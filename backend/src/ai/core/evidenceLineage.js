/**
 * @fileoverview Deterministic checks that FULL_TEXT evidence survives TRACE handoffs.
 */
import { EVIDENCE_LEVEL } from './evidenceLevels.js'

/**
 * @param {object|null|undefined} evidencePackage
 * @returns {{ fullTextPapers: number, fullTextItems: number, abstractItems: number }}
 */
export function summarizeEvidenceLevels(evidencePackage) {
  const items =
    evidencePackage?.allExtractedEvidenceItems ||
    evidencePackage?.extractedEvidenceItems ||
    []
  let fullTextItems = 0
  let abstractItems = 0
  for (const item of items) {
    const level = String(item.evidenceLevel || '').toUpperCase()
    if (level === EVIDENCE_LEVEL.FULL_TEXT) fullTextItems += 1
    else if (level === EVIDENCE_LEVEL.ABSTRACT) abstractItems += 1
  }

  const paperLevels = evidencePackage?.paperEvidenceLevels || {}
  let fullTextPapers = 0
  for (const level of Object.values(paperLevels)) {
    if (String(level).toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT) {
      fullTextPapers += 1
    }
  }

  return { fullTextPapers, fullTextItems, abstractItems }
}

/**
 * @param {object|null|undefined} evidencePackage
 * @param {object|null|undefined} analyticalFindings
 * @param {object|null|undefined} critiqueResult
 * @param {object|null|undefined} report
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function auditFullTextLineage(
  evidencePackage,
  analyticalFindings,
  critiqueResult,
  report,
) {
  const issues = []
  const summary = summarizeEvidenceLevels(evidencePackage)

  if (summary.fullTextPapers > 0 && summary.fullTextItems === 0) {
    issues.push(
      'FULL_TEXT paper levels present but no FULL_TEXT evidence items (orphaned acquisition)',
    )
  }

  if (summary.fullTextItems > 0) {
    const findings = analyticalFindings?.findings || []
    const fullTextFindingCount = findings.filter(
      (f) => String(f.evidenceLevel || '').toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT,
    ).length
    if (fullTextFindingCount === 0) {
      issues.push('FULL_TEXT acquired but no Analyst finding carries FULL_TEXT evidenceLevel')
    }

    const evaluations = critiqueResult?.findingEvaluations || []
    const criticFullText = evaluations.filter(
      (e) => String(e.evidenceLevel || '').toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT,
    ).length
    if (criticFullText === 0 && evaluations.length > 0) {
      issues.push('FULL_TEXT acquired but Critic evaluations lack FULL_TEXT evidenceLevel')
    }
  }

  const registryItems = report?.evidenceRegistry?.items || report?.evidenceItems || []
  if (summary.fullTextItems > 0 && registryItems.length > 0) {
    const registryFullText = registryItems.filter(
      (item) => String(item.evidenceLevel || '').toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT,
    ).length
    if (registryFullText === 0) {
      issues.push('FULL_TEXT acquired but final registry has no FULL_TEXT items')
    }
  }

  for (const finding of analyticalFindings?.findings || []) {
    const level = String(finding.evidenceLevel || '').toUpperCase()
    if (level === EVIDENCE_LEVEL.FULL_TEXT && finding.retrievalLimited) {
      issues.push(`Finding ${finding.id || finding.findingId} marked FULL_TEXT but retrievalLimited`)
    }
  }

  return { ok: issues.length === 0, issues }
}

export default {
  summarizeEvidenceLevels,
  auditFullTextLineage,
}
