import { describe, expect, it } from 'vitest'
import { emptyPrep, newOnlineTask, normalizePrep } from '../../src/shared/exam'
import { applyTaskMap, buildTaskMapPrompt, fakeTaskMap, learnerTopics, needsTopics, normalizeTaskMap, tasksToMap, textKey } from '../../src/shared/taskMap'
import type { ExamPrep, OnlineTask } from '../../src/shared/types'
import { mapTasks, withNotebooks, type CourseHost } from '../../src/shared/courseWork'
import { course } from './helpers'

const now = new Date('2026-11-27T10:00:00Z')
const size = course.concepts.length
const c0 = course.concepts[0]
const c1 = course.concepts[1]

function task(over: Partial<OnlineTask> = {}): OnlineTask {
  const t = newOnlineTask({ kind: 'exercises', title: 'Serie 4', platform: 'Code Expert', statement: `Implement ${c0.title}.` }, now)
  if (!t) throw new Error('no task')
  return { ...t, codeExpert: { seriesId: 's4', due: null, tasks: [] }, ...over }
}

describe('which online tasks the AI maps', () => {
  it('maps synced tasks without a record, guesses, changed statements and tasks mapped before the map grew', () => {
    const t = task()
    expect(needsTopics(t, size)).toBe(true)
    expect(needsTopics(t, 0)).toBe(false)
    expect(needsTopics({ ...t, topics: { by: 'guess', at: '', mapSize: size, key: textKey(t) } }, size)).toBe(true)
    const ai = { ...t, topics: { by: 'ai' as const, at: '', mapSize: size, key: textKey(t) } }
    expect(needsTopics(ai, size)).toBe(false)
    expect(needsTopics(ai, size + 1)).toBe(true)
    expect(needsTopics({ ...ai, statement: 'A different statement' }, size)).toBe(true)
  })

  it('never touches topics the learner picked, nor older hand-added tasks with topics', () => {
    const t = task()
    expect(needsTopics({ ...t, topics: learnerTopics(t, size, now) }, size + 50)).toBe(false)
    const manual = { ...task({ conceptIds: [c0.id] }), codeExpert: undefined }
    expect(needsTopics(manual, size)).toBe(false)
    expect(needsTopics({ ...manual, conceptIds: [] }, size)).toBe(true)
  })

  it('keeps the topic record through normalisation', () => {
    const t = { ...task(), topics: { by: 'ai' as const, at: now.toISOString(), mapSize: 12, key: 'k' } }
    const p = normalizePrep({ ...emptyPrep(), online: [t, { ...t, id: 'ot_b', topics: { by: 'nope' } }] })
    expect(p.online[0].topics).toEqual(t.topics)
    expect(p.online[1].topics).toBeUndefined()
  })
})

describe('mapping answers', () => {
  it('builds a prompt with the map and the statements', () => {
    const t = task()
    const p = buildTaskMapPrompt(course, [t])
    expect(p).toContain(`- ${c0.id} [ch ${c0.chapter}] ${c0.title}`)
    expect(p).toContain(`## id: ${t.id} (on Code Expert)`)
    expect(p).toContain(`Implement ${c0.title}.`)
  })

  it('keeps only asked tasks and known concepts', () => {
    const t = task()
    const rows = normalizeTaskMap({ tasks: [{ id: t.id, conceptIds: [c0.id, 'made-up', c0.id, c1.id] }, { id: 'ot_other', conceptIds: [c0.id] }, null] }, course, [t])
    expect(rows).toEqual([{ id: t.id, conceptIds: [c0.id, c1.id] }])
    expect(normalizeTaskMap('garbage', course, [t])).toEqual([])
  })

  it('applies topics, but not over a learner edit or a statement changed meanwhile', () => {
    const a = task()
    const b = task({ id: 'ot_b' })
    const c = task({ id: 'ot_c' })
    const prep: ExamPrep = { ...emptyPrep(), online: [a, { ...b, conceptIds: [c1.id], topics: learnerTopics(b, size, now) }, { ...c, statement: 'changed' }] }
    const rows = [a, b, c].map((t: OnlineTask) => ({ id: t.id, conceptIds: [c0.id] }))
    const out = applyTaskMap(prep, rows, [a, b, c], size, now)
    expect(out.prep.online[0]).toMatchObject({ conceptIds: [c0.id], topics: { by: 'ai', mapSize: size, key: textKey(a) } })
    expect(out.prep.online[1].conceptIds).toEqual([c1.id])
    expect(out.prep.online[2].topics).toBeUndefined()
    expect(out.changed).toBe(1)
    expect(tasksToMap(out.prep, size).map((t) => t.id)).toEqual(['ot_c'])
  })

  it('adds a found notebook once', () => {
    const nb = task({ id: 'ot_nb', notebook: { path: '/x/a.ipynb', foundMtimeMs: 1, mtimeMs: 1 } })
    const p = withNotebooks(withNotebooks(emptyPrep(), [nb]), [{ ...nb, id: 'ot_nb2' }])
    expect(p.online.map((t) => t.id)).toEqual(['ot_nb'])
  })
})

describe('mapTasks', () => {
  function host(prep: ExamPrep, alive = () => true): CourseHost & { saved: () => ExamPrep } {
    let p = prep
    return {
      courseId: 'numcs',
      builtin: true,
      script: null as never,
      alive,
      cancelled: () => false,
      base: () => course,
      ext: () => ({ chapters: [], concepts: [] }) as never,
      course: () => course,
      setExt: async () => {},
      materials: () => [],
      patchMaterial: () => {},
      saveMaterials: async () => {},
      prep: () => p,
      updatePrep: async (fn) => {
        p = fn(p)
      },
      setJob: () => {},
      setRequest: () => {},
      toast: () => {},
      saved: () => p
    }
  }
  const backend = (calls: string[]) =>
    ({
      generate: async (req: { id: string; prompt: string; meta?: { fake?: unknown } }) => {
        calls.push(req.prompt)
        return { id: req.id, ok: true, data: req.meta?.fake }
      },
      cancel: async () => {}
    }) as never

  it('maps tasks in batches with the model and records it', async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task({ id: `ot_${i}` }))
    const h = host({ ...emptyPrep(), online: tasks })
    const calls: string[] = []
    const n = await mapTasks(backend(calls), h)
    expect(calls).toHaveLength(2)
    const expected = (fakeTaskMap(course, [tasks[0]]) as { tasks: { conceptIds: string[] }[] }).tasks[0].conceptIds
    expect(expected.length).toBeGreaterThan(0)
    expect(n).toBe(10)
    expect(h.saved().online.every((t) => t.topics?.by === 'ai' && t.conceptIds.join() === expected.join())).toBe(true)
    // nothing left to do until the map grows or a statement changes
    expect(await mapTasks(backend(calls), h)).toBe(0)
    expect(calls).toHaveLength(2)
  })

  it('stops when the course is let go and reports a failed call', async () => {
    const h = host({ ...emptyPrep(), online: [task()] }, () => false)
    const calls: string[] = []
    expect(await mapTasks(backend(calls), h)).toBe(0)
    expect(calls).toHaveLength(0)
    const failing = { generate: async (req: { id: string }) => ({ id: req.id, ok: false, errorKind: 'auth', error: 'no login' }), cancel: async () => {} } as never
    expect(await mapTasks(failing, host({ ...emptyPrep(), online: [task()] }))).toBeNull()
  })
})
