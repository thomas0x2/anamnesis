// The lecture-notes PDF: loaded from the learner's disk, text extracted once with pdf.js and cached
// in the app's data folder (never shipped, never committed).
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { findLabels, itemsToText, type LabelHit, type TextItemLike } from '@shared/pdfText'
import type { ScriptPage } from '@shared/prompts'
import type { Backend } from '@shared/types'
import { createStore } from './store'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDoc = pdfjs.PDFDocumentProxy

export interface ScriptStatus {
  state: 'none' | 'loading' | 'indexing' | 'ready' | 'error'
  progress: number
  numPages: number
  message: string | null
}

interface CachedIndex {
  version: 1
  size: number
  numPages: number
  pages: string[]
  labels: LabelHit[]
}

export class ScriptIndex {
  readonly status = createStore<ScriptStatus>({ state: 'none', progress: 0, numPages: 0, message: null })
  private doc: PdfDoc | null = null
  private pages: string[] = []
  labels: LabelHit[] = []

  constructor(private backend: Backend) {}

  get ready(): boolean {
    return this.status.get().state === 'ready'
  }

  async load(force = false): Promise<void> {
    this.status.set({ state: 'loading', progress: 0, numPages: 0, message: null })
    let bytes: Uint8Array | null = null
    try {
      bytes = await this.backend.readScript()
    } catch (e) {
      this.status.set({ state: 'error', progress: 0, numPages: 0, message: String(e) })
      return
    }
    if (!bytes) {
      this.doc = null
      this.status.set({ state: 'none', progress: 0, numPages: 0, message: null })
      return
    }
    try {
      const asset = (path: string): string => new URL(path, document.baseURI).href
      this.doc = await pdfjs.getDocument({
        data: bytes.slice(),
        standardFontDataUrl: asset('pdfjs/standard_fonts/'),
        wasmUrl: asset('pdfjs/wasm/'),
        iccUrl: asset('pdfjs/iccs/')
      }).promise
    } catch (e) {
      this.status.set({ state: 'error', progress: 0, numPages: 0, message: `Could not open the PDF: ${String(e)}` })
      return
    }
    const numPages = this.doc.numPages
    const cached = force ? null : await this.backend.readJson<CachedIndex>('script-index')
    if (cached && cached.version === 1 && cached.size === bytes.byteLength && cached.numPages === numPages) {
      this.pages = cached.pages
      this.labels = cached.labels
      this.status.set({ state: 'ready', progress: 1, numPages, message: null })
      return
    }
    this.status.set({ state: 'indexing', progress: 0, numPages, message: null })
    const pages: string[] = []
    const labels: LabelHit[] = []
    for (let p = 1; p <= numPages; p++) {
      try {
        const page = await this.doc.getPage(p)
        const tc = await page.getTextContent()
        const text = itemsToText(tc.items as unknown as TextItemLike[])
        pages.push(text)
        labels.push(...findLabels(p, text))
      } catch {
        pages.push('')
      }
      if (p % 8 === 0 || p === numPages) this.status.set({ state: 'indexing', progress: p / numPages, numPages, message: null })
    }
    this.pages = pages
    this.labels = labels
    await this.backend.writeJson('script-index', { version: 1, size: bytes.byteLength, numPages, pages, labels } satisfies CachedIndex)
    this.status.set({ state: 'ready', progress: 1, numPages, message: null })
  }

  document(): PdfDoc | null {
    return this.doc
  }

  pageText(p: number): string {
    return this.pages[p - 1] ?? ''
  }

  /** Text of pages [a..b], at most `max` pages, skipping empty ones. */
  range(pages: number[], max: number): ScriptPage[] {
    if (!this.ready || pages.length < 2) return []
    const out: ScriptPage[] = []
    for (let p = pages[0]; p <= pages[1] && out.length < max; p++) {
      const text = this.pageText(p)
      if (text.trim()) out.push({ page: p, text: text.slice(0, 6000) })
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
      for (let i = 0; i < this.pages.length && out.length < limit; i++) {
        const t = this.pages[i]
        const k = t.toLowerCase().indexOf(query)
        if (k >= 0) out.push({ page: i + 1, title: `Page ${i + 1}`, snippet: t.slice(Math.max(0, k - 40), k + 80).replace(/\n/g, ' ') })
      }
    }
    return out.slice(0, limit)
  }
}
