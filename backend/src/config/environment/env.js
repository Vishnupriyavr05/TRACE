/**
 * @fileoverview Load and export process environment for the TRACE backend.
 */
import dotenv from 'dotenv'

dotenv.config()

export const PORT = Number(process.env.PORT) || 5000
export const NODE_ENV = process.env.NODE_ENV || 'development'
export const MONGODB_URI = process.env.MONGODB_URI || ''

/** JWT signing secret — must be set in production. */
export const JWT_SECRET = process.env.JWT_SECRET || ''

/** JWT lifetime (e.g. "7d", "24h"). */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

/** External research-source base URLs (connectors only — no hardcoded provider URLs). */
export const OPENALEX_BASE_URL = process.env.OPENALEX_BASE_URL || ''
export const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || ''
/** Recommended by OpenAlex for the polite pool (email). */
export const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO || ''
export const SEMANTIC_SCHOLAR_BASE_URL = process.env.SEMANTIC_SCHOLAR_BASE_URL || ''
export const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || ''
export const CROSSREF_BASE_URL = process.env.CROSSREF_BASE_URL || ''
export const CORE_BASE_URL = process.env.CORE_BASE_URL || ''

/** AI / LLM configuration (provider-agnostic). Never hardcode secrets. */
export const AI_PROVIDER = process.env.AI_PROVIDER || 'openai_compatible'
export const AI_MODEL = process.env.AI_MODEL || ''
export const AI_API_KEY = process.env.AI_API_KEY || ''
export const AI_BASE_URL = process.env.AI_BASE_URL || ''
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 60000
export const AI_MAX_RETRIES = Number(process.env.AI_MAX_RETRIES) || 2
/** Hard cap on provider HTTP attempts per TRACE orchestration run. */
export const TRACE_MAX_LLM_CALLS =
  Number(process.env.TRACE_MAX_LLM_CALLS) || 24
/** Controlled TRACE baseline profile: minimum | standard */
export const TRACE_PROFILE = process.env.TRACE_PROFILE || 'minimum'

/** Explorer bounding limits (Planner → Discovery / GraphRAG). */
export const EXPLORER_MAX_SEARCH_QUERIES =
  Number(process.env.EXPLORER_MAX_SEARCH_QUERIES) || 7
export const EXPLORER_MAX_RESULTS_PER_QUERY =
  Number(process.env.EXPLORER_MAX_RESULTS_PER_QUERY) || 10
export const EXPLORER_MAX_TOTAL_PAPERS =
  Number(process.env.EXPLORER_MAX_TOTAL_PAPERS) || 50
export const EXPLORER_MAX_GRAPHRAG_CALLS =
  Number(process.env.EXPLORER_MAX_GRAPHRAG_CALLS) || 7
export const EXPLORER_MAX_REFINED_QUERIES =
  Number(process.env.EXPLORER_MAX_REFINED_QUERIES) || 2

export const ANALYST_MAX_PAPERS =
  Number(process.env.ANALYST_MAX_PAPERS) || 15
export const ANALYST_MAX_ABSTRACT_CHARS =
  Number(process.env.ANALYST_MAX_ABSTRACT_CHARS) || 500
export const ANALYST_MAX_GRAPH_NODES =
  Number(process.env.ANALYST_MAX_GRAPH_NODES) || 40
export const ANALYST_MAX_GRAPH_EDGES =
  Number(process.env.ANALYST_MAX_GRAPH_EDGES) || 40
export const ANALYST_MAX_GRAPH_PATHS =
  Number(process.env.ANALYST_MAX_GRAPH_PATHS) || 20

export const CRITIC_MAX_FINDINGS =
  Number(process.env.CRITIC_MAX_FINDINGS) || 10
export const CRITIC_MAX_PAPERS =
  Number(process.env.CRITIC_MAX_PAPERS) || 8
export const CRITIC_MAX_ABSTRACT_CHARS =
  Number(process.env.CRITIC_MAX_ABSTRACT_CHARS) || 220
export const CRITIC_MAX_GRAPH_NODES =
  Number(process.env.CRITIC_MAX_GRAPH_NODES) || 10
export const CRITIC_MAX_GRAPH_EDGES =
  Number(process.env.CRITIC_MAX_GRAPH_EDGES) || 10
export const CRITIC_MAX_GRAPH_PATHS =
  Number(process.env.CRITIC_MAX_GRAPH_PATHS) || 5

export const SYNTHESIZER_MAX_FINDINGS =
  Number(process.env.SYNTHESIZER_MAX_FINDINGS) || 10
export const SYNTHESIZER_MAX_PAPERS =
  Number(process.env.SYNTHESIZER_MAX_PAPERS) || 8
export const SYNTHESIZER_MAX_ABSTRACT_CHARS =
  Number(process.env.SYNTHESIZER_MAX_ABSTRACT_CHARS) || 220
export const SYNTHESIZER_MAX_CONTRADICTIONS =
  Number(process.env.SYNTHESIZER_MAX_CONTRADICTIONS) || 8
export const SYNTHESIZER_MAX_GAPS =
  Number(process.env.SYNTHESIZER_MAX_GAPS) || 8
export const SYNTHESIZER_MAX_COVERAGE =
  Number(process.env.SYNTHESIZER_MAX_COVERAGE) || 8

/** GROBID full-text extraction service (deterministic, no LLM). */
export const GROBID_BASE_URL = process.env.GROBID_BASE_URL || ''
export const GROBID_TIMEOUT_MS = Number(process.env.GROBID_TIMEOUT_MS) || 120_000
export const FULL_TEXT_MAX_PAPERS =
  Number(process.env.FULL_TEXT_MAX_PAPERS) || ANALYST_MAX_PAPERS
export const FULL_TEXT_MAX_EVIDENCE_PER_PAPER =
  Number(process.env.FULL_TEXT_MAX_EVIDENCE_PER_PAPER) || 12

/** Optional email for Unpaywall OA discovery (https://unpaywall.org/products/api). */
export const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL || ''

/** HTTP timeout for full-text binary fetch (large repository PDFs). */
export const FULL_TEXT_FETCH_TIMEOUT_MS =
  Number(process.env.FULL_TEXT_FETCH_TIMEOUT_MS) || 120_000

if (!JWT_SECRET) {
  console.warn(
    '[TRACE] JWT_SECRET is not set. Authentication tokens cannot be signed securely.'
  )
}
