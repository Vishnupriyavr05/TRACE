/**
 * @fileoverview KnowledgeGraph service — persistence only.
 * Deterministic graph construction lives in src/knowledgeGraph/.
 */
import mongoose from 'mongoose'
import * as graphRepository from '../repositories/knowledgeGraph.repository.js'
import { requireOwnedSession } from './researchSession.service.js'
import { AppError } from '../utils/AppError.js'

const MAX_NODES = 5000

function assertId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400)
  }
}

function computeStats(nodes = [], links = []) {
  return {
    nodeCount: nodes.length,
    linkCount: links.length,
  }
}

function validateGraphShape({ nodes = [], links = [] }) {
  if (nodes.length > MAX_NODES) {
    throw new AppError(`Graph exceeds maximum of ${MAX_NODES} nodes`, 400)
  }

  const nodeIds = new Set()
  for (const node of nodes) {
    if (!node?.id || !node?.label || !node?.type) {
      throw new AppError('Each node requires id, label, and type', 400)
    }
    if (nodeIds.has(node.id)) {
      throw new AppError(`Duplicate node id: ${node.id}`, 400)
    }
    nodeIds.add(node.id)
  }

  const linkIds = new Set()
  for (const link of links) {
    if (!link?.id || !link?.source || !link?.target || !link?.type) {
      throw new AppError('Each link requires id, source, target, and type', 400)
    }
    if (linkIds.has(link.id)) {
      throw new AppError(`Duplicate link id: ${link.id}`, 400)
    }
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      throw new AppError(
        `Link ${link.id} references missing node ids`,
        400
      )
    }
    linkIds.add(link.id)
  }
}

/**
 * Create a knowledge graph for a session (fails if one already exists).
 */
export async function createGraph(userId, input) {
  await requireOwnedSession(userId, input.sessionId)

  const existing = await graphRepository.findBySessionId(input.sessionId)
  if (existing) {
    throw new AppError('Knowledge graph already exists for this session', 409)
  }

  const nodes = input.nodes || []
  const links = input.links || []
  validateGraphShape({ nodes, links })

  return graphRepository.create({
    sessionId: input.sessionId,
    userId,
    runId: input.runId ?? null,
    kind: input.kind || 'concept',
    version: input.version || 1,
    schemaVersion: input.schemaVersion || 1,
    nodes,
    links,
    paperIds: input.paperIds || [],
    metadata: input.metadata || {},
    stats: computeStats(nodes, links),
    status:
      input.status ||
      (nodes.length === 0 && links.length === 0 ? 'empty' : 'draft'),
  })
}

export async function getGraphById(userId, graphId) {
  assertId(graphId, 'graph id')
  const graph = await graphRepository.findById(graphId)
  if (!graph || String(graph.userId) !== String(userId)) {
    throw new AppError('Knowledge graph not found', 404)
  }
  return graph
}

export async function getGraphBySession(userId, sessionId) {
  await requireOwnedSession(userId, sessionId, { allowArchived: true })
  const graph = await graphRepository.findBySessionId(sessionId)
  if (!graph) {
    throw new AppError('Knowledge graph not found', 404)
  }
  return graph
}

export async function updateGraph(userId, graphId, updates) {
  const existing = await getGraphById(userId, graphId)
  await requireOwnedSession(userId, existing.sessionId)

  const nodes = updates.nodes !== undefined ? updates.nodes : existing.nodes
  const links = updates.links !== undefined ? updates.links : existing.links
  validateGraphShape({ nodes, links })

  const payload = {
    ...updates,
    nodes,
    links,
    stats: computeStats(nodes, links),
  }

  if (updates.nodes !== undefined || updates.links !== undefined) {
    payload.version = (existing.version || 1) + 1
  }

  const updated = await graphRepository.updateById(graphId, payload)
  if (!updated) throw new AppError('Knowledge graph not found', 404)
  return updated
}

export async function deleteGraph(userId, graphId) {
  await getGraphById(userId, graphId)
  const deleted = await graphRepository.deleteById(graphId)
  if (!deleted) throw new AppError('Knowledge graph not found', 404)
  return deleted
}

export async function listGraphs(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit
  const { items, total } = await graphRepository.listByUserId(userId, {
    skip,
    limit,
  })
  return {
    graphs: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  }
}
