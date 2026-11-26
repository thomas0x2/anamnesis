// Online platforms where problem sets live (Code Expert, GitLab, Moodle…). None of them has a public API
// for students, so the app opens them in its own window, where the learner signs in as usual (ETH login,
// two-factor and all), and reads the page they have open: its text and the code in its editors. The app
// never sees or stores a password; the sign-in stays in that window's cookies in the data folder.
import { truncate } from './util'

/** What the platform window showed when it was read. */
export interface PageCapture {
  url: string
  title: string
  /** the visible text of the page (all frames) */
  text: string
  /** the contents of code editors on the page (Monaco, Ace, CodeMirror) */
  code: { name: string; value: string }[]
  at: string
}

export interface PlatformStatus {
  open: boolean
  url: string | null
  title: string | null
}

const MAX_TEXT = 60_000
const MAX_CODE = 100_000

/**
 * Runs inside the platform page (each frame): its text and the code in its editors. Editors keep most of
 * their lines out of the DOM, so their own APIs are read where the page exposes them.
 */
export const CAPTURE_SCRIPT = String.raw`(() => {
  const out = { url: location.href, title: document.title, text: '', code: [] }
  const push = (name, value) => {
    if (typeof value !== 'string' || !value.trim() || out.code.some((c) => c.value === value)) return
    out.code.push({ name: String(name || 'code').slice(0, 120), value: value.slice(0, ${MAX_CODE}) })
  }
  try { out.text = String((document.body && document.body.innerText) || '').slice(0, ${MAX_TEXT}) } catch (e) {}
  try {
    const m = window.monaco
    if (m && m.editor) for (const model of m.editor.getModels()) push((model.uri && model.uri.path ? model.uri.path.split('/').pop() : '') || 'code', model.getValue())
  } catch (e) {}
  try {
    if (window.ace) document.querySelectorAll('.ace_editor').forEach((el, i) => {
      try { push(el.getAttribute('data-filename') || el.getAttribute('aria-label') || 'editor-' + (i + 1), window.ace.edit(el).getValue()) } catch (e) {}
    })
  } catch (e) {}
  try { document.querySelectorAll('.CodeMirror').forEach((el, i) => { if (el.CodeMirror) push('editor-' + (i + 1), el.CodeMirror.getValue()) }) } catch (e) {}
  try {
    document.querySelectorAll('.cm-editor').forEach((el, i) => {
      const view = el.cmView && el.cmView.view
      push('editor-' + (i + 1), view ? view.state.doc.toString() : (el.querySelector('.cm-content') || {}).innerText)
    })
  } catch (e) {}
  if (!out.code.length) {
    try { document.querySelectorAll('.monaco-editor .view-lines').forEach((el, i) => push('editor-' + (i + 1) + ' (visible part)', el.innerText)) } catch (e) {}
  }
  return out
})()`

const s = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')

/** Merge what the frames of a page returned (the top frame first) into one capture; null when nothing came back. */
export function mergeCaptures(frames: unknown[], now: Date): PageCapture | null {
  const ok = frames.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
  if (!ok.length) return null
  const top = ok[0]
  const text: string[] = []
  const code: PageCapture['code'] = []
  for (const f of ok) {
    const t = s(f.text, MAX_TEXT).trim()
    if (t && !text.includes(t)) text.push(t)
    for (const c of Array.isArray(f.code) ? f.code : []) {
      const value = s((c as Record<string, unknown>)?.value, MAX_CODE)
      if (value.trim() && !code.some((x) => x.value === value)) code.push({ name: s((c as Record<string, unknown>)?.name, 120) || 'code', value })
    }
  }
  const url = s(top.url, 2000)
  if (!/^https?:\/\//i.test(url)) return null
  return { url, title: s(top.title, 300), text: text.join('\n\n').slice(0, MAX_TEXT), code: code.slice(0, 20), at: now.toISOString() }
}

/** A name for the platform behind a link. */
export function guessPlatform(url: string | null): string {
  const host = (() => {
    try {
      return new URL(url ?? '').hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (!host) return ''
  if (host === 'expert.ethz.ch' || host.endsWith('.expert.ethz.ch') || host.includes('codeexpert')) return 'Code Expert'
  if (host.includes('gitlab')) return 'GitLab'
  if (host === 'github.com' || host.endsWith('.github.com')) return 'GitHub'
  if (host.includes('moodle')) return 'Moodle'
  if (host.includes('jupyter')) return 'Jupyter'
  return host.replace(/^www\./, '')
}

/** A score shown on the page, like "7/8 tests passed", "Passed: 7 of 8", "Punkte: 3 / 4". Null when there is none or several disagree. */
export function findScore(text: string): { points: number; max: number } | null {
  const num = String.raw`(\d+(?:[.,]\d+)?)`
  const sep = String.raw`\s*(?:\/|of|von|out of)\s*`
  const word = String.raw`(?:tests?|test cases?|testcases?|points?|pts|punkte|cases?)`
  const patterns = [
    new RegExp(`${num}${sep}${num}\\s*${word}`, 'gi'),
    new RegExp(`${word}\\s*(?:passed|bestanden|erreicht|score)?\\s*[:=]?\\s*${num}${sep}${num}`, 'gi'),
    new RegExp(`(?:score|passed|bestanden|ergebnis|result)\\s*[:=]?\\s*${num}${sep}${num}`, 'gi')
  ]
  const found: { points: number; max: number }[] = []
  for (const re of patterns)
    for (const m of text.matchAll(re)) {
      const points = Number(m[1].replace(',', '.'))
      const max = Number(m[2].replace(',', '.'))
      if (Number.isFinite(points) && Number.isFinite(max) && max > 0 && points <= max && max <= 1000) found.push({ points, max })
    }
  if (!found.length) return null
  const first = found[0]
  return found.every((f) => f.points === first.points && f.max === first.max) ? first : null
}

const fence = (name: string): string => {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()
  return ext && ext.length <= 6 ? ext : ''
}

/** The code on the page as Markdown code blocks, for a check of the learner's work. */
export function captureCode(c: PageCapture): string {
  return c.code.map((x) => `${x.name}:\n\`\`\`${fence(x.name)}\n${x.value.replace(/\s+$/, '')}\n\`\`\``).join('\n\n')
}

/** The page for the tutor: where it is, the code in its editors, then its text. */
export function captureForTutor(c: PageCapture, limit = 24_000): string {
  const parts = [`Page: ${c.title || '(no title)'}\nURL: ${c.url}\nRead: ${c.at}`]
  if (c.code.length) parts.push(`# Code in the page's editors\n${captureCode(c)}`)
  parts.push(`# Page text\n${c.text || '(empty)'}`)
  return truncate(parts.join('\n\n'), limit)
}

/** The scripted page for the demo and the tests: a Code Expert exercise with code and a test result. */
export function fakeCapture(url: string, now: Date): PageCapture {
  return {
    url,
    title: 'Exercise 4: Lists · Code Expert',
    text: 'Exercise 4: Lists\n\nImplement list_reverse(struct node *head) that reverses a singly linked list in place and returns the new head.\n\nTest results\n7/8 tests passed\nFailed: reverse of an empty list',
    code: [{ name: 'list.c', value: 'struct node *list_reverse(struct node *head) {\n  struct node *prev = NULL;\n  while (head->next) {\n    struct node *next = head->next;\n    head->next = prev;\n    prev = head;\n    head = next;\n  }\n  return prev;\n}\n' }],
    at: now.toISOString()
  }
}

/** The lines of a page that report test results (passed, failed, errors), for the check of the code. */
export function testLines(text: string, limit = 20): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line && line.length <= 300 && /\b(tests?|passed|failed|failing|error|bestanden|fehlgeschlagen|score|punkte)\b/i.test(line) && !out.includes(line)) out.push(line)
    if (out.length >= limit) break
  }
  return out
}
