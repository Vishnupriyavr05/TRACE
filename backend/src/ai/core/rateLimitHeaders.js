/**
 * @fileoverview Safe extraction of provider rate-limit headers (Groq / OpenAI-compatible).
 * Never logs secrets. Used for observability and retry decisions.
 */

/**
 * @param {Headers|{ get?: Function, [key: string]: unknown }|null|undefined} headers
 * @param {string} name
 * @returns {string|null}
 */
export function getHeader(headers, name) {
  if (!headers) return null
  const lower = name.toLowerCase()
  if (typeof headers.get === 'function') {
    return (
      headers.get(name) ??
      headers.get(lower) ??
      headers.get(name.toUpperCase()) ??
      null
    )
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower)
  if (!key) return null
  const value = headers[key]
  return value == null ? null : String(value)
}

/**
 * Parse Groq-style reset values ("2s", "1500ms", seconds, or unix epoch).
 *
 * @param {unknown} value
 * @returns {number|null} milliseconds until reset, or null
 */
export function parseResetToMs(value) {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null

  const secMatch = raw.match(/^(\d+(?:\.\d+)?)\s*s$/i)
  if (secMatch) return Math.ceil(Number(secMatch[1]) * 1000)

  const msMatch = raw.match(/^(\d+(?:\.\d+)?)\s*ms$/i)
  if (msMatch) return Math.ceil(Number(msMatch[1]))

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return null
    // Unix seconds (absolute)
    if (n > 1_000_000_000) {
      return Math.max(0, Math.ceil(n * 1000 - Date.now()))
    }
    // Unix ms (absolute)
    if (n > 1_000_000_000_000) {
      return Math.max(0, Math.ceil(n - Date.now()))
    }
    // Relative seconds
    return Math.ceil(n * 1000)
  }

  return null
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseNumericHeader(value) {
  if (value == null) return null
  const n = Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Extract rate-limit headers into a plain object (safe to log).
 *
 * @param {Headers|{ get?: Function }|null|undefined} headers
 * @returns {object}
 */
export function extractRateLimitHeaders(headers) {
  const limitRequests = getHeader(headers, 'x-ratelimit-limit-requests')
  const remainingRequests = getHeader(headers, 'x-ratelimit-remaining-requests')
  const resetRequests = getHeader(headers, 'x-ratelimit-reset-requests')
  const limitTokens = getHeader(headers, 'x-ratelimit-limit-tokens')
  const remainingTokens = getHeader(headers, 'x-ratelimit-remaining-tokens')
  const resetTokens = getHeader(headers, 'x-ratelimit-reset-tokens')
  const retryAfter = getHeader(headers, 'retry-after')

  return {
    'x-ratelimit-limit-requests': limitRequests,
    'x-ratelimit-remaining-requests': remainingRequests,
    'x-ratelimit-reset-requests': resetRequests,
    'x-ratelimit-limit-tokens': limitTokens,
    'x-ratelimit-remaining-tokens': remainingTokens,
    'x-ratelimit-reset-tokens': resetTokens,
    'retry-after': retryAfter,
    limitRequests: parseNumericHeader(limitRequests),
    remainingRequests: parseNumericHeader(remainingRequests),
    resetRequestsMs: parseResetToMs(resetRequests),
    limitTokens: parseNumericHeader(limitTokens),
    remainingTokens: parseNumericHeader(remainingTokens),
    resetTokensMs: parseResetToMs(resetTokens),
  }
}

/**
 * Infer which provider limit was hit from headers + optional error text.
 * Returns RPM | RPD | TPM | ITPM | OTPM | REQUESTS_AND_TOKENS | UNKNOWN.
 *
 * @param {object} [rateLimit]
 * @param {{ type?: string|null, message?: string|null }} [providerError]
 * @returns {string}
 */
export function inferRateLimitKind(rateLimit = {}, providerError = {}) {
  const msg = String(providerError?.message || '').toLowerCase()
  const type = String(providerError?.type || '').toLowerCase()

  if (/\brequests?\s*per\s*day\b|\brpd\b/.test(msg) || type.includes('daily')) {
    return 'RPD'
  }
  if (/\binput\s*tokens?\s*per\s*minute\b|\bitpm\b/.test(msg)) return 'ITPM'
  if (/\boutput\s*tokens?\s*per\s*minute\b|\botpm\b/.test(msg)) return 'OTPM'
  if (/\btokens?\s*per\s*minute\b|\btpm\b/.test(msg)) return 'TPM'
  if (/\brequests?\s*per\s*minute\b|\brpm\b/.test(msg)) return 'RPM'

  const remReq = rateLimit.remainingRequests
  const remTok = rateLimit.remainingTokens
  const reqExhausted = remReq === 0
  const tokExhausted = remTok === 0

  if (reqExhausted && tokExhausted) return 'REQUESTS_AND_TOKENS'
  if (tokExhausted && !reqExhausted) return 'TPM'
  if (reqExhausted && !tokExhausted) {
    // Prefer RPD when reset window is very long
    const resetMs = rateLimit.resetRequestsMs
    if (typeof resetMs === 'number' && resetMs > 60 * 60 * 1000) return 'RPD'
    return 'RPM'
  }

  if (type.includes('rate_limit')) return 'UNKNOWN'
  return 'UNKNOWN'
}

/**
 * Safely parse provider error JSON (no secrets). Truncates message.
 *
 * @param {string} text
 * @returns {{ type: string|null, message: string|null, code: string|null, rawStatus?: unknown }}
 */
export function parseProviderErrorBody(text) {
  if (!text || typeof text !== 'string') {
    return { type: null, message: null, code: null }
  }
  try {
    const json = JSON.parse(text)
    const err = json?.error && typeof json.error === 'object' ? json.error : json
    const type =
      typeof err?.type === 'string'
        ? err.type.slice(0, 120)
        : typeof json?.type === 'string'
          ? json.type.slice(0, 120)
          : null
    const messageRaw =
      typeof err?.message === 'string'
        ? err.message
        : typeof json?.message === 'string'
          ? json.message
          : null
    const message = messageRaw
      ? messageRaw.replace(/gsk_[A-Za-z0-9]+/g, '[redacted]').slice(0, 400)
      : null
    const code =
      typeof err?.code === 'string'
        ? err.code.slice(0, 80)
        : typeof json?.code === 'string'
          ? json.code.slice(0, 80)
          : null
    return { type, message, code }
  } catch {
    return {
      type: null,
      message: text.replace(/gsk_[A-Za-z0-9]+/g, '[redacted]').slice(0, 200),
      code: null,
    }
  }
}

export default {
  getHeader,
  parseResetToMs,
  parseNumericHeader,
  extractRateLimitHeaders,
  inferRateLimitKind,
  parseProviderErrorBody,
}
