/**
 * @fileoverview Planner structured-output schema validation.
 * Lightweight validators consistent with TRACE backend (no extra deps).
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function asNonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Normalize and validate Planner output into the ResearchPlan contract.
 *
 * @param {unknown} raw
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validatePlannerOutput(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Planner output must be a JSON object'] }
  }

  const objective =
    asNonEmptyString(raw.objective) ||
    asNonEmptyString(raw.researchObjective)

  if (!objective) {
    errors.push('objective is required')
  } else if (objective.length < 10) {
    errors.push('objective must be at least 10 characters')
  }

  const subQuestionsRaw = Array.isArray(raw.subQuestions)
    ? raw.subQuestions
    : []
  if (subQuestionsRaw.length < 1) {
    errors.push('subQuestions must contain at least one item')
  }

  const subQuestions = subQuestionsRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`subQuestions[${index}] must be an object`)
      return null
    }
    const id =
      asNonEmptyString(item.id) || `SQ${index + 1}`
    const question =
      asNonEmptyString(item.question) || asNonEmptyString(item.text)
    if (!question) {
      errors.push(`subQuestions[${index}].question is required`)
      return null
    }
    return { id, question }
  }).filter(Boolean)

  const searchQueriesRaw = Array.isArray(raw.searchQueries)
    ? raw.searchQueries
    : []
  if (searchQueriesRaw.length < 1) {
    errors.push('searchQueries must contain at least one item')
  }

  const searchQueries = searchQueriesRaw.map((item, index) => {
    if (typeof item === 'string') {
      const query = item.trim()
      if (!query) {
        errors.push(`searchQueries[${index}] is empty`)
        return null
      }
      return { query, purpose: 'literature_search' }
    }
    if (!item || typeof item !== 'object') {
      errors.push(`searchQueries[${index}] must be an object or string`)
      return null
    }
    const query = asNonEmptyString(item.query)
    if (!query) {
      errors.push(`searchQueries[${index}].query is required`)
      return null
    }
    return {
      query,
      purpose: asNonEmptyString(item.purpose) || 'literature_search',
      recallProfile: normalizeRecallProfile(item.recallProfile),
    }
  }).filter(Boolean)

  const researchDimensions = normalizeStringList(
    raw.researchDimensions,
    'researchDimensions',
    errors,
    { min: 1 }
  )

  const evidenceRequirements = normalizeEvidenceRequirements(
    raw.evidenceRequirements,
    errors
  )

  const stoppingCriteria = normalizeStoppingCriteria(
    raw.stoppingCriteria,
    errors
  )

  const researchStrategy = normalizeResearchStrategy(raw.researchStrategy, errors)
  const priorityTargets = normalizePriorityTargets(raw.priorityTargets, errors)

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      objective,
      researchStrategy,
      subQuestions,
      searchQueries,
      priorityTargets,
      researchDimensions,
      evidenceRequirements,
      stoppingCriteria,
    },
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {string[]} errors
 * @param {{ min?: number }} [opts]
 * @returns {string[]}
 */
function normalizeStringList(value, field, errors, opts = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`)
    return []
  }
  const list = value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        return asNonEmptyString(item.label) || asNonEmptyString(item.text)
      }
      return ''
    })
    .filter(Boolean)

  if (opts.min && list.length < opts.min) {
    errors.push(`${field} must contain at least ${opts.min} item(s)`)
  }
  return list
}

/**
 * @param {unknown} value
 * @param {string[]} errors
 * @returns {string[]}
 */
function normalizeEvidenceRequirements(value, errors) {
  if (!Array.isArray(value) || value.length < 1) {
    errors.push('evidenceRequirements must contain at least one item')
    return []
  }
  return value
    .map((item, index) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        return (
          asNonEmptyString(item.description) ||
          asNonEmptyString(item.text) ||
          asNonEmptyString(item.requirement)
        )
      }
      errors.push(`evidenceRequirements[${index}] is invalid`)
      return ''
    })
    .filter(Boolean)
}

/**
 * @param {unknown} value
 * @param {string[]} errors
 * @returns {string[]}
 */
function normalizeStoppingCriteria(value, errors) {
  if (Array.isArray(value)) {
    const list = value
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object') {
          return (
            asNonEmptyString(item.text) ||
            asNonEmptyString(item.criterion) ||
            asNonEmptyString(item.notes)
          )
        }
        return ''
      })
      .filter(Boolean)
    if (!list.length) {
      errors.push('stoppingCriteria must contain at least one item')
    }
    return list
  }

  if (value && typeof value === 'object') {
    const notes = asNonEmptyString(value.notes)
    const parts = []
    if (typeof value.minPapers === 'number') {
      parts.push(`Collect at least ${value.minPapers} relevant papers`)
    }
    if (typeof value.maxDiscoveryCalls === 'number') {
      parts.push(`Limit discovery calls to ${value.maxDiscoveryCalls}`)
    }
    if (notes) parts.push(notes)
    if (!parts.length) {
      errors.push('stoppingCriteria must contain at least one criterion')
    }
    return parts
  }

  errors.push('stoppingCriteria must be an array or object')
  return []
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRecallProfile(value) {
  const profile = String(value || 'focused').trim().toLowerCase()
  if (profile === 'broad' || profile === 'high_recall' || profile === 'high-recall') {
    return profile.replace('-', '_')
  }
  return 'focused'
}

/**
 * @param {unknown} value
 * @param {string[]} errors
 * @returns {object}
 */
function normalizeResearchStrategy(value, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      intentSummary: '',
      discoveryApproach: '',
      answerSufficiency: '',
    }
  }
  return {
    intentSummary: asNonEmptyString(value.intentSummary),
    discoveryApproach: asNonEmptyString(value.discoveryApproach),
    answerSufficiency: asNonEmptyString(value.answerSufficiency),
  }
}

/**
 * @param {unknown} value
 * @param {string[]} errors
 * @returns {object[]}
 */
function normalizePriorityTargets(value, errors) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        errors.push(`priorityTargets[${index}] must be an object`)
        return null
      }
      const type = asNonEmptyString(item.type).toLowerCase()
      const targetValue = asNonEmptyString(item.value)
      if (!targetValue) {
        errors.push(`priorityTargets[${index}].value is required`)
        return null
      }
      const allowed = ['doi', 'title', 'author', 'topic']
      const normalizedType = allowed.includes(type) ? type : 'topic'
      return {
        type: normalizedType,
        value: targetValue,
        reason: asNonEmptyString(item.reason) || '',
      }
    })
    .filter(Boolean)
}

/**
 * Validate Planner HTTP/service input.
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validatePlannerInput(input = {}) {
  const errors = []
  const sessionId =
    typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  const query = typeof input.query === 'string' ? input.query.trim() : ''

  if (!sessionId) errors.push('sessionId is required')
  if (!query) errors.push('query is required')
  else if (query.length < 3) errors.push('query must be at least 3 characters')
  else if (query.length > 2000) {
    errors.push('query must be at most 2000 characters')
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      sessionId,
      query,
      sessionContext:
        input.sessionContext && typeof input.sessionContext === 'object'
          ? {
              domain: input.sessionContext.domain || '',
              selectedSources: Array.isArray(
                input.sessionContext.selectedSources
              )
                ? input.sessionContext.selectedSources
                : [],
            }
          : undefined,
    },
  }
}

export default {
  validatePlannerOutput,
  validatePlannerInput,
}
