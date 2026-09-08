/**
 * @fileoverview Research report section and scoring constants.
 *
 * Future values: insight section ids, confidence thresholds, max references,
 * integrity indicator keys. Align with frontend REPORT_SECTIONS where needed.
 */

/**
 * Research Insights section identifiers.
 *
 * @type {ReadonlyArray<{ id: string, title: string }>}
 */
export const REPORT_SECTIONS = Object.freeze([
  { id: 'summary', title: 'Research Summary' },
  { id: 'findings', title: 'Key Findings' },
  { id: 'gaps', title: 'Research Gap Analysis' },
  { id: 'contradictions', title: 'Contradictions' },
  { id: 'confidence', title: 'Confidence Score' },
  { id: 'references', title: 'References' },
])

/**
 * @type {Readonly<Record<string, unknown>>}
 */
export const REPORT_CONSTANTS = Object.freeze({
  // e.g. MIN_CONFIDENCE, MAX_PAPERS, SUPPORTED_UPLOAD_TYPES — intentionally empty
})
