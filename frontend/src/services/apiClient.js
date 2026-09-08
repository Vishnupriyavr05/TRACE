/**
 * Axios API client configured for the TRACE backend.
 */
import axios from 'axios'
import { getToken, removeToken } from '../utils/tokenStorage'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
})

apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token invalid/expired — clear so ProtectedRoute can redirect.
      const url = String(error.config?.url || '')
      const isAuthEndpoint =
        url.includes('/auth/login') || url.includes('/auth/register')
      if (!isAuthEndpoint) {
        removeToken()
      }
    }
    return Promise.reject(error)
  }
)

/**
 * Normalize Axios / network errors into a user-facing message + status.
 *
 * @param {unknown} error
 * @returns {{ message: string, status?: number, errors?: string[] }}
 */
export function getApiError(error) {
  if (!error || typeof error !== 'object') {
    return { message: 'Something went wrong. Please try again.' }
  }

  if (!('response' in error) || !error.response) {
    if (error.code === 'ECONNABORTED' || /timeout/i.test(String(error.message || ''))) {
      return {
        message:
          'TRACE is taking longer than expected. Please try again in a moment.',
        status: 408,
      }
    }
    return {
      message:
        'Unable to reach the TRACE server. Check your connection and try again.',
    }
  }

  const { status, data } = error.response

  if (status === 401) {
    return {
      message:
        data?.message ||
        'Your session has expired. Please sign in again.',
      status,
      errors: Array.isArray(data?.errors) ? data.errors : undefined,
    }
  }
  if (status === 400) {
    return {
      message:
        data?.message ||
        'Please check your research question and try again.',
      status,
      errors: Array.isArray(data?.errors) ? data.errors : undefined,
    }
  }
  if (status === 404) {
    return {
      message: data?.message || 'Research session not found.',
      status,
      errors: Array.isArray(data?.errors) ? data.errors : undefined,
    }
  }
  if (status === 429) {
    return {
      message:
        'TRACE could not complete because the AI provider is temporarily rate-limited. Please wait and try again.',
      status,
      errors: Array.isArray(data?.errors) ? data.errors : undefined,
    }
  }
  if (status >= 500) {
    return {
      message:
        data?.message ||
        'TRACE could not complete the research run. Please try again.',
      status,
      errors: Array.isArray(data?.errors) ? data.errors : undefined,
    }
  }

  const message =
    data?.message ||
    (status === 403
      ? 'You do not have permission to perform this action'
      : status === 409
        ? 'An account with this email already exists'
        : 'Request failed. Please try again.')

  return {
    message,
    status,
    errors: Array.isArray(data?.errors) ? data.errors : undefined,
  }
}

export default apiClient
