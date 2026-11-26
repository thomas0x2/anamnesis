import type { CeOp, CeResult } from './codeExpert'
import type { PageCapture, PlatformStatus } from './platform'
import type { AgentEvent, AgentStartRequest, AgentToolResult } from './agentTypes'
import type { CloudSttRequest } from './stt'
// Domain types shared by the Electron main process, the renderer and the tests.

// ---------------------------------------------------------------- course map
export type ConceptTier = 'core' | 'support' | 'extra'

export interface CourseConcept {
  id: string
  chapter: number
  title: string
  /** German term(s) as used in the script */
  de: string
  summary: string
  why: string
  requires: string[]
  /** [firstPdfPage, lastPdfPage] or [] when the concept is a refresher outside the script */
  pages: number[]
  refs: string[]
  demos: string[]
  tier: ConceptTier
  /** set on concepts the app added from a course material (not part of a built-in course file) */
  addedAt?: string
  /** id of the material that introduced this concept */
  material?: string
  /** further page ranges (app page numbers) where the concept is treated, e.g. in later slides */
  sources?: ConceptSource[]
  /** problem-set tasks that practise this concept */
  exercises?: ConceptSource[]
}

export interface ConceptSource {
  material: string
  /** [first, last] app page numbers (see Material.offset) */
  pages: number[]
  label: string
}

export interface CourseChapter {
  number: number
  title: string
  de: string
  pages: number[]
}

export interface Course {
  id: string
  /** shipped with the app (courses/<id>/course.json); otherwise created by the learner */
  builtin?: boolean
  /** language of the course materials, e.g. "de" or "en" */
  language?: string
  institution?: string
  version: number
  title: string
  short: string
  term: string
  lecturer: string
  courseNumber: string
  script: { title: string; fileName: string; language: string; printedPageOffset: number; note: string }
  exam: { format: string; codeLanguage: string }
  chapters: CourseChapter[]
  concepts: CourseConcept[]
}

// ---------------------------------------------------------------- course materials
export const MATERIAL_KINDS = ['script', 'slides', 'exercises', 'solutions', 'exam', 'notes'] as const
export type MaterialKind = (typeof MATERIAL_KINDS)[number]

export type MaterialStatus = 'queued' | 'indexing' | 'mapping' | 'mapped' | 'error' | 'skipped'

/** One PDF of a course (script, a week's slides, a problem set). Its pages get app page numbers offset+1 … offset+numPages. */
export interface Material {
  id: string
  kind: MaterialKind
  title: string
  fileName: string
  path: string | null
  size: number
  mtimeMs: number | null
  /** 0 until the PDF has been read */
  numPages: number
  /** app page number = offset + PDF page; fixed once assigned */
  offset: number | null
  /** printed page = PDF page + printedOffset */
  printedOffset: number
  addedAt: string
  status: MaterialStatus
  /** mapping progress in chunks of pages */
  chunksDone: number
  chunksTotal: number
  error: string | null
  mappedAt: string | null
  /** what the mapping did, for the materials list */
  added: string[]
  linked: string[]
  /** the last failure was a dropped connection or a stall: the build resumes on its own when the app is back online */
  retryable?: boolean
}

export interface MaterialsFile {
  version: 1
  items: Material[]
  /** files in the course folder the learner chose not to add */
  ignored: string[]
}

/** What the app adds to a course from its materials: new chapters and concepts, and links on existing concepts. */
export interface CourseExtension {
  version: 1
  chapters: CourseChapter[]
  concepts: CourseConcept[]
  /** extra sources and exercises on concepts of the base course */
  patches: Record<string, { sources?: ConceptSource[]; exercises?: ConceptSource[] }>
  /** parts of each material already merged into this map (saved with the map, so a resumed build never adds a part twice) */
  done?: Record<string, number>
}

/** A course the learner created (stored in the data folder, not the repository). */
export interface CourseMeta {
  id: string
  title: string
  short: string
  term: string
  lecturer: string
  courseNumber: string
  institution: string
  language: string
  examFormat: string
  codeLanguage: string
  /** folder watched for new PDFs */
  folder: string | null
  autoAdd: boolean
  createdAt: string
}

export interface FolderFile {
  path: string
  /** path relative to the folder */
  rel: string
  name: string
  size: number
  mtimeMs: number
}

// ---------------------------------------------------------------- exam preparation
/** How the learner worked on a submission: what it says about unaided mastery. */
export type WorkHelp = 'alone' | 'notes' | 'help'

/** One task of a problem set or mock exam, as the grader judged it. */
export interface WorkTask {
  label: string
  /** 0..1 */
  score: number
  verdict: 'correct' | 'partial' | 'incorrect' | 'missing'
  feedback: string
  /** concrete errors in the learner's work */
  errors: string[]
  conceptIds: string[]
  misconceptions: string[]
}

/** The learner's own solution to a problem set or mock exam, and how it was graded. */
export interface Submission {
  id: string
  materialId: string
  at: string
  /** files saved in the data folder: courses/<course>/work/<submission>/<name> */
  files: { name: string; size: number }[]
  /** typed answers (instead of or next to files) */
  text: string | null
  help: WorkHelp
  /** mock exams: written timed, without notes */
  examConditions: boolean
  minutes: number | null
  status: 'grading' | 'graded' | 'error'
  error: string | null
  /** 0..1 over all tasks */
  score: number | null
  summary: string | null
  tasks: WorkTask[]
  strengths: string[]
  next: string[]
  gradedAt: string | null
  /** the learner model was updated from this grade */
  applied: boolean
  /** "checked": graded by the tutor (default); "reported": a result the learner logged, e.g. tests passed on Code Expert */
  source?: 'checked' | 'reported'
  /** the logged result of a "reported" submission */
  reported?: { points: number; max: number; note: string | null } | null
}

/** A problem set or mock exam that lives on a platform (Code Expert, GitLab, Moodle…) instead of a PDF in the course. */
export interface OnlineTask {
  /** "ot_…" (used like a material id in records and submissions) */
  id: string
  kind: 'exercises' | 'exam'
  title: string
  /** where it is: "Code Expert", "GitLab", … */
  platform: string
  url: string | null
  /** the concepts it practises, picked by the learner (a logged result updates these) */
  conceptIds: string[]
  /** the task statement, pasted by the learner: the check of a solution grades against it */
  statement: string | null
  addedAt: string
  /** a series synced from Code Expert: its tasks and their scores there */
  codeExpert?: CodeExpertSeries
}

export interface CodeExpertSeries {
  seriesId: string
  due: string | null
  tasks: { id: string; name: string; maxPoints: number; result: number | null; submitted: boolean; feedback: string | null; projectId: string | null }[]
}

/** The Code Expert course a course of the app is linked to (its series sync into the online tasks). */
export interface CodeExpertLink {
  courseId: string
  semester: string
  name: string
  slug: string
  syncedAt: string | null
}

export interface WorkRecord {
  status: 'todo' | 'started' | 'done'
  doneAt: string | null
}

/** A course's exam goal and the problem sets and mock exams done towards it (courses/<id>/exam). */
export interface ExamPrep {
  version: 1
  /** YYYY-MM-DD */
  examDate: string | null
  /** how many problem sets the course will have (they are published one by one); null: as many as were added */
  problemSets: number | null
  /** mock exams to write before the exam */
  mockExams: number
  /** by material id */
  records: Record<string, WorkRecord>
  submissions: Submission[]
  /** problem sets and mock exams without a PDF, e.g. coding tasks on Code Expert or GitLab */
  online: OnlineTask[]
  /** the linked Code Expert course, if any */
  codeExpert?: CodeExpertLink | null
}

// ---------------------------------------------------------------- tutor output (LLM)
export const BLOCK_TYPES = [
  'text',
  'equation',
  'callout',
  'steps',
  'plot',
  'demo',
  'mermaid',
  'sketch',
  'script',
  'code',
  'table'
] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export const DEMO_IDS = [
  'interpolation',
  'lebesgue',
  'chebyshev',
  'cancellation',
  'fourier-series',
  'roots-of-unity',
  'trig-interp',
  'aliasing',
  'splines',
  'quadrature',
  'cobweb',
  'newton',
  'svd',
  'least-squares'
] as const
export type DemoId = (typeof DEMO_IDS)[number]

export interface PlotSeries {
  label?: string | null
  /** math.js expression in x, e.g. "1/(1+25*x^2)" */
  expr?: string | null
  points?: number[][] | null
  style?: 'line' | 'dashed' | 'points' | null
}

export interface PlotSpec {
  title?: string | null
  xLabel?: string | null
  yLabel?: string | null
  xMin: number
  xMax: number
  yMin?: number | null
  yMax?: number | null
  logX?: boolean | null
  logY?: boolean | null
  series: PlotSeries[]
}

export interface Block {
  type: BlockType
  md?: string | null
  latex?: string | null
  tone?: 'info' | 'insight' | 'warning' | 'example' | null
  items?: string[] | null
  plot?: PlotSpec | null
  demo?: { id: string; params?: string | null; caption?: string | null } | null
  html?: string | null
  height?: number | null
  page?: number | null
  label?: string | null
  code?: { language?: string | null; source: string } | null
  table?: { headers: string[]; rows: string[][] } | null
}

export const INTERACTION_TYPES = ['mcq', 'numeric', 'free', 'order', 'fill', 'continue'] as const
export type InteractionType = (typeof INTERACTION_TYPES)[number]

export interface McqOption {
  id: string
  md: string
  correct: boolean
  feedback: string
}

export interface Interaction {
  type: InteractionType
  prompt: string
  options?: McqOption[] | null
  multi?: boolean | null
  answer?: { value: string; tolerance?: number | null; relative?: boolean | null } | null
  items?: string[] | null
  template?: string | null
  blanks?: { id: string; accepted: string[] }[] | null
  rubric?: string[] | null
  modelAnswer?: string | null
  hints: string[]
  solution: string
  explain?: string | null
  confidence: boolean
  conceptIds: string[]
  level?: number | null
  cue?: 'familiar' | 'shifted' | 'novel' | null
  allowVoice?: boolean | null
  misconceptions?: { optionId: string; text: string }[] | null
}

export const CARD_KINDS = [
  'probe',
  'predict',
  'explain',
  'check',
  'practice',
  'review',
  'reflect',
  'summary',
  'message'
] as const
export type CardKind = (typeof CARD_KINDS)[number]

export interface Card {
  kind: CardKind
  title: string | null
  nodeId: string | null
  blocks: Block[]
  interaction: Interaction | null
  speech: string | null
}

export type PlanNodeKind = 'known' | 'shaky' | 'new' | 'goal'

export interface PlanNode {
  id: string
  title: string
  detail: string
  kind: PlanNodeKind
  requires: string[]
  conceptId: string | null
}

export interface Plan {
  goal: string
  approach: string
  nodes: PlanNode[]
}

export interface ModelUpdate {
  notes: { conceptId: string; note: string }[]
  misconceptions: { conceptId: string; text: string; status: 'active' | 'resolved' }[]
  profile: string[]
}

export type StepNext = 'continue' | 'phase_done' | 'session_done'

export interface TutorStep {
  assessment: string | null
  cards: Card[]
  plan: Plan | null
  model: ModelUpdate | null
  control: { next: StepNext; nodeId: string | null; nodeStatus: 'done' | 'shaky' | 'needs_more' | null }
}

export interface GradeResult {
  score: number
  verdict: 'correct' | 'partial' | 'incorrect'
  feedback: string
  missing: string[]
  misconceptions: string[]
}

export interface ChatReply {
  blocks: Block[]
  speech: string | null
}

// ---------------------------------------------------------------- sessions
export type SessionType = 'learn' | 'practice' | 'review' | 'chat'
export type Phase = 'probe' | 'plan' | 'teach' | 'wrap' | 'practice' | 'review' | 'chat' | 'done'
export type Verdict = 'correct' | 'partial' | 'incorrect' | 'dontknow' | 'seen'

export interface CardResponse {
  answer: unknown
  answerText: string
  /** 0..1, null when the card is not graded (continue, open prediction) */
  score: number | null
  verdict: Verdict | null
  attempts: number
  hintsUsed: number
  revealed: boolean
  /** 1 guess .. 4 certain */
  confidence: number | null
  latencyMs: number
  feedback: string | null
  missing?: string[] | null
  /** the learner's explanation of how they got the answer (often spoken), graded into the score */
  reasoning?: string | null
  selfCheck?: 'right' | 'partly' | 'wrong' | null
  at: string
}

export interface StepRecord {
  id: string
  phase: Phase
  nodeId: string | null
  /** practice/review target this step was generated for */
  target: PracticeTarget | null
  step: TutorStep
  responses: Record<number, CardResponse>
  createdAt: string
  completedAt: string | null
  durationMs: number | null
  model: string | null
  /** still streaming from the model: cards may grow */
  pending?: boolean
}

export type PlanNodeState = 'known' | 'pending' | 'active' | 'done' | 'shaky' | 'skipped'

export interface PlanState {
  plan: Plan
  nodeState: Record<string, PlanNodeState>
  attempts: Record<string, number>
  confirmed: boolean
}

export interface PracticeTarget {
  conceptId: string
  level: number
  cue: 'familiar' | 'shifted' | 'novel'
  compose: string[]
  mode: 'recall' | 'apply' | 'discriminate' | 'compose' | 'exam' | 'relearn'
}

export interface ChatTurn {
  role: 'user' | 'tutor'
  text: string
  blocks?: Block[]
  at: string
}

export interface Session {
  id: string
  type: SessionType
  /** set when a tutor agent drives this session (the chat record that holds its conversation) */
  agentChatId?: string
  goalConceptId: string | null
  scope: string[]
  startedAt: string
  endedAt: string | null
  phase: Phase
  steps: StepRecord[]
  plan: PlanState | null
  currentNodeId: string | null
  queue: PracticeTarget[]
  itemsGoal: number
  chat: ChatTurn[]
  pointsEarned: number
  summary: SessionSummary | null
}

export interface SessionSummary {
  id: string
  type: SessionType
  goalConceptId: string | null
  title: string
  startedAt: string
  endedAt: string | null
  items: number
  correct: number
  points: number
  conceptIds: string[]
}

// ---------------------------------------------------------------- learner model
export interface FsrsCard {
  stability: number
  difficulty: number
  lastReview: string | null
  due: string | null
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
}

export interface Misconception {
  id: string
  text: string
  status: 'active' | 'resolved'
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
  count: number
}

/** work: a problem set the learner solved and uploaded; exam: a mock exam */
export type EvidenceKind = 'probe' | 'predict' | 'check' | 'practice' | 'review' | 'reflect' | 'work' | 'exam'

export interface Evidence {
  id: string
  at: string
  sessionId: string
  kind: EvidenceKind
  conceptId: string
  score: number
  weight: number
  confidence: number | null
  hints: number
  revealed: boolean
  level: number | null
  cue: string | null
  summary: string
}

export type ConceptStatus = 'unseen' | 'introduced' | 'developing' | 'proficient' | 'mastered'

export interface ConceptState {
  conceptId: string
  alpha: number
  beta: number
  fsrs: FsrsCard | null
  level: number
  streak: number
  understanding: number | null
  transfer: number | null
  independence: number | null
  misconceptions: Misconception[]
  tutorNote: string | null
  tutorNoteAt: string | null
  userNote: string | null
  evidence: Evidence[]
  firstSeen: string | null
  lastSeen: string | null
  status: ConceptStatus
  successDays: string[]
  maxLevelSolved: number
  proficientAt: string | null
  masteredAt: string | null
}

export interface ProfileNote {
  id: string
  text: string
  source: 'seed' | 'tutor' | 'user'
  at: string
}

export interface LearnerModel {
  profile: ProfileNote[]
  concepts: Record<string, ConceptState>
}

export interface RewardEvent {
  id: string
  at: string
  points: number
  kind: string
  reason: string
  conceptId: string | null
  sessionId: string | null
}

export interface CalibrationPoint {
  at: string
  confidence: number
  correct: number
  conceptId: string
}

export interface AppState {
  version: 1
  createdAt: string
  updatedAt: string
  learner: LearnerModel
  rewards: { total: number; events: RewardEvent[] }
  calibration: CalibrationPoint[]
  sessions: SessionSummary[]
  activeSessionId: string | null
}

// ---------------------------------------------------------------- settings & backend
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ClaudeAuth = 'subscription' | 'api-key'

/** Who runs a model call: Claude (through the Claude Code CLI) or Google Gemini (through the Gemini API). */
export type Provider = 'claude' | 'gemini'
export type KeyProvider = 'anthropic' | 'google'

/** The kinds of work that can each use their own model: tutoring (steps and chat), building course maps, grading. */
export type TaskName = 'tutor' | 'map' | 'grading'

export interface TaskModel {
  provider: Provider
  /** empty = the provider's default (Claude Code's own default, or the app's Gemini default) */
  model: string
  /** 'auto' = what the app asks for per call (e.g. low for quick grading, high for checking a solution) */
  effort: Effort | 'auto'
}

/** What the app knows about the saved API key; the key itself never leaves the main process. */
export interface ApiKeyStatus {
  saved: boolean
  /** the last characters, to recognise it */
  hint: string | null
  /** false when the system offers no encrypted storage (the key cannot be saved) */
  canStore: boolean
  error?: string
}

export interface Settings {
  /** the course on screen */
  activeCourse: string
  provider: 'claude-cli' | 'demo'
  cli: {
    path: string | null
    /** Claude only, used when the Claude model is overloaded */
    fallbackModel: string | null
    timeoutSec: number
    /** whose usage pays for Claude: the Claude Code login (subscription) or an Anthropic API key (API credits) */
    auth: ClaudeAuth
  }
  /** which provider, model and effort each kind of work uses */
  tasks: Record<TaskName, TaskModel>
  script: { path: string | null; sendPages: boolean; maxPages: number }
  voice: {
    sttModel: string
    sttLanguage: 'english' | 'german' | 'auto'
    tts: boolean
    ttsVoice: string | null
    ttsRate: number
    autoSpeak: boolean
  }
  learning: { desiredRetention: number; practiceItems: number; tutorMode: 'agent' | 'guided' }
  onboarded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  activeCourse: 'numcs',
  provider: 'claude-cli',
  cli: { path: null, fallbackModel: null, timeoutSec: 240, auth: 'subscription' },
  tasks: {
    tutor: { provider: 'claude', model: '', effort: 'medium' },
    map: { provider: 'claude', model: '', effort: 'medium' },
    grading: { provider: 'claude', model: '', effort: 'auto' }
  },
  script: { path: null, sendPages: true, maxPages: 8 },
  voice: {
    sttModel: 'onnx-community/whisper-base',
    sttLanguage: 'english',
    tts: true,
    ttsVoice: null,
    ttsRate: 1.05,
    autoSpeak: false
  },
  learning: { desiredRetention: 0.9, practiceItems: 8, tutorMode: 'agent' },
  onboarded: false
}

export type LlmKind = 'step' | 'grade' | 'chat' | 'test' | 'map' | 'work'

export interface LlmRequest {
  id: string
  kind: LlmKind
  system: string
  prompt: string
  schema: Record<string, unknown>
  model?: string | null
  effort?: Effort | null
  meta?: Record<string, unknown>
  /** overrides the configured timeout when longer (mapping a long material) */
  timeoutSec?: number | null
  /** the learner's own files the model may read (paths in the data folder: courses/<course>/work/<submission>/<name>) */
  files?: string[] | null
}

export interface LlmEvent {
  id: string
  type: 'status' | 'partial' | 'thinking'
  status?: string
  partial?: unknown
  tokens?: number
}

export type LlmErrorKind = 'not_found' | 'auth' | 'timeout' | 'invalid' | 'cancelled' | 'rate_limit' | 'other'

export interface LlmResult {
  id: string
  ok: boolean
  data?: unknown
  error?: string
  errorKind?: LlmErrorKind
  model?: string | null
  durationMs?: number
  costUsd?: number | null
}

export interface LlmTestResult {
  ok: boolean
  message: string
  path: string | null
  version: string | null
}

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
  backend: 'electron' | 'http' | 'demo'
}

/** Everything the renderer needs from the outside world. Implemented by the Electron preload, the dev server and an in-browser demo. */
export interface Backend {
  kind: 'electron' | 'http' | 'demo'
  generate(req: LlmRequest, onEvent?: (e: LlmEvent) => void): Promise<LlmResult>
  cancel(id: string): Promise<void>
  testLlm(): Promise<LlmTestResult>
  readJson<T = unknown>(name: string): Promise<T | null>
  writeJson(name: string, data: unknown): Promise<void>
  listJson(prefix: string): Promise<string[]>
  getSettings(): Promise<Settings>
  setSettings(patch: DeepPartial<Settings>): Promise<Settings>
  readScript(): Promise<Uint8Array | null>
  chooseScript(): Promise<string | null>
  /** The bytes of a course material (the path is looked up in the course's materials file). */
  readMaterial(courseId: string, materialId: string): Promise<Uint8Array | null>
  /** Desktop only: pick PDFs to add. */
  pickMaterials(): Promise<FolderFile[]>
  /** Desktop only: pick the folder a course watches. */
  pickFolder(): Promise<string | null>
  /** The PDFs in a folder (and its subfolders, a few levels deep). */
  scanFolder(path: string): Promise<FolderFile[] | null>
  /** Save the learner's solution files (PDF, images, text) in the data folder; returns what was stored. */
  saveWork(courseId: string, submissionId: string, files: { name: string; bytes: Uint8Array }[]): Promise<{ name: string; size: number }[]>
  openExternal(url: string): Promise<void>
  /** Open a platform page (Code Expert, GitLab…) in the app's own window, where the learner signs in; false where there is none (the browser version opens a tab). */
  openPlatform(url: string): Promise<boolean>
  platformStatus(): Promise<PlatformStatus>
  /** Read the page open in the platform window: its text and the code in its editors. */
  capturePage(): Promise<PageCapture | null>
  /** Forget the sign-ins made in the platform window. */
  signOutPlatforms(): Promise<void>
  /** Ask Code Expert (expert.ethz.ch) for the learner's courses, a course's series with scores, or submitted code, with their sign-in in the platform window. */
  codeExpert(op: CeOp): Promise<CeResult<unknown>>
  info(): Promise<AppInfo>
  /** Start the tutor agent for a chat; events stream until it exits. */
  agentStart(req: AgentStartRequest, onEvent: (e: AgentEvent) => void): Promise<{ ok: boolean; error?: string; errorKind?: LlmErrorKind }>
  agentSend(chatId: string, text: string): Promise<boolean>
  agentToolResult(chatId: string, callId: string, result: AgentToolResult): Promise<void>
  agentStop(chatId: string): Promise<void>
  /** Desktop only: the saved API key of a provider (encrypted with the system keychain). */
  apiKeyStatus?(provider: KeyProvider): Promise<ApiKeyStatus>
  /** Desktop only: save a key, or remove it with null. */
  setApiKey?(provider: KeyProvider, key: string | null): Promise<ApiKeyStatus>
  /** Models the provider offers (Gemini: listed with the saved key); empty when unknown. */
  listModels?(provider: Provider): Promise<string[]>
  /** Desktop only: transcribe a recording with Gemini (Settings → Voice → Gemini), using the saved Google key. */
  transcribeCloud?(req: CloudSttRequest): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }>
  /** Electron only: run `fn` (save everything) before the window closes. */
  onBeforeQuit?(fn: () => Promise<void>): void
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }
