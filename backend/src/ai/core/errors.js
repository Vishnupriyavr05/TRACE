/**
 * @fileoverview AI-layer errors mapped to safe HTTP responses.
 */
import { AppError } from '../../utils/AppError.js'
import {
  extractRateLimitHeaders,
  inferRateLimitKind,
} from './rateLimitHeaders.js'

/** Hard cap for a single Retry-After / rate-limit wait (ms). */
export const AI_RATE_LIMIT_MAX_DELAY_MS = 60_000

export class AiConfigError extends AppError {
  constructor(message = 'AI is not configured') {
    super(message, 503)
    this.name = 'AiConfigError'
    this.code = 'AI_CONFIG'
  }
}

export class AiTimeoutError extends AppError {
  constructor(message = 'AI provider request timed out') {
    super(message, 504)
    this.name = 'AiTimeoutError'
    this.code = 'AI_TIMEOUT'
  }
}

export class AiAuthError extends AppError {
  constructor(message = 'AI provider authentication failed') {
    super(message, 502)
    this.name = 'AiAuthError'
    this.code = 'AI_AUTH'
  }
}

export class AiRateLimitError extends AppError {
  /**
   * @param {string} [message]
   * @param {{
   *   retryAfterMs?: number|null,
   *   rateLimit?: object|null,
   *   rateLimitKind?: string|null,
   *   providerErrorType?: string|null,
   *   providerErrorMessage?: string|null,
   *   locallyBlocked?: boolean,
   *   circuitOpen?: boolean,
   *   circuitReason?: string|null,
   *   cooldownUntil?: number|null,
   * }} [options]
   */
  constructor(message = 'AI provider rate limit exceeded', options = {}) {
    super(message, 429)
    this.name = 'AiRateLimitError'
    this.code = 'AI_RATE_LIMIT'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs =
      typeof retryAfterMs === 'number' &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs > 0
        ? retryAfterMs
        : null
    this.rateLimit = options?.rateLimit || null
    this.rateLimitKind = options?.rateLimitKind || null
    this.providerErrorType = options?.providerErrorType || null
    this.providerErrorMessage = options?.providerErrorMessage || null
    this.locallyBlocked = Boolean(options?.locallyBlocked)
    this.circuitOpen = Boolean(options?.circuitOpen)
    this.circuitReason = options?.circuitReason || null
    this.cooldownUntil =
      typeof options?.cooldownUntil === 'number' &&
      Number.isFinite(options.cooldownUntil)
        ? options.cooldownUntil
        : null
  }
}

export class AiProviderError extends AppError {
  /**
   * @param {string} [message]
   * @param {number} [statusCode=502] — use 413 for payload-too-large
   * @param {{
   *   rateLimit?: object|null,
   *   providerErrorType?: string|null,
   *   providerErrorMessage?: string|null,
   * }} [options]
   */
  constructor(
    message = 'AI provider request failed',
    statusCode = 502,
    options = {},
  ) {
    super(message, statusCode)
    this.name = 'AiProviderError'
    this.code =
      statusCode === 413 ? 'AI_PAYLOAD_TOO_LARGE' : 'AI_PROVIDER'
    this.rateLimit = options?.rateLimit || null
    this.providerErrorType = options?.providerErrorType || null
    this.providerErrorMessage = options?.providerErrorMessage || null
  }
}

export class AiOutputError extends AppError {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message = 'AI returned invalid structured output', errors) {
    super(message, 502, errors)
    this.name = 'AiOutputError'
    this.code = 'AI_OUTPUT'
  }
}

/**
 * Parse seconds-based Retry-After into milliseconds.
 * Does not accept HTTP-date forms. Caps at AI_RATE_LIMIT_MAX_DELAY_MS.
 *
 * @param {unknown} headerValue
 * @param {number} [maxMs]
 * @returns {number|null} milliseconds, or null if missing/invalid
 */
export function parseRetryAfterMs(
  headerValue,
  maxMs = AI_RATE_LIMIT_MAX_DELAY_MS,
) {
  if (headerValue == null) return null
  const raw = String(headerValue).trim()
  if (!raw) return null
  // Seconds only (integer or decimal). Reject HTTP-date and other forms.
  if (!/^\d+(\.\d+)?$/.test(raw)) return null
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  if (seconds === 0) return null
  const ms = Math.ceil(seconds * 1000)
  const cap =
    typeof maxMs === 'number' && Number.isFinite(maxMs) && maxMs > 0
      ? maxMs
      : AI_RATE_LIMIT_MAX_DELAY_MS
  return Math.min(cap, ms)
}

/**
 * Read Retry-After from a Fetch Headers object or plain header map.
 *
 * @param {Headers|{ get?: Function, [key: string]: unknown }|null|undefined} headers
 * @returns {number|null}
 */
export function retryAfterMsFromHeaders(headers) {
  if (!headers) return null
  let value
  if (typeof headers.get === 'function') {
    value = headers.get('retry-after') ?? headers.get('Retry-After')
  } else {
    value = headers['retry-after'] ?? headers['Retry-After']
  }
  return parseRetryAfterMs(value)
}

/**
 * Prefer Retry-After; fall back to rate-limit reset headers.
 *
 * @param {object|null|undefined} rateLimit
 * @param {Headers|{ get?: Function }|null|undefined} headers
 * @returns {number|null}
 */
export function resolveRetryAfterMs(rateLimit, headers) {
  const fromHeader = retryAfterMsFromHeaders(headers)
  if (fromHeader != null) return fromHeader
  if (rateLimit?.resetRequestsMs != null && rateLimit.resetRequestsMs > 0) {
    return Math.min(AI_RATE_LIMIT_MAX_DELAY_MS, rateLimit.resetRequestsMs)
  }
  if (rateLimit?.resetTokensMs != null && rateLimit.resetTokensMs > 0) {
    return Math.min(AI_RATE_LIMIT_MAX_DELAY_MS, rateLimit.resetTokensMs)
  }
  return null
}

/**
 * Map provider HTTP status to a safe AppError (no raw body leakage).
 *
 * Groq semantics: 413 = payload too large, 429 = rate limit.
 * Never classify 413 as rate_limit even if body text is noisy.
 *
 * @param {number} status
 * @param {Headers|{ get?: Function }|null} [headers]
 * @param {{ type?: string|null, message?: string|null, code?: string|null }|null} [providerError]
 * @returns {AppError}
 */
export function errorFromProviderStatus(
  status,
  headers = null,
  providerError = null,
) {
  const rateLimit = extractRateLimitHeaders(headers)
  const errType = providerError?.type || null
  const errMessage = providerError?.message || null

  if (status === 401 || status === 403) {
    return new AiAuthError('AI provider authentication failed')
  }

  // HTTP 413 is always payload-too-large (Groq). Do not treat as rate limit.
  if (status === 413) {
    return new AiProviderError(
      'AI provider request payload too large',
      413,
      {
        rateLimit,
        providerErrorType: errType,
        providerErrorMessage: errMessage,
      },
    )
  }

  if (status === 429) {
    const rateLimitKind = inferRateLimitKind(rateLimit, {
      type: errType,
      message: errMessage,
    })
    return new AiRateLimitError('AI provider rate limit exceeded', {
      retryAfterMs: resolveRetryAfterMs(rateLimit, headers),
      rateLimit,
      rateLimitKind,
      providerErrorType: errType,
      providerErrorMessage: errMessage,
    })
  }

  if (status >= 500) {
    return new AiProviderError('AI provider is temporarily unavailable', 502, {
      rateLimit,
      providerErrorType: errType,
      providerErrorMessage: errMessage,
    })
  }

  return new AiProviderError(`AI provider request failed (${status})`, 502, {
    rateLimit,
    providerErrorType: errType,
    providerErrorMessage: errMessage,
  })
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isPayloadTooLargeError(error) {
  if (!error || typeof error !== 'object') return false
  // Local context budget uses HTTP 413-shaped status but is not a provider 413
  if (
    error.code === 'AI_CONTEXT_BUDGET_EXCEEDED' ||
    error.name === 'AiContextBudgetError'
  ) {
    return false
  }
  if (error.code === 'AI_PAYLOAD_TOO_LARGE') return true
  if (Number(error.statusCode) === 413 || Number(error.status) === 413) {
    return true
  }
  return false
}

export default {
  AiConfigError,
  AiTimeoutError,
  AiAuthError,
  AiRateLimitError,
  AiProviderError,
  AiOutputError,
  AI_RATE_LIMIT_MAX_DELAY_MS,
  parseRetryAfterMs,
  retryAfterMsFromHeaders,
  resolveRetryAfterMs,
  errorFromProviderStatus,
  isPayloadTooLargeError,
}
