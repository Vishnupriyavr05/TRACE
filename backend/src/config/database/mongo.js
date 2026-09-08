/**
 * @fileoverview MongoDB Atlas connection for the TRACE backend.
 */
import mongoose from 'mongoose'
import { MONGODB_URI } from '../environment/env.js'

/**
 * Establish a connection to MongoDB Atlas.
 * Exits the process if the connection cannot be established.
 *
 * @returns {Promise<typeof mongoose.connection>}
 */
export async function connectDatabase() {
  if (!MONGODB_URI) {
    console.error('MongoDB Connection Failed')
    console.error('MONGODB_URI is not defined in the environment.')
    process.exit(1)
  }

  try {
    await mongoose.connect(MONGODB_URI)
    return mongoose.connection
  } catch (error) {
    console.error('MongoDB Connection Failed')
    console.error(error.message)
    process.exit(1)
  }
}
