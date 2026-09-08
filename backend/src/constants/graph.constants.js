/**
 * @fileoverview Knowledge graph related constants.
 *
 * Node / edge type identifiers must stay aligned with the frontend Evidence Graph
 * where applicable. Paper and Venue use fallback styles on the canvas.
 */

/**
 * Reserved node type identifiers.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GRAPH_NODE_TYPES = Object.freeze({
  PAPER: 'Paper',
  CONCEPT: 'Concept',
  TOPIC: 'Topic',
  METHOD: 'Method',
  ALGORITHM: 'Algorithm',
  DATASET: 'Dataset',
  AUTHOR: 'Author',
  VENUE: 'Venue',
  RESEARCH_GAP: 'Research Gap',
})

/**
 * Deterministic edge types produced by the Knowledge Graph Builder.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GRAPH_EDGE_TYPES = Object.freeze({
  AUTHOR_OF: 'AUTHOR_OF',
  HAS_KEYWORD: 'HAS_KEYWORD',
  HAS_CONCEPT: 'HAS_CONCEPT',
  PUBLISHED_IN: 'PUBLISHED_IN',
  CITES: 'CITES',
  RELATED_TO: 'RELATED_TO',
})

/**
 * Activity types recorded around graph builds (via ActivityService).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GRAPH_BUILD_ACTIVITY = Object.freeze({
  STARTED: 'KNOWLEDGE_GRAPH_BUILD_STARTED',
  COMPLETED: 'KNOWLEDGE_GRAPH_BUILD_COMPLETED',
  FAILED: 'KNOWLEDGE_GRAPH_BUILD_FAILED',
})

/**
 * @type {Readonly<Record<string, unknown>>}
 */
export const GRAPH_CONSTANTS = Object.freeze({
  MAX_NODES_PER_BUILD: 5000,
})
