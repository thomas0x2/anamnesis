// Problem sets that live online (Code Expert series, GitLab exercises, Jupyter notebooks, tasks added by hand) have
// no pages for the course map to read. Their statements are mapped here instead: the model gets the concepts of the
// map and the statements, and picks the concepts each task practises, as it does for the tasks of a PDF problem set.
// A task is mapped again when the map has grown since or its statement changed; topics the learner picked stay.
import { guessConcepts } from './codeExpert'
import { LANGUAGES } from './courseMap'
import type { Course, ExamPrep, OnlineTask, TaskTopics } from './types'

/** at most this many tasks per call, and this much of each statement */
export const TASK_BATCH = 8
const TEXT_LIMIT = 6000
const MAX_CONCEPTS = 8

export const TASK_MAP_SYSTEM = String.raw`You link the problem sets of a university course to the concepts of its concept map inside a learning app. The app uses the links to tell the learner which problem sets they can already solve and what to learn first for the others, and to update its model of what the learner knows when they hand in a solution.

You get the concepts of the map (id, chapter, title, the material's own term) and the statements of some problem sets that live online (coding exercises on Code Expert or GitLab, Jupyter notebooks). For each problem set, list the concepts of the map that its tasks practise: the ideas a learner must understand to solve it, most central first, usually 2-6, at most 8.

- Use only ids from the map. Never invent ids.
- Pick what the tasks actually need, not everything the topic touches. A concept the statement only mentions in passing is not practised.
- Generic skills (reading a statement, using the editor, compiling) are not concepts unless the map has them.
- If the statement is too thin to tell (only a title like "Serie 3", or setup instructions), return an empty list for that problem set.

Output exactly one JSON object matching the schema, with one entry per problem set you were given, by its id.`

export const taskMapSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'conceptIds'],
        properties: { id: { type: 'string' }, conceptIds: { type: 'array', items: { type: 'string' } } }
      }
    }
  }
}

/** What the model reads of a task: its title, statement and (for a Code Expert series) the names of its tasks. */
export function taskText(t: OnlineTask): string {
  const parts = [t.title]
  const names = t.codeExpert?.tasks.map((x) => x.name).filter(Boolean) ?? []
  if (names.length) parts.push(`Tasks: ${names.join('; ')}`)
  if (t.statement) parts.push(t.statement.slice(0, TEXT_LIMIT))
  return parts.join('\n')
}

/** A short fingerprint of what the model read, to notice a changed statement. */
export function textKey(t: OnlineTask): string {
  const s = taskText(t)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return `${s.length.toString(36)}-${h.toString(36)}`
}

/**
 * Whether the AI should (re)map a task's topics now: never when the learner picked them or the map is empty; for a
 * task without a record, unless it was added by hand with topics (those were the learner's own, before records).
 */
export function needsTopics(t: OnlineTask, mapSize: number): boolean {
  if (mapSize <= 0) return false
  const tp = t.topics
  if (tp?.by === 'learner') return false
  if (!tp) return !(t.conceptIds.length && !t.codeExpert && !t.gitlab && !t.notebook)
  if (tp.by === 'guess') return true
  return tp.key !== textKey(t) || mapSize > tp.mapSize
}

/** The online tasks whose topics should be mapped now, in the order they were added. */
export function tasksToMap(prep: Pick<ExamPrep, 'online'>, mapSize: number): OnlineTask[] {
  return prep.online.filter((t) => needsTopics(t, mapSize))
}

/** The record for topics picked in Edit: they stay as they are. */
export function learnerTopics(t: OnlineTask, mapSize: number, now: Date): TaskTopics {
  return { by: 'learner', at: now.toISOString(), mapSize, key: textKey(t) }
}

export function buildTaskMapPrompt(course: Course, tasks: OnlineTask[]): string {
  const out: string[] = []
  out.push(
    `# Course\n${course.title}${course.courseNumber ? ` (${course.courseNumber})` : ''}${course.term ? `, ${course.term}` : ''}. Materials language: ${LANGUAGES[course.language ?? ''] ?? course.language ?? 'unknown'}.`
  )
  out.push('', `# Concepts in the map (${course.concepts.length})`)
  for (const c of course.concepts.slice(0, 500)) out.push(`- ${c.id} [ch ${c.chapter}] ${c.title}${c.de && c.de !== c.title ? ` (${c.de})` : ''}`)
  out.push('', `# Problem sets (${tasks.length})`)
  for (const t of tasks) out.push('', `## id: ${t.id}${t.platform ? ` (on ${t.platform})` : ''}`, taskText(t))
  return out.join('\n')
}

/** The model's answer, cleaned: only tasks that were asked about, only concepts of the map. */
export function normalizeTaskMap(raw: unknown, course: Course, tasks: OnlineTask[]): { id: string; conceptIds: string[] }[] {
  const asked = new Set(tasks.map((t) => t.id))
  const known = new Set(course.concepts.map((c) => c.id))
  const rows = Array.isArray((raw as { tasks?: unknown } | null)?.tasks) ? ((raw as { tasks: unknown[] }).tasks as unknown[]) : []
  const out = new Map<string, string[]>()
  for (const row of rows) {
    const r = (row ?? {}) as { id?: unknown; conceptIds?: unknown }
    if (typeof r.id !== 'string' || !asked.has(r.id) || out.has(r.id)) continue
    const ids = Array.isArray(r.conceptIds) ? r.conceptIds.filter((x): x is string => typeof x === 'string' && known.has(x)) : []
    out.set(r.id, [...new Set(ids)].slice(0, MAX_CONCEPTS))
  }
  return [...out].map(([id, conceptIds]) => ({ id, conceptIds }))
}

/**
 * Put mapped topics on the tasks of a (freshly read) exam prep. A task the learner edited meanwhile, or whose
 * statement changed meanwhile, keeps what it has (it is mapped again later).
 */
export function applyTaskMap(prep: ExamPrep, rows: { id: string; conceptIds: string[] }[], asked: OnlineTask[], mapSize: number, now: Date): { prep: ExamPrep; changed: number } {
  const byId = new Map(rows.map((r) => [r.id, r.conceptIds]))
  const keys = new Map(asked.map((t) => [t.id, textKey(t)]))
  let changed = 0
  const online = prep.online.map((t) => {
    const ids = byId.get(t.id)
    if (!ids || t.topics?.by === 'learner' || keys.get(t.id) !== textKey(t)) return t
    if (ids.join() !== t.conceptIds.join()) changed++
    return { ...t, conceptIds: ids, topics: { by: 'ai' as const, at: now.toISOString(), mapSize, key: textKey(t) } }
  })
  return { prep: { ...prep, online }, changed }
}

/** The demo tutor's answer: the concepts whose names appear in each statement. */
export function fakeTaskMap(course: Course, tasks: OnlineTask[]): unknown {
  const concepts = course.concepts.map((c) => ({ id: c.id, title: c.title, de: c.de }))
  return { tasks: tasks.map((t) => ({ id: t.id, conceptIds: guessConcepts(taskText(t), concepts) })) }
}
