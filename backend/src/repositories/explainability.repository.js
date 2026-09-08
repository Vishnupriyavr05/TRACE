/**
 * @fileoverview Explainability repository — DB access only.
 */
import Explainability from '../models/explainability.model.js'

export async function create(data) {
  const doc = await Explainability.create(data)
  return doc.toObject()
}

export async function findById(id) {
  return Explainability.findById(id).lean().exec()
}

export async function findBySessionId(sessionId) {
  return Explainability.findOne({ sessionId }).lean().exec()
}

export async function updateById(id, updates) {
  return Explainability.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

export async function upsertBySessionId(sessionId, data) {
  return Explainability.findOneAndUpdate(
    { sessionId },
    { $set: data },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  )
    .lean()
    .exec()
}

export async function deleteById(id) {
  return Explainability.findByIdAndDelete(id).lean().exec()
}
