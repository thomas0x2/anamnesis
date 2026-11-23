// Courses built from the learner's own materials: material bookkeeping (kinds, titles, app page
// numbers), the prompt and schema that extend a course map from a new PDF, and merging the result.
// Pure logic, shared by the renderer and the tests.
import type {
  ConceptSource,
  ConceptTier,
  Course,
  CourseChapter,
  CourseConcept,
  CourseExtension,
  CourseMeta,
  Material,
  MaterialKind
} from './types'
import { truncate } from './util'

// ---------------------------------------------------------------- materials
export const KIND_LABEL: Record<MaterialKind, string> = {
  script: 'Script',
  slides: 'Slides',
  exercises: 'Problem set',
  solutions: 'Solutions',
  exam: 'Exam',
  notes: 'Notes'
}

/** Guess what a PDF is from its name and folder ("Serie/session3.pdf" is a problem set). */
export function inferKind(name: string, rel = name): MaterialKind {
  const s = rel.toLowerCase().replace(/\\/g, '/')
  const base = name.toLowerCase()
  if (/(l(ö|oe)sung|solution|musterl|sol\b|-sol|_sol)/.test(s)) return 'solutions'
  if (/(exam|pr(ü|ue)fung|mock|midterm|mid-term|klausur)/.test(s)) return 'exam'
  if (/(serie|exercise|übung|uebung|uebungs|übungs|problem.?set|assignment|sheet|blatt|homework|hw\d|session)/.test(s)) return 'exercises'
  if (/(skript|script|lecture.?notes|vorlesungsnotizen|\bln|notes)/.test(base)) return 'script'
  if (/(summary|zusammenfassung|cheat|guide)/.test(s)) return 'notes'
  return 'slides'
}

/** "04-Pointers.pdf" → "04 Pointers", "session3.pdf" → "Session 3". */
export function titleFromFile(name: string): string {
  let t = name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/-(handout|slides|print|annotated)$/i, '')
  t = t.replace(/([a-zA-Z])(\d+)$/, '$1 $2').replace(/\s*-\s*/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  t = t.replace(/\s+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : name
}

export function newMaterial(file: { path: string | null; name: string; rel?: string; size: number; mtimeMs?: number | null }, id: string, now: string): Material {
  return {
    id,
    kind: inferKind(file.name, file.rel ?? file.name),
    title: titleFromFile(file.name),
    fileName: file.name,
    path: file.path,
    size: file.size,
    mtimeMs: file.mtimeMs ?? null,
    numPages: 0,
    offset: null,
    printedOffset: 0,
    addedAt: now,
    status: 'queued',
    chunksDone: 0,
    chunksTotal: 0,
    error: null,
    mappedAt: null,
    added: [],
    linked: []
  }
}

/** App page numbers are offset + PDF page. Each material starts at the next multiple of 1000, so numbers stay stable and readable. */
export function nextOffset(items: Material[]): number {
  const placed = items.filter((m) => m.offset !== null)
  if (!placed.length) return 0
  const end = Math.max(...placed.map((m) => (m.offset ?? 0) + Math.max(1, m.numPages)))
  return Math.ceil(end / 1000) * 1000
}

export function locatePage(items: Material[], page: number): { material: Material; local: number } | null {
  for (const m of items) {
    if (m.offset === null || !m.numPages) continue
    const local = page - m.offset
    if (local >= 1 && local <= m.numPages) return { material: m, local }
  }
  return null
}

/** How a page is shown to the learner and the tutor: "Pointers, p. 12" (printed numbers where known). */
export function pageLabel(items: Material[], page: number, single = items.length <= 1): string {
  const at = locatePage(items, page)
  if (!at) return `p. ${page}`
  const printed = at.local + at.material.printedOffset
  return single ? `p. ${printed}` : `${at.material.title}, p. ${printed}`
}

/** Split a material's pages into chunks of at most `budget` characters (local page numbers, 1-based). */
export function chunkPages(texts: string[], budget = 45_000): number[][] {
  const out: number[][] = []
  let start = 1
  let size = 0
  for (let i = 0; i < texts.length; i++) {
    const n = Math.min(texts[i].length, 6000) + 20
    if (size > 0 && size + n > budget) {
      out.push([start, i])
      start = i + 1
      size = 0
    }
    size += n
  }
  if (texts.length) out.push([start, texts.length])
  return out
}

// ---------------------------------------------------------------- courses
export function emptyExtension(): CourseExtension {
  return { version: 1, chapters: [], concepts: [], patches: {} }
}

export const LANGUAGES: Record<string, string> = { en: 'English', de: 'German', fr: 'French', it: 'Italian' }

export function metaToCourse(m: CourseMeta): Course {
  return {
    id: m.id,
    version: 1,
    title: m.title,
    short: m.short || m.title,
    term: m.term,
    lecturer: m.lecturer,
    courseNumber: m.courseNumber,
    institution: m.institution,
    language: m.language,
    script: { title: 'Course materials', fileName: '', language: m.language, printedPageOffset: 0, note: '' },
    exam: { format: m.examFormat, codeLanguage: m.codeLanguage },
    chapters: [],
    concepts: []
  }
}

/** The course as the app uses it: the base course plus everything added from materials. */
export function buildCourse(base: Course, ext: CourseExtension | null): Course {
  if (!ext) return base
  const ids = new Set(base.concepts.map((c) => c.id))
  const concepts = base.concepts.map((c) => {
    const p = ext.patches[c.id]
    if (!p) return c
    return { ...c, sources: [...(c.sources ?? []), ...(p.sources ?? [])], exercises: [...(c.exercises ?? []), ...(p.exercises ?? [])] }
  })
  for (const c of ext.concepts) if (!ids.has(c.id)) concepts.push(c)
  const numbers = new Set(base.chapters.map((c) => c.number))
  const chapters = [...base.chapters, ...ext.chapters.filter((c) => !numbers.has(c.number))].sort((a, b) => a.number - b.number)
  return { ...base, chapters, concepts }
}

// ---------------------------------------------------------------- the mapping call
export const MAP_SYSTEM = String.raw`You maintain the concept map of a university course inside a learning app. A tutor uses the map to plan lessons, to find prerequisites and to schedule practice, so the map must be accurate, fine-grained and connected.

You get the current map (chapters and concepts) and the text of some pages of a new course material (a script, lecture slides, a problem set, solutions or an exam), extracted from the learner's own PDF. Extend the map with what these pages add.

# Concepts
- A concept is one idea, definition, theorem, technique or skill that can be taught in 5-15 minutes and tested with a question. Not a whole lecture, not a single fact.
- id: short kebab-case English, unique (e.g. "pointer-arithmetic", "taylor-two-vars"). Never reuse an id from the map for a different idea.
- title: English. de: the term as the material names it, in the material's language (same as the title for English material).
- summary: one sentence stating the idea precisely (the claim, not "this section discusses"). why: one sentence on what it is needed for or what problem it solves.
- requires: the direct prerequisites only (ids from the map or new ids in your answer). A concept never requires a concept that the course introduces later unless it truly depends on it. Keep the graph acyclic.
- chapter: the number of an existing chapter, or of a new chapter in your "chapters" list. For slides, one chapter per lecture or topic; for a script, its own chapters.
- pages: [first, last] page numbers of THIS material as given in the excerpt headers, where the concept is treated.
- refs: labels the material uses for it ("Theorem 4.7.6", "Def. 2.1", "Slide: Pointer arithmetic"), possibly empty.
- tier: "core" for the material the course is about, "support" for refreshers from earlier courses that this course relies on (put those in chapter 0 "Foundations"), "extra" for optional digressions.
- Prefer 3-12 new concepts per 10 pages of dense material; slides are usually less dense than a script.

# Existing concepts
If the pages treat a concept already in the map, do not add a duplicate: add an entry to "links" (conceptId, pages, label) instead. Add a new concept only for genuinely new ideas.

# Problem sets, solutions and exams
These mainly practise what the map already has. List each task or sub-task in "exercises" (label like "Serie 3, Task 2b", pages, conceptIds it practises, 1-3 ids). Add a concept only when a task needs an idea that is not in the map yet.

# Output
Exactly one JSON object matching the schema. "note": one sentence on what this material covers. If the pages contain nothing to map (a title page, logistics, an index), return empty lists.`

const nstr = { type: ['string', 'null'] }
const pagesSchema = { type: 'array', items: { type: 'integer' }, description: '[first, last] page numbers of this material' }

export const mapSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['note', 'chapters', 'concepts', 'links', 'exercises'],
  properties: {
    note: nstr,
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'title', 'de'],
        properties: { number: { type: 'integer' }, title: { type: 'string' }, de: { type: 'string' } }
      }
    },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'de', 'summary', 'why', 'chapter', 'requires', 'pages', 'refs', 'tier'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          de: { type: 'string' },
          summary: { type: 'string' },
          why: { type: 'string' },
          chapter: { type: 'integer' },
          requires: { type: 'array', items: { type: 'string' } },
          pages: pagesSchema,
          refs: { type: 'array', items: { type: 'string' } },
          tier: { type: 'string', enum: ['core', 'support', 'extra'] }
        }
      }
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['conceptId', 'pages', 'label'],
        properties: { conceptId: { type: 'string' }, pages: pagesSchema, label: { type: 'string' } }
      }
    },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'pages', 'conceptIds'],
        properties: { label: { type: 'string' }, pages: pagesSchema, conceptIds: { type: 'array', items: { type: 'string' } } }
      }
    }
  }
}

export interface MapPromptInput {
  course: Course
  material: Material
  /** local page numbers with their text */
  pages: { page: number; text: string }[]
  chunk: number
  chunks: number
  outline: string[]
}

export function buildMapPrompt(x: MapPromptInput): string {
  const { course, material } = x
  const out: string[] = []
  out.push(
    `# Course\n${course.title}${course.courseNumber ? ` (${course.courseNumber})` : ''}${course.lecturer ? `, ${course.lecturer}` : ''}${course.term ? `, ${course.term}` : ''}. Materials language: ${LANGUAGES[course.language ?? ''] ?? course.language ?? 'unknown'}.`
  )
  out.push('', '# Chapters in the map')
  out.push(course.chapters.length ? course.chapters.map((c) => `- ${c.number}: ${c.title}${c.de && c.de !== c.title ? ` (${c.de})` : ''}`).join('\n') : '(none yet: define them)')
  out.push('', `# Concepts in the map (${course.concepts.length})`)
  if (!course.concepts.length) out.push('(none yet: this is the first material)')
  for (const c of course.concepts.slice(0, 400)) out.push(`- ${c.id} [ch ${c.chapter}] ${c.title}${c.requires.length ? ` ← ${c.requires.join(', ')}` : ''}`)
  out.push(
    '',
    `# New material: ${KIND_LABEL[material.kind]} "${material.title}" (${material.fileName}, ${material.numPages} pages)`,
    x.chunks > 1 ? `This is part ${x.chunk} of ${x.chunks}: pages ${x.pages[0]?.page}-${x.pages[x.pages.length - 1]?.page}. Earlier parts are already in the map above.` : ''
  )
  if (x.outline.length) out.push('', 'Outline of the PDF:', ...x.outline.slice(0, 80).map((o) => `- ${o}`))
  out.push('', 'Text extracted from the PDF (formulas may be garbled; rely on your own knowledge of the subject for the content, and on the text for structure, terms and labels):')
  for (const p of x.pages) out.push(`\n[page ${p.page}]\n${p.text.trim().slice(0, 6000)}`)
  return out.filter((l) => l !== '').join('\n')
}

// ---------------------------------------------------------------- normalising the answer
export interface MapDelta {
  note: string | null
  chapters: CourseChapter[]
  concepts: CourseConcept[]
  links: { conceptId: string; source: ConceptSource }[]
  exercises: { conceptIds: string[]; source: ConceptSource }[]
}

export function slug(s: string): string {
  return (
    String(s)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'concept'
  )
}

const str = (v: unknown, n = 400): string => truncate(typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v), n)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function pagesOf(v: unknown, m: Material): number[] {
  const nums = arr(v)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.round(n))
  if (!nums.length || m.offset === null) return []
  const max = Math.max(1, m.numPages)
  const a = Math.min(max, Math.max(1, nums[0]))
  const b = Math.min(max, Math.max(a, nums[1] ?? nums[0]))
  return [m.offset + a, m.offset + b]
}

/** Make the model's answer safe to merge: unique ids, known references, no cycles, pages turned into app pages. */
export function normalizeMapOutput(raw: unknown, course: Course, material: Material, now: string): MapDelta {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const existing = new Set(course.concepts.map((c) => c.id))
  const chapterNums = new Set(course.chapters.map((c) => c.number))
  const chapters: CourseChapter[] = []
  for (const c of arr(o.chapters)) {
    const r = (c ?? {}) as Record<string, unknown>
    const number = Math.round(Number(r.number))
    if (!Number.isFinite(number) || number < 0 || chapterNums.has(number)) continue
    const title = str(r.title, 120)
    if (!title) continue
    chapterNums.add(number)
    chapters.push({ number, title, de: str(r.de, 120) || title, pages: [] })
  }
  // new concepts: ids made unique, renamed ids remembered so requires can follow
  const rename = new Map<string, string>()
  const taken = new Set(existing)
  const drafts: (CourseConcept & { rawRequires: string[] })[] = []
  for (const c of arr(o.concepts)) {
    const r = (c ?? {}) as Record<string, unknown>
    const title = str(r.title, 140)
    if (!title) continue
    const rawId = str(r.id, 80) || title
    let id = slug(rawId)
    if (taken.has(id)) {
      let k = 2
      while (taken.has(`${id}-${k}`)) k++
      id = `${id}-${k}`
    }
    taken.add(id)
    // the first concept with a given id keeps it: later duplicates are renamed, references mean the first
    if (!rename.has(rawId)) rename.set(rawId, id)
    if (!rename.has(slug(rawId))) rename.set(slug(rawId), id)
    let chapter = Math.round(Number(r.chapter))
    if (!Number.isFinite(chapter) || !chapterNums.has(chapter)) chapter = chapterNums.has(0) && r.tier === 'support' ? 0 : -1
    const tier: ConceptTier = r.tier === 'support' || r.tier === 'extra' ? r.tier : 'core'
    drafts.push({
      id,
      chapter,
      title,
      de: str(r.de, 140) || title,
      summary: str(r.summary, 400),
      why: str(r.why, 300),
      requires: [],
      rawRequires: arr(r.requires).map((x) => str(x, 80)),
      pages: pagesOf(r.pages, material),
      refs: arr(r.refs).map((x) => str(x, 60)).filter(Boolean).slice(0, 6),
      demos: [],
      tier,
      addedAt: now,
      material: material.id
    })
  }
  // concepts without a valid chapter go to a chapter named after the material
  if (drafts.some((d) => d.chapter === -1)) {
    const number = Math.max(0, ...chapterNums) + 1
    chapterNums.add(number)
    chapters.push({ number, title: material.title, de: material.title, pages: [] })
    for (const d of drafts) if (d.chapter === -1) d.chapter = number
  }
  const known = (id: string): string | null => {
    const r = rename.get(id) ?? rename.get(slug(id)) ?? id
    return existing.has(r) || drafts.some((d) => d.id === r) ? r : null
  }
  for (const d of drafts) d.requires = [...new Set(d.rawRequires.map(known).filter((x): x is string => !!x && x !== d.id))]
  // break cycles among the new concepts (existing ones can not depend on them)
  const byId = new Map(drafts.map((d) => [d.id, d]))
  const state = new Map<string, number>()
  const visit = (id: string): void => {
    state.set(id, 1)
    const d = byId.get(id)!
    d.requires = d.requires.filter((r) => {
      if (!byId.has(r)) return true
      if (state.get(r) === 1) return false
      if (!state.get(r)) visit(r)
      return true
    })
    state.set(id, 2)
  }
  for (const d of drafts) if (!state.get(d.id)) visit(d.id)
  const concepts: CourseConcept[] = drafts.map(({ rawRequires: _r, ...c }) => c)

  const links: MapDelta['links'] = []
  for (const l of arr(o.links)) {
    const r = (l ?? {}) as Record<string, unknown>
    const id = known(str(r.conceptId, 80))
    const pages = pagesOf(r.pages, material)
    if (!id || !pages.length || concepts.some((c) => c.id === id)) continue
    links.push({ conceptId: id, source: { material: material.id, pages, label: str(r.label, 80) || material.title } })
  }
  const exercises: MapDelta['exercises'] = []
  for (const e of arr(o.exercises)) {
    const r = (e ?? {}) as Record<string, unknown>
    const ids = [...new Set(arr(r.conceptIds).map((x) => known(str(x, 80))).filter((x): x is string => !!x))].slice(0, 3)
    const pages = pagesOf(r.pages, material)
    if (!ids.length || !pages.length) continue
    exercises.push({ conceptIds: ids, source: { material: material.id, pages, label: str(r.label, 80) || material.title } })
  }
  return { note: str(o.note, 300) || null, chapters, concepts, links, exercises }
}

/** Merge a normalised answer into the course extension. Returns the new extension and what changed. */
export function applyMapDelta(ext: CourseExtension, base: Course, delta: MapDelta): { ext: CourseExtension; added: string[]; linked: string[] } {
  const baseIds = new Set(base.concepts.map((c) => c.id))
  const next: CourseExtension = {
    version: 1,
    chapters: [...ext.chapters, ...delta.chapters.filter((c) => !ext.chapters.some((x) => x.number === c.number) && !base.chapters.some((x) => x.number === c.number))],
    concepts: [...ext.concepts, ...delta.concepts.filter((c) => !baseIds.has(c.id) && !ext.concepts.some((x) => x.id === c.id))],
    patches: { ...ext.patches }
  }
  const linked = new Set<string>()
  const addTo = (id: string, field: 'sources' | 'exercises', src: ConceptSource): void => {
    const same = (x: ConceptSource): boolean => x.material === src.material && x.pages[0] === src.pages[0] && x.label === src.label
    if (baseIds.has(id)) {
      const p = { ...(next.patches[id] ?? {}) }
      const list = p[field] ?? []
      if (!list.some(same)) p[field] = [...list, src].slice(-24)
      next.patches[id] = p
    } else {
      next.concepts = next.concepts.map((c) => (c.id === id && !(c[field] ?? []).some(same) ? { ...c, [field]: [...(c[field] ?? []), src].slice(-24) } : c))
    }
    linked.add(id)
  }
  for (const l of delta.links) addTo(l.conceptId, 'sources', l.source)
  for (const e of delta.exercises) for (const id of e.conceptIds) addTo(id, 'exercises', e.source)
  return { ext: next, added: delta.concepts.map((c) => c.id).filter((id) => next.concepts.some((c) => c.id === id)), linked: [...linked] }
}

/**
 * Take a material out of the extension: its links and exercises go, and so do the concepts it
 * introduced, unless the learner already has evidence on them or other concepts build on them.
 */
export function removeMaterial(ext: CourseExtension, materialId: string, keep: (conceptId: string) => boolean): CourseExtension {
  const strip = (list: ConceptSource[] | undefined): ConceptSource[] | undefined => list?.filter((s) => s.material !== materialId)
  let concepts = ext.concepts.map((c) => ({ ...c, sources: strip(c.sources), exercises: strip(c.exercises) }))
  for (;;) {
    const required = new Set(concepts.flatMap((c) => c.requires))
    const drop = concepts.filter((c) => c.material === materialId && !keep(c.id) && !required.has(c.id))
    if (!drop.length) break
    const ids = new Set(drop.map((c) => c.id))
    concepts = concepts.filter((c) => !ids.has(c.id))
  }
  const patches: CourseExtension['patches'] = {}
  for (const [id, p] of Object.entries(ext.patches)) {
    const q = { sources: strip(p.sources), exercises: strip(p.exercises) }
    if (q.sources?.length || q.exercises?.length) patches[id] = q
  }
  const used = new Set(concepts.map((c) => c.chapter))
  const chapters = ext.chapters.filter((c) => used.has(c.number))
  return { version: 1, chapters, concepts, patches }
}

/** All page ranges of a concept: its main range first, then other sources. */
export function conceptRanges(c: CourseConcept): number[][] {
  const out: number[][] = []
  if (c.pages.length >= 2) out.push(c.pages)
  for (const s of c.sources ?? []) if (s.pages.length >= 2) out.push(s.pages)
  return out
}

/** A deterministic stand-in for the mapping call (demo tutor and tests): one concept per few pages. */
export function fakeMapOutput(material: Material, pages: { page: number; text: string }[], course: Course): unknown {
  const firstLine = (t: string): string =>
    t
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 3 && /[a-zA-Z]/.test(l) && !/^\d+$/.test(l)) ?? ''
  const step = material.kind === 'script' ? 4 : 6
  const concepts: unknown[] = []
  const exercises: unknown[] = []
  let prev: string | null = course.concepts.length ? course.concepts[course.concepts.length - 1].id : null
  const chapter = Math.max(0, ...course.chapters.map((c) => c.number)) + 1
  for (let i = 0; i < pages.length; i += step) {
    const p = pages[i]
    const title = truncate(firstLine(p.text) || `${material.title} part ${i / step + 1}`, 60)
    if (material.kind === 'exercises' || material.kind === 'solutions' || material.kind === 'exam') {
      if (course.concepts.length) exercises.push({ label: `${material.title}, page ${p.page}`, pages: [p.page, p.page], conceptIds: [course.concepts[(i / step) % course.concepts.length].id] })
      continue
    }
    const id = slug(`${material.title}-${title}`)
    concepts.push({
      id,
      title,
      de: title,
      summary: `What ${material.title} says on page ${p.page}.`,
      why: 'Placeholder from the demo tutor.',
      chapter,
      requires: prev ? [prev] : [],
      pages: [p.page, Math.min(pages[pages.length - 1].page, p.page + step - 1)],
      refs: [],
      tier: 'core'
    })
    prev = id
  }
  return {
    note: `Demo map of ${material.title}.`,
    chapters: concepts.length ? [{ number: chapter, title: material.title, de: material.title }] : [],
    concepts,
    links: [],
    exercises
  }
}
