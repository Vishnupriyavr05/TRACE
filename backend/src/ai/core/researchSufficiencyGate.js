/**
 * @fileoverview Research sufficiency / coverage gate and bounded recovery planning.
 */
import { extractResearchQueryIntents, buildMethodDiscoveryQuery, buildComparativeDiscoveryQuery } from './queryIntents.js'
import {
  buildEvidenceTargets,
  resolveEvidenceMatrixCoverage,
} from './evidenceTargets.js'
import {
  EVIDENCE_TARGET_STATE,
  enrichCoverageWithChainStates,
} from './evidenceChain.js'
import { queriesNearlyEqual } from '../agents/explorer.limits.js'
import { confidenceLabelToScore, capConfidence } from '../validators/synthesizer.schema.js'

const PRIORITY_DIMENSIONS = [
  'clinical usefulness',
  'robustness',
  'diagnostic performance',
  'interpretability',
  'standardized evaluation metrics',
]

export function getExecutedQueriesFromPackage(evidencePackage) {
  const audit = evidencePackage?.retrievalObservability?.retrievalAudit
  return (
    audit?.plannerQueryCoverage?.executed ||
    audit?.plannerQueries?.executed ||
    evidencePackage?.retrievalObservability?.executedQueries ||
    []
  )
}

function buildQueryForTargetRow(row, intents) {
  if (row.type === 'method_dimension' && row.method && row.dimension) {
    return buildMethodDiscoveryQuery(intents, row.method, row.dimension)
  }
  if (row.type === 'comparison') {
    return buildComparativeDiscoveryQuery(intents)
  }
  if (row.evidenceType === 'clinician studies' && intents.methods?.[0]) {
    return [intents.methods[0], intents.domainPhrase, 'clinician study']
      .filter(Boolean)
      .join(' ')
  }
  if (row.evidenceType === 'standardized evaluation metrics') {
    return [intents.domainPhrase, 'evaluation metrics', intents.methods?.[0]]
      .filter(Boolean)
      .join(' ')
  }
  if (row.evidenceType === 'reported limitations') {
    return [intents.domainPhrase, 'limitations', intents.methods?.[0]]
      .filter(Boolean)
      .join(' ')
  }
  return null
}

function queryAlreadyExecuted(executedQueries, queryText) {
  return (executedQueries || []).some((row) =>
    queriesNearlyEqual(row?.query || row, queryText),
  )
}

export function buildCoverageRecoveryQueries(
  coverage,
  intents,
  executedQueries = [],
  maxQueries = 2,
) {
  const enriched = enrichCoverageWithChainStates(coverage)
  const notSearched = enriched.rows.filter(
    (row) => row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED,
  )
  if (!notSearched.length) return []

  const priority = (row) => {
    if (row.type === 'comparison') return 0
    if (row.evidenceType === 'clinician studies') return 1
    const dimIdx = PRIORITY_DIMENSIONS.indexOf(String(row.dimension || ''))
    return dimIdx >= 0 ? 2 + dimIdx : 20
  }

  const sorted = [...notSearched].sort(
    (a, b) => priority(a) - priority(b) || String(a.targetId).localeCompare(String(b.targetId)),
  )

  const queries = []
  const seen = new Set()

  for (const row of sorted) {
    if (queries.length >= maxQueries) break
    const queryText = buildQueryForTargetRow(row, intents)
    if (!queryText) continue
    const key = queryText.toLowerCase()
    if (seen.has(key) || queryAlreadyExecuted(executedQueries, queryText)) continue
    seen.add(key)
    queries.push({
      query: queryText,
      purpose: 'coverage_recovery',
      methodSpecific: true,
      recovery: true,
      evidenceTargetIds: [row.targetId],
      methodLabel: row.method || null,
      evaluationDimension: row.dimension || null,
    })
  }

  return queries
}

export function computeComparisonSufficiency(coverage, intents) {
  const enriched = enrichCoverageWithChainStates(coverage)
  const rows = enriched.rows || []
  const methodRows = rows.filter((row) => row.type === 'method_dimension')
  const comparisonRows = rows.filter((row) => row.type === 'comparison')

  const methodDimensionMatrix = []
  for (const method of intents.methods || []) {
    for (const dimension of intents.evaluationDimensions || []) {
      const row =
        methodRows.find(
          (r) => r.method === method && r.dimension === dimension,
        ) || null
      methodDimensionMatrix.push({
        method,
        dimension,
        state: row?.state || EVIDENCE_TARGET_STATE.NOT_SEARCHED,
        relevantPaperCount: row?.relevantPaperCount || 0,
        fullTextPaperCount: row?.fullTextPaperCount || 0,
        citedPaperCount: row?.citedPaperCount || 0,
        hasQuantitativeEvidence: Boolean(row?.hasQuantitativeEvidence),
        hasClinicalEvidence: Boolean(row?.hasClinicalEvidence),
        hasRobustnessEvidence: Boolean(row?.hasRobustnessEvidence),
        hasComparativeEvidence: Boolean(row?.hasComparativeEvidence),
      })
    }
  }

  const dimensionsWithEvidence = new Set(
    methodDimensionMatrix
      .filter((cell) => cell.relevantPaperCount > 0 || cell.citedPaperCount > 0)
      .map((cell) => cell.dimension),
  )
  const methodsWithEvidence = new Set(
    methodDimensionMatrix
      .filter((cell) => cell.relevantPaperCount > 0 || cell.citedPaperCount > 0)
      .map((cell) => cell.method),
  )

  const directComparison = comparisonRows.some(
    (row) =>
      row.state === EVIDENCE_TARGET_STATE.EVIDENCE_USED ||
      row.citedPaperCount > 0 ||
      row.hasComparativeEvidence,
  )
  const indirectComparison =
    methodsWithEvidence.size >= 2 && dimensionsWithEvidence.size > 0

  return {
    canCompareMethods: methodsWithEvidence.size >= 2,
    canCompareAcrossDimensions: dimensionsWithEvidence.size > 0,
    directComparisonEvidence: directComparison,
    indirectComparisonOnly: !directComparison && indirectComparison,
    methodsWithEvidence: [...methodsWithEvidence],
    dimensionsWithEvidence: [...dimensionsWithEvidence],
    methodDimensionMatrix,
    winnerEstablishable: directComparison && enriched.evidenceUsedCount >= 2,
    comparisonBlockedReason: directComparison
      ? null
      : enriched.notSearchedCount > 0
        ? 'TRACE_RETRIEVAL_COVERAGE_INCOMPLETE'
        : indirectComparison
          ? 'INDIRECT_EVIDENCE_ONLY'
          : 'INSUFFICIENT_COMPARATIVE_EVIDENCE',
  }
}

export function evaluateResearchSufficiency(input = {}) {
  const evidencePackage = input.evidencePackage || {}
  const query =
    input.researchQuestion ||
    evidencePackage.researchQuestion ||
    ''
  const intents = extractResearchQueryIntents(query)
  const executedQueries = getExecutedQueriesFromPackage(evidencePackage)
  const coverage = enrichCoverageWithChainStates(
    resolveEvidenceMatrixCoverage({
      evidencePackage,
      researchQuestion: query,
      analyticalFindings: input.analyticalFindings || {},
      registryPaperIds: input.registryPaperIds || [],
    }),
  )

  const maxRecoveryQueries =
    Number(input.maxRecoveryQueries) ||
    Number(input.maxRefinedQueries) ||
    2
  const recoveryQueries = buildCoverageRecoveryQueries(
    coverage,
    intents,
    executedQueries,
    maxRecoveryQueries,
  )

  const corpusSize = (evidencePackage.papers || []).length
  const comparisonSufficiency = computeComparisonSufficiency(coverage, intents)
  const highPriorityNotSearched = coverage.rows.filter(
    (row) =>
      row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED &&
      (row.type === 'method_dimension' || row.type === 'comparison'),
  )

  const sparseCorpus =
    corpusSize < Math.max(3, Math.min(6, (intents.methods?.length || 1) * 2))
  const shouldRecover =
    Boolean(input.recoveryAllowed !== false) &&
    recoveryQueries.length > 0 &&
    (highPriorityNotSearched.length > 0 || sparseCorpus)

  const searchedRatio = coverage.targetCount
    ? coverage.searchedCount / coverage.targetCount
    : 0
  const usedRatio = coverage.targetCount
    ? (coverage.evidenceUsedCount || 0) / coverage.targetCount
    : 0

  return {
    sufficient:
      highPriorityNotSearched.length === 0 &&
      !sparseCorpus &&
      usedRatio >= 0.15 &&
      searchedRatio >= 0.5,
    shouldRecover,
    recoveryQueries,
    recoveryExhausted: Boolean(input.recoveryAttempted),
    coverage,
    comparisonSufficiency,
    notSearchedCount: coverage.notSearchedCount,
    corpusSize,
    sparseCorpus,
    searchedRatio,
    usedRatio,
    evidenceTargets: buildEvidenceTargets(intents),
    gateVerdict:
      shouldRecover && !input.recoveryAttempted
        ? 'RECOVERY_RECOMMENDED'
        : highPriorityNotSearched.length > 0
          ? 'RETRIEVAL_LIMITED'
          : sparseCorpus
            ? 'SPARSE_EVIDENCE_BASE'
            : comparisonSufficiency.canCompareMethods
              ? 'COMPARISON_POSSIBLE'
              : 'PARTIAL_COVERAGE',
  }
}

export function computeEvidenceAwareConfidence(input = {}) {
  const coverage = enrichCoverageWithChainStates(input.coverage || {})
  const criticLabel = capConfidence(
    input.criticConfidence || 'LOW',
    input.criticConfidence || 'LOW',
  )
  const ceiling = capConfidence(
    input.coverageConfidenceCeiling || computeCoverageConfidenceFromCoverage(coverage),
    criticLabel,
  )

  const searchedRatio = coverage.targetCount
    ? coverage.searchedCount / coverage.targetCount
    : 0
  const usedRatio = coverage.targetCount
    ? (coverage.evidenceUsedCount || 0) / coverage.targetCount
    : 0
  const fullTextRatio = coverage.targetCount
    ? (coverage.fullTextCount || 0) / coverage.targetCount
    : 0
  const qualitySignal = searchedRatio * 0.25 + usedRatio * 0.45 + fullTextRatio * 0.3

  let score = confidenceLabelToScore(ceiling)
  if (ceiling === 'HIGH') {
    score = Math.max(70, Math.min(85, 70 + Math.round(qualitySignal * 15)))
  } else if (ceiling === 'MEDIUM') {
    score = Math.max(40, Math.min(65, 40 + Math.round(qualitySignal * 25)))
  } else {
    score = Math.max(20, Math.min(45, 20 + Math.round(qualitySignal * 25)))
  }

  const basisParts = []
  if (coverage.notSearchedCount > 0) {
    basisParts.push(
      `${coverage.notSearchedCount} requested evidence target(s) were not searched in this run`,
    )
  }
  if (coverage.evidenceUsedCount > 0) {
    basisParts.push(
      `${coverage.evidenceUsedCount} target(s) have evidence used in findings`,
    )
  }
  if (coverage.fullTextCount > 0) {
    basisParts.push(`${coverage.fullTextCount} target(s) have full-text material`)
  }
  if (input.comparisonSufficiency?.indirectComparisonOnly) {
    basisParts.push('comparison relies on indirect cross-study evidence only')
  }

  return {
    label: ceiling,
    score,
    basis:
      basisParts.join('; ') ||
      'Confidence reflects bounded coverage and assessed evidence strength in this run.',
  }
}

function computeCoverageConfidenceFromCoverage(coverage) {
  const enriched = enrichCoverageWithChainStates(coverage)
  if (!enriched.targetCount) return 'LOW'
  const searchedRatio = enriched.searchedCount / enriched.targetCount
  if (enriched.notSearchedCount > Math.ceil(enriched.targetCount * 0.25)) {
    return 'LOW'
  }
  if (searchedRatio < 0.45) return 'LOW'
  if (
    enriched.evidenceUsedCount >= Math.ceil(enriched.targetCount * 0.25) &&
    enriched.fullTextCount >= 1
  ) {
    return 'HIGH'
  }
  return 'MEDIUM'
}

export function planUnifiedRecoveryQueries(
  critiqueResult,
  researchPlan,
  evidencePackage,
  query,
  analyticalFindings,
  maxQueries = 2,
) {
  const sufficiency = evaluateResearchSufficiency({
    evidencePackage,
    researchQuestion: query,
    analyticalFindings,
    recoveryAllowed: true,
    maxRecoveryQueries: maxQueries,
  })

  const queries = [...sufficiency.recoveryQueries]
  const seen = new Set(queries.map((row) => row.query.toLowerCase()))

  const coverage = Array.isArray(critiqueResult?.evidenceCoverage)
    ? critiqueResult.evidenceCoverage
    : []
  const dimensions = (researchPlan?.researchDimensions || [])
    .map((d) => (typeof d === 'string' ? d : d?.name || ''))
    .filter(Boolean)
  const dimensionHint = dimensions[0] || ''

  for (const item of coverage.filter((c) => c.status === 'NOT_COVERED')) {
    if (queries.length >= maxQueries) break
    const requirement = String(item.requirement || '').trim()
    if (!requirement) continue
    const queryText = (dimensionHint
      ? `${requirement} ${dimensionHint}`
      : requirement
    ).slice(0, 200)
    if (seen.has(queryText.toLowerCase())) continue
    seen.add(queryText.toLowerCase())
    queries.push({
      query: queryText,
      purpose: 'refinement',
      basedOnRequirement: requirement,
      coverageStatus: item.status,
    })
  }

  return queries.slice(0, maxQueries)
}

export default {
  getExecutedQueriesFromPackage,
  buildCoverageRecoveryQueries,
  computeComparisonSufficiency,
  evaluateResearchSufficiency,
  computeEvidenceAwareConfidence,
  planUnifiedRecoveryQueries,
}
