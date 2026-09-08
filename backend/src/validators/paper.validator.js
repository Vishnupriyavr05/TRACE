/**
 * @fileoverview Paper request validators — feedback and paper actions.
 *
 * Future responsibility:
 * - Validate pin / relevant / replace / remove feedback payloads
 * - Validate paper id / DOI path params
 *
 * No Joi/Zod wiring yet — interface only.
 */

/**
 * @param {object} params
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validatePaperParams(params) {
  throw new Error('Not implemented')
}

/**
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validatePaperFeedback(body) {
  throw new Error('Not implemented')
}
