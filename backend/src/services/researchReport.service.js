/**
 * @fileoverview ResearchReport service — persistence only (no AI generation).
 */
import mongoose from 'mongoose'
import * as reportRepository from '../repositories/researchReport.repository.js'
import { requireOwnedSession } from './researchSession.service.js'
import { AppError } from '../utils/AppError.js'

function assertId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400)
  }
}

function normalizeReportPayload(input = {}) {
  const executiveSummary = input.executiveSummary ?? input.summary ?? ''
  const keyFindings = input.keyFindings ?? input.findings ?? []

  return {
    executiveSummary,
    summary: executiveSummary,
    researchObjective: input.researchObjective ?? '',
    keyFindings,
    findings: keyFindings,
    supportingEvidence: input.supportingEvidence ?? [],
    contradictions: input.contradictions ?? [],
    researchGaps: input.researchGaps ?? {
      title: '',
      summary: '',
      evidence: '',
      items: [],
    },
    confidence: input.confidence ?? 0,
    confidenceBreakdown: input.confidenceBreakdown ?? null,
    references: input.references ?? [],
    recommendations: input.recommendations ?? [],
    methodology: input.methodology ?? { strengths: [], weaknesses: [] },
    generationMetadata: input.generationMetadata ?? {},
    findingConceptMap: input.findingConceptMap ?? {},
    status: input.status || 'draft',
    version: input.version || 1,
  }
}

export async function createReport(userId, input) {
  await requireOwnedSession(userId, input.sessionId)

  const existing = await reportRepository.findBySessionId(input.sessionId)
  if (existing) {
    throw new AppError('Research report already exists for this session', 409)
  }

  return reportRepository.create({
    sessionId: input.sessionId,
    userId,
    ...normalizeReportPayload(input),
  })
}

export async function getReportById(userId, reportId) {
  assertId(reportId, 'report id')
  const report = await reportRepository.findById(reportId)
  if (!report || String(report.userId) !== String(userId)) {
    throw new AppError('Research report not found', 404)
  }
  return report
}

export async function getReportBySession(userId, sessionId) {
  await requireOwnedSession(userId, sessionId, { allowArchived: true })
  const report = await reportRepository.findBySessionId(sessionId)
  if (!report) {
    throw new AppError('Research report not found', 404)
  }
  return report
}

export async function updateReport(userId, reportId, updates) {
  const existing = await getReportById(userId, reportId)
  await requireOwnedSession(userId, existing.sessionId)

  const merged = normalizeReportPayload({ ...existing, ...updates })
  merged.version = (existing.version || 1) + 1

  const updated = await reportRepository.updateById(reportId, merged)
  if (!updated) throw new AppError('Research report not found', 404)
  return updated
}

export async function deleteReport(userId, reportId) {
  await getReportById(userId, reportId)
  const deleted = await reportRepository.deleteById(reportId)
  if (!deleted) throw new AppError('Research report not found', 404)
  return deleted
}

export async function listReports(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit
  const { items, total } = await reportRepository.listByUserId(userId, {
    skip,
    limit,
  })
  return {
    reports: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  }
}

/**
 * Create or update the single ResearchReport for a session (1:1).
 * Used by Synthesizer — does not generate content.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function upsertForSession(userId, sessionId, data = {}) {
  await requireOwnedSession(userId, sessionId)

  const existing = await reportRepository.findBySessionId(sessionId)
  const payload = normalizeReportPayload(data)
  payload.version = existing ? (existing.version || 1) + 1 : payload.version || 1

  return reportRepository.upsertBySessionId(sessionId, {
    ...payload,
    sessionId,
    userId,
  })
}
