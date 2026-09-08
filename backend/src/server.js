/**
 * @fileoverview HTTP server entry point for TRACE.
 */
import mongoose from 'mongoose'
import app from './app.js'
import { PORT, NODE_ENV } from './config/environment/env.js'
import { connectDatabase } from './config/database/mongo.js'

async function startServer() {
  await connectDatabase()

  app.listen(PORT, () => {
    console.log('========================================')
    console.log('MongoDB Connected Successfully')
    console.log(`Database: ${mongoose.connection.name}`)
    console.log('TRACE Backend Running')
    console.log(`Environment: ${NODE_ENV}`)
    console.log(`Server: http://localhost:${PORT}`)
    console.log('========================================')
  })
}

startServer()
