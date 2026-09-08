/**
 * Research documents API service.
 */
import apiClient, { getApiError } from './apiClient'

export async function uploadDocument(sessionId, file) {
  try {
    const form = new FormData()
    form.append('sessionId', sessionId)
    form.append('file', file)

    const { data } = await apiClient.post('/documents/upload', form, {
      headers: { 'Content-Type': undefined },
    })
    return data?.data?.document
  } catch (error) {
    throw getApiError(error)
  }
}

export async function listSessionDocuments(sessionId) {
  try {
    const { data } = await apiClient.get(`/documents/session/${sessionId}`)
    return data?.data?.documents || []
  } catch (error) {
    throw getApiError(error)
  }
}

export async function deleteDocument(id) {
  try {
    const { data } = await apiClient.delete(`/documents/${id}`)
    return data?.data?.document
  } catch (error) {
    throw getApiError(error)
  }
}

export default {
  uploadDocument,
  listSessionDocuments,
  deleteDocument,
}
