// GitLab (gitlab.ethz.ch, gitlab.inf.ethz.ch, gitlab.com…): problem sets that are repositories. A course links a
// group (one repository per exercise) or one repository (a folder per exercise). The app runs GL_CLIENT inside a
// page of that GitLab in the platform window's session, where the learner signed in as usual: GitLab's REST API
// takes the session cookie for reads, so no access token is needed. It only reads.
import type { ExamPrep, GitLabLink, OnlineTask } from './types'
import { CODE_EXTENSIONS } from './exam'
import { uid } from './util'

export type GlOp =
  | { op: 'resolve'; origin: string; path: string }
  | { op: 'sync'; origin: string; kind: GitLabLink['kind']; id: number }
  | { op: 'code'; origin: string; projectId: number; path: string; ref: string }

export type GlResult<T> = { ok: true; data: T } | { ok: false; signedIn: boolean; error: string }

/** One exercise: a repository of the group, or a folder of the linked repository. */
export interface GlExercise {
  key: string
  name: string
  projectId: number
  /** folder in the repository ('' for the whole repository) */
  path: string
  ref: string
  webUrl: string
  readme: string | null
  /** the learner has commits there */
  mine: boolean
  lastCommitAt: string | null
  /** the latest pipeline's tests (for a folder: the suites named after it), null without a test report */
  tests: { passed: number; total: number } | null
  pipeline: string | null
}

/** A GitLab link the learner pasted: its origin and the group or project path. Null for anything else. */
export function parseGitLabUrl(raw: string): { origin: string; path: string } | null {
  try {
    const u = new URL(/^[a-z][\w+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const parts = u.pathname.split('/').filter(Boolean)
    const stop = parts.indexOf('-')
    const path = (stop >= 0 ? parts.slice(0, stop) : parts).filter((p) => !/^(groups|dashboard)$/.test(p)).join('/').replace(/\.git$/, '')
    if (!path || !/^[\w.\-/]+$/.test(path)) return null
    return { origin: u.origin, path }
  } catch {
    return null
  }
}

export function glScript(op: GlOp): string {
  return `(${GL_CLIENT})(${JSON.stringify({ ...op, exts: CODE_EXTENSIONS })})`
}

const GL_CLIENT = String.raw`async function (op) {
  const api = async (p, raw) => {
    const r = await fetch('/api/v4' + p, { credentials: 'same-origin', headers: { Accept: raw ? '*/*' : 'application/json' } })
    if (r.status === 401) { const e = new Error('not signed in'); e.signedOut = true; throw e }
    if (!r.ok) { const e = new Error(p.split('?')[0] + ': HTTP ' + r.status); e.status = r.status; throw e }
    return raw ? r.text() : r.json()
  }
  const soft = (p, raw) => api(p, raw).catch((e) => { if (e.signedOut) throw e; return null })
  const enc = encodeURIComponent
  const README = /^readme(\.(md|markdown|txt|rst))?$/i
  const readmeOf = async (pid, ref, dir) => {
    const tree = (await soft('/projects/' + pid + '/repository/tree?per_page=100&ref=' + enc(ref) + (dir ? '&path=' + enc(dir) : ''))) || []
    const f = tree.find((x) => x.type === 'blob' && README.test(x.name))
    if (!f) return { readme: null, tree }
    const t = await soft('/projects/' + pid + '/repository/files/' + enc(f.path) + '/raw?ref=' + enc(ref), true)
    return { readme: typeof t === 'string' ? t.slice(0, 30000) : null, tree }
  }
  const mineIn = async (pid, ref, dir, me) => {
    const cs = (await soft('/projects/' + pid + '/repository/commits?per_page=50&ref_name=' + enc(ref) + (dir ? '&path=' + enc(dir) : ''))) || []
    const own = cs.filter((c) => (me.email && (c.author_email || '').toLowerCase() === me.email) || (me.name && c.author_name === me.name) || (me.username && (c.author_email || '').toLowerCase().startsWith(me.username + '@')))
    return { mine: own.length > 0, at: own[0] ? own[0].committed_date || own[0].created_at : null }
  }
  const pipelineOf = async (pid, ref) => {
    const ps = (await soft('/projects/' + pid + '/pipelines?per_page=1&ref=' + enc(ref))) || []
    if (!ps[0]) return null
    const rep = await soft('/projects/' + pid + '/pipelines/' + ps[0].id + '/test_report')
    return { status: ps[0].status, suites: rep && Array.isArray(rep.test_suites) ? rep.test_suites.map((s) => ({ name: String(s.name || ''), passed: s.success_count || 0, total: s.total_count || 0 })) : [] }
  }
  const sum = (suites) => { const t = suites.reduce((a, s) => a + s.total, 0); return t ? { passed: suites.reduce((a, s) => a + s.passed, 0), total: t } : null }
  try {
    let me
    try { me = await api('/user') } catch (e) { if (e.signedOut) return { ok: false, signedIn: false, error: 'not signed in' }; throw e }
    me = { email: String(me.email || me.commit_email || me.public_email || '').toLowerCase(), name: me.name || '', username: String(me.username || '').toLowerCase() }
    if (op.op === 'resolve') {
      const g = await soft('/groups/' + enc(op.path) + '?with_projects=false')
      if (g && g.id) return { ok: true, data: { kind: 'group', id: g.id, path: g.full_path, name: g.full_name || g.name, webUrl: g.web_url } }
      const p = await soft('/projects/' + enc(op.path))
      if (p && p.id) return { ok: true, data: { kind: 'project', id: p.id, path: p.path_with_namespace, name: p.name_with_namespace || p.name, webUrl: p.web_url } }
      return { ok: false, signedIn: true, error: 'no group or repository at ' + op.path + ' that you can see' }
    }
    if (op.op === 'sync') {
      const out = []
      if (op.kind === 'group') {
        const ps = ((await api('/groups/' + op.id + '/projects?include_subgroups=true&archived=false&per_page=100&order_by=name&sort=asc')) || []).slice(0, 60)
        for (let i = 0; i < ps.length; i += 6) {
          await Promise.all(ps.slice(i, i + 6).map(async (p) => {
            const ref = p.default_branch || 'main'
            const [{ readme }, own, pipe] = await Promise.all([readmeOf(p.id, ref, ''), mineIn(p.id, ref, '', me), pipelineOf(p.id, ref)])
            out.push({ key: 'p' + p.id, name: p.name, projectId: p.id, path: '', ref, webUrl: p.web_url, readme, mine: own.mine, lastCommitAt: own.at, tests: pipe ? sum(pipe.suites) : null, pipeline: pipe ? pipe.status : null })
          }))
        }
      } else {
        const p = await api('/projects/' + op.id)
        const ref = p.default_branch || 'main'
        const tree = (await api('/projects/' + p.id + '/repository/tree?per_page=100&ref=' + enc(ref))) || []
        const dirs = tree.filter((x) => x.type === 'tree' && /\d/.test(x.name) && !x.name.startsWith('.')).slice(0, 40)
        const pipe = await pipelineOf(p.id, ref)
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
        if (!dirs.length) {
          const [{ readme }, own] = await Promise.all([readmeOf(p.id, ref, ''), mineIn(p.id, ref, '', me)])
          out.push({ key: 'p' + p.id, name: p.name, projectId: p.id, path: '', ref, webUrl: p.web_url, readme, mine: own.mine, lastCommitAt: own.at, tests: pipe ? sum(pipe.suites) : null, pipeline: pipe ? pipe.status : null })
        }
        for (let i = 0; i < dirs.length; i += 6) {
          await Promise.all(dirs.slice(i, i + 6).map(async (d) => {
            const [{ readme }, own] = await Promise.all([readmeOf(p.id, ref, d.path), mineIn(p.id, ref, d.path, me)])
            const suites = pipe ? pipe.suites.filter((s) => norm(s.name).includes(norm(d.name))) : []
            out.push({ key: 'p' + p.id + ':' + d.path, name: d.name, projectId: p.id, path: d.path, ref, webUrl: p.web_url + '/-/tree/' + enc(ref) + '/' + d.path.split('/').map(enc).join('/'), readme, mine: own.mine, lastCommitAt: own.at, tests: sum(suites), pipeline: pipe ? pipe.status : null })
          }))
        }
      }
      return { ok: true, data: out }
    }
    if (op.op === 'code') {
      const tree = (await api('/projects/' + op.projectId + '/repository/tree?recursive=true&per_page=100&ref=' + enc(op.ref) + (op.path ? '&path=' + enc(op.path) : ''))) || []
      const files = tree.filter((x) => x.type === 'blob' && op.exts.includes((x.name.split('.').pop() || '').toLowerCase()) && !/(^|\/)(\.|node_modules\/|build\/|vendor\/)/.test(x.path)).slice(0, 15)
      const out = []
      for (const f of files) {
        const t = await soft('/projects/' + op.projectId + '/repository/files/' + enc(f.path) + '/raw?ref=' + enc(op.ref), true)
        if (typeof t === 'string') out.push({ path: f.path, content: t.slice(0, 100000) })
      }
      return { ok: true, data: out }
    }
    return { ok: false, signedIn: true, error: 'unknown operation' }
  } catch (e) {
    return { ok: false, signedIn: !e.signedOut, error: String((e && e.message) || e) }
  }
}`

// ---------------------------------------------------------------- checking what came back
const str = (v: unknown, n = 300): string => (typeof v === 'string' ? v.slice(0, n) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)

/** An operation that came over IPC or HTTP, checked; null when it is not one. */
export function checkGlOp(raw: unknown): GlOp | null {
  const r = (raw ?? {}) as Record<string, unknown>
  let origin: string
  try {
    const u = new URL(str(r.origin, 300))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    origin = u.origin
  } catch {
    return null
  }
  const path = str(r.path, 300)
  if (r.op === 'resolve' && /^[\w.\-/]+$/.test(path)) return { op: 'resolve', origin, path }
  if (r.op === 'sync' && (r.kind === 'group' || r.kind === 'project') && num(r.id) !== null) return { op: 'sync', origin, kind: r.kind, id: num(r.id) as number }
  if (r.op === 'code' && num(r.projectId) !== null && /^[\w.\-/ ]*$/.test(path) && !path.includes('..') && /^[\w.\-/]{1,200}$/.test(str(r.ref, 200)))
    return { op: 'code', origin, projectId: num(r.projectId) as number, path, ref: str(r.ref, 200) }
  return null
}

export function normalizeResolved(raw: unknown, origin: string): GitLabLink | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = num(r.id)
  if (id === null || (r.kind !== 'group' && r.kind !== 'project')) return null
  return { origin, kind: r.kind, id, path: str(r.path, 300), name: str(r.name, 200) || str(r.path, 300), syncedAt: null }
}

const date = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)

/** The exercises in a natural order ("ex2" before "ex10"). */
export function normalizeExercises(raw: unknown): GlExercise[] {
  const out: GlExercise[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const projectId = num(r.projectId)
    const key = str(r.key, 400)
    if (projectId === null || !key || out.some((e) => e.key === key)) continue
    const t = (r.tests ?? null) as Record<string, unknown> | null
    const total = num(t?.total)
    const passed = num(t?.passed)
    out.push({
      key,
      name: str(r.name, 120).trim() || 'Exercise',
      projectId,
      path: str(r.path, 300),
      ref: str(r.ref, 200) || 'main',
      webUrl: /^https?:\/\//.test(str(r.webUrl, 2000)) ? str(r.webUrl, 2000) : '',
      readme: str(r.readme, 30_000).trim() || null,
      mine: r.mine === true,
      lastCommitAt: date(r.lastCommitAt),
      tests: total && passed !== null && passed <= total ? { passed, total } : null,
      pipeline: str(r.pipeline, 40) || null
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export interface GlPlan {
  online: OnlineTask[]
  /** exercises the learner worked on with a test report: log (or update) the tests passed */
  results: { taskId: string; points: number; max: number; note: string }[]
  /** exercises the learner committed to, without tests: started */
  started: string[]
  added: string[]
  updated: number
}

/** Logged results that came from a sync start with this, so a later sync updates them. */
export const GL_NOTE = 'From GitLab CI:'

/** Fold the synced exercises into the course's online tasks, matched by repository and folder. */
export function planGitLab(prep: Pick<ExamPrep, 'online'>, exercises: GlExercise[], now: Date): GlPlan {
  const online = [...prep.online]
  const plan: GlPlan = { online, results: [], started: [], added: [], updated: 0 }
  for (const e of exercises) {
    const meta = { key: e.key, projectId: e.projectId, path: e.path, ref: e.ref, tests: e.tests, pipeline: e.pipeline, mine: e.mine, lastCommitAt: e.lastCommitAt }
    let i = online.findIndex((t) => t.gitlab?.key === e.key)
    if (i < 0) {
      online.push({ id: uid('ot_'), kind: 'exercises', title: e.name, platform: 'GitLab', url: e.webUrl || null, conceptIds: [], statement: e.readme, addedAt: now.toISOString(), gitlab: meta })
      i = online.length - 1
      plan.added.push(online[i].id)
    } else {
      const prev = online[i]
      if (JSON.stringify(prev.gitlab) !== JSON.stringify(meta) || (e.readme && prev.statement !== e.readme)) plan.updated++
      online[i] = { ...prev, statement: e.readme ?? prev.statement, gitlab: meta }
    }
    if (!e.mine) continue
    if (e.tests) plan.results.push({ taskId: online[i].id, points: e.tests.passed, max: e.tests.total, note: `${GL_NOTE} ${e.tests.passed}/${e.tests.total} tests passed (pipeline ${e.pipeline ?? 'unknown'})` })
    else plan.started.push(online[i].id)
  }
  return plan
}

/** The learner's code of an exercise as Markdown, for the check. */
export function glCode(t: OnlineTask, files: { path: string; content: string }[]): string {
  const g = t.gitlab
  const head = g?.tests ? `CI on GitLab: ${g.tests.passed}/${g.tests.total} tests passed (pipeline ${g.pipeline ?? 'unknown'}).` : g?.pipeline ? `CI pipeline on GitLab: ${g.pipeline}, no test report.` : ''
  const body = files.map((f) => `${f.path}:\n\`\`\`${(/\.([a-z0-9]+)$/i.exec(f.path)?.[1] ?? '').toLowerCase()}\n${f.content.replace(/\s+$/, '')}\n\`\`\``)
  return [head, ...body].filter(Boolean).join('\n\n')
}

/** The scripted GitLab for the demo and the tests. */
export function fakeGitLab(op: GlOp): GlResult<unknown> {
  if (op.op === 'resolve') return { ok: true, data: { kind: 'group', id: 7, path: op.path, name: 'Fixture Course / Exercises', webUrl: `${op.origin}/${op.path}` } }
  if (op.op === 'code') return { ok: true, data: [{ path: `${op.path ? op.path + '/' : ''}queue.c`, content: 'int pop(struct q *q) {\n  return q->items[q->head++];\n}\n' }] }
  const base = `${op.origin}/fixture`
  return {
    ok: true,
    data: [
      { key: 'p11', name: 'ex02-queues', projectId: 11, path: '', ref: 'main', webUrl: `${base}/ex02-queues`, readme: '# Exercise 2\nImplement a ring-buffer queue.', mine: true, lastCommitAt: '2026-11-20T10:00:00Z', tests: { passed: 5, total: 8 }, pipeline: 'failed' },
      { key: 'p10', name: 'ex01-pointers', projectId: 10, path: '', ref: 'main', webUrl: `${base}/ex01-pointers`, readme: '# Exercise 1\nSwap two ints through pointers.', mine: true, lastCommitAt: '2026-11-10T10:00:00Z', tests: null, pipeline: null },
      { key: 'p12', name: 'ex10-caches', projectId: 12, path: '', ref: 'main', webUrl: `${base}/ex10-caches`, readme: null, mine: false, lastCommitAt: null, tests: { passed: 0, total: 6 }, pipeline: 'failed' }
    ]
  }
}
