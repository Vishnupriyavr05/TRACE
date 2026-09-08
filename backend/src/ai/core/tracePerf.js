/**
 * @fileoverview Lightweight per-TRACE stage timing (audit / profiling only).
 * Does not log prompts, evidence text, or query content beyond runId.
 */
import { performance } from 'node:perf_hooks'
import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

/**
 * @param {string} runId
 * @returns {object}
 */
export function createTracePerf(runId) {
  return {
    runId: String(runId || ''),
    startedAt: performance.now(),
    stages: Object.create(null),
    agents: Object.create(null),
    fullTextRuns: [],
    graph: null,
    cooldownMs: 0,
    refinement: false,
  }
}

/**
 * @param {object} perf
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>|T}
 * @template T
 */
export function runWithTracePerf(perf, fn) {
  return storage.run(perf, fn)
}

/**
 * @returns {object|null}
 */
export function getTracePerf() {
  return storage.getStore() || null
}

/**
 * @param {string} stage
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function timeStage(stage, fn) {
  const perf = getTracePerf()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    if (perf && stage) {
      const ms = performance.now() - start
      perf.stages[stage] = (perf.stages[stage] || 0) + ms
    }
  }
}

/**
 * @param {string} agent
 * @param {object} [meta]
 */
export function recordAgentTiming(agent, meta = {}) {
  const perf = getTracePerf()
  if (!perf || !agent) return
  const key = String(agent)
  const prev = perf.agents[key]
  perf.agents[key] = {
    durationMs:
      (prev?.durationMs || 0) + (Number(meta.durationMs) || 0),
    model: meta.model || prev?.model || null,
    provider: meta.provider || prev?.provider || null,
    usage: meta.usage || prev?.usage || null,
    calls: (prev?.calls || 0) + 1,
  }
}

/**
 * @param {number} ms
 */
export function recordCooldownMs(ms) {
  const perf = getTracePerf()
  if (!perf) return
  perf.cooldownMs += Number(ms) || 0
}

/**
 * @param {object|null|undefined} stats
 * @param {number} durationMs
 * @param {object[]} [paperOutcomes]
 * @param {{ phase?: string, reuseMs?: number, acquisitionMs?: number }} [options]
 */
export function recordFullTextAcquisition(stats, durationMs, paperOutcomes = [], options = {}) {
  const perf = getTracePerf()
  if (!perf) return

  const outcomes = Array.isArray(paperOutcomes) ? paperOutcomes : []
  const grobidMs = outcomes.reduce(
    (sum, row) => sum + (Number(row.processingMs) || 0),
    0,
  )
  const queueWaitMs = outcomes.reduce(
    (sum, row) => sum + (Number(row.queueWaitMs) || 0),
    0,
  )
  const fetchMs = outcomes.reduce(
    (sum, row) => sum + (Number(row.fetchMs) || 0),
    0,
  )
  const reused = Number(stats?.papersReused ?? stats?.papersSkippedPriorFullText) || 0
  const acquired =
    Number(stats?.papersAcquired) ||
    outcomes.filter((row) => row.status === 'full_text' && !row.skippedAcquisition).length
  const requested = Number(stats?.papersRequested ?? stats?.papersGrobidSelected) || null
  const reuseMs = outcomes
    .filter((row) => row.skippedAcquisition)
    .reduce((sum, row) => sum + (Number(row.totalElapsedMs) || 0), 0)
  const acquisitionMs = Math.max(0, durationMs - reuseMs)

  perf.fullTextRuns.push({
    phase: options.phase || stats?.acquisitionPhase || null,
    durationMs: Math.round(durationMs),
    fullTextReuseMs: Math.round(options.reuseMs ?? reuseMs),
    fullTextAcquisitionMs: Math.round(options.acquisitionMs ?? acquisitionMs),
    grobidProcessingMs: Math.round(grobidMs),
    grobidQueueWaitMs: Math.round(queueWaitMs),
    pdfFetchMs: Math.round(fetchMs),
    papersRequested: requested,
    papersReused: reused,
    papersAcquired: acquired,
    papersFailed:
      Number(stats?.papersFailed) ||
      outcomes.filter(
        (row) => row.status === 'fallback' || row.status === 'grobid_failed',
      ).length,
    fullTextConcurrency: stats?.fullTextConcurrency ?? null,
    peakActiveAcquisitions: stats?.peakActiveAcquisitions ?? null,
    papersSkipped: reused,
    papersSelected: stats?.papersSelected ?? null,
    papersGrobidAttempted: stats?.papersGrobidAttempted ?? null,
    papersFullText: stats?.papersFullText ?? null,
    papersFallback: stats?.papersFallback ?? null,
    papersGrobidFailed: stats?.papersGrobidFailed ?? null,
    evidenceItemsExtracted: stats?.evidenceItemsExtracted ?? null,
    evidenceItemsSelected: stats?.evidenceItemsSelected ?? null,
    slowestPaperMs: outcomes.reduce(
      (max, row) => Math.max(max, Number(row.totalMs) || 0),
      0,
    ) || null,
  })
}

/**
 * @param {object} graphMeta
 */
export function recordGraphBuild(graphMeta) {
  const perf = getTracePerf()
  if (!perf) return
  perf.graph = graphMeta
}

/**
 * @param {object} perf
 * @param {object} [extras]
 * @returns {object}
 */
export function finalizeTracePerf(perf, extras = {}) {
  const totalMs = performance.now() - perf.startedAt
  const stages = {}
  for (const [key, value] of Object.entries(perf.stages || {})) {
    stages[key] = Math.round(Number(value) || 0)
  }

  const agents = {}
  for (const [key, value] of Object.entries(perf.agents || {})) {
    agents[key] = {
      durationMs: Math.round(Number(value.durationMs) || 0),
      model: value.model || null,
      provider: value.provider || null,
      calls: value.calls || 1,
      inputTokens: value.usage?.promptTokens ?? value.usage?.inputTokens ?? null,
      outputTokens:
        value.usage?.completionTokens ?? value.usage?.outputTokens ?? null,
    }
  }

  const fullTextAgg = (perf.fullTextRuns || []).reduce(
    (acc, row) => ({
      runs: acc.runs + 1,
      durationMs: acc.durationMs + (row.durationMs || 0),
      fullTextReuseMs: acc.fullTextReuseMs + (row.fullTextReuseMs || 0),
      fullTextAcquisitionMs: acc.fullTextAcquisitionMs + (row.fullTextAcquisitionMs || 0),
      grobidProcessingMs: acc.grobidProcessingMs + (row.grobidProcessingMs || 0),
      grobidQueueWaitMs: acc.grobidQueueWaitMs + (row.grobidQueueWaitMs || 0),
      pdfFetchMs: acc.pdfFetchMs + (row.pdfFetchMs || 0),
      papersRequested: acc.papersRequested + (row.papersRequested || 0),
      papersReused: acc.papersReused + (row.papersReused || 0),
      papersAcquired: acc.papersAcquired + (row.papersAcquired || 0),
      papersFailed: acc.papersFailed + (row.papersFailed || 0),
      papersGrobidAttempted:
        acc.papersGrobidAttempted + (row.papersGrobidAttempted || 0),
      papersFullText: acc.papersFullText + (row.papersFullText || 0),
      evidenceItemsExtracted:
        acc.evidenceItemsExtracted + (row.evidenceItemsExtracted || 0),
    }),
    {
      runs: 0,
      durationMs: 0,
      fullTextReuseMs: 0,
      fullTextAcquisitionMs: 0,
      grobidProcessingMs: 0,
      grobidQueueWaitMs: 0,
      pdfFetchMs: 0,
      papersRequested: 0,
      papersReused: 0,
      papersAcquired: 0,
      papersFailed: 0,
      papersGrobidAttempted: 0,
      papersFullText: 0,
      evidenceItemsExtracted: 0,
    },
  )

  const fullTextByPhase = { initial: null, refinement: null }
  for (const row of perf.fullTextRuns || []) {
    const phase = row.phase === 'refinement' ? 'refinement' : 'initial'
    const bucket = fullTextByPhase[phase] || {
      requested: 0,
      reused: 0,
      acquired: 0,
      failed: 0,
      concurrency: null,
      peakActiveAcquisitions: 0,
      durationMs: 0,
      fullTextReuseMs: 0,
      fullTextAcquisitionMs: 0,
      grobidProcessingMs: 0,
    }
    bucket.requested += row.papersRequested || 0
    bucket.reused += row.papersReused || 0
    bucket.acquired += row.papersAcquired || 0
    bucket.failed = (bucket.failed || 0) + (row.papersFailed || 0)
    bucket.concurrency = row.fullTextConcurrency ?? bucket.concurrency
    bucket.peakActiveAcquisitions = Math.max(
      bucket.peakActiveAcquisitions || 0,
      row.peakActiveAcquisitions || 0,
    )
    bucket.durationMs += row.durationMs || 0
    bucket.fullTextReuseMs += row.fullTextReuseMs || 0
    bucket.fullTextAcquisitionMs += row.fullTextAcquisitionMs || 0
    bucket.grobidProcessingMs += row.grobidProcessingMs || 0
    fullTextByPhase[phase] = bucket
  }

  return {
    runId: perf.runId,
    totalMs: Math.round(totalMs),
    stages,
    agents,
    fullText: {
      ...fullTextAgg,
      initial: fullTextByPhase.initial,
      refinement: fullTextByPhase.refinement,
    },
    fullTextRuns: perf.fullTextRuns || [],
    graph: perf.graph,
    cooldownMs: Math.round(perf.cooldownMs || 0),
    refinement: Boolean(perf.refinement),
    llm: extras.llmUsage
      ? {
          totalCalls: extras.llmUsage.totalCalls,
          successfulCalls: extras.llmUsage.successfulCalls,
          totalInputTokens: extras.llmUsage.totalInputTokens,
          totalOutputTokens: extras.llmUsage.totalOutputTokens,
          byAgent: extras.llmUsage.perAgent || extras.llmUsage.byAgent,
        }
      : null,
    ...extras.extra,
  }
}

/**
 * @param {object} summary
 */
export function logTracePerf(summary) {
  console.log(`TRACE_PERF ${JSON.stringify(summary)}`)
}

export default {
  createTracePerf,
  runWithTracePerf,
  getTracePerf,
  timeStage,
  recordAgentTiming,
  recordCooldownMs,
  recordFullTextAcquisition,
  recordGraphBuild,
  finalizeTracePerf,
  logTracePerf,
}
