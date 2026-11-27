// How long model calls take, one JSON line per call in <data>/logs/model-timing.jsonl, so the tutor's
// speed can be measured on real sessions (scripts/timing-report.mjs summarises the file).
// Only timings, token counts and tool names are written: never prompts, answers or keys.
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface TimingRecord {
  /** agent: one model call of the tutor agent; call: a structured one-shot call (grading, maps, steps) */
  type: 'agent' | 'call'
  provider: 'claude' | 'gemini'
  model: string | null
  /** request kind of a one-shot call, chat id of an agent call */
  kind?: string
  chatId?: string
  /** time to the first streamed output (text, thought or tool input), ms */
  firstMs?: number | null
  totalMs: number
  /** model round trips inside this record (a Claude agent turn can hold several) */
  rounds?: number
  promptTokens?: number | null
  cachedTokens?: number | null
  outputTokens?: number | null
  /** tools the model called in this round trip */
  tools?: string[]
  ok: boolean
}

const MAX_BYTES = 2 * 1024 * 1024

export type TimingLog = (r: TimingRecord) => void

/** A logger that appends to <dataDir>/logs/model-timing.jsonl (rotated at 2 MB); failures are ignored. */
export function timingLog(dataDir: () => string): TimingLog {
  let chain: Promise<void> = Promise.resolve()
  return (r) => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n'
    chain = chain
      .then(async () => {
        const dir = join(dataDir(), 'logs')
        const file = join(dir, 'model-timing.jsonl')
        await mkdir(dir, { recursive: true })
        const size = await stat(file).then((s) => s.size, () => 0)
        if (size > MAX_BYTES) await rename(file, join(dir, 'model-timing.old.jsonl')).catch(() => {})
        await appendFile(file, line, 'utf8')
      })
      .catch(() => {
        /* timing is optional */
      })
  }
}

const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** Token counts from Gemini's usageMetadata. */
export function geminiUsage(u: Record<string, number> | null): Pick<TimingRecord, 'promptTokens' | 'cachedTokens' | 'outputTokens'> {
  if (!u) return {}
  const out = n(u.candidatesTokenCount)
  const thoughts = n(u.thoughtsTokenCount)
  return { promptTokens: n(u.promptTokenCount), cachedTokens: n(u.cachedContentTokenCount) ?? 0, outputTokens: out === null && thoughts === null ? null : (out ?? 0) + (thoughts ?? 0) }
}

/** Token counts from a Claude Code result message's usage. */
export function claudeUsage(u: unknown): Pick<TimingRecord, 'promptTokens' | 'cachedTokens' | 'outputTokens'> {
  if (!u || typeof u !== 'object') return {}
  const x = u as Record<string, unknown>
  const input = n(x.input_tokens) ?? 0
  const read = n(x.cache_read_input_tokens) ?? 0
  const created = n(x.cache_creation_input_tokens) ?? 0
  return { promptTokens: input + read + created, cachedTokens: read, outputTokens: n(x.output_tokens) }
}
