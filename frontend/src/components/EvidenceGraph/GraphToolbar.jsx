import Icon from '../Icon/Icon'

function GraphToolbar({ onZoomIn, onZoomOut, onReset, onFit, onFullscreen }) {
  const actions = [
    { label: 'Zoom In', icon: 'zoomIn', onClick: onZoomIn },
    { label: 'Zoom Out', icon: 'zoomOut', onClick: onZoomOut },
    { label: 'Reset View', icon: 'reset', onClick: onReset },
    { label: 'Fit Graph', icon: 'fit', onClick: onFit },
    { label: 'Fullscreen', icon: 'fullscreen', onClick: onFullscreen },
  ]

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-panel/50 p-1 dark:bg-panel/70">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card hover:text-accent dark:hover:bg-card/60"
        >
          <Icon name={action.icon} className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  )
}

export default GraphToolbar
