/**
 * @fileoverview ResearchReport repository — DB access only.
 */
import ResearchReport from '../models/researchReport.model.js'

export async function create(data) {
  const doc = await ResearchReport.create(data)
  return doc.toObject()
}

export async function findById(id) {
  return ResearchReport.findById(id).lean().exec()
}

export async function findBySessionId(sessionId) {
  return ResearchReport.findOne({ sessionId }).lean().exec()
}

export async function updateById(id, updates) {
  return ResearchReport.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

export async function upsertBySessionId(sessionId, data) {
  return ResearchReport.findOneAndUpdate(
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
  return ResearchReport.findByIdAndDelete(id).lean().exec()
}

export async function listByUserId(userId, { skip = 0, limit = 20 } = {}) {
  const [items, total] = await Promise.all([
    ResearchReport.find({ userId })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    ResearchReport.countDocuments({ userId }),
  ])
  return { items, total }
}
