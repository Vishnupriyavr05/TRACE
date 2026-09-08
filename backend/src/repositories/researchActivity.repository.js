/**
 * @fileoverview ResearchActivity repository — DB access only.
 */
import ResearchActivity from '../models/researchActivity.model.js'

export async function create(data) {
  const doc = await ResearchActivity.create(data)
  return doc.toObject()
}

export async function findById(id) {
  return ResearchActivity.findById(id).lean().exec()
}

export async function listBySessionId(
  sessionId,
  { skip = 0, limit = 50, type } = {}
) {
  const filter = { sessionId }
  if (type) filter.type = type

  const [items, total] = await Promise.all([
    ResearchActivity.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    ResearchActivity.countDocuments(filter),
  ])
  return { items, total }
}

export async function updateById(id, updates) {
  return ResearchActivity.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

export async function deleteById(id) {
  return ResearchActivity.findByIdAndDelete(id).lean().exec()
}
