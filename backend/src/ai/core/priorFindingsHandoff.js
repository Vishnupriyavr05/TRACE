/**
 * @fileoverview Compact prior Analyst findings for refinement handoff.
 * Deterministic EXCLUDE + stale ID filtering before LLM context.
 */
import { compactFindingRecord } from './contextBudget.js'

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
 * @param {object|null|undefined} priorCritiqueResult
 * @returns {Map<string, object>}
 */
function critiqueEvalByFindingId(priorCritiqueResult) {
  /** @type {Map<string, object>} */
  const map = new Map()
  for (const evaluation of priorCritiqueResult?.findingEvaluations || []) {
    const findingId = String(evaluation?.findingId || '')
    if (findingId) map.set(findingId, evaluation)
  }
  return map
}

/**
 * Build a compact prior-finding slice for refinement Analyst context.
 * Drops Critic-EXCLUDE findings and stale paper/evidence IDs.
 *
 * @param {object|null|undefined} priorAnalyticalFindings
 * @param {object|null|undefined} priorCritiqueResult
 * @param {{
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>
 * }} bounds
 * @returns {object[]}
 */
export function buildPriorFindingsForRefinement(
  priorAnalyticalFindings,
  priorCritiqueResult,
  bounds,
) {
  const allowedPaperIds = bounds?.allowedPaperIds || new Set()
  const allowedEvidenceIds = bounds?.allowedEvidenceIds || new Set()
  const evalById = critiqueEvalByFindingId(priorCritiqueResult)

  /** @type {object[]} */
  const exposed = []

  for (const finding of priorAnalyticalFindings?.findings || []) {
    const id = String(finding?.id || '')
    if (!id) continue

    const evaluation = evalById.get(id)
    const handling = String(
      evaluation?.recommendedHandling || '',
    ).toUpperCase()
    if (handling === 'EXCLUDE') continue

    const evidenceIds = (finding.evidenceIds || [])
      .map(String)
      .filter((eid) => allowedEvidenceIds.has(eid))
    const paperIds = (finding.paperIds || [])
      .map(String)
      .filter((pid) => allowedPaperIds.has(pid))

    if (!evidenceIds.length && !paperIds.length) continue

    exposed.push(
      compactFindingRecord(
        {
          id,
          statement: truncate(finding.statement || '', 280),
          type: finding.type,
          confidence: finding.confidence,
          paperIds,
          evidenceIds,
          recommendedHandling: evaluation?.recommendedHandling || null,
          support: evaluation?.support || null,
        },
        { statementChars: 280 },
      ),
    )
  }

  return exposed
}

export default {
  buildPriorFindingsForRefinement,
}
