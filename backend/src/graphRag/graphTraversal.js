/**
 * @fileoverview Configurable BFS graph traversal with cycle / duplicate prevention.
 */

/**
 * Build adjacency list (undirected for evidence exploration).
 *
 * @param {object[]} nodes
 * @param {object[]} links
 * @returns {Map<string, { neighborId: string, edge: object }[]>}
 */
export function buildAdjacency(nodes = [], links = []) {
  const nodeIds = new Set(nodes.map((n) => n.id))
  /** @type {Map<string, { neighborId: string, edge: object }[]>} */
  const adj = new Map()

  for (const node of nodes) {
    adj.set(node.id, [])
  }

  for (const edge of links) {
    if (!edge?.source || !edge?.target) continue
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue

    adj.get(edge.source).push({ neighborId: edge.target, edge })
    adj.get(edge.target).push({ neighborId: edge.source, edge })
  }

  return adj
}

/**
 * Traverse the knowledge graph from seed nodes.
 *
 * @param {object} params
 * @param {object[]} params.nodes Full graph nodes
 * @param {object[]} params.links Full graph links
 * @param {string[]} params.seedNodeIds
 * @param {number} [params.depth=1]
 * @returns {{
 *   visitedNodes: object[],
 *   traversedEdges: object[],
 *   connectedPapers: object[],
 *   paths: object[]
 * }}
 */
export function traverseGraph({
  nodes = [],
  links = [],
  seedNodeIds = [],
  depth = 1,
}) {
  const maxDepth = Math.max(0, Number(depth) || 0)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const adj = buildAdjacency(nodes, links)

  /** @type {Set<string>} */
  const visitedNodeIds = new Set()
  /** @type {Set<string>} */
  const visitedEdgeIds = new Set()
  /** @type {Map<string, object>} */
  const traversedEdges = new Map()
  /** @type {object[]} */
  const paths = []
  /** @type {Set<string>} */
  const pathSignatures = new Set()

  /** @type {{ nodeId: string, depth: number, pathNodes: string[], pathEdges: string[] }[]} */
  const queue = []

  for (const seedId of seedNodeIds) {
    if (!nodeById.has(seedId)) continue
    if (visitedNodeIds.has(seedId)) continue
    visitedNodeIds.add(seedId)
    queue.push({
      nodeId: seedId,
      depth: 0,
      pathNodes: [seedId],
      pathEdges: [],
    })

    const sig = seedId
    if (!pathSignatures.has(sig)) {
      pathSignatures.add(sig)
      paths.push({
        id: `path:${sig}`,
        nodeIds: [seedId],
        edgeIds: [],
        length: 0,
        seedNodeId: seedId,
      })
    }
  }

  let head = 0
  while (head < queue.length) {
    const current = queue[head++]
    if (current.depth >= maxDepth) continue

    const neighbors = adj.get(current.nodeId) || []
    for (const { neighborId, edge } of neighbors) {
      const edgeId = edge.id || `${edge.source}->${edge.target}:${edge.type}`

      // Always record the edge once when first seen on a valid hop
      if (!visitedEdgeIds.has(edgeId)) {
        visitedEdgeIds.add(edgeId)
        traversedEdges.set(edgeId, edge)
      }

      // Cycle / revisit prevention for BFS expansion
      if (visitedNodeIds.has(neighborId)) continue
      visitedNodeIds.add(neighborId)

      const nextPathNodes = [...current.pathNodes, neighborId]
      const nextPathEdges = [...current.pathEdges, edgeId]
      const pathSig = `${nextPathNodes.join('>')}|${nextPathEdges.join(',')}`

      if (!pathSignatures.has(pathSig)) {
        pathSignatures.add(pathSig)
        paths.push({
          id: `path:${pathSig}`,
          nodeIds: nextPathNodes,
          edgeIds: nextPathEdges,
          length: nextPathEdges.length,
          seedNodeId: nextPathNodes[0],
        })
      }

      queue.push({
        nodeId: neighborId,
        depth: current.depth + 1,
        pathNodes: nextPathNodes,
        pathEdges: nextPathEdges,
      })
    }
  }

  const visitedNodes = [...visitedNodeIds]
    .map((id) => nodeById.get(id))
    .filter(Boolean)

  const connectedPapers = visitedNodes.filter((n) => n.type === 'Paper')

  return {
    visitedNodes,
    traversedEdges: [...traversedEdges.values()],
    connectedPapers,
    paths,
  }
}

export default {
  traverseGraph,
  buildAdjacency,
}
