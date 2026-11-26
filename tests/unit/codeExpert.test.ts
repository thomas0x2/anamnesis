import { afterEach, describe, expect, it } from 'vitest'
import { ceScript, checkCeOp, fakeCodeExpert, guessConcepts, guessCourse, normalizeCourses, normalizeSync, planSync, semesterRank, seriesCode, seriesScore, SYNC_NOTE, type CeResult } from '../../src/shared/codeExpert'
import { emptyPrep, normalizePrep } from '../../src/shared/exam'

const now = new Date('2026-11-26T20:00:00Z')
const link = { courseId: 'c1', semester: 'AS26', name: 'Fixture Systems', slug: 'fs', syncedAt: null }
const synced = (): ReturnType<typeof normalizeSync> => {
  const r = fakeCodeExpert({ op: 'sync', courseId: 'c1', semester: 'AS26' })
  if (!r.ok) throw new Error('fake failed')
  return normalizeSync(r.data)
}

describe('Code Expert answers', () => {
  it('keeps enrolled courses once per semester, newest first', () => {
    const cs = normalizeCourses([
      { _id: 'a', name: 'NumCS', url: 'NumINFK', semester: 'AS25' },
      { _id: 'a', name: 'NumCS', url: 'NumINFK', semester: 'AS26' },
      { _id: 'a', name: 'NumCS', url: 'NumINFK', semester: 'AS26' },
      { _id: 'b', name: 'Broken', semester: 'whenever' },
      null
    ])
    expect(cs.map((c) => `${c.slug}/${c.semester}`)).toEqual(['NumINFK/AS26', 'NumINFK/AS25'])
    expect(semesterRank('AS26')).toBeGreaterThan(semesterRank('SS26'))
    expect(semesterRank('SS26')).toBeGreaterThan(semesterRank('AS25'))
    expect(normalizeCourses('nope')).toEqual([])
  })

  it('turns series, tasks and submissions into problem sets with scores', () => {
    const s = synced()
    expect(s.map((x) => x.name)).toEqual(['Serie 1: Basics', 'Serie 2: Lists', 'Serie 3: Trees'])
    expect(s[0].tasks.map((t) => [t.name, t.result, t.submitted])).toEqual([
      ['Recursion', 1, true],
      ['Loops', 0.5, true]
    ])
    expect(s[0].tasks[0].feedback).toBe('Top :)')
    expect(s[0].tasks[0].statement).toContain('y_n')
    expect(seriesScore(s[0])).toEqual({ points: 3, max: 4, submitted: 2 })
    expect(s[1].tasks[0]).toMatchObject({ result: null, submitted: true, projectId: 'p3' })
    expect(s[2].tasks[0]).toMatchObject({ submitted: false, projectId: null })
    expect(normalizeSync(null)).toEqual([])
  })

  it('creates one task per series, logs fully submitted ones and matches them again on the next sync', () => {
    const first = planSync(emptyPrep(), synced(), link, now)
    expect(first.added).toHaveLength(3)
    expect(first.online[0]).toMatchObject({ title: 'Serie 1: Basics', platform: 'Code Expert', url: 'https://expert.ethz.ch/enrolled/AS26/fs/exercises' })
    expect(first.online[0].statement).toContain('## Recursion (2 points)')
    expect(first.results).toEqual([{ taskId: first.online[0].id, points: 3, max: 4, note: `${SYNC_NOTE} Recursion 2/2; Loops 1/2` }])
    expect(first.done).toEqual([])
    expect(first.started).toEqual([first.online[1].id])

    // stored and read back: the Code Expert data survives
    const stored = normalizePrep(JSON.parse(JSON.stringify({ ...emptyPrep(), online: first.online, codeExpert: link })))
    expect(stored.codeExpert).toEqual(link)
    expect(stored.online[0].codeExpert?.tasks).toHaveLength(2)

    const again = planSync(stored, synced(), link, now)
    expect(again.added).toEqual([])
    expect(again.updated).toBe(0)
    expect(again.online.map((t) => t.id)).toEqual(first.online.map((t) => t.id))
  })

  it('scores only graded tasks, and marks a series with nothing graded yet as done', () => {
    const s = synced()
    s[1].tasks[1] = { ...s[1].tasks[1], submitted: true, result: 0.75, projectId: 'p4' }
    s[2].tasks[0] = { ...s[2].tasks[0], submitted: true, projectId: 'p5' }
    const plan = planSync(emptyPrep(), s, link, now)
    const lists = plan.results.find((r) => r.taskId === plan.online[1].id)
    expect(lists).toMatchObject({ points: 3, max: 4 })
    expect(lists?.note).toContain('not graded yet')
    expect(plan.done).toEqual([plan.online[2].id])
  })

  it('puts the submitted code of a series together, task by task', () => {
    const plan = planSync(emptyPrep(), synced(), link, now)
    const r = fakeCodeExpert({ op: 'code', projectIds: ['p1', 'p2'] })
    const md = seriesCode(plan.online[0], (r.ok ? r.data : {}) as never)
    expect(md).toContain('## Recursion (2/2 points on Code Expert)')
    expect(md).toContain('/main.py:\n```py')
    expect(md).toContain('TA feedback on Code Expert: Top :)')
  })

  it('guesses the course and the concepts', () => {
    const courses = normalizeCourses([
      { _id: 'n', name: 'Numerical Methods for Computer Science', url: 'NumINFK', semester: 'AS26' },
      { _id: 's', name: 'Systems Programming and Computer Architecture', url: 'spca', semester: 'AS26' }
    ])
    expect(guessCourse(courses, 'Numerical Methods for CS NumCS')?.id).toBe('n')
    expect(guessCourse(courses, 'Systems Programming and Computer Architecture SPCA')?.id).toBe('s')
    expect(guessCourse(courses, 'Analysis II')).toBeNull()
    const concepts = [
      { id: 'fft', title: 'Fast Fourier transform', de: 'schnelle Fourier-Transformation' },
      { id: 'cheb', title: 'Chebyshev interpolation', de: 'Tschebyscheff-Interpolation' },
      { id: 'qr', title: 'QR decomposition', de: 'QR-Zerlegung' }
    ]
    expect(guessConcepts('Implement the fast Fourier transform and use Chebyshev nodes for interpolation.', concepts)).toEqual(['fft', 'cheb'])
    expect(guessConcepts('Berechnen Sie die QR-Zerlegung.', concepts)).toEqual(['qr'])
    expect(guessConcepts('Nothing related.', concepts)).toEqual([])
  })

  it('accepts only well-formed operations', () => {
    expect(checkCeOp({ op: 'sync', courseId: 'abc', semester: 'AS26' })).toEqual({ op: 'sync', courseId: 'abc', semester: 'AS26' })
    expect(checkCeOp({ op: 'sync', courseId: 'a"b', semester: 'AS26' })).toEqual({ op: 'courses' })
    expect(checkCeOp({ op: 'code', projectIds: ['p1', '../x', 3] })).toEqual({ op: 'code', projectIds: ['p1'] })
    expect(checkCeOp('rm -rf')).toEqual({ op: 'courses' })
  })
})

// ---------------------------------------------------------------- the in-page client against a scripted server
// a minimal msgpack (the subset socket.io's parser uses) for the server side of the test
function pack(v: unknown): Uint8Array {
  const out: number[] = []
  const te = new TextEncoder()
  const w = (x: unknown): void => {
    if (x === undefined) return void out.push(0xd4, 0, 0)
    if (x === null) return void out.push(0xc0)
    if (typeof x === 'boolean') return void out.push(x ? 0xc3 : 0xc2)
    if (typeof x === 'number') {
      if (Number.isInteger(x) && x >= 0 && x < 128) return void out.push(x)
      const b = new DataView(new ArrayBuffer(8))
      b.setFloat64(0, x)
      return void out.push(0xcb, ...new Uint8Array(b.buffer))
    }
    if (x instanceof Date) {
      const ms = x.getTime()
      return void out.push(0xd7, 0, ...[24, 16, 8, 0].map((s) => (Math.floor(ms / 2 ** 32) >>> s) & 255), ...[24, 16, 8, 0].map((s) => (ms >>> s) & 255))
    }
    if (typeof x === 'string') {
      const s = te.encode(x)
      out.push(0xda, s.length >> 8, s.length & 255, ...s)
      return
    }
    if (Array.isArray(x)) {
      out.push(0xdc, x.length >> 8, x.length & 255)
      x.forEach(w)
      return
    }
    const ks = Object.keys(x as object)
    out.push(0xde, ks.length >> 8, ks.length & 255)
    for (const k of ks) {
      w(k)
      w((x as Record<string, unknown>)[k])
    }
  }
  w(v)
  return new Uint8Array(out)
}

function unpack(buf: ArrayBuffer): any {
  const v = new DataView(buf)
  const td = new TextDecoder()
  let o = 0
  const r = (): any => {
    const b = v.getUint8(o++)
    if (b < 0x80) return b
    if (b < 0x90) return Object.fromEntries(Array.from({ length: b & 15 }, () => [r(), r()]))
    if (b < 0xa0) return Array.from({ length: b & 15 }, r)
    const str = (n: number): string => {
      const s = td.decode(new Uint8Array(buf, o, n))
      o += n
      return s
    }
    if (b < 0xc0) return str(b & 31)
    if (b === 0xc0) return null
    if (b === 0xc2) return false
    if (b === 0xc3) return true
    if (b === 0xcd) return (o += 2), v.getUint16(o - 2)
    if (b === 0xcb) return (o += 8), v.getFloat64(o - 8)
    if (b === 0xd4) return (o += 2), undefined
    if (b === 0xd9) return str(v.getUint8(o++))
    if (b === 0xda) return (o += 2), str(v.getUint16(o - 2))
    if (b === 0xdc) return (o += 2), Array.from({ length: v.getUint16(o - 2) }, r)
    if (b === 0xde) {
      o += 2
      return Object.fromEntries(Array.from({ length: v.getUint16(o - 2) }, () => [r(), r()]))
    }
    throw new Error('test unpack: byte ' + b)
  }
  return r()
}

const right = (x: unknown): unknown => ({ _tag: 'Right', right: x })

/** Plays the Code Expert server: answers the procedures the client calls. */
function installServer(loggedIn: boolean, calls: string[]): void {
  const due = new Date('2026-10-01T12:00:00Z')
  class FakeSocket {
    binaryType = 'blob'
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) {
      setTimeout(() => this.emit('0{"sid":"x"}'))
    }
    emit(data: unknown): void {
      this.onmessage?.({ data: data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data })
    }
    close(): void {}
    send(raw: unknown): void {
      if (typeof raw === 'string') return
      const m = unpack(raw as ArrayBuffer)
      if (m.type === 0) {
        setTimeout(() => {
          this.emit(pack({ type: 2, data: ['initConnection', { loggedIn }], nsp: '/cx' }))
          this.emit(pack({ type: 0, data: { sid: 'y' }, nsp: '/cx' }))
        })
        return
      }
      const [kind, name, arg, sid] = m.data
      if (kind === 'unsubscribe') return
      calls.push(name)
      const reply = (value: unknown): void => {
        setTimeout(() => {
          if (kind === 'subscribe') this.emit(pack({ type: 2, data: [sid, { _tag: 'initial', value }], nsp: '/cx' }))
          else this.emit(pack({ type: 3, data: [right(value)], id: m.id, nsp: '/cx' }))
        })
      }
      if (name === 'courseSelect.getEnrolledCourses') reply([{ _id: 'c1', name: 'Fixture Systems', url: 'fs', semester: 'AS26' }])
      else if (name === 'enrolledExercises_exercisesInCourse') reply([{ _id: 'se1', name: 'Serie 1', dueDate: due, taskIds: ['t1'] }])
      else if (name === 'enrolledExercises_tasksInCourse') reply([{ _id: 't1', name: 'Recursion', grading: { maximumPoints: 2 } }])
      else if (name === 'enrolledExercises_submissionsInCourse') reply([{ taskId: 't1', result: 0.5, projectId: 'p1', submissionDate: due, comments: 'ok' }])
      else if (name === 'enrolledExercises_templateProjectsInCourse') reply([{ _id: 'tp1', taskId: 't1' }])
      else if (name === 'ide_getDescription') reply(right({ value: { default: { content: `Statement of ${arg.projectId}` } } }))
      else if (name === 'project_getProjectTree') reply({ tree: [{ path: '/cx_description', children: [{ path: '/cx_description/a.md', key: 'd', isLeaf: true }] }, { path: '/main.py', key: 'k1', isLeaf: true }, { path: '/lib.py', key: 'k2', isLeaf: true, readOnly: true }] })
      else if (name === 'editor_getFileContent') reply({ content: `code of ${arg.fileKey}` })
    }
  }
  ;(globalThis as any).WebSocket = FakeSocket
  ;(globalThis as any).location = { host: 'expert.ethz.ch' }
}

describe('the in-page Code Expert client', () => {
  afterEach(() => {
    delete (globalThis as any).WebSocket
    delete (globalThis as any).location
  })
  const run = (op: Parameters<typeof ceScript>[0]): Promise<CeResult<any>> => (0, eval)(ceScript(op))

  it('lists courses, syncs a course and reads submitted code over the socket', async () => {
    const calls: string[] = []
    installServer(true, calls)
    const courses = await run({ op: 'courses' })
    expect(courses.ok && normalizeCourses(courses.data)[0]?.slug).toBe('fs')

    const sync = await run({ op: 'sync', courseId: 'c1', semester: 'AS26' })
    expect(sync.ok).toBe(true)
    const series = normalizeSync(sync.ok ? sync.data : null)
    expect(series[0]).toMatchObject({ name: 'Serie 1', due: '2026-10-01T12:00:00.000Z' })
    expect(series[0].tasks[0]).toMatchObject({ result: 0.5, projectId: 'p1', feedback: 'ok', statement: 'Statement of p1' })

    const code = await run({ op: 'code', projectIds: ['p1'] })
    expect(code.ok && code.data).toEqual({ p1: [{ path: '/main.py', content: 'code of k1' }] })
    expect(calls).toContain('ide_getDescription')
  })

  it('says so when the learner is not signed in', async () => {
    installServer(false, [])
    const r = await run({ op: 'courses' })
    expect(r).toEqual({ ok: false, signedIn: false, error: 'not signed in' })
  })
})
