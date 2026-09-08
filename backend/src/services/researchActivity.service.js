/**
 * @fileoverview ResearchActivity service — timeline persistence.
 */
import mongoose from 'mongoose'
import * as activityRepository from '../repositories/researchActivity.repository.js'
import { ACTIVITY_TYPES } from '../models/researchActivity.model.js'
import { requireOwnedSession } from './researchSession.service.js'
import { AppError } from '../utils/AppError.js'

function assertId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400)
  }
}

export async function createActivity(userId, input) {
  await requireOwnedSession(userId, input.sessionId, { allowArchived: true })

  if (!ACTIVITY_TYPES.includes(input.type)) {
    throw new AppError('Invalid activity type', 400)
  }

  const description = input.description || input.message || ''

  return activityRepository.create({
    userId,
    sessionId: input.sessionId,
    type: input.type,
    description,
    message: input.message || description,
    metadata: input.metadata || {},
    payload: input.payload || input.metadata || {},
    agentId: input.agentId ?? null,
    paperId: input.paperId ?? null,
    severity: input.severity || 'info',
  })
}

export async function getActivityById(userId, activityId) {
  assertId(activityId, 'activity id')
  const activity = await activityRepository.findById(activityId)
  if (!activity || String(activity.userId) !== String(userId)) {
    throw new AppError('Research activity not found', 404)
  }
  return activity
}

export async function listSessionActivities(
  userId,
  sessionId,
  { page = 1, limit = 50, type } = {}
) {
  await requireOwnedSession(userId, sessionId, { allowArchived: true })
  const skip = (page - 1) * limit
  const { items, total } = await activityRepository.listBySessionId(sessionId, {
    skip,
    limit,
    type,
  })
  return {
    activities: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  }
}

export async function updateActivity(userId, activityId, updates) {
  await getActivityById(userId, activityId)

  const payload = {}
  if (updates.description !== undefined) payload.description = updates.description
  if (updates.message !== undefined) payload.message = updates.message
  if (updates.metadata !== undefined) payload.metadata = updates.metadata
  if (updates.payload !== undefined) payload.payload = updates.payload
  if (updates.severity !== undefined) payload.severity = updates.severity

  const updated = await activityRepository.updateById(activityId, payload)
  if (!updated) throw new AppError('Research activity not found', 404)
  return updated
}

export async function deleteActivity(userId, activityId) {
  await getActivityById(userId, activityId)
  const deleted = await activityRepository.deleteById(activityId)
  if (!deleted) throw new AppError('Research activity not found', 404)
  return deleted
}
