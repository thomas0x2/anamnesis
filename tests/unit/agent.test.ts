/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import courseJson from '../../courses/numcs/course.json'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentHost, agentArgs } from '../../src/node/agent'
import type { TimingRecord } from '../../src/node/timing'
import { McpBridge } from '../../src/node/mcpBridge'
import { AGENT_TOOLS, buildAgentSystemPrompt } from '../../src/shared/agentTools'
import type { AgentEvent } from '../../src/shared/agentTypes'
import { FakeAgentHost } from '../../src/shared/fakeAgent'
import { CourseGraph } from '../../src/shared/graph'
import type { Course } from '../../src/shared/types'

const course = courseJson as Course
const graph = new CourseGraph(course)

async function rpc(url: string, token: string | null, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
}

describe('MCP bridge', () => {
  it('lists tools, rejects bad tokens, and holds a tool call open until the app answers', async () => {
    const bridge = new McpBridge()
    let release: (() => void) | null = null
    const ep = await bridge.register('chat-1', AGENT_TOOLS, (name, args) => new Promise((resolve) => (release = () => resolve({ text: `${name}:${JSON.stringify(args)}` }))))
    try {
      expect((await rpc(ep.url, 'wrong', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
      const init: any = await (await rpc(ep.url, ep.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json()
      expect(init.result.serverInfo.name).toBe('anamnesis')
      expect((await rpc(ep.url, ep.token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
      const list: any = await (await rpc(ep.url, ep.token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
      expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('ask')

      const pending = rpc(ep.url, ep.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask', arguments: { kind: 'check' } } })
      await new Promise((r) => setTimeout(r, 50))
      expect(release).not.toBeNull()
      release!()
      const res = await pending
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const text = await res.text()
      const data = JSON.parse(/data: (.*)/.exec(text)![1])
      expect(data.id).toBe(3)
      expect(data.result.content[0].text).toBe('ask:{"kind":"check"}')

      const unknown: any = await (await rpc(ep.url, ep.token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } })).json()
      expect(unknown.error.code).toBe(-32602)
    } finally {
      bridge.close()
    }
  })
})

describe('agent CLI arguments', () => {
  it('disables built-in tools, allows only the app server, and resumes by session id', () => {
    const cfg = { path: null, model: '', effort: 'medium' as const, fallbackModel: null, timeoutSec: 60, workDir: '/tmp' }
    const ep = { url: 'http://127.0.0.1:1/mcp/x', token: 't', close: () => {} }
    const base = { chatId: 'x', system: 's', tools: AGENT_TOOLS, sessionId: 'sid' }
    const a = agentArgs({ ...base, resume: null }, cfg, '/tmp/sys.txt', ep)
    expect(a[a.indexOf('--tools') + 1]).toBe('')
    expect(a[a.indexOf('--allowedTools') + 1]).toBe('mcp__anamnesis')
    expect(a).toContain('--strict-mcp-config')
    expect(a[a.indexOf('--session-id') + 1]).toBe('sid')
    const mcp = JSON.parse(a[a.indexOf('--mcp-config') + 1])
    expect(mcp.mcpServers.anamnesis.headers.Authorization).toBe('Bearer t')
    const r = agentArgs({ ...base, resume: 'sid' }, cfg, '/tmp/sys.txt', ep)
    expect(r[r.indexOf('--resume') + 1]).toBe('sid')
    expect(r).not.toContain('--session-id')
  })
})

// A stand-in for the Claude Code CLI: answers each stream-json user message with one streamed text message.
const FAKE_CLI = `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('env.json', JSON.stringify({ traffic: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, memory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, mds: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS }))
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
out({ type: 'system', subtype: 'init', model: 'claude-test' })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    buf = buf.slice(nl + 1)
    const ev = (event) => out({ type: 'stream_event', event })
    ev({ type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } } })
    setTimeout(() => {
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi.' } })
      ev({ type: 'content_block_stop', index: 0 })
      ev({ type: 'message_delta', usage: { output_tokens: 7 } })
      ev({ type: 'message_stop' })
      out({ type: 'result', subtype: 'success', is_error: false, result: 'Hi.', num_turns: 1 })
    }, 20)
  }
})
process.stdin.on('end', () => process.exit(0))
`

describe('agent host', () => {
  it('starts the CLI without Claude Code extras, streams the reply and times each model round trip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anam-agent-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, FAKE_CLI)
    chmodSync(bin, 0o755)
    const timings: TimingRecord[] = []
    const host = new AgentHost()
    const events: AgentEvent[] = []
    const done = new Promise<void>((resolve) => {
      void host
        .start(
          { chatId: 'c', system: 'tutor', tools: [], resume: null, sessionId: 's' },
          { path: bin, model: '', effort: 'low', fallbackModel: null, timeoutSec: 60, workDir: dir, timing: (r) => timings.push(r) },
          (e) => {
            events.push(e)
            if (e.type === 'turn_end') resolve()
          }
        )
        .then((r) => {
          expect(r.ok).toBe(true)
          host.send('c', 'hello')
        })
    })
    await done
    host.stopAll()
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Hi.')
    expect(JSON.parse(readFileSync(join(dir, 'env.json'), 'utf8'))).toEqual({ traffic: '1', memory: '1', mds: '1' })
    expect(timings).toHaveLength(1)
    expect(timings[0]).toMatchObject({ type: 'agent', provider: 'claude', model: 'claude-test', chatId: 'c', promptTokens: 5010, cachedTokens: 5000, outputTokens: 7, tools: [], ok: true })
    expect(timings[0].firstMs).toBeGreaterThanOrEqual(15)
  })
})

describe('agent system prompt', () => {
  it('carries the doctrine, the tools flow and the goal, without the JSON-output framing', () => {
    const goal = course.concepts.find((c) => c.requires.length > 0)!
    const p = buildAgentSystemPrompt(course, graph, { profile: [], concepts: {} }, { mode: 'learn', goalConceptId: goal.id, scope: [goal.id] }, new Date())
    expect(p).toContain('# How you teach')
    expect(p).toContain('# Widget kit')
    expect(p).toContain('# Built-in demos')
    expect(p).toContain(`Goal concept: ${goal.title} (id ${goal.id})`)
    expect(p).toContain('ask: one question')
    // bookkeeping goes with the next card instead of costing a round trip of its own
    expect(p).toContain('go in the same response as the next card')
    expect(p).not.toContain('Exactly one JSON object')
    expect(p).not.toContain('You never chat freely')
    expect(p).not.toContain('Mode: OPEN')
  })
})

describe('agent system prompt for practice', () => {
  it('lists the items the app selected, numbered for the ask tool', () => {
    const ids = course.concepts.slice(0, 2).map((c) => c.id)
    const queue = ids.map((conceptId) => ({ conceptId, level: 2 as const, cue: 'familiar' as const, mode: 'apply' as const, compose: [] }))
    const p = buildAgentSystemPrompt(course, graph, { profile: [], concepts: {} }, { mode: 'practice', goalConceptId: null, scope: ids, queue: queue as any }, new Date())
    expect(p).toContain('Mode: PRACTICE.')
    expect(p).toContain(`1. ${ids[0]} (`)
    expect(p).toContain(`2. ${ids[1]} (`)
    expect(p).not.toContain('Mode: OPEN')
  })
})

describe('scripted agent', () => {
  it('drives a learn session through the same tools the real agent uses', async () => {
    const host = new FakeAgentHost(1)
    const events: AgentEvent[] = []
    const names: string[] = []
    await host.start({ chatId: 'c', system: 'Mode: LEARN. Goal concept: X (id lagrange).', tools: AGENT_TOOLS, resume: null, sessionId: 's' }, (e) => {
      events.push(e)
      if (e.type === 'tool_call') {
        names.push(e.name)
        // every tool is answered at once, as if the learner clicked through
        queueMicrotask(() => host.toolResult('c', e.callId, { text: e.name === 'ask' ? 'The learner answered x, ✓ correct.' : 'ok' }))
      }
    })
    host.send('c', 'start')
    for (let i = 0; i < 400 && !events.some((e) => e.type === 'turn_end'); i++) await new Promise((r) => setTimeout(r, 5))
    expect(events.some((e) => e.type === 'turn_end' && e.ok)).toBe(true)
    expect(names).toContain('show_plan')
    expect(names).toContain('finish')
    expect(names.filter((n) => n === 'ask').length).toBeGreaterThan(3)
    for (const n of names) expect(AGENT_TOOLS.some((t) => t.name === n)).toBe(true)
    host.stop('c')
    expect(events.at(-1)?.type).toBe('exit')
  })
})
