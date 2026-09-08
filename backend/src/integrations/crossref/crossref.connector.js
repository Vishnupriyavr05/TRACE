/**
 * @fileoverview CrossRef research-source connector (structure only — no HTTP yet).
 */
import { CROSSREF_BASE_URL } from '../../config/environment/env.js'
import { ResearchSourceConnector } from '../base/researchSource.connector.js'
import { mapFromCrossref } from '../mappers/paper.mapper.js'
import { ConnectorNotImplementedError } from '../utils/connectorError.js'
import { withRetry } from '../utils/retry.js'

/**
 * CrossRef connector implementing the shared research-source contract.
 */
export class CrossrefConnector extends ResearchSourceConnector {
  constructor(options = {}) {
    super({
      sourceId: 'crossref',
      displayName: 'CrossRef',
      baseUrl: options.baseUrl || CROSSREF_BASE_URL,
    })
  }

  /**
   * @param {string} query
   * @param {import('../base/researchSource.connector.js').SearchOptions} [options]
   */
  async search(query, options = {}) {
    await this.rateLimiter.acquire()

    return withRetry(async () => {
      throw new ConnectorNotImplementedError(
        'CrossrefConnector.search() is not implemented (no network calls yet)',
        { source: this.sourceId }
      )
    })
  }

  /**
   * @param {string} id
   */
  async getPaper(id) {
    await this.rateLimiter.acquire()

    return withRetry(async () => {
      throw new ConnectorNotImplementedError(
        'CrossrefConnector.getPaper() is not implemented (no network calls yet)',
        { source: this.sourceId }
      )
    })
  }

  /**
   * @param {unknown} rawResponse
   */
  normalize(rawResponse) {
    if (Array.isArray(rawResponse)) {
      return rawResponse.map((item) => mapFromCrossref(item))
    }

    if (
      rawResponse &&
      typeof rawResponse === 'object' &&
      rawResponse.message?.items &&
      Array.isArray(rawResponse.message.items)
    ) {
      return rawResponse.message.items.map((item) => mapFromCrossref(item))
    }

    return mapFromCrossref(rawResponse || {})
  }
}

export default CrossrefConnector
