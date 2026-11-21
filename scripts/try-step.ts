// Manual end-to-end check of one tutor step against the real Claude Code CLI.
//   node_modules/.bin/jiti scripts/try-step.ts <conceptId> [phase] [pdfPath] [model] [effort]
// Prints timing, how early the first card was complete while streaming, and the normalized step.
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runClaude } from '../src/node/claudeCli'
import { CourseGraph } from '../src/shared/graph'
import { completeCardsFromPartial, normalizeStep } from '../src/shared/normalize'
import { buildStepPrompt, buildSystemPrompt, type StepTask } from '../src/shared/prompts'
import { stepSchema } from '../src/shared/schema'
import type { Course, LearnerModel, Session } from '../src/shared/types'
import { extractPages } from './script-text'

const [conceptId = 'barycentric', phase = 'probe', pdfPath, model = '', effort = 'medium'] = process.argv.slice(2)

const course = JSON.parse(await readFile(new URL('../courses/numcs/course.json', import.meta.url), 'utf8')) as Course
const graph = new CourseGraph(course)
const concept = graph.get(conceptId)
if (!concept) throw new Error(`unknown concept ${conceptId}`)
const learner: LearnerModel = {
  profile: [
    { id: 'p1', text: 'Linear algebra basics are rusty (inner products, orthonormal bases, change of basis).', source: 'seed', at: new Date().toISOString() },
    { id: 'p2', text: 'Wants the motivation (why) before formulas.', source: 'seed', at: new Date().toISOString() }
  ],
  concepts: {}
}
const session: Session = {
  id: 'try',
  type: 'learn',
  goalConceptId: conceptId,
  scope: [],
  startedAt: new Date().toISOString(),
  endedAt: null,
  phase: 'probe',
  steps: [],
  plan: null,
  currentNodeId: null,
  queue: [],
  itemsGoal: 0,
  chat: [],
  pointsEarned: 0,
  summary: null
}
const pages = pdfPath && concept.pages.length ? await extractPages(pdfPath, range(concept.pages[0], Math.min(concept.pages[1], concept.pages[0] + 5))) : []
const system = buildSystemPrompt(course, graph, session, pages)
const task: StepTask = { phase: phase as StepTask['phase'], probeRound: 1, allowPlanNow: false }
const prompt = buildStepPrompt(graph, learner, session, task, new Date())
console.log(`system ${system.length} chars, prompt ${prompt.length} chars, pages ${pages.map((p) => p.page).join(',')}`)

const workDir = join(tmpdir(), 'anamnesis-try')
mkdirSync(workDir, { recursive: true })
const ctx = { conceptIds: new Set(course.concepts.map((c) => c.id)), defaultConceptId: conceptId }
const t0 = Date.now()
let firstCardAt: number | null = null
let partials = 0
const res = await runClaude(
  { id: `try_${Date.now()}`, kind: 'step', system, prompt, schema: stepSchema, model, effort: effort as never },
  { path: null, model, effort: effort as never, fallbackModel: null, timeoutSec: 300, workDir },
  (e) => {
    if (e.type === 'partial') {
      partials++
      if (firstCardAt === null && completeCardsFromPartial(e.partial, ctx).length > 0) firstCardAt = Date.now() - t0
    } else if (e.type === 'status') console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${e.status}`)
  }
)
console.log(`ok=${res.ok} ${res.error ?? ''} total ${((Date.now() - t0) / 1000).toFixed(1)}s, first card complete at ${firstCardAt ? (firstCardAt / 1000).toFixed(1) + 's' : 'n/a'}, partial events ${partials}, cost $${res.costUsd?.toFixed(4)} model ${res.model}`)
if (res.ok) console.log(JSON.stringify(normalizeStep(res.data, ctx), null, 1))

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}
