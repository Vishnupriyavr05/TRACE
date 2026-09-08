/**
 * @fileoverview Knowledge graph builder — constructs run-scoped graphs.
 *
 * Implementation lives in src/knowledgeGraph/ (deterministic, no LLM).
 * This module re-exports the pure in-memory builder for graph/* consumers.
 */

import { buildGraphFromPapers } from '../../knowledgeGraph/knowledgeGraph.builder.js'

/**
 * Build a knowledge graph from papers (in-memory; no persistence).
 *
 * @param {object[]} papers
 * @param {object} [_connectorOutput]
 * @param {object} [options]
 * @returns {Promise<{ nodes: object[], links: object[], paperIds: string[], stats: object, status: string }>}
 */
export async function buildKnowledgeGraph(papers, _connectorOutput = {}, options = {}) {
  return buildGraphFromPapers(papers, options)
}

/**
 * Merge incremental nodes/edges into an existing graph (Explorer expansion).
 * Deterministic ID union — does not invent relationships.
 *
 * @param {{ nodes?: object[], links?: object[] }} graph
 * @param {{ nodes?: object[], links?: object[] }} delta
 * @returns {Promise<{ nodes: object[], links: object[] }>}
 */
export async function mergeGraphDelta(graph, delta) {
  const nodesById = new Map()
  for (const node of graph?.nodes || []) {
    if (node?.id) nodesById.set(node.id, node)
  }
  for (const node of delta?.nodes || []) {
    if (node?.id) nodesById.set(node.id, node)
  }

  const linksById = new Map()
  for (const link of graph?.links || []) {
    if (link?.id) linksById.set(link.id, link)
  }
  for (const link of delta?.links || []) {
    if (link?.id) linksById.set(link.id, link)
  }

  return {
    nodes: [...nodesById.values()],
    links: [...linksById.values()],
  }
}
