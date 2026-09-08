/**
 * @fileoverview Parse JATS/PMC XML into structured EvidenceItems.
 */
import { EVIDENCE_LEVEL } from '../../ai/core/evidenceLevels.js'

/**
 * @param {string} xml
 * @returns {string}
 */
function stripTags(xml) {
  return String(xml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} jatsXml
 * @param {string} paperId
 * @param {{ paperIndex?: number, maxItems?: number }} [options]
 * @returns {object[]}
 */
export function parseJatsToEvidenceItems(jatsXml, paperId, options = {}) {
  const maxItems = options.maxItems ?? 120
  const paperIndex = options.paperIndex ?? 1
  const items = []

  if (!jatsXml || typeof jatsXml !== 'string') return items

  let currentSection = 'body'
  let sectionIndex = 0
  let paragraphIndex = 0

  const bodyMatch =
    jatsXml.match(/<body[^>]*>([\s\S]*?)<\/body>/i) ||
    jatsXml.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  const body = bodyMatch ? bodyMatch[1] : jatsXml

  const chunks = body.split(
    /(<title[^>]*>[\s\S]*?<\/title>|<sec[^>]*>|<p[^>]*>[\s\S]*?<\/p>)/gi,
  )

  for (const chunk of chunks) {
    if (!chunk) continue

    const secOpen = chunk.match(/^<sec[^>]*>/i)
    if (secOpen) {
      sectionIndex += 1
      paragraphIndex = 0
      continue
    }

    const titleMatch = chunk.match(/^<title[^>]*>([\s\S]*?)<\/title>$/i)
    if (titleMatch) {
      const title = stripTags(titleMatch[1])
      if (title) currentSection = title.slice(0, 120)
      continue
    }

    const pMatch = chunk.match(/^<p[^>]*>([\s\S]*?)<\/p>$/i)
    if (!pMatch) continue

    paragraphIndex += 1
    const text = stripTags(pMatch[1])
    if (!text || text.length < 20) continue
    if (items.length >= maxItems) return items

    items.push({
      evidenceId: `EV${paperIndex}-S${sectionIndex}-P${paragraphIndex}`,
      paperId: String(paperId),
      section: currentSection,
      sectionIndex,
      paragraphIndex,
      sentenceIndex: 1,
      page: null,
      text: text.slice(0, 1200),
      sourceType: 'full_text',
      evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
      availability: 'full_text_xml',
      fallbackReason: null,
      role: 'supporting',
    })
  }

  return items
}

export default { parseJatsToEvidenceItems }
