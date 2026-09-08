function formatTriState(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return 'Unknown'
}

function IntegrityReview({ indicators, papers }) {
  return (
    <div className="space-y-3">
      {papers.map((paper) => (
        <article key={paper.id} className="rounded-xl border border-border p-3">
          <h4 className="truncate text-xs font-semibold text-ink" title={paper.title}>
            {paper.title}
          </h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            {indicators.map((indicator) => (
              <div
                key={indicator.label}
                className="flex items-center justify-between gap-2 rounded-lg bg-panel/55 px-2 py-1.5"
              >
                <dt className="text-[11px] text-ink-muted">{indicator.label}</dt>
                <dd className="text-[11px] font-semibold text-ink">
                  {indicator.label === 'DOI'
                    ? paper.doi
                      ? 'Available'
                      : 'Unavailable'
                    : indicator.label === 'Peer reviewed'
                      ? formatTriState(
                          paper.integrity?.peerReviewed ?? paper.peerReviewed,
                        )
                      : indicator.label === 'Open access'
                        ? formatTriState(
                            paper.integrity?.openAccess ?? paper.openAccess,
                          )
                        : indicator.value}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  )
}

export default IntegrityReview
