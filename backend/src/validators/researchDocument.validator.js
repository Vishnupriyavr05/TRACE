/**
 * @fileoverview Research document validators (non-file fields / params).
 * File type and size are enforced by Multer configuration.
 */
import mongoose from 'mongoose'

/**
 * Validate upload form fields (sessionId required).
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateUploadDocument(body = {}) {
  const errors = []
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

  if (!sessionId) {
    errors.push('sessionId is required')
  } else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, value: { sessionId } }
}

/**
 * Validate MongoDB ObjectId route params.
 *
 * @param {string} id
 * @param {string} [label='id']
 * @returns {{ ok: boolean, errors?: string[], value?: string }}
 */
export function validateObjectIdParam(id, label = 'id') {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return { ok: false, errors: [`Invalid ${label}`] }
  }
  return { ok: true, value: id }
}
