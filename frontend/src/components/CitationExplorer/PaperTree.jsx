import { useState } from 'react'
import Icon from '../Icon/Icon'

function PaperTreeNode({ node, selectedId, onSelect, depth = 0 }) {
  const [isOpen, setIsOpen] = useState(true)
  const hasChildren = Boolean(node.children?.length)

  return (
    <li>
      <div
        className={`flex items-center rounded-md pr-2 transition-colors ${
          selectedId === node.id
            ? 'bg-accent/12 text-accent'
            : 'text-ink-soft hover:bg-panel/70'
        }`}
        style={{ paddingLeft: `${depth * 14 + 2}px` }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-hidden={!hasChildren}
          aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
          onClick={() => hasChildren && setIsOpen((open) => !open)}
          className="grid h-6 w-5 shrink-0 place-items-center text-ink-muted"
        >
          {hasChildren && (
            <Icon
              name="chevron"
              className={`h-3 w-3 transition-transform ${isOpen ? '' : '-rotate-90'}`}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          title={node.title}
        >
          <Icon name="file" className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <span className="truncate text-xs">{node.title}</span>
        </button>
      </div>

      {hasChildren && isOpen && (
        <ul>
          {node.children.map((child) => (
            <PaperTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function PaperTree({ root, selectedId, onSelect }) {
  return (
    <ul>
      <PaperTreeNode node={root} selectedId={selectedId} onSelect={onSelect} />
    </ul>
  )
}

export default PaperTree
