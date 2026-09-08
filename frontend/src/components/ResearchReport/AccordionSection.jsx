import Icon from '../Icon/Icon'
import SkeletonBlock from './SkeletonBlock'

function AccordionSection({
  id,
  title,
  isOpen,
  onToggle,
  status,
  children,
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-panel/50"
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${
              status === 'ready'
                ? 'bg-accent'
                : status === 'loading'
                  ? 'animate-pulse bg-accent/60'
                  : 'bg-border'
            }`}
          />
          <span className="text-sm font-semibold text-ink">{title}</span>
        </div>
        <Icon
          name="chevron"
          className={`h-4 w-4 text-ink-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        className={`grid transition-all duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border px-4 py-3 text-sm leading-relaxed text-ink-soft">
            {status === 'loading' ? <SkeletonBlock lines={4} /> : children}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AccordionSection
