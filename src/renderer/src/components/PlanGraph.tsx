// The dependency tree of a learning plan: anchors at the top, the goal at the bottom.
import { Graph, layout } from '@dagrejs/dagre'
import type { Plan, PlanNodeState } from '@shared/types'
import { useMemo, type ReactElement } from 'react'
import { Markdown } from './Markdown'

export interface PlanGraphProps {
  plan: Plan
  nodeState: Record<string, PlanNodeState>
  currentId?: string | null
  overrides?: Record<string, 'known' | 'teach'>
  onNodeClick?: (id: string) => void
  size?: 'side' | 'full'
}

interface Laid {
  nodes: { id: string; x: number; y: number }[]
  edges: { from: string; to: string; points: { x: number; y: number }[] }[]
  width: number
  height: number
}

export function PlanGraph({ plan, nodeState, currentId, overrides, onNodeClick, size = 'side' }: PlanGraphProps): ReactElement {
  const W = size === 'side' ? 128 : 172
  const H = size === 'side' ? 46 : 52
  const laid = useMemo<Laid>(() => {
    const g = new Graph()
    g.setGraph({ rankdir: 'TB', nodesep: size === 'side' ? 12 : 22, ranksep: size === 'side' ? 26 : 34, marginx: 6, marginy: 6 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of plan.nodes) g.setNode(n.id, { width: W, height: H })
    for (const n of plan.nodes) for (const r of n.requires) if (plan.nodes.some((m) => m.id === r)) g.setEdge(r, n.id)
    layout(g)
    const info = g.graph() as { width?: number; height?: number }
    return {
      nodes: plan.nodes.map((n) => {
        const v = g.node(n.id) as { x: number; y: number }
        return { id: n.id, x: v.x, y: v.y }
      }),
      edges: g.edges().map((e: { v: string; w: string }) => ({ from: e.v, to: e.w, points: ((g.edge(e) as { points?: { x: number; y: number }[] }).points ?? []).slice() })),
      width: info.width ?? W,
      height: info.height ?? H
    }
  }, [plan, W, H, size])

  const stateOf = (id: string): PlanNodeState => {
    const o = overrides?.[id]
    if (o === 'known') return 'known'
    if (o === 'teach') return 'pending'
    return nodeState[id] ?? 'pending'
  }
  const order = plan.nodes.filter((n) => stateOf(n.id) !== 'known').map((n) => n.id)

  return (
    <div className="plan-graph">
      <svg viewBox={`0 0 ${laid.width} ${laid.height}`} width="100%" style={{ maxWidth: laid.width, maxHeight: size === 'side' ? 520 : 460 }} role="img" aria-label="learning plan">
        <defs>
          <marker id="plan-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#5a5a5a" />
          </marker>
        </defs>
        {laid.edges.map((e, i) => {
          const done = ['done', 'known'].includes(stateOf(e.from))
          const d = e.points.map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join('')
          return <path key={i} d={d} className={`plan-edge ${done ? 'done' : ''}`} markerEnd="url(#plan-arrow)" />
        })}
        {laid.nodes.map((ln) => {
          const n = plan.nodes.find((x) => x.id === ln.id)!
          const st = currentId === n.id && stateOf(n.id) !== 'done' ? 'active' : stateOf(n.id)
          const idx = order.indexOf(n.id)
          const icon = st === 'known' || st === 'done' ? '✓' : st === 'shaky' ? '~' : n.kind === 'goal' ? '★' : idx >= 0 ? String(idx + 1) : '·'
          return (
            <foreignObject key={n.id} x={ln.x - W / 2} y={ln.y - H / 2} width={W} height={H}>
              <div
                className={`plan-node ${st} ${n.kind === 'goal' ? 'goal' : ''} ${onNodeClick && n.kind !== 'goal' ? 'clickable' : ''}`}
                title={n.detail}
                onClick={() => onNodeClick && n.kind !== 'goal' && onNodeClick(n.id)}
              >
                <span className="ic">{icon}</span>
                <span className="t">
                  <Markdown text={n.title} inline />
                </span>
              </div>
            </foreignObject>
          )
        })}
      </svg>
    </div>
  )
}
