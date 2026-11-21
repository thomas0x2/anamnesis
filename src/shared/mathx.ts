// A locked-down math.js instance: model-written expressions (plots, numeric answers) are evaluated
// with no access to import/createUnit/evaluate/parse from inside an expression.
import { all, create, type EvalFunction } from 'mathjs'

const math = create(all, {})
const compileExpr = math.compile.bind(math)
math.import(
  {
    import: () => {
      throw new Error('disabled')
    },
    createUnit: () => {
      throw new Error('disabled')
    },
    evaluate: () => {
      throw new Error('disabled')
    },
    parse: () => {
      throw new Error('disabled')
    },
    simplify: () => {
      throw new Error('disabled')
    },
    derivative: () => {
      throw new Error('disabled')
    },
    resolve: () => {
      throw new Error('disabled')
    }
  },
  { override: true }
)

const cache = new Map<string, EvalFunction | null>()

/** Normalize common notations: "**" → "^", unicode minus/pi/times, "ln" → "log". */
export function normalizeExpr(src: string): string {
  return src
    .replace(/\*\*/g, '^')
    .replace(/[−–]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/π/g, 'pi')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/\bln\(/g, 'log(')
    .replace(/\bnp\./g, '')
    .trim()
}

export function compile(src: string): EvalFunction | null {
  const key = normalizeExpr(src)
  if (cache.has(key)) return cache.get(key) ?? null
  let fn: EvalFunction | null = null
  try {
    fn = compileExpr(key)
  } catch {
    fn = null
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, fn)
  return fn
}

/** Evaluate a real-valued function of x; returns NaN where undefined or complex. */
export function makeFn(src: string, variable = 'x'): ((x: number) => number) | null {
  const c = compile(src)
  if (!c) return null
  const scope: Record<string, number> = {}
  return (x: number) => {
    scope[variable] = x
    try {
      const v = c.evaluate(scope) as unknown
      if (typeof v === 'number') return v
      if (v && typeof v === 'object' && 're' in (v as object)) {
        const z = v as { re: number; im: number }
        return Math.abs(z.im) < 1e-12 ? z.re : NaN
      }
      return Number(v)
    } catch {
      return NaN
    }
  }
}

/** Evaluate a constant expression like "1/3", "2^-3", "pi/4". */
export function evalNumber(src: string): number | null {
  if (src === null || src === undefined) return null
  const s = String(src).trim()
  if (!s) return null
  const direct = Number(s.replace(/,/g, '.'))
  if (!Number.isNaN(direct) && /^[-+]?[\d.,]+(e[-+]?\d+)?$/i.test(s)) return direct
  const c = compile(s.replace(/(\d),(\d)/g, '$1.$2'))
  if (!c) return null
  try {
    const v = c.evaluate({}) as unknown
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (v && typeof v === 'object' && 're' in (v as object)) {
      const z = v as { re: number; im: number }
      if (Math.abs(z.im) < 1e-12) return z.re
    }
    return null
  } catch {
    return null
  }
}
