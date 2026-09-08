/**
 * @fileoverview GraphRAG request validators.
 */
import mongoose from 'mongoose'

/**
 * Validate POST /graph-rag/retrieve body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateGraphRagRetrieve(body = {}) {
  const errors = []

  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const query = typeof body.query === 'string' ? body.query.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (!query) errors.push('query is required')
  else if (query.length < 2) errors.push('query must be at least 2 characters')
  else if (query.length > 2000) {
    errors.push('query must be at most 2000 characters')
  }

  let topK
  if (body.topK !== undefined && body.topK !== null && body.topK !== '') {
    topK = Number(body.topK)
    if (!Number.isInteger(topK) || topK < 1) {
      errors.push('topK must be an integer >= 1')
    } else if (topK > 50) {
      errors.push('topK must be at most 50')
    }
  }

  let depth
  if (body.depth !== undefined && body.depth !== null && body.depth !== '') {
    depth = Number(body.depth)
    if (!Number.isInteger(depth) || depth < 0) {
      errors.push('depth must be an integer >= 0')
    } else if (depth > 4) {
      errors.push('depth must be at most 4')
    }
  }

  let filters = {}
  if (body.filters !== undefined) {
    if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters)) {
      errors.push('filters must be an object')
    } else {
      filters = body.filters
    }
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      query,
      ...(topK !== undefined ? { topK } : {}),
      ...(depth !== undefined ? { depth } : {}),
      filters,
    },
  }
}

export default {
  validateGraphRagRetrieve,
}
