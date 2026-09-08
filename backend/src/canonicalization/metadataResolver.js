/**
 * @fileoverview Resolve best metadata values when merging duplicate Paper DTOs.
 * Never overwrites valid data with null/empty.
 */
import {
  mergePdfCandidateUrls,
  preferPrimaryPdfUrl,
} from '../integrations/utils/pdfCandidateUrls.js'

/**
 * Prefer non-null, then longer string.
 *
 * @param {...(string|null|undefined)} values
 * @returns {string|null}
 */
export function preferBestString(...values) {
  let best = null
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    if (!best || trimmed.length > best.length) {
      best = trimmed
    }
  }
  return best
}

/**
 * Prefer highest non-negative citation count.
 *
 * @param {...unknown} values
 * @returns {number}
 */
export function preferHighestCitationCount(...values) {
  let best = 0
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n) && n > best) best = Math.trunc(n)
  }
  return best
}

/**
 * Prefer first non-null boolean.
 *
 * @param {...(boolean|null|undefined)} values
 * @returns {boolean|null}
 */
export function preferBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return null
}

/**
 * Prefer first usable year.
 *
 * @param {...unknown} values
 * @returns {number|null}
 */
export function preferYear(...values) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) {
      const y = Math.trunc(n)
      if (y >= 1000 && y <= 9999) return y
    }
  }
  return null
}

/**
 * Union keyword lists, preserving order and uniqueness (case-insensitive).
 *
 * @param {...unknown} lists
 * @returns {string[]}
 */
export function preferRichestKeywords(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const value = String(item || '').trim()
      if (!value) continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(value)
    }
  }
  return out
}

/**
 * Prefer richest author list (most names); if tie, prefer first non-empty.
 *
 * @param {...unknown} lists
 * @returns {string[]}
 */
export function preferAuthors(...lists) {
  let best = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    const cleaned = list.map((a) => String(a || '').trim()).filter(Boolean)
    if (cleaned.length > best.length) {
      best = cleaned
    }
  }
  return best
}

function mergeFullTextSources(...lists) {
  const seen = new Set()
  /** @type {object[]} */
  const out = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      if (!row?.url) continue
      const key = `${row.type || 'pdf'}|${String(row.url).trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

function mergeOpenAlexLocations(...lists) {
  const seen = new Set()
  /** @type {object[]} */
  const out = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      const key = `${row?.pdf_url || ''}|${row?.landing_page_url || ''}`.toLowerCase()
      if (!key.replace(/\|/g, '') || seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}

/**
 * Merge a cluster of duplicate Paper DTOs into one metadata object
 * (without source attribution — handled separately).
 *
 * @param {object[]} papers
 * @returns {object}
 */
export function resolveMetadata(papers = []) {
  if (!Array.isArray(papers) || papers.length === 0) {
    return {}
  }

  const title = preferBestString(...papers.map((p) => p.title))
  const abstract = preferBestString(...papers.map((p) => p.abstract))
  const doi = preferBestString(...papers.map((p) => p.doi))
  const venue = preferBestString(...papers.map((p) => p.venue))
  const pdfCandidates = mergePdfCandidateUrls(
    ...papers.map((p) => p.pdfCandidates),
    ...papers.map((p) => p.pdfUrl),
  )
  const pdfUrl = preferPrimaryPdfUrl(pdfCandidates)
  const fullTextSources = mergeFullTextSources(
    ...papers.map((p) => p.fullTextSources),
  )
  const openAlexLocations = mergeOpenAlexLocations(
    ...papers.map((p) => p.openAlexLocations),
  )
  const paperType =
    preferBestString(
      ...papers.map((p) => (p.paperType && p.paperType !== 'other' ? p.paperType : null))
    ) ||
    preferBestString(...papers.map((p) => p.paperType)) ||
    'other'

  // Normalize DOI lowercase without resolver prefix already typically done
  const normalizedDoi = doi
    ? doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase()
    : null

  return {
    title: title || 'Untitled',
    authors: preferAuthors(...papers.map((p) => p.authors)),
    abstract,
    doi: normalizedDoi,
    venue,
    publicationYear: preferYear(...papers.map((p) => p.publicationYear)),
    citationCount: preferHighestCitationCount(
      ...papers.map((p) => p.citationCount)
    ),
    keywords: preferRichestKeywords(...papers.map((p) => p.keywords)),
    paperType,
    pdfUrl,
    pdfCandidates,
    fullTextSources,
    openAlexLocations,
    openAccess: preferBoolean(...papers.map((p) => p.openAccess)),
    peerReviewed: preferBoolean(...papers.map((p) => p.peerReviewed)),
    references: mergeReferences(...papers.map((p) => p.references)),
  }
}

/**
 * @param {...unknown} lists
 * @returns {string[]|null}
 */
function mergeReferences(...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const value = String(item || '').trim()
      if (!value) continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(value)
    }
  }
  return out.length > 0 ? out : null
}

export default {
  resolveMetadata,
  preferBestString,
  preferHighestCitationCount,
  preferRichestKeywords,
  preferAuthors,
}
