/**
 * Evidence-focused subgraph selection + readable layout for the Evidence Graph.
 * Uses only real backend nodes/edges; does not fabricate relationships.
 */

export const EVIDENCE_GRAPH_LIMITS = Object.freeze({
  MIN_INITIAL_NODES: 40,
  MAX_INITIAL_NODES: 90,
  MAX_NEIGHBORS_PER_EXPAND: 18,
  MAX_FULL_LAYOUT_NODES: 400,
})

/** Node types shown in the default evidence-focused subgraph. */
export const EVIDENCE_TRACE_NODE_TYPES = new Set([
  'Paper',
  'Finding',
  'EvidenceItem',
])

/**
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isEvidenceTraceNode(node) {
  return EVIDENCE_TRACE_NODE_TYPES.has(node?.type)
}

/**
 * @param {object} node
 * @returns {string[]}
 */
function paperIdsForNode(node) {
  const related = (node?.relatedPaperIds || node?.data?.relatedPaperIds || [])
    .map(String)
    .filter(Boolean)
  const direct = String(
    node?.paperId || node?.data?.paperId || node?.payload?.paperId || '',
  )
  if (direct) related.push(direct)
  if (node?.type === 'Paper' && node?.id) {
    const raw = String(node.id).replace(/^paper:/, '')
    related.push(raw, String(node.id))
  }
  return [...new Set(related)]
}

/**
 * @param {object[]} papers
 * @returns {Set<string>}
 */
export function seedPaperIdsFromLiterature(papers = []) {
  const ids = new Set()
  for (const paper of papers) {
    if (!paper) continue
    if (paper.id) {
      ids.add(String(paper.id))
      ids.add(`paper:${paper.id}`)
    }
    if (paper._id) {
      ids.add(String(paper._id))
      ids.add(`paper:${paper._id}`)
    }
  }
  return ids
}

/**
 * Resolve Paper nodes matching supporting literature / report paper IDs.
 *
 * @param {object[]} nodes
 * @param {Set<string>} seedPaperIds
 * @returns {object[]}
 */
export function findSeedPaperNodes(nodes = [], seedPaperIds = new Set()) {
  if (!seedPaperIds.size) return []
  return nodes.filter((node) => {
    if (node.type !== 'Paper') return false
    const ids = paperIdsForNode(node)
    return ids.some((id) => seedPaperIds.has(id))
  })
}

/**
 * Build adjacency from real links only.
 *
 * @param {object[]} links
 * @returns {Map<string, Set<string>>}
 */
export function buildAdjacency(links = []) {
  const adj = new Map()
  for (const link of links) {
    const s = String(link.source || '')
    const t = String(link.target || '')
    if (!s || !t) continue
    if (!adj.has(s)) adj.set(s, new Set())
    if (!adj.has(t)) adj.set(t, new Set())
    adj.get(s).add(t)
    adj.get(t).add(s)
  }
  return adj
}

/**
 * Evidence subgraph neighbor preference (Finding / EvidenceItem before Paper).
 *
 * @param {object} node
 * @returns {number}
 */
function evidenceTraceNeighborPriority(node) {
  if (node.type === 'EvidenceItem') return 0
  if (node.type === 'Finding') return 1
  if (node.type === 'Paper') return 2
  return 999
}

/**
 * Initial evidence-focused node set: seed papers + 1-hop support entities.
 *
 * @param {{ nodes?: object[], links?: object[] }} fullGraph
 * @param {{ seedPaperIds?: Set<string>, focusNodeIds?: string[], maxNodes?: number }} options
 * @returns {Set<string>}
 */
export function selectEvidenceFocusedNodeIds(fullGraph, options = {}) {
  const nodes = fullGraph?.nodes || []
  const links = fullGraph?.links || []
  const maxNodes = Math.min(
    Math.max(options.maxNodes || EVIDENCE_GRAPH_LIMITS.MAX_INITIAL_NODES, 20),
    EVIDENCE_GRAPH_LIMITS.MAX_INITIAL_NODES,
  )
  const adj = buildAdjacency(links)
  const byId = new Map(nodes.map((n) => [String(n.id), n]))

  const focusIds = (options.focusNodeIds || []).map(String).filter((id) => byId.has(id))
  const seedPapers = findSeedPaperNodes(nodes, options.seedPaperIds || new Set())

  /** @type {string[]} */
  let seeds = []
  if (focusIds.length) {
    for (const id of focusIds) {
      const node = byId.get(id)
      if (node && isEvidenceTraceNode(node)) {
        seeds.push(id)
        continue
      }
      const paperKey = id.startsWith('paper:') ? id : `paper:${id}`
      if (byId.has(paperKey)) seeds.push(paperKey)
    }
    seeds = [...new Set(seeds)]
  }
  if (!seeds.length && seedPapers.length) {
    seeds = seedPapers.map((n) => String(n.id))
  } else if (!seeds.length) {
    // Fallback: highest-degree Paper nodes (still real graph data)
    seeds = nodes
      .filter((n) => n.type === 'Paper')
      .map((n) => ({
        id: String(n.id),
        deg: adj.get(String(n.id))?.size || 0,
      }))
      .sort((a, b) => b.deg - a.deg || a.id.localeCompare(b.id))
      .slice(0, 12)
      .map((x) => x.id)
  }

  const selected = new Set(seeds.slice(0, Math.min(24, maxNodes)))

  const candidates = []
  for (const seedId of selected) {
    const neigh = [...(adj.get(seedId) || [])]
    for (const nid of neigh) {
      if (selected.has(nid) || !byId.has(nid)) continue
      const node = byId.get(nid)
      if (!isEvidenceTraceNode(node)) continue
      candidates.push(node)
    }
  }

  candidates.sort(
    (a, b) =>
      evidenceTraceNeighborPriority(a) - evidenceTraceNeighborPriority(b) ||
      String(a.label || '').localeCompare(String(b.label || '')),
  )

  for (const node of candidates) {
    if (selected.size >= maxNodes) break
    selected.add(String(node.id))
  }

  return selected
}

/**
 * Expand visible set by one hop around a node (real neighbors only).
 *
 * @param {Set<string>} visibleIds
 * @param {string} nodeId
 * @param {{ nodes?: object[], links?: object[] }} fullGraph
 * @param {number} [maxAdd]
 * @returns {Set<string>}
 */
export function expandNodeNeighborhood(
  visibleIds,
  nodeId,
  fullGraph,
  maxAdd = EVIDENCE_GRAPH_LIMITS.MAX_NEIGHBORS_PER_EXPAND,
) {
  const next = new Set(visibleIds)
  const adj = buildAdjacency(fullGraph?.links || [])
  const byId = new Map((fullGraph?.nodes || []).map((n) => [String(n.id), n]))
  const neighbors = [...(adj.get(String(nodeId)) || [])]
    .map((id) => byId.get(id))
    .filter((node) => node && isEvidenceTraceNode(node))
    .sort(
      (a, b) =>
        evidenceTraceNeighborPriority(a) - evidenceTraceNeighborPriority(b) ||
        String(a.label || '').localeCompare(String(b.label || '')),
    )

  let added = 0
  for (const node of neighbors) {
    if (added >= maxAdd) break
    const id = String(node.id)
    if (next.has(id)) continue
    next.add(id)
    added += 1
  }
  return next
}

/**
 * Slice full graph to visible node ids + induced edges.
 *
 * @param {{ nodes?: object[], links?: object[], kind?: string }} fullGraph
 * @param {Set<string>|string[]} visibleIds
 * @returns {{ kind: string, nodes: object[], links: object[], fullNodeCount: number, fullLinkCount: number }}
 */
export function induceSubgraph(fullGraph, visibleIds) {
  const idSet = visibleIds instanceof Set ? visibleIds : new Set(visibleIds)
  const nodes = (fullGraph?.nodes || []).filter((n) => idSet.has(String(n.id)))
  const links = (fullGraph?.links || []).filter(
    (l) => idSet.has(String(l.source)) && idSet.has(String(l.target)),
  )
  return {
    kind: fullGraph?.kind || 'concept',
    nodes,
    links,
    fullNodeCount: (fullGraph?.nodes || []).length,
    fullLinkCount: (fullGraph?.links || []).length,
  }
}

/**
 * Readable clustered force-ish layout for the visible subgraph only.
 * Deterministic given the same node/link set.
 *
 * @param {object[]} nodes
 * @param {object[]} links
 * @returns {object[]}
 */
export function applyReadableLayout(nodes = [], links = []) {
  if (!nodes.length) return nodes

  const positions = new Map()
  const byType = {
    Paper: [],
    Concept: [],
    Author: [],
    Venue: [],
    other: [],
  }

  for (const node of nodes) {
    if (byType[node.type]) byType[node.type].push(node)
    else byType.other.push(node)
  }

  const placeGrid = (group, originX, originY, cols, gapX, gapY) => {
    group.forEach((node, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      positions.set(String(node.id), {
        x: originX + col * gapX,
        y: originY + row * gapY,
      })
    })
  }

  placeGrid(byType.Paper, 0, 0, Math.min(6, Math.max(3, Math.ceil(Math.sqrt(byType.Paper.length || 1)))), 140, 110)
  placeGrid(byType.Author, -320, -40, 3, 100, 90)
  placeGrid(byType.Concept, 420, -60, 4, 110, 95)
  placeGrid(byType.Venue, 40, 280, 5, 120, 80)
  placeGrid(byType.other, -200, 280, 4, 100, 80)

  // Mild edge attraction toward connected papers (keeps related nodes close)
  const paperSet = new Set(byType.Paper.map((n) => String(n.id)))
  for (let iter = 0; iter < 18; iter += 1) {
    for (const link of links) {
      const s = String(link.source)
      const t = String(link.target)
      const a = positions.get(s)
      const b = positions.get(t)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 1
      const pull = 0.06
      // Prefer pulling non-papers toward papers
      if (paperSet.has(s) && !paperSet.has(t)) {
        b.x -= dx * pull
        b.y -= dy * pull
      } else if (paperSet.has(t) && !paperSet.has(s)) {
        a.x += dx * pull
        a.y += dy * pull
      } else if (dist > 180) {
        a.x += dx * pull * 0.4
        a.y += dy * pull * 0.4
        b.x -= dx * pull * 0.4
        b.y -= dy * pull * 0.4
      }
    }

    // Soft repulsion within type clusters
    const ids = [...positions.keys()]
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = positions.get(ids[i])
        const b = positions.get(ids[j])
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 0.01
        if (dist >= 70) continue
        const push = ((70 - dist) / dist) * 1.8
        const ox = dx * push * 0.5
        const oy = dy * push * 0.5
        a.x -= ox
        a.y -= oy
        b.x += ox
        b.y += oy
      }
    }
  }

  return nodes.map((node) => {
    const pos = positions.get(String(node.id)) || { x: node.x || 0, y: node.y || 0 }
    return {
      ...node,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    }
  })
}

/**
 * Build the canvas-ready evidence view from the full backend graph.
 *
 * @param {{ nodes?: object[], links?: object[], kind?: string }} fullGraph
 * @param {Set<string>|string[]} visibleIds
 * @returns {{ kind: string, nodes: object[], links: object[], fullNodeCount: number, fullLinkCount: number, visibleNodeCount: number, visibleLinkCount: number }}
 */
export function buildVisibleGraph(fullGraph, visibleIds) {
  const induced = induceSubgraph(fullGraph, visibleIds)
  const layoutNodes =
    induced.nodes.length <= EVIDENCE_GRAPH_LIMITS.MAX_FULL_LAYOUT_NODES
      ? applyReadableLayout(induced.nodes, induced.links)
      : induced.nodes
  return {
    ...induced,
    nodes: layoutNodes,
    visibleNodeCount: layoutNodes.length,
    visibleLinkCount: induced.links.length,
  }
}
