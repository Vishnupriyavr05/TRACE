/**
 * @fileoverview Knowledge graph request validators.
 */
import mongoose from 'mongoose'

export function validateCreateKnowledgeGraph(body = {}) {
  const errors = []
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (body.nodes !== undefined && !Array.isArray(body.nodes)) {
    errors.push('nodes must be an array')
  }
  if (body.links !== undefined && !Array.isArray(body.links)) {
    errors.push('links must be an array')
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      runId: body.runId ?? null,
      kind: typeof body.kind === 'string' ? body.kind : 'concept',
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      links: Array.isArray(body.links) ? body.links : [],
      paperIds: Array.isArray(body.paperIds) ? body.paperIds : [],
      metadata:
        body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      status: body.status,
      version: body.version,
      schemaVersion: body.schemaVersion,
    },
  }
}

export function validateUpdateKnowledgeGraph(body = {}) {
  const errors = []
  const value = {}

  if (body.nodes !== undefined) {
    if (!Array.isArray(body.nodes)) errors.push('nodes must be an array')
    else value.nodes = body.nodes
  }
  if (body.links !== undefined) {
    if (!Array.isArray(body.links)) errors.push('links must be an array')
    else value.links = body.links
  }
  if (body.paperIds !== undefined) {
    if (!Array.isArray(body.paperIds)) errors.push('paperIds must be an array')
    else value.paperIds = body.paperIds
  }
  if (body.metadata !== undefined) {
    if (!body.metadata || typeof body.metadata !== 'object') {
      errors.push('metadata must be an object')
    } else value.metadata = body.metadata
  }
  if (body.kind !== undefined) value.kind = String(body.kind)
  if (body.runId !== undefined) value.runId = body.runId
  if (body.status !== undefined) value.status = body.status

  if (!Object.keys(value).length && !errors.length) {
    errors.push('At least one field is required to update')
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value }
}
