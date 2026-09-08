/**
 * @fileoverview Research Discovery HTTP controllers.
 */
import * as discoveryService from '../services/researchDiscovery.service.js'
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
 * POST /discovery/search
 */
export async function search(req, res, next) {
  try {
    const result = await discoveryService.discoverPapers(
      getUserId(req),
      req.validated
    )

    let message = 'Research discovery completed successfully'
    if (result.allSourcesFailed) {
      message =
        'No research sources returned results. Selected connectors may not be ready yet.'
    } else if (result.partial) {
      message =
        'Research discovery completed with partial results from available sources'
    }

    res.status(200).json({
      success: true,
      message,
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /discovery/providers
 */
export async function listProviders(req, res, next) {
  try {
    const providers = discoveryService.listDiscoveryProviders()

    res.status(200).json({
      success: true,
      message: 'Discovery providers retrieved successfully',
      data: { providers },
    })
  } catch (error) {
    next(error)
  }
}
