/**
 * @fileoverview Explorer advisory agent (light LLM) — no discovery/retrieval.
 */
import {
  buildExplorerSystemPrompt,
  buildExplorerUserPrompt,
} from '../prompts/explorer.prompt.js'
import {
  validateExplorerAdvisory,
  defaultExplorerAdvisory,
} from '../validators/explorer.schema.js'
import { getAgentTokenBudget } from '../core/traceProfile.js'

/**
 * Build agent definition for a specific advisory context.
 *
 * @param {{ plannedCount: number, maxGraphRag: number, maxRefined: number }} bounds
 * @returns {import('../core/agentRunner.js').AgentDefinition}
 */
export function createExplorerAdvisoryAgent(bounds) {
  return {
    id: 'explorer',
    temperature: 0.1,
    maxTokens: getAgentTokenBudget('explorer').maxOutputTokens,
    jsonMode: true,
    validateInput(input) {
      if (!input?.researchQuestion || !input?.plan || !input?.plannedQueries) {
        return { ok: false, errors: ['Invalid explorer advisory input'] }
      }
      return { ok: true, value: input }
    },
    validateOutput(raw) {
      return validateExplorerAdvisory(raw, bounds)
    },
    buildMessages(input) {
      return {
        system: buildExplorerSystemPrompt(),
        user: buildExplorerUserPrompt(input),
      }
    },
  }
}

export { defaultExplorerAdvisory }

export default {
  createExplorerAdvisoryAgent,
  defaultExplorerAdvisory,
}
