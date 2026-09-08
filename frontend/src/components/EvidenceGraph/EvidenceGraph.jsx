import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GraphToggle from './GraphToggle'
import GraphToolbar from './GraphToolbar'
import GraphCanvas from './GraphCanvas'
import CitationExplorer from '../CitationExplorer/CitationExplorer'
import {
  buildVisibleGraph,
  EVIDENCE_GRAPH_LIMITS,
  expandNodeNeighborhood,
  seedPaperIdsFromLiterature,
  selectEvidenceFocusedNodeIds,
} from '../../utils/evidenceGraphView'

const EMPTY_GRAPH = { kind: 'concept', nodes: [], links: [] }

function EvidenceGraph({
  hasGraph,
  graphSessionId = 0,
  graphData = EMPTY_GRAPH,
  papers,
  selectedPaper,
  selectedConceptId,
  highlightedConceptIds,
  graphMode = 'concept',
  onGraphModeChange,
  onConceptSelect,
  onSelectPaper,
  onClearFindingFocus,
}) {
  const [mode, setMode] = useState(graphMode)
  const [viewMode, setViewMode] = useState('evidence') // 'evidence' | 'full'
  const [visibleIds, setVisibleIds] = useState(() => new Set())
  const graphRef = useRef(null)
  const panelRef = useRef(null)
  const lastFocusKeyRef = useRef('')
  const originalVisibleIdsRef = useRef(new Set())

  const pinnedIds = papers.filter((paper) => paper.pinned).map((paper) => paper.id)
  const orderedPapers = [...papers].sort((a, b) => {
    if (a.pinned === b.pinned) return 0
    return a.pinned ? -1 : 1
  })

  const fullGraph = graphData?.nodes?.length ? graphData : EMPTY_GRAPH
  const seedPaperIds = useMemo(
    () => seedPaperIdsFromLiterature(papers),
    [papers],
  )

  const snapshotOriginalEvidenceGraph = useCallback(() => {
    if (!fullGraph.nodes?.length) {
      const empty = new Set()
      originalVisibleIdsRef.current = empty
      return empty
    }
    const ids = selectEvidenceFocusedNodeIds(fullGraph, {
      seedPaperIds,
      focusNodeIds: [],
      maxNodes: EVIDENCE_GRAPH_LIMITS.MAX_INITIAL_NODES,
    })
    originalVisibleIdsRef.current = ids
    return ids
  }, [fullGraph, seedPaperIds])

  const restoreOriginalEvidenceGraph = useCallback(() => {
    lastFocusKeyRef.current = ''
    setViewMode('evidence')
    setVisibleIds(new Set(originalVisibleIdsRef.current))
    onConceptSelect?.(null)
    onClearFindingFocus?.()
  }, [onConceptSelect, onClearFindingFocus])

  const reseedEvidenceView = useCallback(
    (focusNodeIds = []) => {
      if (!fullGraph.nodes?.length) {
        setVisibleIds(new Set())
        return
      }
      const focused = selectEvidenceFocusedNodeIds(fullGraph, {
        seedPaperIds,
        focusNodeIds,
        maxNodes: EVIDENCE_GRAPH_LIMITS.MAX_INITIAL_NODES,
      })
      const original = originalVisibleIdsRef.current
      const next =
        original.size > 0
          ? new Set([...focused].filter((id) => original.has(id)))
          : focused
      setVisibleIds(next.size ? next : focused)
      setViewMode('evidence')
    },
    [fullGraph, seedPaperIds],
  )

  useEffect(() => {
    setMode(graphMode)
  }, [graphMode, graphSessionId])

  useEffect(() => {
    if (!hasGraph) {
      setMode('concept')
      onGraphModeChange?.('concept')
    }
  }, [hasGraph, graphSessionId, onGraphModeChange])

  // Seed the original evidence graph whenever a new graph session loads
  useEffect(() => {
    lastFocusKeyRef.current = ''
    const ids = snapshotOriginalEvidenceGraph()
    setVisibleIds(ids)
    setViewMode('evidence')
  }, [graphSessionId, fullGraph.nodes?.length, snapshotOriginalEvidenceGraph])

  // Focus subgraph when a Key Finding highlights related nodes (any view mode)
  useEffect(() => {
    const focus = highlightedConceptIds || []
    const key = focus.slice().sort().join('|')
    if (!key) {
      if (lastFocusKeyRef.current && viewMode !== 'full') {
        setVisibleIds(new Set(originalVisibleIdsRef.current))
      }
      lastFocusKeyRef.current = ''
      return
    }
    if (key === lastFocusKeyRef.current) return
    lastFocusKeyRef.current = key
    reseedEvidenceView(focus)
  }, [highlightedConceptIds, reseedEvidenceView, viewMode])

  const canvasData = useMemo(() => {
    if (!fullGraph.nodes?.length) {
      return { kind: 'concept', nodes: [], links: [] }
    }
    if (viewMode === 'full') {
      // Cap layout work; still uses only real nodes/edges
      const ids =
        fullGraph.nodes.length > EVIDENCE_GRAPH_LIMITS.MAX_FULL_LAYOUT_NODES
          ? new Set(
              fullGraph.nodes
                .slice(0, EVIDENCE_GRAPH_LIMITS.MAX_FULL_LAYOUT_NODES)
                .map((n) => String(n.id)),
            )
          : new Set(fullGraph.nodes.map((n) => String(n.id)))
      return buildVisibleGraph(fullGraph, ids)
    }
    const ids =
      visibleIds.size > 0
        ? visibleIds
        : selectEvidenceFocusedNodeIds(fullGraph, {
            seedPaperIds,
            maxNodes: EVIDENCE_GRAPH_LIMITS.MAX_INITIAL_NODES,
          })
    return buildVisibleGraph(fullGraph, ids)
  }, [fullGraph, viewMode, visibleIds, seedPaperIds])

  const handleModeChange = (next) => {
    setMode(next)
    onGraphModeChange?.(next)
  }

  const handleFullscreen = () => {
    const node = panelRef.current
    if (!node) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      node.requestFullscreen?.()
    }
  }

  const handleNodeSelect = (node) => {
    onConceptSelect?.(node)
    if (!node?.id || viewMode !== 'evidence') return
    setVisibleIds((current) =>
      expandNodeNeighborhood(current, node.id, fullGraph),
    )
  }

  const handleResetView = () => {
    restoreOriginalEvidenceGraph()
    requestAnimationFrame(() => graphRef.current?.reset())
  }

  const handleShowFull = () => {
    lastFocusKeyRef.current = ''
    setViewMode('full')
    onClearFindingFocus?.()
    requestAnimationFrame(() => graphRef.current?.fit())
  }

  const handleShowEvidence = () => {
    restoreOriginalEvidenceGraph()
    requestAnimationFrame(() => graphRef.current?.fit())
  }

  return (
    <section
      ref={panelRef}
      className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-ink">Evidence Graph</h2>
        <GraphToggle
          mode={mode}
          onChange={handleModeChange}
          citationAvailable={papers.length > 0}
        />
      </div>

      {mode === 'concept' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">
              Concepts · Methods · Algorithms · Datasets · Authors · Gaps
            </p>
            {hasGraph && (fullGraph.nodes?.length || 0) > 0 && (
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Showing {canvasData.nodes?.length || 0} nodes ·{' '}
                {canvasData.links?.length || 0} edges
                {viewMode === 'evidence'
                  ? ` (evidence focus of ${fullGraph.nodes.length})`
                  : ` (full graph${
                      fullGraph.nodes.length >
                      EVIDENCE_GRAPH_LIMITS.MAX_FULL_LAYOUT_NODES
                        ? `, layout capped at ${EVIDENCE_GRAPH_LIMITS.MAX_FULL_LAYOUT_NODES}`
                        : ''
                    })`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'full' ? (
              <button
                type="button"
                onClick={handleShowEvidence}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent"
              >
                Evidence view
              </button>
            ) : (
              <button
                type="button"
                onClick={handleShowFull}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent"
              >
                Show full graph
              </button>
            )}
            <GraphToolbar
              onZoomIn={() => graphRef.current?.zoomIn()}
              onZoomOut={() => graphRef.current?.zoomOut()}
              onReset={handleResetView}
              onFit={() => graphRef.current?.fit()}
              onFullscreen={handleFullscreen}
            />
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1 p-3">
        {mode === 'citation' && orderedPapers.length > 0 ? (
          <div className="h-full overflow-hidden rounded-2xl border border-border bg-card dark:bg-panel">
            <CitationExplorer
              sourcePaper={orderedPapers[0]}
              papers={orderedPapers}
              selectedPaper={selectedPaper}
              onSelectPaper={onSelectPaper}
              pinnedIds={pinnedIds}
            />
          </div>
        ) : hasGraph && (canvasData?.nodes?.length || 0) > 0 ? (
          <GraphCanvas
            key={`${graphSessionId}-${viewMode}`}
            ref={graphRef}
            data={canvasData}
            isActive
            selectedNodeId={selectedConceptId}
            highlightedNodeIds={highlightedConceptIds}
            papers={papers}
            onNodeSelect={handleNodeSelect}
            onPaperSelect={onSelectPaper}
          />
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-dashed border-border bg-panel/40 px-6 text-center">
            <p className="max-w-xs text-sm text-ink-muted">
              {hasGraph
                ? 'No concept connections yet for this session.'
                : 'The evidence graph will appear here as TRACE explores connected literature.'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

export default EvidenceGraph
