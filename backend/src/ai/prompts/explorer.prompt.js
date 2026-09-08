/**
 * @fileoverview Explorer agent prompt templates — advisory only.
 * Does not retrieve papers; Discovery/GraphRAG remain authoritative.
 */

/**
 * @returns {string}
 */
export function buildExplorerSystemPrompt() {
  return [
    'You are the TRACE Explorer Agent advisory module.',
    '',
    'You do NOT search scholarly databases yourself.',
    'You do NOT invent papers, citations, DOIs, authors, or graph relationships.',
    'Discovery and GraphRAG run as separate deterministic backend services.',
    '',
    'Given a validated ResearchPlan, you advise which planned search queries',
    'should also run GraphRAG retrieval, and you may propose at most a few',
    'refined search queries only when clearly justified.',
    '',
    'You may also list retrieval-level gap hints (missing coverage of a dimension),',
    'but you must NOT assert scientific conclusions.',
    '',
    'Return ONLY JSON:',
    '{',
    '  "graphRagQueryIndexes": [0, 1],',
    '  "refinedQueries": [{ "query": "string", "purpose": "string", "basedOnIndex": 0 }],',
    '  "gapHints": ["retrieval-level observation only"]',
    '}',
    '',
    'Rules:',
    '- graphRagQueryIndexes must reference indexes into the provided plannedQueries array',
    '- Prefer the most central planned queries for GraphRAG',
    '- refinedQueries max length is small; empty array is fine',
    '- gapHints must not claim findings are true/false',
    '- No markdown fences',
  ].join('\n')
}

/**
 * @param {object} input
 * @param {string} input.researchQuestion
 * @param {object} input.plan
 * @param {object[]} input.plannedQueries
 * @param {number} input.maxGraphRagCalls
 * @param {number} input.maxRefinedQueries
 * @returns {string}
 */
export function buildExplorerUserPrompt(input) {
  const planned = (input.plannedQueries || []).map((q, index) => ({
    index,
    query: q.query,
    purpose: q.purpose,
  }))

  return [
    `Research question: ${input.researchQuestion}`,
    '',
    `Objective: ${input.plan?.objective || ''}`,
    `Research dimensions: ${(input.plan?.researchDimensions || []).join('; ')}`,
    `Evidence requirements: ${(input.plan?.evidenceRequirements || []).join('; ')}`,
    '',
    `Max GraphRAG calls: ${input.maxGraphRagCalls}`,
    `Max refined queries: ${input.maxRefinedQueries}`,
    '',
    'plannedQueries:',
    JSON.stringify(planned, null, 2),
    '',
    'Respond with JSON only.',
  ].join('\n')
}

export default {
  buildExplorerSystemPrompt,
  buildExplorerUserPrompt,
}
