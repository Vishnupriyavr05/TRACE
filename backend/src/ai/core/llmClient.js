/**
 * @fileoverview Provider-agnostic LLM client with timeout + transient retries.
 * Agents depend on this client — never on a vendor SDK.
 */
import { NODE_ENV } from '../../config/environment/env.js'
import { getLlmProvider, getSafeAiMeta } from '../providers/index.js'
import {
  AiRateLimitError,
  AiProviderError,
  AiTimeoutError,
  AI_RATE_LIMIT_MAX_DELAY_MS,
  isPayloadTooLargeError,
} from './errors.js'
import {
  assertWithinLlmBudget,
  recordLlmAttempt,
  recordUnrecoverableProviderFailure,
} from './llmAccounting.js'
import {
  assertProviderCircuitAllows,
  openCircuitFromRateLimitError,
} from './providerCircuit.js'
import {
  enforceContextBudget,
  isContextBudgetError,
} from './contextBudget.js'

const DEFAULT_RETRIES = 2

/** Exponential rate-limit floor/base (matches prior 5s · 2^attempt design). */
const RATE_LIMIT_BASE_MS = 5000

/** Short transient backoff for 5xx / timeouts only — never for 429. */
const TRANSIENT_BASE_MS = 250

/** Absolute minimum wait before any retry — never retry immediately. */
const MIN_RETRY_DELAY_MS = 1000

/** @type {{ chat: Function } | null} */
let testProviderOverride = null

/** When set, backoff sleeps this many ms instead of computed wait (offline tests). */
let testBackoffSleepMs = null

/**
 * Offline-test seam only. Does not change production provider selection.
 *
 * @param {{ provider?: { chat: Function } | null, backoffSleepMs?: number | null }} [hooks]
 */
export function __setChatTestHooks(hooks = {}) {
  if ('provider' in hooks) {
    testProviderOverride = hooks.provider ?? null
  }
  if ('backoffSleepMs' in hooks) {
    testBackoffSleepMs =
      typeof hooks.backoffSleepMs === 'number' ? hooks.backoffSleepMs : null
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  if (!error || typeof error !== 'object') return false
  // 413 is never a rate limit (Groq: payload too large)
  if (isPayloadTooLargeError(error)) return false
  if (error instanceof AiRateLimitError) return true
  if (error.code === 'AI_RATE_LIMIT') return true
  if (error.name === 'AiRateLimitError') return true
  if (Number(error.statusCode) === 429 || Number(error.status) === 429) {
    return true
  }
  return false
}

/**
 * Daily / very-long resets should not burn the TRACE retry budget.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isUnrecoverableRateLimit(error) {
  if (!isRateLimitError(error)) return false
  const kind = String(error?.rateLimitKind || '')
  if (kind === 'RPD') return true
  const resetMs = Math.max(
    Number(error?.rateLimit?.resetRequestsMs) || 0,
    Number(error?.rateLimit?.resetTokensMs) || 0,
    Number(error?.retryAfterMs) || 0,
  )
  // Beyond our wait cap — unlikely to succeed within this TRACE
  if (resetMs > AI_RATE_LIMIT_MAX_DELAY_MS) return true
  return false
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransient(error) {
  // 413 → do not retry; callers must reduce payload instead
  if (isPayloadTooLargeError(error)) return false
  if (isUnrecoverableRateLimit(error)) return false
  return (
    isRateLimitError(error) ||
    error instanceof AiTimeoutError ||
    (error instanceof AiProviderError && error.statusCode >= 500)
  )
}

/**
 * Compute wait before a retry. Rate-limit path is separate from short transient path.
 *
 * 429 rule: waitMs = min(cap, max(Retry-AfterMs, exponentialBackoffMs))
 * Tiny Retry-After values (e.g. 1s) cannot undercut the safer exponential floor.
 *
 * @param {number} attempt - zero-based attempt that just failed
 * @param {unknown} [error]
 * @returns {{ waitMs: number, usedRetryAfter: boolean, rateLimited: boolean }}
 */
export function computeRetryWait(attempt, error) {
  const rateLimited = isRateLimitError(error)

  if (!rateLimited) {
    const waitMs = Math.max(
      MIN_RETRY_DELAY_MS,
      Math.min(2000, TRANSIENT_BASE_MS * 2 ** attempt),
    )
    return { waitMs, usedRetryAfter: false, rateLimited: false }
  }

  const exponential = Math.min(
    AI_RATE_LIMIT_MAX_DELAY_MS,
    RATE_LIMIT_BASE_MS * 2 ** attempt,
  )

  const fromHeader =
    typeof error?.retryAfterMs === 'number' &&
    Number.isFinite(error.retryAfterMs) &&
    error.retryAfterMs > 0
      ? Math.min(AI_RATE_LIMIT_MAX_DELAY_MS, error.retryAfterMs)
      : null

  const waitMs = Math.max(
    MIN_RETRY_DELAY_MS,
    Math.min(
      AI_RATE_LIMIT_MAX_DELAY_MS,
      Math.max(exponential, fromHeader ?? 0),
    ),
  )

  return {
    waitMs,
    usedRetryAfter: fromHeader != null,
    rateLimited: true,
  }
}

/**
 * @param {number} attempt
 * @param {unknown} [error]
 * @returns {Promise<{ waitMs: number, usedRetryAfter: boolean, rateLimited: boolean }>}
 */
async function backoff(attempt, error) {
  const plan = computeRetryWait(attempt, error)
  const sleepMs =
    testBackoffSleepMs != null ? testBackoffSleepMs : plan.waitMs
  await new Promise((resolve) => setTimeout(resolve, sleepMs))
  return plan
}

/**
 * Safe log helper — never logs keys, auth headers, or full prompts/responses.
 *
 * @param {string} event
 * @param {object} [meta]
 */
function logAiEvent(event, meta = {}) {
  const rateLimit = meta.rateLimit || null
  const safe = {
    provider: meta.provider,
    model: meta.model,
    latencyMs: meta.latencyMs,
    ok: meta.ok,
    agent: meta.agent,
    runId: meta.runId,
    attempt: meta.attempt,
    status: meta.status,
    waitMs: meta.waitMs,
    usedRetryAfter: meta.usedRetryAfter,
    rateLimited: meta.rateLimited,
    code: meta.code,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
    totalTokens: meta.totalTokens,
    retryCount: meta.retryCount,
    retryAfter: meta.retryAfter ?? rateLimit?.['retry-after'] ?? null,
    'x-ratelimit-limit-requests':
      rateLimit?.['x-ratelimit-limit-requests'] ?? null,
    'x-ratelimit-remaining-requests':
      rateLimit?.['x-ratelimit-remaining-requests'] ?? null,
    'x-ratelimit-reset-requests':
      rateLimit?.['x-ratelimit-reset-requests'] ?? null,
    'x-ratelimit-limit-tokens': rateLimit?.['x-ratelimit-limit-tokens'] ?? null,
    'x-ratelimit-remaining-tokens':
      rateLimit?.['x-ratelimit-remaining-tokens'] ?? null,
    'x-ratelimit-reset-tokens': rateLimit?.['x-ratelimit-reset-tokens'] ?? null,
    rateLimitKind: meta.rateLimitKind ?? null,
    providerErrorType: meta.providerErrorType ?? null,
    providerErrorMessage: meta.providerErrorMessage ?? null,
    finishReason: meta.finishReason ?? null,
  }

  if (NODE_ENV === 'production') {
    console.info('[AI]', event, {
      provider: safe.provider,
      model: safe.model,
      latencyMs: safe.latencyMs,
      ok: safe.ok,
      agent: safe.agent,
      runId: safe.runId,
      attempt: safe.attempt,
      status: safe.status,
      waitMs: safe.waitMs,
      usedRetryAfter: safe.usedRetryAfter,
      inputTokens: safe.inputTokens,
      outputTokens: safe.outputTokens,
      totalTokens: safe.totalTokens,
      retryCount: safe.retryCount,
      retryAfter: safe.retryAfter,
      'x-ratelimit-limit-requests': safe['x-ratelimit-limit-requests'],
      'x-ratelimit-remaining-requests': safe['x-ratelimit-remaining-requests'],
      'x-ratelimit-reset-requests': safe['x-ratelimit-reset-requests'],
      'x-ratelimit-limit-tokens': safe['x-ratelimit-limit-tokens'],
      'x-ratelimit-remaining-tokens': safe['x-ratelimit-remaining-tokens'],
      'x-ratelimit-reset-tokens': safe['x-ratelimit-reset-tokens'],
      rateLimitKind: safe.rateLimitKind,
      providerErrorType: safe.providerErrorType,
      code: safe.code,
    })
    return
  }

  console.info('[AI]', event, {
    ...getSafeAiMeta(),
    ...safe,
  })
}

/**
 * Chat completion via the configured provider adapter.
 *
 * @param {import('../providers/llm.provider.js').LlmChatRequest} request
 * @param {{ retries?: number, agent?: string, runId?: string }} [options]
 * @returns {Promise<import('../providers/llm.provider.js').LlmChatResponse>}
 */
export async function chat(request, options = {}) {
  const provider = testProviderOverride || getLlmProvider()
  const retries =
    typeof options.retries === 'number'
      ? options.retries
      : Number(process.env.AI_MAX_RETRIES) || DEFAULT_RETRIES

  // Local context budget: measure → compact → fail locally (never send oversized)
  let boundedRequest = request
  let contextMeasure = null
  try {
    const enforced = enforceContextBudget(request, {
      agent: options.agent,
      runId: options.runId,
    })
    boundedRequest = enforced.request
    contextMeasure = enforced.measure
  } catch (error) {
    if (isContextBudgetError(error)) {
      // Do not retry; do not call provider
      throw error
    }
    throw error
  }

  // Circuit breaker: fail locally when TRACE/provider is already rate-blocked
  assertProviderCircuitAllows({
    agent: options.agent,
    runId: options.runId,
  })

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    assertWithinLlmBudget({ agent: options.agent, runId: options.runId })
    // Re-check each attempt (cooldown may open mid-retry via sibling paths)
    assertProviderCircuitAllows({
      agent: options.agent,
      runId: options.runId,
    })

    try {
      const result = await provider.chat(boundedRequest)
      const inputTokens = result.usage?.promptTokens ?? null
      const outputTokens = result.usage?.completionTokens ?? null
      const totalTokens = result.usage?.totalTokens ?? null

      recordLlmAttempt({
        ok: true,
        status: result.httpStatus || 200,
        agent: options.agent,
        inputTokens,
        outputTokens,
        totalTokens,
        isRetry: attempt > 0,
        rateLimit: result.rateLimit || null,
        retryAfterMs: null,
        rateLimitKind: null,
        serializedChars: contextMeasure?.serializedChars,
        estimatedInputTokens: contextMeasure?.estimatedInputTokens,
        maxInputTokens: contextMeasure?.maxInputTokens,
        requestedOutputTokens: contextMeasure?.requestedOutputTokens,
      })

      logAiEvent('chat.success', {
        ...getSafeAiMeta(),
        model: result.model,
        latencyMs: result.latencyMs,
        ok: true,
        agent: options.agent,
        runId: options.runId,
        attempt,
        status: 200,
        inputTokens,
        outputTokens,
        totalTokens,
        retryCount: attempt,
        rateLimit: result.rateLimit || null,
        finishReason: result.finishReason ?? null,
      })
      return result
    } catch (error) {
      lastError = error

      // Local circuit blocks must not count as provider HTTP attempts
      if (error?.locallyBlocked || error?.circuitOpen) {
        throw error
      }

      const status =
        Number(error?.statusCode) ||
        Number(error?.status) ||
        (isRateLimitError(error) ? 429 : undefined)

      recordLlmAttempt({
        ok: false,
        status,
        agent: options.agent,
        code: error?.code,
        rateLimitKind: error?.rateLimitKind || null,
        providerErrorType: error?.providerErrorType || null,
        providerErrorMessage: error?.providerErrorMessage || null,
        isRetry: attempt > 0,
        rateLimit: error?.rateLimit || null,
        retryAfterMs:
          typeof error?.retryAfterMs === 'number' ? error.retryAfterMs : null,
      })

      logAiEvent('chat.failure', {
        ...getSafeAiMeta(),
        model: getSafeAiMeta().model,
        ok: false,
        agent: options.agent,
        runId: options.runId,
        attempt,
        status,
        code: error?.code,
        rateLimited: isRateLimitError(error),
        retryCount: attempt,
        retryAfter: error?.retryAfterMs != null
          ? String(Math.ceil(error.retryAfterMs / 1000))
          : error?.rateLimit?.['retry-after'] || null,
        rateLimit: error?.rateLimit || null,
        rateLimitKind: error?.rateLimitKind || null,
        providerErrorType: error?.providerErrorType || null,
        providerErrorMessage: error?.providerErrorMessage || null,
      })

      // 413: never retry — payload must be reduced by the caller
      if (isPayloadTooLargeError(error)) {
        recordUnrecoverableProviderFailure({
          agent: options.agent,
          status,
          code: error?.code,
        })
        throw error
      }

      // Local budget failures never retry / never hit provider
      if (isContextBudgetError(error)) {
        throw error
      }

      // Local circuit blocks are already terminal (should not reach here)
      if (error?.locallyBlocked || error?.circuitOpen) {
        throw error
      }

      if (isUnrecoverableRateLimit(error)) {
        openCircuitFromRateLimitError(error, {
          agent: options.agent,
          runId: options.runId,
          reasonCode: 'RATE_LIMIT_UNRECOVERABLE',
        })
        recordUnrecoverableProviderFailure({
          agent: options.agent,
          status,
          code: error?.code,
        })
        throw error
      }

      if (attempt < retries && isTransient(error)) {
        const plan = await backoff(attempt, error)
        logAiEvent('chat.retry_wait', {
          ...getSafeAiMeta(),
          ok: false,
          agent: options.agent,
          runId: options.runId,
          attempt,
          status,
          waitMs: plan.waitMs,
          usedRetryAfter: plan.usedRetryAfter,
          rateLimited: plan.rateLimited,
          code: error?.code,
          retryCount: attempt + 1,
          retryAfter: error?.retryAfterMs != null
            ? String(Math.ceil(error.retryAfterMs / 1000))
            : error?.rateLimit?.['retry-after'] || null,
          rateLimit: error?.rateLimit || null,
          rateLimitKind: error?.rateLimitKind || null,
          providerErrorType: error?.providerErrorType || null,
          providerErrorMessage: error?.providerErrorMessage || null,
        })
        continue
      }

      if (isRateLimitError(error)) {
        openCircuitFromRateLimitError(error, {
          agent: options.agent,
          runId: options.runId,
          reasonCode: 'RATE_LIMIT_RETRIES_EXHAUSTED',
        })
      }
      recordUnrecoverableProviderFailure({
        agent: options.agent,
        status,
        code: error?.code,
      })
      throw error
    }
  }
  throw lastError
}

/**
 * Back-compat facade formerly exposed by llm/llm.service.js.
 *
 * @param {{ role: string, content: string }[]} messages
 * @param {object} [options]
 */
export async function generate(messages, options = {}) {
  const result = await chat({
    messages,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    jsonMode: options.jsonMode,
  })
  return {
    text: result.text,
    model: result.model,
    usage: result.usage,
    provider: result.provider,
  }
}

export async function healthCheck() {
  const meta = getSafeAiMeta()
  try {
    getLlmProvider()
    return { ok: true, provider: meta.provider, model: meta.model }
  } catch (error) {
    return {
      ok: false,
      provider: meta.provider,
      model: meta.model,
      message: error?.message || 'AI not configured',
    }
  }
}

export default {
  chat,
  generate,
  healthCheck,
  isRateLimitError,
  isUnrecoverableRateLimit,
  computeRetryWait,
  isContextBudgetError,
}
