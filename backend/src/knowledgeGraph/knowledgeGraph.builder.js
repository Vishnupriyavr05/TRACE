/**
 * @fileoverview Deterministic Knowledge Graph Builder.
 * Converts canonical session papers into nodes/edges and persists via services.
 */

import * as paperService from '../services/paper.service.js'
import * as graphService from '../services/knowledgeGraph.service.js'
import * as activityService from '../services/researchActivity.service.js'
import { requireOwnedSession } from '../services/researchSession.service.js'
import { resolveFinalEvidenceRegistry } from '../ai/core/finalEvidenceRegistry.js'
import * as researchReportService from '../services/researchReport.service.js'
import { GRAPH_BUILD_ACTIVITY } from '../constants/graph.constants.js'
import { extractEntities } from './entityExtractor.js'
import { buildRelationships } from './relationshipBuilder.js'
import { validateKnowledgeGraph } from './graphValidator.js'
import { enrichGraphFromTraceEvidence } from './traceGraphEnrichment.js'

/**
 * Assign deterministic clustered layout coordinates for Evidence Graph canvas.
 * Avoids single concentric rings that produce hairball views at scale.
 * Frontend may further refine layout for the visible evidence subgraph.
 *
 * @param {object[]} nodes
 * @returns {object[]}
 */
export function assignLayout(nodes = []) {
  const byType = {
    Paper: [],
    Author: [],
    Concept: [],
    Venue: [],
    other: [],
  }

  for (const node of nodes) {
    if (byType[node.type]) byType[node.type].push(node)
    else byType.other.push(node)
  }

  /**
   * Place a type group on a rectangular grid centered at (cx, cy).
   *
   * @param {object[]} group
   * @param {number} cx
   * @param {number} cy
   * @param {number} gapX
   * @param {number} gapY
   */
  const placeGrid = (group, cx, cy, gapX, gapY) => {
    if (!group.length) return
    const cols = Math.max(1, Math.ceil(Math.sqrt(group.length)))
    const rows = Math.ceil(group.length / cols)
    const startX = cx - ((cols - 1) * gapX) / 2
    const startY = cy - ((rows - 1) * gapY) / 2
    group.forEach((node, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      node.x = Math.round(startX + col * gapX)
      node.y = Math.round(startY + row * gapY)
    })
  }

  placeGrid(byType.Paper, 0, 0, 150, 120)
  placeGrid(byType.Author, -420, -20, 110, 95)
  placeGrid(byType.Concept, 460, -30, 120, 100)
  placeGrid(byType.Venue, 40, 360, 130, 90)
  placeGrid(byType.other, -280, 340, 110, 90)

  return nodes
}

/**
 * Build an in-memory graph from canonical papers (no persistence).
 *
 * @param {object[]} papers
 * @param {{ sessionId?: string }} [options]
 * @returns {{ nodes: object[], links: object[], paperIds: string[], stats: object, status: string }}
 */
export function buildGraphFromPapers(papers = [], options = {}) {
  const list = Array.isArray(papers) ? papers : []
  const { nodes } = extractEntities(list)
  const links = buildRelationships(list, nodes)
  assignLayout(nodes)

  const paperIds = list
    .map((paper) => (paper?._id ? String(paper._id) : null))
    .filter(Boolean)

  const draft = {
    sessionId: options.sessionId || null,
    nodes,
    links,
    paperIds,
  }

  const { stats } = validateKnowledgeGraph(draft, {
    sessionId: options.sessionId,
  })

  const status =
    nodes.length === 0 && links.length === 0 ? 'empty' : 'ready'

  return {
    nodes,
    links,
    paperIds,
    stats: {
      ...stats,
      paperCount: list.length,
    },
    status,
  }
}

/**
 * Build (or rebuild) the knowledge graph for an owned research session.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {{ paperIds?: string[], scope?: 'final'|'discovery' }} [options]
 * @returns {Promise<{ graph: object, stats: object, status: string, buildStatus: string }>}
 */
export async function buildSessionKnowledgeGraph(userId, sessionId, options = {}) {
  await requireOwnedSession(userId, sessionId)

  await activityService.createActivity(userId, {
    sessionId,
    type: GRAPH_BUILD_ACTIVITY.STARTED,
    description: 'Knowledge graph build started',
    message: 'Knowledge graph build started',
    severity: 'info',
  })

  try {
    let papers = await paperService.listSessionPapers(sessionId)

    let scopedPaperIds = Array.isArray(options.paperIds)
      ? options.paperIds.map(String).filter(Boolean)
      : []

    if (!scopedPaperIds.length && options.scope === 'final') {
      try {
        const report = await researchReportService.getReportBySession(userId, sessionId)
        const registry = resolveFinalEvidenceRegistry(report, papers)
        scopedPaperIds = registry.paperIds || []
      } catch {
        scopedPaperIds = []
      }
    }

    if (scopedPaperIds.length) {
      const wanted = new Set(scopedPaperIds)
      papers = papers.filter((paper) =>
        wanted.has(String(paper._id || paper.id || paper.paperId || '')),
      )
    }

    const baseBuilt = buildGraphFromPapers(papers, { sessionId })
    let enrichmentStats = {}
    let nodes = baseBuilt.nodes
    let links = baseBuilt.links

    let finalEvidenceRegistry = options.traceArtifacts?.finalEvidenceRegistry || null
    if (!finalEvidenceRegistry && options.scope === 'final') {
      try {
        const report = await researchReportService.getReportBySession(userId, sessionId)
        finalEvidenceRegistry = resolveFinalEvidenceRegistry(report, papers)
      } catch {
        finalEvidenceRegistry = null
      }
    }

    if (options.traceArtifacts) {
      const enriched = enrichGraphFromTraceEvidence(baseBuilt, {
        ...options.traceArtifacts,
        finalEvidenceRegistry,
      })
      nodes = enriched.nodes
      links = enriched.links
      enrichmentStats = enriched.enrichmentStats || {}
    }

    const built = {
      ...baseBuilt,
      nodes,
      links,
      stats: {
        ...baseBuilt.stats,
        ...enrichmentStats,
        nodeCount: nodes.length,
        linkCount: links.length,
      },
    }

    let graph
    try {
      const existing = await graphService.getGraphBySession(userId, sessionId)
      graph = await graphService.updateGraph(userId, existing._id, {
        nodes: built.nodes,
        links: built.links,
        paperIds: built.paperIds,
        kind: 'concept',
        status: built.status,
        metadata: {
          builder: 'knowledgeGraph.builder',
          builtAt: new Date().toISOString(),
          paperCount: papers.length,
          scopedPaperIds,
          scope: options.scope || (scopedPaperIds.length ? 'final' : 'discovery'),
          stats: built.stats,
          traceEnriched: Boolean(options.traceArtifacts),
        },
      })
    } catch (error) {
      if (error?.statusCode !== 404) {
        throw error
      }
      graph = await graphService.createGraph(userId, {
        sessionId,
        kind: 'concept',
        nodes: built.nodes,
        links: built.links,
        paperIds: built.paperIds,
        status: built.status,
        metadata: {
          builder: 'knowledgeGraph.builder',
          builtAt: new Date().toISOString(),
          paperCount: papers.length,
          scopedPaperIds,
          scope: options.scope || (scopedPaperIds.length ? 'final' : 'discovery'),
          stats: built.stats,
          traceEnriched: Boolean(options.traceArtifacts),
        },
      })
    }

    await activityService.createActivity(userId, {
      sessionId,
      type: GRAPH_BUILD_ACTIVITY.COMPLETED,
      description: `Knowledge graph build completed (${built.stats.nodeCount} nodes, ${built.stats.linkCount} edges)`,
      message: 'Knowledge graph build completed',
      metadata: {
        stats: built.stats,
        status: built.status,
        graphId: String(graph._id),
      },
      severity: 'info',
    })

    return {
      graph,
      stats: built.stats,
      status: built.status,
      buildStatus: 'completed',
    }
  } catch (error) {
    try {
      await activityService.createActivity(userId, {
        sessionId,
        type: GRAPH_BUILD_ACTIVITY.FAILED,
        description: error?.message || 'Knowledge graph build failed',
        message: 'Knowledge graph build failed',
        metadata: {
          error: error?.message || 'Unknown error',
        },
        severity: 'error',
      })
    } catch {
      // Ownership / validation errors during failure logging should not mask original error
    }
    throw error
  }
}

export default {
  buildGraphFromPapers,
  buildSessionKnowledgeGraph,
  assignLayout,
}
