import { describe, expect, it } from 'vitest'
import { applyAuth, authProblem, cliArgs, modelFor, type CliConfig } from '../../src/node/claudeCli'
import { addUsage, emptyUsage, formatUsd, looksLikeApiKey, normalizeUsage, usageKind, usageSummary } from '../../src/shared/usage'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
const cfg: CliConfig = { path: null, model: 'opus', effort: 'medium', fallbackModel: null, timeoutSec: 60, workDir: '/tmp/w', auth: 'subscription' }

describe('subscription or API credits', () => {
  it('defaults to the subscription', () => {
    expect(DEFAULT_SETTINGS.cli.auth).toBe('subscription')
    expect(DEFAULT_SETTINGS.tasks.map).toEqual({ provider: 'claude', model: '', effort: 'medium' })
  })

  it('passes the API key only when API credits are chosen', () => {
    const shell = { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-from-shell', CLAUDE_CODE_OAUTH_TOKEN: 'tok' }
    const sub = applyAuth(shell, { auth: 'subscription', apiKey: KEY })
    expect(sub.ANTHROPIC_API_KEY).toBeUndefined()
    expect(sub.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok')
    const api = applyAuth(shell, { auth: 'api-key', apiKey: KEY })
    expect(api.ANTHROPIC_API_KEY).toBe(KEY)
    expect(api.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(api.PATH).toBe('/bin')
    // the caller's environment is not changed
    expect(shell.ANTHROPIC_API_KEY).toBe('sk-ant-from-shell')
  })

  it('refuses to start on API credits without a key', () => {
    expect(authProblem({ auth: 'api-key', apiKey: null })).toMatch(/no API key/)
    expect(authProblem({ auth: 'api-key', apiKey: KEY })).toBeNull()
    expect(authProblem({ auth: 'subscription', apiKey: null })).toBeNull()
  })

  it('never puts the key on the command line', () => {
    const args = cliArgs({ id: 'r', kind: 'step', system: 's', prompt: 'p', schema: {} }, { ...cfg, auth: 'api-key', apiKey: KEY }, 'f')
    expect(args.join(' ')).not.toContain('sk-ant')
  })

  it('uses the request model, else the configured one', () => {
    expect(modelFor({ model: 'sonnet' }, cfg)).toBe('sonnet')
    expect(modelFor({}, cfg)).toBe('opus')
    const args = cliArgs({ id: 'r', kind: 'map', system: 's', prompt: 'p', schema: {}, model: 'haiku' }, cfg, 'f')
    expect(args[args.indexOf('--model') + 1]).toBe('haiku')
  })

  it('checks the shape of a key', () => {
    expect(looksLikeApiKey(KEY)).toBe(true)
    expect(looksLikeApiKey(`  ${KEY}\n`)).toBe(true)
    expect(looksLikeApiKey('sk-123')).toBe(false)
    expect(looksLikeApiKey('')).toBe(false)
  })
})

describe('cost of the calls', () => {
  it('adds calls per day, kind and account', () => {
    const d = new Date(2026, 10, 23, 15)
    let u = emptyUsage()
    u = addUsage(u, { at: d, kind: 'map', usd: 0.12, auth: 'api-key' })
    u = addUsage(u, { at: d, kind: 'chat', usd: 0.05, auth: 'api-key' })
    u = addUsage(u, { at: d, kind: 'step', usd: 0.03, auth: 'subscription' })
    u = addUsage(u, { at: d, kind: 'work', usd: null, auth: 'api-key' })
    u = addUsage(u, { at: new Date(2026, 9, 30), kind: 'grade', usd: 1, auth: 'api-key' })
    const s = usageSummary(u, d)
    expect(s.today.api).toBeCloseTo(0.17, 6)
    expect(s.today.subscription).toBeCloseTo(0.03, 6)
    expect(s.today.calls).toBe(4)
    expect(s.today.byKind.map).toBeCloseTo(0.12, 6)
    expect(s.today.byKind.tutor).toBeCloseTo(0.08, 6)
    expect(s.month.api).toBeCloseTo(0.17, 6)
    expect(s.last30.api).toBeCloseTo(1.17, 6)
    expect(usageKind('grade')).toBe('grading')
    expect(usageKind('test')).toBe('other')
  })

  it('reads a stored ledger defensively and keeps about a year', () => {
    expect(normalizeUsage(null)).toEqual(emptyUsage())
    const n = normalizeUsage({ days: { '2026-11-23': { api: 1, subscription: -2, calls: 2.4, byKind: { map: 1, nope: 3 } }, bad: { api: 1 } } })
    expect(n.days).toEqual({ '2026-11-23': { api: 1, subscription: 0, calls: 2, byKind: { map: 1 } } })
    let u = emptyUsage()
    for (let i = 0; i < 410; i++) u = addUsage(u, { at: new Date(2025, 0, 1 + i), kind: 'map', usd: 0.01, auth: 'api-key' })
    expect(Object.keys(u.days)).toHaveLength(400)
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.004)).toBe('$0.004')
    expect(formatUsd(12.3)).toBe('$12.30')
  })
})
