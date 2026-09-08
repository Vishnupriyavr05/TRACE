/**
 * @fileoverview Synthesizer input/output schema validation.
 * Enforces Critic USE_AS_IS | QUALIFY | EXCLUDE and ResearchReport mapping.
 */
import mongoose from 'mongoose'
import { validatePlannerOutput } from './planner.schema.js'
import { validateEvidencePackage } from './explorer.schema.js'
import {
  validateAnalyticalFindingsForCritic,
  buildEvidenceIndexes,
} from './critic.schema.js'
import {
  buildFinalEvidenceRegistryFromSynthesis,
  inferEvidenceAvailability,
  normalizeEvidenceItem,
} from '../core/finalEvidenceRegistry.js'
import { buildMethodologyReviewFromRegistry } from '../core/methodologyReview.js'
import { computeEvidenceAwareConfidence } from '../core/researchSufficiencyGate.js'
import {
  formatEvidenceTargetGapDescriptions,
  isGenericEvidenceGapPhrase,
  resolveContradictionStatements,
  resolveEvidenceMatrixCoverage,
} from '../core/evidenceTargets.js'
import {
  applyEvidenceChainToSynthesis,
  buildEvidenceChainGapAnalysis,
  qualifyAbsenceClaim,
} from '../core/evidenceChain.js'
import { applySynthesisQualityGates } from '../core/synthesisQuality.js'
import {
  applyFinalOutputGuard,
  sanitizeMethodologyReview,
} from '../core/finalOutputGuard.js'

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

const CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW'])
const HANDLING = new Set(['USE_AS_IS', 'QUALIFY', 'EXCLUDE'])
const SUPPORT = new Set([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'INSUFFICIENT_EVIDENCE',
])
const CONFIDENCE_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 }

/**
 * @param {string} label
 * @returns {number}
 */
export function confidenceLabelToScore(label) {
  const upper = asString(label).toUpperCase()
  if (upper === 'HIGH') return 85
  if (upper === 'MEDIUM') return 55
  return 25
}

/**
 * Cap confidence so it never exceeds Critic ceiling.
 *
 * @param {string} proposed
 * @param {string} ceiling
 * @returns {string}
 */
export function capConfidence(proposed, ceiling) {
  const p = CONFIDENCE.has(asString(proposed).toUpperCase())
    ? asString(proposed).toUpperCase()
    : 'LOW'
  const c = CONFIDENCE.has(asString(ceiling).toUpperCase())
    ? asString(ceiling).toUpperCase()
    : 'LOW'
  return CONFIDENCE_RANK[p] <= CONFIDENCE_RANK[c] ? p : c
}

/**
 * Validate CritiqueResult structure for Synthesizer input.
 *
 * @param {unknown} raw
 * @param {{ findingIds: Set<string>, paperIds: Set<string> }} bound
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateCritiqueResultForSynthesizer(raw, bound) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['critiqueResult must be an object'] }
  }

  const evalsRaw = Array.isArray(raw.findingEvaluations)
    ? raw.findingEvaluations
    : null
  if (!evalsRaw) {
    return {
      ok: false,
      errors: ['critiqueResult.findingEvaluations must be an array'],
    }
  }

  const findingEvaluations = []
  const evaluatedIds = new Set()

  evalsRaw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`critiqueResult.findingEvaluations[${index}] must be an object`)
      return
    }
    const findingId = asString(item.findingId)
    if (!findingId) {
      errors.push(
        `critiqueResult.findingEvaluations[${index}].findingId is required`
      )
      return
    }
    if (!bound.findingIds.has(findingId)) {
      errors.push(
        `critiqueResult.findingEvaluations[${index}] references unknown findingId "${findingId}"`
      )
      return
    }
    evaluatedIds.add(findingId)

    let support = asString(item.support).toUpperCase()
    if (!SUPPORT.has(support)) support = 'INSUFFICIENT_EVIDENCE'

    let confidence = asString(item.confidence).toUpperCase()
    if (!CONFIDENCE.has(confidence)) confidence = 'LOW'

    let recommendedHandling = asString(item.recommendedHandling).toUpperCase()
    if (!HANDLING.has(recommendedHandling)) {
      if (support === 'SUPPORTED') recommendedHandling = 'USE_AS_IS'
      else if (support === 'PARTIALLY_SUPPORTED') recommendedHandling = 'QUALIFY'
      else recommendedHandling = 'EXCLUDE'
    }

    const paperIds = asIdArray(
      item.paperIds,
      `critiqueResult.findingEvaluations[${index}].paperIds`,
      errors
    ).filter((id) => bound.paperIds.has(id))

    const evidenceIds = asIdArray(
      item.evidenceIds,
      `critiqueResult.findingEvaluations[${index}].evidenceIds`,
      errors
    )

    findingEvaluations.push({
      findingId,
      support,
      confidence,
      evidenceIds,
      paperIds,
      evidenceAssessment: asString(item.evidenceAssessment),
      issues: Array.isArray(item.issues)
        ? item.issues.map((i) => asString(i)).filter(Boolean)
        : [],
      recommendedHandling,
      saferInterpretation: asString(item.saferInterpretation),
    })
  })

  // Critic must cover every finding when findings exist
  for (const findingId of bound.findingIds) {
    if (!evaluatedIds.has(findingId)) {
      errors.push(
        `critiqueResult missing evaluation for findingId "${findingId}"`
      )
    }
  }

  const overall =
    raw.overallAssessment && typeof raw.overallAssessment === 'object'
      ? raw.overallAssessment
      : null
  if (!overall) {
    errors.push('critiqueResult.overallAssessment is required')
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      runId: asString(raw.runId) || null,
      sessionId: asString(raw.sessionId) || null,
      researchQuestion: asString(raw.researchQuestion) || '',
      findingEvaluations,
      contradictions: Array.isArray(raw.contradictions)
        ? raw.contradictions
        : [],
      evidenceCoverage: Array.isArray(raw.evidenceCoverage)
        ? raw.evidenceCoverage
        : [],
      gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
      overallAssessment: {
        confidence: CONFIDENCE.has(asString(overall.confidence).toUpperCase())
          ? asString(overall.confidence).toUpperCase()
          : 'LOW',
        evidenceSufficiency: asString(overall.evidenceSufficiency).toUpperCase() ||
          'INSUFFICIENT',
        notes: asString(overall.notes),
      },
      confidenceNote: asString(raw.confidenceNote),
    },
  }
}

/**
 * Validate Synthesizer HTTP/service input (all four artifacts).
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateSynthesizerInput(input = {}) {
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

  const planResult = validatePlannerOutput(
    input.researchPlan || input.plan || {}
  )
  if (!planResult.ok) {
    for (const err of planResult.errors || []) {
      errors.push(`researchPlan.${err}`)
    }
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
    return {
      ok: false,
      errors: (findingsResult.errors || []).map((e) =>
        e.startsWith('analyticalFindings') ? e : `analyticalFindings.${e}`
      ),
    }
  }

  const findingIds = new Set(
    (findingsResult.value.findings || []).map((f) => String(f.id))
  )
  const paperIds = new Set(
    (packageResult.value.papers || []).map((p) => String(p.paperId))
  )

  const critiqueResult = validateCritiqueResultForSynthesizer(
    input.critiqueResult || input.critique,
    { findingIds, paperIds }
  )
  if (!critiqueResult.ok) {
    return { ok: false, errors: critiqueResult.errors }
  }

  // Empty findings allowed only with empty/insufficient critique coverage
  if (
    findingIds.size === 0 &&
    critiqueResult.value.findingEvaluations.length > 0
  ) {
    return {
      ok: false,
      errors: ['critiqueResult cannot evaluate findings that do not exist'],
    }
  }

  return {
    ok: true,
    value: {
      sessionId,
      query,
      researchPlan: planResult.value,
      evidencePackage: packageResult.value,
      analyticalFindings: findingsResult.value,
      critiqueResult: critiqueResult.value,
    },
  }
}

/**
 * Build includable / excluded finding sets from Critic decisions.
 *
 * @param {object} analyticalFindings
 * @param {object} critiqueResult
 * @returns {{
 *   includable: object[],
 *   excluded: object[],
 *   byHandling: { USE_AS_IS: object[], QUALIFY: object[], EXCLUDE: object[] }
 * }}
 */
export function partitionFindingsByCritic(
  analyticalFindings,
  critiqueResult
) {
  const findingById = new Map(
    (analyticalFindings?.findings || []).map((f) => [String(f.id), f])
  )
  const evalById = new Map(
    (critiqueResult?.findingEvaluations || []).map((e) => [
      String(e.findingId),
      e,
    ])
  )

  /** @type {{ USE_AS_IS: object[], QUALIFY: object[], EXCLUDE: object[] }} */
  const byHandling = { USE_AS_IS: [], QUALIFY: [], EXCLUDE: [] }
  /** @type {object[]} */
  const includable = []
  /** @type {object[]} */
  const excluded = []

  for (const [findingId, finding] of findingById) {
    const evaluation = evalById.get(findingId)
    const handling = evaluation?.recommendedHandling || 'EXCLUDE'
    const entry = {
      ...finding,
      critic: evaluation || {
        findingId,
        support: 'INSUFFICIENT_EVIDENCE',
        confidence: 'LOW',
        recommendedHandling: 'EXCLUDE',
        saferInterpretation: '',
        issues: ['Missing critic evaluation'],
      },
    }
    if (handling === 'EXCLUDE') {
      excluded.push(entry)
      byHandling.EXCLUDE.push(entry)
    } else if (handling === 'QUALIFY') {
      includable.push(entry)
      byHandling.QUALIFY.push(entry)
    } else {
      includable.push(entry)
      byHandling.USE_AS_IS.push(entry)
    }
  }

  return { includable, excluded, byHandling }
}

/**
 * @param {object|null|undefined} critiqueResult
 * @returns {string[]}
 */
export function extractCriticGapDescriptions(critiqueResult, evidencePackage, researchQuestion) {
  const criticGaps = (critiqueResult?.gaps || [])
    .map((item) => {
      if (typeof item === 'string') return asString(item)
      if (item && typeof item === 'object') {
        return asString(item.description || item.statement || item.text)
      }
      return ''
    })
    .filter(Boolean)

  const coverageGaps =
    evidencePackage && researchQuestion
      ? formatEvidenceTargetGapDescriptions(
          resolveEvidenceMatrixCoverage({
            evidencePackage,
            researchQuestion,
          }),
          { maxItems: 6 },
        )
      : []

  if (!criticGaps.length) return coverageGaps
  if (!coverageGaps.length) return criticGaps

  const merged = [...criticGaps]
  for (const gap of coverageGaps) {
    if (!merged.some((row) => row.toLowerCase() === gap.toLowerCase())) {
      merged.push(gap)
    }
  }
  return merged
}

/**
 * Deterministically rebuild supporting evidence from findings + references.
 *
 * @param {object[]} structuredFindings
 * @param {Map<string, object>} refByPaper
 * @param {{
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>,
 *   papersById: Map<string, object>,
 *   evidenceIdToPaperId?: Map<string, string>
 * }} bound
 * @returns {object[]}
 */
export function reconstructSupportingEvidence(
  structuredFindings,
  refByPaper,
  bound,
) {
  /** @type {Map<string, object>} */
  const byKey = new Map()

  /**
   * @param {string|null|undefined} evidenceId
   * @param {string} paperId
   * @param {string} [role]
   */
  function addEntry(evidenceId, paperId, role = 'supporting') {
    if (!paperId || !bound.allowedPaperIds.has(paperId)) return
    const paper = bound.papersById.get(paperId)
    if (!paper) return
    const key = evidenceId ? String(evidenceId) : `paper:${paperId}`
    if (byKey.has(key)) return
    const availability = inferEvidenceAvailability(paper)
    byKey.set(key, {
      evidenceId: evidenceId || null,
      paperId,
      role,
      citation: buildCitation(paper) || `Paper ${paperId}`,
      sourceType: availability.sourceType,
      availability: availability.availability,
    })
  }

  for (const ref of refByPaper.values()) {
    const evidenceIds = ref.evidenceIds || []
    if (evidenceIds.length) {
      for (const evidenceId of evidenceIds) {
        if (!bound.allowedEvidenceIds.has(evidenceId)) continue
        const mapped = bound.evidenceIdToPaperId?.get(evidenceId)
        addEntry(evidenceId, mapped || ref.paperId)
      }
    } else {
      addEntry(null, ref.paperId)
    }
  }

  for (const finding of structuredFindings) {
    for (const evidenceId of finding.evidenceIds || []) {
      if (!bound.allowedEvidenceIds.has(evidenceId)) continue
      const paperId = bound.evidenceIdToPaperId?.get(evidenceId)
      if (paperId) addEntry(evidenceId, paperId)
    }
    for (const paperId of finding.paperIds || []) {
      addEntry(null, paperId)
    }
  }

  return [...byKey.values()]
}

/**
 * Validate LLM synthesis output and map toward ResearchReport fields.
 *
 * @param {unknown} raw
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   researchQuestion: string,
 *   researchPlanObjective?: string,
 *   criticGapDescriptions?: string[],
 *   targetGapDescriptions?: string[],
 *   criticContradictions?: object[],
 *   evidenceChain?: object,
 *   allowedFindingIds: Set<string>,
 *   excludedFindingIds: Set<string>,
 *   qualifyFindingIds: Set<string>,
 *   criticConfidenceByFinding: Map<string, string>,
 *   overallCriticConfidence: string,
 *   overallSufficiency: string,
 *   allowedPaperIds: Set<string>,
 *   papersById: Map<string, object>,
 *   allowedEvidenceIds: Set<string>,
 *   evidenceIdToPaperId?: Map<string, string>
 * }} bound
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateSynthesizerOutput(raw, bound) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Synthesizer output must be a JSON object'] }
  }

  const summary = asString(raw.summary || raw.executiveSummary)
  const objective =
    asString(raw.objective || raw.researchObjective) ||
    asString(bound.researchPlanObjective)
  if (!summary) errors.push('summary is required')
  if (!objective) errors.push('objective is required (from plan when omitted by LLM)')

  const findingsRaw = Array.isArray(raw.findings) ? raw.findings : []
  const structuredFindings = []

  findingsRaw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`findings[${index}] must be an object`)
      return
    }
    const id = asString(item.id || item.findingId)
    if (!id) {
      errors.push(`findings[${index}].id is required`)
      return
    }
    if (bound.excludedFindingIds.has(id)) {
      errors.push(
        `findings[${index}] uses EXCLUDE finding "${id}" as a conclusion`
      )
      return
    }
    if (!bound.allowedFindingIds.has(id)) {
      errors.push(`findings[${index}] references unknown/disallowed finding "${id}"`)
      return
    }

    let handling = asString(item.handling).toUpperCase()
    if (bound.qualifyFindingIds.has(id)) handling = 'QUALIFY'
    if (!handling || handling === 'EXCLUDE') {
      handling = bound.qualifyFindingIds.has(id) ? 'QUALIFY' : 'USE_AS_IS'
    }
    if (handling !== 'USE_AS_IS' && handling !== 'QUALIFY') {
      errors.push(`findings[${index}].handling must be USE_AS_IS or QUALIFY`)
      return
    }

    const ceiling = bound.criticConfidenceByFinding.get(id) || 'LOW'
    const confidence = capConfidence(item.confidence, ceiling)

    const paperIds = asIdArray(
      item.paperIds,
      `findings[${index}].paperIds`,
      errors
    ).filter((pid) => bound.allowedPaperIds.has(pid))
    const evidenceIds = asIdArray(
      item.evidenceIds,
      `findings[${index}].evidenceIds`,
      errors
    ).filter((eid) => bound.allowedEvidenceIds.has(eid))

    const statement = asString(item.statement)
    if (!statement) {
      errors.push(`findings[${index}].statement is required`)
      return
    }

    structuredFindings.push({
      id,
      statement,
      confidence,
      handling,
      evidenceIds,
      paperIds,
    })
  })

  // Detect fabricated finding IDs already covered; require at least 0 findings OK
  if (
    bound.allowedFindingIds.size > 0 &&
    structuredFindings.length === 0 &&
    bound.overallSufficiency !== 'INSUFFICIENT'
  ) {
    // Soft: if Critic has includable findings, report should include at least one
    // Allow empty only when all excluded
  }

  const evidenceRaw = Array.isArray(raw.evidence) ? raw.evidence : []
  const llmEvidence = evidenceRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const paperId = asString(item.paperId)
      if (!paperId || !bound.allowedPaperIds.has(paperId)) return null
      const paper = bound.papersById.get(paperId)
      if (!paper) return null
      const evidenceId = asString(item.evidenceId)
      if (evidenceId && !bound.allowedEvidenceIds.has(evidenceId)) return null
      return normalizeEvidenceItem(
        {
          evidenceId: evidenceId || null,
          paperId,
          role: asString(item.role) || 'supporting',
          citation:
            asString(item.citation) ||
            buildCitation(paper) ||
            `Paper ${paperId}`,
        },
        paper,
      )
    })
    .filter(Boolean)

  const contradictions = (
    Array.isArray(raw.contradictions) ? raw.contradictions : []
  )
    .map((item) => {
      if (typeof item === 'string') return asString(item)
      if (item && typeof item === 'object') {
        return asString(item.description || item.statement || item.text)
      }
      return ''
    })
    .filter(Boolean)

  let resolvedContradictions = contradictions
  if (!resolvedContradictions.length) {
    resolvedContradictions = resolveContradictionStatements(
      {
        contradictions: bound.criticContradictions || [],
        overallAssessment: {
          evidenceSufficiency: bound.overallSufficiency,
        },
      },
      {
        relevantCount: bound.evidenceMatrixRelevantCount || 0,
        findingCount: bound.allowedFindingIds?.size || 0,
      },
    )
  }

  const gaps = (Array.isArray(raw.gaps) ? raw.gaps : [])
    .map((item) => {
      if (typeof item === 'string') return asString(item)
      if (item && typeof item === 'object') {
        return asString(item.description || item.statement || item.text)
      }
      return ''
    })
    .filter(Boolean)

  const criticGaps = (bound.criticGapDescriptions || [])
    .map((item) => asString(item))
    .filter(Boolean)
  const targetGaps = (bound.targetGapDescriptions || [])
    .map((item) => asString(item))
    .filter(Boolean)
  let resolvedGaps = gaps.length ? gaps : criticGaps
  if (!resolvedGaps.length || resolvedGaps.every(isGenericEvidenceGapPhrase)) {
    resolvedGaps = targetGaps.length ? targetGaps : resolvedGaps
  } else if (targetGaps.length) {
    for (const gap of targetGaps) {
      if (!resolvedGaps.some((row) => row.toLowerCase() === gap.toLowerCase())) {
        resolvedGaps.push(gap)
      }
    }
  }

  const limitations = asString(raw.limitations || raw.evidenceLimitations)
  if (
    (bound.overallSufficiency === 'INSUFFICIENT' ||
      bound.overallSufficiency === 'PARTIAL') &&
    !limitations &&
    resolvedGaps.length === 0
  ) {
    errors.push(
      'limitations or gaps required when Critic reports insufficient/partial evidence'
    )
  }

  let overallLabel = asString(raw.confidence?.overall || raw.overallConfidence).toUpperCase()
  if (!CONFIDENCE.has(overallLabel)) {
    overallLabel = bound.overallCriticConfidence || 'LOW'
  }
  overallLabel = capConfidence(overallLabel, bound.overallCriticConfidence || 'LOW')
  const basis = asString(
    raw.confidence?.basis || raw.confidenceBasis || ''
  )

  const referencesRaw = Array.isArray(raw.references) ? raw.references : []
  /** @type {Map<string, object>} */
  const refByPaper = new Map()
  referencesRaw.forEach((item, index) => {
    if (typeof item === 'string') {
      // citation-only — try match later; skip if no paperId
      return
    }
    if (!item || typeof item !== 'object') {
      errors.push(`references[${index}] must be an object or string`)
      return
    }
    const paperId = asString(item.paperId)
    if (!paperId || !bound.allowedPaperIds.has(paperId)) {
      // drop unknown — do not invent
      return
    }
    if (refByPaper.has(paperId)) return
    const paper = bound.papersById.get(paperId)
    if (!paper) {
      errors.push(
        `references[${index}] paperId "${paperId}" has no resolvable metadata`
      )
      return
    }
    refByPaper.set(paperId, {
      paperId,
      citation: asString(item.citation) || buildCitation(paper),
      evidenceIds: asIdArray(
        item.evidenceIds,
        `references[${index}].evidenceIds`,
        errors
      ).filter((eid) => bound.allowedEvidenceIds.has(eid)),
      source: paper?.source || paper?.provenance?.source || null,
      providers: paper?.provenance?.providers || [],
      title: paper?.title || null,
      year: paper?.year ?? null,
    })
  })

  // Ensure every paper cited by included findings is in references
  for (const finding of structuredFindings) {
    for (const paperId of finding.paperIds || []) {
      if (refByPaper.has(paperId)) continue
      const paper = bound.papersById.get(paperId)
      if (!paper) {
        errors.push(
          `findings reference unknown paperId "${paperId}" with no resolvable metadata`
        )
        continue
      }
      refByPaper.set(paperId, {
        paperId,
        citation: buildCitation(paper),
        evidenceIds: (finding.evidenceIds || []).filter((eid) =>
          bound.allowedEvidenceIds.has(eid)
        ),
        source: paper.source || paper.provenance?.source || null,
        providers: paper.provenance?.providers || [],
        title: paper.title || null,
        year: paper.year ?? null,
      })
    }
  }

  const recommendations = (
    Array.isArray(raw.recommendations) ? raw.recommendations : []
  )
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 3)

  if (errors.length) return { ok: false, errors }

  const structuredReferences = [...refByPaper.values()]
  const supportingEvidence = llmEvidence.length
    ? llmEvidence
    : reconstructSupportingEvidence(
        structuredFindings,
        refByPaper,
        bound,
      )

  let synthesisValue = {
    summary: qualifyAbsenceClaim(summary, {
      hasUnsearchedTargets: bound.evidenceChain?.hasUnsearchedTargets,
    }),
    objective,
    findings: structuredFindings,
    evidence: supportingEvidence,
    contradictions: resolvedContradictions,
    gaps: resolvedGaps,
    limitations,
    confidence: {
      overall: overallLabel,
      basis:
        basis ||
        'Overall confidence reflects Critic final assessment of evidence support.',
    },
    references: structuredReferences,
    recommendations,
    excludedFindingIds: [...bound.excludedFindingIds],
    qualifiedFindingIds: [...bound.qualifyFindingIds],
  }

  if (bound.evidenceChain) {
    synthesisValue = applyEvidenceChainToSynthesis(
      synthesisValue,
      bound.evidenceChain,
      capConfidence,
      bound.criticConfidenceByFinding,
    )
  } else if (bound.matrixCoverage) {
    const chain = buildEvidenceChainGapAnalysis(
      bound.matrixCoverage,
      bound.criticGapDescriptions || [],
    )
    synthesisValue = applyEvidenceChainToSynthesis(
      synthesisValue,
      chain,
      capConfidence,
      bound.criticConfidenceByFinding,
    )
  }

  synthesisValue = applySynthesisQualityGates(synthesisValue, {
    researchQuestion: bound.researchQuestion,
    intents: bound.queryIntents,
    comparisonSufficiency: bound.comparisonSufficiency,
    evidenceChain: bound.evidenceChain,
    matrixCoverage: bound.matrixCoverage,
    papersById: bound.papersById,
    evidenceIdToPaperId: bound.evidenceIdToPaperId,
    extractedEvidenceById: bound.extractedEvidenceById || {},
  })

  synthesisValue = applyFinalOutputGuard(synthesisValue, {
    researchQuestion: bound.researchQuestion,
    intents: bound.queryIntents,
    evidenceChain: bound.evidenceChain,
    matrixCoverage: bound.matrixCoverage,
  })

  return { ok: true, value: synthesisValue }
}

/**
 * Build a citation string from available paper metadata only.
 *
 * @param {object|null|undefined} paper
 * @returns {string}
 */
export function buildCitation(paper) {
  if (!paper) return ''
  const authors = Array.isArray(paper.authors)
    ? paper.authors
        .map((a) => (typeof a === 'string' ? a : a?.name || ''))
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')
    : ''
  const year = paper.year ? String(paper.year) : 'n.d.'
  const title = asString(paper.title) || 'Untitled'
  const venue = asString(paper.venue)
  const parts = []
  if (authors) parts.push(authors)
  parts.push(`(${year}).`)
  parts.push(title)
  if (venue) parts.push(venue)
  const source = paper.source || paper.provenance?.source
  if (source) parts.push(`[${source}]`)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Map validated synthesizer output → ResearchReport persistence payload.
 *
 * @param {object} synthesis
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   provider: string,
 *   model: string,
 *   excludedCount: number,
 *   qualifiedCount: number,
 *   paperCount: number
 * }} meta
 * @returns {object}
 */
export function mapSynthesisToReportPayload(synthesis, meta) {
  const matrixCoverage = meta.matrixCoverage ||
    (meta.evidencePackage
      ? resolveEvidenceMatrixCoverage({
          evidencePackage: meta.evidencePackage,
          researchQuestion: meta.researchQuestion || synthesis.researchQuestion || '',
        })
      : null)

  const guardedSynthesis = synthesis.finalOutputGuardApplied
    ? synthesis
    : applyFinalOutputGuard(synthesis, {
        researchQuestion: meta.researchQuestion || synthesis.researchQuestion || '',
        evidenceChain: meta.evidenceChain,
        matrixCoverage,
      })

  const keyFindings = (guardedSynthesis.findings || []).map(
    (f) =>
      `[${f.id}] (${f.confidence}/${f.handling}) ${f.statement}`
  )

  const gapItems = [
    ...(guardedSynthesis.retrievalLimitations || []),
    ...(guardedSynthesis.scientificGaps || guardedSynthesis.gaps || []),
  ]
  if (guardedSynthesis.limitations) {
    gapItems.unshift(guardedSynthesis.limitations)
  }

  const finalEvidenceRegistry = buildFinalEvidenceRegistryFromSynthesis(
    guardedSynthesis,
    {
      corpusPapers: meta.corpusPapers || [],
      evidenceIdToPaperId: meta.evidenceIdToPaperId || {},
      sourceEvidenceItems: meta.sourceEvidenceItems || [],
      extractedEvidenceItems: meta.extractedEvidenceItems || [],
      allExtractedEvidenceItems: meta.allExtractedEvidenceItems || [],
      synthesizerPaperIds: meta.synthesizerPaperIds || [],
      researchQuestion:
        meta.researchQuestion || synthesis.researchQuestion || '',
    },
  )

  const evidenceAwareConfidence = computeEvidenceAwareConfidence({
    coverage: matrixCoverage,
    criticConfidence: guardedSynthesis.confidence?.overall || 'LOW',
    coverageConfidenceCeiling: meta.coverageConfidenceCeiling,
    comparisonSufficiency:
      meta.retrievalObservability?.researchSufficiency?.comparisonSufficiency ||
      meta.comparisonSufficiency,
  })

  return {
    status: 'ready',
    executiveSummary: guardedSynthesis.summary,
    summary: guardedSynthesis.summary,
    researchObjective: guardedSynthesis.objective,
    keyFindings,
    findings: keyFindings,
    supportingEvidence: guardedSynthesis.evidence || [],
    contradictions: guardedSynthesis.contradictions || [],
    researchGaps: {
      title: 'Research Gaps & Evidence Limitations',
      summary: guardedSynthesis.limitations || gapItems[0] || '',
      evidence: '',
      items: gapItems,
      retrievalLimitations: guardedSynthesis.retrievalLimitations || [],
      scientificGaps: guardedSynthesis.scientificGaps || [],
    },
    coverageSummary: {
      supportingPaperCount:
        guardedSynthesis.synthesisQuality?.citedPaperCount ||
        finalEvidenceRegistry.paperIds?.length ||
        0,
      graphNodeCountNote:
        'Knowledge graph node counts represent extracted concepts/entities and are not equivalent to supporting literature count.',
    },
    confidence: evidenceAwareConfidence.score,
    confidenceBreakdown: {
      overallLabel: evidenceAwareConfidence.label,
      basis: guardedSynthesis.confidence?.basis || evidenceAwareConfidence.basis,
      findingConfidences: Object.fromEntries(
        (guardedSynthesis.findings || []).map((f) => [f.id, f.confidence])
      ),
      source: 'evidence_aware',
      coverageScore: evidenceAwareConfidence.score,
    },
    references: (guardedSynthesis.references || []).map((r) => r.citation),
    recommendations: guardedSynthesis.recommendations || [],
    methodology: sanitizeMethodologyReview(
      buildMethodologyReviewFromRegistry(
        finalEvidenceRegistry,
        '',
        meta.retrievalObservability || null,
      ),
    ),
    generationMetadata: {
      agentRunId: meta.runId,
      model: meta.model,
      generatedAt: new Date(),
      pipelineVersion: 'trace-ai-synthesizer-v1',
      evidenceAvailability: meta.insufficientPath
        ? 'insufficient_evidence'
        : 'synthesis_completed',
      notes: JSON.stringify({
        agent: 'synthesizer',
        provider: meta.provider,
        sessionId: meta.sessionId,
        findingsUsed: synthesis.findings?.length || 0,
        findingsExcluded: meta.excludedCount,
        findingsQualified: meta.qualifiedCount,
        referencesUsed: synthesis.references?.length || 0,
        paperCount: meta.paperCount,
        contradictions: synthesis.contradictions?.length || 0,
        gaps: gapItems.length,
        overallConfidence: synthesis.confidence?.overall,
        synthesisQuality: synthesis.synthesisQuality || null,
      }),
      // Temporary run diagnostic. This is metadata only and is not read by
      // synthesis, registry construction, retrieval, or the UI.
      paperBoundaryDiagnostics: {
        synthesizerAvailablePaperIds: (meta.synthesizerPaperIds || []).map(String),
      },
    },
    findingConceptMap: {
      findings: synthesis.findings || [],
      evidence: synthesis.evidence || [],
      references: synthesis.references || [],
      excludedFindingIds: synthesis.excludedFindingIds || [],
      qualifiedFindingIds: synthesis.qualifiedFindingIds || [],
      confidence: synthesis.confidence,
      evidenceIdToPaperId: finalEvidenceRegistry.evidenceIdToPaperId,
      finalEvidenceRegistry,
    },
  }
}

/**
 * Deterministic insufficient-evidence report (no LLM findings).
 *
 * @param {object} args
 * @returns {object}
 */
export function buildInsufficientSynthesis({
  researchQuestion,
  researchPlan,
  critiqueResult,
  evidencePackage,
}) {
  const matrixCoverage = evidencePackage
    ? resolveEvidenceMatrixCoverage({ evidencePackage, researchQuestion })
    : null
  const evidenceChain = matrixCoverage
    ? buildEvidenceChainGapAnalysis(
        matrixCoverage,
        (critiqueResult?.gaps || []).map((g) => g.description).filter(Boolean),
      )
    : null

  const retrievedCount = evidencePackage?.papers?.length || 0
  const summaryLead =
    retrievedCount > 0
      ? 'Based on the retrieved evidence, there is currently limited or insufficient support to draw strong conclusions'
      : 'Based on this run, there is currently limited or insufficient support to draw strong conclusions'

  let synthesis = {
    summary: `${summaryLead} about: ${researchQuestion}. Relevant literature may have been retrieved, but available evidence did not meet TRACE thresholds for confident findings. The Critic assessed overall evidence sufficiency as ${critiqueResult?.overallAssessment?.evidenceSufficiency || 'INSUFFICIENT'} with ${critiqueResult?.overallAssessment?.confidence || 'LOW'} confidence.`,
    objective: researchPlan?.objective || researchQuestion,
    findings: [],
    evidence: [],
    contradictions: resolveContradictionStatements(critiqueResult, {
      relevantCount: matrixCoverage?.relevantCount || retrievedCount,
      findingCount: 0,
    }),
    gaps: [],
    limitations:
      'Evidence limitations: Critic reported insufficient support for substantive conclusions. No EXCLUDE findings were promoted into report conclusions.',
    confidence: {
      overall: critiqueResult?.overallAssessment?.confidence || 'LOW',
      basis:
        critiqueResult?.overallAssessment?.notes ||
        'Critic final overall assessment.',
    },
    references: [],
    recommendations: [
      'Gather additional high-relevance literature covering Critic NOT_COVERED requirements before drawing stronger conclusions.',
    ],
    excludedFindingIds: (critiqueResult?.findingEvaluations || [])
      .filter((e) => e.recommendedHandling === 'EXCLUDE')
      .map((e) => e.findingId),
    qualifiedFindingIds: [],
  }

  if (evidenceChain) {
    synthesis = applyEvidenceChainToSynthesis(synthesis, evidenceChain, capConfidence)
  }

  return applyFinalOutputGuard(synthesis, {
    researchQuestion,
    matrixCoverage,
    evidenceChain,
  })
}

export default {
  validateSynthesizerInput,
  validateCritiqueResultForSynthesizer,
  validateSynthesizerOutput,
  partitionFindingsByCritic,
  mapSynthesisToReportPayload,
  buildInsufficientSynthesis,
  confidenceLabelToScore,
  capConfidence,
  buildCitation,
  buildEvidenceIndexes,
  extractCriticGapDescriptions,
  reconstructSupportingEvidence,
}
