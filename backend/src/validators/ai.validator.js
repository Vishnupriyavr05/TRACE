/**
 * @fileoverview AI HTTP request validators.
 */
import mongoose from 'mongoose'
import { validatePlannerOutput } from '../ai/validators/planner.schema.js'
import { validateEvidenceAnalystInput } from '../ai/validators/evidenceAnalyst.schema.js'
import { validateCriticInput } from '../ai/validators/critic.schema.js'
import { validateSynthesizerInput } from '../ai/validators/synthesizer.schema.js'
import { validateResearchOrchestratorInput } from '../ai/validators/researchOrchestrator.schema.js'

/**
 * Validate POST /ai/planner body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validatePlannerRequest(body = {}) {
  const errors = []
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const query = typeof body.query === 'string' ? body.query.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (!query) errors.push('query is required')
  else if (query.length < 3) errors.push('query must be at least 3 characters')
  else if (query.length > 2000) {
    errors.push('query must be at most 2000 characters')
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { sessionId, query } }
}

/**
 * Validate POST /ai/explorer body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateExplorerRequest(body = {}) {
  const errors = []
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const query = typeof body.query === 'string' ? body.query.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (!query) errors.push('query is required')
  else if (query.length < 3) errors.push('query must be at least 3 characters')
  else if (query.length > 2000) {
    errors.push('query must be at most 2000 characters')
  }

  const planResult = validatePlannerOutput(body.plan)
  if (!planResult.ok) {
    for (const err of planResult.errors || []) {
      errors.push(`plan.${err}`)
    }
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      query,
      plan: planResult.value,
    },
  }
}

/**
 * Validate POST /ai/evidence-analysis body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateEvidenceAnalysisRequest(body = {}) {
  return validateEvidenceAnalystInput(body)
}

/**
 * Validate POST /ai/critic body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateCriticRequest(body = {}) {
  return validateCriticInput(body)
}

/**
 * Validate POST /ai/synthesize body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateSynthesizeRequest(body = {}) {
  return validateSynthesizerInput(body)
}

/**
 * Validate POST /ai/research body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateResearchRequest(body = {}) {
  return validateResearchOrchestratorInput(body)
}

export default {
  validatePlannerRequest,
  validateExplorerRequest,
  validateEvidenceAnalysisRequest,
  validateCriticRequest,
  validateSynthesizeRequest,
  validateResearchRequest,
}
