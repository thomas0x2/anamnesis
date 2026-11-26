// Code Expert (expert.ethz.ch): ETH's platform for programming exercises. It has no public API for
// students; its web app talks to the server over socket.io with msgpack packets (namespace /cx), calling
// named procedures. The app runs CE_SCRIPT inside a Code Expert page in the platform window, where the
// learner is signed in, so the requests carry their session like the site's own. It only reads.
// The structure of the answers is checked here (normalize*), since the site can change without notice.
import type { CodeExpertLink, ExamPrep, OnlineTask } from './types'
import { uid } from './util'

export const CODE_EXPERT_ORIGIN = 'https://expert.ethz.ch'

export interface CeCourse {
  id: string
  name: string
  /** short name in Code Expert's links, e.g. "NumINFK" */
  slug: string
  /** e.g. "AS26" */
  semester: string
}

export interface CeTask {
  id: string
  name: string
  maxPoints: number
  /** 0..1 of the points, from the last marked submission; null when not graded or not submitted */
  result: number | null
  submitted: boolean
  submittedAt: string | null
  /** the TA's comment on the submission */
  feedback: string | null
  /** the learner's own project (their code), when they submitted */
  projectId: string | null
  /** the task statement (Markdown with LaTeX) */
  statement: string | null
}

/** A series (Serie): one problem set of the course. */
export interface CeSeries {
  id: string
  name: string
  due: string | null
  tasks: CeTask[]
}

export interface CeFile {
  path: string
  content: string
}

/** The Code Expert course a course of the app is linked to. */
export type CeLink = CodeExpertLink

/** What a script run in the page returns. */
export type CeResult<T> = { ok: true; data: T } | { ok: false; signedIn: boolean; error: string }

export type CeOp = { op: 'courses' } | { op: 'sync'; courseId: string; semester: string } | { op: 'code'; projectIds: string[] }

/** An operation that came over IPC or HTTP, checked; unknown input becomes a harmless list of courses. */
export function checkCeOp(raw: unknown): CeOp {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = (v: unknown): string => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : '')
  if (r.op === 'sync' && id(r.courseId) && typeof r.semester === 'string' && /^[A-Z]{2}\d{2}$/.test(r.semester)) return { op: 'sync', courseId: id(r.courseId), semester: r.semester }
  if (r.op === 'code' && Array.isArray(r.projectIds)) return { op: 'code', projectIds: r.projectIds.map(id).filter(Boolean).slice(0, 20) }
  return { op: 'courses' }
}

/**
 * The client that runs inside a Code Expert page: opens its own socket to the server (same origin, so the
 * learner's session cookie goes along), calls the procedures for one operation and closes it.
 */
export function ceScript(op: CeOp): string {
  return `(${CE_CLIENT})(${JSON.stringify(op)})`
}

const CE_CLIENT = String.raw`async function (op) {
  const te = new TextEncoder(), td = new TextDecoder()
  function enc(v) {
    const out = []
    const w = (x) => {
      if (x === undefined) return out.push(0xd4, 0, 0)
      if (x === null) return out.push(0xc0)
      if (x === true) return out.push(0xc3)
      if (x === false) return out.push(0xc2)
      if (typeof x === 'number') {
        if (Number.isInteger(x) && x >= 0 && x < 128) return out.push(x)
        if (Number.isInteger(x) && x >= 0 && x < 65536) return out.push(0xcd, x >> 8, x & 255)
        const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return out.push(0xcb, ...new Uint8Array(b.buffer))
      }
      if (typeof x === 'string') {
        const s = te.encode(x), n = s.length
        if (n < 32) out.push(0xa0 | n); else if (n < 256) out.push(0xd9, n); else if (n < 65536) out.push(0xda, n >> 8, n & 255); else out.push(0xdb, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255)
        for (const c of s) out.push(c)
        return
      }
      if (Array.isArray(x)) { const n = x.length; if (n < 16) out.push(0x90 | n); else out.push(0xdc, n >> 8, n & 255); x.forEach(w); return }
      const ks = Object.keys(x), n = ks.length
      if (n < 16) out.push(0x80 | n); else out.push(0xde, n >> 8, n & 255)
      for (const k of ks) { w(k); w(x[k]) }
    }
    w(v)
    return new Uint8Array(out).buffer
  }
  function dec(buf) {
    const v = new DataView(buf); let o = 0
    const str = (n) => { const s = td.decode(new Uint8Array(buf, o, n)); o += n; return s }
    const arr = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(r()); return a }
    const map = (n) => { const m = {}; for (let i = 0; i < n; i++) { const k = r(); m[k] = r() } return m }
    const ext = (n) => { const t = v.getInt8(o); o += 1; let val = null
      if (t === 0 && n === 8) val = new Date(v.getUint32(o) * 4294967296 + v.getUint32(o + 4)).toISOString()
      else if (t === -1 && n === 4) val = new Date(v.getUint32(o) * 1000).toISOString()
      else if (t === -1 && n === 8) { const hi = v.getUint32(o), lo = v.getUint32(o + 4); val = new Date(((hi & 3) * 4294967296 + lo) * 1000).toISOString() }
      else if (t === 0 && n === 1) val = undefined
      o += n; return val }
    function r() {
      const b = v.getUint8(o++)
      if (b < 0x80) return b
      if (b < 0x90) return map(b & 15)
      if (b < 0xa0) return arr(b & 15)
      if (b < 0xc0) return str(b & 31)
      if (b >= 0xe0) return b - 256
      switch (b) {
        case 0xc0: return null
        case 0xc2: return false
        case 0xc3: return true
        case 0xc4: { const n = v.getUint8(o); o += 1 + n; return null }
        case 0xc5: { const n = v.getUint16(o); o += 2 + n; return null }
        case 0xc6: { const n = v.getUint32(o); o += 4 + n; return null }
        case 0xc7: { const n = v.getUint8(o); o += 1; return ext(n) }
        case 0xc8: { const n = v.getUint16(o); o += 2; return ext(n) }
        case 0xc9: { const n = v.getUint32(o); o += 4; return ext(n) }
        case 0xca: { const x = v.getFloat32(o); o += 4; return x }
        case 0xcb: { const x = v.getFloat64(o); o += 8; return x }
        case 0xcc: return v.getUint8(o++)
        case 0xcd: { const x = v.getUint16(o); o += 2; return x }
        case 0xce: { const x = v.getUint32(o); o += 4; return x }
        case 0xcf: { const x = Number(v.getBigUint64(o)); o += 8; return x }
        case 0xd0: return v.getInt8(o++)
        case 0xd1: { const x = v.getInt16(o); o += 2; return x }
        case 0xd2: { const x = v.getInt32(o); o += 4; return x }
        case 0xd3: { const x = Number(v.getBigInt64(o)); o += 8; return x }
        case 0xd4: return ext(1)
        case 0xd5: return ext(2)
        case 0xd6: return ext(4)
        case 0xd7: return ext(8)
        case 0xd8: return ext(16)
        case 0xd9: return str(v.getUint8(o++))
        case 0xda: { const n = v.getUint16(o); o += 2; return str(n) }
        case 0xdb: { const n = v.getUint32(o); o += 4; return str(n) }
        case 0xdc: { const n = v.getUint16(o); o += 2; return arr(n) }
        case 0xdd: { const n = v.getUint32(o); o += 4; return arr(n) }
        case 0xde: { const n = v.getUint16(o); o += 2; return map(n) }
        case 0xdf: { const n = v.getUint32(o); o += 4; return map(n) }
      }
      throw new Error('unknown msgpack byte ' + b)
    }
    return r()
  }
  const cx = await new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://' + location.host + '/socket.io/?connectionId=an' + Math.random().toString(36).slice(2) + '&EIO=4&transport=websocket')
    ws.binaryType = 'arraybuffer'
    let next = 1, signedIn = null
    const pend = new Map(), subs = new Map()
    const send = (p) => ws.send(enc({ ...p, options: { compress: true }, nsp: '/cx' }))
    const api = {
      close: () => { try { ws.close() } catch (e) {} },
      signedIn: () => signedIn,
      invoke: (name, arg) => new Promise((res, rej) => {
        const id = next++
        pend.set(id, (d) => (d && d._tag === 'Right' ? res(d.right) : rej(new Error(name + ': ' + JSON.stringify(d && d.left).slice(0, 200)))))
        send({ type: 2, data: ['invoke', name, arg], id })
        setTimeout(() => { if (pend.delete(id)) rej(new Error(name + ': no answer')) }, 20000)
      }),
      subscribe: (name, arg) => new Promise((res, rej) => {
        const sid = 'an' + Math.random().toString(36).slice(2)
        subs.set(sid, res)
        send({ type: 2, data: ['subscribe', name, arg, sid] })
        setTimeout(() => { if (subs.delete(sid)) rej(new Error(name + ': no answer')) }, 20000)
      })
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (e.data[0] === '0') ws.send(enc({ type: 0, nsp: '/cx' }))
        else if (e.data === '2') ws.send('3')
        return
      }
      const m = dec(e.data)
      if (m.type === 2 && m.data && m.data[0] === 'initConnection') signedIn = !!(m.data[1] && m.data[1].loggedIn)
      else if (m.type === 0) resolve(api)
      else if (m.type === 4) reject(new Error('connection refused'))
      else if (m.type === 3 && pend.has(m.id)) { const f = pend.get(m.id); pend.delete(m.id); f(m.data && m.data[0]) }
      else if (m.type === 2 && m.data && subs.has(m.data[0]) && m.data[1] && m.data[1]._tag === 'initial') {
        const f = subs.get(m.data[0]); subs.delete(m.data[0]); f(m.data[1].value)
        send({ type: 2, data: ['unsubscribe', m.data[0]] })
      }
    }
    ws.onerror = () => reject(new Error('could not connect to Code Expert'))
    setTimeout(() => reject(new Error('Code Expert did not answer')), 15000)
  })
  const fail = (error) => ({ ok: false, signedIn: cx.signedIn() !== false, error: String(error && error.message || error) })
  try {
    if (cx.signedIn() === false) return { ok: false, signedIn: false, error: 'not signed in' }
    if (op.op === 'courses') return { ok: true, data: await cx.invoke('courseSelect.getEnrolledCourses', undefined) }
    if (op.op === 'sync') {
      const q = { courseId: op.courseId, semester: op.semester }
      const series = await cx.subscribe('enrolledExercises_exercisesInCourse', { ...q, type: 'exercise' })
      const taskIds = [].concat(...series.map((s) => s.taskIds || []))
      const [tasks, submissions, templates] = await Promise.all([
        cx.subscribe('enrolledExercises_tasksInCourse', { ...q, taskIds }),
        cx.subscribe('enrolledExercises_submissionsInCourse', { ...q, taskIds }),
        cx.subscribe('enrolledExercises_templateProjectsInCourse', { ...q, taskIds }).catch(() => [])
      ])
      const statements = {}
      const want = taskIds.map((id) => {
        const sub = submissions.find((s) => s.taskId === id && s.projectId)
        const tpl = templates.find((t) => t.taskId === id)
        return [id, (sub && sub.projectId) || (tpl && tpl._id)]
      }).filter((x) => x[1])
      for (let i = 0; i < want.length; i += 6) {
        await Promise.all(want.slice(i, i + 6).map(async ([id, projectId]) => {
          try {
            const d = await cx.invoke('ide_getDescription', { projectId })
            const v = d && d._tag === 'Right' ? d.right : d
            const c = v && v.value && (v.value.default || Object.values(v.value)[0])
            statements[id] = c && typeof c.content === 'string' ? c.content : (typeof (v && v.value) === 'string' ? v.value : null)
          } catch (e) { statements[id] = null }
        }))
      }
      return { ok: true, data: { series, tasks, submissions, statements } }
    }
    if (op.op === 'code') {
      const out = {}
      for (const projectId of op.projectIds.slice(0, 20)) {
        const files = []
        try {
          const t = await cx.invoke('project_getProjectTree', { projectId, role: 'student' })
          const leaves = []
          const walk = (ns) => { for (const n of ns || []) { if (n.isLeaf && !n.readOnly && !String(n.path).startsWith('/cx_description')) leaves.push(n); if (n.children) walk(n.children) } }
          walk(t && t.tree)
          for (const f of leaves.slice(0, 12)) {
            try {
              const c = await cx.invoke('editor_getFileContent', { projectId, fileKey: f.key, end: 131072 })
              if (c && typeof c.content === 'string') files.push({ path: f.path, content: c.content })
            } catch (e) {}
          }
        } catch (e) {}
        out[projectId] = files
      }
      return { ok: true, data: out }
    }
    return { ok: false, signedIn: true, error: 'unknown operation' }
  } catch (e) {
    return fail(e)
  } finally {
    cx.close()
  }
}`

// ---------------------------------------------------------------- checking what came back
const str = (v: unknown, n = 300): string => (typeof v === 'string' ? v.slice(0, n) : '')
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])
const date = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)

/** The courses the learner is enrolled in, newest semester first. */
export function normalizeCourses(raw: unknown): CeCourse[] {
  const seen = new Set<string>()
  const out: CeCourse[] = []
  for (const c of arr(raw)) {
    const course = { id: str(c._id, 40), name: str(c.name, 200), slug: str(c.url, 60), semester: str(c.semester, 10) }
    const key = `${course.id}/${course.semester}`
    if (!course.id || !course.name || !/^[A-Z]{2}\d{2}$/.test(course.semester) || seen.has(key)) continue
    seen.add(key)
    out.push(course)
  }
  return out.sort((a, b) => semesterRank(b.semester) - semesterRank(a.semester) || a.name.localeCompare(b.name))
}

/** "AS26" after "SS26" after "AS25". */
export function semesterRank(s: string): number {
  const m = /^([A-Z]{2})(\d{2})$/.exec(s)
  if (!m) return 0
  return Number(m[2]) * 2 + (m[1] === 'AS' || m[1] === 'HS' ? 1 : 0)
}

/** The series with their tasks, scores and statements, in the course's order. */
export function normalizeSync(raw: unknown): CeSeries[] {
  const r = (raw ?? {}) as Record<string, unknown>
  const tasks = new Map(arr(r.tasks).map((t) => [str(t._id, 40), t]))
  const statements = (r.statements && typeof r.statements === 'object' ? r.statements : {}) as Record<string, unknown>
  const subs = arr(r.submissions)
  return arr(r.series)
    .map((s) => {
      const ids = Array.isArray(s.taskIds) ? s.taskIds.filter((x): x is string => typeof x === 'string') : []
      return {
        id: str(s._id, 40),
        name: str(s.name, 200).trim(),
        due: date(s.dueDate),
        tasks: ids
          .map((id): CeTask | null => {
            const t = tasks.get(id)
            if (!t) return null
            const grading = (t.grading ?? {}) as Record<string, unknown>
            const mine = subs.filter((x) => x.taskId === id).sort((a, b) => String(b.submissionDate ?? '').localeCompare(String(a.submissionDate ?? '')))
            const marked = mine.find((x) => typeof x.result === 'number') ?? mine[0]
            const result = typeof marked?.result === 'number' ? Math.max(0, Math.min(1, marked.result)) : typeof marked?.autograderResult === 'number' ? Math.max(0, Math.min(1, marked.autograderResult)) : null
            return {
              id,
              name: str(t.name, 200).trim() || 'Task',
              maxPoints: typeof grading.maximumPoints === 'number' && grading.maximumPoints > 0 ? grading.maximumPoints : 1,
              result,
              submitted: mine.length > 0,
              submittedAt: date(marked?.submissionDate),
              feedback: str(marked?.comments, 2000).trim() || null,
              projectId: str(mine.find((x) => typeof x.projectId === 'string')?.projectId, 40) || null,
              statement: str(statements[id], 20_000).trim() || null
            }
          })
          .filter((t): t is CeTask => t !== null)
      }
    })
    .filter((s) => s.id && s.name && s.tasks.length)
}

/** Points of a series: what the marked submissions earned, out of all its tasks' points. */
export function seriesScore(s: CeSeries): { points: number; max: number; submitted: number } {
  const max = s.tasks.reduce((a, t) => a + t.maxPoints, 0)
  const points = Math.round(s.tasks.reduce((a, t) => a + (t.result ?? 0) * t.maxPoints, 0) * 100) / 100
  return { points, max, submitted: s.tasks.filter((t) => t.submitted).length }
}

/** The statement of a whole series, for the check of the learner's code and for the tutor. */
export function seriesStatement(s: CeSeries): string {
  return s.tasks.map((t) => `## ${t.name} (${t.maxPoints} ${t.maxPoints === 1 ? 'point' : 'points'})\n\n${t.statement ?? '(statement not available)'}`).join('\n\n')
}

export const seriesUrl = (link: Pick<CeLink, 'semester' | 'slug'>): string => `${CODE_EXPERT_ORIGIN}/enrolled/${link.semester}/${link.slug}/exercises`

export interface SyncPlan {
  online: OnlineTask[]
  /** series whose every task is submitted and some graded: log (or update) their result, over the graded tasks */
  results: { taskId: string; points: number; max: number; note: string }[]
  /** series with every task submitted but none graded yet: done, without a score */
  done: string[]
  /** series with some tasks submitted: started */
  started: string[]
  /** ids of the online tasks the sync created */
  added: string[]
  updated: number
}

/** Logged results that came from a sync start with this, so a later sync updates them instead of adding more. */
export const SYNC_NOTE = 'From Code Expert:'

const pts = (x: number): number => Math.round(x * 100) / 100

/** Fold the synced series into the course's online tasks: each series is one problem set, matched by its Code Expert id. */
export function planSync(prep: Pick<ExamPrep, 'online'>, series: CeSeries[], link: Pick<CeLink, 'semester' | 'slug'>, now: Date): SyncPlan {
  const online = [...prep.online]
  const plan: SyncPlan = { online, results: [], done: [], started: [], added: [], updated: 0 }
  for (const s of series) {
    let i = online.findIndex((t) => t.codeExpert?.seriesId === s.id)
    const statement = seriesStatement(s)
    const meta = { seriesId: s.id, due: s.due, tasks: s.tasks.map((t) => ({ id: t.id, name: t.name, maxPoints: t.maxPoints, result: t.result, submitted: t.submitted, feedback: t.feedback, projectId: t.projectId })) }
    if (i < 0) {
      online.push({ id: uid('ot_'), kind: 'exercises', title: s.name.slice(0, 120), platform: 'Code Expert', url: seriesUrl(link), conceptIds: [], statement, addedAt: now.toISOString(), codeExpert: meta })
      i = online.length - 1
      plan.added.push(online[i].id)
    } else {
      const prev = online[i]
      if (JSON.stringify(prev.codeExpert) !== JSON.stringify(meta) || prev.statement !== statement) plan.updated++
      online[i] = { ...prev, statement, codeExpert: meta }
    }
    const submitted = s.tasks.filter((t) => t.submitted).length
    const graded = s.tasks.filter((t) => t.result !== null)
    if (submitted === s.tasks.length && graded.length) {
      const pending = s.tasks.length - graded.length
      plan.results.push({
        taskId: online[i].id,
        points: pts(graded.reduce((a, t) => a + (t.result ?? 0) * t.maxPoints, 0)),
        max: graded.reduce((a, t) => a + t.maxPoints, 0),
        note: `${SYNC_NOTE} ${s.tasks.map((t) => `${t.name} ${t.result === null ? 'not graded yet' : `${pts(t.result * t.maxPoints)}/${t.maxPoints}`}`).join('; ')}${pending ? ` (${pending} not graded yet, left out of the score)` : ''}`
      })
    } else if (submitted === s.tasks.length) plan.done.push(online[i].id)
    else if (submitted > 0) plan.started.push(online[i].id)
  }
  return plan
}

/** The concepts of the course a statement most likely practises, by their names (English or the script's German terms) in it. */
export function guessConcepts(text: string, concepts: { id: string; title: string; de?: string }[], max = 4): string[] {
  const norm = (x: string): string => ` ${x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const hay = norm(text)
  const words = new Set(hay.trim().split(' '))
  const scored: { id: string; score: number }[] = []
  for (const c of concepts) {
    let best = 0
    for (const term of [c.title, ...(c.de ?? '').split(/[,;/]/)]) {
      const t = norm(term).trim()
      if (t.length < 4) continue
      if (hay.includes(` ${t} `)) best = Math.max(best, 2 + t.split(' ').length / 10)
      else {
        const ws = t.split(' ').filter((w) => w.length >= 4)
        if (ws.length >= 2) {
          const hit = ws.filter((w) => words.has(w)).length / ws.length
          if (hit >= 0.99) best = Math.max(best, 1)
        }
      }
    }
    if (best > 0) scored.push({ id: c.id, score: best })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.id)
}

/** The learner's code of a series as Markdown, task by task, for the check. */
export function seriesCode(t: OnlineTask, files: Record<string, CeFile[]>): string {
  const tasks = t.codeExpert?.tasks ?? []
  const parts: string[] = []
  for (const task of tasks) {
    const fs = task.projectId ? files[task.projectId] ?? [] : []
    const score = task.result === null ? (task.submitted ? 'submitted, not graded' : 'not submitted') : `${Math.round(task.result * task.maxPoints * 100) / 100}/${task.maxPoints} points on Code Expert`
    parts.push(`## ${task.name} (${score})`)
    if (!fs.length) parts.push(task.submitted ? '(no code found)' : '(not submitted)')
    for (const f of fs) {
      const ext = (/\.([a-z0-9]+)$/i.exec(f.path)?.[1] ?? '').toLowerCase()
      parts.push(`${f.path}:\n\`\`\`${ext}\n${f.content.replace(/\s+$/, '')}\n\`\`\``)
    }
    if (task.feedback) parts.push(`TA feedback on Code Expert: ${task.feedback}`)
  }
  return parts.join('\n\n')
}

/** The Code Expert course that most likely matches a course of the app (by name), newest semester first. */
export function guessCourse(courses: CeCourse[], title: string): CeCourse | null {
  const words = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2)
  const want = new Set(words(title))
  let best: CeCourse | null = null
  let bestScore = 0
  for (const c of courses) {
    const have = words(`${c.name} ${c.slug}`)
    const score = have.filter((w) => want.has(w)).length / Math.max(1, Math.min(have.length, want.size))
    if (score > bestScore + 1e-9) {
      best = c
      bestScore = score
    }
  }
  return bestScore >= 0.5 ? best : null
}

/** The scripted Code Expert for the demo and the tests. */
export function fakeCodeExpert(op: CeOp): CeResult<unknown> {
  if (op.op === 'courses') return { ok: true, data: [{ _id: 'c1', name: 'Fixture Systems', url: 'fs', semester: 'AS26' }, { _id: 'c2', name: 'Other Course', url: 'oc', semester: 'AS25' }] }
  if (op.op === 'code') return { ok: true, data: Object.fromEntries(op.projectIds.map((p) => [p, [{ path: '/main.py', content: 'def solve(n):\n    return [1 - k for k in range(n)]\n' }]])) }
  const due = '2026-10-01T12:00:00.000Z'
  return {
    ok: true,
    data: {
      series: [
        { _id: 'se1', name: 'Serie 1: Basics', dueDate: due, taskIds: ['t1', 't2'] },
        { _id: 'se2', name: 'Serie 2: Lists', dueDate: due, taskIds: ['t3', 't4'] },
        { _id: 'se3', name: 'Serie 3: Trees', dueDate: due, taskIds: ['t5'] }
      ],
      tasks: [
        { _id: 't1', name: 'Recursion', grading: { maximumPoints: 2 } },
        { _id: 't2', name: 'Loops', grading: { maximumPoints: 2 } },
        { _id: 't3', name: 'Reverse', grading: { maximumPoints: 4 } },
        { _id: 't4', name: 'Merge', grading: { maximumPoints: 4 } },
        { _id: 't5', name: 'Depth', grading: { maximumPoints: 2 } }
      ],
      submissions: [
        { taskId: 't1', result: 1, projectId: 'p1', submissionDate: due, comments: 'Top :)' },
        { taskId: 't2', result: 0.5, projectId: 'p2', submissionDate: due },
        { taskId: 't3', result: null, projectId: 'p3', submissionDate: due }
      ],
      statements: { t1: 'Compute $y_n = 1 - n y_{n-1}$ forwards and backwards.', t2: 'Sum with a loop.', t3: 'Reverse a list.', t4: 'Merge two lists.', t5: 'Depth of a tree.' }
    }
  }
}
