// Runs the Claude Code CLI in print mode as the model provider.
//   claude -p --output-format stream-json --include-partial-messages --json-schema <schema>
//          --system-prompt-file <file> --tools "" ...
// The structured result arrives as a StructuredOutput tool call; its input streams as
// input_json_delta events, which we forward as partial JSON so cards can render early.
import { spawn, execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { parsePartialJson } from '../shared/partialJson'
import type { Effort, LlmErrorKind, LlmEvent, LlmRequest, LlmResult, LlmTestResult } from '../shared/types'

export interface CliConfig {
  path: string | null
  model: string
  effort: Effort
  fallbackModel: string | null
  timeoutSec: number
  /** empty working directory, so no project CLAUDE.md is picked up */
  workDir: string
}

let loginShellPath: string | null | undefined

function shellPath(): Promise<string | null> {
  if (loginShellPath !== undefined) return Promise.resolve(loginShellPath)
  if (process.platform === 'win32') return Promise.resolve((loginShellPath = null))
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 6000 }, (err, stdout) => {
      const m = /__P__(.*)__P__/s.exec(String(stdout ?? ''))
      loginShellPath = err || !m ? null : m[1]
      resolve(loginShellPath)
    })
  })
}

function candidates(): string[] {
  const h = homedir()
  const out = [
    join(h, '.claude', 'local', 'claude'),
    join(h, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(h, '.npm-global', 'bin', 'claude'),
    join(h, '.volta', 'bin', 'claude'),
    join(h, '.bun', 'bin', 'claude'),
    '/usr/bin/claude'
  ]
  try {
    const nvm = join(h, '.nvm', 'versions', 'node')
    for (const v of readdirSync(nvm)) out.push(join(nvm, v, 'bin', 'claude'))
  } catch {
    /* no nvm */
  }
  return out
}

export async function buildEnv(claudePath: string | null): Promise<NodeJS.ProcessEnv> {
  const parts = new Set<string>()
  if (claudePath) parts.add(dirname(claudePath))
  const sp = await shellPath()
  for (const p of (sp ?? '').split(delimiter)) if (p) parts.add(p)
  for (const p of (process.env.PATH ?? '').split(delimiter)) if (p) parts.add(p)
  for (const p of ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), '/usr/bin', '/bin']) parts.add(p)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [...parts].join(delimiter) }
  // never let the Electron runtime leak into a node-based CLI
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  return env
}

export async function resolveClaudePath(explicit: string | null): Promise<string | null> {
  if (explicit && existsSync(explicit)) return explicit
  const env = await buildEnv(null)
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    const p = join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')
    if (existsSync(p)) return p
  }
  for (const p of candidates()) if (existsSync(p)) return p
  return null
}

function classify(text: string): LlmErrorKind {
  if (/ENOENT|not found|no such file/i.test(text)) return 'not_found'
  if (/log ?in|logged out|auth|credential|unauthori[sz]ed|401|oauth|api key/i.test(text)) return 'auth'
  if (/rate.?limit|429|overloaded|usage limit|quota|529/i.test(text)) return 'rate_limit'
  if (/timed? ?out|timeout/i.test(text)) return 'timeout'
  return 'other'
}

export function cliArgs(req: LlmRequest, cfg: CliConfig, systemFile: string): string[] {
  // the learner's own files (absolute paths, checked by the caller): the model may only read them
  const files = req.files ?? []
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--json-schema',
    JSON.stringify(req.schema),
    '--system-prompt-file',
    systemFile,
    '--tools',
    files.length ? 'Read' : '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--effort',
    req.effort || cfg.effort || 'medium'
  ]
  // no model given: Claude Code uses the learner's own default
  const model = (req.model || cfg.model || '').trim()
  if (model) args.push('--model', model)
  const fb = (cfg.fallbackModel || '').trim()
  if (fb && fb !== model) args.push('--fallback-model', fb)
  // reads inside the added folder need no approval; anything else is denied in print mode
  if (files.length) args.push('--add-dir', ...new Set(files.map((f) => dirname(f))))
  return args
}

interface Running {
  kill: () => void
}
const running = new Map<string, Running>()

export function cancelClaude(id: string): void {
  running.get(id)?.kill()
}

export async function runClaude(req: LlmRequest, cfg: CliConfig, onEvent: (e: LlmEvent) => void): Promise<LlmResult> {
  const started = Date.now()
  const bin = await resolveClaudePath(cfg.path)
  if (!bin) {
    return {
      id: req.id,
      ok: false,
      errorKind: 'not_found',
      error: 'Claude Code CLI not found. Install it (https://docs.claude.com/claude-code) or set its path in Settings.'
    }
  }
  await mkdir(join(cfg.workDir, 'prompts'), { recursive: true })
  const sysFile = join(cfg.workDir, 'prompts', `${req.id.replace(/[^\w-]/g, '_')}.txt`)
  await writeFile(sysFile, req.system, 'utf8')
  const env = await buildEnv(bin)

  return new Promise<LlmResult>((resolve) => {
    const child = spawn(bin, cliArgs(req, cfg, sysFile), { cwd: cfg.workDir, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let settled = false
    let buf = ''
    let stderr = ''
    let json = ''
    let capturing = false
    let lastPartialAt = 0
    let thinkingChars = 0
    let resultModel: string | null = null

    const finish = (r: LlmResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(req.id)
      void rm(sysFile, { force: true })
      resolve({ durationMs: Date.now() - started, model: resultModel, ...r })
    }
    const kill = (): void => {
      try {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 3000)
      } catch {
        /* already gone */
      }
    }
    running.set(req.id, {
      kill: () => {
        kill()
        finish({ id: req.id, ok: false, errorKind: 'cancelled', error: 'Cancelled' })
      }
    })
    const timeoutSec = Math.max(20, cfg.timeoutSec, req.timeoutSec ?? 0)
    const timer = setTimeout(() => {
      kill()
      finish({ id: req.id, ok: false, errorKind: 'timeout', error: `No answer within ${timeoutSec} s` })
    }, timeoutSec * 1000)

    const emitPartial = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastPartialAt < 150) return
      lastPartialAt = now
      const p = parsePartialJson(json)
      if (p.value !== undefined) onEvent({ id: req.id, type: 'partial', partial: p.value })
    }

    const handle = (line: string): void => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      const type = msg.type
      if (type === 'system' && msg.subtype === 'init') {
        resultModel = typeof msg.model === 'string' ? msg.model : null
        onEvent({ id: req.id, type: 'status', status: 'started' })
      } else if (type === 'system' && msg.subtype === 'thinking_tokens') {
        onEvent({ id: req.id, type: 'thinking', tokens: Number(msg.estimated_tokens) || 0 })
      } else if (type === 'stream_event') {
        const ev = msg.event as Record<string, unknown>
        if (ev?.type === 'content_block_start') {
          const cb = ev.content_block as Record<string, unknown>
          if (cb?.type === 'tool_use' && cb?.name === 'StructuredOutput') {
            capturing = true
            json = ''
            onEvent({ id: req.id, type: 'status', status: 'writing' })
          } else if (cb?.type === 'thinking') onEvent({ id: req.id, type: 'status', status: 'thinking' })
        } else if (ev?.type === 'content_block_delta') {
          const d = ev.delta as Record<string, unknown>
          if (capturing && d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
            json += d.partial_json
            emitPartial()
          } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') {
            thinkingChars += d.thinking.length
            if (thinkingChars % 400 < d.thinking.length) onEvent({ id: req.id, type: 'thinking', tokens: Math.round(thinkingChars / 4) })
          }
        } else if (ev?.type === 'content_block_stop' && capturing) {
          emitPartial(true)
          capturing = false
        }
      } else if (type === 'result') {
        const isError = msg.is_error === true || msg.subtype !== 'success'
        const cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null
        if (!isError && msg.structured_output !== undefined && msg.structured_output !== null) {
          finish({ id: req.id, ok: true, data: msg.structured_output, costUsd: cost })
        } else if (!isError && typeof msg.result === 'string') {
          try {
            finish({ id: req.id, ok: true, data: JSON.parse(msg.result), costUsd: cost })
          } catch {
            finish({ id: req.id, ok: false, errorKind: 'invalid', error: 'The model did not return structured output.', costUsd: cost })
          }
        } else {
          const text = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.errors ?? msg.subtype ?? 'error')
          finish({ id: req.id, ok: false, errorKind: classify(text), error: text.slice(0, 600), costUsd: cost })
        }
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) handle(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr = (stderr + c).slice(-4000)
    })
    child.on('error', (err) => finish({ id: req.id, ok: false, errorKind: classify(String(err)), error: String(err) }))
    child.on('close', (code) => {
      if (buf.trim()) handle(buf.trim())
      if (!settled) {
        const text = stderr.trim() || `claude exited with code ${code}`
        finish({ id: req.id, ok: false, errorKind: classify(text), error: text.slice(-600) })
      }
    })
    child.stdin.on('error', () => {
      /* process died early; reported via close */
    })
    const files = req.files ?? []
    const prompt = files.length ? `${req.prompt}\n\nFiles:\n${files.map((f) => `- ${f}`).join('\n')}` : req.prompt
    child.stdin.end(prompt, 'utf8')
  })
}

export async function claudeVersion(path: string | null): Promise<{ path: string | null; version: string | null; error?: string }> {
  const bin = await resolveClaudePath(path)
  if (!bin) return { path: null, version: null, error: 'not found' }
  const env = await buildEnv(bin)
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { env, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) resolve({ path: bin, version: null, error: String(stderr || err.message).slice(0, 300) })
      else resolve({ path: bin, version: String(stdout).trim() })
    })
  })
}

export async function testClaude(cfg: CliConfig): Promise<LlmTestResult> {
  const v = await claudeVersion(cfg.path)
  if (!v.path) return { ok: false, message: 'Claude Code CLI not found. Install it, run `claude` once to log in, or set the path manually.', path: null, version: null }
  if (!v.version) return { ok: false, message: `Found ${v.path} but it did not run: ${v.error}`, path: v.path, version: null }
  const r = await runClaude(
    {
      id: `test_${Date.now()}`,
      kind: 'test',
      system: 'You are a connectivity check.',
      prompt: 'Reply with ok = true.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      effort: 'low'
    },
    { ...cfg, path: v.path, fallbackModel: null, timeoutSec: 60 },
    () => {}
  )
  if (!r.ok) {
    const hint = r.errorKind === 'auth' ? ' Run `claude` in a terminal once and log in.' : ''
    return { ok: false, message: `${v.version} found, but a test call failed: ${r.error}.${hint}`, path: v.path, version: v.version }
  }
  return { ok: true, message: `${v.version} is working (test call took ${((r.durationMs ?? 0) / 1000).toFixed(1)} s).`, path: v.path, version: v.version }
}
