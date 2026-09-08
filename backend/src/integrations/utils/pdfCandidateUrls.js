/**
 * @fileoverview Shared PDF URL candidate helpers (mapping + canonicalization).
 */

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isLikelyPdfUrl(url) {
  const value = String(url || '').trim()
  if (!value) return false
  if (/\.pdf(\?|#|$)/i.test(value)) return true
  if (/\/pdf\//i.test(value)) return true
  if (/arxiv\.org\/pdf\//i.test(value)) return true
  if (/ncbi\.nlm\.nih\.gov\/pmc\/articles\/.*\/pdf/i.test(value)) return true
  if (/biorxiv\.org\/content\/.*\.full\.pdf/i.test(value)) return true
  if (/medrxiv\.org\/content\/.*\.full\.pdf/i.test(value)) return true
  if (/zenodo\.org\/records?\/.*\/files\/.*\.pdf/i.test(value)) return true
  if (/osf\.io\/.*\/download/i.test(value)) return true
  if (/\/content\/pdf\//i.test(value)) return true
  return false
}

/**
 * @param {...(string[]|string|null|undefined)} sources
 * @returns {string[]}
 */
export function mergePdfCandidateUrls(...sources) {
  const seen = new Set()
  /** @type {string[]} */
  const out = []

  for (const source of sources) {
    const values = Array.isArray(source) ? source : source ? [source] : []
    for (const value of values) {
      const trimmed = String(value || '').trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(trimmed)
    }
  }

  return out
}

/**
 * Prefer the first direct-PDF URL; otherwise first candidate.
 *
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function preferPrimaryPdfUrl(candidates = []) {
  for (const url of candidates) {
    if (isLikelyPdfUrl(url)) return url
  }
  return candidates[0] || null
}

export default {
  isLikelyPdfUrl,
  mergePdfCandidateUrls,
  preferPrimaryPdfUrl,
}
