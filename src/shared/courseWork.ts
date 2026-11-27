// The work that builds a course from its materials: reading and mapping PDFs, and mapping the topics of online
// problem sets. It runs on a CourseHost, so the same code serves the course on screen (backed by the app's stores)
// and the courses that are not open (backed by their files, see background.ts).
import { applyMapDelta, buildMapPrompt, chunkPages, fakeMapOutput, mapSchema, MAP_SYSTEM, markParts, nextOffset, normalizeMapOutput, partsDone } from './courseMap'
import { generateWithRetry } from './retry'
import { applyTaskMap, buildTaskMapPrompt, fakeTaskMap, normalizeTaskMap, TASK_BATCH, TASK_MAP_SYSTEM, taskMapSchema, tasksToMap } from './taskMap'
import { guessConcepts } from './codeExpert'
import { newOnlineTask } from './exam'
import { isSolutionNotebook, notebookKind, notebookText, notebookTitle, parseNotebook } from './notebook'
import type { Backend, Course, CourseExtension, ExamPrep, FolderFile, Material, OnlineTask } from './types'
import { nowIso, uid } from './util'

export interface MaterialJob {
  materialId: string
  phase: 'indexing' | 'mapping'
  progress: number
  label: string
}

/** what the build needs of a course's MaterialLibrary (script.ts): reading PDFs and their cached text */
export interface MaterialTexts {
  materialText(id: string): { pages: string[]; outline: string[] } | null
  index(m: Material, onProgress?: (f: number) => void): Promise<{ numPages: number; pages: string[]; outline: string[] }>
  load(items: Material[]): Promise<void>
}

export interface CourseHost {
  readonly courseId: string
  readonly builtin: boolean
  readonly script: MaterialTexts
  /** false once the course is no longer this host's (another course opened, or the background let it go) */
  alive(): boolean
  /** the learner stopped this material's build */
  cancelled(materialId: string): boolean
  /** a material's build starts */
  onStart?(materialId: string): void
  base(): Course
  ext(): CourseExtension
  /** the course as built from base and map */
  course(): Course
  /** store the map (written to its file) */
  setExt(ext: CourseExtension): Promise<void>
  materials(): Material[]
  patchMaterial(id: string, patch: Partial<Material>): void
  saveMaterials(): Promise<void>
  prep(): ExamPrep
  /** change the exam prep, applied to its latest version */
  updatePrep(fn: (p: ExamPrep) => ExamPrep): Promise<void>
  setJob(job: MaterialJob | null): void
  setRequest(id: string | null): void
  toast(text: string): void
}

const online = (): boolean => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false

/** Read a material (once) and extend the course map with it, part by part (a stopped build resumes at its last part). */
export async function runMaterial(backend: Backend, host: CourseHost, m0: Material): Promise<void> {
  const alive = (): boolean => host.alive() && !host.cancelled(m0.id)
  const present = (): boolean => host.materials().some((x) => x.id === m0.id)
  let m = m0
  // 1. read the text (once)
  let text = host.script.materialText(m.id)
  if (!text || !m.numPages || m.offset === null) {
    const offset = m.offset ?? nextOffset(host.materials().filter((x) => x.id !== m.id))
    m = { ...m, offset, status: 'indexing', error: null }
    host.patchMaterial(m.id, { offset, status: 'indexing', error: null })
    host.setJob({ materialId: m.id, phase: 'indexing', progress: 0, label: `Reading ${m.title}` })
    const r = await host.script.index(m, (f) => alive() && host.setJob({ materialId: m.id, phase: 'indexing', progress: f, label: `Reading ${m.title}` }))
    if (!host.alive()) return
    m = { ...m, numPages: r.numPages }
    host.patchMaterial(m.id, { numPages: r.numPages })
    text = { pages: r.pages, outline: r.outline }
    await host.saveMaterials()
    await host.script.load(host.materials())
  }
  if (!alive()) {
    if (host.alive()) host.patchMaterial(m.id, { status: 'skipped' })
    return
  }
  // the built-in course's script is mapped already
  if (host.builtin && m.id === 'script') {
    host.patchMaterial(m.id, { status: 'skipped' })
    return
  }
  // 2. extend the course map, chunk by chunk
  const chunks = chunkPages(text.pages)
  host.patchMaterial(m.id, { status: 'mapping', chunksTotal: chunks.length })
  // the map file records which parts it holds; trust it over the materials list (they are written one after the other)
  const start = Math.min(chunks.length, partsDone(host.ext(), m))
  const added = start > m.chunksDone ? [...new Set([...m.added, ...host.ext().concepts.filter((c) => c.material === m.id).map((c) => c.id)])] : [...m.added]
  const linked = new Set(m.linked)
  if (start > m.chunksDone) host.patchMaterial(m.id, { chunksDone: start, added })
  for (let k = start; k < chunks.length; k++) {
    if (!alive()) {
      if (host.alive()) host.patchMaterial(m.id, { status: 'skipped' })
      return
    }
    const label = chunks.length > 1 ? `Mapping ${m.title} (part ${k + 1} of ${chunks.length})` : `Mapping ${m.title}`
    host.setJob({ materialId: m.id, phase: 'mapping', progress: k / chunks.length, label })
    const [a, b] = chunks[k]
    const pages = text.pages.slice(a - 1, b).map((t, i) => ({ page: a + i, text: t })).filter((p) => p.text.trim())
    if (pages.length) {
      const cur = { ...m, numPages: text.pages.length }
      const course = host.course()
      const prompt = buildMapPrompt({ course, material: cur, pages, chunk: k + 1, chunks: chunks.length, outline: k === 0 ? text.outline : [] })
      const fake = fakeMapOutput(cur, pages, course)
      const r = await generateWithRetry(
        backend,
        () => ({ id: uid('map_'), kind: 'map', system: MAP_SYSTEM, prompt, schema: mapSchema, effort: 'medium', timeoutSec: 900, meta: { fake } }),
        {
          alive: () => alive() && present(),
          online,
          onRequest: (id) => {
            host.setRequest(id)
            if (alive()) host.setJob({ materialId: m.id, phase: 'mapping', progress: k / chunks.length, label })
          },
          onWait: (w) => {
            host.setRequest(null)
            if (!alive()) return
            const what = chunks.length > 1 ? `part ${k + 1} of ${m.title}` : m.title
            const msg = w.offline
              ? `Offline. Mapping ${what} goes on when the connection is back.`
              : `${w.error.replace(/\.$/, '')}. Trying ${what} again in ${w.secondsLeft} s (attempt ${w.next} of ${w.of}).`
            host.setJob({ materialId: m.id, phase: 'mapping', progress: k / chunks.length, label: msg })
          }
        }
      )
      host.setRequest(null)
      if (!host.alive()) return
      if (!alive() || !present()) {
        host.patchMaterial(m.id, { status: 'skipped' })
        return
      }
      if (!r.ok) {
        const what = chunks.length > 1 ? `Part ${k + 1} of ${chunks.length} failed after ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : `Failed after ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}`
        const kind = r.errorKind
        throw Object.assign(new Error(`${what}: ${r.error ?? 'the mapping call failed.'}${k > 0 ? ` Parts 1 to ${k} are in the map; Retry continues from part ${k + 1}.` : ''}`), {
          retryable: r.stalled || kind === undefined || kind === 'timeout' || kind === 'rate_limit' || kind === 'other'
        })
      }
      const delta = normalizeMapOutput(r.data, host.course(), cur, nowIso())
      const out = applyMapDelta(host.ext(), host.base(), delta)
      // the part is marked done in the same write that adds it, so a crash can never add it twice
      await host.setExt(markParts(out.ext, m.id, k + 1))
      added.push(...out.added)
      for (const id of out.linked) linked.add(id)
    }
    host.patchMaterial(m.id, { chunksDone: k + 1, added: [...new Set(added)], linked: [...linked] })
    await host.saveMaterials()
  }
  host.patchMaterial(m.id, { status: 'mapped', mappedAt: nowIso() })
  const n = new Set(added).size
  host.toast(`${m.title}: ${n ? `${n} new concept${n === 1 ? '' : 's'}` : 'no new concepts'}${linked.size ? `, ${linked.size} linked` : ''}.`)
}

/** Read and map the queued materials of a course, one at a time. */
export async function runQueue(backend: Backend, host: CourseHost): Promise<void> {
  for (;;) {
    if (!host.alive()) return
    const m = host.materials().find((x) => x.status === 'queued')
    if (!m) return
    host.onStart?.(m.id)
    await runMaterial(backend, host, m).catch((e) => {
      if (!host.alive()) return
      if (host.cancelled(m.id)) host.patchMaterial(m.id, { status: 'skipped' })
      else host.patchMaterial(m.id, { status: 'error', error: String((e as Error)?.message ?? e), retryable: !!(e as { retryable?: boolean })?.retryable })
    })
    if (!host.alive()) return
    host.setJob(null)
    await host.saveMaterials()
  }
}

/**
 * Have the AI pick the concepts each online problem set practises (Code Expert, GitLab, notebooks, tasks added by
 * hand), for those never mapped, whose statement changed, or mapped before the map grew. Returns how many tasks
 * got different topics; null when a call failed (try again later).
 */
export async function mapTasks(backend: Backend, host: CourseHost): Promise<number | null> {
  const course = host.course()
  const size = course.concepts.length
  const todo = tasksToMap(host.prep(), size)
  let changed = 0
  for (let i = 0; i < todo.length; i += TASK_BATCH) {
    if (!host.alive()) return changed
    const batch = todo.slice(i, i + TASK_BATCH)
    const fake = fakeTaskMap(course, batch)
    const r = await generateWithRetry(
      backend,
      () => ({ id: uid('tmap_'), kind: 'map', system: TASK_MAP_SYSTEM, prompt: buildTaskMapPrompt(course, batch), schema: taskMapSchema, effort: 'low', timeoutSec: 300, meta: { fake } }),
      { alive: () => host.alive(), online, maxAttempts: 2, onRequest: (id) => host.setRequest(id), onWait: () => host.setRequest(null) }
    )
    host.setRequest(null)
    if (!host.alive()) return changed
    if (!r.ok) return null
    const rows = normalizeTaskMap(r.data, course, batch)
    await host.updatePrep((p) => {
      const out = applyTaskMap(p, rows, batch, size, new Date())
      changed += out.changed
      return out.prep
    })
  }
  return changed
}

/**
 * Jupyter notebooks found in a course folder that are not problem sets yet: each becomes a task with its Markdown
 * and code as the statement (worked solutions are left out). Known notebooks whose file changed are returned too.
 */
export async function notebookTasks(
  backend: Pick<Backend, 'readNotebook'>,
  files: FolderFile[],
  prep: Pick<ExamPrep, 'online'>,
  ignored: string[],
  concepts: { id: string; title: string; de?: string }[]
): Promise<{ added: OnlineTask[]; changed: Map<string, number> }> {
  const known = new Map(prep.online.filter((t) => t.notebook).map((t) => [t.notebook?.path ?? '', t]))
  const added: OnlineTask[] = []
  const changed = new Map<string, number>()
  for (const f of files) {
    const t = known.get(f.path)
    if (t) {
      if (t.notebook && t.notebook.mtimeMs !== f.mtimeMs) changed.set(t.id, f.mtimeMs)
      continue
    }
    if (ignored.includes(f.path) || isSolutionNotebook(f.name) || added.length >= 40) continue
    const cells = parseNotebook((await backend.readNotebook(f.path).catch(() => null)) ?? '')
    if (!cells) continue
    const statement = notebookText(cells, { outputs: false, limit: 30_000 }) || null
    const task = newOnlineTask({ kind: notebookKind(f.rel), title: notebookTitle(f.name, cells), platform: 'Jupyter', url: null, statement, conceptIds: statement ? guessConcepts(`${f.name}\n${statement}`, concepts) : [] }, new Date())
    if (task) added.push({ ...task, notebook: { path: f.path, foundMtimeMs: f.mtimeMs, mtimeMs: f.mtimeMs } })
  }
  return { added, changed }
}

/** Add found notebooks to an exam prep (once per file, even if another scan added it meanwhile). */
export function withNotebooks(p: ExamPrep, added: OnlineTask[]): ExamPrep {
  const have = new Set(p.online.map((t) => t.notebook?.path).filter(Boolean))
  return { ...p, online: [...p.online, ...added.filter((t) => !have.has(t.notebook?.path))] }
}
