// Node helper: extract per-page text from the lecture-notes PDF with pdf.js (same logic as the app).
// Output stays on this machine; never commit it.
import { readFile } from 'node:fs/promises'
import { itemsToText, type TextItemLike } from '../src/shared/pdfText'

export async function extractPages(pdfPath: string, pages?: number[]): Promise<{ page: number; text: string }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(pdfPath))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const wanted = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const out: { page: number; text: string }[] = []
  for (const p of wanted) {
    if (p < 1 || p > doc.numPages) continue
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    out.push({ page: p, text: itemsToText(tc.items as TextItemLike[]) })
  }
  await (doc as unknown as { cleanup?: () => Promise<void> }).cleanup?.()
  return out
}
