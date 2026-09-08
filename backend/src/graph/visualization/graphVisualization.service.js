/**
 * @fileoverview Graph visualization — JSON payloads for the React Concept Graph.
 *
 * Future responsibility:
 * - Map internal KnowledgeGraph documents to frontend GraphCanvas contracts
 * - Attach layout hints (clusters, importance) without coupling to SVG rendering
 * - Keep visualization DTO stable so UI can swap dummy CONCEPT_GRAPH for live data
 *
 * Must NOT perform browser rendering; frontend owns SVG/canvas drawing.
 */

/**
 * @typedef {import('../builders/graphBuilder.service.js').KnowledgeGraph} KnowledgeGraph
 */

/**
 * Convert a knowledge graph into the TRACE Evidence Graph visualization DTO.
 *
 * @param {KnowledgeGraph} graph
 * @param {object} [options]
 * @returns {Promise<{ kind: 'concept', nodes: object[], links: object[] }>}
 */
export async function toConceptGraphVisualization(graph, options = {}) {
  throw new Error('Not implemented')
}

/**
 * Build legend metadata (node types, edge styles, confidence hints) for the UI.
 *
 * @param {KnowledgeGraph} graph
 * @returns {Promise<object>}
 */
export async function buildGraphLegend(graph) {
  throw new Error('Not implemented')
}
