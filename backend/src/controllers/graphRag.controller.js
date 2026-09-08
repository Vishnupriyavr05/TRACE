/**
 * @fileoverview GraphRAG HTTP controllers.
 */
import * as graphRagService from '../graphRag/graphRag.service.js'
import { AppError } from '../utils/AppError.js'

function getUserId(req) {
  const userId = req.user?._id || req.user?.id
  if (!userId) throw new AppError('Authentication required', 401)
  return String(userId)
}

/**
 * POST /graph-rag/retrieve
 */
export async function retrieve(req, res, next) {
  try {
    const context = await graphRagService.retrieveGraphContext(
      getUserId(req),
      req.validated
    )

    res.status(200).json({
      success: true,
      message:
        context.retrievalStats?.scoredPaperCount > 0
          ? 'GraphRAG context retrieved successfully'
          : context.retrievalStats?.emptyGraph
            ? 'No knowledge graph data available for this session'
            : 'No relevant papers found for this query',
      data: {
        query: context.query,
        sessionId: context.sessionId,
        papers: context.papers,
        nodes: context.nodes,
        edges: context.edges,
        paths: context.paths,
        evidence: context.evidence,
        seedNodes: context.seedNodes,
        retrievalStats: context.retrievalStats,
      },
    })
  } catch (error) {
    next(error)
  }
}
