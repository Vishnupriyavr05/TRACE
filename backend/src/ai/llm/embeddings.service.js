/**
 * @fileoverview Embeddings service — interface for vector representation of text.
 *
 * Future responsibility:
 * - Embed queries, paper abstracts, and chunks into dense vectors
 * - Support pluggable backends (Ollama embeddings, OpenAI, sentence-transformers)
 * - Batch embedding for indexing pipelines
 * - Supply vectors to RAG retriever and future vector DBs (Qdrant / Weaviate)
 *
 * Consumed by: rag/retriever, indexing jobs, GraphRAG hybrid retrieval.
 * Must NOT own: graph topology, re-ranking policy, or LLM chat generation.
 */

/**
 * @typedef {Object} EmbedOptions
 * @property {string} [model]
 * @property {boolean} [normalize]
 */

/**
 * Embed a single text string.
 *
 * @param {string} text
 * @param {EmbedOptions} [options]
 * @returns {Promise<number[]>} Dense embedding vector
 */
export async function embedText(text, options = {}) {
  throw new Error('Not implemented')
}

/**
 * Embed multiple texts in one batch.
 *
 * @param {string[]} texts
 * @param {EmbedOptions} [options]
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts, options = {}) {
  throw new Error('Not implemented')
}

/**
 * Return embedding dimensionality for the active model.
 *
 * @param {string} [model]
 * @returns {Promise<number>}
 */
export async function getDimensions(model) {
  throw new Error('Not implemented')
}
