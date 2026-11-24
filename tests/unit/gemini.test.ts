import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileParts, generateBody, geminiError, runGemini, sseJson } from '../../src/node/gemini'
import { GeminiAgentHost, mergeParts, pushUser, settledHistory } from '../../src/node/geminiAgent'
import { geminiThinking, migrateSettings, normalizeTask, routeFor, taskOf, textGeminiModels } from '../../src/shared/models'
import type { AgentEvent } from '../../src/shared/agentTypes'
import { DEFAULT_SETTINGS, type LlmEvent, type Settings } from '../../src/shared/types'

/** A fetch that answers each call with the next scripted list of SSE events (or an HTTP error). */
function sseFetch(script: (Record<string, unknown>[] | { status: number; body: string })[]) {
  const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')), key: new Headers(init?.headers).get('x-goog-api-key') })
    const next = script.shift() ?? []
    if (!Array.isArray(next)) return new Response(next.body, { status: next.status })
    const text = next.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('')
    return new Response(new Blob([text]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return { f, calls }
}

const textChunk = (text: string, extra: Record<string, unknown> = {}) => ({ candidates: [{ content: { role: 'model', parts: [{ text, ...extra }] } }] })

describe('models per task', () => {
  it('maps request kinds to tasks and fills in models and efforts', () => {
    expect(taskOf('map')).toBe('map')
    expect(taskOf('work')).toBe('grading')
    expect(taskOf('grade')).toBe('grading')
    expect(taskOf('step')).toBe('tutor')
    expect(taskOf('chat')).toBe('tutor')
    const s = { tasks: { ...DEFAULT_SETTINGS.tasks, map: { provider: 'gemini' as const, model: '', effort: 'max' as const } } }
    expect(routeFor('map', s)).toEqual({ task: 'map', provider: 'gemini', model: 'gemini-3.8-flash', effort: 'high' })
    // grading on auto keeps what the app asks for
    expect(routeFor('work', s, 'high').effort).toBe('high')
    expect(routeFor('grade', s, 'low').effort).toBe('low')
    expect(routeFor('step', s, 'low')).toEqual({ task: 'tutor', provider: 'claude', model: '', effort: 'medium' })
  })

  it('carries older settings over once', () => {
    const m = migrateSettings({ cli: { model: 'opus', effort: 'high', mapModel: 'haiku' } }) as unknown as Settings
    expect(m.tasks.tutor).toEqual({ provider: 'claude', model: 'opus', effort: 'high' })
    expect(m.tasks.map.model).toBe('haiku')
    expect(m.tasks.grading).toEqual({ provider: 'claude', model: 'opus', effort: 'auto' })
    const already = { tasks: { tutor: { provider: 'gemini' } } }
    expect(migrateSettings(already)).toBe(already)
    expect(normalizeTask({ provider: 'x', effort: 'huge', model: 7 }, 'tutor')).toEqual(DEFAULT_SETTINGS.tasks.tutor)
  })

  it('turns efforts into Gemini thinking settings', () => {
    expect(geminiThinking('gemini-4-argon', 'xhigh')).toEqual({ thinkingLevel: 'high' })
    expect(geminiThinking('gemini-3.8-flash', 'low')).toEqual({ thinkingLevel: 'low' })
    expect(geminiThinking('gemini-2.5-pro', 'medium')).toEqual({ thinkingBudget: 8192 })
    expect(geminiThinking('gemini-3.8-flash', null)).toBeNull()
  })

  it('lists only text models', () => {
    const list = textGeminiModels([
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-4-argon', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] }
    ])
    expect(list).toEqual(['gemini-4-argon', 'gemini-3.8-flash'])
  })
})

describe('Gemini structured calls', () => {
  it('builds the request with the schema, thinking level and inline files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anam-gem-'))
    writeFileSync(join(dir, '01-a.png'), Buffer.from([1, 2, 3]))
    writeFileSync(join(dir, '02-b.txt'), 'my answer')
    writeFileSync(join(dir, '03-c.exe'), 'x')
    const parts = await fileParts([join(dir, '01-a.png'), join(dir, '02-b.txt'), join(dir, '03-c.exe')])
    expect(parts).toEqual([{ inlineData: { mimeType: 'image/png', data: 'AQID' } }, { text: 'File 02-b.txt:\nmy answer' }])
    const body = generateBody({ system: 'sys', prompt: 'p', schema: { $schema: 'x', type: 'object' } }, 'gemini-4-argon', 'medium', parts) as Record<string, any>
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] })
    expect(body.contents[0].parts).toHaveLength(3)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseJsonSchema).toEqual({ type: 'object' })
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('medium')
  })

  it('streams partial JSON and returns the parsed answer', async () => {
    const { f, calls } = sseFetch([[textChunk('{"cards": [{"t'), textChunk('ext": "hi"}]}'), { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }], usageMetadata: { totalTokenCount: 9 } }]])
    const events: LlmEvent[] = []
    const r = await runGemini({ id: 'r1', kind: 'step', system: 's', prompt: 'p', schema: {} }, { apiKey: 'k'.repeat(39), model: 'gemini-3.8-flash', effort: 'low', timeoutSec: 30, fetch: f }, (e) => events.push(e))
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ cards: [{ text: 'hi' }] })
    expect(calls[0].url).toContain('/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(calls[0].key).toBe('k'.repeat(39))
    expect(events.some((e) => e.type === 'partial')).toBe(true)
  })

  it('explains failures', async () => {
    expect(geminiError(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}').kind).toBe('auth')
    expect(geminiError(429, 'quota').kind).toBe('rate_limit')
    expect(geminiError(404, '{"error":{"message":"models/x is not found"}}').kind).toBe('not_found')
    expect(geminiError(500, '').kind).toBe('other')
    const noKey = await runGemini({ id: 'r', kind: 'step', system: 's', prompt: 'p', schema: {} }, { apiKey: null, model: 'm', effort: null, timeoutSec: 5 }, () => {})
    expect(noKey).toMatchObject({ ok: false, errorKind: 'auth' })
    const { f } = sseFetch([[textChunk('not json')]])
    const bad = await runGemini({ id: 'r', kind: 'step', system: 's', prompt: 'p', schema: {} }, { apiKey: 'k', model: 'm', effort: null, timeoutSec: 5, fetch: f }, () => {})
    expect(bad).toMatchObject({ ok: false, errorKind: 'invalid' })
  })

  it('reads server-sent events split across chunks', async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"a"'))
        c.enqueue(enc.encode(':1}\n\ndata: {"b":2}\n'))
        c.close()
      }
    })
    const out: unknown[] = []
    for await (const e of sseJson(stream)) out.push(e)
    expect(out).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('Gemini tutor agent', () => {
  it('keeps the conversation valid to send again', () => {
    expect(mergeParts([{ text: 'Hel' }, { text: 'lo' }, { text: '', thoughtSignature: 'sig' }, { functionCall: { name: 'ask', args: {} }, thoughtSignature: 's2' }, { text: 'th', thought: true }])).toEqual([
      { text: 'Hello', thoughtSignature: 'sig' },
      { functionCall: { name: 'ask', args: {} }, thoughtSignature: 's2' }
    ])
    const h = [
      { role: 'user' as const, parts: [{ text: 'hi' }] },
      { role: 'model' as const, parts: [{ functionCall: { name: 'ask' } }] }
    ]
    expect(settledHistory(h)).toHaveLength(1)
    const u = [{ role: 'user' as const, parts: [{ text: 'a' }] }]
    pushUser(u, [{ text: 'b' }])
    expect(u).toEqual([{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }])
  })

  it('runs tool calls through the app and answers in text', async () => {
    const { f, calls } = sseFetch([
      [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Let me ask. ' }, { functionCall: { name: 'ask', args: { q: 'x?' } }, thoughtSignature: 'sigA' }] } }] }],
      [textChunk('Well done.')]
    ])
    const dir = mkdtempSync(join(tmpdir(), 'anam-gchat-'))
    const host = new GeminiAgentHost()
    const events: AgentEvent[] = []
    const ended = new Promise<void>((resolve) => {
      void host.start(
        { chatId: 'c1', system: 'tutor', tools: [{ name: 'ask', description: 'Ask the learner', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }], resume: null, sessionId: 's1' },
        { apiKey: 'key', model: 'gemini-3.8-flash', effort: 'medium', historyDir: dir, fetch: f },
        (e) => {
          events.push(e)
          if (e.type === 'tool_call') setTimeout(() => host.toolResult('c1', e.callId, { text: 'the learner said 42' }), 0)
          if (e.type === 'status' && e.status === 'idle') resolve()
        }
      )
    })
    expect(host.send('c1', 'Teach me')).toBe(true)
    await ended
    const call = events.find((e) => e.type === 'tool_call')
    expect(call).toMatchObject({ name: 'ask', args: { q: 'x?' } })
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')
    expect(text).toBe('Let me ask. Well done.')
    expect(events.find((e) => e.type === 'turn_end')).toMatchObject({ ok: true })
    // the second call sends the tool result back, after the call with its signature
    const contents = calls[1].body.contents as { role: string; parts: Record<string, any>[] }[]
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(contents[1].parts[1]).toMatchObject({ functionCall: { name: 'ask' }, thoughtSignature: 'sigA' })
    expect(contents[2].parts[0]).toEqual({ functionResponse: { name: 'ask', response: { result: 'the learner said 42' } } })
    expect((calls[0].body.tools as any)[0].functionDeclarations[0].name).toBe('ask')
    expect((calls[0].body.generationConfig as any).thinkingConfig.thinkingLevel).toBe('medium')
    host.stop('c1')

    // a reopened chat continues the saved conversation
    const again = sseFetch([[textChunk('Welcome back.')]])
    const host2 = host
    let idle2: () => void = () => {}
    const done2 = new Promise<void>((resolve) => (idle2 = resolve))
    await host2.start(
      { chatId: 'c1', system: 'tutor', tools: [], resume: 's1', sessionId: 's1' },
      { apiKey: 'key', model: 'gemini-3.8-flash', effort: null, historyDir: dir, fetch: again.f },
      (e) => e.type === 'status' && e.status === 'idle' && idle2()
    )
    expect(host2.send('c1', 'Hi again')).toBe(true)
    await done2
    const c2 = again.calls[0].body.contents as { role: string }[]
    expect(c2.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user'])
    host2.stop('c1')
  })

  it('reports an error turn and refuses to start without a key', async () => {
    const host = new GeminiAgentHost()
    expect(await host.start({ chatId: 'c', system: '', tools: [], resume: null, sessionId: 's' }, { apiKey: null, model: 'm', effort: null, historyDir: tmpdir() }, () => {})).toMatchObject({ ok: false, errorKind: 'auth' })
    const { f } = sseFetch([{ status: 429, body: '{"error":{"message":"Resource exhausted"}}' }])
    const events: AgentEvent[] = []
    const idle = new Promise<void>((resolve) => {
      void host.start({ chatId: 'c', system: '', tools: [], resume: null, sessionId: 's2' }, { apiKey: 'k', model: 'm', effort: null, historyDir: mkdtempSync(join(tmpdir(), 'anam-g2-')), fetch: f }, (e) => {
        events.push(e)
        if (e.type === 'status' && e.status === 'idle') resolve()
      })
    })
    host.send('c', 'hi')
    await idle
    expect(events.find((e) => e.type === 'turn_end')).toMatchObject({ ok: false, errorKind: 'rate_limit' })
  })
})
