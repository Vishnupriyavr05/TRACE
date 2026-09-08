/**
 * @fileoverview Explorer service — ResearchPlan → Discovery + GraphRAG → EvidencePackage.
 * Does not call provider APIs directly. Does not build/modify the knowledge graph.
 * Callable later by ResearchOrchestrator. Does not call other agents.
 */
import { requireOwnedSession } from '../../services/researchSession.service.js'
import * as activityService from '../../services/researchActivity.service.js'
import * as discoveryService from '../../services/researchDiscovery.service.js'
import * as graphRagService from '../../graphRag/graphRag.service.js'
import { AppError } from '../../utils/AppError.js'
import { createRunId } from '../core/runId.js'
import { runAgent } from '../core/agentRunner.js'
import { getSafeAiMeta } from '../providers/index.js'
import { AiConfigError } from '../core/errors.js'
import {
  createExplorerAdvisoryAgent,
  defaultExplorerAdvisory,
} from './explorer.agent.js'
import {
  getExplorerLimits,
  boundSearchQueries,
  resolvePerQueryDiscoveryLimit,
  buildSupplementalDiscoveryQueries,
  buildMethodSpecificDiscoveryQueries,
  collectPriorityTargets,
  queriesNearlyEqual,
  extractResearchQueryIntents,
} from './explorer.limits.js'
import { NAMED_METHOD_PATTERNS } from './explorer.methodPatterns.js'
import { mergePdfCandidateUrls } from '../../integrations/utils/pdfCandidateUrls.js'
import {
  validateExplorerInput,
  validateEvidencePackage,
} from '../validators/explorer.schema.js'
import {
  ensureSessionUploadsInCorpus,
  mapUploadPaperToEvidencePackageEntry,
} from '../../services/uploadedPaperIntegration.service.js'
import {
  buildExplorerRetrievalAudit,
  attachRetrievalAudit,
  normalizePaperOrigin,
  summarizePaperForAudit,
} from '../core/retrievalAudit.js'
import {
  applyEvidenceTargetRankingAdjustments,
  buildCapKeepSet,
  buildEvidenceTargets,
} from '../core/evidenceTargets.js'
import { scorePaper } from '../../graphRag/relevanceScorer.js'

/**
 * @param {object[]} a
 * @param {object[]} b
 * @returns {object[]}
 */
function mergeFullTextSourceRows(a = [], b = []) {
  const seen = new Set()
  /** @type {object[]} */
  const out = []
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      if (!row?.url) continue
      const key = `${row.type || 'pdf'}|${String(row.url).trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

/**
 * @param {object[]} a
 * @param {object[]} b
 * @returns {object[]}
 */
function mergeOpenAlexLocationRows(a = [], b = []) {
  const seen = new Set()
  /** @type {object[]} */
  const out = []
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      const key = `${row?.pdf_url || ''}|${row?.landing_page_url || ''}`.toLowerCase()
      if (!key.replace(/\|/g, '') || seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

export const EXPLORER_ACTIVITY = Object.freeze({
  STARTED: 'AI_EXPLORER_STARTED',
  COMPLETED: 'AI_EXPLORER_COMPLETED',
  FAILED: 'AI_EXPLORER_FAILED',
})

const ACTIVE_SOURCES = Object.freeze(['openalex', 'semantic_scholar'])

/**
 * @param {object} paper
 * @returns {string}
 */
function paperIdOf(paper) {
  return paper?._id ? String(paper._id) : paper?.id ? String(paper.id) : ''
}

/**
 * @param {object} paper
 * @returns {string[]}
 */
function providersOf(paper) {
  if (Array.isArray(paper?.sources) && paper.sources.length) {
    return paper.sources.map((s) => s.provider).filter(Boolean)
  }
  return paper?.source ? [paper.source] : []
}

/**
 * Merge discovered papers across queries with provenance.
 *
 * @param {Map<string, object>} byId
 * @param {object[]} papers
 * @param {string} queryText
 * @param {string} sessionId
 */
function mergePapers(byId, papers, queryText, sessionId) {
  for (const paper of papers || []) {
    const paperId = paperIdOf(paper)
    if (!paperId) continue

    const existing = byId.get(paperId)
    if (existing) {
      if (!existing.matchedQueries.includes(queryText)) {
        existing.matchedQueries.push(queryText)
      }
      const providers = new Set([
        ...(existing.provenance.providers || []),
        ...providersOf(paper),
      ])
      existing.provenance.providers = [...providers]
      if (!existing.provenance.discoveryQueries.includes(queryText)) {
        existing.provenance.discoveryQueries.push(queryText)
      }
      if (!existing.url && (paper.url || paper.pdfUrl)) {
        existing.url = paper.url || paper.pdfUrl
      }
      if (!existing.pdfUrl && (paper.pdfUrl || paper.url)) {
        existing.pdfUrl = paper.pdfUrl || paper.url
      }
      if (Array.isArray(paper.pdfCandidates) && paper.pdfCandidates.length) {
        existing.pdfCandidates = mergePdfCandidateUrls(
          existing.pdfCandidates,
          paper.pdfCandidates,
          existing.pdfUrl,
          paper.pdfUrl,
          existing.url,
          paper.url,
        )
      } else if (!existing.pdfCandidates?.length) {
        existing.pdfCandidates = mergePdfCandidateUrls(
          existing.pdfUrl,
          existing.url,
          paper.pdfUrl,
          paper.url,
        )
      }
      existing.fullTextSources = mergeFullTextSourceRows(
        existing.fullTextSources,
        paper.fullTextSources,
      )
      existing.openAlexLocations = mergeOpenAlexLocationRows(
        existing.openAlexLocations,
        paper.openAlexLocations,
      )
      if (paper.integrity && !existing.integrity) {
        existing.integrity = paper.integrity
      }
      if (existing.openAccess == null && paper.openAccess != null) {
        existing.openAccess = paper.openAccess
      }
      continue
    }

    byId.set(paperId, {
      paperId,
      source: paper.source || null,
      discoveryMethod: paper.discoveryMethod || null,
      title: paper.title || '',
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      abstract: paper.abstract || '',
      venue: paper.venue || '',
      year: paper.year ?? null,
      doi: paper.externalIds?.doi || paper.doi || null,
      keywords: Array.isArray(paper.keywords) ? paper.keywords : [],
      citationCount: paper.citationCount ?? 0,
      url: paper.url || paper.pdfUrl || null,
      pdfUrl: paper.pdfUrl || paper.url || null,
      pdfCandidates: mergePdfCandidateUrls(
        paper.pdfCandidates,
        paper.pdfUrl,
        paper.url,
      ),
      fullTextSources: Array.isArray(paper.fullTextSources)
        ? paper.fullTextSources
        : [],
      openAlexLocations: Array.isArray(paper.openAlexLocations)
        ? paper.openAlexLocations
        : [],
      openAccess: paper.openAccess ?? paper.integrity?.openAccess ?? null,
      integrity: paper.integrity || {
        peerReviewed: paper.peerReviewed ?? null,
        openAccess: paper.openAccess ?? null,
        retractionStatus: 'none',
        correctionStatus: 'none',
        venueQuality: null,
      },
      externalIds: paper.externalIds || {},
      relevance: null,
      matchedQueries: [queryText],
      provenance: {
        sessionId,
        paperId,
        source: paper.source || null,
        origin:
          paper.provenance?.origin ||
          normalizePaperOrigin(paper.source || providersOf(paper)[0]),
        providers: providersOf(paper),
        discoveryQueries: [queryText],
        nodeId: null,
      },
    })
  }
}

/**
 * Deterministic query-aware relevance before LLM stages.
 * Uses existing scorePaper (token overlap) against the research question,
 * matched discovery queries, and planner dimensions — no domain hardcoding.
 *
 * @param {Map<string, object>} byId
 * @param {string} researchQuestion
 * @param {string[]} [researchDimensions]
 */
export function applyQueryAwareRelevance(
  byId,
  researchQuestion,
  researchDimensions = []
) {
  const dimensionText = (researchDimensions || [])
    .map((d) => (typeof d === 'string' ? d : d?.name || d?.label || ''))
    .filter(Boolean)
    .join(' ')

  for (const entry of byId.values()) {
    const paperLike = {
      _id: entry.paperId,
      id: entry.paperId,
      title: entry.title,
      abstract: entry.abstract,
      authors: entry.authors,
      venue: entry.venue,
      keywords: entry.keywords,
    }

    const queries = [
      researchQuestion,
      ...(entry.matchedQueries || []),
      dimensionText,
    ].filter((q) => typeof q === 'string' && q.trim())

    let queryScore = 0
    for (const q of queries) {
      const scored = scorePaper(q, paperLike)
      if (scored.score > queryScore) queryScore = scored.score
    }

    entry.queryRelevance = queryScore

    const graphScore =
      typeof entry.relevance === 'number' ? entry.relevance : null

    // Prefer query match; GraphRAG may boost but cannot fully rescue weak match.
    let blended
    if (graphScore == null) {
      blended = queryScore
    } else if (queryScore < 0.08) {
      blended = Math.min(graphScore, queryScore + 0.06)
    } else {
      blended = Math.min(
        1,
        queryScore * 0.72 + Math.min(graphScore, queryScore + 0.28) * 0.28
      )
    }

    const multiQueryMatches = (entry.matchedQueries || []).length
    if (multiQueryMatches > 1) {
      blended = Math.min(
        1,
        blended + Math.min(0.12, (multiQueryMatches - 1) * 0.04),
      )
    }

    entry.relevance = Number(blended.toFixed(4))
  }
}

/**
 * Boost papers that explicitly mention a user-requested method in title/abstract.
 *
 * @param {Map<string, object>} byId
 * @param {string} researchQuestion
 */
export function applyExplicitMethodRelevanceBoost(byId, researchQuestion) {
  const question = String(researchQuestion || '')
  if (!question.trim()) return

  for (const entry of byId.values()) {
    const haystack = `${entry.title || ''} ${entry.abstract || ''} ${Array.isArray(entry.keywords) ? entry.keywords.join(' ') : ''}`
    for (const method of NAMED_METHOD_PATTERNS) {
      if (!method.pattern.test(question) || !method.pattern.test(haystack)) continue
      const current = typeof entry.relevance === 'number' ? entry.relevance : 0
      entry.relevance = Number(Math.min(1, current + 0.1).toFixed(4))
      entry.explicitMethodMatch = method.label
      break
    }
  }
}

/**
 * Attach GraphRAG relevance / node provenance onto merged papers.
 *
 * @param {Map<string, object>} byId
 * @param {object} graphContext
 */
function attachGraphRelevance(byId, graphContext) {
  for (const item of graphContext?.evidence || []) {
    const paperId = String(item.paperId || '')
    if (!paperId || !byId.has(paperId)) continue
    const entry = byId.get(paperId)
    const score =
      typeof item.score === 'number' ? item.score : entry.relevance
    if (entry.relevance == null || score > entry.relevance) {
      entry.relevance = score
    }
    if (item.nodeId) {
      entry.provenance.nodeId = item.nodeId
    }
  }

  for (const paper of graphContext?.papers || []) {
    const paperId = String(paper.paperId || '')
    if (!paperId || !byId.has(paperId)) continue
    const entry = byId.get(paperId)
    if (
      typeof paper.relevanceScore === 'number' &&
      (entry.relevance == null || paper.relevanceScore > entry.relevance)
    ) {
      entry.relevance = paper.relevanceScore
    }
    if (paper.nodeId) entry.provenance.nodeId = paper.nodeId
  }
}

/**
 * Build retrieval-level evidence gaps (not scientific conclusions).
 *
 * @param {object} args
 * @returns {object[]}
 */
function buildEvidenceGaps({
  searches,
  papers,
  graphEvidence,
  plan,
  advisoryHints,
  discoveryAllFailed,
  queryLimitReached,
  paperCapReached,
}) {
  /** @type {object[]} */
  const gaps = []

  for (const search of searches) {
    if (search.status === 'error' || search.allSourcesFailed) {
      gaps.push({
        type: 'provider_failure',
        severity: 'major',
        message: `Discovery returned no usable results for query “${search.query}”.`,
        query: search.query,
        details: search.sourceResults || [],
      })
    } else if (search.papersFound === 0) {
      gaps.push({
        type: 'empty_query_results',
        severity: 'major',
        message: `No papers were found for search query “${search.query}”.`,
        query: search.query,
      })
    }
  }

  if (discoveryAllFailed) {
    gaps.push({
      type: 'discovery_unavailable',
      severity: 'critical',
      message:
        'All Discovery searches failed or returned empty. Evidence package has no new literature.',
    })
  }

  if (papers.length < 3 && !discoveryAllFailed) {
    gaps.push({
      type: 'insufficient_unique_papers',
      severity: 'major',
      message: `Only ${papers.length} unique canonical paper(s) were collected.`,
    })
  }

  const missingMeta = papers.filter(
    (p) => !p.abstract || !p.doi || !(p.authors && p.authors.length)
  ).length
  if (papers.length > 0 && missingMeta / papers.length >= 0.5) {
    gaps.push({
      type: 'missing_metadata',
      severity: 'minor',
      message:
        'A large share of collected papers are missing abstract, DOI, or author metadata.',
    })
  }

  const emptyGraphContexts = graphEvidence.filter(
    (g) => !g.nodes?.length && !g.edges?.length
  )
  if (graphEvidence.length > 0 && emptyGraphContexts.length === graphEvidence.length) {
    gaps.push({
      type: 'no_graph_context',
      severity: 'major',
      message:
        'GraphRAG returned no graph nodes/edges for the selected queries (empty or missing graph).',
    })
  }

  for (const requirement of plan.evidenceRequirements || []) {
    const tokens = String(requirement)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
    if (!tokens.length) continue
    const hit = papers.some((paper) => {
      const hay = `${paper.title} ${paper.abstract} ${(paper.keywords || []).join(' ')}`.toLowerCase()
      return tokens.some((t) => hay.includes(t))
    })
    if (!hit) {
      gaps.push({
        type: 'unmet_evidence_requirement',
        severity: 'major',
        message: `Sparse retrieval coverage for evidence requirement: ${requirement}`,
        requirement,
      })
    }
  }

  if (queryLimitReached) {
    gaps.push({
      type: 'search_limit_reached',
      severity: 'info',
      message: 'Planner produced more search queries than the Explorer limit; extras were not executed.',
    })
  }

  if (paperCapReached) {
    gaps.push({
      type: 'paper_cap_reached',
      severity: 'info',
      message: 'Unique paper collection hit the configured MAX_TOTAL_PAPERS cap.',
    })
  }

  for (const hint of advisoryHints || []) {
    gaps.push({
      type: 'advisory_hint',
      severity: 'info',
      message: hint,
    })
  }

  return gaps
}

/**
 * Light LLM advisory with deterministic fallback.
 *
 * @param {object} args
 */
async function getExplorerAdvisory({
  researchQuestion,
  plan,
  plannedQueries,
  limits,
  runId,
}) {
  const fallback = defaultExplorerAdvisory(
    plannedQueries.length,
    limits.maxGraphRagCalls
  )

  try {
    const agent = createExplorerAdvisoryAgent({
      plannedCount: plannedQueries.length,
      maxGraphRag: limits.maxGraphRagCalls,
      maxRefined: limits.maxRefinedQueries,
    })

    const result = await runAgent(
      agent,
      {
        researchQuestion,
        plan,
        plannedQueries,
        maxGraphRagCalls: limits.maxGraphRagCalls,
        maxRefinedQueries: limits.maxRefinedQueries,
      },
      { runId }
    )

    return {
      advisory: result.output,
      source: 'llm',
      meta: result.meta,
    }
  } catch (error) {
    // Config / provider / output failures fall back deterministically
    return {
      advisory: fallback,
      source: error instanceof AiConfigError ? 'fallback_unconfigured' : 'fallback_error',
      errorCode: error?.code || error?.name || 'AI_ERROR',
      meta: getSafeAiMeta(),
    }
  }
}

/**
 * Execute Explorer for an owned session.
 *
 * @param {string} userId
 * @param {{ sessionId: string, query: string, plan: object }} input
 * @returns {Promise<{ runId: string, agent: string, evidencePackage: object, meta: object }>}
 */
export async function exploreResearchPlan(userId, input) {
  const validated = validateExplorerInput(input)
  if (!validated.ok) {
    throw new AppError(
      'Invalid Explorer input',
      400,
      validated.errors || ['Validation failed']
    )
  }

  const { sessionId, query, plan } = validated.value
  await requireOwnedSession(userId, sessionId)

  const runId = createRunId()
  const limits = getExplorerLimits()
  const startedAt = Date.now()
  const safeMeta = getSafeAiMeta()

  await activityService.createActivity(userId, {
    sessionId,
    type: EXPLORER_ACTIVITY.STARTED,
    description: 'Explorer agent started',
    message: 'Explorer agent started',
    agentId: 'explorer',
    metadata: {
      runId,
      agent: 'explorer',
      queryPreview: query.slice(0, 160),
      plannedQueryCount: plan.searchQueries.length,
      provider: safeMeta.provider,
      model: safeMeta.model,
    },
    severity: 'info',
  })

  try {
    const supplementalQueries = buildSupplementalDiscoveryQueries(query, plan)
    const queryIntents = extractResearchQueryIntents(query)
    const maxTargetSlots =
      queryIntents.methods.length > 0
        ? Math.min(5, Math.max(queryIntents.methods.length, limits.maxSearchQueries - 1))
        : 0
    const methodQueries = buildMethodSpecificDiscoveryQueries(query, plan, {
      maxSlots: maxTargetSlots,
    })
    const evidenceTargets = buildEvidenceTargets(queryIntents)

    const plannerBudget = Math.max(
      1,
      limits.maxSearchQueries - methodQueries.length,
    )
    const bounded = boundSearchQueries(
      plan.searchQueries,
      plannerBudget,
      {
        researchQuestion: query,
        researchDimensions:
          plan.researchDimensions || plan.dimensions || [],
      },
    )

    const priorityTargets = collectPriorityTargets(plan, query)

    const advisoryResult = await getExplorerAdvisory({
      researchQuestion: query,
      plan,
      plannedQueries: bounded.queries,
      limits,
      runId,
    })

    /** @type {object[]} */
    const executionQueries = []
    for (const methodQuery of methodQueries) {
      if (executionQueries.length >= limits.maxSearchQueries) break
      executionQueries.push(methodQuery)
    }
    for (const plannerQuery of bounded.queries) {
      if (executionQueries.length >= limits.maxSearchQueries) break
      if (
        executionQueries.some((row) =>
          queriesNearlyEqual(row.query, plannerQuery.query),
        )
      ) {
        continue
      }
      executionQueries.push(plannerQuery)
    }
    for (const supplementalQuery of supplementalQueries) {
      if (executionQueries.length >= limits.maxSearchQueries) break
      if (
        executionQueries.some((row) =>
          queriesNearlyEqual(row.query, supplementalQuery.query),
        )
      ) {
        continue
      }
      executionQueries.push(supplementalQuery)
    }

    const selectedPlannerKeys = new Set(
      bounded.queries.map((row) =>
        String(typeof row === 'string' ? row : row?.query || '').toLowerCase(),
      ),
    )
    const droppedPlannerQueries = (plan.searchQueries || [])
      .map((row) =>
        typeof row === 'string'
          ? { query: row, purpose: '' }
          : { query: row?.query || '', purpose: row?.purpose || '' },
      )
      .filter((row) => row.query && !selectedPlannerKeys.has(row.query.toLowerCase()))
    for (const refined of advisoryResult.advisory.refinedQueries || []) {
      if (executionQueries.length >= limits.maxSearchQueries) break
      // Avoid exact duplicates
      if (
        executionQueries.some(
          (q) => q.query.toLowerCase() === refined.query.toLowerCase()
        )
      ) {
        continue
      }
      executionQueries.push({
        query: refined.query,
        purpose: refined.purpose || 'refinement',
        refined: true,
        basedOnIndex: refined.basedOnIndex,
      })
    }

    /** @type {Map<string, object>} */
    const papersById = new Map()
    /** @type {object[]} */
    const searches = []
    /** @type {object[]} */
    const providerStatuses = []
    /** @type {object[]} */
    const providerAuditEntries = []
    let discoveryAllFailed = executionQueries.length === 0
    let anyDiscoverySuccess = false
    let totalPapersDiscovered = 0

    const uploadPapers = await ensureSessionUploadsInCorpus(userId, sessionId)
    for (const uploadPaper of uploadPapers) {
      const entry = mapUploadPaperToEvidencePackageEntry(uploadPaper)
      mergePapers(papersById, [entry], 'user_upload', sessionId)
      anyDiscoverySuccess = true
    }
    for (const item of executionQueries) {
      const queryLimit = resolvePerQueryDiscoveryLimit(
        limits,
        executionQueries.length,
        item,
      )

      try {
        const result = await discoveryService.discoverPapers(userId, {
          sessionId,
          query: item.query,
          sources: [...ACTIVE_SOURCES],
          limit: queryLimit,
        })

        const paperIds = (result.papers || []).map(paperIdOf).filter(Boolean)
        mergePapers(papersById, result.papers || [], item.query, sessionId)
        totalPapersDiscovered += result.papers?.length || 0

        if (!result.allSourcesFailed && (result.papers?.length || 0) > 0) {
          anyDiscoverySuccess = true
        }

        searches.push({
          query: item.query,
          purpose: item.purpose || 'literature_search',
          refined: Boolean(item.refined),
          papersFound: result.papers?.length || 0,
          paperIds,
          sourceResults: result.sourceResults || [],
          partial: Boolean(result.partial),
          allSourcesFailed: Boolean(result.allSourcesFailed),
          status: result.allSourcesFailed ? 'error' : 'success',
        })

        for (const sr of result.sourceResults || []) {
          providerStatuses.push({
            query: item.query,
            ...sr,
          })
          providerAuditEntries.push({
            provider: sr.provider || sr.source,
            query: item.query,
            requestedLimit: sr.requestedLimit ?? queryLimit,
            rawResultCount: sr.rawResultCount ?? null,
            parsedResultCount: sr.parsedResultCount ?? sr.count ?? 0,
            usableResultCount: sr.usableResultCount ?? sr.count ?? 0,
            status: sr.status || 'success',
            papers: sr.papers || [],
            code: sr.code || null,
            message: sr.message || null,
          })
        }
      } catch (error) {
        searches.push({
          query: item.query,
          purpose: item.purpose || 'literature_search',
          refined: Boolean(item.refined),
          papersFound: 0,
          paperIds: [],
          sourceResults: [],
          partial: false,
          allSourcesFailed: true,
          status: 'error',
          error: error?.message || 'Discovery failed',
        })
      }
    }

    for (const target of priorityTargets) {
      const searchQuery =
        target.type === 'doi'
          ? target.value
          : target.type === 'title'
            ? `"${target.value}"`
            : target.value
      try {
        const result = await discoveryService.discoverPapers(userId, {
          sessionId,
          query: searchQuery,
          sources: [...ACTIVE_SOURCES],
          limit: Math.min(3, limits.maxResultsPerQuery),
        })
        mergePapers(
          papersById,
          result.papers || [],
          `priority:${searchQuery}`,
          sessionId,
        )
        if (!result.allSourcesFailed && (result.papers?.length || 0) > 0) {
          anyDiscoverySuccess = true
        }
        for (const paper of result.papers || []) {
          const paperId = paperIdOf(paper)
          if (!paperId || !papersById.has(paperId)) continue
          const entry = papersById.get(paperId)
          entry.priorityTarget = true
          entry.provenance = entry.provenance || {}
          entry.provenance.priorityTarget = {
            type: target.type,
            value: target.value,
            reason: target.reason || '',
          }
        }
        for (const sr of result.sourceResults || []) {
          providerAuditEntries.push({
            provider: sr.provider || sr.source,
            query: searchQuery,
            requestedLimit: sr.requestedLimit ?? Math.min(3, limits.maxResultsPerQuery),
            rawResultCount: sr.rawResultCount ?? null,
            parsedResultCount: sr.parsedResultCount ?? sr.count ?? 0,
            usableResultCount: sr.usableResultCount ?? sr.count ?? 0,
            status: sr.status || 'success',
            papers: sr.papers || [],
            code: sr.code || null,
            message: sr.message || null,
          })
        }
      } catch {
        // Priority target lookup is best-effort
      }
    }

    discoveryAllFailed = !anyDiscoverySuccess

    // Query-aware relevance before cap so loosely related API hits drop first
    const planDimensions =
      plan.researchDimensions ||
      plan.dimensions ||
      advisoryResult?.advisory?.researchDimensions ||
      []
    applyQueryAwareRelevance(papersById, query, planDimensions)
    applyExplicitMethodRelevanceBoost(papersById, query)
    applyEvidenceTargetRankingAdjustments(papersById, queryIntents)

    for (const entry of papersById.values()) {
      entry.pipelineState = {
        discovered: true,
        inCorpus: true,
        hasAbstract: Boolean(entry.abstract),
        fullTextAvailable: false,
        evidenceUsed: false,
        citedInReport: false,
      }
      if (entry.priorityTarget) {
        const current =
          typeof entry.relevance === 'number' ? entry.relevance : 0
        entry.relevance = Number(Math.max(current, 0.82).toFixed(4))
      }
    }

    // Cap unique papers by relevance (stable tie-break on paperId)
    let paperCapReached = false
    /** @type {object[]} */
    const explorerCapDrops = []
    let papers = [...papersById.values()].sort((a, b) => {
      const ra = typeof a.relevance === 'number' ? a.relevance : -1
      const rb = typeof b.relevance === 'number' ? b.relevance : -1
      return rb - ra || a.paperId.localeCompare(b.paperId)
    })
    const afterDeduplicationCount = papers.length
    if (papers.length > limits.maxTotalPapers) {
      paperCapReached = true
      const keep = buildCapKeepSet(papers, queryIntents, limits.maxTotalPapers)
      for (const paper of papers) {
        if (keep.has(String(paper.paperId))) continue
        explorerCapDrops.push({
          ...summarizePaperForAudit(paper),
          stage: 'explorerCorpus',
          reason: 'paper_cap',
          relevance: paper.relevance,
        })
      }
      for (const id of papersById.keys()) {
        if (!keep.has(String(id))) papersById.delete(id)
      }
      papers = [...papersById.values()]
    }

    // GraphRAG for advised planned query indexes (not refined unless selected)
    const graphIndexes = (
      advisoryResult.advisory.graphRagQueryIndexes || []
    ).slice(0, limits.maxGraphRagCalls)

    /** @type {object[]} */
    const graphEvidence = []
    const graphQueries = []

    for (const index of graphIndexes) {
      const planned = bounded.queries[index]
      if (!planned?.query) continue
      if (graphQueries.length >= limits.maxGraphRagCalls) break
      graphQueries.push(planned.query)

      try {
        const ctx = await graphRagService.retrieveGraphContext(userId, {
          sessionId,
          query: planned.query,
          topK: Math.min(10, limits.maxResultsPerQuery),
          depth: 1,
        })

        attachGraphRelevance(papersById, ctx)
        graphEvidence.push({
          query: planned.query,
          papers: ctx.papers || [],
          nodes: ctx.nodes || [],
          edges: ctx.edges || [],
          paths: ctx.paths || [],
          evidence: ctx.evidence || [],
          retrievalStats: ctx.retrievalStats || {},
          provenance: {
            sessionId,
            query: planned.query,
          },
        })
      } catch (error) {
        graphEvidence.push({
          query: planned.query,
          papers: [],
          nodes: [],
          edges: [],
          paths: [],
          evidence: [],
          retrievalStats: { error: true },
          error: error?.message || 'GraphRAG retrieval failed',
          provenance: {
            sessionId,
            query: planned.query,
          },
        })
      }
    }

    // Re-blend after GraphRAG so graph scores cannot outweigh weak query match
    applyQueryAwareRelevance(papersById, query, planDimensions)
    applyExplicitMethodRelevanceBoost(papersById, query)
    applyEvidenceTargetRankingAdjustments(papersById, queryIntents)

    papers = [...papersById.values()].sort((a, b) => {
      const ra = typeof a.relevance === 'number' ? a.relevance : -1
      const rb = typeof b.relevance === 'number' ? b.relevance : -1
      return rb - ra || a.paperId.localeCompare(b.paperId)
    })

    const evidenceGaps = buildEvidenceGaps({
      searches,
      papers,
      graphEvidence,
      plan,
      advisoryHints: advisoryResult.advisory.gapHints || [],
      discoveryAllFailed,
      queryLimitReached: bounded.truncated,
      paperCapReached,
    })

    const retrievalAudit = buildExplorerRetrievalAudit(null, {
      userQuery: query,
      plan,
      methodQueries,
      supplementalQueries,
      executionQueries,
      providerEntries: providerAuditEntries,
      papersById,
      afterDeduplicationCount,
      explorerCorpusCount: papers.length,
      droppedPapers: explorerCapDrops,
      queryIntents,
      evidenceTargets,
      plannerQueryCoverage: {
        planned: (plan.searchQueries || []).map((row) =>
          typeof row === 'string'
            ? { query: row, purpose: '' }
            : { query: row?.query || '', purpose: row?.purpose || '' },
        ),
        selected: bounded.queries.map((row) =>
          typeof row === 'string'
            ? { query: row, purpose: '' }
            : { query: row?.query || '', purpose: row?.purpose || '' },
        ),
        dropped: droppedPlannerQueries,
        executed: executionQueries.map((row) => ({
          query: row?.query || '',
          purpose: row?.purpose || '',
          methodSpecific: Boolean(row?.methodSpecific),
          supplemental: Boolean(row?.supplemental),
          refined: Boolean(row?.refined),
          evidenceTargetIds: row?.evidenceTargetIds || [],
        })),
        truncated: bounded.truncated,
      },
    })

    const retrievalObservability = attachRetrievalAudit(
      {
      plannerQueries: retrievalAudit.plannerQueries.fromPlanner.map(
        (row) => row.query,
      ),
      methodSpecificQueries: methodQueries.map((row) => row.query),
      supplementalQueries: supplementalQueries.map((row) => row.query),
      executedQueries: searches.map((row) => ({
        query: row.query,
        purpose: row.purpose || 'literature_search',
        paperIds: row.paperIds || [],
        papersFound: row.papersFound || 0,
        sourceResults: (row.sourceResults || []).map((sourceRow) => ({
          provider: sourceRow.provider || sourceRow.source || null,
          status: sourceRow.status || null,
          count: sourceRow.count ?? sourceRow.papersFound ?? null,
          rawResultCount: sourceRow.rawResultCount ?? null,
          parsedResultCount: sourceRow.parsedResultCount ?? null,
          usableResultCount: sourceRow.usableResultCount ?? null,
        })),
        status: row.status || null,
      })),
      paperOrigins: retrievalAudit.paperOrigins,
      deduplicatedPaperCount: papers.length,
      uploadedPaperIds: [...papersById.values()]
        .filter((paper) => paper.source === 'upload')
        .map((paper) => paper.paperId),
      pipelineCounts: retrievalAudit.pipelineCounts,
      droppedPapers: retrievalAudit.droppedPapers,
    },
      retrievalAudit,
    )

    const evidencePackage = {
      runId,
      sessionId,
      researchQuestion: query,
      planSummary: {
        objective: plan.objective,
        researchDimensions: plan.researchDimensions,
        evidenceRequirements: plan.evidenceRequirements,
        stoppingCriteria: plan.stoppingCriteria,
      },
      searches,
      papers,
      graphEvidence,
      evidenceGaps,
      explorationStats: {
        queriesExecuted: searches.length,
        papersDiscovered: totalPapersDiscovered,
        uniqueCanonicalPapers: papers.length,
        graphRagQueries: graphQueries.length,
        plannedQueriesOriginal: bounded.originalCount,
        plannedQueriesBounded: bounded.queries.length,
        supplementalQueriesUsed: supplementalQueries.length,
        methodSpecificQueriesUsed: methodQueries.length,
        priorityTargetsResolved: priorityTargets.length,
        refinedQueriesUsed: searches.filter((s) => s.refined).length,
        queryLimitReached: bounded.truncated,
        paperCapReached,
        discoveryAllFailed,
        advisorySource: advisoryResult.source,
      },
      limits,
      providerStatuses,
      retrievalObservability,
    }

    const packageCheck = validateEvidencePackage(evidencePackage)
    if (!packageCheck.ok) {
      throw new AppError(
        'Explorer produced an invalid EvidencePackage',
        502,
        packageCheck.errors
      )
    }

    const durationMs = Date.now() - startedAt

    await activityService.createActivity(userId, {
      sessionId,
      type: EXPLORER_ACTIVITY.COMPLETED,
      description: 'Explorer agent completed',
      message: 'Explorer agent completed',
      agentId: 'explorer',
      metadata: {
        runId,
        agent: 'explorer',
        success: true,
        durationMs,
        queriesExecuted: evidencePackage.explorationStats.queriesExecuted,
        uniqueCanonicalPapers:
          evidencePackage.explorationStats.uniqueCanonicalPapers,
        graphRagQueries: evidencePackage.explorationStats.graphRagQueries,
        discoveryAllFailed,
        advisorySource: advisoryResult.source,
        provider: safeMeta.provider,
        model: safeMeta.model,
      },
      payload: {
        explorationStats: evidencePackage.explorationStats,
        evidenceGapCount: evidenceGaps.length,
      },
      severity: discoveryAllFailed ? 'warning' : 'info',
    })

    return {
      runId,
      agent: 'explorer',
      evidencePackage,
      meta: {
        durationMs,
        success: true,
        advisorySource: advisoryResult.source,
        provider: safeMeta.provider,
        model: safeMeta.model,
      },
    }
  } catch (error) {
    try {
      await activityService.createActivity(userId, {
        sessionId,
        type: EXPLORER_ACTIVITY.FAILED,
        description: error?.message || 'Explorer agent failed',
        message: 'Explorer agent failed',
        agentId: 'explorer',
        metadata: {
          runId,
          agent: 'explorer',
          success: false,
          code: error?.code || error?.name || 'AI_ERROR',
          provider: safeMeta.provider,
          model: safeMeta.model,
        },
        severity: 'error',
      })
    } catch {
      // do not mask original error
    }
    throw error
  }
}

export default {
  exploreResearchPlan,
  applyQueryAwareRelevance,
  EXPLORER_ACTIVITY,
}
