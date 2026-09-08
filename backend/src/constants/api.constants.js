/**
 * @fileoverview HTTP / API surface constants.
 *
 * Future values: API version prefix, route base paths, rate-limit keys,
 * standard header names. No Express router registration here.
 */

/** @type {string} */
export const API_VERSION = 'v1'

/** @type {string} */
export const API_BASE_PATH = `/api/${API_VERSION}`

/**
 * @type {Readonly<Record<string, unknown>>}
 */
export const API_CONSTANTS = Object.freeze({
  // e.g. MAX_REQUEST_BODY_BYTES, DEFAULT_TIMEOUT_MS — intentionally empty
})
