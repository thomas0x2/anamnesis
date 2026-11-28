// Course graph and plan-tree utilities.
import { conceptOrder, type ExamContext } from './ordering'
import type { Course, CourseConcept, LearnerModel, Plan, PlanNode } from './types'

export class CourseGraph {
  readonly byId: Map<string, CourseConcept>
  readonly children: Map<string, string[]>
  readonly order: Map<string, number>

  constructor(readonly course: Course) {
    this.byId = new Map(course.concepts.map((c) => [c.id, c]))
    this.children = new Map(course.concepts.map((c) => [c.id, [] as string[]]))
    for (const c of course.concepts) for (const r of c.requires) this.children.get(r)?.push(c.id)
    this.order = new Map(course.concepts.map((c, i) => [c.id, i]))
  }

  get(id: string): CourseConcept | undefined {
    return this.byId.get(id)
  }

  title(id: string): string {
    return this.byId.get(id)?.title ?? id
  }

  /** Prerequisites up to `depth` levels, nearest first. */
  ancestors(id: string, depth = 99): string[] {
    const out: string[] = []
    const seen = new Set([id])
    let frontier = [id]
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = []
      for (const f of frontier)
        for (const r of this.byId.get(f)?.requires ?? []) {
          if (!seen.has(r)) {
            seen.add(r)
            out.push(r)
            next.push(r)
          }
        }
      frontier = next
    }
    return out
  }

  descendants(id: string, depth = 99): string[] {
    const out: string[] = []
    const seen = new Set([id])
    let frontier = [id]
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = []
      for (const f of frontier)
        for (const c of this.children.get(f) ?? []) {
          if (!seen.has(c)) {
            seen.add(c)
            out.push(c)
            next.push(c)
          }
        }
      frontier = next
    }
    return out
  }

  /** Concepts sharing a prerequisite with `id` (useful distractor and interleaving partners). */
  siblings(id: string): string[] {
    const out = new Set<string>()
    for (const r of this.byId.get(id)?.requires ?? []) for (const c of this.children.get(r) ?? []) if (c !== id) out.add(c)
    return [...out]
  }

  /**
   * Concepts that are ready to learn (not yet developing, all prerequisites at least developing), best first.
   * With the course's materials and exam prep, the order puts what the problem sets and mock exams need first;
   * see ordering.ts, which the study plan uses too.
   */
  frontier(model: LearnerModel, exam: ExamContext | null = null): string[] {
    return conceptOrder(this.course.concepts, model, exam)
  }

  chapterConcepts(ch: number): CourseConcept[] {
    return this.course.concepts.filter((c) => c.chapter === ch)
  }
}

/** Make a model-written plan safe: unique ids, known requires, no cycles, exactly one goal, topological order. */
export function sanitizePlan(plan: Plan): Plan {
  const seen = new Set<string>()
  let nodes: PlanNode[] = []
  for (const raw of plan.nodes ?? []) {
    let id = String(raw.id || '').trim() || `n${nodes.length + 1}`
    while (seen.has(id)) id = id + "'"
    seen.add(id)
    nodes.push({ ...raw, id, requires: [...new Set((raw.requires ?? []).map(String))] })
  }
  const ids = new Set(nodes.map((n) => n.id))
  nodes = nodes.map((n) => ({ ...n, requires: n.requires.filter((r) => ids.has(r) && r !== n.id) }))
  // break cycles by dropping back-edges found in DFS order
  const state = new Map<string, number>()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visit = (id: string): void => {
    state.set(id, 1)
    const n = byId.get(id)!
    n.requires = n.requires.filter((r) => {
      if (state.get(r) === 1) return false
      if (!state.get(r)) visit(r)
      return true
    })
    state.set(id, 2)
  }
  for (const n of nodes) if (!state.get(n.id)) visit(n.id)
  const goals = nodes.filter((n) => n.kind === 'goal')
  if (goals.length === 0 && nodes.length) nodes[nodes.length - 1].kind = 'goal'
  if (goals.length > 1) for (const g of goals.slice(0, -1)) g.kind = 'new'
  return { ...plan, nodes: topoSort(nodes) }
}

export function topoSort(nodes: PlanNode[]): PlanNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: PlanNode[] = []
  const done = new Set<string>()
  const visit = (n: PlanNode, stack: Set<string>): void => {
    if (done.has(n.id) || stack.has(n.id)) return
    stack.add(n.id)
    for (const r of n.requires) {
      const m = byId.get(r)
      if (m) visit(m, stack)
    }
    stack.delete(n.id)
    done.add(n.id)
    out.push(n)
  }
  for (const n of nodes) visit(n, new Set())
  return out
}
