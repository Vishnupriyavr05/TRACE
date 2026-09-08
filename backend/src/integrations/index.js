/**
 * @fileoverview Research-source integrations registry.
 *
 * Independent of AI, LangChain, GraphRAG, MongoDB, and repositories.
 * Downstream code should depend on `ResearchSourceConnector` + this registry,
 * not on provider-specific clients.
 */
import { OpenAlexConnector } from './openalex/openalex.connector.js'
import { SemanticScholarConnector } from './semanticscholar/semanticScholar.connector.js'
import { CrossrefConnector } from './crossref/crossref.connector.js'
import { CoreConnector } from './core/core.connector.js'
import { ResearchSourceConnector } from './base/researchSource.connector.js'
import { ConnectorError } from './utils/connectorError.js'

export { ResearchSourceConnector } from './base/researchSource.connector.js'
export { OpenAlexConnector } from './openalex/openalex.connector.js'
export { SemanticScholarConnector } from './semanticscholar/semanticScholar.connector.js'
export { SemanticScholarClient } from './semanticscholar/semanticScholar.client.js'
export {
  mapSemanticScholarPaper,
  mapSemanticScholarSearchResponse,
} from './semanticscholar/semanticScholar.mapper.js'
export { CrossrefConnector } from './crossref/crossref.connector.js'
export { CoreConnector } from './core/core.connector.js'

export {
  mapPaperFromSource,
  mapFromOpenAlex,
  mapFromSemanticScholar,
  mapFromCrossref,
  mapFromCore,
  toPaperDto,
  createEmptyPaperDto,
} from './mappers/paper.mapper.js'

export {
  ConnectorError,
  ConnectorTimeoutError,
  ConnectorRateLimitError,
  ConnectorInvalidResponseError,
  ConnectorUnavailableError,
  ConnectorNotImplementedError,
} from './utils/connectorError.js'

export { withRetry } from './utils/retry.js'
export { RateLimiter, createRateLimiter } from './utils/rateLimiter.js'

/** @type {Readonly<Record<string, new (options?: object) => ResearchSourceConnector>>} */
export const CONNECTOR_CLASSES = Object.freeze({
  openalex: OpenAlexConnector,
  semantic_scholar: SemanticScholarConnector,
  crossref: CrossrefConnector,
  core: CoreConnector,
})

/**
 * Create a connector instance by source id.
 *
 * @param {keyof typeof CONNECTOR_CLASSES | string} sourceId
 * @param {object} [options]
 * @returns {ResearchSourceConnector}
 */
export function createConnector(sourceId, options = {}) {
  const ConnectorClass = CONNECTOR_CLASSES[sourceId]
  if (!ConnectorClass) {
    throw new ConnectorError(
      `Unknown research source: ${sourceId}`,
      'UNKNOWN',
      { source: String(sourceId) }
    )
  }
  return new ConnectorClass(options)
}

/**
 * List registered connector source ids.
 *
 * @returns {string[]}
 */
export function listConnectorSources() {
  return Object.keys(CONNECTOR_CLASSES)
}

/**
 * Default singleton-style registry (lazy).
 * Callers may swap sources without changing downstream search/getPaper usage.
 */
const defaultRegistry = {
  /** @type {Map<string, ResearchSourceConnector>} */
  _cache: new Map(),

  /**
   * @param {string} sourceId
   * @returns {ResearchSourceConnector}
   */
  get(sourceId) {
    if (!this._cache.has(sourceId)) {
      this._cache.set(sourceId, createConnector(sourceId))
    }
    return this._cache.get(sourceId)
  },

  /**
   * @returns {ResearchSourceConnector[]}
   */
  all() {
    return listConnectorSources().map((id) => this.get(id))
  },
}

export const connectorRegistry = defaultRegistry

export default {
  createConnector,
  listConnectorSources,
  connectorRegistry,
  CONNECTOR_CLASSES,
}
