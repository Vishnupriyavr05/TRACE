/**
 * @fileoverview Express application configuration for TRACE.
 */
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { NODE_ENV } from './config/environment/env.js'
import apiRoutes from './routes/index.js'
import { notFoundMiddleware } from './middleware/notFound.middleware.js'
import { errorMiddleware } from './middleware/error.middleware.js'

const app = express()

app.use(helmet())
app.use(cors())
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/v1', apiRoutes)

app.use(notFoundMiddleware)
app.use(errorMiddleware)

export default app
