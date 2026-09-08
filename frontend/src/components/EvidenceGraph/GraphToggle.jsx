function GraphToggle({ mode, onChange, citationAvailable = false }) {
  return (
    <div
      role="tablist"
      aria-label="Graph mode"
      className="inline-flex rounded-xl border border-border bg-panel p-1"
    >
      {[
        { id: 'concept', label: 'Concept Graph' },
        { id: 'citation', label: 'Citation Explorer' },
      ].map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={mode === option.id}
          disabled={option.id === 'citation' && !citationAvailable}
          onClick={() => onChange(option.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
            mode === option.id
              ? 'bg-card text-accent shadow-sm'
              : 'text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default GraphToggle
