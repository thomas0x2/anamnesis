// JSON Schemas for structured model output (passed to `claude -p --json-schema`).
// Kept flat: one block shape with optional fields instead of a deep oneOf, which models fill more reliably.
import { BLOCK_TYPES, CARD_KINDS, DEMO_IDS, INTERACTION_TYPES } from './types'

type S = Record<string, unknown>
const str: S = { type: 'string' }
const nstr: S = { type: ['string', 'null'] }
const nbool: S = { type: ['boolean', 'null'] }
const nint: S = { type: ['integer', 'null'] }
const nnum: S = { type: ['number', 'null'] }
const arr = (items: S): S => ({ type: 'array', items })
const narr = (items: S): S => ({ type: ['array', 'null'], items })
const nullable = (s: S): S => ({ anyOf: [s, { type: 'null' }] })
const obj = (properties: Record<string, S>, required: string[] = Object.keys(properties)): S => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})
const nenum = (values: string[]): S => ({ type: ['string', 'null'], enum: [...values, null] })

const plotSchema = obj(
  {
    title: nstr,
    xLabel: nstr,
    yLabel: nstr,
    xMin: { type: 'number' },
    xMax: { type: 'number' },
    yMin: nnum,
    yMax: nnum,
    logX: nbool,
    logY: nbool,
    series: arr(
      obj(
        {
          label: nstr,
          expr: { type: ['string', 'null'], description: 'math.js expression in x, e.g. "1/(1+25*x^2)"' },
          points: { type: ['array', 'null'], items: arr({ type: 'number' }) },
          style: nenum(['line', 'dashed', 'points'])
        },
        []
      )
    )
  },
  ['xMin', 'xMax', 'series']
)

export const blockSchema = obj(
  {
    type: { type: 'string', enum: [...BLOCK_TYPES] },
    md: nstr,
    latex: nstr,
    tone: nenum(['info', 'insight', 'warning', 'example']),
    items: narr(str),
    plot: nullable(plotSchema),
    demo: nullable(obj({ id: { type: 'string', enum: [...DEMO_IDS] }, params: nstr, caption: nstr }, ['id'])),
    html: nstr,
    height: nint,
    page: nint,
    label: nstr,
    code: nullable(obj({ language: nstr, source: str }, ['source'])),
    table: nullable(obj({ headers: arr(str), rows: arr(arr(str)) }))
  },
  ['type']
)

export const interactionSchema = obj(
  {
    type: { type: 'string', enum: [...INTERACTION_TYPES] },
    prompt: str,
    options: narr(obj({ id: str, md: str, correct: { type: 'boolean' }, feedback: str })),
    multi: nbool,
    answer: nullable(obj({ value: str, tolerance: nnum, relative: nbool }, ['value'])),
    items: narr(str),
    template: nstr,
    blanks: narr(obj({ id: str, accepted: arr(str) })),
    rubric: narr(str),
    modelAnswer: nstr,
    hints: arr(str),
    solution: str,
    explain: nstr,
    confidence: { type: 'boolean' },
    conceptIds: arr(str),
    level: nint,
    cue: nenum(['familiar', 'shifted', 'novel']),
    allowVoice: nbool,
    misconceptions: narr(obj({ optionId: str, text: str }))
  },
  ['type', 'prompt', 'hints', 'solution', 'confidence', 'conceptIds']
)

export const cardSchema = obj(
  {
    kind: { type: 'string', enum: [...CARD_KINDS] },
    title: nstr,
    nodeId: nstr,
    blocks: arr(blockSchema),
    interaction: nullable(interactionSchema),
    speech: nstr
  },
  ['kind', 'blocks']
)

export const planSchema = obj({
  goal: str,
  approach: str,
  nodes: arr(
    obj(
      {
        id: str,
        title: str,
        detail: str,
        kind: { type: 'string', enum: ['known', 'shaky', 'new', 'goal'] },
        requires: arr(str),
        conceptId: nstr
      },
      ['id', 'title', 'detail', 'kind', 'requires']
    )
  )
})

export const modelUpdateSchema = obj(
  {
    notes: arr(obj({ conceptId: str, note: str })),
    misconceptions: arr(obj({ conceptId: str, text: str, status: { type: 'string', enum: ['active', 'resolved'] } })),
    profile: arr(str)
  },
  []
)

export const stepSchema = obj(
  {
    assessment: nstr,
    cards: arr(cardSchema),
    plan: nullable(planSchema),
    model: nullable(modelUpdateSchema),
    control: obj(
      {
        next: { type: 'string', enum: ['continue', 'phase_done', 'session_done'] },
        nodeId: nstr,
        nodeStatus: nenum(['done', 'shaky', 'needs_more'])
      },
      ['next']
    )
  },
  ['cards', 'control']
)

export const gradeSchema = obj({
  score: { type: 'number', description: '0 to 1' },
  verdict: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
  feedback: str,
  missing: arr(str),
  misconceptions: arr(str)
})

export const chatSchema = obj({ blocks: arr(blockSchema), speech: nstr }, ['blocks'])

export const testSchema = obj({ ok: { type: 'boolean' }, model: str })
