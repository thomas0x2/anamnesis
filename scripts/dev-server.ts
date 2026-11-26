// HTTP backend so the UI can run in a normal browser (development, screenshots, the end-to-end test).
// It does what the Electron main process does: JSON storage, settings, the script PDF and the Claude Code CLI.
//
//   node_modules/.bin/jiti scripts/dev-server.ts
//   env: PORT (5318), ANAMNESIS_DATA_DIR (temp folder), ANAMNESIS_SCRIPT (path to the PDF),
//        ANAMNESIS_FAKE=1 (scripted tutor instead of the CLI)
//
// Listens on 127.0.0.1 only and refuses cross-site requests.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FakeAgentHost } from '../src/shared/fakeAgent'
import type { AgentEvent, AgentStartRequest, AgentToolResult } from '../src/shared/agentTypes'
import { Providers } from '../src/node/providers'
import { JsonStore, loadSettings, saveSettings } from '../src/node/store'
import { readMaterial, resolveWorkFiles, saveWork, scanPdfs } from '../src/node/files'
import { fakeGenerate } from '../src/shared/fakeTutor'
import type { LlmRequest, LlmResult } from '../src/shared/types'
import { fakeCapture } from '../src/shared/platform'

const port = Number(process.env.PORT ?? 5318)
const dataDir = resolve(process.env.ANAMNESIS_DATA_DIR ?? join(tmpdir(), 'anamnesis-dev'))
const scriptPath = process.env.ANAMNESIS_SCRIPT ? resolve(process.env.ANAMNESIS_SCRIPT) : null
const fake = process.env.ANAMNESIS_FAKE === '1'
let platformUrl: string | null = null
const store = new JsonStore(dataDir)
// the browser dev server has no keychain: API keys come from its own environment
const providers = new Providers({ dataDir: () => dataDir, key: (p) => (p === 'google' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY) || null })
const fakeAgents = new FakeAgentHost(120)
/** which host runs each chat (the provider can change between chats) */
const fakeChats = new Set<string>()
const ALLOWED_HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5317', 'localhost:5317'])


function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as T
}

/** Same-origin only: the Host must be ours (no DNS rebinding) and writes must be JSON (forces a CORS preflight we never answer). */
function allowed(req: IncomingMessage): boolean {
  if (!ALLOWED_HOSTS.has(String(req.headers.host ?? ''))) return false
  const origin = req.headers.origin
  if (origin && ![...ALLOWED_HOSTS].some((h) => origin === `http://${h}`)) return false
  if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return false
  return true
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (!allowed(req)) return send(res, 403, { error: 'forbidden' })
    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/info':
          return send(res, 200, { version: '0.1.0', dataDir, platform: process.platform, backend: 'http' })
        case 'GET /api/settings':
          return send(res, 200, await loadSettings(store))
        case 'PATCH /api/settings':
          return send(res, 200, await saveSettings(store, await body(req)))
        case 'GET /api/store':
          return send(res, 200, { data: await store.read(url.searchParams.get('name') ?? '') })
        case 'PUT /api/store':
          await store.write(url.searchParams.get('name') ?? '', await body(req))
          return send(res, 200, { ok: true })
        case 'GET /api/store-list':
          return send(res, 200, { names: await store.list(url.searchParams.get('prefix') ?? '') })
        case 'GET /api/script': {
          // 204, not 404: having no PDF is a normal state and should not log an error in the browser
          if (!scriptPath) {
            res.writeHead(204, { 'cache-control': 'no-store' })
            return res.end()
          }
          const data = await readFile(scriptPath)
          res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' })
          return res.end(data)
        }
        case 'GET /api/material': {
          const data = await readMaterial(store, await loadSettings(store), url.searchParams.get('course') ?? '', url.searchParams.get('id') ?? '', scriptPath)
          if (!data) {
            res.writeHead(204, { 'cache-control': 'no-store' })
            return res.end()
          }
          res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' })
          return res.end(data)
        }
        case 'POST /api/scan': {
          const { path } = await body<{ path: string }>(req)
          return send(res, 200, { files: typeof path === 'string' && path ? await scanPdfs(path) : null })
        }
        case 'POST /api/work': {
          const b = await body<{ course: string; id: string; files: { name: string; data: string }[] }>(req)
          const files = (b.files ?? []).map((f) => ({ name: String(f.name), bytes: new Uint8Array(Buffer.from(String(f.data), 'base64')) }))
          return send(res, 200, { files: await saveWork(dataDir, String(b.course), String(b.id), files) })
        }
        // the platform window exists only in the desktop app; in fake mode the server plays one with a scripted page
        case 'POST /api/platform/open': {
          const { url: page } = await body<{ url: string }>(req)
          if (fake && /^https?:\/\//i.test(String(page))) platformUrl = String(page)
          return send(res, 200, { ok: fake })
        }
        case 'GET /api/platform/status':
          return send(res, 200, { open: !!platformUrl, url: platformUrl, title: platformUrl ? 'Exercise 4: Lists · Code Expert' : null })
        case 'GET /api/platform/capture':
          return send(res, 200, { page: platformUrl ? fakeCapture(platformUrl, new Date()) : null })
        case 'POST /api/platform/sign-out':
          platformUrl = null
          return send(res, 200, { ok: true })
        case 'GET /api/test':
          if (fake) return send(res, 200, { ok: true, message: 'Dev server in fake mode: the scripted tutor answers.', path: null, version: null })
          return send(res, 200, await providers.test(await loadSettings(store)))
        case 'POST /api/cancel': {
          const { id } = await body<{ id: string }>(req)
          providers.cancel(id)
          return send(res, 200, { ok: true })
        }
        case 'POST /api/generate': {
          const r = await body<LlmRequest>(req)
          res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
          let open = true
          res.on('close', () => {
            if (open) providers.cancel(r.id)
          })
          const emit = (line: unknown): void => {
            if (!res.writableEnded) res.write(JSON.stringify(line) + '\n')
          }
          const settings = await loadSettings(store)
          const result: LlmResult = fake || settings.provider === 'demo' ? await fakeGenerate(r, (event) => emit({ event }), 120) : await providers.generate({ ...r, files: resolveWorkFiles(dataDir, r.files) }, settings, (event) => emit({ event }))
          open = false
          emit({ result })
          return res.end()
        }
        case 'POST /api/agent/start': {
          const r = await body<AgentStartRequest>(req)
          const settings = await loadSettings(store)
          const useFake = fake || settings.provider === 'demo'
          providers.agentStop(r.chatId)
          fakeAgents.stop(r.chatId)
          if (useFake) fakeChats.add(r.chatId)
          else fakeChats.delete(r.chatId)
          const stop = (id: string): void => (fakeChats.has(id) ? fakeAgents.stop(id) : providers.agentStop(id))
          res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
          const emit = (line: unknown): void => {
            if (!res.writableEnded) res.write(JSON.stringify(line) + '\n')
          }
          let alive = true
          res.on('close', () => {
            if (alive) stop(r.chatId)
          })
          const onEvent = (event: AgentEvent): void => {
            emit({ event })
            if (event.type === 'exit') {
              alive = false
              res.end()
            }
          }
          const started = useFake ? await fakeAgents.start(r, onEvent) : await providers.agentStart(r, settings, onEvent)
          emit({ started })
          if (!started.ok) {
            alive = false
            res.end()
          }
          return
        }
        case 'POST /api/agent/send': {
          const { chatId, text } = await body<{ chatId: string; text: string }>(req)
          return send(res, 200, { ok: fakeChats.has(chatId) ? fakeAgents.send(chatId, text) : providers.agentSend(chatId, text) })
        }
        case 'POST /api/agent/result': {
          const { chatId, callId, result } = await body<{ chatId: string; callId: string; result: AgentToolResult }>(req)
          return send(res, 200, { ok: fakeChats.has(chatId) ? fakeAgents.toolResult(chatId, callId, result) : providers.agentToolResult(chatId, callId, result) })
        }
        case 'POST /api/agent/stop': {
          const { chatId } = await body<{ chatId: string }>(req)
          if (fakeChats.has(chatId)) fakeAgents.stop(chatId)
          else providers.agentStop(chatId)
          return send(res, 200, { ok: true })
        }
        default:
          return send(res, 404, { error: 'not found' })
      }
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: String((e as Error)?.message ?? e) })
      else res.end()
    }
  })()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`anamnesis dev server on http://127.0.0.1:${port} · data ${dataDir}${scriptPath ? ` · script ${scriptPath}` : ''}${fake ? ' · fake tutor' : ''}`)
})
