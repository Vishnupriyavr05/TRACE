/**
 * @fileoverview Research repository — DB access for research questions / runs metadata.
 *
 * Future responsibility:
 * - Persist research run metadata linked to sessions (query text, filters, status)
 * - Query research artifacts by user or session for history restore
 * - Must be the only module that writes research_* collections (if split from sessions)
 *
 * Must NOT own: agent orchestration, GraphRAG, or Express routing.
 */

/**
 * @param {string} researchId
 * @returns {Promise<object|null>}
 */
export async function findById(researchId) {
  throw new Error('Not implemented')
}

/**
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function findBySessionId(sessionId) {
  throw new Error('Not implemented')
}

/**
 * @param {object} researchData
 * @returns {Promise<object>}
 */
export async function create(researchData) {
  throw new Error('Not implemented')
}

/**
 * @param {string} researchId
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
export async function updateById(researchId, updates) {
  throw new Error('Not implemented')
}

/**
 * @param {string} userId
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
export async function listByUserId(userId, options = {}) {
  throw new Error('Not implemented')
}
