/**
 * @fileoverview OpenAlex research-source connector (Phase 1 — live HTTP).
 */
import {
  OPENALEX_BASE_URL,
  OPENALEX_API_KEY,
  OPENALEX_MAILTO,
} from '../../config/environment/env.js'
import { ResearchSourceConnector } from '../base/researchSource.connector.js'
import { mapFromOpenAlex } from '../mappers/paper.mapper.js'
import { ConnectorInvalidResponseError } from '../utils/connectorError.js'
import { connectorGetJson } from '../utils/httpClient.js'
import { withRetry } from '../utils/retry.js'

/**
 * OpenAlex connector implementing the shared research-source contract.
 */
export class OpenAlexConnector extends ResearchSourceConnector {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      sourceId: 'openalex',
      displayName: 'OpenAlex',
      baseUrl: options.baseUrl || OPENALEX_BASE_URL,
    })
    this.apiKey = options.apiKey ?? OPENALEX_API_KEY
    this.mailto = options.mailto ?? OPENALEX_MAILTO
  }

  /**
   * Search OpenAlex works and return normalized Paper DTOs.
   *
   * @param {string} query
   * @param {import('../base/researchSource.connector.js').SearchOptions} [options]
   * @returns {Promise<{ results: object[], meta: object }>}
   */
  async search(query, options = {}) {
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) {
      throw new ConnectorInvalidResponseError('Search query is required', {
        source: this.sourceId,
      })
    }

    if (!this.baseUrl) {
      throw new ConnectorInvalidResponseError(
        'OPENALEX_BASE_URL is not configured',
        { source: this.sourceId }
      )
    }

    await this.rateLimiter.acquire()

    const limit = clampLimit(options.limit)
    const page = Math.max(1, Number(options.page) || 1)

    const url = this.#buildUrl('/works', {
      search: q,
      'per-page': String(limit),
      page: String(page),
      mailto: this.mailto || undefined,
      api_key: this.#usableApiKey() || undefined,
    })

    return withRetry(async () => {
      const raw = await connectorGetJson(url, { source: this.sourceId })
      const results = this.normalize(raw)

      return {
        results: Array.isArray(results) ? results : [results],
        meta: {
          source: this.sourceId,
          page,
          perPage: limit,
          count: Number(raw?.meta?.count) || undefined,
        },
      }
    })
  }

  /**
   * Fetch a single OpenAlex work by id, DOI (`doi:…`), or OpenAlex URL/id.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getPaper(id) {
    const workId = typeof id === 'string' ? id.trim() : ''
    if (!workId) {
      throw new ConnectorInvalidResponseError('Paper id is required', {
        source: this.sourceId,
      })
    }

    if (!this.baseUrl) {
      throw new ConnectorInvalidResponseError(
        'OPENALEX_BASE_URL is not configured',
        { source: this.sourceId }
      )
    }

    await this.rateLimiter.acquire()

    const pathId = encodeWorkId(workId)
    const url = this.#buildUrl(`/works/${pathId}`, {
      mailto: this.mailto || undefined,
      api_key: this.#usableApiKey() || undefined,
    })

    return withRetry(async () => {
      const raw = await connectorGetJson(url, { source: this.sourceId })
      const normalized = this.normalize(raw)
      return Array.isArray(normalized) ? normalized[0] : normalized
    })
  }

  /**
   * Normalize OpenAlex raw payloads into PaperDTO(s).
   *
   * @param {unknown} rawResponse
   */
  normalize(rawResponse) {
    if (Array.isArray(rawResponse)) {
      return rawResponse.map((item) => mapFromOpenAlex(item))
    }

    if (
      rawResponse &&
      typeof rawResponse === 'object' &&
      Array.isArray(rawResponse.results)
    ) {
      return rawResponse.results.map((item) => mapFromOpenAlex(item))
    }

    return mapFromOpenAlex(rawResponse || {})
  }

  /**
   * @param {string} path
   * @param {Record<string, string|undefined>} params
   * @returns {string}
   */
  #buildUrl(path, params = {}) {
    const base = this.baseUrl.replace(/\/$/, '')
    const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    return url.toString()
  }

  /**
   * Ignore obvious placeholder keys so polite-pool requests still succeed.
   *
   * @returns {string}
   */
  #usableApiKey() {
    const key = typeof this.apiKey === 'string' ? this.apiKey.trim() : ''
    if (!key) return ''
    if (/^sk-/i.test(key)) return ''
    if (/^your[_-]?/i.test(key)) return ''
    if (key === 'sk-1234567890') return ''
    return key
  }
}

/**
 * @param {unknown} limit
 * @returns {number}
 */
function clampLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n)) return 20
  return Math.min(100, Math.max(1, Math.trunc(n)))
}

/**
 * Encode OpenAlex work identifiers for path usage.
 * Supports OpenAlex ids, full URLs, and `doi:10.…` forms.
 *
 * @param {string} id
 * @returns {string}
 */
function encodeWorkId(id) {
  if (id.startsWith('http://') || id.startsWith('https://')) {
    const cleaned = id.replace(/^https?:\/\/api\.openalex\.org\/works\//i, '')
    return encodeURIComponent(cleaned)
  }
  if (id.toLowerCase().startsWith('doi:')) {
    return encodeURIComponent(id)
  }
  return encodeURIComponent(id)
}

export default OpenAlexConnector
