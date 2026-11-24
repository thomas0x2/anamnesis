/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import courseJson from '../../courses/numcs/course.json'
import { agentArgs } from '../../src/node/agent'
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

describe('agent system prompt', () => {
  it('carries the doctrine, the tools flow and the goal, without the JSON-output framing', () => {
    const goal = course.concepts.find((c) => c.requires.length > 0)!
    const p = buildAgentSystemPrompt(course, graph, { profile: [], concepts: {} }, { mode: 'learn', goalConceptId: goal.id, scope: [goal.id] }, new Date())
    expect(p).toContain('# How you teach')
    expect(p).toContain('# Widget kit')
    expect(p).toContain('# Built-in demos')
    expect(p).toContain(`Goal concept: ${goal.title} (id ${goal.id})`)
    expect(p).toContain('ask: one question')
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
