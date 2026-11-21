// Axis helpers for the SVG charts: number formatting, tick positions, robust ranges, sampling.
// Pure functions, unit tested.

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e5 || a < 1e-3) {
    let e = Math.floor(Math.log10(a))
    let mant = (a / 10 ** e).toFixed(1)
    // 9.96e-4 rounds to "10.0e-4": carry into the exponent
    if (Number(mant) >= 10) {
      e += 1
      mant = (a / 10 ** e).toFixed(1)
    }
    return `${v < 0 ? '−' : ''}${mant.replace(/\.0$/, '')}e${e}`
  }
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3
  return v
    .toFixed(digits)
    .replace(/\.?0+$/, '')
    .replace('-', '−')
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(span)) return [lo]
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const err = raw / mag
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag
  const out: number[] = []
  // multiply instead of accumulating, so 0 is exactly 0 (not -5.6e-17)
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) out.push(Number((k * step).toPrecision(12)))
  return out
}

export function logTicks(lo: number, hi: number): number[] {
  const a = Math.floor(Math.log10(lo))
  const b = Math.ceil(Math.log10(hi))
  const every = Math.max(1, Math.ceil((b - a) / 7))
  const out: number[] = []
  for (let e = a; e <= b; e += every) {
    const v = Number(`1e${e}`) // exact decimal; 10 ** -4 is 0.00009999999999999999
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v)
  }
  return out.length >= 2 ? out : [lo, hi]
}

/** Robust automatic range: ignores poles and extreme outliers. */
export function autoRange(values: number[], log = false): [number, number] {
  const v = values.filter((x) => Number.isFinite(x) && (!log || x > 0)).sort((a, b) => a - b)
  if (!v.length) return log ? [1e-3, 1] : [-1, 1]
  const q = (p: number): number => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]
  let lo = v[0]
  let hi = v[v.length - 1]
  if (v.length > 30) {
    const lo2 = q(0.01)
    const hi2 = q(0.99)
    const inner = log ? Math.log10(hi2 / lo2) : hi2 - lo2
    const outer = log ? Math.log10(hi / lo) : hi - lo
    if (inner > 0 && outer > 12 * inner) {
      lo = lo2
      hi = hi2
    }
  }
  if (log) {
    if (hi / lo < 10) {
      lo /= 3
      hi *= 3
    }
    return [lo / 1.6, hi * 1.6]
  }
  if (hi - lo < 1e-12) {
    const d = Math.abs(lo) * 0.1 || 1
    return [lo - d, hi + d]
  }
  const pad = (hi - lo) * 0.07
  return [lo - pad, hi + pad]
}

export function sample(fn: (x: number) => number, a: number, b: number, n = 400, log = false): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = log ? 10 ** (Math.log10(a) + t * (Math.log10(b) - Math.log10(a))) : a + t * (b - a)
    out.push([x, fn(x)])
  }
  return out
}
