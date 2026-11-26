// The platform window: Code Expert, GitLab, Moodle… opened inside the app so the learner signs in there as
// usual and the app can read the page they have open (see src/shared/platform.ts). It is an ordinary
// sandboxed browser window with its own persistent session ("persist:platforms"): no preload, no access to
// the app, every permission request denied. Its cookies are the sign-in; "Sign out" clears them.
import { BrowserWindow, session, type WebFrameMain } from 'electron'
import { CODE_EXPERT_ORIGIN, ceScript, type CeOp, type CeResult } from '../shared/codeExpert'
import { glScript, type GlOp, type GlResult } from '../shared/gitlab'
import { CAPTURE_SCRIPT, mergeCaptures, type PageCapture, type PlatformStatus } from '../shared/platform'

const PARTITION = 'persist:platforms'
let win: BrowserWindow | null = null
let onActivity: (() => void) | null = null
let lastActivity = 0

/** Tell the app when the learner works in the platform window (focus, typing, clicks), so that time counts as study. */
export function setPlatformActivity(fn: (() => void) | null): void {
  onActivity = fn
}

function activity(): void {
  const t = Date.now()
  if (t - lastActivity < 5000) return
  lastActivity = t
  onActivity?.()
}
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
    // input and focus only signal that the learner is there; nothing about the page is passed on
    win.on('focus', activity)
    win.webContents.on('before-input-event', activity)
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

const sameOrigin = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

let busy: Promise<unknown> = Promise.resolve()

type PageResult = { ok: true; data: unknown } | { ok: false; signedIn: boolean; error: string }

/**
 * Run a read-only script inside a page of a platform (Code Expert, GitLab) in a hidden window on the platform
 * session, so its requests carry the learner's sign-in. When they are not signed in, the visible platform
 * window opens at that site for it. One run at a time.
 */
function runInPage(origin: string, script: string, signIn: string, parent: BrowserWindow | null): Promise<PageResult> {
  const run = async (): Promise<PageResult> => {
    const bg = new BrowserWindow({ show: false, webPreferences: { session: platformSession(), sandbox: true, contextIsolation: true, nodeIntegration: false } })
    bg.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await withTimeout(bg.loadURL(`${origin}/`).catch(() => undefined), 30_000)
      let res: PageResult | null
      if (sameOrigin(bg.webContents.getURL(), origin))
        res = (await withTimeout(bg.webContents.executeJavaScript(script, true) as Promise<PageResult>, 180_000).catch((e: unknown) => ({ ok: false as const, signedIn: true, error: String(e) }))) ?? { ok: false, signedIn: true, error: 'the site took too long' }
      else res = { ok: false, signedIn: false, error: 'not signed in' }
      if (!res || typeof res !== 'object') res = { ok: false, signedIn: true, error: 'no answer from the site' }
      if (!res.ok && !res.signedIn) openPlatform(signIn, parent)
      return res
    } finally {
      if (!bg.isDestroyed()) bg.destroy()
    }
  }
  const p = busy.then(run, run)
  busy = p.catch(() => undefined)
  return p
}

/** Run one Code Expert operation (courses, sync, code) with the learner's sign-in. */
export function runCodeExpert(op: CeOp, parent: BrowserWindow | null): Promise<CeResult<unknown>> {
  return runInPage(CODE_EXPERT_ORIGIN, ceScript(op), `${CODE_EXPERT_ORIGIN}/`, parent)
}

/** Run one GitLab operation (resolve a link, sync, code) on that GitLab with the learner's sign-in. */
export function runGitLab(op: GlOp, parent: BrowserWindow | null): Promise<GlResult<unknown>> {
  return runInPage(op.origin, glScript(op), `${op.origin}/users/sign_in`, parent)
}

/** Forget every sign-in made in the platform window. */
export async function signOutPlatforms(): Promise<void> {
  if (win && !win.isDestroyed()) win.close()
  await platformSession().clearStorageData()
}
