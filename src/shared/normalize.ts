// Turn model output (possibly partial, possibly sloppy) into well-formed domain objects.
// Rule: never crash the session on a bad field; repair what can be repaired, drop what cannot.
import { sanitizePlan } from './graph'
import {
  BLOCK_TYPES,
  CARD_KINDS,
  DEMO_IDS,
  INTERACTION_TYPES,
  type Block,
  type Card,
  type ChatReply,
  type GradeResult,
  type Interaction,
  type ModelUpdate,
  type Plan,
  type TutorStep
} from './types'
import { clamp } from './util'

type Raw = Record<string, unknown>
const isObj = (x: unknown): x is Raw => !!x && typeof x === 'object' && !Array.isArray(x)
const s = (x: unknown): string => (typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x))
const ns = (x: unknown): string | null => {
  const v = s(x).trim()
  return v ? v : null
}
const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.map(s).map((v) => v.trim()).filter(Boolean) : [])
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() && Number.isFinite(Number(x)) ? Number(x) : null)

export interface NormalizeContext {
  conceptIds: Set<string>
  defaultConceptId: string | null
}

function stripMathDelims(latex: string): string {
  return latex
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .replace(/^\$([\s\S]*)\$$/, '$1')
    .trim()
}

export function normalizeBlock(raw: unknown): Block | null {
  if (typeof raw === 'string') return raw.trim() ? { type: 'text', md: raw } : null
  if (!isObj(raw)) return null
  let type = s(raw.type) as Block['type']
  if (!(BLOCK_TYPES as readonly string[]).includes(type)) type = raw.latex ? 'equation' : 'text'
  const b: Block = { type }
  const md = ns(raw.md) ?? ns(raw.text) ?? ns(raw.content)
  switch (type) {
    case 'text':
      if (!md) return null
      b.md = md
      return b
    case 'equation': {
      const latex = ns(raw.latex) ?? md
      if (!latex) return null
      b.latex = stripMathDelims(latex)
      b.md = ns(raw.md) && ns(raw.latex) ? md : null
      return b
    }
    case 'callout': {
      if (!md) return null
      b.md = md
      const tone = s(raw.tone)
      b.tone = (['info', 'insight', 'warning', 'example'].includes(tone) ? tone : 'info') as Block['tone']
      return b
    }
    case 'steps': {
      const items = strArr(raw.items)
      if (!items.length) return md ? { type: 'text', md } : null
      b.items = items
      b.md = md
      return b
    }
    case 'plot': {
      const p = isObj(raw.plot) ? raw.plot : null
      if (!p) return null
      let xMin = num(p.xMin) ?? -1
      let xMax = num(p.xMax) ?? 1
      if (xMax <= xMin) [xMin, xMax] = [Math.min(xMin, xMax), Math.max(xMin, xMax) + 1]
      const series = (Array.isArray(p.series) ? p.series : [])
        .filter(isObj)
        .map((q) => ({
          label: ns(q.label),
          expr: ns(q.expr),
          points: Array.isArray(q.points)
            ? (q.points as unknown[]).filter((pt): pt is number[] => Array.isArray(pt) && pt.length >= 2 && pt.every((v) => typeof v === 'number'))
            : null,
          style: (['line', 'dashed', 'points'].includes(s(q.style)) ? s(q.style) : null) as 'line' | 'dashed' | 'points' | null
        }))
        .filter((q) => q.expr || (q.points && q.points.length))
      if (!series.length) return null
      b.plot = {
        title: ns(p.title),
        xLabel: ns(p.xLabel),
        yLabel: ns(p.yLabel),
        xMin,
        xMax,
        yMin: num(p.yMin),
        yMax: num(p.yMax),
        logX: p.logX === true,
        logY: p.logY === true,
        series
      }
      b.md = md
      return b
    }
    case 'demo': {
      const d = isObj(raw.demo) ? raw.demo : null
      const id = s(d?.id ?? raw.id)
      if (!(DEMO_IDS as readonly string[]).includes(id)) return md ? { type: 'text', md } : null
      let params = d?.params
      if (isObj(params)) params = JSON.stringify(params)
      b.demo = { id, params: ns(params), caption: ns(d?.caption) ?? md }
      return b
    }
    case 'mermaid': {
      const src = md ?? ns(raw.code)
      if (!src) return null
      b.md = src.replace(/^```mermaid\s*/i, '').replace(/```\s*$/, '').trim()
      return b
    }
    case 'sketch': {
      const html = ns(raw.html)
      if (!html) return null
      b.html = html
      b.height = clamp(num(raw.height) ?? 320, 120, 720)
      b.md = md
      return b
    }
    case 'script': {
      const page = num(raw.page)
      if (page === null) return null
      b.page = Math.round(page)
      b.label = ns(raw.label)
      b.md = md
      return b
    }
    case 'code': {
      const c = isObj(raw.code) ? raw.code : null
      const source = ns(c?.source) ?? md
      if (!source) return null
      b.code = { language: ns(c?.language) ?? 'python', source: source.replace(/^```\w*\s*/, '').replace(/```\s*$/, '') }
      return b
    }
    case 'table': {
      const t = isObj(raw.table) ? raw.table : null
      const headers = strArr(t?.headers)
      const rows = Array.isArray(t?.rows) ? (t!.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map(s)) : []
      if (!headers.length && !rows.length) return null
      b.table = { headers, rows }
      b.md = md
      return b
    }
  }
  return null
}

const LETTERS = 'abcdefghij'

export function normalizeInteraction(raw: unknown, ctx: NormalizeContext): Interaction | null {
  if (!isObj(raw)) return null
  let type = s(raw.type) as Interaction['type']
  if (!(INTERACTION_TYPES as readonly string[]).includes(type)) type = 'free'
  const prompt = s(raw.prompt).trim()
  const hints = strArr(raw.hints).slice(0, 5)
  const solution = s(raw.solution).trim()
  let conceptIds = strArr(raw.conceptIds).filter((c) => ctx.conceptIds.has(c))
  if (!conceptIds.length && ctx.defaultConceptId) conceptIds = [ctx.defaultConceptId]
  const lvl = num(raw.level)
  const it: Interaction = {
    type,
    prompt,
    hints,
    solution,
    explain: ns(raw.explain),
    confidence: raw.confidence !== false,
    conceptIds,
    level: lvl === null ? null : clamp(Math.round(lvl), 1, 5),
    cue: (['familiar', 'shifted', 'novel'].includes(s(raw.cue)) ? s(raw.cue) : null) as Interaction['cue'],
    allowVoice: raw.allowVoice === true,
    rubric: strArr(raw.rubric),
    modelAnswer: ns(raw.modelAnswer)
  }
  const asFree = (): Interaction => ({
    ...it,
    type: 'free',
    options: null,
    rubric: it.rubric?.length ? it.rubric : solution ? [solution.slice(0, 200)] : [],
    modelAnswer: it.modelAnswer ?? (solution || null),
    allowVoice: true
  })
  switch (type) {
    case 'continue':
      return { ...it, confidence: false, hints: [], solution: '' }
    case 'mcq': {
      const rawOpts = Array.isArray(raw.options) ? raw.options : []
      const opts = rawOpts
        .map((o, i) =>
          typeof o === 'string'
            ? { id: LETTERS[i] ?? `o${i}`, md: o, correct: false, feedback: '' }
            : isObj(o)
              ? { id: s(o.id).trim() || LETTERS[i] || `o${i}`, md: s(o.md ?? o.text).trim(), correct: o.correct === true, feedback: s(o.feedback).trim() }
              : null
        )
        .filter((o): o is NonNullable<typeof o> => !!o && !!o.md)
      const ids = new Set<string>()
      for (const [i, o] of opts.entries()) {
        if (ids.has(o.id)) o.id = `${o.id}${i}`
        ids.add(o.id)
      }
      const nCorrect = opts.filter((o) => o.correct).length
      if (opts.length < 2 || nCorrect === 0) return asFree()
      const mcs = Array.isArray(raw.misconceptions)
        ? raw.misconceptions.filter(isObj).map((m) => ({ optionId: s(m.optionId), text: s(m.text).trim() })).filter((m) => ids.has(m.optionId) && m.text)
        : []
      return { ...it, options: opts, multi: raw.multi === true || nCorrect > 1, misconceptions: mcs }
    }
    case 'numeric': {
      const a = isObj(raw.answer) ? raw.answer : null
      const value = ns(a?.value ?? raw.answer)
      if (!value) return asFree()
      return { ...it, answer: { value, tolerance: num(a?.tolerance), relative: a?.relative === true } }
    }
    case 'order': {
      const items = strArr(raw.items)
      if (items.length < 2) return asFree()
      return { ...it, items: [...new Set(items)] }
    }
    case 'fill': {
      let template = s(raw.template)
      const blanks = (Array.isArray(raw.blanks) ? raw.blanks : [])
        .filter(isObj)
        .map((b, i) => ({ id: s(b.id).trim() || String(i + 1), accepted: strArr(b.accepted) }))
        .filter((b) => b.accepted.length)
      if (!template || !blanks.length) return asFree()
      // make sure every blank appears as [[id]] in the template; map positional markers if needed
      const markers = [...template.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1])
      if (blanks.some((b) => !markers.includes(b.id))) {
        if (markers.length === blanks.length) {
          blanks.forEach((b, i) => (b.id = markers[i]))
        } else if (markers.length === 0) {
          template = template + '\n\n' + blanks.map((b) => `[[${b.id}]]`).join(' ')
        } else return asFree()
      }
      return { ...it, template, blanks }
    }
    case 'free':
      return asFree()
  }
  return asFree()
}

export function normalizeCard(raw: unknown, ctx: NormalizeContext): Card | null {
  if (!isObj(raw)) return null
  let kind = s(raw.kind) as Card['kind']
  if (!(CARD_KINDS as readonly string[]).includes(kind)) kind = 'explain'
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).map(normalizeBlock).filter((b): b is Block => !!b)
  let interaction = normalizeInteraction(raw.interaction, ctx)
  if (interaction && !interaction.prompt && interaction.type !== 'continue') {
    interaction.prompt = kind === 'predict' ? 'What do you predict?' : 'Your answer:'
  }
  if (!interaction) interaction = { type: 'continue', prompt: '', hints: [], solution: '', confidence: false, conceptIds: ctx.defaultConceptId ? [ctx.defaultConceptId] : [] }
  if (!blocks.length && interaction.type === 'continue') return null
  return { kind, title: ns(raw.title), nodeId: ns(raw.nodeId), blocks, interaction, speech: ns(raw.speech) }
}

export function normalizePlan(raw: unknown, ctx: NormalizeContext): Plan | null {
  if (!isObj(raw) || !Array.isArray(raw.nodes)) return null
  const nodes = raw.nodes
    .filter(isObj)
    .map((n, i) => ({
      id: s(n.id).trim() || `n${i + 1}`,
      title: s(n.title).trim() || `Step ${i + 1}`,
      detail: s(n.detail).trim(),
      kind: (['known', 'shaky', 'new', 'goal'].includes(s(n.kind)) ? s(n.kind) : 'new') as Plan['nodes'][number]['kind'],
      requires: strArr(n.requires),
      conceptId: ns(n.conceptId) && ctx.conceptIds.has(s(n.conceptId)) ? s(n.conceptId) : null
    }))
  if (!nodes.length) return null
  return sanitizePlan({ goal: s(raw.goal).trim(), approach: s(raw.approach).trim(), nodes })
}

export function normalizeModelUpdate(raw: unknown, ctx: NormalizeContext): ModelUpdate | null {
  if (!isObj(raw)) return null
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter(isObj)
    .map((n) => ({ conceptId: s(n.conceptId), note: s(n.note).trim() }))
    .filter((n) => ctx.conceptIds.has(n.conceptId) && n.note)
  const misconceptions = (Array.isArray(raw.misconceptions) ? raw.misconceptions : [])
    .filter(isObj)
    .map((m) => ({ conceptId: s(m.conceptId), text: s(m.text).trim(), status: (s(m.status) === 'resolved' ? 'resolved' : 'active') as 'active' | 'resolved' }))
    .filter((m) => ctx.conceptIds.has(m.conceptId) && m.text)
  const profile = strArr(raw.profile).slice(0, 3)
  return { notes, misconceptions, profile }
}

export function normalizeStep(raw: unknown, ctx: NormalizeContext): TutorStep {
  const r = isObj(raw) ? raw : {}
  const cards = (Array.isArray(r.cards) ? r.cards : []).map((c) => normalizeCard(c, ctx)).filter((c): c is Card => !!c)
  const control = isObj(r.control) ? r.control : {}
  const next = (['continue', 'phase_done', 'session_done'].includes(s(control.next)) ? s(control.next) : 'continue') as TutorStep['control']['next']
  const nodeStatus = (['done', 'shaky', 'needs_more'].includes(s(control.nodeStatus)) ? s(control.nodeStatus) : null) as TutorStep['control']['nodeStatus']
  return {
    assessment: ns(r.assessment),
    cards,
    plan: normalizePlan(r.plan, ctx),
    model: normalizeModelUpdate(r.model, ctx),
    control: { next, nodeId: ns(control.nodeId), nodeStatus }
  }
}

/** Cards that are complete in a streaming partial step (all but the last, unless later keys exist). */
export function completeCardsFromPartial(partial: unknown, ctx: NormalizeContext): Card[] {
  if (!isObj(partial) || !Array.isArray(partial.cards)) return []
  const closed = 'plan' in partial || 'model' in partial || 'control' in partial
  const raws = closed ? partial.cards : partial.cards.slice(0, -1)
  return raws.map((c) => normalizeCard(c, ctx)).filter((c): c is Card => !!c)
}

export function normalizeGrade(raw: unknown): GradeResult {
  const r = isObj(raw) ? raw : {}
  const score = clamp(num(r.score) ?? 0, 0, 1)
  const v = s(r.verdict)
  const verdict = (['correct', 'partial', 'incorrect'].includes(v) ? v : score >= 0.8 ? 'correct' : score >= 0.4 ? 'partial' : 'incorrect') as GradeResult['verdict']
  return { score, verdict, feedback: s(r.feedback).trim(), missing: strArr(r.missing), misconceptions: strArr(r.misconceptions) }
}

export function normalizeChat(raw: unknown): ChatReply {
  const r = isObj(raw) ? raw : {}
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).map(normalizeBlock).filter((b): b is Block => !!b)
  return { blocks: blocks.length ? blocks : [{ type: 'text', md: s(r.text) || '…' }], speech: ns(r.speech) }
}
