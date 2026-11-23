import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AgentHost } from '../node/agent'
import { FakeAgentHost } from '../shared/fakeAgent'
import type { AgentEvent, AgentStartRequest, AgentToolResult } from '../shared/agentTypes'
import { cancelClaude, runClaude, testClaude, type CliConfig } from '../node/claudeCli'
import { JsonStore, loadSettings, saveSettings } from '../node/store'
import { fileInfo, readMaterial, scanPdfs } from '../node/files'
import type { DeepPartial, LlmRequest, Settings } from '../shared/types'

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

// Sketch blocks run model-written HTML in a sandboxed, opaque-origin iframe: inline code only, no network.
const SKETCH_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"

function cliConfig(s: Settings): CliConfig {
  return { ...s.cli, workDir: join(dataDir(), 'claude-workdir') }
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
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', file.endsWith('sketch.html') ? SKETCH_CSP : CSP)
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

const realAgents = new AgentHost()
const fakeAgents = new FakeAgentHost(160)
const agentOf = new Map<string, AgentHost | FakeAgentHost>()
app.on('will-quit', () => realAgents.stopAll())

function registerIpc(): void {
  ipcMain.handle('agent:start', async (event, req: AgentStartRequest) => {
    const settings = await loadSettings(store)
    const host = settings.provider === 'demo' || process.env.ANAMNESIS_FAKE === '1' ? fakeAgents : realAgents
    agentOf.get(req.chatId)?.stop(req.chatId)
    agentOf.set(req.chatId, host)
    const sender = event.sender
    const onEvent = (e: AgentEvent): void => {
      if (!sender.isDestroyed()) sender.send('agent:event', e)
    }
    return host instanceof FakeAgentHost ? host.start(req, onEvent) : host.start(req, cliConfig(settings), onEvent)
  })
  ipcMain.handle('agent:send', (_e, chatId: string, text: string) => agentOf.get(chatId)?.send(chatId, text) ?? false)
  ipcMain.handle('agent:result', (_e, chatId: string, callId: string, result: AgentToolResult) => {
    agentOf.get(chatId)?.toolResult(chatId, callId, result)
  })
  ipcMain.handle('agent:stop', (_e, chatId: string) => agentOf.get(chatId)?.stop(chatId))
  ipcMain.handle('llm:generate', async (event, req: LlmRequest) => {
    const settings = await loadSettings(store)
    return runClaude(req, cliConfig(settings), (e) => {
      if (!event.sender.isDestroyed()) event.sender.send('llm:event', e)
    })
  })
  ipcMain.handle('llm:cancel', (_e, id: string) => cancelClaude(id))
  ipcMain.handle('llm:test', async () => testClaude(cliConfig(await loadSettings(store))))
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
  ipcMain.handle('folder:scan', (_e, path: string) => (typeof path === 'string' && path ? scanPdfs(path) : null))
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })
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
