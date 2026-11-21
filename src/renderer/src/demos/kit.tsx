// Shared pieces for the interactive demos: safe parameter parsing, controls and the frame.
import { makeFn } from '@shared/mathx'
import type { ReactElement, ReactNode } from 'react'
import type { Scales } from '../components/Chart'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'

export type Params = Record<string, unknown>

export function num(p: Params, key: string, def: number, min: number, max: number): number {
  const v = Number(p[key])
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}

export function int(p: Params, key: string, def: number, min: number, max: number): number {
  return Math.round(num(p, key, def, min, max))
}

export function str<T extends string>(p: Params, key: string, def: T, allowed?: readonly T[]): T {
  const v = typeof p[key] === 'string' ? (p[key] as string) : def
  return allowed && !allowed.includes(v as T) ? def : (v as T)
}

export function bool(p: Params, key: string, def: boolean): boolean {
  return typeof p[key] === 'boolean' ? (p[key] as boolean) : def
}

/** A model-supplied function of x, falling back to a default if it does not parse or evaluate. */
export function fnParam(p: Params, key: string, def: string): { src: string; f: (x: number) => number } {
  const src = typeof p[key] === 'string' && (p[key] as string).trim() ? (p[key] as string) : def
  const f = makeFn(src)
  if (f && Number.isFinite(f(0.37))) return { src, f }
  if (f) {
    // may be undefined at one point only (e.g. 1/x); accept if finite somewhere nearby
    for (const x of [0.5, 1.3, -0.7, 2.1]) if (Number.isFinite(f(x))) return { src, f }
  }
  return { src: def, f: makeFn(def)! }
}

export function parseParams(src: string | null | undefined): Params {
  if (!src) return {}
  try {
    const v = JSON.parse(src) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Params) : {}
  } catch {
    return {}
  }
}

export function DemoFrame({ name, caption, children, controls, readout }: { name: string; caption?: string | null; children: ReactNode; controls?: ReactNode; readout?: ReactNode }): ReactElement {
  return (
    <div className="demo">
      <div className="demo-head">
        <Icon name="zap" size={15} style={{ color: 'var(--accent-text)' }} />
        <span className="demo-name">{name}</span>
      </div>
      {caption && (
        <div className="small" style={{ color: 'var(--text-2)', marginBottom: 8 }}>
          <Markdown text={caption} inline />
        </div>
      )}
      {children}
      {controls && <div className="demo-controls">{controls}</div>}
      {readout && <div className="demo-readout">{readout}</div>}
    </div>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, fmt }: { label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }): ReactElement {
  return (
    <label>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{fmt ? fmt(value) : value}</span>
    </label>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): ReactElement {
  return (
    <span className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  )
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): ReactElement {
  return (
    <label style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
      <span>{label}</span>
    </label>
  )
}

export function Arrow({ s, x1, y1, x2, y2, color, width = 2 }: { s: Scales; x1: number; y1: number; x2: number; y2: number; color: string; width?: number }): ReactElement | null {
  const ax = s.x(x1)
  const ay = s.y(y1)
  const bx = s.x(x2)
  const by = s.y(y2)
  const len = Math.hypot(bx - ax, by - ay)
  if (!(len > 1)) return null
  const ux = (bx - ax) / len
  const uy = (by - ay) / len
  const h = Math.min(10, len * 0.4)
  const p1 = `${bx},${by}`
  const p2 = `${bx - h * ux + h * 0.45 * uy},${by - h * uy - h * 0.45 * ux}`
  const p3 = `${bx - h * ux - h * 0.45 * uy},${by - h * uy + h * 0.45 * ux}`
  return (
    <g>
      <line x1={ax} y1={ay} x2={bx - h * 0.6 * ux} y2={by - h * 0.6 * uy} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${p1} ${p2} ${p3}`} fill={color} />
    </g>
  )
}

export function sci(v: number): string {
  if (!Number.isFinite(v)) return '∞'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e-3 && a < 1e5) return v.toPrecision(4).replace(/\.?0+$/, '')
  const e = Math.floor(Math.log10(a))
  return `${(v / 10 ** e).toFixed(2)}e${e}`
}
