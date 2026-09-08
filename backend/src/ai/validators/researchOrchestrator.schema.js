/**
 * @fileoverview Research Orchestrator input validation.
 */
import mongoose from 'mongoose'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Validate POST /ai/research body.
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateResearchOrchestratorInput(input = {}) {
  const errors = []
  const sessionId = asString(input.sessionId)
  const query = asString(input.query)

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

  return {
    ok: true,
    value: {
      sessionId,
      query,
    },
  }
}

export default {
  validateResearchOrchestratorInput,
}
