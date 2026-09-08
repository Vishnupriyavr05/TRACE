/**
 * @fileoverview Full-text source type constants for OA acquisition.
 */

export const FULL_TEXT_SOURCE_TYPE = Object.freeze({
  PDF: 'pdf',
  XML: 'xml',
  HTML: 'html',
  LANDING: 'landing',
})

export const FULL_TEXT_SOURCE_PROVIDER = Object.freeze({
  OPENALEX: 'openalex',
  SEMANTIC_SCHOLAR: 'semantic_scholar',
  PMC: 'pmc',
  EUROPE_PMC: 'europe_pmc',
  ARXIV: 'arxiv',
  REPOSITORY: 'repository',
  PUBLISHER: 'publisher',
  UNPAYWALL: 'unpaywall',
  DSPACE: 'dspace',
  DERIVED: 'derived',
  UPLOAD: 'upload',
})

/**
 * @typedef {object} FullTextSource
 * @property {string} url
 * @property {'pdf'|'xml'|'html'|'landing'} type
 * @property {string} source
 * @property {number} priority
 * @property {string} [kind]
 */

export default {
  FULL_TEXT_SOURCE_TYPE,
  FULL_TEXT_SOURCE_PROVIDER,
}
