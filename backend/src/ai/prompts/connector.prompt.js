/**
 * @fileoverview Connector agent prompt templates.
 *
 * Future responsibility:
 * - Guide linking of concepts, methods, datasets, and papers into relational structure
 * - Describe proposed edges/types for the graph layer to materialize
 * - Remain pure template functions (no graph writes here — graph/ owns construction)
 */

/**
 * @returns {string}
 */
export function buildConnectorSystemPrompt() {
  throw new Error('Not implemented')
}

/**
 * @param {string} researchQuestion
 * @param {object[]} papers
 * @param {object} [explorerOutput]
 * @returns {string}
 */
export function buildConnectorUserPrompt(researchQuestion, papers, explorerOutput = {}) {
  throw new Error('Not implemented')
}
