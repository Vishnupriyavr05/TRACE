import { AGENTS } from '../../utils/constants'

function formatActivityTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Session activity timeline (and reserved agent-trace shell).
 * Shows chronological research activity when activities are provided.
 */
function AgentTrace({
  traces = {},
  activities = [],
  loading = false,
  hidden = true,
}) {
  if (hidden) return null

  const hasActivities = activities.length > 0

  return (
    <section
      aria-label="Activity timeline"
      className="border-b border-border bg-card/80 px-3 py-2 sm:px-4"
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Activity timeline
          </h2>
          {loading ? (
            <span className="text-[11px] text-ink-muted">Loading…</span>
          ) : null}
        </div>

        {hasActivities ? (
          <ol className="flex max-h-20 gap-2 overflow-x-auto pb-0.5">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="min-w-[12rem] shrink-0 rounded-lg border border-border bg-panel/50 px-2.5 py-1.5"
              >
                <p className="truncate text-[11px] font-semibold text-ink">
                  {activity.description || activity.type}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-muted">
                  {formatActivityTime(activity.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-ink-muted">
            {loading
              ? 'Restoring activity history…'
              : 'Session activity will appear here as you research.'}
          </p>
        )}

        {/* Reserved agent-trace surface for future multi-agent events */}
        <div className="hidden" aria-hidden="true">
          {AGENTS.map((agent) => (
            <article key={agent.id}>
              <h3>{agent.label}</h3>
              <p>{traces[agent.id]?.searched}</p>
              <p>{traces[agent.id]?.selected}</p>
              <p>{traces[agent.id]?.rejected}</p>
              <p>{traces[agent.id]?.reasoning}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default AgentTrace
