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
import { cancelClaude, runClaude, testClaude, type CliConfig } from '../src/node/claudeCli'
import { JsonStore, loadSettings, saveSettings } from '../src/node/store'
import { fakeGenerate } from '../src/shared/fakeTutor'
import type { LlmRequest, LlmResult, Settings } from '../src/shared/types'

const port = Number(process.env.PORT ?? 5318)
const dataDir = resolve(process.env.ANAMNESIS_DATA_DIR ?? join(tmpdir(), 'anamnesis-dev'))
const scriptPath = process.env.ANAMNESIS_SCRIPT ? resolve(process.env.ANAMNESIS_SCRIPT) : null
const fake = process.env.ANAMNESIS_FAKE === '1'
const store = new JsonStore(dataDir)
const ALLOWED_HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5317', 'localhost:5317'])

const cliConfig = (s: Settings): CliConfig => ({ ...s.cli, workDir: join(dataDir, 'claude-workdir') })

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
          if (!scriptPath) return send(res, 404, { error: 'no script configured (set ANAMNESIS_SCRIPT)' })
          const data = await readFile(scriptPath)
          res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' })
          return res.end(data)
        }
        case 'GET /api/test':
          if (fake) return send(res, 200, { ok: true, message: 'Dev server in fake mode: the scripted tutor answers.', path: null, version: null })
          return send(res, 200, await testClaude(cliConfig(await loadSettings(store))))
        case 'POST /api/cancel': {
          const { id } = await body<{ id: string }>(req)
          cancelClaude(id)
          return send(res, 200, { ok: true })
        }
        case 'POST /api/generate': {
          const r = await body<LlmRequest>(req)
          res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
          let open = true
          res.on('close', () => {
            if (open) cancelClaude(r.id)
          })
          const emit = (line: unknown): void => {
            if (!res.writableEnded) res.write(JSON.stringify(line) + '\n')
          }
          const settings = await loadSettings(store)
          const result: LlmResult = fake || settings.provider === 'demo' ? await fakeGenerate(r, (event) => emit({ event }), 120) : await runClaude(r, cliConfig(settings), (event) => emit({ event }))
          open = false
          emit({ result })
          return res.end()
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
