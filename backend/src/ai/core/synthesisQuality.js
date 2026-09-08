/**
 * @fileoverview Deterministic synthesis quality gates (evidence-to-synthesis).
 */
import { NAMED_METHOD_PATTERNS } from '../agents/explorer.methodPatterns.js'
import { extractResearchQueryIntents } from './queryIntents.js'
import {
  EVIDENCE_TARGET_STATE,
  enrichCoverageWithChainStates,
  qualifyAbsenceClaim,
} from './evidenceChain.js'

/**
 * @param {string} proposed
 * @param {string} ceiling
 * @returns {string}
 */
function capLabel(proposed, ceiling) {
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2 }
  const p = order[String(proposed || 'LOW').toUpperCase()] ?? 0
  const c = order[String(ceiling || 'LOW').toUpperCase()] ?? 0
  const label = String(proposed || 'LOW').toUpperCase()
  const cap = String(ceiling || 'LOW').toUpperCase()
  return p <= c ? label : cap
}

export const COMPARISON_TYPE = Object.freeze({
  DIRECT: 'DIRECT',
  INDIRECT: 'INDIRECT',
  SINGLE_METHOD: 'SINGLE_METHOD',
  NONE: 'NONE',
  UNSUPPORTED: 'UNSUPPORTED',
})

const GENERIC_FACT_PATTERNS = [
  /\b(is|are)\s+(a|an)\s+[\w\s-]{0,40}(method|approach|technique|framework)\b/i,
  /\bwas used (as|for|in)\b/i,
  /\b(is|was) used as\b/i,
  /\bwas applied\b/i,
  /\bin a [\w\s-]{3,40} study\b/i,
  /\b(is|are) widely used\b/i,
  /\bmodel-agnostic\b.*\b(explain|explanation)\b/i,
  /\bachieved\s+\d+(\.\d+)?%?\s*(training|validation|test)\s+accuracy\b/i,
]

const WINNER_PATTERNS = [
  /\b(best|superior|outperform(s|ed)?|preferred|winner|most effective)\b/i,
  /\bbetter than\b/i,
]

const METRIC_PATTERN =
  /\b(accuracy|auc|sensitivity|specificity|f1|precision|recall|performance)\b/i
const XAI_CONTEXT_PATTERN =
  /\b(explain|explanation|interpret|attribution|saliency|heatmap|prototype|feature importance|xai|visualiz|fidelity)\b/i
const RESEARCH_RELEVANCE_PATTERN =
  /\b(strength|limitation|advantage|drawback|compared|comparison|versus|vs\.?|robust|interpretab|clinical|diagnostic performance|useful|validation|head-to-head|indirect)\b/i

/**
 * @param {string} text
 * @param {string} method
 * @returns {boolean}
 */
export function mentionsMethod(text, method) {
  const pattern = NAMED_METHOD_PATTERNS.find((row) => row.label === method)
  if (pattern?.pattern.test(String(text || ''))) return true
  return String(text || '')
    .toLowerCase()
    .includes(String(method || '').toLowerCase())
}

/**
 * @param {string} statement
 * @param {string[]} methods
 * @param {string[]} dimensions
 * @returns {boolean}
 */
export function isGenericPaperFact(statement, methods = [], dimensions = []) {
  const text = String(statement || '')
  if (!text) return false
  if (RESEARCH_RELEVANCE_PATTERN.test(text)) return false
  if (dimensions.some((dim) => text.toLowerCase().includes(dim.toLowerCase()))) {
    return false
  }
  if (GENERIC_FACT_PATTERNS.some((pattern) => pattern.test(text))) return true
  if (METRIC_PATTERN.test(text) && !XAI_CONTEXT_PATTERN.test(text)) return true
  if (
    methods.length &&
    methods.every((method) => mentionsMethod(text, method)) &&
    methods.length === 1 &&
    !RESEARCH_RELEVANCE_PATTERN.test(text)
  ) {
    return /\b(is|are|was|were)\b/i.test(text)
  }
  return false
}

/**
 * @param {string} statement
 * @param {string[]} evidenceTexts
 * @param {string[]} methodsInStatement
 * @returns {boolean}
 */
export function detectMisattributedModelPerformance(
  statement,
  evidenceTexts = [],
  methodsInStatement = [],
) {
  if (!methodsInStatement.length) return false
  if (!METRIC_PATTERN.test(statement)) return false

  const diagnosticOnly =
    /\b(training|validation|test)\s+accuracy\b/i.test(statement) ||
    (/\b\d+(\.\d+)?%?\b/.test(statement) && !XAI_CONTEXT_PATTERN.test(statement))

  const evidenceSupportsXaiMetric = evidenceTexts.some((text) =>
    methodsInStatement.some((method) => mentionsMethod(text, method)) &&
    METRIC_PATTERN.test(text) &&
    XAI_CONTEXT_PATTERN.test(text),
  )

  if (evidenceSupportsXaiMetric) return false
  return diagnosticOnly || !XAI_CONTEXT_PATTERN.test(statement)
}

/**
 * @param {string} statement
 * @param {string[]} methodsInStatement
 * @param {string[]} methodsInEvidence
 * @returns {boolean}
 */
export function detectUnsupportedCrossMethodClaim(
  statement,
  methodsInStatement = [],
  methodsInEvidence = [],
) {
  if (methodsInStatement.length < 2) return false
  const evidenceMethods = new Set(methodsInEvidence)
  const unsupported = methodsInStatement.filter((method) => !evidenceMethods.has(method))
  return unsupported.length > 0
}

/**
 * @param {string} statement
 * @param {object} comparisonSufficiency
 * @returns {boolean}
 */
export function detectUnsupportedWinnerClaim(statement, comparisonSufficiency = {}) {
  if (!WINNER_PATTERNS.some((pattern) => pattern.test(statement))) return false
  if (comparisonSufficiency.winnerEstablishable) return false
  return true
}

/**
 * @param {string} statement
 * @param {string[]} methodsInStatement
 * @param {string[]} methodsInEvidence
 * @param {string[]} evidenceTexts
 * @param {object} comparisonSufficiency
 * @returns {string}
 */
export function classifyComparisonType(
  statement,
  methodsInStatement = [],
  methodsInEvidence = [],
  evidenceTexts = [],
  comparisonSufficiency = {},
) {
  const compares = /\b(compare|comparison|versus|vs\.?|outperform|better than|head-to-head)\b/i.test(
    statement,
  )
  if (!compares && methodsInStatement.length < 2) {
    return methodsInStatement.length === 1
      ? COMPARISON_TYPE.SINGLE_METHOD
      : COMPARISON_TYPE.NONE
  }

  const directInEvidence = evidenceTexts.some(
    (text) =>
      /\b(compare|comparison|versus|vs\.?|head-to-head)\b/i.test(text) &&
      methodsInEvidence.length >= 2,
  )

  if (directInEvidence && comparisonSufficiency.directComparisonEvidence) {
    return COMPARISON_TYPE.DIRECT
  }
  if (methodsInStatement.length >= 2 && methodsInEvidence.length >= 2) {
    return COMPARISON_TYPE.INDIRECT
  }
  if (methodsInStatement.length >= 2) {
    return COMPARISON_TYPE.UNSUPPORTED
  }
  return COMPARISON_TYPE.SINGLE_METHOD
}

/**
 * @param {object} finding
 * @param {object} context
 * @returns {string[]}
 */
function evidenceTextsForFinding(finding, context) {
  const texts = []
  const evidenceIdToPaperId = context.evidenceIdToPaperId || new Map()
  const extractedById = context.extractedEvidenceById || {}
  const papersById = context.papersById || new Map()

  for (const evidenceId of finding.evidenceIds || []) {
    const item = extractedById[String(evidenceId)]
    if (item?.text) texts.push(String(item.text))
  }

  for (const paperId of finding.paperIds || []) {
    const paper = papersById.get(String(paperId))
    if (paper?.abstract) texts.push(String(paper.abstract))
    if (paper?.title) texts.push(String(paper.title))
  }

  for (const evidenceId of finding.evidenceIds || []) {
    const paperId = evidenceIdToPaperId.get
      ? evidenceIdToPaperId.get(String(evidenceId))
      : evidenceIdToPaperId[String(evidenceId)]
    if (!paperId) continue
    const paper = papersById.get(String(paperId))
    if (paper?.abstract) texts.push(String(paper.abstract))
  }

  return texts
}

/**
 * @param {string} statement
 * @param {string[]} dimensions
 * @returns {string|null}
 */
export function inferPrimaryDimension(statement, dimensions = []) {
  const lower = String(statement || '').toLowerCase()
  for (const dimension of dimensions) {
    if (lower.includes(dimension.toLowerCase())) return dimension
  }
  if (/\binterpretab|explainab|visualiz|saliency|prototype\b/i.test(lower)) {
    return 'interpretability'
  }
  if (/\brobust|adversarial|perturb|stability\b/i.test(lower)) {
    return 'robustness'
  }
  if (/\bclinician|clinical validation|reader study|workflow|usability\b/i.test(lower)) {
    return 'clinical usefulness'
  }
  if (METRIC_PATTERN.test(lower)) return 'diagnostic performance'
  if (/\b(compare|comparison|versus|vs\.?|head-to-head)\b/i.test(lower)) {
    return 'direct comparison'
  }
  return null
}

function findCoverageRow(coverage, method, dimension) {
  const rows = enrichCoverageWithChainStates(coverage).rows || []
  return rows.find(
    (row) =>
      row.method?.toLowerCase() === String(method || '').toLowerCase() &&
      row.dimension?.toLowerCase() === String(dimension || '').toLowerCase(),
  )
}

function qualifyGenericFact(
  statement,
  methods,
  dimensions,
  researchQuestion,
  coverage,
  comparisonSufficiency,
  methodsInStatement = [],
) {
  const methodHint = methodsInStatement[0] || methods[0] || 'the requested methods'
  const primaryDim =
    inferPrimaryDimension(statement, dimensions) ||
    dimensions[0] ||
    'the requested dimensions'

  let limitation = ''
  if (coverage && methodHint && primaryDim !== 'the requested dimensions') {
    const row = findCoverageRow(coverage, methodHint, primaryDim)
    if (row?.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED) {
      limitation = ` However, evidence for ${methodHint} on ${primaryDim} was not searched in this run, so comparative strength or limitation relative to other methods cannot be inferred.`
    } else if (methods.length > 1) {
      const othersNotComparable = methods
        .filter((method) => method !== methodHint)
        .some((method) => {
          const otherRow = findCoverageRow(coverage, method, primaryDim)
          return (
            !otherRow ||
            otherRow.state === EVIDENCE_TARGET_STATE.NOT_SEARCHED ||
            otherRow.state === EVIDENCE_TARGET_STATE.SEARCHED_NO_RELEVANT_RESULTS
          )
        })
      if (othersNotComparable || comparisonSufficiency?.indirectComparisonOnly) {
        limitation = ` However, the available evidence does not establish comparative strengths across ${methods.join(', ')} for ${primaryDim} because those methods were not comparably assessed in this run.`
      }
    }
  }

  return `For ${primaryDim}, among the evidence retrieved and assessed in this run, the retrieved material describes ${methodHint} in study context but does not by itself answer the comparative research question: ${String(researchQuestion || '').slice(0, 160)}.${limitation} Assessed point: ${statement}`
}

function qualifyModelPerformance(statement, methods) {
  const methodLabel = methods[0] || 'the explanation method'
  return `The retrieved evidence reports diagnostic-model performance metrics in a study context involving ${methodLabel}, but it does not establish that ${methodLabel} itself improves diagnostic performance relative to other explanation approaches. ${statement}`
}

function qualifyCrossMethod(statement, methodsInStatement, methodsInEvidence, comparisonSufficiency) {
  const covered = methodsInEvidence.join(', ') || 'one method'
  const missing = methodsInStatement
    .filter((method) => !methodsInEvidence.includes(method))
    .join(', ')
  const comparisonNote = comparisonSufficiency.indirectComparisonOnly
    ? ' Any comparison must be treated as indirect across studies.'
    : ''
  return `Among the evidence retrieved and assessed in this run, comparative wording is limited because assessed evidence directly covers ${covered}${missing ? ` and does not substantiate claims about ${missing}` : ''}.${comparisonNote} ${statement}`
}

function qualifyWinner(statement, comparisonSufficiency) {
  const reason =
    comparisonSufficiency.comparisonBlockedReason === 'TRACE_RETRIEVAL_COVERAGE_INCOMPLETE'
      ? 'requested comparison targets were not fully searched in this run'
      : comparisonSufficiency.indirectComparisonOnly
        ? 'only indirect cross-study evidence was available'
        : 'direct comparative evidence was insufficient'
  return `No overall best-method conclusion is supported because ${reason}. ${statement}`
}

/**
 * @param {object} finding
 * @param {object} context
 * @returns {object}
 */
export function processFindingQuality(finding, context) {
  const intents =
    context.intents || extractResearchQueryIntents(context.researchQuestion || '')
  const methods = intents.methods || []
  const dimensions = intents.evaluationDimensions || []
  const comparisonSufficiency = context.comparisonSufficiency || {}
  const evidenceTexts = evidenceTextsForFinding(finding, context)

  let statement = String(finding.statement || '')
  let handling = finding.handling || 'USE_AS_IS'
  let confidence = finding.confidence || 'LOW'
  /** @type {string[]} */
  const qualityIssues = []

  const methodsInStatement = methods.filter((method) => mentionsMethod(statement, method))
  const methodsInEvidence = methods.filter((method) =>
    evidenceTexts.some((text) => mentionsMethod(text, method)),
  )

  if (isGenericPaperFact(statement, methods, dimensions)) {
    qualityIssues.push('generic_paper_fact')
    statement = qualifyGenericFact(
      statement,
      methods,
      dimensions,
      context.researchQuestion,
      context.matrixCoverage || context.evidenceChain?.coverage,
      comparisonSufficiency,
      methodsInStatement,
    )
    handling = 'QUALIFY'
    confidence = capLabel(confidence, 'LOW')
  }

  if (
    detectMisattributedModelPerformance(statement, evidenceTexts, methodsInStatement)
  ) {
    qualityIssues.push('model_performance_misattribution')
    statement = qualifyModelPerformance(statement, methodsInStatement)
    handling = 'QUALIFY'
    confidence = capLabel(confidence, 'MEDIUM')
  }

  if (
    detectUnsupportedCrossMethodClaim(statement, methodsInStatement, methodsInEvidence)
  ) {
    qualityIssues.push('unsupported_cross_method_claim')
    statement = qualifyCrossMethod(
      statement,
      methodsInStatement,
      methodsInEvidence,
      comparisonSufficiency,
    )
    handling = 'QUALIFY'
    confidence = capLabel(confidence, 'LOW')
  }

  if (detectUnsupportedWinnerClaim(statement, comparisonSufficiency)) {
    qualityIssues.push('unsupported_winner_claim')
    statement = qualifyWinner(statement, comparisonSufficiency)
    handling = 'QUALIFY'
    confidence = capLabel(confidence, 'LOW')
  }

  const comparisonType = classifyComparisonType(
    statement,
    methodsInStatement,
    methodsInEvidence,
    evidenceTexts,
    comparisonSufficiency,
  )

  const primaryDimension = inferPrimaryDimension(statement, dimensions)

  return {
    ...finding,
    statement: qualifyAbsenceClaim(statement, {
      hasUnsearchedTargets: Boolean(context.evidenceChain?.hasUnsearchedTargets),
      coverage: context.matrixCoverage || context.evidenceChain?.coverage,
      intents,
    }),
    handling,
    confidence,
    comparisonType,
    primaryDimension,
    methodsReferenced: methodsInStatement,
    methodsSupportedByEvidence: methodsInEvidence,
    qualityIssues,
  }
}

/**
 * @param {string[]} gaps
 * @returns {string[]}
 */
export function deduplicateResearchGaps(gaps = []) {
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  for (const gap of gaps) {
    const value = String(gap || '').trim()
    if (!value) continue
    const key = value.toLowerCase().replace(/\s+/g, ' ').slice(0, 160)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * @param {object} synthesis
 * @param {object} context
 * @returns {object}
 */
export function applySynthesisQualityGates(synthesis, context = {}) {
  const findings = (synthesis.findings || []).map((finding) =>
    processFindingQuality(finding, context),
  )

  /** @type {Set<string>} */
  const citedPaperIds = new Set()
  /** @type {Set<string>} */
  const citedEvidenceIds = new Set()
  for (const finding of findings) {
    for (const paperId of finding.paperIds || []) citedPaperIds.add(String(paperId))
    for (const evidenceId of finding.evidenceIds || []) {
      citedEvidenceIds.add(String(evidenceId))
    }
  }

  const evidenceIdToPaperId = context.evidenceIdToPaperId || new Map()
  for (const evidenceId of citedEvidenceIds) {
    const paperId = evidenceIdToPaperId.get
      ? evidenceIdToPaperId.get(evidenceId)
      : evidenceIdToPaperId[evidenceId]
    if (paperId) citedPaperIds.add(String(paperId))
  }

  const references = synthesis.references || []
  const evidence = synthesis.evidence || []

  const retrievalLimitations = deduplicateResearchGaps(
    synthesis.retrievalLimitations || [],
  )
  const scientificGaps = deduplicateResearchGaps(synthesis.scientificGaps || [])
  const gaps = deduplicateResearchGaps([
    ...retrievalLimitations,
    ...scientificGaps,
    ...(synthesis.gaps || []).filter(
      (gap) =>
        !retrievalLimitations.includes(gap) && !scientificGaps.includes(gap),
    ),
  ])

  let summary = String(synthesis.summary || '')
  const comparison = context.comparisonSufficiency || {}
  if (
    detectUnsupportedWinnerClaim(summary, comparison) &&
    !/\bno overall winner\b/i.test(summary)
  ) {
    summary = `${summary} No overall winner can be established from the evidence retrieved and assessed in this run because comparative evidence was insufficient or indirect.`
  }

  return {
    ...synthesis,
    summary: qualifyAbsenceClaim(summary, {
      hasUnsearchedTargets: Boolean(context.evidenceChain?.hasUnsearchedTargets),
      coverage: context.matrixCoverage || context.evidenceChain?.coverage,
      intents: context.intents,
    }),
    findings,
    references,
    evidence,
    gaps,
    retrievalLimitations,
    scientificGaps,
    synthesisQuality: {
      findingCount: findings.length,
      citedPaperCount: citedPaperIds.size,
      citedEvidenceCount: citedEvidenceIds.size,
      qualityIssueCount: findings.reduce(
        (sum, row) => sum + (row.qualityIssues?.length || 0),
        0,
      ),
    },
  }
}

export default {
  COMPARISON_TYPE,
  mentionsMethod,
  isGenericPaperFact,
  detectMisattributedModelPerformance,
  detectUnsupportedCrossMethodClaim,
  detectUnsupportedWinnerClaim,
  classifyComparisonType,
  inferPrimaryDimension,
  processFindingQuality,
  deduplicateResearchGaps,
  applySynthesisQualityGates,
}
