/**
 * @fileoverview Bounded analyst context from an Explorer EvidencePackage.
 * Prioritizes relevance, query/provider diversity, and graph-connected papers.
 */
import {
  ANALYST_MAX_PAPERS,
  ANALYST_MAX_ABSTRACT_CHARS,
  ANALYST_MAX_GRAPH_NODES,
  ANALYST_MAX_GRAPH_EDGES,
  ANALYST_MAX_GRAPH_PATHS,
} from '../../config/environment/env.js'
import {
  envNumber,
  getProfileArtifactLimits,
} from '../core/traceProfile.js'
import {
  estimateTokensFromChars,
} from '../core/contextBudget.js'
import { buildPackageEvidenceIndexes } from '../core/evidencePackageIndexes.js'
import { buildPriorFindingsForRefinement } from '../core/priorFindingsHandoff.js'

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

/**
 * @returns {{
 *   maxPapers: number,
 *   maxAbstractChars: number,
 *   maxGraphNodes: number,
 *   maxGraphEdges: number,
 *   maxGraphPaths: number
 * }}
 */
export function getAnalystContextLimits() {
  const profile = getProfileArtifactLimits()
  return {
    maxPapers: envNumber('ANALYST_MAX_PAPERS', profile.maxPapers || ANALYST_MAX_PAPERS),
    maxAbstractChars: envNumber(
      'ANALYST_MAX_ABSTRACT_CHARS',
      profile.maxAbstractChars || ANALYST_MAX_ABSTRACT_CHARS,
    ),
    maxGraphNodes: envNumber(
      'ANALYST_MAX_GRAPH_NODES',
      profile.maxGraphNodes ?? ANALYST_MAX_GRAPH_NODES,
    ),
    maxGraphEdges: envNumber(
      'ANALYST_MAX_GRAPH_EDGES',
      profile.maxGraphEdges ?? ANALYST_MAX_GRAPH_EDGES,
    ),
    maxGraphPaths: envNumber(
      'ANALYST_MAX_GRAPH_PATHS',
      profile.maxGraphPaths ?? ANALYST_MAX_GRAPH_PATHS,
    ),
  }
}

/**
 * Safe payload-size diagnostics (no prompts/secrets).
 *
 * @param {object} context
 * @returns {object}
 */
export function measureAnalystPayload(context) {
  const serialized = JSON.stringify(context || {})
  return {
    papers: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    evidenceItems: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    graphNodes: context?.graph?.nodes?.length || 0,
    graphEdges: context?.graph?.edges?.length || 0,
    graphPaths: context?.graph?.paths?.length || 0,
    serializedChars: serialized.length,
    estimatedTokens: estimateTokensFromChars(serialized.length),
  }
}

/**
 * Select a diverse, relevance-prioritized paper subset.
 *
 * @param {object[]} papers
 * @param {number} maxPapers
 * @returns {object[]}
 */
export function selectAnalystPapers(papers = [], maxPapers = 15) {
  const list = Array.isArray(papers) ? [...papers] : []
  list.sort((a, b) => {
    const ra = typeof a.relevance === 'number' ? a.relevance : -1
    const rb = typeof b.relevance === 'number' ? b.relevance : -1
    if (rb !== ra) return rb - ra
    const qa = Array.isArray(a.matchedQueries) ? a.matchedQueries.length : 0
    const qb = Array.isArray(b.matchedQueries) ? b.matchedQueries.length : 0
    return qb - qa || String(a.paperId).localeCompare(String(b.paperId))
  })

  /** @type {object[]} */
  const selected = []
  const seenSources = new Set()
  const seenQueries = new Set()

  // Pass 1: diversify by source + first matched query
  for (const paper of list) {
    if (selected.length >= maxPapers) break
    const source = paper.source || 'unknown'
    const query = paper.matchedQueries?.[0] || ''
    const diversifyKey = `${source}::${query}`
    if (seenSources.has(source) && seenQueries.has(query) && selected.length >= Math.min(6, maxPapers)) {
      continue
    }
    selected.push(paper)
    seenSources.add(source)
    if (query) seenQueries.add(query)
    // keep diversifyKey used for readability / future scoring
    void diversifyKey
  }

  // Pass 2: fill remaining by rank
  for (const paper of list) {
    if (selected.length >= maxPapers) break
    if (selected.some((p) => p.paperId === paper.paperId)) continue
    selected.push(paper)
  }

  return selected
}

/**
 * @param {object} evidencePackage
 * @param {string} researchQuestion
 * @param {object} [limits]
 * @param {{
 *   priorAnalyticalFindings?: object|null,
 *   priorCritiqueResult?: object|null
 * }} [options]
 * @returns {{
 *   context: object,
 *   evidenceIdToPaperId: Map<string, string>,
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>,
 *   allowedNodeIds: Set<string>,
 *   allowedPathIds: Set<string>,
 *   bounded: boolean,
 *   stats: object
 * }}
 */
export function buildAnalystContext(
  evidencePackage,
  researchQuestion,
  limits = getAnalystContextLimits(),
  options = {},
) {
  const allPapers = Array.isArray(evidencePackage?.papers)
    ? evidencePackage.papers
    : []
  const indexed = buildPackageEvidenceIndexes(evidencePackage, {
    maxPapers: limits.maxPapers,
  })
  const selectedPapers = indexed.selectedPapers
  const bounded = selectedPapers.length < allPapers.length

  const evidenceIdToPaperId = indexed.evidenceIdToPaperId
  const allowedPaperIds = indexed.allowedPaperIds
  const allowedEvidenceIds = indexed.allowedEvidenceIds

  const evidenceItems = indexed.evidenceItems.map((item) => ({
    ...item,
    title: item.title || selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.title || '',
    abstract: truncate(
      item.abstract ||
        selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.abstract ||
        item.text ||
        '',
      limits.maxAbstractChars,
    ),
    text: truncate(item.text || '', limits.maxAbstractChars * 2),
    keywords: Array.isArray(item.keywords)
      ? item.keywords.slice(0, 8)
      : (selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.keywords || []).slice(0, 8),
    year:
      item.year ??
      selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.year ??
      null,
    venue: truncate(
      item.venue ||
        selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.venue ||
        '',
      80,
    ),
    source:
      item.source ||
      selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.source ||
      null,
    providers:
      item.providers ||
      selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.provenance?.providers ||
      [],
    relevance:
      typeof item.relevance === 'number'
        ? item.relevance
        : selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.relevance ?? null,
    matchedQueries: Array.isArray(item.matchedQueries)
      ? item.matchedQueries.slice(0, 4)
      : (selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.matchedQueries || []).slice(0, 4),
    nodeId:
      item.nodeId ||
      selectedPapers.find((p) => String(p.paperId) === String(item.paperId))?.provenance?.nodeId ||
      null,
  }))

  // Prefer graph nodes tied to selected papers; keep edges/paths light.
  const allowedNodeIds = new Set()
  const allowedPathIds = new Set()
  const selectedNodeIds = new Set(
    evidenceItems.map((item) => item.nodeId).filter(Boolean)
  )
  for (const item of evidenceItems) {
    if (item.nodeId) allowedNodeIds.add(String(item.nodeId))
  }

  /** @type {object[]} */
  const nodes = []
  /** @type {object[]} */
  const edges = []
  /** @type {object[]} */
  const paths = []

  for (const block of evidencePackage?.graphEvidence || []) {
    for (const node of block.nodes || []) {
      if (nodes.length >= limits.maxGraphNodes) break
      if (!node?.id) continue
      const nodeId = String(node.id)
      const related = (node.relatedPaperIds || []).map(String)
      const connected =
        selectedNodeIds.has(nodeId) ||
        related.some((id) => allowedPaperIds.has(id))
      if (!connected && nodes.length >= Math.min(8, limits.maxGraphNodes)) {
        continue
      }
      allowedNodeIds.add(nodeId)
      nodes.push({
        id: nodeId,
        label: truncate(node.label || '', 120),
        type: node.type,
        relatedPaperIds: related
          .filter((id) => allowedPaperIds.has(id))
          .slice(0, 6),
      })
    }
    for (const edge of block.edges || []) {
      if (edges.length >= limits.maxGraphEdges) break
      if (!edge?.id) continue
      // Keep only edges touching selected nodes when possible
      if (
        selectedNodeIds.size &&
        !selectedNodeIds.has(String(edge.source)) &&
        !selectedNodeIds.has(String(edge.target)) &&
        edges.length >= Math.min(6, limits.maxGraphEdges)
      ) {
        continue
      }
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
      })
    }
    for (const path of block.paths || []) {
      if (paths.length >= limits.maxGraphPaths) break
      if (!path?.id) continue
      allowedPathIds.add(String(path.id))
      paths.push({
        id: path.id,
        nodeIds: (path.nodeIds || []).slice(0, 6),
        edgeIds: (path.edgeIds || []).slice(0, 6),
        length: path.length,
      })
    }
  }

  const retrievalGaps = (evidencePackage?.evidenceGaps || [])
    .slice(0, 8)
    .map((gap, index) => ({
      id: gap.id || `RG${index + 1}`,
      type: gap.type || 'retrieval',
      severity: gap.severity || 'info',
      message: truncate(gap.message || gap.description || '', 200),
    }))

  const priorFindingsForRefinement = buildPriorFindingsForRefinement(
    options.priorAnalyticalFindings,
    options.priorCritiqueResult,
    {
      allowedPaperIds,
      allowedEvidenceIds,
    },
  )

  const context = {
    researchQuestion,
    objective: truncate(evidencePackage?.planSummary?.objective || '', 300),
    researchDimensions: (evidencePackage?.planSummary?.researchDimensions || []).slice(
      0,
      8
    ),
    evidenceRequirements: (
      evidencePackage?.planSummary?.evidenceRequirements || []
    ).slice(0, 8),
    evidenceItems,
    graph:
      limits.maxGraphNodes <= 0
        ? { nodes: [], edges: [], paths: [], omitted: true }
        : { nodes, edges, paths },
    retrievalGaps,
    contextNotes: {
      bounded,
      totalPapersAvailable: allPapers.length,
      papersIncluded: evidenceItems.length,
      instruction:
        'Use only evidenceIds/paperIds listed here. Do not invent papers or citations.',
      ...(priorFindingsForRefinement.length
        ? { refinementHandoff: true, priorFindingsCount: priorFindingsForRefinement.length }
        : {}),
    },
    ...(priorFindingsForRefinement.length
      ? { priorFindingsForRefinement }
      : {}),
  }

  const payload = measureAnalystPayload(context)

  return {
    context,
    evidenceIdToPaperId,
    allowedPaperIds,
    allowedEvidenceIds,
    allowedNodeIds,
    allowedPathIds,
    bounded,
    payload,
    stats: {
      totalPapersAvailable: allPapers.length,
      papersIncluded: evidenceItems.length,
      nodesIncluded: context.graph?.nodes?.length || 0,
      edgesIncluded: context.graph?.edges?.length || 0,
      pathsIncluded: context.graph?.paths?.length || 0,
      bounded,
      serializedChars: payload.serializedChars,
      estimatedTokens: payload.estimatedTokens,
    },
  }
}

export default {
  buildAnalystContext,
  selectAnalystPapers,
  getAnalystContextLimits,
  measureAnalystPayload,
}
