import Icon from '../Icon/Icon'

const actionClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-accent dark:bg-panel'

function PaperActionsToolbar({
  paper,
  feedback,
  onOpen,
  onReplace,
  onRemove,
  onFeedback,
}) {
  if (!paper) return null

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        Paper Actions
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onOpen} className={actionClass}>
          <Icon name="external" className="h-3 w-3" />
          Open Paper
        </button>
        <button type="button" onClick={() => onReplace(paper)} className={actionClass}>
          <Icon name="replace" className="h-3 w-3" />
          Replace Paper
        </button>
        <button type="button" onClick={() => onRemove(paper)} className={actionClass}>
          <Icon name="trash" className="h-3 w-3" />
          Remove Paper
        </button>
        <button
          type="button"
          onClick={() => onFeedback(paper.id, 'relevant')}
          className={`${actionClass} ${feedback === 'relevant' ? 'border-accent/50 text-accent' : ''}`}
        >
          <Icon name="thumbsUp" className="h-3 w-3" />
          Mark Relevant
        </button>
        <button
          type="button"
          onClick={() => onFeedback(paper.id, 'not-relevant')}
          className={`${actionClass} ${feedback === 'not-relevant' ? 'border-accent/50 text-accent' : ''}`}
        >
          <Icon name="thumbsDown" className="h-3 w-3" />
          Mark Not Relevant
        </button>
        <button
          type="button"
          onClick={() => onFeedback(paper.id, 'pinned')}
          className={`${actionClass} ${feedback === 'pinned' ? 'border-accent/50 text-accent' : ''}`}
        >
          <Icon name="pin" className="h-3 w-3" />
          Pin Paper
        </button>
      </div>
    </div>
  )
}

export default PaperActionsToolbar
