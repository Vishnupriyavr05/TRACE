/**
 * @fileoverview Evidence location helpers (GROBID-derived, no fabrication).
 */
import { EVIDENCE_LEVEL } from './evidenceLevels.js'

/**
 * @param {object} item
 * @returns {object|null}
 */
export function buildEvidenceLocationFromItem(item) {
  if (!item || item.evidenceLevel !== EVIDENCE_LEVEL.FULL_TEXT) return null
  const hasLocation =
    item.page ||
    item.section ||
    item.paragraphIndex != null ||
    item.paragraph != null ||
    item.sentenceIndex != null
  if (!hasLocation) return null
  return {
    page: item.page ?? null,
    section: item.section || null,
    paragraph: item.paragraphIndex ?? item.paragraph ?? null,
    sentenceIndex: item.sentenceIndex ?? null,
    sentence:
      item.sentenceIndex != null && item.text
        ? String(item.text)
        : item.sentence
          ? String(item.sentence)
          : null,
  }
}

export default { buildEvidenceLocationFromItem }
