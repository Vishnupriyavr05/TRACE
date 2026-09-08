/**
 * @fileoverview GROBID REST client — processFulltextDocument (no LLM).
 */
import { fetch as undiciFetch, Agent, FormData } from 'undici'
import { File } from 'node:buffer'
import { GROBID_BASE_URL, GROBID_TIMEOUT_MS } from '../../config/environment/env.js'

/** Health probe timeout — independent of PDF processing (GROBID_TIMEOUT_MS). */
export const GROBID_HEALTH_TIMEOUT_MS = 5_000

/** Dropwizard/Jetty default idle timeout is 30s — keep dispatcher aligned above that. */
const MIN_PROCESSING_DISPATCHER_TIMEOUT_MS = 35_000

/**
 * @param {{ timeoutMs?: number }} [options]
 * @returns {number}
 */
export function resolveGrobidProcessingTimeoutMs(options = {}) {
  const raw = options.timeoutMs ?? GROBID_TIMEOUT_MS
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : GROBID_TIMEOUT_MS
}

/**
 * @param {{ healthTimeoutMs?: number, timeoutMs?: number }} [options]
 * @returns {number}
 */
export function resolveGrobidHealthTimeoutMs(options = {}) {
  const raw = options.healthTimeoutMs ?? options.timeoutMs ?? GROBID_HEALTH_TIMEOUT_MS
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : GROBID_HEALTH_TIMEOUT_MS
}

/**
 * @param {string} url
 * @param {import('undici').RequestInit} init
 * @param {import('undici').Dispatcher} dispatcher
 * @returns {Promise<import('undici').Response>}
 */
async function grobidFetch(url, init, dispatcher) {
  return undiciFetch(url, { ...init, dispatcher })
}

/**
 * @param {number} timeoutMs
 * @returns {import('undici').Dispatcher}
 */
function createGrobidDispatcher(timeoutMs) {
  const safeTimeout = Math.max(
    timeoutMs,
    MIN_PROCESSING_DISPATCHER_TIMEOUT_MS,
  )
  return new Agent({
    // Large PDF uploads can exceed 30s before the server responds; align with processing timeout.
    connectTimeout: safeTimeout,
    headersTimeout: safeTimeout,
    bodyTimeout: safeTimeout,
    keepAliveTimeout: safeTimeout,
    keepAliveMaxTimeout: safeTimeout,
  })
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatGrobidFetchError(error) {
  if (error?.name === 'AbortError') {
    return 'GROBID request timed out'
  }
  const message = String(error?.message || error || 'fetch_failed')
  const cause = error?.cause?.message || error?.cause?.code || ''
  if (message.toLowerCase() === 'fetch failed' && cause) {
    return `GROBID fetch failed: ${cause}`
  }
  if (message.toLowerCase() === 'fetch failed') {
    return 'GROBID fetch failed: connection closed (possible server idle timeout near 30s)'
  }
  return message
}

/**
 * @param {object} [options]
 * @returns {(url: string, init: object, dispatcher?: import('undici').Dispatcher) => Promise<import('undici').Response>}
 */
function resolveGrobidFetchFn(options = {}) {
  if (options.fetchFn) {
    return async (url, init) => options.fetchFn(url, init)
  }
  return grobidFetch
}

/**
 * @param {{ baseUrl?: string, timeoutMs?: number, healthTimeoutMs?: number, fetchFn?: Function }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string, status?: number }>}
 */
export async function checkGrobidHealth(options = {}) {
  const baseUrl = (options.baseUrl || GROBID_BASE_URL || '').replace(/\/$/, '')
  if (!baseUrl) {
    return { ok: false, reason: 'unconfigured' }
  }

  const timeoutMs = resolveGrobidHealthTimeoutMs(options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const dispatcher = createGrobidDispatcher(timeoutMs)
  const fetchFn = resolveGrobidFetchFn(options)

  try {
    const response = await fetchFn(`${baseUrl}/api/isalive`, {
      method: 'GET',
      signal: controller.signal,
      dispatcher,
    })
    const text = (await response.text()).trim().toLowerCase()
    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}`, status: response.status }
    }
    if (text === 'true' || text.includes('true')) {
      return { ok: true, status: response.status }
    }
    return { ok: false, reason: 'not_alive', status: response.status }
  } catch (error) {
    const reason =
      error?.name === 'AbortError' ? 'timeout' : formatGrobidFetchError(error)
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
    await dispatcher.close()
  }
}

/**
 * @param {string} teiXml
 * @returns {boolean}
 */
export function isUsableTei(teiXml) {
  if (!teiXml || typeof teiXml !== 'string') return false
  const trimmed = teiXml.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return false
  return /<TEI[\s>]/i.test(trimmed) || /<text[\s>]/i.test(trimmed)
}

/**
 * @param {Buffer} pdfBuffer
 * @param {{
 *   segmentSentences?: boolean,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   healthTimeoutMs?: number,
 *   skipHealthCheck?: boolean,
 *   fetchFn?: Function
 * }} [options]
 * @returns {Promise<string>}
 */
export async function processFulltextDocument(pdfBuffer, options = {}) {
  const baseUrl = (options.baseUrl || GROBID_BASE_URL || '').replace(/\/$/, '')
  if (!baseUrl) {
    throw new Error('GROBID_BASE_URL is not configured')
  }

  if (!options.skipHealthCheck) {
    const health = await checkGrobidHealth({
      baseUrl,
      healthTimeoutMs: options.healthTimeoutMs,
      fetchFn: options.fetchFn,
    })
    if (!health.ok) {
      throw new Error(`GROBID unavailable: ${health.reason || 'health_check_failed'}`)
    }
  }

  const timeoutMs = resolveGrobidProcessingTimeoutMs(options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const dispatcher = createGrobidDispatcher(timeoutMs)
  const fetchFn = resolveGrobidFetchFn(options)
  const startedAt = Date.now()

  const form = new FormData()
  form.append(
    'input',
    new File([pdfBuffer], 'document.pdf', { type: 'application/pdf' }),
  )
  if (options.segmentSentences !== false) {
    form.append('segmentSentences', '1')
  }
  try {
    const response = await fetchFn(`${baseUrl}/api/processFulltextDocument`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      dispatcher,
    })

    const text = await response.text()

    if (!response.ok) {
      throw new Error(
        `GROBID HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      )
    }

    if (!isUsableTei(text)) {
      throw new Error('GROBID returned empty or non-TEI response')
    }

    return text
  } catch (error) {
    throw new Error(formatGrobidFetchError(error))
  } finally {
    clearTimeout(timer)
    await dispatcher.close()
  }
}

/**
 * @param {Buffer} pdfBuffer
 * @param {object} [options]
 * @returns {Promise<{ tei: string, diagnostics: object }>}
 */
export async function processFulltextDocumentWithDiagnostics(pdfBuffer, options = {}) {
  const startedAt = Date.now()
  try {
    const tei = await processFulltextDocument(pdfBuffer, options)
    return {
      tei,
      diagnostics: {
        attempted: true,
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs: Date.now() - startedAt,
        httpStatus: 200,
        success: true,
        errorType: null,
        errorMessage: null,
      },
    }
  } catch (error) {
    return {
      tei: null,
      diagnostics: {
        attempted: true,
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs: Date.now() - startedAt,
        httpStatus: null,
        success: false,
        errorType: error?.name || 'Error',
        errorMessage: formatGrobidFetchError(error),
      },
    }
  }
}

export default {
  GROBID_HEALTH_TIMEOUT_MS,
  resolveGrobidProcessingTimeoutMs,
  resolveGrobidHealthTimeoutMs,
  checkGrobidHealth,
  isUsableTei,
  processFulltextDocument,
  processFulltextDocumentWithDiagnostics,
}
