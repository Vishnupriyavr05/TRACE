import { useEffect, useState } from 'react'

/** UI preview length for long methodology evidence excerpts (data stays full-length). */
const PREVIEW_CHAR_LIMIT = 360

/**
 * @param {string} text
 * @returns {boolean}
 */
function needsPreview(text) {
  return String(text).length > PREVIEW_CHAR_LIMIT
}

/**
 * @param {string} text
 * @returns {string}
 */
function buildPreviewText(text) {
  const value = String(text)
  if (!needsPreview(value)) return value
  const slice = value.slice(0, PREVIEW_CHAR_LIMIT)
  const lastSpace = slice.lastIndexOf(' ')
  const cut =
    lastSpace > PREVIEW_CHAR_LIMIT * 0.7 ? slice.slice(0, lastSpace) : slice
  return `${cut.trimEnd()}…`
}

function AssessmentItem({ item, positive, expanded, onToggle }) {
  const long = needsPreview(item)
  const displayText = long && !expanded ? buildPreviewText(item) : item

  return (
    <li className="flex gap-2 text-xs text-ink-soft">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          positive ? 'bg-accent' : 'bg-ink-muted'
        }`}
      />
      <span className="min-w-0 leading-relaxed">
        {displayText}
        {long ? (
          <button
            type="button"
            onClick={onToggle}
            className="ml-1 inline text-[11px] font-medium text-accent hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        ) : null}
      </span>
    </li>
  )
}

function AssessmentList({ title, items, positive }) {
  const [expandedKeys, setExpandedKeys] = useState(() => new Set())
  const itemsKey = items.join('\u0000')

  useEffect(() => {
    setExpandedKeys(new Set())
  }, [itemsKey])

  const toggleExpanded = (key) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {title}
      </h4>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => {
          const itemKey = `${title}-${index}`
          return (
            <AssessmentItem
              key={itemKey}
              item={item}
              positive={positive}
              expanded={expandedKeys.has(itemKey)}
              onToggle={() => toggleExpanded(itemKey)}
            />
          )
        })}
      </ul>
    </div>
  )
}

function MethodologyReview({ review }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <AssessmentList title="Strengths" items={review.strengths} positive />
      <AssessmentList title="Weaknesses" items={review.weaknesses} />
    </div>
  )
}

export default MethodologyReview
