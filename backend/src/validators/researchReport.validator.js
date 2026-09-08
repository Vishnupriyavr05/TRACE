/**
 * @fileoverview Research report request validators.
 */
import mongoose from 'mongoose'

export function validateCreateResearchReport(body = {}) {
  const errors = []
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  else if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    errors.push('sessionId must be a valid id')
  }

  if (
    body.confidence !== undefined &&
    (Number(body.confidence) < 0 || Number(body.confidence) > 100)
  ) {
    errors.push('confidence must be between 0 and 100')
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      executiveSummary: body.executiveSummary ?? body.summary ?? '',
      researchObjective: body.researchObjective ?? '',
      keyFindings: body.keyFindings ?? body.findings ?? [],
      supportingEvidence: body.supportingEvidence ?? [],
      contradictions: body.contradictions ?? [],
      researchGaps: body.researchGaps,
      confidence: body.confidence ?? 0,
      confidenceBreakdown: body.confidenceBreakdown ?? null,
      references: body.references ?? [],
      recommendations: body.recommendations ?? [],
      methodology: body.methodology,
      generationMetadata: body.generationMetadata,
      status: body.status,
    },
  }
}

export function validateUpdateResearchReport(body = {}) {
  const errors = []
  const value = { ...body }

  if (
    body.confidence !== undefined &&
    (Number(body.confidence) < 0 || Number(body.confidence) > 100)
  ) {
    errors.push('confidence must be between 0 and 100')
  }

  if (!Object.keys(body || {}).length) {
    errors.push('At least one field is required to update')
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value }
}
