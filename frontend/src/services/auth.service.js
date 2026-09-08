/**
 * Authentication API service — talks to TRACE backend auth endpoints only.
 */
import apiClient, { getApiError } from './apiClient'
import { saveToken, removeToken, getToken } from '../utils/tokenStorage'

/**
 * @param {{ name: string, email: string, password: string }} payload
 * @returns {Promise<{ user: object, token: string, message: string }>}
 */
export async function register(payload) {
  try {
    const { data } = await apiClient.post('/auth/register', payload)
    const user = data?.data?.user
    const token = data?.data?.token
    if (!user || !token) {
      throw new Error('Unexpected registration response')
    }
    return {
      user,
      token,
      message: data.message || 'User registered successfully',
    }
  } catch (error) {
    throw getApiError(error)
  }
}

/**
 * @param {{ email: string, password: string }} payload
 * @param {{ remember?: boolean }} [options]
 * @returns {Promise<{ user: object, token: string, message: string }>}
 */
export async function login(payload, options = {}) {
  try {
    const { data } = await apiClient.post('/auth/login', payload)
    const user = data?.user
    const token = data?.token
    if (!user || !token) {
      throw new Error('Unexpected login response')
    }

    saveToken(token, { remember: options.remember !== false })

    return {
      user,
      token,
      message: data.message || 'Login successful',
    }
  } catch (error) {
    throw getApiError(error)
  }
}

/**
 * @returns {Promise<object>}
 */
export async function getCurrentUser() {
  try {
    const { data } = await apiClient.get('/auth/me')
    const user = data?.data?.user
    if (!user) {
      throw new Error('Unexpected /auth/me response')
    }
    return user
  } catch (error) {
    throw getApiError(error)
  }
}

/**
 * Clear persisted JWT.
 */
export function logout() {
  removeToken()
}

/**
 * @returns {boolean}
 */
export function hasStoredToken() {
  return Boolean(getToken())
}

/**
 * Persist a token after registration when auto-login is used.
 *
 * @param {string} token
 * @param {{ remember?: boolean }} [options]
 */
export function persistToken(token, options = {}) {
  saveToken(token, options)
}

export default {
  register,
  login,
  getCurrentUser,
  logout,
  hasStoredToken,
  persistToken,
}
