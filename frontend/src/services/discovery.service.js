/**
 * Discovery API service.
 */
import apiClient, { getApiError } from './apiClient'

export async function searchDiscovery(payload) {
  try {
    const { data } = await apiClient.post('/discovery/search', payload)
    return data?.data
  } catch (error) {
    throw getApiError(error)
  }
}

export async function listProviders() {
  try {
    const { data } = await apiClient.get('/discovery/providers')
    return data?.data?.providers || []
  } catch (error) {
    throw getApiError(error)
  }
}

export default { searchDiscovery, listProviders }
