// Which provider, model and effort each kind of work uses, and how efforts map onto each provider.
import type { Effort, LlmKind, Provider, Settings, TaskModel, TaskName } from './types'
import { DEFAULT_SETTINGS } from './types'

export const TASKS: { id: TaskName; label: string; desc: string }[] = [
  { id: 'tutor', label: 'Tutor', desc: 'Lessons, practice, reviews and the chat.' },
  { id: 'map', label: 'Course maps', desc: 'Reading slides and scripts into the course map. Bulk work: a smaller model is usually enough.' },
  { id: 'grading', label: 'Grading', desc: 'Grading answers and checking uploaded solutions.' }
]

/** The kind of work behind a request. */
export function taskOf(kind: LlmKind | 'chat'): TaskName {
  if (kind === 'map') return 'map'
  if (kind === 'grade' || kind === 'work') return 'grading'
  return 'tutor'
}

export const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' }
]

/** Effort levels each provider understands (on Gemini, Extra is only for models that have an xhigh level). */
export const EFFORTS: Record<Provider, { id: Effort; label: string }[]> = {
  claude: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'Extra' },
    { id: 'max', label: 'Max' }
  ],
  gemini: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'Extra' }
  ]
}

/** Model names offered in the picker; any other name the provider accepts can be typed. */
export const MODEL_SUGGESTIONS: Record<Provider, { id: string; label: string }[]> = {
  claude: [
    { id: 'opus', label: 'Opus (most capable)' },
    { id: 'sonnet', label: 'Sonnet (balanced)' },
    { id: 'haiku', label: 'Haiku (fastest, cheapest)' }
  ],
  gemini: [
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (fast, general purpose)' },
    { id: 'gemini-4-neon', label: 'Gemini 4 Neon (frontier, balanced)' },
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon (deepest reasoning)' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon (efficient reasoning)' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (previous generation)' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (cheapest)' }
  ]
}

/** The Gemini model used when a task names none (Google's general-purpose Gemini 4 model, with a free tier). */
export const GEMINI_DEFAULT_MODEL = 'gemini-4-hydrogen'

/** Gemini models with an xhigh thinking level (Gemini 4 Neon and Hydrogen); the others stop at high. */
export function geminiHasXhigh(model: string): boolean {
  return /^gemini-4-(neon|hydrogen)\b/.test(model.trim())
}

/** What a task runs with: model and effort filled in (an empty Claude model = Claude Code's default). */
export interface Route {
  task: TaskName
  provider: Provider
  model: string
  effort: Effort | null
}

export function routeFor(kind: LlmKind | 'chat', s: Pick<Settings, 'tasks'>, requested?: Effort | null): Route {
  const task = taskOf(kind)
  const t = normalizeTask(s.tasks?.[task], task)
  const effort = t.effort === 'auto' ? (requested ?? null) : t.effort
  const model = t.model.trim() || (t.provider === 'gemini' ? GEMINI_DEFAULT_MODEL : '')
  return { task, provider: t.provider, model, effort: effort ? clampEffort(t.provider, effort, model) : null }
}

/** The nearest effort the provider (and, on Gemini, the model) supports. */
export function clampEffort(p: Provider, e: Effort, model = ''): Effort {
  if (p !== 'gemini' || (e !== 'xhigh' && e !== 'max')) return e
  return geminiHasXhigh(model || GEMINI_DEFAULT_MODEL) ? 'xhigh' : 'high'
}

const EFFORT_IDS: (Effort | 'auto')[] = ['low', 'medium', 'high', 'xhigh', 'max', 'auto']

export function normalizeTask(raw: unknown, task: TaskName): TaskModel {
  const d = DEFAULT_SETTINGS.tasks[task]
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TaskModel>
  return {
    provider: r.provider === 'gemini' ? 'gemini' : r.provider === 'claude' ? 'claude' : d.provider,
    model: typeof r.model === 'string' ? r.model.trim().slice(0, 120) : d.model,
    effort: EFFORT_IDS.includes(r.effort as Effort) ? (r.effort as Effort | 'auto') : d.effort
  }
}

/**
 * Settings saved before tasks existed kept one Claude model and effort (cli.model, cli.effort) and a
 * map model (cli.mapModel): carry them over once.
 */
export function migrateSettings(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || raw.tasks) return raw
  const cli = (raw.cli ?? {}) as { model?: unknown; effort?: unknown; mapModel?: unknown }
  const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')
  const effort = EFFORT_IDS.includes(cli.effort as Effort) ? (cli.effort as Effort) : DEFAULT_SETTINGS.tasks.tutor.effort
  const model = str(cli.model)
  return {
    ...raw,
    tasks: {
      tutor: { provider: 'claude', model, effort },
      map: { provider: 'claude', model: str(cli.mapModel) || model, effort: DEFAULT_SETTINGS.tasks.map.effort },
      grading: { provider: 'claude', model, effort: 'auto' }
    }
  }
}

/** Gemini's thinking setting for an effort: a level for Gemini 3 and later, a token budget for 2.x. */
export function geminiThinking(model: string, effort: Effort | null): { thinkingLevel: string } | { thinkingBudget: number } | null {
  if (!effort) return null
  const e = clampEffort('gemini', effort, model)
  if (/^gemini-[12](\.|-)/.test(model)) return { thinkingBudget: e === 'low' ? 1024 : e === 'medium' ? 8192 : 24576 }
  return { thinkingLevel: e }
}

/** Keep the text models out of a Gemini model list (no images, speech, embeddings or live audio). */
export function textGeminiModels(list: { name?: string; supportedGenerationMethods?: string[] }[]): string[] {
  const out = new Set<string>()
  for (const m of list) {
    const id = String(m.name ?? '').replace(/^models\//, '')
    if (!/^gemini-/.test(id)) continue
    if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue
    if (/(image|tts|live|embedding|transcribe|audio|banana|omni|translate|robotics|computer-use)/.test(id)) continue
    out.add(id)
  }
  return [...out].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}

/**
 * Loose sanity check for a Google AI Studio key: Google has more than one key format, so this only
 * refuses what cannot be a key (too short, spaces inside); Test the connection proves it works.
 */
export function looksLikeGoogleKey(key: string): boolean {
  return /^[\x21-\x7e]{20,512}$/.test(key.trim())
}
