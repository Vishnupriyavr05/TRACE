/**
 * @fileoverview Authentication routes — register, login, current user.
 */
import { Router } from 'express'
import * as authController from '../controllers/auth.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  validateRegister,
  validateLogin,
} from '../validators/auth.validator.js'

const router = Router()

router.post(
  '/register',
  validateBody(validateRegister),
  authController.register
)

router.post('/login', validateBody(validateLogin), authController.login)

router.get('/me', authenticate, authController.me)

export default router
