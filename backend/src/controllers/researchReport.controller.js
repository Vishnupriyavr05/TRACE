/**
 * @fileoverview ResearchReport HTTP controllers.
 */
import * as reportService from '../services/researchReport.service.js'
import { AppError } from '../utils/AppError.js'

function getUserId(req) {
  const userId = req.user?._id || req.user?.id
  if (!userId) throw new AppError('Authentication required', 401)
  return String(userId)
}

export async function create(req, res, next) {
  try {
    const report = await reportService.createReport(getUserId(req), req.validated)
    res.status(201).json({
      success: true,
      message: 'Research report created successfully',
      data: { report },
    })
  } catch (error) {
    next(error)
  }
}

export async function list(req, res, next) {
  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 20
    const result = await reportService.listReports(getUserId(req), {
      page,
      limit,
    })
    res.status(200).json({
      success: true,
      message: 'Research reports retrieved successfully',
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export async function getById(req, res, next) {
  try {
    const report = await reportService.getReportById(
      getUserId(req),
      req.params.id
    )
    res.status(200).json({
      success: true,
      message: 'Research report retrieved successfully',
      data: { report },
    })
  } catch (error) {
    next(error)
  }
}

export async function getBySession(req, res, next) {
  try {
    const report = await reportService.getReportBySession(
      getUserId(req),
      req.params.sessionId
    )
    res.status(200).json({
      success: true,
      message: 'Research report retrieved successfully',
      data: { report },
    })
  } catch (error) {
    next(error)
  }
}

export async function update(req, res, next) {
  try {
    const report = await reportService.updateReport(
      getUserId(req),
      req.params.id,
      req.validated
    )
    res.status(200).json({
      success: true,
      message: 'Research report updated successfully',
      data: { report },
    })
  } catch (error) {
    next(error)
  }
}

export async function remove(req, res, next) {
  try {
    const report = await reportService.deleteReport(
      getUserId(req),
      req.params.id
    )
    res.status(200).json({
      success: true,
      message: 'Research report deleted successfully',
      data: { report },
    })
  } catch (error) {
    next(error)
  }
}
