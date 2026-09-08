/**
 * JWT token storage utilities.
 * Supports Remember Me via localStorage vs sessionStorage.
 */

const TOKEN_KEY = 'trace_auth_token'
const REMEMBER_KEY = 'trace_auth_remember'

/**
 * @returns {Storage}
 */
function getStore() {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }
  }

  const remember = window.localStorage.getItem(REMEMBER_KEY)
  if (remember === 'false') {
    return window.sessionStorage
  }
  return window.localStorage
}

/**
 * Persist JWT and remember preference.
 *
 * @param {string} token
 * @param {{ remember?: boolean }} [options]
 */
export function saveToken(token, options = {}) {
  const remember = options.remember !== false

  window.localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false')

  // Clear the other store so only one place holds the token.
  window.localStorage.removeItem(TOKEN_KEY)
  window.sessionStorage.removeItem(TOKEN_KEY)

  const store = remember ? window.localStorage : window.sessionStorage
  store.setItem(TOKEN_KEY, token)
}

/**
 * @returns {string|null}
 */
export function getToken() {
  const local = window.localStorage.getItem(TOKEN_KEY)
  if (local) return local
  return window.sessionStorage.getItem(TOKEN_KEY)
}

/**
 * Remove JWT from both storages (keeps remember preference).
 */
export function removeToken() {
  window.localStorage.removeItem(TOKEN_KEY)
  window.sessionStorage.removeItem(TOKEN_KEY)
}

/**
 * @returns {boolean}
 */
export function getRememberPreference() {
  return window.localStorage.getItem(REMEMBER_KEY) !== 'false'
}

export default {
  saveToken,
  getToken,
  removeToken,
  getRememberPreference,
}
