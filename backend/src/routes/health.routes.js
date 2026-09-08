/**
 * @fileoverview Health check routes.
 */
import { Router } from 'express'
import '../config/environment/env.js'

const router = Router()

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'TRACE Backend Running',
    version: '1.0.0',
    environment: process.env.NODE_ENV,
  })
})

export default router
