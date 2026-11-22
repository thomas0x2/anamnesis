// The tutor agent's tools and system prompt. The agent (Claude Code CLI) calls these through the
// app's MCP server; the app runs them in its UI: cards the learner answers, the plan panel, the
// learner model, the lecture notes. Card-like tools wait until the learner has answered.
import type { AgentToolDef } from './agentTypes'
import type { CourseGraph } from './graph'
import { CORE_RULES, conceptModelLine } from './prompts'
import { blockSchema, interactionSchema, modelUpdateSchema, planSchema } from './schema'
import type { Course, LearnerModel } from './types'

type S = Record<string, unknown>
const str: S = { type: 'string' }
const nstr: S = { type: ['string', 'null'] }

const ASK_KINDS = ['probe', 'predict', 'check', 'practice', 'review', 'reflect']

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: 'explain',
    description:
      'Show the learner a short content card (text, equations, plots, demos, diagrams, code, script references) with a Continue button. Waits until the learner has read it; the result says "read" or carries a question they typed instead. Keep it short: at most 3 blocks, prose under ~90 words.',
    inputSchema: {
      type: 'object',
      properties: {
        title: nstr,
        blocks: { type: 'array', items: blockSchema },
        speech: { ...nstr, description: 'what to read aloud, math spoken out, 1-3 sentences' },
        nodeId: { ...nstr, description: 'plan node this card teaches, if any' }
      },
      required: ['blocks']
    }
  },
  {
    name: 'ask',
    description:
      'Ask the learner one interactive question and wait for the answer. The app renders the interaction (mcq, numeric, free, order, fill), offers "I don\'t know", hints from your ladder, a confidence rating, and an optional spoken or typed explanation of their reasoning. It grades closed formats itself and free answers against your rubric, and records the evidence in the learner model. The result describes the answer, the grade, confidence, hints used, attempts, the reasoning and the misconceptions it revealed. kind: probe (diagnostic, neutral feedback), predict (before a reveal), check (after teaching), practice, review, reflect.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ASK_KINDS },
        title: nstr,
        blocks: { type: 'array', items: blockSchema, description: 'optional context shown above the question (0-2 blocks)' },
        interaction: interactionSchema,
        speech: nstr,
        nodeId: nstr
      },
      required: ['kind', 'blocks', 'interaction']
    }
  },
  {
    name: 'show_plan',
    description:
      'Show (or replace) the learning plan: a dependency tree of 3-8 reasoning steps from what the learner already knows up to the goal. It appears in the chat and in the side panel, where node status is tracked. Returns at once.',
    inputSchema: planSchema
  },
  {
    name: 'update_plan',
    description: 'Mark a plan node as the current one, done, shaky or needing more work. Returns at once.',
    inputSchema: {
      type: 'object',
      properties: { nodeId: str, status: { type: 'string', enum: ['current', 'done', 'shaky', 'needs_more'] } },
      required: ['nodeId', 'status']
    }
  },
  {
    name: 'read_script',
    description:
      "Read text from the learner's PDF of the lecture notes (German; formulas may be garbled by extraction). Give pages [first, last] (at most 4 pages) or a search query (a label like \"2.4.11\" or a German term) to find pages. Use it for the script's notation, labels and emphasis; never paste long passages to the learner.",
    inputSchema: {
      type: 'object',
      properties: {
        pages: { type: ['array', 'null'], items: { type: 'integer' }, description: '[first, last] PDF page numbers' },
        query: nstr
      },
      required: []
    }
  },
  {
    name: 'course',
    description:
      'Look up course concepts: details (summary, why it matters, prerequisites, what it enables, script pages, demos) for the given ids, or a search over titles and German terms.',
    inputSchema: {
      type: 'object',
      properties: { conceptIds: { type: ['array', 'null'], items: str }, query: nstr },
      required: []
    }
  },
  {
    name: 'learner',
    description:
      "Read the learner model: for each concept the status, mastery estimate, current recall probability, practice level, active and resolved misconceptions and notes, plus which concepts are due for spaced review. Omit conceptIds for an overview of everything with evidence and everything due.",
    inputSchema: { type: 'object', properties: { conceptIds: { type: ['array', 'null'], items: str } }, required: [] }
  },
  {
    name: 'update_learner',
    description:
      "Write to the learner model: notes on a concept (replaces your previous note), misconceptions observed (active) or now fixed (resolved), and rare stable profile observations about how this learner learns best. Answers from ask are recorded automatically; use this for what you concluded.",
    inputSchema: modelUpdateSchema
  },
  {
    name: 'finish',
    description: 'End the session with a short summary card: 2-4 key takeaways and the script pages to reread. Use it when the goal is reached or the learner wants to stop.',
    inputSchema: {
      type: 'object',
      properties: { takeaways: { type: 'array', items: str, description: 'Markdown with LaTeX ($...$ for math)' }, pages: { type: ['array', 'null'], items: { type: 'integer' } } },
      required: ['takeaways']
    }
  }
]

/** The teaching doctrine shared with the classic step loop, minus its JSON-output framing. */
function doctrine(): string {
  const start = CORE_RULES.indexOf('# How you teach')
  const phases = CORE_RULES.indexOf('# Phases')
  const levels = CORE_RULES.indexOf('# Difficulty levels')
  const model = CORE_RULES.indexOf('# Learner model updates')
  return `${CORE_RULES.slice(start, phases)}${CORE_RULES.slice(levels, model > levels ? model : undefined)}`
}

export type AgentMode = 'learn' | 'practice' | 'review' | 'open'

export interface AgentContext {
  mode: AgentMode
  goalConceptId: string | null
  scope: string[]
}

const FLOW = String.raw`# How a session runs
You talk with the learner in a chat. Your plain text replies appear as chat messages (Markdown with LaTeX, same rules as cards): keep them to one to three sentences (feedback, a transition, an answer to their question). All teaching content goes through the tools, which render interactive cards in the chat:
- explain: content (text, equations, plots, demos, mermaid, sketch, code, script references). Waits until read.
- ask: one question the learner answers in the card (kind probe, predict, check, practice, review, reflect). Waits for the answer and returns the graded result.
- show_plan / update_plan: the dependency tree of reasoning steps toward the goal, shown in a side panel.
- read_script, course, learner: look things up. update_learner: record what you concluded. finish: the closing summary.
Call tools one at a time and react to each result before the next step. Do not write a question in plain text when it should be an ask card; plain text is for short talk. When the learner writes in the chat instead of answering a card, the card's result says so: answer them first (briefly, a tool card if it needs a visual), then continue.

A learning session for a goal concept usually goes:
1. Probe: 1-3 ask cards of kind probe, cheap to answer, each on a different prerequisite or aspect. Neutral feedback; do not teach yet.
2. Plan: show_plan with 3-8 nodes (kind known/shaky/new/goal; requires must form a DAG; exactly one goal). Then one sentence on the approach.
3. Teach each node in order: update_plan current, then predict (ask) → explain (1-2 cards, building on the prediction) → check (ask, new surface). If a check fails, name the likely misconception, re-explain with a different representation, then a new check. update_plan done (or shaky).
4. Wrap: an ask of kind reflect (free, allowVoice, rubric, modelAnswer) to explain the chain in their own words, then finish.
Practice: pick items at the learner's level from the learner model (L1-L5), one ask per item with level and cue set, raise the level after successes, step back after failures. Review: start with concepts due for review. Open chat: follow the learner's lead but keep them doing the thinking.
Use update_learner when you learn something worth remembering across sessions (a note per concept, misconceptions, rare profile observations).`

export function buildAgentSystemPrompt(course: Course, graph: CourseGraph, learner: LearnerModel, ctx: AgentContext, now: Date): string {
  const intro = `You are Anamnesis, a one-to-one tutor for the ETH Zurich course "${course.title}" (${course.courseNumber}, lecture notes "${course.script?.title ?? 'the script'}", in German). You run inside a desktop learning app as an agent with tools that create the learning interface. Write in English; when you introduce a term, give the script's German term once in parentheses.`
  const out = [intro, '', FLOW, '', doctrine(), '']
  out.push('# Course concepts (id: title [chapter])')
  for (const c of course.concepts) out.push(`- ${c.id}: ${c.title} [${c.chapter}]`)
  out.push('', `Exam: ${course.exam.format}`, '', '# This session')
  if (ctx.mode === 'learn' && ctx.goalConceptId) {
    const g = graph.get(ctx.goalConceptId)
    out.push(`Mode: LEARN. Goal concept: ${g?.title ?? ctx.goalConceptId} (id ${ctx.goalConceptId}).`)
    if (g) out.push(`Summary: ${g.summary}`, `Why it matters: ${g.why}`, `Script: ${g.refs.join(', ') || 'no references'}${g.pages.length ? `; PDF pages ${g.pages[0]}-${g.pages[1]}` : ''}.`)
    const anc = graph.ancestors(ctx.goalConceptId, 3)
    if (anc.length) out.push(`Prerequisites (nearest first): ${anc.map((id) => `${id} (${graph.title(id)})`).join(', ')}`)
  } else if (ctx.mode === 'practice') out.push(`Mode: PRACTICE. Concepts in scope: ${ctx.scope.map((id) => `${id} (${graph.title(id)})`).join(', ') || 'whatever the learner model suggests'}.`)
  else if (ctx.mode === 'review') out.push('Mode: REVIEW. Start with the concepts due for spaced review (use the learner tool).')
  else out.push('Mode: OPEN. The learner says what they want; help them learn it actively.')
  const ids = new Set<string>([...(ctx.goalConceptId ? [ctx.goalConceptId, ...graph.ancestors(ctx.goalConceptId, 2)] : []), ...ctx.scope])
  if (ids.size) {
    out.push('', '# Learner model (relevant concepts; the learner tool has more)')
    for (const id of [...ids].filter((x) => graph.get(x)).slice(0, 20)) out.push(conceptModelLine(graph, learner.concepts[id], id, now))
  }
  if (learner.profile.length) {
    out.push('', '# Learner profile')
    for (const p of learner.profile.slice(-12)) out.push(`- ${p.text}${p.source === 'tutor' ? '' : ' (from the learner)'}`)
  }
  return out.join('\n')
}
