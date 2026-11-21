// A small vertical bar chart: thin bars with rounded data ends on the baseline, recessive grid,
// value labels, and a hover tooltip per bar (hit area = the whole band).
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { fmtNum, niceTicks } from './Chart'

export interface Bar {
  label: string
  value: number | null
  tip?: string
}

const M = { top: 18, right: 8, bottom: 26, left: 38 }

/** Path of a bar whose top corners are rounded (r) and whose bottom sits flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

export function BarChart({ data, height = 200, max, format = fmtNum, color = 'var(--s1)', ariaLabel }: { data: Bar[]; height?: number; max?: number; format?: (v: number) => string; color?: string; ariaLabel: string }): ReactElement {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(420)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(160, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const top = max ?? Math.max(1e-9, ...data.map((d) => d.value ?? 0))
  const ticks = niceTicks(0, top, 4).filter((t) => t >= 0 && t <= top * 1.0001)
  const yMax = Math.max(top, ticks[ticks.length - 1] ?? top)
  const w = width - M.left - M.right
  const h = height - M.top - M.bottom
  const band = w / Math.max(1, data.length)
  const bw = Math.max(6, Math.min(40, band * 0.56))
  const y = (v: number): number => M.top + h - (v / yMax) * h

  return (
    <div className="chart" ref={wrap}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        {ticks.map((t) => (
          <g className="tick" key={`l${t}`}>
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        <line className="baseline" x1={M.left} x2={M.left + w} y1={M.top + h} y2={M.top + h} />
        {data.map((d, i) => {
          const cx = M.left + band * i + band / 2
          const v = d.value
          const bh = v !== null ? Math.max(v > 0 ? 2 : 0, (v / yMax) * h) : 0
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={M.left + band * i} y={M.top} width={band} height={h + M.bottom} fill="transparent" />
              {v !== null && bh > 0 ? (
                <path d={barPath(cx - bw / 2, M.top + h - bh, bw, bh, 4)} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              ) : (
                <line x1={cx - bw / 2} x2={cx + bw / 2} y1={M.top + h - 1} y2={M.top + h - 1} stroke="var(--faint)" strokeWidth={2} strokeLinecap="round" />
              )}
              <text x={cx} y={v !== null ? M.top + h - bh - 6 : M.top + h - 8} textAnchor="middle" fill="var(--text-2)" fontSize={11} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {v !== null ? format(v) : '–'}
              </text>
              <text x={cx} y={M.top + h + 17} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="chart-tip" style={{ left: Math.min(M.left + band * hover + band / 2 + 10, width - 190), top: 4 }}>
          <div style={{ fontWeight: 600 }}>{data[hover].label}</div>
          <div>{data[hover].value !== null ? format(data[hover].value!) : 'no data yet'}</div>
          {data[hover].tip && <div className="muted">{data[hover].tip}</div>}
        </div>
      )}
    </div>
  )
}
