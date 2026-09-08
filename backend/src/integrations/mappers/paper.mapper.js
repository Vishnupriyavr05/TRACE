/**
 * @fileoverview Map provider-specific paper payloads into the TRACE Paper DTO.
 * No provider-specific fields may leak outside this module.
 */
import {
  mergePdfCandidateUrls,
  preferPrimaryPdfUrl,
  isLikelyPdfUrl,
} from '../utils/pdfCandidateUrls.js'

/** @typedef {'openalex'|'semantic_scholar'|'crossref'|'core'|'manual'|'upload'|'other'} PaperSource */

/**
 * @typedef {object} PaperDTO
 * @property {string} title
 * @property {string[]} authors
 * @property {string} abstract
 * @property {string|null} doi
 * @property {string} venue
 * @property {number|null} publicationYear
 * @property {number} citationCount
 * @property {string[]} keywords
 * @property {string} paperType
 * @property {PaperSource} source
 * @property {string|null} pdfUrl
 * @property {string[]} pdfCandidates
 * @property {object[]} fullTextSources
 * @property {object[]} openAlexLocations
 * @property {boolean|null} openAccess
 * @property {boolean|null} peerReviewed
 */

/**
 * Empty Paper DTO with safe defaults.
 *
 * @returns {PaperDTO}
 */
export function createEmptyPaperDto() {
  return {
    title: '',
    authors: [],
    abstract: '',
    doi: null,
    venue: '',
    publicationYear: null,
    citationCount: 0,
    keywords: [],
    paperType: 'other',
    source: 'other',
    pdfUrl: null,
    pdfCandidates: [],
    fullTextSources: [],
    openAlexLocations: [],
    openAccess: null,
    peerReviewed: null,
  }
}

/**
 * Normalize arbitrary partial fields into a clean PaperDTO.
 *
 * @param {Partial<PaperDTO> & Record<string, unknown>} [partial]
 * @returns {PaperDTO}
 */
export function toPaperDto(partial = {}) {
  const base = createEmptyPaperDto()

  return {
    title: typeof partial.title === 'string' ? partial.title.trim() : base.title,
    authors: Array.isArray(partial.authors)
      ? partial.authors.map(String).filter(Boolean)
      : base.authors,
    abstract:
      partial.abstract === null
        ? null
        : typeof partial.abstract === 'string'
          ? partial.abstract.trim()
          : base.abstract,
    doi:
      typeof partial.doi === 'string' && partial.doi.trim()
        ? partial.doi.trim().toLowerCase()
        : null,
    venue:
      partial.venue === null
        ? null
        : typeof partial.venue === 'string'
          ? partial.venue.trim()
          : base.venue,
    publicationYear: normalizeYear(partial.publicationYear),
    citationCount: normalizeNonNegativeInt(partial.citationCount),
    keywords: Array.isArray(partial.keywords)
      ? partial.keywords.map(String).filter(Boolean)
      : base.keywords,
    paperType:
      typeof partial.paperType === 'string' && partial.paperType.trim()
        ? partial.paperType.trim()
        : base.paperType,
    source: normalizeSource(partial.source),
    pdfUrl:
      typeof partial.pdfUrl === 'string' && partial.pdfUrl.trim()
        ? partial.pdfUrl.trim()
        : null,
    pdfCandidates: Array.isArray(partial.pdfCandidates)
      ? mergePdfCandidateUrls(partial.pdfCandidates, partial.pdfUrl)
      : mergePdfCandidateUrls(partial.pdfUrl),
    fullTextSources: Array.isArray(partial.fullTextSources)
      ? partial.fullTextSources
      : [],
    openAlexLocations: Array.isArray(partial.openAlexLocations)
      ? partial.openAlexLocations
      : [],
    openAccess:
      typeof partial.openAccess === 'boolean' ? partial.openAccess : null,
    peerReviewed:
      typeof partial.peerReviewed === 'boolean' ? partial.peerReviewed : null,
  }
}

/**
 * Map raw OpenAlex work-like objects into PaperDTO.
 *
 * @param {object} raw
 * @returns {PaperDTO}
 */
export function mapFromOpenAlex(raw = {}) {
  const authors = Array.isArray(raw.authorships)
    ? dedupeStrings(
        raw.authorships.map((a) => a?.author?.display_name).filter(Boolean)
      )
    : []

  const keywords = Array.isArray(raw.keywords)
    ? dedupeStrings(
        raw.keywords.map((k) => k?.display_name || k).filter(Boolean)
      )
    : Array.isArray(raw.concepts)
      ? dedupeStrings(
          raw.concepts
            .slice(0, 12)
            .map((c) => c?.display_name)
            .filter(Boolean)
        )
      : []

  const pdfCandidates = collectOpenAlexPdfCandidates(raw)
  const fullTextSources = collectOpenAlexFullTextSources(raw)
  const openAlexLocations = collectOpenAlexLocations(raw)
  const pdfUrl = preferPrimaryPdfUrl(pdfCandidates)

  return toPaperDto({
    title: raw.display_name || raw.title || '',
    authors,
    abstract: resolveOpenAlexAbstract(raw),
    doi: extractDoi(raw.doi),
    venue:
      raw.primary_location?.source?.display_name ||
      raw.host_venue?.display_name ||
      '',
    publicationYear: raw.publication_year ?? raw.from_publication_date,
    citationCount: raw.cited_by_count ?? 0,
    keywords,
    paperType: raw.type || 'other',
    source: 'openalex',
    pdfUrl,
    pdfCandidates,
    fullTextSources,
    openAlexLocations,
    openAccess:
      typeof raw.open_access?.is_oa === 'boolean' ? raw.open_access.is_oa : null,
    peerReviewed: null,
  })
}

/**
 * Collect OpenAlex PDF candidate URLs (best OA, primary, all locations, OA URL).
 *
 * @param {object} raw
 * @returns {string[]}
 */
export function collectOpenAlexPdfCandidates(raw = {}) {
  /** @type {string[]} */
  const locationPdfUrls = []
  if (Array.isArray(raw.locations)) {
    for (const location of raw.locations) {
      if (location?.pdf_url) locationPdfUrls.push(location.pdf_url)
    }
  }

  return mergePdfCandidateUrls(
    raw.best_oa_location?.pdf_url,
    raw.primary_location?.pdf_url,
    locationPdfUrls,
    raw.open_access?.oa_url,
  )
}

/**
 * @param {object} raw
 * @returns {object[]}
 */
export function collectOpenAlexLocations(raw = {}) {
  if (!Array.isArray(raw.locations)) return []
  return raw.locations.map((location) => ({
    pdf_url: location?.pdf_url || null,
    landing_page_url: location?.landing_page_url || null,
    source: location?.source?.display_name || null,
    is_oa: location?.is_oa ?? null,
  }))
}

/**
 * @param {object} raw
 * @returns {object[]}
 */
export function collectOpenAlexFullTextSources(raw = {}) {
  /** @type {object[]} */
  const sources = []
  const seen = new Set()

  /**
   * @param {unknown} url
   * @param {string} type
   * @param {string} source
   * @param {number} priority
   */
  const add = (url, type, source, priority) => {
    const value = String(url || '').trim()
    if (!value || !/^https?:\/\//i.test(value)) return
    const key = `${type}|${value.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    sources.push({ url: value, type, source, priority })
  }

  add(raw.best_oa_location?.pdf_url, 'pdf', 'openalex', 5)
  add(raw.primary_location?.pdf_url, 'pdf', 'openalex', 8)
  if (raw.open_access?.oa_url) {
    const type = isLikelyPdfUrl(raw.open_access.oa_url) ? 'pdf' : 'landing'
    add(raw.open_access.oa_url, type, 'openalex', type === 'pdf' ? 10 : 90)
  }

  if (Array.isArray(raw.locations)) {
    for (const location of raw.locations) {
      if (location?.pdf_url) {
        add(location.pdf_url, 'pdf', 'openalex', 12)
      }
      if (location?.landing_page_url) {
        add(location.landing_page_url, 'landing', 'openalex', 95)
      }
    }
  }

  return sources
}

/**
 * @param {object} raw
 * @returns {string[]}
 */
export function collectSemanticScholarPdfCandidates(raw = {}) {
  return mergePdfCandidateUrls(raw.openAccessPdf?.url)
}

/**
 * Reconstruct OpenAlex abstract from plain field or inverted index.
 *
 * @param {object} raw
 * @returns {string|null}
 */
function resolveOpenAlexAbstract(raw) {
  if (typeof raw.abstract === 'string' && raw.abstract.trim()) {
    return raw.abstract.trim()
  }

  const inverted = raw.abstract_inverted_index
  if (!inverted || typeof inverted !== 'object') {
    return null
  }

  /** @type {string[]} */
  const words = []
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0) {
        words[pos] = word
      }
    }
  }

  const text = words.filter(Boolean).join(' ').trim()
  return text || null
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function dedupeStrings(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const key = String(value).trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(String(value).trim())
  }
  return out
}

/**
 * Map raw Semantic Scholar paper-like objects into PaperDTO.
 *
 * @param {object} raw
 * @returns {PaperDTO}
 */
export function mapFromSemanticScholar(raw = {}) {
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((a) => a?.name || a).filter(Boolean)
    : []

  const pdfCandidates = collectSemanticScholarPdfCandidates(raw)
  const fullTextSources = raw.openAccessPdf?.url
    ? [{ url: raw.openAccessPdf.url, type: 'pdf', source: 'semantic_scholar', priority: 5 }]
    : []
  const pdfUrl = preferPrimaryPdfUrl(pdfCandidates)

  return toPaperDto({
    title: raw.title || '',
    authors,
    abstract:
      typeof raw.abstract === 'string' && raw.abstract.trim()
        ? raw.abstract.trim()
        : null,
    doi: extractDoi(raw.externalIds?.DOI || raw.doi),
    venue: raw.venue || raw.journal?.name || null,
    publicationYear: raw.year,
    citationCount: raw.citationCount ?? 0,
    keywords: Array.isArray(raw.fieldsOfStudy)
      ? raw.fieldsOfStudy.filter(Boolean)
      : [],
    paperType: raw.publicationTypes?.[0] || 'other',
    source: 'semantic_scholar',
    pdfUrl,
    pdfCandidates,
    fullTextSources,
    openAccess:
      typeof raw.isOpenAccess === 'boolean'
        ? raw.isOpenAccess
        : raw.openAccessPdf?.url
          ? true
          : null,
    peerReviewed: null,
  })
}

/**
 * Map raw CrossRef work-like objects into PaperDTO.
 *
 * @param {object} raw
 * @returns {PaperDTO}
 */
export function mapFromCrossref(raw = {}) {
  const message = raw.message || raw
  const authors = Array.isArray(message.author)
    ? message.author
        .map((a) => [a.given, a.family].filter(Boolean).join(' ').trim())
        .filter(Boolean)
    : []

  const year =
    message.published?.['date-parts']?.[0]?.[0] ??
    message['published-print']?.['date-parts']?.[0]?.[0] ??
    message['published-online']?.['date-parts']?.[0]?.[0] ??
    null

  return toPaperDto({
    title: Array.isArray(message.title) ? message.title[0] : message.title || '',
    authors,
    abstract: typeof message.abstract === 'string' ? stripXml(message.abstract) : '',
    doi: extractDoi(message.DOI || message.doi),
    venue: Array.isArray(message['container-title'])
      ? message['container-title'][0]
      : '',
    publicationYear: year,
    citationCount: message['is-referenced-by-count'] ?? 0,
    keywords: Array.isArray(message.subject) ? message.subject : [],
    paperType: message.type || 'other',
    source: 'crossref',
    pdfUrl: null,
    openAccess: null,
    peerReviewed: null,
  })
}

/**
 * Map raw CORE work-like objects into PaperDTO.
 *
 * @param {object} raw
 * @returns {PaperDTO}
 */
export function mapFromCore(raw = {}) {
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean)
    : []

  const pdfCandidates = mergePdfCandidateUrls(
    raw.downloadUrl,
    raw.sourceFulltextUrls,
  )
  const pdfUrl = preferPrimaryPdfUrl(pdfCandidates)

  return toPaperDto({
    title: raw.title || '',
    authors,
    abstract: raw.abstract || raw.description || '',
    doi: extractDoi(raw.doi),
    venue: raw.publisher || raw.journals?.[0]?.title || '',
    publicationYear: raw.yearPublished ?? raw.year,
    citationCount: raw.citationCount ?? 0,
    keywords: Array.isArray(raw.topics) ? raw.topics.filter(Boolean) : [],
    paperType: raw.documentType || 'other',
    source: 'core',
    pdfUrl,
    pdfCandidates,
    openAccess: typeof raw.isOpenAccess === 'boolean' ? raw.isOpenAccess : null,
    peerReviewed: null,
  })
}

/**
 * Dispatch mapper by source id.
 *
 * @param {PaperSource|string} source
 * @param {object} raw
 * @returns {PaperDTO}
 */
export function mapPaperFromSource(source, raw) {
  switch (source) {
    case 'openalex':
      return mapFromOpenAlex(raw)
    case 'semantic_scholar':
      return mapFromSemanticScholar(raw)
    case 'crossref':
      return mapFromCrossref(raw)
    case 'core':
      return mapFromCore(raw)
    default:
      return toPaperDto({ ...raw, source: 'other' })
  }
}

/**
 * @param {unknown} year
 * @returns {number|null}
 */
function normalizeYear(year) {
  if (year === null || year === undefined || year === '') return null
  if (typeof year === 'string' && /^\d{4}/.test(year)) {
    return Number.parseInt(year.slice(0, 4), 10)
  }
  const n = Number(year)
  if (!Number.isFinite(n)) return null
  const y = Math.trunc(n)
  return y >= 1000 && y <= 9999 ? y : null
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeNonNegativeInt(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

/**
 * @param {unknown} source
 * @returns {PaperSource}
 */
function normalizeSource(source) {
  const allowed = new Set([
    'openalex',
    'semantic_scholar',
    'crossref',
    'core',
    'manual',
    'upload',
    'other',
  ])
  if (typeof source === 'string' && allowed.has(source)) return source
  return 'other'
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function extractDoi(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase()
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripXml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
