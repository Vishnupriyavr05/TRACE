/**
 * @fileoverview Canonicalization layer public exports.
 */
export { CanonicalizationService, canonicalizePapers } from './canonicalization.service.js'
export { isDuplicate, findDuplicates } from './duplicateDetector.js'
export { scoreSimilarity } from './similarityScorer.js'
export { resolveMetadata } from './metadataResolver.js'
export { buildCanonicalPaper } from './canonicalPaperBuilder.js'
export { buildSourceAttribution } from './sourceAttribution.js'
