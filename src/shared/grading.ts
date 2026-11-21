// Local grading for closed formats: instant feedback without a model call.
import { evalNumber } from './mathx'
import type { Interaction } from './types'

export interface LocalGrade {
  score: number
  verdict: 'correct' | 'partial' | 'incorrect'
  /** per-option or per-blank feedback to show */
  feedback: string[]
  detail?: Record<string, boolean>
}

const verdictOf = (s: number): LocalGrade['verdict'] => (s >= 0.999 ? 'correct' : s >= 0.5 ? 'partial' : 'incorrect')

export function gradeMcq(it: Interaction, selected: string[]): LocalGrade {
  const opts = it.options ?? []
  const correct = new Set(opts.filter((o) => o.correct).map((o) => o.id))
  const sel = new Set(selected)
  const feedback = opts.filter((o) => sel.has(o.id) && o.feedback).map((o) => o.feedback)
  if (!it.multi) {
    const ok = selected.length === 1 && correct.has(selected[0])
    return { score: ok ? 1 : 0, verdict: ok ? 'correct' : 'incorrect', feedback }
  }
  let tp = 0
  let fp = 0
  for (const s of sel) (correct.has(s) ? tp++ : fp++)
  const fn = correct.size - tp
  const score = correct.size === 0 ? (sel.size === 0 ? 1 : 0) : Math.max(0, (tp - fp) / correct.size)
  const exact = fp === 0 && fn === 0
  return { score: exact ? 1 : Math.min(score, 0.75), verdict: exact ? 'correct' : verdictOf(Math.min(score, 0.75)), feedback }
}

export function gradeNumeric(it: Interaction, input: string): LocalGrade {
  const expected = evalNumber(it.answer?.value ?? '')
  const got = evalNumber(input)
  if (expected === null) return { score: 0, verdict: 'incorrect', feedback: ['The answer key could not be evaluated.'] }
  if (got === null) return { score: 0, verdict: 'incorrect', feedback: ['That is not a number or an expression I can evaluate.'] }
  const tol = it.answer?.tolerance
  const relative = it.answer?.relative ?? false
  const scale = Math.max(Math.abs(expected), 1e-300)
  const err = Math.abs(got - expected)
  const ok =
    tol !== null && tol !== undefined && tol > 0 ? (relative ? err / scale <= tol : err <= tol) : err <= 1e-3 * Math.max(1, Math.abs(expected)) + 1e-12
  if (ok) return { score: 1, verdict: 'correct', feedback: [] }
  // close but not within tolerance (e.g. rounding) gets partial credit
  const rel = err / scale
  if (rel < 0.02) return { score: 0.5, verdict: 'partial', feedback: ['Close: check rounding or the last step.'] }
  if (Math.abs(got + expected) <= 1e-9 + 1e-3 * scale) return { score: 0, verdict: 'incorrect', feedback: ['Right magnitude, wrong sign.'] }
  return { score: 0, verdict: 'incorrect', feedback: [] }
}

/** Fraction of item pairs in the right relative order (1 = exact). */
export function gradeOrder(correctOrder: string[], given: string[]): LocalGrade {
  if (given.length !== correctOrder.length) return { score: 0, verdict: 'incorrect', feedback: [] }
  const pos = new Map(correctOrder.map((x, i) => [x, i]))
  let good = 0
  let total = 0
  for (let i = 0; i < given.length; i++)
    for (let j = i + 1; j < given.length; j++) {
      total++
      if ((pos.get(given[i]) ?? 0) < (pos.get(given[j]) ?? 0)) good++
    }
  const exact = given.every((x, i) => x === correctOrder[i])
  const score = exact ? 1 : total ? Math.min(0.75, good / total) : 0
  return { score, verdict: exact ? 'correct' : verdictOf(score), feedback: [] }
}

export function normalizeAnswer(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\*\*/g, '^')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^\$+|\$+$/g, '')
    .replace(/[;.]$/, '')
}

export function blankMatches(accepted: string[], value: string): boolean {
  const v = normalizeAnswer(value)
  if (!v) return false
  for (const a of accepted) {
    const n = normalizeAnswer(a)
    if (n === v) return true
    const x = evalNumber(a)
    const y = evalNumber(value)
    if (x !== null && y !== null && Math.abs(x - y) <= 1e-9 + 1e-6 * Math.abs(x)) return true
  }
  return false
}

export function gradeFill(it: Interaction, values: Record<string, string>): LocalGrade {
  const blanks = it.blanks ?? []
  if (!blanks.length) return { score: 0, verdict: 'incorrect', feedback: [] }
  const detail: Record<string, boolean> = {}
  let ok = 0
  for (const b of blanks) {
    const hit = blankMatches(b.accepted, values[b.id] ?? '')
    detail[b.id] = hit
    if (hit) ok++
  }
  const score = ok / blanks.length
  return { score, verdict: verdictOf(score), feedback: [], detail }
}
