import Icon from '../Icon/Icon'

function RecentSearches({ searches, onSelect }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Recent Searches
      </h3>
      <ul className="space-y-2">
        {searches.map((query) => (
          <li key={query}>
            <button
              type="button"
              onClick={() => onSelect(query)}
              className="flex w-full items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-sm hover:border-accent/35 hover:bg-panel/70 dark:bg-panel dark:hover:border-accent/40 dark:hover:bg-slate-800/80"
            >
              <Icon name="history" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
              <span className="text-sm leading-snug text-ink-soft">{query}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default RecentSearches
