/**
 * @fileoverview Planner agent definition for the agent runner contract.
 */
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from '../prompts/planner.prompt.js'
import {
  validatePlannerInput,
  validatePlannerOutput,
} from '../validators/planner.schema.js'
import { getAgentTokenBudget } from '../core/traceProfile.js'

/** @type {import('../core/agentRunner.js').AgentDefinition} */
export const plannerAgent = {
  id: 'planner',
  temperature: 0.2,
  maxTokens: getAgentTokenBudget('planner').maxOutputTokens,
  jsonMode: true,
  validateInput: validatePlannerInput,
  validateOutput: validatePlannerOutput,
  buildMessages(input) {
    return {
      system: buildPlannerSystemPrompt(),
      user: buildPlannerUserPrompt(input.query, input.sessionContext || {}),
    }
  },
}

export default plannerAgent
