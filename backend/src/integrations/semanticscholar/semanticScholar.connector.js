/**
 * @fileoverview Semantic Scholar research-source connector (Phase 2 — live HTTP).
 * Client → Mapper → Paper DTO. No Discovery / persistence.
 */
import { SEMANTIC_SCHOLAR_BASE_URL } from '../../config/environment/env.js'
import { ResearchSourceConnector } from '../base/researchSource.connector.js'
import { ConnectorInvalidResponseError } from '../utils/connectorError.js'
import { withRetry } from '../utils/retry.js'
import { SemanticScholarClient } from './semanticScholar.client.js'
import {
  mapSemanticScholarPaper,
  mapSemanticScholarSearchResponse,
} from './semanticScholar.mapper.js'

/**
 * Semantic Scholar connector implementing the shared research-source contract.
 */
export class SemanticScholarConnector extends ResearchSourceConnector {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super({
      sourceId: 'semantic_scholar',
      displayName: 'Semantic Scholar',
      baseUrl: options.baseUrl || SEMANTIC_SCHOLAR_BASE_URL,
    })
    this.client =
      options.client ||
      new SemanticScholarClient({
        baseUrl: this.baseUrl,
        apiKey: options.apiKey,
      })
  }

  /**
   * Search Semantic Scholar and return normalized Paper DTOs.
   *
   * @param {string} query
   * @param {import('../base/researchSource.connector.js').SearchOptions} [options]
   * @returns {Promise<{ results: object[], meta: object }>}
   */
  async search(query, options = {}) {
    await this.rateLimiter.acquire()

    const limit = clampLimit(options.limit)
    const offset = Number.isFinite(Number(options.offset))
      ? Math.max(0, Math.trunc(Number(options.offset)))
      : 0

    return withRetry(
      async () => {
        const raw = await this.client.search(query, {
          limit,
          offset,
          fields: options.fields,
        })

        const results = this.normalize(raw)

        return {
          results: Array.isArray(results) ? results : [results],
          meta: {
            source: this.sourceId,
            offset,
            limit,
            total: Number(raw?.total) || undefined,
          },
        }
      },
      {
        retries: 3,
        delayMs: 2500,
        shouldRetry: (error) =>
          error?.code === 'RATE_LIMIT' || error?.code === 'SOURCE_UNAVAILABLE',
      }
    )
  }

  /**
   * Fetch a single paper and return a Paper DTO.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getPaper(id) {
    await this.rateLimiter.acquire()

    return withRetry(
      async () => {
        const raw = await this.client.getPaper(id, { fields: undefined })
        if (!raw || typeof raw !== 'object') {
          throw new ConnectorInvalidResponseError(
            'Semantic Scholar returned an empty paper payload',
            { source: this.sourceId }
          )
        }
        const normalized = this.normalize(raw)
        return Array.isArray(normalized) ? normalized[0] : normalized
      },
      {
        retries: 3,
        delayMs: 2500,
        shouldRetry: (error) =>
          error?.code === 'RATE_LIMIT' || error?.code === 'SOURCE_UNAVAILABLE',
      }
    )
  }

  /**
   * Normalize Semantic Scholar raw payloads into PaperDTO(s).
   *
   * @param {unknown} rawResponse
   */
  normalize(rawResponse) {
    if (Array.isArray(rawResponse)) {
      return rawResponse.map((item) => mapSemanticScholarPaper(item))
    }

    if (
      rawResponse &&
      typeof rawResponse === 'object' &&
      Array.isArray(rawResponse.data)
    ) {
      return mapSemanticScholarSearchResponse(rawResponse)
    }

    return mapSemanticScholarPaper(rawResponse || {})
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

export default SemanticScholarConnector
