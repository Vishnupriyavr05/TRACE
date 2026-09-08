/**
 * @fileoverview Research Discovery request validators.
 */
import mongoose from 'mongoose'
import { listConnectorSources } from '../integrations/index.js'

const ALLOWED_SOURCES = new Set(listConnectorSources())

/**
 * Validate POST /discovery/search body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateDiscoverySearch(body = {}) {
  const errors = []

  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const query = typeof body.query === 'string' ? body.query.trim() : ''

  if (!sessionId) {
    errors.push('sessionId is required')
  } else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (!query) {
    errors.push('query is required')
  } else if (query.length < 3) {
    errors.push('query must be at least 3 characters')
  } else if (query.length > 2000) {
    errors.push('query must be at most 2000 characters')
  }

  let sources = ['openalex']
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources) || body.sources.length === 0) {
      errors.push('sources must be a non-empty array when provided')
    } else {
      const normalized = body.sources.map((s) => String(s).trim().toLowerCase())
      const invalid = normalized.filter((s) => !ALLOWED_SOURCES.has(s))
      if (invalid.length > 0) {
        errors.push(
          `Unsupported sources: ${invalid.join(', ')}. Allowed: ${[...ALLOWED_SOURCES].join(', ')}`
        )
      } else {
        sources = [...new Set(normalized)]
      }
    }
  }

  let limit = 20
  if (body.limit !== undefined && body.limit !== null && body.limit !== '') {
    const parsed = Number(body.limit)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      errors.push('limit must be an integer')
    } else if (parsed < 1) {
      errors.push('limit must be at least 1')
    } else if (parsed > 100) {
      errors.push('limit must be at most 100')
    } else {
      limit = parsed
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: { sessionId, query, sources, limit },
  }
}
