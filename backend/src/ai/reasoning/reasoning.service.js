/**
 * @fileoverview Reasoning service — orchestrates AI reasoning steps for TRACE runs.
 *
 * Future responsibility:
 * - Coordinate LLM calls with retrieval/re-ranking outputs for agent stages
 * - Apply prompt templates from ai/prompts without embedding prompt text here
 * - Produce structured reasoning traces (searched / selected / rejected / why)
 * - Bridge agents ↔ ai/* while remaining free of Express and Mongo details
 *
 * Consumed by: backend agents (Planner…Synthesizer).
 * Must NOT own: knowledge graph mutation (delegate to graph/) or HTTP routes.
 */

/**
 * @typedef {Object} ReasoningContext
 * @property {string} sessionId
 * @property {string} researchQuestion
 * @property {object} [filters]
 * @property {object} [retrieval]
 * @property {object} [graphSnapshot]
 * @property {object} [priorAgentOutputs]
 */

/**
 * @typedef {Object} ReasoningResult
 * @property {string} agentId
 * @property {object} output
 * @property {object} [trace]
 */

/**
 * Run a named reasoning stage (e.g. planner, critic) with structured context.
 *
 * @param {'planner'|'explorer'|'connector'|'critic'|'synthesizer'} stage
 * @param {ReasoningContext} context
 * @returns {Promise<ReasoningResult>}
 */
export async function runReasoningStage(stage, context) {
  throw new Error('Not implemented')
}

/**
 * Build an explainability trace entry for AgentTrace UI.
 *
 * @param {ReasoningResult} result
 * @returns {Promise<object>}
 */
export async function buildReasoningTrace(result) {
  throw new Error('Not implemented')
}
