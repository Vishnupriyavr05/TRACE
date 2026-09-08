/**
 * @fileoverview Optional OA full-text discovery (Europe PMC, Unpaywall, repository metadata).
 */
import { UNPAYWALL_EMAIL } from '../../config/environment/env.js'
import { connectorGetJson } from '../utils/httpClient.js'
import {
  FULL_TEXT_SOURCE_PROVIDER,
  FULL_TEXT_SOURCE_TYPE,
} from './fullTextSourceTypes.js'
import {
  buildEuropePmcXmlUrl,
  normalizePmcid,
  resolvePaperPmcid,
} from './pmcFullTextClient.js'
import { inferSourceTypeFromUrl } from './fullTextSourceResolver.js'
import {
  discoverDSpaceSourcesForPaper,
  emptyRepositoryApiDiagnostics,
} from './dspaceRepositoryResolver.js'

const EUROPE_PMC_REST = 'https://www.ebi.ac.uk/europepmc/webservices/rest'
const UNPAYWALL_API = 'https://api.unpaywall.org/v2'

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
 * @param {unknown} doi
 * @returns {string}
 */
export function normalizeDoi(doi) {
  const raw = String(doi || '').trim().toLowerCase()
  if (!raw) return ''
  return raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
}

/**
 * @param {string} url
 * @param {string} type
 * @param {string} source
 * @param {number} priority
 * @param {string} [kind]
 * @returns {import('./fullTextSourceTypes.js').FullTextSource}
 */
function makeSource(url, type, source, priority, kind = type) {
  const normalized = normalizeHttpUrl(url)
  if (!normalized) return null
  return {
    url: normalized,
    type,
    source,
    priority,
    kind,
  }
}

/**
 * @param {import('./fullTextSourceTypes.js').FullTextSource[]} sources
 * @param {import('./fullTextSourceTypes.js').FullTextSource|null} row
 */
function pushSource(sources, row) {
  if (!row?.url) return
  sources.push(row)
}

/**
 * @param {string} doi
 * @param {object} deps
 * @returns {Promise<import('./fullTextSourceTypes.js').FullTextSource[]>}
 */
async function discoverEuropePmcByDoi(doi, deps = {}) {
  const normalized = normalizeDoi(doi)
  if (!normalized) return []

  const fetchJson = deps.fetchJson || connectorGetJson
  const url = `${EUROPE_PMC_REST}/search?query=DOI:"${encodeURIComponent(normalized)}"&format=json&pageSize=1`
  const raw = await fetchJson(url, { source: 'europe_pmc_doi_search', timeoutMs: 15_000 })
  const results = raw?.resultList?.result
  if (!Array.isArray(results) || !results.length) return []

  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  for (const row of results) {
    const pmcid = normalizePmcid(row?.pmcid)
    if (pmcid) {
      pushSource(
        sources,
        makeSource(
          buildEuropePmcXmlUrl(pmcid),
          FULL_TEXT_SOURCE_TYPE.XML,
          FULL_TEXT_SOURCE_PROVIDER.EUROPE_PMC,
          -135,
          'europe_pmc_doi_xml',
        ),
      )
    }
    if (row?.pmcid && row?.hasPDF === 'Y') {
      pushSource(
        sources,
        makeSource(
          `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`,
          FULL_TEXT_SOURCE_TYPE.PDF,
          FULL_TEXT_SOURCE_PROVIDER.EUROPE_PMC,
          -105,
          'europe_pmc_doi_pdf',
        ),
      )
    }
  }
  return sources
}

/**
 * @param {string} hostType
 * @param {boolean} hasPdf
 * @returns {number}
 */
function unpaywallPriority(hostType, hasPdf) {
  const host = String(hostType || '').toLowerCase()
  if (host === 'repository') {
    return hasPdf ? -100 : 22
  }
  if (host === 'publisher') {
    return hasPdf ? 48 : 88
  }
  return hasPdf ? -60 : 55
}

/**
 * @param {object} location
 * @returns {import('./fullTextSourceTypes.js').FullTextSource[]}
 */
function mapUnpaywallLocation(location) {
  if (!location || typeof location !== 'object') return []
  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  const hostType = location.host_type || 'other'
  const provider =
    String(hostType).toLowerCase() === 'repository'
      ? FULL_TEXT_SOURCE_PROVIDER.REPOSITORY
      : FULL_TEXT_SOURCE_PROVIDER.UNPAYWALL

  if (location.url_for_pdf) {
    pushSource(
      sources,
      makeSource(
        location.url_for_pdf,
        FULL_TEXT_SOURCE_TYPE.PDF,
        provider,
        unpaywallPriority(hostType, true),
        `unpaywall_${hostType}_pdf`,
      ),
    )
  }
  if (location.url) {
    const type = inferSourceTypeFromUrl(location.url)
    pushSource(
      sources,
      makeSource(
        location.url,
        type,
        provider,
        unpaywallPriority(hostType, type === FULL_TEXT_SOURCE_TYPE.PDF),
        `unpaywall_${hostType}_${type}`,
      ),
    )
  }
  return sources
}

/**
 * @param {string} doi
 * @param {object} deps
 * @returns {Promise<import('./fullTextSourceTypes.js').FullTextSource[]>}
 */
async function discoverUnpaywallByDoi(doi, deps = {}) {
  const email = String(deps.unpaywallEmail || UNPAYWALL_EMAIL || '').trim()
  const normalized = normalizeDoi(doi)
  if (!email || !normalized) return []

  const fetchJson = deps.fetchJson || connectorGetJson
  const url = `${UNPAYWALL_API}/${encodeURIComponent(normalized)}?email=${encodeURIComponent(email)}`
  const raw = await fetchJson(url, { source: 'unpaywall', timeoutMs: 15_000 })

  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  for (const row of mapUnpaywallLocation(raw?.best_oa_location)) {
    pushSource(sources, row)
  }
  if (Array.isArray(raw?.oa_locations)) {
    for (const location of raw.oa_locations) {
      for (const row of mapUnpaywallLocation(location)) {
        pushSource(sources, row)
      }
    }
  }
  return sources
}

/**
 * @param {object} metadata
 * @returns {import('./fullTextSourceTypes.js').FullTextSource[]}
 */
function discoverRepositoryFromMetadata(metadata = {}) {
  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  const paper = metadata.paper || {}
  const lists = [
    paper.fullTextSources,
    metadata.existingSources,
  ]

  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      if (!row?.url) continue
      const lower = String(row.url).toLowerCase()
      const isRepo =
        row.source === FULL_TEXT_SOURCE_PROVIDER.REPOSITORY ||
        /repository|researchoutput|eprint|dspace|hal\.science|zenodo|figshare|csu\.edu/i.test(lower)
      if (!isRepo) continue
      const type = row.type || inferSourceTypeFromUrl(row.url)
      pushSource(
        sources,
        makeSource(
          row.url,
          type,
          FULL_TEXT_SOURCE_PROVIDER.REPOSITORY,
          type === FULL_TEXT_SOURCE_TYPE.XML ? -120 : type === FULL_TEXT_SOURCE_TYPE.PDF ? -85 : 24,
          row.kind || `repository_${type}`,
        ),
      )
    }
  }

  if (Array.isArray(paper.openAlexLocations)) {
    for (const loc of paper.openAlexLocations) {
      const landing = loc?.landing_page_url
      if (!landing || !/repository|researchoutput|eprint|dspace|hal\.|zenodo/i.test(landing)) {
        continue
      }
      pushSource(
        sources,
        makeSource(
          landing,
          FULL_TEXT_SOURCE_TYPE.LANDING,
          FULL_TEXT_SOURCE_PROVIDER.REPOSITORY,
          26,
          'repository_openalex_landing',
        ),
      )
      if (loc?.pdf_url) {
        pushSource(
          sources,
          makeSource(
            loc.pdf_url,
            FULL_TEXT_SOURCE_TYPE.PDF,
            FULL_TEXT_SOURCE_PROVIDER.REPOSITORY,
            -82,
            'repository_openalex_pdf',
          ),
        )
      }
    }
  }

  return sources
}

/**
 * @param {object} metadata
 * @param {object} [deps]
 * @returns {Promise<{
 *   sources: import('./fullTextSourceTypes.js').FullTextSource[],
 *   providersQueried: string[],
 *   repositoryApiDiagnostics: object
 * }>}
 */
export async function discoverOaSources(metadata = {}, deps = {}) {
  const doi = normalizeDoi(metadata.doi || metadata.paper?.doi || metadata.paper?.externalIds?.doi)
  const paper = metadata.paper || {}
  const pmcid = metadata.pmcid || resolvePaperPmcid(paper)

  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  /** @type {string[]} */
  const providersQueried = []

  if (Array.isArray(metadata.existingSources) && metadata.existingSources.length) {
    providersQueried.push('openalex', 'semanticScholar')
  }

  if (pmcid) {
    providersQueried.push('europePmc')
    pushSource(
      sources,
      makeSource(
        buildEuropePmcXmlUrl(pmcid),
        FULL_TEXT_SOURCE_TYPE.XML,
        FULL_TEXT_SOURCE_PROVIDER.EUROPE_PMC,
        -130,
        'europe_pmc_pmcid_xml',
      ),
    )
  }

  if (doi) {
    try {
      providersQueried.push('europePmc')
      sources.push(...(await discoverEuropePmcByDoi(doi, deps)))
    } catch {
      // optional provider — continue
    }
  }

  const repoSources = discoverRepositoryFromMetadata(metadata)
  if (repoSources.length) {
    providersQueried.push('repository')
    sources.push(...repoSources)
  }

  const email = String(deps.unpaywallEmail || UNPAYWALL_EMAIL || '').trim()
  if (email && doi) {
    try {
      providersQueried.push('unpaywall')
      sources.push(...(await discoverUnpaywallByDoi(doi, deps)))
    } catch {
      // optional provider — continue
    }
  }

  const uniqueProviders = [...new Set(providersQueried)]

  let repositoryApiDiagnostics = emptyRepositoryApiDiagnostics()
  const dspaceFn = deps.discoverDSpaceSources || discoverDSpaceSourcesForPaper
  try {
    const dspaceResult = await dspaceFn(
      paper,
      {
        existingSources: [
          ...(metadata.existingSources || []),
          ...sources,
        ],
      },
      deps,
    )
    if (dspaceResult.sources?.length) {
      sources.push(...dspaceResult.sources)
    }
    if (dspaceResult.diagnostics) {
      repositoryApiDiagnostics = dspaceResult.diagnostics
    }
    if (repositoryApiDiagnostics.repositoryApiAttempted) {
      uniqueProviders.push('dspace')
    }
  } catch {
    repositoryApiDiagnostics = {
      ...emptyRepositoryApiDiagnostics(),
      repositoryApiAttempted: true,
      repositoryApiProvider: 'dspace',
      repositoryApiFailureReason: 'dspace_api_failed',
    }
    uniqueProviders.push('dspace')
  }

  return {
    sources,
    providersQueried: [...new Set(uniqueProviders)],
    repositoryApiDiagnostics,
  }
}

export default {
  normalizeDoi,
  discoverOaSources,
}
