function ResearchGapAnalysis({ gap }) {
  if (!gap) {
    return <p className="text-ink-muted">No research gaps reported.</p>
  }

  const items = Array.isArray(gap.items) ? gap.items : []

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
      {gap.title ? (
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          {gap.title}
        </p>
      ) : null}
      {gap.summary ? (
        <p className="mt-2 text-sm font-medium text-ink">{gap.summary}</p>
      ) : null}
      {gap.evidence ? (
        <p className="mt-2 text-xs text-ink-muted">{gap.evidence}</p>
      ) : null}
      {items.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-soft">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {!gap.summary && !items.length ? (
        <p className="text-sm text-ink-muted">No research gaps reported.</p>
      ) : null}
    </div>
  )
}

export default ResearchGapAnalysis
