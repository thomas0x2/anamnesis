import { describe, expect, it } from 'vitest'
import {
  applyMapDelta,
  buildCourse,
  buildMapPrompt,
  chunkPages,
  emptyExtension,
  fakeMapOutput,
  inferKind,
  locatePage,
  mapSchema,
  metaToCourse,
  newMaterial,
  nextOffset,
  normalizeMapOutput,
  pageLabel,
  removeMaterial,
  titleFromFile
} from '../../src/shared/courseMap'
import { CourseGraph } from '../../src/shared/graph'
import { buildSystemPrompt, coreRules, CORE_RULES } from '../../src/shared/prompts'
import { buildAgentSystemPrompt } from '../../src/shared/agentTools'
import type { CourseMeta, Material } from '../../src/shared/types'
import { course as numcs, emptyLearner as freshLearner, makeSession } from './helpers'

const NOW = '2026-11-22T10:00:00.000Z'

const meta: CourseMeta = {
  id: 'spca',
  title: 'Systems Programming and Computer Architecture',
  short: 'SPCA',
  term: 'HS26',
  lecturer: '',
  courseNumber: '252-0061-00',
  institution: '',
  language: 'en',
  examFormat: 'Written exam: C code reading and writing, caches, virtual memory.',
  codeLanguage: 'C and x86-64 assembly',
  folder: null,
  autoAdd: true,
  createdAt: NOW
}

function material(id: string, numPages: number, offset: number | null, kind: Material['kind'] = 'slides'): Material {
  return { ...newMaterial({ path: `/x/${id}.pdf`, name: `${id}.pdf`, size: 10 }, id, NOW), kind, numPages, offset }
}

describe('materials', () => {
  it('guesses the kind of a PDF from its name and folder', () => {
    expect(inferKind('session3.pdf', 'Serie/session3.pdf')).toBe('exercises')
    expect(inferKind('04-Pointers.pdf')).toBe('slides')
    expect(inferKind('script-analysis-II.pdf')).toBe('script')
    expect(inferKind('lnNPIinf26.pdf')).toBe('script')
    expect(inferKind('Numerical Methods for CS(E) Mock Exam HS23.pdf', 'Mock exams/Numerical Methods for CS(E) Mock Exam HS23.pdf')).toBe('exam')
    expect(inferKind('serie3-loesung.pdf')).toBe('solutions')
    expect(inferKind('L2601-Introduction.pdf')).toBe('slides')
  })

  it('makes readable titles from file names', () => {
    expect(titleFromFile('04-Pointers.pdf')).toBe('04 Pointers')
    expect(titleFromFile('session3.pdf')).toBe('Session 3')
    expect(titleFromFile('02-IntroductionToC-handout.pdf')).toBe('02 Introduction To C')
  })

  it('gives each material its own block of app page numbers', () => {
    expect(nextOffset([])).toBe(0)
    const a = material('a', 68, 0)
    expect(nextOffset([a])).toBe(1000)
    const b = material('b', 1200, 1000)
    expect(nextOffset([a, b])).toBe(3000)
    expect(nextOffset([material('c', 0, null)])).toBe(0)
    expect(locatePage([a, b], 12)).toMatchObject({ local: 12 })
    expect(locatePage([a, b], 1012)?.material.id).toBe('b')
    expect(locatePage([a, b], 900)).toBeNull()
    expect(pageLabel([a, b], 1012)).toBe('B, p. 12')
    expect(pageLabel([{ ...a, printedOffset: -1 }], 56)).toBe('p. 55')
  })

  it('splits long materials into chunks by text size', () => {
    const pages = Array.from({ length: 10 }, () => 'x'.repeat(10_000))
    const chunks = chunkPages(pages, 25_000)
    expect(chunks[0]).toEqual([1, 4])
    expect(chunks[chunks.length - 1][1]).toBe(10)
    expect(chunkPages(['a', 'b'], 25_000)).toEqual([[1, 2]])
    expect(chunkPages([], 25_000)).toEqual([])
  })
})

describe('extending a course map', () => {
  const base = metaToCourse(meta)
  const slides = material('m1', 68, 0)

  it('normalises the answer: unique ids, known prerequisites, no cycles, app pages', () => {
    const raw = {
      note: 'Pointers',
      chapters: [{ number: 4, title: 'C pointers', de: 'C pointers' }],
      concepts: [
        { id: 'Address Space', title: 'Process address space', de: '', summary: 's', why: 'w', chapter: 4, requires: ['pointer-basics'], pages: [2, 3], refs: [], tier: 'core' },
        { id: 'pointer-basics', title: 'Pointers', de: '', summary: 's', why: 'w', chapter: 4, requires: ['address-space', 'ghost'], pages: [4, 99], refs: ['Slide 4'], tier: 'core' },
        { id: 'pointer-basics', title: 'Pointer arithmetic', de: '', summary: 's', why: 'w', chapter: 9, requires: ['pointer-basics'], pages: [], refs: [], tier: 'weird' },
        { id: 'x', title: '', summary: 'no title' }
      ],
      links: [{ conceptId: 'nope', pages: [1, 1], label: 'x' }],
      exercises: []
    }
    const d = normalizeMapOutput(raw, base, slides, NOW)
    expect(d.concepts.map((c) => c.id)).toEqual(['address-space', 'pointer-basics', 'pointer-basics-2'])
    const g = new CourseGraph({ ...base, chapters: d.chapters, concepts: d.concepts })
    // the cycle address-space ↔ pointer-basics is broken, unknown ids are dropped
    const reqs = d.concepts.flatMap((c) => c.requires.map((r) => `${c.id}<-${r}`))
    expect(reqs).not.toContain('pointer-basics<-ghost')
    expect(reqs.includes('address-space<-pointer-basics') && reqs.includes('pointer-basics<-address-space')).toBe(false)
    expect(g.ancestors('pointer-basics-2')).toContain('pointer-basics')
    // pages are clamped to the material and turned into app pages
    expect(d.concepts[1].pages).toEqual([4, 68])
    // a concept with an unknown chapter goes to a chapter named after the material
    expect(d.concepts[2].chapter).not.toBe(9)
    expect(d.chapters.some((c) => c.number === d.concepts[2].chapter)).toBe(true)
    expect(d.concepts[2].tier).toBe('core')
    expect(d.concepts.every((c) => c.material === 'm1' && c.addedAt === NOW)).toBe(true)
    expect(d.links).toHaveLength(0)
  })

  it('merges new concepts, links existing ones and records problem-set tasks', () => {
    const first = normalizeMapOutput(
      { note: null, chapters: [{ number: 1, title: 'Intro to C', de: 'Intro to C' }], concepts: [{ id: 'c-types', title: 'C types', de: '', summary: 's', why: 'w', chapter: 1, requires: [], pages: [1, 5], refs: [], tier: 'core' }], links: [], exercises: [] },
      base,
      slides,
      NOW
    )
    let out = applyMapDelta(emptyExtension(), base, first)
    expect(out.added).toEqual(['c-types'])
    let course = buildCourse(base, out.ext)
    expect(course.concepts.map((c) => c.id)).toEqual(['c-types'])
    // a later problem set practises it
    const sheet = material('m2', 12, 1000, 'exercises')
    const second = normalizeMapOutput({ note: null, chapters: [], concepts: [], links: [{ conceptId: 'c-types', pages: [3, 4], label: 'Recap' }], exercises: [{ label: 'Serie 1, Task 2', pages: [2, 3], conceptIds: ['c-types', 'nope'] }] }, course, sheet, NOW)
    out = applyMapDelta(out.ext, base, second)
    expect(out.linked).toEqual(['c-types'])
    course = buildCourse(base, out.ext)
    const c = course.concepts[0]
    expect(c.sources).toEqual([{ material: 'm2', pages: [1003, 1004], label: 'Recap' }])
    expect(c.exercises).toEqual([{ material: 'm2', pages: [1002, 1003], label: 'Serie 1, Task 2' }])
    // the same answer twice does not duplicate anything
    out = applyMapDelta(out.ext, base, second)
    expect(buildCourse(base, out.ext).concepts[0].exercises).toHaveLength(1)
    // removing the problem set takes its links away
    const removed = removeMaterial(out.ext, 'm2', () => false)
    expect(buildCourse(base, removed).concepts[0].exercises).toEqual([])
  })

  it('links a built-in course concept through a patch, without copying the concept', () => {
    const exam = material('mock', 20, 1000, 'exam')
    const d = normalizeMapOutput({ note: null, chapters: [], concepts: [], links: [], exercises: [{ label: 'Mock exam, Q3', pages: [5, 6], conceptIds: ['barycentric'] }] }, numcs, exam, NOW)
    const out = applyMapDelta(emptyExtension(), numcs, d)
    expect(out.ext.concepts).toHaveLength(0)
    expect(out.ext.patches.barycentric.exercises?.[0].pages).toEqual([1005, 1006])
    const merged = buildCourse(numcs, out.ext)
    expect(merged.concepts.length).toBe(numcs.concepts.length)
    expect(merged.concepts.find((c) => c.id === 'barycentric')?.exercises).toHaveLength(1)
  })

  it('keeps concepts the learner worked on, or that others build on, when their material is removed', () => {
    const d = normalizeMapOutput(
      {
        note: null,
        chapters: [{ number: 1, title: 'C', de: 'C' }],
        concepts: [
          { id: 'a', title: 'A', de: '', summary: '', why: '', chapter: 1, requires: [], pages: [1, 2], refs: [], tier: 'core' },
          { id: 'b', title: 'B', de: '', summary: '', why: '', chapter: 1, requires: [], pages: [3, 4], refs: [], tier: 'core' },
          { id: 'c', title: 'C', de: '', summary: '', why: '', chapter: 1, requires: [], pages: [5, 6], refs: [], tier: 'core' }
        ],
        links: [],
        exercises: []
      },
      base,
      slides,
      NOW
    )
    let ext = applyMapDelta(emptyExtension(), base, d).ext
    const other = material('m9', 10, 1000)
    const d2 = normalizeMapOutput({ note: null, chapters: [], concepts: [{ id: 'd', title: 'D', de: '', summary: '', why: '', chapter: 1, requires: ['b'], pages: [1, 1], refs: [], tier: 'core' }], links: [], exercises: [] }, buildCourse(base, ext), other, NOW)
    ext = applyMapDelta(ext, base, d2).ext
    const left = removeMaterial(ext, 'm1', (id) => id === 'a')
    expect(left.concepts.map((c) => c.id).sort()).toEqual(['a', 'b', 'd'])
  })

  it('builds a prompt with the current map and the page text, and a strict schema', () => {
    const course = buildCourse(base, emptyExtension())
    const p = buildMapPrompt({ course, material: slides, pages: [{ page: 1, text: 'Chapter 4: C Pointers' }], chunk: 1, chunks: 2, outline: ['Pointers'] })
    expect(p).toContain('none yet: this is the first material')
    expect(p).toContain('[page 1]\nChapter 4: C Pointers')
    expect(p).toContain('part 1 of 2')
    expect((mapSchema.required as string[]).sort()).toEqual(['chapters', 'concepts', 'exercises', 'links', 'note'])
  })

  it('has a deterministic stand-in for the demo tutor', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, text: `Slide title ${i + 1}\nbody` }))
    const raw = fakeMapOutput(slides, pages, base)
    const d = normalizeMapOutput(raw, base, slides, NOW)
    expect(d.concepts.length).toBe(2)
    expect(d.concepts[1].requires).toEqual([d.concepts[0].id])
  })
})

describe('prompts for a course the learner created', () => {
  const ext = applyMapDelta(
    emptyExtension(),
    metaToCourse(meta),
    normalizeMapOutput(
      { note: null, chapters: [{ number: 4, title: 'Pointers', de: 'Pointers' }], concepts: [{ id: 'pointer-basics', title: 'Pointers', de: '', summary: 'A pointer holds an address.', why: 'w', chapter: 4, requires: [], pages: [4, 6], refs: [], tier: 'core' }], links: [], exercises: [] },
      metaToCourse(meta),
      material('m1', 68, 0),
      NOW
    )
  ).ext
  const course = buildCourse(metaToCourse(meta), ext)
  const graph = new CourseGraph(course)

  it('keeps the built-in course rules unchanged', () => {
    expect(coreRules(numcs)).toBe(CORE_RULES)
  })

  it('names the course and drops the built-in course specifics', () => {
    const r = coreRules(course)
    expect(r.startsWith('You are Anamnesis, a one-to-one tutor for the course "Systems Programming and Computer Architecture" (252-0061-00)')).toBe(true)
    for (const word of ['NumCS', 'Gradinaru', 'numpy', 'German term']) expect(r).not.toContain(word)
    expect(r).toContain('C and x86-64 assembly code completion')
    expect(r).toContain('Written exam: C code reading and writing')
    expect(r).toContain('# How you teach')
    expect(r).toContain('# Output')
  })

  it('asks for the materials’ own terms when they are not in English', () => {
    const de = buildCourse(metaToCourse({ ...meta, language: 'de' }), ext)
    expect(coreRules(de)).toContain("give the materials' German term once in parentheses")
  })

  it('uses the course in the session and agent prompts', () => {
    const s = makeSession({ type: 'learn', goalConceptId: 'pointer-basics', scope: ['pointer-basics'] })
    const sys = buildSystemPrompt(course, graph, s, [{ page: 4, text: 'pointers', label: '04 Pointers, p. 4' }])
    expect(sys).toContain('[page 4 · 04 Pointers, p. 4]')
    expect(sys).not.toContain('The author permits this use')
    const agent = buildAgentSystemPrompt(course, graph, freshLearner(), { mode: 'learn', goalConceptId: 'pointer-basics', scope: [] }, new Date(NOW))
    expect(agent).toContain('tutor for the course "Systems Programming and Computer Architecture"')
    expect(agent).not.toContain('ETH Zurich course "Numerical')
    expect(agent).toContain('pages: pp. 4-6')
  })
})
