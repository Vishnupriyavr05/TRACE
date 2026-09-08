/**
 * @fileoverview Deterministic graph entity retrieval for GraphRAG.
 * Matches query tokens against paper metadata and graph node labels.
 */

import { scorePaper, scoreNode, tokenize } from './relevanceScorer.js'

/**
 * @param {object} paper
 * @param {object} [filters]
 * @returns {boolean}
 */
function passesFilters(paper, filters = {}) {
  if (!filters || typeof filters !== 'object') return true

  if (filters.yearFrom != null && filters.yearFrom !== '') {
    const year = Number(paper.year)
    if (!Number.isFinite(year) || year < Number(filters.yearFrom)) return false
  }
  if (filters.yearTo != null && filters.yearTo !== '') {
    const year = Number(paper.year)
    if (!Number.isFinite(year) || year > Number(filters.yearTo)) return false
  }
  if (filters.openAccess === true) {
    if (!paper.integrity?.openAccess && !paper.openAccess) return false
  }
  if (
    typeof filters.venue === 'string' &&
    filters.venue.trim() &&
    !(paper.venue || '').toLowerCase().includes(filters.venue.trim().toLowerCase())
  ) {
    return false
  }
  if (
    typeof filters.author === 'string' &&
    filters.author.trim()
  ) {
    const needle = filters.author.trim().toLowerCase()
    const authors = Array.isArray(paper.authors) ? paper.authors : []
    const hit = authors.some((a) =>
      String(typeof a === 'string' ? a : a?.name || '')
        .toLowerCase()
        .includes(needle)
    )
    if (!hit) return false
  }
  if (
    typeof filters.source === 'string' &&
    filters.source.trim() &&
    String(paper.source || '').toLowerCase() !== filters.source.trim().toLowerCase()
  ) {
    return false
  }

  return true
}

/**
 * Build paperId → concept labels from graph nodes.
 *
 * @param {object[]} nodes
 * @returns {Map<string, string[]>}
 */
function conceptLabelsByPaper(nodes = []) {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  for (const node of nodes) {
    if (node?.type !== 'Concept' || !Array.isArray(node.relatedPaperIds)) continue
    for (const paperId of node.relatedPaperIds) {
      const key = String(paperId)
      const list = map.get(key) || []
      list.push(node.label)
      map.set(key, list)
    }
  }
  return map
}

/**
 * Map paper Mongo id → Paper graph node id.
 *
 * @param {object[]} nodes
 * @returns {Map<string, string>}
 */
export function paperNodeIdByPaperId(nodes = []) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const node of nodes) {
    if (node?.type !== 'Paper') continue
    const ids = Array.isArray(node.relatedPaperIds)
      ? node.relatedPaperIds.map(String)
      : []
    // paper:ObjectId convention
    if (String(node.id).startsWith('paper:')) {
      const raw = String(node.id).slice('paper:'.length)
      map.set(raw, node.id)
    }
    for (const id of ids) map.set(id, node.id)
  }
  return map
}

/**
 * Retrieve relevant papers and seed graph nodes for a query.
 *
 * @param {object} params
 * @param {string} params.query
 * @param {object[]} params.papers
 * @param {{ nodes?: object[], links?: object[] }} params.graph
 * @param {number} [params.topK=10]
 * @param {object} [params.filters]
 * @returns {{
 *   scoredPapers: object[],
 *   seedNodes: object[],
 *   seedNodeIds: string[],
 *   queryTokens: string[],
 *   emptyGraph: boolean
 * }}
 */
export function retrieveRelevantEntities({
  query,
  papers = [],
  graph = {},
  topK = 10,
  filters = {},
}) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const emptyGraph = nodes.length === 0
  const queryTokens = tokenize(query)
  const conceptsByPaper = conceptLabelsByPaper(nodes)
  const paperNodeMap = paperNodeIdByPaperId(nodes)

  const scoredPapers = papers
    .filter((paper) => passesFilters(paper, filters))
    .map((paper) => {
      const paperId = paper._id ? String(paper._id) : String(paper.id || '')
      const scoring = scorePaper(query, paper, {
        conceptLabels: conceptsByPaper.get(paperId) || [],
      })
      return {
        paper,
        paperId,
        score: scoring.score,
        matchedFields: scoring.matchedFields,
        matchedTokens: scoring.matchedTokens,
        nodeId: paperNodeMap.get(paperId) || null,
        provenance: {
          sessionId: paper.sessionId ? String(paper.sessionId) : null,
          paperId,
          nodeId: paperNodeMap.get(paperId) || null,
          source: paper.source || null,
          providers: Array.isArray(paper.sources)
            ? paper.sources.map((s) => s.provider).filter(Boolean)
            : paper.source
              ? [paper.source]
              : [],
        },
      }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.paperId.localeCompare(b.paperId))
    .slice(0, Math.max(0, topK))

  /** @type {Map<string, object>} */
  const seedById = new Map()

  for (const item of scoredPapers) {
    if (!item.nodeId) continue
    const node = nodes.find((n) => n.id === item.nodeId)
    if (node) {
      seedById.set(node.id, {
        ...node,
        retrievalScore: item.score,
        matchedFields: item.matchedFields,
      })
    }
  }

  // Also seed strongly matching Concept / Author / Venue nodes
  for (const node of nodes) {
    if (node.type === 'Paper') continue
    const scored = scoreNode(query, node)
    if (scored.score <= 0) continue
    if (!seedById.has(node.id) || scored.score > (seedById.get(node.id).retrievalScore || 0)) {
      seedById.set(node.id, {
        ...node,
        retrievalScore: scored.score,
        matchedFields: scored.matchedFields,
      })
    }
  }

  // Prefer seed nodes tied to top papers; cap additional concept seeds
  const seedNodes = [...seedById.values()]
    .sort(
      (a, b) =>
        (b.retrievalScore || 0) - (a.retrievalScore || 0) ||
        String(a.id).localeCompare(String(b.id))
    )
    .slice(0, Math.max(topK * 2, topK))

  return {
    scoredPapers,
    seedNodes,
    seedNodeIds: seedNodes.map((n) => n.id),
    queryTokens,
    emptyGraph,
  }
}

export default {
  retrieveRelevantEntities,
  paperNodeIdByPaperId,
}
