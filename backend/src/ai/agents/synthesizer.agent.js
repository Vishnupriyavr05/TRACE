/**
 * @fileoverview Synthesizer agent definition for the agent runner contract.
 */
import {
  buildSynthesizerSystemPrompt,
  buildSynthesizerUserPrompt,
} from '../prompts/synthesizer.prompt.js'
import { validateSynthesizerOutput } from '../validators/synthesizer.schema.js'
import { getAgentTokenBudget } from '../core/traceProfile.js'

/**
 * @param {object} bound — provenance + Critic ceilings for output validation
 * @returns {import('../core/agentRunner.js').AgentDefinition}
 */
export function createSynthesizerAgent(bound) {
  return {
    id: 'synthesizer',
    temperature: 0.2,
    maxTokens: getAgentTokenBudget('synthesizer').maxOutputTokens,
    jsonMode: true,
    validateInput(input) {
      if (!input?.context || typeof input.context !== 'object') {
        return { ok: false, errors: ['context is required'] }
      }
      if (!input.context.researchQuestion) {
        return { ok: false, errors: ['context.researchQuestion is required'] }
      }
      if (!input.context.criticDecisions) {
        return { ok: false, errors: ['context.criticDecisions is required'] }
      }
      return { ok: true, value: input }
    },
    validateOutput(raw) {
      return validateSynthesizerOutput(raw, bound)
    },
    buildMessages(input) {
      return {
        system: buildSynthesizerSystemPrompt(),
        user: buildSynthesizerUserPrompt(input.context),
      }
    },
  }
}

export default {
  createSynthesizerAgent,
}
