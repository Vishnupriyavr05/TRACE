/**
 * @fileoverview Application-wide constants for the TRACE backend.
 *
 * Future values may include: app name, environment labels, default locale,
 * pagination defaults, and feature flags. No runtime config loading here
 * (that belongs in config/).
 */

/** @type {string} */
export const APP_NAME = 'TRACE'

/** @type {string} */
export const APP_DESCRIPTION =
  'Tracing Research Across Connected Evidence & Reasoning'

/**
 * Placeholder for additional app constants object.
 * Extend later without scattering magic strings.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
export const APP_CONSTANTS = Object.freeze({
  // e.g. DEFAULT_PAGE_SIZE, MAX_UPLOAD_BYTES — intentionally empty for now
})
