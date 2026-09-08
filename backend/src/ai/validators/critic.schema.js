/**
 * @fileoverview Critic input/output schema validation.
 * CritiqueResult is the Critic's structured evaluation — final confidence owner.
 */
import mongoose from 'mongoose'
import { validateEvidencePackage } from './explorer.schema.js'
import { buildPackageEvidenceIndexes } from '../core/evidencePackageIndexes.js'
import { getCriticContextLimits } from '../agents/critic.context.js'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
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

const SUPPORT = new Set([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'INSUFFICIENT_EVIDENCE',
])
const CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW'])
const HANDLING = new Set(['USE_AS_IS', 'QUALIFY', 'EXCLUDE'])
const COVERAGE = new Set(['COVERED', 'PARTIAL', 'NOT_COVERED'])
const SUFFICIENCY = new Set(['SUFFICIENT', 'PARTIAL', 'INSUFFICIENT'])
const SEVERITY = new Set(['LOW', 'MEDIUM', 'HIGH'])
const FINDING_TYPES = new Set(['SUPPORTED', 'PATTERN', 'LIMITED'])

/**
 * Collect package-level ID indexes for provenance checks.
 *
 * @param {object} evidencePackage
 * @returns {{
 *   paperIds: Set<string>,
 *   evidenceIds: Set<string>,
 *   nodeIds: Set<string>,
 *   pathIds: Set<string>,
 *   evidenceIdToPaperId: Map<string, string>
 * }}
 */
export function buildEvidenceIndexes(evidencePackage) {
  const paperIds = new Set(
    (evidencePackage?.papers || []).map((p) => String(p.paperId)).filter(Boolean)
  )
  const nodeIds = new Set()
  const pathIds = new Set()
  for (const block of evidencePackage?.graphEvidence || []) {
    for (const node of block.nodes || []) {
      if (node?.id) nodeIds.add(String(node.id))
    }
    for (const path of block.paths || []) {
      if (path?.id) pathIds.add(String(path.id))
    }
    for (const paper of evidencePackage?.papers || []) {
      if (paper?.provenance?.nodeId) nodeIds.add(String(paper.provenance.nodeId))
    }
  }

  // Resolve evidence IDs from extracted full-text items when available.
  const rebuilt = buildPackageEvidenceIndexes(evidencePackage, {
    maxPapers: getCriticContextLimits().maxPapers,
  })

  return {
    paperIds,
    evidenceIds: rebuilt.allowedEvidenceIds,
    nodeIds: new Set([
      ...nodeIds,
      ...rebuilt.evidenceItems.map((i) => i.nodeId).filter(Boolean),
    ]),
    pathIds,
    evidenceIdToPaperId: rebuilt.evidenceIdToPaperId,
    evidenceItems: rebuilt.evidenceItems,
  }
}

/**
 * Validate AnalyticalFindings structure + provenance against an EvidencePackage.
 *
 * @param {unknown} raw
 * @param {object} evidencePackage
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateAnalyticalFindingsForCritic(raw, evidencePackage) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['analyticalFindings must be an object'] }
  }

  const indexes = buildEvidenceIndexes(evidencePackage)
  const findingsRaw = Array.isArray(raw.findings) ? raw.findings : null
  if (!findingsRaw) {
    return { ok: false, errors: ['analyticalFindings.findings must be an array'] }
  }

  const findings = []
  findingsRaw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`analyticalFindings.findings[${index}] must be an object`)
      return
    }
    const id = asString(item.id)
    const statement = asString(item.statement)
    if (!id) errors.push(`analyticalFindings.findings[${index}].id is required`)
    if (!statement) {
      errors.push(`analyticalFindings.findings[${index}].statement is required`)
    }

    let type = asString(item.type).toUpperCase()
    if (!FINDING_TYPES.has(type)) type = 'LIMITED'

    let confidence = asString(item.confidence).toUpperCase()
    if (!CONFIDENCE.has(confidence)) confidence = 'LOW'

    const paperIds = asIdArray(
      item.paperIds,
      `analyticalFindings.findings[${index}].paperIds`,
      errors
    )
    const evidenceIds = asIdArray(
      item.evidenceIds,
      `analyticalFindings.findings[${index}].evidenceIds`,
      errors
    )

    const validPaperIds = paperIds.filter((pid) => indexes.paperIds.has(pid))
    const invalidPapers = paperIds.filter((pid) => !indexes.paperIds.has(pid))
    for (const pid of invalidPapers) {
      errors.push(
        `analyticalFindings.findings[${index}] references unknown paperId "${pid}"`
      )
    }

    // Prefer known EV* ids; also accept evidenceIds that map via rebuilt Analyst context
    const validEvidenceIds = evidenceIds.filter((eid) =>
      indexes.evidenceIds.has(eid)
    )

    // Backfill papers from evidence ids when paperIds omitted
    const mappedPapers = new Set(validPaperIds)
    for (const eid of validEvidenceIds) {
      const mapped = indexes.evidenceIdToPaperId.get(eid)
      if (mapped && indexes.paperIds.has(mapped)) mappedPapers.add(mapped)
    }

    if (!mappedPapers.size && !validEvidenceIds.length) {
      errors.push(
        `analyticalFindings.findings[${index}] must reference at least one valid paperId or evidenceId`
      )
    }

    if (id && statement) {
      findings.push({
        id,
        statement,
        type,
        confidence,
        paperIds: [...mappedPapers],
        evidenceIds: validEvidenceIds,
        note: item.note || undefined,
      })
    }
  })

  const themes = (Array.isArray(raw.themes) ? raw.themes : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const id = asString(item.id) || `THEME${index + 1}`
      const name = asString(item.name) || asString(item.label)
      if (!name) return null
      const paperIds = asIdArray(item.paperIds, `themes[${index}].paperIds`, errors).filter(
        (pid) => indexes.paperIds.has(pid)
      )
      const evidenceIds = asIdArray(
        item.evidenceIds,
        `themes[${index}].evidenceIds`,
        errors
      ).filter((eid) => indexes.evidenceIds.has(eid))
      return {
        id,
        name,
        description: asString(item.description),
        paperIds,
        evidenceIds,
      }
    })
    .filter(Boolean)

  const relationships = (Array.isArray(raw.relationships) ? raw.relationships : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const id = asString(item.id) || `R${index + 1}`
      const description = asString(item.description)
      if (!description) return null
      return {
        id,
        description,
        sourcePaperIds: asIdArray(
          item.sourcePaperIds || item.paperIds,
          `relationships[${index}].sourcePaperIds`,
          errors
        ).filter((pid) => indexes.paperIds.has(pid)),
        graphNodeIds: asIdArray(
          item.graphNodeIds,
          `relationships[${index}].graphNodeIds`,
          errors
        ).filter((nid) => indexes.nodeIds.has(nid)),
        graphPathIds: asIdArray(
          item.graphPathIds,
          `relationships[${index}].graphPathIds`,
          errors
        ).filter((pid) => indexes.pathIds.has(pid)),
      }
    })
    .filter(Boolean)

  const gaps = (Array.isArray(raw.gaps) ? raw.gaps : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const description = asString(item.description)
      if (!description) return null
      return {
        id: asString(item.id) || `G${index + 1}`,
        description,
        evidenceIds: asIdArray(
          item.evidenceIds,
          `gaps[${index}].evidenceIds`,
          errors
        ).filter((eid) => indexes.evidenceIds.has(eid)),
      }
    })
    .filter(Boolean)

  const limitations = (Array.isArray(raw.limitations) ? raw.limitations : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const description = asString(item.description)
      if (!description) return null
      return {
        id: asString(item.id) || `L${index + 1}`,
        description,
        evidenceIds: asIdArray(
          item.evidenceIds,
          `limitations[${index}].evidenceIds`,
          errors
        ).filter((eid) => indexes.evidenceIds.has(eid)),
      }
    })
    .filter(Boolean)

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      runId: asString(raw.runId) || null,
      sessionId: asString(raw.sessionId) || null,
      researchQuestion: asString(raw.researchQuestion) || '',
      themes,
      findings,
      relationships,
      limitations,
      gaps,
      confidenceNote: asString(raw.confidenceNote) || '',
      _indexes: indexes,
    },
  }
}

/**
 * Validate Critic service/HTTP input.
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateCriticInput(input = {}) {
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

  if (errors.length) return { ok: false, errors }

  const findingsResult = validateAnalyticalFindingsForCritic(
    input.analyticalFindings,
    packageResult.value
  )
  if (!findingsResult.ok) {
    return { ok: false, errors: findingsResult.errors }
  }

  if (
    findingsResult.value.sessionId &&
    String(findingsResult.value.sessionId) !== sessionId
  ) {
    return {
      ok: false,
      errors: ['analyticalFindings.sessionId must match sessionId'],
    }
  }

  return {
    ok: true,
    value: {
      sessionId,
      query,
      evidencePackage: packageResult.value,
      analyticalFindings: findingsResult.value,
    },
  }
}

/**
 * Normalize/validate CritiqueResult against known finding + evidence IDs.
 *
 * @param {unknown} raw
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   researchQuestion: string,
 *   findingIds: Set<string>,
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>
 * }} bound
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateCritiqueResult(raw, bound) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['CritiqueResult must be a JSON object'] }
  }

  const evalsRaw = Array.isArray(raw.findingEvaluations)
    ? raw.findingEvaluations
    : []
  const contradictionsRaw = Array.isArray(raw.contradictions)
    ? raw.contradictions
    : []
  const coverageRaw = Array.isArray(raw.evidenceCoverage)
    ? raw.evidenceCoverage
    : []
  const gapsRaw = Array.isArray(raw.gaps) ? raw.gaps : []
  const overallRaw =
    raw.overallAssessment && typeof raw.overallAssessment === 'object'
      ? raw.overallAssessment
      : null

  if (!overallRaw) {
    errors.push('overallAssessment is required')
  }

  /**
   * @param {string[]} ids
   * @param {Set<string>} allowed
   * @returns {string[]}
   */
  function keepAllowed(ids, allowed) {
    return ids.filter((id) => allowed.has(id))
  }

  /**
   * @param {string} value
   * @param {Set<string>} allowed
   * @param {string} fallback
   */
  function normalizeEnum(value, allowed, fallback) {
    const upper = asString(value).toUpperCase()
    if (allowed.has(upper)) return upper
    // tolerate synonyms
    if (upper === 'PARTIAL_SUPPORT' || upper === 'PARTIAL') {
      if (allowed.has('PARTIALLY_SUPPORTED')) return 'PARTIALLY_SUPPORTED'
      if (allowed.has('PARTIAL')) return 'PARTIAL'
    }
    if (upper === 'NOT_SUPPORTED' || upper === 'FALSE') {
      if (allowed.has('UNSUPPORTED')) return 'UNSUPPORTED'
    }
    if (upper === 'WEAK') {
      if (allowed.has('INSUFFICIENT_EVIDENCE')) return 'INSUFFICIENT_EVIDENCE'
      if (allowed.has('LOW')) return 'LOW'
    }
    return fallback
  }

  const evaluatedIds = new Set()
  const findingEvaluations = evalsRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        errors.push(`findingEvaluations[${index}] must be an object`)
        return null
      }
      const findingId = asString(item.findingId)
      if (!findingId) {
        errors.push(`findingEvaluations[${index}].findingId is required`)
        return null
      }
      if (!bound.findingIds.has(findingId)) {
        // Drop evaluations for unknown findings (soft)
        return null
      }
      evaluatedIds.add(findingId)

      let support = normalizeEnum(
        item.support || item.supportLevel,
        SUPPORT,
        'INSUFFICIENT_EVIDENCE'
      )
      // Map boolean supported if LLM used older shape
      if (!item.support && typeof item.supported === 'boolean') {
        support = item.supported ? 'SUPPORTED' : 'UNSUPPORTED'
      }

      let confidence = normalizeEnum(item.confidence, CONFIDENCE, 'LOW')
      // Critic final rules: HIGH only with SUPPORTED
      if (confidence === 'HIGH' && support !== 'SUPPORTED') {
        confidence = 'MEDIUM'
      }
      if (
        support === 'UNSUPPORTED' ||
        support === 'INSUFFICIENT_EVIDENCE'
      ) {
        if (confidence === 'HIGH') confidence = 'LOW'
        if (confidence === 'MEDIUM' && support === 'UNSUPPORTED') {
          confidence = 'LOW'
        }
      }

      let recommendedHandling = normalizeEnum(
        item.recommendedHandling,
        HANDLING,
        'QUALIFY'
      )
      if (support === 'SUPPORTED' && !item.recommendedHandling) {
        recommendedHandling = 'USE_AS_IS'
      }
      if (
        (support === 'UNSUPPORTED' || support === 'INSUFFICIENT_EVIDENCE') &&
        !item.recommendedHandling
      ) {
        recommendedHandling = 'EXCLUDE'
      }
      if (support === 'PARTIALLY_SUPPORTED' && !item.recommendedHandling) {
        recommendedHandling = 'QUALIFY'
      }

      const evidenceIds = keepAllowed(
        asIdArray(
          item.evidenceIds,
          `findingEvaluations[${index}].evidenceIds`,
          errors
        ),
        bound.allowedEvidenceIds
      )
      const paperIds = keepAllowed(
        asIdArray(
          item.paperIds,
          `findingEvaluations[${index}].paperIds`,
          errors
        ),
        bound.allowedPaperIds
      )

      const issues = Array.isArray(item.issues)
        ? item.issues.map((issue) => asString(issue)).filter(Boolean).slice(0, 8)
        : []

      return {
        findingId,
        support,
        confidence,
        evidenceIds,
        paperIds,
        evidenceAssessment: asString(item.evidenceAssessment).slice(0, 600),
        issues,
        recommendedHandling,
        // Preserve original finding reference — Critic does not rewrite
        originalFindingPreserved: true,
        saferInterpretation: asString(item.saferInterpretation || item.recommendedInterpretation).slice(
          0,
          600
        ),
      }
    })
    .filter(Boolean)

  // Ensure every input finding has an evaluation (fill missing deterministically)
  for (const findingId of bound.findingIds) {
    if (evaluatedIds.has(findingId)) continue
    findingEvaluations.push({
      findingId,
      support: 'INSUFFICIENT_EVIDENCE',
      confidence: 'LOW',
      evidenceIds: [],
      paperIds: [],
      evidenceAssessment:
        'No structured evaluation was returned for this finding.',
      issues: ['Missing critic evaluation for this finding'],
      recommendedHandling: 'EXCLUDE',
      originalFindingPreserved: true,
      saferInterpretation: '',
    })
  }

  const contradictions = contradictionsRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const description = asString(item.description)
      if (!description) return null
      const findingIds = asIdArray(
        item.findingIds,
        `contradictions[${index}].findingIds`,
        errors
      ).filter((id) => bound.findingIds.has(id))
      const paperIds = keepAllowed(
        asIdArray(item.paperIds, `contradictions[${index}].paperIds`, errors),
        bound.allowedPaperIds
      )
      const evidenceIds = keepAllowed(
        asIdArray(
          item.evidenceIds,
          `contradictions[${index}].evidenceIds`,
          errors
        ),
        bound.allowedEvidenceIds
      )
      // Require conflicting evidence provenance
      if (paperIds.length + evidenceIds.length < 2 && findingIds.length < 1) {
        return null
      }
      return {
        id: asString(item.id) || `C${index + 1}`,
        description,
        findingIds,
        paperIds,
        evidenceIds,
        severity: normalizeEnum(item.severity, SEVERITY, 'LOW'),
      }
    })
    .filter(Boolean)

  const evidenceCoverage = coverageRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const requirement = asString(item.requirement)
      if (!requirement) return null
      return {
        requirement,
        status: normalizeEnum(item.status, COVERAGE, 'NOT_COVERED'),
        evidenceIds: keepAllowed(
          asIdArray(
            item.evidenceIds,
            `evidenceCoverage[${index}].evidenceIds`,
            errors
          ),
          bound.allowedEvidenceIds
        ),
        paperIds: keepAllowed(
          asIdArray(
            item.paperIds,
            `evidenceCoverage[${index}].paperIds`,
            errors
          ),
          bound.allowedPaperIds
        ),
        notes: asString(item.notes).slice(0, 400),
      }
    })
    .filter(Boolean)

  const gaps = gapsRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const description = asString(item.description)
      if (!description) return null
      return {
        id: asString(item.id) || `G${index + 1}`,
        description,
        evidenceIds: keepAllowed(
          asIdArray(item.evidenceIds, `gaps[${index}].evidenceIds`, errors),
          bound.allowedEvidenceIds
        ),
        severity: normalizeEnum(item.severity, SEVERITY, 'MEDIUM'),
      }
    })
    .filter(Boolean)

  let overallAssessment = {
    confidence: 'LOW',
    evidenceSufficiency: 'INSUFFICIENT',
    notes: '',
  }
  if (overallRaw) {
    overallAssessment = {
      confidence: normalizeEnum(
        overallRaw.confidence,
        CONFIDENCE,
        'LOW'
      ),
      evidenceSufficiency: normalizeEnum(
        overallRaw.evidenceSufficiency,
        SUFFICIENCY,
        'INSUFFICIENT'
      ),
      notes: asString(overallRaw.notes).slice(0, 800),
    }
    // Block unjustified overall HIGH
    const hasUnsupported = findingEvaluations.some(
      (e) =>
        e.support === 'UNSUPPORTED' || e.support === 'INSUFFICIENT_EVIDENCE'
    )
    const supportedCount = findingEvaluations.filter(
      (e) => e.support === 'SUPPORTED'
    ).length
    if (
      overallAssessment.confidence === 'HIGH' &&
      (hasUnsupported || supportedCount === 0)
    ) {
      overallAssessment.confidence = 'MEDIUM'
    }
    if (
      overallAssessment.evidenceSufficiency === 'SUFFICIENT' &&
      findingEvaluations.length === 0
    ) {
      overallAssessment.evidenceSufficiency = 'INSUFFICIENT'
      overallAssessment.confidence = 'LOW'
    }
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      runId: bound.runId,
      sessionId: bound.sessionId,
      researchQuestion: bound.researchQuestion,
      findingEvaluations,
      contradictions,
      evidenceCoverage,
      gaps,
      overallAssessment,
      confidenceNote:
        'Critic confidence values are FINAL for TRACE claim validation. Analyst confidence was preliminary only.',
    },
  }
}

/**
 * Deterministic critique when there are no findings / no evidence.
 *
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   researchQuestion: string,
 *   analyticalFindings?: object,
 *   evidencePackage?: object
 * }} args
 * @returns {object}
 */
export function buildEmptyCritique({
  runId,
  sessionId,
  researchQuestion,
  analyticalFindings,
  evidencePackage,
}) {
  const requirements =
    evidencePackage?.planSummary?.evidenceRequirements ||
    analyticalFindings?.evidenceRequirements ||
    []

  const evidenceCoverage = (Array.isArray(requirements) ? requirements : []).map(
    (requirement) => ({
      requirement: String(requirement),
      status: 'NOT_COVERED',
      evidenceIds: [],
      paperIds: [],
      notes: 'No analytical findings were available for coverage assessment.',
    })
  )

  const gaps = (analyticalFindings?.gaps || []).map((gap, index) => ({
    id: gap.id || `G${index + 1}`,
    description: gap.description || 'Evidence gap reported by Evidence Analyst.',
    evidenceIds: gap.evidenceIds || [],
    severity: 'HIGH',
  }))

  if (!gaps.length) {
    gaps.push({
      id: 'G1',
      description:
        'Insufficient evidence was retrieved to assess the research question reliably.',
      evidenceIds: [],
      severity: 'HIGH',
    })
  }

  return {
    runId,
    sessionId,
    researchQuestion,
    findingEvaluations: [],
    contradictions: [],
    evidenceCoverage,
    gaps,
    overallAssessment: {
      confidence: 'LOW',
      evidenceSufficiency: 'INSUFFICIENT',
      notes:
        'No findings were available for claim validation. Critic did not fabricate evaluations.',
    },
    confidenceNote:
      'Critic confidence values are FINAL for TRACE claim validation. Analyst confidence was preliminary only.',
  }
}

export default {
  validateCriticInput,
  validateAnalyticalFindingsForCritic,
  validateCritiqueResult,
  buildEmptyCritique,
  buildEvidenceIndexes,
}
