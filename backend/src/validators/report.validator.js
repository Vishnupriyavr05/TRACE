/**
 * @fileoverview Report request validators.
 *
 * Future responsibility:
 * - Validate report fetch params and optional partial report updates
 * - Ensure section identifiers match REPORT_SECTIONS contracts
 *
 * No Joi/Zod wiring yet — interface only.
 */

/**
 * @param {object} params
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateReportParams(params) {
  throw new Error('Not implemented')
}

/**
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateReportUpdate(body) {
  throw new Error('Not implemented')
}
