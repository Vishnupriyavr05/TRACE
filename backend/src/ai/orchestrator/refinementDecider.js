/**
 * @fileoverview Deterministic Critic → refinement decision (MAX 1 cycle).
 * Orchestrator-only — not an LLM agent.
 */
import { getExplorerLimits } from '../agents/explorer.limits.js'
import {
  evaluateResearchSufficiency,
  planUnifiedRecoveryQueries,
} from '../core/researchSufficiencyGate.js'

export const MAX_REFINEMENTS = 1

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Decide whether ONE bounded Explorer refinement is justified.
 *
 * Refines only for meaningful evidence insufficiency:
 * - overall INSUFFICIENT
 * - ≥1 NOT_COVERED evidence requirement
 * - ≥2 PARTIAL requirements
 * - ≥2 INSUFFICIENT_EVIDENCE findings (or ≥50% when multiple findings)
 *
 * Does NOT refine for LOW confidence alone or contradictions alone.
 *
 * @param {object} critiqueResult
 * @param {object} researchPlan
 * @param {number} refinementCount
 * @param {{ maxRefinements?: number, maxQueries?: number }} [options]
 * @returns {{
 *   shouldRefine: boolean,
 *   reasons: string[],
 *   queries: object[]
 * }}
 */
export function shouldRefine(
  critiqueResult,
  researchPlan,
  refinementCount = 0,
  options = {}
) {
  const maxRefinements =
    typeof options.maxRefinements === 'number'
      ? options.maxRefinements
      : MAX_REFINEMENTS
  const maxQueries =
    typeof options.maxQueries === 'number'
      ? options.maxQueries
      : getExplorerLimits().maxRefinedQueries || 2

  if (refinementCount >= maxRefinements) {
    return {
      shouldRefine: false,
      reasons: [`MAX_REFINEMENTS (${maxRefinements}) already reached`],
      queries: [],
    }
  }

  const coverage = Array.isArray(critiqueResult?.evidenceCoverage)
    ? critiqueResult.evidenceCoverage
    : []
  const notCovered = coverage.filter((c) => c.status === 'NOT_COVERED')
  const partial = coverage.filter((c) => c.status === 'PARTIAL')
  const sufficiency = asString(
    critiqueResult?.overallAssessment?.evidenceSufficiency
  ).toUpperCase()
  const evaluations = Array.isArray(critiqueResult?.findingEvaluations)
    ? critiqueResult.findingEvaluations
    : []
  const insuffFindings = evaluations.filter(
    (e) => e.support === 'INSUFFICIENT_EVIDENCE'
  )
  const insuffRatio =
    evaluations.length > 0 ? insuffFindings.length / evaluations.length : 0

  let coverageSufficiency = null
  if (options.evidencePackage && options.query) {
    coverageSufficiency = evaluateResearchSufficiency({
      evidencePackage: options.evidencePackage,
      researchQuestion: options.query,
      analyticalFindings: options.analyticalFindings || {},
      recoveryAllowed: true,
      maxRecoveryQueries: maxQueries,
      recoveryAttempted: refinementCount > 0,
    })
  }

  /** @type {string[]} */
  const reasons = []

  if (sufficiency === 'INSUFFICIENT') {
    reasons.push('overall evidence sufficiency is INSUFFICIENT')
  }
  if (notCovered.length >= 1) {
    reasons.push(
      `${notCovered.length} Planner evidence requirement(s) are NOT_COVERED`
    )
  }
  if (partial.length >= 2) {
    reasons.push(
      `${partial.length} Planner evidence requirements are PARTIAL`
    )
  }
  if (
    insuffFindings.length >= 2 ||
    (evaluations.length >= 2 && insuffRatio >= 0.5 && insuffFindings.length >= 1)
  ) {
    reasons.push(
      `${insuffFindings.length} finding(s) have INSUFFICIENT_EVIDENCE`
    )
  }
  if (coverageSufficiency?.shouldRecover) {
    reasons.push(
      `${coverageSufficiency.notSearchedCount} high-priority evidence target(s) remain NOT_SEARCHED; bounded coverage recovery recommended`,
    )
  }

  const justified =
    reasons.length > 0 &&
    (sufficiency === 'INSUFFICIENT' ||
      notCovered.length >= 1 ||
      partial.length >= 2 ||
      insuffFindings.length >= 2 ||
      (evaluations.length >= 2 && insuffRatio >= 0.5) ||
      Boolean(coverageSufficiency?.shouldRecover))

  if (!justified) {
    return {
      shouldRefine: false,
      reasons:
        reasons.length > 0
          ? reasons
          : ['Evidence sufficiency does not justify refinement'],
      queries: [],
      coverageSufficiency,
    }
  }

  if (options.evidencePackage && options.query) {
    const queries = planUnifiedRecoveryQueries(
      critiqueResult,
      researchPlan,
      options.evidencePackage,
      options.query,
      options.analyticalFindings || {},
      maxQueries,
    )
    if (!queries.length) {
      return {
        shouldRefine: false,
        reasons: [
          ...reasons,
          'No bounded refinement queries could be derived from coverage or Critic gaps',
        ],
        queries: [],
        coverageSufficiency,
      }
    }
    return {
      shouldRefine: true,
      reasons,
      queries,
      coverageSufficiency,
    }
  }

  const dimensions = Array.isArray(researchPlan?.researchDimensions)
    ? researchPlan.researchDimensions.map(asString).filter(Boolean)
    : []
  const dimensionHint = dimensions[0] || ''

  /** @type {object[]} */
  const queries = []
  const seen = new Set()

  for (const item of [...notCovered, ...partial]) {
    if (queries.length >= maxQueries) break
    const requirement = asString(item.requirement)
    if (!requirement) continue
    const queryText = dimensionHint
      ? `${requirement} ${dimensionHint}`.slice(0, 200)
      : requirement.slice(0, 200)
    const key = queryText.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push({
      query: queryText,
      purpose: 'refinement',
      basedOnRequirement: requirement,
      coverageStatus: item.status,
    })
  }

  // Fall back to HIGH-severity gaps only when coverage-based queries are empty
  if (!queries.length) {
    const highGaps = (critiqueResult?.gaps || []).filter(
      (g) => asString(g.severity).toUpperCase() === 'HIGH'
    )
    for (const gap of highGaps) {
      if (queries.length >= maxQueries) break
      const description = asString(gap.description)
      if (!description) continue
      // Prefer retrieved-evidence phrasing over open-ended invention
      const queryText = `literature evidence ${description}`
        .replace(/\s+/g, ' ')
        .slice(0, 200)
      const key = queryText.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      queries.push({
        query: queryText,
        purpose: 'refinement',
        basedOnGap: gap.id || null,
        coverageStatus: 'GAP',
      })
    }
  }

  if (!queries.length) {
    return {
      shouldRefine: false,
      reasons: [
        ...reasons,
        'No bounded refinement queries could be derived from Critic coverage/gaps',
      ],
      queries: [],
      coverageSufficiency,
    }
  }

  return {
    shouldRefine: true,
    reasons,
    queries,
    coverageSufficiency,
  }
}

export default {
  shouldRefine,
  MAX_REFINEMENTS,
}
