// Sends each model call to the provider its task is set to (Settings → Models): Claude through the
// Claude Code CLI, or Gemini through the Gemini API. Used by the desktop app and the browser dev server.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, AgentStartRequest, AgentToolResult } from '../shared/agentTypes'
import { GEMINI_DEFAULT_MODEL, MODEL_SUGGESTIONS, routeFor, type Route } from '../shared/models'
import type { KeyProvider, LlmErrorKind, LlmEvent, LlmRequest, LlmResult, LlmTestResult, Provider, Settings } from '../shared/types'
import { AgentHost } from './agent'
import { cancelClaude, runClaude, testClaude, type CliConfig } from './claudeCli'
import { cancelGemini, listGeminiModels, runGemini, testGemini, transcribeGemini, type GeminiConfig } from './gemini'
import type { CloudSttRequest } from '../shared/stt'
import { GeminiAgentHost } from './geminiAgent'
import { timingLog, type TimingLog } from './timing'

export interface ProviderDeps {
  dataDir: () => string
  /** the saved key of a provider, decrypted (null when none) */
  key: (p: KeyProvider) => string | null
  fetch?: typeof fetch
  /** where model call timings go (default: <data>/logs/model-timing.jsonl) */
  timing?: TimingLog
}

type Host = AgentHost | GeminiAgentHost

export class Providers {
  readonly claudeAgents = new AgentHost()
  readonly geminiAgents = new GeminiAgentHost()
  private hostOf = new Map<string, Host>()
  private readonly timing: TimingLog

  constructor(private readonly deps: ProviderDeps) {
    this.timing = deps.timing ?? timingLog(deps.dataDir)
  }

  cliConfig(s: Settings, route?: Route): CliConfig {
    const auth = s.cli.auth === 'api-key' ? 'api-key' : 'subscription'
    return {
      path: s.cli.path,
      fallbackModel: s.cli.fallbackModel,
      timeoutSec: s.cli.timeoutSec,
      model: route?.model ?? '',
      effort: route?.effort ?? 'medium',
      auth,
      apiKey: auth === 'api-key' ? this.deps.key('anthropic') : null,
      workDir: join(this.deps.dataDir(), 'claude-workdir'),
      timing: this.timing
    }
  }

  geminiConfig(s: Settings, route: Route): GeminiConfig {
    return { apiKey: this.deps.key('google'), model: route.model, effort: route.effort, timeoutSec: s.cli.timeoutSec, fetch: this.deps.fetch }
  }

  /** Run a structured call on the provider of its task; the task's model and effort win over the request's. */
  async generate(req: LlmRequest, s: Settings, onEvent: (e: LlmEvent) => void): Promise<LlmResult & { route: Route }> {
    const route = routeFor(req.kind, s, req.effort)
    const r = { ...req, model: route.model || null, effort: route.effort }
    const started = Date.now()
    let firstAt: number | null = null
    const watch = (e: LlmEvent): void => {
      if (firstAt === null && (e.type === 'partial' || e.type === 'thinking' || (e.type === 'status' && e.status === 'writing'))) firstAt = Date.now()
      onEvent(e)
    }
    const out = route.provider === 'gemini' ? await runGemini(r, this.geminiConfig(s, route), watch) : await runClaude(r, this.cliConfig(s, route), watch)
    if (req.kind !== 'test')
      this.timing({ type: 'call', provider: route.provider, model: out.model ?? (route.model || null), kind: req.kind, firstMs: firstAt === null ? null : firstAt - started, totalMs: Date.now() - started, ok: out.ok })
    return { ...out, route }
  }

  cancel(id: string): void {
    if (!cancelGemini(id)) cancelClaude(id)
  }

  /** Test the provider the tutor runs on. */
  test(s: Settings): Promise<LlmTestResult> {
    const route = routeFor('step', s)
    return route.provider === 'gemini' ? testGemini(this.geminiConfig(s, route)) : testClaude(this.cliConfig(s, route))
  }

  /** Speech to text on Gemini: the tutor's Gemini model when the tutor runs on Gemini, else the default one; low thinking for speed. */
  transcribe(req: CloudSttRequest, s: Settings): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
    const tutor = routeFor('chat', s)
    const model = tutor.provider === 'gemini' && tutor.model ? tutor.model : GEMINI_DEFAULT_MODEL
    return transcribeGemini(req, { apiKey: this.deps.key('google'), model, effort: 'low', timeoutSec: s.cli.timeoutSec, fetch: this.deps.fetch })
  }

  async listModels(p: Provider): Promise<string[]> {
    if (p === 'gemini') return listGeminiModels(this.deps.key('google'), this.deps.fetch)
    return MODEL_SUGGESTIONS.claude.map((m) => m.id)
  }

  private get historyDir(): string {
    return join(this.deps.dataDir(), 'gemini-chats')
  }

  async agentStart(req: AgentStartRequest, s: Settings, emit: (e: AgentEvent) => void): Promise<{ ok: boolean; error?: string; errorKind?: LlmErrorKind }> {
    const route = routeFor('chat', s, req.effort ?? null)
    this.agentStop(req.chatId)
    const r = { ...req, model: route.model || undefined, effort: route.effort ?? undefined }
    if (route.provider === 'gemini') {
      this.hostOf.set(req.chatId, this.geminiAgents)
      return this.geminiAgents.start(r, { apiKey: this.deps.key('google'), model: route.model, effort: route.effort, historyDir: this.historyDir, fetch: this.deps.fetch, timing: this.timing }, emit)
    }
    // a chat that ran on Gemini has no Claude Code session to resume: start a fresh one with the same id
    const fromGemini = !!req.resume && existsSync(join(this.historyDir, `${req.resume.replace(/[^\w-]/g, '_').slice(0, 80)}.json`))
    this.hostOf.set(req.chatId, this.claudeAgents)
    return this.claudeAgents.start(fromGemini ? { ...r, resume: null } : r, this.cliConfig(s, route), emit)
  }

  agentSend(chatId: string, text: string): boolean {
    return this.hostOf.get(chatId)?.send(chatId, text) ?? false
  }

  agentToolResult(chatId: string, callId: string, result: AgentToolResult): boolean {
    return this.hostOf.get(chatId)?.toolResult(chatId, callId, result) ?? false
  }

  agentStop(chatId: string): void {
    this.hostOf.get(chatId)?.stop(chatId)
    this.hostOf.delete(chatId)
  }

  stopAll(): void {
    this.claudeAgents.stopAll()
    this.geminiAgents.stopAll()
  }
}
