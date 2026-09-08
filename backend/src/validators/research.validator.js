/**
 * @fileoverview Research request validators — query, filters, run options.
 *
 * Future responsibility:
 * - Validate research question length, filter ranges, sort options
 * - Validate POST /sessions and POST /sessions/:id/run bodies
 *
 * No Joi/Zod wiring yet — interface only.
 */

/**
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateCreateSession(body) {
  throw new Error('Not implemented')
}

/**
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateRunTrace(body) {
  throw new Error('Not implemented')
}

/**
 * @param {object} query
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateResearchFilters(query) {
  throw new Error('Not implemented')
}
