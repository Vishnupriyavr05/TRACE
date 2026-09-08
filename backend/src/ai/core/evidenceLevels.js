/**
 * @fileoverview Canonical evidence levels and claim-strength rules for TRACE.
 */

export const EVIDENCE_LEVEL = Object.freeze({
  FULL_TEXT: 'FULL_TEXT',
  ABSTRACT: 'ABSTRACT',
  METADATA: 'METADATA',
  UNAVAILABLE: 'UNAVAILABLE',
})

/** @type {Record<string, number>} */
export const EVIDENCE_LEVEL_RANK = Object.freeze({
  UNAVAILABLE: 0,
  METADATA: 1,
  ABSTRACT: 2,
  FULL_TEXT: 3,
})

export const CLAIM_STRENGTH = Object.freeze({
  DESCRIPTIVE: 'DESCRIPTIVE',
  ABSTRACT_LEVEL: 'ABSTRACT_LEVEL',
  METHODOLOGICAL: 'METHODOLOGICAL',
  EMPIRICAL_RESULT: 'EMPIRICAL_RESULT',
  GAP_STRONG: 'GAP_STRONG',
  ABSENCE: 'ABSENCE',
})

/** Minimum evidence level required per claim strength. */
export const CLAIM_EVIDENCE_REQUIREMENTS = Object.freeze({
  DESCRIPTIVE: EVIDENCE_LEVEL.METADATA,
  ABSTRACT_LEVEL: EVIDENCE_LEVEL.ABSTRACT,
  METHODOLOGICAL: EVIDENCE_LEVEL.FULL_TEXT,
  EMPIRICAL_RESULT: EVIDENCE_LEVEL.FULL_TEXT,
  GAP_STRONG: EVIDENCE_LEVEL.FULL_TEXT,
  ABSENCE: EVIDENCE_LEVEL.ABSTRACT,
})

const ABSENCE_PATTERNS = [
  /\bno (studies|papers|research|evidence|literature)\b/i,
  /\black(s|ing)? (of|in)\b/i,
  /\bnot (studied|addressed|covered|explored|reported)\b/i,
  /\bunder[- ]researched\b/i,
  /\bremains? (unclear|unknown|unexplored)\b/i,
  /\bgap(s)? (in|remain|exists?)\b/i,
  /\binsufficient (evidence|literature|research)\b/i,
]

const METHODOLOGICAL_PATTERNS = [
  /\bmethod(s|ology|ological)?\b/i,
  /\bexperiment(al)?\b/i,
  /\bdataset\b/i,
  /\bsample size\b/i,
  /\bprotocol\b/i,
  /\bstatistical\b/i,
]

const EMPIRICAL_PATTERNS = [
  /\bresult(s)?\b/i,
  /\bfinding(s)?\b/i,
  /\bperformance\b/i,
  /\baccuracy\b/i,
  /\bimprov(e|es|ed|ement)\b/i,
  /\bmeasured\b/i,
  /\boutperform(s|ed)?\b/i,
]

const GAP_STRONG_PATTERNS = [
  /\bresearch gap\b/i,
  /\bopen (question|problem)\b/i,
  /\bfuture work\b/i,
  /\bunderexplored\b/i,
]

/**
 * @param {unknown} level
 * @returns {string}
 */
export function normalizeEvidenceLevel(level) {
  const upper = String(level || '').trim().toUpperCase()
  if (upper in EVIDENCE_LEVEL_RANK) return upper
  if (upper === 'FULL_TEXT' || upper === 'FULL-TEXT') return EVIDENCE_LEVEL.FULL_TEXT
  return EVIDENCE_LEVEL.UNAVAILABLE
}

/**
 * @param {unknown} level
 * @returns {number}
 */
export function evidenceLevelRank(level) {
  return EVIDENCE_LEVEL_RANK[normalizeEvidenceLevel(level)] ?? 0
}

/**
 * Infer claim strength from finding statement (deterministic, no LLM).
 *
 * @param {string} statement
 * @returns {string}
 */
export function inferClaimStrength(statement) {
  const text = String(statement || '').trim()
  if (!text) return CLAIM_STRENGTH.DESCRIPTIVE

  if (ABSENCE_PATTERNS.some((re) => re.test(text))) {
    return CLAIM_STRENGTH.ABSENCE
  }
  if (GAP_STRONG_PATTERNS.some((re) => re.test(text))) {
    return CLAIM_STRENGTH.GAP_STRONG
  }
  if (METHODOLOGICAL_PATTERNS.some((re) => re.test(text))) {
    return CLAIM_STRENGTH.METHODOLOGICAL
  }
  if (EMPIRICAL_PATTERNS.some((re) => re.test(text))) {
    return CLAIM_STRENGTH.EMPIRICAL_RESULT
  }
  if (/\babstract\b/i.test(text)) {
    return CLAIM_STRENGTH.ABSTRACT_LEVEL
  }
  return CLAIM_STRENGTH.DESCRIPTIVE
}

/**
 * @param {string} claimStrength
 * @returns {string}
 */
export function requiredEvidenceLevelForClaim(claimStrength) {
  return (
    CLAIM_EVIDENCE_REQUIREMENTS[claimStrength] || EVIDENCE_LEVEL.METADATA
  )
}

/**
 * @param {string} claimStrength
 * @param {string} evidenceLevel
 * @returns {boolean}
 */
export function claimSupportedByEvidenceLevel(claimStrength, evidenceLevel) {
  const required = requiredEvidenceLevelForClaim(claimStrength)
  return evidenceLevelRank(evidenceLevel) >= evidenceLevelRank(required)
}

/**
 * Highest evidence level among items.
 *
 * @param {object[]} evidenceItems
 * @returns {string}
 */
export function maxEvidenceLevelForItems(evidenceItems = []) {
  let max = EVIDENCE_LEVEL.UNAVAILABLE
  for (const item of evidenceItems || []) {
    const level = normalizeEvidenceLevel(item.evidenceLevel)
    if (evidenceLevelRank(level) > evidenceLevelRank(max)) {
      max = level
    }
  }
  return max
}

/**
 * Map legacy sourceType to evidence level.
 *
 * @param {object|null|undefined} item
 * @returns {string}
 */
export function evidenceLevelFromItem(item) {
  if (item?.evidenceLevel) return normalizeEvidenceLevel(item.evidenceLevel)
  const sourceType = String(item?.sourceType || '').toLowerCase()
  if (sourceType === 'full_text') return EVIDENCE_LEVEL.FULL_TEXT
  if (sourceType === 'abstract') return EVIDENCE_LEVEL.ABSTRACT
  if (sourceType === 'metadata') return EVIDENCE_LEVEL.METADATA
  return EVIDENCE_LEVEL.UNAVAILABLE
}

export default {
  EVIDENCE_LEVEL,
  EVIDENCE_LEVEL_RANK,
  CLAIM_STRENGTH,
  CLAIM_EVIDENCE_REQUIREMENTS,
  normalizeEvidenceLevel,
  evidenceLevelRank,
  inferClaimStrength,
  requiredEvidenceLevelForClaim,
  claimSupportedByEvidenceLevel,
  maxEvidenceLevelForItems,
  evidenceLevelFromItem,
}
