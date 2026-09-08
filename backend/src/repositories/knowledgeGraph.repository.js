/**
 * @fileoverview KnowledgeGraph repository — DB access only.
 */
import KnowledgeGraph from '../models/knowledgeGraph.model.js'

export async function create(data) {
  const doc = await KnowledgeGraph.create(data)
  return doc.toObject()
}

export async function findById(id) {
  return KnowledgeGraph.findById(id).lean().exec()
}

export async function findBySessionId(sessionId) {
  return KnowledgeGraph.findOne({ sessionId }).lean().exec()
}

export async function updateById(id, updates) {
  return KnowledgeGraph.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

export async function upsertBySessionId(sessionId, data) {
  return KnowledgeGraph.findOneAndUpdate(
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
  const result = await KnowledgeGraph.findByIdAndDelete(id).lean().exec()
  return result
}

export async function listByUserId(userId, { skip = 0, limit = 20 } = {}) {
  const [items, total] = await Promise.all([
    KnowledgeGraph.find({ userId })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    KnowledgeGraph.countDocuments({ userId }),
  ])
  return { items, total }
}
