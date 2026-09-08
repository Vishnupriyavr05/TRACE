/**
 * Knowledge graph API service.
 */
import apiClient, { getApiError } from './apiClient'

export async function getGraphBySession(sessionId) {
  try {
    const { data } = await apiClient.get(`/graphs/session/${sessionId}`)
    return data?.data?.graph
  } catch (error) {
    throw getApiError(error)
  }
}

export async function createGraph(payload) {
  try {
    const { data } = await apiClient.post('/graphs', payload)
    return data?.data?.graph
  } catch (error) {
    throw getApiError(error)
  }
}

/**
 * Deterministic Knowledge Graph Builder for a session.
 *
 * @param {string} sessionId
 * @param {{ paperIds?: string[], scope?: 'final'|'discovery' }} [options]
 * @returns {Promise<{ graph: object, stats: object, status: string, buildStatus: string }>}
 */
export async function buildGraph(sessionId, options = {}) {
  try {
    const { data } = await apiClient.post(`/graphs/session/${sessionId}/build`, {
      paperIds: options.paperIds,
      scope: options.scope,
    })
    return {
      graph: data?.data?.graph,
      stats: data?.data?.stats,
      status: data?.data?.status,
      buildStatus: data?.data?.buildStatus,
      message: data?.message,
    }
  } catch (error) {
    throw getApiError(error)
  }
}

/**
 * Load graph for a session; create an empty shell when missing (404).
 */
export async function ensureGraphShell(sessionId) {
  try {
    return await getGraphBySession(sessionId)
  } catch (error) {
    if (error?.status === 404) {
      return createGraph({
        sessionId,
        kind: 'concept',
        nodes: [],
        links: [],
        status: 'empty',
      })
    }
    throw error
  }
}

export default {
  getGraphBySession,
  createGraph,
  buildGraph,
  ensureGraphShell,
}
