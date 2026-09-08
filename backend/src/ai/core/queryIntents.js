/**
 * @fileoverview Structured research-query intent extraction for retrieval.
 */
import { NAMED_METHOD_PATTERNS } from '../agents/explorer.methodPatterns.js'

const DOMAIN_PATTERNS = [
  { pattern: /\bmedical imaging\b/i, phrase: 'medical imaging' },
  { pattern: /\bmedical image(?:s|ry)?\b/i, phrase: 'medical imaging' },
  { pattern: /\bradiology\b/i, phrase: 'radiology' },
  { pattern: /\bhealthcare\b/i, phrase: 'healthcare' },
  { pattern: /\bclinical\b/i, phrase: 'clinical' },
]

const EVALUATION_DIMENSION_PATTERNS = [
  { pattern: /\bdiagnostic performance\b/i, label: 'diagnostic performance' },
  { pattern: /\binterpretability\b/i, label: 'interpretability' },
  { pattern: /\brobustness\b/i, label: 'robustness' },
  { pattern: /\bclinical usefulness\b/i, label: 'clinical usefulness' },
  {
    pattern: /\bstandardized evaluation metrics?\b/i,
    label: 'standardized evaluation metrics',
  },
]

/**
 * @param {string} researchQuestion
 * @returns {object}
 */
export function extractResearchQueryIntents(researchQuestion) {
  const question = String(researchQuestion || '').trim()

  /** @type {string[]} */
  const methods = []
  for (const method of NAMED_METHOD_PATTERNS) {
    if (!method.pattern.test(question)) continue
    if (!methods.includes(method.label)) methods.push(method.label)
  }

  /** @type {string[]} */
  const domain = []
  for (const row of DOMAIN_PATTERNS) {
    if (!row.pattern.test(question)) continue
    if (!domain.includes(row.phrase)) domain.push(row.phrase)
  }

  /** @type {string[]} */
  const evaluationDimensions = []
  for (const row of EVALUATION_DIMENSION_PATTERNS) {
    if (!row.pattern.test(question)) continue
    if (!evaluationDimensions.includes(row.label)) {
      evaluationDimensions.push(row.label)
    }
  }

  /** @type {string[]} */
  const evidenceTypes = []
  if (
    /\b(compare|comparison|comparing|comparative|contrasts?|versus|vs\.?)\b/i.test(
      question,
    )
  ) {
    evidenceTypes.push('comparative evidence')
  }
  if (/\bindirect\b/i.test(question)) {
    evidenceTypes.push('indirect comparison')
  }
  if (/\bclinician\b/i.test(question)) {
    evidenceTypes.push('clinician studies')
  }
  if (/\blimitations?\b/i.test(question)) {
    evidenceTypes.push('reported limitations')
  }
  if (/\beach method\b|\bseparately\b/i.test(question)) {
    evidenceTypes.push('per-method evidence')
  }
  if (/\bdirect\b/i.test(question) && evidenceTypes.includes('comparative evidence')) {
    evidenceTypes.push('direct comparison')
  }

  return {
    methods,
    domain,
    domainPhrase: domain[0] || '',
    evaluationDimensions,
    evidenceTypes,
    isComparative:
      /\b(compare|comparison|comparing|comparative|contrasts?|versus|vs\.?)\b/i.test(
        question,
      ),
    isPostHoc: /\bpost[\s-]?hoc\b/i.test(question),
    isInterpretable:
      /\b(inherently|intrinsic(?:ally)?)\s+interpretable\b/i.test(question) ||
      /\bprototype[\s-]?(network|net)s?\b/i.test(question) ||
      /\bprotopnet\b/i.test(question),
  }
}

/**
 * @param {object} intents
 * @param {string} methodLabel
 * @param {string} [dimension]
 * @returns {string}
 */
export function buildMethodDiscoveryQuery(intents, methodLabel, dimension) {
  const domain = intents.domainPhrase || ''
  const evalDimension = dimension || intents.evaluationDimensions[0] || 'interpretability'
  return [methodLabel, domain, evalDimension].filter(Boolean).join(' ').trim()
}

/**
 * @param {object} intents
 * @returns {string|null}
 */
export function buildComparativeDiscoveryQuery(intents) {
  if (!intents.isComparative || intents.methods.length < 2) return null
  const domain = intents.domainPhrase || ''
  const dimension =
    intents.evaluationDimensions.find((row) => row.includes('robustness')) ||
    intents.evaluationDimensions.find((row) => row.includes('comparative')) ||
    intents.evaluationDimensions[0] ||
    'comparative evaluation'
  return [...intents.methods, domain, 'comparative', dimension]
    .filter(Boolean)
    .join(' ')
    .trim()
}

export default {
  extractResearchQueryIntents,
  buildMethodDiscoveryQuery,
  buildComparativeDiscoveryQuery,
}
