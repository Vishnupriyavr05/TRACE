/**
 * @fileoverview Bounded Critic context — findings + cited evidence only.
 * Does not dump full EvidencePackage; preserves provenance while prioritizing cited papers.
 */
import {
  CRITIC_MAX_FINDINGS,
  CRITIC_MAX_PAPERS,
  CRITIC_MAX_ABSTRACT_CHARS,
  CRITIC_MAX_GRAPH_NODES,
  CRITIC_MAX_GRAPH_EDGES,
  CRITIC_MAX_GRAPH_PATHS,
} from '../../config/environment/env.js'
import {
  envNumber,
  getProfileArtifactLimits,
} from '../core/traceProfile.js'
import {
  buildPackageEvidenceIndexes,
  getExtractedEvidenceItems,
} from '../core/evidencePackageIndexes.js'
import { buildConsolidatedRetrievalLimitations } from '../core/evidenceChain.js'
import { resolveEvidenceMatrixCoverage } from '../core/evidenceTargets.js'
import { normalizeEvidenceLevel } from '../core/evidenceLevels.js'

/**
 * @returns {{
 *   maxFindings: number,
 *   maxPapers: number,
 *   maxAbstractChars: number,
 *   maxGraphNodes: number,
 *   maxGraphEdges: number,
 *   maxGraphPaths: number
 * }}
 */
export function getCriticContextLimits() {
  const profile = getProfileArtifactLimits()
  return {
    maxFindings: envNumber('CRITIC_MAX_FINDINGS', profile.maxFindings || CRITIC_MAX_FINDINGS),
    maxPapers: envNumber('CRITIC_MAX_PAPERS', profile.maxPapers || CRITIC_MAX_PAPERS),
    maxAbstractChars: envNumber(
      'CRITIC_MAX_ABSTRACT_CHARS',
      profile.maxAbstractChars || CRITIC_MAX_ABSTRACT_CHARS,
    ),
    maxGraphNodes: envNumber(
      'CRITIC_MAX_GRAPH_NODES',
      profile.maxGraphNodes ?? CRITIC_MAX_GRAPH_NODES,
    ),
    maxGraphEdges: envNumber(
      'CRITIC_MAX_GRAPH_EDGES',
      profile.maxGraphEdges ?? CRITIC_MAX_GRAPH_EDGES,
    ),
    maxGraphPaths: envNumber(
      'CRITIC_MAX_GRAPH_PATHS',
      profile.maxGraphPaths ?? CRITIC_MAX_GRAPH_PATHS,
    ),
  }
}

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
 * Safe payload-size diagnostics (no prompts/secrets).
 *
 * @param {object} context
 * @param {object} [extra]
 * @returns {{
 *   findings: number,
 *   papers: number,
 *   evidenceItems: number,
 *   graphNodes: number,
 *   graphEdges: number,
 *   graphPaths: number,
 *   serializedChars: number,
 *   estimatedTokens: number
 * }}
 */
export function measureCriticPayload(context, extra = {}) {
  const serialized = JSON.stringify(context || {})
  const serializedChars = serialized.length
  return {
    findings: Array.isArray(context?.findingsToEvaluate)
      ? context.findingsToEvaluate.length
      : 0,
    papers: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    evidenceItems: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    graphNodes: context?.graph?.nodes?.length || 0,
    graphEdges: context?.graph?.edges?.length || 0,
    graphPaths: context?.graph?.paths?.length || 0,
    serializedChars,
    // Rough chars/4 estimate — not a provider tokenizer
    estimatedTokens: Math.ceil(serializedChars / 4),
    ...extra,
  }
}

/**
 * Normalize evidence requirements into short strings.
 *
 * @param {unknown[]} requirements
 * @param {number} max
 * @returns {string[]}
 */
function compactRequirements(requirements, max) {
  return (Array.isArray(requirements) ? requirements : [])
    .slice(0, max)
    .map((item) => {
      if (typeof item === 'string') return truncate(item, 160)
      if (item && typeof item === 'object') {
        return truncate(
          item.description || item.requirement || item.text || String(item.id || ''),
          160,
        )
      }
      return ''
    })
    .filter(Boolean)
}

/**
 * Build a bounded critic context from EvidencePackage + AnalyticalFindings.
 *
 * Findings carry IDs only (paperIds / evidenceIds). Full paper metadata lives
 * once in evidenceItems — no duplicated paper objects per finding.
 *
 * @param {object} evidencePackage
 * @param {object} analyticalFindings
 * @param {string} researchQuestion
 * @param {object} [limits]
 * @returns {{
 *   context: object,
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>,
 *   findingIds: Set<string>,
 *   evidenceIdToPaperId: Map<string, string>,
 *   bounded: boolean,
 *   stats: object,
 *   payload: object
 * }}
 */
export function buildCriticContext(
  evidencePackage,
  analyticalFindings,
  researchQuestion,
  limits = getCriticContextLimits()
) {
  const allFindings = Array.isArray(analyticalFindings?.findings)
    ? analyticalFindings.findings
    : []
  // Prefer higher-confidence / earlier analyst findings (already ordered)
  const findings = allFindings.slice(0, limits.maxFindings)
  const findingsBounded = findings.length < allFindings.length

  const papersById = new Map(
    (evidencePackage?.papers || []).map((p) => [String(p.paperId), p])
  )

  /** @type {Map<string, string>} */
  const evidenceIdToPaperId = new Map()
  /** @type {Set<string>} */
  const allowedPaperIds = new Set()
  /** @type {Set<string>} */
  const allowedEvidenceIds = new Set()
  /** @type {Set<string>} */
  const findingIds = new Set()

  // Collect cited paper ids from findings first (relevance-first)
  /** @type {Set<string>} */
  const citedPaperIds = new Set()
  for (const finding of findings) {
    findingIds.add(String(finding.id))
    for (const pid of finding.paperIds || []) citedPaperIds.add(String(pid))
  }
  for (const theme of (analyticalFindings?.themes || []).slice(0, 6)) {
    for (const pid of theme.paperIds || []) citedPaperIds.add(String(pid))
  }
  for (const rel of (analyticalFindings?.relationships || []).slice(0, 6)) {
    for (const pid of rel.sourcePaperIds || []) citedPaperIds.add(String(pid))
  }

  const citedPapers = [...citedPaperIds]
    .map((id) => papersById.get(id))
    .filter(Boolean)
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))

  const remaining = (evidencePackage?.papers || [])
    .filter((p) => !citedPaperIds.has(String(p.paperId)))
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))

  const selectedPapers = [...citedPapers, ...remaining].slice(0, limits.maxPapers)
  const papersBounded =
    selectedPapers.length < (evidencePackage?.papers || []).length

  const hasExtracted = getExtractedEvidenceItems(evidencePackage).length > 0
  /** @type {object[]} */
  let evidenceItems
  if (hasExtracted) {
    const indexed = buildPackageEvidenceIndexes(evidencePackage, {
      maxPapers: limits.maxPapers,
    })
    const selectedIds = new Set(selectedPapers.map((p) => String(p.paperId)))
    evidenceItems = indexed.evidenceItems
      .filter((item) => selectedIds.has(String(item.paperId)))
      .map((item) => ({
        ...item,
        evidenceLevel: normalizeEvidenceLevel(
          item.evidenceLevel ||
            evidencePackage.paperEvidenceLevels?.[String(item.paperId)] ||
            'ABSTRACT',
        ),
        title: truncate(item.title || papersById.get(String(item.paperId))?.title || '', 160),
        abstract: truncate(
          item.abstract ||
            item.text ||
            papersById.get(String(item.paperId))?.abstract ||
            '',
          limits.maxAbstractChars,
        ),
        text: truncate(item.text || '', limits.maxAbstractChars * 2),
      }))
    for (const [k, v] of indexed.evidenceIdToPaperId) {
      evidenceIdToPaperId.set(k, v)
      allowedEvidenceIds.add(String(k))
    }
    for (const pid of selectedIds) allowedPaperIds.add(String(pid))
  } else {
    evidenceItems = selectedPapers.map((paper, index) => {
      const evidenceId = `EV${index + 1}`
      const paperId = String(paper.paperId)
      evidenceIdToPaperId.set(evidenceId, paperId)
      allowedEvidenceIds.add(evidenceId)
      allowedPaperIds.add(paperId)

      return {
        evidenceId,
        paperId,
        evidenceLevel: normalizeEvidenceLevel(
          evidencePackage.paperEvidenceLevels?.[paperId] || 'ABSTRACT',
        ),
        title: truncate(paper.title || '', 160),
        abstract: truncate(paper.abstract || '', limits.maxAbstractChars),
        keywords: Array.isArray(paper.keywords) ? paper.keywords.slice(0, 5) : [],
        year: paper.year ?? null,
        venue: truncate(paper.venue || '', 60),
        source: paper.source || null,
        providers: (paper.provenance?.providers || []).slice(0, 3),
        relevance: typeof paper.relevance === 'number' ? paper.relevance : null,
        matchedQueries: Array.isArray(paper.matchedQueries)
          ? paper.matchedQueries.slice(0, 2)
          : [],
        nodeId: paper.provenance?.nodeId || null,
      }
    })
  }

  const paperIdToCriticEvidenceId = new Map()
  if (!hasExtracted) {
    for (const item of evidenceItems) {
      paperIdToCriticEvidenceId.set(item.paperId, item.evidenceId)
    }
  }

  const mappedFindings = findings.map((finding) => {
    const paperIds = (finding.paperIds || [])
      .map(String)
      .filter((id) => allowedPaperIds.has(id))
    const evidenceIds = hasExtracted
      ? (finding.evidenceIds || [])
          .map(String)
          .filter((id) => allowedEvidenceIds.has(id))
      : [
          ...new Set(
            paperIds
              .map((pid) => paperIdToCriticEvidenceId.get(pid))
              .filter(Boolean),
          ),
        ]
    // Compact: IDs only — no embedded paper/abstract copies
    return {
      id: finding.id,
      statement: truncate(finding.statement || '', 320),
      type: finding.type,
      preliminaryConfidence: finding.confidence,
      paperIds,
      evidenceIds,
    }
  })

  const selectedNodeIds = new Set(
    evidenceItems.map((e) => e.nodeId).filter(Boolean)
  )

  /** @type {object[]} */
  const nodes = []
  /** @type {object[]} */
  const edges = []
  /** @type {object[]} */
  const paths = []
  /** @type {Set<string>} */
  const allowedNodeIds = new Set(selectedNodeIds)
  /** @type {Set<string>} */
  const allowedPathIds = new Set()

  const relationshipNodeIds = new Set()
  const relationshipPathIds = new Set()
  for (const rel of (analyticalFindings?.relationships || []).slice(0, 6)) {
    for (const nid of rel.graphNodeIds || []) relationshipNodeIds.add(String(nid))
    for (const pid of rel.graphPathIds || []) relationshipPathIds.add(String(pid))
  }

  for (const block of evidencePackage?.graphEvidence || []) {
    for (const node of block.nodes || []) {
      if (nodes.length >= limits.maxGraphNodes) break
      if (!node?.id) continue
      const nodeId = String(node.id)
      const related = (node.relatedPaperIds || []).map(String)
      const keep =
        selectedNodeIds.has(nodeId) ||
        relationshipNodeIds.has(nodeId) ||
        related.some((id) => allowedPaperIds.has(id))
      if (!keep) continue
      allowedNodeIds.add(nodeId)
      nodes.push({
        id: nodeId,
        label: truncate(node.label || '', 80),
        type: node.type,
        relatedPaperIds: related
          .filter((id) => allowedPaperIds.has(id))
          .slice(0, 4),
      })
    }
    for (const edge of block.edges || []) {
      if (edges.length >= limits.maxGraphEdges) break
      if (!edge?.id) continue
      if (
        !allowedNodeIds.has(String(edge.source)) &&
        !allowedNodeIds.has(String(edge.target))
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
      if (
        relationshipPathIds.size &&
        !relationshipPathIds.has(String(path.id)) &&
        paths.length >= Math.min(3, limits.maxGraphPaths)
      ) {
        continue
      }
      allowedPathIds.add(String(path.id))
      paths.push({
        id: path.id,
        nodeIds: (path.nodeIds || []).slice(0, 5),
        edgeIds: (path.edgeIds || []).slice(0, 5),
        length: path.length,
      })
    }
  }

  const matrixCoverage = resolveEvidenceMatrixCoverage({
    evidencePackage,
    researchQuestion,
    analyticalFindings,
  })
  const retrievalLimitations = buildConsolidatedRetrievalLimitations(
    matrixCoverage,
  )

  const context = {
    researchQuestion: truncate(researchQuestion || '', 280),
    objective: truncate(evidencePackage?.planSummary?.objective || '', 220),
    researchDimensions: (
      evidencePackage?.planSummary?.researchDimensions || []
    )
      .slice(0, 6)
      .map((d) => truncate(String(d), 80)),
    evidenceRequirements: compactRequirements(
      evidencePackage?.planSummary?.evidenceRequirements || [],
      8,
    ),
    findingsToEvaluate: mappedFindings,
    themes: (analyticalFindings?.themes || []).slice(0, 5).map((t) => ({
      id: t.id,
      name: truncate(t.name || '', 80),
      description: truncate(t.description || '', 140),
      paperIds: (t.paperIds || [])
        .map(String)
        .filter((id) => allowedPaperIds.has(id))
        .slice(0, 4),
    })),
    relationships: (analyticalFindings?.relationships || [])
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        description: truncate(r.description || '', 160),
        sourcePaperIds: (r.sourcePaperIds || [])
          .map(String)
          .filter((id) => allowedPaperIds.has(id))
          .slice(0, 4),
        graphNodeIds: (r.graphNodeIds || [])
          .map(String)
          .filter((id) => allowedNodeIds.has(id))
          .slice(0, 4),
        graphPathIds: (r.graphPathIds || [])
          .map(String)
          .filter((id) => allowedPathIds.has(id))
          .slice(0, 3),
      })),
    analystGaps: (analyticalFindings?.gaps || []).slice(0, 5).map((g) => ({
      id: g.id,
      description: truncate(g.description || '', 160),
    })),
    analystLimitations: (analyticalFindings?.limitations || [])
      .slice(0, 4)
      .map((l) => ({
        id: l.id,
        description: truncate(l.description || '', 140),
      })),
    evidenceItems,
    graph: { nodes, edges, paths },
    retrievalGaps: [
      ...(evidencePackage?.evidenceGaps || []).slice(0, 5).map((gap) => ({
        id: gap.id,
        type: gap.type,
        severity: gap.severity,
        message: truncate(gap.message || gap.description || '', 140),
      })),
      ...retrievalLimitations.map((message, index) => ({
        id: `RL${index + 1}`,
        type: 'retrieval_limitation',
        severity: 'HIGH',
        message: truncate(message, 200),
      })),
    ].slice(0, 6),
    evidenceMatrixCoverage: matrixCoverage
      ? {
          targetCount: matrixCoverage.targetCount,
          searchedCount: matrixCoverage.searchedCount,
          relevantCount: matrixCoverage.relevantCount,
          fullTextCount: matrixCoverage.fullTextCount,
        }
      : null,
    contextNotes: {
      findingsBounded,
      papersBounded,
      instruction: [
        'Evaluate ONLY the listed findings against listed evidenceItems.',
        'Resolve evidence via evidenceId → paperId. Do not invent IDs.',
        'Do NOT rewrite findings. Assign FINAL confidence.',
        'Respect evidenceLevel on evidenceItems: abstract-only evidence cannot support detailed quantitative/clinical/comparative claims.',
      ].join(' '),
    },
  }

  const payload = measureCriticPayload(context, {
    findingsAvailable: allFindings.length,
    papersAvailable: (evidencePackage?.papers || []).length,
    limits: { ...limits },
  })

  return {
    context,
    allowedPaperIds,
    allowedEvidenceIds,
    findingIds,
    evidenceIdToPaperId,
    bounded: findingsBounded || papersBounded,
    stats: {
      findingsAvailable: allFindings.length,
      findingsIncluded: findings.length,
      papersAvailable: (evidencePackage?.papers || []).length,
      papersIncluded: evidenceItems.length,
      nodesIncluded: nodes.length,
      edgesIncluded: edges.length,
      pathsIncluded: paths.length,
      bounded: findingsBounded || papersBounded,
      serializedChars: payload.serializedChars,
      estimatedTokens: payload.estimatedTokens,
    },
    payload,
  }
}

export default {
  buildCriticContext,
  getCriticContextLimits,
  measureCriticPayload,
}
