/**
 * Research Sessions API service.
 */
import apiClient, { getApiError } from './apiClient'

export async function listSessions(params = {}) {
  try {
    const { data } = await apiClient.get('/sessions', { params })
    return {
      sessions: data?.data?.sessions || [],
      pagination: data?.data?.pagination || null,
      message: data?.message,
    }
  } catch (error) {
    throw getApiError(error)
  }
}

export async function getSession(id) {
  try {
    const { data } = await apiClient.get(`/sessions/${id}`)
    return data?.data?.session
  } catch (error) {
    throw getApiError(error)
  }
}

export async function createSession(payload) {
  try {
    const { data } = await apiClient.post('/sessions', payload)
    return data?.data?.session
  } catch (error) {
    throw getApiError(error)
  }
}

export async function updateSession(id, payload) {
  try {
    const { data } = await apiClient.patch(`/sessions/${id}`, payload)
    return data?.data?.session
  } catch (error) {
    throw getApiError(error)
  }
}

export async function pinSession(id, isPinned) {
  try {
    const body = typeof isPinned === 'boolean' ? { isPinned } : {}
    const { data } = await apiClient.patch(`/sessions/${id}/pin`, body)
    return data?.data?.session
  } catch (error) {
    throw getApiError(error)
  }
}

export async function archiveSession(id, isArchived = true) {
  try {
    const { data } = await apiClient.patch(`/sessions/${id}/archive`, {
      isArchived,
    })
    return data?.data?.session
  } catch (error) {
    throw getApiError(error)
  }
}

export async function deleteSession(id) {
  try {
    const { data } = await apiClient.delete(`/sessions/${id}`)
    return data?.data?.session
  } catch (error) {
    throw getApiError(error)
  }
}

export default {
  listSessions,
  getSession,
  createSession,
  updateSession,
  pinSession,
  archiveSession,
  deleteSession,
}
