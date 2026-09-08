/**
 * @fileoverview Evidence-chain invariants: states, gaps, confidence caps, claim qualification.
 */
import {
  CLAIM_STRENGTH,
  claimSupportedByEvidenceLevel,
  inferClaimStrength,
  maxEvidenceLevelForItems,
  normalizeEvidenceLevel,
} from './evidenceLevels.js'

/**
 * @param {object} row
 * @returns {string}
 */
export function formatEvidenceTargetLabel(row) {
  if (row.method && row.dimension) {
    return [row.method, row.dimension].filter(Boolean).join(' + ')
  }
  if (row.evidenceType) return String(row.evidenceType)
  if (row.type === 'comparison') return 'comparative evidence'
  return String(row.targetId || 'requested evidence target')
}

export const EVIDENCE_TARGET_STATE = Object.freeze({
  NOT_SEARCHED: 'NOT_SEARCHED',
  SEARCHED_NO_RELEVANT_RESULTS: 'SEARCHED_NO_RELEVANT_RESULTS',
  RELEVANT_RESULTS_RETRIEVED: 'RELEVANT_RESULTS_RETRIEVED',
  FULL_TEXT_AVAILABLE: 'FULL_TEXT_AVAILABLE',
  EVIDENCE_ASSESSED: 'EVIDENCE_ASSESSED',
  EVIDENCE_USED: 'EVIDENCE_USED',
})

/**
 * @param {object} row
 * @returns {string}
 */
export function resolveEvidenceTargetState(row) {
  if (row?.state && Object.values(EVIDENCE_TARGET_STATE).includes(row.state)) {
    return row.state
  }
  if ((row?.citedPaperCount || 0) > 0) return EVIDENCE_TARGET_STATE.EVIDENCE_USED
  if ((row?.registryPaperCount || 0) > 0) {
    return EVIDENCE_TARGET_STATE.EVIDENCE_ASSESSED
  }
  if ((row?.fullTextPaperCount || 0) > 0) {
    return EVIDENCE_TARGET_STATE.FULL_TEXT_AVAILABLE
  }
  if ((row?.relevantPaperCount || 0) > 0) {
    return EVIDENCE_TARGET_STATE.RELEVANT_RESULTS_RETRIEVED
  }
  if (row?.searched || row?.status === 'searched_no_relevant_papers') {
    return EVIDENCE_TARGET_STATE.SEARCHED_NO_RELEVANT_RESULTS
  }
  return EVIDENCE_TARGET_STATE.NOT_SEARCHED
}

/**
 * @param {object|null|undefined} coverage
 * @returns {object}
 */
export function enrichCoverageWithChainStates(coverage) {
  if (!coverage) {
    return {
      targetCount: 0,
      searchedCount: 0,
      relevantCount: 0,
      fullTextCount: 0,
      registryCount: 0,
      notSearchedCount: 0,
      rows: [],
    }
  }

  const rows = (coverage.rows || []).map((row) => {
    const state = resolveEvidenceTargetState(row)
    return { ...row, state }
  })

  return {
    ...coverage,
    rows,
    notSearchedCount: rows.filter(
      (row) => row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED,
    ).length,
    evidenceUsedCount: rows.filter(
      (row) => row.state === EVIDENCE_TARGET_STATE.EVIDENCE_USED,
    ).length,
  }
}

/**
 * @param {object|null|undefined} coverage
 * @returns {'LOW'|'MEDIUM'|'HIGH'}
 */
export function computeCoverageConfidenceCeiling(coverage) {
  const enriched = enrichCoverageWithChainStates(coverage)
  const rows = enriched.rows || []
  if (!rows.length) return 'LOW'

  if (enriched.notSearchedCount > 0) return 'LOW'

  const noRelevant = rows.filter(
    (row) => row.state === EVIDENCE_TARGET_STATE.SEARCHED_NO_RELEVANT_RESULTS,
  ).length
  if (noRelevant >= Math.ceil(rows.length * 0.35)) return 'MEDIUM'

  const used = enriched.evidenceUsedCount || 0
  const fullText = enriched.fullTextCount || 0
  if (used >= Math.ceil(rows.length * 0.35) && fullText >= 1) return 'HIGH'

  return 'MEDIUM'
}

/**
 * @param {object|null|undefined} coverage
 * @returns {string[]}
 */
export function buildConsolidatedRetrievalLimitations(coverage) {
  const rows = enrichCoverageWithChainStates(coverage).rows.filter(
    (row) => row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED,
  )
  if (!rows.length) return []

  /** @type {Map<string, Set<string>>} */
  const methodDimensions = new Map()
  let comparisonMissed = false
  let evidenceTypeMissed = false

  for (const row of rows) {
    if (row.type === 'comparison') comparisonMissed = true
    if (row.type === 'evidence_type') evidenceTypeMissed = true
    if (!row.method) continue
    const dims = methodDimensions.get(row.method) || new Set()
    if (row.dimension) dims.add(row.dimension)
    methodDimensions.set(row.method, dims)
  }

  const methodParts = [...methodDimensions.entries()]
    .slice(0, 4)
    .map(([method, dims]) => {
      const dimList = [...dims].slice(0, 4).join(', ')
      return dimList ? `${method} (${dimList})` : method
    })

  let summary =
    'Several requested method–dimension combinations were not reached within the configured retrieval budget'
  if (methodParts.length) {
    summary += `, particularly for ${methodParts.join('; ')}`
  }
  summary +=
    '. Therefore, absence of evidence for those targets cannot be inferred from this run.'

  /** @type {string[]} */
  const limitations = [summary]
  if (comparisonMissed) {
    limitations.push(
      'Direct comparison targets were not fully searched in this run; any comparative conclusion must be limited to retrieved and assessed evidence only.',
    )
  }
  if (evidenceTypeMissed && !comparisonMissed) {
    limitations.push(
      'Some requested evidence types (for example clinician studies or standardized metrics) were not fully searched in this run.',
    )
  }
  return limitations
}

/**
 * @param {object|null|undefined} coverage
 * @param {string[]} [criticGapDescriptions]
 * @returns {string[]}
 */
export function buildScientificGapsFromCoverage(
  coverage,
  criticGapDescriptions = [],
) {
  const rows = enrichCoverageWithChainStates(coverage).rows
  /** @type {Set<string>} */
  const gaps = new Set()

  let comparisonGapAdded = false
  for (const row of rows) {
    const label = formatEvidenceTargetLabel(row)
    if (row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED) continue

    if (row.state === EVIDENCE_TARGET_STATE.SEARCHED_NO_RELEVANT_RESULTS) {
      gaps.add(
        `Within the evidence retrieved and assessed in this run, no relevant literature was retained for ${label}.`,
      )
      continue
    }

    if (
      row.state === EVIDENCE_TARGET_STATE.RELEVANT_RESULTS_RETRIEVED &&
      (row.fullTextPaperCount || 0) === 0
    ) {
      gaps.add(
        `Relevant literature was retrieved for ${label}, but available evidence in this run was limited to abstracts or high-level metadata.`,
      )
    }

    if (
      row.type === 'comparison' &&
      row.searched &&
      row.state !== EVIDENCE_TARGET_STATE.EVIDENCE_USED &&
      !comparisonGapAdded
    ) {
      gaps.add(
        'No direct head-to-head comparison was identified among the evidence retrieved and assessed in this run.',
      )
      comparisonGapAdded = true
    }
  }

  for (const gap of criticGapDescriptions || []) {
    const text = String(gap || '').trim()
    if (!text) continue
    if (enrichCoverageWithChainStates(coverage).notSearchedCount > 0) {
      continue
    }
    gaps.add(qualifyAbsenceClaim(text, { hasUnsearchedTargets: false }))
  }

  return [...gaps]
}

/**
 * @param {string} text
 * @param {{ hasUnsearchedTargets?: boolean }} [context]
 * @returns {string}
 */
export function qualifyAbsenceClaim(text, context = {}) {
  let value = String(text || '').trim()
  if (!value) return value

  const replacements = [
    [
      /\bno direct head-to-head (comparative )?evidence was found\b/gi,
      'No direct head-to-head comparison was identified among the evidence retrieved and assessed in this run',
    ],
    [
      /\bno (direct )?comparative evidence was found\b/gi,
      'No direct comparative evidence was identified among the evidence retrieved and assessed in this run',
    ],
    [
      /\bno (studies|papers|research) (exist|were found|was found)\b/gi,
      'No qualifying studies were identified among the evidence retrieved and assessed in this run',
    ],
    [
      /\bno evidence (exists|was found|were found)\b/gi,
      'No qualifying evidence was identified among the evidence retrieved and assessed in this run',
    ],
    [
      /\bthe literature (does not|doesn't) contain\b/gi,
      'the literature retrieved and assessed in this run does not contain',
    ],
  ]

  for (const [pattern, replacement] of replacements) {
    value = value.replace(pattern, replacement)
  }

  if (
    context.hasUnsearchedTargets &&
    /\bno\b/i.test(value) &&
    /\b(evidence|studies|validation|robustness|literature|addressed|lacking|comparative)\b/i.test(
      value,
    )
  ) {
    return 'This run did not reach the relevant evidence target(s), so absence cannot be inferred from this run.'
  }

  return value
}

/**
 * @param {object|null|undefined} coverage
 * @param {string[]} [criticGapDescriptions]
 * @returns {object}
 */
export function buildEvidenceChainGapAnalysis(coverage, criticGapDescriptions = []) {
  const enriched = enrichCoverageWithChainStates(coverage)
  const retrievalLimitations = buildConsolidatedRetrievalLimitations(enriched)
  const scientificGaps = buildScientificGapsFromCoverage(
    enriched,
    criticGapDescriptions,
  )
  const coverageConfidenceCeiling = computeCoverageConfidenceCeiling(enriched)

  return {
    coverage: enriched,
    retrievalLimitations,
    scientificGaps,
    coverageConfidenceCeiling,
    hasUnsearchedTargets: enriched.notSearchedCount > 0,
    auditRows: (enriched.rows || []).map((row) => ({
      targetId: row.targetId,
      method: row.method,
      dimension: row.dimension,
      evidenceType: row.evidenceType,
      state: row.state,
      relevantPaperCount: row.relevantPaperCount,
      fullTextPaperCount: row.fullTextPaperCount,
      citedPaperCount: row.citedPaperCount,
      registryPaperCount: row.registryPaperCount,
    })),
  }
}

/**
 * @param {object} synthesis
 * @param {object} chain
 * @param {(proposed: string, ceiling: string) => string} capConfidence
 * @param {Map<string, string>} [criticConfidenceByFinding]
 * @returns {object}
 */
export function applyEvidenceChainToSynthesis(
  synthesis,
  chain,
  capConfidence,
  criticConfidenceByFinding = new Map(),
) {
  const coverageCeiling = chain.coverageConfidenceCeiling || 'LOW'
  const chainContext = { hasUnsearchedTargets: Boolean(chain.hasUnsearchedTargets) }

  const findings = (synthesis.findings || []).map((finding) => {
    const criticCeiling = criticConfidenceByFinding.get(finding.id) || 'LOW'
    return {
      ...finding,
      statement: qualifyAbsenceClaim(finding.statement, chainContext),
      confidence: capConfidence(
        finding.confidence,
        capConfidence(chain.coverageConfidenceCeiling || 'LOW', criticCeiling),
      ),
    }
  })

  const qualifiedScientific = (chain.scientificGaps || []).map((gap) =>
    qualifyAbsenceClaim(gap, chainContext),
  )
  const qualifiedCritic = (synthesis.gaps || [])
    .filter(
      (gap) =>
        !(chain.retrievalLimitations || []).some((row) => row === gap) &&
        !(chain.scientificGaps || []).includes(gap),
    )
    .map((gap) => qualifyAbsenceClaim(gap, chainContext))

  const scientificGaps = [...new Set([...qualifiedScientific, ...qualifiedCritic])]
  const retrievalLimitations = [...(chain.retrievalLimitations || [])]
  const gaps = [...retrievalLimitations, ...scientificGaps]

  const overall = capConfidence(
    synthesis.confidence?.overall,
    capConfidence(coverageCeiling, synthesis.confidence?.overall || 'LOW'),
  )

  let basis = String(synthesis.confidence?.basis || '').trim()
  if (chain.hasUnsearchedTargets) {
    const note =
      'Confidence is capped because one or more requested evidence targets were not searched within the retrieval budget.'
    basis = basis ? `${basis} ${note}` : note
  }

  return {
    ...synthesis,
    findings,
    gaps,
    retrievalLimitations,
    scientificGaps,
    contradictions: (synthesis.contradictions || []).map((row) =>
      qualifyAbsenceClaim(row, chainContext),
    ),
    limitations: qualifyAbsenceClaim(synthesis.limitations, chainContext),
    confidence: {
      ...(synthesis.confidence || {}),
      overall,
      basis,
      coverageCeiling,
    },
  }
}

/**
 * @param {object} input
 * @returns {object}
 */
export function auditFindingReferenceConsistency(input = {}) {
  const findings = input.findings || []
  const registryPaperIds = new Set(
    (input.registryPaperIds || []).map((id) => String(id)),
  )
  const registryEvidenceIds = new Set(
    (input.registryEvidenceIds || []).map((id) => String(id)),
  )
  const evidenceIdToPaperId = input.evidenceIdToPaperId || new Map()
  /** @type {object[]} */
  const issues = []
  const findingsPaperIds = new Set()
  const findingsEvidenceIds = new Set()

  for (const finding of findings) {
    const paperIds = (finding.paperIds || []).map(String)
    const evidenceIds = (finding.evidenceIds || []).map(String)
    if (!paperIds.length && !evidenceIds.length) {
      issues.push({
        findingId: finding.id,
        issue: 'finding_without_paper_or_evidence_refs',
      })
    }
    for (const evidenceId of evidenceIds) {
      findingsEvidenceIds.add(evidenceId)
      if (registryEvidenceIds.size && !registryEvidenceIds.has(evidenceId)) {
        issues.push({
          findingId: finding.id,
          evidenceId,
          issue: 'finding_evidence_not_in_final_registry',
        })
      }
      const mappedPaperId = evidenceIdToPaperId.get
        ? evidenceIdToPaperId.get(evidenceId)
        : evidenceIdToPaperId[evidenceId]
      if (mappedPaperId && paperIds.length) {
        if (!paperIds.includes(String(mappedPaperId))) {
          issues.push({
            findingId: finding.id,
            evidenceId,
            paperId: String(mappedPaperId),
            issue: 'finding_evidence_paper_mismatch',
          })
        }
      }
    }
    for (const paperId of paperIds) {
      findingsPaperIds.add(paperId)
      if (registryPaperIds.size && !registryPaperIds.has(paperId)) {
        issues.push({
          findingId: finding.id,
          paperId,
          issue: 'finding_paper_not_in_final_registry',
        })
      }
    }
  }

  const unusedRegistryPaperIds = [...registryPaperIds].filter(
    (paperId) => !findingsPaperIds.has(paperId),
  )

  return {
    findingCount: findings.length,
    registryPaperCount: registryPaperIds.size,
    findingsWithPaperRefs: findings.filter((f) => (f.paperIds || []).length).length,
    uniqueFindingPaperCount: findingsPaperIds.size,
    uniqueFindingEvidenceCount: findingsEvidenceIds.size,
    unusedRegistryPaperIds,
    issues,
    consistent: issues.length === 0,
  }
}

/**
 * @param {object|null|undefined} coverage
 * @param {{ maxItems?: number }} [options]
 * @returns {string[]}
 */
export function formatEvidenceTargetGapDescriptions(coverage, options = {}) {
  const chain = buildEvidenceChainGapAnalysis(coverage, [])
  const maxItems = Math.max(1, Number(options?.maxItems) || 8)
  return [...chain.retrievalLimitations, ...chain.scientificGaps].slice(
    0,
    maxItems,
  )
}

/**
 * @param {object} input
 * @returns {object}
 */
export function auditFindingEvidenceChain(input = {}) {
  const base = auditFindingReferenceConsistency(input)
  const evidenceLevelsById = input.evidenceLevelsById || {}
  const extractedById = input.extractedEvidenceById || {}

  for (const finding of input.findings || []) {
    const strength = inferClaimStrength(finding.statement)
    const levels = (finding.evidenceIds || [])
      .map((id) =>
        normalizeEvidenceLevel(
          evidenceLevelsById[String(id)] ||
            extractedById[String(id)]?.evidenceLevel,
        ),
      )
      .filter(Boolean)

    const maxLevel =
      levels.length > 0
        ? maxEvidenceLevelForItems(levels.map((level) => ({ evidenceLevel: level })))
        : 'UNAVAILABLE'

    if (!claimSupportedByEvidenceLevel(strength, maxLevel)) {
      base.issues.push({
        findingId: finding.id,
        issue: 'finding_claim_exceeds_evidence_level',
        claimStrength: strength,
        maxEvidenceLevel: maxLevel,
      })
      base.consistent = false
    }

    if (
      strength === CLAIM_STRENGTH.ABSENCE &&
      input.hasUnsearchedTargets &&
      !/\bretrieved and assessed in this run\b/i.test(finding.statement || '')
    ) {
      base.issues.push({
        findingId: finding.id,
        issue: 'absence_claim_with_unsearched_targets',
      })
      base.consistent = false
    }
  }

  return base
}

export default {
  EVIDENCE_TARGET_STATE,
  resolveEvidenceTargetState,
  enrichCoverageWithChainStates,
  computeCoverageConfidenceCeiling,
  buildConsolidatedRetrievalLimitations,
  buildScientificGapsFromCoverage,
  qualifyAbsenceClaim,
  buildEvidenceChainGapAnalysis,
  applyEvidenceChainToSynthesis,
  formatEvidenceTargetLabel,
  formatEvidenceTargetGapDescriptions,
  auditFindingReferenceConsistency,
  auditFindingEvidenceChain,
}
