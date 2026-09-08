/**
 * @fileoverview Deterministic entity extraction from canonical papers.
 * No LLM / embeddings — metadata-only.
 */

import { GRAPH_NODE_TYPES } from '../constants/graph.constants.js'

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * @param {string} prefix
 * @param {string} key
 * @returns {string}
 */
export function stableId(prefix, key) {
  const normalized = normalizeKey(key)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${prefix}:${normalized || 'unknown'}`
}

/**
 * @param {object} paper
 * @returns {string}
 */
export function paperNodeId(paper) {
  const id = paper?._id || paper?.id
  if (id) return `paper:${String(id)}`
  const doi = paper?.externalIds?.doi || paper?.doi
  if (doi) return stableId('paper', doi)
  return stableId('paper', paper?.title || 'untitled')
}

/**
 * @param {object} paper
 * @returns {string[]}
 */
function normalizeAuthors(paper) {
  if (!Array.isArray(paper?.authors)) return []
  return paper.authors
    .map((author) => {
      if (typeof author === 'string') return author.trim()
      if (author && typeof author.name === 'string') return author.name.trim()
      return ''
    })
    .filter(Boolean)
}

/**
 * @param {object} paper
 * @returns {string[]}
 */
function normalizeKeywords(paper) {
  if (!Array.isArray(paper?.keywords)) return []
  return [
    ...new Set(
      paper.keywords
        .map((kw) => (typeof kw === 'string' ? kw.trim() : ''))
        .filter(Boolean)
    ),
  ]
}

/**
 * Extract Paper / Author / Concept / Venue nodes from a paper list.
 * Duplicate entities across papers are merged by stable ID.
 *
 * @param {object[]} papers
 * @returns {{ nodes: object[], paperIdByNodeId: Map<string, string> }}
 */
export function extractEntities(papers = []) {
  /** @type {Map<string, object>} */
  const nodesById = new Map()
  /** @type {Map<string, string>} */
  const paperIdByNodeId = new Map()

  for (const paper of papers) {
    if (!paper) continue

    const mongoPaperId = paper._id ? String(paper._id) : paper.id ? String(paper.id) : null
    const pId = paperNodeId(paper)
    const title = typeof paper.title === 'string' && paper.title.trim()
      ? paper.title.trim()
      : 'Untitled paper'

    const existingPaper = nodesById.get(pId)
    if (existingPaper) {
      if (mongoPaperId && !existingPaper.relatedPaperIds.includes(mongoPaperId)) {
        existingPaper.relatedPaperIds.push(mongoPaperId)
      }
    } else {
      nodesById.set(pId, {
        id: pId,
        label: title.slice(0, 200),
        type: GRAPH_NODE_TYPES.PAPER,
        importance: 'primary',
        description: typeof paper.abstract === 'string' ? paper.abstract.slice(0, 500) : '',
        relatedPaperIds: mongoPaperId ? [mongoPaperId] : [],
        x: null,
        y: null,
        properties: {
          year: paper.year ?? null,
          venue: paper.venue || '',
          citationCount: paper.citationCount ?? 0,
          doi: paper.externalIds?.doi || paper.doi || null,
          source: paper.source || null,
          discoveryMethod: paper.discoveryMethod || null,
        },
      })
    }

    if (mongoPaperId) paperIdByNodeId.set(pId, mongoPaperId)

    for (const authorName of normalizeAuthors(paper)) {
      const aId = stableId('author', authorName)
      const existing = nodesById.get(aId)
      if (existing) {
        if (mongoPaperId && !existing.relatedPaperIds.includes(mongoPaperId)) {
          existing.relatedPaperIds.push(mongoPaperId)
        }
        existing.properties.paperCount = (existing.properties.paperCount || 1) + 1
      } else {
        nodesById.set(aId, {
          id: aId,
          label: authorName.slice(0, 200),
          type: GRAPH_NODE_TYPES.AUTHOR,
          importance: 'major',
          description: '',
          relatedPaperIds: mongoPaperId ? [mongoPaperId] : [],
          x: null,
          y: null,
          properties: {
            paperCount: 1,
          },
        })
      }
    }

    for (const keyword of normalizeKeywords(paper)) {
      const cId = stableId('concept', keyword)
      const existing = nodesById.get(cId)
      if (existing) {
        if (mongoPaperId && !existing.relatedPaperIds.includes(mongoPaperId)) {
          existing.relatedPaperIds.push(mongoPaperId)
        }
        existing.properties.paperCount = (existing.properties.paperCount || 1) + 1
      } else {
        nodesById.set(cId, {
          id: cId,
          label: keyword.slice(0, 200),
          type: GRAPH_NODE_TYPES.CONCEPT,
          importance: 'minor',
          description: '',
          relatedPaperIds: mongoPaperId ? [mongoPaperId] : [],
          x: null,
          y: null,
          properties: {
            paperCount: 1,
            origin: 'keyword',
          },
        })
      }
    }

    const venue =
      typeof paper.venue === 'string' && paper.venue.trim() ? paper.venue.trim() : ''
    if (venue) {
      const vId = stableId('venue', venue)
      const existing = nodesById.get(vId)
      if (existing) {
        if (mongoPaperId && !existing.relatedPaperIds.includes(mongoPaperId)) {
          existing.relatedPaperIds.push(mongoPaperId)
        }
        existing.properties.paperCount = (existing.properties.paperCount || 1) + 1
      } else {
        nodesById.set(vId, {
          id: vId,
          label: venue.slice(0, 200),
          type: GRAPH_NODE_TYPES.VENUE,
          importance: 'minor',
          description: '',
          relatedPaperIds: mongoPaperId ? [mongoPaperId] : [],
          x: null,
          y: null,
          properties: {
            paperCount: 1,
          },
        })
      }
    }
  }

  // Promote frequently mentioned concepts
  for (const node of nodesById.values()) {
    if (node.type === GRAPH_NODE_TYPES.CONCEPT && (node.properties.paperCount || 0) >= 3) {
      node.importance = 'major'
    }
    if (node.type === GRAPH_NODE_TYPES.AUTHOR && (node.properties.paperCount || 0) >= 3) {
      node.importance = 'primary'
    }
  }

  return {
    nodes: [...nodesById.values()],
    paperIdByNodeId,
  }
}

export default {
  extractEntities,
  normalizeKey,
  stableId,
  paperNodeId,
}
