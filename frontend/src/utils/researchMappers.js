/**
 * Map backend research entities to Research Workspace UI shapes.
 */
import { AGENTS, REPORT_SECTIONS, SESSION_STATUSES } from './constants'

const SOURCE_UI_TO_API = {
  openalex: 'openalex',
  'semantic-scholar': 'semantic_scholar',
  semantic_scholar: 'semantic_scholar',
  crossref: 'crossref',
  core: 'core',
}

const ACTIVITY_LABELS = {
  AI_RESEARCH_STARTED: 'Research orchestration started',
  AI_RESEARCH_COMPLETED: 'Research orchestration completed',
  AI_RESEARCH_FAILED: 'Research orchestration failed',
  AI_PROVIDER_RATE_LIMITED:
    'AI provider rate limit reached. TRACE stopped safely.',
  AI_PLANNER_STARTED: 'Planner started',
  AI_PLANNER_COMPLETED: 'Planner completed',
  AI_PLANNER_FAILED: 'Planner failed',
  AI_EXPLORER_STARTED: 'Explorer started',
  AI_EXPLORER_COMPLETED: 'Explorer completed',
  AI_EXPLORER_FAILED: 'Explorer failed',
  AI_EVIDENCE_ANALYST_STARTED: 'Evidence Analyst started',
  AI_EVIDENCE_ANALYST_COMPLETED: 'Evidence Analyst completed',
  AI_EVIDENCE_ANALYST_FAILED: 'Evidence Analyst failed',
  AI_CRITIC_STARTED: 'Critic started',
  AI_CRITIC_COMPLETED: 'Critic completed',
  AI_CRITIC_FAILED: 'Critic failed',
  AI_SYNTHESIZER_STARTED: 'Synthesizer started',
  AI_SYNTHESIZER_COMPLETED: 'Synthesizer completed',
  AI_SYNTHESIZER_FAILED: 'Synthesizer failed',
}

/**
 * @param {string} [source]
 * @returns {string}
 */
export function toApiSourceId(source) {
  if (!source) return 'openalex'
  return SOURCE_UI_TO_API[source] || source
}

/**
 * @param {object|null|undefined} session
 * @returns {object|null}
 */
export function mapSessionToUi(session) {
  if (!session) return null

  const filters = session.filters || {}
  const status = mapBackendStatusToUi(session)

  return {
    id: String(session._id),
    title: session.sessionTitle || session.researchQuery || 'Untitled session',
    query: session.researchQuery || '',
    status,
    pinned: Boolean(session.isPinned),
    archived: Boolean(session.isArchived) || session.status === 'ARCHIVED',
    createdAt: session.createdAt ? new Date(session.createdAt).getTime() : Date.now(),
    updatedAt: session.updatedAt
      ? new Date(session.updatedAt).getTime()
      : Date.now(),
    lastOpenedAt: session.lastOpenedAt
      ? new Date(session.lastOpenedAt).getTime()
      : null,
    filters: {
      yearFrom: filters.yearFrom ?? '',
      yearTo: filters.yearTo ?? '',
      domain: session.domain || '',
      publicationType: filters.publicationType ?? '',
      minCitations: filters.minCitations ?? '',
      openAccess: Boolean(filters.openAccess),
    },
    sortBy: filters.sortBy || 'relevant',
    selectedSources: session.selectedSources || [],
    uploadedSources: (session.uploadedFiles || []).map((file) => ({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
    })),
    graphMode: session.workspaceState?.graphMode || 'concept',
    selectedPaperId: session.workspaceState?.selectedPaperId || null,
    selectedConceptId: session.workspaceState?.selectedConceptId || null,
    raw: session,
  }
}

/**
 * @param {object} session
 * @returns {string}
 */
export function mapBackendStatusToUi(session) {
  if (session.isArchived || session.status === 'ARCHIVED') {
    return SESSION_STATUSES.COMPLETED
  }
  if (session.status === 'COMPLETED') return SESSION_STATUSES.COMPLETED
  return SESSION_STATUSES.DRAFT
}

/**
 * @param {object} paper
 * @returns {object|null}
 */
export function mapPaperToUi(paper) {
  if (!paper) return null

  const doi = paper.doi || paper.externalIds?.doi || null

  const authors = Array.isArray(paper.authors)
    ? paper.authors.map((author) =>
        typeof author === 'string' ? author : author?.name || 'Unknown',
      )
    : []

  const id = String(paper._id || paper.id || paper.paperId || '')
  if (!id) return null

  return {
    id,
    title: paper.title || 'Untitled paper',
    authors,
    year: paper.year ?? paper.publicationYear ?? null,
    venue: paper.venue || '',
    citationCount: Number(paper.citationCount) || 0,
    confidence:
      typeof paper.confidence === 'number' ? paper.confidence : null,
    relevance:
      typeof paper.relevance === 'number' ? paper.relevance : null,
    url: paper.url || paper.pdfUrl || null,
    doi,
    abstract: paper.abstract || '',
    badges: Array.isArray(paper.badges) ? paper.badges : [],
    keywords: Array.isArray(paper.keywords) ? paper.keywords : [],
    source: paper.source || paper.provenance?.source || 'other',
    providers: paper.provenance?.providers || paper.providers || [],
    discoveryMethod: paper.discoveryMethod || null,
    paperType: paper.paperType || null,
    integrity: paper.integrity || {
      peerReviewed: paper.peerReviewed ?? null,
      openAccess: paper.openAccess ?? null,
      retractionStatus: 'none',
      correctionStatus: 'none',
      venueQuality: null,
    },
    reproducibility: paper.reproducibility || {
      codeAvailable: false,
      datasetAvailable: false,
      githubRepository: null,
      papersWithCode: false,
    },
    evidenceLocation: paper.evidenceLocation || null,
    evidenceSourceType: paper.evidenceSourceType || null,
    evidenceAvailability: paper.evidenceAvailability || null,
    evidenceLevel: paper.evidenceLevel || null,
    fallbackReason: paper.fallbackReason || null,
    externalIds: paper.externalIds || {},
    matchedQueries: Array.isArray(paper.matchedQueries)
      ? paper.matchedQueries
      : [],
    nodeId: paper.provenance?.nodeId || paper.nodeId || null,
    pinned: Boolean(paper.pinned),
  }
}

/**
 * @param {object|null} report
 * @returns {object[]}
 */
export function extractPapersFromReport(report) {
  if (!report || !Array.isArray(report.supportingEvidence)) return []
  return report.supportingEvidence.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item.title || item._id || item.id || item.paperId),
  )
}

/**
 * @param {object|null} registry
 * @param {string} paperId
 * @returns {object|null}
 */
function pickRegistryEvidenceForPaper(registry, paperId) {
  const items = (registry?.evidenceItems || []).filter(
    (item) => String(item.paperId) === String(paperId),
  )
  if (!items.length) return null
  const fullText = items.filter(
    (item) =>
      String(item.evidenceLevel || '').toUpperCase() === 'FULL_TEXT' ||
      item.sourceType === 'full_text',
  )
  const pool = fullText.length ? fullText : items
  return (
    pool.find(
      (item) =>
        item.section ||
        item.paragraphIndex != null ||
        item.sentenceIndex != null ||
        item.page,
    ) || pool[0]
  )
}

/**
 * @param {object|null|undefined} paperLocation
 * @param {object|null|undefined} registryItem
 * @returns {object|null}
 */
function mergeEvidenceLocationFromRegistry(paperLocation, registryItem) {
  if (!registryItem) return paperLocation || null
  const fromRegistry =
    registryItem.section ||
    registryItem.paragraphIndex != null ||
    registryItem.sentenceIndex != null ||
    registryItem.page
      ? {
          page: registryItem.page ?? null,
          section: registryItem.section || null,
          paragraph: registryItem.paragraphIndex ?? registryItem.paragraph ?? null,
          sentenceIndex: registryItem.sentenceIndex ?? null,
          sentence:
            registryItem.sentenceIndex != null && registryItem.text
              ? registryItem.text
              : registryItem.sentence || null,
        }
      : null
  if (!paperLocation) return fromRegistry
  if (!fromRegistry) return paperLocation
  return {
    ...paperLocation,
    page: paperLocation.page ?? fromRegistry.page ?? null,
    section: paperLocation.section || fromRegistry.section || null,
    paragraph: paperLocation.paragraph ?? fromRegistry.paragraph ?? null,
    sentenceIndex: paperLocation.sentenceIndex ?? fromRegistry.sentenceIndex ?? null,
    sentence: paperLocation.sentence || fromRegistry.sentence || null,
  }
}

/**
 * @param {object} paper
 * @param {object|null} registryItem
 * @returns {object}
 */
function mergeRegistryEvidenceOntoPaper(paper, registryItem) {
  if (!registryItem) return paper
  const location = mergeEvidenceLocationFromRegistry(
    paper.evidenceLocation,
    registryItem,
  )
  return {
    ...paper,
    evidenceLevel: registryItem.evidenceLevel || paper.evidenceLevel || null,
    evidenceSourceType: registryItem.sourceType || paper.evidenceSourceType || null,
    evidenceAvailability: registryItem.availability || paper.evidenceAvailability || null,
    fallbackReason: registryItem.fallbackReason || paper.fallbackReason || null,
    evidenceLocation: location,
  }
}

/**
 * Normalize orchestrator/report papers into UI papers.
 *
 * @param {object|null} report
 * @param {object[]} [papers]
 * @returns {object[]}
 */
export function extractEvidencePapers(report, papers = []) {
  const registry = report?.findingConceptMap?.finalEvidenceRegistry
  const allowedPaperIds = new Set(
    (registry?.paperIds || []).map(String).filter(Boolean),
  )

  /** @type {Map<string, object>} */
  const byId = new Map()
  const corpusById = new Map()
  for (const paper of papers || []) {
    const mapped = mapPaperToUi(paper)
    if (mapped) corpusById.set(mapped.id, mapped)
  }

  const targetIds =
    allowedPaperIds.size > 0
      ? [...allowedPaperIds]
      : collectFallbackPaperIds(report)

  for (const paperId of targetIds) {
    const fromCorpus = corpusById.get(String(paperId))
    const registryItem = pickRegistryEvidenceForPaper(registry, paperId)
    if (fromCorpus) {
      byId.set(fromCorpus.id, mergeRegistryEvidenceOntoPaper(fromCorpus, registryItem))
      continue
    }

    const conceptMap = report?.findingConceptMap || {}
    const ref = (conceptMap.references || []).find(
      (item) => String(item.paperId) === String(paperId),
    )
    const evidenceItem = (registry?.evidenceItems || report?.supportingEvidence || []).find(
      (item) => String(item.paperId) === String(paperId),
    )
    const mapped = mapPaperToUi({
      paperId,
      title: ref?.title || ref?.citation || 'Untitled paper',
      year: ref?.year ?? null,
      source: ref?.source || null,
      providers: ref?.providers || [],
      authors: [],
      abstract: '',
      evidenceSourceType: evidenceItem?.sourceType || null,
      evidenceAvailability: evidenceItem?.availability || null,
    })
    if (mapped) byId.set(mapped.id, mapped)
  }

  for (const paper of extractPapersFromReport(report)) {
    const mapped = mapPaperToUi(paper)
    if (!mapped) continue
    if (allowedPaperIds.size && !allowedPaperIds.has(mapped.id)) continue
    if (!byId.has(mapped.id)) byId.set(mapped.id, mapped)
  }

  return [...byId.values()]
}

/**
 * Fallback paper IDs when registry is absent (legacy reports).
 *
 * @param {object|null} report
 * @returns {string[]}
 */
function collectFallbackPaperIds(report) {
  const ids = new Set()
  const conceptMap = report?.findingConceptMap || {}

  for (const finding of conceptMap.findings || []) {
    for (const paperId of finding.paperIds || []) ids.add(String(paperId))
  }
  for (const ref of conceptMap.references || []) {
    if (ref?.paperId) ids.add(String(ref.paperId))
  }
  for (const item of report?.supportingEvidence || []) {
    if (item?.paperId) ids.add(String(item.paperId))
  }

  return [...ids]
}

/**
 * Structured findings from findingConceptMap (preferred) or string findings.
 *
 * @param {object|null} report
 * @returns {object[]}
 */
export function extractStructuredFindings(report) {
  const excluded = new Set(
    (report?.findingConceptMap?.excludedFindingIds || []).map(String),
  )

  /** @param {object} finding */
  const isDisplayable = (finding) => {
    const handling = String(finding.handling || '').toUpperCase()
    if (handling === 'EXCLUDE') return false
    if (excluded.has(String(finding.id))) return false
    return Boolean(finding.statement)
  }

  const conceptFindings = report?.findingConceptMap?.findings
  if (Array.isArray(conceptFindings) && conceptFindings.length) {
    return conceptFindings
      .map((finding, index) => ({
        id: finding.id || `F${index + 1}`,
        statement: finding.statement || '',
        confidence: finding.confidence || null,
        handling: finding.handling || null,
        evidenceIds: finding.evidenceIds || [],
        paperIds: (finding.paperIds || []).map(String),
      }))
      .filter(isDisplayable)
  }

  const raw =
    (Array.isArray(report?.keyFindings) && report.keyFindings.length
      ? report.keyFindings
      : report?.findings) || []

  return raw
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: `F${index + 1}`,
          statement: item,
          confidence: null,
          handling: null,
          evidenceIds: [],
          paperIds: [],
        }
      }
      return {
        id: item.id || `F${index + 1}`,
        statement: item.statement || item.text || String(item),
        confidence: item.confidence || null,
        handling: item.handling || null,
        evidenceIds: item.evidenceIds || [],
        paperIds: (item.paperIds || []).map(String),
      }
    })
    .filter(isDisplayable)
}

/**
 * Build UI report from backend ResearchReport (+ optional orchestrator papers).
 *
 * @param {object|null} report
 * @param {object[]} [papers]
 * @returns {object|null}
 */
export function mapReportToUi(report, papers = []) {
  if (!report && !papers.length) return null

  const literature = extractEvidencePapers(report, papers)
  const structuredFindings = extractStructuredFindings(report)

  const summary =
    report?.executiveSummary ||
    report?.summary ||
    ''

  const gaps = report?.researchGaps || {
    title: '',
    summary: '',
    evidence: '',
    items: [],
  }

  const gapItems = Array.isArray(gaps.items) ? gaps.items : []
  const confidenceBreakdown = report?.confidenceBreakdown || null
  const overallLabel =
    confidenceBreakdown?.overallLabel ||
    report?.findingConceptMap?.confidence?.overall ||
    null

  const integrityFromPapers = buildIntegrityIndicators(literature)
  const recommendations = Array.isArray(report?.recommendations)
    ? report.recommendations
    : []

  const qualityWarning =
    report?.status === 'quality_warning'
      ? report?.generationMetadata?.qualityGate?.failures || [
          'Quality threshold not met',
        ]
      : null

  return {
    id: report?._id ? String(report._id) : null,
    summary,
    findings: structuredFindings.map((f) => f.statement),
    structuredFindings,
    supportingLiterature: literature,
    integrity: integrityFromPapers,
    methodology: {
      strengths: report?.methodology?.strengths || [],
      weaknesses: report?.methodology?.weaknesses || [],
      limitations: report?.methodology?.limitations || '',
    },
    contradictions: report?.contradictions || [],
    researchGaps: {
      title: gaps.title || '',
      summary: gaps.summary || gapItems[0] || '',
      evidence: gaps.evidence || '',
      items: gapItems,
    },
    confidence: typeof report?.confidence === 'number' ? report.confidence : 0,
    confidenceLabel: overallLabel,
    confidenceBreakdown,
    confidenceBasis:
      confidenceBreakdown?.basis ||
      report?.findingConceptMap?.confidence?.basis ||
      '',
    recommendations,
    references:
      Array.isArray(report?.references) && report.references.length
        ? report.references
        : literature.map(formatReference),
    researchObjective: report?.researchObjective || '',
    status: report?.status || 'draft',
    qualityWarning,
    qualityGate: report?.generationMetadata?.qualityGate || null,
    retrievalObservability:
      report?.generationMetadata?.retrievalObservability || null,
    findingConceptMap: report?.findingConceptMap || {},
    generationMetadata: report?.generationMetadata || {},
    excludedFindingIds: report?.findingConceptMap?.excludedFindingIds || [],
    qualifiedFindingIds: report?.findingConceptMap?.qualifiedFindingIds || [],
    raw: report,
  }
}

/**
 * Highlight graph nodes related to a selected finding via paperIds.
 *
 * @param {object|null} reportUi
 * @param {number|null} findingIndex
 * @param {{ nodes?: object[] }} [graphData]
 * @returns {string[]}
 */
export function getHighlightedIdsForFinding(
  reportUi,
  findingIndex,
  graphData = {},
) {
  if (findingIndex === null || findingIndex === undefined || !reportUi) {
    return []
  }
  const finding = reportUi.structuredFindings?.[findingIndex]
  if (!finding) return []

  const paperIds = new Set((finding.paperIds || []).map(String))
  if (!paperIds.size) return []

  const highlighted = new Set()
  for (const node of graphData.nodes || []) {
    const nodeId = String(node.id || '')
    const related = (
      node.relatedPaperIds ||
      node.data?.relatedPaperIds ||
      []
    ).map(String)
    const nodePaperId = String(
      node.paperId || node.data?.paperId || node.payload?.paperId || '',
    )
    if (paperIds.has(nodePaperId) || related.some((id) => paperIds.has(id))) {
      highlighted.add(nodeId)
    }
    if (node.type === 'Paper' && paperIds.has(nodeId)) {
      highlighted.add(nodeId)
    }
  }

  for (const id of paperIds) highlighted.add(id)
  return [...highlighted]
}

/**
 * Papers supporting the selected finding (by paperId).
 *
 * @param {object|null} reportUi
 * @param {number|null} findingIndex
 * @param {object[]} papers
 * @returns {object[]}
 */
export function getPapersForFinding(reportUi, findingIndex, papers = []) {
  if (findingIndex === null || findingIndex === undefined || !reportUi) {
    return papers
  }
  const finding = reportUi.structuredFindings?.[findingIndex]
  if (!finding?.paperIds?.length) return papers
  const wanted = new Set(finding.paperIds.map(String))
  return papers.filter((paper) => wanted.has(String(paper.id)))
}

/**
 * @param {object[]} papers
 * @returns {object[]}
 */
function buildIntegrityIndicators(papers) {
  if (!papers.length) return []

  const triStateCount = (getter) => {
    let yes = 0
    let no = 0
    let unknown = 0
    for (const paper of papers) {
      const value = getter(paper)
      if (value === true) yes += 1
      else if (value === false) no += 1
      else unknown += 1
    }
    return { yes, no, unknown }
  }

  const peer = triStateCount(
    (p) => p.integrity?.peerReviewed ?? p.peerReviewed ?? null,
  )
  const oa = triStateCount(
    (p) => p.integrity?.openAccess ?? p.openAccess ?? null,
  )
  const retracted = papers.filter(
    (p) =>
      p.integrity?.retractionStatus && p.integrity.retractionStatus !== 'none',
  ).length

  const sources = new Set(
    papers.flatMap((p) =>
      p.providers?.length ? p.providers : [p.source].filter(Boolean),
    ),
  )

  const formatTri = ({ yes, no, unknown }) => {
    const known = yes + no
    if (!known && unknown) return `${unknown} unknown`
    const base = known ? `${yes}/${known} known` : '0/0 known'
    return unknown ? `${base} (${unknown} unknown)` : base
  }

  return [
    {
      label: 'Peer reviewed',
      value: formatTri(peer),
    },
    {
      label: 'Open access',
      value: formatTri(oa),
    },
    {
      label: 'Sources',
      value: sources.size ? [...sources].join(', ') : 'Unknown',
    },
    {
      label: 'Retraction flags',
      value: retracted === 0 ? 'None detected' : `${retracted} flagged`,
    },
  ]
}

/**
 * @param {object|string} paper
 * @returns {string}
 */
export function formatReference(paper) {
  if (typeof paper === 'string') return paper
  const lead = paper.authors?.[0]?.split(' ').slice(-1)[0] || 'Author'
  return `${lead} et al. — ${paper.title}`
}

/**
 * @param {object|null} graph
 * @returns {{ kind: string, nodes: object[], links: object[] }}
 */
export function mapGraphToUi(graph) {
  if (!graph) {
    return { kind: 'concept', nodes: [], links: [] }
  }

  return {
    id: graph._id ? String(graph._id) : null,
    kind: graph.kind || 'concept',
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    links: Array.isArray(graph.links) ? graph.links : [],
    status: graph.status || 'empty',
    stats: graph.stats || { nodeCount: 0, linkCount: 0 },
    raw: graph,
  }
}

/**
 * @param {object} activity
 * @returns {object|null}
 */
export function mapActivityToUi(activity) {
  if (!activity) return null
  const type = activity.type
  const friendly = ACTIVITY_LABELS[type]
  return {
    id: String(activity._id),
    type,
    description: activity.description || activity.message || friendly || type,
    message: activity.message || friendly || '',
    severity: activity.severity || 'info',
    createdAt: activity.createdAt
      ? new Date(activity.createdAt).getTime()
      : Date.now(),
    metadata: activity.metadata || {},
    payload: activity.payload || {},
    agentId: activity.agentId || null,
    paperId: activity.paperId || null,
  }
}

/**
 * Map orchestrator workflow object → agent bar states.
 *
 * @param {object} workflow
 * @returns {Record<string, string>}
 */
export function mapWorkflowToAgentStates(workflow = {}) {
  const statusMap = (value) => {
    if (value === 'completed') return 'completed'
    if (value === 'failed') return 'failed'
    if (value === 'running') return 'running'
    return 'pending'
  }

  return {
    planner: statusMap(workflow.planner),
    explorer: statusMap(workflow.explorer),
    evidence_analyst: statusMap(workflow.evidenceAnalyst),
    critic: statusMap(workflow.critic),
    synthesizer: statusMap(workflow.synthesizer),
  }
}

/**
 * Honest running banner text while waiting on the synchronous orchestrator.
 *
 * @returns {string}
 */
export function researchingStatusMessage() {
  return 'TRACE is researching…'
}

/**
 * Build create-session payload from workspace controls.
 */
export function buildCreateSessionPayload({
  query,
  title,
  filters,
  sortBy,
  files,
  selectedSources = ['openalex', 'semantic_scholar'],
}) {
  return {
    researchQuery: query,
    sessionTitle: (title || query).slice(0, 200),
    domain: filters?.domain || '',
    filters: {
      yearFrom: filters?.yearFrom ?? '',
      yearTo: filters?.yearTo ?? '',
      publicationType: filters?.publicationType ?? '',
      minCitations: filters?.minCitations ?? '',
      openAccess: Boolean(filters?.openAccess),
      sortBy: sortBy || 'relevant',
    },
    selectedSources,
    uploadedFiles: (files || [])
      .filter((file) => file?.name)
      .map((file) => ({
        name: file.name,
        size: typeof file.size === 'number' ? file.size : null,
        mimeType: file.type || file.mimeType || null,
        storageKey: null,
      })),
    status: 'ACTIVE',
    workspaceState: {
      graphMode: 'concept',
      selectedPaperId: null,
      selectedConceptId: null,
      expandedAccordion: null,
      activePanel: null,
    },
  }
}

export function readySectionStatus() {
  return Object.fromEntries(
    REPORT_SECTIONS.map((section) => [section.id, 'ready']),
  )
}

export function completedAgentStates() {
  return Object.fromEntries(AGENTS.map((agent) => [agent.id, 'completed']))
}

export function idleSectionStatus() {
  return Object.fromEntries(
    REPORT_SECTIONS.map((section) => [section.id, 'idle']),
  )
}

export function pendingAgentStates() {
  return Object.fromEntries(AGENTS.map((agent) => [agent.id, 'pending']))
}

export default {
  mapSessionToUi,
  mapPaperToUi,
  mapReportToUi,
  mapGraphToUi,
  mapActivityToUi,
  mapWorkflowToAgentStates,
  extractEvidencePapers,
  extractStructuredFindings,
  getHighlightedIdsForFinding,
  getPapersForFinding,
  buildCreateSessionPayload,
  toApiSourceId,
  researchingStatusMessage,
}
