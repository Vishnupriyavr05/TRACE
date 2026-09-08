import { SORT_OPTIONS } from '../../utils/constants'

function SortBy({ value, onChange }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Sort By
      </h3>
      <div className="space-y-2">
        {SORT_OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
              value === option.id
                ? 'border-accent/40 bg-accent/5 text-accent'
                : 'border-border bg-card text-ink-soft hover:border-accent/30'
            }`}
          >
            <input
              type="radio"
              name="sort-by"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="accent-accent"
            />
            {option.label}
          </label>
        ))}
      </div>
    </section>
  )
}

export default SortBy
