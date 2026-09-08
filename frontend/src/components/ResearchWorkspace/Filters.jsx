import { PUBLICATION_TYPES, RESEARCH_DOMAINS } from '../../utils/constants'

function Filters({ filters, onChange }) {
  const update = (key, value) => {
    onChange({ ...filters, [key]: value })
  }

  const fieldClass =
    'rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent/50 dark:bg-panel dark:focus:border-accent/40'

  return (
    <section>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Filters
      </h3>
      <div className="space-y-5">
        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">Publication Year</span>
          <div className="grid grid-cols-2 gap-2.5">
            <input
              type="number"
              min="1900"
              max="2099"
              placeholder="From"
              value={filters.yearFrom}
              onChange={(event) => update('yearFrom', event.target.value)}
              className={fieldClass}
            />
            <input
              type="number"
              min="1900"
              max="2099"
              placeholder="To"
              value={filters.yearTo}
              onChange={(event) => update('yearTo', event.target.value)}
              className={fieldClass}
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">Research Domain</span>
          <select
            value={filters.domain}
            onChange={(event) => update('domain', event.target.value)}
            className={`w-full ${fieldClass}`}
          >
            <option value="">All domains</option>
            {RESEARCH_DOMAINS.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">Publication Type</span>
          <select
            value={filters.publicationType}
            onChange={(event) => update('publicationType', event.target.value)}
            className={`w-full ${fieldClass}`}
          >
            <option value="">All types</option>
            {PUBLICATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">Minimum Citation Count</span>
          <input
            type="number"
            min="0"
            value={filters.minCitations}
            onChange={(event) => update('minCitations', event.target.value)}
            className={`w-full ${fieldClass}`}
          />
        </label>

        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-3 dark:bg-panel">
          <span className="text-sm font-medium text-ink-soft">Open Access</span>
          <input
            type="checkbox"
            checked={filters.openAccess}
            onChange={(event) => update('openAccess', event.target.checked)}
            className="h-4 w-4 accent-accent"
          />
        </label>
      </div>
    </section>
  )
}

export default Filters
