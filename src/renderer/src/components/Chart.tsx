// A small SVG chart for function plots and the demos: linear/log axes, lines, points, stems,
// reference lines, draggable points, a crosshair tooltip and a legend.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MathText } from './Markdown'
import { autoRange, fmtNum, logTicks, niceTicks, sample } from '../lib/axes'

export { autoRange, fmtNum, niceTicks, sample }

export const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)']

export interface ChartSeries {
  label?: string | null
  points: [number, number][]
  color?: string
  style?: 'line' | 'dashed' | 'points' | 'area' | 'stem'
  width?: number
  /** points can be dragged (style 'points' only) */
  draggable?: boolean
  /** leave out of the hover tooltip */
  noTip?: boolean
  /** leave out of the legend */
  noLegend?: boolean
  radius?: number
}

export interface Scales {
  x: (v: number) => number
  y: (v: number) => number
  ix: (px: number) => number
  iy: (py: number) => number
  left: number
  top: number
  width: number
  height: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface ChartProps {
  series: ChartSeries[]
  xMin?: number | null
  xMax?: number | null
  yMin?: number | null
  yMax?: number | null
  logX?: boolean
  logY?: boolean
  height?: number
  title?: string | null
  xLabel?: string | null
  yLabel?: string | null
  /** keep one data unit equally long on both axes (circles stay circles) */
  equal?: boolean
  vlines?: { x: number; label?: string; color?: string }[]
  hlines?: { y: number; label?: string; color?: string }[]
  onDrag?: (series: number, index: number, x: number, y: number) => void
  overlay?: (s: Scales) => ReactNode
  formatX?: (x: number) => string
  formatY?: (y: number) => string
  tooltip?: boolean
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cw = Math.floor(entries[0].contentRect.width)
      if (cw > 0) setW(cw)
    })
    ro.observe(el)
    setW(Math.floor(el.getBoundingClientRect().width) || 600)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const M = { top: 10, right: 14, bottom: 28, left: 46 }

export function Chart(props: ChartProps): ReactElement {
  const { series, logX = false, logY = false, height = 260, title, xLabel, yLabel, equal = false, tooltip = true } = props
  const [wrapRef, width] = useWidth()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null)
  const drag = useRef<{ s: number; i: number } | null>(null)
  const fx = props.formatX ?? fmtNum
  const fy = props.formatY ?? fmtNum

  const dims = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p[0]))
    const ys = series.flatMap((s) => s.points.map((p) => p[1]))
    let [x0, x1] = props.xMin !== null && props.xMin !== undefined && props.xMax !== null && props.xMax !== undefined ? [props.xMin, props.xMax] : autoRange(xs, logX)
    if (props.xMin !== null && props.xMin !== undefined) x0 = props.xMin
    if (props.xMax !== null && props.xMax !== undefined) x1 = props.xMax
    let [y0, y1] = autoRange(ys, logY)
    if (props.yMin !== null && props.yMin !== undefined) y0 = props.yMin
    if (props.yMax !== null && props.yMax !== undefined) y1 = props.yMax
    if (logX && x0 <= 0) x0 = Math.max(1e-12, x1 / 1e6)
    if (logY && y0 <= 0) y0 = Math.max(1e-16, y1 / 1e12)
    const w = Math.max(80, width - M.left - M.right)
    const h = Math.max(60, height - M.top - M.bottom)
    const left = M.left
    if (equal && !logX && !logY) {
      // expand the shorter range so that one unit has the same length in x and y
      const ux = w / (x1 - x0)
      const uy = h / (y1 - y0)
      if (ux > uy) {
        const need = w / uy - (x1 - x0)
        x0 -= need / 2
        x1 += need / 2
      } else {
        const need = h / ux - (y1 - y0)
        y0 -= need / 2
        y1 += need / 2
      }
    }
    const tx = (v: number): number => (logX ? Math.log10(v) : v)
    const ty = (v: number): number => (logY ? Math.log10(v) : v)
    const X0 = tx(x0)
    const X1 = tx(x1)
    const Y0 = ty(y0)
    const Y1 = ty(y1)
    const scales: Scales = {
      x: (v) => left + ((tx(v) - X0) / (X1 - X0)) * w,
      y: (v) => M.top + h - ((ty(v) - Y0) / (Y1 - Y0)) * h,
      ix: (px) => {
        const t = X0 + ((px - left) / w) * (X1 - X0)
        return logX ? 10 ** t : t
      },
      iy: (py) => {
        const t = Y0 + ((M.top + h - py) / h) * (Y1 - Y0)
        return logY ? 10 ** t : t
      },
      left,
      top: M.top,
      width: w,
      height: h,
      xMin: x0,
      xMax: x1,
      yMin: y0,
      yMax: y1
    }
    return scales
  }, [series, props.xMin, props.xMax, props.yMin, props.yMax, logX, logY, width, height, equal])

  const s = dims
  const xt = logX ? logTicks(s.xMin, s.xMax) : niceTicks(s.xMin, s.xMax, Math.max(3, Math.round(s.width / 90)))
  const yt = logY ? logTicks(s.yMin, s.yMax) : niceTicks(s.yMin, s.yMax, Math.max(3, Math.round(s.height / 55)))
  const clipId = useMemo(() => `clip${Math.random().toString(36).slice(2, 8)}`, [])

  const path = (pts: [number, number][]): string => {
    let d = ''
    let pen = false
    const lim = s.height * 4
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || (logY && y <= 0) || (logX && x <= 0)) {
        pen = false
        continue
      }
      const px = s.x(x)
      const py = s.y(y)
      if (py < s.top - lim || py > s.top + s.height + lim) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`
      pen = true
    }
    return d
  }

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const r = svgRef.current?.getBoundingClientRect()
      if (!r) return
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      if (drag.current && props.onDrag) {
        props.onDrag(drag.current.s, drag.current.i, s.ix(Math.min(s.left + s.width, Math.max(s.left, px))), s.iy(Math.min(s.top + s.height, Math.max(s.top, py))))
        return
      }
      if (px < s.left || px > s.left + s.width || py < s.top || py > s.top + s.height) setHover(null)
      else setHover({ px, py })
    },
    [s, props]
  )

  const tip = useMemo(() => {
    if (!hover || !tooltip) return null
    const x = s.ix(hover.px)
    const rows: { label: string; color: string; value: string }[] = []
    series.forEach((ser, k) => {
      if (ser.noTip || !ser.points.length) return
      const color = ser.color ?? SERIES_COLORS[k % 4]
      if (ser.style === 'points' || ser.style === 'stem') {
        let best = -1
        let bd = 1e9
        ser.points.forEach((p, i) => {
          const d = Math.hypot(s.x(p[0]) - hover.px, s.y(p[1]) - hover.py)
          if (d < bd) {
            bd = d
            best = i
          }
        })
        if (best >= 0 && bd < 24) rows.push({ label: `${ser.label ?? 'point'} (${fx(ser.points[best][0])})`, color, value: fy(ser.points[best][1]) })
        return
      }
      // nearest sample by x
      let lo = 0
      let hi = ser.points.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (ser.points[mid][0] < x) lo = mid
        else hi = mid
      }
      const p = Math.abs(ser.points[lo][0] - x) < Math.abs(ser.points[hi][0] - x) ? ser.points[lo] : ser.points[hi]
      if (Number.isFinite(p[1])) rows.push({ label: ser.label ?? `series ${k + 1}`, color, value: fy(p[1]) })
    })
    if (!rows.length) return null
    return { x, rows }
  }, [hover, series, s, tooltip, fx, fy])

  const legend = series.filter((x) => x.label && !x.noLegend)
  return (
    <div className="chart" ref={wrapRef}>
      {title && <div className="chart-title"><MathText text={title} /></div>}
      {legend.length >= 2 && (
        <div className="legend">
          {series.map((ser, k) =>
            ser.label && !ser.noLegend ? (
              <span className="legend-item" key={k}>
                <span
                  className={`legend-key ${ser.style === 'dashed' ? 'dashed' : ser.style === 'points' || ser.style === 'stem' ? 'dot' : ''}`}
                  style={{ background: ser.color ?? SERIES_COLORS[k % 4], borderColor: ser.color ?? SERIES_COLORS[k % 4] }}
                />
                <MathText text={ser.label} />
              </span>
            ) : null
          )}
        </div>
      )}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onPointerMove={onMove}
        onPointerLeave={() => {
          if (!drag.current) setHover(null)
        }}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label={title ?? 'plot'}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={s.left} y={s.top - 2} width={s.width} height={s.height + 4} />
          </clipPath>
        </defs>
        <g className="grid">
          {yt.map((v) => (
            <line key={`gy${v}`} x1={s.left} x2={s.left + s.width} y1={s.y(v)} y2={s.y(v)} />
          ))}
          {xt.map((v) => (
            <line key={`gx${v}`} x1={s.x(v)} x2={s.x(v)} y1={s.top} y2={s.top + s.height} opacity={0.5} />
          ))}
        </g>
        {!logY && s.yMin < 0 && s.yMax > 0 && <line className="baseline" x1={s.left} x2={s.left + s.width} y1={s.y(0)} y2={s.y(0)} />}
        {!logX && s.xMin < 0 && s.xMax > 0 && <line className="baseline" x1={s.x(0)} x2={s.x(0)} y1={s.top} y2={s.top + s.height} />}
        <line className="baseline" x1={s.left} x2={s.left + s.width} y1={s.top + s.height} y2={s.top + s.height} />
        <g className="tick">
          {yt.map((v) => (
            <text key={`ty${v}`} x={s.left - 7} y={s.y(v) + 3.5} textAnchor="end">
              {logY ? `1e${Math.round(Math.log10(v))}` : fy(v)}
            </text>
          ))}
          {xt.map((v) => (
            <text key={`tx${v}`} x={s.x(v)} y={s.top + s.height + 16} textAnchor="middle">
              {logX ? `1e${Math.round(Math.log10(v))}` : fx(v)}
            </text>
          ))}
        </g>
        {xLabel && (
          <text className="axis-label" x={s.left + s.width} y={s.top + s.height - 6} textAnchor="end">
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text className="axis-label" x={s.left + 6} y={s.top + 11}>
            {yLabel}
          </text>
        )}
        <g clipPath={`url(#${clipId})`}>
          {(props.hlines ?? []).map((l, i) => (
            <line key={`hl${i}`} x1={s.left} x2={s.left + s.width} y1={s.y(l.y)} y2={s.y(l.y)} stroke={l.color ?? 'var(--muted)'} strokeWidth={1} strokeDasharray="4 4" />
          ))}
          {(props.vlines ?? []).map((l, i) => (
            <line key={`vl${i}`} x1={s.x(l.x)} x2={s.x(l.x)} y1={s.top} y2={s.top + s.height} stroke={l.color ?? 'var(--muted)'} strokeWidth={1} strokeDasharray="4 4" />
          ))}
          {series.map((ser, k) => {
            const color = ser.color ?? SERIES_COLORS[k % 4]
            if (ser.style === 'points' || ser.style === 'stem') return null
            const d = path(ser.points)
            if (ser.style === 'area') {
              const base = logY ? s.yMin : Math.max(s.yMin, Math.min(s.yMax, 0))
              const pts = ser.points.filter((p) => Number.isFinite(p[1]))
              if (!pts.length) return null
              const area = `${path(pts)}L${s.x(pts[pts.length - 1][0])},${s.y(base)}L${s.x(pts[0][0])},${s.y(base)}Z`
              return (
                <g key={k}>
                  <path d={area} fill={color} opacity={0.1} />
                  <path d={d} fill="none" stroke={color} strokeWidth={ser.width ?? 2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            }
            return (
              <path
                key={k}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={ser.width ?? 2}
                strokeDasharray={ser.style === 'dashed' ? '6 5' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )
          })}
          {series.map((ser, k) => {
            const color = ser.color ?? SERIES_COLORS[k % 4]
            if (ser.style !== 'points' && ser.style !== 'stem') return null
            const r = ser.radius ?? 4.5
            return (
              <g key={`p${k}`}>
                {ser.points.map(([x, y], i) => {
                  if (!Number.isFinite(x) || !Number.isFinite(y) || (logY && y <= 0)) return null
                  const base = logY ? s.yMin : 0
                  return (
                    <g key={i}>
                      {ser.style === 'stem' && <line x1={s.x(x)} x2={s.x(x)} y1={s.y(base)} y2={s.y(y)} stroke={color} strokeWidth={2} />}
                      <circle
                        cx={s.x(x)}
                        cy={s.y(y)}
                        r={ser.draggable ? r + 1.5 : r}
                        fill={color}
                        stroke="var(--surface)"
                        strokeWidth={2}
                        style={ser.draggable ? { cursor: 'ns-resize' } : undefined}
                        onPointerDown={
                          ser.draggable
                            ? (e) => {
                                ;(e.target as Element).setPointerCapture?.(e.pointerId)
                                drag.current = { s: k, i }
                              }
                            : undefined
                        }
                        onPointerUp={() => (drag.current = null)}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })}
          {props.overlay?.(s)}
        </g>
        {hover && tooltip && <line x1={hover.px} x2={hover.px} y1={s.top} y2={s.top + s.height} stroke="var(--line-2)" strokeWidth={1} pointerEvents="none" />}
      </svg>
      {tip && hover && (
        <div className="chart-tip" style={{ left: Math.min(hover.px + 14, width - 180), top: Math.max(0, hover.py - 10) + (title ? 22 : 0) + (legend.length >= 2 ? 22 : 0) }}>
          <div className="tip-head">x = {fx(tip.x)}</div>
          {tip.rows.slice(0, 6).map((r, i) => (
            <div className="tip-row" key={i}>
              <span className="legend-key dot" style={{ background: r.color }} />
              <span>{r.label}</span>
              <b>{r.value}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
