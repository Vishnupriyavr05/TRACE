import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon/Icon'
import PanelScroll from '../PanelScroll/PanelScroll'

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function getSectionLabel(updatedAt, now = new Date()) {
  const day = startOfDay(updatedAt).getTime()
  const today = startOfDay(now).getTime()
  const diffDays = Math.round((today - day) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7) return 'Last Week'
  return 'Older'
}

function formatModified(date) {
  return `${date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

const SECTION_ORDER = ['Today', 'Yesterday', 'Last Week', 'Older']

const STATUS_STYLES = {
  draft: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300',
  running: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-300',
  completed:
    'border-green-300 bg-green-50 text-green-700 dark:border-green-500/40 dark:bg-green-950/50 dark:text-green-300',
  failed:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-300',
}

const MENU_ACTIONS = [
  { id: 'rename', label: 'Rename', icon: 'file' },
  { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
  { id: 'pin', label: 'Pin', icon: 'pin' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
  { id: 'delete', label: 'Delete', icon: 'trash' },
]

function StatusBadge({ status }) {
  const label = status
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : 'Draft'
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-[0.04em] border ${style}`}
    >
      {label}
    </span>
  )
}

function SessionCard({
  session,
  menuOpen,
  onToggleMenu,
  onSelect,
  onAction,
  disabled,
}) {
  const modified = new Date(session.updatedAt || session.createdAt)
  const title = session.title || session.name || session.query

  return (
    <li className="relative">
      <div
        className={`group flex items-start gap-1 rounded-xl border border-border bg-panel/40 transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md dark:hover:shadow-black/30 ${
          disabled ? 'pointer-events-none opacity-60' : 'cursor-pointer'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect(session)}
          disabled={disabled}
          className="min-w-0 flex-1 cursor-pointer px-3 py-2.5 text-left"
        >
          <div className="flex items-start gap-2">
            {session.pinned && (
              <Icon name="pin" className="mt-1 h-3 w-3 shrink-0 text-accent" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate text-sm font-semibold leading-5 text-ink">
                  {title}
                </p>
                <StatusBadge status={session.status} />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {formatModified(modified)}
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          aria-label="Session actions"
          aria-expanded={menuOpen}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onToggleMenu(session.id)
          }}
          className="mr-1.5 mt-2 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted hover:bg-card hover:text-ink dark:hover:bg-panel"
        >
          <Icon name="more" className="h-4 w-4" />
        </button>
      </div>

      {menuOpen && (
        <div className="absolute right-2 top-10 z-20 w-40 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg dark:bg-panel">
          {MENU_ACTIONS.map((action) => {
            let label = action.label
            if (action.id === 'pin') {
              label = session.pinned ? 'Unpin' : 'Pin'
            }
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => onAction(session, action.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                  action.id === 'delete'
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40'
                    : 'text-ink-soft hover:bg-panel hover:text-ink'
                }`}
              >
                <Icon name={action.icon} className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </div>
      )}
    </li>
  )
}

function ResearchSessions({
  open,
  onClose,
  sessions,
  loading = false,
  error = '',
  onRetry,
  onSelectSession,
  onRenameSession,
  onDuplicateSession,
  onPinSession,
  onArchiveSession,
  onDeleteSession,
}) {
  const [menuId, setMenuId] = useState(null)
  const [renameId, setRenameId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [search, setSearch] = useState('')
  const [restoring, setRestoring] = useState(false)
  const restoreTimerRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setMenuId(null)
      setRenameId(null)
      setConfirmDeleteId(null)
      setSearch('')
      setRestoring(false)
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current)
        restoreTimerRef.current = null
      }
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined

    const onKey = (event) => {
      if (event.key === 'Escape' && !restoring) onClose()
    }
    const onPointer = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setMenuId(null)
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [open, onClose, restoring])

  const visibleSessions = useMemo(() => {
    const active = sessions.filter((session) => !session.archived)
    const term = search.trim().toLowerCase()
    if (!term) return active

    return active.filter((session) => {
      const title = (session.title || session.name || '').toLowerCase()
      const query = (session.query || '').toLowerCase()
      return title.includes(term) || query.includes(term)
    })
  }, [sessions, search])

  const grouped = useMemo(() => {
    const pinned = visibleSessions.filter((session) => session.pinned)
    const unpinned = visibleSessions.filter((session) => !session.pinned)
    const groups = {}

    unpinned.forEach((session) => {
      const label = getSectionLabel(
        new Date(session.updatedAt || session.createdAt),
      )
      if (!groups[label]) groups[label] = []
      groups[label].push(session)
    })

    return { pinned, groups }
  }, [visibleSessions])

  const handleSelectSession = (session) => {
    if (restoring) return
    setMenuId(null)
    setRestoring(true)
    restoreTimerRef.current = setTimeout(() => {
      onSelectSession(session)
      setRestoring(false)
      restoreTimerRef.current = null
    }, 300)
  }

  const handleAction = (session, actionId) => {
    if (restoring) return
    setMenuId(null)

    if (actionId === 'rename') {
      setRenameId(session.id)
      setRenameValue(session.title || session.name || session.query)
      return
    }
    if (actionId === 'duplicate') {
      onDuplicateSession(session)
      return
    }
    if (actionId === 'pin') {
      onPinSession(session.id)
      return
    }
    if (actionId === 'archive') {
      onArchiveSession(session.id)
      return
    }
    if (actionId === 'delete') {
      setConfirmDeleteId(session.id)
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-[60] bg-ink/20 transition-opacity duration-300 dark:bg-black/45 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={restoring ? undefined : onClose}
        aria-hidden="true"
      />

      <aside
        ref={panelRef}
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-out dark:bg-panel ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink">
              Research Sessions
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Resume a previous research workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            aria-label="Close research sessions"
            className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-4 py-3">
          <label className="relative block">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={restoring}
              placeholder="Search sessions..."
              className="w-full rounded-xl border border-border bg-panel/50 py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent disabled:opacity-60"
            />
          </label>
        </div>

        <PanelScroll className="relative min-h-0 flex-1 px-4 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-panel/40 px-4 py-10 text-center">
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-ink">Loading sessions…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center dark:border-red-900/50 dark:bg-red-950/30">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                {error}
              </p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-panel/40 px-4 py-8 text-center">
              <p className="text-sm font-medium text-ink">
                {search.trim()
                  ? 'No sessions match your search.'
                  : 'No research sessions yet.'}
              </p>
              {!search.trim() && (
                <p className="mt-1.5 text-xs text-ink-muted">
                  Start your first TRACE research.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.pinned.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Pinned
                  </h3>
                  <ul className="space-y-2">
                    {grouped.pinned.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        menuOpen={menuId === session.id}
                        disabled={restoring}
                        onToggleMenu={(id) =>
                          setMenuId((current) => (current === id ? null : id))
                        }
                        onSelect={handleSelectSession}
                        onAction={handleAction}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {SECTION_ORDER.map((label) => {
                const items = grouped.groups[label]
                if (!items?.length) return null
                return (
                  <section key={label}>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                      {label}
                    </h3>
                    <ul className="space-y-2">
                      {items.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          menuOpen={menuId === session.id}
                          disabled={restoring}
                          onToggleMenu={(id) =>
                            setMenuId((current) => (current === id ? null : id))
                          }
                          onSelect={handleSelectSession}
                          onAction={handleAction}
                        />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}

          {restoring && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-card/80 backdrop-blur-[2px] dark:bg-panel/85"
              role="status"
              aria-live="polite"
            >
              <p className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-ink shadow-sm dark:bg-panel">
                Restoring workspace...
              </p>
            </div>
          )}
        </PanelScroll>

        {renameId && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/25 px-6 dark:bg-black/50">
            <form
              className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl dark:bg-panel"
              onSubmit={(event) => {
                event.preventDefault()
                onRenameSession(renameId, renameValue.trim())
                setRenameId(null)
              }}
            >
              <h3 className="text-sm font-semibold text-ink">Rename Session</h3>
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                className="mt-3 w-full rounded-lg border border-border bg-panel/50 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="e.g. GraphRAG Literature Review"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameId(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-soft"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        )}

        {confirmDeleteId && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/25 px-6 dark:bg-black/50">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl dark:bg-panel">
              <h3 className="text-sm font-semibold text-ink">Delete Session?</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                This removes the session from Research Sessions only. It does
                not delete papers permanently.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-soft"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteSession(confirmDeleteId)
                    setConfirmDeleteId(null)
                  }}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

export default ResearchSessions
