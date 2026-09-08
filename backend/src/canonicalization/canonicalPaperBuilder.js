/**
 * @fileoverview Build a canonical Paper DTO from a duplicate cluster.
 */
import { resolveMetadata } from './metadataResolver.js'
import { buildSourceAttribution } from './sourceAttribution.js'

/**
 * Construct the final canonical Paper DTO (no persistence).
 *
 * @param {object[]} papers Duplicate cluster of Paper DTOs
 * @returns {object}
 */
export function buildCanonicalPaper(papers = []) {
  if (!Array.isArray(papers) || papers.length === 0) {
    throw new Error('buildCanonicalPaper requires at least one paper')
  }

  const resolved = resolveMetadata(papers)
  const sources = buildSourceAttribution(resolved, papers)

  const providerOrder = papers
    .map((p) => p.source)
    .filter(Boolean)
  const primarySource =
    sources[0]?.provider ||
    providerOrder[0] ||
    'other'

  return {
    title: resolved.title,
    authors: resolved.authors,
    abstract: resolved.abstract,
    doi: resolved.doi,
    venue: resolved.venue,
    publicationYear: resolved.publicationYear,
    citationCount: resolved.citationCount,
    keywords: resolved.keywords,
    paperType: resolved.paperType,
    pdfUrl: resolved.pdfUrl,
    pdfCandidates: resolved.pdfCandidates || [],
    fullTextSources: resolved.fullTextSources || [],
    openAlexLocations: resolved.openAlexLocations || [],
    openAccess: resolved.openAccess,
    peerReviewed: resolved.peerReviewed,
    references: resolved.references,
    source: primarySource,
    sources,
    discoveryMethod:
      papers.length > 1 ? 'CANONICAL_MERGE' : papers[0].discoveryMethod || null,
    providerCount: new Set(providerOrder).size,
  }
}

export default {
  buildCanonicalPaper,
}
