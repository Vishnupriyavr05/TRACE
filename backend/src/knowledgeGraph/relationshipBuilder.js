/**
 * @fileoverview Deterministic relationship builder for knowledge graphs.
 * Creates only edges grounded in canonical paper metadata.
 */

import { GRAPH_EDGE_TYPES } from '../constants/graph.constants.js'
import {
  normalizeKey,
  paperNodeId,
  stableId,
} from './entityExtractor.js'

/**
 * @param {string} type
 * @param {string} source
 * @param {string} target
 * @returns {string}
 */
function edgeId(type, source, target) {
  return `edge:${normalizeKey(type)}:${source}->${target}`
}

/**
 * Extract citation targets only when explicit relationship data exists.
 *
 * Supported shapes:
 * - paper.citationTree.references / cites / children (ids, dois, titles)
 * - paper.references (array of strings / objects) when present on the document
 *
 * @param {object} paper
 * @returns {{ doi?: string, semanticScholarId?: string, openAlexId?: string, title?: string, id?: string }[]}
 */
export function extractCitationTargets(paper) {
  const targets = []

  const pushTarget = (raw) => {
    if (!raw) return
    if (typeof raw === 'string') {
      const value = raw.trim()
      if (!value) return
      if (/^10\.\d{4,}\//i.test(value)) {
        targets.push({ doi: value.toLowerCase() })
        return
      }
      if (/^https?:\/\//i.test(value) && value.includes('doi.org/')) {
        const doi = value.split('doi.org/')[1]?.split('?')[0]
        if (doi) targets.push({ doi: doi.toLowerCase() })
        return
      }
      targets.push({ title: value })
      return
    }
    if (typeof raw === 'object') {
      targets.push({
        id: raw._id || raw.id || raw.paperId || null,
        doi: raw.doi || raw.externalIds?.doi || null,
        semanticScholarId:
          raw.semanticScholarId || raw.externalIds?.semanticScholarId || null,
        openAlexId: raw.openAlexId || raw.externalIds?.openAlexId || null,
        title: raw.title || null,
      })
    }
  }

  if (Array.isArray(paper?.references)) {
    paper.references.forEach(pushTarget)
  }

  const tree = paper?.citationTree
  if (tree && typeof tree === 'object') {
    const lists = [tree.references, tree.cites, tree.children, tree.citedPapers]
    for (const list of lists) {
      if (Array.isArray(list)) list.forEach(pushTarget)
    }
  }

  return targets
}

/**
 * @param {object[]} papers
 * @returns {Map<string, string>} lookup key → paper node id
 */
function buildPaperLookup(papers) {
  /** @type {Map<string, string>} */
  const lookup = new Map()

  for (const paper of papers) {
    const nodeId = paperNodeId(paper)
    const mongoId = paper._id ? String(paper._id) : paper.id ? String(paper.id) : null
    if (mongoId) lookup.set(`id:${mongoId}`, nodeId)

    const doi = paper.externalIds?.doi || paper.doi
    if (doi) lookup.set(`doi:${normalizeKey(doi)}`, nodeId)

    const s2 = paper.externalIds?.semanticScholarId
    if (s2) lookup.set(`s2:${normalizeKey(s2)}`, nodeId)

    const oa = paper.externalIds?.openAlexId
    if (oa) lookup.set(`oa:${normalizeKey(oa)}`, nodeId)

    if (paper.title) lookup.set(`title:${normalizeKey(paper.title)}`, nodeId)
  }

  return lookup
}

/**
 * Resolve a citation target to a paper node id within the session graph.
 *
 * @param {object} target
 * @param {Map<string, string>} lookup
 * @returns {string|null}
 */
function resolveCitedPaperNodeId(target, lookup) {
  if (target.id && lookup.has(`id:${String(target.id)}`)) {
    return lookup.get(`id:${String(target.id)}`)
  }
  if (target.doi && lookup.has(`doi:${normalizeKey(target.doi)}`)) {
    return lookup.get(`doi:${normalizeKey(target.doi)}`)
  }
  if (
    target.semanticScholarId &&
    lookup.has(`s2:${normalizeKey(target.semanticScholarId)}`)
  ) {
    return lookup.get(`s2:${normalizeKey(target.semanticScholarId)}`)
  }
  if (target.openAlexId && lookup.has(`oa:${normalizeKey(target.openAlexId)}`)) {
    return lookup.get(`oa:${normalizeKey(target.openAlexId)}`)
  }
  if (target.title && lookup.has(`title:${normalizeKey(target.title)}`)) {
    return lookup.get(`title:${normalizeKey(target.title)}`)
  }
  return null
}

/**
 * Build deterministic relationships for the session graph.
 *
 * @param {object[]} papers
 * @param {object[]} nodes
 * @returns {object[]} links
 */
export function buildRelationships(papers = [], nodes = []) {
  const nodeIds = new Set(nodes.map((node) => node.id))
  /** @type {Map<string, object>} */
  const linksById = new Map()
  const paperLookup = buildPaperLookup(papers)

  /** @type {Map<string, Set<string>>} paperNodeId → concept node ids */
  const conceptsByPaper = new Map()

  const addLink = (link) => {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) return
    if (link.source === link.target) return
    if (!linksById.has(link.id)) linksById.set(link.id, link)
  }

  for (const paper of papers) {
    if (!paper) continue
    const pId = paperNodeId(paper)
    if (!nodeIds.has(pId)) continue

    const mongoPaperId = paper._id ? String(paper._id) : null
    const supporting = mongoPaperId ? [mongoPaperId] : []

    // AUTHOR_OF: Author → Paper
    const authors = Array.isArray(paper.authors) ? paper.authors : []
    for (const author of authors) {
      const name =
        typeof author === 'string'
          ? author.trim()
          : author?.name
            ? String(author.name).trim()
            : ''
      if (!name) continue
      const aId = stableId('author', name)
      addLink({
        id: edgeId(GRAPH_EDGE_TYPES.AUTHOR_OF, aId, pId),
        source: aId,
        target: pId,
        type: GRAPH_EDGE_TYPES.AUTHOR_OF,
        explanation: `${name} authored “${paper.title || 'paper'}”`,
        confidence: 100,
        supportingPaperIds: supporting,
        properties: {},
      })
    }

    // HAS_CONCEPT / HAS_KEYWORD: Paper → Concept
    const keywords = Array.isArray(paper.keywords) ? paper.keywords : []
    const conceptSet = conceptsByPaper.get(pId) || new Set()
    for (const keyword of keywords) {
      if (typeof keyword !== 'string' || !keyword.trim()) continue
      const cId = stableId('concept', keyword)
      conceptSet.add(cId)
      addLink({
        id: edgeId(GRAPH_EDGE_TYPES.HAS_CONCEPT, pId, cId),
        source: pId,
        target: cId,
        type: GRAPH_EDGE_TYPES.HAS_CONCEPT,
        explanation: `Paper associated with concept “${keyword.trim()}”`,
        confidence: 90,
        supportingPaperIds: supporting,
        properties: { alsoKnownAs: GRAPH_EDGE_TYPES.HAS_KEYWORD },
      })
      // Alias edge type recorded in properties only — avoid duplicate edges.
    }
    conceptsByPaper.set(pId, conceptSet)

    // PUBLISHED_IN: Paper → Venue
    const venue =
      typeof paper.venue === 'string' && paper.venue.trim() ? paper.venue.trim() : ''
    if (venue) {
      const vId = stableId('venue', venue)
      addLink({
        id: edgeId(GRAPH_EDGE_TYPES.PUBLISHED_IN, pId, vId),
        source: pId,
        target: vId,
        type: GRAPH_EDGE_TYPES.PUBLISHED_IN,
        explanation: `Published in ${venue}`,
        confidence: 100,
        supportingPaperIds: supporting,
        properties: {},
      })
    }

    // CITES: only when citation relationship data exists AND target is in-session
    const citationTargets = extractCitationTargets(paper)
    for (const target of citationTargets) {
      const citedId = resolveCitedPaperNodeId(target, paperLookup)
      if (!citedId || citedId === pId) continue
      addLink({
        id: edgeId(GRAPH_EDGE_TYPES.CITES, pId, citedId),
        source: pId,
        target: citedId,
        type: GRAPH_EDGE_TYPES.CITES,
        explanation: 'Citation relationship present in canonical paper data',
        confidence: 85,
        supportingPaperIds: supporting,
        properties: {},
      })
    }
  }

  // RELATED_TO: papers that share at least one concept (grounded in keywords)
  const paperNodeIds = [...conceptsByPaper.keys()]
  for (let i = 0; i < paperNodeIds.length; i += 1) {
    for (let j = i + 1; j < paperNodeIds.length; j += 1) {
      const a = paperNodeIds[i]
      const b = paperNodeIds[j]
      const shared = [...conceptsByPaper.get(a)].filter((id) =>
        conceptsByPaper.get(b).has(id)
      )
      if (shared.length === 0) continue

      // Stable undirected key
      const [source, target] = a < b ? [a, b] : [b, a]
      addLink({
        id: edgeId(GRAPH_EDGE_TYPES.RELATED_TO, source, target),
        source,
        target,
        type: GRAPH_EDGE_TYPES.RELATED_TO,
        explanation: `Share ${shared.length} concept(s)`,
        confidence: Math.min(95, 50 + shared.length * 10),
        supportingPaperIds: [],
        properties: {
          sharedConceptIds: shared.slice(0, 20),
          sharedConceptCount: shared.length,
        },
      })
    }
  }

  return [...linksById.values()]
}

export default {
  buildRelationships,
  extractCitationTargets,
}
