import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar/Navbar'
import AgentExecutionBar from '../components/AgentExecutionBar/AgentExecutionBar'
import AgentTrace from '../components/AgentTrace/AgentTrace'
import ResearchWorkspace from '../components/ResearchWorkspace/ResearchWorkspace'
import ResearchReport from '../components/ResearchReport/ResearchReport'
import EvidenceGraph from '../components/EvidenceGraph/EvidenceGraph'
import ResearchSessions from '../components/ResearchSessions/ResearchSessions'
import Toast from '../components/Toast/Toast'
import { useAuth } from '../hooks/useAuth'
import * as sessionsService from '../services/sessions.service'
import * as aiService from '../services/ai.service'
import * as reportsService from '../services/reports.service'
import * as graphsService from '../services/graphs.service'
import * as activitiesService from '../services/activities.service'
import * as documentsService from '../services/documents.service'
import { SESSION_STATUSES } from '../utils/constants'
import {
  buildCreateSessionPayload,
  completedAgentStates,
  formatReference,
  getHighlightedIdsForFinding,
  getPapersForFinding,
  idleSectionStatus,
  mapActivityToUi,
  mapGraphToUi,
  mapReportToUi,
  mapSessionToUi,
  mapWorkflowToAgentStates,
  pendingAgentStates,
  readySectionStatus,
  researchingStatusMessage,
} from '../utils/researchMappers'
import { resolveTraceSessionAction } from '../utils/traceSessionPolicy'

const INITIAL_FILTERS = {
  yearFrom: '',
  yearTo: '',
  domain: '',
  publicationType: '',
  minCitations: '',
  openAccess: false,
}

const INITIAL_SECTION_STATUS = idleSectionStatus()
const INITIAL_AGENT_STATES = pendingAgentStates()
const EMPTY_GRAPH = { kind: 'concept', nodes: [], links: [] }
const ACTIVE_SOURCES = ['openalex', 'semantic_scholar']

function cloneReport(report) {
  return report ? structuredClone(report) : null
}

function Home() {
  const { logout } = useAuth()

  const [query, setQuery] = useState('')
  const [files, setFiles] = useState([])
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [sortBy, setSortBy] = useState('relevant')
  const [recentSearches, setRecentSearches] = useState([])
  const [isRunning, setIsRunning] = useState(false)
  const [discoveryProgress, setDiscoveryProgress] = useState('')
  const [agentStates, setAgentStates] = useState(INITIAL_AGENT_STATES)
  const [sectionStatus, setSectionStatus] = useState(INITIAL_SECTION_STATUS)
  const [report, setReport] = useState(null)
  const [hasGraph, setHasGraph] = useState(false)
  const [graphData, setGraphData] = useState(EMPTY_GRAPH)
  const [graphSessionId, setGraphSessionId] = useState(0)
  const [supportingPapers, setSupportingPapers] = useState([])
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [paperFeedback, setPaperFeedback] = useState({})
  const [selectedConceptId, setSelectedConceptId] = useState(null)
  const [selectedFindingIndex, setSelectedFindingIndex] = useState(null)
  const [graphMode, setGraphMode] = useState('concept')
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [researchSessions, setResearchSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [activities, setActivities] = useState([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [toast, setToast] = useState('')
  const timersRef = useRef([])
  const runIdRef = useRef(0)
  /** Synchronous guard — state alone can miss rapid double-clicks before re-render */
  const isRunningRef = useRef(false)

  const showToast = useCallback((message) => {
    setToast(message)
  }, [])

  const dismissToast = useCallback(() => setToast(''), [])

  const handleAuthFailure = useCallback(
    (error) => {
      if (error?.status === 401) {
        logout()
        showToast('Session expired. Please sign in again.')
        return true
      }
      return false
    },
    [logout, showToast],
  )

  const clearTimers = () => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current = []
  }

  const logActivity = useCallback(async (sessionId, type, description, extras = {}) => {
    if (!sessionId) return null
    try {
      return await activitiesService.createActivity({
        sessionId,
        type,
        description,
        message: description,
        ...extras,
      })
    } catch {
      return null
    }
  }, [])

  const refreshActivities = useCallback(async (sessionId) => {
    if (!sessionId) {
      setActivities([])
      return
    }
    setActivitiesLoading(true)
    try {
      const { activities: items } = await activitiesService.listSessionActivities(
        sessionId,
      )
      const mapped = items.map(mapActivityToUi).filter(Boolean)
      mapped.sort((a, b) => b.createdAt - a.createdAt)
      setActivities(mapped)
    } catch (error) {
      if (!handleAuthFailure(error)) {
        setActivities([])
      }
    } finally {
      setActivitiesLoading(false)
    }
  }, [handleAuthFailure])

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    setSessionsError('')
    try {
      const { sessions } = await sessionsService.listSessions({ limit: 100 })
      setResearchSessions(sessions.map(mapSessionToUi).filter(Boolean))
    } catch (error) {
      if (handleAuthFailure(error)) return
      setSessionsError(error.message || 'Failed to load research sessions.')
      setResearchSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [handleAuthFailure])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [])

  useEffect(() => {
    if (!report) {
      setSupportingPapers([])
      setSelectedPaper(null)
      setPaperFeedback({})
      return
    }

    setSupportingPapers((current) => {
      const pinnedIds = new Set(
        current.filter((paper) => paper.pinned).map((paper) => paper.id),
      )
      return (report.supportingLiterature || []).map((paper) => ({
        ...paper,
        pinned: pinnedIds.has(paper.id) || Boolean(paper.pinned),
      }))
    })
  }, [report])

  const resetResults = () => {
    clearTimers()
    setIsRunning(false)
    setDiscoveryProgress('')
    setAgentStates(INITIAL_AGENT_STATES)
    setSectionStatus(INITIAL_SECTION_STATUS)
    setReport(null)
    setHasGraph(false)
    setGraphData(EMPTY_GRAPH)
    setSelectedPaper(null)
    setSupportingPapers([])
    setPaperFeedback({})
    setSelectedConceptId(null)
    setSelectedFindingIndex(null)
    setGraphMode('concept')
    setActiveSessionId(null)
    setActivities([])
    setGraphSessionId((current) => current + 1)
  }

  const handleQueryChange = (value) => {
    setQuery(value)
    if (!value.trim()) {
      resetResults()
    }
  }

  /**
   * Load real session graph (GET). Optionally build once when empty.
   * Never fabricates nodes in the browser.
   */
  const loadSessionGraph = useCallback(async (sessionId, { tryBuild = false, paperIds = [] } = {}) => {
    try {
      let graphDoc = await graphsService.getGraphBySession(sessionId)
      const isEmpty = !graphDoc?.nodes?.length
      if (tryBuild && isEmpty) {
        try {
          const built = await graphsService.buildGraph(sessionId, {
            paperIds,
            scope: 'final',
          })
          graphDoc = built.graph || graphDoc
        } catch {
          // Sparse/empty graph is valid — show empty state
        }
      }
      return mapGraphToUi(graphDoc)
    } catch (error) {
      if (error?.status === 404 && tryBuild) {
        try {
          const built = await graphsService.buildGraph(sessionId, {
            paperIds,
            scope: 'final',
          })
          return mapGraphToUi(built.graph)
        } catch {
          return { ...EMPTY_GRAPH }
        }
      }
      if (error?.status === 404) {
        return { ...EMPTY_GRAPH }
      }
      throw error
    }
  }, [])

  /**
   * TRACE always creates a fresh research session.
   * Never reuse activeSessionId — that mixes papers/report/graph across queries.
   * Prior sessions remain intact and restorable from the session list.
   */
  const ensureResearchSession = async (trimmed) => {
    const action = resolveTraceSessionAction({
      activeSessionId,
      newQuery: trimmed,
    })
    if (action.reuseActiveSession) {
      throw new Error('TRACE must not reuse an active research session')
    }

    try {
      const session = await sessionsService.createSession(
        buildCreateSessionPayload({
          query: trimmed,
          filters,
          sortBy,
          files,
          selectedSources: ACTIVE_SOURCES,
        }),
      )
      return String(session._id)
    } catch (error) {
      if (error?.status === 409) {
        const session = await sessionsService.createSession(
          buildCreateSessionPayload({
            query: trimmed,
            title: `${trimmed.slice(0, 180)} (${Date.now().toString().slice(-4)})`,
            filters,
            sortBy,
            files,
            selectedSources: ACTIVE_SOURCES,
          }),
        )
        return String(session._id)
      }
      throw error
    }
  }

  const handleTrace = async () => {
    const trimmed = query.trim()
    if (!trimmed || isRunning || isRunningRef.current) return
    if (trimmed.length < 3) {
      showToast('Enter a research question with at least 3 characters.')
      return
    }

    const runId = ++runIdRef.current
    clearTimers()
    isRunningRef.current = true
    setIsRunning(true)
    setDiscoveryProgress(researchingStatusMessage())
    setSelectedConceptId(null)
    setSelectedFindingIndex(null)
    // Honest running state — do not fake stage progress while waiting
    setAgentStates(INITIAL_AGENT_STATES)
    setSectionStatus(INITIAL_SECTION_STATUS)
    // Clear prior session artifacts so Citation Explorer / report / graph
    // cannot show another query's literature during this TRACE.
    setReport(null)
    setSupportingPapers([])
    setSelectedPaper(null)
    setHasGraph(false)
    setGraphData(EMPTY_GRAPH)
    setPaperFeedback({})
    setGraphSessionId((current) => current + 1)
    setActivities([])

    setRecentSearches((current) => {
      const next = [trimmed, ...current.filter((item) => item !== trimmed)]
      return next.slice(0, 6)
    })

    let sessionId = null

    try {
      setDiscoveryProgress('Preparing research session…')
      sessionId = await ensureResearchSession(trimmed)
      if (runId !== runIdRef.current) return

      setActiveSessionId(sessionId)
      setQuery(trimmed)

      const uploadable = files.filter((file) => file instanceof File)
      if (uploadable.length) {
        setDiscoveryProgress(`Uploading ${uploadable.length} PDF(s)…`)
        for (const file of uploadable) {
          await documentsService.uploadDocument(sessionId, file)
        }
      }

      if (runId !== runIdRef.current) return
      setDiscoveryProgress(researchingStatusMessage())

      const result = await aiService.research(sessionId, trimmed)
      if (runId !== runIdRef.current) return

      const uiReport = mapReportToUi(result.report, result.papers || [])
      const papers = uiReport?.supportingLiterature || []
      const qualityFailed =
        result.status === 'quality_failed' || uiReport?.status === 'quality_warning'

      setDiscoveryProgress('Loading knowledge graph…')
      const finalPaperIds = (uiReport?.supportingLiterature || []).map((paper) => paper.id)
      const uiGraph = await loadSessionGraph(sessionId, {
        tryBuild: true,
        paperIds: finalPaperIds,
      })
      if (runId !== runIdRef.current) return

      clearTimers()
      setAgentStates(mapWorkflowToAgentStates(result.workflow))
      setSectionStatus(
        uiReport?.status === 'ready' ||
          uiReport?.status === 'quality_warning' ||
          papers.length
          ? readySectionStatus()
          : INITIAL_SECTION_STATUS,
      )
      setReport(uiReport)
      setSupportingPapers(papers)
      setSelectedPaper(null)
      setSelectedFindingIndex(null)
      setHasGraph(Boolean(uiGraph.nodes?.length))
      setGraphData(uiGraph)
      setGraphSessionId((current) => current + 1)
      setDiscoveryProgress('')
      setIsRunning(false)
      isRunningRef.current = false

      await loadSessions()
      await refreshActivities(sessionId)

      if (result.workflow?.refinement?.attempted) {
        showToast(
          'TRACE performed an additional evidence search to address research gaps.',
        )
      } else if (qualityFailed) {
        showToast(
          'Research completed with quality warnings. Review findings before relying on results.',
        )
      } else if (uiReport?.status === 'ready') {
        showToast('Research report ready.')
      } else {
        showToast('TRACE completed.')
      }
    } catch (error) {
      if (runId !== runIdRef.current) return
      clearTimers()
      setIsRunning(false)
      isRunningRef.current = false
      setDiscoveryProgress('')
      // Keep prior report/graph; do not inject fake results
      setAgentStates(INITIAL_AGENT_STATES)
      if (sessionId) {
        setResearchSessions((current) =>
          current.map((item) =>
            item.id === sessionId
              ? { ...item, status: SESSION_STATUSES.FAILED }
              : item,
          ),
        )
        await refreshActivities(sessionId)
      }
      if (handleAuthFailure(error)) return
      showToast(error.message || 'TRACE failed. Please try again.')
    }
  }

  const restoreSession = async (session) => {
    const sessionId = session.id
    setSessionsOpen(false)
    clearTimers()
    setIsRunning(false)
    setDiscoveryProgress('Restoring workspace…')
    setAgentStates(INITIAL_AGENT_STATES)
    setSectionStatus(INITIAL_SECTION_STATUS)

    try {
      const opened = await sessionsService.getSession(sessionId)
      const uiSession = mapSessionToUi(opened)

      setActiveSessionId(sessionId)
      setQuery(uiSession.query)
      setFilters(uiSession.filters || INITIAL_FILTERS)
      setSortBy(uiSession.sortBy || 'relevant')
      setGraphMode(uiSession.graphMode || 'concept')
      setSelectedConceptId(uiSession.selectedConceptId || null)
      setSelectedFindingIndex(null)
      setPaperFeedback({})

      try {
        const docs = await documentsService.listSessionDocuments(sessionId)
        setFiles(
          docs.map((doc) => ({
            name: doc.originalName || doc.storedName,
            size: doc.size,
            mimeType: doc.mimeType,
            id: String(doc._id),
          })),
        )
      } catch {
        setFiles(uiSession.uploadedSources || [])
      }

      setDiscoveryProgress('Loading report…')
      let reportDoc = null
      try {
        reportDoc = await reportsService.getReportBySession(sessionId)
      } catch (error) {
        if (error?.status !== 404) throw error
      }

      const hasReadyReport =
        reportDoc &&
        (reportDoc.status === 'ready' || reportDoc.status === 'quality_warning')
      const uiReport = hasReadyReport ? mapReportToUi(reportDoc) : null
      const papers = uiReport?.supportingLiterature || []

      setDiscoveryProgress('Loading knowledge graph…')
      // Resume: load existing graph only — do not rebuild or re-run AI
      const uiGraph = await loadSessionGraph(sessionId, { tryBuild: false })

      setReport(uiReport)
      setSupportingPapers(papers)
      setSelectedPaper(
        uiSession.selectedPaperId
          ? papers.find((paper) => paper.id === uiSession.selectedPaperId) || null
          : null,
      )
      setHasGraph(Boolean(uiGraph.nodes?.length))
      setGraphData(uiGraph)
      setSectionStatus(hasReadyReport ? readySectionStatus() : INITIAL_SECTION_STATUS)
      setAgentStates(hasReadyReport ? completedAgentStates() : INITIAL_AGENT_STATES)
      setGraphSessionId((current) => current + 1)
      setDiscoveryProgress('')

      await refreshActivities(sessionId)
      await loadSessions()

      showToast(`Resumed workspace: ${uiSession.title}`)
    } catch (error) {
      setDiscoveryProgress('')
      if (handleAuthFailure(error)) return
      if (error?.status === 410) {
        showToast('This session is archived and cannot be opened.')
        await loadSessions()
        return
      }
      showToast(error.message || 'Unable to restore session.')
    }
  }

  const handleConceptSelect = (concept) => {
    setSelectedConceptId(concept?.id || null)
    setSelectedFindingIndex(null)
  }

  const handleFindingSelect = (index) => {
    setSelectedFindingIndex((current) => (current === index ? null : index))
    setSelectedConceptId(null)
    // Graph focus only — do not open Evidence Inspector / Paper Metadata
    setSelectedPaper(null)
  }

  const refreshReportSurfaces = (nextPapers, notice) => {
    setReport((current) => {
      if (!current) return current
      return {
        ...current,
        supportingLiterature: nextPapers,
        // Preserve backend confidence — never recalculate in the client
        references:
          Array.isArray(current.raw?.references) && current.raw.references.length
            ? current.raw.references
            : nextPapers.map(formatReference),
      }
    })
    setGraphSessionId((current) => current + 1)
    if (notice) showToast(notice)
  }

  const handleOpenPaper = () => {
    if (!selectedPaper) return
    const url =
      selectedPaper.url ||
      (selectedPaper.doi ? `https://doi.org/${selectedPaper.doi}` : null)
    if (!url) {
      showToast('Paper URL unavailable.')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handlePaperFeedback = (paperId, value) => {
    if (value === 'pinned') {
      setPaperFeedback((current) => ({
        ...current,
        [paperId]: current[paperId] === 'pinned' ? null : 'pinned',
      }))
      setSupportingPapers((current) => {
        const next = current.map((paper) =>
          paper.id === paperId ? { ...paper, pinned: !paper.pinned } : paper,
        )
        return [...next].sort((a, b) => Number(b.pinned) - Number(a.pinned))
      })
      showToast(
        supportingPapers.find((paper) => paper.id === paperId)?.pinned
          ? 'Paper unpinned.'
          : 'Paper pinned — it will stay in supporting evidence.',
      )
      if (activeSessionId) {
        logActivity(activeSessionId, 'paper.pinned', 'Paper pin toggled', {
          metadata: { paperId },
        })
      }
      return
    }

    if (value === 'relevant') {
      setPaperFeedback((current) => ({
        ...current,
        [paperId]: current[paperId] === 'relevant' ? null : 'relevant',
      }))
      setSupportingPapers((current) =>
        current.map((paper) =>
          paper.id === paperId
            ? {
                ...paper,
                confidence: Math.min(99, (paper.confidence || 80) + 4),
                importanceBoost: true,
              }
            : paper,
        ),
      )
      showToast('Marked relevant — future ranking will prioritize this paper.')
      return
    }

    if (value === 'not-relevant') {
      setPaperFeedback((current) => ({
        ...current,
        [paperId]: 'not-relevant',
      }))

      const alternative = supportingPapers.find(
        (paper) =>
          paper.id !== paperId &&
          !paper.pinned &&
          paperFeedback[paper.id] !== 'not-relevant',
      )

      setSupportingPapers((current) =>
        current.map((paper) =>
          paper.id === paperId
            ? {
                ...paper,
                confidence: Math.max(40, (paper.confidence || 80) - 8),
              }
            : paper,
        ),
      )

      if (alternative) {
        setSelectedPaper(alternative)
        showToast(
          `Marked not relevant. Suggested alternative: “${alternative.title}”.`,
        )
      } else {
        showToast('Marked not relevant.')
      }

      setReport((current) =>
        current
          ? {
              ...current,
              // Keep backend confidence authoritative
            }
          : current,
      )
      setGraphSessionId((current) => current + 1)
      return
    }

    setPaperFeedback((current) => ({
      ...current,
      [paperId]: current[paperId] === value ? null : value,
    }))
  }

  const handleReplacePaper = (paper) => {
    if (paper.pinned) {
      showToast('Pinned papers cannot be automatically replaced.')
      return
    }

    const replacement = supportingPapers.find(
      (candidate) =>
        candidate.id !== paper.id &&
        !candidate.pinned &&
        paperFeedback[candidate.id] !== 'not-relevant',
    )

    if (!replacement) {
      showToast('No alternative supporting paper is available in this session.')
      return
    }

    const demoted = supportingPapers.map((candidate) => {
      if (candidate.id === paper.id) {
        return {
          ...candidate,
          confidence: Math.max(45, (candidate.confidence || 80) - 10),
        }
      }
      if (candidate.id === replacement.id) {
        return {
          ...candidate,
          confidence: Math.min(99, (candidate.confidence || 80) + 3),
        }
      }
      return candidate
    })

    setSupportingPapers(demoted)
    setSelectedPaper(replacement)
    setPaperFeedback((current) => ({
      ...current,
      [paper.id]: 'replaced',
      [replacement.id]: 'relevant',
    }))
    refreshReportSurfaces(
      demoted,
      `Replaced focus with “${replacement.title}”. Report and graph refreshed.`,
    )
  }

  const handleRemovePaper = (paper) => {
    if (paper.pinned) {
      showToast('Unpin this paper before removing it from the session.')
      return
    }

    const nextPapers = supportingPapers.filter(
      (candidate) => candidate.id !== paper.id,
    )
    setSupportingPapers(nextPapers)
    if (selectedPaper?.id === paper.id) {
      setSelectedPaper(nextPapers[0] || null)
    }
    refreshReportSurfaces(
      nextPapers,
      `“${paper.title}” removed from this research session.`,
    )
  }

  const handleRenameSession = async (id, title) => {
    const nextTitle = title || researchSessions.find((s) => s.id === id)?.query
    setResearchSessions((current) =>
      current.map((session) =>
        session.id === id
          ? { ...session, title: nextTitle, updatedAt: Date.now() }
          : session,
      ),
    )

    try {
      await sessionsService.updateSession(id, { sessionTitle: nextTitle })
      await logActivity(id, 'session.renamed', `Renamed to “${nextTitle}”`)
      showToast('Session renamed.')
      if (activeSessionId === id) await refreshActivities(id)
    } catch (error) {
      if (handleAuthFailure(error)) return
      showToast(error.message || 'Failed to rename session.')
      await loadSessions()
    }
  }

  const handleDuplicateSession = async (session) => {
    try {
      const created = await sessionsService.createSession(
        buildCreateSessionPayload({
          query: session.query,
          title: `${session.title || session.query} (Copy)`.slice(0, 200),
          filters: session.filters,
          sortBy: session.sortBy,
          files: session.uploadedSources || [],
          selectedSources: session.selectedSources || ACTIVE_SOURCES,
        }),
      )
      const mapped = mapSessionToUi(created)
      setResearchSessions((current) => [mapped, ...current])
      await logActivity(
        mapped.id,
        'session.created',
        'Session duplicated from previous research',
      )
      showToast('Session duplicated.')
    } catch (error) {
      if (handleAuthFailure(error)) return
      showToast(error.message || 'Failed to duplicate session.')
    }
  }

  const handlePinSession = async (id) => {
    const current = researchSessions.find((session) => session.id === id)
    if (!current) return
    const nextPinned = !current.pinned

    setResearchSessions((sessions) =>
      sessions.map((session) =>
        session.id === id
          ? { ...session, pinned: nextPinned, updatedAt: Date.now() }
          : session,
      ),
    )

    try {
      const updated = await sessionsService.pinSession(id, nextPinned)
      const mapped = mapSessionToUi(updated)
      setResearchSessions((sessions) =>
        sessions.map((session) => (session.id === id ? mapped : session)),
      )
    } catch (error) {
      if (handleAuthFailure(error)) return
      showToast(error.message || 'Failed to update pin.')
      await loadSessions()
    }
  }

  const handleArchiveSession = async (id) => {
    setResearchSessions((current) =>
      current.map((session) =>
        session.id === id
          ? { ...session, archived: true, pinned: false, updatedAt: Date.now() }
          : session,
      ),
    )

    try {
      await sessionsService.archiveSession(id, true)
      await logActivity(id, 'session.archived', 'Session archived')
      if (activeSessionId === id) resetResults()
      showToast('Session archived.')
      await loadSessions()
    } catch (error) {
      if (handleAuthFailure(error)) return
      showToast(error.message || 'Failed to archive session.')
      await loadSessions()
    }
  }

  const handleDeleteSession = async (id) => {
    setResearchSessions((current) => current.filter((session) => session.id !== id))

    try {
      await sessionsService.deleteSession(id)
      await logActivity(id, 'session.deleted', 'Session deleted')
      if (activeSessionId === id) resetResults()
      showToast('Session deleted.')
      await loadSessions()
    } catch (error) {
      if (handleAuthFailure(error)) return
      showToast(error.message || 'Failed to delete session.')
      await loadSessions()
    }
  }

  return (
    <div className="min-h-screen bg-surface text-ink lg:h-screen lg:overflow-hidden">
      <Navbar onOpenSessions={() => setSessionsOpen(true)} />

      <div className="h-14 sm:h-16" aria-hidden="true" />
      <AgentExecutionBar agentStates={agentStates} hidden />
      <AgentTrace
        hidden={false}
        activities={activities}
        loading={activitiesLoading || Boolean(discoveryProgress)}
      />

      {(isRunning || discoveryProgress) && (
        <div className="border-b border-border bg-accent/5 px-3 py-1.5 text-center sm:px-4">
          <p className="text-xs font-medium text-accent">
            {discoveryProgress || researchingStatusMessage()}
          </p>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-3 pb-4 sm:px-4 lg:h-[calc(100vh-10rem)] lg:px-5">
        <div className="grid grid-cols-1 gap-3 lg:h-full lg:grid-cols-[22%_38%_40%]">
          <div className="h-[70vh] lg:h-full lg:min-h-0">
            <ResearchWorkspace
              query={query}
              onQueryChange={handleQueryChange}
              onTrace={handleTrace}
              isRunning={isRunning}
              files={files}
              onFilesChange={setFiles}
              filters={filters}
              onFiltersChange={setFilters}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              recentSearches={recentSearches}
            />
          </div>
          <div className="h-[70vh] lg:h-full lg:min-h-0">
            <ResearchReport
              sectionStatus={sectionStatus}
              report={report}
              researchQuestion={query}
              selectedPaper={selectedPaper}
              papers={getPapersForFinding(
                report,
                selectedFindingIndex,
                supportingPapers,
              )}
              paperFeedback={paperFeedback}
              selectedFindingIndex={selectedFindingIndex}
              onSelectPaper={setSelectedPaper}
              onPaperFeedback={handlePaperFeedback}
              onOpenPaper={handleOpenPaper}
              onReplacePaper={handleReplacePaper}
              onRemovePaper={handleRemovePaper}
              onSelectFinding={handleFindingSelect}
            />
          </div>
          <div className="h-[70vh] lg:h-full lg:min-h-0">
            <EvidenceGraph
              hasGraph={hasGraph}
              graphSessionId={graphSessionId}
              graphData={graphData}
              papers={supportingPapers}
              selectedPaper={selectedPaper}
              selectedConceptId={selectedConceptId}
              highlightedConceptIds={getHighlightedIdsForFinding(
                report,
                selectedFindingIndex,
                graphData,
              )}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
              onConceptSelect={handleConceptSelect}
              onSelectPaper={setSelectedPaper}
              onClearFindingFocus={() => {
                setSelectedFindingIndex(null)
                setSelectedPaper(null)
              }}
            />
          </div>
        </div>
      </main>

      <ResearchSessions
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        sessions={researchSessions}
        loading={sessionsLoading}
        error={sessionsError}
        onRetry={loadSessions}
        onSelectSession={restoreSession}
        onRenameSession={handleRenameSession}
        onDuplicateSession={handleDuplicateSession}
        onPinSession={handlePinSession}
        onArchiveSession={handleArchiveSession}
        onDeleteSession={handleDeleteSession}
      />

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  )
}

export default Home
