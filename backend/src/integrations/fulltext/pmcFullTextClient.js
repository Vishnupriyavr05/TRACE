/**
 * @fileoverview Europe PMC / PMC structured full-text fetch (JATS XML).
 */
import { fetchBinary } from '../utils/httpBinary.js'

const EUROPE_PMC_REST = 'https://www.ebi.ac.uk/europepmc/webservices/rest'

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizePmcid(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const match = raw.match(/^(?:pmc)?(?:id:)?(PMC\d+)$/i) || raw.match(/(PMC\d+)/i)
  return match ? `PMC${match[1].replace(/^PMC/i, '')}` : null
}

/**
 * @param {object} paper
 * @returns {string|null}
 */
export function resolvePaperPmcid(paper) {
  const fromIds = normalizePmcid(
    paper.externalIds?.pmcid ||
      paper.externalIds?.PMC ||
      paper.externalIds?.PubMedCentral,
  )
  if (fromIds) return fromIds

  const urls = [
    ...(paper.pdfCandidates || []),
    paper.pdfUrl,
    paper.url,
  ].filter(Boolean)

  for (const url of urls) {
    const match = String(url).match(/\/articles\/(PMC\d+)/i)
    if (match) return normalizePmcid(match[1])
  }
  return null
}

/**
 * @param {string} pmcid
 * @returns {string}
 */
export function buildEuropePmcXmlUrl(pmcid) {
  const id = normalizePmcid(pmcid)
  if (!id) return ''
  return `${EUROPE_PMC_REST}/${id}/fullTextXML`
}

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isLikelyJatsXml(buffer) {
  if (!buffer || buffer.length < 20) return false
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8')
  return (
    /<\?xml/i.test(head) &&
    (/<article[\s>]/i.test(head) ||
      /<pmc-articleset/i.test(head) ||
      /<JATS/i.test(head) ||
      /<journal-article/i.test(head))
  )
}

/**
 * @param {string} pmcid
 * @param {{ fetchBinary?: typeof fetchBinary, timeoutMs?: number }} [options]
 * @returns {Promise<{ xml: string, pmcid: string, url: string }|null>}
 */
export async function fetchEuropePmcFullTextXml(pmcid, options = {}) {
  const id = normalizePmcid(pmcid)
  if (!id) return null

  const url = buildEuropePmcXmlUrl(id)
  const fetchFn = options.fetchBinary || fetchBinary

  try {
    const fetched = await fetchFn(url, {
      timeoutMs: options.timeoutMs ?? 25_000,
      source: 'pmc_xml',
      headers: { Accept: 'application/xml,text/xml,*/*' },
    })
    if (!isLikelyJatsXml(fetched.buffer)) return null
    return {
      xml: fetched.buffer.toString('utf8'),
      pmcid: id,
      url,
    }
  } catch {
    return null
  }
}

export default {
  normalizePmcid,
  resolvePaperPmcid,
  buildEuropePmcXmlUrl,
  isLikelyJatsXml,
  fetchEuropePmcFullTextXml,
}
