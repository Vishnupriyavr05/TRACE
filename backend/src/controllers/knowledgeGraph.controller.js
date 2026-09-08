/**
 * @fileoverview KnowledgeGraph HTTP controllers.
 */
import * as graphService from '../services/knowledgeGraph.service.js'
import { buildSessionKnowledgeGraph } from '../knowledgeGraph/knowledgeGraph.builder.js'
import { AppError } from '../utils/AppError.js'

function getUserId(req) {
  const userId = req.user?._id || req.user?.id
  if (!userId) throw new AppError('Authentication required', 401)
  return String(userId)
}

export async function create(req, res, next) {
  try {
    const graph = await graphService.createGraph(getUserId(req), req.validated)
    res.status(201).json({
      success: true,
      message: 'Knowledge graph created successfully',
      data: { graph },
    })
  } catch (error) {
    next(error)
  }
}

export async function list(req, res, next) {
  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 20
    const result = await graphService.listGraphs(getUserId(req), { page, limit })
    res.status(200).json({
      success: true,
      message: 'Knowledge graphs retrieved successfully',
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export async function getById(req, res, next) {
  try {
    const graph = await graphService.getGraphById(getUserId(req), req.params.id)
    res.status(200).json({
      success: true,
      message: 'Knowledge graph retrieved successfully',
      data: { graph },
    })
  } catch (error) {
    next(error)
  }
}

export async function getBySession(req, res, next) {
  try {
    const graph = await graphService.getGraphBySession(
      getUserId(req),
      req.params.sessionId
    )
    res.status(200).json({
      success: true,
      message: 'Knowledge graph retrieved successfully',
      data: { graph },
    })
  } catch (error) {
    next(error)
  }
}

export async function update(req, res, next) {
  try {
    const graph = await graphService.updateGraph(
      getUserId(req),
      req.params.id,
      req.validated
    )
    res.status(200).json({
      success: true,
      message: 'Knowledge graph updated successfully',
      data: { graph },
    })
  } catch (error) {
    next(error)
  }
}

export async function remove(req, res, next) {
  try {
    const graph = await graphService.deleteGraph(getUserId(req), req.params.id)
    res.status(200).json({
      success: true,
      message: 'Knowledge graph deleted successfully',
      data: { graph },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /graphs/session/:sessionId/build
 * Deterministic Knowledge Graph Builder for an owned session.
 */
export async function buildForSession(req, res, next) {
  try {
    const paperIds = Array.isArray(req.body?.paperIds)
      ? req.body.paperIds.map(String).filter(Boolean)
      : undefined
    const scope =
      req.body?.scope === 'final' || req.body?.scope === 'discovery'
        ? req.body.scope
        : paperIds?.length
          ? 'final'
          : undefined

    const result = await buildSessionKnowledgeGraph(
      getUserId(req),
      req.params.sessionId,
      { paperIds, scope },
    )

    res.status(200).json({
      success: true,
      message:
        result.status === 'empty'
          ? 'Knowledge graph built (empty — no papers in session)'
          : 'Knowledge graph built successfully',
      data: {
        graph: result.graph,
        stats: result.stats,
        status: result.status,
        buildStatus: result.buildStatus,
      },
    })
  } catch (error) {
    next(error)
  }
}
