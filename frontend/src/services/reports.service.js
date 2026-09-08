/**
 * Research reports API service.
 */
import apiClient, { getApiError } from './apiClient'

export async function getReportBySession(sessionId) {
  try {
    const { data } = await apiClient.get(`/reports/session/${sessionId}`)
    return data?.data?.report
  } catch (error) {
    throw getApiError(error)
  }
}

export async function createReport(payload) {
  try {
    const { data } = await apiClient.post('/reports', payload)
    return data?.data?.report
  } catch (error) {
    throw getApiError(error)
  }
}

export async function updateReport(id, payload) {
  try {
    const { data } = await apiClient.patch(`/reports/${id}`, payload)
    return data?.data?.report
  } catch (error) {
    throw getApiError(error)
  }
}

/**
 * Load report for a session; create an empty shell when missing (404).
 */
export async function ensureReportShell(sessionId, extras = {}) {
  try {
    return await getReportBySession(sessionId)
  } catch (error) {
    if (error?.status === 404) {
      return createReport({
        sessionId,
        status: 'draft',
        ...extras,
      })
    }
    throw error
  }
}

export default {
  getReportBySession,
  createReport,
  updateReport,
  ensureReportShell,
}
