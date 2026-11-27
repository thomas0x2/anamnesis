#!/usr/bin/env node
// Summarise the model call timings the app logs (logs/model-timing.jsonl in the data folder).
//   node scripts/timing-report.mjs [file] [--since 2026-11-27T10:00]
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const sinceAt = args.indexOf('--since')
const since = sinceAt >= 0 ? new Date(args[sinceAt + 1]) : null
const fileArg = args.find((a, i) => !a.startsWith('--') && (sinceAt < 0 || i !== sinceAt + 1))
const dataDir =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Anamnesis')
    : process.platform === 'win32'
      ? join(process.env.APPDATA ?? homedir(), 'Anamnesis')
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Anamnesis')
const file = fileArg ?? join(dataDir, 'logs', 'model-timing.jsonl')
if (!existsSync(file)) {
  console.error(`No timing log at ${file}. Use the tutor in the app first, or pass the file's path.`)
  process.exit(1)
}

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  })
  .filter((r) => r && (!since || new Date(r.at) >= since))

const BOOKKEEPING = new Set(['update_plan', 'update_learner', 'suggest_cheatsheet'])
const q = (xs, p) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (!s.length) return null
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const sec = (ms) => (ms === null ? '   -' : `${(ms / 1000).toFixed(1).padStart(4)} s`)
const groupBy = (xs, key) => xs.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]), new Map())

const agent = rows.filter((r) => r.type === 'agent')
console.log(`Tutor round trips (${agent.length}; median and 90th percentile)`)
for (const [k, rs] of groupBy(agent, (r) => `${r.provider} ${r.model ?? ''}`.trim())) {
  const prompt = rs.reduce((a, r) => a + (r.promptTokens ?? 0), 0)
  const cached = rs.reduce((a, r) => a + (r.cachedTokens ?? 0), 0)
  const book = rs.filter((r) => r.tools?.length && r.tools.every((t) => BOOKKEEPING.has(t))).length
  console.log(`  ${k}: ${rs.length} calls`)
  console.log(`    first output ${sec(q(rs.map((r) => r.firstMs), 0.5))}  (p90 ${sec(q(rs.map((r) => r.firstMs), 0.9))})`)
  console.log(`    whole call   ${sec(q(rs.map((r) => r.totalMs), 0.5))}  (p90 ${sec(q(rs.map((r) => r.totalMs), 0.9))})`)
  console.log(`    prompt cached ${prompt ? Math.round((100 * cached) / prompt) : 0}% of ${Math.round(prompt / Math.max(1, rs.length))} tokens per call`)
  console.log(`    bookkeeping-only round trips: ${book} (${Math.round((100 * book) / rs.length)}%)`)
}
const calls = rows.filter((r) => r.type === 'call')
if (calls.length) {
  console.log(`\nSide calls (${calls.length})`)
  for (const [k, rs] of groupBy(calls, (r) => `${r.kind} on ${r.provider} ${r.model ?? ''}`.trim()))
    console.log(`  ${k}: ${rs.length} calls, median ${sec(q(rs.map((r) => r.totalMs), 0.5))}, first output ${sec(q(rs.map((r) => r.firstMs), 0.5))}`)
}
