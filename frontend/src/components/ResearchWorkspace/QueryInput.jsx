import { useLayoutEffect, useRef } from 'react'
import Icon from '../Icon/Icon'

function resizeQueryTextarea(textarea) {
  if (!textarea) return

  textarea.style.height = 'auto'
  const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight)
  const scrollHeight = textarea.scrollHeight
  const nextHeight =
    Number.isFinite(maxHeight) && maxHeight > 0
      ? Math.min(scrollHeight, maxHeight)
      : scrollHeight

  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY =
    scrollHeight > nextHeight ? 'auto' : 'hidden'
}

function QueryInput({ value, onChange, onSubmit, isRunning }) {
  const textareaRef = useRef(null)

  useLayoutEffect(() => {
    resizeQueryTextarea(textareaRef.current)
  }, [value])

  return (
    <section>
      <label htmlFor="research-query" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Research Query
      </label>
      <textarea
        ref={textareaRef}
        id="research-query"
        rows={1}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          resizeQueryTextarea(event.target)
        }}
        placeholder="Ask a research question..."
        className="max-h-40 w-full resize-none overflow-y-auto rounded-2xl border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-muted shadow-sm outline-none transition focus:border-accent/50 focus:shadow-md focus:shadow-accent/10 dark:bg-panel dark:focus:border-accent/40"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!value.trim() || isRunning}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-accent-deep/30 bg-indigo-600 px-4 py-2.5 text-sm font-semibold tracking-[0.08em] text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:border-border disabled:bg-ink-muted/40 disabled:text-white/70 disabled:shadow-none dark:border-indigo-400/30 dark:bg-indigo-500 dark:shadow-indigo-500/15 dark:hover:bg-indigo-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        {isRunning ? 'Tracing…' : 'TRACE'}
        <Icon name="arrowRight" className="h-4 w-4" />
      </button>
    </section>
  )
}

export default QueryInput
