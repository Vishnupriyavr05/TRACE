/**
 * @fileoverview Convert GROBID TEI XML into structured EvidenceItems (no fabrication).
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
 * @param {string} attrs
 * @returns {string|null}
 */
function pageFromCoords(attrs) {
  const coordsMatch = String(attrs || '').match(/\bcoords=["']([^"']+)["']/i)
  if (!coordsMatch) return null
  const firstBox = coordsMatch[1].split(';')[0].trim()
  const page = firstBox.split(',')[0].trim()
  return /^\d+$/.test(page) ? page : null
}

/**
 * @param {string} chunk
 * @returns {{ type: 'numbered', page: string }|{ type: 'break' }|null}
 */
function parsePbChunk(chunk) {
  if (!/^<pb/i.test(chunk)) return null
  const nMatch = chunk.match(/\bn=["']?(\d+)["']?/i)
  if (nMatch) return { type: 'numbered', page: nMatch[1] }
  return { type: 'break' }
}

/**
 * @param {string} currentPage
 * @param {number} physicalPage
 * @param {{ type: 'numbered', page: string }|{ type: 'break' }} pb
 * @returns {{ currentPage: string, physicalPage: number }}
 */
function applyPageBreak(currentPage, physicalPage, pb) {
  if (pb.type === 'numbered') {
    const nextPhysical = Number(pb.page)
    return {
      currentPage: pb.page,
      physicalPage: Number.isFinite(nextPhysical) ? nextPhysical : physicalPage,
    }
  }
  const nextPhysical = physicalPage + 1
  return { currentPage: String(nextPhysical), physicalPage: nextPhysical }
}

/**
 * @param {string} teiXml
 * @param {string} paperId
 * @param {{ paperIndex?: number, maxItems?: number }} [options]
 * @returns {object[]}
 */
export function parseTeiToEvidenceItems(teiXml, paperId, options = {}) {
  const maxItems = options.maxItems ?? 120
  const paperIndex = options.paperIndex ?? 1
  const items = []

  if (!teiXml || typeof teiXml !== 'string') return items

  const bodyMatch = teiXml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch ? bodyMatch[1] : teiXml

  let currentSection = 'body'
  let sectionIndex = 0
  let paragraphIndex = 0
  let currentPage = '1'
  let physicalPage = 1

  const chunks = body.split(/(<head[^>]*>[\s\S]*?<\/head>|<pb[^>]*\/?>|<p[^>]*>[\s\S]*?<\/p>)/gi)

  for (const chunk of chunks) {
    if (!chunk) continue

    const headMatch = chunk.match(/^<head[^>]*>([\s\S]*?)<\/head>$/i)
    if (headMatch) {
      const title = stripTags(headMatch[1])
      if (title) {
        sectionIndex += 1
        paragraphIndex = 0
        currentSection = title.slice(0, 120)
      }
      continue
    }

    const pb = parsePbChunk(chunk)
    if (pb) {
      ;({ currentPage, physicalPage } = applyPageBreak(currentPage, physicalPage, pb))
      continue
    }

    const pMatch = chunk.match(/^<p[^>]*>([\s\S]*?)<\/p>$/i)
    if (!pMatch) continue

    paragraphIndex += 1
    const pContent = pMatch[1]
    const pParts = pContent.split(/(<pb[^>]*\/?>)/gi)
    const sentenceRegex = /<s([^>]*)>([\s\S]*?)<\/s>/gi
    let sentenceIndex = 0
    let matchedSentence = false

    for (const part of pParts) {
      const innerPb = parsePbChunk(part)
      if (innerPb) {
        ;({ currentPage, physicalPage } = applyPageBreak(currentPage, physicalPage, innerPb))
        continue
      }

      for (const sm of part.matchAll(sentenceRegex)) {
        matchedSentence = true
        sentenceIndex += 1
        const text = stripTags(sm[2])
        if (!text || text.length < 12) continue
        if (items.length >= maxItems) return items

        items.push({
          evidenceId: `EV${paperIndex}-S${sectionIndex}-P${paragraphIndex}-N${sentenceIndex}`,
          paperId: String(paperId),
          section: currentSection,
          sectionIndex,
          paragraphIndex,
          sentenceIndex,
          page: pageFromCoords(sm[1]) ?? currentPage,
          text,
          sourceType: 'full_text',
          evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
          availability: 'available',
          role: 'supporting',
        })
      }
    }

    if (!matchedSentence) {
      const text = stripTags(pContent)
      if (text && text.length >= 20 && items.length < maxItems) {
        const pAttrs = chunk.match(/^<p([^>]*)>/i)?.[1] || ''
        items.push({
          evidenceId: `EV${paperIndex}-S${sectionIndex}-P${paragraphIndex}`,
          paperId: String(paperId),
          section: currentSection,
          sectionIndex,
          paragraphIndex,
          sentenceIndex: null,
          page: pageFromCoords(pAttrs) ?? currentPage,
          text,
          sourceType: 'full_text',
          evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
          availability: 'available',
          role: 'supporting',
        })
      }
    }
  }

  return items
}

export default { parseTeiToEvidenceItems }
