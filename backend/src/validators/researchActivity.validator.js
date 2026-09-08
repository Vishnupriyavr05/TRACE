/**
 * @fileoverview Research activity request validators.
 */
import mongoose from 'mongoose'
import { ACTIVITY_TYPES } from '../models/researchActivity.model.js'

const SEVERITY_ENUM = Object.freeze(['info', 'warning', 'error'])
export function validateCreateResearchActivity(body = {}) {
  const errors = []
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (!type) errors.push('type is required')
  else if (!ACTIVITY_TYPES.includes(type)) {
    errors.push(`type must be one of: ${ACTIVITY_TYPES.join(', ')}`)
  }

  if (body.severity !== undefined && !SEVERITY_ENUM.includes(body.severity)) {
    errors.push(`severity must be one of: ${SEVERITY_ENUM.join(', ')}`)
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      type,
      description: body.description ?? body.message ?? '',
      message: body.message ?? body.description ?? '',
      metadata: body.metadata ?? {},
      payload: body.payload ?? body.metadata ?? {},
      agentId: body.agentId ?? null,
      paperId: body.paperId ?? null,
      severity: body.severity || 'info',
    },
  }
}

export function validateUpdateResearchActivity(body = {}) {
  const errors = []
  const value = {}

  if (body.description !== undefined) value.description = String(body.description)
  if (body.message !== undefined) value.message = String(body.message)
  if (body.metadata !== undefined) value.metadata = body.metadata
  if (body.payload !== undefined) value.payload = body.payload
  if (body.severity !== undefined) {
    if (!SEVERITY_ENUM.includes(body.severity)) {
      errors.push(`severity must be one of: ${SEVERITY_ENUM.join(', ')}`)
    } else {
      value.severity = body.severity
    }
  }

  if (!Object.keys(value).length) {
    errors.push('At least one field is required to update')
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value }
}
