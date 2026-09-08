/**
 * TRACE AI Research Orchestrator API.
 * Browser never holds provider credentials — JWT via apiClient only.
 */
import apiClient, { getApiError } from './apiClient'

/**
 * Full TRACE research workflow (multi-agent; may take several minutes).
 *
 * POST /ai/research
 *
 * @param {string} sessionId
 * @param {string} query
 * @returns {Promise<{
 *   runId: string,
 *   status: string,
 *   workflow: object,
 *   report: object,
 *   papers?: object[]
 * }>}
 */
export async function research(sessionId, query) {
  try {
    const { data } = await apiClient.post(
      '/ai/research',
      { sessionId, query },
      {
        // Orchestrated multi-agent run — far longer than default 30s
        timeout: Number(import.meta.env.VITE_AI_RESEARCH_TIMEOUT_MS) || 900000,
      },
    )

    return {
      runId: data?.data?.runId,
      status: data?.data?.status,
      workflow: data?.data?.workflow || {},
      report: data?.data?.report,
      papers: Array.isArray(data?.data?.papers) ? data.data.papers : [],
    }
  } catch (error) {
    throw getApiError(error)
  }
}

export default {
  research,
}
