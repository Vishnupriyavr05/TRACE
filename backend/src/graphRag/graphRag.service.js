/**
 * @fileoverview GraphRAG orchestration service — retrieval/context only.
 */
import mongoose from 'mongoose'
import { requireOwnedSession } from '../services/researchSession.service.js'
import * as graphService from '../services/knowledgeGraph.service.js'
import * as paperService from '../services/paper.service.js'
import { AppError } from '../utils/AppError.js'
import { retrieveRelevantEntities } from './graphRetriever.js'
import { traverseGraph } from './graphTraversal.js'
import { buildEvidenceContext } from './contextBuilder.js'

const DEFAULT_TOP_K = 10
const DEFAULT_DEPTH = 1
const MAX_TOP_K = 50
const MAX_DEPTH = 4

/**
 * @param {string} id
 * @param {string} label
 */
function assertObjectId(id, label) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400)
  }
}

/**
 * Normalize and validate retrieval options.
 *
 * @param {object} options
 * @returns {{ topK: number, depth: number, filters: object }}
 */
export function normalizeRetrievalOptions(options = {}) {
  let topK = options.topK === undefined ? DEFAULT_TOP_K : Number(options.topK)
  let depth = options.depth === undefined ? DEFAULT_DEPTH : Number(options.depth)

  if (!Number.isInteger(topK) || topK < 1) {
    throw new AppError('topK must be an integer >= 1', 400)
  }
  if (topK > MAX_TOP_K) {
    throw new AppError(`topK must be at most ${MAX_TOP_K}`, 400)
  }
  if (!Number.isInteger(depth) || depth < 0) {
    throw new AppError('depth must be an integer >= 0', 400)
  }
  if (depth > MAX_DEPTH) {
    throw new AppError(`depth must be at most ${MAX_DEPTH}`, 400)
  }

  return {
    topK,
    depth,
    filters:
      options.filters && typeof options.filters === 'object'
        ? options.filters
        : {},
  }
}

/**
 * Run deterministic GraphRAG retrieval for an owned session.
 *
 * @param {string} userId
 * @param {{ sessionId: string, query: string, topK?: number, depth?: number, filters?: object }} input
 * @returns {Promise<object>}
 */
export async function retrieveGraphContext(userId, input) {
  const sessionId = String(input.sessionId || '').trim()
  const query = typeof input.query === 'string' ? input.query.trim() : ''

  assertObjectId(sessionId, 'session id')

  if (!query) {
    throw new AppError('query is required', 400)
  }
  if (query.length < 2) {
    throw new AppError('query must be at least 2 characters', 400)
  }
  if (query.length > 2000) {
    throw new AppError('query must be at most 2000 characters', 400)
  }

  const options = normalizeRetrievalOptions(input)

  // Ownership / not-found / archived handling
  await requireOwnedSession(userId, sessionId)

  const papers = await paperService.listSessionPapers(sessionId)

  let graph = { nodes: [], links: [], status: 'empty' }
  let emptyGraph = true
  try {
    graph = await graphService.getGraphBySession(userId, sessionId)
    emptyGraph = !graph?.nodes?.length
  } catch (error) {
    if (error?.statusCode !== 404) throw error
    // No graph document yet — treat as empty graph
    emptyGraph = true
  }

  const retrieval = retrieveRelevantEntities({
    query,
    papers,
    graph,
    topK: options.topK,
    filters: options.filters,
  })

  const traversal = traverseGraph({
    nodes: graph.nodes || [],
    links: graph.links || [],
    seedNodeIds: retrieval.seedNodeIds,
    depth: options.depth,
  })

  // Attach retrieval scores onto visited seed nodes for context
  const seedScoreById = new Map(
    retrieval.seedNodes.map((n) => [n.id, n.retrievalScore])
  )
  traversal.visitedNodes = traversal.visitedNodes.map((node) => ({
    ...node,
    retrievalScore: seedScoreById.has(node.id)
      ? seedScoreById.get(node.id)
      : null,
  }))

  const context = buildEvidenceContext({
    sessionId,
    query,
    scoredPapers: retrieval.scoredPapers,
    traversal,
    seedNodes: retrieval.seedNodes,
    allPapers: papers,
    emptyGraph: emptyGraph || retrieval.emptyGraph,
    options: {
      topK: options.topK,
      depth: options.depth,
    },
  })

  return context
}

export default {
  retrieveGraphContext,
  normalizeRetrievalOptions,
}
