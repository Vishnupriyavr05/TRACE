/**
 * @fileoverview Fetch full-text sources with rich attempt diagnostics.
 */
import { isValidPdfBuffer } from '../utils/pdfValidate.js'
import {
  fetchBinary,
  isLikelyHtmlResponse,
} from '../utils/httpBinary.js'
import { classifyFetchFailure } from '../../services/pdfCandidateResolver.js'
import {
  FULL_TEXT_SOURCE_TYPE,
} from './fullTextSourceTypes.js'
import {
  isLikelyJatsXml,
} from './pmcFullTextClient.js'
import {
  isHtmlChallengePage,
  isLikelyArticleHtml,
  isPlausibleScholarlyLandingHtml,
  discoverFullTextAssetUrlsFromHtml,
} from './htmlArticleExtractor.js'
import { inferSourceTypeFromUrl } from './fullTextSourceResolver.js'

/**
 * @param {string} message
 * @returns {number|null}
 */
function parseHttpStatus(message) {
  const match = String(message || '').match(/HTTP (\d{3})/i)
  return match ? Number(match[1]) : null
}

/**
 * @param {import('./fullTextSourceTypes.js').FullTextSource} source
 * @param {string} message
 * @returns {string}
 */
function classifySourceFetchFailure(source, message) {
  const base = classifyFetchFailure(message)
  const httpStatus = parseHttpStatus(message)
  if (
    source.type === FULL_TEXT_SOURCE_TYPE.PDF &&
    httpStatus &&
    httpStatus >= 400
  ) {
    return `pdf_http_${httpStatus}`
  }
  return base
}

/**
 * @param {import('./fullTextSourceTypes.js').FullTextSource} source
 * @param {object} fetched
 * @returns {object}
 */
function buildAttemptDiagnostics(source, fetched) {
  const buffer = fetched.buffer
  const isPdf = isValidPdfBuffer(buffer)
  const isHtml = isLikelyHtmlResponse(buffer)
  const isXml = isLikelyJatsXml(buffer)
  const isChallenge = isHtml && isHtmlChallengePage(buffer)

  return {
    url: source.url,
    type: source.type,
    source: source.source,
    kind: source.kind || source.type,
    priority: source.priority,
    attempted: true,
    httpStatus: fetched.httpStatus ?? 200,
    contentType: fetched.contentType || null,
    responseBytes: buffer?.length ?? 0,
    isPdf,
    isXml,
    isHtml,
    isChallenge,
    pdfValidationPassed: isPdf,
    landingDiscoveryRan: false,
    discoveredAssetUrls: [],
    elapsedMs: fetched.elapsedMs ?? null,
    failureReason: null,
  }
}

/**
 * @param {import('./fullTextSourceTypes.js').FullTextSource} source
 * @param {Error|string} error
 * @param {number} elapsedMs
 * @returns {object}
 */
function buildErrorAttempt(source, error, elapsedMs) {
  const message = String(error?.message || error || 'fetch_failed')
  return {
    url: source.url,
    type: source.type,
    source: source.source,
    kind: source.kind || source.type,
    priority: source.priority,
    attempted: true,
    httpStatus: parseHttpStatus(message),
    contentType: null,
    responseBytes: 0,
    isPdf: false,
    isXml: false,
    isHtml: false,
    isChallenge: false,
    pdfValidationPassed: false,
    landingDiscoveryRan: false,
    discoveredAssetUrls: [],
    elapsedMs,
    failureReason: classifySourceFetchFailure(source, message),
    error: message,
  }
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @param {import('./fullTextSourceTypes.js').FullTextSource[]} discoveredAssets
 * @param {string[]} discoveredLinks
 * @param {object} diag
 */
function appendDiscoveredAssetsFromHtml(html, baseUrl, discoveredAssets, discoveredLinks, diag) {
  diag.landingDiscoveryRan = true
  /** @type {string[]} */
  const assetUrls = []
  for (const asset of discoverFullTextAssetUrlsFromHtml(html, baseUrl)) {
    assetUrls.push(asset.url)
    discoveredAssets.push({
      url: asset.url,
      type: asset.type,
      source: 'landing_discovery',
      priority:
        asset.type === FULL_TEXT_SOURCE_TYPE.XML
          ? 35
          : asset.type === FULL_TEXT_SOURCE_TYPE.PDF
            ? 45
            : 60,
      kind: `landing_discovered_${asset.type}`,
    })
    if (
      asset.type === FULL_TEXT_SOURCE_TYPE.PDF &&
      !discoveredLinks.includes(asset.url)
    ) {
      discoveredLinks.push(asset.url)
    }
  }
  diag.discoveredAssetUrls = assetUrls
}

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function shouldInspectHtmlLanding(buffer) {
  if (!buffer || !isLikelyHtmlResponse(buffer)) return false
  if (isHtmlChallengePage(buffer)) return false
  return isPlausibleScholarlyLandingHtml(buffer)
}

/**
 * @param {object[]} attempts
 * @param {import('./fullTextSourceTypes.js').FullTextSource[]} derivedSources
 * @param {string[]} discoveredAssetUrls
 * @returns {string}
 */
function resolveTerminalFetchReason(attempts, derivedSources, discoveredAssetUrls) {
  const last = attempts[attempts.length - 1]
  if (derivedSources.length > 0) {
    return 'no_fulltext_asset_found'
  }
  const landingRanWithoutAssets = attempts.some(
    (row) => row.landingDiscoveryRan && !row.discoveredAssetUrls?.length,
  )
  if (landingRanWithoutAssets) {
    return 'landing_page_discovery_failed'
  }
  if (discoveredAssetUrls.length > 0) {
    return 'no_fulltext_asset_found'
  }
  return last?.failureReason || 'fetch_failed'
}

/**
 * @param {import('./fullTextSourceTypes.js').FullTextSource[]} sources
 * @param {object} deps
 * @returns {Promise<{
 *   buffer: Buffer|null,
 *   contentType: string|null,
 *   selectedSource: object|null,
 *   resolvedType: string|null,
 *   fetchReason: string|null,
 *   attempts: object[],
 *   discoveredLinks: string[],
 *   discoveredAssetUrls: string[]
 * }>}
 */
export async function fetchFullTextFromSources(sources, deps = {}) {
  const fetchFn = deps.fetchBinary || fetchBinary
  const defaultFetchTimeoutMs =
    Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : 120_000
  const isValidPdf = deps.isValidPdfBuffer || isValidPdfBuffer
  /** @type {object[]} */
  const attempts = []
  /** @type {string[]} */
  const discoveredLinks = []
  /** @type {string[]} */
  const discoveredAssetUrls = []
  /** @type {import('./fullTextSourceTypes.js').FullTextSource[]} */
  const discoveredAssets = []

  for (const source of sources) {
    const startedAt = Date.now()
    try {
      const fetched = await fetchFn(source.url, {
        timeoutMs: deps.timeoutMs ?? defaultFetchTimeoutMs,
        source: `full_text_${source.type}`,
        headers: deps.headers,
      })
      const elapsedMs = Date.now() - startedAt
      const diag = buildAttemptDiagnostics(source, { ...fetched, elapsedMs })

      if (source.type === FULL_TEXT_SOURCE_TYPE.XML || diag.isXml) {
        diag.failureReason = null
        attempts.push(diag)
        return {
          buffer: fetched.buffer,
          contentType: fetched.contentType,
          selectedSource: source,
          resolvedType: FULL_TEXT_SOURCE_TYPE.XML,
          fetchReason: null,
          attempts,
          discoveredLinks,
          discoveredAssetUrls,
        }
      }

      if (source.type === FULL_TEXT_SOURCE_TYPE.PDF || diag.isPdf) {
        if (isValidPdf(fetched.buffer)) {
          diag.pdfValidationPassed = true
          diag.failureReason = null
          attempts.push(diag)
          return {
            buffer: fetched.buffer,
            contentType: fetched.contentType,
            selectedSource: source,
            resolvedType: FULL_TEXT_SOURCE_TYPE.PDF,
            fetchReason: null,
            attempts,
            discoveredLinks,
            discoveredAssetUrls,
          }
        }
        diag.pdfValidationPassed = false
        if (shouldInspectHtmlLanding(fetched.buffer)) {
          const html = fetched.buffer.toString('utf8')
          appendDiscoveredAssetsFromHtml(
            html,
            source.url,
            discoveredAssets,
            discoveredLinks,
            diag,
          )
          for (const url of diag.discoveredAssetUrls) {
            if (!discoveredAssetUrls.includes(url)) discoveredAssetUrls.push(url)
          }
          diag.failureReason = diag.discoveredAssetUrls.length
            ? 'html_response'
            : 'landing_page_discovery_failed'
          attempts.push(diag)
          continue
        }
        diag.failureReason = 'invalid_pdf'
        attempts.push(diag)
        continue
      }

      if (
        source.type === FULL_TEXT_SOURCE_TYPE.HTML ||
        (diag.isHtml && !diag.isChallenge && isLikelyArticleHtml(fetched.buffer))
      ) {
        diag.failureReason = null
        attempts.push(diag)
        return {
          buffer: fetched.buffer,
          contentType: fetched.contentType,
          selectedSource: source,
          resolvedType: FULL_TEXT_SOURCE_TYPE.HTML,
          fetchReason: null,
          attempts,
          discoveredLinks,
          discoveredAssetUrls,
        }
      }

      if (source.type === FULL_TEXT_SOURCE_TYPE.LANDING || diag.isHtml) {
        if (diag.isChallenge) {
          diag.failureReason = 'html_challenge'
          attempts.push(diag)
          continue
        }
        const html = fetched.buffer.toString('utf8')
        appendDiscoveredAssetsFromHtml(
          html,
          source.url,
          discoveredAssets,
          discoveredLinks,
          diag,
        )
        for (const url of diag.discoveredAssetUrls) {
          if (!discoveredAssetUrls.includes(url)) discoveredAssetUrls.push(url)
        }
        diag.failureReason = diag.discoveredAssetUrls.length
          ? 'html_response'
          : diag.isHtml
            ? 'landing_page_discovery_failed'
            : 'invalid_pdf'
        attempts.push(diag)
        continue
      }

      diag.failureReason = 'invalid_pdf'
      attempts.push(diag)
    } catch (error) {
      attempts.push(buildErrorAttempt(source, error, Date.now() - startedAt))
    }
  }

  const assetUrlKeys = new Set(
    discoveredAssets.map((row) => String(row.url).trim().toLowerCase()),
  )
  const derivedSources = [
    ...discoveredAssets,
    ...discoveredLinks
      .filter((link) => !assetUrlKeys.has(String(link).trim().toLowerCase()))
      .map((link) => ({
        url: link,
        type: inferSourceTypeFromUrl(link),
        source: 'landing_discovery',
        priority: 50,
        kind: 'landing_discovered',
      })),
  ]
  derivedSources.sort(
    (a, b) =>
      (a.type === FULL_TEXT_SOURCE_TYPE.XML ? -1 : a.type === FULL_TEXT_SOURCE_TYPE.PDF ? 0 : 1) -
        (b.type === FULL_TEXT_SOURCE_TYPE.XML ? -1 : b.type === FULL_TEXT_SOURCE_TYPE.PDF ? 0 : 1) ||
      a.priority - b.priority,
  )

  for (const derived of derivedSources) {
    const startedAt = Date.now()
    try {
      const fetched = await fetchFn(derived.url, {
        timeoutMs: deps.timeoutMs ?? defaultFetchTimeoutMs,
        source: 'full_text_discovered',
      })
      const diag = buildAttemptDiagnostics(derived, {
        ...fetched,
        elapsedMs: Date.now() - startedAt,
      })
      if (derived.type === FULL_TEXT_SOURCE_TYPE.XML || diag.isXml) {
        diag.failureReason = null
        attempts.push(diag)
        return {
          buffer: fetched.buffer,
          contentType: fetched.contentType,
          selectedSource: derived,
          resolvedType: FULL_TEXT_SOURCE_TYPE.XML,
          fetchReason: null,
          attempts,
          discoveredLinks,
          discoveredAssetUrls,
        }
      }
      if (isValidPdf(fetched.buffer)) {
        diag.pdfValidationPassed = true
        diag.failureReason = null
        attempts.push(diag)
        return {
          buffer: fetched.buffer,
          contentType: fetched.contentType,
          selectedSource: derived,
          resolvedType: FULL_TEXT_SOURCE_TYPE.PDF,
          fetchReason: null,
          attempts,
          discoveredLinks,
          discoveredAssetUrls,
        }
      }
      diag.pdfValidationPassed = false
      if (derived.type === FULL_TEXT_SOURCE_TYPE.PDF) {
        diag.failureReason = shouldInspectHtmlLanding(fetched.buffer)
          ? 'landing_page_discovery_failed'
          : 'invalid_pdf'
      } else {
        diag.failureReason = 'invalid_pdf'
      }
      attempts.push(diag)
    } catch (error) {
      attempts.push(buildErrorAttempt(derived, error, Date.now() - startedAt))
    }
  }

  const fetchReason = sources.length
    ? resolveTerminalFetchReason(attempts, derivedSources, discoveredAssetUrls)
  : 'no_pdf_url'

  return {
    buffer: null,
    contentType: null,
    selectedSource: null,
    resolvedType: null,
    fetchReason,
    attempts,
    discoveredLinks,
    discoveredAssetUrls,
  }
}

export default { fetchFullTextFromSources }
