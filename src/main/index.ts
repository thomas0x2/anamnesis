import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FakeAgentHost } from '../shared/fakeAgent'
import type { AgentEvent, AgentStartRequest, AgentToolResult } from '../shared/agentTypes'
import { Providers } from '../node/providers'
import { JsonStore, loadSettings, saveSettings } from '../node/store'
import { fileInfo, readMaterial, resolveWorkFiles, saveWork, scanPdfs } from '../node/files'
import type { DeepPartial, KeyProvider, LlmRequest, Provider, Settings } from '../shared/types'
import { looksLikeGoogleKey, routeFor } from '../shared/models'
import { addUsage, looksLikeApiKey, normalizeUsage } from '../shared/usage'
import type { CloudSttRequest } from '../shared/stt'
import { ApiKeyVault } from './apiKey'
import { checkCeOp, fakeCodeExpert } from '../shared/codeExpert'
import { capturePlatform, openPlatform, platformStatus, runCodeExpert, signOutPlatforms } from './platform'

if (process.env.ANAMNESIS_DATA_DIR) app.setPath('userData', resolve(process.env.ANAMNESIS_DATA_DIR))
app.setName('Anamnesis')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

const dataDir = (): string => app.getPath('userData')
let store: JsonStore
let win: BrowserWindow | null = null
let quitting = false
app.on('before-quit', () => {
  quitting = true
})
const rendererDir = join(__dirname, '../renderer')

const CSP = [
  "default-src 'self' app:",
  "script-src 'self' app: 'wasm-unsafe-eval' blob:",
  "worker-src 'self' app: blob:",
  "style-src 'self' app: 'unsafe-inline'",
  "img-src 'self' app: data: blob:",
  "font-src 'self' app: data:",
  "media-src 'self' app: blob: mediastream:",
  "connect-src 'self' app: blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "frame-src 'self' app: blob: data:",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

// Sketch and widget blocks run model-written code in a sandboxed, opaque-origin iframe: inline code only, no network.
const SKETCH_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"

const vaults: Record<KeyProvider, ApiKeyVault> = {
  anthropic: new ApiKeyVault(dataDir, 'anthropic-api-key', looksLikeApiKey, 'That does not look like an Anthropic API key (it starts with sk-ant-).'),
  google: new ApiKeyVault(dataDir, 'google-api-key', looksLikeGoogleKey, 'That does not look like a Google AI Studio API key.')
}
const keyProvider = (p: unknown): KeyProvider => (p === 'google' ? 'google' : 'anthropic')
const providers = new Providers({ dataDir, key: (p) => vaults[p].get() })

// what the calls cost, per day (see src/shared/usage.ts); writes are chained so none is lost
let usageChain: Promise<void> = Promise.resolve()
function recordUsage(kind: string, usd: number | null | undefined, s: Settings, provider: Provider): void {
  if (process.env.ANAMNESIS_FAKE === '1' || s.provider === 'demo') return
  const auth = provider === 'gemini' || s.cli.auth === 'api-key' ? 'api-key' : 'subscription'
  usageChain = usageChain
    .then(async () => store.write('usage', addUsage(normalizeUsage(await store.read('usage')), { at: new Date(), kind, usd, auth })))
    .catch(() => {})
}

function serveApp(): void {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url)
    let p = decodeURIComponent(url.pathname)
    if (p === '/' || p === '') p = '/index.html'
    const file = normalize(join(rendererDir, p))
    if (!file.startsWith(rendererDir)) return new Response('forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', file.endsWith('sketch.html') || file.endsWith('widget.html') ? SKETCH_CSP : CSP)
    if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm')
    if (file.endsWith('.mjs') || file.endsWith('.js')) headers.set('Content-Type', 'text/javascript')
    return new Response(res.body, { status: res.status, headers })
  })
}

// The packaged app takes its icon from build/icon.png via electron-builder; in development
// Electron would show its own logo, so point the dock and the window at the same file.
const devIcon = app.isPackaged ? undefined : join(__dirname, '../../build/icon.png')

function createWindow(): void {
  if (devIcon && process.platform === 'darwin') app.dock?.setIcon(devIcon)
  win = new BrowserWindow({
    icon: devIcon,
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0b',
    title: 'Anamnesis',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // let the renderer save the open session and the learner model before the window goes away
  let saved = false
  win.on('close', (e) => {
    if (saved || !win || win.webContents.isDestroyed()) return
    e.preventDefault()
    const w = win
    const done = (): void => {
      if (saved) return
      saved = true
      ipcMain.removeListener('app:quit-ready', done)
      if (quitting) app.quit()
      else w.close()
    }
    ipcMain.on('app:quit-ready', done)
    setTimeout(done, 2500)
    w.webContents.send('app:before-quit')
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!(devUrl && url.startsWith(devUrl)) && !url.startsWith('app://')) e.preventDefault()
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadURL('app://anamnesis/index.html')
}

const fakeAgents = new FakeAgentHost(160)
const fakeChats = new Set<string>()
app.on('will-quit', () => providers.stopAll())

function registerIpc(): void {
  ipcMain.handle('agent:start', async (event, req: AgentStartRequest) => {
    const settings = await loadSettings(store)
    const fake = settings.provider === 'demo' || process.env.ANAMNESIS_FAKE === '1'
    providers.agentStop(req.chatId)
    fakeAgents.stop(req.chatId)
    if (fake) fakeChats.add(req.chatId)
    else fakeChats.delete(req.chatId)
    const sender = event.sender
    const provider = routeFor('chat', settings).provider
    const onEvent = (e: AgentEvent): void => {
      if (e.type === 'turn_end' && !fake) recordUsage('chat', e.costUsd, settings, provider)
      if (!sender.isDestroyed()) sender.send('agent:event', e)
    }
    return fake ? fakeAgents.start(req, onEvent) : providers.agentStart(req, settings, onEvent)
  })
  ipcMain.handle('agent:send', (_e, chatId: string, text: string) => (fakeChats.has(chatId) ? fakeAgents.send(chatId, text) : providers.agentSend(chatId, text)))
  ipcMain.handle('agent:result', (_e, chatId: string, callId: string, result: AgentToolResult) => {
    if (fakeChats.has(chatId)) fakeAgents.toolResult(chatId, callId, result)
    else providers.agentToolResult(chatId, callId, result)
  })
  ipcMain.handle('agent:stop', (_e, chatId: string) => (fakeChats.has(chatId) ? fakeAgents.stop(chatId) : providers.agentStop(chatId)))
  ipcMain.handle('llm:generate', async (event, req: LlmRequest) => {
    const settings = await loadSettings(store)
    const r = await providers.generate({ ...req, files: resolveWorkFiles(dataDir(), req.files) }, settings, (e) => {
      if (!event.sender.isDestroyed()) event.sender.send('llm:event', e)
    })
    if (r.ok || r.costUsd) recordUsage(req.kind, r.costUsd, settings, r.route.provider)
    const { route: _route, ...result } = r
    return result
  })
  ipcMain.handle('apikey:status', (_e, p: unknown) => vaults[keyProvider(p)].status())
  ipcMain.handle('apikey:set', (_e, p: unknown, key: unknown) => vaults[keyProvider(p)].set(typeof key === 'string' ? key : null))
  ipcMain.handle('stt:cloud', async (_e, req: unknown) => {
    const r = (req ?? {}) as Partial<CloudSttRequest>
    const settings = await loadSettings(store)
    const out = await providers.transcribe({ audio: String(r.audio ?? ''), context: String(r.context ?? '').slice(0, 4000), language: String(r.language ?? 'english') }, settings)
    if (out.ok) recordUsage('stt', null, settings, 'gemini')
    return out
  })
  ipcMain.handle('models:list', (_e, p: unknown) => providers.listModels(p === 'gemini' ? 'gemini' : 'claude'))
  ipcMain.handle('llm:cancel', (_e, id: string) => providers.cancel(id))
  ipcMain.handle('llm:test', async () => providers.test(await loadSettings(store)))
  ipcMain.handle('store:read', (_e, name: string) => store.read(name))
  ipcMain.handle('store:write', (_e, name: string, data: unknown) => store.write(name, data))
  ipcMain.handle('store:list', (_e, prefix: string) => store.list(prefix))
  ipcMain.handle('settings:get', () => loadSettings(store))
  ipcMain.handle('settings:set', (_e, patch: DeepPartial<Settings>) => saveSettings(store, patch))
  ipcMain.handle('script:read', async () => {
    const s = await loadSettings(store)
    if (!s.script.path) return null
    try {
      return new Uint8Array(await readFile(s.script.path))
    } catch {
      return null
    }
  })
  ipcMain.handle('script:choose', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose the lecture notes (PDF)',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    await saveSettings(store, { script: { path: r.filePaths[0] } })
    return r.filePaths[0]
  })
  ipcMain.handle('material:read', async (_e, courseId: string, materialId: string) => readMaterial(store, await loadSettings(store), String(courseId), String(materialId)))
  ipcMain.handle('material:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Add course materials (PDF)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled) return []
    return (await Promise.all(r.filePaths.map(fileInfo))).filter(Boolean)
  })
  ipcMain.handle('folder:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose the course folder', properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('work:save', (_e, courseId: string, submissionId: string, files: { name: string; bytes: Uint8Array }[]) => saveWork(dataDir(), courseId, submissionId, files))
  ipcMain.handle('folder:scan', (_e, path: string) => (typeof path === 'string' && path ? scanPdfs(path) : null))
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })
  ipcMain.handle('platform:open', (_e, url: unknown) => openPlatform(String(url ?? ''), win))
  ipcMain.handle('platform:status', () => platformStatus())
  ipcMain.handle('platform:capture', () => capturePlatform())
  ipcMain.handle('platform:sign-out', () => signOutPlatforms())
  ipcMain.handle('codeexpert:run', (_e, op: unknown) => (process.env.ANAMNESIS_FAKE === '1' ? fakeCodeExpert(checkCeOp(op)) : runCodeExpert(checkCeOp(op), win)))
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: dataDir(), platform: process.platform, backend: 'electron' }))
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

void app.whenReady().then(() => {
  store = new JsonStore(dataDir())
  serveApp()
  registerIpc()
  const origin = (u: string): boolean => u.startsWith('app://anamnesis') || (!!process.env.ELECTRON_RENDERER_URL && u.startsWith(process.env.ELECTRON_RENDERER_URL))
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && origin(wc.getURL())))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission === 'media' && origin(requestingOrigin))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
