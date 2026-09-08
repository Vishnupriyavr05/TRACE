/**
 * @fileoverview Graph traversal — neighbourhood and path queries over KGs.
 *
 * Future responsibility:
 * - BFS/DFS / k-hop expansion from seed nodes
 * - Evidence-path extraction between claims and papers/concepts
 * - Support GraphRAG context assembly without embedding LLM calls here
 *
 * Consumed by: GraphRAG pipelines, Evidence Inspector backends, agents (read-only).
 */

/**
 * @typedef {import('../builders/graphBuilder.service.js').KnowledgeGraph} KnowledgeGraph
 */

/**
 * Expand k-hop neighbourhood from seed node IDs.
 *
 * @param {KnowledgeGraph} graph
 * @param {string[]} seedNodeIds
 * @param {number} [depth]
 * @returns {Promise<KnowledgeGraph>} Subgraph
 */
export async function expandNeighborhood(graph, seedNodeIds, depth = 1) {
  throw new Error('Not implemented')
}

/**
 * Find paths between two nodes (evidence / citation style paths).
 *
 * @param {KnowledgeGraph} graph
 * @param {string} sourceId
 * @param {string} targetId
 * @param {object} [options]
 * @returns {Promise<object[]>} Ordered path descriptors
 */
export async function findPaths(graph, sourceId, targetId, options = {}) {
  throw new Error('Not implemented')
}

/**
 * Return nodes/edges connected to a selected concept (UI highlight support).
 *
 * @param {KnowledgeGraph} graph
 * @param {string} nodeId
 * @returns {Promise<{ nodeIds: string[], edgeIds: string[] }>}
 */
export async function getConnectedComponentsForNode(graph, nodeId) {
  throw new Error('Not implemented')
}
