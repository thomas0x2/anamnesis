// The only bridge between the sandboxed renderer and the main process.
import { contextBridge, ipcRenderer } from 'electron'

type Listener = (e: unknown) => void
const listeners = new Map<string, Listener>()

ipcRenderer.on('llm:event', (_e, ev: { id: string }) => listeners.get(ev.id)?.(ev))
const agentListeners = new Map<string, Listener>()
ipcRenderer.on('agent:event', (_e, ev: { chatId: string }) => agentListeners.get(ev.chatId)?.(ev))

const api = {
  kind: 'electron',
  async generate(req: { id: string }, onEvent?: Listener) {
    if (onEvent) listeners.set(req.id, onEvent)
    try {
      return await ipcRenderer.invoke('llm:generate', req)
    } finally {
      listeners.delete(req.id)
    }
  },
  agentStart(req: { chatId: string }, onEvent: Listener) {
    agentListeners.set(req.chatId, onEvent)
    return ipcRenderer.invoke('agent:start', req)
  },
  agentSend: (chatId: string, text: string) => ipcRenderer.invoke('agent:send', chatId, text),
  agentToolResult: (chatId: string, callId: string, result: unknown) => ipcRenderer.invoke('agent:result', chatId, callId, result),
  agentStop: (chatId: string) => ipcRenderer.invoke('agent:stop', chatId),
  cancel: (id: string) => ipcRenderer.invoke('llm:cancel', id),
  apiKeyStatus: (provider: string) => ipcRenderer.invoke('apikey:status', provider),
  setApiKey: (provider: string, key: string | null) => ipcRenderer.invoke('apikey:set', provider, key),
  listModels: (provider: string) => ipcRenderer.invoke('models:list', provider),
  transcribeCloud: (req: unknown) => ipcRenderer.invoke('stt:cloud', req),
  testLlm: () => ipcRenderer.invoke('llm:test'),
  readJson: (name: string) => ipcRenderer.invoke('store:read', name),
  writeJson: (name: string, data: unknown) => ipcRenderer.invoke('store:write', name, data),
  listJson: (prefix: string) => ipcRenderer.invoke('store:list', prefix),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  readScript: () => ipcRenderer.invoke('script:read'),
  chooseScript: () => ipcRenderer.invoke('script:choose'),
  readMaterial: (courseId: string, materialId: string) => ipcRenderer.invoke('material:read', courseId, materialId),
  pickMaterials: () => ipcRenderer.invoke('material:pick'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  scanFolder: (path: string) => ipcRenderer.invoke('folder:scan', path),
  readNotebook: (path: string) => ipcRenderer.invoke('notebook:read', path),
  saveWork: (courseId: string, submissionId: string, files: { name: string; bytes: Uint8Array }[]) => ipcRenderer.invoke('work:save', courseId, submissionId, files),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  openPlatform: (url: string) => ipcRenderer.invoke('platform:open', url),
  platformStatus: () => ipcRenderer.invoke('platform:status'),
  capturePage: () => ipcRenderer.invoke('platform:capture'),
  signOutPlatforms: () => ipcRenderer.invoke('platform:sign-out'),
  onPlatformActivity(fn: () => void) {
    ipcRenderer.removeAllListeners('platform:activity')
    ipcRenderer.on('platform:activity', () => fn())
  },
  codeExpert: (op: unknown) => ipcRenderer.invoke('codeexpert:run', op),
  gitlab: (op: unknown) => ipcRenderer.invoke('gitlab:run', op),
  info: () => ipcRenderer.invoke('app:info'),
  onBeforeQuit(fn: () => Promise<void>) {
    ipcRenderer.removeAllListeners('app:before-quit')
    ipcRenderer.on('app:before-quit', () => {
      void Promise.resolve()
        .then(fn)
        .catch(() => {})
        .finally(() => ipcRenderer.send('app:quit-ready'))
    })
  }
}

contextBridge.exposeInMainWorld('anamnesis', api)
