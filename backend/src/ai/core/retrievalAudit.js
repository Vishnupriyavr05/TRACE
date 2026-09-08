/**
 * @fileoverview Retrieval pipeline audit helpers (observability only).
 */
import {
  auditFindingEvidenceChain,
  enrichCoverageWithChainStates,
} from './evidenceChain.js'
import {
  buildEvidenceTargets,
  computeEvidenceTargetCoverage,
} from './evidenceTargets.js'
import { extractResearchQueryIntents } from './queryIntents.js'

/**
 * @param {string|null|undefined} source
 * @returns {'SEMANTIC_SCHOLAR'|'OPENALEX'|'USER_UPLOAD'|'OTHER'}
 */
export function normalizePaperOrigin(source) {
  const value = String(source || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (value === 'semantic_scholar' || value === 'semanticscholar') {
    return 'SEMANTIC_SCHOLAR'
  }
  if (value === 'openalex') return 'OPENALEX'
  if (value === 'upload' || value === 'user_upload') return 'USER_UPLOAD'
  return 'OTHER'
}

/**
 * @param {string} providerId
 * @returns {'semanticScholar'|'openAlex'|'other'}
 */
export function providerAuditBucket(providerId) {
  const origin = normalizePaperOrigin(providerId)
  if (origin === 'SEMANTIC_SCHOLAR') return 'semanticScholar'
  if (origin === 'OPENALEX') return 'openAlex'
  return 'other'
}

/**
 * @param {object|null|undefined} paper
 * @returns {{ paperId: string|null, title: string, doi: string|null, origin: string }}
 */
export function summarizePaperForAudit(paper) {
  const paperId = paper?.paperId
    ? String(paper.paperId)
    : paper?._id
      ? String(paper._id)
      : paper?.id
        ? String(paper.id)
        : null
  const origin =
    paper?.provenance?.origin ||
    normalizePaperOrigin(
      paper?.source ||
        paper?.provenance?.providers?.[0] ||
        paper?.sources?.[0]?.provider,
    )
  return {
    paperId,
    title: String(paper?.title || '').slice(0, 300),
    doi: paper?.externalIds?.doi || paper?.doi || null,
    origin,
  }
}

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createRetrievalAudit(input = {}) {
  return {
    userQuery: String(input.userQuery || ''),
    queryIntents: input.queryIntents || null,
    evidenceTargets: input.evidenceTargets || [],
    evidenceTargetCoverage: input.evidenceTargetCoverage || null,
    findingReferenceConsistency: input.findingReferenceConsistency || null,
    plannerQueryCoverage: input.plannerQueryCoverage || null,
    plannerQueries: {
      fromPlanner: [],
      methodSpecific: [],
      supplemental: [],
      executed: [],
    },
    providers: {
      semanticScholar: [],
      openAlex: [],
      other: [],
    },
    paperOrigins: [],
    pipelineCounts: {
      providerResultsTotal: 0,
      afterDeduplication: 0,
      explorerCorpus: 0,
      evidenceAnalyst: 0,
      fullTextAcquisition: 0,
      criticFindings: 0,
      synthesizerReferences: 0,
      finalEvidenceRegistry: 0,
      supportingLiterature: 0,
    },
    droppedPapers: [],
  }
}

/**
 * @param {object} audit
 * @param {object} entry
 */
export function appendProviderQueryResult(audit, entry) {
  const bucket = providerAuditBucket(entry.provider || entry.source)
  audit.providers[bucket].push({
    provider: entry.provider || entry.source || null,
    query: entry.query || '',
    requestedLimit: entry.requestedLimit ?? entry.limit ?? null,
    rawResultCount: entry.rawResultCount ?? null,
    parsedResultCount: entry.parsedResultCount ?? entry.count ?? 0,
    usableResultCount: entry.usableResultCount ?? entry.count ?? 0,
    status: entry.status || 'success',
    papers: Array.isArray(entry.papers) ? entry.papers : [],
    code: entry.code || null,
    message: entry.message || null,
  })
  audit.pipelineCounts.providerResultsTotal += Number(
    entry.usableResultCount ?? entry.count ?? 0,
  )
}

/**
 * @param {object} audit
 * @param {object} drop
 */
export function recordDroppedPaper(audit, drop) {
  audit.droppedPapers.push({
    paperId: drop.paperId ? String(drop.paperId) : null,
    title: String(drop.title || '').slice(0, 300),
    origin: drop.origin ? normalizePaperOrigin(drop.origin) : 'OTHER',
    stage: drop.stage || 'unknown',
    reason: drop.reason || 'unknown',
    relevance:
      typeof drop.relevance === 'number'
        ? drop.relevance
        : typeof drop.queryRelevance === 'number'
          ? drop.queryRelevance
          : null,
  })
}

/**
 * @param {object} audit
 * @param {string} stage
 * @param {number} count
 */
export function setPipelineStageCount(audit, stage, count) {
  if (!Object.prototype.hasOwnProperty.call(audit.pipelineCounts, stage)) return
  audit.pipelineCounts[stage] = count
}

/**
 * @param {object} plan
 * @returns {object[]}
 */
export function plannerQueriesFromPlan(plan) {
  return (plan?.searchQueries || []).map((row) =>
    typeof row === 'string'
      ? { query: row }
      : {
          query: row?.query || '',
          purpose: row?.purpose || '',
        },
  )
}

/**
 * @param {object[]} executionQueries
 * @returns {object[]}
 */
export function executedQueriesFromList(executionQueries = []) {
  return executionQueries.map((row) => ({
    query: row?.query || '',
    purpose: row?.purpose || 'literature_search',
    methodSpecific: Boolean(row?.methodSpecific),
    supplemental: Boolean(row?.supplemental),
    refined: Boolean(row?.refined),
    evidenceTargetIds: row?.evidenceTargetIds || [],
  }))
}

/**
 * @param {Map<string, object>|object[]} papers
 * @returns {object[]}
 */
export function paperOriginsFromCorpus(papers) {
  const list =
    papers instanceof Map ? [...papers.values()] : Array.isArray(papers) ? papers : []
  return list.map((paper) => ({
    ...summarizePaperForAudit(paper),
    matchedQueries: paper?.matchedQueries || [],
    relevance:
      typeof paper?.relevance === 'number' ? paper.relevance : null,
  }))
}

/**
 * @param {object} audit
 * @param {object} input
 * @returns {object}
 */
export function buildExplorerRetrievalAudit(audit, input) {
  const next = audit || createRetrievalAudit({ userQuery: input.userQuery })

  next.userQuery = String(input.userQuery || next.userQuery || '')
  next.queryIntents = input.queryIntents || next.queryIntents || null
  next.evidenceTargets =
    input.evidenceTargets ||
    next.evidenceTargets ||
    buildEvidenceTargets(
      next.queryIntents || extractResearchQueryIntents(next.userQuery),
    )
  next.plannerQueryCoverage =
    input.plannerQueryCoverage || next.plannerQueryCoverage || null
  next.plannerQueries = {
    fromPlanner: plannerQueriesFromPlan(input.plan),
    methodSpecific: (input.methodQueries || []).map((row) => ({
      query: row?.query || '',
      purpose: row?.purpose || '',
      methodLabel: row?.methodLabel || null,
      evidenceTargetIds: row?.evidenceTargetIds || [],
    })),
    supplemental: (input.supplementalQueries || []).map((row) => ({
      query: row?.query || '',
      purpose: row?.purpose || '',
    })),
    executed: executedQueriesFromList(input.executionQueries),
  }

  for (const providerEntry of input.providerEntries || []) {
    appendProviderQueryResult(next, providerEntry)
  }

  next.paperOrigins = paperOriginsFromCorpus(input.papersById || [])
  setPipelineStageCount(
    next,
    'afterDeduplication',
    Number(input.afterDeduplicationCount || 0),
  )
  setPipelineStageCount(
    next,
    'explorerCorpus',
    Number(input.explorerCorpusCount || 0),
  )

  for (const drop of input.droppedPapers || []) {
    recordDroppedPaper(next, drop)
  }

  return next
}

/**
 * @param {object} audit
 * @param {object} input
 * @returns {object}
 */
export function finalizeRetrievalAudit(audit, input) {
  const next = audit || createRetrievalAudit()
  const evidencePackage = input.evidencePackage || {}
  const report = input.report || {}
  const analyticalFindings = input.analyticalFindings || {}
  const registry =
    report?.findingConceptMap?.finalEvidenceRegistry ||
    input.finalEvidenceRegistry ||
    {}

  const corpusPapers = Array.isArray(evidencePackage.papers)
    ? evidencePackage.papers
    : []
  const corpusById = new Map(
    corpusPapers.map((paper) => [String(paper.paperId), paper]),
  )

  const analystSelected = input.analystPaperIds || []
  setPipelineStageCount(
    next,
    'evidenceAnalyst',
    analystSelected.length || Number(input.analystPaperCount || 0),
  )

  const fullTextIds = input.fullTextPaperIds || []
  setPipelineStageCount(
    next,
    'fullTextAcquisition',
    fullTextIds.length || Number(input.fullTextPaperCount || 0),
  )

  const findingPaperIds = new Set()
  for (const finding of analyticalFindings.findings || []) {
    for (const paperId of finding.paperIds || []) {
      findingPaperIds.add(String(paperId))
    }
  }
  setPipelineStageCount(next, 'criticFindings', findingPaperIds.size)

  const synthRefIds = new Set(
    (registry.references || [])
      .map((ref) => String(ref?.paperId || ''))
      .filter(Boolean),
  )
  setPipelineStageCount(
    next,
    'synthesizerReferences',
    synthRefIds.size || Number(input.synthesizerReferenceCount || 0),
  )

  const finalIds = new Set(
    (registry.paperIds || []).map((id) => String(id)).filter(Boolean),
  )
  setPipelineStageCount(next, 'finalEvidenceRegistry', finalIds.size)
  setPipelineStageCount(next, 'supportingLiterature', finalIds.size)
  setPipelineStageCount(next, 'explorerCorpus', corpusPapers.length)

  if (!next.pipelineCounts.afterDeduplication) {
    setPipelineStageCount(next, 'afterDeduplication', corpusPapers.length)
  }

  for (const drop of registry.auditRelevanceDrops || []) {
    recordDroppedPaper(next, drop)
  }

  for (const drop of input.droppedPapers || []) {
    recordDroppedPaper(next, drop)
  }

  if (input.recordAnalystDrops !== false && analystSelected.length) {
    const selectedSet = new Set(analystSelected.map(String))
    for (const paper of corpusPapers) {
      const paperId = String(paper.paperId)
      if (selectedSet.has(paperId)) continue
      recordDroppedPaper(next, {
        ...summarizePaperForAudit(paper),
        stage: 'evidenceAnalyst',
        reason: 'analyst_paper_cap',
        relevance: paper.relevance,
      })
    }
  }

  if (input.recordFullTextDrops !== false && fullTextIds.length) {
    const fullTextSet = new Set(fullTextIds.map(String))
    const analystSet = new Set(analystSelected.map(String))
    for (const paperId of analystSet) {
      if (fullTextSet.has(paperId)) continue
      const paper = corpusById.get(paperId)
      if (!paper) continue
      recordDroppedPaper(next, {
        ...summarizePaperForAudit(paper),
        stage: 'fullTextAcquisition',
        reason: 'full_text_not_acquired',
        relevance: paper.relevance,
      })
    }
  }

  if (input.recordSynthesizerDrops !== false && synthRefIds.size && finalIds.size) {
    for (const paperId of synthRefIds) {
      if (finalIds.has(paperId)) continue
      const paper = corpusById.get(paperId)
      recordDroppedPaper(next, {
        ...(paper ? summarizePaperForAudit(paper) : { paperId, title: '', doi: null }),
        stage: 'finalEvidenceRegistry',
        reason: 'relevance_gate_or_registry_filter',
        relevance: paper?.relevance ?? null,
      })
    }
  }

  next.paperPipelineStages = {
    explorerCorpus: corpusPapers.map((paper) => String(paper.paperId)),
    evidenceAnalyst: analystSelected.map(String),
    fullTextAcquisition: fullTextIds.map(String),
    criticFindings: [...findingPaperIds],
    synthesizerReferences: [...synthRefIds],
    finalEvidenceRegistry: [...finalIds],
    supportingLiterature: [...finalIds],
  }

  // Temporary paper-flow diagnostic. It exposes IDs/counts already present at
  // each completed boundary; it does not participate in any retrieval,
  // filtering, ranking, synthesis, registry, or UI decision.
  const synthesisReferencePaperIds = new Set(
    (report?.findingConceptMap?.references || [])
      .map((ref) => String(ref?.paperId || ''))
      .filter(Boolean),
  )
  const synthesisEvidencePaperIds = new Set()
  for (const item of report?.findingConceptMap?.evidence || report?.supportingEvidence || []) {
    if (item?.paperId) synthesisEvidencePaperIds.add(String(item.paperId))
  }
  const findingLinkedPaperIds = new Set()
  const findingEvidenceIds = new Set()
  for (const finding of report?.findingConceptMap?.findings || []) {
    for (const paperId of finding?.paperIds || []) {
      findingLinkedPaperIds.add(String(paperId))
    }
    for (const evidenceId of finding?.evidenceIds || []) {
      findingEvidenceIds.add(String(evidenceId))
    }
  }
  for (const item of report?.findingConceptMap?.evidence || report?.supportingEvidence || []) {
    if (item?.evidenceId && item?.paperId) {
      if (findingEvidenceIds.has(String(item.evidenceId))) {
        findingLinkedPaperIds.add(String(item.paperId))
      }
    }
  }
  next.paperBoundaryDiagnostics = {
    explorerCorpusPaperIds: corpusPapers.map((paper) => String(paper.paperId)),
    analystPaperIds: analystSelected.map(String),
    synthesizerAvailablePaperIds: (
      report?.generationMetadata?.paperBoundaryDiagnostics?.synthesizerAvailablePaperIds || []
    ).map(String),
    synthesisReferencePaperIds: [...synthesisReferencePaperIds],
    synthesisEvidencePaperIds: [...synthesisEvidencePaperIds],
    findingLinkedPaperIds: [...findingLinkedPaperIds],
    finalEvidenceRegistryPaperIds: [...finalIds],
  }
  next.paperBoundaryDiagnostics.counts = {
    explorerCorpus: next.paperBoundaryDiagnostics.explorerCorpusPaperIds.length,
    analystPapersIncluded: next.paperBoundaryDiagnostics.analystPaperIds.length,
    synthesizerPapersIncluded:
      next.paperBoundaryDiagnostics.synthesizerAvailablePaperIds.length,
    synthesisReferences:
      next.paperBoundaryDiagnostics.synthesisReferencePaperIds.length,
    synthesisEvidence:
      next.paperBoundaryDiagnostics.synthesisEvidencePaperIds.length,
    findingLinked: next.paperBoundaryDiagnostics.findingLinkedPaperIds.length,
    finalEvidenceRegistry:
      next.paperBoundaryDiagnostics.finalEvidenceRegistryPaperIds.length,
  }

  const intents =
    next.queryIntents || extractResearchQueryIntents(next.userQuery || '')
  const evidenceTargets =
    next.evidenceTargets?.length > 0
      ? next.evidenceTargets
      : buildEvidenceTargets(intents)
  next.evidenceTargets = evidenceTargets
  next.evidenceTargetCoverage = enrichCoverageWithChainStates(
    computeEvidenceTargetCoverage({
      evidenceTargets,
      executedQueries:
        next.plannerQueryCoverage?.executed ||
        next.plannerQueries?.executed ||
        [],
      corpusPapers,
      paperEvidenceLevels: evidencePackage.paperEvidenceLevels || {},
      extractedEvidenceItems: evidencePackage.extractedEvidenceItems || [],
      registryPaperIds: [...finalIds],
      findingPaperIds: [...findingPaperIds],
    }),
  )
  next.findingReferenceConsistency = auditFindingEvidenceChain({
    findings: analyticalFindings.findings || report?.findings || [],
    registryPaperIds: [...finalIds],
    registryEvidenceIds: (registry.references || [])
      .flatMap((ref) => ref.evidenceIds || [])
      .map(String),
    evidenceIdToPaperId: registry.evidenceIdToPaperId || {},
    evidenceLevelsById: input.evidenceLevelsById || {},
    extractedEvidenceById: input.extractedEvidenceById || {},
    hasUnsearchedTargets: (next.evidenceTargetCoverage?.notSearchedCount || 0) > 0,
  })

  return next
}

/**
 * @param {object|null|undefined} retrievalObservability
 * @param {object} retrievalAudit
 * @returns {object}
 */
export function attachRetrievalAudit(retrievalObservability, retrievalAudit) {
  return {
    ...(retrievalObservability || {}),
    retrievalAudit,
  }
}

export default {
  normalizePaperOrigin,
  providerAuditBucket,
  summarizePaperForAudit,
  createRetrievalAudit,
  appendProviderQueryResult,
  recordDroppedPaper,
  setPipelineStageCount,
  plannerQueriesFromPlan,
  executedQueriesFromList,
  paperOriginsFromCorpus,
  buildExplorerRetrievalAudit,
  finalizeRetrievalAudit,
  attachRetrievalAudit,
}
