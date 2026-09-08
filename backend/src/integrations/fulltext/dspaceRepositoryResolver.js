/**
 * @fileoverview Resolve DSpace repository handle URLs via REST API bitstreams.
 */
import { connectorGetJson } from '../utils/httpClient.js'
import {
  FULL_TEXT_SOURCE_PROVIDER,
  FULL_TEXT_SOURCE_TYPE,
} from './fullTextSourceTypes.js'

const DSPACE_HANDLE_PATH = /\/handle\/([^?#]+)/i
const DSPACE_API_PATH = /\/server\/api\//i

/** DSpace API PDF bitstreams rank above HTML landing pages but below Unpaywall OA PDFs. */
const DSPACE_API_PDF_PRIORITY = -88
/** DSpace XML bitstreams rank below Europe PMC XML but above repository landings. */
const DSPACE_API_XML_PRIORITY = -118

/**
 * @returns {object}
 */
export function emptyRepositoryApiDiagnostics() {
  return {
    repositoryApiAttempted: false,
    repositoryApiProvider: null,
    repositoryApiResolved: false,
    repositoryApiSources: [],
    repositoryApiFailureReason: null,
  }
}

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
 * @returns {string}
 */
export function extractDSpaceBaseUrl(url) {
  const normalized = normalizeHttpUrl(url)
  if (!normalized) return ''
  try {
    return new URL(normalized).origin
  } catch {
    return ''
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isDSpaceHandleUrl(url) {
  const normalized = normalizeHttpUrl(url)
  if (!normalized) return false
  try {
    const { pathname } = new URL(normalized)
    return DSPACE_HANDLE_PATH.test(pathname) && !DSPACE_API_PATH.test(pathname)
  } catch {
    return false
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isDSpaceApiUrl(url) {
  const normalized = normalizeHttpUrl(url)
  if (!normalized) return false
  return DSPACE_API_PATH.test(normalized)
}

/**
 * @param {string} url
 * @returns {string|null}
 */
export function extractDSpaceHandle(url) {
  const normalized = normalizeHttpUrl(url)
  if (!normalized) return null
  try {
    const match = new URL(normalized).pathname.match(DSPACE_HANDLE_PATH)
    if (!match?.[1]) return null
    return decodeURIComponent(match[1]).replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * @param {string} baseUrl
 * @param {string} href
 * @returns {string}
 */
function resolveApiHref(baseUrl, href) {
  const value = String(href || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return normalizeHttpUrl(value)
  try {
    return normalizeHttpUrl(new URL(value, baseUrl).toString())
  } catch {
    return ''
  }
}

/**
 * @param {object} bitstream
 * @param {string} bundleName
 * @returns {'pdf'|'xml'|null}
 */
export function classifyDSpaceBitstream(bitstream, bundleName = '') {
  const name = String(bitstream?.name || '').trim()
  const lowerName = name.toLowerCase()
  const mime = String(bitstream?.mimeType || bitstream?.format || '').toLowerCase()
  const bundle = String(bundleName || bitstream?.bundleName || '').toUpperCase()

  if (
    /\.(jpg|jpeg|png|gif|txt)$/i.test(name) ||
    /\.pdf\.(jpg|jpeg|txt)$/i.test(lowerName) ||
    bundle === 'THUMBNAIL' ||
    bundle === 'LICENSE'
  ) {
    return null
  }

  if (
    mime.includes('xml') ||
    /\.xml$/i.test(name) ||
    mime.includes('application/nlm') ||
    mime.includes('jats')
  ) {
    return FULL_TEXT_SOURCE_TYPE.XML
  }

  if (
    mime.includes('pdf') ||
    (/\.pdf$/i.test(name) && !/\.pdf\.[a-z]+$/i.test(lowerName))
  ) {
    return FULL_TEXT_SOURCE_TYPE.PDF
  }

  return null
}

/**
 * @param {object} response
 * @returns {object[]}
 */
function extractDiscoverObjects(response) {
  const embedded = response?._embedded
  const objects =
    embedded?.searchResult?._embedded?.objects ||
    embedded?.objects ||
    response?.objects
  return Array.isArray(objects) ? objects : []
}

/**
 * @param {object} objectRow
 * @returns {string|null}
 */
function extractItemUuidFromDiscoverObject(objectRow) {
  const item =
    objectRow?._embedded?.indexableObject ||
    objectRow?.indexableObject ||
    objectRow
  return item?.uuid || item?.id || null
}

/**
 * @param {object} response
 * @returns {object[]}
 */
function extractEmbeddedList(response, key) {
  const list = response?._embedded?.[key]
  return Array.isArray(list) ? list : []
}

/**
 * @param {string} baseUrl
 * @param {string} handle
 * @param {object} deps
 * @returns {Promise<string|null>}
 */
async function resolveDSpaceItemUuid(baseUrl, handle, deps = {}) {
  const fetchJson = deps.fetchJson || connectorGetJson
  const searchUrl = `${baseUrl}/server/api/discover/search/objects?query=${encodeURIComponent(`handle:${handle}`)}`
  const raw = await fetchJson(searchUrl, {
    source: 'dspace_discover',
    timeoutMs: deps.timeoutMs ?? 15_000,
  })
  const objects = extractDiscoverObjects(raw)
  for (const row of objects) {
    const uuid = extractItemUuidFromDiscoverObject(row)
    if (uuid) return String(uuid)
  }
  return null
}

/**
 * @param {string} baseUrl
 * @param {string} itemUuid
 * @param {object} deps
 * @returns {Promise<import('./fullTextSourceTypes.js').FullTextSource[]>}
 */
async function resolveDSpaceBitstreamSources(baseUrl, itemUuid, deps = {}) {
  const fetchJson = deps.fetchJson || connectorGetJson
  const bundlesUrl = `${baseUrl}/server/api/core/items/${encodeURIComponent(itemUuid)}/bundles`
  const bundlesRaw = await fetchJson(bundlesUrl, {
    source: 'dspace_bundles',
    timeoutMs: deps.timeoutMs ?? 15_000,
  })
  const bundles = extractEmbeddedList(bundlesRaw, 'bundles')
  const bundleOrder = [...bundles].sort((a, b) => {
    const rank = (name) => {
      const upper = String(name || '').toUpperCase()
      if (upper === 'ORIGINAL') return 0
      if (upper === 'TEXT') return 1
      return 2
    }
    return rank(a?.name) - rank(b?.name) || String(a?.uuid).localeCompare(String(b?.uuid))
  })

  /** @type {Array<{ type: string, contentUrl: string, bitstreamName: string, bundleName: string }>} */
  const candidates = []

  for (const bundle of bundleOrder) {
    const bundleUuid = bundle?.uuid || bundle?.id
    if (!bundleUuid) continue
    const bitstreamsUrl = `${baseUrl}/server/api/core/bundles/${encodeURIComponent(bundleUuid)}/bitstreams`
    const bitstreamsRaw = await fetchJson(bitstreamsUrl, {
      source: 'dspace_bitstreams',
      timeoutMs: deps.timeoutMs ?? 15_000,
    })
    const bitstreams = extractEmbeddedList(bitstreamsRaw, 'bitstreams')
    for (const bitstream of bitstreams) {
      const type = classifyDSpaceBitstream(bitstream, bundle?.name)
      if (!type) continue
      const contentUrl = resolveApiHref(
        baseUrl,
        bitstream?._links?.content?.href ||
          `${baseUrl}/server/api/core/bitstreams/${bitstream?.uuid || bitstream?.id}/content`,
      )
      if (!contentUrl) continue
      candidates.push({
        type,
        contentUrl,
        bitstreamName: String(bitstream?.name || ''),
        bundleName: String(bundle?.name || ''),
      })
    }
  }

  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  const seen = new Set()
  const typeRank = (type) =>
    type === FULL_TEXT_SOURCE_TYPE.XML ? 0 : type === FULL_TEXT_SOURCE_TYPE.PDF ? 1 : 2
  candidates.sort(
    (a, b) => typeRank(a.type) - typeRank(b.type) || a.contentUrl.localeCompare(b.contentUrl),
  )

  for (const row of candidates) {
    const key = `${row.type}|${row.contentUrl.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      url: row.contentUrl,
      type: row.type,
      source: FULL_TEXT_SOURCE_PROVIDER.DSPACE,
      priority:
        row.type === FULL_TEXT_SOURCE_TYPE.XML
          ? DSPACE_API_XML_PRIORITY
          : DSPACE_API_PDF_PRIORITY,
      kind:
        row.type === FULL_TEXT_SOURCE_TYPE.XML
          ? 'dspace_api_xml'
          : 'dspace_api_pdf',
      resolutionMethod: 'dspace_discover_handle',
      bitstreamName: row.bitstreamName,
      bundleName: row.bundleName,
    })
  }

  return sources
}

/**
 * @param {string} landingUrl
 * @param {object} [deps]
 * @returns {Promise<{
 *   sources: import('./fullTextSourceTypes.js').FullTextSource[],
 *   diagnostics: object
 * }>}
 */
export async function resolveDSpaceSourcesFromLandingUrl(landingUrl, deps = {}) {
  const normalizedLanding = normalizeHttpUrl(landingUrl)
  const diagnostics = {
    ...emptyRepositoryApiDiagnostics(),
    repositoryApiAttempted: true,
    repositoryApiProvider: 'dspace',
    landingUrl: normalizedLanding,
  }

  if (!isDSpaceHandleUrl(normalizedLanding)) {
    diagnostics.repositoryApiAttempted = false
    diagnostics.repositoryApiFailureReason = 'not_dspace_handle_url'
    return { sources: [], diagnostics }
  }

  const handle = extractDSpaceHandle(normalizedLanding)
  const baseUrl = extractDSpaceBaseUrl(normalizedLanding)
  if (!handle || !baseUrl) {
    diagnostics.repositoryApiFailureReason = 'invalid_dspace_handle_url'
    return { sources: [], diagnostics }
  }

  try {
    const itemUuid = await resolveDSpaceItemUuid(baseUrl, handle, deps)
    if (!itemUuid) {
      diagnostics.repositoryApiFailureReason = 'dspace_item_not_found'
      return { sources: [], diagnostics }
    }

    const sources = await resolveDSpaceBitstreamSources(baseUrl, itemUuid, deps)
    if (!sources.length) {
      diagnostics.repositoryApiFailureReason = 'no_fulltext_bitstream'
      return { sources: [], diagnostics }
    }

    diagnostics.repositoryApiResolved = true
    diagnostics.repositoryApiFailureReason = null
    diagnostics.repositoryApiSources = sources.map((row) => ({
      url: row.url,
      type: row.type,
      sourceType: row.type,
      resolutionMethod: row.resolutionMethod || row.kind || 'dspace_api',
      landingUrl: normalizedLanding,
      handle,
      bitstreamName: row.bitstreamName,
      bundleName: row.bundleName,
    }))

    for (const source of sources) {
      source.landingUrl = normalizedLanding
      source.handle = handle
    }

    return { sources, diagnostics }
  } catch (error) {
    diagnostics.repositoryApiFailureReason =
      error?.code === 'INVALID_RESPONSE' && error?.details?.status === 404
        ? 'dspace_api_not_found'
        : 'dspace_api_failed'
    return { sources: [], diagnostics }
  }
}

/**
 * @param {object} paper
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {Promise<{
 *   sources: import('./fullTextSourceTypes.js').FullTextSource[],
 *   diagnostics: object
 * }>}
 */
export async function discoverDSpaceSourcesForPaper(
  paper = {},
  options = {},
  deps = {},
) {
  const diagnostics = emptyRepositoryApiDiagnostics()
  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const sources = []
  const seenLanding = new Set()

  /**
   * @param {unknown} value
   */
  const considerUrl = (value) => {
    const normalized = normalizeHttpUrl(value)
    if (!normalized || !isDSpaceHandleUrl(normalized)) return
    const key = normalized.toLowerCase()
    if (seenLanding.has(key)) return
    seenLanding.add(key)
  }

  if (Array.isArray(paper.fullTextSources)) {
    for (const row of paper.fullTextSources) considerUrl(row?.url)
  }
  if (Array.isArray(paper.openAlexLocations)) {
    for (const loc of paper.openAlexLocations) considerUrl(loc?.landing_page_url)
  }
  if (Array.isArray(options.existingSources)) {
    for (const row of options.existingSources) considerUrl(row?.url)
  }
  if (Array.isArray(paper.pdfCandidates)) {
    for (const url of paper.pdfCandidates) considerUrl(url)
  }
  considerUrl(paper.url)

  if (!seenLanding.size) {
    return { sources: [], diagnostics }
  }

  diagnostics.repositoryApiAttempted = true
  diagnostics.repositoryApiProvider = 'dspace'
  /** @type {object[]} */
  const resolvedRows = []
  /** @type {string[]} */
  const failures = []

  for (const landingUrl of seenLanding) {
    const result = await resolveDSpaceSourcesFromLandingUrl(landingUrl, deps)
    if (result.diagnostics?.repositoryApiResolved) {
      diagnostics.repositoryApiResolved = true
      resolvedRows.push(...(result.diagnostics.repositoryApiSources || []))
      sources.push(...result.sources)
    } else if (result.diagnostics?.repositoryApiFailureReason) {
      failures.push(result.diagnostics.repositoryApiFailureReason)
    }
  }

  diagnostics.repositoryApiSources = resolvedRows
  if (!diagnostics.repositoryApiResolved && failures.length) {
    diagnostics.repositoryApiFailureReason = failures[failures.length - 1]
  }

  const deduped = []
  const seenSource = new Set()
  for (const row of sources) {
    const key = `${row.type}|${String(row.url).toLowerCase()}`
    if (seenSource.has(key)) continue
    seenSource.add(key)
    deduped.push(row)
  }

  deduped.sort(
    (a, b) => a.priority - b.priority || String(a.url).localeCompare(String(b.url)),
  )

  return { sources: deduped, diagnostics }
}

export default {
  emptyRepositoryApiDiagnostics,
  extractDSpaceBaseUrl,
  extractDSpaceHandle,
  isDSpaceHandleUrl,
  isDSpaceApiUrl,
  classifyDSpaceBitstream,
  resolveDSpaceSourcesFromLandingUrl,
  discoverDSpaceSourcesForPaper,
}
