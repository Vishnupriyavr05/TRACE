/**
 * @fileoverview Planner service — research question → validated ResearchPlan.
 * Callable later by ResearchOrchestrator. Does not call other agents.
 */
import mongoose from 'mongoose'
import { requireOwnedSession } from '../../services/researchSession.service.js'
import * as activityService from '../../services/researchActivity.service.js'
import { AppError } from '../../utils/AppError.js'
import { runAgent } from '../core/agentRunner.js'
import { createRunId } from '../core/runId.js'
import { plannerAgent } from './planner.agent.js'
import { getSafeAiMeta } from '../providers/index.js'

export const PLANNER_ACTIVITY = Object.freeze({
  STARTED: 'AI_PLANNER_STARTED',
  COMPLETED: 'AI_PLANNER_COMPLETED',
  FAILED: 'AI_PLANNER_FAILED',
})

/**
 * @param {string} userId
 * @param {{ sessionId: string, query: string }} input
 * @returns {Promise<{ runId: string, agent: string, plan: object, meta: object }>}
 */
export async function createResearchPlan(userId, input) {
  const sessionId = String(input?.sessionId || '').trim()
  const query = typeof input?.query === 'string' ? input.query.trim() : ''

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new AppError('Invalid session id', 400)
  }
  if (!query) {
    throw new AppError('query is required', 400)
  }
  if (query.length < 3) {
    throw new AppError('query must be at least 3 characters', 400)
  }
  if (query.length > 2000) {
    throw new AppError('query must be at most 2000 characters', 400)
  }

  const session = await requireOwnedSession(userId, sessionId)
  const runId = createRunId()
  const safeMeta = getSafeAiMeta()

  await activityService.createActivity(userId, {
    sessionId,
    type: PLANNER_ACTIVITY.STARTED,
    description: 'Planner agent started',
    message: 'Planner agent started',
    agentId: 'planner',
    metadata: {
      runId,
      agent: 'planner',
      queryPreview: query.slice(0, 160),
      provider: safeMeta.provider,
      model: safeMeta.model,
    },
    severity: 'info',
  })

  try {
    const result = await runAgent(
      plannerAgent,
      {
        sessionId,
        query,
        sessionContext: {
          domain: session.domain || '',
          selectedSources: session.selectedSources || [],
        },
      },
      { runId }
    )

    await activityService.createActivity(userId, {
      sessionId,
      type: PLANNER_ACTIVITY.COMPLETED,
      description: 'Planner agent completed',
      message: 'Planner agent completed',
      agentId: 'planner',
      metadata: {
        runId,
        agent: 'planner',
        success: true,
        provider: result.meta.provider,
        model: result.meta.model,
        durationMs: result.meta.durationMs,
        subQuestionCount: result.output.subQuestions.length,
        searchQueryCount: result.output.searchQueries.length,
        searchQueries: (result.output.searchQueries || []).map((row) =>
          typeof row === 'string'
            ? { query: row }
            : { query: row?.query || '', purpose: row?.purpose || '' },
        ),
      },
      // Structured plan only — no chain-of-thought
      payload: {
        plan: result.output,
      },
      severity: 'info',
    })

    return {
      runId: result.runId,
      agent: 'planner',
      plan: result.output,
      meta: result.meta,
    }
  } catch (error) {
    try {
      await activityService.createActivity(userId, {
        sessionId,
        type: PLANNER_ACTIVITY.FAILED,
        description: error?.message || 'Planner agent failed',
        message: 'Planner agent failed',
        agentId: 'planner',
        metadata: {
          runId,
          agent: 'planner',
          success: false,
          code: error?.code || error?.name || 'AI_ERROR',
          provider: safeMeta.provider,
          model: safeMeta.model,
        },
        severity: 'error',
      })
    } catch {
      // Do not mask the original AI/ownership error
    }
    throw error
  }
}

export default {
  createResearchPlan,
  PLANNER_ACTIVITY,
}
