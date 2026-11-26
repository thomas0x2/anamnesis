// In-browser backend: localStorage persistence and the scripted demo tutor. No model, no files.
import { workFileName } from '@shared/exam'
import { fakeCapture } from '@shared/platform'
import { FakeAgentHost } from '@shared/fakeAgent'
import { fakeGenerate } from '@shared/fakeTutor'
import { DEFAULT_SETTINGS, type Backend, type DeepPartial, type Settings } from '@shared/types'
import { deepMerge } from '@shared/util'

/** the page the demo pretends to have open in the platform window */
let platformUrl: string | null = null

const KEY = 'anamnesis:'

export function createDemoBackend(): Backend {
  const read = <T>(name: string): T | null => {
    try {
      const v = localStorage.getItem(KEY + name)
      return v ? (JSON.parse(v) as T) : null
    } catch {
      return null
    }
  }
  const write = (name: string, data: unknown): void => {
    try {
      localStorage.setItem(KEY + name, JSON.stringify(data))
    } catch {
      /* storage full or blocked: demo mode keeps working in memory */
    }
  }
  const settings = (): Settings => deepMerge({ ...DEFAULT_SETTINGS, provider: 'demo' as const }, read<DeepPartial<Settings>>('settings') ?? {})
  const agents = new FakeAgentHost(260)
  return {
    kind: 'demo',
    agentStart: (req, onEvent) => agents.start(req, onEvent),
    agentSend: async (chatId, text) => agents.send(chatId, text),
    agentToolResult: async (chatId, callId, result) => {
      agents.toolResult(chatId, callId, result)
    },
    agentStop: async (chatId) => agents.stop(chatId),
    generate: (req, onEvent) => fakeGenerate(req, onEvent, 220),
    cancel: async () => {},
    testLlm: async () => ({ ok: true, message: 'Demo tutor (no model). Run the desktop app to use Claude.', path: null, version: null }),
    readJson: async <T>(name: string) => read<T>(name),
    writeJson: async (name, data) => write(name, data),
    listJson: async (prefix) =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(KEY + prefix))
        .map((k) => k.slice(KEY.length)),
    getSettings: async () => settings(),
    setSettings: async (patch) => {
      const next = deepMerge(settings(), patch)
      write('settings', next)
      return next
    },
    readScript: async () => null,
    chooseScript: async () => null,
    readMaterial: async () => null,
    pickMaterials: async () => [],
    pickFolder: async () => null,
    scanFolder: async () => null,
    // the demo keeps nothing on disk: the scripted grade does not read the files
    saveWork: async (_c, _s, files) => files.map((f, i) => ({ name: workFileName(f.name, i) ?? `file-${i + 1}`, size: f.bytes.byteLength })),
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    // no platform window in the browser: the page opens in a tab and the demo reads a scripted page
    async openPlatform(url) {
      platformUrl = url
      window.open(url, '_blank', 'noopener')
      return false
    },
    platformStatus: async () => ({ open: !!platformUrl, url: platformUrl, title: platformUrl ? 'Exercise 4: Lists · Code Expert' : null }),
    capturePage: async () => (platformUrl ? fakeCapture(platformUrl, new Date()) : null),
    signOutPlatforms: async () => {
      platformUrl = null
    },
    info: async () => ({ version: '0.1.0', dataDir: 'browser localStorage', platform: navigator.platform, backend: 'demo' as const })
  }
}
