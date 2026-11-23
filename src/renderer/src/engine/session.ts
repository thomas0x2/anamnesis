// One tutoring session: the phase machine (probe → plan → teach → wrap, or practice/review items),
// card-level interaction state (attempts, hints, grading) and the model calls behind it.
import { conceptRanges } from "@shared/courseMap";
import { fakeGenerate } from "@shared/fakeTutor";
import {
  combineWithReasoning,
  gradeFill,
  gradeMcq,
  gradeNumeric,
  gradeOrder,
  MIN_REASONING_CHARS,
  type LocalGrade,
} from "@shared/grading";
import { effectiveScore } from "@shared/mastery";
import {
  completeCardsFromPartial,
  normalizeChat,
  normalizeGrade,
  normalizeStep,
  type NormalizeContext,
} from "@shared/normalize";
import {
  buildChatPrompt,
  buildGradePrompt,
  buildReasoningGradePrompt,
  buildStepPrompt,
  buildSystemPrompt,
  type StepTask,
} from "@shared/prompts";
import { milestoneReward, selfCheckReward } from "@shared/rewards";
import { chatSchema, gradeSchema, stepSchema } from "@shared/schema";
import { makeTarget, practiceQueue, reviewQueue } from "@shared/selection";
import type {
  Card,
  CardResponse,
  LlmEvent,
  LlmKind,
  LlmRequest,
  LlmResult,
  Plan,
  PlanNodeState,
  PracticeTarget,
  Session,
  SessionSummary,
  StepRecord,
  TutorStep,
  Verdict,
} from "@shared/types";
import { nowIso, truncate, uid } from "@shared/util";
import type { AppController } from "./app";
import { createStore, type Store } from "./store";

export type AnswerPayload =
  | { kind: "mcq"; selected: string[] }
  | { kind: "numeric"; value: string }
  | { kind: "order"; order: string[] }
  | { kind: "fill"; values: Record<string, string> }
  | { kind: "free"; text: string }
  | { kind: "continue" }
  | { kind: "dontknow" };

export interface CardDraft {
  attempts: number;
  hintsUsed: number;
  revealed: boolean;
  startedAt: number;
  confidence: number | null;
  feedback: string[];
  verdict: Verdict | null;
  score: number | null;
  grading: boolean;
  done: boolean;
  missing: string[];
}

export interface SessionView {
  session: Session;
  cursor: { step: number; card: number };
  drafts: Record<string, CardDraft>;
  status: { label: string; tokens: number; startedAt: number } | null;
  error: { message: string; kind: string; canRetry: boolean } | null;
  planReview: boolean;
  chatBusy: boolean;
}

export const MAX_ATTEMPTS: Record<Card["kind"], number> = {
  probe: 1,
  predict: 1,
  check: 3,
  practice: 3,
  review: 3,
  reflect: 2,
  explain: 1,
  summary: 1,
  message: 1,
};

const emptyStep = (): TutorStep => ({
  assessment: null,
  cards: [],
  plan: null,
  model: null,
  control: { next: "continue", nodeId: null, nodeStatus: null },
});

export const draftKey = (step: number, card: number): string =>
  `${step}:${card}`;

/** A step generation that can start before it is needed (speculation) and be attached later. */
interface Generation {
  key: string;
  reqId: string;
  task: StepTask;
  partial: unknown;
  status: LlmEvent | null;
  listeners: Set<(e: LlmEvent) => void>;
  result: Promise<LlmResult>;
}

export function taskKey(t: StepTask): string {
  const g = t.target;
  return [
    t.phase,
    t.nodeId ?? "",
    t.attempt ?? "",
    t.itemIndex ?? "",
    g?.conceptId ?? "",
    g?.level ?? "",
    g?.cue ?? "",
    g?.mode ?? "",
    t.relearn ? 1 : 0,
  ].join("|");
}

function initialCursor(s: Session): { step: number; card: number } {
  for (let i = 0; i < s.steps.length; i++) {
    const rec = s.steps[i];
    for (let j = 0; j < rec.step.cards.length; j++)
      if (!rec.responses[j]) return { step: i, card: j };
  }
  const last = s.steps.length - 1;
  return last >= 0
    ? { step: last, card: s.steps[last].step.cards.length }
    : { step: 0, card: 0 };
}

/** How a tutor agent drives a session instead of the step loop (see engine/chat.ts). */
export interface AgentHooks {
  onCardDone: (step: number, card: number, resp: CardResponse) => void;
  onPlanConfirmed: (nodeState: Record<string, PlanNodeState>) => void;
  retry: () => Promise<void>;
}

export class SessionController {
  readonly view: Store<SessionView>;
  private system: string | null = null;
  private readonly ctx: NormalizeContext;
  private inflight = new Set<string>();
  private lastFailed: StepTask | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private stepRunning = false;
  private runToken = 0;
  private spec: Generation | null = null;

  constructor(
    private app: AppController,
    session: Session,
    /** cards come from a tutor agent instead of the step loop: report each finished card back */
    private external: AgentHooks | null = null,
  ) {
    this.ctx = {
      conceptIds: new Set(app.course.concepts.map((c) => c.id)),
      defaultConceptId: session.goalConceptId ?? session.scope[0] ?? null,
    };
    // a step that was still streaming when the app closed: keep what arrived, or drop it
    const steps = session.steps
      .map((r) => (r.pending ? { ...r, pending: false } : r))
      .filter((r) => r.step.cards.length > 0 || r.step.plan);
    const s = { ...session, steps };
    this.view = createStore<SessionView>({
      session: s,
      cursor: initialCursor(s),
      drafts: {},
      status: null,
      error: null,
      planReview:
        s.phase === "plan" &&
        !!s.plan &&
        !s.plan.confirmed &&
        this.allAnswered(s),
      chatBusy: false,
    });
  }

  get s(): Session {
    return this.view.get().session;
  }

  // ------------------------------------------------------------ persistence
  private patch(fn: (s: Session) => Session): void {
    this.view.set((v) => ({ ...v, session: fn(v.session) }));
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 500);
  }

  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const s = this.s;
    await this.app.backend.writeJson(`sessions/${s.id}`, s);
  }

  async pause(): Promise<void> {
    this.dropSpec();
    for (const id of this.inflight)
      await this.app.backend.cancel(id).catch(() => {});
    await this.save();
  }

  addPoints(n: number): void {
    this.patch((s) => ({ ...s, pointsEarned: s.pointsEarned + n }));
  }

  private updateStep(index: number, fn: (r: StepRecord) => StepRecord): void {
    this.patch((s) => ({
      ...s,
      steps: s.steps.map((r, i) => (i === index ? fn(r) : r)),
    }));
  }

  private setStatus(label: string | null): void {
    this.view.set((v) => ({
      ...v,
      status: label
        ? {
            label,
            tokens: v.status?.tokens ?? 0,
            startedAt: v.status?.startedAt ?? Date.now(),
          }
        : null,
    }));
  }

  // ------------------------------------------------------------ model calls
  private systemPrompt(): string {
    if (!this.system) {
      const settings = this.app.settings.get();
      const goal = this.s.goalConceptId
        ? this.app.graph.get(this.s.goalConceptId)
        : null;
      const range = goal ? conceptRanges(goal)[0] : undefined;
      const pages =
        settings.script.sendPages && range
          ? this.app.script.range(range, settings.script.maxPages)
          : [];
      this.system = buildSystemPrompt(
        this.app.course,
        this.app.graph,
        this.s,
        pages,
      );
    }
    return this.system;
  }

  private generate(
    kind: LlmKind,
    prompt: string,
    schema: Record<string, unknown>,
    meta: Record<string, unknown>,
    onEvent?: (e: LlmEvent) => void,
  ): { id: string; result: Promise<LlmResult> } {
    const settings = this.app.settings.get();
    const req: LlmRequest = {
      id: uid("rq_"),
      kind,
      system: this.systemPrompt(),
      prompt,
      schema,
      model: settings.cli.model,
      effort: kind === "step" ? settings.cli.effort : "low",
      meta,
    };
    this.inflight.add(req.id);
    const run = async (): Promise<LlmResult> => {
      try {
        const fake =
          settings.provider === "demo" || this.app.backend.kind === "demo";
        return fake
          ? await fakeGenerate(req, onEvent)
          : await this.app.backend.generate(req, onEvent);
      } catch (e) {
        return { id: req.id, ok: false, errorKind: "other", error: String(e) };
      } finally {
        this.inflight.delete(req.id);
      }
    };
    return { id: req.id, result: run() };
  }

  private stepMeta(task: StepTask): Record<string, unknown> {
    const node = this.s.plan?.plan.nodes.find((n) => n.id === task.nodeId);
    const conceptId = task.target?.conceptId ?? this.s.goalConceptId;
    return {
      phase: task.phase,
      nodeId: task.nodeId ?? null,
      nodeTitle: node?.title,
      conceptId,
      conceptTitle: conceptId ? this.app.graph.title(conceptId) : undefined,
      level: task.target?.level,
      attempt: task.attempt,
      round: task.probeRound,
      itemIndex: task.itemIndex,
    };
  }

  private startGeneration(task: StepTask, speculative: boolean): Generation {
    const prompt = buildStepPrompt(
      this.app.graph,
      this.app.state.get().learner,
      this.s,
      speculative ? { ...task, speculative: true } : task,
      new Date(),
    );
    const gen: Generation = {
      key: taskKey(task),
      reqId: "",
      task,
      partial: null,
      status: null,
      listeners: new Set(),
      result: Promise.resolve({ id: "", ok: false }),
    };
    const g = this.generate(
      "step",
      prompt,
      stepSchema,
      { ...this.stepMeta(task), speculative },
      (e) => {
        if (e.type === "partial") gen.partial = e.partial;
        else if (e.type === "status") gen.status = e;
        for (const l of gen.listeners) l(e);
      },
    );
    gen.reqId = g.id;
    gen.result = g.result;
    return gen;
  }

  /** What comes next if the learner gets the current step right: prepared while they work on it. */
  private predictNext(): StepTask | null {
    const s = this.s;
    const last = s.steps[s.steps.length - 1];
    if (!last || last.pending || s.phase === "done") return null;
    if (
      s.phase === "teach" &&
      s.plan?.confirmed &&
      last.phase === "teach" &&
      last.nodeId
    ) {
      if (last.step.control.nodeStatus === "needs_more") return null;
      const next = s.plan.plan.nodes.find(
        (n) =>
          n.id !== last.nodeId &&
          (s.plan!.nodeState[n.id] ?? "pending") === "pending",
      );
      return next
        ? { phase: "teach", nodeId: next.id, attempt: 1 }
        : { phase: "wrap" };
    }
    if ((s.phase === "practice" || s.phase === "review") && last.target) {
      const items = s.steps.filter((r) => r.target).length;
      if (items >= s.itemsGoal || items >= s.queue.length) return null;
      return this.itemTask(items);
    }
    return null;
  }

  private maybeSpeculate(): void {
    if (this.spec || this.stepRunning) return;
    const next = this.predictNext();
    if (next) this.spec = this.startGeneration(next, true);
  }

  private dropSpec(): void {
    const sp = this.spec;
    this.spec = null;
    if (sp) void this.app.backend.cancel(sp.reqId).catch(() => {});
  }

  // ------------------------------------------------------------ flow
  async start(): Promise<void> {
    const s = this.s;
    if (s.phase === "done" || this.external) return;
    if (s.type !== "learn" && !s.queue.length) {
      const now = new Date();
      const learner = this.app.state.get().learner;
      const queue =
        s.type === "practice"
          ? practiceQueue(this.app.graph, learner, s.scope, s.itemsGoal, now)
          : reviewQueue(this.app.graph, learner, now, s.itemsGoal);
      if (!queue.length) {
        this.view.set((v) => ({
          ...v,
          error: {
            message:
              s.type === "review"
                ? "Nothing is due for review right now."
                : "Nothing to practice yet: learn a concept first.",
            kind: "empty",
            canRetry: false,
          },
        }));
        await this.finish();
        return;
      }
      this.patch((x) => ({
        ...x,
        queue,
        itemsGoal: Math.min(x.itemsGoal || queue.length, queue.length),
      }));
    }
    if (!this.s.steps.length) return this.runStep(this.firstTask());
    if (this.view.get().planReview) return;
    if (this.allAnswered(this.s)) return this.afterStepComplete();
  }

  private firstTask(): StepTask {
    const s = this.s;
    if (s.type === "learn")
      return { phase: "probe", probeRound: 1, allowPlanNow: false };
    return this.itemTask(0);
  }

  private itemTask(index: number): StepTask {
    const s = this.s;
    const q = s.queue[index] ?? s.queue[s.queue.length - 1];
    const learner = this.app.state.get().learner;
    // practice targets are rebuilt so that a level change earlier in the session applies; review and relearn
    // items keep their queued target (a review sits one level below practice, at most L3, with a shifted cue)
    const target: PracticeTarget =
      s.type === "review" || q.mode === "relearn"
        ? q
        : makeTarget(this.app.graph, learner, q.conceptId, index);
    const settings = this.app.settings.get();
    const c = this.app.graph.get(target.conceptId);
    const range = c ? conceptRanges(c)[0] : undefined;
    const targetPages =
      settings.script.sendPages && range
        ? this.app.script.range(
            [range[0], Math.min(range[1], range[0] + 2)],
            3,
          )
        : [];
    return {
      phase: s.type === "review" ? "review" : "practice",
      target,
      itemIndex: index,
      itemsGoal: s.itemsGoal,
      relearn: q.mode === "relearn",
      targetPages,
    };
  }

  private allAnswered(s: Session): boolean {
    const last = s.steps[s.steps.length - 1];
    return (
      !!last &&
      !last.pending &&
      last.step.cards.every((_, i) => !!last.responses[i])
    );
  }

  private stepComplete(index: number): boolean {
    const r = this.s.steps[index];
    return !!r && !r.pending && r.step.cards.every((_, i) => !!r.responses[i]);
  }

  private async runStep(task: StepTask, isRetry = false): Promise<void> {
    if (this.stepRunning) return;
    const token = ++this.runToken;
    this.stepRunning = true;
    try {
      await this.runStepInner(task, isRetry);
    } finally {
      if (this.runToken === token) this.stepRunning = false;
    }
    if (this.runToken !== token) return; // superseded (the learner changed the plan mid-stream)
    // if the learner answered every streamed card before the stream ended, move on now
    const last = this.s.steps.length - 1;
    if (
      last >= 0 &&
      this.stepComplete(last) &&
      !this.view.get().planReview &&
      this.s.phase !== "done"
    )
      await this.afterStepComplete();
    else this.maybeSpeculate();
  }

  private async runStepInner(task: StepTask, isRetry: boolean): Promise<void> {
    const app = this.app;
    let gen: Generation;
    const key = taskKey(task);
    if (this.spec && this.spec.key === key) {
      gen = this.spec;
      this.spec = null;
    } else {
      this.dropSpec();
      gen = this.startGeneration(task, false);
    }
    const rec: StepRecord = {
      id: uid("st_"),
      phase: task.phase,
      nodeId: task.nodeId ?? null,
      target: task.target ?? null,
      step: emptyStep(),
      responses: {},
      createdAt: nowIso(),
      completedAt: null,
      durationMs: null,
      model: null,
      pending: true,
    };
    this.view.set((v) => {
      const steps = [...v.session.steps, rec];
      const index = steps.length - 1;
      const prev = v.session.steps[index - 1];
      const atEnd =
        !prev ||
        (v.cursor.step === index - 1 &&
          v.cursor.card >= prev.step.cards.length) ||
        v.cursor.step >= index;
      return {
        ...v,
        error: null,
        session: {
          ...v.session,
          steps,
          currentNodeId: task.nodeId ?? v.session.currentNodeId,
        },
        cursor: atEnd ? { step: index, card: 0 } : v.cursor,
        status: { label: "Starting…", tokens: 0, startedAt: Date.now() },
      };
    });
    const index = this.s.steps.length - 1;
    const t0 = Date.now();
    const onEvent = (e: LlmEvent): void => {
      if (e.type === "partial") {
        const cards = completeCardsFromPartial(e.partial, this.ctx);
        const cur = this.s.steps[index];
        if (cur && cur.id === rec.id && cards.length > cur.step.cards.length)
          this.updateStep(index, (r) => ({
            ...r,
            step: {
              ...r.step,
              cards: [...r.step.cards, ...cards.slice(r.step.cards.length)],
            },
          }));
      } else if (e.type === "status") {
        const label =
          e.status === "started"
            ? "Claude is reading your model…"
            : e.status === "thinking"
              ? "Thinking…"
              : e.status === "writing"
                ? "Writing cards…"
                : (e.status ?? "");
        this.view.set((v) => ({
          ...v,
          status: {
            label,
            tokens: v.status?.tokens ?? 0,
            startedAt: v.status?.startedAt ?? Date.now(),
          },
        }));
      } else if (e.type === "thinking")
        this.view.set((v) =>
          v.status
            ? { ...v, status: { ...v.status, tokens: e.tokens ?? 0 } }
            : v,
        );
    };
    gen.listeners.add(onEvent);
    if (gen.status) onEvent(gen.status);
    if (gen.partial) onEvent({ id: "", type: "partial", partial: gen.partial });
    const res = await gen.result;
    gen.listeners.delete(onEvent);
    const cur = this.s.steps[index];
    if (!cur || cur.id !== rec.id) return; // cancelled and replaced
    if (!res.ok) {
      this.setStatus(null);
      if (res.errorKind === "cancelled") {
        this.removeStep(index);
        return;
      }
      if (cur.step.cards.length) {
        this.updateStep(index, (r) => ({ ...r, pending: false }));
        this.lastFailed = task;
        this.view.set((v) => ({
          ...v,
          error: {
            message: `The tutor stopped early (${res.error}). Continue with what arrived, then retry.`,
            kind: res.errorKind ?? "other",
            canRetry: true,
          },
        }));
        return;
      }
      this.removeStep(index);
      if (
        !isRetry &&
        (res.errorKind === "invalid" ||
          res.errorKind === "other" ||
          res.errorKind === "timeout")
      )
        return this.runStepInner(task, true);
      this.lastFailed = task;
      this.view.set((v) => ({
        ...v,
        error: {
          message: errorText(res),
          kind: res.errorKind ?? "other",
          canRetry: true,
        },
      }));
      return;
    }
    let step = normalizeStep(res.data, this.ctx);
    if (!step.cards.length && !step.plan) {
      this.removeStep(index);
      if (!isRetry) return this.runStepInner(task, true);
      this.lastFailed = task;
      this.view.set((v) => ({
        ...v,
        error: {
          message: "The tutor returned no usable cards.",
          kind: "invalid",
          canRetry: true,
        },
      }));
      return;
    }
    // cards the learner may already be answering keep their identity
    const streamed = this.s.steps[index].step.cards;
    if (streamed.length)
      step = {
        ...step,
        cards: [...streamed, ...step.cards.slice(streamed.length)],
      };
    this.updateStep(index, (r) => ({
      ...r,
      step,
      pending: false,
      durationMs: Date.now() - t0,
      model: res.model ?? null,
    }));
    this.setStatus(null);
    app.applyModelUpdate(step.model);
    if (step.plan && (task.phase === "plan" || task.phase === "probe"))
      this.setPlan(step.plan);
  }

  private removeStep(index: number): void {
    this.view.set((v) => {
      const steps = v.session.steps.filter((_, i) => i !== index);
      const cursor =
        v.cursor.step >= steps.length
          ? {
              step: Math.max(0, steps.length - 1),
              card: steps.length
                ? steps[steps.length - 1].step.cards.length
                : 0,
            }
          : v.cursor;
      return { ...v, session: { ...v.session, steps }, cursor };
    });
  }

  get agentDriven(): boolean {
    return !!this.external;
  }

  /** Agent mode: what the tutor is doing right now (null when it waits for the learner). */
  setAgentStatus(label: string | null): void {
    this.setStatus(label);
  }

  setAgentError(error: SessionView["error"]): void {
    this.view.set((v) => ({ ...v, error }));
  }

  /** Agent mode: the phase follows the tools the agent uses. */
  setPhase(phase: Session["phase"], currentNodeId?: string | null): void {
    if (this.s.phase === "done") return;
    this.patch((s) => ({
      ...s,
      phase,
      ...(currentNodeId !== undefined ? { currentNodeId } : {}),
    }));
  }

  /** Agent mode: show a plan for review (the agent waits until the learner confirms it). */
  showPlan(plan: Plan): void {
    this.setPlan(plan);
    this.view.set((v) => ({ ...v, planReview: true }));
  }

  setNodeState(id: string, state: PlanNodeState): void {
    const p = this.s.plan;
    if (!p) return;
    const nodeState = { ...p.nodeState };
    if (state === "active")
      for (const k of Object.keys(nodeState))
        if (nodeState[k] === "active") nodeState[k] = "pending";
    nodeState[id] = state;
    this.patch((s) => ({
      ...s,
      plan: { ...p, nodeState },
      ...(state === "active" ? { currentNodeId: id, phase: "teach" as const } : {}),
    }));
  }

  setQueue(queue: PracticeTarget[], itemsGoal: number): void {
    this.patch((s) => ({ ...s, queue, itemsGoal }));
  }

  async retry(): Promise<void> {
    if (this.external) {
      this.view.set((v) => ({ ...v, error: null }));
      return this.external.retry();
    }
    const t = this.lastFailed;
    this.view.set((v) => ({ ...v, error: null }));
    if (t) {
      this.lastFailed = null;
      await this.runStep(t);
    } else await this.afterStepComplete();
  }

  private setPlan(plan: Plan): void {
    const nodeState: Record<string, PlanNodeState> = {};
    for (const n of plan.nodes)
      nodeState[n.id] = n.kind === "known" ? "known" : "pending";
    this.patch((s) => ({
      ...s,
      phase: "plan",
      plan: { plan, nodeState, attempts: {}, confirmed: false },
    }));
  }

  private nextNode(): string | null {
    const p = this.s.plan;
    if (!p) return null;
    return (
      p.plan.nodes.find((n) => (p.nodeState[n.id] ?? "pending") === "pending")
        ?.id ?? null
    );
  }

  private nodePassed(rec: StepRecord): boolean {
    const checks = rec.step.cards
      .map((c, i) => ({ c, r: rec.responses[i] }))
      .filter(
        (x) =>
          x.c.kind === "check" &&
          x.c.interaction &&
          x.c.interaction.type !== "continue",
      );
    if (!checks.length) return rec.step.control.nodeStatus !== "needs_more";
    return checks.every(
      (x) =>
        x.r &&
        effectiveScore(
          x.r.score ?? 0,
          x.r.hintsUsed,
          x.r.attempts,
          x.r.revealed,
        ) >= 0.6,
    );
  }

  private async afterStepComplete(): Promise<void> {
    const s = this.s;
    const last = s.steps[s.steps.length - 1];
    if (!last || s.phase === "done") return;
    this.updateStep(s.steps.length - 1, (r) => ({
      ...r,
      completedAt: r.completedAt ?? nowIso(),
    }));
    switch (s.phase) {
      case "probe": {
        const rounds = s.steps.filter((r) => r.phase === "probe").length;
        if (last.step.control.next === "phase_done" || rounds >= 2) {
          this.patch((x) => ({ ...x, phase: "plan" }));
          return this.runStep({ phase: "plan" });
        }
        return this.runStep({
          phase: "probe",
          probeRound: rounds + 1,
          allowPlanNow: true,
        });
      }
      case "plan": {
        if (!s.plan) return this.runStep({ phase: "plan" });
        if (!s.plan.confirmed) {
          this.view.set((v) => ({ ...v, planReview: true }));
          // start writing the first lesson while the learner looks at the plan
          const first = this.nextNode();
          if (first && last.phase !== "teach")
            void this.runStep({ phase: "teach", nodeId: first, attempt: 1 });
        }
        return;
      }
      case "teach": {
        const nodeId = last.nodeId;
        const plan = s.plan;
        if (nodeId && plan && last.phase === "teach") {
          const attempts = (plan.attempts[nodeId] ?? 0) + 1;
          const passed = this.nodePassed(last);
          const state: PlanNodeState = passed
            ? "done"
            : attempts >= 2
              ? "shaky"
              : "active";
          this.patch((x) => ({
            ...x,
            plan: x.plan
              ? {
                  ...x.plan,
                  attempts: { ...x.plan.attempts, [nodeId]: attempts },
                  nodeState: { ...x.plan.nodeState, [nodeId]: state },
                }
              : x.plan,
          }));
          if (state === "active")
            return this.runStep({
              phase: "teach",
              nodeId,
              attempt: attempts + 1,
            });
        }
        const next = this.nextNode();
        if (next)
          return this.runStep({ phase: "teach", nodeId: next, attempt: 1 });
        const goal = s.goalConceptId
          ? this.app.graph.title(s.goalConceptId)
          : "the goal";
        this.app.addRewards([
          milestoneReward("plan_done", goal, {
            conceptId: s.goalConceptId,
            sessionId: s.id,
            now: new Date(),
          }),
        ]);
        this.patch((x) => ({ ...x, phase: "wrap" }));
        return this.runStep({ phase: "wrap" });
      }
      case "wrap":
        return this.finish();
      case "practice":
      case "review": {
        const items = s.steps.filter((r) => r.target).length;
        if (
          s.type === "review" &&
          last.target &&
          last.target.mode !== "relearn"
        ) {
          const r = last.responses[last.step.cards.length - 1];
          const eff = r
            ? effectiveScore(r.score ?? 0, r.hintsUsed, r.attempts, r.revealed)
            : 1;
          if (eff < 0.5 && s.queue.length < s.itemsGoal + 5) {
            const relearn: PracticeTarget = {
              ...last.target,
              mode: "relearn",
              level: 1,
              cue: "shifted",
            };
            this.patch((x) => {
              const q = x.queue.slice();
              q.splice(Math.min(items + 1, q.length), 0, relearn);
              return { ...x, queue: q, itemsGoal: x.itemsGoal + 1 };
            });
          }
        }
        if (items >= this.s.itemsGoal || items >= this.s.queue.length)
          return this.finish();
        return this.runStep(this.itemTask(items));
      }
    }
  }

  async confirmPlan(
    overrides: Record<string, "known" | "teach">,
  ): Promise<void> {
    const p = this.s.plan;
    if (!p) return;
    const nodeState = { ...p.nodeState };
    for (const [id, o] of Object.entries(overrides))
      nodeState[id] = o === "known" ? "known" : "pending";
    this.patch((s) => ({
      ...s,
      phase: "teach",
      plan: { ...p, nodeState, confirmed: true },
    }));
    this.view.set((v) => ({ ...v, planReview: false }));
    if (this.external) {
      this.external.onPlanConfirmed(nodeState);
      return;
    }
    const after = this.nextNode();
    const last = this.s.steps.length - 1;
    const prefetched = this.s.steps[last];
    if (prefetched?.phase === "teach" && prefetched.nodeId === after) {
      this.maybeSpeculate();
      return;
    }
    // the learner changed the path: drop the prefetched lesson and write the right one
    if (prefetched?.phase === "teach") {
      for (const id of this.inflight)
        await this.app.backend.cancel(id).catch(() => {});
      this.removeStep(last);
      this.runToken++;
      this.stepRunning = false;
    }
    if (after)
      await this.runStep({ phase: "teach", nodeId: after, attempt: 1 });
    else {
      this.patch((s) => ({ ...s, phase: "wrap" }));
      await this.runStep({ phase: "wrap" });
    }
  }

  // ------------------------------------------------------------ cards
  draft(step: number, card: number): CardDraft {
    const d = this.view.get().drafts[draftKey(step, card)];
    if (d) return d;
    const r = this.s.steps[step]?.responses[card];
    return {
      attempts: r?.attempts ?? 0,
      hintsUsed: r?.hintsUsed ?? 0,
      revealed: r?.revealed ?? false,
      startedAt: Date.now(),
      confidence: r?.confidence ?? null,
      feedback: r?.feedback ? [r.feedback] : [],
      verdict: r?.verdict ?? null,
      score: r?.score ?? null,
      grading: false,
      done: !!r,
      missing: r?.missing ?? [],
    };
  }

  private setDraft(
    step: number,
    card: number,
    patch: Partial<CardDraft>,
  ): void {
    const key = draftKey(step, card);
    const cur = this.draft(step, card);
    this.view.set((v) => ({
      ...v,
      drafts: { ...v.drafts, [key]: { ...cur, ...patch } },
    }));
  }

  /** Mark a card as seen (starts its latency clock). */
  touch(step: number, card: number): void {
    if (!this.view.get().drafts[draftKey(step, card)])
      this.setDraft(step, card, {});
  }

  hint(step: number, card: number): void {
    const c = this.s.steps[step]?.step.cards[card];
    const d = this.draft(step, card);
    if (!c?.interaction || d.done) return;
    this.setDraft(step, card, {
      hintsUsed: Math.min(c.interaction.hints.length, d.hintsUsed + 1),
    });
  }

  reveal(step: number, card: number): void {
    const d = this.draft(step, card);
    if (d.done) return;
    this.complete(step, card, {
      answer: null,
      answerText: "gave up and looked at the solution",
      score: 0,
      verdict: "incorrect",
      revealed: true,
      feedback: null,
    });
  }

  async answer(
    step: number,
    card: number,
    payload: AnswerPayload,
    confidence: number | null = null,
    reasoningInput = "",
  ): Promise<void> {
    const rec = this.s.steps[step];
    const c = rec?.step.cards[card];
    if (!rec || !c) return;
    const it = c.interaction;
    const d = this.draft(step, card);
    if (d.done || d.grading) return;
    const conf = d.confidence ?? confidence;
    if (conf !== d.confidence) this.setDraft(step, card, { confidence: conf });
    if (payload.kind === "continue" || !it || it.type === "continue") {
      this.complete(step, card, {
        answer: null,
        answerText: "read",
        score: null,
        verdict: "seen",
        feedback: null,
      });
      return;
    }
    if (payload.kind === "dontknow") {
      if (c.kind === "probe" || c.kind === "predict") {
        this.complete(step, card, {
          answer: null,
          answerText: "I don't know",
          score: c.kind === "probe" ? 0 : null,
          verdict: "dontknow",
          feedback: null,
        });
      } else if (d.hintsUsed < it.hints.length) this.hint(step, card);
      else this.reveal(step, card);
      return;
    }
    let g: LocalGrade | null = null;
    let answerText = "";
    let misconceptions: string[] = [];
    switch (payload.kind) {
      case "mcq": {
        g = gradeMcq(it, payload.selected);
        answerText =
          payload.selected
            .map(
              (id) =>
                `${id}) ${truncate(it.options?.find((o) => o.id === id)?.md ?? id, 80)}`,
            )
            .join("; ") || "(nothing selected)";
        const wrong = payload.selected.filter(
          (id) => !it.options?.find((o) => o.id === id)?.correct,
        );
        misconceptions = (it.misconceptions ?? [])
          .filter((m) => wrong.includes(m.optionId))
          .map((m) => m.text);
        break;
      }
      case "numeric":
        g = gradeNumeric(it, payload.value);
        answerText = payload.value;
        break;
      case "order":
        g = gradeOrder(it.items ?? [], payload.order);
        answerText = payload.order
          .map((x, i) => `${i + 1}. ${truncate(x, 50)}`)
          .join(" ");
        break;
      case "fill":
        g = gradeFill(it, payload.values);
        answerText = Object.entries(payload.values)
          .map(([k, v]) => `[${k}] = ${v}`)
          .join(", ");
        break;
      case "free": {
        answerText = payload.text.trim();
        if (c.kind === "probe" || c.kind === "predict") {
          this.complete(step, card, {
            answer: payload.text,
            answerText,
            score: null,
            verdict: "seen",
            feedback: null,
          });
          return;
        }
        this.setDraft(step, card, { grading: true });
        const attempt = d.attempts + 1;
        const res = await this.generate(
          "grade",
          buildGradePrompt(
            c,
            answerText,
            attempt,
            d.feedback.join(" ") || null,
          ),
          gradeSchema,
          { answer: answerText },
        ).result;
        if (!res.ok) {
          this.setDraft(step, card, {
            grading: false,
            feedback: [
              `Could not grade this right now (${res.error}). Try again, or compare with the model answer.`,
            ],
          });
          return;
        }
        const gr = normalizeGrade(res.data);
        this.app.recordFreeMisconceptions(
          it.conceptIds[0] ?? this.s.goalConceptId,
          gr.misconceptions,
        );
        g = {
          score: gr.score,
          verdict: gr.verdict,
          feedback: [gr.feedback].filter(Boolean),
        };
        this.setDraft(step, card, { grading: false, missing: gr.missing });
        break;
      }
    }
    if (!g) return;
    // Spoken or typed reasoning behind a closed-format answer is graded too and changes the rating.
    const reasoning =
      payload.kind !== "free" &&
      reasoningInput.trim().length >= MIN_REASONING_CHARS
        ? reasoningInput.trim()
        : null;
    if (reasoning) {
      this.setDraft(step, card, { grading: true });
      const prompt = buildReasoningGradePrompt(
        c,
        answerText,
        g.verdict === "correct",
        reasoning,
        d.attempts + 1,
        d.feedback.join(" ") || null,
      );
      const res = await this.generate("grade", prompt, gradeSchema, {
        answer: reasoning,
      }).result;
      if (res.ok) {
        const gr = normalizeGrade(res.data);
        g = combineWithReasoning(g, gr);
        misconceptions = [...misconceptions, ...gr.misconceptions];
        this.setDraft(step, card, { grading: false, missing: gr.missing });
      } else {
        this.setDraft(step, card, { grading: false });
        g = {
          ...g,
          feedback: [
            ...g.feedback,
            `Your reasoning could not be checked right now (${res.error}), so only the answer counted.`,
          ],
        };
      }
      answerText = `${answerText} | reasoning: ${truncate(reasoning, 400)}`;
    }
    const attempts = d.attempts + 1;
    const finalNow =
      g.verdict === "correct" || attempts >= MAX_ATTEMPTS[c.kind];
    if (finalNow) {
      this.complete(step, card, {
        answer: payload,
        answerText,
        score: g.score,
        verdict: g.verdict,
        attempts,
        feedback: g.feedback.join(" ") || null,
        misconceptions,
        missing: this.draft(step, card).missing,
        reasoning,
      });
    } else {
      this.setDraft(step, card, {
        attempts,
        feedback: g.feedback,
        verdict: g.verdict,
        score: g.score,
      });
      if (misconceptions.length)
        this.app.recordFreeMisconceptions(
          rec.target?.conceptId ?? it.conceptIds[0] ?? null,
          misconceptions,
        );
    }
  }

  private complete(
    step: number,
    card: number,
    f: {
      answer: unknown;
      answerText: string;
      score: number | null;
      verdict: Verdict;
      attempts?: number;
      revealed?: boolean;
      feedback: string | null;
      misconceptions?: string[];
      missing?: string[];
      reasoning?: string | null;
    },
  ): void {
    const rec = this.s.steps[step];
    const c = rec?.step.cards[card];
    if (!rec || !c) return;
    const d = this.draft(step, card);
    const resp: CardResponse = {
      answer: f.answer,
      answerText: f.answerText,
      score: f.score,
      verdict: f.verdict,
      attempts: Math.max(
        1,
        f.attempts ?? d.attempts + (f.verdict === "seen" ? 0 : 1),
      ),
      hintsUsed: d.hintsUsed,
      revealed: f.revealed ?? false,
      confidence: d.confidence,
      latencyMs: Date.now() - d.startedAt,
      feedback: f.feedback,
      missing: f.missing ?? null,
      ...(f.reasoning ? { reasoning: f.reasoning } : {}),
      at: nowIso(),
    };
    this.updateStep(step, (r) => ({
      ...r,
      responses: { ...r.responses, [card]: resp },
    }));
    this.setDraft(step, card, {
      done: true,
      attempts: resp.attempts,
      revealed: resp.revealed,
      verdict: resp.verdict,
      score: resp.score,
      feedback: f.feedback ? [f.feedback] : d.feedback,
    });
    this.app.recordCard(this.s, c, resp, rec.target, f.misconceptions ?? []);
    if (this.external) {
      this.external.onCardDone(step, card, resp);
      return;
    }
    if (
      this.stepComplete(step) &&
      step === this.s.steps.length - 1 &&
      !this.stepRunning
    )
      void this.afterStepComplete();
  }

  /** Agent mode: append cards the agent made as a new step; returns the step index. */
  pushStep(
    cards: Card[],
    nodeId: string | null = null,
    target: PracticeTarget | null = null,
  ): number {
    const index = this.s.steps.length;
    // move on to the new card only once the learner is past the previous one
    const { cursor } = this.view.get();
    const prev = this.s.steps[index - 1];
    const atEnd =
      index === 0 ||
      cursor.step >= index ||
      (cursor.step === index - 1 && cursor.card >= (prev?.step.cards.length ?? 0));
    const rec: StepRecord = {
      id: uid("st_"),
      phase: this.s.phase === "chat" ? "chat" : this.s.phase,
      nodeId,
      target,
      step: { ...emptyStep(), cards },
      responses: {},
      createdAt: nowIso(),
      completedAt: null,
      durationMs: null,
      model: null,
    };
    this.patch((s) => ({ ...s, steps: [...s.steps, rec] }));
    if (atEnd) this.view.set((v) => ({ ...v, cursor: { step: index, card: 0 } }));
    return index;
  }

  /** The learner compares an open prediction with the reveal. */
  selfCheck(
    step: number,
    card: number,
    value: "right" | "partly" | "wrong",
  ): void {
    const rec = this.s.steps[step];
    const r = rec?.responses[card];
    if (!rec || !r || r.selfCheck === value) return;
    const first = !r.selfCheck;
    this.updateStep(step, (x) => ({
      ...x,
      responses: { ...x.responses, [card]: { ...r, selfCheck: value } },
    }));
    const c = rec.step.cards[card];
    const conceptId = c?.interaction?.conceptIds[0] ?? this.s.goalConceptId;
    if (first && value === "right")
      this.app.addRewards([selfCheckReward(conceptId, this.s.id, new Date())]);
  }

  /** Move the cursor past the current card (after the learner read its feedback). */
  advance(): void {
    this.view.set((v) => {
      const { step, card } = v.cursor;
      const rec = v.session.steps[step];
      if (!rec) return v;
      if (card + 1 < rec.step.cards.length || rec.pending)
        return { ...v, cursor: { step, card: card + 1 } };
      if (v.session.steps[step + 1])
        return { ...v, cursor: { step: step + 1, card: 0 } };
      return { ...v, cursor: { step, card: rec.step.cards.length } };
    });
  }

  // ------------------------------------------------------------ side questions
  async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || this.view.get().chatBusy) return;
    this.patch((s) => ({
      ...s,
      chat: [...s.chat, { role: "user", text: q, at: nowIso() }],
    }));
    this.view.set((v) => ({ ...v, chatBusy: true }));
    const { step, card } = this.view.get().cursor;
    const current = this.s.steps[step]?.step.cards[card] ?? null;
    const res = await this.generate(
      "chat",
      buildChatPrompt(
        this.app.graph,
        this.app.state.get().learner,
        this.s,
        q,
        current,
        new Date(),
      ),
      chatSchema,
      { question: q },
    ).result;
    const reply = res.ok
      ? normalizeChat(res.data)
      : {
          blocks: [
            {
              type: "text" as const,
              md: `I could not answer right now: ${res.error}`,
            },
          ],
          speech: null,
        };
    const text = reply.blocks.map((b) => b.md ?? b.latex ?? "").join("\n");
    this.patch((s) => ({
      ...s,
      chat: [
        ...s.chat,
        { role: "tutor", text, blocks: reply.blocks, at: nowIso() },
      ],
    }));
    this.view.set((v) => ({ ...v, chatBusy: false }));
  }

  // ------------------------------------------------------------ end
  async finish(): Promise<void> {
    const s = this.s;
    if (s.phase === "done" && s.summary) return;
    this.dropSpec();
    const responses = s.steps
      .flatMap((r) => r.step.cards.map((c, i) => ({ c, r: r.responses[i] })))
      .filter(
        (x) =>
          x.r &&
          x.r.score !== null &&
          x.c.kind !== "probe" &&
          x.c.kind !== "predict",
      );
    const conceptIds = [
      ...new Set(
        s.steps.flatMap((r) =>
          r.step.cards.flatMap((c) => c.interaction?.conceptIds ?? []),
        ),
      ),
    ].filter((id) => this.app.graph.get(id));
    const title =
      s.type === "chat"
        ? `Tutor chat: ${s.goalConceptId ? this.app.graph.title(s.goalConceptId) : "open"}`
        : s.type === "learn"
        ? `Learn: ${s.goalConceptId ? this.app.graph.title(s.goalConceptId) : ""}`
        : s.type === "practice"
          ? `Practice (${s.queue.length ? this.app.graph.title(s.queue[0].conceptId) : "mixed"}…)`
          : "Spaced review";
    const summary: SessionSummary = {
      id: s.id,
      type: s.type,
      goalConceptId: s.goalConceptId,
      title,
      startedAt: s.startedAt,
      endedAt: nowIso(),
      items: responses.length,
      correct: responses.filter((x) => (x.r!.score ?? 0) >= 0.8).length,
      points: s.pointsEarned,
      conceptIds,
    };
    this.patch((x) => ({
      ...x,
      phase: "done",
      endedAt: summary.endedAt,
      summary,
    }));
    this.view.set((v) => ({ ...v, status: null, planReview: false }));
    await this.save();
    await this.app.finishSession(this.s, summary);
  }
}

function errorText(res: LlmResult): string {
  switch (res.errorKind) {
    case "not_found":
      return "The Claude Code CLI was not found. Open Settings to set its path.";
    case "auth":
      return "Claude Code is not logged in. Run `claude` once in a terminal and log in, then retry.";
    case "rate_limit":
      return `Claude is busy or your usage limit was reached: ${res.error}`;
    case "timeout":
      return "The tutor took too long. Retry, or pick a faster model in Settings.";
    default:
      return res.error ?? "Something went wrong.";
  }
}
