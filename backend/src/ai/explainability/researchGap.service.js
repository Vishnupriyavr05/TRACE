/**
 * @fileoverview Research gap detection — explainability service interface.
 *
 * Future responsibility:
 * - Identify under-covered topics relative to the query and retrieved corpus
 * - Quantify gap strength (e.g. sparse publication counts in a niche)
 * - Populate Research Insights "Research Gap Analysis"
 *
 * Consumed by: Critic agent, report synthesis.
 * Must NOT own: OpenAlex HTTP clients (use integrations/) or graph builders.
 */

/**
 * @typedef {Object} CorpusSummary
 * @property {string[]} paperIds
 * @property {string[]} [concepts]
 * @property {object} [stats]
 */

/**
 * @typedef {Object} ResearchGapResult
 * @property {string} title
 * @property {string} summary
 * @property {string} [evidence]
 * @property {string[]} [relatedConcepts]
 * @property {number} [severity]
 */

/**
 * Discover research gaps for a question given a retrieved corpus summary.
 *
 * @param {string} researchQuestion
 * @param {CorpusSummary} corpus
 * @returns {Promise<ResearchGapResult[]>}
 */
export async function detectResearchGaps(researchQuestion, corpus) {
  throw new Error('Not implemented')
}
