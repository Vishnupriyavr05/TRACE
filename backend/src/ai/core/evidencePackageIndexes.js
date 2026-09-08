/**
 * @fileoverview Shared evidence indexes from EvidencePackage (+ extracted items).
 */
import { selectAnalystPapers } from '../agents/evidenceAnalyst.context.js'
import { evidenceLevelFromItem } from './evidenceLevels.js'

/**
 * @param {object} evidencePackage
 * @returns {object[]}
 */
export function getExtractedEvidenceItems(evidencePackage) {
  if (Array.isArray(evidencePackage?.extractedEvidenceItems)) {
    return evidencePackage.extractedEvidenceItems
  }
  return []
}

/**
 * @param {object} evidencePackage
 * @param {object} [limits]
 * @returns {{
 *   evidenceItems: object[],
 *   evidenceIdToPaperId: Map<string, string>,
 *   allowedPaperIds: Set<string>,
 *   allowedEvidenceIds: Set<string>,
 *   selectedPapers: object[]
 * }}
 */
export function buildPackageEvidenceIndexes(evidencePackage, limits = {}) {
  const maxPapers = limits.maxPapers ?? 15
  const allPapers = Array.isArray(evidencePackage?.papers)
    ? evidencePackage.papers
    : []
  const selectedPapers = selectAnalystPapers(allPapers, maxPapers)
  const selectedIds = new Set(selectedPapers.map((p) => String(p.paperId)))

  const extracted = getExtractedEvidenceItems(evidencePackage)
  const evidenceIdToPaperId = new Map()
  const allowedPaperIds = new Set(selectedIds)
  const allowedEvidenceIds = new Set()

  /** @type {object[]} */
  let evidenceItems = []

  if (extracted.length) {
    evidenceItems = extracted.filter((item) =>
      selectedIds.has(String(item.paperId)),
    )
  } else {
    evidenceItems = selectedPapers.map((paper, index) => {
      const evidenceId = `EV${index + 1}`
      const paperId = String(paper.paperId)
      const hasAbstract = Boolean(String(paper.abstract || '').trim())
      return {
        evidenceId,
        paperId,
        title: paper.title || '',
        text: hasAbstract ? String(paper.abstract).slice(0, 500) : paper.title || '',
        abstract: paper.abstract || '',
        sourceType: hasAbstract ? 'abstract' : 'metadata',
        evidenceLevel: hasAbstract ? 'ABSTRACT' : 'METADATA',
        availability: 'pending_full_text',
        role: 'supporting',
      }
    })
  }

  for (const item of evidenceItems) {
    if (item.evidenceId) {
      allowedEvidenceIds.add(String(item.evidenceId))
      if (item.paperId) {
        evidenceIdToPaperId.set(String(item.evidenceId), String(item.paperId))
      }
    }
  }

  const storedMap = evidencePackage?.evidenceIdToPaperId
  if (storedMap instanceof Map) {
    for (const [k, v] of storedMap) evidenceIdToPaperId.set(String(k), String(v))
  } else if (storedMap && typeof storedMap === 'object') {
    for (const [k, v] of Object.entries(storedMap)) {
      evidenceIdToPaperId.set(String(k), String(v))
    }
  }

  return {
    evidenceItems,
    evidenceIdToPaperId,
    allowedPaperIds,
    allowedEvidenceIds,
    selectedPapers,
  }
}

/**
 * @param {object} evidencePackage
 * @returns {Map<string, string>}
 */
export function paperEvidenceLevelById(evidencePackage) {
  const map = new Map()
  for (const item of getExtractedEvidenceItems(evidencePackage)) {
    const pid = String(item.paperId || '')
    if (!pid) continue
    const level = evidenceLevelFromItem(item)
    const prev = map.get(pid)
    if (!prev || level > prev) map.set(pid, level)
  }
  if (evidencePackage?.paperEvidenceLevels) {
    for (const [k, v] of Object.entries(evidencePackage.paperEvidenceLevels)) {
      map.set(String(k), String(v))
    }
  }
  return map
}

export default {
  getExtractedEvidenceItems,
  buildPackageEvidenceIndexes,
  paperEvidenceLevelById,
}
