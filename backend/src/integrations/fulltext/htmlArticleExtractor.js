/**
 * @fileoverview Conservative HTML article extraction (no paywall bypass).
 */
import { EVIDENCE_LEVEL } from '../../ai/core/evidenceLevels.js'

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isHtmlChallengePage(buffer) {
  if (!buffer || buffer.length < 20) return false
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').toLowerCase()
  return (
    head.includes('captcha') ||
    head.includes('cf-challenge') ||
    head.includes('just a moment') ||
    head.includes('access denied') ||
    head.includes('login') && head.includes('password') ||
    head.includes('sign in to') ||
    head.includes('403 forbidden') ||
    head.includes('enable javascript') ||
    head.includes('bot detection')
  )
}

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isLikelyArticleHtml(buffer) {
  if (!buffer || buffer.length < 200) return false
  const html = buffer.toString('utf8')
  if (isHtmlChallengePage(buffer)) return false
  const lower = html.toLowerCase()
  const hasArticleMarkers =
    lower.includes('<article') ||
    lower.includes('class="article') ||
    lower.includes('id="article') ||
    lower.includes('<main') ||
    lower.includes('scholarly') ||
    lower.includes('abstract')
  const paragraphCount = (html.match(/<p[\s>]/gi) || []).length
  return hasArticleMarkers && paragraphCount >= 3
}

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isPlausibleScholarlyLandingHtml(buffer) {
  if (!buffer || buffer.length < 80) return false
  if (isHtmlChallengePage(buffer)) return false
  const html = buffer.toString('utf8').toLowerCase()
  return (
    isLikelyArticleHtml(buffer) ||
    html.includes('citation_pdf_url') ||
    html.includes('citation_xml_url') ||
    html.includes('bitstream') ||
    html.includes('/download/') ||
    html.includes('elibrary') ||
    html.includes('repository') ||
    html.includes('dspace') ||
    html.includes('durham.ac.uk') ||
    /\.pdf(\?|"|'|>)/i.test(html)
  )
}

/**
 * @param {string} html
 * @param {string} metaName
 * @returns {string[]}
 */
function extractMetaCitationValues(html, metaName) {
  /** @type {string[]} */
  const values = []
  const patterns = [
    new RegExp(
      `<meta[^>]+name=["']${metaName}["'][^>]+content=["']([^"']+)["']`,
      'gi',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${metaName}["']`,
      'gi',
    ),
  ]
  for (const pattern of patterns) {
    for (const match of String(html).matchAll(pattern)) {
      if (match[1]) values.push(match[1])
    }
  }
  return values
}

/**
 * @param {string} html
 * @param {string} [baseUrl]
 * @returns {{ url: string, type: 'pdf'|'xml'|'html'|'landing' }[]}
 */
export function discoverFullTextAssetUrlsFromHtml(html, baseUrl = '') {
  /** @type {{ url: string, type: 'pdf'|'xml'|'html'|'landing' }[]} */
  const assets = []
  const seen = new Set()

  /**
   * @param {string} rawUrl
   * @param {'pdf'|'xml'|'html'|'landing'} type
   */
  const add = (rawUrl, type) => {
    let value = String(rawUrl || '').trim()
    if (!value) return
    if (value.startsWith('//')) value = `https:${value}`
    if (!/^https?:\/\//i.test(value) && baseUrl) {
      try {
        value = new URL(value, baseUrl).toString()
      } catch {
        return
      }
    }
    if (!/^https?:\/\//i.test(value)) return
    const key = `${type}|${value.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    assets.push({ url: value, type })
  }

  const text = String(html || '')

  for (const value of extractMetaCitationValues(text, 'citation_pdf_url')) {
    add(value, 'pdf')
  }
  for (const value of extractMetaCitationValues(text, 'citation_xml_url')) {
    add(value, 'xml')
  }
  for (const value of extractMetaCitationValues(text, 'citation_fulltext_html_url')) {
    add(value, 'html')
  }

  for (const match of text.matchAll(
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi,
  )) {
    const ogUrl = match[1]
    if (/\.pdf(\?|#|$)/i.test(ogUrl)) add(ogUrl, 'pdf')
  }
  for (const match of text.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/gi,
  )) {
    const ogUrl = match[1]
    if (/\.pdf(\?|#|$)/i.test(ogUrl)) add(ogUrl, 'pdf')
  }

  for (const match of text.matchAll(/<link[^>]+>/gi)) {
    const tag = match[0]
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i)
    if (!hrefMatch) continue
    const typeMatch = tag.match(/type=["']([^"']+)["']/i)
    const relMatch = tag.match(/rel=["']([^"']+)["']/i)
    const mime = (typeMatch?.[1] || '').toLowerCase()
    const rel = (relMatch?.[1] || '').toLowerCase()
    if (mime.includes('pdf') || rel.includes('alternate') && /\.pdf/i.test(hrefMatch[1])) {
      add(hrefMatch[1], 'pdf')
    } else if (
      mime.includes('xml') ||
      /jats|nlm|application\/xml/i.test(mime) ||
      /\.xml(\?|#|$)/i.test(hrefMatch[1])
    ) {
      add(hrefMatch[1], 'xml')
    }
  }

  for (const match of text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1]
    if (/\.pdf(\?|#|$)/i.test(href) || /\/pdf\//i.test(href) || /type=printable/i.test(href)) {
      add(href, 'pdf')
    } else if (
      /\.xml(\?|#|$)/i.test(href) ||
      /fulltextxml|jats|\/xml\//i.test(href)
    ) {
      add(href, 'xml')
    } else if (/download|bitstream|elibrary|\/files\/|content\/pdf/i.test(href)) {
      add(href, isLikelyPdfUrl(href) || /format=pdf|type=pdf|download=1/i.test(href) ? 'pdf' : 'landing')
    }
  }

  return assets.slice(0, 16)
}

function isLikelyPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || '')) || /\/pdf\//i.test(String(url || ''))
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function discoverFullTextLinksFromHtml(html) {
  return discoverFullTextAssetUrlsFromHtml(html)
    .filter((row) => row.type === 'pdf')
    .map((row) => row.url)
    .slice(0, 8)
}

/**
 * @param {string} html
 * @param {string} paperId
 * @param {{ paperIndex?: number, maxItems?: number }} [options]
 * @returns {object[]}
 */
export function extractHtmlArticleEvidenceItems(html, paperId, options = {}) {
  const maxItems = options.maxItems ?? 80
  const paperIndex = options.paperIndex ?? 1
  const items = []

  if (!html || typeof html !== 'string') return items

  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const scope = articleMatch ? articleMatch[1] : html

  let sectionIndex = 0
  let paragraphIndex = 0

  for (const chunk of scope.split(/(<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>|<p[^>]*>[\s\S]*?<\/p>)/gi)) {
    if (!chunk) continue
    const heading = chunk.match(/^<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>$/i)
    if (heading) {
      sectionIndex += 1
      paragraphIndex = 0
      continue
    }
    const pMatch = chunk.match(/^<p[^>]*>([\s\S]*?)<\/p>$/i)
    if (!pMatch) continue
    const text = pMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text || text.length < 30) continue
    paragraphIndex += 1
    if (items.length >= maxItems) break
    items.push({
      evidenceId: `EV${paperIndex}-S${sectionIndex}-P${paragraphIndex}`,
      paperId: String(paperId),
      section: sectionIndex > 0 ? `section-${sectionIndex}` : 'body',
      sectionIndex,
      paragraphIndex,
      sentenceIndex: 1,
      page: null,
      text: text.slice(0, 1200),
      sourceType: 'full_text',
      evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
      availability: 'full_text_html',
      fallbackReason: null,
      role: 'supporting',
    })
  }

  return items
}

export default {
  isHtmlChallengePage,
  isLikelyArticleHtml,
  isPlausibleScholarlyLandingHtml,
  discoverFullTextAssetUrlsFromHtml,
  discoverFullTextLinksFromHtml,
  extractHtmlArticleEvidenceItems,
}
