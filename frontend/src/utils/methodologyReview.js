/**
 * Derive methodology strengths/weaknesses from retrieved full-text evidence only.
 */

const LIMITATION_RE =
  /\b(challenge|challenges|limitation|limitations|drawback|drawbacks|weakness|weaknesses|requires|requirement|however|although|cannot|inflexible|constraint|constraints|problem|difficult|difficulty|barrier|trade-?off|tradeoff|degradation|shortcoming|must adapt)\b/i

const METHOD_DESC_RE =
  /\b(method|algorithm|technique|approach|architecture|mapping|propagat|layer|network|visualiz|mechanism|gradient|activation|pooling|convolutional|proposed|capable|obtain|compute|distinguish|procedure|optimization)\b/i

const INSUFFICIENT = 'Insufficient evidence retrieved.'

/**
 * @param {string} text
 * @returns {'strength'|'weakness'|null}
 */
export function classifyMethodologyEvidence(text) {
  const value = String(text || '').trim()
  if (value.length < 24) return null
  const hasLimit = LIMITATION_RE.test(value)
  const hasMethod = METHOD_DESC_RE.test(value)
  if (hasLimit) return 'weakness'
  if (hasMethod) return 'strength'
  return null
}

/**
 * @param {object[]} items
 * @returns {{ strengths: string[], weaknesses: string[], limitations: string }}
 */
export function buildMethodologyReviewFromEvidenceItems(items = []) {
  const strengths = []
  const weaknesses = []
  const seen = new Set()

  for (const item of items || []) {
    const text = String(item?.text || '').trim()
    if (!text) continue
    const level = String(item?.evidenceLevel || '').toUpperCase()
    const isFullText =
      level === 'FULL_TEXT' || String(item?.sourceType || '') === 'full_text'
    if (!isFullText) continue

    const kind = classifyMethodologyEvidence(text)
    if (!kind) continue

    if (seen.has(text)) continue
    seen.add(text)

    if (kind === 'weakness') weaknesses.push(text)
    else strengths.push(text)
  }

  return {
    strengths: strengths.length ? strengths : [INSUFFICIENT],
    weaknesses: weaknesses.length ? weaknesses : [INSUFFICIENT],
    limitations:
      strengths.length + weaknesses.length
        ? 'Assessment derived from available full-text methodological evidence only; it does not establish comparative coverage across all requested methodological categories.'
        : INSUFFICIENT,
  }
}

/**
 * @param {object|null|undefined} registry
 * @param {string} [paperId]
 * @returns {{ strengths: string[], weaknesses: string[], limitations: string }}
 */
export function buildMethodologyReviewForPaper(registry, paperId = '') {
  const items = (registry?.evidenceItems || []).filter((item) => {
    if (!paperId) return true
    return String(item.paperId) === String(paperId)
  })
  return buildMethodologyReviewFromEvidenceItems(items)
}

export default {
  classifyMethodologyEvidence,
  buildMethodologyReviewFromEvidenceItems,
  buildMethodologyReviewForPaper,
}
