/**
 * @fileoverview Critic agent definition for the agent runner contract.
 */
import {
  buildCriticSystemPrompt,
  buildCriticUserPrompt,
} from '../prompts/critic.prompt.js'
import { validateCritiqueResult } from '../validators/critic.schema.js'
import { getAgentTokenBudget } from '../core/traceProfile.js'

/**
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   researchQuestion: string,
 *   findingIds: Set<string>,
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>,
 *   evidenceIdToPaperId?: Map<string, string>
 * }} bound
 * @returns {import('../core/agentRunner.js').AgentDefinition}
 */
export function createCriticAgent(bound) {
  return {
    id: 'critic',
    temperature: 0.1,
    maxTokens: getAgentTokenBudget('critic').maxOutputTokens,
    jsonMode: true,
    validateInput(input) {
      if (!input?.context || typeof input.context !== 'object') {
        return { ok: false, errors: ['context is required'] }
      }
      if (!Array.isArray(input.context.findingsToEvaluate)) {
        return {
          ok: false,
          errors: ['context.findingsToEvaluate must be an array'],
        }
      }
      if (!input.context.researchQuestion) {
        return { ok: false, errors: ['context.researchQuestion is required'] }
      }
      return { ok: true, value: input }
    },
    validateOutput(raw) {
      return validateCritiqueResult(raw, bound)
    },
    buildMessages(input) {
      return {
        system: buildCriticSystemPrompt(),
        user: buildCriticUserPrompt(input.context),
      }
    },
  }
}

export default {
  createCriticAgent,
}
