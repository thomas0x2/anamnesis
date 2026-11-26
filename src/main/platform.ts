// The platform window: Code Expert, GitLab, Moodle… opened inside the app so the learner signs in there as
// usual and the app can read the page they have open (see src/shared/platform.ts). It is an ordinary
// sandboxed browser window with its own persistent session ("persist:platforms"): no preload, no access to
// the app, every permission request denied. Its cookies are the sign-in; "Sign out" clears them.
import { BrowserWindow, session, type WebFrameMain } from 'electron'
import { CAPTURE_SCRIPT, mergeCaptures, type PageCapture, type PlatformStatus } from '../shared/platform'

const PARTITION = 'persist:platforms'
let win: BrowserWindow | null = null
let configured = false

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

function platformSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  if (!configured) {
    configured = true
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)
  }
  return ses
}

/** Open (or reuse) the platform window at a link. */
export function openPlatform(url: string, parent: BrowserWindow | null): boolean {
  if (typeof url !== 'string' || !isWeb(url)) return false
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1200,
      height: 860,
      title: 'Platform',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: { session: platformSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true }
    })
    // links that open a new tab stay in this window; nothing but web pages
    win.webContents.setWindowOpenHandler(({ url: next }) => {
      if (isWeb(next)) void win?.loadURL(next)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e, next) => {
      if (!isWeb(next)) e.preventDefault()
    })
    win.on('closed', () => {
      win = null
    })
    if (parent && !parent.isDestroyed()) {
      const [x, y] = parent.getPosition()
      win.setPosition(x + 60, y + 40)
    }
  }
  void win.loadURL(url)
  win.show()
  win.focus()
  return true
}

export function platformStatus(): PlatformStatus {
  if (!win || win.isDestroyed()) return { open: false, url: null, title: null }
  return { open: true, url: win.webContents.getURL() || null, title: win.webContents.getTitle() || null }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])

/** Read the page open in the platform window: its text and the code in its editors, from every frame. */
export async function capturePlatform(): Promise<PageCapture | null> {
  if (!win || win.isDestroyed()) return null
  const main = win.webContents.mainFrame
  const frames: WebFrameMain[] = [main, ...main.framesInSubtree.filter((f) => f !== main)].slice(0, 12)
  const results = await Promise.all(frames.map((f) => withTimeout(f.executeJavaScript(CAPTURE_SCRIPT).catch(() => null), 4000)))
  return mergeCaptures(results, new Date())
}

/** Forget every sign-in made in the platform window. */
export async function signOutPlatforms(): Promise<void> {
  if (win && !win.isDestroyed()) win.close()
  await platformSession().clearStorageData()
}
