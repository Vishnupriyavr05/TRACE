/**
 * @fileoverview Merge Explorer EvidencePackages across refinement passes.
 * Deduplicates by canonical paperId; preserves provenance and acquisition artifacts.
 */
import {
  EVIDENCE_LEVEL,
  evidenceLevelRank,
  normalizeEvidenceLevel,
} from '../core/evidenceLevels.js'

/**
 * @param {unknown} value
 * @returns {any}
 */
function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

/**
 * @param {object|null|undefined} pkg
 * @returns {object[]}
 */
function collectEvidenceItemsFromPackage(pkg) {
  /** @type {object[]} */
  const items = []
  const seen = new Set()
  for (const source of [pkg?.allExtractedEvidenceItems, pkg?.extractedEvidenceItems]) {
    if (!Array.isArray(source)) continue
    for (const item of source) {
      const evidenceId = String(item?.evidenceId || '')
      if (!evidenceId || seen.has(evidenceId)) continue
      seen.add(evidenceId)
      items.push(structuredCloneSafe(item))
    }
  }
  return items
}

/**
 * @param {object[]} items
 * @param {string} paperId
 * @returns {boolean}
 */
function paperHasFullTextItems(items, paperId) {
  const pid = String(paperId)
  return items.some(
    (item) =>
      String(item.paperId) === pid &&
      normalizeEvidenceLevel(item.evidenceLevel) === EVIDENCE_LEVEL.FULL_TEXT,
  )
}

/**
 * @param {object[]} primaryItems
 * @param {object[]} secondaryItems
 * @param {object[]} primaryFullPool
 * @returns {object[]}
 */
function mergeEvidenceItemLists(primaryItems, secondaryItems, primaryFullPool) {
  /** @type {Map<string, object>} */
  const byId = new Map()

  for (const item of primaryItems) {
    const evidenceId = String(item?.evidenceId || '')
    if (!evidenceId) continue
    byId.set(evidenceId, structuredCloneSafe(item))
  }

  for (const item of secondaryItems) {
    const evidenceId = String(item?.evidenceId || '')
    if (!evidenceId) continue
    const paperId = String(item.paperId || '')
    const level = normalizeEvidenceLevel(item.evidenceLevel)

    if (byId.has(evidenceId)) {
      const existing = byId.get(evidenceId)
      const existingLevel = normalizeEvidenceLevel(existing.evidenceLevel)
      if (evidenceLevelRank(level) > evidenceLevelRank(existingLevel)) {
        byId.set(evidenceId, structuredCloneSafe(item))
      }
      continue
    }

    if (
      level !== EVIDENCE_LEVEL.FULL_TEXT &&
      paperHasFullTextItems(primaryFullPool, paperId)
    ) {
      continue
    }

    byId.set(evidenceId, structuredCloneSafe(item))
  }

  return [...byId.values()]
}

/**
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @returns {Record<string, string>}
 */
function mergePaperEvidenceLevels(primary, secondary) {
  /** @type {Record<string, string>} */
  const merged = { ...(primary?.paperEvidenceLevels || {}) }
  for (const [paperId, level] of Object.entries(secondary?.paperEvidenceLevels || {})) {
    const pid = String(paperId)
    const incoming = normalizeEvidenceLevel(level)
    const existing = merged[pid]
    if (!existing) {
      merged[pid] = incoming
      continue
    }
    const current = normalizeEvidenceLevel(existing)
    merged[pid] =
      evidenceLevelRank(current) >= evidenceLevelRank(incoming) ? current : incoming
  }
  return merged
}

/**
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @param {Record<string, string>} paperEvidenceLevels
 * @returns {Record<string, string>}
 */
function mergePaperFallbackReasons(primary, secondary, paperEvidenceLevels) {
  /** @type {Record<string, string>} */
  const merged = { ...(primary?.paperFallbackReasons || {}) }
  for (const [paperId, reason] of Object.entries(secondary?.paperFallbackReasons || {})) {
    const pid = String(paperId)
    if (
      normalizeEvidenceLevel(paperEvidenceLevels[pid]) === EVIDENCE_LEVEL.FULL_TEXT
    ) {
      delete merged[pid]
      continue
    }
    if (!merged[pid]) {
      merged[pid] = reason
    }
  }
  return merged
}

/**
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @returns {Record<string, string>}
 */
function mergeEvidenceIdToPaperId(primary, secondary) {
  /** @type {Record<string, string>} */
  const merged = { ...(primary?.evidenceIdToPaperId || {}) }
  for (const [evidenceId, paperId] of Object.entries(
    secondary?.evidenceIdToPaperId || {},
  )) {
    const eid = String(evidenceId)
    if (!merged[eid]) {
      merged[eid] = String(paperId)
    }
  }
  return merged
}

/**
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @returns {object}
 */
function mergeFullTextAcquisition(primary, secondary) {
  const primaryAcq = primary?.fullTextAcquisition || {}
  const secondaryAcq = secondary?.fullTextAcquisition || {}
  /** @type {Map<string, object>} */
  const outcomesByPaper = new Map()

  for (const outcome of primaryAcq.paperOutcomes || []) {
    const paperId = String(outcome?.paperId || '')
    if (!paperId) continue
    outcomesByPaper.set(paperId, structuredCloneSafe(outcome))
  }

  for (const outcome of secondaryAcq.paperOutcomes || []) {
    const paperId = String(outcome?.paperId || '')
    if (!paperId) continue
    const existing = outcomesByPaper.get(paperId)
    if (!existing) {
      outcomesByPaper.set(paperId, structuredCloneSafe(outcome))
      continue
    }
    if (outcome.status === 'full_text') {
      outcomesByPaper.set(paperId, structuredCloneSafe(outcome))
    }
  }

  return {
    stats: {
      ...(primaryAcq.stats || {}),
      ...(secondaryAcq.stats || {}),
      refinementMerged: true,
    },
    paperOutcomes: [...outcomesByPaper.values()],
  }
}

/**
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @returns {{
 *   extractedEvidenceItems: object[],
 *   allExtractedEvidenceItems: object[],
 *   paperEvidenceLevels: Record<string, string>,
 *   paperFallbackReasons: Record<string, string>,
 *   evidenceIdToPaperId: Record<string, string>,
 *   fullTextAcquisition: object
 * }}
 */
function mergeAcquisitionArtifacts(primary, secondary) {
  const primaryPool = collectEvidenceItemsFromPackage(primary)
  const secondaryPool = collectEvidenceItemsFromPackage(secondary)
  const allExtractedEvidenceItems = mergeEvidenceItemLists(
    primaryPool,
    secondaryPool,
    primaryPool,
  )

  const extractedEvidenceItems = mergeEvidenceItemLists(
    Array.isArray(primary?.extractedEvidenceItems)
      ? primary.extractedEvidenceItems
      : [],
    Array.isArray(secondary?.extractedEvidenceItems)
      ? secondary.extractedEvidenceItems
      : [],
    primaryPool,
  )

  const paperEvidenceLevels = mergePaperEvidenceLevels(primary, secondary)
  const paperFallbackReasons = mergePaperFallbackReasons(
    primary,
    secondary,
    paperEvidenceLevels,
  )

  const evidenceIdToPaperId = mergeEvidenceIdToPaperId(primary, secondary)
  for (const item of allExtractedEvidenceItems) {
    const evidenceId = String(item.evidenceId || '')
    const paperId = String(item.paperId || '')
    if (evidenceId && paperId && !evidenceIdToPaperId[evidenceId]) {
      evidenceIdToPaperId[evidenceId] = paperId
    }
    if (paperId) {
      const itemLevel = normalizeEvidenceLevel(item.evidenceLevel)
      const current = paperEvidenceLevels[paperId]
      if (!current) {
        paperEvidenceLevels[paperId] = itemLevel
      } else {
        const normalized = normalizeEvidenceLevel(current)
        paperEvidenceLevels[paperId] =
          evidenceLevelRank(normalized) >= evidenceLevelRank(itemLevel)
            ? normalized
            : itemLevel
      }
    }
  }

  return {
    extractedEvidenceItems,
    allExtractedEvidenceItems,
    paperEvidenceLevels,
    paperFallbackReasons,
    evidenceIdToPaperId,
    fullTextAcquisition: mergeFullTextAcquisition(primary, secondary),
  }
}

/**
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @param {{ runId?: string }} [options]
 * @returns {object}
 */
export function mergeEvidencePackages(primary, secondary, options = {}) {
  if (!primary && !secondary) {
    throw new Error('At least one EvidencePackage is required to merge')
  }
  if (!secondary) return structuredCloneSafe(primary)
  if (!primary) return structuredCloneSafe(secondary)

  /** @type {Map<string, object>} */
  const papersById = new Map()

  for (const paper of primary.papers || []) {
    if (!paper?.paperId) continue
    papersById.set(String(paper.paperId), structuredCloneSafe(paper))
  }

  for (const paper of secondary.papers || []) {
    const paperId = String(paper?.paperId || '')
    if (!paperId) continue
    const existing = papersById.get(paperId)
    if (!existing) {
      papersById.set(paperId, structuredCloneSafe(paper))
      continue
    }

    const matched = new Set([
      ...(existing.matchedQueries || []),
      ...(paper.matchedQueries || []),
    ])
    existing.matchedQueries = [...matched]

    const providers = new Set([
      ...(existing.provenance?.providers || []),
      ...(paper.provenance?.providers || []),
    ])
    const discoveryQueries = new Set([
      ...(existing.provenance?.discoveryQueries || []),
      ...(paper.provenance?.discoveryQueries || []),
    ])
    existing.provenance = {
      ...(existing.provenance || {}),
      ...(paper.provenance || {}),
      paperId,
      sessionId:
        existing.provenance?.sessionId ||
        paper.provenance?.sessionId ||
        primary.sessionId,
      providers: [...providers],
      discoveryQueries: [...discoveryQueries],
      nodeId: existing.provenance?.nodeId || paper.provenance?.nodeId || null,
    }

    if (
      typeof paper.relevance === 'number' &&
      (typeof existing.relevance !== 'number' ||
        paper.relevance > existing.relevance)
    ) {
      existing.relevance = paper.relevance
    }

    const existingLevel = normalizeEvidenceLevel(existing.evidenceLevel)
    const incomingLevel = normalizeEvidenceLevel(paper.evidenceLevel)
    existing.evidenceLevel =
      evidenceLevelRank(existingLevel) >= evidenceLevelRank(incomingLevel)
        ? existingLevel
        : incomingLevel
  }

  const gapKey = (gap) =>
    String(gap?.id || gap?.message || gap?.description || JSON.stringify(gap))

  /** @type {Map<string, object>} */
  const gapsByKey = new Map()
  for (const gap of [...(primary.evidenceGaps || []), ...(secondary.evidenceGaps || [])]) {
    gapsByKey.set(gapKey(gap), gap)
  }

  const searches = [
    ...(primary.searches || []),
    ...(secondary.searches || []),
  ]
  // Keep graph evidence bounded — full multi-pass dumps can exceed LLM context
  const graphEvidence = [
    ...(primary.graphEvidence || []).slice(-1),
    ...(secondary.graphEvidence || []).slice(-1),
  ].map((block) => ({
    ...block,
    nodes: Array.isArray(block.nodes) ? block.nodes.slice(0, 30) : [],
    edges: Array.isArray(block.edges) ? block.edges.slice(0, 30) : [],
    paths: Array.isArray(block.paths) ? block.paths.slice(0, 15) : [],
  }))
  const providerStatuses = [
    ...(primary.providerStatuses || []),
    ...(secondary.providerStatuses || []),
  ]

  const statsA = primary.explorationStats || {}
  const statsB = secondary.explorationStats || {}
  const acquisition = mergeAcquisitionArtifacts(primary, secondary)

  return {
    runId: options.runId || secondary.runId || primary.runId,
    sessionId: primary.sessionId || secondary.sessionId,
    researchQuestion:
      primary.researchQuestion || secondary.researchQuestion || '',
    searches,
    papers: [...papersById.values()],
    graphEvidence,
    evidenceGaps: [...gapsByKey.values()],
    explorationStats: {
      queriesExecuted:
        (statsA.queriesExecuted || 0) + (statsB.queriesExecuted || 0),
      papersDiscovered:
        (statsA.papersDiscovered || 0) + (statsB.papersDiscovered || 0),
      uniqueCanonicalPapers: papersById.size,
      graphRagQueries:
        (statsA.graphRagQueries || 0) + (statsB.graphRagQueries || 0),
      discoveryAllFailed: Boolean(
        statsA.discoveryAllFailed && statsB.discoveryAllFailed,
      ),
      refinementMerged: true,
    },
    limits: secondary.limits || primary.limits || {},
    providerStatuses,
    planSummary: primary.planSummary || secondary.planSummary || {},
    explorationPasses: 2,
    ...acquisition,
  }
}

export default {
  mergeEvidencePackages,
}
