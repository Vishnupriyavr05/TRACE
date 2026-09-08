/**
 * @fileoverview ResearchSession HTTP controllers.
 */
import * as sessionService from '../services/researchSession.service.js'
import { AppError } from '../utils/AppError.js'

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function getUserId(req) {
  const userId = req.user?._id || req.user?.id
  if (!userId) {
    throw new AppError('Authentication required', 401)
  }
  return String(userId)
}

/**
 * POST /sessions
 */
export async function createSession(req, res, next) {
  try {
    const session = await sessionService.createSession(
      getUserId(req),
      req.validated
    )

    res.status(201).json({
      success: true,
      message: 'Research session created successfully',
      data: { session },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /sessions
 */
export async function listSessions(req, res, next) {
  try {
    const result = await sessionService.listSessions(
      getUserId(req),
      req.validatedQuery
    )

    res.status(200).json({
      success: true,
      message: 'Research sessions retrieved successfully',
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /sessions/:id — restore / open session
 */
export async function getSession(req, res, next) {
  try {
    const session = await sessionService.getSession(
      getUserId(req),
      req.params.id
    )

    res.status(200).json({
      success: true,
      message: 'Research session restored successfully',
      data: { session },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * PATCH /sessions/:id
 */
export async function updateSession(req, res, next) {
  try {
    const session = await sessionService.updateSession(
      getUserId(req),
      req.params.id,
      req.validated
    )

    res.status(200).json({
      success: true,
      message: 'Research session updated successfully',
      data: { session },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * DELETE /sessions/:id — soft archive
 */
export async function deleteSession(req, res, next) {
  try {
    const session = await sessionService.deleteSession(
      getUserId(req),
      req.params.id
    )

    res.status(200).json({
      success: true,
      message: 'Research session archived successfully',
      data: { session },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * PATCH /sessions/:id/pin
 */
export async function pinSession(req, res, next) {
  try {
    const session = await sessionService.pinSession(
      getUserId(req),
      req.params.id,
      req.validated || { toggle: true }
    )

    res.status(200).json({
      success: true,
      message: session.isPinned
        ? 'Research session pinned successfully'
        : 'Research session unpinned successfully',
      data: { session },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * PATCH /sessions/:id/archive
 */
export async function archiveSession(req, res, next) {
  try {
    const isArchived =
      req.body?.isArchived === undefined ? true : Boolean(req.body.isArchived)

    const session = await sessionService.archiveSession(
      getUserId(req),
      req.params.id,
      { isArchived }
    )

    res.status(200).json({
      success: true,
      message: session.isArchived
        ? 'Research session archived successfully'
        : 'Research session unarchived successfully',
      data: { session },
    })
  } catch (error) {
    next(error)
  }
}
