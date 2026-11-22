// Application controller: owns the active course (its graph, materials and learner model), settings,
// rewards, routing and the active session. Each course keeps its own learner model; the learner's
// profile (how they like to learn) is shared by all courses.
import numcsJson from '@courses/numcs/course.json'
import { applyMapDelta, buildCourse, buildMapPrompt, chunkPages, emptyExtension, fakeMapOutput, mapSchema, MAP_SYSTEM, metaToCourse, newMaterial, nextOffset, normalizeMapOutput, removeMaterial, slug } from '@shared/courseMap'
import { CourseGraph } from '@shared/graph'
import { applyEvidence, getConcept, recordMisconception, updateLevel, type EvidenceInput } from '@shared/mastery'
import { milestoneReward, rewardsForResponse } from '@shared/rewards'
import type {
  AppState,
  Backend,
  Card,
  CardResponse,
  ConceptState,
  Course,
  CourseExtension,
  CourseMeta,
  DeepPartial,
  FolderFile,
  Material,
  MaterialsFile,
  ProfileNote,
  EvidenceKind,
  ModelUpdate,
  PracticeTarget,
  RewardEvent,
  Session,
  SessionSummary,
  Settings
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { practiceQueue, reviewQueue } from '@shared/selection'
import { nowIso, truncate, uid } from '@shared/util'
import type { AgentMode } from '@shared/agentTools'
import { ChatController, chatSession, newChatRecord, type ChatIndexEntry, type ChatRecord } from './chat'
import { MaterialLibrary } from './script'
import { SessionController } from './session'
import { createStore, type Store } from './store'

export type Route =
  | { name: 'home' }
  | { name: 'map'; conceptId?: string }
  | { name: 'session' }
  | { name: 'chat' }
  | { name: 'mind'; conceptId?: string }
  | { name: 'stats' }
  | { name: 'script'; page?: number }
  | { name: 'materials' }
  | { name: 'settings' }

export interface Toast {
  id: string
  kind: 'reward' | 'milestone' | 'info' | 'error'
  text: string
  points?: number
}

export interface UiState {
  /** changes when the course on screen changes (views remount) */
  courseKey: string
  route: Route
  toasts: Toast[]
  onboarding: boolean
  scriptPeek: { page: number; label: string | null } | null
}

/** Starting notes the learner can pick during setup (first person: they are shown as-is and read by the tutor). */
export const SEED_PROFILE = [
  'Refresh the prerequisites briefly when a topic relies on them.',
  'I want the motivation (why are we doing this?) before the formulas.',
  'I like a picture or a plot before the algebra.',
  'Show me a worked example before I try a problem myself.',
  'I prefer to understand the concepts before practising exercises.',
  'Keep explanations short and ask me often.'
]

function freshState(): AppState {
  const t = nowIso()
  return {
    version: 1,
    createdAt: t,
    updatedAt: t,
    learner: { profile: [], concepts: {} },
    rewards: { total: 0, events: [] },
    calibration: [],
    sessions: [],
    activeSessionId: null
  }
}

const EVIDENCE_KIND: Partial<Record<Card['kind'], EvidenceKind>> = {
  probe: 'probe',
  predict: 'predict',
  check: 'check',
  practice: 'practice',
  review: 'review',
  reflect: 'reflect'
}

/** Courses that ship with the app. */
export const BUILTIN_COURSES: Course[] = [{ ...(numcsJson as Course), builtin: true }]

export interface CourseEntry {
  id: string
  title: string
  short: string
  term: string
  builtin: boolean
}

export interface MaterialJob {
  materialId: string
  phase: 'indexing' | 'mapping'
  progress: number
  label: string
}

const stateName = (courseId: string): string => (courseId === 'numcs' ? 'state' : `courses/${courseId}/state`)
const chatsName = (courseId: string): string => (courseId === 'numcs' ? 'chats-index' : `courses/${courseId}/chats-index`)

export class AppController {
  readonly state: Store<AppState> = createStore(freshState())
  readonly settings: Store<Settings> = createStore(DEFAULT_SETTINGS)
  readonly ui: Store<UiState> = createStore<UiState>({ courseKey: 'numcs', route: { name: 'home' }, toasts: [], onboarding: false, scriptPeek: null })
  readonly session: Store<SessionController | null> = createStore<SessionController | null>(null)
  readonly chat: Store<ChatController | null> = createStore<ChatController | null>(null)
  readonly chats: Store<ChatIndexEntry[]> = createStore<ChatIndexEntry[]>([])
  /** every course the learner can switch to */
  readonly courses: Store<CourseEntry[]> = createStore<CourseEntry[]>([])
  /** the active course as the app uses it (base course plus what its materials added) */
  readonly courseView: Store<{ course: Course; graph: CourseGraph }>
  readonly materials: Store<Material[]> = createStore<Material[]>([])
  /** PDFs in the course folder that are not materials yet (and not ignored) */
  readonly pending: Store<FolderFile[]> = createStore<FolderFile[]>([])
  readonly job: Store<MaterialJob | null> = createStore<MaterialJob | null>(null)
  script: MaterialLibrary
  private base: Course
  private ext: CourseExtension = emptyExtension()
  private metas: CourseMeta[] = []
  private ignored: string[] = []
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private queueRunning = false
  private queueCancel: string | null = null
  /** the mapping call in flight, so it can be cancelled */
  private mapRequest: string | null = null
  private lastScan = 0
  private builtinFolder: { folder: string | null; autoAdd: boolean } = { folder: null, autoAdd: true }
  /** bumps when the watched folder or its settings change */
  readonly folderVersion: Store<number> = createStore(0)
  private savedProfile = ''

  constructor(readonly backend: Backend) {
    this.base = BUILTIN_COURSES[0]
    this.courseView = createStore({ course: this.base, graph: new CourseGraph(this.base) })
    this.script = new MaterialLibrary(backend, this.base.id, true)
  }

  get course(): Course {
    return this.courseView.get().course
  }

  get graph(): CourseGraph {
    return this.courseView.get().graph
  }

  get courseId(): string {
    return this.base.id
  }

  get meta(): CourseMeta | null {
    return this.metas.find((m) => m.id === this.base.id) ?? null
  }

  /** The folder the active course watches for new PDFs (built-in courses keep it in their own small file). */
  get folder(): { folder: string | null; autoAdd: boolean } {
    const m = this.meta
    return m ? { folder: m.folder, autoAdd: m.autoAdd } : this.builtinFolder
  }

  async setFolder(patch: { folder?: string | null; autoAdd?: boolean }): Promise<void> {
    if (this.meta) return this.updateCourse(patch)
    this.builtinFolder = { ...this.builtinFolder, ...patch }
    await this.backend.writeJson(`courses/${this.courseId}/folder`, this.builtinFolder)
    this.folderVersion.set((v) => v + 1)
    if (patch.folder !== undefined) void this.scanFolder(true)
  }

  async init(): Promise<void> {
    this.settings.set(await this.backend.getSettings())
    this.metas = ((await this.backend.readJson<CourseMeta[]>('courses-index')) ?? []).filter((m) => m && typeof m.id === 'string')
    this.refreshCourseList()
    if (!this.settings.get().onboarded) this.ui.set((u) => ({ ...u, onboarding: true }))
    let id = this.settings.get().activeCourse || 'numcs'
    if (!this.courses.get().some((c) => c.id === id)) id = 'numcs'
    await this.openCourse(id)
  }

  private refreshCourseList(): void {
    this.courses.set([
      ...BUILTIN_COURSES.map((c) => ({ id: c.id, title: c.title, short: c.short, term: c.term, builtin: true })),
      ...this.metas.map((m) => ({ id: m.id, title: m.title, short: m.short || m.title, term: m.term, builtin: false }))
    ])
  }

  /** Load a course: its map, materials, learner model and chats, then resume its open session. */
  private async openCourse(id: string): Promise<void> {
    const builtin = BUILTIN_COURSES.find((c) => c.id === id)
    const meta = this.metas.find((m) => m.id === id)
    this.base = builtin ?? (meta ? metaToCourse(meta) : BUILTIN_COURSES[0])
    id = this.base.id
    this.ext = (await this.backend.readJson<CourseExtension>(`courses/${id}/map`)) ?? emptyExtension()
    this.builtinFolder = (builtin && (await this.backend.readJson<{ folder: string | null; autoAdd: boolean }>(`courses/${id}/folder`))) || { folder: null, autoAdd: true }
    this.lastScan = 0
    const saved = await this.backend.readJson<AppState>(stateName(id))
    const profile = await this.loadProfile(saved)
    const st = saved && saved.version === 1 ? { ...freshState(), ...saved } : freshState()
    this.state.set({ ...st, learner: { ...st.learner, profile } })
    this.savedProfile = JSON.stringify(profile)
    // the course on screen changes only once its learner model is in place
    this.rebuildCourse()
    this.chats.set((await this.backend.readJson<ChatIndexEntry[]>(chatsName(id))) ?? [])
    // materials
    const file = await this.backend.readJson<MaterialsFile>(`courses/${id}/materials`)
    let items = file?.items ?? []
    this.ignored = file?.ignored ?? []
    if (builtin) {
      items = this.builtinScript(items)
      // the script was read before courses had materials: reuse that index instead of reading the PDF again
      const sc = items.find((m) => m.id === 'script')
      if (sc && !sc.numPages && sc.path) {
        const cached = await this.backend.readJson<{ numPages?: number }>('script-index')
        if (cached?.numPages) items = items.map((m) => (m.id === 'script' ? { ...m, numPages: cached.numPages ?? 0, status: 'skipped' as const } : m))
      }
    }
    items = items.map((m) => (m.status === 'indexing' || m.status === 'mapping' ? { ...m, status: 'queued' as const } : m))
    this.materials.set(items)
    this.pending.set([])
    this.job.set(null)
    this.script = new MaterialLibrary(this.backend, id, !!builtin)
    await this.script.load(items)
    if (builtin) await this.saveMaterials()
    this.ui.set((u) => ({ ...u, courseKey: id, scriptPeek: null }))
    void this.processQueue()
    void this.scanFolder(true)
    await this.resumeActive()
  }

  /** The built-in course's script is the PDF chosen in Settings (or during the welcome tour). */
  private builtinScript(items: Material[]): Material[] {
    const path = this.settings.get().script.path
    const have = items.find((m) => m.id === 'script')
    const rest = items.filter((m) => m.id !== 'script')
    if (!path && !have) return rest
    const name = path ? path.split(/[\\/]/).pop() ?? this.base.script.fileName : have?.fileName ?? this.base.script.fileName
    const base: Material = have ?? {
      ...newMaterial({ path, name, size: 0 }, 'script', nowIso()),
      kind: 'script',
      title: this.base.script.title,
      offset: 0,
      printedOffset: this.base.script.printedPageOffset,
      status: 'skipped'
    }
    const changed = !!have && have.path !== path
    const script: Material = { ...base, path, fileName: name, offset: 0, ...(changed ? { numPages: 0, status: 'queued' as const } : {}) }
    if (!have && path) script.status = 'queued'
    return [script, ...rest]
  }

  private async loadProfile(saved: AppState | null): Promise<ProfileNote[]> {
    const global = await this.backend.readJson<ProfileNote[]>('profile')
    if (global) return global
    // first start with shared profiles: the built-in course's notes become everyone's
    const legacy = saved?.learner?.profile ?? (await this.backend.readJson<AppState>('state'))?.learner?.profile ?? []
    await this.backend.writeJson('profile', legacy)
    return legacy
  }

  private async resumeActive(): Promise<void> {
    const active = this.state.get().activeSessionId
    if (!active) return
    const s = await this.backend.readJson<Session>(`sessions/${active}`)
    const rec = s?.agentChatId ? await this.backend.readJson<ChatRecord>(`chats/${s.agentChatId}`) : null
    if (!s || s.phase === 'done') {
      // nothing to resume
    } else if (rec && rec.version === 1) {
      const cc = new ChatController(this, rec, s)
      this.chat.set(cc)
      this.session.set(cc.cards)
    } else if (this.agentMode) {
      // a guided session from before the agent tutor: start fresh (its evidence is kept)
      this.updateState((st) => ({ ...st, activeSessionId: null }))
    } else this.session.set(new SessionController(this, s))
  }

  private rebuildCourse(): void {
    const course = buildCourse(this.base, this.ext)
    this.courseView.set({ course, graph: new CourseGraph(course) })
  }

  // ------------------------------------------------------------ courses
  async switchCourse(id: string): Promise<void> {
    if (id === this.courseId) return
    await this.leaveCurrent()
    this.session.set(null)
    await this.flush()
    this.queueCancel = this.job.get()?.materialId ?? null
    if (this.mapRequest) void this.backend.cancel(this.mapRequest)
    await this.saveSettings({ activeCourse: id })
    await this.openCourse(id)
    this.go({ name: 'home' })
  }

  async createCourse(input: Partial<CourseMeta> & { title: string }): Promise<string> {
    let id = slug(input.short || input.title).slice(0, 24) || 'course'
    const taken = new Set(this.courses.get().map((c) => c.id))
    if (taken.has(id)) {
      let k = 2
      while (taken.has(`${id}-${k}`)) k++
      id = `${id}-${k}`
    }
    const meta: CourseMeta = {
      id,
      title: input.title.trim(),
      short: (input.short ?? '').trim() || input.title.trim(),
      term: (input.term ?? '').trim(),
      lecturer: (input.lecturer ?? '').trim(),
      courseNumber: (input.courseNumber ?? '').trim(),
      institution: (input.institution ?? '').trim(),
      language: input.language || 'en',
      examFormat: (input.examFormat ?? '').trim(),
      codeLanguage: (input.codeLanguage ?? '').trim(),
      folder: input.folder || null,
      autoAdd: input.autoAdd ?? true,
      createdAt: nowIso()
    }
    this.metas = [...this.metas, meta]
    await this.backend.writeJson('courses-index', this.metas)
    this.refreshCourseList()
    await this.switchCourse(id)
    return id
  }

  async updateCourse(patch: Partial<CourseMeta>): Promise<void> {
    const meta = this.meta
    if (!meta) return
    const next = { ...meta, ...patch, id: meta.id }
    this.metas = this.metas.map((m) => (m.id === meta.id ? next : m))
    await this.backend.writeJson('courses-index', this.metas)
    this.refreshCourseList()
    this.base = metaToCourse(next)
    this.rebuildCourse()
    this.folderVersion.set((v) => v + 1)
    if (patch.folder !== undefined) void this.scanFolder(true)
  }

  /** Take a learner-made course off the list (its files stay in the data folder). */
  async removeCourse(id: string): Promise<void> {
    if (BUILTIN_COURSES.some((c) => c.id === id)) return
    if (id === this.courseId) await this.switchCourse('numcs')
    this.metas = this.metas.filter((m) => m.id !== id)
    await this.backend.writeJson('courses-index', this.metas)
    this.refreshCourseList()
  }

  // ------------------------------------------------------------ materials
  private async saveMaterials(): Promise<void> {
    await this.backend.writeJson(`courses/${this.courseId}/materials`, { version: 1, items: this.materials.get(), ignored: this.ignored } satisfies MaterialsFile)
  }

  private patchMaterial(id: string, patch: Partial<Material>): void {
    this.materials.set((xs) => xs.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  /** Add PDFs to the course; they are read and mapped one after another. */
  async addFiles(files: FolderFile[]): Promise<number> {
    const have = new Set(this.materials.get().map((m) => m.path))
    const fresh = files.filter((f) => f.name.toLowerCase().endsWith('.pdf') && !have.has(f.path))
    if (!fresh.length) return 0
    const now = nowIso()
    const added = fresh
      .sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }))
      .map((f) => newMaterial({ path: f.path, name: f.name, rel: f.rel, size: f.size, mtimeMs: f.mtimeMs }, uid('m_'), now))
    this.materials.set((xs) => [...xs, ...added])
    this.pending.set((p) => p.filter((f) => !fresh.some((x) => x.path === f.path)))
    await this.saveMaterials()
    void this.processQueue()
    return added.length
  }

  async ignoreFiles(paths: string[]): Promise<void> {
    this.ignored = [...new Set([...this.ignored, ...paths])]
    this.pending.set((p) => p.filter((f) => !paths.includes(f.path)))
    await this.saveMaterials()
  }

  async pickMaterials(): Promise<number> {
    const files = await this.backend.pickMaterials()
    return this.addFiles(files)
  }

  /** Look for new PDFs in the course folder (on open, on window focus, or when asked). */
  async scanFolder(force = false): Promise<number> {
    const { folder, autoAdd } = this.folder
    if (!folder) return 0
    if (!force && Date.now() - this.lastScan < 60_000) return 0
    this.lastScan = Date.now()
    const files = await this.backend.scanFolder(folder).catch(() => null)
    if (!files) return 0
    const have = new Set(this.materials.get().map((m) => m.path))
    const fresh = files.filter((f) => !have.has(f.path) && !this.ignored.includes(f.path))
    if (autoAdd && fresh.length) {
      const n = await this.addFiles(fresh)
      if (n) this.toast({ kind: 'info', text: `Added ${n} new file${n === 1 ? '' : 's'} from the course folder.` })
      return n
    }
    this.pending.set(fresh)
    return fresh.length
  }

  updateMaterial(id: string, patch: Partial<Pick<Material, 'title' | 'kind' | 'printedOffset'>>): void {
    this.patchMaterial(id, patch)
    void this.saveMaterials()
    void this.script.load(this.materials.get())
  }

  private hasEvidence = (conceptId: string): boolean => (this.state.get().learner.concepts[conceptId]?.evidence.length ?? 0) > 0

  async deleteMaterial(id: string): Promise<void> {
    const m = this.materials.get().find((x) => x.id === id)
    if (!m) return
    if (this.job.get()?.materialId === id) {
      this.queueCancel = id
      if (this.mapRequest) void this.backend.cancel(this.mapRequest)
    }
    this.ext = removeMaterial(this.ext, id, this.hasEvidence)
    await this.backend.writeJson(`courses/${this.courseId}/map`, this.ext)
    this.rebuildCourse()
    this.materials.set((xs) => xs.filter((x) => x.id !== id))
    if (m.path) this.ignored = [...new Set([...this.ignored, m.path])]
    this.script.forget(id)
    await this.saveMaterials()
  }

  /** Map a material again from scratch (what it added before is taken out first). */
  async remapMaterial(id: string): Promise<void> {
    if (this.job.get()?.materialId === id) return
    this.ext = removeMaterial(this.ext, id, this.hasEvidence)
    await this.backend.writeJson(`courses/${this.courseId}/map`, this.ext)
    this.rebuildCourse()
    this.patchMaterial(id, { status: 'queued', chunksDone: 0, chunksTotal: 0, error: null, added: [], linked: [] })
    await this.saveMaterials()
    void this.processQueue()
  }

  cancelMaterial(id: string): void {
    if (this.job.get()?.materialId === id) {
      this.queueCancel = id
      if (this.mapRequest) void this.backend.cancel(this.mapRequest)
    } else this.patchMaterial(id, { status: 'skipped' })
    void this.saveMaterials()
  }

  /** Read and map queued materials, one at a time. */
  private async processQueue(): Promise<void> {
    if (this.queueRunning) return
    this.queueRunning = true
    const courseId = this.courseId
    try {
      for (;;) {
        if (courseId !== this.courseId) break
        const m = this.materials.get().find((x) => x.status === 'queued')
        if (!m) break
        this.queueCancel = null
        await this.runMaterial(m).catch((e) => {
          if (courseId !== this.courseId) return
          if (this.queueCancel === m.id) this.patchMaterial(m.id, { status: 'skipped' })
          else this.patchMaterial(m.id, { status: 'error', error: String((e as Error)?.message ?? e) })
        })
        if (courseId !== this.courseId) break
        this.job.set(null)
        await this.saveMaterials()
      }
    } finally {
      this.queueRunning = false
      if (courseId === this.courseId) this.job.set(null)
      else void this.processQueue()
    }
  }

  private async runMaterial(m0: Material): Promise<void> {
    const courseId = this.courseId
    const alive = (): boolean => courseId === this.courseId && this.queueCancel !== m0.id
    let m = m0
    // 1. read the text (once)
    let text = this.script.materialText(m.id)
    if (!text || !m.numPages || m.offset === null) {
      const offset = m.offset ?? nextOffset(this.materials.get().filter((x) => x.id !== m.id))
      m = { ...m, offset, status: 'indexing', error: null }
      this.patchMaterial(m.id, { offset, status: 'indexing', error: null })
      this.job.set({ materialId: m.id, phase: 'indexing', progress: 0, label: `Reading ${m.title}` })
      const r = await this.script.index(m, (f) => alive() && this.job.set({ materialId: m.id, phase: 'indexing', progress: f, label: `Reading ${m.title}` }))
      if (courseId !== this.courseId) return
      m = { ...m, numPages: r.numPages }
      this.patchMaterial(m.id, { numPages: r.numPages })
      text = { pages: r.pages, outline: r.outline }
      await this.saveMaterials()
      await this.script.load(this.materials.get())
    }
    if (!alive()) {
      if (courseId === this.courseId) this.patchMaterial(m.id, { status: 'skipped' })
      return
    }
    // the built-in course's script is mapped already
    if (BUILTIN_COURSES.some((c) => c.id === courseId) && m.id === 'script') {
      this.patchMaterial(m.id, { status: 'skipped' })
      return
    }
    // 2. extend the course map, chunk by chunk
    const chunks = chunkPages(text.pages)
    this.patchMaterial(m.id, { status: 'mapping', chunksTotal: chunks.length })
    const added = [...m.added]
    const linked = new Set(m.linked)
    for (let k = m.chunksDone; k < chunks.length; k++) {
      if (!alive()) {
        if (courseId === this.courseId) this.patchMaterial(m.id, { status: 'skipped' })
        return
      }
      const label = chunks.length > 1 ? `Mapping ${m.title} (part ${k + 1} of ${chunks.length})` : `Mapping ${m.title}`
      this.job.set({ materialId: m.id, phase: 'mapping', progress: k / chunks.length, label })
      const [a, b] = chunks[k]
      const pages = text.pages.slice(a - 1, b).map((t, i) => ({ page: a + i, text: t })).filter((p) => p.text.trim())
      if (pages.length) {
        const cur = { ...m, numPages: text.pages.length }
        const course = this.course
        const reqId = uid('map_')
        this.mapRequest = reqId
        const r = await this.backend.generate({
          id: reqId,
          kind: 'map',
          system: MAP_SYSTEM,
          prompt: buildMapPrompt({ course, material: cur, pages, chunk: k + 1, chunks: chunks.length, outline: k === 0 ? text.outline : [] }),
          schema: mapSchema,
          effort: 'medium',
          timeoutSec: 900,
          meta: { fake: fakeMapOutput(cur, pages, course) }
        })
        this.mapRequest = null
        if (courseId !== this.courseId) return
        if (!alive() || !this.materials.get().some((x) => x.id === m.id)) {
          if (courseId === this.courseId) this.patchMaterial(m.id, { status: 'skipped' })
          return
        }
        if (!r.ok) throw new Error(r.error ?? 'The mapping call failed.')
        const delta = normalizeMapOutput(r.data, this.course, cur, nowIso())
        const out = applyMapDelta(this.ext, this.base, delta)
        this.ext = out.ext
        await this.backend.writeJson(`courses/${courseId}/map`, this.ext)
        this.rebuildCourse()
        added.push(...out.added)
        for (const id of out.linked) linked.add(id)
      }
      this.patchMaterial(m.id, { chunksDone: k + 1, added: [...new Set(added)], linked: [...linked] })
      await this.saveMaterials()
    }
    this.patchMaterial(m.id, { status: 'mapped', mappedAt: nowIso() })
    const n = new Set(added).size
    this.toast({ kind: 'info', text: `${m.title}: ${n ? `${n} new concept${n === 1 ? '' : 's'}` : 'no new concepts'}${linked.size ? `, ${linked.size} linked` : ''}.` }, 6000)
  }

  // ------------------------------------------------------------ persistence
  updateState(fn: (s: AppState) => AppState): void {
    this.state.set((s) => ({ ...fn(s), updatedAt: nowIso() }))
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 400)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const st = this.state.get()
    await this.backend.writeJson(stateName(this.courseId), st)
    const profile = JSON.stringify(st.learner.profile)
    if (profile !== this.savedProfile) {
      this.savedProfile = profile
      await this.backend.writeJson('profile', st.learner.profile)
    }
  }

  async saveSettings(patch: DeepPartial<Settings>): Promise<void> {
    this.settings.set(await this.backend.setSettings(patch))
  }

  /** Let the learner pick the built-in course's lecture notes (desktop app only), then read them. */
  async chooseScript(): Promise<boolean> {
    const path = await this.backend.chooseScript()
    if (!path) return false
    this.settings.set(await this.backend.getSettings())
    if (!BUILTIN_COURSES.some((c) => c.id === this.courseId)) return true
    this.materials.set((xs) => this.builtinScript(xs.map((m) => (m.id === 'script' ? { ...m, numPages: 0, status: 'queued' as const } : m))))
    this.script.forget('script')
    await this.saveMaterials()
    void this.processQueue()
    return true
  }

  /** Read the built-in script again (after the PDF changed). */
  async reindexScript(): Promise<void> {
    this.patchMaterial('script', { numPages: 0, status: 'queued' })
    this.script.forget('script')
    await this.saveMaterials()
    void this.processQueue()
  }

  // ------------------------------------------------------------ navigation & toasts
  go(route: Route): void {
    this.ui.set((u) => ({ ...u, route }))
  }

  toast(t: Omit<Toast, 'id'>, ms = 4200): void {
    const id = uid('t_')
    this.ui.set((u) => ({ ...u, toasts: [...u.toasts.slice(-2), { ...t, id }] }))
    setTimeout(() => this.ui.set((u) => ({ ...u, toasts: u.toasts.filter((x) => x.id !== id) })), ms)
  }

  peekScript(page: number, label: string | null = null): void {
    this.ui.set((u) => ({ ...u, scriptPeek: { page, label } }))
  }

  // ------------------------------------------------------------ learner model
  concept(id: string): ConceptState {
    return getConcept(this.state.get().learner, id)
  }

  addRewards(events: RewardEvent[]): void {
    if (!events.length) return
    this.updateState((s) => ({
      ...s,
      rewards: { total: s.rewards.total + events.reduce((a, e) => a + e.points, 0), events: [...s.rewards.events, ...events].slice(-600) }
    }))
    const sum = events.reduce((a, e) => a + e.points, 0)
    const sc = this.session.get()
    const cc = this.chat.get()
    if (cc && events.some((e) => e.sessionId === cc.cards.s.id)) cc.cards.addPoints(sum)
    else if (sc) sc.addPoints(sum)
    for (const e of events) this.toast({ kind: ['proficient', 'mastered', 'plan_done'].includes(e.kind) ? 'milestone' : 'reward', text: e.reason, points: e.points })
  }

  /** Record one finished card as evidence: mastery, memory, staircase, misconceptions, calibration, rewards. */
  recordCard(session: Session, card: Card, response: CardResponse, target: PracticeTarget | null, selectedMisconceptions: string[] = []): void {
    const it = card.interaction
    const kind = EVIDENCE_KIND[card.kind]
    const now = new Date()
    if (!it || it.type === 'continue' || !kind) return
    const known = it.conceptIds.filter((c) => this.graph.get(c))
    const primary = target?.conceptId ?? (session.goalConceptId && known.includes(session.goalConceptId) ? session.goalConceptId : known[0])
    const concepts = [...new Set([primary, ...known])].filter(Boolean) as string[]
    const graded = response.score !== null
    const rewards: RewardEvent[] = []
    const desired = this.settings.get().learning.desiredRetention
    const before = primary ? this.concept(primary) : null

    this.updateState((s) => {
      const conceptsMap = { ...s.learner.concepts }
      for (const cid of concepts) {
        let cs = conceptsMap[cid] ?? getConcept(s.learner, cid)
        if (graded || response.verdict === 'dontknow') {
          const input: EvidenceInput = {
            sessionId: session.id,
            kind,
            conceptId: cid,
            score: response.score ?? 0,
            hints: response.hintsUsed,
            attempts: response.attempts,
            revealed: response.revealed,
            confidence: response.confidence,
            level: it.level ?? target?.level ?? null,
            cue: it.cue ?? target?.cue ?? null,
            summary: truncate(it.prompt, 160),
            primary: cid === primary,
            weightScale: cid === primary ? 1 : 0.6
          }
          const out = applyEvidence(cs, input, now, desired)
          cs = out.state
          const title = this.graph.title(cid)
          for (const m of out.milestones) if (m === 'proficient' || m === 'mastered') rewards.push(milestoneReward(m, title, { conceptId: cid, sessionId: session.id, now }))
          if (cid === primary && (kind === 'practice' || kind === 'review') && graded) {
            const lvl = it.level ?? target?.level ?? cs.level
            const eff = out.evidence.score
            const st = updateLevel(cs, lvl, eff)
            cs = st.state
            if (st.change === 'up') rewards.push(milestoneReward('level_up', title, { conceptId: cid, sessionId: session.id, now }, cs.level))
          }
        }
        if (cid === primary) for (const m of selectedMisconceptions) cs = recordMisconception(cs, m, 'active', now)
        conceptsMap[cid] = cs
      }
      const calibration =
        graded && response.confidence && primary
          ? [...s.calibration, { at: now.toISOString(), confidence: response.confidence, correct: (response.score ?? 0) >= 0.8 ? 1 : 0, conceptId: primary }].slice(-1500)
          : s.calibration
      return { ...s, learner: { ...s.learner, concepts: conceptsMap }, calibration }
    })

    rewards.unshift(
      ...rewardsForResponse({
        cardKind: card.kind,
        response,
        conceptId: primary ?? null,
        conceptTitle: primary ? this.graph.title(primary) : 'this topic',
        level: it.level ?? target?.level ?? null,
        sessionId: session.id,
        now,
        before
      })
    )
    this.addRewards(rewards)
  }

  applyModelUpdate(update: ModelUpdate | null): void {
    if (!update) return
    const now = new Date()
    this.updateState((s) => {
      const concepts = { ...s.learner.concepts }
      for (const n of update.notes) {
        const cs = concepts[n.conceptId] ?? getConcept(s.learner, n.conceptId)
        concepts[n.conceptId] = { ...cs, tutorNote: n.note, tutorNoteAt: now.toISOString() }
      }
      for (const m of update.misconceptions) {
        const cs = concepts[m.conceptId] ?? getConcept(s.learner, m.conceptId)
        concepts[m.conceptId] = recordMisconception(cs, m.text, m.status, now)
      }
      let profile = s.learner.profile
      for (const p of update.profile) {
        const low = p.toLowerCase()
        if (!profile.some((x) => x.text.toLowerCase() === low)) profile = [...profile, { id: uid('pf_'), text: p, source: 'tutor' as const, at: now.toISOString() }].slice(-20)
      }
      return { ...s, learner: { ...s.learner, concepts, profile } }
    })
  }

  recordFreeMisconceptions(conceptId: string | null, texts: string[]): void {
    if (!conceptId || !texts.length) return
    const now = new Date()
    this.updateState((s) => {
      let cs = s.learner.concepts[conceptId] ?? getConcept(s.learner, conceptId)
      for (const t of texts) cs = recordMisconception(cs, t, 'active', now)
      return { ...s, learner: { ...s.learner, concepts: { ...s.learner.concepts, [conceptId]: cs } } }
    })
  }

  setUserNote(conceptId: string, note: string): void {
    this.updateState((s) => {
      const cs = s.learner.concepts[conceptId] ?? getConcept(s.learner, conceptId)
      return { ...s, learner: { ...s.learner, concepts: { ...s.learner.concepts, [conceptId]: { ...cs, userNote: note.trim() || null } } } }
    })
  }

  setMisconceptionStatus(conceptId: string, id: string, status: 'active' | 'resolved' | 'deleted'): void {
    this.updateState((s) => {
      const cs = s.learner.concepts[conceptId]
      if (!cs) return s
      const list =
        status === 'deleted'
          ? cs.misconceptions.filter((m) => m.id !== id)
          : cs.misconceptions.map((m) => (m.id === id ? { ...m, status, resolvedAt: status === 'resolved' ? nowIso() : null } : m))
      return { ...s, learner: { ...s.learner, concepts: { ...s.learner.concepts, [conceptId]: { ...cs, misconceptions: list } } } }
    })
  }

  setProfile(texts: { id?: string; text: string; source?: 'seed' | 'tutor' | 'user' }[]): void {
    this.updateState((s) => ({
      ...s,
      learner: {
        ...s.learner,
        profile: texts.filter((t) => t.text.trim()).map((t) => ({ id: t.id ?? uid('pf_'), text: t.text.trim(), source: t.source ?? 'user', at: nowIso() }))
      }
    }))
  }

  // ------------------------------------------------------------ sessions
  private newSession(type: Session['type'], goal: string | null, scope: string[], queue: PracticeTarget[], itemsGoal: number): Session {
    return {
      id: uid('s_'),
      type,
      goalConceptId: goal,
      scope,
      startedAt: nowIso(),
      endedAt: null,
      phase: type === 'learn' ? 'probe' : type,
      steps: [],
      plan: null,
      currentNodeId: null,
      queue,
      itemsGoal,
      chat: [],
      pointsEarned: 0,
      summary: null
    }
  }

  private async begin(s: Session): Promise<void> {
    await this.leaveCurrent()
    const sc = new SessionController(this, s)
    this.session.set(sc)
    this.updateState((st) => ({ ...st, activeSessionId: s.id }))
    this.go({ name: 'session' })
    await sc.save()
    void sc.start()
  }

  private get agentMode(): boolean {
    return this.settings.get().learning.tutorMode !== 'guided'
  }

  startLearn(conceptId: string): Promise<void> {
    if (this.agentMode) return this.startChat('learn', conceptId, [conceptId])
    return this.begin(this.newSession('learn', conceptId, [conceptId], [], 0))
  }

  startPractice(scope: string[]): Promise<void> {
    if (this.agentMode) return this.startChat('practice', null, scope)
    const n = this.settings.get().learning.practiceItems
    return this.begin(this.newSession('practice', null, scope, [], n))
  }

  startReview(): Promise<void> {
    if (this.agentMode) return this.startChat('review', null, [])
    return this.begin(this.newSession('review', null, [], [], 10))
  }

  // ------------------------------------------------------------ tutor chats (agent)
  private chatTitle(mode: AgentMode, goal: string | null, scope: string[]): string {
    if (mode === 'learn' && goal) return this.graph.title(goal)
    if (mode === 'practice') return scope.length === 1 ? `Practice: ${this.graph.title(scope[0])}` : 'Mixed practice'
    if (mode === 'review') return 'Spaced review'
    return 'Open chat'
  }

  /**
   * Start a new agent session. The cards it creates appear on the session screen (phases, plan
   * review, side panel); `opening` is the learner's first message (open chats), otherwise the app
   * briefs the agent.
   */
  async startChat(mode: AgentMode, goal: string | null, scope: string[], opening?: string): Promise<void> {
    const rec = newChatRecord(mode, goal, scope, opening ? opening.slice(0, 60) : this.chatTitle(mode, goal, scope))
    const session = chatSession(rec)
    if (mode === 'practice' || mode === 'review') {
      const now = new Date()
      const learner = this.state.get().learner
      const queue = mode === 'practice' ? practiceQueue(this.graph, learner, scope, this.settings.get().learning.practiceItems, now) : reviewQueue(this.graph, learner, now, 10)
      if (!queue.length) {
        this.toast({ kind: 'info', text: mode === 'review' ? 'Nothing is due for review right now.' : 'Nothing to practice yet: learn a concept first.' })
        return
      }
      session.queue = queue
      session.itemsGoal = queue.length
    }
    await this.leaveCurrent()
    const cc = new ChatController(this, rec, session)
    this.chat.set(cc)
    this.session.set(cc.cards)
    this.updateState((st) => ({ ...st, activeSessionId: session.id }))
    this.go({ name: 'session' })
    await cc.save()
    if (opening) await cc.send(opening)
    else
      await cc.begin(
        mode === 'learn'
          ? `Start the learning session for "${this.chatTitle(mode, goal, scope)}": probe first.`
          : mode === 'practice'
            ? `Start the practice session with item 1 of ${session.queue.length}.`
            : mode === 'review'
              ? `Start the spaced review with item 1 of ${session.queue.length}.`
              : 'Greet the learner in one sentence and ask what they want to work on.'
      )
  }

  /** Pause the session on screen and stop its agent, if any. */
  private async leaveCurrent(): Promise<void> {
    const cc = this.chat.get()
    const sc = this.session.get()
    if (cc) await cc.stop()
    else if (sc) await sc.pause()
    this.chat.set(null)
  }

  async openChat(id: string): Promise<void> {
    if (this.chat.get()?.chat.id === id) return this.go({ name: 'session' })
    const rec = await this.backend.readJson<ChatRecord>(`chats/${id}`)
    if (!rec || rec.version !== 1) {
      this.toast({ kind: 'error', text: 'That chat could not be opened.' })
      return
    }
    await this.leaveCurrent()
    const s = await this.backend.readJson<Session>(`sessions/${rec.sessionId}`)
    const cc = new ChatController(this, rec, s)
    this.chat.set(cc)
    this.session.set(cc.cards)
    if (cc.cards.s.phase !== 'done') this.updateState((st) => ({ ...st, activeSessionId: cc.cards.s.id }))
    this.go({ name: 'session' })
  }

  /** Stop the running agent (the chat stays and resumes on the next message). */
  async closeChatAgent(): Promise<void> {
    const cc = this.chat.get()
    if (cc) await cc.stop()
  }

  async touchChatIndex(c: ChatRecord): Promise<void> {
    // a late save from a chat of another course (after a course switch) must not land in this course's list
    if (this.chat.get()?.chat.id !== c.id && !this.chats.get().some((x) => x.id === c.id)) return
    const entry: ChatIndexEntry = { id: c.id, title: c.title, mode: c.mode, goalConceptId: c.goalConceptId, updatedAt: c.updatedAt }
    const list = [entry, ...this.chats.get().filter((x) => x.id !== c.id)].slice(0, 100)
    this.chats.set(list)
    await this.backend.writeJson(chatsName(this.courseId), list)
  }

  async finishSession(s: Session, summary: SessionSummary): Promise<void> {
    this.updateState((st) => ({
      ...st,
      sessions: [...st.sessions.filter((x) => x.id !== summary.id), summary].slice(-300),
      activeSessionId: st.activeSessionId === s.id ? null : st.activeSessionId
    }))
    await this.flush()
  }

  closeSession(): void {
    void this.leaveCurrent()
    this.session.set(null)
    this.updateState((st) => ({ ...st, activeSessionId: null }))
    this.go({ name: 'home' })
  }

  async resetAll(): Promise<void> {
    await this.leaveCurrent()
    this.session.set(null)
    this.state.set({ ...freshState(), learner: { profile: this.state.get().learner.profile, concepts: {} } })
    await this.flush()
  }

  exportData(): string {
    return JSON.stringify({ exportedAt: nowIso(), state: this.state.get() }, null, 1)
  }

  importData(json: string): boolean {
    try {
      const d = JSON.parse(json) as { state?: AppState }
      if (!d.state || d.state.version !== 1) return false
      this.state.set(d.state)
      void this.flush()
      return true
    } catch {
      return false
    }
  }
}

let instance: AppController | null = null

export function createApp(backend: Backend): AppController {
  instance = new AppController(backend)
  return instance
}

export function useApp(): AppController {
  if (!instance) throw new Error('app not created')
  return instance
}
