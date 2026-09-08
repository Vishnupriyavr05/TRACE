/**
 * @fileoverview CORE research-source connector (structure only — no HTTP yet).
 */
import { CORE_BASE_URL } from '../../config/environment/env.js'
import { ResearchSourceConnector } from '../base/researchSource.connector.js'
import { mapFromCore } from '../mappers/paper.mapper.js'
import { ConnectorNotImplementedError } from '../utils/connectorError.js'
import { withRetry } from '../utils/retry.js'

/**
 * CORE connector implementing the shared research-source contract.
 */
export class CoreConnector extends ResearchSourceConnector {
  constructor(options = {}) {
    super({
      sourceId: 'core',
      displayName: 'CORE',
      baseUrl: options.baseUrl || CORE_BASE_URL,
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
        'CoreConnector.search() is not implemented (no network calls yet)',
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
        'CoreConnector.getPaper() is not implemented (no network calls yet)',
        { source: this.sourceId }
      )
    })
  }

  /**
   * @param {unknown} rawResponse
   */
  normalize(rawResponse) {
    if (Array.isArray(rawResponse)) {
      return rawResponse.map((item) => mapFromCore(item))
    }

    if (rawResponse && typeof rawResponse === 'object' && Array.isArray(rawResponse.results)) {
      return rawResponse.results.map((item) => mapFromCore(item))
    }

    return mapFromCore(rawResponse || {})
  }
}

export default CoreConnector
