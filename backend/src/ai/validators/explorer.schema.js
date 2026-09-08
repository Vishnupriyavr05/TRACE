/**
 * @fileoverview Explorer input/output and advisory schemas.
 */
import mongoose from 'mongoose'
import { validatePlannerOutput } from './planner.schema.js'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Validate Explorer service/HTTP input.
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateExplorerInput(input = {}) {
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

  const planResult = validatePlannerOutput(input.plan)
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
 * Validate optional LLM advisory output (GraphRAG selection / refinements).
 *
 * @param {unknown} raw
 * @param {{ plannedCount: number, maxGraphRag: number, maxRefined: number }} bounds
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateExplorerAdvisory(raw, bounds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Advisory output must be a JSON object'] }
  }

  const indexes = Array.isArray(raw.graphRagQueryIndexes)
    ? raw.graphRagQueryIndexes
    : []

  const graphRagQueryIndexes = [
    ...new Set(
      indexes
        .map((n) => Number(n))
        .filter(
          (n) =>
            Number.isInteger(n) &&
            n >= 0 &&
            n < bounds.plannedCount
        )
    ),
  ].slice(0, bounds.maxGraphRag)

  const refinedRaw = Array.isArray(raw.refinedQueries) ? raw.refinedQueries : []
  const refinedQueries = refinedRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const query = asString(item.query)
      if (!query || query.length < 3) return null
      return {
        query,
        purpose: asString(item.purpose) || 'refinement',
        basedOnIndex:
          Number.isInteger(Number(item.basedOnIndex))
            ? Number(item.basedOnIndex)
            : null,
      }
    })
    .filter(Boolean)
    .slice(0, bounds.maxRefined)

  const gapHints = Array.isArray(raw.gapHints)
    ? raw.gapHints
        .map((g) => asString(g))
        .filter(Boolean)
        .slice(0, 12)
    : []

  return {
    ok: true,
    value: {
      graphRagQueryIndexes,
      refinedQueries,
      gapHints,
    },
  }
}

/**
 * Validate the structured EvidencePackage.
 *
 * @param {unknown} raw
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateEvidencePackage(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['EvidencePackage must be an object'] }
  }

  const runId = asString(raw.runId)
  const sessionId = asString(raw.sessionId)
  const researchQuestion = asString(raw.researchQuestion)

  if (!runId) errors.push('runId is required')
  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }
  if (!researchQuestion) errors.push('researchQuestion is required')

  if (!Array.isArray(raw.searches)) errors.push('searches must be an array')
  if (!Array.isArray(raw.papers)) errors.push('papers must be an array')
  if (!Array.isArray(raw.graphEvidence)) {
    errors.push('graphEvidence must be an array')
  }
  if (!Array.isArray(raw.evidenceGaps)) {
    errors.push('evidenceGaps must be an array')
  }
  if (!raw.explorationStats || typeof raw.explorationStats !== 'object') {
    errors.push('explorationStats is required')
  }

  const papers = Array.isArray(raw.papers) ? raw.papers : []
  papers.forEach((paper, index) => {
    if (!paper || typeof paper !== 'object') {
      errors.push(`papers[${index}] must be an object`)
      return
    }
    if (!asString(paper.paperId)) {
      errors.push(`papers[${index}].paperId is required`)
    }
    if (!Array.isArray(paper.matchedQueries)) {
      errors.push(`papers[${index}].matchedQueries must be an array`)
    }
    if (!paper.provenance || typeof paper.provenance !== 'object') {
      errors.push(`papers[${index}].provenance is required`)
    } else if (!asString(paper.provenance.sessionId)) {
      errors.push(`papers[${index}].provenance.sessionId is required`)
    }
  })

  const stats = raw.explorationStats || {}
  for (const key of [
    'queriesExecuted',
    'papersDiscovered',
    'uniqueCanonicalPapers',
    'graphRagQueries',
  ]) {
    if (typeof stats[key] !== 'number') {
      errors.push(`explorationStats.${key} must be a number`)
    }
  }

  if (errors.length) return { ok: false, errors }

  return { ok: true, value: raw }
}

/**
 * Deterministic default advisory when LLM is unavailable.
 *
 * @param {number} plannedCount
 * @param {number} maxGraphRag
 * @returns {object}
 */
export function defaultExplorerAdvisory(plannedCount, maxGraphRag) {
  const count = Math.min(plannedCount, maxGraphRag)
  return {
    graphRagQueryIndexes: Array.from({ length: count }, (_, i) => i),
    refinedQueries: [],
    gapHints: [],
  }
}

export default {
  validateExplorerInput,
  validateExplorerAdvisory,
  validateEvidencePackage,
  defaultExplorerAdvisory,
}
