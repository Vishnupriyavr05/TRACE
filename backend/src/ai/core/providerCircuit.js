/**
 * @fileoverview Provider rate-limit circuit breaker (shared LLM boundary).
 *
 * CLOSED → normal requests
 * OPEN (unrecoverable / exhausted 429 / provider cooldown) → fail locally,
 * never call the provider HTTP API.
 *
 * Safe diagnostics only — no API keys, Authorization, prompts, or raw bodies.
 */
import { getSafeAiMeta } from '../providers/index.js'
import { AiRateLimitError, AI_RATE_LIMIT_MAX_DELAY_MS } from './errors.js'
import {
  getTraceAccounting,
  recordProviderCircuitOpen,
  recordLocallyBlockedLlmCall,
} from './llmAccounting.js'

/** Conservative cooldown when provider gives no reset/Retry-After (ms). */
export const PROVIDER_CONSERVATIVE_COOLDOWN_MS = AI_RATE_LIMIT_MAX_DELAY_MS

/**
 * Process-wide provider cooldown (survives across TRACE runs in this process).
 * @type {{
 *   open: boolean,
 *   cooldownUntil: number|null,
 *   reasonCode: string|null,
 *   rateLimitKind: string|null,
 *   retryAfterMs: number|null,
 *   resetRequests: string|null,
 *   resetTokens: string|null,
 *   openedAt: string|null,
 *   runId: string|null,
 *   agent: string|null,
 *   provider: string|null,
 * }}
 */
let providerCooldown = emptyProviderCooldown()

/**
 * @returns {typeof providerCooldown}
 */
function emptyProviderCooldown() {
  return {
    open: false,
    cooldownUntil: null,
    reasonCode: null,
    rateLimitKind: null,
    retryAfterMs: null,
    resetRequests: null,
    resetTokens: null,
    openedAt: null,
    runId: null,
    agent: null,
    provider: null,
  }
}

/**
 * @returns {object}
 */
export function getProviderCooldownState() {
  maybeExpireProviderCooldown()
  return { ...providerCooldown }
}

/**
 * Test helper — reset process cooldown.
 */
export function resetProviderCircuitForTests() {
  providerCooldown = emptyProviderCooldown()
}

/**
 * @returns {void}
 */
function maybeExpireProviderCooldown() {
  if (
    providerCooldown.open &&
    providerCooldown.cooldownUntil != null &&
    Date.now() >= providerCooldown.cooldownUntil
  ) {
    providerCooldown = emptyProviderCooldown()
  }
}

/**
 * Expire the per-TRACE circuit snapshot with the same cooldown semantics as
 * the process-wide circuit. The snapshot is accounting state, but it is also
 * consulted when admitting subsequent calls in the same TRACE.
 *
 * @param {object|null} accounting
 * @returns {void}
 */
function maybeExpireTraceCircuit(accounting) {
  if (
    accounting?.providerCircuit?.open &&
    accounting.providerCircuit.cooldownUntil != null &&
    Date.now() >= accounting.providerCircuit.cooldownUntil
  ) {
    accounting.providerCircuit = null
  }
}

/**
 * Compute cooldown end from known provider signals only.
 * Missing headers remain null — never invent reset strings.
 *
 * @param {{
 *   retryAfterMs?: number|null,
 *   resetRequestsMs?: number|null,
 *   resetTokensMs?: number|null,
 * }} [signals]
 * @returns {{ cooldownUntil: number, usedConservative: boolean }}
 */
export function computeCooldownUntil(signals = {}) {
  const candidates = [
    Number(signals.retryAfterMs) || 0,
    Number(signals.resetRequestsMs) || 0,
    Number(signals.resetTokensMs) || 0,
  ].filter((n) => n > 0)

  if (candidates.length) {
    const waitMs = Math.max(...candidates)
    return {
      cooldownUntil: Date.now() + waitMs,
      usedConservative: false,
    }
  }

  return {
    cooldownUntil: Date.now() + PROVIDER_CONSERVATIVE_COOLDOWN_MS,
    usedConservative: true,
  }
}

/**
 * User-facing terminal rate-limit message (safe).
 *
 * @param {{ cooldownUntil?: number|null, rateLimitKind?: string|null }} [info]
 * @returns {string}
 */
export function formatProviderRateLimitUserMessage(info = {}) {
  const base =
    'AI provider rate limit reached. TRACE stopped safely. Try again after the provider reset.'
  const until =
    typeof info.cooldownUntil === 'number' && Number.isFinite(info.cooldownUntil)
      ? info.cooldownUntil
      : null
  if (until && until > Date.now()) {
    return `${base} Provider reset around ${new Date(until).toISOString()}.`
  }
  return base
}

/**
 * Open the circuit for this TRACE + process provider cooldown.
 *
 * @param {{
 *   reasonCode: string,
 *   rateLimitKind?: string|null,
 *   retryAfterMs?: number|null,
 *   resetRequestsMs?: number|null,
 *   resetTokensMs?: number|null,
 *   resetRequests?: string|null,
 *   resetTokens?: string|null,
 *   agent?: string|null,
 *   runId?: string|null,
 *   error?: object|null,
 * }} input
 * @returns {object} circuit snapshot
 */
export function openProviderCircuit(input = {}) {
  const accounting = getTraceAccounting()
  const runId =
    input.runId ||
    accounting?.runId ||
    null
  const rateLimit = input.error?.rateLimit || null
  const retryAfterMs =
    typeof input.retryAfterMs === 'number'
      ? input.retryAfterMs
      : typeof input.error?.retryAfterMs === 'number'
        ? input.error.retryAfterMs
        : null
  const resetRequestsMs =
    typeof input.resetRequestsMs === 'number'
      ? input.resetRequestsMs
      : rateLimit?.resetRequestsMs ?? null
  const resetTokensMs =
    typeof input.resetTokensMs === 'number'
      ? input.resetTokensMs
      : rateLimit?.resetTokensMs ?? null
  const resetRequests =
    input.resetRequests != null
      ? String(input.resetRequests)
      : rateLimit?.['x-ratelimit-reset-requests'] != null
        ? String(rateLimit['x-ratelimit-reset-requests'])
        : rateLimit?.resetRequests != null
          ? String(rateLimit.resetRequests)
          : null
  const resetTokens =
    input.resetTokens != null
      ? String(input.resetTokens)
      : rateLimit?.['x-ratelimit-reset-tokens'] != null
        ? String(rateLimit['x-ratelimit-reset-tokens'])
        : rateLimit?.resetTokens != null
          ? String(rateLimit.resetTokens)
          : null

  const { cooldownUntil, usedConservative } = computeCooldownUntil({
    retryAfterMs,
    resetRequestsMs,
    resetTokensMs,
  })

  const rateLimitKind =
    input.rateLimitKind || input.error?.rateLimitKind || null
  const reasonCode = input.reasonCode || 'RATE_LIMIT_UNRECOVERABLE'
  const openedAt = new Date().toISOString()
  const provider = getSafeAiMeta().provider || null

  const snapshot = {
    open: true,
    reasonCode,
    rateLimitKind,
    retryAfterMs,
    resetRequests,
    resetTokens,
    cooldownUntil,
    usedConservativeCooldown: usedConservative,
    openedAt,
    runId,
    agent: input.agent || null,
    provider,
  }

  providerCooldown = {
    open: true,
    cooldownUntil,
    reasonCode,
    rateLimitKind,
    retryAfterMs,
    resetRequests,
    resetTokens,
    openedAt,
    runId,
    agent: input.agent || null,
    provider,
  }

  if (accounting) {
    accounting.providerCircuit = {
      ...snapshot,
    }
    recordProviderCircuitOpen({
      reasonCode,
      rateLimitKind,
      cooldownUntil,
      agent: input.agent || null,
    })
  }

  return snapshot
}

/**
 * @returns {boolean}
 */
export function isProviderCircuitOpen() {
  maybeExpireProviderCooldown()
  const accounting = getTraceAccounting()
  maybeExpireTraceCircuit(accounting)
  if (accounting?.providerCircuit?.open) return true
  return Boolean(providerCooldown.open)
}

/**
 * Fail fast locally when circuit/cooldown is open. Does not call the provider.
 *
 * @param {{ agent?: string, runId?: string }} [meta]
 */
export function assertProviderCircuitAllows(meta = {}) {
  maybeExpireProviderCooldown()
  const accounting = getTraceAccounting()
  maybeExpireTraceCircuit(accounting)
  const traceOpen = Boolean(accounting?.providerCircuit?.open)
  const providerOpen = Boolean(providerCooldown.open)

  if (!traceOpen && !providerOpen) return

  const source = traceOpen ? accounting.providerCircuit : providerCooldown
  const cooldownUntil = source?.cooldownUntil ?? null

  recordLocallyBlockedLlmCall({
    agent: meta.agent || null,
    reasonCode: source?.reasonCode || 'PROVIDER_CIRCUIT_OPEN',
  })

  throw new AiRateLimitError(formatProviderRateLimitUserMessage({ cooldownUntil }), {
    retryAfterMs:
      cooldownUntil != null && cooldownUntil > Date.now()
        ? cooldownUntil - Date.now()
        : source?.retryAfterMs ?? null,
    rateLimitKind: source?.rateLimitKind || null,
    providerErrorType: 'circuit_open',
    providerErrorMessage: null,
    locallyBlocked: true,
    circuitOpen: true,
    circuitReason: source?.reasonCode || 'PROVIDER_CIRCUIT_OPEN',
    cooldownUntil,
  })
}

/**
 * Open circuit from a terminal rate-limit error (after policy decides no more retries).
 *
 * @param {object} error
 * @param {{ agent?: string, runId?: string, reasonCode?: string }} [meta]
 * @returns {object}
 */
export function openCircuitFromRateLimitError(error, meta = {}) {
  return openProviderCircuit({
    reasonCode: meta.reasonCode || 'RATE_LIMIT_TERMINAL',
    rateLimitKind: error?.rateLimitKind || null,
    retryAfterMs: error?.retryAfterMs ?? null,
    agent: meta.agent || null,
    runId: meta.runId || null,
    error,
  })
}

export default {
  getProviderCooldownState,
  resetProviderCircuitForTests,
  computeCooldownUntil,
  formatProviderRateLimitUserMessage,
  openProviderCircuit,
  isProviderCircuitOpen,
  assertProviderCircuitAllows,
  openCircuitFromRateLimitError,
  PROVIDER_CONSERVATIVE_COOLDOWN_MS,
}
