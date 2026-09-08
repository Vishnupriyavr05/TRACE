/**
 * @fileoverview Confidence scoring — explainability service interface.
 *
 * Future responsibility:
 * - Compute overall and per-finding confidence for a TRACE run
 * - Combine signals: source quality, agreement, citation strength, integrity flags
 * - Power Research Insights "Confidence Score" and PDF export fields
 *
 * Consumed by: Critic/Synthesizer agents, report controllers.
 * Must NOT own: UI rendering or MongoDB schema definitions.
 */

/**
 * @typedef {Object} ConfidenceSignals
 * @property {number} [agreement]
 * @property {number} [sourceQuality]
 * @property {number} [citationStrength]
 * @property {number} [integrityRisk]
 * @property {number} [coverage]
 * @property {object} [extras]
 */

/**
 * @typedef {Object} ConfidenceResult
 * @property {number} overall Score 0–100
 * @property {object} [breakdown]
 * @property {string} [explanation]
 */

/**
 * Score confidence for a research session given structured signals.
 *
 * @param {string} researchQuestion
 * @param {ConfidenceSignals} signals
 * @returns {Promise<ConfidenceResult>}
 */
export async function scoreConfidence(researchQuestion, signals) {
  throw new Error('Not implemented')
}

/**
 * Score confidence for an individual finding / claim.
 *
 * @param {string} finding
 * @param {ConfidenceSignals} signals
 * @returns {Promise<ConfidenceResult>}
 */
export async function scoreFindingConfidence(finding, signals) {
  throw new Error('Not implemented')
}
