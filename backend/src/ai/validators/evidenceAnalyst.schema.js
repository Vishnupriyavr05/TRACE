/**
 * @fileoverview Evidence Analyst input/output schema validation.
 */
import mongoose from 'mongoose'
import { validateEvidencePackage } from './explorer.schema.js'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const FINDING_TYPES = new Set(['SUPPORTED', 'PATTERN', 'LIMITED'])
const CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW'])

/**
 * Validate Evidence Analyst service/HTTP input.
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateEvidenceAnalystInput(input = {}) {
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

  const packageResult = validateEvidencePackage(input.evidencePackage)
  if (!packageResult.ok) {
    for (const err of packageResult.errors || []) {
      errors.push(`evidencePackage.${err}`)
    }
  } else if (
    packageResult.value.sessionId &&
    String(packageResult.value.sessionId) !== sessionId
  ) {
    errors.push('evidencePackage.sessionId must match sessionId')
  }

  const priorAnalyticalFindings =
    input.priorAnalyticalFindings &&
    typeof input.priorAnalyticalFindings === 'object' &&
    !Array.isArray(input.priorAnalyticalFindings)
      ? input.priorAnalyticalFindings
      : null

  const priorCritiqueResult =
    input.priorCritiqueResult &&
    typeof input.priorCritiqueResult === 'object' &&
    !Array.isArray(input.priorCritiqueResult)
      ? input.priorCritiqueResult
      : null

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      query,
      evidencePackage: packageResult.value,
      priorAnalyticalFindings,
      priorCritiqueResult,
    },
  }
}

/**
 * @param {unknown} list
 * @param {string} field
 * @param {string[]} errors
 * @returns {string[]}
 */
function asIdArray(list, field, errors) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) {
    errors.push(`${field} must be an array`)
    return []
  }
  return list.map((item) => asString(item)).filter(Boolean)
}

/**
 * Normalize and validate AnalyticalFindings against allowed provenance IDs.
 *
 * @param {unknown} raw
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
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateAnalyticalFindings(raw, bound) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['AnalyticalFindings must be a JSON object'] }
  }

  const themesRaw = Array.isArray(raw.themes) ? raw.themes : []
  const findingsRaw = Array.isArray(raw.findings) ? raw.findings : []
  const relationshipsRaw = Array.isArray(raw.relationships)
    ? raw.relationships
    : []
  const limitationsRaw = Array.isArray(raw.limitations) ? raw.limitations : []
  const gapsRaw = Array.isArray(raw.gaps) ? raw.gaps : []

  /**
   * Soft-filter: drop unknown refs; provenance must remain grounded after filter.
   *
   * @param {string[]} ids
   * @param {Set<string>} allowed
   * @returns {string[]}
   */
  function keepAllowed(ids, allowed) {
    return ids.filter((id) => allowed.has(id))
  }

  /**
   * Ensure paperIds include papers mapped from evidenceIds.
   *
   * @param {string[]} paperIds
   * @param {string[]} evidenceIds
   * @returns {string[]}
   */
  function withMappedPapers(paperIds, evidenceIds) {
    const merged = new Set(paperIds)
    const map = bound.evidenceIdToPaperId
    if (map) {
      for (const evidenceId of evidenceIds) {
        const paperId = map.get(evidenceId)
        if (paperId && bound.allowedPaperIds.has(paperId)) merged.add(paperId)
      }
    }
    return [...merged]
  }

  const themes = themesRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`themes[${index}] must be an object`)
      return null
    }
    const id = asString(item.id) || `THEME${index + 1}`
    const name = asString(item.name) || asString(item.label)
    const description = asString(item.description)
    if (!name) return null
    const evidenceIds = keepAllowed(
      asIdArray(item.evidenceIds, `themes[${index}].evidenceIds`, errors),
      bound.allowedEvidenceIds
    )
    const paperIds = withMappedPapers(
      keepAllowed(
        asIdArray(item.paperIds, `themes[${index}].paperIds`, errors),
        bound.allowedPaperIds
      ),
      evidenceIds
    )
    if (!paperIds.length && !evidenceIds.length) {
      return null
    }
    return { id, name, description, evidenceIds, paperIds }
  }).filter(Boolean)

  const findings = findingsRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`findings[${index}] must be an object`)
      return null
    }
    const id = asString(item.id) || `F${index + 1}`
    const statement = asString(item.statement)
    if (!statement) {
      return null
    }

    let type = asString(item.type).toUpperCase()
    if (!FINDING_TYPES.has(type)) {
      // tolerate lowercase / synonyms
      if (type === 'SUPPORT' || type === 'SUPPORTED_FINDING') type = 'SUPPORTED'
      else if (type === 'WEAK' || type === 'INSUFFICIENT') type = 'LIMITED'
      else if (type === 'INFERRED' || type === 'CROSS_PAPER') type = 'PATTERN'
    }
    if (!FINDING_TYPES.has(type)) {
      type = 'LIMITED'
    }

    let confidence = asString(item.confidence).toUpperCase()
    if (!CONFIDENCE.has(confidence)) confidence = 'LOW'
    // Preliminary only — never allow HIGH without strong type
    if (confidence === 'HIGH' && type !== 'SUPPORTED') {
      confidence = 'MEDIUM'
    }

    const evidenceIds = keepAllowed(
      asIdArray(item.evidenceIds, `findings[${index}].evidenceIds`, errors),
      bound.allowedEvidenceIds
    )
    const paperIds = withMappedPapers(
      keepAllowed(
        asIdArray(item.paperIds, `findings[${index}].paperIds`, errors),
        bound.allowedPaperIds
      ),
      evidenceIds
    )

    if (!paperIds.length && !evidenceIds.length) {
      return null
    }

    return {
      id,
      statement,
      type,
      evidenceIds,
      paperIds,
      confidence,
      note:
        'Analyst confidence is preliminary; Critic performs independent final assessment.',
    }
  }).filter(Boolean)

  const relationships = relationshipsRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`relationships[${index}] must be an object`)
      return null
    }
    const id = asString(item.id) || `R${index + 1}`
    const description = asString(item.description)
    if (!description) {
      return null
    }
    const sourcePaperIds = keepAllowed(
      asIdArray(
        item.sourcePaperIds || item.paperIds,
        `relationships[${index}].sourcePaperIds`,
        errors
      ),
      bound.allowedPaperIds
    )
    const graphNodeIds = asIdArray(
      item.graphNodeIds,
      `relationships[${index}].graphNodeIds`,
      errors
    ).filter((nid) => bound.allowedNodeIds.has(nid))
    const graphPathIds = asIdArray(
      item.graphPathIds,
      `relationships[${index}].graphPathIds`,
      errors
    ).filter((pid) => bound.allowedPathIds.has(pid))

    if (!sourcePaperIds.length && !graphNodeIds.length && !graphPathIds.length) {
      return null
    }

    return {
      id,
      description,
      sourcePaperIds,
      graphNodeIds,
      graphPathIds,
    }
  }).filter(Boolean)

  const limitations = limitationsRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return null
    }
    const id = asString(item.id) || `L${index + 1}`
    const description = asString(item.description)
    if (!description) {
      return null
    }
    const evidenceIds = asIdArray(
      item.evidenceIds,
      `limitations[${index}].evidenceIds`,
      errors
    ).filter((idValue) => bound.allowedEvidenceIds.has(idValue))
    return { id, description, evidenceIds }
  }).filter(Boolean)

  const gaps = gapsRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return null
    }
    const id = asString(item.id) || `G${index + 1}`
    const description = asString(item.description)
    if (!description) return null
    const evidenceIds = asIdArray(
      item.evidenceIds,
      `gaps[${index}].evidenceIds`,
      errors
    ).filter((idValue) => bound.allowedEvidenceIds.has(idValue))
    return { id, description, evidenceIds }
  }).filter(Boolean)

  // Require either findings/themes or explicit gaps for non-empty contexts
  if (
    bound.allowedPaperIds.size > 0 &&
    !findings.length &&
    !themes.length &&
    !gaps.length
  ) {
    errors.push(
      'Analysis must include findings/themes or gaps when evidence is present'
    )
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      runId: bound.runId,
      sessionId: bound.sessionId,
      researchQuestion: bound.researchQuestion,
      themes,
      findings,
      relationships,
      limitations,
      gaps,
      confidenceNote:
        'Analyst confidence values are preliminary. The Critic Agent performs the independent final confidence assessment.',
    },
  }
}

/**
 * Deterministic insufficient-evidence analysis (no LLM).
 *
 * @param {{ runId: string, sessionId: string, researchQuestion: string, evidencePackage: object }} args
 * @returns {object}
 */
export function buildInsufficientEvidenceAnalysis({
  runId,
  sessionId,
  researchQuestion,
  evidencePackage,
}) {
  const retrievalGaps = (evidencePackage?.evidenceGaps || []).map(
    (gap, index) => ({
      id: `G${index + 1}`,
      description: gap.message || gap.description || 'Retrieval-level evidence gap',
      evidenceIds: [],
    })
  )

  if (!retrievalGaps.length) {
    retrievalGaps.push({
      id: 'G1',
      description:
        'No recoverable literature evidence was available for cross-paper analysis.',
      evidenceIds: [],
    })
  }

  return {
    runId,
    sessionId,
    researchQuestion,
    themes: [],
    findings: [],
    relationships: [],
    limitations: [
      {
        id: 'L1',
        description:
          'Insufficient retrieved evidence to support cross-paper analytical findings.',
        evidenceIds: [],
      },
    ],
    gaps: retrievalGaps,
    confidenceNote:
      'Analyst confidence values are preliminary. The Critic Agent performs the independent final confidence assessment.',
  }
}

export default {
  validateEvidenceAnalystInput,
  validateAnalyticalFindings,
  buildInsufficientEvidenceAnalysis,
}
