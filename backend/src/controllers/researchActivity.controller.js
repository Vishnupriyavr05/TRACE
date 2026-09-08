/**
 * @fileoverview ResearchActivity HTTP controllers.
 */
import * as activityService from '../services/researchActivity.service.js'
import { AppError } from '../utils/AppError.js'

function getUserId(req) {
  const userId = req.user?._id || req.user?.id
  if (!userId) throw new AppError('Authentication required', 401)
  return String(userId)
}

export async function create(req, res, next) {
  try {
    const activity = await activityService.createActivity(
      getUserId(req),
      req.validated
    )
    res.status(201).json({
      success: true,
      message: 'Research activity recorded successfully',
      data: { activity },
    })
  } catch (error) {
    next(error)
  }
}

export async function listBySession(req, res, next) {
  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 50
    const type = req.query.type
    const result = await activityService.listSessionActivities(
      getUserId(req),
      req.params.sessionId,
      { page, limit, type }
    )
    res.status(200).json({
      success: true,
      message: 'Research activities retrieved successfully',
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export async function getById(req, res, next) {
  try {
    const activity = await activityService.getActivityById(
      getUserId(req),
      req.params.id
    )
    res.status(200).json({
      success: true,
      message: 'Research activity retrieved successfully',
      data: { activity },
    })
  } catch (error) {
    next(error)
  }
}

export async function update(req, res, next) {
  try {
    const activity = await activityService.updateActivity(
      getUserId(req),
      req.params.id,
      req.validated
    )
    res.status(200).json({
      success: true,
      message: 'Research activity updated successfully',
      data: { activity },
    })
  } catch (error) {
    next(error)
  }
}

export async function remove(req, res, next) {
  try {
    const activity = await activityService.deleteActivity(
      getUserId(req),
      req.params.id
    )
    res.status(200).json({
      success: true,
      message: 'Research activity deleted successfully',
      data: { activity },
    })
  } catch (error) {
    next(error)
  }
}
