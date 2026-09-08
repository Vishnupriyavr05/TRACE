import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { GRAPH_EDGE_STYLES, GRAPH_NODE_STYLES } from '../../utils/constants'
import Icon from '../Icon/Icon'

const FALLBACK_STYLE = { fill: '#6b7fad', shape: 'circle', strokeDash: null }

function getRadius(importance) {
  if (importance === 'primary') return 24
  if (importance === 'major') return 16
  return 11
}

function truncateLabel(label, max = 18) {
  if (label.length <= max) return label
  return `${label.slice(0, max - 1)}…`
}

function edgeDash(style) {
  if (style === 'dashed') return '7 5'
  if (style === 'dotted') return '2.5 3.5'
  return null
}

function edgeWidth(confidence, active) {
  const base = 0.8 + (confidence / 100) * 1.8
  return active ? base + 0.7 : base
}

function NodeShape({ shape, radius, fill, fillOpacity, stroke, strokeWidth, strokeDasharray, glow }) {
  const common = {
    fill,
    fillOpacity,
    stroke,
    strokeWidth,
    strokeDasharray: strokeDasharray || undefined,
    style: glow
      ? { filter: 'drop-shadow(0 0 6px rgba(79, 124, 255, 0.55))' }
      : undefined,
    className: 'transition-all duration-300 ease-out',
  }

  if (shape === 'diamond') {
    const d = radius * 1.15
    return (
      <polygon
        points={`0,${-d} ${d},0 0,${d} ${-d},0`}
        {...common}
      />
    )
  }

  if (shape === 'rounded') {
    const s = radius * 1.55
    return (
      <rect
        x={-s / 2}
        y={-s / 2}
        width={s}
        height={s}
        rx={4}
        ry={4}
        {...common}
      />
    )
  }

  if (shape === 'hex') {
    const r = radius * 1.1
    const points = [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 2
        return `${Math.cos(angle) * r},${Math.sin(angle) * r}`
      })
      .join(' ')
    return <polygon points={points} {...common} />
  }

  if (shape === 'triangle') {
    const h = radius * 1.35
    return (
      <polygon
        points={`0,${-h} ${h * 0.95},${h * 0.7} ${-h * 0.95},${h * 0.7}`}
        {...common}
      />
    )
  }

  return <circle r={radius} {...common} />
}

const GraphCanvas = forwardRef(function GraphCanvas(
  {
    data,
    isActive,
    selectedNodeId,
    highlightedNodeIds = [],
    papers = [],
    onNodeSelect,
    onPaperSelect,
  },
  ref,
) {
  const containerRef = useRef(null)
  const [transform, setTransform] = useState({ x: 24, y: 24, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [internalSelectedId, setInternalSelectedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [tooltip, setTooltip] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [legendOpen, setLegendOpen] = useState(true)
  const selectedId = selectedNodeId ?? internalSelectedId

  const fitGraph = () => {
    const container = containerRef.current
    if (!container || !data.nodes.length) return

    const xs = data.nodes.map((node) => node.x)
    const ys = data.nodes.map((node) => node.y)
    const minX = Math.min(...xs) - 48
    const maxX = Math.max(...xs) + 48
    const minY = Math.min(...ys) - 48
    const maxY = Math.max(...ys) + 56
    const width = maxX - minX || 1
    const height = maxY - minY || 1
    const scale = Math.min(
      (container.clientWidth - 72) / width,
      (container.clientHeight - 72) / height,
      1.35,
    )

    setTransform({
      scale,
      x: (container.clientWidth - width * scale) / 2 - minX * scale,
      y: (container.clientHeight - height * scale) / 2 - minY * scale,
    })
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () =>
      setTransform((current) => ({
        ...current,
        scale: Math.min(2.4, current.scale * 1.15),
      })),
    zoomOut: () =>
      setTransform((current) => ({
        ...current,
        scale: Math.max(0.45, current.scale * 0.85),
      })),
    reset: () => {
      setInternalSelectedId(null)
      setHoveredId(null)
      setTooltip(null)
      setSelectedEdge(null)
      setTransform({ x: 24, y: 24, scale: 1 })
      requestAnimationFrame(fitGraph)
    },
    fit: fitGraph,
  }))

  useEffect(() => {
    setInternalSelectedId(null)
    setHoveredId(null)
    setTooltip(null)
    setSelectedEdge(null)
    setTransform({ x: 24, y: 24, scale: 1 })
  }, [data])

  useEffect(() => {
    if (isActive) fitGraph()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, data])

  const nodeMap = useMemo(() => {
    const map = new Map()
    data.nodes.forEach((node) => map.set(node.id, node))
    return map
  }, [data])

  const connectedIds = useMemo(() => {
    if (!selectedId) return new Set()
    const set = new Set([selectedId])
    data.links.forEach((link) => {
      if (link.source === selectedId) set.add(link.target)
      if (link.target === selectedId) set.add(link.source)
    })
    return set
  }, [data.links, selectedId])

  const externallyHighlightedIds = useMemo(
    () => new Set(highlightedNodeIds),
    [highlightedNodeIds],
  )

  useEffect(() => {
    if (highlightedNodeIds.length > 0) {
      setInternalSelectedId(null)
      setSelectedEdge(null)
    }
  }, [highlightedNodeIds])

  const relatedPapersFor = (ids = []) =>
    ids.map((id) => papers.find((paper) => paper.id === id)).filter(Boolean)

  const nodeTypesPresent = useMemo(() => {
    const types = new Set(data.nodes.map((node) => node.type))
    return Object.keys(GRAPH_NODE_STYLES).filter((type) => types.has(type))
  }, [data.nodes])

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-0 overflow-hidden rounded-2xl border border-border ${
        isActive ? 'opacity-100' : 'pointer-events-none absolute inset-0 opacity-0'
      }`}
      style={{
        backgroundImage: `
          radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 42%),
          radial-gradient(circle at 80% 80%, color-mix(in srgb, var(--color-accent) 5%, transparent), transparent 40%),
          radial-gradient(circle, color-mix(in srgb, var(--color-ink-muted) 18%, transparent) 0.7px, transparent 0.8px)
        `,
        backgroundSize: 'auto, auto, 16px 16px',
        backgroundColor: 'color-mix(in srgb, var(--color-panel) 55%, transparent)',
      }}
      onWheel={(event) => {
        event.preventDefault()
        const delta = event.deltaY > 0 ? 0.9 : 1.1
        setTransform((current) => ({
          ...current,
          scale: Math.min(2.4, Math.max(0.45, current.scale * delta)),
        }))
      }}
      onMouseLeave={() => {
        setDragging(false)
        setHoveredId(null)
        setTooltip(null)
      }}
      onMouseMove={(event) => {
        if (!dragging) return
        setTransform((current) => ({
          ...current,
          x: event.clientX - dragStart.x,
          y: event.clientY - dragStart.y,
        }))
      }}
      onMouseUp={() => setDragging(false)}
      onMouseDown={(event) => {
        if (event.target.closest('[data-node]')) return
        setDragging(true)
        setDragStart({
          x: event.clientX - transform.x,
          y: event.clientY - transform.y,
        })
      }}
    >
      <svg className="h-full w-full cursor-grab active:cursor-grabbing">
        <g
          transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
          style={{ transition: dragging ? 'none' : 'transform 280ms ease-out' }}
        >
          {data.links.map((link) => {
            const source = nodeMap.get(link.source)
            const target = nodeMap.get(link.target)
            if (!source || !target) return null

            const isActiveEdge =
              selectedId
                ? connectedIds.has(link.source) && connectedIds.has(link.target)
                : externallyHighlightedIds.size
                  ? externallyHighlightedIds.has(link.source) &&
                    externallyHighlightedIds.has(link.target)
                  : true
            const style = GRAPH_EDGE_STYLES[link.type] || 'solid'
            const confidence = link.confidence ?? 70
            const opacity = isActiveEdge
              ? 0.25 + (confidence / 100) * 0.65
              : 0.08
            const selected = selectedEdge?.id === link.id

            return (
              <g key={link.id}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={selected || (isActiveEdge && selectedId) ? '#4f7cff' : '#9aa8c2'}
                  strokeOpacity={opacity}
                  strokeWidth={edgeWidth(confidence, selected || (isActiveEdge && selectedId))}
                  strokeDasharray={edgeDash(style) || undefined}
                  className="transition-all duration-300 ease-out"
                />
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="transparent"
                  strokeWidth="14"
                  className="cursor-pointer"
                  onMouseEnter={(event) => {
                    const bounds = containerRef.current.getBoundingClientRect()
                    setTooltip({
                      title: `${source.label} → ${target.label}`,
                      detail: link.explanation,
                      meta: `${link.type} · ${confidence}% confidence · ${style}`,
                      x: event.clientX - bounds.left,
                      y: event.clientY - bounds.top,
                    })
                  }}
                  onMouseMove={(event) => {
                    const bounds = containerRef.current.getBoundingClientRect()
                    setTooltip((current) =>
                      current
                        ? {
                            ...current,
                            x: event.clientX - bounds.left,
                            y: event.clientY - bounds.top,
                          }
                        : current,
                    )
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedEdge((current) =>
                      current?.id === link.id ? null : link,
                    )
                  }}
                />
              </g>
            )
          })}

          {data.nodes.map((node) => {
            const hasFindingHighlight = externallyHighlightedIds.size > 0
            const isConnected = selectedId
              ? connectedIds.has(node.id)
              : hasFindingHighlight
                ? externallyHighlightedIds.has(node.id)
                : true
            const isSelected = node.id === selectedId
            const style = GRAPH_NODE_STYLES[node.type] || FALLBACK_STYLE
            const radius = getRadius(node.importance)
            const displayRadius =
              (isSelected ? radius + 3 : hoveredId === node.id ? radius + 1.5 : radius)

            return (
              <g
                key={node.id}
                data-node
                className="cursor-pointer"
                transform={`translate(${node.x} ${node.y})`}
                opacity={isConnected ? 1 : 0.22}
                style={{ transition: 'opacity 300ms ease-out' }}
                onMouseEnter={(event) => {
                  setHoveredId(node.id)
                  const bounds = containerRef.current.getBoundingClientRect()
                  setTooltip({
                    title: node.label,
                    detail: node.description,
                    meta: `${node.type} · ${
                      node.relatedPaperIds?.length || 0
                    } related papers · ${
                      data.links.filter(
                        (link) => link.source === node.id || link.target === node.id,
                      ).length
                    } connected concepts`,
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top,
                  })
                }}
                onMouseLeave={() => {
                  setHoveredId(null)
                  setTooltip(null)
                }}
                onClick={() => {
                  const nextNode = selectedId === node.id ? null : node
                  setInternalSelectedId(nextNode?.id || null)
                  setSelectedEdge(null)
                  onNodeSelect?.(nextNode)
                }}
              >
                <NodeShape
                  shape={style.shape}
                  radius={displayRadius}
                  fill={style.fill}
                  fillOpacity={isConnected ? 0.95 : 0.35}
                  stroke={isSelected ? '#4f7cff' : '#ffffff'}
                  strokeWidth={isSelected ? 2.6 : 1.7}
                  strokeDasharray={style.strokeDash}
                  glow={isSelected}
                />
                {(isSelected ||
                  hoveredId === node.id ||
                  node.importance === 'primary' ||
                  (data.nodes.length <= 28 && isConnected)) && (
                  <text
                    y={displayRadius + 15}
                    textAnchor="middle"
                    className="fill-current text-[10px] font-medium text-ink"
                    opacity={isConnected ? 0.95 : 0.35}
                    style={{ transition: 'opacity 300ms ease-out' }}
                  >
                    {truncateLabel(
                      node.label,
                      isSelected || hoveredId === node.id ? 32 : 18,
                    )}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-[260px] rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg dark:bg-panel"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <p className="font-semibold text-ink">{tooltip.title}</p>
          <p className="mt-1 leading-relaxed text-ink-soft">{tooltip.detail}</p>
          {tooltip.meta && (
            <p className="mt-1.5 text-[11px] text-ink-muted">{tooltip.meta}</p>
          )}
        </div>
      )}

      {selectedEdge && (
        <div className="absolute bottom-3 right-3 z-10 w-[min(19rem,calc(100%-1.5rem))] rounded-xl border border-accent/25 bg-card/95 p-3 shadow-lg backdrop-blur dark:bg-panel/95">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                {selectedEdge.type}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {selectedEdge.explanation}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close relationship details"
              onClick={() => setSelectedEdge(null)}
              className="text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            Confidence:{' '}
            <strong className="text-ink">{selectedEdge.confidence}%</strong>
            {' · '}
            {(GRAPH_EDGE_STYLES[selectedEdge.type] || 'solid')} edge
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {relatedPapersFor(selectedEdge.supportingPaperIds).map((paper) => (
              <button
                key={paper.id}
                type="button"
                onClick={() => onPaperSelect?.(paper)}
                className="rounded-full border border-border px-2 py-1 text-[10px] text-ink-soft hover:border-accent/40 hover:text-accent"
              >
                {truncateLabel(paper.title, 24)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="absolute left-3 top-3 z-10 max-w-[11.5rem]">
        <button
          type="button"
          onClick={() => setLegendOpen((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur hover:text-ink dark:bg-panel/95"
        >
          Legend
          <Icon
            name="chevron"
            className={`h-3 w-3 transition-transform ${legendOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {legendOpen && (
          <div className="mt-1.5 rounded-xl border border-border bg-card/95 p-2.5 text-[10px] shadow-sm backdrop-blur dark:bg-panel/95">
            <p className="font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Node Types
            </p>
            <ul className="mt-1.5 space-y-1">
              {nodeTypesPresent.map((type) => {
                const style = GRAPH_NODE_STYLES[type]
                return (
                  <li key={type} className="flex items-center gap-2 text-ink-soft">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/80"
                      style={{
                        background: style.fill,
                        borderRadius:
                          style.shape === 'rounded'
                            ? '2px'
                            : style.shape === 'diamond' || style.shape === 'triangle'
                              ? '1px'
                              : '999px',
                      }}
                    />
                    {type}
                  </li>
                )
              })}
            </ul>
            <p className="mt-2.5 font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Relationships
            </p>
            <ul className="mt-1.5 space-y-1 text-ink-soft">
              <li className="flex items-center gap-2">
                <span className="h-px w-5 bg-ink-muted" />
                Solid · Direct
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 border-t border-dashed border-ink-muted" />
                Dashed · Indirect
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 border-t border-dotted border-ink-muted" />
                Dotted · Reference
              </li>
            </ul>
            <p className="mt-2.5 font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Confidence
            </p>
            <p className="mt-1 leading-relaxed text-ink-soft">
              Higher opacity and thicker edges indicate stronger confidence.
            </p>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border bg-card/90 px-2.5 py-1 text-[11px] text-ink-muted backdrop-blur dark:bg-panel/90">
        Pan · Zoom · Click node to highlight
      </div>
    </div>
  )
})

export default GraphCanvas
