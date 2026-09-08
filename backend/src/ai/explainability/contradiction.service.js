/**
 * @fileoverview Contradiction detection — explainability service interface.
 *
 * Future responsibility:
 * - Detect conflicting claims across supporting papers / retrieved passages
 * - Classify contradiction severity and cite source paper IDs
 * - Feed Research Insights "Contradictions" section and Critic agent output
 *
 * Consumed by: Critic agent, report synthesis, explainability APIs.
 * Must NOT own: graph construction or raw LLM provider configuration.
 */

/**
 * @typedef {Object} EvidenceClaim
 * @property {string} id
 * @property {string} paperId
 * @property {string} text
 * @property {object} [location]
 */

/**
 * @typedef {Object} ContradictionResult
 * @property {string} summary
 * @property {string[]} paperIds
 * @property {'low'|'medium'|'high'} [severity]
 * @property {string} [explanation]
 */

/**
 * Find contradictions among a set of evidence claims for a research question.
 *
 * @param {string} researchQuestion
 * @param {EvidenceClaim[]} claims
 * @returns {Promise<ContradictionResult[]>}
 */
export async function detectContradictions(researchQuestion, claims) {
  throw new Error('Not implemented')
}
