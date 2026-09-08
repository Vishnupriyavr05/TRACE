/**
 * @fileoverview Semantic Scholar HTTP client — raw JSON only (no DTO mapping).
 */
import {
  SEMANTIC_SCHOLAR_BASE_URL,
  SEMANTIC_SCHOLAR_API_KEY,
} from '../../config/environment/env.js'
import { ConnectorInvalidResponseError } from '../utils/connectorError.js'
import { connectorGetJson } from '../utils/httpClient.js'

/** Default Graph API fields matching API_FIELD_MAPPING.md */
export const DEFAULT_PAPER_FIELDS = [
  'paperId',
  'title',
  'authors',
  'abstract',
  'externalIds',
  'venue',
  'year',
  'citationCount',
  'fieldsOfStudy',
  'publicationTypes',
  'openAccessPdf',
  'isOpenAccess',
  'journal',
  'references',
].join(',')

/**
 * Low-level Semantic Scholar Graph API client.
 */
export class SemanticScholarClient {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || SEMANTIC_SCHOLAR_BASE_URL || '').replace(
      /\/$/,
      ''
    )
    this.apiKey = options.apiKey ?? SEMANTIC_SCHOLAR_API_KEY
  }

  /**
   * Search papers. Returns raw Semantic Scholar JSON.
   *
   * @param {string} query
   * @param {{ limit?: number, offset?: number, fields?: string }} [options]
   * @returns {Promise<object>}
   */
  async search(query, options = {}) {
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) {
      throw new ConnectorInvalidResponseError('Search query is required', {
        source: 'semantic_scholar',
      })
    }

    this.#assertConfigured()

    const limit = clampInt(options.limit, 20, 1, 100)
    const offset = clampInt(options.offset, 0, 0, 9999)
    const fields = options.fields || DEFAULT_PAPER_FIELDS

    const url = this.#buildUrl('/graph/v1/paper/search', {
      query: q,
      limit: String(limit),
      offset: String(offset),
      fields,
    })

    return connectorGetJson(url, {
      source: 'semantic_scholar',
      headers: this.#headers(),
    })
  }

  /**
   * Fetch a single paper by Semantic Scholar id, DOI, ArXiv id, etc.
   * Returns raw Semantic Scholar JSON.
   *
   * @param {string} paperId
   * @param {{ fields?: string }} [options]
   * @returns {Promise<object>}
   */
  async getPaper(paperId, options = {}) {
    const id = typeof paperId === 'string' ? paperId.trim() : ''
    if (!id) {
      throw new ConnectorInvalidResponseError('Paper id is required', {
        source: 'semantic_scholar',
      })
    }

    this.#assertConfigured()

    const fields = options.fields || DEFAULT_PAPER_FIELDS
    const url = this.#buildUrl(`/graph/v1/paper/${encodeURIComponent(id)}`, {
      fields,
    })

    return connectorGetJson(url, {
      source: 'semantic_scholar',
      headers: this.#headers(),
    })
  }

  /**
   * @returns {Record<string, string>}
   */
  #headers() {
    const headers = {}
    const key = typeof this.apiKey === 'string' ? this.apiKey.trim() : ''
    if (key && !isPlaceholderKey(key)) {
      headers['x-api-key'] = key
    }
    return headers
  }

  /**
   * @param {string} path
   * @param {Record<string, string|undefined>} params
   * @returns {string}
   */
  #buildUrl(path, params = {}) {
    const url = new URL(
      `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    )
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        url.searchParams.set(key, String(value))
      }
    }
    return url.toString()
  }

  #assertConfigured() {
    if (!this.baseUrl) {
      throw new ConnectorInvalidResponseError(
        'SEMANTIC_SCHOLAR_BASE_URL is not configured',
        { source: 'semantic_scholar' }
      )
    }
  }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isPlaceholderKey(key) {
  return (
    /^your[_-]?/i.test(key) ||
    key === 'changeme' ||
    key === 'SEMANTIC_SCHOLAR_API_KEY'
  )
}

export default SemanticScholarClient
