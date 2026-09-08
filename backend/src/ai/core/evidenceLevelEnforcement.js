/**
 * @fileoverview Deterministic evidence-level enforcement for findings and critiques.
 */
import {
  CLAIM_STRENGTH,
  EVIDENCE_LEVEL,
  claimSupportedByEvidenceLevel,
  evidenceLevelFromItem,
  inferClaimStrength,
  maxEvidenceLevelForItems,
  normalizeEvidenceLevel,
  requiredEvidenceLevelForClaim,
} from './evidenceLevels.js'

/**
 * @param {object[]} evidenceItems
 * @param {string[]} evidenceIds
 * @returns {object[]}
 */
function itemsForEvidenceIds(evidenceItems, evidenceIds = []) {
  const wanted = new Set((evidenceIds || []).map(String))
  if (!wanted.size) return []
  return (evidenceItems || []).filter((item) =>
    wanted.has(String(item.evidenceId)),
  )
}

/**
 * Resolve max evidence level for a finding from linked evidence items.
 *
 * @param {object} finding
 * @param {object[]} evidenceItems
 * @param {Map<string, string>} evidenceIdToPaperId
 * @returns {string}
 */
export function resolveFindingEvidenceLevel(
  finding,
  evidenceItems = [],
  evidenceIdToPaperId = new Map(),
) {
  const linked = itemsForEvidenceIds(evidenceItems, finding.evidenceIds)
  if (linked.length) {
    return maxEvidenceLevelForItems(linked)
  }

  const paperIds = new Set((finding.paperIds || []).map(String))
  const paperItems = (evidenceItems || []).filter((item) =>
    paperIds.has(String(item.paperId)),
  )
  if (paperItems.length) {
    return maxEvidenceLevelForItems(paperItems)
  }

  for (const eid of finding.evidenceIds || []) {
    const pid = evidenceIdToPaperId.get(String(eid))
    if (!pid) continue
    const match = (evidenceItems || []).find(
      (item) => String(item.paperId) === String(pid),
    )
    if (match) return evidenceLevelFromItem(match)
  }

  return EVIDENCE_LEVEL.UNAVAILABLE
}

/**
 * Deterministic downgrade for findings that exceed evidence level.
 *
 * @param {object[]} findings
 * @param {object[]} evidenceItems
 * @param {Map<string, string>} [evidenceIdToPaperId]
 * @returns {{ findings: object[], adjustments: object[] }}
 */
export function enforceEvidenceLevelsOnFindings(
  findings = [],
  evidenceItems = [],
  evidenceIdToPaperId = new Map(),
) {
  const adjustments = []
  const next = []

  for (const finding of findings) {
    const claimStrength =
      finding.claimStrength || inferClaimStrength(finding.statement)
    const evidenceLevel = resolveFindingEvidenceLevel(
      finding,
      evidenceItems,
      evidenceIdToPaperId,
    )
    const supported = claimSupportedByEvidenceLevel(claimStrength, evidenceLevel)
    const retrievalLimited =
      claimStrength === CLAIM_STRENGTH.ABSENCE &&
      evidenceLevelRankOrUnavailable(evidenceLevel) < evidenceLevelRankOrUnavailable(
        EVIDENCE_LEVEL.FULL_TEXT,
      )

    let confidence = finding.confidence || 'LOW'
    let type = finding.type || 'LIMITED'
    let note = finding.note || ''

    if (!supported) {
      if (
        claimStrength === CLAIM_STRENGTH.METHODOLOGICAL ||
        claimStrength === CLAIM_STRENGTH.EMPIRICAL_RESULT ||
        claimStrength === CLAIM_STRENGTH.GAP_STRONG
      ) {
        type = 'LIMITED'
        confidence = 'LOW'
        note = [
          note,
          `Claim strength ${claimStrength} requires ${requiredEvidenceLevelForClaim(claimStrength)} evidence; available ${evidenceLevel}.`,
        ]
          .filter(Boolean)
          .join(' ')
      } else if (claimStrength === CLAIM_STRENGTH.ABSENCE) {
        type = 'LIMITED'
        confidence = 'LOW'
        note = [
          note,
          'Absence/gap claim marked retrieval-limited — not definitive without full-text coverage.',
        ]
          .filter(Boolean)
          .join(' ')
      } else {
        type = 'LIMITED'
        if (confidence === 'HIGH') confidence = 'MEDIUM'
      }

      adjustments.push({
        findingId: finding.id,
        claimStrength,
        evidenceLevel,
        action: 'downgrade',
      })
    }

    next.push({
      ...finding,
      claimStrength,
      evidenceLevel,
      retrievalLimited: Boolean(retrievalLimited || finding.retrievalLimited),
      type,
      confidence,
      note: note || undefined,
    })
  }

  return { findings: next, adjustments }
}

/**
 * @param {string} level
 * @returns {number}
 */
function evidenceLevelRankOrUnavailable(level) {
  const ranks = {
    UNAVAILABLE: 0,
    METADATA: 1,
    ABSTRACT: 2,
    FULL_TEXT: 3,
  }
  return ranks[normalizeEvidenceLevel(level)] ?? 0
}

/**
 * Apply evidence-level rules to Critic evaluations (server-side).
 *
 * @param {object} critiqueResult
 * @param {object[]} findings
 * @param {object[]} evidenceItems
 * @param {Map<string, string>} [evidenceIdToPaperId]
 * @returns {object}
 */
export function enforceEvidenceLevelsOnCritique(
  critiqueResult,
  findings = [],
  evidenceItems = [],
  evidenceIdToPaperId = new Map(),
) {
  const findingById = new Map(findings.map((f) => [String(f.id), f]))
  const evaluations = (critiqueResult.findingEvaluations || []).map((ev) => {
    const finding = findingById.get(String(ev.findingId))
    if (!finding) return ev

    const claimStrength =
      finding.claimStrength || inferClaimStrength(finding.statement)
    const evidenceLevel = resolveFindingEvidenceLevel(
      finding,
      evidenceItems,
      evidenceIdToPaperId,
    )
    const supported = claimSupportedByEvidenceLevel(claimStrength, evidenceLevel)

    let support = ev.support
    let confidence = ev.confidence
    let recommendedHandling = ev.recommendedHandling
    const issues = [...(ev.issues || [])]

    if (!supported) {
      if (
        claimStrength === CLAIM_STRENGTH.METHODOLOGICAL ||
        claimStrength === CLAIM_STRENGTH.EMPIRICAL_RESULT ||
        claimStrength === CLAIM_STRENGTH.GAP_STRONG
      ) {
        support = 'INSUFFICIENT_EVIDENCE'
        confidence = 'LOW'
        recommendedHandling = 'QUALIFY'
        issues.push(
          `Evidence level ${evidenceLevel} insufficient for ${claimStrength} claim`,
        )
      } else if (claimStrength === CLAIM_STRENGTH.ABSENCE) {
        support = 'PARTIALLY_SUPPORTED'
        confidence = 'LOW'
        recommendedHandling = 'QUALIFY'
        issues.push('Absence claim is retrieval-limited, not definitive')
      } else if (evidenceLevel === EVIDENCE_LEVEL.METADATA) {
        support = 'INSUFFICIENT_EVIDENCE'
        confidence = 'LOW'
        recommendedHandling = 'QUALIFY'
        issues.push('Metadata-only evidence cannot support substantive finding')
      }
    }

    return {
      ...ev,
      support,
      confidence,
      recommendedHandling,
      issues: issues.slice(0, 8),
      claimStrength,
      evidenceLevel,
      retrievalLimited:
        claimStrength === CLAIM_STRENGTH.ABSENCE &&
        evidenceLevel !== EVIDENCE_LEVEL.FULL_TEXT,
    }
  })

  return {
    ...critiqueResult,
    findingEvaluations: evaluations,
  }
}

/**
 * Quality metrics for evidence-level coverage.
 *
 * @param {object[]} evidenceItems
 * @param {object[]} findings
 * @param {object} critiqueResult
 * @returns {object}
 */
export function computeEvidenceLevelMetrics(
  evidenceItems = [],
  findings = [],
  critiqueResult = {},
) {
  const paperLevels = new Map()
  for (const item of evidenceItems) {
    const pid = String(item.paperId || '')
    if (!pid) continue
    const level = evidenceLevelFromItem(item)
    const prev = paperLevels.get(pid)
    if (!prev || evidenceLevelRankOrUnavailable(level) > evidenceLevelRankOrUnavailable(prev)) {
      paperLevels.set(pid, level)
    }
  }

  const papersWithFullText = [...paperLevels.values()].filter(
    (l) => normalizeEvidenceLevel(l) === EVIDENCE_LEVEL.FULL_TEXT,
  ).length
  const paperCount = paperLevels.size || 1

  let strongGapTotal = 0
  let strongGapSupported = 0
  let absenceTotal = 0
  let unsupportedAbsence = 0

  for (const finding of findings) {
    const claimStrength =
      finding.claimStrength || inferClaimStrength(finding.statement)
    const evidenceLevel = finding.evidenceLevel || EVIDENCE_LEVEL.UNAVAILABLE

    if (claimStrength === CLAIM_STRENGTH.GAP_STRONG) {
      strongGapTotal += 1
      if (claimSupportedByEvidenceLevel(claimStrength, evidenceLevel)) {
        strongGapSupported += 1
      }
    }
    if (claimStrength === CLAIM_STRENGTH.ABSENCE) {
      absenceTotal += 1
      const evalRow = (critiqueResult.findingEvaluations || []).find(
        (e) => String(e.findingId) === String(finding.id),
      )
      const retrievalLimited =
        finding.retrievalLimited || evalRow?.retrievalLimited
      if (!retrievalLimited && !claimSupportedByEvidenceLevel(claimStrength, evidenceLevel)) {
        unsupportedAbsence += 1
      }
    }
  }

  return {
    fullTextEvidenceRate: {
      papersWithFullText,
      paperCount,
      ratio: Number((papersWithFullText / paperCount).toFixed(4)),
    },
    strongGapEvidenceRate: {
      total: strongGapTotal,
      supported: strongGapSupported,
      ratio:
        strongGapTotal > 0
          ? Number((strongGapSupported / strongGapTotal).toFixed(4))
          : null,
    },
    unsupportedAbsenceClaimRate: {
      total: absenceTotal,
      unsupported: unsupportedAbsence,
      ratio:
        absenceTotal > 0
          ? Number((unsupportedAbsence / absenceTotal).toFixed(4))
          : null,
    },
  }
}

export default {
  resolveFindingEvidenceLevel,
  enforceEvidenceLevelsOnFindings,
  enforceEvidenceLevelsOnCritique,
  computeEvidenceLevelMetrics,
}
