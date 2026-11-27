// Courses that are not open keep building: new files in their watched folders are added, queued materials are read
// and mapped, and their online problem sets get their topics. One course at a time, one model call at a time, next
// to whatever the open course does. A course that is opened is let go first, so only one side ever writes its files.
import { buildCourse, emptyExtension, newMaterial } from '@shared/courseMap'
import { normalizePrep } from '@shared/exam'
import type { Backend, Course, CourseExtension, ExamPrep, FolderFile, Material, MaterialsFile } from '@shared/types'
import { nowIso, uid } from '@shared/util'
import { mapTasks, notebookTasks, runQueue, withNotebooks, type CourseHost, type MaterialJob } from '@shared/courseWork'
import { MaterialLibrary } from './script'
import { createStore, type Store } from './store'

/** what the background needs of the app */
export interface BackgroundApp {
  readonly backend: Backend
  readonly courseId: string
  courseIds(): string[]
  courseSource(id: string): Promise<{ base: Course; builtin: boolean; short: string; folder: { folder: string | null; autoAdd: boolean } } | null>
  updatePrep(courseId: string, fn: (p: ExamPrep) => ExamPrep): Promise<void>
  toast(t: { kind: 'info'; text: string }, ms?: number): void
}

/** a pass over the courses at least this often (also on window focus and after switching course) */
const PASS_MS = 5 * 60_000
/** a course's folder is looked at no more often than this */
const SCAN_MS = 2 * 60_000
/** after a failed topic mapping, wait this long before the next try */
const TASK_RETRY_MS = 30 * 60_000
/** how long opening a course waits for the background to let it go */
const RELEASE_MS = 5000

interface Current {
  courseId: string
  released: boolean
  request: string | null
}

export class BackgroundWork {
  /** what the background is doing right now, if anything */
  readonly job: Store<(MaterialJob & { courseId: string; course: string }) | null> = createStore<(MaterialJob & { courseId: string; course: string }) | null>(null)
  private running: Promise<void> | null = null
  private again = false
  private stopped = false
  private timer: ReturnType<typeof setInterval> | null = null
  private current: Current | null = null
  private lastScan = new Map<string, number>()
  private taskFailedAt = new Map<string, number>()
  /** retryable failures are retried once per run of the app (the build's own retries came first) */
  private retried = new Set<string>()

  constructor(private app: BackgroundApp) {}

  start(): void {
    this.stopped = false
    if (!this.timer) this.timer = setInterval(() => this.kick(), PASS_MS)
    this.kick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.current) void this.release(this.current.courseId)
  }

  /** Go over the courses that are not open (again, if a pass is running). */
  kick(): void {
    if (this.stopped) return
    if (this.running) {
      this.again = true
      return
    }
    this.running = this.run().finally(() => {
      this.running = null
      if (this.again && !this.stopped) {
        this.again = false
        this.kick()
      }
    })
  }

  /** Stop working on a course (it is being opened): its build stops where it is and resumes in the open course. */
  async release(courseId: string): Promise<void> {
    const cur = this.current
    if (!cur || cur.courseId !== courseId) return
    cur.released = true
    if (cur.request) void this.app.backend.cancel(cur.request).catch(() => {})
    const running = this.running
    if (running) await Promise.race([running.catch(() => {}), new Promise((r) => setTimeout(r, RELEASE_MS))])
  }

  private async run(): Promise<void> {
    const ids = this.app.courseIds()
    for (const id of ids) {
      if (this.stopped) return
      if (id === this.app.courseId) continue
      const cur: Current = { courseId: id, released: false, request: null }
      this.current = cur
      try {
        await this.work(id, cur)
      } catch {
        // a damaged file or a failed read leaves this course for the next pass
      } finally {
        this.current = null
        this.job.set(null)
      }
    }
  }

  private async work(id: string, cur: Current): Promise<void> {
    const { backend } = this.app
    const src = await this.app.courseSource(id)
    if (!src) return
    const alive = (): boolean => !cur.released && !this.stopped && this.app.courseId !== id
    let ext = (await backend.readJson<CourseExtension>(`courses/${id}/map`)) ?? emptyExtension()
    let course = buildCourse(src.base, ext)
    const file = await backend.readJson<MaterialsFile>(`courses/${id}/materials`)
    const ignored = file?.ignored ?? []
    // builds stopped by quitting or by switching course pick up where they left off
    let items: Material[] = (file?.items ?? []).map((m) => {
      if (m.status === 'indexing' || m.status === 'mapping') return { ...m, status: 'queued' as const, error: null, retryable: false }
      if (m.status === 'error' && m.retryable && !this.retried.has(m.id)) {
        this.retried.add(m.id)
        return { ...m, status: 'queued' as const, error: null, retryable: false }
      }
      return m
    })
    let prep = normalizePrep(await backend.readJson<ExamPrep>(`courses/${id}/exam`))
    let dirty = items.some((m, i) => m !== file?.items[i])
    const save = async (): Promise<void> => {
      if (alive()) await backend.writeJson(`courses/${id}/materials`, { version: 1, items, ignored } satisfies MaterialsFile)
    }
    const say = (text: string): void => {
      if (alive()) this.app.toast({ kind: 'info', text: `${src.short}: ${text}` }, 6000)
    }

    // 1. new files in the watched folder (only when the course adds them by itself; otherwise they wait for the learner)
    const { folder, autoAdd } = src.folder
    if (folder && autoAdd && Date.now() - (this.lastScan.get(id) ?? 0) >= SCAN_MS) {
      this.lastScan.set(id, Date.now())
      const all = await backend.scanFolder(folder).catch(() => null)
      if (all && alive()) {
        const have = new Set(items.map((m) => m.path))
        const fresh = all.filter((f) => f.name.toLowerCase().endsWith('.pdf') && !have.has(f.path) && !ignored.includes(f.path))
        if (fresh.length) {
          const now = nowIso()
          const added = fresh
            .sort((a: FolderFile, b: FolderFile) => a.rel.localeCompare(b.rel, undefined, { numeric: true }))
            .map((f) => newMaterial({ path: f.path, name: f.name, rel: f.rel, size: f.size, mtimeMs: f.mtimeMs }, uid('m_'), now))
          items = [...items, ...added]
          dirty = true
          say(`added ${added.length} new file${added.length === 1 ? '' : 's'} from the course folder.`)
        }
        // a changed notebook is left for the open course to notice (it marks the task started)
        const nb = await notebookTasks(backend, all.filter((f) => /\.ipynb$/i.test(f.name)), prep, ignored, course.concepts)
        if (nb.added.length && alive()) {
          await this.app.updatePrep(id, (p) => (prep = withNotebooks(p, nb.added)))
          say(`found ${nb.added.length} Jupyter notebook${nb.added.length === 1 ? '' : 's'} in the course folder: added to Exam prep.`)
        }
      }
    }
    if (dirty) await save()
    if (!alive()) return

    // 2. read and map the queued materials
    const host: CourseHost = {
      courseId: id,
      builtin: src.builtin,
      script: new MaterialLibrary(backend, id, src.builtin),
      alive,
      cancelled: () => false,
      base: () => src.base,
      ext: () => ext,
      course: () => course,
      setExt: async (next) => {
        if (!alive()) return
        ext = next
        course = buildCourse(src.base, ext)
        await backend.writeJson(`courses/${id}/map`, ext)
      },
      materials: () => items,
      patchMaterial: (mid, patch) => {
        items = items.map((m) => (m.id === mid ? { ...m, ...patch } : m))
      },
      saveMaterials: save,
      prep: () => prep,
      updatePrep: async (fn) => {
        if (!alive()) return
        await this.app.updatePrep(id, (p) => (prep = fn(p)))
      },
      setJob: (job) => this.job.set(job && alive() ? { ...job, courseId: id, course: src.short } : null),
      setRequest: (rid) => {
        cur.request = rid
      },
      toast: say
    }
    if (items.some((m) => m.status === 'queued')) {
      await host.script.load(items)
      await runQueue(backend, host)
      this.job.set(null)
    }
    if (!alive()) return

    // 3. the topics of its online problem sets, against the map as it is now
    if (Date.now() - (this.taskFailedAt.get(id) ?? 0) < TASK_RETRY_MS) return
    const n = await mapTasks(backend, host)
    if (n === null) this.taskFailedAt.set(id, Date.now())
    else if (n > 0) say(`linked ${n} online problem set${n === 1 ? '' : 's'} to the topics ${n === 1 ? 'it practises' : 'they practise'}.`)
  }
}
