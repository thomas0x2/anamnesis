// Google Gemini as a model provider, over the Gemini API (generateContent, streamed as server-sent events).
// Structured calls send the app's JSON schema as responseJsonSchema; the learner's files go inline.
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { parsePartialJson } from '../shared/partialJson'
import { geminiThinking, textGeminiModels } from '../shared/models'
import type { Effort, LlmErrorKind, LlmEvent, LlmRequest, LlmResult, LlmTestResult } from '../shared/types'

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiConfig {
  apiKey: string | null
  model: string
  effort: Effort | null
  timeoutSec: number
  /** for tests */
  fetch?: typeof fetch
  base?: string
}

export type GeminiPart = {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string }
}
export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export const NO_KEY = 'Gemini is chosen in Settings, but no Google AI API key is saved. Add one under Settings → Models, or pick Claude for this task.'

/** What a failed HTTP call means for the app. */
export function geminiError(status: number, body: string): { kind: LlmErrorKind; message: string } {
  let msg = body
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } }
    if (j.error?.message) msg = j.error.message
  } catch {
    /* not JSON */
  }
  msg = msg.trim().slice(0, 500) || `HTTP ${status}`
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(body)) return { kind: 'auth', message: `Google rejected the API key: ${msg}` }
  if (status === 429) return { kind: 'rate_limit', message: `Gemini is busy or the quota is used up: ${msg}` }
  if (status === 404) return { kind: 'not_found', message: `Gemini does not know this model: ${msg}` }
  if (status === 400) return { kind: 'invalid', message: `Gemini refused the request: ${msg}` }
  return { kind: 'other', message: `Gemini error (${status}): ${msg}` }
}

/** Server-sent events: one JSON object per `data:` line. */
export async function* sseJson(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Record<string, unknown>> {
  if (!body) return
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        yield JSON.parse(data) as Record<string, unknown>
      } catch {
        /* a broken event is skipped */
      }
    }
    if (done) break
  }
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.md': 'text/plain'
}

/** Inline request data is limited to about 20 MB per request. */
export const MAX_INLINE_BYTES = 18 * 1024 * 1024

/** The learner's files as inline parts (text files as text). */
export async function fileParts(paths: string[]): Promise<GeminiPart[]> {
  const out: GeminiPart[] = []
  let total = 0
  for (const p of paths) {
    const mime = MIME[extname(p).toLowerCase()]
    if (!mime) continue
    total += (await stat(p)).size
    if (total > MAX_INLINE_BYTES) throw new Error('The files are too large to send to Gemini at once (about 18 MB in total). Send fewer or smaller files.')
    const bytes = await readFile(p)
    if (mime === 'text/plain') out.push({ text: `File ${p.split(/[\\/]/).pop()}:\n${bytes.toString('utf8')}` })
    else out.push({ inlineData: { mimeType: mime, data: bytes.toString('base64') } })
  }
  return out
}

/** JSON Schema as Gemini takes it ($schema and $id are not part of it). */
export function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, $id: _i, ...rest } = schema
  return rest
}

export function generateBody(req: Pick<LlmRequest, 'system' | 'prompt' | 'schema'>, model: string, effort: Effort | null, files: GeminiPart[] = []): Record<string, unknown> {
  const thinking = geminiThinking(model, effort)
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [{ text: req.prompt }, ...files] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: geminiSchema(req.schema),
      ...(thinking ? { thinkingConfig: { ...thinking, includeThoughts: false } } : {})
    }
  }
}

/** Text and thought parts of one streamed chunk, plus how it ended. */
export function chunkParts(ev: Record<string, unknown>): { parts: GeminiPart[]; finish: string | null; blocked: string | null; usage: Record<string, number> | null } {
  const c = (ev.candidates as { content?: { parts?: GeminiPart[] }; finishReason?: string }[] | undefined)?.[0]
  const blocked = (ev.promptFeedback as { blockReason?: string } | undefined)?.blockReason ?? null
  return { parts: c?.content?.parts ?? [], finish: c?.finishReason ?? null, blocked, usage: (ev.usageMetadata as Record<string, number>) ?? null }
}

const running = new Map<string, AbortController>()

export function cancelGemini(id: string): boolean {
  const c = running.get(id)
  c?.abort('cancelled')
  return !!c
}

export async function runGemini(req: LlmRequest, cfg: GeminiConfig, onEvent: (e: LlmEvent) => void): Promise<LlmResult> {
  const started = Date.now()
  if (!cfg.apiKey) return { id: req.id, ok: false, errorKind: 'auth', error: NO_KEY }
  const model = cfg.model
  let files: GeminiPart[]
  try {
    files = await fileParts(req.files ?? [])
  } catch (e) {
    return { id: req.id, ok: false, errorKind: 'invalid', error: String((e as Error).message ?? e) }
  }
  const ctl = new AbortController()
  running.set(req.id, ctl)
  const timeoutSec = Math.max(cfg.timeoutSec, req.timeoutSec ?? 0)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort('timeout')
  }, timeoutSec * 1000)
  const done = (r: Omit<LlmResult, 'id'>): LlmResult => ({ id: req.id, model, durationMs: Date.now() - started, ...r })
  try {
    const f = cfg.fetch ?? fetch
    const res = await f(`${cfg.base ?? GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(generateBody(req, model, req.effort ?? cfg.effort, files)),
      signal: ctl.signal
    })
    if (!res.ok) {
      const e = geminiError(res.status, await res.text().catch(() => ''))
      return done({ ok: false, errorKind: e.kind, error: e.message })
    }
    onEvent({ id: req.id, type: 'status', status: 'started' })
    let text = ''
    let thoughtChars = 0
    let finish: string | null = null
    let blocked: string | null = null
    let lastPartial = 0
    let writing = false
    for await (const ev of sseJson(res.body)) {
      const c = chunkParts(ev)
      if (c.blocked) blocked = c.blocked
      if (c.finish) finish = c.finish
      for (const p of c.parts) {
        if (typeof p.text !== 'string') continue
        if (p.thought) {
          thoughtChars += p.text.length
          onEvent({ id: req.id, type: 'thinking', tokens: Math.round(thoughtChars / 4) })
          continue
        }
        if (!writing) {
          writing = true
          onEvent({ id: req.id, type: 'status', status: 'writing' })
        }
        text += p.text
      }
      if (Date.now() - lastPartial > 150 && text) {
        lastPartial = Date.now()
        const pp = parsePartialJson(text)
        if (pp.value !== undefined) onEvent({ id: req.id, type: 'partial', partial: pp.value })
      }
    }
    if (blocked) return done({ ok: false, errorKind: 'invalid', error: `Gemini blocked the request (${blocked}).` })
    try {
      const data = JSON.parse(text)
      return done({ ok: true, data, costUsd: null })
    } catch {
      const why = finish === 'MAX_TOKENS' ? 'the answer was cut off (too long)' : finish && finish !== 'STOP' ? `it stopped (${finish})` : 'it was not valid JSON'
      return done({ ok: false, errorKind: 'invalid', error: `Gemini did not return the structured answer: ${why}.` })
    }
  } catch (e) {
    if (ctl.signal.aborted) return done(timedOut ? { ok: false, errorKind: 'timeout', error: `No answer within ${timeoutSec} s` } : { ok: false, errorKind: 'cancelled', error: 'Cancelled' })
    return done({ ok: false, errorKind: 'other', error: `Could not reach Gemini: ${String((e as Error)?.message ?? e)}` })
  } finally {
    clearTimeout(timer)
    running.delete(req.id)
  }
}

/** The text models the key can use (empty when the list cannot be read). */
export async function listGeminiModels(apiKey: string | null, f: typeof fetch = fetch, base = GEMINI_BASE): Promise<string[]> {
  if (!apiKey) return []
  try {
    const all: { name?: string; supportedGenerationMethods?: string[] }[] = []
    let page = ''
    for (let i = 0; i < 5; i++) {
      const res = await f(`${base}/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { 'x-goog-api-key': apiKey } })
      if (!res.ok) break
      const j = (await res.json()) as { models?: typeof all; nextPageToken?: string }
      all.push(...(j.models ?? []))
      if (!j.nextPageToken) break
      page = j.nextPageToken
    }
    return textGeminiModels(all)
  } catch {
    return []
  }
}

export async function testGemini(cfg: GeminiConfig): Promise<LlmTestResult> {
  if (!cfg.apiKey) return { ok: false, message: NO_KEY, path: null, version: null }
  const r = await runGemini(
    {
      id: `test_${Date.now()}`,
      kind: 'test',
      system: 'You are a connectivity check.',
      prompt: 'Reply with ok = true.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      effort: 'low'
    },
    { ...cfg, timeoutSec: 60 },
    () => {}
  )
  if (!r.ok) return { ok: false, message: `Gemini (${cfg.model}) failed a test call: ${r.error}`, path: null, version: cfg.model }
  return { ok: true, message: `Gemini ${cfg.model} is working (test call took ${((r.durationMs ?? 0) / 1000).toFixed(1)} s).`, path: null, version: cfg.model }
}
