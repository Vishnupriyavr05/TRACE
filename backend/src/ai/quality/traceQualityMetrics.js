/**
 * @fileoverview Deterministic TRACE quality metrics (no LLM judge).
 * Pure functions over existing artifacts + graph + LLM accounting.
 */
import { resolveFinalEvidenceRegistry } from '../core/finalEvidenceRegistry.js'
import { computeEvidenceLevelMetrics } from '../core/evidenceLevelEnforcement.js'

/**
 * @param {unknown} value
 * @returns {number}
 */
function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {object[]} papers
 * @returns {{ avg: number|null, median: number|null, scored: number, total: number }}
 */
export function computeRetrievalRelevance(papers = []) {
  const scores = (papers || [])
    .map((p) => (typeof p.relevance === 'number' ? p.relevance : null))
    .filter((s) => s != null)
    .sort((a, b) => a - b)

  if (!scores.length) {
    return { avg: null, median: null, scored: 0, total: papers.length || 0 }
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  const mid = Math.floor(scores.length / 2)
  const median =
    scores.length % 2 === 0
      ? (scores[mid - 1] + scores[mid]) / 2
      : scores[mid]

  return {
    avg: Number(avg.toFixed(4)),
    median: Number(median.toFixed(4)),
    scored: scores.length,
    total: papers.length || 0,
  }
}

/**
 * @param {object[]} coverage
 * @returns {object}
 */
export function computeEvidenceCoverage(coverage = []) {
  const items = Array.isArray(coverage) ? coverage : []
  const counts = { COVERED: 0, PARTIAL: 0, NOT_COVERED: 0, OTHER: 0 }
  for (const item of items) {
    const status = String(item?.status || item?.coverageStatus || '').toUpperCase()
    if (status in counts) counts[status] += 1
    else counts.OTHER += 1
  }
  const total = items.length
  const coveredRatio =
    total > 0 ? Number(((counts.COVERED + counts.PARTIAL * 0.5) / total).toFixed(4)) : null
  return { ...counts, total, coveredRatio }
}

/**
 * @param {object[]} findings
 * @returns {object}
 */
export function computeFindingToEvidenceCoverage(findings = []) {
  const list = Array.isArray(findings) ? findings : []
  let withEvidence = 0
  let withPapers = 0
  for (const f of list) {
    const evidenceIds = f.evidenceIds || f.evidenceItemIds || []
    const paperIds = f.paperIds || []
    if (Array.isArray(evidenceIds) && evidenceIds.length) withEvidence += 1
    if (Array.isArray(paperIds) && paperIds.length) withPapers += 1
  }
  const total = list.length
  return {
    total,
    withEvidenceIds: withEvidence,
    withPaperIds: withPapers,
    ratio:
      total > 0
        ? Number((Math.max(withEvidence, withPapers) / total).toFixed(4))
        : null,
  }
}

/**
 * @param {object|null} report
 * @param {object[]} papers
 * @returns {object}
 */
export function computeCitationValidity(report, papers = []) {
  const registry = resolveFinalEvidenceRegistry(report, papers)
  const known = new Set(
    [
      ...(papers || []).map((p) => String(p.paperId || p.id || p._id || '')),
      ...(registry.paperIds || []),
    ].filter(Boolean),
  )

  const refs = (report?.findingConceptMap?.references || registry.references || [])
    .filter((ref) => ref && typeof ref === 'object')

  let valid = 0
  let invalid = 0
  let missingId = 0
  for (const ref of refs) {
    const id = String(ref.paperId || ref.id || '')
    if (!id) {
      missingId += 1
      continue
    }
    if (known.size === 0 || known.has(id)) valid += 1
    else invalid += 1
  }
  const total = refs.length
  return {
    total,
    valid,
    invalid,
    missingId,
    ratio: total > 0 ? Number((valid / total).toFixed(4)) : null,
  }
}

/**
 * @param {object[]} gaps
 * @returns {object}
 */
export function computeGapToEvidenceCoverage(gaps = []) {
  const list = Array.isArray(gaps) ? gaps : []
  let linked = 0
  for (const gap of list) {
    const hasLink =
      (Array.isArray(gap.relatedFindingIds) && gap.relatedFindingIds.length) ||
      (Array.isArray(gap.paperIds) && gap.paperIds.length) ||
      (Array.isArray(gap.evidenceIds) && gap.evidenceIds.length) ||
      Boolean(gap.requirementId) ||
      Boolean(gap.basedOnRequirement)
    if (hasLink) linked += 1
  }
  const total = list.length
  return {
    total,
    linked,
    ratio: total > 0 ? Number((linked / total).toFixed(4)) : null,
  }
}

/**
 * @param {object[]} contradictions
 * @returns {object}
 */
export function computeContradictionSupport(contradictions = []) {
  const list = Array.isArray(contradictions) ? contradictions : []
  let supported = 0
  for (const c of list) {
    const hasSupport =
      (Array.isArray(c.findingIds) && c.findingIds.length >= 1) ||
      (Array.isArray(c.paperIds) && c.paperIds.length >= 1) ||
      (Array.isArray(c.evidenceIds) && c.evidenceIds.length >= 1) ||
      Boolean(c.statement)
    if (hasSupport) supported += 1
  }
  const total = list.length
  return {
    total,
    supported,
    ratio: total > 0 ? Number((supported / total).toFixed(4)) : null,
  }
}

/**
 * @param {object|null} report
 * @returns {object}
 */
export function computeReportCompleteness(report) {
  if (!report || typeof report !== 'object') {
    return {
      complete: false,
      score: 0,
      missing: ['report'],
      present: [],
    }
  }

  // Match the persisted ResearchReport contract from mapSynthesisToReportPayload:
  // researchObjective, numeric confidence (+ optional confidenceBreakdown),
  // findings/keyFindings, references/supportingEvidence.
  const hasObjective = Boolean(
    report.objective || report.researchObjective,
  )
  const hasFindings =
    (Array.isArray(report.findings) && report.findings.length > 0) ||
    (Array.isArray(report.keyFindings) && report.keyFindings.length > 0)
  const hasConfidence =
    (typeof report.confidence === 'number' &&
      Number.isFinite(report.confidence)) ||
    Boolean(
      report.confidence?.overall ||
        report.overallConfidence ||
        report.confidenceBreakdown?.overallLabel,
    )
  const hasReferences =
    (Array.isArray(report.references) && report.references.length > 0) ||
    (Array.isArray(report.evidence) && report.evidence.length > 0) ||
    (Array.isArray(report.supportingEvidence) &&
      report.supportingEvidence.length > 0)

  const checks = {
    summary: Boolean(report.summary || report.executiveSummary),
    objective: hasObjective,
    findings: hasFindings,
    confidence: hasConfidence,
    references: hasReferences,
    statusReady: report.status === 'ready' || report.status == null,
  }
  const present = Object.keys(checks).filter((k) => checks[k])
  const missing = Object.keys(checks).filter((k) => !checks[k])
  const score = Number((present.length / Object.keys(checks).length).toFixed(4))
  return {
    complete: missing.length === 0,
    score,
    missing,
    present,
  }
}

/**
 * @param {{ nodes?: object[], links?: object[] }|null} graph
 * @returns {object}
 */
export function computeGraphIntegrity(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const links = Array.isArray(graph?.links)
    ? graph.links
    : Array.isArray(graph?.edges)
      ? graph.edges
      : []
  const nodeIds = new Set()
  let duplicateNodeIds = 0
  for (const node of nodes) {
    const id = String(node.id || '')
    if (!id) continue
    if (nodeIds.has(id)) duplicateNodeIds += 1
    else nodeIds.add(id)
  }
  const linked = new Set()
  let orphanEdges = 0
  let duplicateEdgeKeys = 0
  const edgeKeys = new Set()

  for (const link of links) {
    const s = String(link.source || '')
    const t = String(link.target || '')
    const key = `${s}|${t}|${link.type || ''}`
    if (edgeKeys.has(key)) duplicateEdgeKeys += 1
    else edgeKeys.add(key)

    const sOk = nodeIds.has(s)
    const tOk = nodeIds.has(t)
    if (!sOk || !tOk) orphanEdges += 1
    if (sOk) linked.add(s)
    if (tOk) linked.add(t)
  }

  const orphanNodes = nodes.filter((n) => !linked.has(String(n.id))).length
  const denom = Math.max(1, nodes.length)
  return {
    nodeCount: nodes.length,
    edgeCount: links.length,
    orphanNodes,
    orphanEdges,
    duplicateNodeIds,
    duplicateEdgeKeys,
    integrityScore:
      nodes.length === 0
        ? null
        : Number(
            (
              1 -
              (orphanNodes + orphanEdges) /
                Math.max(1, nodes.length + links.length)
            ).toFixed(4),
          ),
    orphanRate: Number((orphanNodes / denom).toFixed(4)),
  }
}

/**
 * @param {object|null} report
 * @param {object} analyticalFindings
 * @param {object} critiqueResult
 * @returns {object}
 */
export function computeEvidenceIdValidity(
  report,
  analyticalFindings = {},
  critiqueResult = {},
) {
  const registry = resolveFinalEvidenceRegistry(report)
  const allowed = new Set(registry.evidenceIds || [])
  for (const item of registry.evidenceItems || []) {
    if (item?.evidenceId) allowed.add(String(item.evidenceId))
  }
  for (const item of report?.supportingEvidence || []) {
    if (item?.evidenceId) allowed.add(String(item.evidenceId))
  }
  for (const f of analyticalFindings.findings || []) {
    for (const id of f.evidenceIds || []) allowed.add(String(id))
  }

  let checked = 0
  let valid = 0
  const findings = registry.findings?.length
    ? registry.findings
    : report?.findingConceptMap?.findings || []

  for (const f of findings) {
    for (const id of f.evidenceIds || []) {
      checked += 1
      if (allowed.has(String(id)) || allowed.size === 0) valid += 1
    }
  }
  for (const e of critiqueResult.findingEvaluations || []) {
    for (const id of e.evidenceIds || []) {
      checked += 1
      if (allowed.has(String(id)) || allowed.size === 0) valid += 1
    }
  }
  return {
    checked,
    valid,
    ratio: checked > 0 ? Number((valid / checked).toFixed(4)) : 1,
  }
}

/**
 * @param {object|null} report
 * @param {object[]} papers
 * @returns {object}
 */
export function computePaperIdValidity(report, papers = []) {
  const registry = resolveFinalEvidenceRegistry(report, papers)
  const known = new Set(
    [
      ...(papers || []).map((p) => String(p.paperId || p.id || p._id || '')),
      ...(registry.paperIds || []),
    ].filter(Boolean),
  )
  let checked = 0
  let valid = 0
  const collect = (ids) => {
    for (const id of ids || []) {
      checked += 1
      if (!known.size || known.has(String(id))) valid += 1
    }
  }
  const findings = registry.findings?.length
    ? registry.findings
    : report?.findingConceptMap?.findings || []
  for (const f of findings) collect(f.paperIds)
  for (const r of registry.references || []) {
    if (r.paperId) collect([r.paperId])
  }
  for (const e of registry.evidenceItems || []) {
    if (e.paperId) collect([e.paperId])
  }
  return {
    checked,
    valid,
    ratio: checked > 0 ? Number((valid / checked).toFixed(4)) : 1,
  }
}

/**
 * @param {object} finding
 * @param {object|null|undefined} registry
 * @returns {boolean}
 */
function findingHasResolvableEvidence(finding, registry = null) {
  const evidenceIds = (finding?.evidenceIds || []).map(String).filter(Boolean)
  const paperIds = (finding?.paperIds || []).map(String).filter(Boolean)
  if (!registry) {
    return evidenceIds.length > 0 || paperIds.length > 0
  }

  const knownEvidence = new Set(
    (registry.evidenceIds || []).map(String).filter(Boolean),
  )
  for (const item of registry.evidenceItems || []) {
    if (item?.evidenceId) knownEvidence.add(String(item.evidenceId))
  }
  const knownPapers = new Set(
    (registry.paperIds || []).map(String).filter(Boolean),
  )

  if (knownEvidence.size || knownPapers.size) {
    const linkedEvidence = evidenceIds.some((id) => knownEvidence.has(id))
    const linkedPaper = paperIds.some((id) => knownPapers.has(id))
    return linkedEvidence || linkedPaper
  }

  return evidenceIds.length > 0 || paperIds.length > 0
}

/**
 * @param {object[]} findings
 * @param {object} critiqueResult
 * @param {{ registry?: object|null }} [options]
 * @returns {object}
 */
export function computeSupportedFindingRate(
  findings = [],
  critiqueResult = {},
  options = {},
) {
  const registry = options.registry || null
  const evals = critiqueResult.findingEvaluations || []
  const byId = new Map(evals.map((e) => [String(e.findingId), e]))
  const list = Array.isArray(findings) ? findings : []
  if (!list.length) {
    return { total: 0, supported: 0, unsupported: 0, ratio: null }
  }
  let supported = 0
  let unsupported = 0
  for (const f of list) {
    const ev = byId.get(String(f.id))
    const handling = String(
      f.handling || ev?.recommendedHandling || '',
    ).toUpperCase()
    const support = String(ev?.support || '').toUpperCase()
    const hasEvidence = findingHasResolvableEvidence(f, registry)

    const isExcluded = handling === 'EXCLUDE'
    const isQualifiedWithEvidence =
      handling === 'QUALIFY' &&
      hasEvidence &&
      (support === 'INSUFFICIENT_EVIDENCE' ||
        support === 'PARTIALLY_SUPPORTED' ||
        support === 'UNSUPPORTED')

    const isSupported =
      (support === 'SUPPORTED' && (hasEvidence || !registry)) ||
      (support === 'PARTIALLY_SUPPORTED' && hasEvidence) ||
      isQualifiedWithEvidence ||
      (hasEvidence && !support)

    if (isExcluded) {
      unsupported += 1
    } else if (isSupported) {
      supported += 1
    } else if (
      support === 'INSUFFICIENT_EVIDENCE' ||
      support === 'UNSUPPORTED' ||
      !hasEvidence
    ) {
      unsupported += 1
    } else {
      unsupported += 1
    }
  }
  return {
    total: list.length,
    supported,
    unsupported,
    ratio: Number((supported / list.length).toFixed(4)),
  }
}

/**
 * @param {object[]} findings
 * @returns {object}
 */
export function computeDuplicateFindings(findings = []) {
  const list = Array.isArray(findings) ? findings : []
  const seen = new Map()
  let duplicates = 0
  for (const f of list) {
    const key = normalizeText(f.statement || f.id || '')
    if (!key) continue
    if (seen.has(key)) duplicates += 1
    else seen.set(key, 1)
  }
  return {
    total: list.length,
    uniqueStatements: seen.size,
    duplicates,
  }
}

/**
 * Aggregate deterministic TRACE quality metrics.
 *
 * @param {object} input
 * @returns {object}
 */
export function computeTraceQualityMetrics(input = {}) {
  const evidencePackage = input.evidencePackage || {}
  const analyticalFindings = input.analyticalFindings || {}
  const critiqueResult = input.critiqueResult || {}
  const report = input.report || null
  const graph = input.graph || null
  const llmAccounting = input.llmAccounting || null

  const papers = evidencePackage.papers || []
  const registry = resolveFinalEvidenceRegistry(report, papers)
  const findings =
    registry.findings?.length
      ? registry.findings
      : analyticalFindings.findings || []
  const gaps =
    report?.gaps ||
    critiqueResult.gaps ||
    analyticalFindings.gaps ||
    []
  const contradictions =
    report?.contradictions ||
    critiqueResult.contradictions ||
    []

  const retrievalRelevance = computeRetrievalRelevance(papers)
  const evidenceCoverage = computeEvidenceCoverage(
    critiqueResult.evidenceCoverage || [],
  )
  const findingToEvidenceCoverage = computeFindingToEvidenceCoverage(findings)
  const citationValidity = computeCitationValidity(report, papers)
  const gapToEvidenceCoverage = computeGapToEvidenceCoverage(
    Array.isArray(gaps)
      ? gaps.map((g) => (typeof g === 'string' ? { statement: g } : g))
      : [],
  )
  const contradictionSupport = computeContradictionSupport(
    Array.isArray(contradictions)
      ? contradictions.map((c) =>
          typeof c === 'string' ? { statement: c } : c,
        )
      : [],
  )
  const reportCompleteness = computeReportCompleteness(report)
  const graphIntegrity = computeGraphIntegrity(graph)
  const duplicateFindings = computeDuplicateFindings(
    analyticalFindings.findings || findings,
  )
  const evidenceLevelMetrics = computeEvidenceLevelMetrics(
    registry.evidenceItems?.length
      ? registry.evidenceItems
      : evidencePackage.extractedEvidenceItems || [],
    findings,
    critiqueResult,
  )
  const evidenceIdValidity = computeEvidenceIdValidity(
    report,
    analyticalFindings,
    critiqueResult,
  )
  const paperIdValidity = computePaperIdValidity(report, papers)
  const supportedFindingRate = computeSupportedFindingRate(
    findings,
    critiqueResult,
    { registry },
  )
  const graphOrphanRate = {
    orphanNodes: graphIntegrity.orphanNodes,
    nodeCount: graphIntegrity.nodeCount,
    rate: graphIntegrity.orphanRate,
  }

  return {
    retrievalRelevance,
    evidenceCoverage,
    findingToEvidenceCoverage,
    citationValidity,
    evidenceIdValidity,
    paperIdValidity,
    supportedFindingRate,
    unsupportedFindingRate: {
      ratio:
        supportedFindingRate.total > 0
          ? Number(
              (
                supportedFindingRate.unsupported / supportedFindingRate.total
              ).toFixed(4),
            )
          : null,
      count: supportedFindingRate.unsupported,
    },
    gapToEvidenceCoverage,
    contradictionSupport,
    reportCompleteness,
    graphIntegrity,
    graphOrphanRate,
    orphanNodes: graphIntegrity.orphanNodes,
    orphanEdges: graphIntegrity.orphanEdges,
    duplicateFindings,
    fullTextEvidenceRate: evidenceLevelMetrics.fullTextEvidenceRate,
    strongGapEvidenceRate: evidenceLevelMetrics.strongGapEvidenceRate,
    unsupportedAbsenceClaimRate: evidenceLevelMetrics.unsupportedAbsenceClaimRate,
    tokenUsage: llmAccounting
      ? {
          totalInputTokens: num(llmAccounting.totalInputTokens),
          totalOutputTokens: num(llmAccounting.totalOutputTokens),
          totalTokens: num(llmAccounting.totalTokens),
          totalCalls: num(llmAccounting.totalCalls),
          successfulCalls: num(llmAccounting.successfulCalls),
          failedCalls: num(llmAccounting.failedCalls),
          count429: num(llmAccounting.count429),
          count413: num(llmAccounting.count413),
          retries: num(llmAccounting.retries),
          contextBudgetFailures: num(llmAccounting.contextBudgetFailures),
          totalBudgetCompactions: num(llmAccounting.totalBudgetCompactions),
          unrecoverableProviderFailures: num(
            llmAccounting.unrecoverableProviderFailures,
          ),
          perAgent: llmAccounting.perAgent || null,
        }
      : null,
    latencyAndErrors: {
      durationMs: input.durationMs ?? null,
      providerErrors: llmAccounting?.lastError || null,
      // Attempt-level failed HTTP calls (observability; includes recovered transients)
      providerFailures: num(llmAccounting?.failedCalls),
      // Final / unrecoverable logical provider failures (quality gate)
      unrecoverableProviderFailures: num(
        llmAccounting?.unrecoverableProviderFailures,
      ),
      count429: num(llmAccounting?.count429),
      count413: num(llmAccounting?.count413),
      contextBudgetFailures: num(llmAccounting?.contextBudgetFailures),
    },
  }
}

export default {
  computeRetrievalRelevance,
  computeEvidenceCoverage,
  computeFindingToEvidenceCoverage,
  computeCitationValidity,
  computeEvidenceIdValidity,
  computePaperIdValidity,
  computeSupportedFindingRate,
  computeGapToEvidenceCoverage,
  computeContradictionSupport,
  computeReportCompleteness,
  computeGraphIntegrity,
  computeDuplicateFindings,
  computeTraceQualityMetrics,
}
