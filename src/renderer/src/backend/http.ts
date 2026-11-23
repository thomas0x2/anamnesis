// Backend over HTTP to scripts/dev-server.ts (lets the UI run in a normal browser for development and tests).
import type { AgentEvent } from '@shared/agentTypes'
import type { AppInfo, Backend, FolderFile, DeepPartial, LlmEvent, LlmRequest, LlmResult, LlmTestResult, Settings } from '@shared/types'

export function createHttpBackend(base: string): Backend {
  const j = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(base + path, init)
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    return (await r.json()) as T
  }
  const post = (path: string, body: unknown): Promise<Response> => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    kind: 'http',
    /** The event stream stays open for the agent's lifetime; resolves once the agent process started. */
    agentStart(req, onEvent) {
      return new Promise((resolve) => {
        let started = false
        const done = (r: { ok: boolean; error?: string }): void => {
          if (!started) {
            started = true
            resolve(r)
          }
        }
        void (async () => {
          try {
            const r = await post('/api/agent/start', req)
            if (!r.ok || !r.body) return done({ ok: false, error: `dev server: ${r.status}` })
            const reader = r.body.getReader()
            const dec = new TextDecoder()
            let buf = ''
            for (;;) {
              const { value, done: end } = await reader.read()
              if (end) break
              buf += dec.decode(value, { stream: true })
              let nl: number
              while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).trim()
                buf = buf.slice(nl + 1)
                if (!line) continue
                const msg = JSON.parse(line) as { started?: { ok: boolean; error?: string }; event?: AgentEvent }
                if (msg.started) done(msg.started)
                if (msg.event) onEvent(msg.event)
              }
            }
            done({ ok: false, error: 'dev server closed the agent stream' })
          } catch (e) {
            done({ ok: false, error: String(e) })
            onEvent({ chatId: req.chatId, type: 'exit', error: String(e), errorKind: 'other' })
          }
        })()
      })
    },
    agentSend: async (chatId, text) => ((await (await post('/api/agent/send', { chatId, text })).json()) as { ok: boolean }).ok,
    agentToolResult: async (chatId, callId, result) => {
      await post('/api/agent/result', { chatId, callId, result })
    },
    agentStop: async (chatId) => {
      await post('/api/agent/stop', { chatId })
    },
    async generate(req: LlmRequest, onEvent?: (e: LlmEvent) => void): Promise<LlmResult> {
      const r = await fetch(base + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
      if (!r.ok || !r.body) return { id: req.id, ok: false, errorKind: 'other', error: `dev server: ${r.status}` }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let result: LlmResult | null = null
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const msg = JSON.parse(line) as { event?: LlmEvent; result?: LlmResult }
          if (msg.event) onEvent?.(msg.event)
          if (msg.result) result = msg.result
        }
      }
      return result ?? { id: req.id, ok: false, errorKind: 'other', error: 'dev server closed the stream' }
    },
    cancel: async (id) => {
      await fetch(base + '/api/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
    },
    testLlm: () => j<LlmTestResult>('/api/test'),
    readJson: async <T>(name: string) => (await j<{ data: T | null }>(`/api/store?name=${encodeURIComponent(name)}`)).data,
    writeJson: async (name, data) => {
      await j(`/api/store?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
    },
    listJson: async (prefix) => (await j<{ names: string[] }>(`/api/store-list?prefix=${encodeURIComponent(prefix)}`)).names,
    getSettings: () => j<Settings>('/api/settings'),
    setSettings: (patch: DeepPartial<Settings>) => j<Settings>('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }),
    async readScript() {
      const r = await fetch(base + '/api/script')
      if (!r.ok || r.status === 204) return null
      return new Uint8Array(await r.arrayBuffer())
    },
    chooseScript: async () => null,
    async readMaterial(courseId, materialId) {
      const r = await fetch(`${base}/api/material?course=${encodeURIComponent(courseId)}&id=${encodeURIComponent(materialId)}`)
      if (!r.ok || r.status === 204) return null
      return new Uint8Array(await r.arrayBuffer())
    },
    pickMaterials: async () => [],
    pickFolder: async () => null,
    scanFolder: async (path) => (await (await post('/api/scan', { path })).json() as { files: FolderFile[] | null }).files,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    info: () => j<AppInfo>('/api/info')
  }
}
