/**
 * @fileoverview AI layer public surface.
 *
 * Boundary: LLM adapters, agent contracts, prompts, structured validators.
 * Knowledge graph topology lives under backend/src/knowledgeGraph — not here.
 * Deterministic GraphRAG retrieval lives under backend/src/graphRag — not here.
 */

export * as llm from './llm/llm.service.js'
export * as llmClient from './core/llmClient.js'
export * as agentRunner from './core/agentRunner.js'
export * as providers from './providers/index.js'
export * as plannerAgent from './agents/planner.agent.js'
export * as plannerService from './agents/planner.service.js'
export * as plannerSchema from './validators/planner.schema.js'
export * as explorerAgent from './agents/explorer.agent.js'
export * as explorerService from './agents/explorer.service.js'
export * as explorerSchema from './validators/explorer.schema.js'
export * as evidenceAnalystAgent from './agents/evidenceAnalyst.agent.js'
export * as evidenceAnalystService from './agents/evidenceAnalyst.service.js'
export * as evidenceAnalystSchema from './validators/evidenceAnalyst.schema.js'
export * as criticAgent from './agents/critic.agent.js'
export * as criticService from './agents/critic.service.js'
export * as criticSchema from './validators/critic.schema.js'
export * as synthesizerAgent from './agents/synthesizer.agent.js'
export * as synthesizerService from './agents/synthesizer.service.js'
export * as synthesizerSchema from './validators/synthesizer.schema.js'
export * as researchOrchestrator from './orchestrator/index.js'
export * as llmAccounting from './core/llmAccounting.js'
export * as traceQuality from './quality/traceQualityMetrics.js'
export * as contextBudget from './core/contextBudget.js'
export * as traceProfile from './core/traceProfile.js'
export * as qualityGate from './quality/qualityGate.js'

export * as embeddings from './llm/embeddings.service.js'
export * as retriever from './rag/retriever.service.js'
export * as reranker from './rag/reranker.service.js'
export * as contradiction from './explainability/contradiction.service.js'
export * as confidence from './explainability/confidence.service.js'
export * as researchGap from './explainability/researchGap.service.js'
export * as reasoning from './reasoning/reasoning.service.js'

export * as plannerPrompt from './prompts/planner.prompt.js'
export * as explorerPrompt from './prompts/explorer.prompt.js'
export * as evidenceAnalystPrompt from './prompts/evidenceAnalyst.prompt.js'
export * as connectorPrompt from './prompts/connector.prompt.js'
export * as criticPrompt from './prompts/critic.prompt.js'
export * as synthesizerPrompt from './prompts/synthesizer.prompt.js'
