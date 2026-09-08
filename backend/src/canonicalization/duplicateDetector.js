/**
 * @fileoverview Deterministic duplicate detection for Paper DTOs.
 */
import {
  normalizeDoi,
  normalizeTitle,
  scoreSimilarity,
  scoreAuthorSimilarity,
  scoreTitleSimilarity,
  scoreYearSimilarity,
} from './similarityScorer.js'

/** Minimum overall score to treat non-DOI pairs as duplicates. */
const DUPLICATE_OVERALL_THRESHOLD = 0.82

/** Title similarity required for soft (non-DOI) duplicates. */
const TITLE_THRESHOLD = 0.9

/** Author overlap required when titles match closely. */
const AUTHOR_THRESHOLD = 0.45

/**
 * Extract a comparable external paper id when present on a DTO.
 *
 * @param {object} paper
 * @returns {string|null}
 */
export function extractPaperKey(paper = {}) {
  const candidates = [
    paper.paperId,
    paper.externalIds?.openAlexId,
    paper.externalIds?.semanticScholarId,
    paper.externalIds?.arxivId,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toLowerCase()
    }
  }
  return null
}

/**
 * Determine whether two Paper DTOs represent the same work.
 *
 * @param {object} paperA
 * @param {object} paperB
 * @returns {boolean}
 */
export function isDuplicate(paperA = {}, paperB = {}) {
  if (!paperA || !paperB) return false

  const doiA = normalizeDoi(paperA.doi)
  const doiB = normalizeDoi(paperB.doi)
  if (doiA && doiB) {
    return doiA === doiB
  }

  const idA = extractPaperKey(paperA)
  const idB = extractPaperKey(paperB)
  if (idA && idB && idA === idB) {
    return true
  }

  const titleA = normalizeTitle(paperA.title)
  const titleB = normalizeTitle(paperB.title)
  if (!titleA || !titleB) return false

  const titleScore = scoreTitleSimilarity(paperA.title, paperB.title)
  const authorScore = scoreAuthorSimilarity(paperA.authors, paperB.authors)
  const yearScore = scoreYearSimilarity(
    paperA.publicationYear,
    paperB.publicationYear
  )
  const bothYearsPresent =
    paperA.publicationYear != null && paperB.publicationYear != null

  // Exact normalized title + compatible year + some author signal
  if (titleA === titleB) {
    if (bothYearsPresent && yearScore === 0) {
      return false
    }
    if (authorScore >= AUTHOR_THRESHOLD || authorScore === 1) {
      return true
    }
    // Both author lists empty still merge on exact title + year compatibility
    if (
      (!paperA.authors || paperA.authors.length === 0) &&
      (!paperB.authors || paperB.authors.length === 0)
    ) {
      return !bothYearsPresent || yearScore > 0
    }
  }

  if (bothYearsPresent && yearScore === 0) {
    return false
  }

  const scores = scoreSimilarity(paperA, paperB)
  return (
    titleScore >= TITLE_THRESHOLD &&
    authorScore >= AUTHOR_THRESHOLD &&
    scores.overall >= DUPLICATE_OVERALL_THRESHOLD
  )
}

/**
 * Cluster papers into duplicate groups.
 * Each group contains one or more Paper DTOs believed to be the same work.
 *
 * @param {object[]} papers
 * @returns {object[][]}
 */
export function findDuplicates(papers = []) {
  if (!Array.isArray(papers) || papers.length === 0) return []

  const parent = papers.map((_, i) => i)

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }

  function union(a, b) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < papers.length; i += 1) {
    for (let j = i + 1; j < papers.length; j += 1) {
      if (isDuplicate(papers[i], papers[j])) {
        union(i, j)
      }
    }
  }

  /** @type {Map<number, object[]>} */
  const clusters = new Map()
  for (let i = 0; i < papers.length; i += 1) {
    const root = find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(papers[i])
  }

  return [...clusters.values()]
}

export default {
  isDuplicate,
  findDuplicates,
  extractPaperKey,
}
