// What the model calls cost, as Claude Code reports it (total_cost_usd), kept per day and kind of work.
// With an API key this is what the API bills; with a subscription it is what the same calls would cost on the API.
import type { ClaudeAuth } from './types'

export type UsageKind = 'tutor' | 'map' | 'grading' | 'other'
const KINDS: UsageKind[] = ['tutor', 'map', 'grading', 'other']

export interface UsageDay {
  /** spend on the API key */
  api: number
  /** API-equivalent cost of calls on the subscription */
  subscription: number
  calls: number
  byKind: Partial<Record<UsageKind, number>>
}

export interface UsageLedger {
  version: 1
  days: Record<string, UsageDay>
}

export const emptyUsage = (): UsageLedger => ({ version: 1, days: {} })
const emptyDay = (): UsageDay => ({ api: 0, subscription: 0, calls: 0, byKind: {} })

/** The kind of work behind a request kind (see LlmKind). */
export function usageKind(kind: string): UsageKind {
  if (kind === 'step' || kind === 'chat' || kind === 'tutor') return 'tutor'
  if (kind === 'map') return 'map'
  if (kind === 'grade' || kind === 'work' || kind === 'grading') return 'grading'
  return 'other'
}

export const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)

export function normalizeUsage(raw: unknown): UsageLedger {
  const days = (raw as UsageLedger | null)?.days
  const out = emptyUsage()
  if (!days || typeof days !== 'object') return out
  for (const [k, v] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue
    const byKind: UsageDay['byKind'] = {}
    for (const kind of KINDS) if (num(v.byKind?.[kind])) byKind[kind] = num(v.byKind?.[kind])
    out.days[k] = { api: num(v.api), subscription: num(v.subscription), calls: Math.round(num(v.calls)), byKind }
  }
  return out
}

/** Add one call's cost. Calls without a reported cost still count as calls. Keeps the last 400 days. */
export function addUsage(ledger: UsageLedger, e: { at: Date; kind: string; usd: number | null | undefined; auth: ClaudeAuth }): UsageLedger {
  const k = dayKey(e.at)
  const usd = num(e.usd)
  const d = ledger.days[k] ?? emptyDay()
  const kind = usageKind(e.kind)
  const next: UsageDay = {
    api: d.api + (e.auth === 'api-key' ? usd : 0),
    subscription: d.subscription + (e.auth === 'subscription' ? usd : 0),
    calls: d.calls + 1,
    byKind: { ...d.byKind, [kind]: (d.byKind[kind] ?? 0) + usd }
  }
  const keep = Object.keys({ ...ledger.days, [k]: next }).sort().slice(-400)
  const days: Record<string, UsageDay> = {}
  for (const key of keep) days[key] = key === k ? next : ledger.days[key]
  return { version: 1, days }
}

export interface UsageSummary {
  today: UsageDay
  month: UsageDay
  /** the last 30 days, including today */
  last30: UsageDay
}

function addDays(a: UsageDay, b: UsageDay): UsageDay {
  const byKind = { ...a.byKind }
  for (const kind of KINDS) if (b.byKind[kind]) byKind[kind] = (byKind[kind] ?? 0) + (b.byKind[kind] ?? 0)
  return { api: a.api + b.api, subscription: a.subscription + b.subscription, calls: a.calls + b.calls, byKind }
}

export function usageSummary(ledger: UsageLedger, now: Date): UsageSummary {
  const today = dayKey(now)
  const month = today.slice(0, 7)
  const from = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
  const out: UsageSummary = { today: emptyDay(), month: emptyDay(), last30: emptyDay() }
  for (const [k, d] of Object.entries(ledger.days)) {
    if (k === today) out.today = addDays(out.today, d)
    if (k.startsWith(month)) out.month = addDays(out.month, d)
    if (k >= from && k <= today) out.last30 = addDays(out.last30, d)
  }
  return out
}

/** "$0", "$0.004", "$12.30" */
export function formatUsd(x: number): string {
  if (x <= 0) return '$0'
  if (x < 0.01) return `$${x.toFixed(3)}`
  return `$${x.toFixed(2)}`
}

/** A plausible Anthropic API key (format check only; the test call proves it works). */
export function looksLikeApiKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())
}
