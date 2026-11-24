import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newMaterial } from '../../src/shared/courseMap'
import {
  applyWork,
  buildWorkPrompt,
  daysUntil,
  emptyPrep,
  fakeWorkOutput,
  normalizePrep,
  normalizeWork,
  numberKey,
  prepProgress,
  prepSummary,
  solutionFor,
  workEvidence,
  cleanUrl,
  newOnlineTask,
  onlineMaterial,
  practisedConcepts,
  reportedSubmission,
  REPORTED_WEIGHT,
  workFileName,
  workItems,
  workState
} from '../../src/shared/exam'
import { resolveWorkFiles, saveWork } from '../../src/node/files'
import { cliArgs, type CliConfig } from '../../src/node/claudeCli'
import { masteryMean } from '../../src/shared/mastery'
import type { Course, ExamPrep, Material, Submission } from '../../src/shared/types'

const mat = (id: string, name: string, kind?: Material['kind']): Material => ({ ...newMaterial({ path: `/c/${name}`, name, size: 10 }, id, '2026-11-01T00:00:00Z'), ...(kind ? { kind } : {}) })

const sub = (over: Partial<Submission> = {}): Submission => ({
  id: 'w_1',
  materialId: 's3',
  at: '2026-11-20T10:00:00Z',
  files: [],
  text: null,
  help: 'alone',
  examConditions: false,
  minutes: null,
  status: 'graded',
  error: null,
  score: 0.5,
  summary: 'ok',
  tasks: [],
  strengths: [],
  next: [],
  gradedAt: '2026-11-20T10:02:00Z',
  applied: true,
  ...over
})

describe('exam preparation', () => {
  it('reads stored files defensively', () => {
    expect(normalizePrep(null)).toEqual(emptyPrep())
    const p = normalizePrep({ examDate: '2027-01-28', problemSets: 13.2, mockExams: -1, submissions: [{ id: 'a' }, null] })
    expect(p.examDate).toBe('2027-01-28')
    expect(p.problemSets).toBe(13)
    expect(p.mockExams).toBe(2)
    expect(p.submissions).toHaveLength(1)
    expect(normalizePrep({ examDate: 'soon' }).examDate).toBeNull()
  })

  it('matches problem sets to their official solutions by number', () => {
    expect(numberKey('Serie 03')).toBe('3')
    const s3 = mat('s3', 'Serie03.pdf')
    const l3 = mat('l3', 'Loesung_Serie03.pdf')
    const l4 = mat('l4', 'Loesung_Serie04.pdf')
    expect(s3.kind).toBe('exercises')
    expect(l3.kind).toBe('solutions')
    expect(solutionFor(s3, [s3, l4, l3])?.id).toBe('l3')
    expect(solutionFor(mat('x', 'Intro.pdf', 'exercises'), [l3])).toBeNull()
  })

  it('tracks status, goal and pace', () => {
    const materials = [mat('s1', 'Serie1.pdf'), mat('s2', 'Serie2.pdf'), mat('s3', 'Serie3.pdf'), mat('e1', 'Mock exam 2024.pdf')]
    const prep: ExamPrep = {
      ...emptyPrep(),
      examDate: '2027-01-29',
      problemSets: 12,
      records: { s1: { status: 'done', doneAt: '2026-11-01T00:00:00Z' }, s2: { status: 'started', doneAt: null } },
      submissions: [sub({ materialId: 's3', score: 0.8 }), sub({ id: 'w_2', materialId: 's3', at: '2026-11-21T00:00:00Z', status: 'grading', score: null })]
    }
    expect(workState(prep, 's1').status).toBe('done')
    expect(workState(prep, 's2').status).toBe('started')
    expect(workState(prep, 's3').status).toBe('grading')
    expect(workState(prep, 's3').best).toBe(0.8)
    expect(workState(prep, 's3').done).toBe(true)
    const now = new Date(2026, 10, 23)
    const p = prepProgress(prep, materials, now)
    expect(p.sets).toEqual({ done: 2, added: 3, total: 12 })
    expect(p.mocks).toEqual({ done: 0, added: 1, goal: 2 })
    expect(p.daysLeft).toBe(daysUntil('2027-01-29', now))
    expect(p.daysLeft).toBe(67)
    expect(p.remaining).toBe(12)
    expect(p.perWeek).toBeCloseTo(12 / (67 / 7), 5)
    expect(prepSummary(prep, materials, now)).toContain('Problem sets done: 2 of 12')
    expect(prepSummary(emptyPrep(), [], now)).toBeNull()
  })

  it('checks the grader’s answer', () => {
    const known = (id: string): boolean => ['pointers', 'arrays'].includes(id)
    const g = normalizeWork(
      {
        summary: 'Fine',
        tasks: [
          { label: 'Task 1', score: 1.4, verdict: 'partial', feedback: 'ok', errors: [], conceptIds: ['pointers', 'nope'], misconceptions: [] },
          { label: '', score: 0.5, verdict: 'missing', feedback: '', errors: [], conceptIds: ['arrays'], misconceptions: [] },
          { label: 'Task 3', score: 0.4, verdict: 'correct', feedback: 'x', errors: ['e'], conceptIds: ['arrays', 'arrays'], misconceptions: ['m'] }
        ],
        notes: [{ conceptId: 'nope', note: 'x' }, { conceptId: 'arrays', note: 'shaky' }],
        strengths: [],
        next: ['redo']
      },
      known
    )
    expect(g.tasks.map((t) => [t.score, t.verdict])).toEqual([
      [1, 'correct'],
      [0, 'missing'],
      [0.4, 'partial']
    ])
    expect(g.tasks[0].conceptIds).toEqual(['pointers'])
    expect(g.tasks[1].label).toBe('Task 2')
    expect(g.tasks[2].conceptIds).toEqual(['arrays'])
    expect(g.notes).toEqual([{ conceptId: 'arrays', note: 'shaky' }])
    expect(g.score).toBeCloseTo(0.47, 2)
    expect(normalizeWork(null, known).score).toBeNull()
  })

  it('turns graded tasks into evidence weighted by help', () => {
    const tasks = normalizeWork(fakeWorkOutput(mat('s3', 'Serie3.pdf'), [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'this is wrong'), () => true).tasks
    const s = sub({ tasks, help: 'notes' })
    const ev = workEvidence(s, { kind: 'exercises', title: 'Serie 3' })
    // the task that was not attempted adds no evidence
    expect(ev.map((e) => e.conceptId)).toEqual(['a', 'b'])
    expect(ev.every((e) => e.kind === 'work' && e.level === 3 && e.hints === 1 && e.primary)).toBe(true)
    const mock = workEvidence(sub({ tasks, examConditions: true }), { kind: 'exam', title: 'Mock' })
    expect(mock[0].kind).toBe('exam')
    expect(mock[0].level).toBe(4)
  })

  it('updates the learner model and awards points', () => {
    const tasks = normalizeWork(fakeWorkOutput(mat('s3', 'Serie3.pdf'), [{ id: 'a' }, { id: 'b' }], 'wrong'), () => true).tasks
    const s = sub({ tasks, score: 0.4 })
    const now = new Date('2026-11-23T10:00:00Z')
    const out = applyWork({ profile: [], concepts: {} }, s, { kind: 'exercises', title: 'Serie 3' }, [{ conceptId: 'b', note: 'slips' }], (id) => id, now)
    const a = out.learner.concepts.a
    const b = out.learner.concepts.b
    expect(a.evidence).toHaveLength(1)
    expect(a.evidence[0].kind).toBe('work')
    expect(masteryMean(a)).toBeGreaterThan(0.5)
    expect(masteryMean(b)).toBeLessThan(0.5)
    expect(a.fsrs).not.toBeNull()
    expect(b.misconceptions.map((m) => m.text)).toEqual(['thinks the derivative of x^2 is x'])
    expect(b.tutorNote).toBe('slips')
    expect(out.rewards[0].kind).toBe('problem_set')
    expect(out.rewards[0].points).toBe(8)
  })

  it('writes the prompt with the statement, solution and how the learner worked', () => {
    const course = { title: 'SPCA', term: 'HS26', exam: { format: 'written', codeLanguage: 'C' } } as Course
    const p = buildWorkPrompt({
      course,
      material: mat('e1', 'Exam2024.pdf'),
      problem: [{ label: 'Exam 2024, page 1', text: 'Task 1: pointers' }],
      solution: [],
      concepts: [{ id: 'pointers', title: 'Pointers' }],
      fileCount: 2,
      text: 'my answer',
      help: 'alone',
      examConditions: true,
      minutes: 120
    })
    expect(p).toContain('# Mock exam: Exam 2024')
    expect(p).toContain('Task 1: pointers')
    expect(p).toContain('- pointers: Pointers')
    expect(p).toContain('Under exam conditions (timed, no notes), 120 minutes')
    expect(p).toContain('2 files')
    expect(p).toContain('<student_text>\nmy answer')
  })
})

describe('problem sets that live online (Code Expert, GitLab…)', () => {
  const now = new Date('2026-11-24T20:00:00Z')

  it('keeps online tasks in the exam file, defensively', () => {
    const t = newOnlineTask({ kind: 'exercises', title: '  Exercise 7: Linked lists ', platform: 'Code Expert', url: 'expert.ethz.ch/x', conceptIds: ['lists', 'lists'] }, now)
    expect(t?.id).toMatch(/^ot_/)
    expect(t?.title).toBe('Exercise 7: Linked lists')
    expect(t?.url).toBe('https://expert.ethz.ch/x')
    expect(t?.conceptIds).toEqual(['lists'])
    expect(newOnlineTask({ kind: 'exam', title: '  ' }, now)).toBeNull()
    expect(cleanUrl('javascript:alert(1)')).toBeNull()
    expect(cleanUrl('')).toBeNull()
    const p = normalizePrep({ online: [t, { id: 'bad id', title: 'x' }, { id: 'ot_2', title: 'Mock', kind: 'exam', url: 'file:///etc' }, null] })
    expect(p.online.map((x) => x.id)).toEqual([t?.id, 'ot_2'])
    expect(p.online[1].url).toBeNull()
    expect(normalizePrep({}).online).toEqual([])
  })

  it('counts online tasks towards the goal like PDFs', () => {
    const t1 = newOnlineTask({ kind: 'exercises', title: 'Serie 2 (Code Expert)' }, now)!
    const t2 = newOnlineTask({ kind: 'exam', title: 'Practice exam' }, now)!
    const prep: ExamPrep = { ...emptyPrep(), problemSets: 4, online: [t1, t2], records: { [t1.id]: { status: 'done', doneAt: now.toISOString() } } }
    const materials = [mat('s1', 'Serie1.pdf'), mat('s3', 'Serie3.pdf')]
    const items = workItems(materials, prep)
    expect(items.sets.map((m) => m.id)).toEqual(['s1', t1.id, 's3'])
    expect(items.mocks.map((m) => m.id)).toEqual([t2.id])
    expect(workItems(materials).sets).toHaveLength(2)
    const p = prepProgress(prep, materials, now)
    expect(p.sets).toEqual({ done: 1, added: 3, total: 4 })
    expect(p.mocks.added).toBe(1)
    expect(onlineMaterial(t1).numPages).toBe(0)
  })

  it('logs a result as evidence with less weight than a checked solution', () => {
    const t = newOnlineTask({ kind: 'exercises', title: 'Exercise 7', conceptIds: ['lists', 'malloc'] }, now)!
    const m = onlineMaterial(t)
    const concepts = practisedConcepts(m, [], { online: [t] })
    expect(concepts).toEqual(['lists', 'malloc'])
    expect(reportedSubmission({ materialId: t.id, points: 9, max: 8, note: null, help: 'alone', minutes: null, examConditions: false }, concepts, now)).toBeNull()
    expect(reportedSubmission({ materialId: t.id, points: 1, max: 0, note: null, help: 'alone', minutes: null, examConditions: false }, concepts, now)).toBeNull()
    const s = reportedSubmission({ materialId: t.id, points: 6, max: 8, note: 'free() was tricky', help: 'alone', minutes: 50, examConditions: false }, concepts, now)!
    expect(s.source).toBe('reported')
    expect(s.score).toBe(0.75)
    expect(s.tasks[0].verdict).toBe('partial')
    expect(s.reported).toEqual({ points: 6, max: 8, note: 'free() was tricky' })
    const ev = workEvidence(s, m)
    expect(ev.map((e) => e.conceptId)).toEqual(['lists', 'malloc'])
    expect(ev[0].weightScale).toBe(REPORTED_WEIGHT)
    expect(ev[1].weightScale).toBeCloseTo(0.6 * REPORTED_WEIGHT)
    const prep: ExamPrep = { ...emptyPrep(), online: [t], submissions: [s] }
    expect(workState(prep, t.id).done).toBe(true)
    expect(workState(prep, t.id).best).toBe(0.75)
    const out = applyWork({ profile: [], concepts: {} }, s, m, [], (id) => id, now)
    expect(out.learner.concepts.lists.evidence).toHaveLength(1)
    expect(out.rewards[0].points).toBe(Math.round(20 * 0.75 * REPORTED_WEIGHT))
    expect(out.rewards[0].reason).toContain('6/8')
    // a PDF problem set practises the concepts the map links to it
    const pdf = mat('s3', 'Serie3.pdf')
    expect(practisedConcepts(pdf, [{ id: 'a', material: 's3' }, { id: 'b', exercises: [{ material: 's3' }] }, { id: 'c' }] as unknown as Course['concepts'], { online: [] })).toEqual(['a', 'b'])
  })

  it('asks the grader to read code against the pasted statement', () => {
    const course = { title: 'SPCA', term: 'HS26', exam: { format: '', codeLanguage: 'C' } } as Course
    const t = newOnlineTask({ kind: 'exercises', title: 'Exercise 7', platform: 'Code Expert' }, now)!
    const base = { course, material: onlineMaterial(t), problem: [], solution: [], concepts: [], fileCount: 1, text: null, help: 'alone' as const, examConditions: false, minutes: null, platform: 'Code Expert' }
    const withStatement = buildWorkPrompt({ ...base, statement: 'Implement list_reverse().' })
    expect(withStatement).toContain('# Problem set: Exercise 7 (on Code Expert)')
    expect(withStatement).toContain('<statement>\nImplement list_reverse().')
    const without = buildWorkPrompt({ ...base, statement: null })
    expect(without).toContain('The task statement is on Code Expert and was not given')
  })
})

describe('solution files', () => {
  it('keeps only readable kinds under safe names', () => {
    expect(workFileName('Serie 3 (final).PDF', 0)).toBe('01-Serie_3_final.pdf')
    expect(workFileName('../../etc/passwd', 1)).toBeNull()
    expect(workFileName('photo.heic', 2)).toBeNull()
    expect(workFileName('linked list.c', 3)).toBe('04-linked_list.c')
    expect(workFileName('solve.py', 4)).toBe('05-solve.py')
    expect(workFileName('a.out', 5)).toBeNull()
  })

  it('saves files in the data folder and resolves only those paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anam-work-'))
    const saved = await saveWork(dir, 'spca', 'w_abc', [
      { name: 'page1.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'evil.exe', bytes: new Uint8Array([1]) }
    ])
    expect(saved).toEqual([{ name: '01-page1.png', size: 3 }])
    expect(await saveWork(dir, '../x', 'w', [{ name: 'a.png', bytes: new Uint8Array([1]) }])).toEqual([])
    const ok = resolveWorkFiles(dir, ['courses/spca/work/w_abc/01-page1.png', 'courses/spca/work/../../../etc/passwd', '/etc/passwd', 'settings', 7])
    expect(ok).toEqual([join(dir, 'courses/spca/work/w_abc/01-page1.png')])
  })

  it('lets the CLI read only the submission folder', () => {
    const cfg: CliConfig = { path: null, model: '', effort: 'medium', fallbackModel: null, timeoutSec: 60, workDir: '/tmp/w' }
    const req = { id: 'r', kind: 'work' as const, system: 's', prompt: 'p', schema: {} }
    const plain = cliArgs(req, cfg, 'f')
    expect(plain[plain.indexOf('--tools') + 1]).toBe('')
    expect(plain).not.toContain('--add-dir')
    const a = cliArgs({ ...req, files: ['/d/courses/x/work/w1/01-a.pdf', '/d/courses/x/work/w1/02-b.png'] }, cfg, 'f')
    expect(a[a.indexOf('--tools') + 1]).toBe('Read')
    expect(a.slice(a.indexOf('--add-dir'))).toEqual(['--add-dir', '/d/courses/x/work/w1'])
    expect(a).not.toContain('--allowedTools')
  })
})
