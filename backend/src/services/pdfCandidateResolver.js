/**
 * @fileoverview Rank and resolve downloadable PDF candidates for full-text acquisition.
 * Prefers reliable OA/repository PDFs over publisher landing pages and DOI redirects.
 */
import { isLikelyPdfUrl } from '../integrations/utils/pdfCandidateUrls.js'

/**
 * @typedef {{ url: string, kind: string, priority: number }} PdfCandidate
 */

export { isLikelyPdfUrl }

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeHttpUrl(url) {
  const value = String(url || '').trim()
  if (!value || !/^https?:\/\//i.test(value)) return ''
  try {
    const parsed = new URL(value)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value
  }
}

/**
 * @param {string} url
 * @param {string} kind
 * @param {number} [basePriority]
 * @returns {number}
 */
export function scorePdfCandidateUrl(url, kind, basePriority = 20) {
  let score = basePriority
  const lower = String(url || '').toLowerCase()

  const trusted = [
    { pattern: /arxiv\.org\/pdf\//i, boost: -120 },
    { pattern: /export\.arxiv\.org\/pdf\//i, boost: -115 },
    { pattern: /ncbi\.nlm\.nih\.gov\/pmc\/articles\/.*\/pdf/i, boost: -110 },
    { pattern: /europepmc\.org\/backend\/ptpmcrender/i, boost: -105 },
    { pattern: /biorxiv\.org\/content\/.*\.full\.pdf/i, boost: -100 },
    { pattern: /medrxiv\.org\/content\/.*\.full\.pdf/i, boost: -100 },
    { pattern: /semanticscholar\.org/i, boost: -95 },
    { pattern: /aclanthology\.org\/.*\.pdf/i, boost: -90 },
    { pattern: /zenodo\.org\/records?\/.*\/files\/.*\.pdf/i, boost: -85 },
    { pattern: /osf\.io\/.*\/download/i, boost: -80 },
    { pattern: /mdpi\.com\/.*\/pdf/i, boost: -70 },
    { pattern: /frontiersin\.org\/articles\/.*\/pdf/i, boost: -70 },
    { pattern: /plos\.org\/.*\/article.*filetype=pdf/i, boost: -65 },
    { pattern: /\/content\/pdf\//i, boost: -40 },
    { pattern: /\.pdf(\?|#|$)/i, boost: -20 },
  ]
  for (const rule of trusted) {
    if (rule.pattern.test(lower)) score += rule.boost
  }

  const risky = [
    { pattern: /doi\.org\//i, penalty: 80 },
    { pattern: /link\.springer\.com\/article\//i, penalty: 90 },
    { pattern: /sciencedirect\.com/i, penalty: 90 },
    { pattern: /onlinelibrary\.wiley\.com/i, penalty: 90 },
    { pattern: /nature\.com\/articles\//i, penalty: 90 },
    { pattern: /acm\.org\/doi\//i, penalty: 90 },
    { pattern: /ieeexplore\.ieee\.org/i, penalty: 90 },
    { pattern: /tandfonline\.com/i, penalty: 90 },
    { pattern: /journals\.sagepub\.com/i, penalty: 90 },
    { pattern: /cell\.com\/.*\/fulltext/i, penalty: 90 },
    { pattern: /elsevier\.com/i, penalty: 85 },
    { pattern: /linkinghub\.elsevier\.com/i, penalty: 85 },
    { pattern: /springer\.com\/article\//i, penalty: 85 },
  ]
  for (const rule of risky) {
    if (rule.pattern.test(lower)) score += rule.penalty
  }

  if (kind === 'semantic_scholar_oa_pdf') score -= 15
  if (kind === 'openalex_best_oa_pdf') score -= 10
  if (kind === 'landing_page') score += 40
  if (kind === 'openalex_oa_url') score += 35

  return score
}

/**
 * @param {object} paper
 * @returns {{ url: string, kind: string, priority: number }[]}
 */
export function buildDerivedPdfUrls(paper) {
  /** @type {{ url: string, kind: string, priority: number }[]} */
  const derived = []

  const arxivId =
    paper.externalIds?.arxivId ||
    paper.externalIds?.arxiv ||
    paper.externalIds?.ArXiv ||
    extractArxivFromDoi(paper.doi || paper.externalIds?.doi)
  if (arxivId) {
    const id = String(arxivId).replace(/^arxiv:/i, '').trim()
    if (id) {
      derived.push({
        url: `https://arxiv.org/pdf/${id}.pdf`,
        kind: 'arxiv_derived',
        priority: scorePdfCandidateUrl(`https://arxiv.org/pdf/${id}.pdf`, 'arxiv_derived', 0),
      })
    }
  }

  const pmcRaw =
    paper.externalIds?.pmcid ||
    paper.externalIds?.PMC ||
    paper.externalIds?.PubMedCentral
  if (pmcRaw) {
    const pmcid = String(pmcRaw).replace(/^pmc/i, '').trim()
    if (pmcid) {
      const url = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcid}/pdf/`
      derived.push({
        url,
        kind: 'pmc_derived',
        priority: scorePdfCandidateUrl(url, 'pmc_derived', 2),
      })
    }
  }

  const doi = String(paper.doi || paper.externalIds?.doi || '').trim()
  const biorxivMatch = doi.match(/^10\.1101\/(.+)$/i)
  if (biorxivMatch) {
    const suffix = biorxivMatch[1]
    const url = `https://www.biorxiv.org/content/10.1101/${suffix}.full.pdf`
    derived.push({
      url,
      kind: 'biorxiv_derived',
      priority: scorePdfCandidateUrl(url, 'biorxiv_derived', 3),
    })
  }

  return derived
}

/**
 * @param {unknown} doi
 * @returns {string|null}
 */
export function extractArxivFromDoi(doi) {
  const value = String(doi || '').trim()
  if (!value) return null
  const lower = value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  const match =
    lower.match(/10\.48550\/arxiv\.(.+)$/i) ||
    lower.match(/^arxiv:(.+)$/i)
  return match?.[1] || null
}

/**
 * @param {object} paper
 * @returns {PdfCandidate[]}
 */
export function collectPdfCandidates(paper) {
  /** @type {PdfCandidate[]} */
  const candidates = []
  const seen = new Set()

  /**
   * @param {unknown} value
   * @param {string} kind
   * @param {number} basePriority
   */
  const add = (value, kind, basePriority) => {
    const url = normalizeHttpUrl(value)
    if (!url || seen.has(url)) return
    seen.add(url)
    candidates.push({
      url,
      kind,
      priority: scorePdfCandidateUrl(url, kind, basePriority),
    })
  }

  if (Array.isArray(paper.pdfCandidates)) {
    for (const candidateUrl of paper.pdfCandidates) {
      const kind = isLikelyPdfUrl(candidateUrl)
        ? 'pdf_candidates'
        : 'pdf_candidates_landing'
      add(candidateUrl, kind, kind === 'pdf_candidates' ? 4 : 90)
    }
  }

  if (Array.isArray(paper.locations)) {
    for (const location of paper.locations) {
      add(location?.pdf_url, 'openalex_location_pdf', 9)
    }
  }

  add(paper.openAccessPdf?.url, 'semantic_scholar_oa_pdf', 5)
  add(paper.openAccessPdfUrl, 'semantic_scholar_oa_pdf', 6)
  add(paper.provenance?.openAccessPdf?.url, 'provenance_oa_pdf', 7)
  add(paper.best_oa_location?.pdf_url, 'openalex_best_oa_pdf', 8)
  add(paper.primary_location?.pdf_url, 'openalex_primary_pdf', 10)
  add(paper.pdfUrl, 'paper_pdf_url', 12)
  add(paper.provenance?.pdfUrl, 'provenance_pdf_url', 13)

  for (const derived of buildDerivedPdfUrls(paper)) {
    add(derived.url, derived.kind, derived.priority)
  }

  const oaUrl = paper.open_access?.oa_url
  if (oaUrl && isLikelyPdfUrl(oaUrl)) {
    add(oaUrl, 'openalex_oa_url', 18)
  }

  if (paper.url && isLikelyPdfUrl(paper.url)) {
    add(paper.url, 'landing_pdf_url', 22)
  } else if (paper.url) {
    add(paper.url, 'landing_page', 95)
  }

  candidates.sort(
    (a, b) => a.priority - b.priority || a.url.localeCompare(b.url),
  )
  return candidates
}

/**
 * @param {object} paper
 * @returns {string[]}
 */
export function resolvePdfUrlsForPaper(paper) {
  return collectPdfCandidates(paper).map((candidate) => candidate.url)
}

/**
 * @param {PdfCandidate[]} candidates
 * @param {object} deps
 * @returns {Promise<{
 *   buffer: Buffer|null,
 *   source: string|null,
 *   selectedUrl: string|null,
 *   selectedKind: string|null,
 *   fetchReason: string|null,
 *   attempts: object[]
 * }>}
 */
export async function fetchPdfFromCandidates(candidates, deps) {
  /** @type {object[]} */
  const attempts = []

  for (const candidate of candidates) {
    try {
      const fetched = await deps.fetchBinary(candidate.url, {
        timeoutMs: 25_000,
        source: 'paper_pdf',
      })
      if (
        deps.isLikelyHtmlResponse?.(fetched.buffer) &&
        !deps.isValidPdfBuffer(fetched.buffer)
      ) {
        attempts.push({ ...candidate, status: 'html_response' })
        continue
      }
      if (deps.isValidPdfBuffer(fetched.buffer)) {
        return {
          buffer: fetched.buffer,
          source: 'remote',
          selectedUrl: candidate.url,
          selectedKind: candidate.kind,
          fetchReason: null,
          attempts,
        }
      }
      attempts.push({ ...candidate, status: 'invalid_pdf' })
    } catch (error) {
      const message = error?.message || 'fetch_failed'
      const status = classifyFetchFailure(message)
      attempts.push({ ...candidate, status, error: message })
    }
  }

  const last = attempts[attempts.length - 1]
  return {
    buffer: null,
    source: null,
    selectedUrl: null,
    selectedKind: null,
    fetchReason: last?.status || (candidates.length ? 'fetch_failed' : 'no_pdf_url'),
    attempts,
  }
}

/**
 * @param {string} message
 * @returns {string}
 */
export function classifyFetchFailure(message) {
  const lower = String(message || '').toLowerCase()
  if (lower.includes('http 403')) return 'http_403'
  if (lower.includes('http 401')) return 'http_401'
  if (lower.includes('http 404')) return 'http_404'
  if (lower.includes('http 429')) return 'http_429'
  if (lower.includes('http 500')) return 'http_500'
  if (lower.includes('http 502')) return 'http_502'
  if (lower.includes('html')) return 'html_response'
  if (lower.includes('timeout') || lower.includes('aborted')) return 'fetch_timeout'
  return 'fetch_failed'
}

export default {
  isLikelyPdfUrl,
  scorePdfCandidateUrl,
  buildDerivedPdfUrls,
  extractArxivFromDoi,
  collectPdfCandidates,
  resolvePdfUrlsForPaper,
  fetchPdfFromCandidates,
  classifyFetchFailure,
}
