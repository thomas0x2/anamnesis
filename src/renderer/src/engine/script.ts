// A course's materials (script, slides, problem sets): the PDFs are read from the learner's disk,
// their text is extracted once with pdf.js and cached in the app's data folder (never shipped,
// never committed). Every page has an app page number (material offset + PDF page), so one number
// names a page across all materials of the course.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { locatePage, pageLabel } from '@shared/courseMap'
import { findLabels, itemsToText, type LabelHit, type TextItemLike } from '@shared/pdfText'
import type { ScriptPage } from '@shared/prompts'
import type { Backend, Material } from '@shared/types'
import { createStore } from './store'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDoc = pdfjs.PDFDocumentProxy

export interface ScriptStatus {
  state: 'none' | 'loading' | 'indexing' | 'ready' | 'error'
  progress: number
  /** the highest app page number */
  numPages: number
  message: string | null
}

interface CachedIndex {
  version: 1
  size: number
  numPages: number
  pages: string[]
  /** local page numbers */
  labels: LabelHit[]
  outline?: string[]
}

interface Loaded {
  material: Material
  pages: string[]
  labels: LabelHit[]
  outline: string[]
}

export interface IndexResult {
  numPages: number
  pages: string[]
  outline: string[]
}

export class MaterialLibrary {
  readonly status = createStore<ScriptStatus>({ state: 'none', progress: 0, numPages: 0, message: null })
  private loaded = new Map<string, Loaded>()
  private docs = new Map<string, Promise<PdfDoc>>()
  private tasks = new Map<string, pdfjs.PDFDocumentLoadingTask>()
  private items: Material[] = []
  labels: LabelHit[] = []

  constructor(
    private backend: Backend,
    readonly courseId: string,
    /** the built-in course's script keeps its old cache name */
    private legacyScript = false
  ) {}

  get ready(): boolean {
    return this.status.get().state === 'ready'
  }

  materials(): Material[] {
    return this.items
  }

  private cacheName(id: string): string {
    return this.legacyScript && id === 'script' ? 'script-index' : `courses/${this.courseId}/text/${id}`
  }

  /** Load the cached text of every material that has been read. Materials without a cache are left to `index`. */
  async load(items: Material[]): Promise<void> {
    this.items = items
    const placed = items.filter((m) => m.offset !== null && m.numPages > 0)
    if (!placed.length) {
      this.loaded.clear()
      this.labels = []
      this.status.set({ state: 'none', progress: 0, numPages: 0, message: null })
      return
    }
    if (!this.ready) this.status.set({ state: 'loading', progress: 0, numPages: 0, message: null })
    for (const m of placed) {
      const have = this.loaded.get(m.id)
      if (have && have.material.size === m.size) {
        have.material = m
        continue
      }
      const cached = await this.backend.readJson<CachedIndex>(this.cacheName(m.id))
      if (cached && cached.version === 1 && cached.numPages === m.numPages) this.loaded.set(m.id, { material: m, pages: cached.pages, labels: cached.labels, outline: cached.outline ?? [] })
    }
    for (const id of [...this.loaded.keys()]) if (!placed.some((m) => m.id === id)) this.loaded.delete(id)
    this.refresh()
  }

  private refresh(): void {
    const labels: LabelHit[] = []
    let max = 0
    for (const l of this.loaded.values()) {
      const off = l.material.offset ?? 0
      for (const h of l.labels) labels.push({ ...h, page: h.page + off })
      max = Math.max(max, off + l.material.numPages)
    }
    this.labels = labels
    this.status.set(this.loaded.size ? { state: 'ready', progress: 1, numPages: max, message: null } : { state: 'none', progress: 0, numPages: 0, message: null })
  }

  /** The PDF of a material, opened once (a few stay open). */
  doc(m: Material): Promise<PdfDoc> {
    let p = this.docs.get(m.id)
    if (!p) {
      p = (async () => {
        const bytes = await this.backend.readMaterial(this.courseId, m.id)
        if (!bytes) throw new Error(`${m.fileName} could not be read. Is the file still at ${m.path ?? 'its place'}?`)
        const asset = (path: string): string => new URL(path, document.baseURI).href
        const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: asset('pdfjs/standard_fonts/'), wasmUrl: asset('pdfjs/wasm/'), iccUrl: asset('pdfjs/iccs/') })
        this.tasks.set(m.id, task)
        return task.promise
      })()
      p.catch(() => this.docs.delete(m.id))
      this.docs.set(m.id, p)
      if (this.docs.size > 3) {
        const [old] = this.docs.keys()
        const d = this.docs.get(old)
        this.docs.delete(old)
        void d?.catch(() => {})
        void this.tasks.get(old)?.destroy()
        this.tasks.delete(old)
      }
    }
    return p
  }

  /** Read a material's text once (pdf.js) and cache it. `offset` is the material's app page offset. */
  async index(m: Material, onProgress?: (f: number) => void): Promise<IndexResult> {
    const doc = await this.doc(m)
    const numPages = doc.numPages
    const pages: string[] = []
    const labels: LabelHit[] = []
    for (let p = 1; p <= numPages; p++) {
      try {
        const page = await doc.getPage(p)
        const tc = await page.getTextContent()
        const text = itemsToText(tc.items as unknown as TextItemLike[])
        pages.push(text)
        labels.push(...findLabels(p, text))
      } catch {
        pages.push('')
      }
      if (p % 8 === 0 || p === numPages) onProgress?.(p / numPages)
    }
    let outline: string[] = []
    try {
      const o = (await doc.getOutline()) ?? []
      const walk = (items: { title: string; items?: unknown[] }[], depth: number): void => {
        for (const it of items) {
          if (outline.length >= 120) return
          outline.push(`${'  '.repeat(depth)}${it.title}`)
          if (depth < 1 && Array.isArray(it.items)) walk(it.items as { title: string; items?: unknown[] }[], depth + 1)
        }
      }
      walk(o as { title: string; items?: unknown[] }[], 0)
    } catch {
      outline = []
    }
    await this.backend.writeJson(this.cacheName(m.id), { version: 1, size: m.size, numPages, pages, labels, outline } satisfies CachedIndex)
    if (m.offset !== null) {
      this.loaded.set(m.id, { material: { ...m, numPages }, pages, labels, outline })
      this.items = this.items.map((x) => (x.id === m.id ? { ...x, numPages } : x))
      this.refresh()
    }
    return { numPages, pages, outline }
  }

  /** Text and outline of a material (local pages), from the cache. */
  materialText(id: string): { pages: string[]; outline: string[] } | null {
    const l = this.loaded.get(id)
    return l ? { pages: l.pages, outline: l.outline } : null
  }

  forget(id: string): void {
    this.loaded.delete(id)
    this.docs.delete(id)
    void this.tasks.get(id)?.destroy()
    this.tasks.delete(id)
    this.items = this.items.filter((m) => m.id !== id)
    this.refresh()
  }

  locate(page: number): { material: Material; local: number } | null {
    return locatePage(this.items, page)
  }

  /** "p. 56" for a course with one material, "Pointers, p. 12" otherwise. */
  label(page: number): string {
    return pageLabel(this.items.filter((m) => m.offset !== null), page)
  }

  /** The first and last app page of a material. */
  span(m: Material): number[] {
    return m.offset === null ? [] : [m.offset + 1, m.offset + Math.max(1, m.numPages)]
  }

  /** The previous or next page that exists (pages of different materials are not contiguous). */
  step(page: number, dir: 1 | -1): number {
    const at = this.locate(page)
    if (at) {
      const local = at.local + dir
      if (local >= 1 && local <= at.material.numPages) return page + dir
    }
    const placed = this.items.filter((m) => m.offset !== null && m.numPages > 0).sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
    if (dir > 0) {
      const next = placed.find((m) => (m.offset ?? 0) + 1 > page)
      return next ? (next.offset ?? 0) + 1 : page
    }
    const prev = [...placed].reverse().find((m) => (m.offset ?? 0) + m.numPages < page)
    return prev ? (prev.offset ?? 0) + prev.numPages : page
  }

  firstPage(): number {
    const placed = this.items.filter((m) => m.offset !== null && m.numPages > 0).sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
    return placed.length ? (placed[0].offset ?? 0) + 1 : 1
  }

  pageText(p: number): string {
    const at = this.locate(p)
    if (!at) return ''
    return this.loaded.get(at.material.id)?.pages[at.local - 1] ?? ''
  }

  /** Text of pages [a..b], at most `max` pages, skipping empty ones. */
  range(pages: number[], max: number): ScriptPage[] {
    if (!this.ready || pages.length < 2) return []
    const out: ScriptPage[] = []
    for (let p = pages[0]; p <= pages[1] && out.length < max; p++) {
      const text = this.pageText(p)
      if (text.trim()) out.push({ page: p, text: text.slice(0, 6000), label: this.label(p) })
    }
    return out
  }

  search(q: string, limit = 30): { page: number; title: string; snippet: string }[] {
    const query = q.trim().toLowerCase()
    if (!query) return []
    const num = /(\d+\.\d+(?:\.\d+)?)/.exec(query)?.[1]
    const out: { page: number; title: string; snippet: string }[] = []
    if (num) for (const l of this.labels) if (l.label === num || l.label.startsWith(num + '.')) out.push({ page: l.page, title: `${l.kind} ${l.label}`, snippet: l.snippet })
    if (out.length < limit && query.length >= 3) {
      const placed = [...this.loaded.values()].sort((a, b) => (a.material.offset ?? 0) - (b.material.offset ?? 0))
      for (const l of placed) {
        for (let i = 0; i < l.pages.length && out.length < limit; i++) {
          const t = l.pages[i]
          const k = t.toLowerCase().indexOf(query)
          const page = (l.material.offset ?? 0) + i + 1
          if (k >= 0) out.push({ page, title: this.label(page), snippet: t.slice(Math.max(0, k - 40), k + 80).replace(/\n/g, ' ') })
        }
      }
    }
    return out.slice(0, limit)
  }
}
