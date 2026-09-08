/**
 * @fileoverview Build structured GraphRAG evidence context with provenance.
 * No natural-language conclusions — agent-ready structured payload only.
 */

/**
 * @param {object} paper
 * @returns {object}
 */
function summarizePaper(paper) {
  return {
    paperId: paper._id ? String(paper._id) : String(paper.id || ''),
    title: paper.title || '',
    authors: Array.isArray(paper.authors) ? paper.authors : [],
    year: paper.year ?? null,
    venue: paper.venue || '',
    abstract: paper.abstract || '',
    keywords: Array.isArray(paper.keywords) ? paper.keywords : [],
    citationCount: paper.citationCount ?? 0,
    doi: paper.externalIds?.doi || paper.doi || null,
    url: paper.url || null,
    source: paper.source || null,
    sources: Array.isArray(paper.sources) ? paper.sources : [],
    discoveryMethod: paper.discoveryMethod || null,
    badges: Array.isArray(paper.badges) ? paper.badges : [],
  }
}

/**
 * Convert retrieval + traversal into a structured evidence context.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.query
 * @param {object[]} input.scoredPapers From retriever
 * @param {object} input.traversal From graphTraversal
 * @param {object[]} input.seedNodes
 * @param {object[]} [input.allPapers] Full session papers (for connected paper hydration)
 * @param {boolean} [input.emptyGraph]
 * @param {{ topK: number, depth: number }} input.options
 * @returns {object}
 */
export function buildEvidenceContext({
  sessionId,
  query,
  scoredPapers = [],
  traversal = {},
  seedNodes = [],
  allPapers = [],
  emptyGraph = false,
  options = {},
}) {
  const paperById = new Map(
    allPapers.map((p) => [String(p._id || p.id), p])
  )

  const relevanceByPaperId = new Map(
    scoredPapers.map((item) => [item.paperId, item])
  )

  // Hydrate connected paper nodes from traversal + scored set
  /** @type {Map<string, object>} */
  const papersOut = new Map()

  for (const item of scoredPapers) {
    const summary = summarizePaper(item.paper)
    papersOut.set(item.paperId, {
      ...summary,
      relevanceScore: item.score,
      matchedFields: item.matchedFields,
      matchedTokens: item.matchedTokens,
      nodeId: item.nodeId,
      provenance: {
        sessionId,
        paperId: item.paperId,
        nodeId: item.nodeId,
        source: summary.source,
        providers: item.provenance?.providers || [],
        role: 'seed_relevant',
      },
    })
  }

  for (const paperNode of traversal.connectedPapers || []) {
    const relatedIds = Array.isArray(paperNode.relatedPaperIds)
      ? paperNode.relatedPaperIds.map(String)
      : []
    for (const paperId of relatedIds) {
      if (papersOut.has(paperId)) continue
      const paper = paperById.get(paperId)
      if (!paper) continue
      const summary = summarizePaper(paper)
      papersOut.set(paperId, {
        ...summary,
        relevanceScore: relevanceByPaperId.get(paperId)?.score ?? 0,
        matchedFields: relevanceByPaperId.get(paperId)?.matchedFields || {},
        matchedTokens: relevanceByPaperId.get(paperId)?.matchedTokens || [],
        nodeId: paperNode.id,
        provenance: {
          sessionId,
          paperId,
          nodeId: paperNode.id,
          source: summary.source,
          providers: Array.isArray(paper.sources)
            ? paper.sources.map((s) => s.provider).filter(Boolean)
            : summary.source
              ? [summary.source]
              : [],
          role: 'traversal_connected',
        },
      })
    }
  }

  const nodes = (traversal.visitedNodes || []).map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    importance: node.importance || null,
    relatedPaperIds: Array.isArray(node.relatedPaperIds)
      ? node.relatedPaperIds.map(String)
      : [],
    properties: node.properties || {},
    retrievalScore: node.retrievalScore ?? null,
    provenance: {
      sessionId,
      nodeId: node.id,
      paperIds: Array.isArray(node.relatedPaperIds)
        ? node.relatedPaperIds.map(String)
        : [],
    },
  }))

  const edges = (traversal.traversedEdges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    explanation: edge.explanation || '',
    confidence: edge.confidence ?? null,
    supportingPaperIds: Array.isArray(edge.supportingPaperIds)
      ? edge.supportingPaperIds.map(String)
      : [],
    properties: edge.properties || {},
    provenance: {
      sessionId,
      edgeId: edge.id,
      paperIds: Array.isArray(edge.supportingPaperIds)
        ? edge.supportingPaperIds.map(String)
        : [],
    },
  }))

  const paths = (traversal.paths || []).map((path) => ({
    id: path.id,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    length: path.length,
    seedNodeId: path.seedNodeId,
    provenance: {
      sessionId,
      seedNodeId: path.seedNodeId,
    },
  }))

  const evidence = scoredPapers.map((item, index) => ({
    rank: index + 1,
    paperId: item.paperId,
    nodeId: item.nodeId,
    title: item.paper?.title || '',
    score: item.score,
    matchedFields: item.matchedFields,
    matchedTokens: item.matchedTokens,
    source: item.paper?.source || null,
    providers: item.provenance?.providers || [],
    provenance: {
      sessionId,
      paperId: item.paperId,
      nodeId: item.nodeId,
      source: item.paper?.source || null,
      providers: item.provenance?.providers || [],
    },
  }))

  const papers = [...papersOut.values()].sort(
    (a, b) =>
      (b.relevanceScore || 0) - (a.relevanceScore || 0) ||
      a.paperId.localeCompare(b.paperId)
  )

  return {
    query,
    sessionId,
    papers,
    nodes,
    edges,
    paths,
    evidence,
    seedNodes: seedNodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      retrievalScore: n.retrievalScore ?? null,
      provenance: { sessionId, nodeId: n.id },
    })),
    retrievalStats: {
      emptyGraph,
      topK: options.topK,
      depth: options.depth,
      scoredPaperCount: scoredPapers.length,
      returnedPaperCount: papers.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      pathCount: paths.length,
      seedNodeCount: seedNodes.length,
      queryTokenCount: tokenizeSafe(query),
    },
  }
}

function tokenizeSafe(query) {
  if (!query || typeof query !== 'string') return 0
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2).length
}

export default {
  buildEvidenceContext,
}
