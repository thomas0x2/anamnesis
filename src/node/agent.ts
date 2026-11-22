// Runs one long-lived Claude Code CLI agent per chat:
//   claude -p --input-format stream-json --output-format stream-json --include-partial-messages
//          --mcp-config <the app's MCP server> --tools "" --allowedTools mcp__anamnesis ...
// Built-in tools are off; the agent can only use the app's tutor tools, which the app runs in its UI.
// Learner messages go in over stdin; text, tool inputs and tool calls come back as AgentEvents.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MCP_SERVER, toolShortName, type AgentEvent, type AgentStartRequest, type AgentToolResult } from '../shared/agentTypes'
import type { LlmErrorKind } from '../shared/types'
import { buildEnv, resolveClaudePath, type CliConfig } from './claudeCli'
import { McpBridge, type McpEndpoint } from './mcpBridge'

interface Pending {
  resolve: (r: AgentToolResult) => void
}

interface Running {
  child: ChildProcessWithoutNullStreams
  endpoint: McpEndpoint
  pending: Map<string, Pending>
  sysFile: string
  busy: boolean
  queue: string[]
  stopped: boolean
}

function classify(text: string): LlmErrorKind {
  if (/ENOENT|not found|no such file/i.test(text)) return 'not_found'
  if (/log ?in|logged out|auth|credential|unauthori[sz]ed|401|oauth|api key/i.test(text)) return 'auth'
  if (/rate.?limit|429|overloaded|usage limit|quota|529/i.test(text)) return 'rate_limit'
  if (/timed? ?out|timeout/i.test(text)) return 'timeout'
  return 'other'
}

export function agentArgs(req: AgentStartRequest, cfg: CliConfig, sysFile: string, endpoint: McpEndpoint): string[] {
  const mcp = { mcpServers: { [MCP_SERVER]: { type: 'http', url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` } } } }
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    sysFile,
    '--tools',
    '',
    '--mcp-config',
    JSON.stringify(mcp),
    '--strict-mcp-config',
    '--allowedTools',
    `mcp__${MCP_SERVER}`,
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--effort',
    req.effort || cfg.effort || 'medium'
  ]
  if (req.resume) args.push('--resume', req.resume)
  else args.push('--session-id', req.sessionId)
  const model = (req.model || cfg.model || '').trim()
  if (model) args.push('--model', model)
  const fb = (cfg.fallbackModel || '').trim()
  if (fb && fb !== model) args.push('--fallback-model', fb)
  return args
}

export class AgentHost {
  private bridge = new McpBridge()
  private agents = new Map<string, Running>()
  private calls = 0

  running(chatId: string): boolean {
    return this.agents.has(chatId)
  }

  async start(req: AgentStartRequest, cfg: CliConfig, emit: (e: AgentEvent) => void): Promise<{ ok: boolean; error?: string; errorKind?: LlmErrorKind }> {
    this.stop(req.chatId)
    const chatId = req.chatId
    const bin = await resolveClaudePath(cfg.path)
    if (!bin) return { ok: false, errorKind: 'not_found', error: 'Claude Code CLI not found. Install it or set its path in Settings.' }
    await mkdir(join(cfg.workDir, 'prompts'), { recursive: true })
    const sysFile = join(cfg.workDir, 'prompts', `agent_${chatId.replace(/[^\w-]/g, '_')}.txt`)
    await writeFile(sysFile, req.system, 'utf8')

    const pending = new Map<string, Pending>()
    const endpoint = await this.bridge.register(chatId, req.tools, (name, args, signal) => {
      const callId = `call_${++this.calls}_${Date.now().toString(36)}`
      return new Promise<AgentToolResult>((resolve) => {
        pending.set(callId, { resolve })
        signal.addEventListener('abort', () => {
          if (!pending.delete(callId)) return
          emit({ chatId, type: 'tool_cancel', callId })
          resolve({ text: 'cancelled', isError: true })
        })
        emit({ chatId, type: 'tool_call', callId, name, args })
      })
    })

    const env = await buildEnv(bin)
    // a learner can take a long time to answer: tool calls must not time out on the CLI side
    env.MCP_TOOL_TIMEOUT = String(24 * 3600 * 1000)
    env.MCP_TIMEOUT = '30000'
    env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = String(24 * 3600 * 1000)
    // keep waiting tool calls in the foreground: the agent must not move on while the learner thinks
    env.CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND = '1'
    env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS = '0'
    env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'
    env.CLAUDE_CODE_DISABLE_MCP_TASKS = '1'
    env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
    // the app keeps the learner model; no Claude Code memory in the tutor
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const child = spawn(bin, agentArgs(req, cfg, sysFile, endpoint), { cwd: cfg.workDir, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const run: Running = { child, endpoint, pending, sysFile, busy: false, queue: [], stopped: false }
    this.agents.set(chatId, run)
    emit({ chatId, type: 'status', status: 'starting' })

    let buf = ''
    let stderr = ''
    let block = 0
    const blocks = new Map<number, { kind: 'text' | 'tool' | 'other'; id: string; name?: string; json: string }>()

    const handle = (line: string): void => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        emit({ chatId, type: 'status', status: 'ready', model: typeof msg.model === 'string' ? msg.model : null })
      } else if (msg.type === 'stream_event') {
        const ev = msg.event as Record<string, unknown>
        const index = Number(ev?.index ?? 0)
        if (ev?.type === 'message_start') blocks.clear()
        else if (ev?.type === 'content_block_start') {
          const cb = ev.content_block as Record<string, unknown>
          if (cb?.type === 'text') {
            blocks.set(index, { kind: 'text', id: `b${++block}`, json: '' })
            emit({ chatId, type: 'status', status: 'writing' })
          } else if (cb?.type === 'tool_use') {
            const name = toolShortName(String(cb.name ?? ''))
            blocks.set(index, { kind: 'tool', id: String(cb.id ?? `t${++block}`), name, json: '' })
            emit({ chatId, type: 'tool_input', toolUseId: String(cb.id), name, json: '', done: false })
          } else {
            blocks.set(index, { kind: 'other', id: '', json: '' })
            if (cb?.type === 'thinking') emit({ chatId, type: 'status', status: 'thinking' })
          }
        } else if (ev?.type === 'content_block_delta') {
          const b = blocks.get(index)
          const d = ev.delta as Record<string, unknown>
          if (b?.kind === 'text' && d?.type === 'text_delta' && typeof d.text === 'string') emit({ chatId, type: 'text', blockId: b.id, delta: d.text })
          else if (b?.kind === 'tool' && d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
            b.json += d.partial_json
            emit({ chatId, type: 'tool_input', toolUseId: b.id, name: b.name!, json: b.json, done: false })
          }
        } else if (ev?.type === 'content_block_stop') {
          const b = blocks.get(index)
          if (b?.kind === 'tool') emit({ chatId, type: 'tool_input', toolUseId: b.id, name: b.name!, json: b.json, done: true })
        }
      } else if (msg.type === 'result') {
        const ok = msg.is_error !== true && msg.subtype === 'success'
        const text = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.errors ?? msg.subtype ?? '')
        run.busy = false
        emit({
          chatId,
          type: 'turn_end',
          ok,
          costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
          ...(ok ? {} : { error: text.slice(0, 600), errorKind: classify(text) })
        })
        emit({ chatId, type: 'status', status: 'idle' })
        const next = run.queue.shift()
        if (next !== undefined) this.write(run, next)
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
    child.stdin.on('error', () => {
      /* reported via close */
    })
    const cleanup = (): void => {
      if (this.agents.get(chatId) === run) this.agents.delete(chatId)
      endpoint.close()
      for (const [id, p] of pending) {
        emit({ chatId, type: 'tool_cancel', callId: id })
        p.resolve({ text: 'cancelled', isError: true })
      }
      pending.clear()
      void rm(sysFile, { force: true })
    }
    child.on('error', (err) => {
      cleanup()
      emit({ chatId, type: 'exit', error: String(err), errorKind: classify(String(err)) })
    })
    child.on('close', (code, signal) => {
      if (buf.trim()) handle(buf.trim())
      cleanup()
      if (code === 0 || run.stopped || signal) emit({ chatId, type: 'exit' })
      else {
        const text = stderr.trim() || `claude exited with code ${code}`
        emit({ chatId, type: 'exit', error: text.slice(-600), errorKind: classify(text) })
      }
    })
    return { ok: true }
  }

  private write(run: Running, text: string): void {
    run.busy = true
    const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
    run.child.stdin.write(JSON.stringify(msg) + '\n', 'utf8')
  }

  /** Send a learner message (or an app note). Queued while the agent is still working on a turn. */
  send(chatId: string, text: string): boolean {
    const run = this.agents.get(chatId)
    if (!run) return false
    if (run.busy) run.queue.push(text)
    else this.write(run, text)
    return true
  }

  toolResult(chatId: string, callId: string, result: AgentToolResult): boolean {
    const p = this.agents.get(chatId)?.pending
    const entry = p?.get(callId)
    if (!entry) return false
    p!.delete(callId)
    entry.resolve(result)
    return true
  }

  stop(chatId: string): void {
    const run = this.agents.get(chatId)
    if (!run) return
    this.agents.delete(chatId)
    run.stopped = true
    try {
      run.child.stdin.end()
      run.child.kill('SIGTERM')
      setTimeout(() => {
        if (run.child.exitCode === null) run.child.kill('SIGKILL')
      }, 3000)
    } catch {
      /* already gone */
    }
  }

  stopAll(): void {
    for (const id of [...this.agents.keys()]) this.stop(id)
    this.bridge.close()
  }
}
