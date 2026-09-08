/**
 * @fileoverview Track which provider contributed which fields to a canonical paper.
 */

/** Fields considered for attribution. */
export const ATTRIBUTABLE_FIELDS = Object.freeze([
  'title',
  'authors',
  'abstract',
  'doi',
  'venue',
  'publicationYear',
  'citationCount',
  'keywords',
  'paperType',
  'pdfUrl',
  'openAccess',
  'peerReviewed',
  'references',
])

/**
 * Determine whether a field value is considered present/usable.
 *
 * @param {string} field
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasUsableValue(field, value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') {
    if (field === 'citationCount') return Number.isFinite(value)
    return Number.isFinite(value)
  }
  if (typeof value === 'boolean') return true
  return false
}

/**
 * Decide which provider "won" a field in the merged metadata.
 * Preference: provider whose value equals the resolved value (first match).
 *
 * @param {string} field
 * @param {unknown} resolvedValue
 * @param {object[]} papers
 * @returns {string|null} provider id
 */
export function providerForField(field, resolvedValue, papers = []) {
  if (!hasUsableValue(field, resolvedValue)) return null

  for (const paper of papers) {
    const provider = paper.source || paper.provider || null
    if (!provider) continue
    const value = paper[field]

    if (!hasUsableValue(field, value)) continue

    if (fieldEquals(field, value, resolvedValue)) {
      return String(provider)
    }
  }

  // Fallback: first provider that had any usable value for the field
  for (const paper of papers) {
    const provider = paper.source || paper.provider || null
    if (!provider) continue
    if (hasUsableValue(field, paper[field])) return String(provider)
  }

  return null
}

/**
 * Build source attribution list for a merged paper.
 *
 * @param {object} resolvedMetadata
 * @param {object[]} papers
 * @returns {{ provider: string, contributed: string[] }[]}
 */
export function buildSourceAttribution(resolvedMetadata = {}, papers = []) {
  /** @type {Map<string, Set<string>>} */
  const byProvider = new Map()

  for (const field of ATTRIBUTABLE_FIELDS) {
    const provider = providerForField(field, resolvedMetadata[field], papers)
    if (!provider) continue
    if (!byProvider.has(provider)) byProvider.set(provider, new Set())
    byProvider.get(provider).add(field)
  }

  // Ensure every input provider appears at least with empty contributed? No —
  // only list providers that contributed at least one selected field.
  // Also record providers that supplied a duplicate record even if no unique win?
  // Spec example lists contributes that were used — stick to winners + any field match.

  return [...byProvider.entries()].map(([provider, fields]) => ({
    provider,
    contributed: [...fields],
  }))
}

/**
 * @param {string} field
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function fieldEquals(field, a, b) {
  if (field === 'doi') {
    return (
      String(a).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') ===
      String(b).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    )
  }

  if (field === 'authors' || field === 'keywords' || field === 'references') {
    const left = Array.isArray(a) ? a.map(String) : []
    const right = Array.isArray(b) ? b.map(String) : []
    if (left.length !== right.length) {
      // For keywords/authors, treat as contributor if resolved is a superset containing all of left
      if (field === 'keywords' || field === 'authors') {
        const rightSet = new Set(right.map((x) => x.toLowerCase()))
        return left.every((x) => rightSet.has(String(x).toLowerCase()))
      }
      return false
    }
    return left.every(
      (value, index) =>
        String(value).toLowerCase() === String(right[index]).toLowerCase()
    )
  }

  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b)
  }

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return a === b
  }

  return String(a).trim() === String(b).trim()
}

export default {
  buildSourceAttribution,
  providerForField,
  hasUsableValue,
  ATTRIBUTABLE_FIELDS,
}
