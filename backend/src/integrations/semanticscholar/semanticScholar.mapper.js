/**
 * @fileoverview Map Semantic Scholar JSON → TRACE Paper DTO (API_FIELD_MAPPING.md).
 */
import { mapFromSemanticScholar } from '../mappers/paper.mapper.js'

/**
 * Convert a Semantic Scholar paper object into the canonical Paper DTO.
 *
 * @param {object} raw
 * @returns {object}
 */
export function mapSemanticScholarPaper(raw = {}) {
  const dto = mapFromSemanticScholar(raw)

  return {
    ...dto,
    references: normalizeReferences(raw.references),
    discoveryMethod: 'SEMANTIC_SCHOLAR',
  }
}

/**
 * Map a Semantic Scholar search response (`{ data, total, ... }`) or paper list.
 *
 * @param {unknown} rawResponse
 * @returns {object[]}
 */
export function mapSemanticScholarSearchResponse(rawResponse) {
  if (Array.isArray(rawResponse)) {
    return rawResponse.map((item) => mapSemanticScholarPaper(item))
  }

  if (
    rawResponse &&
    typeof rawResponse === 'object' &&
    Array.isArray(rawResponse.data)
  ) {
    return rawResponse.data.map((item) => mapSemanticScholarPaper(item))
  }

  if (rawResponse && typeof rawResponse === 'object' && rawResponse.paperId) {
    return [mapSemanticScholarPaper(rawResponse)]
  }

  return []
}

/**
 * @param {unknown} references
 * @returns {string[]|null}
 */
function normalizeReferences(references) {
  if (!Array.isArray(references) || references.length === 0) {
    return null
  }

  const ids = references
    .map((ref) => {
      if (!ref || typeof ref !== 'object') return null
      if (ref.paperId) return String(ref.paperId)
      if (ref.externalIds?.DOI) {
        return String(ref.externalIds.DOI)
          .trim()
          .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
          .toLowerCase()
      }
      if (typeof ref.title === 'string' && ref.title.trim()) {
        return ref.title.trim()
      }
      return null
    })
    .filter(Boolean)

  return ids.length > 0 ? ids : null
}

export default {
  mapSemanticScholarPaper,
  mapSemanticScholarSearchResponse,
}
