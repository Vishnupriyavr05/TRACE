/**
 * @fileoverview Stage labels for full-text acquisition outcomes.
 * Distinguishes discovery vs acquisition vs GROBID vs downstream failures.
 */

export const ACQUISITION_FAILURE_STAGE = Object.freeze({
  DISCOVERY_FAILURE: 'DISCOVERY_FAILURE',
  ACQUISITION_FAILURE: 'ACQUISITION_FAILURE',
  GROBID_FAILURE: 'GROBID_FAILURE',
  EVIDENCE_FAILURE: 'EVIDENCE_FAILURE',
  DOWNSTREAM_FAILURE: 'DOWNSTREAM_FAILURE',
})

/**
 * @param {object|null|undefined} outcome
 * @returns {string|null}
 */
export function classifyPaperOutcomeFailureStage(outcome) {
  if (!outcome) return null
  if (outcome.status === 'full_text') return null
  if (outcome.skippedAcquisition) return null

  if (outcome.grobidAttempted) {
    if (outcome.status === 'grobid_failed') {
      return ACQUISITION_FAILURE_STAGE.GROBID_FAILURE
    }
    if (outcome.status === 'fallback' && outcome.fallbackReason?.startsWith('grobid')) {
      return ACQUISITION_FAILURE_STAGE.GROBID_FAILURE
    }
  }

  return ACQUISITION_FAILURE_STAGE.ACQUISITION_FAILURE
}

/**
 * @param {object|null|undefined} outcome
 * @returns {string|null}
 */
export function classifyPaperOutcomeFailureCategory(outcome) {
  if (!outcome || outcome.status === 'full_text') return null
  const reason = String(
    outcome.finalFallbackReason || outcome.fallbackReason || outcome.reason || '',
  ).toLowerCase()

  if (!reason || reason === 'no_pdf_url' || reason === 'no_pdf') return 'A_no_candidate'
  if (reason.includes('403') || reason === 'http_403' || reason.includes('pdf_http_403')) {
    return 'B_http_403'
  }
  if (
    reason.includes('502') ||
    reason.includes('500') ||
    reason.includes('5xx') ||
    reason.includes('pdf_http_5')
  ) {
    return 'C_http_5xx'
  }
  if (reason.includes('html_response') || reason.includes('challenge')) return 'D_html_challenge'
  if (reason.includes('invalid_pdf') || reason.includes('landing_page')) return 'E_invalid_pdf_or_landing'
  if (reason.includes('timeout') || reason.includes('timed_out')) return 'F_timeout'
  if (reason.startsWith('grobid')) return 'G_grobid'
  return 'H_other'
}

export default {
  ACQUISITION_FAILURE_STAGE,
  classifyPaperOutcomeFailureStage,
  classifyPaperOutcomeFailureCategory,
}
