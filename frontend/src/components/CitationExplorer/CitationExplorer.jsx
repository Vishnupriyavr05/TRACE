import { useMemo } from 'react'
import PanelScroll from '../PanelScroll/PanelScroll'
import PaperTree from './PaperTree'

function sortPinnedFirst(nodes, pinnedIds) {
  if (!nodes?.length) return nodes
  return [...nodes]
    .map((node) => ({
      ...node,
      children: sortPinnedFirst(node.children, pinnedIds),
    }))
    .sort((a, b) => {
      const aPinned = pinnedIds.has(a.id) ? 0 : 1
      const bPinned = pinnedIds.has(b.id) ? 0 : 1
      return aPinned - bPinned
    })
}

function toTreeNode(paper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    citationCount: paper.citationCount,
    doi: paper.doi,
    url: paper.url,
    abstract: paper.abstract,
    badges: paper.badges,
    children: [],
  }
}

function resolveCanonicalPaperForTreeNode(node, papers = [], sourcePaper = null) {
  if (!node) return node
  const nodeId = String(node.id ?? '')
  if (!nodeId) return node

  const list = papers.length ? papers : sourcePaper ? [sourcePaper] : []
  const resolved = list.find(
    (paper) => String(paper.id ?? paper.paperId) === nodeId,
  )
  return resolved ?? node
}

/**
 * Navigation-only hierarchical paper tree (VS Code Explorer style).
 * All paper details live exclusively in the Evidence Inspector.
 */
function CitationExplorer({
  sourcePaper,
  papers = [],
  selectedPaper,
  onSelectPaper,
  pinnedIds = [],
}) {
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])

  const treeRoot = useMemo(() => {
    const list = papers.length
      ? papers
      : sourcePaper
        ? [sourcePaper]
        : []

    if (!list.length) return null

    const rootPaper = sourcePaper || list[0]
    const children = list
      .filter((paper) => paper.id !== rootPaper.id)
      .map(toTreeNode)

    return {
      ...toTreeNode(rootPaper),
      children: sortPinnedFirst(children, pinnedSet),
    }
  }, [papers, sourcePaper, pinnedSet])

  const handleSelectTreeNode = (node) => {
    onSelectPaper(resolveCanonicalPaperForTreeNode(node, papers, sourcePaper))
  }

  if (!treeRoot) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-ink-muted">
        No supporting papers yet.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Supporting Papers
        </p>
      </div>
      <PanelScroll className="min-h-0 flex-1 p-1.5">
        <PaperTree
          root={treeRoot}
          selectedId={selectedPaper?.id ?? null}
          onSelect={handleSelectTreeNode}
        />
      </PanelScroll>
    </div>
  )
}

export default CitationExplorer
