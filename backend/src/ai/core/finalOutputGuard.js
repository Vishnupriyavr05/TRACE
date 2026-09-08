/**
 * @fileoverview Deterministic final-output guard for TRACE synthesis narratives.
 * Enforces the hard absence invariant: NOT_SEARCHED targets must never become
 * universal scientific-absence claims.
 */
import { NAMED_METHOD_PATTERNS } from '../agents/explorer.methodPatterns.js'
import { extractResearchQueryIntents } from './queryIntents.js'
import { mentionsMethod } from './synthesisQuality.js'
import {
  EVIDENCE_TARGET_STATE,
  enrichCoverageWithChainStates,
  formatEvidenceTargetLabel,
} from './evidenceChain.js'

const UNIVERSAL_ABSENCE_PATTERNS = [
  /\bno evidence\b/i,
  /\bno studies\b/i,
  /\bno relevant\b/i,
  /\bnot addressed\b/i,
  /\bis lacking\b/i,
  /\bare lacking\b/i,
  /\bthere are no\b/i,
  /\bdo not provide\b/i,
  /\bnot provide\b/i,
  /\bwas not found\b/i,
  /\bwere not found\b/i,
  /\bdoes not exist\b/i,
  /\bdon't exist\b/i,
  /\bno comparative\b/i,
  /\bno robustness\b/i,
  /\bno clinical validation\b/i,
  /\bno evidence on\b/i,
  /\bno literature\b/i,
  /\bnot substantiated\b/i,
  /\bno direct head-to-head\b/i,
  /\bno direct comparative\b/i,
]

const BROAD_ABSENCE_PATTERNS = [
  /\bacross methods\b/i,
  /\bcomparative evaluations\b/i,
  /\bhead-to-head\b/i,
  /\bno studies provide\b/i,
]

const DIMENSION_ALIASES = Object.freeze({
  interpretability: [
    'interpretability',
    'explainability',
    'interpretable',
    'explanation',
    'visualiz',
    'saliency',
  ],
  'diagnostic performance': [
    'diagnostic performance',
    'diagnostic',
    'accuracy',
    'auc',
    'sensitivity',
    'specificity',
  ],
  robustness: ['robustness', 'robust', 'adversarial', 'perturbation', 'stability'],
  'clinical usefulness': [
    'clinical usefulness',
    'clinical validation',
    'clinician',
    'user acceptance',
    'reader study',
    'workflow',
  ],
})

export const PAPER_PROSE_PATTERNS = [
  /\bremainder of the paper\b/i,
  /\bstructured as follows\b/i,
  /\bdeep learning models have shown\b/i,
  /\bthis paper (presents|proposes|introduces)\b/i,
  /\bin this (paper|study), we\b/i,
  /\bthe rest of (this|the) (paper|section)\b/i,
  /\brelated work\b/i,
]

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isPaperProseExcerpt(text) {
  return PAPER_PROSE_PATTERNS.some((pattern) => pattern.test(String(text || '')))
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isUniversalAbsenceClaim(text) {
  const value = String(text || '').trim()
  if (!value) return false
  if (UNIVERSAL_ABSENCE_PATTERNS.some((pattern) => pattern.test(value))) return true
  return /\bno\b.+\b(evidence|studies|validation|robustness|literature)\b/i.test(value)
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isBroadAbsenceClaim(text) {
  return (
    isUniversalAbsenceClaim(text) &&
    BROAD_ABSENCE_PATTERNS.some((pattern) => pattern.test(String(text || '')))
  )
}

/**
 * @param {string} text
 * @param {string[]} knownMethods
 * @returns {string[]}
 */
export function extractMethodsFromText(text, knownMethods = []) {
  /** @type {Set<string>} */
  const found = new Set()
  for (const method of knownMethods || []) {
    if (mentionsMethod(text, method)) found.add(method)
  }
  for (const row of NAMED_METHOD_PATTERNS) {
    if (row.pattern.test(String(text || ''))) found.add(row.label)
  }
  return [...found]
}

/**
 * @param {string} text
 * @param {string[]} knownDimensions
 * @returns {string[]}
 */
export function extractDimensionsFromText(text, knownDimensions = []) {
  const lower = String(text || '').toLowerCase()
  /** @type {Set<string>} */
  const found = new Set()

  for (const dimension of knownDimensions || []) {
    const aliases = DIMENSION_ALIASES[dimension.toLowerCase()] || [dimension.toLowerCase()]
    if (aliases.some((alias) => lower.includes(alias))) found.add(dimension)
  }

  if (!found.size) {
    for (const [canonical, aliases] of Object.entries(DIMENSION_ALIASES)) {
      if (aliases.some((alias) => lower.includes(alias))) {
        const match =
          (knownDimensions || []).find(
            (dim) => dim.toLowerCase() === canonical,
          ) || canonical
        found.add(match)
      }
    }
  }

  return [...found]
}

/**
 * @param {string} text
 * @param {object|null|undefined} coverage
 * @param {object} intents
 * @returns {object[]}
 */
export function resolveRelevantCoverageRows(text, coverage, intents = {}) {
  const enriched = enrichCoverageWithChainStates(coverage)
  const rows = enriched.rows || []
  if (!rows.length) return []

  const methods = extractMethodsFromText(text, intents.methods || [])
  const dimensions = extractDimensionsFromText(
    text,
    intents.evaluationDimensions || [],
  )
  const isComparison = /\b(compar|head-to-head|versus|cross-method|across methods)\b/i.test(
    text,
  )

  if (isComparison && !methods.length && !dimensions.length) {
    return rows.filter((row) => row.type === 'comparison' || row.method)
  }

  if (!methods.length && !dimensions.length) {
    return isUniversalAbsenceClaim(text) ? rows : []
  }

  return rows.filter((row) => {
    const methodMatch =
      !methods.length ||
      (row.method &&
        methods.some(
          (method) =>
            row.method.toLowerCase() === method.toLowerCase() ||
            row.method.toLowerCase().includes(method.toLowerCase()),
        ))
    const dimensionMatch =
      !dimensions.length ||
      (row.dimension &&
        dimensions.some(
          (dimension) =>
            row.dimension.toLowerCase().includes(dimension.toLowerCase()) ||
            dimension.toLowerCase().includes(row.dimension.toLowerCase()),
        ))
    const comparisonMatch = isComparison && row.type === 'comparison'
    if (comparisonMatch) return methodMatch || dimensionMatch
    return methodMatch && dimensionMatch
  })
}

/**
 * @param {string} text
 * @param {object|null|undefined} coverage
 * @param {object} [intents]
 * @returns {{ text: string, type: 'retrieval_limitation'|'scientific_gap'|null }}
 */
export function guardAbsenceClaim(text, coverage, intents = {}) {
  const value = String(text || '').trim()
  if (!value) return { text: value, type: null }
  if (!isUniversalAbsenceClaim(value)) return { text: value, type: null }

  const resolvedIntents =
    intents.methods?.length || intents.evaluationDimensions?.length
      ? intents
      : extractResearchQueryIntents(intents.researchQuestion || '')

  const enriched = enrichCoverageWithChainStates(coverage)
  const relevantRows = resolveRelevantCoverageRows(value, coverage, resolvedIntents)
  const notSearched = relevantRows.filter(
    (row) => row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED,
  )

  const hasNotSearched =
    notSearched.length > 0 ||
    (relevantRows.length === 0 &&
      enriched.notSearchedCount > 0 &&
      (isBroadAbsenceClaim(value) ||
        extractMethodsFromText(value, resolvedIntents.methods).length > 0))

  if (hasNotSearched) {
    const labels = notSearched.slice(0, 4).map(formatEvidenceTargetLabel)
    const labelPart = labels.length ? ` (${labels.join('; ')})` : ''
    return {
      text: `This run did not reach the relevant evidence target(s)${labelPart}, so absence cannot be inferred from this run.`,
      type: 'retrieval_limitation',
    }
  }

  const allSearchedNoRelevant =
    relevantRows.length > 0 &&
    relevantRows.every(
      (row) => row.state === EVIDENCE_TARGET_STATE.SEARCHED_NO_RELEVANT_RESULTS,
    )

  if (allSearchedNoRelevant) {
    return {
      text: 'No relevant evidence was identified among the evidence retrieved and assessed in this run for the target(s) covered by this statement.',
      type: 'scientific_gap',
    }
  }

  if (
    !/\bretrieved and assessed in this run\b/i.test(value) &&
    !/\bamong the evidence retrieved\b/i.test(value)
  ) {
    const lowered = value.charAt(0).toLowerCase() + value.slice(1)
    return {
      text: `Among the evidence retrieved and assessed in this run, ${lowered}`,
      type: 'scientific_gap',
    }
  }

  return { text: value, type: 'scientific_gap' }
}

/**
 * @param {string} text
 * @param {object|null|undefined} coverage
 * @param {object} intents
 * @returns {string}
 */
export function guardNarrativeText(text, coverage, intents = {}) {
  return guardAbsenceClaim(text, coverage, intents).text
}

/**
 * @param {{ strengths?: string[], weaknesses?: string[], limitations?: string }} review
 * @returns {{ strengths: string[], weaknesses: string[], limitations: string }}
 */
export function sanitizeMethodologyReview(review = {}) {
  const strengths = (review.strengths || []).filter((item) => !isPaperProseExcerpt(item))
  const weaknesses = (review.weaknesses || []).filter((item) => !isPaperProseExcerpt(item))

  if (!strengths.length) {
    strengths.push(
      (review.strengths || []).length
        ? 'Methodology assessment is limited because retrieved paper excerpts were excluded from process review.'
        : 'Methodology assessment is limited because retrieval observability is unavailable.',
    )
  }

  return {
    strengths,
    weaknesses,
    limitations:
      review.limitations ||
      'Methodology assessment is limited because retrieval observability is unavailable.',
  }
}

/**
 * @param {string[]} items
 * @param {object|null|undefined} coverage
 * @param {object} intents
 * @param {string[]} retrievalLimitations
 * @param {string[]} scientificGaps
 */
function classifyGapItems(items, coverage, intents, retrievalLimitations, scientificGaps) {
  for (const item of items || []) {
    const value = String(item || '').trim()
    if (!value) continue

    const result = guardAbsenceClaim(value, coverage, intents)
    if (result.type === 'retrieval_limitation') {
      if (!retrievalLimitations.includes(result.text)) {
        retrievalLimitations.push(result.text)
      }
      continue
    }

    if (result.type === 'scientific_gap') {
      if (!scientificGaps.includes(result.text)) scientificGaps.push(result.text)
      continue
    }

    const relevantRows = resolveRelevantCoverageRows(value, coverage, intents)
    if (
      relevantRows.some((row) => row.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED) &&
      isUniversalAbsenceClaim(value)
    ) {
      const blocked = guardAbsenceClaim(value, coverage, intents)
      if (
        blocked.type === 'retrieval_limitation' &&
        !retrievalLimitations.includes(blocked.text)
      ) {
        retrievalLimitations.push(blocked.text)
      }
      continue
    }

    if (!scientificGaps.includes(value)) scientificGaps.push(value)
  }
}

/**
 * @param {object} synthesis
 * @param {object} context
 * @returns {object}
 */
export function applyFinalOutputGuard(synthesis, context = {}) {
  const coverage =
    context.matrixCoverage ||
    context.evidenceChain?.coverage ||
    context.coverage ||
    null
  const intents =
    context.intents ||
    extractResearchQueryIntents(
      context.researchQuestion || synthesis.researchQuestion || '',
    )

  const guardText = (text) => guardNarrativeText(text, coverage, intents)

  const findings = (synthesis.findings || []).map((finding) => ({
    ...finding,
    statement: guardText(finding.statement),
  }))

  /** @type {string[]} */
  const retrievalLimitations = [...(synthesis.retrievalLimitations || [])]
  /** @type {string[]} */
  const scientificGaps = []

  classifyGapItems(synthesis.scientificGaps, coverage, intents, retrievalLimitations, scientificGaps)
  classifyGapItems(synthesis.gaps, coverage, intents, retrievalLimitations, scientificGaps)

  for (const item of context.evidenceChain?.retrievalLimitations || []) {
    if (!retrievalLimitations.includes(item)) retrievalLimitations.push(item)
  }

  const gaps = [...new Set([...retrievalLimitations, ...scientificGaps])]

  return {
    ...synthesis,
    summary: guardText(synthesis.summary),
    findings,
    limitations: guardText(synthesis.limitations),
    recommendations: (synthesis.recommendations || []).map(guardText),
    contradictions: (synthesis.contradictions || []).map(guardText),
    retrievalLimitations,
    scientificGaps,
    gaps,
    finalOutputGuardApplied: true,
  }
}

export default {
  PAPER_PROSE_PATTERNS,
  isPaperProseExcerpt,
  isUniversalAbsenceClaim,
  extractMethodsFromText,
  extractDimensionsFromText,
  resolveRelevantCoverageRows,
  guardAbsenceClaim,
  guardNarrativeText,
  sanitizeMethodologyReview,
  applyFinalOutputGuard,
}
