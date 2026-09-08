/**
 * @fileoverview Research Discovery service — connector orchestration (no AI).
 * Flow: Connectors → CanonicalizationService → PaperService
 */
import {
  createConnector,
  ConnectorError,
} from '../integrations/index.js'
import { canonicalizePapers } from '../canonicalization/canonicalization.service.js'
import * as paperService from './paper.service.js'
import * as sessionService from './researchSession.service.js'

/**
 * Map connector errors to safe, client-facing descriptions.
 *
 * @param {ConnectorError|Error} error
 * @returns {{ code: string, message: string }}
 */
function toPublicConnectorFailure(error) {
  if (error instanceof ConnectorError) {
    switch (error.code) {
      case 'NOT_IMPLEMENTED':
        return {
          code: 'SOURCE_NOT_READY',
          message: 'This research source is not connected yet',
        }
      case 'TIMEOUT':
        return {
          code: 'SOURCE_TIMEOUT',
          message: 'The research source timed out',
        }
      case 'RATE_LIMIT':
        return {
          code: 'SOURCE_RATE_LIMITED',
          message: 'The research source rate limit was reached',
        }
      case 'INVALID_RESPONSE':
        return {
          code: 'SOURCE_INVALID_RESPONSE',
          message: 'The research source returned an invalid response',
        }
      case 'SOURCE_UNAVAILABLE':
        return {
          code: 'SOURCE_UNAVAILABLE',
          message: 'The research source is currently unavailable',
        }
      default:
        return {
          code: 'SOURCE_ERROR',
          message: 'The research source could not be queried',
        }
    }
  }

  return {
    code: 'SOURCE_ERROR',
    message: 'The research source could not be queried',
  }
}

/**
 * Normalize connector search output into PaperDTO[].
 *
 * @param {import('../integrations/base/researchSource.connector.js').ResearchSourceConnector} connector
 * @param {unknown} searchResult
 * @returns {object[]}
 */
function extractPaperDtos(connector, searchResult) {
  if (!searchResult) return []

  if (Array.isArray(searchResult)) {
    const first = searchResult[0]
    if (first && typeof first === 'object' && 'title' in first && 'source' in first) {
      return searchResult
    }
    const normalized = connector.normalize(searchResult)
    return Array.isArray(normalized) ? normalized : [normalized]
  }

  if (typeof searchResult === 'object') {
    if (Array.isArray(searchResult.results)) {
      const sample = searchResult.results[0]
      if (sample && typeof sample === 'object' && 'title' in sample && 'source' in sample) {
        return searchResult.results
      }
      const normalized = connector.normalize(searchResult)
      return Array.isArray(normalized) ? normalized : [normalized]
    }

    const normalized = connector.normalize(searchResult)
    return Array.isArray(normalized) ? normalized : [normalized]
  }

  return []
}

/**
 * @param {unknown} searchResult
 * @param {number} parsedCount
 * @returns {number|null}
 */
function countRawSearchResults(searchResult, parsedCount) {
  if (!searchResult) return parsedCount
  if (Array.isArray(searchResult?.results)) return searchResult.results.length
  if (Array.isArray(searchResult)) return searchResult.length
  return parsedCount
}

/**
 * @param {object} dto
 * @returns {{ title: string, doi: string|null, paperId: string|null }}
 */
function summarizeDtoForAudit(dto) {
  return {
    title: String(dto?.title || '').slice(0, 300),
    doi: dto?.externalIds?.doi || dto?.doi || null,
    paperId: dto?._id ? String(dto._id) : dto?.id ? String(dto.id) : null,
  }
}

/**
 * Run multi-source discovery for a session.
 *
 * @param {string} userId
 * @param {{ sessionId: string, query: string, sources: string[], limit: number }} input
 * @returns {Promise<object>}
 */
export async function discoverPapers(userId, input) {
  const { sessionId, query, sources, limit } = input

  await sessionService.getSession(userId, sessionId)

  /** @type {object[]} */
  const collected = []
  /** @type {object[]} */
  const sourceResults = []

  for (const sourceId of sources) {
    try {
      const connector = createConnector(sourceId)
      const searchResult = await connector.search(query, { limit })
      const allDtos = extractPaperDtos(connector, searchResult)
      const parsedResultCount = allDtos.length
      const rawResultCount = countRawSearchResults(searchResult, parsedResultCount)
      const paperDtos = allDtos.slice(0, limit)

      collected.push(...paperDtos)
      sourceResults.push({
        source: sourceId,
        provider: sourceId,
        query,
        requestedLimit: limit,
        rawResultCount,
        parsedResultCount,
        usableResultCount: paperDtos.length,
        papers: paperDtos.map(summarizeDtoForAudit),
        status: 'success',
        count: paperDtos.length,
      })
    } catch (error) {
      if (error instanceof ConnectorError || error?.name?.includes('Connector')) {
        const publicFailure = toPublicConnectorFailure(error)
        sourceResults.push({
          source: sourceId,
          provider: sourceId,
          query,
          requestedLimit: limit,
          rawResultCount: 0,
          parsedResultCount: 0,
          usableResultCount: 0,
          papers: [],
          status: 'error',
          code: publicFailure.code,
          message: publicFailure.message,
          count: 0,
        })
        continue
      }

      sourceResults.push({
        source: sourceId,
        provider: sourceId,
        query,
        requestedLimit: limit,
        rawResultCount: 0,
        parsedResultCount: 0,
        usableResultCount: 0,
        papers: [],
        status: 'error',
        code: 'SOURCE_ERROR',
        message: 'The research source could not be queried',
        count: 0,
      })
    }
  }

  // Canonicalization owns duplicate detection + metadata merge
  const canonicalPapers = canonicalizePapers(collected).slice(0, limit)

  const papers =
    canonicalPapers.length > 0
      ? await paperService.saveDiscoveredPapers(
          userId,
          sessionId,
          canonicalPapers
        )
      : []

  const successCount = sourceResults.filter((r) => r.status === 'success').length
  const errorCount = sourceResults.filter((r) => r.status === 'error').length
  const partial = successCount > 0 && errorCount > 0
  const allSourcesFailed = successCount === 0 && errorCount > 0

  return {
    sessionId,
    query,
    sourcesRequested: sources,
    limit,
    papers,
    sourceResults,
    partial,
    allSourcesFailed,
    totals: {
      collected: collected.length,
      canonical: canonicalPapers.length,
      saved: papers.length,
      sourcesSucceeded: successCount,
      sourcesFailed: errorCount,
    },
  }
}

/**
 * Provider registry status for Discovery UI / clients.
 *
 * @returns {object[]}
 */
export function listDiscoveryProviders() {
  return [
    {
      id: 'openalex',
      name: 'OpenAlex',
      status: 'active',
      enabled: true,
    },
    {
      id: 'semantic_scholar',
      name: 'Semantic Scholar',
      status: 'active',
      enabled: true,
    },
    {
      id: 'crossref',
      name: 'CrossRef',
      status: 'inactive',
      enabled: false,
    },
    {
      id: 'core',
      name: 'CORE',
      status: 'inactive',
      enabled: false,
    },
  ]
}
