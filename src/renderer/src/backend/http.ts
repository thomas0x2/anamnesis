// Backend over HTTP to scripts/dev-server.ts (lets the UI run in a normal browser for development and tests).
import type { AppInfo, Backend, DeepPartial, LlmEvent, LlmRequest, LlmResult, LlmTestResult, Settings } from '@shared/types'

export function createHttpBackend(base: string): Backend {
  const j = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(base + path, init)
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    return (await r.json()) as T
  }
  return {
    kind: 'http',
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
      if (!r.ok) return null
      return new Uint8Array(await r.arrayBuffer())
    },
    chooseScript: async () => null,
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    info: () => j<AppInfo>('/api/info')
  }
}
