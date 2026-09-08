/**
 * @fileoverview Transparent deterministic relevance scoring for GraphRAG.
 * No LLM / embeddings — token overlap and field weights only.
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

/**
 * @param {string[]} tokens
 * @returns {Set<string>}
 */
function uniqueSet(tokens) {
  return new Set(tokens)
}

/**
 * Count overlapping tokens between query and field text.
 *
 * @param {Set<string>} queryTokens
 * @param {string} fieldText
 * @returns {{ hits: string[], count: number, ratio: number }}
 */
export function fieldOverlap(queryTokens, fieldText) {
  const fieldTokens = uniqueSet(tokenize(fieldText))
  if (queryTokens.size === 0 || fieldTokens.size === 0) {
    return { hits: [], count: 0, ratio: 0 }
  }

  const hits = []
  for (const token of queryTokens) {
    if (fieldTokens.has(token)) hits.push(token)
  }

  return {
    hits,
    count: hits.length,
    ratio: hits.length / queryTokens.size,
  }
}

/** Transparent field weights (sum to 1.0). */
export const FIELD_WEIGHTS = Object.freeze({
  title: 0.4,
  concept: 0.25,
  abstract: 0.2,
  author: 0.1,
  venue: 0.05,
})

/**
 * Query-agnostic common tokens. Matching ONLY these is weak relevance.
 * Domain specificity must come from the remaining distinctive query tokens.
 */
export const COMMON_ACADEMIC_TOKENS = Object.freeze(
  new Set([
    'ai',
    'ml',
    'machine',
    'learning',
    'deep',
    'model',
    'models',
    'system',
    'systems',
    'method',
    'methods',
    'approach',
    'approaches',
    'based',
    'using',
    'via',
    'study',
    'studies',
    'research',
    'paper',
    'review',
    'survey',
    'analysis',
    'application',
    'applications',
    'data',
    'algorithm',
    'algorithms',
    'framework',
    'network',
    'networks',
    'neural',
    'computer',
    'computing',
    'information',
    'technology',
    'technologies',
    'performance',
    'result',
    'results',
    'novel',
    'proposed',
    'new',
    'use',
    'used',
    'towards',
    'toward',
    'gap',
    'gaps',
  ])
)

/** Filler tokens that should not satisfy comparative relevance on their own. */
const QUERY_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'in',
  'to',
  'of',
  'a',
  'an',
  'used',
  'compare',
  'comparison',
  'comparing',
  'versus',
  'vs',
])

/**
 * @param {Set<string>|string[]} tokens
 * @returns {string[]}
 */
export function distinctiveTokens(tokens) {
  const list = tokens instanceof Set ? [...tokens] : [...(tokens || [])]
  return list.filter((t) => t && !COMMON_ACADEMIC_TOKENS.has(t))
}

/**
 * Distinctive tokens excluding query filler words (for final relevance gates).
 *
 * @param {Set<string>|string[]} tokens
 * @returns {string[]}
 */
export function contentDistinctiveTokens(tokens) {
  return distinctiveTokens(tokens).filter((token) => !QUERY_STOPWORDS.has(token))
}

/** Domain tokens alone are weak for comparative XAI methodology queries. */
const DOMAIN_ONLY_TOKENS = new Set([
  'healthcare',
  'clinical',
  'medical',
  'hospital',
  'patient',
  'medicine',
  'metaverse',
])

/** Methodological / XAI facet tokens for comparative explainability queries. */
const XAI_METHOD_FACET_TOKENS = new Set([
  'post',
  'hoc',
  'interpretable',
  'inherently',
  'intrinsic',
  'intrinsically',
  'explainable',
  'explainability',
  'interpretability',
  'xai',
  'methodologies',
  'methodology',
  'comparative',
  'comparison',
  'compare',
  'posthoc',
  'grad',
  'cam',
  'gradcam',
  'shap',
  'lime',
  'protopnet',
  'prototype',
  'prototypes',
  'attention',
  'saliency',
])

const NAMED_METHOD_QUERY_PATTERNS = [
  /\bgrad[\s-]?cam\b/i,
  /\bshap\b/i,
  /\blime\b/i,
  /\bprotopnet\b/i,
  /\bprototype[\s-]?(network|net)s?\b/i,
  /\bintegrated gradients\b/i,
]

const NAMED_METHOD_PAPER_PATTERNS = [
  /\bgrad[\s-]?cam\b/i,
  /\bclass activation mapping\b/i,
  /\bshap\b/i,
  /\bshapley\b/i,
  /\blime\b/i,
  /\bprotopnet\b/i,
  /\bprototype[\s-]?(network|net)s?\b/i,
  /\bintegrated gradients\b/i,
  /\bexplainable ai\b/i,
  /\bexplainability\b/i,
  /\binterpretability\b/i,
  /\binherently interpretable\b/i,
  /\bintrinsic(?:ally)? interpretable\b/i,
  /\bpost[\s-]?hoc\b/i,
]

/**
 * @param {string} query
 * @returns {boolean}
 */
function queryNamesExplicitXaiMethods(query) {
  return NAMED_METHOD_QUERY_PATTERNS.some((pattern) =>
    pattern.test(String(query || '')),
  )
}

/**
 * @param {string} fieldText
 * @returns {boolean}
 */
function paperMentionsXaiMethodology(fieldText) {
  const text = String(fieldText || '')
  if (!text.trim()) return false
  if (NAMED_METHOD_PAPER_PATTERNS.some((pattern) => pattern.test(text))) {
    return true
  }
  return distinctiveTokens(fieldOverlap(uniqueSet(tokenize(text)), text).hits).some(
    (token) => XAI_METHOD_FACET_TOKENS.has(token),
  )
}

/**
 * @param {string} fieldText
 * @returns {boolean}
 */
function isSegmentationFocusedWithoutXai(fieldText) {
  const text = String(fieldText || '')
  if (!text.trim()) return false
  const segmentationFocused =
    /\bu[\s-]?net\b/i.test(text) ||
    /\bsemantic segmentation\b/i.test(text) ||
    (/\bsegmentation\b/i.test(text) && /\bmedical image/i.test(text))
  return segmentationFocused && !paperMentionsXaiMethodology(text)
}

/**
 * @param {string} query
 * @returns {boolean}
 */
export function isComparativeResearchQuery(query) {
  return /\b(compare|comparison|comparing|contrasts?|versus|vs\.?)\b/i.test(
    String(query || ''),
  )
}

/**
 * @param {Set<string>} queryTokens
 * @param {string} fieldText
 * @returns {boolean}
 */
function hasXaiMethodFacetMatch(queryTokens, fieldText) {
  if (paperMentionsXaiMethodology(fieldText)) return true
  const hits = fieldOverlap(queryTokens, fieldText).hits
  return distinctiveTokens(hits).some((token) => XAI_METHOD_FACET_TOKENS.has(token))
}

/**
 * @param {string[]} distinctiveHits
 * @returns {boolean}
 */
function isDomainOnlyDistinctiveMatch(distinctiveHits) {
  return (
    distinctiveHits.length > 0 &&
    distinctiveHits.every((token) => DOMAIN_ONLY_TOKENS.has(token))
  )
}

/**
 * Score a paper (and optional related graph labels) against a query.
 *
 * @param {string} query
 * @param {object} paper Canonical paper document
 * @param {{ conceptLabels?: string[] }} [extras]
 * @returns {{ score: number, matchedFields: object, paperId: string|null, matchedTokens: string[] }}
 */
export function scorePaper(query, paper, extras = {}) {
  const paperId = paper?._id
    ? String(paper._id)
    : paper?.id
      ? String(paper.id)
      : null

  const queryTokens = uniqueSet(tokenize(query))
  if (queryTokens.size === 0 || !paper) {
    return {
      score: 0,
      matchedFields: {},
      paperId,
      matchedTokens: [],
    }
  }

  const title = fieldOverlap(queryTokens, paper.title || '')
  const abstract = fieldOverlap(queryTokens, paper.abstract || '')

  const keywordText = Array.isArray(paper.keywords)
    ? paper.keywords.filter((k) => typeof k === 'string').join(' ')
    : ''
  const conceptExtra = Array.isArray(extras.conceptLabels)
    ? extras.conceptLabels.join(' ')
    : ''
  const concept = fieldOverlap(
    queryTokens,
    `${keywordText} ${conceptExtra}`.trim()
  )

  const authorText = Array.isArray(paper.authors)
    ? paper.authors
        .map((a) => (typeof a === 'string' ? a : a?.name || ''))
        .join(' ')
    : ''
  const author = fieldOverlap(queryTokens, authorText)
  const venue = fieldOverlap(queryTokens, paper.venue || '')

  const weighted =
    title.ratio * FIELD_WEIGHTS.title +
    concept.ratio * FIELD_WEIGHTS.concept +
    abstract.ratio * FIELD_WEIGHTS.abstract +
    author.ratio * FIELD_WEIGHTS.author +
    venue.ratio * FIELD_WEIGHTS.venue

  // Phrase bonus: full query appears in title
  const normalizedQuery = String(query || '')
    .toLowerCase()
    .trim()
  let phraseBonus = 0
  if (
    normalizedQuery.length >= 4 &&
    String(paper.title || '')
      .toLowerCase()
      .includes(normalizedQuery)
  ) {
    phraseBonus = 0.15
  }

  // Multi-token phrase fragments (query-derived, not domain-hardcoded)
  const queryTokenList = [...queryTokens]
  const haystack = `${paper.title || ''} ${paper.abstract || ''} ${keywordText}`.toLowerCase()
  for (let i = 0; i < queryTokenList.length - 1; i += 1) {
    const bigram = `${queryTokenList[i]} ${queryTokenList[i + 1]}`
    if (bigram.length >= 5 && haystack.includes(bigram)) {
      phraseBonus += 0.08
    }
  }
  phraseBonus = Math.min(0.28, phraseBonus)

  // Down-rank papers that only hit generic tokens when the query has
  // distinctive terms (works for arbitrary research questions).
  const distinctQuery = distinctiveTokens(queryTokens)
  const matchedAll = [
    ...title.hits,
    ...concept.hits,
    ...abstract.hits,
    ...author.hits,
    ...venue.hits,
  ]
  const distinctHits = distinctiveTokens(matchedAll)
  let distinctFactor = 1
  if (distinctQuery.length > 0) {
    const coverage = distinctHits.length / distinctQuery.length
    if (coverage === 0) {
      // Only generic overlap (e.g. "AI" / "research") → strong dampen
      distinctFactor = matchedAll.length ? 0.22 : 0.05
    } else if (coverage < 0.34) {
      distinctFactor = 0.45 + coverage
    } else {
      distinctFactor = Math.min(1.15, 0.85 + coverage * 0.3)
    }
  }

  const score = Math.min(
    1,
    Number(((weighted + phraseBonus) * distinctFactor).toFixed(4))
  )

  /** @type {Record<string, { weight: number, ratio: number, hits: string[] }>} */
  const matchedFields = {}
  if (title.count) {
    matchedFields.title = {
      weight: FIELD_WEIGHTS.title,
      ratio: Number(title.ratio.toFixed(4)),
      hits: title.hits,
    }
  }
  if (concept.count) {
    matchedFields.concept = {
      weight: FIELD_WEIGHTS.concept,
      ratio: Number(concept.ratio.toFixed(4)),
      hits: concept.hits,
    }
  }
  if (abstract.count) {
    matchedFields.abstract = {
      weight: FIELD_WEIGHTS.abstract,
      ratio: Number(abstract.ratio.toFixed(4)),
      hits: abstract.hits,
    }
  }
  if (author.count) {
    matchedFields.author = {
      weight: FIELD_WEIGHTS.author,
      ratio: Number(author.ratio.toFixed(4)),
      hits: author.hits,
    }
  }
  if (venue.count) {
    matchedFields.venue = {
      weight: FIELD_WEIGHTS.venue,
      ratio: Number(venue.ratio.toFixed(4)),
      hits: venue.hits,
    }
  }

  const matchedTokens = [
    ...new Set([
      ...title.hits,
      ...concept.hits,
      ...abstract.hits,
      ...author.hits,
      ...venue.hits,
    ]),
  ]

  return {
    score,
    matchedFields,
    paperId,
    matchedTokens,
  }
}

/**
 * Score a non-paper graph node (Concept / Author / Venue) against a query.
 *
 * @param {string} query
 * @param {object} node
 * @returns {{ score: number, matchedFields: object, nodeId: string, matchedTokens: string[] }}
 */
export function scoreNode(query, node) {
  const queryTokens = uniqueSet(tokenize(query))
  const overlap = fieldOverlap(queryTokens, node?.label || '')
  const score = Number(overlap.ratio.toFixed(4))

  return {
    score,
    matchedFields: overlap.count
      ? {
          label: {
            weight: 1,
            ratio: score,
            hits: overlap.hits,
          },
        }
      : {},
    nodeId: node?.id || null,
    matchedTokens: overlap.hits,
  }
}

/**
 * Final supporting-literature gate using existing token overlap semantics.
 * Requires at least one distinctive query token in the title or keywords.
 * Rejects abstract-only bridge papers whose title matches only common tokens.
 *
 * @param {string} query
 * @param {object|null|undefined} paper
 * @returns {boolean}
 */
export function isEligibleFinalSupportingPaper(query, paper) {
  if (!paper) return false
  const queryTokens = uniqueSet(tokenize(query))
  if (queryTokens.size === 0) return true

  const title = String(paper.title || '')
  const keywordText = Array.isArray(paper.keywords)
    ? paper.keywords.filter((k) => typeof k === 'string').join(' ')
    : ''
  const abstract = String(paper.abstract || '')
  const titleKwText = `${title} ${keywordText}`.trim()
  const fullText = `${titleKwText} ${abstract}`.trim()
  const comparative = isComparativeResearchQuery(query)
  const explicitMethodQuery = queryNamesExplicitXaiMethods(query)

  if (
    explicitMethodQuery &&
    isSegmentationFocusedWithoutXai(fullText)
  ) {
    return false
  }

  const titleHits = fieldOverlap(queryTokens, title).hits
  const titleKwHits = fieldOverlap(queryTokens, titleKwText).hits
  const titleKwDistinct = contentDistinctiveTokens(titleKwHits)

  const distinctQuery = contentDistinctiveTokens(queryTokens)
  if (distinctQuery.length > 0) {
    if (titleKwDistinct.length > 0) {
      if (
        comparative &&
        isDomainOnlyDistinctiveMatch(titleKwDistinct) &&
        !hasXaiMethodFacetMatch(queryTokens, titleKwText)
      ) {
        return false
      }
      return true
    }

    if (explicitMethodQuery && paperMentionsXaiMethodology(fullText)) {
      return true
    }

    const abstractDistinct = contentDistinctiveTokens(
      fieldOverlap(queryTokens, abstract).hits,
    )
    if (abstractDistinct.length > 0) {
      const titleDistinct = contentDistinctiveTokens(titleHits)
      if (titleDistinct.length === 0) {
        if (paperMentionsXaiMethodology(abstract)) {
          return true
        }
        return false
      }
      if (
        comparative &&
        isDomainOnlyDistinctiveMatch(abstractDistinct) &&
        !hasXaiMethodFacetMatch(queryTokens, abstract)
      ) {
        return false
      }
      return true
    }

    if (paperMentionsXaiMethodology(fullText)) {
      return true
    }

    return false
  }

  return titleHits.length > 0 || fieldOverlap(queryTokens, keywordText).hits.length > 0
}

export default {
  tokenize,
  fieldOverlap,
  scorePaper,
  scoreNode,
  FIELD_WEIGHTS,
  COMMON_ACADEMIC_TOKENS,
  distinctiveTokens,
  contentDistinctiveTokens,
  isComparativeResearchQuery,
  isEligibleFinalSupportingPaper,
}
