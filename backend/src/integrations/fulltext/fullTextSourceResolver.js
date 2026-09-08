/**
 * @fileoverview Collect and rank typed full-text sources for OA acquisition.
 */
import { isLikelyPdfUrl } from '../utils/pdfCandidateUrls.js'
import { collectPdfCandidates } from '../../services/pdfCandidateResolver.js'
import {
  FULL_TEXT_SOURCE_PROVIDER,
  FULL_TEXT_SOURCE_TYPE,
} from './fullTextSourceTypes.js'
import {
  buildEuropePmcXmlUrl,
  resolvePaperPmcid,
} from './pmcFullTextClient.js'
import { discoverOaSources } from './oaSourceDiscovery.js'
import {
  emptyRepositoryApiDiagnostics,
} from './dspaceRepositoryResolver.js'

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
 * @param {string} type
 * @param {string} source
 * @param {number} basePriority
 * @param {string} [kind]
 * @returns {{ url: string, type: string, source: string, priority: number, kind: string }}
 */
function makeSource(url, type, source, basePriority, kind = type) {
  return {
    url: normalizeHttpUrl(url),
    type,
    source,
    priority: basePriority,
    kind,
  }
}

/**
 * @param {string} url
 * @returns {'pdf'|'xml'|'html'|'landing'}
 */
export function inferSourceTypeFromUrl(url) {
  const lower = String(url || '').toLowerCase()
  if (/fulltextxml|\/pmc\/.*\.nxml|jats|\/article\/.*\.xml/i.test(lower)) {
    return FULL_TEXT_SOURCE_TYPE.XML
  }
  if (isLikelyPdfUrl(url)) return FULL_TEXT_SOURCE_TYPE.PDF
  if (/\.html?(\?|#|$)/i.test(lower) || /\/html\//i.test(lower)) {
    return FULL_TEXT_SOURCE_TYPE.HTML
  }
  return FULL_TEXT_SOURCE_TYPE.LANDING
}

/**
 * @param {object} paper
 * @returns {import('./fullTextSourceTypes.js').FullTextSource[]}
 */
export function collectFullTextSources(paper) {
  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  const seen = new Set()

  /**
   * @param {string} url
   * @param {string} type
   * @param {string} source
   * @param {number} priority
   * @param {string} [kind]
   */
  const add = (url, type, source, priority, kind) => {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) return
    const key = `${type}|${normalized.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    sources.push(makeSource(normalized, type, source, priority, kind || type))
  }

  const pmcid = resolvePaperPmcid(paper)
  if (pmcid) {
    add(
      buildEuropePmcXmlUrl(pmcid),
      FULL_TEXT_SOURCE_TYPE.XML,
      FULL_TEXT_SOURCE_PROVIDER.EUROPE_PMC,
      -130,
      'europe_pmc_xml',
    )
  }

  if (Array.isArray(paper.fullTextSources)) {
    for (const row of paper.fullTextSources) {
      if (!row?.url) continue
      const inferredType = row.type || inferSourceTypeFromUrl(row.url)
      const isPublisher =
        row.source === FULL_TEXT_SOURCE_PROVIDER.PUBLISHER ||
        row.source === FULL_TEXT_SOURCE_PROVIDER.OPENALEX ||
        /mdpi\.com|springer|elsevier|ieee|nature\.com/i.test(row.url)
      const priority =
        Number(row.priority) ||
        (inferredType === FULL_TEXT_SOURCE_TYPE.XML
          ? -125
          : inferredType === FULL_TEXT_SOURCE_TYPE.PDF && !isPublisher
            ? 15
            : inferredType === FULL_TEXT_SOURCE_TYPE.PDF
              ? 42
              : isPublisher
                ? 90
                : 70)
      add(
        row.url,
        inferredType,
        row.source || FULL_TEXT_SOURCE_PROVIDER.DERIVED,
        priority,
        row.kind || row.type,
      )
    }
  }

  const pdfCandidates = collectPdfCandidates(paper)
  for (const candidate of pdfCandidates) {
    const type =
      candidate.kind === 'landing_page' || candidate.kind === 'pdf_candidates_landing'
        ? FULL_TEXT_SOURCE_TYPE.LANDING
        : FULL_TEXT_SOURCE_TYPE.PDF
    add(
      candidate.url,
      type,
      FULL_TEXT_SOURCE_PROVIDER.DERIVED,
      candidate.priority,
      candidate.kind,
    )
  }

  if (Array.isArray(paper.openAlexLocations)) {
    for (const loc of paper.openAlexLocations) {
      if (loc?.pdf_url) {
        add(
          loc.pdf_url,
          FULL_TEXT_SOURCE_TYPE.PDF,
          FULL_TEXT_SOURCE_PROVIDER.OPENALEX,
          8,
          'openalex_location_pdf',
        )
      }
      if (loc?.landing_page_url) {
        add(
          loc.landing_page_url,
          FULL_TEXT_SOURCE_TYPE.LANDING,
          FULL_TEXT_SOURCE_PROVIDER.OPENALEX,
          92,
          'openalex_location_landing',
        )
      }
    }
  }

  sources.sort(
    (a, b) => a.priority - b.priority || a.url.localeCompare(b.url),
  )
  return sources
}

/**
 * @param {import('./fullTextSourceTypes.js').FullTextSource[]} ...lists
 * @returns {import('./fullTextSourceTypes.js').FullTextSource[]}
 */
export function mergeFullTextSourceLists(...lists) {
  const seen = new Set()
  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
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
  out.sort((a, b) => a.priority - b.priority || a.url.localeCompare(b.url))
  return out
}

/**
 * @param {object} paper
 * @param {object} [deps]
 * @returns {Promise<{
 *   sources: import('./fullTextSourceTypes.js').FullTextSource[],
 *   sourceDiscoveryProviders: string[]
 * }>}
 */
export async function resolveFullTextSourcesForPaper(paper, deps = {}) {
  const localSources = collectFullTextSources(paper)
  const discoverFn = deps.discoverOaSources || discoverOaSources
  const discovery = await discoverFn(
    {
      doi: paper.doi || paper.externalIds?.doi,
      title: paper.title,
      pmcid: resolvePaperPmcid(paper),
      arxivId:
        paper.externalIds?.arxivId ||
        paper.externalIds?.arxiv ||
        paper.externalIds?.ArXiv,
      paperId: paper.paperId,
      existingSources: localSources,
      paper,
    },
    deps,
  )

  const mergedBeforeDspace = mergeFullTextSourceLists(
    localSources,
    discovery.sources,
  )

  let repositoryApiDiagnostics =
    discovery.repositoryApiDiagnostics || emptyRepositoryApiDiagnostics()

  const providers = [...(discovery.providersQueried || [])]

  return {
    sources: mergedBeforeDspace,
    sourceDiscoveryProviders: [...new Set(providers)],
    repositoryApiDiagnostics,
  }
}

export default {
  inferSourceTypeFromUrl,
  collectFullTextSources,
  mergeFullTextSourceLists,
  resolveFullTextSourcesForPaper,
}
