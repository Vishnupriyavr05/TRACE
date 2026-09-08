/**
 * @fileoverview Canonicalization orchestration — duplicates → merge → canonical DTOs.
 * Independent of AI, GraphRAG, Discovery HTTP, and MongoDB persistence.
 */
import { findDuplicates } from './duplicateDetector.js'
import { buildCanonicalPaper } from './canonicalPaperBuilder.js'

/**
 * Canonicalize a list of provider Paper DTOs.
 *
 * Steps: duplicate detection → metadata resolution → canonical build.
 *
 * @param {object[]} papers
 * @returns {object[]} Canonical Paper DTOs
 */
export function canonicalizePapers(papers = []) {
  if (!Array.isArray(papers) || papers.length === 0) {
    return []
  }

  const usable = papers.filter(
    (paper) => paper && typeof paper.title === 'string' && paper.title.trim()
  )

  const clusters = findDuplicates(usable)
  return clusters.map((cluster) => buildCanonicalPaper(cluster))
}

/**
 * Service-style facade for Discovery and other callers.
 */
export const CanonicalizationService = {
  /**
   * @param {object[]} papers
   * @returns {object[]}
   */
  canonicalize(papers) {
    return canonicalizePapers(papers)
  },
}

export default CanonicalizationService
