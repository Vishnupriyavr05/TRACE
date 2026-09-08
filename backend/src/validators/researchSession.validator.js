/**
 * @fileoverview Research session validators — create, update, list query.
 */

import { SESSION_STATUSES } from '../models/researchSession.model.js'

const SORT_BY = new Set(['relevant', 'cited', 'newest'])
const GRAPH_MODES = new Set(['concept', 'citation'])

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * @param {object} [raw]
 * @returns {object}
 */
function normalizeFilters(raw = {}) {
  const filters = {
    yearFrom: raw.yearFrom ?? '',
    yearTo: raw.yearTo ?? '',
    publicationType:
      typeof raw.publicationType === 'string' ? raw.publicationType.trim() : '',
    minCitations: raw.minCitations ?? '',
    openAccess: Boolean(raw.openAccess),
    sortBy:
      typeof raw.sortBy === 'string' && SORT_BY.has(raw.sortBy)
        ? raw.sortBy
        : 'relevant',
  }
  return filters
}

/**
 * @param {unknown} files
 * @param {string[]} errors
 * @returns {object[]}
 */
function normalizeUploadedFiles(files, errors) {
  if (files === undefined) return []
  if (!Array.isArray(files)) {
    errors.push('uploadedFiles must be an array of metadata objects')
    return []
  }

  return files
    .map((file, index) => {
      if (!file || typeof file !== 'object') {
        errors.push(`uploadedFiles[${index}] must be an object`)
        return null
      }
      const name = typeof file.name === 'string' ? file.name.trim() : ''
      if (!name) {
        errors.push(`uploadedFiles[${index}].name is required`)
        return null
      }
      return {
        name,
        size: typeof file.size === 'number' ? file.size : null,
        mimeType:
          typeof file.mimeType === 'string' ? file.mimeType.trim() : null,
        storageKey:
          typeof file.storageKey === 'string' ? file.storageKey.trim() : null,
      }
    })
    .filter(Boolean)
}

/**
 * @param {unknown} raw
 * @param {string[]} errors
 * @returns {object|undefined}
 */
function normalizeWorkspaceState(raw, errors) {
  if (raw === undefined) return undefined
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('workspaceState must be an object')
    return undefined
  }

  const state = {}

  if (raw.graphMode !== undefined) {
    if (!GRAPH_MODES.has(raw.graphMode)) {
      errors.push('workspaceState.graphMode must be concept or citation')
    } else {
      state.graphMode = raw.graphMode
    }
  }

  if (raw.selectedPaperId !== undefined) {
    state.selectedPaperId = raw.selectedPaperId
  }
  if (raw.selectedConceptId !== undefined) {
    state.selectedConceptId =
      raw.selectedConceptId === null
        ? null
        : String(raw.selectedConceptId).trim()
  }
  if (raw.expandedAccordion !== undefined) {
    state.expandedAccordion =
      raw.expandedAccordion === null
        ? null
        : String(raw.expandedAccordion).trim()
  }
  if (raw.activePanel !== undefined) {
    state.activePanel =
      raw.activePanel === null ? null : String(raw.activePanel).trim()
  }

  return state
}

/**
 * Validate create-session body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateCreateSession(body = {}) {
  const errors = []

  const researchQuery =
    typeof body.researchQuery === 'string' ? body.researchQuery.trim() : ''
  let sessionTitle =
    typeof body.sessionTitle === 'string' ? body.sessionTitle.trim() : ''

  if (!researchQuery) {
    errors.push('researchQuery is required')
  } else if (researchQuery.length < 3) {
    errors.push('researchQuery must be at least 3 characters')
  } else if (researchQuery.length > 2000) {
    errors.push('researchQuery must be at most 2000 characters')
  }

  if (!sessionTitle && researchQuery) {
    sessionTitle = researchQuery.slice(0, 200)
  }

  if (!sessionTitle) {
    errors.push('sessionTitle is required')
  } else if (sessionTitle.length > 200) {
    errors.push('sessionTitle must be at most 200 characters')
  }

  let status = 'ACTIVE'
  if (body.status !== undefined) {
    if (!SESSION_STATUSES.includes(body.status)) {
      errors.push('status must be ACTIVE, COMPLETED, or ARCHIVED')
    } else {
      status = body.status
    }
  }

  const uploadedFiles = normalizeUploadedFiles(body.uploadedFiles, errors)
  const workspaceState = normalizeWorkspaceState(body.workspaceState, errors)

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      sessionTitle,
      researchQuery,
      domain: typeof body.domain === 'string' ? body.domain.trim() : '',
      paperTypes: asStringArray(body.paperTypes),
      filters: normalizeFilters(body.filters),
      selectedSources: asStringArray(body.selectedSources),
      uploadedFiles,
      workspaceState: workspaceState ?? {},
      status,
      isPinned: Boolean(body.isPinned),
      isArchived: Boolean(body.isArchived),
    },
  }
}

/**
 * Validate partial update body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateUpdateSession(body = {}) {
  const errors = []
  const value = {}

  if (body.sessionTitle !== undefined) {
    const sessionTitle =
      typeof body.sessionTitle === 'string' ? body.sessionTitle.trim() : ''
    if (!sessionTitle) {
      errors.push('sessionTitle cannot be empty')
    } else if (sessionTitle.length > 200) {
      errors.push('sessionTitle must be at most 200 characters')
    } else {
      value.sessionTitle = sessionTitle
    }
  }

  if (body.researchQuery !== undefined) {
    const researchQuery =
      typeof body.researchQuery === 'string' ? body.researchQuery.trim() : ''
    if (researchQuery.length < 3) {
      errors.push('researchQuery must be at least 3 characters')
    } else if (researchQuery.length > 2000) {
      errors.push('researchQuery must be at most 2000 characters')
    } else {
      value.researchQuery = researchQuery
    }
  }

  if (body.domain !== undefined) {
    value.domain = typeof body.domain === 'string' ? body.domain.trim() : ''
  }

  if (body.paperTypes !== undefined) {
    value.paperTypes = asStringArray(body.paperTypes)
  }

  if (body.filters !== undefined) {
    if (!body.filters || typeof body.filters !== 'object') {
      errors.push('filters must be an object')
    } else {
      value.filters = normalizeFilters(body.filters)
    }
  }

  if (body.selectedSources !== undefined) {
    value.selectedSources = asStringArray(body.selectedSources)
  }

  if (body.uploadedFiles !== undefined) {
    value.uploadedFiles = normalizeUploadedFiles(body.uploadedFiles, errors)
  }

  if (body.workspaceState !== undefined) {
    const workspaceState = normalizeWorkspaceState(body.workspaceState, errors)
    if (workspaceState) {
      value.workspaceState = workspaceState
    }
  }

  if (body.status !== undefined) {
    if (!SESSION_STATUSES.includes(body.status)) {
      errors.push('status must be ACTIVE, COMPLETED, or ARCHIVED')
    } else {
      value.status = body.status
    }
  }

  if (body.isPinned !== undefined) {
    value.isPinned = Boolean(body.isPinned)
  }

  if (Object.keys(value).length === 0 && errors.length === 0) {
    errors.push('At least one field is required to update')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, value }
}

/**
 * Validate list/search query parameters.
 *
 * @param {object} query
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateListSessionsQuery(query = {}) {
  const errors = []

  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
  const limitRaw = Number.parseInt(String(query.limit ?? '20'), 10) || 20
  const limit = Math.min(100, Math.max(1, limitRaw))

  let status
  if (query.status !== undefined && query.status !== '') {
    const normalized = String(query.status).toUpperCase()
    if (!SESSION_STATUSES.includes(normalized)) {
      errors.push('status must be ACTIVE, COMPLETED, or ARCHIVED')
    } else {
      status = normalized
    }
  }

  let pinned
  if (query.pinned !== undefined && query.pinned !== '') {
    if (query.pinned === 'true' || query.pinned === true) pinned = true
    else if (query.pinned === 'false' || query.pinned === false) pinned = false
    else errors.push('pinned must be true or false')
  }

  const search =
    typeof query.search === 'string' && query.search.trim()
      ? query.search.trim()
      : undefined

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: { search, status, pinned, page, limit },
  }
}

/**
 * Validate pin body (optional explicit boolean; defaults to toggle handled in service).
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validatePinSession(body = {}) {
  if (body.isPinned === undefined) {
    return { ok: true, value: { toggle: true } }
  }
  if (typeof body.isPinned !== 'boolean') {
    return { ok: false, errors: ['isPinned must be a boolean'] }
  }
  return { ok: true, value: { isPinned: body.isPinned, toggle: false } }
}
