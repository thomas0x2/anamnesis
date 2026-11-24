// Deterministic stand-in for the model: used by the demo mode, UI tests and the dev server's fake mode.
// It exercises every card kind, block type and interaction, but its content is generic.
import type { LlmEvent, LlmRequest, LlmResult } from './types'

export type Meta = {
  phase?: string
  nodeId?: string | null
  nodeTitle?: string
  conceptId?: string
  conceptTitle?: string
  level?: number
  attempt?: number
  round?: number
  itemIndex?: number
  question?: string
  answer?: string
}

const hints = ['What is given, and what exactly is asked?', 'Which definition from the plan applies here?', 'Write the first line of the computation and look at the shape of the result.']

export function probeStep(m: Meta) {
  const c = m.conceptId ?? 'lagrange'
  return {
    assessment: null,
    cards: [
      {
        kind: 'probe',
        title: 'Warm-up: a value by hand',
        nodeId: null,
        blocks: [{ type: 'text', md: 'Take the nodes \\\\$x_0=0, x_1=1, x_2=2\\\\$ and the Lagrange polynomial' /* escaped twice, as Gemini does */ }, { type: 'equation', latex: '\\ell_1(x)=\\prod_{k\\neq 1}\\frac{x-x_k}{x_1-x_k}' }],
        interaction: { type: 'numeric', prompt: 'Compute $\\ell_1(3)$.', answer: { value: '-3', tolerance: 1e-9, relative: false }, hints, solution: '$\\ell_1(3)=\\frac{3}{1}\\cdot\\frac{1}{-1}=-3$.', confidence: true, conceptIds: [c] },
        speech: 'Evaluate l one at three.'
      },
      {
        kind: 'probe',
        title: 'Warm-up: cost',
        nodeId: null,
        blocks: [{ type: 'text', md: 'You evaluate \\(p(x)=\\sum_j y_j\\ell_j(x)\\) directly at one point, with \\$n+1\\$ nodes. Each of the \\$n+1\\$ terms is a product of factors like $\\frac{x-x_0}{x_1-x_0}$, so with $n = 10^4$ nodes one evaluation takes about $(n+1)\\cdot n \\approx 10^{8}$ multiplications.' }],
        interaction: {
          type: 'mcq',
          prompt: 'What does one evaluation cost?',
          options: [
            { id: 'a', md: '\\\\(O(n)\\\\)', correct: false, feedback: 'Each term has its own product of about \\$n\\$ factors.' },
            { id: 'b', md: '$O(n^2)$', correct: true, feedback: 'Right: $n+1$ terms times $n$ factors.' },
            { id: 'c', md: '$O(n^3)$', correct: false, feedback: 'That is the cost of solving a dense system.' }
          ],
          multi: false,
          hints,
          solution: '$n+1$ terms, each a product of $n$ factors: $O(n^2)$.',
          confidence: true,
          conceptIds: ['complexity', c],
          misconceptions: [{ optionId: 'c', text: 'confuses evaluating the Lagrange form with solving the Vandermonde system' }]
        },
        speech: 'How expensive is one evaluation?'
      },
      {
        kind: 'probe',
        title: 'In your words',
        nodeId: null,
        blocks: [],
        interaction: { type: 'free', prompt: 'Why might the choice of basis matter when you interpolate?', rubric: ['cost', 'stability'], modelAnswer: 'It changes the cost of finding and evaluating coefficients and the conditioning.', hints: [], solution: 'Cost and stability depend on the basis.', confidence: true, conceptIds: [c], allowVoice: true },
        speech: null
      }
    ],
    plan: null,
    model: null,
    control: { next: 'continue', nodeId: null, nodeStatus: null }
  }
}

export function planStep(m: Meta) {
  const c = m.conceptId ?? 'barycentric'
  return {
    assessment: 'You can evaluate Lagrange polynomials and count cost; the weights are new.',
    cards: [
      {
        kind: 'message',
        title: 'Your path',
        nodeId: null,
        blocks: [{ type: 'text', md: `We start from the Lagrange basis you already know and build up to **${m.conceptTitle ?? c}** in four steps. Mark anything you already know.` }],
        interaction: { type: 'continue', prompt: '', hints: [], solution: '', confidence: false, conceptIds: [] },
        speech: 'Here is the path. Adjust it if you like.'
      }
    ],
    plan: {
      goal: m.conceptTitle ?? c,
      approach: 'Factor the node polynomial out of every Lagrange term, then divide by the interpolant of 1.',
      nodes: [
        { id: 'n1', title: 'Lagrange basis', detail: 'ℓ_j is 1 at x_j and 0 at the other nodes.', kind: 'known', requires: [], conceptId: 'lagrange' },
        { id: 'n2', title: 'Node polynomial', detail: 'ℓ(x) = ∏(x − x_k) is shared by every term.', kind: 'new', requires: ['n1'], conceptId: null },
        { id: 'n3', title: 'Weights', detail: 'λ_j = 1/∏_{k≠j}(x_j − x_k) depend only on the nodes.', kind: 'new', requires: ['n2'], conceptId: null },
        { id: 'n4', title: 'Interpolating 1', detail: 'Σ ℓ_j(x) = 1 lets us divide ℓ(x) away.', kind: 'shaky', requires: ['n1'], conceptId: 'interp-problem' },
        { id: 'n5', title: 'Barycentric formula', detail: 'p(x) = Σ λ_j y_j/(x−x_j) / Σ λ_j/(x−x_j), O(n) per point.', kind: 'goal', requires: ['n3', 'n4'], conceptId: c }
      ]
    },
    model: { notes: [{ conceptId: 'lagrange', note: 'Computes Lagrange values reliably.' }], misconceptions: [], profile: [] },
    control: { next: 'phase_done', nodeId: null, nodeStatus: null }
  }
}

export function teachStep(m: Meta) {
  const node = m.nodeId ?? 'n2'
  const c = m.conceptId ?? 'barycentric'
  const remediation = (m.attempt ?? 1) > 1
  return {
    assessment: remediation ? 'The last check missed the shared factor; trying a picture this time.' : 'Ready for the next step.',
    cards: [
      {
        kind: 'predict',
        title: `Predict: ${m.nodeTitle ?? 'next step'}`,
        nodeId: node,
        blocks: [{ type: 'text', md: 'Look at two Lagrange terms side by side. What do they have in common?' }],
        interaction: {
          type: 'mcq',
          prompt: 'Which factor appears in **every** $\\ell_j(x)$ (up to one missing term)?',
          options: [
            { id: 'a', md: '$\\prod_k (x-x_k)$', correct: true, feedback: 'Yes: each $\\ell_j$ is this product with one factor removed.' },
            { id: 'b', md: '$\\prod_k (x_j-x_k)$', correct: false, feedback: 'That denominator depends on $j$.' },
            { id: 'c', md: '$y_j$', correct: false, feedback: 'The data values are not part of $\\ell_j$.' }
          ],
          multi: false,
          hints: [],
          solution: 'The numerator of every term is the node polynomial divided by $(x-x_j)$.',
          confidence: false,
          conceptIds: [c]
        },
        speech: 'What do all Lagrange terms share?'
      },
      {
        kind: 'explain',
        title: 'Factor it out',
        nodeId: node,
        blocks: [
          { type: 'text', md: 'If you guessed the full product: exactly. Write it once:' },
          { type: 'equation', latex: '\\ell(x)=\\prod_{k=0}^{n}(x-x_k),\\qquad \\ell_j(x)=\\ell(x)\\,\\frac{\\lambda_j}{x-x_j}' },
          { type: 'callout', tone: 'insight', md: 'The weights $\\lambda_j$ depend only on the nodes, so they are computed **once**.' },
          { type: 'demo', demo: { id: 'interpolation', params: '{"n":6,"nodes":"equispaced","showBasis":true}', caption: 'Toggle the basis: every curve vanishes at all nodes but one.' } },
          {
            type: 'plot',
            plot: { title: 'Two basis functions', xMin: 0, xMax: 2, series: [{ label: 'ℓ₀', expr: '(x-1)*(x-2)/2' }, { label: 'ℓ₁', expr: '-x*(x-2)', style: 'dashed' }] }
          },
          { type: 'mermaid', md: 'graph LR\n  A["ℓ(x) once"] --> B["λ_j once, O(n²)"]\n  B --> C["p(x) per point, O(n)"]' },
          { type: 'script', page: 51, label: 'Abschnitt 2.3', md: 'The barycentric form in the script.' }
        ],
        interaction: { type: 'continue', prompt: '', hints: [], solution: '', confidence: false, conceptIds: [] },
        speech: 'Every term shares the node polynomial; factor it out.'
      },
      {
        kind: 'check',
        title: 'Check: a weight',
        nodeId: node,
        blocks: [{ type: 'text', md: 'Nodes $0, 1, 3$.' }],
        interaction: {
          type: 'numeric',
          prompt: 'Compute $\\lambda_1 = 1/\\prod_{k\\neq 1}(x_1-x_k)$.',
          answer: { value: '-1/2', tolerance: 1e-9, relative: false },
          hints,
          solution: '$\\lambda_1 = 1/((1-0)(1-3)) = -1/2$.',
          confidence: true,
          conceptIds: [c]
        },
        speech: 'Compute lambda one.'
      }
    ],
    plan: null,
    model: { notes: [], misconceptions: [], profile: [] },
    control: { next: 'continue', nodeId: node, nodeStatus: remediation ? 'needs_more' : null }
  }
}

export function wrapStep(m: Meta) {
  const c = m.conceptId ?? 'barycentric'
  return {
    assessment: 'Every node is in place.',
    cards: [
      {
        kind: 'reflect',
        title: 'Explain the chain',
        nodeId: null,
        blocks: [{ type: 'text', md: 'In your own words (typing or speaking): how do we get from the Lagrange form to the barycentric formula, and why is it faster?' }],
        interaction: {
          type: 'free',
          prompt: 'Explain the chain from Lagrange to barycentric.',
          rubric: ['factor the node polynomial', 'weights computed once', 'divide by the interpolant of 1', 'O(n) per point'],
          modelAnswer: 'Each ℓ_j = ℓ(x) λ_j/(x−x_j); the weights are computed once; dividing by Σλ_j/(x−x_j) (the interpolant of 1) removes ℓ(x); each evaluation is O(n).',
          hints: ['Start from what every ℓ_j shares.'],
          solution: 'See the model answer.',
          confidence: true,
          conceptIds: [c],
          allowVoice: true
        },
        speech: 'Explain the whole chain in your own words.'
      },
      {
        kind: 'summary',
        title: 'Takeaways',
        nodeId: null,
        blocks: [{ type: 'steps', items: ['Factor out $\\ell(x)$.', 'Weights once: $O(n^2)$.', 'Evaluate in $O(n)$.'] }, { type: 'script', page: 52, label: 'Abschnitt 2.3', md: 'Reread this.' }],
        interaction: { type: 'continue', prompt: '', hints: [], solution: '', confidence: false, conceptIds: [] },
        speech: 'Well done.'
      }
    ],
    plan: null,
    model: { notes: [{ conceptId: c, note: 'Can derive the barycentric formula from the Lagrange form.' }], misconceptions: [], profile: [] },
    control: { next: 'session_done', nodeId: null, nodeStatus: null }
  }
}

export function practiceStep(m: Meta, phase: 'practice' | 'review') {
  const c = m.conceptId ?? 'lagrange'
  const level = m.level ?? 1
  const k = (m.itemIndex ?? 0) % 4
  const interactions = [
    {
      type: 'mcq',
      prompt: `(M) Which statements about ${m.conceptTitle ?? c} are true?`,
      options: [
        { id: 'a', md: 'It is unique for distinct nodes.', correct: true, feedback: 'Uniqueness follows from the dimension of $\\mathcal P_n$.' },
        { id: 'b', md: 'It needs a linear solve per evaluation.', correct: false, feedback: 'No system is solved per evaluation.' },
        { id: 'c', md: 'Its basis functions vanish at all other nodes.', correct: true, feedback: 'That is the cardinal property.' }
      ],
      multi: true
    },
    {
      type: 'order',
      prompt: 'Order the steps of barycentric evaluation.',
      items: ['Compute the weights $\\lambda_j$', 'Form $\\lambda_j/(x-x_j)$', 'Sum numerator and denominator', 'Divide']
    },
    {
      type: 'fill',
      prompt: 'Complete the numpy code.',
      template: '```python\nlam = 1/np.prod(x[j]-np.delete(x, j))\np = np.sum(lam*y/(t-x)) / np.sum([[1]])\n```',
      blanks: [{ id: '1', accepted: ['lam/(t-x)', 'lam / (t - x)'] }]
    },
    { type: 'numeric', prompt: 'With nodes $0,1,2$: compute $\\lambda_0$.', answer: { value: '1/2', tolerance: 1e-9, relative: false } }
  ]
  return {
    assessment: null,
    cards: [
      {
        kind: phase,
        title: `Level ${level}: ${m.conceptTitle ?? c}`,
        nodeId: null,
        blocks: [{ type: 'text', md: 'A fresh item on this concept.' }],
        interaction: { ...interactions[k], hints, solution: 'Worked solution: apply the definition step by step.', confidence: true, conceptIds: [c], level, cue: level >= 3 ? 'shifted' : 'familiar' },
        speech: 'Here is the next item.'
      }
    ],
    plan: null,
    model: null,
    control: { next: 'continue', nodeId: null, nodeStatus: null }
  }
}

export function fakeResponse(req: LlmRequest): unknown {
  const m = (req.meta ?? {}) as Meta
  if (req.kind === 'grade') {
    const a = (m.answer ?? '').toLowerCase()
    const score = a.length > 60 ? 0.9 : a.length > 15 ? 0.6 : 0.2
    return {
      score,
      verdict: score >= 0.8 ? 'correct' : score >= 0.4 ? 'partial' : 'incorrect',
      feedback: score >= 0.8 ? 'Clear and complete: you named every step.' : 'Good start. What happens to the shared factor when you divide by the interpolant of 1?',
      missing: score >= 0.8 ? [] : ['divide by the interpolant of 1'],
      misconceptions: []
    }
  }
  if (req.kind === 'chat') return { blocks: [{ type: 'text', md: `Good question. Think about what stays the same for every $j$. *(demo tutor; you asked: ${(m.question ?? '').slice(0, 80)})*` }], speech: 'Think about what stays the same for every j.' }
  if (req.kind === 'test') return { ok: true, model: 'demo' }
  if (req.kind === 'work') return (req.meta as { fake?: unknown } | undefined)?.fake ?? { summary: '', tasks: [], notes: [], strengths: [], next: [] }
  if (req.kind === 'map') return (req.meta as { fake?: unknown } | undefined)?.fake ?? { note: null, chapters: [], concepts: [], links: [], exercises: [] }
  switch (m.phase) {
    case 'probe':
      return (m.round ?? 1) > 1 ? planStep(m) : probeStep(m)
    case 'plan':
      return planStep(m)
    case 'teach':
      return teachStep(m)
    case 'wrap':
      return wrapStep(m)
    case 'review':
      return practiceStep(m, 'review')
    default:
      return practiceStep(m, 'practice')
  }
}

/** Simulated streaming: emits the cards one by one, then the result. */
/** Test hook: a map request whose pages contain this marker fails the first time (to exercise Retry). */
export const FAKE_FAIL_ONCE = '[fake: fail once]'
const failedOnce = new Set<string>()

export async function fakeGenerate(req: LlmRequest, onEvent?: (e: LlmEvent) => void, delayMs = 250): Promise<LlmResult> {
  if (req.kind === 'map' && req.prompt.includes(FAKE_FAIL_ONCE) && !failedOnce.has(req.prompt)) {
    failedOnce.add(req.prompt)
    await new Promise((r) => setTimeout(r, delayMs))
    return { id: req.id, ok: false, errorKind: 'auth', error: 'Demo: this part failed once on purpose.' }
  }
  const data = fakeResponse(req) as { cards?: unknown[] }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  onEvent?.({ id: req.id, type: 'status', status: 'thinking' })
  await sleep(delayMs)
  if (Array.isArray(data.cards)) {
    onEvent?.({ id: req.id, type: 'status', status: 'writing' })
    for (let i = 1; i <= data.cards.length; i++) {
      onEvent?.({ id: req.id, type: 'partial', partial: { ...data, cards: data.cards.slice(0, i), plan: undefined, model: undefined, control: undefined } })
      await sleep(delayMs)
    }
  }
  return { id: req.id, ok: true, data, model: 'demo', durationMs: delayMs * 3, costUsd: 0 }
}
