// The cheat sheet of a course: whether the exam allows one (and its limits), and what goes on it.
// While tutoring, the tutor suggests entries that are worth looking up instead of memorising (exact
// formulas, the conditions of a theorem, conventions, pitfalls); the learner adds them, edits them, or
// drops them. Understanding is never an entry: the sheet does not tell you which method fits a
// problem, so the tutor keeps teaching and practising those things. Stored per course in
// courses/<id>/cheatsheet.json, next to (not inside) the exam preparation.
import { truncate, uid } from './util'

export type CheatAllowed = 'unknown' | 'yes' | 'no'
export const CHEAT_KINDS = ['formula', 'condition', 'procedure', 'pitfall', 'definition', 'code'] as const
export type CheatKind = (typeof CHEAT_KINDS)[number]

export const CHEAT_KIND_LABEL: Record<CheatKind, string> = {
  formula: 'Formula',
  condition: 'Conditions',
  procedure: 'Procedure',
  pitfall: 'Pitfall',
  definition: 'Definition',
  code: 'Code'
}

export interface CheatRules {
  allowed: CheatAllowed
  /** page sides allowed (an A4 sheet written on both sides is 2); null: not limited or not known */
  pages: number | null
  /** must be handwritten */
  handwritten: boolean
  /** anything else the exam rules say ("A4, own handwriting, no printed solutions") */
  note: string
}

export interface CheatItem {
  id: string
  kind: CheatKind
  /** the entry as it goes on the sheet: Markdown with LaTeX, short */
  text: string
  /** why it belongs on the sheet rather than in memory (the tutor's reason, or empty) */
  why: string
  conceptIds: string[]
  /** suggested by the tutor and not decided yet, on the sheet, or not wanted */
  status: 'suggested' | 'accepted' | 'dismissed'
  source: 'tutor' | 'learner'
  at: string
}

export interface Cheatsheet {
  version: 1
  rules: CheatRules
  items: CheatItem[]
}

export const MAX_CHEAT_ITEMS = 300
const MAX_TEXT = 1200

export function emptyCheatsheet(): Cheatsheet {
  return { version: 1, rules: { allowed: 'unknown', pages: null, handwritten: false, note: '' }, items: [] }
}

const isKind = (k: unknown): k is CheatKind => typeof k === 'string' && (CHEAT_KINDS as readonly string[]).includes(k)

export function normalizeRules(raw: unknown): CheatRules {
  const r = (raw ?? {}) as Partial<CheatRules>
  return {
    allowed: r.allowed === 'yes' || r.allowed === 'no' ? r.allowed : 'unknown',
    pages: typeof r.pages === 'number' && Number.isFinite(r.pages) && r.pages > 0 ? Math.min(40, Math.round(r.pages)) : null,
    handwritten: r.handwritten === true,
    note: typeof r.note === 'string' ? r.note.trim().slice(0, 300) : ''
  }
}

export function normalizeCheatItem(raw: unknown): CheatItem | null {
  const r = (raw ?? {}) as Partial<CheatItem>
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, MAX_TEXT) : ''
  if (!text) return null
  return {
    id: typeof r.id === 'string' && /^[\w-]+$/.test(r.id) ? r.id : uid('cs_'),
    kind: isKind(r.kind) ? r.kind : 'formula',
    text,
    why: typeof r.why === 'string' ? r.why.trim().slice(0, 300) : '',
    conceptIds: Array.isArray(r.conceptIds) ? [...new Set(r.conceptIds.filter((x): x is string => typeof x === 'string'))].slice(0, 6) : [],
    status: r.status === 'accepted' || r.status === 'dismissed' ? r.status : 'suggested',
    source: r.source === 'learner' ? 'learner' : 'tutor',
    at: typeof r.at === 'string' ? r.at : new Date(0).toISOString()
  }
}

/** Read a stored file defensively (older or hand-edited files still load). */
export function normalizeCheatsheet(raw: unknown): Cheatsheet {
  const r = (raw ?? {}) as Partial<Cheatsheet>
  const items = Array.isArray(r.items) ? r.items.map(normalizeCheatItem).filter((x): x is CheatItem => x !== null) : []
  const seen = new Set<string>()
  return {
    version: 1,
    rules: normalizeRules(r.rules),
    items: items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(-MAX_CHEAT_ITEMS)
  }
}

/** Text compared loosely: case, spaces and LaTeX spacing commands do not make an entry new. */
export function cheatKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\\[,;:! ]|\\quad|\\qquad/g, '')
    .replace(/[\s$*_`]+/g, '')
}

export interface SuggestInput {
  kind?: unknown
  text?: unknown
  why?: unknown
  conceptIds?: unknown
}

export interface SuggestOutcome {
  sheet: Cheatsheet
  added: CheatItem[]
  /** suggestions already on the sheet, already suggested, or once dropped by the learner */
  skipped: { text: string; reason: 'on the sheet' | 'already suggested' | 'dropped before' }[]
}

/** Add the tutor's suggestions as undecided entries; an entry the sheet already has (or the learner dropped) is not added again. */
export function addSuggestions(sheet: Cheatsheet, input: SuggestInput[], knownConcepts: Set<string> | null, now: Date): SuggestOutcome {
  const byKey = new Map(sheet.items.map((x) => [cheatKey(x.text), x]))
  const added: CheatItem[] = []
  const skipped: SuggestOutcome['skipped'] = []
  for (const s of input.slice(0, 4)) {
    const item = normalizeCheatItem({ ...s, id: uid('cs_'), status: 'suggested', source: 'tutor', at: now.toISOString() })
    if (!item) continue
    if (knownConcepts) item.conceptIds = item.conceptIds.filter((c) => knownConcepts.has(c))
    const key = cheatKey(item.text)
    const prev = byKey.get(key)
    if (prev) {
      skipped.push({ text: truncate(item.text, 80), reason: prev.status === 'accepted' ? 'on the sheet' : prev.status === 'dismissed' ? 'dropped before' : 'already suggested' })
      continue
    }
    byKey.set(key, item)
    added.push(item)
  }
  return { sheet: { ...sheet, items: [...sheet.items, ...added].slice(-MAX_CHEAT_ITEMS) }, added, skipped }
}

/** A rough budget: how many short entries fit, from the page limit (handwriting fits fewer). */
export function cheatCapacity(rules: CheatRules): number | null {
  if (!rules.pages) return null
  return rules.pages * (rules.handwritten ? 14 : 22)
}

export function rulesLine(rules: CheatRules): string {
  if (rules.allowed !== 'yes') return rules.allowed === 'no' ? 'No cheat sheet allowed.' : 'Not known yet whether a cheat sheet is allowed.'
  const parts = [rules.pages ? `${rules.pages} page side${rules.pages === 1 ? '' : 's'}` : 'size not limited (or not known)']
  if (rules.handwritten) parts.push('handwritten')
  if (rules.note) parts.push(rules.note)
  return `Cheat sheet allowed: ${parts.join(', ')}.`
}

/** The cheat sheet section of the tutor's system prompt; null when the exam allows none. */
export function cheatsheetPrompt(sheet: Cheatsheet): string | null {
  const { rules } = sheet
  if (rules.allowed !== 'yes') return null
  const accepted = sheet.items.filter((x) => x.status === 'accepted')
  const dropped = sheet.items.filter((x) => x.status === 'dismissed')
  const cap = cheatCapacity(rules)
  const out = [
    '# Cheat sheet',
    `The exam allows a cheat sheet. ${rulesLine(rules).replace(/^Cheat sheet allowed: /, 'Limits: ')}`,
    'While you teach and practise, suggest entries worth putting on it with suggest_cheatsheet. The learner decides what goes on the sheet; they see each suggestion in the stream and can add, edit or drop it. Good entries are things that are costly to memorise exactly and cheap to look up:',
    '- exact formulas and constants (error bounds, convergence rates, costs and complexities, closed forms, transform pairs);',
    '- the conditions of a theorem or method (when it applies, what it needs, what breaks without them);',
    '- conventions and pitfalls the learner tripped over (signs, indexing, normalisation, off-by-one, units);',
    '- short procedures with several fixed steps, and library calls or signatures the exam may ask for.',
    'Not on the sheet: the core ideas and the judgement of which method fits a problem. A sheet cannot give that during the exam, so keep teaching and retrieving those; tell the learner so when it helps. An entry on the sheet still gets practised: knowing where it is and how to use it matters.',
    'Suggest sparingly: right after the learner has worked with the thing (a check, a practice item, a mistake), at most one or two per node or item, never as a replacement for a question. Write each entry the way it would stand on the sheet: compressed, with LaTeX, a few symbols explained only if needed, and say in why what it saves. Do not suggest what is on the sheet or was dropped.'
  ]
  if (rules.handwritten) out.push('The sheet is handwritten: keep entries short enough to copy by hand. Writing it is itself good practice; say so once.')
  if (cap) out.push(`Space: roughly ${cap} short entries fit; ${accepted.length} are on it. ${accepted.length >= cap ? 'It is full: suggest an entry only if it beats one on the sheet, and say which one it replaces.' : ''}`.trim())
  if (accepted.length) {
    out.push('On the sheet now:')
    for (const x of accepted.slice(-40)) out.push(`- [${x.kind}] ${truncate(x.text.replace(/\s+/g, ' '), 140)}`)
    if (accepted.length > 40) out.push(`- … and ${accepted.length - 40} more`)
  }
  if (dropped.length) out.push(`Dropped by the learner (do not suggest again): ${dropped.slice(-15).map((x) => `"${truncate(x.text.replace(/\s+/g, ' '), 60)}"`).join('; ')}`)
  return out.join('\n')
}

/** The sheet as Markdown, grouped by kind, for copying into a document or printing. */
export function cheatsheetMarkdown(sheet: Cheatsheet, title: string): string {
  const accepted = sheet.items.filter((x) => x.status === 'accepted')
  const out = [`# ${title}: cheat sheet`, '']
  for (const k of CHEAT_KINDS) {
    const xs = accepted.filter((x) => x.kind === k)
    if (!xs.length) continue
    out.push(`## ${CHEAT_KIND_LABEL[k]}`, '')
    for (const x of xs) out.push(`- ${x.text.replace(/\n+/g, '\n  ')}`)
    out.push('')
  }
  return out.join('\n').trim() + '\n'
}

export function suggestResultText(o: SuggestOutcome, sheet: Cheatsheet): string {
  const parts: string[] = []
  if (o.added.length) parts.push(`Shown to the learner as ${o.added.length} suggestion${o.added.length === 1 ? '' : 's'}; they decide whether to add ${o.added.length === 1 ? 'it' : 'them'}. Carry on teaching; do not wait for the decision.`)
  for (const s of o.skipped) parts.push(`Not added (${s.reason}): "${s.text}".`)
  const cap = cheatCapacity(sheet.rules)
  const n = sheet.items.filter((x) => x.status === 'accepted').length
  parts.push(`The sheet has ${n} entr${n === 1 ? 'y' : 'ies'}${cap ? ` of roughly ${cap} that fit` : ''}.`)
  return parts.join(' ')
}
