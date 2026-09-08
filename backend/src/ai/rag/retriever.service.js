/**
 * @fileoverview RAG retriever — interface for similarity-based evidence retrieval.
 *
 * Future responsibility:
 * - Query vector indexes / caches for top-k scholarly passages or paper summaries
 * - Combine metadata filters (year, domain, open access) with semantic search
 * - Integrate OpenAlex / Semantic Scholar result sets before embedding ranking
 * - Return retrieval traces suitable for AgentTrace explainability
 *
 * Consumed by: Explorer agent, reasoning.service, GraphRAG hybrid pipelines.
 * Must NOT own: knowledge graph edge construction or LLM prompt templates.
 */

/**
 * @typedef {Object} RetrievalFilters
 * @property {number} [yearFrom]
 * @property {number} [yearTo]
 * @property {string} [domain]
 * @property {boolean} [openAccess]
 * @property {number} [minCitations]
 */

/**
 * @typedef {Object} RetrievalHit
 * @property {string} id
 * @property {string} [paperId]
 * @property {string} text
 * @property {number} score
 * @property {object} [metadata]
 */

/**
 * @typedef {Object} RetrieveOptions
 * @property {number} [topK]
 * @property {RetrievalFilters} [filters]
 * @property {string} [indexName]
 */

/**
 * Retrieve top-k passages / papers for a natural-language query.
 *
 * @param {string} query
 * @param {RetrieveOptions} [options]
 * @returns {Promise<RetrievalHit[]>}
 */
export async function retrieve(query, options = {}) {
  throw new Error('Not implemented')
}

/**
 * Retrieve by an already-computed query embedding.
 *
 * @param {number[]} queryEmbedding
 * @param {RetrieveOptions} [options]
 * @returns {Promise<RetrievalHit[]>}
 */
export async function retrieveByEmbedding(queryEmbedding, options = {}) {
  throw new Error('Not implemented')
}
