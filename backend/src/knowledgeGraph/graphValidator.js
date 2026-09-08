/**
 * @fileoverview Validate built knowledge graphs before persistence.
 */

import {
  GRAPH_EDGE_TYPES,
  GRAPH_NODE_TYPES,
} from '../constants/graph.constants.js'
import { AppError } from '../utils/AppError.js'

const VALID_NODE_TYPES = new Set(Object.values(GRAPH_NODE_TYPES))
const VALID_EDGE_TYPES = new Set(Object.values(GRAPH_EDGE_TYPES))

/**
 * @param {object} graph
 * @param {{ sessionId?: string }} [options]
 * @returns {{ ok: true, stats: object } | never}
 */
export function validateKnowledgeGraph(graph, options = {}) {
  if (!graph || typeof graph !== 'object') {
    throw new AppError('Graph payload is required', 400)
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null
  const links = Array.isArray(graph.links) ? graph.links : null

  if (!nodes || !links) {
    throw new AppError('Graph must include nodes and links arrays', 400)
  }

  if (options.sessionId) {
    const graphSessionId = graph.sessionId ? String(graph.sessionId) : null
    if (graphSessionId && graphSessionId !== String(options.sessionId)) {
      throw new AppError('Graph does not belong to the requested session', 400)
    }
  }

  const nodeIds = new Set()
  for (const node of nodes) {
    if (!node?.id || typeof node.id !== 'string') {
      throw new AppError('Each node requires a string id', 400)
    }
    if (!node.label || typeof node.label !== 'string') {
      throw new AppError(`Node ${node.id} requires a label`, 400)
    }
    if (!node.type || typeof node.type !== 'string') {
      throw new AppError(`Node ${node.id} requires a type`, 400)
    }
    if (!VALID_NODE_TYPES.has(node.type)) {
      throw new AppError(
        `Invalid node type "${node.type}" on node ${node.id}`,
        400
      )
    }
    if (nodeIds.has(node.id)) {
      throw new AppError(`Duplicate node id: ${node.id}`, 400)
    }
    nodeIds.add(node.id)
  }

  const linkIds = new Set()
  const directedKeys = new Set()

  for (const link of links) {
    if (!link?.id || typeof link.id !== 'string') {
      throw new AppError('Each edge requires a string id', 400)
    }
    if (!link.source || !link.target || !link.type) {
      throw new AppError(`Edge ${link.id} requires source, target, and type`, 400)
    }
    if (!VALID_EDGE_TYPES.has(link.type)) {
      throw new AppError(
        `Invalid edge type "${link.type}" on edge ${link.id}`,
        400
      )
    }
    if (linkIds.has(link.id)) {
      throw new AppError(`Duplicate edge id: ${link.id}`, 400)
    }
    linkIds.add(link.id)

    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      throw new AppError(
        `Edge ${link.id} references missing node ids (orphan relationship)`,
        400
      )
    }

    if (link.source === link.target) {
      throw new AppError(`Edge ${link.id} cannot be self-referential`, 400)
    }

    const directedKey = `${link.type}|${link.source}->${link.target}`
    if (directedKeys.has(directedKey)) {
      throw new AppError(
        `Duplicate edge between ${link.source} and ${link.target} (${link.type})`,
        400
      )
    }
    directedKeys.add(directedKey)

    // RELATED_TO is semantically undirected — reject reverse duplicates
    if (link.type === GRAPH_EDGE_TYPES.RELATED_TO) {
      const reverseKey = `${link.type}|${link.target}->${link.source}`
      if (directedKeys.has(reverseKey)) {
        throw new AppError(
          `Duplicate undirected RELATED_TO between ${link.source} and ${link.target}`,
          400
        )
      }
    }
  }

  const stats = {
    nodeCount: nodes.length,
    linkCount: links.length,
    nodeTypes: countBy(nodes, 'type'),
    edgeTypes: countBy(links, 'type'),
  }

  return { ok: true, stats }
}

/**
 * @param {object[]} items
 * @param {string} key
 * @returns {Record<string, number>}
 */
function countBy(items, key) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const item of items) {
    const value = item?.[key] || 'unknown'
    out[value] = (out[value] || 0) + 1
  }
  return out
}

export default {
  validateKnowledgeGraph,
  VALID_NODE_TYPES,
  VALID_EDGE_TYPES,
}
