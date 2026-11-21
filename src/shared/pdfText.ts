// Turn pdf.js text items into readable page text (used for the local script index and grounding).

export interface TextItemLike {
  str: string
  transform: number[]
  hasEOL?: boolean
}

export function itemsToText(items: TextItemLike[]): string {
  let out = ''
  let lastY: number | null = null
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    const y = it.transform?.[5] ?? 0
    if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n'
    else if (out && !out.endsWith('\n') && !out.endsWith(' ') && it.str && !it.str.startsWith(' ')) out += ' '
    out += it.str
    if (it.hasEOL) out += '\n'
    lastY = y
  }
  return cleanPageText(out)
}

export function cleanPageText(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface LabelHit {
  page: number
  kind: string
  label: string
  snippet: string
}

const KIND_RE = /^(Definition|Theorem|Satz|Lemma|Korollar|Beispiel|Bemerkung|Code|Algorithmus)\s+(\d+\.\d+(?:\.\d+)?)\b(.{0,80})/

/** Find labelled items ("Theorem 2.4.11 …") at line starts, for the script search box. */
export function findLabels(page: number, text: string): LabelHit[] {
  const out: LabelHit[] = []
  for (const line of text.split('\n')) {
    const m = KIND_RE.exec(line.trim())
    if (m) out.push({ page, kind: m[1], label: m[2], snippet: m[3].trim() })
  }
  return out
}
