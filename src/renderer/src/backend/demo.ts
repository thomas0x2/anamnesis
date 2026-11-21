// In-browser backend: localStorage persistence and the scripted demo tutor. No model, no files.
import { fakeGenerate } from '@shared/fakeTutor'
import { DEFAULT_SETTINGS, type Backend, type DeepPartial, type Settings } from '@shared/types'
import { deepMerge } from '@shared/util'

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
  return {
    kind: 'demo',
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
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    info: async () => ({ version: '0.1.0', dataDir: 'browser localStorage', platform: navigator.platform, backend: 'demo' as const })
  }
}
