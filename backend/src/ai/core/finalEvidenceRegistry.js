/**
 * @fileoverview Canonical final evidence registry for TRACE reports.
 * Single source of truth: paper → evidenceItem → finding → reference/citation.
 */
import {
  evidenceLevelFromItem,
  EVIDENCE_LEVEL,
  normalizeEvidenceLevel,
  evidenceLevelRank,
} from './evidenceLevels.js'
import { buildEvidenceLocationFromItem } from './evidenceLocation.js'
import {
  isEligibleFinalSupportingPaper,
} from '../../graphRag/relevanceScorer.js'
import { normalizePaperOrigin } from './retrievalAudit.js'

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Infer evidence source / availability from paper metadata (no fabrication).
 *
 * @param {object|null|undefined} paper
 * @returns {{ sourceType: string, availability: string }}
 */
export function inferEvidenceAvailability(paper) {
  const loc = paper?.evidenceLocation
  const hasLocation =
    loc &&
    typeof loc === 'object' &&
    Boolean(
      asString(loc.page) ||
        asString(loc.section) ||
        asString(loc.paragraph) ||
        asString(loc.sentence),
    )

  if (hasLocation) {
    return {
      sourceType: 'full_text',
      availability: 'available',
      evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
    }
  }

  if (asString(paper?.abstract)) {
    return {
      sourceType: 'abstract',
      availability: 'pending_full_text',
      evidenceLevel: EVIDENCE_LEVEL.ABSTRACT,
    }
  }

  return {
    sourceType: 'metadata',
    availability: 'pending_full_text',
    evidenceLevel: EVIDENCE_LEVEL.METADATA,
  }
}

/**
 * @param {object} item
 * @param {object|null|undefined} paper
 * @returns {object}
 */
export function normalizeEvidenceItem(item, paper = null) {
  const evidenceId = item?.evidenceId ? String(item.evidenceId) : null
  const paperId = item?.paperId ? String(item.paperId) : null
  const inferred = inferEvidenceAvailability(paper)

  return {
    evidenceId,
    paperId,
    role: asString(item?.role) || 'supporting',
    citation: asString(item?.citation) || null,
    sourceType: asString(item?.sourceType) || inferred.sourceType,
    availability: asString(item?.availability) || inferred.availability,
    evidenceLevel:
      asString(item?.evidenceLevel) ||
      evidenceLevelFromItem(item) ||
      inferred.evidenceLevel,
    section: item?.section ?? null,
    paragraphIndex: item?.paragraphIndex ?? null,
    sentenceIndex: item?.sentenceIndex ?? null,
    page: item?.page ?? null,
    text: asString(item?.text) || null,
    fallbackReason: asString(item?.fallbackReason) || null,
  }
}

/**
 * @param {string} field
 * @param {unknown} value
 * @returns {boolean}
 */
function hasValidFieldValue(field, value) {
  if (value === null || value === undefined) return false
  if (field === 'paragraphIndex' || field === 'sentenceIndex') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (field === 'page') {
    return typeof value === 'number' && Number.isFinite(value) || asString(value) !== ''
  }
  return asString(value) !== ''
}

/**
 * @param {string} field
 * @param {unknown} current
 * @param {unknown} incoming
 * @returns {unknown}
 */
function pickRicherFieldValue(field, current, incoming) {
  if (!hasValidFieldValue(field, incoming)) return current
  if (!hasValidFieldValue(field, current)) return incoming
  return current
}

/**
 * Merge two representations of the same evidenceId (never downgrade FULL_TEXT).
 *
 * @param {object|null|undefined} primary
 * @param {object|null|undefined} secondary
 * @param {object|null|undefined} [paper]
 * @returns {object}
 */
export function mergeEvidenceItemRepresentations(primary, secondary, paper = null) {
  if (!primary && !secondary) return normalizeEvidenceItem({}, paper)
  if (!secondary) return normalizeEvidenceItem(primary, paper)
  if (!primary) return normalizeEvidenceItem(secondary, paper)

  const primaryLevel = normalizeEvidenceLevel(
    primary.evidenceLevel || evidenceLevelFromItem(primary),
  )
  const secondaryLevel = normalizeEvidenceLevel(
    secondary.evidenceLevel || evidenceLevelFromItem(secondary),
  )
  const primaryRank = evidenceLevelRank(primaryLevel)
  const secondaryRank = evidenceLevelRank(secondaryLevel)
  const base = primaryRank >= secondaryRank ? primary : secondary
  const supplement = primaryRank >= secondaryRank ? secondary : primary
  const mergedLevel =
    primaryRank >= secondaryRank ? primaryLevel : secondaryLevel

  const normalized = normalizeEvidenceItem(base, paper)
  const supplementNorm = normalizeEvidenceItem(supplement, paper)

  if (evidenceLevelRank(normalized.evidenceLevel) < evidenceLevelRank(mergedLevel)) {
    normalized.evidenceLevel = mergedLevel
    if (mergedLevel === EVIDENCE_LEVEL.FULL_TEXT) {
      if (normalized.sourceType === 'abstract') normalized.sourceType = 'full_text'
      if (normalized.availability === 'pending_full_text') {
        normalized.availability = 'available'
      }
    }
  }

  for (const field of [
    'section',
    'paragraphIndex',
    'sentenceIndex',
    'page',
    'text',
    'citation',
    'role',
    'fallbackReason',
  ]) {
    normalized[field] = pickRicherFieldValue(field, normalized[field], supplementNorm[field])
    normalized[field] = pickRicherFieldValue(field, normalized[field], supplement[field])
  }

  normalized.evidenceId =
    normalized.evidenceId || supplementNorm.evidenceId || supplement.evidenceId || null
  normalized.paperId =
    normalized.paperId || supplementNorm.paperId || supplement.paperId || null

  return normalized
}

/**
 * @param {object} [options]
 * @returns {object[]}
 */
function collectSourceEvidenceItems(options = {}) {
  if (Array.isArray(options.sourceEvidenceItems)) {
    return options.sourceEvidenceItems
  }

  /** @type {object[]} */
  const items = []
  const seen = new Set()
  for (const source of [
    options.allExtractedEvidenceItems,
    options.extractedEvidenceItems,
  ]) {
    if (!Array.isArray(source)) continue
    for (const item of source) {
      const evidenceId = String(item?.evidenceId || '')
      if (!evidenceId || seen.has(evidenceId)) continue
      seen.add(evidenceId)
      items.push(item)
    }
  }
  return items
}

/**
 * @param {object[]} sourceEvidenceItems
 * @returns {Map<string, object>}
 */
function indexSourceEvidenceItems(sourceEvidenceItems = []) {
  /** @type {Map<string, object>} */
  const byId = new Map()
  for (const item of sourceEvidenceItems || []) {
    const evidenceId = String(item?.evidenceId || '')
    if (!evidenceId) continue
    const existing = byId.get(evidenceId)
    byId.set(
      evidenceId,
      existing ? mergeEvidenceItemRepresentations(existing, item) : item,
    )
  }
  return byId
}

/**
 * @param {object[]} corpusPapers
 * @returns {Map<string, object>}
 */
function indexCorpusPapers(corpusPapers = []) {
  /** @type {Map<string, object>} */
  const byId = new Map()
  for (const paper of corpusPapers || []) {
    const id = String(paper?.paperId || paper?.id || paper?._id || '')
    if (id) byId.set(id, paper)
  }
  return byId
}

/**
 * @param {object|null|undefined} paper
 * @returns {object}
 */
function paperLikeForRelevance(paper) {
  return {
    _id: paper?.paperId || paper?._id || paper?.id || null,
    title: paper?.title || '',
    abstract: paper?.abstract || '',
    keywords: paper?.keywords || [],
    venue: paper?.venue || '',
    authors: paper?.authors || [],
  }
}

/**
 * Remove final supporting papers that fail the existing title-distinctive relevance gate.
 *
 * @param {object} registry
 * @param {Map<string, object>} corpusById
 * @param {string} [researchQuestion]
 * @returns {object}
 */
function filterRegistryForFinalPaperRelevance(
  registry,
  corpusById,
  researchQuestion = '',
) {
  const question = asString(researchQuestion)
  if (!question) return registry

  const allowedPaperIds = new Set()
  for (const paperId of registry.paperIds || []) {
    const paper = corpusById.get(String(paperId))
    if (!paper) continue
    if (isEligibleFinalSupportingPaper(question, paperLikeForRelevance(paper))) {
      allowedPaperIds.add(String(paperId))
    }
  }

  if (allowedPaperIds.size === (registry.paperIds || []).length) {
    return registry
  }

  const evidenceItems = (registry.evidenceItems || []).filter((item) =>
    allowedPaperIds.has(String(item.paperId)),
  )
  const allowedEvidenceIds = new Set(
    evidenceItems.map((item) => String(item.evidenceId)).filter(Boolean),
  )

  const findings = (registry.findings || []).map((finding) => ({
    ...finding,
    paperIds: (finding.paperIds || [])
      .map(String)
      .filter((paperId) => allowedPaperIds.has(paperId)),
    evidenceIds: (finding.evidenceIds || [])
      .map(String)
      .filter((evidenceId) => allowedEvidenceIds.has(evidenceId)),
  }))

  const references = (registry.references || []).filter(
    (ref) => ref?.paperId && allowedPaperIds.has(String(ref.paperId)),
  )

  /** @type {Record<string, string>} */
  const evidenceIdToPaperId = {}
  for (const [evidenceId, paperId] of Object.entries(
    registry.evidenceIdToPaperId || {},
  )) {
    if (allowedPaperIds.has(String(paperId))) {
      evidenceIdToPaperId[String(evidenceId)] = String(paperId)
    }
  }

  const papers = (registry.papers || []).filter((paper) =>
    allowedPaperIds.has(
      String(paper?.paperId || paper?._id || paper?.id || ''),
    ),
  )

  return {
    ...registry,
    findings,
    evidenceItems,
    references,
    paperIds: [...allowedPaperIds],
    evidenceIds: [...allowedEvidenceIds],
    evidenceIdToPaperId,
    papers,
    stats: {
      ...registry.stats,
      findingCount: findings.length,
      evidenceCount: evidenceItems.length,
      referenceCount: references.length,
      paperCount: allowedPaperIds.size,
    },
  }
}

/**
 * Record papers removed by the relevance gate (observability only).
 *
 * @param {object} registry
 * @param {Map<string, object>} corpusById
 * @param {string} researchQuestion
 * @returns {object[]}
 */
export function collectRegistryRelevanceDrops(
  registry,
  corpusById,
  researchQuestion = '',
) {
  const question = asString(researchQuestion)
  if (!question) return []

  /** @type {object[]} */
  const drops = []
  for (const paperId of registry.paperIds || []) {
    const paper = corpusById.get(String(paperId))
    if (!paper) continue
    if (isEligibleFinalSupportingPaper(question, paperLikeForRelevance(paper))) {
      continue
    }
    drops.push({
      paperId: String(paperId),
      title: paper.title || '',
      origin: normalizePaperOrigin(
        paper.source || paper.provenance?.origin || paper.provenance?.providers?.[0],
      ),
      stage: 'finalEvidenceRegistry',
      reason: 'relevance_gate',
      relevance:
        typeof paper.relevance === 'number'
          ? paper.relevance
          : typeof paper.queryRelevance === 'number'
            ? paper.queryRelevance
            : null,
    })
  }
  return drops
}

/**
 * Build canonical registry from validated synthesizer output.
 *
 * @param {object} synthesis
 * @param {{
 *   corpusPapers?: object[],
 *   evidenceIdToPaperId?: Map<string, string>|Record<string, string>,
 *   sourceEvidenceItems?: object[],
 *   extractedEvidenceItems?: object[],
 *   allExtractedEvidenceItems?: object[],
 *   synthesizerPaperIds?: string[],
 *   researchQuestion?: string
 * }} [options]
 * @returns {object}
 */
export function buildFinalEvidenceRegistryFromSynthesis(
  synthesis,
  options = {},
) {
  const corpusById = indexCorpusPapers(options.corpusPapers)
  const sourceById = indexSourceEvidenceItems(collectSourceEvidenceItems(options))
  const excluded = new Set((synthesis?.excludedFindingIds || []).map(String))

  const findings = (synthesis?.findings || []).filter((finding) => {
    const handling = String(finding?.handling || '').toUpperCase()
    if (handling === 'EXCLUDE') return false
    if (excluded.has(String(finding?.id))) return false
    return Boolean(asString(finding?.statement) || finding?.id)
  })

  /** @type {Map<string, string>} */
  const evidenceIdToPaperId = new Map()
  const mapInput = options.evidenceIdToPaperId
  if (mapInput instanceof Map) {
    for (const [k, v] of mapInput) evidenceIdToPaperId.set(String(k), String(v))
  } else if (mapInput && typeof mapInput === 'object') {
    for (const [k, v] of Object.entries(mapInput)) {
      evidenceIdToPaperId.set(String(k), String(v))
    }
  }

  const paperIds = new Set()
  const evidenceIds = new Set()
  const synthesizerPaperIds = new Set(
    (options.synthesizerPaperIds || [])
      .map(String)
      .filter((paperId) => corpusById.has(paperId)),
  )

  for (const paperId of synthesizerPaperIds) {
    paperIds.add(paperId)
  }

  /** @type {Map<string, object>} */
  const evidenceById = new Map()

  for (const item of synthesis?.evidence || []) {
    if (!item?.paperId && !item?.evidenceId) continue
    if (item?.paperId) paperIds.add(String(item.paperId))
    if (item?.evidenceId) {
      const eid = String(item.evidenceId)
      evidenceIds.add(eid)
      const mapped = evidenceIdToPaperId.get(eid)
      if (mapped) paperIds.add(mapped)
    }
    const paper = corpusById.get(String(item.paperId))
    const sourceItem = item.evidenceId
      ? sourceById.get(String(item.evidenceId))
      : null
    const normalized = mergeEvidenceItemRepresentations(item, sourceItem, paper)
    if (normalized.evidenceId) {
      evidenceById.set(normalized.evidenceId, normalized)
      if (normalized.paperId) {
        evidenceIdToPaperId.set(normalized.evidenceId, normalized.paperId)
      }
    }
  }

  for (const finding of findings) {
    for (const paperId of finding.paperIds || []) {
      paperIds.add(String(paperId))
    }
    for (const evidenceId of finding.evidenceIds || []) {
      const eid = String(evidenceId)
      evidenceIds.add(eid)
      const mapped = evidenceIdToPaperId.get(eid)
      if (mapped) paperIds.add(mapped)
    }
  }

  for (const ref of synthesis?.references || []) {
    if (ref?.paperId) {
      paperIds.add(String(ref.paperId))
    }
    for (const evidenceId of ref.evidenceIds || []) {
      const eid = String(evidenceId)
      evidenceIds.add(eid)
      const mapped = evidenceIdToPaperId.get(eid)
      if (mapped) paperIds.add(mapped)
    }
  }

  /** @type {object[]} */
  const evidenceItems = []
  for (const evidenceId of evidenceIds) {
    const existing = evidenceById.get(evidenceId)
    if (existing) {
      evidenceItems.push(existing)
      continue
    }
    const paperId = evidenceIdToPaperId.get(evidenceId)
    if (!paperId) continue
    const paper = corpusById.get(paperId)
    const sourceItem = sourceById.get(evidenceId)
    evidenceItems.push(
      mergeEvidenceItemRepresentations(
        { evidenceId, paperId, role: 'supporting' },
        sourceItem,
        paper,
      ),
    )
  }

  for (const paperId of paperIds) {
    if (![...evidenceItems].some((item) => item.paperId === paperId)) {
      const paper = corpusById.get(paperId)
      evidenceItems.push(
        normalizeEvidenceItem({ paperId, evidenceId: null, role: 'supporting' }, paper),
      )
    }
  }

  const references = (synthesis?.references || []).filter((ref) =>
    ref?.paperId ? paperIds.has(String(ref.paperId)) : false,
  )

  const findingLinkedPaperIds = new Set()
  for (const finding of findings) {
    for (const paperId of finding.paperIds || []) {
      findingLinkedPaperIds.add(String(paperId))
    }
    for (const evidenceId of finding.evidenceIds || []) {
      const mapped = evidenceIdToPaperId.get(String(evidenceId))
      if (mapped) findingLinkedPaperIds.add(String(mapped))
    }
  }

  const finalPaperIds = new Set([
    ...findingLinkedPaperIds,
    ...synthesizerPaperIds,
  ])

  const papers = [...finalPaperIds]
    .map((id) => corpusById.get(id))
    .filter(Boolean)

  const filteredEvidenceItems = evidenceItems.filter((item) =>
    finalPaperIds.has(String(item.paperId)),
  )
  const filteredReferences = references.filter((ref) =>
    finalPaperIds.has(String(ref.paperId)),
  )

  const registry = {
    findings,
    evidenceItems: filteredEvidenceItems,
    references: filteredReferences,
    paperIds: [...finalPaperIds],
    evidenceIds: [...evidenceIds].filter((evidenceId) =>
      filteredEvidenceItems.some((item) => String(item.evidenceId) === evidenceId),
    ),
    evidenceIdToPaperId: Object.fromEntries(
      [...evidenceIdToPaperId.entries()].filter(([, paperId]) =>
        finalPaperIds.has(String(paperId)),
      ),
    ),
    papers,
    stats: {
      findingCount: findings.length,
      evidenceCount: filteredEvidenceItems.length,
      referenceCount: filteredReferences.length,
      paperCount: finalPaperIds.size,
    },
  }

  const researchQuestion =
    options.researchQuestion || synthesis?.researchQuestion || ''
  const relevanceDrops = collectRegistryRelevanceDrops(
    registry,
    corpusById,
    researchQuestion,
  )
  const filtered = filterRegistryForFinalPaperRelevance(
    registry,
    corpusById,
    researchQuestion,
  )
  if (relevanceDrops.length) {
    filtered.auditRelevanceDrops = relevanceDrops
  }
  return filtered
}

/**
 * Resolve canonical registry from a persisted ResearchReport (+ optional corpus).
 *
 * @param {object|null|undefined} report
 * @param {object[]} [corpusPapers]
 * @returns {object}
 */
export function resolveFinalEvidenceRegistry(report, corpusPapers = []) {
  const conceptMap = report?.findingConceptMap || {}
  if (
    conceptMap.finalEvidenceRegistry &&
    typeof conceptMap.finalEvidenceRegistry === 'object'
  ) {
    const stored = conceptMap.finalEvidenceRegistry
    const corpusById = indexCorpusPapers(corpusPapers)
    const paperIds = (stored.paperIds || []).map(String)
    const papers =
      Array.isArray(stored.papers) && stored.papers.length
        ? stored.papers
        : paperIds.map((id) => corpusById.get(id)).filter(Boolean)

    return {
      ...stored,
      paperIds,
      papers,
      findings: stored.findings || conceptMap.findings || [],
      evidenceItems: stored.evidenceItems || report?.supportingEvidence || [],
      references: stored.references || conceptMap.references || [],
      evidenceIdToPaperId:
        stored.evidenceIdToPaperId || conceptMap.evidenceIdToPaperId || {},
    }
  }

  const synthesisLike = {
    findings: conceptMap.findings || [],
    evidence: report?.supportingEvidence || conceptMap.evidence || [],
    references: conceptMap.references || [],
    excludedFindingIds: conceptMap.excludedFindingIds || [],
  }

  return buildFinalEvidenceRegistryFromSynthesis(synthesisLike, {
    corpusPapers,
    evidenceIdToPaperId: conceptMap.evidenceIdToPaperId || {},
  })
}

/**
 * Resolve final paper records for API/UI from registry + discovery corpus.
 *
 * @param {object|null|undefined} report
 * @param {object[]} [corpusPapers]
 * @returns {object[]}
 */
export function resolveFinalPapers(report, corpusPapers = []) {
  const registry = resolveFinalEvidenceRegistry(report, corpusPapers)
  const corpusById = indexCorpusPapers(corpusPapers)
  const allEvidence = registry.evidenceItems || []

  return (registry.paperIds || []).map((paperId) => {
    const corpus = corpusById.get(String(paperId))
    const ref = (registry.references || []).find(
      (r) => String(r.paperId) === String(paperId),
    )
    const evidenceItem = pickPrimaryRegistryEvidenceItem(allEvidence, paperId)
    const location =
      buildEvidenceLocationFromItem(evidenceItem) ||
      corpus?.evidenceLocation ||
      null
    const shared = {
      evidenceSourceType:
        evidenceItem?.sourceType || inferEvidenceAvailability(corpus).sourceType,
      evidenceAvailability:
        evidenceItem?.availability || inferEvidenceAvailability(corpus).availability,
      evidenceLevel:
        evidenceItem?.evidenceLevel ||
        corpus?.evidenceLevel ||
        inferEvidenceAvailability(corpus).evidenceLevel,
      evidenceLocation: location,
      fallbackReason:
        evidenceItem?.fallbackReason || corpus?.fallbackReason || null,
    }
    if (corpus) {
      return {
        ...corpus,
        paperId: String(paperId),
        ...shared,
      }
    }
    return {
      paperId: String(paperId),
      title: ref?.title || ref?.citation || 'Untitled paper',
      year: ref?.year ?? null,
      source: ref?.source || null,
      providers: ref?.providers || [],
      authors: [],
      abstract: '',
      ...shared,
    }
  })
}

/**
 * @param {object[]} items
 * @param {string} paperId
 * @returns {object|null}
 */
function pickPrimaryRegistryEvidenceItem(items, paperId) {
  const paperItems = (items || []).filter(
    (item) => String(item.paperId) === String(paperId),
  )
  if (!paperItems.length) return null
  const fullText = paperItems.filter(
    (item) =>
      String(item.evidenceLevel || '').toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT ||
      item.sourceType === 'full_text',
  )
  const pool = fullText.length ? fullText : paperItems
  return (
    pool.find((item) => buildEvidenceLocationFromItem(item)) ||
    pool[0] ||
    null
  )
}

export default {
  inferEvidenceAvailability,
  normalizeEvidenceItem,
  mergeEvidenceItemRepresentations,
  buildFinalEvidenceRegistryFromSynthesis,
  collectRegistryRelevanceDrops,
  resolveFinalEvidenceRegistry,
  resolveFinalPapers,
}
