/**
 * Research activity timeline API service.
 */
import apiClient, { getApiError } from './apiClient'

export async function listSessionActivities(sessionId, params = {}) {
  try {
    const { data } = await apiClient.get(`/activities/session/${sessionId}`, {
      params: { limit: 50, page: 1, ...params },
    })
    return {
      activities: data?.data?.activities || [],
      pagination: data?.data?.pagination || null,
    }
  } catch (error) {
    throw getApiError(error)
  }
}

export async function createActivity(payload) {
  try {
    const { data } = await apiClient.post('/activities', payload)
    return data?.data?.activity
  } catch (error) {
    throw getApiError(error)
  }
}

export default { listSessionActivities, createActivity }
