/**
 * @fileoverview Explorer search / GraphRAG bounding limits (config-driven).
 */
import {
  EXPLORER_MAX_SEARCH_QUERIES,
  EXPLORER_MAX_RESULTS_PER_QUERY,
  EXPLORER_MAX_TOTAL_PAPERS,
  EXPLORER_MAX_GRAPHRAG_CALLS,
  EXPLORER_MAX_REFINED_QUERIES,
} from '../../config/environment/env.js'
import {
  envNumber,
  getProfileArtifactLimits,
} from '../core/traceProfile.js'
import { NAMED_METHOD_PATTERNS } from './explorer.methodPatterns.js'
import {
  extractResearchQueryIntents,
} from '../core/queryIntents.js'
import {
  buildEvidenceTargets,
  selectDiverseEvidenceTargetQueries,
} from '../core/evidenceTargets.js'

/**
 * @returns {{
 *   maxSearchQueries: number,
 *   maxResultsPerQuery: number,
 *   maxTotalPapers: number,
 *   maxGraphRagCalls: number,
 *   maxRefinedQueries: number
 * }}
 */
export function getExplorerLimits() {
  const profile = getProfileArtifactLimits()
  return {
    maxSearchQueries: envNumber(
      'EXPLORER_MAX_SEARCH_QUERIES',
      profile.maxSearchQueries || EXPLORER_MAX_SEARCH_QUERIES,
    ),
    maxResultsPerQuery: envNumber(
      'EXPLORER_MAX_RESULTS_PER_QUERY',
      profile.maxResultsPerQuery || EXPLORER_MAX_RESULTS_PER_QUERY,
    ),
    maxTotalPapers: envNumber(
      'EXPLORER_MAX_TOTAL_PAPERS',
      profile.maxPapers || EXPLORER_MAX_TOTAL_PAPERS,
    ),
    maxGraphRagCalls: envNumber(
      'EXPLORER_MAX_GRAPHRAG_CALLS',
      profile.maxGraphRagCalls || EXPLORER_MAX_GRAPHRAG_CALLS,
    ),
    maxRefinedQueries: envNumber(
      'EXPLORER_MAX_REFINED_QUERIES',
      profile.maxRefinedQueries || EXPLORER_MAX_REFINED_QUERIES,
    ),
  }
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  )
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccardSimilarity(a, b) {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const t of a) {
    if (b.has(t)) inter += 1
  }
  const union = new Set([...a, ...b]).size
  return union ? inter / union : 0
}

/**
 * Spread indices across the planner list so later dimensions are not skipped.
 * When anchorIndex is set, that query is always retained (typically the broad
 * first Planner query) and the remaining slots are spread across the rest.
 *
 * @param {number} count
 * @param {number} limit
 * @param {number} [anchorIndex]
 * @returns {number[]}
 */
export function spreadSelectIndices(count, limit, anchorIndex = -1) {
  const n = Math.max(0, Number(count) || 0)
  const cap = Math.max(1, Number(limit) || 1)
  if (n <= cap) return Array.from({ length: n }, (_, i) => i)

  const anchor =
    Number.isInteger(anchorIndex) && anchorIndex >= 0 && anchorIndex < n
      ? anchorIndex
      : -1

  if (anchor >= 0 && cap > 1) {
    /** @type {number[]} */
    const remaining = []
    for (let i = 0; i < n; i += 1) {
      if (i !== anchor) remaining.push(i)
    }
    const tail = spreadSelectIndices(remaining.length, cap - 1)
    return [anchor, ...tail.map((i) => remaining[i])]
  }

  /** @type {number[]} */
  const indices = []
  const seen = new Set()
  for (let k = 0; k < cap; k += 1) {
    const idx = Math.min(n - 1, Math.round((k * (n - 1)) / (cap - 1)))
    if (!seen.has(idx)) {
      seen.add(idx)
      indices.push(idx)
    }
  }
  for (let i = 0; i < n && indices.length < cap; i += 1) {
    if (!seen.has(i)) {
      seen.add(i)
      indices.push(i)
    }
  }
  return indices
}

/**
 * @param {object|string} item
 * @returns {{ query: string, purpose: string, dimension: string }}
 */
function normalizeSearchQueryItem(item) {
  if (typeof item === 'string') {
    return { query: item.trim(), purpose: '', dimension: '' }
  }
  return {
    query: String(item?.query || '').trim(),
    purpose: String(item?.purpose || '').trim(),
    dimension: String(
      item?.dimension || item?.researchDimension || '',
    ).trim(),
  }
}

/**
 * Select planner queries up to max, spreading across purposes/dimensions.
 *
 * @param {object[]} searchQueries
 * @param {number} max
 * @param {{ researchQuestion?: string, researchDimensions?: string[] }} [context]
 * @returns {object[]}
 */
export function selectBoundedSearchQueries(
  searchQueries = [],
  max = 7,
  context = {},
) {
  const list = Array.isArray(searchQueries) ? searchQueries : []
  const limit = Math.max(1, Number(max) || 7)
  if (list.length <= limit) return [...list]

  const intents = extractResearchQueryIntents(context.researchQuestion || '')
  const dimensionHints = (context.researchDimensions || [])
    .map((d) => (typeof d === 'string' ? d : d?.name || d?.label || ''))
    .filter(Boolean)
  const normalized = list.map((item, index) => ({
    item,
    index,
    ...normalizeSearchQueryItem(item),
  }))

  /** @type {object[]} */
  const selected = []
  const selectedIndexes = new Set()
  const seenPurposeKeys = new Set()

  const scoreEntry = (entry) => {
    const text = `${entry.query} ${entry.purpose} ${entry.dimension}`.toLowerCase()
    let score = 0
    for (const method of intents.methods) {
      if (text.includes(method.toLowerCase())) score += 4
    }
    for (const dimension of intents.evaluationDimensions) {
      if (text.includes(dimension.toLowerCase())) score += 3
    }
    for (const hint of dimensionHints) {
      if (text.includes(String(hint).toLowerCase())) score += 3
    }
    for (const evidenceType of intents.evidenceTypes) {
      if (text.includes(evidenceType.toLowerCase())) score += 2
    }
    for (const target of buildEvidenceTargets(intents)) {
      if (target.type === 'method_dimension') {
        const methodHit = text.includes(String(target.method).toLowerCase())
        const dimHit = text.includes(String(target.dimension).toLowerCase())
        if (methodHit && dimHit) score += 5
        else if (methodHit) score += 3
      }
      if (target.type === 'comparison' && /\b(compare|versus|vs\.?)\b/i.test(text)) {
        score += 3
      }
      if (
        target.type === 'evidence_type' &&
        target.evidenceType === 'clinician studies' &&
        /\bclinician|clinical evaluation|reader study\b/i.test(text)
      ) {
        score += 3
      }
    }
    if (intents.domainPhrase && text.includes(intents.domainPhrase.toLowerCase())) {
      score += 2
    }
    if (/\b(compare|comparative|robustness|clinical|clinician)\b/i.test(text)) {
      score += 1
    }
    return score
  }

  // Phase 0: honor explicit planner researchDimensions from context.
  const purposeOrdered = [...normalized].sort(
    (a, b) => scoreEntry(b) - scoreEntry(a) || a.index - b.index,
  )
  for (const hint of dimensionHints) {
    if (selected.length >= limit) break
    const match = purposeOrdered.find((entry) => {
      if (selectedIndexes.has(entry.index)) return false
      const text = `${entry.query} ${entry.purpose} ${entry.dimension}`.toLowerCase()
      return text.includes(String(hint).toLowerCase())
    })
    if (!match) continue
    selected.push(match.item)
    selectedIndexes.add(match.index)
    seenPurposeKeys.add(
      (
        match.purpose.toLowerCase() ||
        match.dimension.toLowerCase() ||
        match.query.toLowerCase().split(/\s+/).slice(0, 4).join(' ')
      ).trim(),
    )
  }

  // Phase 1: preserve distinct planner purposes/dimensions (high-value intents).
  for (const entry of purposeOrdered) {
    if (selected.length >= limit) break
    const purposeKey = (
      entry.purpose.toLowerCase() ||
      entry.dimension.toLowerCase() ||
      entry.query.toLowerCase().split(/\s+/).slice(0, 4).join(' ')
    ).trim()
    if (!purposeKey || seenPurposeKeys.has(purposeKey)) continue
    selected.push(entry.item)
    selectedIndexes.add(entry.index)
    seenPurposeKeys.add(purposeKey)
  }

  // Phase 2: fill remaining slots by intent score, then original order.
  for (const entry of purposeOrdered) {
    if (selected.length >= limit) break
    if (selectedIndexes.has(entry.index)) continue
    selected.push(entry.item)
    selectedIndexes.add(entry.index)
  }

  // Phase 3: backfill any remaining slots in planner order.
  for (const entry of normalized) {
    if (selected.length >= limit) break
    if (selectedIndexes.has(entry.index)) continue
    selected.push(entry.item)
    selectedIndexes.add(entry.index)
  }

  /** @type {object[]} */
  const deduped = []
  const seenQueries = new Set()
  for (const item of selected) {
    const { query } = normalizeSearchQueryItem(item)
    const key = query.toLowerCase()
    if (!key || seenQueries.has(key)) continue
    seenQueries.add(key)
    deduped.push(item)
  }

  return deduped.slice(0, limit)
}

/**
 * Bound Planner search queries and annotate truncation.
 *
 * @param {object[]} searchQueries
 * @param {number} max
 * @param {{ researchQuestion?: string, researchDimensions?: string[] }} [context]
 * @returns {{ queries: object[], truncated: boolean, originalCount: number }}
 */
export function boundSearchQueries(searchQueries = [], max = 7, context = {}) {
  const list = Array.isArray(searchQueries) ? searchQueries : []
  const limit = Math.max(1, Number(max) || 7)
  const queries = selectBoundedSearchQueries(list, limit, context)
  return {
    queries,
    truncated: list.length > limit,
    originalCount: list.length,
  }
}

/**
 * Per-query discovery limit — independent of the final unique-paper cap.
 * External search volume is bounded by maxSearchQueries, not by shrinking
 * each query when earlier queries already filled the merge pool.
 *
 * @param {{ maxResultsPerQuery: number, maxTotalPapers: number }} limits
 * @param {number} [executionQueryCount]
 * @returns {number}
 */
export function resolvePerQueryDiscoveryLimit(
  limits,
  executionQueryCount = 1,
  queryItem = {},
) {
  const count = Math.max(1, Number(executionQueryCount) || 1)
  const recall = String(queryItem.recallProfile || '').replace('-', '_')
  if (queryItem.supplemental || recall === 'high_recall') {
    return limits.maxResultsPerQuery
  }
  const fairShare = Math.ceil((limits.maxTotalPapers * 1.5) / count)
  return Math.min(
    limits.maxResultsPerQuery,
    Math.max(4, fairShare),
  )
}

const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s"'<>]+/gi

/**
 * @param {string} queryA
 * @param {string} queryB
 * @returns {boolean}
 */
export function queriesNearlyEqual(queryA, queryB) {
  const a = tokenSet(queryA)
  const b = tokenSet(queryB)
  return jaccardSimilarity(a, b) >= 0.72
}

/**
 * Deterministic high-recall supplemental queries (not domain-specific).
 *
 * @param {string} researchQuestion
 * @param {{ searchQueries?: object[] }} [plan]
 * @returns {object[]}
 */
export function buildSupplementalDiscoveryQueries(researchQuestion, plan = {}) {
  const question = String(researchQuestion || '').trim()
  if (!question) return []

  const needsHighRecall =
    /\bgaps?\b|\blimitations?\b|\bchallenges?\b|\bopen questions?\b|\bfuture (research|directions?)\b|\bunderstudied\b|\bunder-explored\b/i.test(
      question,
    )
  if (!needsHighRecall) return []

  const stop = new Set([
    'research',
    'gaps',
    'gap',
    'challenges',
    'challenge',
    'limitations',
    'limitation',
    'study',
    'studies',
    'review',
    'reviews',
    'future',
    'directions',
    'direction',
    'the',
    'and',
    'for',
    'in',
    'of',
  ])
  const topicTokens = [...tokenSet(question)].filter((t) => !stop.has(t))
  if (!topicTokens.length) return []

  const topicPhrase = topicTokens.slice(0, 6).join(' ')
  const highRecallQuery = `${topicPhrase} research gaps OR challenges OR limitations`

  const existing = (plan.searchQueries || []).map((q) =>
    typeof q === 'string' ? q : q?.query || '',
  )
  if (existing.some((q) => queriesNearlyEqual(q, highRecallQuery))) {
    return []
  }

  return [
    {
      query: highRecallQuery,
      purpose:
        'High-recall discovery across gaps, challenges, and limitations',
      recallProfile: 'high_recall',
      supplemental: true,
    },
  ]
}

/**
 * @param {{ priorityTargets?: object[] }} plan
 * @param {string} researchQuestion
 * @returns {object[]}
 */
export function collectPriorityTargets(plan = {}, researchQuestion = '') {
  /** @type {object[]} */
  const targets = []
  const seen = new Set()

  for (const row of plan.priorityTargets || []) {
    const value = String(row?.value || '').trim()
    if (!value) continue
    const key = `${row.type || 'topic'}::${value.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({
      type: row.type || 'topic',
      value,
      reason: row.reason || '',
    })
  }

  for (const match of String(researchQuestion || '').matchAll(DOI_PATTERN)) {
    const doi = match[0].replace(/[.,;]+$/, '')
    const key = `doi::${doi.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({
      type: 'doi',
      value: doi,
      reason: 'DOI mentioned in research question',
    })
  }

  return targets.slice(0, 8)
}

/**
 * Preserve explicit named methods from the research question in discovery queries.
 *
 * @param {string} researchQuestion
 * @param {{ searchQueries?: object[] }} [plan]
 * @returns {object[]}
 */
export function buildMethodSpecificDiscoveryQueries(
  researchQuestion,
  plan = {},
  options = {},
) {
  const question = String(researchQuestion || '').trim()
  if (!question) return []

  const intents = extractResearchQueryIntents(question)
  if (!intents.methods.length) return []

  const maxSlots = Math.max(1, Number(options.maxSlots) || 5)
  return selectDiverseEvidenceTargetQueries(
    intents,
    maxSlots,
    plan.searchQueries,
  )
}

export { extractResearchQueryIntents } from '../core/queryIntents.js'

export default {
  getExplorerLimits,
  boundSearchQueries,
  selectBoundedSearchQueries,
  spreadSelectIndices,
  resolvePerQueryDiscoveryLimit,
  buildSupplementalDiscoveryQueries,
  buildMethodSpecificDiscoveryQueries,
  collectPriorityTargets,
  queriesNearlyEqual,
}
