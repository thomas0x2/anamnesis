// The tutor agent's tools and system prompt. The agent (Claude Code CLI) calls these through the
// app's MCP server; the app runs them in its UI: cards the learner answers, the plan panel, the
// learner model, the lecture notes. Card-like tools wait until the learner has answered.
import type { AgentToolDef } from './agentTypes'
import { CHEAT_KINDS } from './cheatsheet'
import { BREAK_IDEAS, BREAK_TOOL_NAME } from './studyTime'
import type { CourseGraph } from './graph'
import { conceptModelLine, conceptPlaces, coreRules } from './prompts'
import { blockSchema, interactionSchema, modelUpdateSchema, planSchema } from './schema'
import type { Course, LearnerModel, PracticeTarget } from './types'

type S = Record<string, unknown>
const str: S = { type: 'string' }
const nstr: S = { type: ['string', 'null'] }

const ASK_KINDS = ['probe', 'predict', 'check', 'practice', 'review', 'reflect']

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: 'explain',
    description:
      'Show the learner a short content card (text, equations, plots, interactive widgets, demos, diagrams, code, script references) with a Continue button. Waits until the learner has read it; the result says "read" or carries a question they typed instead. Keep it short: at most 3 blocks, prose under ~90 words.',
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
        blocks: { type: 'array', items: blockSchema, description: 'optional context shown above the question (0-2 blocks). Code the question asks about goes here as a code block (code.source); the prompt cannot show it otherwise.' },
        interaction: interactionSchema,
        speech: nstr,
        nodeId: { ...nstr, description: 'plan node this question belongs to (teaching), if any' },
        item: { type: ['integer', 'null'], description: 'practice/review: the number of the session item this question is for (see the item list)' }
      },
      required: ['kind', 'blocks', 'interaction']
    }
  },
  {
    name: 'show_plan',
    description:
      'Show the learning plan: a dependency tree of 3-8 reasoning steps from what the learner already knows up to the goal. The learner reviews it, can mark steps as already known or ask to have them taught, and confirms. Waits for that and returns which nodes to teach. The tree then stays in the side panel, where update_plan tracks progress.',
    inputSchema: planSchema
  },
  {
    name: 'update_plan',
    description: 'Mark a plan node as the current one, done, shaky or needing more work. Returns at once: call it in the same response as the next card.',
    inputSchema: {
      type: 'object',
      properties: { nodeId: str, status: { type: 'string', enum: ['current', 'done', 'shaky', 'needs_more'] } },
      required: ['nodeId', 'status']
    }
  },
  {
    name: 'read_script',
    description:
      "Read text from the learner's PDFs of the course materials (lecture notes, slides, problem sets; formulas may be garbled by extraction). Give pages [first, last] (at most 4 pages, page numbers as in the concept list) or a search query (a label like \"2.4.11\" or a term in the materials' language) to find pages. Use it for the materials' notation, labels and emphasis; never paste long passages to the learner.",
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
    name: 'platform_page',
    description:
      "Read the page the learner has open in the app's platform window (Code Expert, GitLab, Moodle…, where coding problem sets live): its URL, the code in its editors and its visible text (task statement, test results). Returns a note when no page is open: then ask the learner to open the task from Exam prep (\"Open in app\"). Use it when the learner asks about a coding task or their code there; read it again after they change the code. Never paste the whole statement back.",
    inputSchema: { type: 'object', properties: {}, required: [] }
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

/** Offered only when the course's exam allows a cheat sheet. Returns at once: the learner decides later. */
export const CHEATSHEET_TOOL: AgentToolDef = {
  name: 'suggest_cheatsheet',
  description:
    "Suggest 1-2 entries for the learner's exam cheat sheet (only offered when the exam allows one). Each appears as a small card in the stream that the learner can add to the sheet, edit or drop. Returns at once; carry on teaching. Use it right after the learner has worked with something that is costly to memorise exactly and cheap to look up (formulas, conditions, conventions, pitfalls, short procedures), never for core ideas they must understand.",
  inputSchema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...CHEAT_KINDS] },
            text: { type: 'string', description: 'the entry as it would stand on the sheet: compressed Markdown with LaTeX ($...$), one to three lines' },
            why: { type: 'string', description: 'one short sentence: why look it up rather than memorise it' },
            conceptIds: { type: 'array', items: { type: 'string' }, description: 'course concept ids it belongs to' }
          },
          required: ['kind', 'text']
        }
      }
    },
    required: ['suggestions']
  }
}

/** Offered when break suggestions are on. Returns at once; the app tells the tutor when the learner is back. */
export const BREAK_TOOL: AgentToolDef = {
  name: BREAK_TOOL_NAME,
  description:
    'Suggest a break to the learner: a small card in the stream with the length, your reason and an idea for the break, which they can start (a timer runs) or put off. Use it when the app says a break is due (at the next natural pause, never mid-question) or when the learner asks for one. Returns at once; then end your turn without a new card: the app tells you when they are back or skipped it.',
  inputSchema: {
    type: 'object',
    properties: {
      minutes: { type: 'integer', description: 'length of the break in minutes (use the one the app names)' },
      kind: { type: 'string', enum: ['short', 'long'] },
      reason: { type: 'string', description: 'one short sentence, e.g. "You have worked for 50 minutes and just finished the weights."' },
      idea: { type: 'string', enum: BREAK_IDEAS.map((x) => x.id), description: 'what to do: move, outside, rest (quiet rest, eyes closed; best right after learning something new), water' }
    },
    required: ['minutes', 'reason']
  }
}

/** The tools of a session: the cheat sheet tool only when the exam allows a sheet, the break tool when breaks are on. */
export function agentTools(opts: { cheatsheet: boolean; breaks?: boolean }): AgentToolDef[] {
  const extra = [...(opts.cheatsheet ? [CHEATSHEET_TOOL] : []), ...(opts.breaks ? [BREAK_TOOL] : [])]
  return extra.length ? [...AGENT_TOOLS, ...extra] : AGENT_TOOLS
}

/** The teaching doctrine shared with the classic step loop, minus its JSON-output framing. */
function doctrine(course: Course): string {
  const rules = coreRules(course)
  const start = rules.indexOf('# How you teach')
  const phases = rules.indexOf('# Phases')
  const levels = rules.indexOf('# Difficulty levels')
  const model = rules.indexOf('# Learner model updates')
  return `${rules.slice(start, phases)}${rules.slice(levels, model > levels ? model : undefined)}`
}

export type AgentMode = 'learn' | 'practice' | 'review' | 'open'

export interface AgentContext {
  mode: AgentMode
  goalConceptId: string | null
  scope: string[]
  /** practice and review items the app selected */
  queue?: PracticeTarget[]
  /** the exam date and the problem sets and mock exams done (exam preparation) */
  examPrep?: string | null
  /** the cheat sheet section (rules, what is on it), when the exam allows a sheet */
  cheatsheet?: string | null
  /** the breaks section (the learner's rhythm), when break suggestions are on */
  breaks?: string | null
}

const FLOW = String.raw`# How a session runs
The learner works through a stream of cards, one at a time; you create every card with a tool, on the fly, from what their answers show. Your plain text appears as short tutor notes between the cards (Markdown with LaTeX, same rules as cards): one to three sentences (a transition, a reaction, an answer to their question). The learner can also write to you at any time. The tools:
- explain: content (text, equations, plots, widgets you build, built-in demos, mermaid, code, script references). Waits until read.
- ask: one question the learner answers in the card (kind probe, predict, check, practice, review, reflect). Waits for the answer and returns the graded result.
- show_plan: the dependency tree of reasoning steps toward the goal; the learner reviews it (marks steps as known or to be taught) and you get the result. update_plan: progress in the side panel.
- suggest_break (when offered): a break card when one is due or the learner asks for one.
- read_script, course, learner: look things up. platform_page: the coding task (and the learner's code) open in the app's platform window. update_learner: record what you concluded. finish: the closing summary.
Show one card at a time (explain, ask, show_plan) and react to its result before the next step. Every round trip to you makes the learner wait, so do not spend one on bookkeeping: tools that return at once without telling you anything new (update_plan, update_learner, suggest_cheatsheet) go in the same response as the next card, called before it. For example, after a passed check, call update_plan done, update_plan current for the next node and the next ask together. Lookups you need at the same time (read_script, course, learner) can also go together in one response. Do not write a question in plain text when it should be an ask card; plain text is for short talk. When the learner writes in the chat instead of answering a card, the card's result says so: answer them first (briefly, a tool card if it needs a visual), then continue.

A learning session for a goal concept usually goes:
1. Probe: 1-3 ask cards of kind probe, cheap to answer, each on a different prerequisite or aspect. Neutral feedback; do not teach yet.
   Ask the probes one by one and let each answer shape the next; a second round is fine when the first leaves the picture unclear.
2. Plan: show_plan with 3-8 nodes (kind known/shaky/new/goal; requires must form a DAG; exactly one goal). Teach only the nodes the learner left to be taught.
3. Teach each node in order: update_plan current, then predict (ask) → explain (1-2 cards, building on the prediction) → check (ask, new surface). Set nodeId on these cards. If a check fails, name the likely misconception, re-explain with a different representation, then a new check. update_plan done (or shaky).
4. Wrap: an ask of kind reflect (free, allowVoice, rubric, modelAnswer) to explain the chain in their own words, then finish.
Practice and review: the app picked the items (spacing and difficulty staircase) and lists them below. One ask per item, in order, kind practice or review, with item set to the item number and the item's level and cue. After a failed review item, explain briefly, then a fresh question on the same item. Finish after the last item. Open chat: follow the learner's lead but keep them doing the thinking.
Use update_learner when you learn something worth remembering across sessions (a note per concept, misconceptions, rare profile observations).`

export function buildAgentSystemPrompt(course: Course, graph: CourseGraph, learner: LearnerModel, ctx: AgentContext, now: Date): string {
  const builtin = course.builtin || course.id === 'numcs'
  const lang = course.language ?? course.script?.language ?? 'en'
  const langName = ({ en: 'English', de: 'German', fr: 'French', it: 'Italian' } as Record<string, string>)[lang] ?? lang
  const intro = builtin
    ? `You are Anamnesis, a one-to-one tutor for the ETH Zurich course "${course.title}" (${course.courseNumber}, lecture notes "${course.script?.title ?? 'the script'}", in German). You run inside a desktop learning app as an agent with tools that create the learning interface. Write in English; when you introduce a term, give the script's German term once in parentheses.`
    : `You are Anamnesis, a one-to-one tutor for the course "${course.title}"${course.courseNumber ? ` (${course.courseNumber})` : ''}${course.lecturer ? `, ${course.lecturer}` : ''}. The course materials (script, slides, problem sets) are the learner's own PDFs${lang !== 'en' ? `, in ${langName}` : ''}; read_script reads them by page number. You run inside a desktop learning app as an agent with tools that create the learning interface. Write in English${lang !== 'en' ? `; when you introduce a term, give the materials' ${langName} term once in parentheses` : ''}.`
  const out = [intro, '', FLOW, '', doctrine(course), '']
  out.push('# Course concepts (id: title [chapter])')
  for (const c of course.concepts) out.push(`- ${c.id}: ${c.title} [${c.chapter}]`)
  out.push('', `Exam: ${course.exam.format}`)
  if (ctx.examPrep) out.push(`Exam preparation: ${ctx.examPrep} Shape practice toward the exam when it is close.`)
  if (ctx.cheatsheet) out.push('', ctx.cheatsheet)
  if (ctx.breaks) out.push('', ctx.breaks)
  out.push('', '# This session')
  if (ctx.mode === 'learn' && ctx.goalConceptId) {
    const g = graph.get(ctx.goalConceptId)
    out.push(`Mode: LEARN. Goal concept: ${g?.title ?? ctx.goalConceptId} (id ${ctx.goalConceptId}).`)
    if (g) out.push(`Summary: ${g.summary}`, `Why it matters: ${g.why}`, `Script: ${g.refs.join(', ') || 'no references'}${conceptPlaces(g) ? `; ${conceptPlaces(g)}` : ''}.`)
    const anc = graph.ancestors(ctx.goalConceptId, 3)
    if (anc.length) out.push(`Prerequisites (nearest first): ${anc.map((id) => `${id} (${graph.title(id)})`).join(', ')}`)
  } else if (ctx.mode === 'practice') out.push(`Mode: PRACTICE. Concepts in scope: ${ctx.scope.map((id) => `${id} (${graph.title(id)})`).join(', ') || 'whatever the learner model suggests'}.`)
  else if (ctx.mode === 'review') out.push('Mode: REVIEW (spaced review of what is due).')
  else out.push('Mode: OPEN. The learner says what they want; help them learn it actively.')
  if ((ctx.mode === 'practice' || ctx.mode === 'review') && ctx.queue?.length) {
    out.push('', 'Items (number: concept, level, cue, mode, compose with):')
    ctx.queue.forEach((q, i) =>
      out.push(`${i + 1}. ${q.conceptId} (${graph.title(q.conceptId)}), L${q.level}, cue ${q.cue}, ${q.mode}${q.compose.length ? `, with ${q.compose.join(', ')}` : ''}`)
    )
  }
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
