/**
 * @fileoverview Deterministic similarity scores for Paper DTO comparison.
 * No AI / fuzzy embeddings — string and set algorithms only.
 */

/**
 * @typedef {object} SimilarityBreakdown
 * @property {number} title 0–1
 * @property {number} authors 0–1
 * @property {number} doi 0–1
 * @property {number} publicationYear 0–1
 * @property {number} overall 0–1 weighted aggregate
 */

/**
 * Normalize a title for comparison.
 *
 * @param {unknown} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return ''
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize DOI for comparison.
 *
 * @param {unknown} doi
 * @returns {string|null}
 */
export function normalizeDoi(doi) {
  if (typeof doi !== 'string' || !doi.trim()) return null
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase()
}

/**
 * Normalize author display names.
 *
 * @param {unknown} authors
 * @returns {string[]}
 */
export function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return []
  const seen = new Set()
  const out = []
  for (const author of authors) {
    const name = String(author || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * Token Jaccard similarity for titles.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function scoreTitleSimilarity(a, b) {
  const left = tokenize(normalizeTitle(a))
  const right = tokenize(normalizeTitle(b))
  if (left.size === 0 || right.size === 0) return 0
  return jaccard(left, right)
}

/**
 * Author-set similarity using full-name Jaccard, with last-name fallback.
 *
 * @param {unknown} authorsA
 * @param {unknown} authorsB
 * @returns {number}
 */
export function scoreAuthorSimilarity(authorsA, authorsB) {
  const left = normalizeAuthors(authorsA)
  const right = normalizeAuthors(authorsB)
  if (left.length === 0 && right.length === 0) return 1
  if (left.length === 0 || right.length === 0) return 0

  const full = jaccard(new Set(left), new Set(right))
  if (full >= 0.45) return full

  const leftLast = new Set(left.map(lastName))
  const rightLast = new Set(right.map(lastName))
  const byLast = jaccard(leftLast, rightLast)

  // Blend: last-name overlap helps "J. Smith" ≈ "John Smith"
  return Number(Math.max(full, byLast * 0.9).toFixed(4))
}

/**
 * @param {string} name
 * @returns {string}
 */
function lastName(name) {
  const parts = name.split(' ').filter(Boolean)
  return parts[parts.length - 1] || name
}

/**
 * Exact DOI match score.
 *
 * @param {unknown} doiA
 * @param {unknown} doiB
 * @returns {number}
 */
export function scoreDoiSimilarity(doiA, doiB) {
  const left = normalizeDoi(doiA)
  const right = normalizeDoi(doiB)
  if (!left || !right) return 0
  return left === right ? 1 : 0
}

/**
 * Publication year similarity (exact = 1, off-by-one = 0.5, else 0).
 *
 * @param {unknown} yearA
 * @param {unknown} yearB
 * @returns {number}
 */
export function scoreYearSimilarity(yearA, yearB) {
  const a = toYear(yearA)
  const b = toYear(yearB)
  if (a === null || b === null) return 0
  if (a === b) return 1
  if (Math.abs(a - b) === 1) return 0.5
  return 0
}

/**
 * Score two Paper DTOs.
 *
 * @param {object} paperA
 * @param {object} paperB
 * @returns {SimilarityBreakdown}
 */
export function scoreSimilarity(paperA = {}, paperB = {}) {
  const title = scoreTitleSimilarity(paperA.title, paperB.title)
  const authors = scoreAuthorSimilarity(paperA.authors, paperB.authors)
  const doi = scoreDoiSimilarity(paperA.doi, paperB.doi)
  const publicationYear = scoreYearSimilarity(
    paperA.publicationYear,
    paperB.publicationYear
  )

  // DOI exact match dominates overall confidence.
  const overall =
    doi === 1
      ? 1
      : Number(
          (
            title * 0.5 +
            authors * 0.25 +
            publicationYear * 0.15 +
            doi * 0.1
          ).toFixed(4)
        )

  return { title, authors, doi, publicationYear, overall }
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  return new Set(text.split(' ').filter((t) => t.length > 1))
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * @param {unknown} year
 * @returns {number|null}
 */
function toYear(year) {
  if (year === null || year === undefined || year === '') return null
  const n = Number(year)
  if (!Number.isFinite(n)) return null
  const y = Math.trunc(n)
  return y >= 1000 && y <= 9999 ? y : null
}
