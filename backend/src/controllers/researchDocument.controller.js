/**
 * @fileoverview ResearchDocument HTTP controllers.
 */
import * as documentService from '../services/researchDocument.service.js'
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
 * POST /documents/upload
 */
export async function uploadDocument(req, res, next) {
  try {
    const sessionId = req.validated?.sessionId || req.body?.sessionId
    const document = await documentService.uploadDocument(
      getUserId(req),
      sessionId,
      req.file
    )

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: { document },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /documents/session/:sessionId
 */
export async function listBySession(req, res, next) {
  try {
    const documents = await documentService.listSessionDocuments(
      getUserId(req),
      req.params.sessionId
    )

    res.status(200).json({
      success: true,
      message: 'Documents retrieved successfully',
      data: { documents },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /documents/:id
 */
export async function getDocument(req, res, next) {
  try {
    const document = await documentService.getDocument(
      getUserId(req),
      req.params.id
    )

    res.status(200).json({
      success: true,
      message: 'Document retrieved successfully',
      data: { document },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /documents/:id/download
 */
export async function downloadDocument(req, res, next) {
  try {
    const file = await documentService.getDocumentForDownload(
      getUserId(req),
      req.params.id
    )

    res.download(file.absolutePath, file.originalName, (err) => {
      if (err && !res.headersSent) {
        next(err)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * DELETE /documents/:id
 */
export async function deleteDocument(req, res, next) {
  try {
    const document = await documentService.deleteDocument(
      getUserId(req),
      req.params.id
    )

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
      data: { document },
    })
  } catch (error) {
    next(error)
  }
}
