/**
 * @fileoverview Per-TRACE LLM request accounting + hard call budget.
 * Uses AsyncLocalStorage so agents need not pass counters explicitly.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { AppError } from '../../utils/AppError.js'
import { getProviderTpmConfig } from './traceProfile.js'
import { parseResetToMs } from './rateLimitHeaders.js'

const storage = new AsyncLocalStorage()

/** Default hard cap on provider HTTP attempts per TRACE run. */
export const DEFAULT_TRACE_MAX_LLM_CALLS = 24

/** Bounded history of safe rate-limit snapshots per TRACE. */
const MAX_RATE_LIMIT_SAMPLES = 32

const RATE_LIMIT_KINDS = Object.freeze([
  'RPM',
  'RPD',
  'TPM',
  'ITPM',
  'OTPM',
  'REQUESTS_AND_TOKENS',
  'UNKNOWN',
])

export class AiLlmBudgetError extends AppError {
  constructor(message = 'TRACE LLM call budget exceeded', meta = {}) {
    super(message, 503)
    this.name = 'AiLlmBudgetError'
    this.code = 'AI_LLM_BUDGET'
    this.budget = meta
  }
}

/**
 * Normalize a SAFE rate-limit snapshot for accounting (no secrets / raw headers).
 *
 * @param {object|null|undefined} input
 * @returns {object|null}
 */
export function normalizeRateLimitSnapshot(input) {
  if (!input || typeof input !== 'object') return null

  const retryAfterMs =
    typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs)
      ? input.retryAfterMs
      : null

  const limitRequests =
    input.limitRequests != null && Number.isFinite(Number(input.limitRequests))
      ? Number(input.limitRequests)
      : null
  const remainingRequests =
    input.remainingRequests != null &&
    Number.isFinite(Number(input.remainingRequests))
      ? Number(input.remainingRequests)
      : null
  const limitTokens =
    input.limitTokens != null && Number.isFinite(Number(input.limitTokens))
      ? Number(input.limitTokens)
      : null
  const remainingTokens =
    input.remainingTokens != null &&
    Number.isFinite(Number(input.remainingTokens))
      ? Number(input.remainingTokens)
      : null

  // Prefer raw header strings when present; else ms forms; never invent values
  const resetRequests =
    input.resetRequests != null
      ? String(input.resetRequests)
      : input['x-ratelimit-reset-requests'] != null
        ? String(input['x-ratelimit-reset-requests'])
        : input.resetRequestsMs != null &&
            Number.isFinite(Number(input.resetRequestsMs))
          ? String(input.resetRequestsMs)
          : null

  const resetTokens =
    input.resetTokens != null
      ? String(input.resetTokens)
      : input['x-ratelimit-reset-tokens'] != null
        ? String(input['x-ratelimit-reset-tokens'])
        : input.resetTokensMs != null &&
            Number.isFinite(Number(input.resetTokensMs))
          ? String(input.resetTokensMs)
          : null

  // Fill numeric limits from header aliases when normalized fields absent
  const limitRequestsFinal =
    limitRequests != null
      ? limitRequests
      : input['x-ratelimit-limit-requests'] != null &&
          Number.isFinite(Number(input['x-ratelimit-limit-requests']))
        ? Number(input['x-ratelimit-limit-requests'])
        : null
  const remainingRequestsFinal =
    remainingRequests != null
      ? remainingRequests
      : input['x-ratelimit-remaining-requests'] != null &&
          Number.isFinite(Number(input['x-ratelimit-remaining-requests']))
        ? Number(input['x-ratelimit-remaining-requests'])
        : null
  const limitTokensFinal =
    limitTokens != null
      ? limitTokens
      : input['x-ratelimit-limit-tokens'] != null &&
          Number.isFinite(Number(input['x-ratelimit-limit-tokens']))
        ? Number(input['x-ratelimit-limit-tokens'])
        : null
  const remainingTokensFinal =
    remainingTokens != null
      ? remainingTokens
      : input['x-ratelimit-remaining-tokens'] != null &&
          Number.isFinite(Number(input['x-ratelimit-remaining-tokens']))
        ? Number(input['x-ratelimit-remaining-tokens'])
        : null

  const retryAfterMsFinal =
    retryAfterMs != null
      ? retryAfterMs
      : input['retry-after'] != null &&
          Number.isFinite(Number(input['retry-after']))
        ? Math.ceil(Number(input['retry-after']) * 1000)
        : null

  const kindRaw =
    typeof input.rateLimitKind === 'string' && input.rateLimitKind
      ? input.rateLimitKind
      : null
  const rateLimitKind = kindRaw && RATE_LIMIT_KINDS.includes(kindRaw)
    ? kindRaw
    : kindRaw
      ? 'UNKNOWN'
      : null

  const snapshot = {
    retryAfterMs: retryAfterMsFinal,
    limitRequests: limitRequestsFinal,
    remainingRequests: remainingRequestsFinal,
    resetRequests,
    limitTokens: limitTokensFinal,
    remainingTokens: remainingTokensFinal,
    resetTokens,
    rateLimitKind,
  }

  const hasAny = Object.values(snapshot).some((v) => v != null)
  return hasAny ? snapshot : null
}

/**
 * @returns {object}
 */
function emptyRateLimitAgg() {
  return {
    attemptsWithRateLimitData: 0,
    retryAfterMs: [],
    limitRequests: [],
    remainingRequests: [],
    resetRequests: [],
    limitTokens: [],
    remainingTokens: [],
    resetTokens: [],
    byKind: {
      RPM: 0,
      RPD: 0,
      TPM: 0,
      ITPM: 0,
      OTPM: 0,
      REQUESTS_AND_TOKENS: 0,
      UNKNOWN: 0,
    },
  }
}

/**
 * @param {{ runId?: string, maxCalls?: number }} [options]
 * @returns {object}
 */
export function createTraceAccounting(options = {}) {
  const maxCalls =
    typeof options.maxCalls === 'number' && options.maxCalls > 0
      ? Math.floor(options.maxCalls)
      : Number(process.env.TRACE_MAX_LLM_CALLS) > 0
        ? Math.floor(Number(process.env.TRACE_MAX_LLM_CALLS))
        : DEFAULT_TRACE_MAX_LLM_CALLS

  return {
    runId: options.runId || null,
    maxCalls,
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    count429: 0,
    count413: 0,
    retries: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    byAgent: Object.create(null),
    lastError: null,
    rateLimitSamples: [],
    contextBudgetFailures: 0,
    totalBudgetCompactions: 0,
    unrecoverableProviderFailures: 0,
    providerCircuitOpened: false,
    providerCircuitReason: null,
    providerCooldownUntil: null,
    locallyBlockedLlmCalls: 0,
    providerCircuit: null,
  }
}

/**
 * @param {object} accounting
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>|T}
 * @template T
 */
export function runWithTraceAccounting(accounting, fn) {
  return storage.run(accounting, fn)
}

/**
 * @returns {object|null}
 */
export function getTraceAccounting() {
  return storage.getStore() || null
}

/**
 * @param {string} [agent]
 * @returns {object}
 */
function agentBucket(accounting, agent) {
  const key = agent || 'unknown'
  if (!accounting.byAgent[key]) {
    accounting.byAgent[key] = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      count429: 0,
      count413: 0,
      retries: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      // Extended TRACE diagnostics (do not alter meaning of counters above)
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedContextTokens: 0,
      maxContextTokens: null,
      budgetCompactions: 0,
      providerFailures: 0,
      unrecoverableProviderFailures: 0,
    }
  }
  return accounting.byAgent[key]
}

/**
 * Throw if the TRACE has exhausted its LLM call budget.
 *
 * @param {{ agent?: string, runId?: string }} [meta]
 */
export function assertWithinLlmBudget(meta = {}) {
  const accounting = getTraceAccounting()
  if (!accounting) return
  if (accounting.totalCalls >= accounting.maxCalls) {
    throw new AiLlmBudgetError(
      `TRACE LLM call budget exceeded (${accounting.totalCalls}/${accounting.maxCalls})`,
      {
        runId: accounting.runId || meta.runId || null,
        agent: meta.agent || null,
        totalCalls: accounting.totalCalls,
        maxCalls: accounting.maxCalls,
      }
    )
  }
}

/**
 * Record one provider HTTP attempt (success or failure).
 *
 * @param {object} event
 */
export function recordLlmAttempt(event = {}) {
  const accounting = getTraceAccounting()
  if (!accounting) return null

  accounting.totalCalls += 1
  const bucket = agentBucket(accounting, event.agent)
  bucket.totalCalls += 1
  bucket.calls = bucket.totalCalls

  const status = Number(event.status) || null
  const ok = Boolean(event.ok)

  if (ok) {
    accounting.successfulCalls += 1
    bucket.successfulCalls += 1
    const input = Number(event.inputTokens) || 0
    const output = Number(event.outputTokens) || 0
    const total =
      Number(event.totalTokens) ||
      (input || output ? input + output : 0)
    accounting.totalInputTokens += input
    accounting.totalOutputTokens += output
    accounting.totalTokens += total
    bucket.totalInputTokens += input
    bucket.totalOutputTokens += output
    bucket.totalTokens += total
    bucket.inputTokens = bucket.totalInputTokens
    bucket.outputTokens = bucket.totalOutputTokens
  } else {
    accounting.failedCalls += 1
    bucket.failedCalls += 1
    bucket.providerFailures = (bucket.providerFailures || 0) + 1
    if (status === 429) {
      accounting.count429 += 1
      bucket.count429 += 1
    }
    if (status === 413) {
      accounting.count413 += 1
      bucket.count413 += 1
    }
    accounting.lastError = {
      status,
      code: event.code || null,
      agent: event.agent || null,
      rateLimitKind: event.rateLimitKind || null,
      providerErrorType: event.providerErrorType || null,
      providerErrorMessage: event.providerErrorMessage || null,
      serializedChars: event.serializedChars ?? null,
      estimatedInputTokens: event.estimatedInputTokens ?? null,
      maxInputTokens: event.maxInputTokens ?? null,
      requestedOutputTokens: event.requestedOutputTokens ?? null,
    }
  }

  if (event.isRetry) {
    accounting.retries += 1
    bucket.retries += 1
  }

  // Safe rate-limit snapshot (optional). Never store raw headers/bodies/secrets.
  const rateLimitSnapshot = normalizeRateLimitSnapshot({
    ...(event.rateLimit && typeof event.rateLimit === 'object'
      ? event.rateLimit
      : {}),
    retryAfterMs:
      event.retryAfterMs != null
        ? event.retryAfterMs
        : event.rateLimit?.retryAfterMs,
    rateLimitKind: event.rateLimitKind ?? event.rateLimit?.rateLimitKind,
  })

  if (rateLimitSnapshot) {
    if (!Array.isArray(accounting.rateLimitSamples)) {
      accounting.rateLimitSamples = []
    }
    if (accounting.rateLimitSamples.length < MAX_RATE_LIMIT_SAMPLES) {
      accounting.rateLimitSamples.push({
        agent: event.agent || null,
        status,
        ok,
        ...rateLimitSnapshot,
      })
    }
  }

  return snapshotTraceAccounting(accounting)
}

/**
 * Record local context-budget compaction / failure (not a provider call).
 *
 * @param {object} event
 */
export function recordContextBudgetEvent(event = {}) {
  const accounting = getTraceAccounting()
  if (!accounting) return null
  const bucket = agentBucket(accounting, event.agent)
  const comps = Number(event.budgetCompactions) || 0
  if (comps > 0) {
    accounting.totalBudgetComped =
      (accounting.totalBudgetComped || 0) + comps
    bucket.budgetCompactions = (bucket.budgetCompactions || 0) + comps
  }
  if (typeof event.estimatedContextTokens === 'number') {
    bucket.estimatedContextTokens = event.estimatedContextTokens
  }
  if (typeof event.maxContextTokens === 'number') {
    bucket.maxContextTokens = event.maxContextTokens
  }
  if (event.failed) {
    accounting.contextBudgetFailures =
      (accounting.contextBudgetFailures || 0) + 1
  }
  return snapshotTraceAccounting(accounting)
}

/**
 * Record one logical LLM operation that ended in unrecoverable provider failure
 * (retries exhausted, non-retryable 413, unrecoverable rate limit, etc.).
 * Does NOT count recovered transient attempts (e.g. 429 → 200).
 *
 * @param {{ agent?: string, status?: number|null, code?: string|null }} [event]
 */
export function recordUnrecoverableProviderFailure(event = {}) {
  const accounting = getTraceAccounting()
  if (!accounting) return null
  accounting.unrecoverableProviderFailures =
    (accounting.unrecoverableProviderFailures || 0) + 1
  const bucket = agentBucket(accounting, event.agent)
  bucket.unrecoverableProviderFailures =
    (bucket.unrecoverableProviderFailures || 0) + 1
  return snapshotTraceAccounting(accounting)
}

/**
 * Mark that the provider circuit opened for this TRACE (idempotent flag).
 *
 * @param {{
 *   reasonCode?: string|null,
 *   rateLimitKind?: string|null,
 *   cooldownUntil?: number|null,
 *   agent?: string|null,
 * }} [event]
 */
export function recordProviderCircuitOpen(event = {}) {
  const accounting = getTraceAccounting()
  if (!accounting) return null
  accounting.providerCircuitOpened = true
  accounting.providerCircuitReason =
    event.reasonCode || accounting.providerCircuitReason || null
  if (typeof event.cooldownUntil === 'number') {
    accounting.providerCooldownUntil = new Date(event.cooldownUntil).toISOString()
  }
  return snapshotTraceAccounting(accounting)
}

/**
 * Local circuit block — not a provider HTTP attempt.
 *
 * @param {{ agent?: string|null, reasonCode?: string|null }} [event]
 */
export function recordLocallyBlockedLlmCall(event = {}) {
  const accounting = getTraceAccounting()
  if (!accounting) return null
  accounting.locallyBlockedLlmCalls = (accounting.locallyBlockedLlmCalls || 0) + 1
  const bucket = agentBucket(accounting, event.agent)
  bucket.locallyBlockedLlmCalls = (bucket.locallyBlockedLlmCalls || 0) + 1
  return snapshotTraceAccounting(accounting)
}

/**
 * Aggregate safe rate-limit samples for TRACE diagnostics.
 *
 * @param {object[]} samples
 * @returns {object}
 */
export function aggregateRateLimits(samples = []) {
  const agg = emptyRateLimitAgg()
  for (const sample of samples || []) {
    if (!sample || typeof sample !== 'object') continue
    agg.attemptsWithRateLimitData += 1
    agg.retryAfterMs.push(
      sample.retryAfterMs != null ? sample.retryAfterMs : null,
    )
    agg.limitRequests.push(
      sample.limitRequests != null ? sample.limitRequests : null,
    )
    agg.remainingRequests.push(
      sample.remainingRequests != null ? sample.remainingRequests : null,
    )
    agg.resetRequests.push(
      sample.resetRequests != null ? sample.resetRequests : null,
    )
    agg.limitTokens.push(
      sample.limitTokens != null ? sample.limitTokens : null,
    )
    agg.remainingTokens.push(
      sample.remainingTokens != null ? sample.remainingTokens : null,
    )
    agg.resetTokens.push(
      sample.resetTokens != null ? sample.resetTokens : null,
    )
    const kind = sample.rateLimitKind || 'UNKNOWN'
    if (kind in agg.byKind) agg.byKind[kind] += 1
    else agg.byKind.UNKNOWN += 1
  }
  return agg
}

/**
 * @param {object} [accounting]
 * @returns {object|null}
 */
export function snapshotTraceAccounting(accounting = getTraceAccounting()) {
  if (!accounting) return null
  const byAgent = { ...accounting.byAgent }
  /** @type {object} */
  const perAgent = {}
  for (const [agent, bucket] of Object.entries(byAgent)) {
    perAgent[agent] = {
      calls: bucket.calls ?? bucket.totalCalls ?? 0,
      inputTokens: bucket.inputTokens ?? bucket.totalInputTokens ?? 0,
      outputTokens: bucket.outputTokens ?? bucket.totalOutputTokens ?? 0,
      estimatedContextTokens: bucket.estimatedContextTokens ?? 0,
      maxContextTokens: bucket.maxContextTokens ?? null,
      budgetCompactions: bucket.budgetCompactions ?? 0,
      providerFailures: bucket.providerFailures ?? 0,
      unrecoverableProviderFailures: bucket.unrecoverableProviderFailures ?? 0,
      locallyBlockedLlmCalls: bucket.locallyBlockedLlmCalls ?? 0,
    }
  }
  return {
    runId: accounting.runId,
    maxCalls: accounting.maxCalls,
    totalCalls: accounting.totalCalls,
    successfulCalls: accounting.successfulCalls,
    failedCalls: accounting.failedCalls,
    count429: accounting.count429,
    count413: accounting.count413,
    retries: accounting.retries,
    totalInputTokens: accounting.totalInputTokens,
    totalOutputTokens: accounting.totalOutputTokens,
    totalTokens: accounting.totalTokens,
    byAgent,
    perAgent,
    lastError: accounting.lastError,
    budgetRemaining: Math.max(0, accounting.maxCalls - accounting.totalCalls),
    rateLimits: aggregateRateLimits(accounting.rateLimitSamples || []),
    contextBudgetFailures: accounting.contextBudgetFailures || 0,
    totalBudgetCompactions: accounting.totalBudgetCompactions || 0,
    unrecoverableProviderFailures:
      accounting.unrecoverableProviderFailures || 0,
    providerCircuitOpened: Boolean(accounting.providerCircuitOpened),
    providerCircuitReason: accounting.providerCircuitReason || null,
    providerCooldownUntil: accounting.providerCooldownUntil || null,
    locallyBlockedLlmCalls: accounting.locallyBlockedLlmCalls || 0,
  }
}

/**
 * Latest provider TPM headroom from rate-limit headers + TRACE usage.
 * remainingTokens is the conservative minimum of header-reported and computed.
 *
 * @returns {{
 *   remainingTokens: number|null,
 *   limitTokens: number|null,
 *   resetTokensMs: number|null
 * }|null}
 */
export function getProviderTpmHeadroom() {
  const tpm = getProviderTpmConfig()
  if (!tpm.enabled) return null

  const accounting = getTraceAccounting()
  const samples = accounting?.rateLimitSamples || []
  const last = samples.length ? samples[samples.length - 1] : null

  const limitTokens =
    last?.limitTokens != null && last.limitTokens > 0
      ? last.limitTokens
      : tpm.limit

  let headerRemaining = null
  if (last?.remainingTokens != null && last.remainingTokens >= 0) {
    headerRemaining = last.remainingTokens
  }

  const used = Number(accounting?.totalTokens) || 0
  const computedRemaining = Math.max(
    0,
    limitTokens - used - tpm.safetyMargin,
  )

  let remainingTokens = headerRemaining
  if (remainingTokens != null) {
    remainingTokens = Math.min(remainingTokens, computedRemaining)
  } else {
    remainingTokens = computedRemaining
  }

  const resetTokensMs = last?.resetTokens
    ? parseResetToMs(last.resetTokens)
    : null

  return {
    remainingTokens,
    limitTokens,
    resetTokensMs,
  }
}

export default {
  createTraceAccounting,
  runWithTraceAccounting,
  getTraceAccounting,
  assertWithinLlmBudget,
  recordLlmAttempt,
  recordContextBudgetEvent,
  recordUnrecoverableProviderFailure,
  recordProviderCircuitOpen,
  recordLocallyBlockedLlmCall,
  snapshotTraceAccounting,
  normalizeRateLimitSnapshot,
  aggregateRateLimits,
  getProviderTpmHeadroom,
  AiLlmBudgetError,
  DEFAULT_TRACE_MAX_LLM_CALLS,
}
