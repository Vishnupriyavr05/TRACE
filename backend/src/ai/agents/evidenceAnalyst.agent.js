/**
 * @fileoverview Evidence Analyst agent definition for the agent runner contract.
 */
import {
  buildEvidenceAnalystSystemPrompt,
  buildEvidenceAnalystUserPrompt,
} from '../prompts/evidenceAnalyst.prompt.js'
import { validateAnalyticalFindings } from '../validators/evidenceAnalyst.schema.js'
import { getAgentTokenBudget } from '../core/traceProfile.js'

/**
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   researchQuestion: string,
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>,
 *   allowedNodeIds: Set<string>,
 *   allowedPathIds: Set<string>,
 *   evidenceIdToPaperId?: Map<string, string>
 * }} bound
 * @returns {import('../core/agentRunner.js').AgentDefinition}
 */
export function createEvidenceAnalystAgent(bound) {
  return {
    id: 'evidence_analyst',
    temperature: 0.2,
    maxTokens: getAgentTokenBudget('evidence_analyst').maxOutputTokens,
    jsonMode: true,
    validateInput(input) {
      if (!input?.context || typeof input.context !== 'object') {
        return { ok: false, errors: ['context is required'] }
      }
      if (!input.context.researchQuestion) {
        return { ok: false, errors: ['context.researchQuestion is required'] }
      }
      if (!Array.isArray(input.context.evidenceItems)) {
        return { ok: false, errors: ['context.evidenceItems must be an array'] }
      }
      return { ok: true, value: input }
    },
    validateOutput(raw) {
      return validateAnalyticalFindings(raw, bound)
    },
    buildMessages(input) {
      return {
        system: buildEvidenceAnalystSystemPrompt(),
        user: buildEvidenceAnalystUserPrompt(input.context),
      }
    },
  }
}

export default {
  createEvidenceAnalystAgent,
}
