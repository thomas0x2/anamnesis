// Small display helpers shared by the views.
import type { CardKind, ConceptStatus, Verdict } from '@shared/types'

export const pct = (x: number | null | undefined, digits = 0): string => (x === null || x === undefined || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(digits)}%`)

export const signedPts = (x: number | null | undefined): string => {
  if (x === null || x === undefined || Number.isNaN(x)) return '–'
  const v = Math.round(x * 100)
  return `${v > 0 ? '+' : ''}${v} pts`
}

export function plural(n: number, word: string, many = word + 's'): string {
  return `${n} ${n === 1 ? word : many}`
}

export function relTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  const d = (t - now.getTime()) / 1000
  const a = Math.abs(d)
  const fut = d > 0
  const fmt = (n: number, u: string): string => (fut ? `in ${n} ${u}` : `${n} ${u} ago`)
  if (a < 50) return fut ? 'in a moment' : 'just now'
  if (a < 3600) return fmt(Math.round(a / 60), 'min')
  if (a < 86400) return fmt(Math.round(a / 3600), a < 5400 ? 'hour' : 'hours')
  const days = Math.round(a / 86400)
  if (days === 1) return fut ? 'tomorrow' : 'yesterday'
  if (days < 45) return fmt(days, 'days')
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export const STATUS_LABEL: Record<ConceptStatus, string> = {
  unseen: 'Not started',
  introduced: 'Introduced',
  developing: 'Developing',
  proficient: 'Proficient',
  mastered: 'Mastered'
}

export const STATUS_HELP: Record<ConceptStatus, string> = {
  unseen: 'No evidence yet.',
  introduced: 'Seen in a lesson; little or weak evidence of understanding so far.',
  developing: 'More right than wrong, but not yet reliable.',
  proficient: 'Reliably right (≥80%, tight estimate) on items of level 3 or higher.',
  mastered: 'Proficient, retained over at least 3 separate days spanning 5+ days, level 4 solved, memory ≥80%.'
}

export const KIND_LABEL: Record<CardKind, string> = {
  probe: 'Probe',
  predict: 'Predict',
  explain: 'Explain',
  check: 'Check',
  practice: 'Practice',
  review: 'Review',
  reflect: 'Explain it back',
  summary: 'Summary',
  message: 'Plan'
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: 'Correct',
  partial: 'Partly right',
  incorrect: 'Not quite',
  dontknow: "Didn't know",
  seen: 'Noted'
}

export const LEVEL_LABEL = ['', 'Recall', 'Apply', 'Compose', 'Transfer', 'Exam']

export const CUE_LABEL: Record<string, string> = { familiar: 'familiar cue', shifted: 'shifted cue', novel: 'novel cue' }

/** Strip Markdown and LaTeX to something a speech engine can read. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (formula) ')
    .replace(/\$([^$]{1,40})\$/g, (_m, x: string) => x.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}_^]/g, ' '))
    .replace(/\$[^$]*\$/g, ' (formula) ')
    .replace(/[*_`#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
