/**
 * @fileoverview Abstract base connector for external academic research sources.
 * All providers implement the same contract so callers can swap sources.
 *
 * This module performs NO HTTP, MongoDB, or AI work.
 */
import { ConnectorNotImplementedError } from '../utils/connectorError.js'
import { createRateLimiter } from '../utils/rateLimiter.js'

/**
 * @typedef {import('../mappers/paper.mapper.js').PaperDTO} PaperDTO
 */

/**
 * @typedef {object} SearchOptions
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {number} [yearFrom]
 * @property {number} [yearTo]
 * @property {boolean} [openAccess]
 * @property {string} [sortBy]
 * @property {Record<string, unknown>} [filters]
 */

/**
 * Abstract research-source connector.
 * Subclasses must implement `search`, `getPaper`, and `normalize`.
 */
export class ResearchSourceConnector {
  /**
   * @param {object} config
   * @param {string} config.sourceId Machine id (e.g. 'openalex')
   * @param {string} config.displayName Human-readable name
   * @param {string} [config.baseUrl] Provider base URL from env
   */
  constructor(config) {
    if (new.target === ResearchSourceConnector) {
      throw new Error('ResearchSourceConnector is abstract and cannot be instantiated directly')
    }

    this.sourceId = config.sourceId
    this.displayName = config.displayName
    this.baseUrl = config.baseUrl || ''
    this.rateLimiter = createRateLimiter({ source: this.sourceId })
  }

  /**
   * Search the external source for papers matching a query.
   *
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {Promise<{ results: PaperDTO[], raw?: unknown, meta?: object }>}
   */
  async search(query, options = {}) {
    throw new ConnectorNotImplementedError(
      `${this.displayName}.search() is not implemented`,
      { source: this.sourceId }
    )
  }

  /**
   * Fetch a single paper by provider-specific id (DOI, OpenAlex id, etc.).
   *
   * @param {string} id
   * @returns {Promise<PaperDTO>}
   */
  async getPaper(id) {
    throw new ConnectorNotImplementedError(
      `${this.displayName}.getPaper() is not implemented`,
      { source: this.sourceId }
    )
  }

  /**
   * Normalize a raw provider payload into PaperDTO(s).
   *
   * @param {unknown} rawResponse
   * @returns {PaperDTO|PaperDTO[]}
   */
  normalize(rawResponse) {
    throw new ConnectorNotImplementedError(
      `${this.displayName}.normalize() is not implemented`,
      { source: this.sourceId }
    )
  }

  /**
   * Lightweight health / metadata for registry consumers.
   *
   * @returns {{ sourceId: string, displayName: string, baseUrl: string, ready: boolean }}
   */
  getInfo() {
    return {
      sourceId: this.sourceId,
      displayName: this.displayName,
      baseUrl: this.baseUrl,
      ready: Boolean(this.baseUrl),
    }
  }
}

export default ResearchSourceConnector
