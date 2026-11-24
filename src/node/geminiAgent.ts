// The tutor agent on Google Gemini: the same tools and events as the Claude agent (agent.ts), run as a
// function-calling loop over the Gemini API. The conversation is kept by the app (sent in full each call)
// and saved per chat, so a reopened chat continues.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { geminiThinking } from '../shared/models'
import type { AgentEvent, AgentStartRequest, AgentToolResult } from '../shared/agentTypes'
import type { Effort, LlmErrorKind } from '../shared/types'
import { chunkParts, GEMINI_BASE, geminiError, geminiSchema, NO_KEY, sseJson, type GeminiContent, type GeminiPart } from './gemini'

export interface GeminiAgentConfig {
  apiKey: string | null
  model: string
  effort: Effort | null
  /** where chats are saved (one JSON file per session id) */
  historyDir: string
  fetch?: typeof fetch
  base?: string
}

interface Run {
  req: AgentStartRequest
  cfg: GeminiAgentConfig
  emit: (e: AgentEvent) => void
  history: GeminiContent[]
  pending: Map<string, (r: AgentToolResult) => void>
  queue: string[]
  busy: boolean
  stopped: boolean
  ctl: AbortController | null
}

/** Most tool rounds in one turn before the agent is stopped (a runaway loop). */
const MAX_STEPS = 40

const safeId = (id: string): string => id.replace(/[^\w-]/g, '_').slice(0, 80)

/** Join streamed text pieces; keep function calls and thought signatures exactly as received. */
export function mergeParts(parts: GeminiPart[]): GeminiPart[] {
  const out: GeminiPart[] = []
  for (const p of parts) {
    if (p.thought) {
      // thought text is not needed later, but its signature is
      if (p.thoughtSignature) out.push({ text: '', thoughtSignature: p.thoughtSignature })
      continue
    }
    const prev = out[out.length - 1]
    if (typeof p.text === 'string' && !p.functionCall && prev && typeof prev.text === 'string' && !prev.functionCall && !prev.thoughtSignature) {
      prev.text += p.text
      if (p.thoughtSignature) prev.thoughtSignature = p.thoughtSignature
      continue
    }
    out.push({ ...p })
  }
  return out.filter((p) => p.functionCall || p.thoughtSignature || (typeof p.text === 'string' && p.text.length > 0) || p.inlineData)
}

/** A history that ends with unanswered function calls cannot be sent again: drop that last model turn. */
export function settledHistory(h: GeminiContent[]): GeminiContent[] {
  const out = [...h]
  while (out.length && out[out.length - 1].role === 'model' && out[out.length - 1].parts.some((p) => p.functionCall)) out.pop()
  return out
}

/** Add user parts, joining them to a user turn that is still open (Gemini expects turns to alternate). */
export function pushUser(h: GeminiContent[], parts: GeminiPart[]): void {
  const last = h[h.length - 1]
  if (last?.role === 'user') last.parts.push(...parts)
  else h.push({ role: 'user', parts })
}

export function agentBody(run: Pick<Run, 'req' | 'cfg' | 'history'>): Record<string, unknown> {
  const thinking = geminiThinking(run.cfg.model, run.req.effort ?? run.cfg.effort)
  return {
    systemInstruction: { parts: [{ text: run.req.system }] },
    contents: run.history,
    tools: [{ functionDeclarations: run.req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: geminiSchema(t.inputSchema) })) }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    ...(thinking ? { generationConfig: { thinkingConfig: { ...thinking, includeThoughts: false } } } : {})
  }
}

export class GeminiAgentHost {
  private runs = new Map<string, Run>()
  private calls = 0
  /** saves in flight per session, so a chat reopened right away reads the finished file */
  private saving = new Map<string, Promise<void>>()

  running(chatId: string): boolean {
    return this.runs.has(chatId)
  }

  async start(req: AgentStartRequest, cfg: GeminiAgentConfig, emit: (e: AgentEvent) => void): Promise<{ ok: boolean; error?: string; errorKind?: LlmErrorKind }> {
    this.stop(req.chatId)
    if (!cfg.apiKey) return { ok: false, errorKind: 'auth', error: NO_KEY }
    let history: GeminiContent[] = []
    if (req.resume) {
      await this.saving.get(safeId(req.resume))
      try {
        history = settledHistory(JSON.parse(await readFile(join(cfg.historyDir, `${safeId(req.resume)}.json`), 'utf8')) as GeminiContent[])
      } catch {
        history = []
      }
    }
    const run: Run = { req, cfg, emit, history, pending: new Map(), queue: [], busy: false, stopped: false, ctl: null }
    this.runs.set(req.chatId, run)
    emit({ chatId: req.chatId, type: 'status', status: 'starting' })
    emit({ chatId: req.chatId, type: 'status', status: 'ready', model: cfg.model })
    return { ok: true }
  }

  send(chatId: string, text: string): boolean {
    const run = this.runs.get(chatId)
    if (!run) return false
    if (run.busy) run.queue.push(text)
    else void this.turn(run, text)
    return true
  }

  toolResult(chatId: string, callId: string, result: AgentToolResult): boolean {
    const run = this.runs.get(chatId)
    const resolve = run?.pending.get(callId)
    if (!run || !resolve) return false
    run.pending.delete(callId)
    resolve(result)
    return true
  }

  stop(chatId: string): void {
    const run = this.runs.get(chatId)
    if (!run) return
    this.runs.delete(chatId)
    run.stopped = true
    run.ctl?.abort('stopped')
    for (const [id, resolve] of run.pending) {
      run.emit({ chatId, type: 'tool_cancel', callId: id })
      resolve({ text: 'cancelled', isError: true })
    }
    run.pending.clear()
    void this.save(run)
    run.emit({ chatId, type: 'exit' })
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
  }

  private save(run: Run): Promise<void> {
    const id = safeId(run.req.sessionId)
    const json = JSON.stringify(settledHistory(run.history))
    const next = (this.saving.get(id) ?? Promise.resolve())
      .then(async () => {
        await mkdir(run.cfg.historyDir, { recursive: true })
        await writeFile(join(run.cfg.historyDir, `${id}.json`), json, 'utf8')
      })
      .catch(() => {
        /* the chat continues; only a later resume loses context */
      })
    this.saving.set(id, next)
    void next.then(() => this.saving.get(id) === next && this.saving.delete(id))
    return next
  }

  private async turn(run: Run, text: string): Promise<void> {
    const chatId = run.req.chatId
    run.busy = true
    pushUser(run.history, [{ text }])
    let ended = false
    const end = (ok: boolean, error?: string, errorKind?: LlmErrorKind): void => {
      if (ended) return
      ended = true
      run.emit({ chatId, type: 'turn_end', ok, costUsd: null, ...(ok ? {} : { error, errorKind }) })
    }
    try {
      for (let step = 0; step < MAX_STEPS && !run.stopped; step++) {
        const r = await this.call(run)
        if (run.stopped) return
        if ('error' in r) return end(false, r.error, r.kind)
        run.history.push({ role: 'model', parts: r.parts })
        const calls = r.parts.filter((p) => p.functionCall)
        if (!calls.length) return end(true)
        const responses: GeminiPart[] = []
        for (const p of calls) {
          const fc = p.functionCall!
          const callId = `g${++this.calls}_${Date.now().toString(36)}`
          const args = fc.args ?? {}
          run.emit({ chatId, type: 'tool_input', toolUseId: callId, name: fc.name, json: JSON.stringify(args), done: true })
          const result = await new Promise<AgentToolResult>((resolve) => {
            run.pending.set(callId, resolve)
            run.emit({ chatId, type: 'tool_call', callId, name: fc.name, args })
          })
          if (run.stopped) return
          responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: result.isError ? { error: result.text } : { result: result.text } } })
        }
        pushUser(run.history, responses)
      }
      if (!run.stopped) end(false, `The tutor used tools ${MAX_STEPS} times in a row without answering; it was stopped.`, 'other')
    } finally {
      if (!run.stopped) {
        end(true)
        await this.save(run)
        run.busy = false
        run.emit({ chatId, type: 'status', status: 'idle' })
        const next = run.queue.shift()
        if (next !== undefined) void this.turn(run, next)
      }
    }
  }

  /** One model call: streams the text to the app and returns the model's parts. */
  private async call(run: Run): Promise<{ parts: GeminiPart[] } | { error: string; kind: LlmErrorKind }> {
    const chatId = run.req.chatId
    const ctl = new AbortController()
    run.ctl = ctl
    run.emit({ chatId, type: 'status', status: 'thinking' })
    try {
      const f = run.cfg.fetch ?? fetch
      const res = await f(`${run.cfg.base ?? GEMINI_BASE}/models/${encodeURIComponent(run.cfg.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': run.cfg.apiKey ?? '' },
        body: JSON.stringify(agentBody(run)),
        signal: ctl.signal
      })
      if (!res.ok) {
        const e = geminiError(res.status, await res.text().catch(() => ''))
        return { error: e.message, kind: e.kind }
      }
      const parts: GeminiPart[] = []
      const blockId = `g${++this.calls}`
      let writing = false
      let blocked: string | null = null
      for await (const ev of sseJson(res.body)) {
        const c = chunkParts(ev)
        if (c.blocked) blocked = c.blocked
        for (const p of c.parts) {
          parts.push(p)
          if (typeof p.text === 'string' && p.text && !p.thought && !p.functionCall) {
            if (!writing) {
              writing = true
              run.emit({ chatId, type: 'status', status: 'writing' })
            }
            run.emit({ chatId, type: 'text', blockId, delta: p.text })
          }
        }
      }
      if (blocked) return { error: `Gemini blocked the request (${blocked}).`, kind: 'invalid' }
      return { parts: mergeParts(parts) }
    } catch (e) {
      if (ctl.signal.aborted) return { error: 'Stopped', kind: 'cancelled' }
      return { error: `Could not reach Gemini: ${String((e as Error)?.message ?? e)}`, kind: 'other' }
    } finally {
      run.ctl = null
    }
  }
}
