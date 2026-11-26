// Jupyter notebooks (.ipynb) as problem sets: found in the course folder (or in a synced repository), their
// Markdown and code become the statement, and the learner's filled-in notebook (code and outputs) is what the
// tutor checks. Notebooks are JSON; only the cells' text is read.
import type { OnlineTask } from './types'

export interface NbCell {
  type: 'markdown' | 'code' | 'raw'
  source: string
  /** text outputs of a code cell (stream, plain text results, errors) */
  output: string
}

const text = (v: unknown): string => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('') : typeof v === 'string' ? v : '')

/** The cells of a notebook file; null when it is not a notebook. */
export function parseNotebook(raw: string): NbCell[] | null {
  let nb: unknown
  try {
    nb = JSON.parse(raw)
  } catch {
    return null
  }
  const cells = (nb as { cells?: unknown })?.cells
  if (!Array.isArray(cells)) return null
  return cells.slice(0, 600).flatMap((c): NbCell[] => {
    const r = (c ?? {}) as Record<string, unknown>
    const type = r.cell_type === 'markdown' || r.cell_type === 'code' ? r.cell_type : 'raw'
    const outs = Array.isArray(r.outputs) ? (r.outputs as Record<string, unknown>[]) : []
    const output = outs
      .map((o) => {
        if (o?.output_type === 'stream') return text(o.text)
        if (o?.output_type === 'error') return `${String(o.ename ?? 'Error')}: ${String(o.evalue ?? '')}`
        const data = (o?.data ?? {}) as Record<string, unknown>
        return data['text/plain'] !== undefined ? text(data['text/plain']) : data['image/png'] ? '[figure]' : ''
      })
      .filter(Boolean)
      .join('\n')
    return [{ type, source: text(r.source), output }]
  })
}

/** A notebook as Markdown: text cells as they are, code in fenced blocks, outputs when asked (for the check). */
export function notebookText(cells: NbCell[], opts: { outputs: boolean; limit?: number }): string {
  const parts: string[] = []
  for (const c of cells) {
    const src = c.source.replace(/\s+$/, '')
    if (c.type === 'markdown' || c.type === 'raw') {
      if (src) parts.push(src)
      continue
    }
    if (src) parts.push('```python\n' + src + '\n```')
    if (opts.outputs && c.output.trim()) parts.push('Output:\n```\n' + c.output.replace(/\s+$/, '').slice(0, 3000) + '\n```')
  }
  return parts.join('\n\n').slice(0, opts.limit ?? 60_000)
}

/** Notebooks that are not problem sets themselves: worked solutions, checkpoints. */
export function isSolutionNotebook(name: string): boolean {
  return /(solution|l[oö]sung|loesung|musterl|sol\b|_sol\.|-sol\.|answers?\b)/i.test(name) || /checkpoint/i.test(name)
}

/** A mock exam or a problem set, from the file name. */
export function notebookKind(name: string): OnlineTask['kind'] {
  return /(exam|mock|pr[uü]fung|probe)/i.test(name) ? 'exam' : 'exercises'
}

/** A readable title from a notebook's file name and its first heading. */
export function notebookTitle(name: string, cells: NbCell[] | null): string {
  const base = name.replace(/\.ipynb$/i, '').replace(/[_]+/g, ' ').trim()
  const h = cells?.find((c) => c.type === 'markdown' && /^\s*#\s+\S/.test(c.source))
  const heading = h ? /^\s*#\s+(.+)$/m.exec(h.source)?.[1]?.replace(/[*_`]/g, '').trim() : ''
  return (heading && heading.length <= 80 && !base.toLowerCase().includes(heading.toLowerCase()) ? `${base}: ${heading}` : base).slice(0, 120)
}

/** The learner's notebook for the check: what they wrote and what it printed. */
export function notebookForCheck(name: string, cells: NbCell[]): string {
  return `${name} (Jupyter notebook, cells in order; outputs as last run):\n\n${notebookText(cells, { outputs: true })}`
}
