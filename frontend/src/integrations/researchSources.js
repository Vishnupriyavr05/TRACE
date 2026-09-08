/**
 * Stable integration registry for future backend adapters.
 * No network calls are implemented in the frontend UI phase.
 */
export const RESEARCH_SOURCE_IDS = Object.freeze({
  OPEN_ALEX: 'openalex',
  SEMANTIC_SCHOLAR: 'semantic-scholar',
  CROSSREF: 'crossref',
  CORE: 'core',
  PUBMED: 'pubmed',
  ARXIV: 'arxiv',
  UNPAYWALL: 'unpaywall',
  RETRACTION_WATCH: 'retraction-watch',
  DOAJ: 'doaj',
  GROBID: 'grobid',
})

export const RESEARCH_SOURCE_CAPABILITIES = Object.freeze({
  [RESEARCH_SOURCE_IDS.OPEN_ALEX]: ['metadata', 'citations', 'concepts'],
  [RESEARCH_SOURCE_IDS.SEMANTIC_SCHOLAR]: ['metadata', 'citations', 'abstracts'],
  [RESEARCH_SOURCE_IDS.CROSSREF]: ['doi', 'corrections', 'publisher-metadata'],
  [RESEARCH_SOURCE_IDS.CORE]: ['open-access', 'full-text'],
  [RESEARCH_SOURCE_IDS.PUBMED]: ['biomedical-metadata', 'abstracts'],
  [RESEARCH_SOURCE_IDS.ARXIV]: ['preprints', 'full-text'],
  [RESEARCH_SOURCE_IDS.UNPAYWALL]: ['open-access'],
  [RESEARCH_SOURCE_IDS.RETRACTION_WATCH]: ['retractions', 'corrections'],
  [RESEARCH_SOURCE_IDS.DOAJ]: ['journal-quality', 'open-access'],
  [RESEARCH_SOURCE_IDS.GROBID]: ['document-structure', 'evidence-location'],
})
