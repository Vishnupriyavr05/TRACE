/**
 * @fileoverview Explainability service — persistence placeholders only.
 * No scoring, contradiction detection, or AI reasoning.
 */
import mongoose from 'mongoose'
import * as explainabilityRepository from '../repositories/explainability.repository.js'
import { requireOwnedSession } from './researchSession.service.js'
import { AppError } from '../utils/AppError.js'

function assertId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400)
  }
}

/**
 * Create explainability metadata for a session.
 */
export async function createExplainability(userId, input) {
  await requireOwnedSession(userId, input.sessionId)

  const existing = await explainabilityRepository.findBySessionId(
    input.sessionId
  )
  if (existing) {
    throw new AppError(
      'Explainability metadata already exists for this session',
      409
    )
  }

  return explainabilityRepository.create({
    sessionId: input.sessionId,
    userId,
    reportId: input.reportId ?? null,
    graphId: input.graphId ?? null,
    evidenceLinks: input.evidenceLinks ?? [],
    confidenceScores: input.confidenceScores ?? {},
    reasoningChains: input.reasoningChains ?? [],
    sourceAttribution: input.sourceAttribution ?? [],
    citationSupport: input.citationSupport ?? [],
    contradictions: input.contradictions ?? [],
    researchGaps: input.researchGaps ?? [],
    status: input.status || 'empty',
    metadata: input.metadata || {},
  })
}

export async function getById(userId, id) {
  assertId(id, 'explainability id')
  const doc = await explainabilityRepository.findById(id)
  if (!doc || String(doc.userId) !== String(userId)) {
    throw new AppError('Explainability metadata not found', 404)
  }
  return doc
}

export async function getBySession(userId, sessionId) {
  await requireOwnedSession(userId, sessionId, { allowArchived: true })
  const doc = await explainabilityRepository.findBySessionId(sessionId)
  if (!doc) {
    throw new AppError('Explainability metadata not found', 404)
  }
  return doc
}

export async function updateExplainability(userId, id, updates) {
  const existing = await getById(userId, id)
  await requireOwnedSession(userId, existing.sessionId)

  const updated = await explainabilityRepository.updateById(id, updates)
  if (!updated) {
    throw new AppError('Explainability metadata not found', 404)
  }
  return updated
}

export async function upsertForSession(userId, sessionId, data) {
  await requireOwnedSession(userId, sessionId)

  return explainabilityRepository.upsertBySessionId(sessionId, {
    ...data,
    sessionId,
    userId,
  })
}

export async function deleteExplainability(userId, id) {
  await getById(userId, id)
  const deleted = await explainabilityRepository.deleteById(id)
  if (!deleted) {
    throw new AppError('Explainability metadata not found', 404)
  }
  return deleted
}
