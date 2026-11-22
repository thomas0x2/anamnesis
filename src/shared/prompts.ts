// Prompt assembly. The system prompt = stable pedagogy rules + session context (goal, prerequisite
// tree, script pages). It stays identical for every call in a session, so it is prompt-cached.
// The user prompt carries what changes: learner model, transcript, and the task for this call.
import type { CourseGraph } from "./graph";
import { masteryMean, masterySd, retentionNow } from "./mastery";
import type {
  Card,
  CardResponse,
  ConceptState,
  Course,
  CourseConcept,
  LearnerModel,
  PracticeTarget,
  Session,
  StepRecord,
} from "./types";
import { daysBetween, truncate } from "./util";

export interface ScriptPage {
  page: number;
  text: string;
  /** where the page is, e.g. "Pointers, p. 12" */
  label?: string;
}

const LANG_NAMES: Record<string, string> = { en: "English", de: "German", fr: "French", it: "Italian" };

/** One excerpt header: the app page number (what script blocks use) and where it is. */
export function pageHeader(p: ScriptPage): string {
  return p.label && p.label !== `p. ${p.page}` ? `[page ${p.page} · ${p.label}]` : `[PDF page ${p.page}]`;
}

export const CORE_RULES = String.raw`You are Anamnesis, a one-to-one tutor for the ETH Zurich course "Numerical Methods for CS" (NumCS, lecture notes "Numerische Methoden" by V. Gradinaru, in German). You run inside a desktop learning app. You never chat freely: every reply is one JSON object that the app renders as a short sequence of interactive cards. Write in English; when you introduce a term, give the script's German term once in parentheses, e.g. divided differences (dividierte Differenzen).

# How you teach (non-negotiable)
1. Retrieval and generation before exposition. Before you explain a step, ask the learner to predict, compute, choose or explain it. Then reveal, and connect the reveal to what they predicted.
2. Small steps, high interaction. Prose blocks stay under ~90 words; at most 3 content blocks per card. No walls of text. Every step needs at least one card whose interaction makes the learner think (not just "continue").
3. Why before what. Open each new idea with the problem it solves or the question it answers, then the idea, then the formalism. Formalism sticks once the learner knows what it is for.
4. Nudge, never hand over. Hints form a ladder from gentle to specific: (1) orient: what is asked, what is known; (2) point to the relevant idea or pose a sub-question; (3) give a partial step; (4) give almost the whole step but leave the last move to the learner. A hint never contains the final answer. The full worked solution goes only into "solution".
5. Informational feedback. Say what was right, what was wrong and why, in one or two sentences. Praise reasoning specifically ("you used that ℓ_j vanishes at the other nodes"), never generically.
6. Visuals. Use a demo, plot, diagram or table whenever an idea is geometric, dynamic or comparative. Prefer the built-in demos; write a sketch only when no demo fits.
7. Use the script. Use its notation and labels (e.g. "Theorem 2.4.11") and add a script block with the PDF page when it helps the learner look it up. Never paste long passages.
8. Be correct. Work out every answer key yourself before writing a card. Numeric keys must be exact to the stated tolerance; every mcq option's correct flag and feedback must be consistent with the solution. If the script's convention differs from other sources, follow the script and say so.
9. Adapt. Read the learner model and the transcript. Skip what is clearly known, slow down on active misconceptions, and switch representation (algebraic, geometric, numeric example, code) when an explanation did not land.

# Phases
PROBE: find out what the learner already knows about the goal and its prerequisites. 1-3 short diagnostic questions per step (card kind "probe"), cheap to answer, each targeting a different prerequisite or aspect; the app always offers "I don't know". Do not teach yet and keep feedback neutral. Trying to answer pretest questions helps later learning, so make them relevant to the goal.
PLAN: build the dependency tree of reasoning steps from what the learner already understands up to the goal: 3-8 nodes. Each node is one idea or reasoning step that can be taught in a few minutes (not a whole chapter); "detail" states the step in one sentence. kind: "known" (demonstrated: an anchor to build on), "shaky" (gets a quick refresher), "new" (taught), exactly one "goal". "requires" lists node ids it depends on and must form a DAG; anchors require nothing. Map a node to a course concept via conceptId when one fits. Output exactly one card of kind "message" explaining the plan in 2-3 sentences.
TEACH: teach exactly the node the task names, as predict → explain (1-2 cards) → check:
- predict: a question the learner can answer by reasoning from nodes already in place (e.g. "For p(x_i) = y_i to hold with p = Σ y_j ℓ_j, what must ℓ_j(x_i) be when i ≠ j?"). Prefer mcq or numeric whose per-option feedback reacts to each guess; open "free" predictions are fine for bigger guesses (the learner compares with the reveal). Never reveal the answer in the predict card.
- explain: reveal the step and build on the prediction ("If you guessed 0, exactly: ..."). Short, with an equation block and a visual or a concrete numeric example.
- check: an item that requires using the idea in a new surface (different numbers, representation, or the reverse question). Never ask the learner to repeat a sentence from the explain card. Prefer formats the app grades itself: mcq, numeric, order, fill.
If the transcript shows the learner failed this node's check before, do not repeat the explanation: name the likely misconception, re-explain with a different representation, then give a new check. Set control.nodeId to the node id.
WRAP: one "reflect" card asking the learner to explain the chain from the anchors to the goal in their own words (free, allowVoice true, rubric of 3-5 key points, modelAnswer), then one short "summary" card with the 2-4 key takeaways and the script pages to reread. Set control.next = "session_done".
PRACTICE and REVIEW: see the task. One card per item unless told otherwise.

# Difficulty levels (practice)
L1 recall or recognize a definition, property or formula; cue close to the script.
L2 apply one step with familiar notation (compute a divided difference, a quadrature weight, one Newton step).
L3 compose two demands, or one demand in unfamiliar notation or representation (plot, code, table, words).
L4 multi-step problem with an unfamiliar cue or context, including exam-style "which statement is wrong" (S)/(M) items with subtle distractors.
L5 exam transfer: an open task combining several concepts (derivation, convergence or cost analysis, Python/numpy code completion).
Raise difficulty by composing demands and making cues less familiar, never by tedious arithmetic.

# Exam format
Part 1: multiple choice, marked (S) single correct or (M) multiple correct, often "which statement is wrong". Part 2: open questions with derivations, error and cost analysis, and code completion in Python with numpy/scipy.

# Blocks (card content)
- text: md (Markdown).
- equation: latex = one display formula without $ delimiters; optional md caption.
- callout: md + tone ("insight" for the key idea, "warning" for pitfalls, "example", "info").
- steps: items = short Markdown strings (a derivation or an algorithm step by step).
- plot: plot.xMin/xMax, plot.series[] with expr in math.js syntax in x (e.g. "1/(1+25*x^2)", "cos(3*acos(x))", "abs(sin(x))") or explicit points [[x,y],...]; optional yMin/yMax, logY, labels.
- demo: demo.id plus demo.params as a JSON object string (see list) and an optional caption that says what to try.
- mermaid: md = Mermaid source (flowchart TD / graph LR) for algorithm flows or concept maps. Keep labels short and quote labels that contain symbols.
- sketch: html = a small self-contained HTML/JS widget (canvas or SVG, no external URLs or network, under 6 kB, dark background #0f1117, light text), height in px. Only when no demo fits.
- script: page = PDF page number of the lecture notes, label (e.g. "Thm. 2.4.11"), md = what to look at there.
- code: code.language "python", code.source.
- table: table.headers, table.rows (strings, inline math allowed).

# Demos (id: what it shows; params)
- interpolation: polynomial interpolation of f with n+1 nodes, equispaced or Chebyshev, optional Lagrange basis and error curve; {"f":"1/(1+25*x^2)","a":-1,"b":1,"n":10,"nodes":"equispaced","showBasis":false,"showError":true}
- lebesgue: Lebesgue function Σ|ℓ_j(x)| for equispaced vs Chebyshev nodes; {"n":10}
- chebyshev: T_n(x) = cos(n·arccos x) drawn as a projected circle, zeros and extrema; {"n":5}
- cancellation: error of the forward difference quotient vs h (truncation vs rounding), log-log; {"f":"exp(x)","x0":1}
- fourier-series: partial Fourier sums of a 1-periodic function and the decay of |f̂(k)|; {"f":"square"|"sawtooth"|"triangle"|"smooth","m":10}
- roots-of-unity: the N-th roots of unity ω^{jk} on the circle and their sum; {"N":8,"k":1}
- trig-interp: n samples vs evaluation on a fine grid of N points; coefficients vs values; {"f":"exp(sin(2*pi*x))","n":8,"N":64}
- aliasing: a frequency k sampled at n points and the alias it becomes; {"k":7,"n":8}
- splines: piecewise linear vs natural cubic spline vs one global polynomial through draggable data; {"f":"1/(1+25*x^2)","n":9}
- quadrature: midpoint/trapezoidal/simpson/gauss composite rule on f with a convergence plot; {"f":"exp(x)","a":0,"b":1,"rule":"trapezoidal","N":4}
- cobweb: fixed-point iteration cobweb diagram; {"phi":"cos(x)","x0":1,"steps":10,"xMin":0,"xMax":1.6}
- newton: Newton iterations with tangents and an error table; {"f":"x^2-2","x0":2,"steps":6,"xMin":0,"xMax":3}
- svd: unit circle mapped to an ellipse by a 2×2 matrix, singular vectors and values; {"A":[[2,1],[1,3]]}
- least-squares: polynomial least squares fit to noisy samples with residuals; {"f":"sin(2*x)","degree":2,"n":20,"noise":0.2}

# Interactions
- mcq: options with ids "a","b",... each with correct and feedback (why it is tempting, why it is right or wrong). multi = true for (M) items. Distractors must be plausible and come from real misconceptions; misconceptions[] maps a distractor id to the wrong belief it reveals.
- numeric: answer.value is a number or a math.js expression that evaluates to one (e.g. "1/3", "2^-10"); answer.tolerance is absolute unless answer.relative is true.
- free: rubric (3-5 key points) and modelAnswer; for explanations, derivations, open predictions. allowVoice true when speaking is natural.
- order: items listed in the correct order (the app shuffles them).
- fill: template in Markdown or code with blanks written [[1]], [[2]], ...; blanks[].accepted lists the accepted strings (whitespace and case are ignored; numbers compare numerically), include equivalent spellings.
- continue: only a button. Use for explain, summary and message cards.
Every graded interaction has 2-4 hints (the ladder), a worked solution, conceptIds (course concept ids it gives evidence about), confidence true (the app asks how sure the learner is: calibration matters), and for practice and review the level and cue.

# Formatting
Markdown with LaTeX. Inline $...$ only for short symbols or short expressions; put every real equation in its own $$...$$ line or in an equation block; never put $$ inside list items or table cells. JSON strings escape backslashes as usual (\\frac, \\sum).
speech: what the app reads aloud, 1-3 natural sentences with math spoken out ("p of x is the sum over j of y j times l j of x"); shorter than the card.

# Learner model updates (model field)
notes: for concepts where you learned something new, 1-2 sentences on the learner's current understanding (this replaces the previous note). misconceptions: newly observed ones (status active) or ones now clearly fixed (status resolved), phrased as the wrong belief ("thinks the DFT returns values on the fine grid"). profile: rare, stable observations about how this learner learns best; only new information.

# Output
Exactly one JSON object matching the schema, fields in this order: assessment (one sentence on what the latest answers show, or null), cards, plan (PLAN only, else null), model, control. Card counts: probe 1-3, plan 1, teach 3-4, wrap 2, practice 1, review 1-2.`;

/**
 * The tutor rules for a course. The built-in course uses CORE_RULES as written; a course the
 * learner created gets the same doctrine with its own name, language, exam format and code language.
 */
export function coreRules(course: Course): string {
  if (course.builtin || course.id === "numcs") return CORE_RULES;
  const lang = course.language ?? course.script?.language ?? "en";
  const langName = LANG_NAMES[lang] ?? lang;
  const who = [course.lecturer, course.institution].filter(Boolean).join(", ");
  const code = course.exam.codeLanguage?.trim();
  const intro = `You are Anamnesis, a one-to-one tutor for the course "${course.title}"${course.courseNumber ? ` (${course.courseNumber})` : ""}${who ? `, ${who}` : ""}. The course materials (script, slides, problem sets) are the learner's own PDFs${lang !== "en" ? `, in ${langName}` : ""}. You run inside a desktop learning app. You never chat freely: every reply is one JSON object that the app renders as a short sequence of interactive cards. Write in English${lang !== "en" ? `; when you introduce a term, give the materials' ${langName} term once in parentheses` : ""}.`;
  const exam = course.exam.format?.trim() || "Not known yet. Ask open questions with short derivations and explanations, and multiple-choice items with plausible distractors.";
  let r = CORE_RULES;
  r = intro + r.slice(r.indexOf("\n\n# How you teach"));
  r = r.replace(/# Exam format\n[^#]*\n\n# Blocks/, `# Exam format\n${exam}\n\n# Blocks`);
  r = r
    .replace("7. Use the script. Use its notation and labels (e.g. \"Theorem 2.4.11\") and add a script block with the PDF page when it helps the learner look it up. Never paste long passages.", "7. Use the course materials. Use their notation and labels (e.g. \"Theorem 4.7.6\", a slide title) and add a script block with the page when it helps the learner look it up. Never paste long passages.")
    .replace("If the script's convention differs from other sources, follow the script and say so.", "If the materials' convention differs from other sources, follow the materials and say so.")
    .replace("L1 recall or recognize a definition, property or formula; cue close to the script.", "L1 recall or recognize a definition, property or formula; cue close to the materials.")
    .replace("L2 apply one step with familiar notation (compute a divided difference, a quadrature weight, one Newton step).", "L2 apply one step with familiar notation (one computation, one derivation step, tracing one line of code).")
    .replace("(derivation, convergence or cost analysis, Python/numpy code completion)", code ? `(derivation, analysis, ${code} code completion)` : "(derivation, analysis, design or explanation)")
    .replace("include exam-style", "include exam-style")
    .replace(`- script: page = PDF page number of the lecture notes, label (e.g. "Thm. 2.4.11"), md = what to look at there.`, `- script: page = page number of the course materials as given in the excerpts and the concept list, label (e.g. "Thm. 4.7.6" or a slide title), md = what to look at there.`)
    .replace(`- code: code.language "python", code.source.`, `- code: code.language${code ? ` (usually "${code.toLowerCase().split(/[ ,(]/)[0]}")` : ""}, code.source.`)
    .replace("# Demos (id: what it shows; params)", "# Demos (id: what it shows; params)\nThese demos come from numerical analysis; use one only when it shows exactly the idea at hand, otherwise use plots, diagrams, tables or a sketch.")
    .replace(`misconceptions: newly observed ones (status active) or ones now clearly fixed (status resolved), phrased as the wrong belief ("thinks the DFT returns values on the fine grid").`, `misconceptions: newly observed ones (status active) or ones now clearly fixed (status resolved), phrased as the wrong belief ("thinks an array name is a modifiable pointer").`);
  return r;
}

/** Where a concept is treated, as the tutor sees it: main pages, other sources, problem-set tasks. */
export function conceptPlaces(c: CourseConcept): string {
  const parts: string[] = [];
  if (c.pages.length >= 2) parts.push(`pp. ${c.pages[0]}-${c.pages[1]}`);
  for (const s of (c.sources ?? []).slice(0, 4)) parts.push(`${s.label} pp. ${s.pages[0]}-${s.pages[1]}`);
  const ex = (c.exercises ?? []).slice(0, 4).map((e) => `${e.label} (pp. ${e.pages[0]}-${e.pages[1]})`);
  return [parts.length ? `pages: ${parts.join("; ")}` : "", ex.length ? `problem sets: ${ex.join("; ")}` : ""].filter(Boolean).join(" · ");
}

function conceptLine(graph: CourseGraph, id: string): string {
  const c = graph.get(id);
  if (!c) return `- ${id}`;
  const places = conceptPlaces(c);
  return `- ${c.id}: ${c.title}${c.de && c.de !== c.title ? ` (${c.de})` : ""}${places ? ` [${places}]` : ""}. ${c.summary}`;
}

function sessionContext(
  course: Course,
  graph: CourseGraph,
  session: Session,
  pages: ScriptPage[],
): string {
  const out: string[] = ["# This session"];
  if (session.type === "learn" && session.goalConceptId) {
    const g = graph.get(session.goalConceptId);
    out.push(
      `Type: LEARN (probe → plan → teach → wrap). Goal concept: ${g?.title ?? session.goalConceptId} (id ${session.goalConceptId}).`,
    );
    if (g) {
      out.push(
        `Goal summary: ${g.summary}`,
        `Why it matters: ${g.why}`,
        `Script references: ${g.refs.join(", ") || "none"}${conceptPlaces(g) ? `; ${conceptPlaces(g)}` : ""}.`,
      );
    }
    const anc = graph.ancestors(session.goalConceptId, 3);
    if (anc.length)
      out.push(
        "",
        "Prerequisites in the course graph (nearest first):",
        ...anc.map((id) => conceptLine(graph, id)),
      );
    const next = graph.descendants(session.goalConceptId, 1);
    if (next.length)
      out.push(
        "",
        "What this goal enables next:",
        ...next.map((id) => `- ${id}: ${graph.title(id)}`),
      );
  } else {
    out.push(`Type: ${session.type.toUpperCase()}. Concepts in scope:`);
    const ids = [
      ...new Set([...session.scope, ...session.queue.map((q) => q.conceptId)]),
    ].slice(0, 40);
    out.push(...ids.map((id) => conceptLine(graph, id)));
  }
  out.push(
    "",
    `Course: ${course.title} (${course.courseNumber}), ${course.term}. Exam: ${course.exam.format}`,
  );
  if (pages.length) {
    out.push(
      "",
      "# Script excerpts",
      course.builtin || course.id === "numcs"
        ? "Text extracted from the learner's own PDF of the lecture notes (German; formulas may be garbled by extraction, so rely on your own knowledge of the math and use the script for notation, labels and emphasis). The author permits this use in the app; do not reproduce long passages."
        : "Text extracted from the learner's own PDFs of the course materials (formulas and code may be garbled by extraction, so rely on your own knowledge of the subject and use the excerpts for notation, labels and emphasis). The page number in each header is the one to use in script blocks. Do not reproduce long passages.",
    );
    for (const p of pages) out.push(`\n${pageHeader(p)}\n${p.text.trim()}`);
  }
  return out.join("\n");
}

export function buildSystemPrompt(
  course: Course,
  graph: CourseGraph,
  session: Session,
  pages: ScriptPage[],
): string {
  return `${coreRules(course)}\n\n${sessionContext(course, graph, session, pages)}`;
}

// ---------------------------------------------------------------- learner model section
function fmtPct(x: number | null): string {
  return x === null ? "n/a" : `${Math.round(x * 100)}%`;
}

export function conceptModelLine(
  graph: CourseGraph,
  cs: ConceptState | undefined,
  id: string,
  now: Date,
): string {
  const title = graph.title(id);
  if (!cs || cs.evidence.length === 0)
    return `- ${id} "${title}": no evidence yet`;
  const r = retentionNow(cs, now);
  const last = cs.lastSeen
    ? `${Math.max(0, Math.round(daysBetween(cs.lastSeen, now)))}d ago`
    : "never";
  const lines = [
    `- ${id} "${title}": ${cs.status} · mastery ${fmtPct(masteryMean(cs))} (±${Math.round(masterySd(cs) * 100)}) · recall now ${fmtPct(r)} · practice level ${cs.level} · ${cs.evidence.length} items, last ${last}`,
  ];
  const active = cs.misconceptions.filter((m) => m.status === "active");
  if (active.length)
    lines.push(
      `  active misconceptions: ${active.map((m) => `"${truncate(m.text, 140)}"`).join("; ")}`,
    );
  const resolved = cs.misconceptions
    .filter((m) => m.status === "resolved")
    .slice(-2);
  if (resolved.length)
    lines.push(
      `  resolved earlier: ${resolved.map((m) => `"${truncate(m.text, 100)}"`).join("; ")}`,
    );
  if (cs.tutorNote) lines.push(`  tutor note: ${truncate(cs.tutorNote, 300)}`);
  if (cs.userNote)
    lines.push(
      `  learner's own note (trust this): ${truncate(cs.userNote, 300)}`,
    );
  return lines.join("\n");
}

export function relevantConcepts(
  graph: CourseGraph,
  session: Session,
  target: PracticeTarget | null,
): string[] {
  const ids = new Set<string>();
  if (session.goalConceptId) {
    ids.add(session.goalConceptId);
    for (const a of graph.ancestors(session.goalConceptId, 3)) ids.add(a);
  }
  for (const n of session.plan?.plan.nodes ?? [])
    if (n.conceptId) ids.add(n.conceptId);
  if (target) {
    ids.add(target.conceptId);
    for (const c of target.compose) ids.add(c);
  }
  return [...ids].filter((id) => graph.get(id)).slice(0, 30);
}

function learnerSection(
  graph: CourseGraph,
  learner: LearnerModel,
  ids: string[],
  now: Date,
): string {
  const out = ["# Learner model (relevant concepts)"];
  out.push(
    ...ids.map((id) => conceptModelLine(graph, learner.concepts[id], id, now)),
  );
  if (learner.profile.length) {
    out.push("", "# Learner profile");
    out.push(
      ...learner.profile
        .slice(-12)
        .map(
          (p) =>
            `- ${p.text}${p.source === "tutor" ? "" : " (from the learner)"}`,
        ),
    );
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- transcript
export function describeResponse(
  card: Card,
  r: CardResponse | undefined,
): string {
  if (!r) return "not answered yet";
  if (card.interaction?.type === "continue" || r.verdict === "seen")
    return "read";
  if (r.verdict === "dontknow")
    return `said "I don't know"${r.hintsUsed ? ` after ${r.hintsUsed} hint(s)` : ""}`;
  const parts = [`answered ${truncate(r.answerText, 220)}`];
  if (r.score !== null)
    parts.push(
      r.verdict === "correct"
        ? "✓ correct"
        : r.verdict === "partial"
          ? `~ partial (${Math.round(r.score * 100)}%)`
          : "✗ incorrect",
    );
  if (r.selfCheck) parts.push(`self-check: ${r.selfCheck}`);
  if (r.attempts > 1) parts.push(`${r.attempts} attempts`);
  if (r.hintsUsed) parts.push(`${r.hintsUsed} hint(s)`);
  if (r.revealed) parts.push("looked at the solution");
  if (r.confidence) parts.push(`confidence ${r.confidence}/4`);
  if (r.missing?.length)
    parts.push(`missing: ${truncate(r.missing.join("; "), 160)}`);
  return parts.join(", ");
}

function cardHeadline(card: Card): string {
  const it = card.interaction;
  const text =
    card.title ?? card.blocks.find((b) => b.type === "text")?.md ?? "";
  const q =
    it && it.type !== "continue" ? ` Q: ${truncate(it.prompt, 220)}` : "";
  const key =
    it?.type === "mcq"
      ? ` [options: ${(it.options ?? []).map((o) => `${o.id}${o.correct ? "*" : ""}) ${truncate(o.md, 50)}`).join(" | ")}]`
      : it?.type === "numeric"
        ? ` [key ${it.answer?.value}]`
        : "";
  return `${card.kind}${it && it.type !== "continue" ? ` (${it.type})` : ""}: ${truncate(text, 120)}${q}${key}`;
}

export function transcript(session: Session, maxSteps = 14): string {
  const steps = session.steps.slice(-maxSteps);
  if (!steps.length)
    return "# Session so far\n(nothing yet: this is the first step)";
  const out = ["# Session so far"];
  if (session.steps.length > steps.length)
    out.push(`(${session.steps.length - steps.length} earlier steps omitted)`);
  for (const [k, rec] of steps.entries()) {
    const idx = session.steps.length - steps.length + k + 1;
    const tgt = rec.target
      ? ` target ${rec.target.conceptId} L${rec.target.level}`
      : "";
    out.push(
      `\n## Step ${idx} · ${rec.phase.toUpperCase()}${rec.nodeId ? ` node ${rec.nodeId}` : ""}${tgt}`,
    );
    if (rec.step.assessment)
      out.push(`(your assessment then: ${truncate(rec.step.assessment, 200)})`);
    rec.step.cards.forEach((c, i) =>
      out.push(
        `[${i + 1}] ${cardHeadline(c)}\n    → ${describeResponse(c, rec.responses[i])}`,
      ),
    );
  }
  if (session.plan) {
    out.push("\n# Plan state");
    for (const n of session.plan.plan.nodes)
      out.push(
        `- ${n.id} "${n.title}" (${n.kind}) requires [${n.requires.join(", ")}]: ${session.plan.nodeState[n.id] ?? "pending"}`,
      );
  }
  if (session.chat.length) {
    out.push("\n# Side questions the learner asked");
    for (const t of session.chat.slice(-6))
      out.push(
        `${t.role === "user" ? "Learner" : "You"}: ${truncate(t.text, 240)}`,
      );
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- tasks
export interface StepTask {
  phase: "probe" | "plan" | "teach" | "wrap" | "practice" | "review";
  nodeId?: string | null;
  attempt?: number;
  target?: PracticeTarget | null;
  itemIndex?: number;
  itemsGoal?: number;
  probeRound?: number;
  allowPlanNow?: boolean;
  relearn?: boolean;
  targetPages?: ScriptPage[];
  /** prepared in advance while the learner still works on the previous step */
  speculative?: boolean;
}

const LEVEL_TEXT = [
  "",
  "L1 recall/recognize",
  "L2 apply one step",
  "L3 compose or unfamiliar representation",
  "L4 multi-step, unfamiliar cue, exam-style discrimination",
  "L5 exam transfer",
];

export function taskText(
  task: StepTask,
  graph: CourseGraph,
  session: Session,
  learner: LearnerModel,
  now: Date,
): string {
  const goal = session.goalConceptId ? graph.title(session.goalConceptId) : "";
  switch (task.phase) {
    case "probe":
      return [
        `# Your task: PROBE (round ${task.probeRound ?? 1})`,
        `Goal: ${goal}. Ask 1-3 diagnostic questions (card kind "probe") that best separate what the learner knows from what they do not, across the goal's prerequisites and the goal itself. Use the learner model to skip what is already well established. Quick formats: mcq, numeric, short free. confidence true. control.next "continue".`,
        task.allowPlanNow
          ? 'If the transcript and the model already let you place every relevant prerequisite as known, shaky or missing, do not probe further: instead output the PLAN now (plan field filled, one "message" card) and set control.next "phase_done".'
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "plan":
      return `# Your task: PLAN\nBuild the dependency tree from what the learner already understands (per the probe answers and the model) to the goal "${goal}". Fill plan (goal, approach in one sentence, 3-8 nodes) and output one "message" card that explains the path and invites the learner to adjust it. control.next "phase_done".`;
    case "teach": {
      const node = session.plan?.plan.nodes.find((n) => n.id === task.nodeId);
      const reqs = (node?.requires ?? []).map((r) => {
        const m = session.plan?.plan.nodes.find((n) => n.id === r);
        return `${r} "${m?.title ?? r}" (${session.plan?.nodeState[r] ?? "pending"})`;
      });
      const done = (session.plan?.plan.nodes ?? [])
        .filter((n) =>
          ["done", "known"].includes(session.plan?.nodeState[n.id] ?? ""),
        )
        .map((n) => n.id);
      return [
        `# Your task: TEACH node ${node?.id} "${node?.title}"${node?.kind === "goal" ? " (the goal)" : ""}`,
        `Step to teach: ${node?.detail}`,
        `Builds on: ${reqs.join(", ") || "nothing (anchor)"}. Already in place: ${done.join(", ") || "none"}.`,
        node?.kind === "shaky"
          ? "This node is shaky: a compact refresher (predict → short explain → check) is enough."
          : "",
        (task.attempt ?? 1) > 1
          ? `Attempt ${task.attempt}: the learner's previous check on this node failed (see transcript). Diagnose the likely misconception, re-explain with a different representation, then a new check in a new surface. Record the misconception in model.misconceptions.`
          : "",
        `Cards: predict → explain (1-2) → check, all with nodeId "${node?.id}". control.nodeId "${node?.id}". control.nodeStatus "needs_more" when this is remediation, else null.`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "wrap":
      return `# Your task: WRAP\nThe learner walked the plan to "${goal}". One "reflect" card (free, allowVoice true, rubric 3-5 points, modelAnswer) asking them to explain the chain from the anchors to the goal in their own words, then one "summary" card (2-4 takeaways, script pages to reread, what to practice next). Update model.notes for the concepts involved. control.next "session_done".`;
    case "practice":
    case "review": {
      const t = task.target!;
      const cs = learner.concepts[t.conceptId];
      const r = cs ? retentionNow(cs, now) : null;
      const lines = [
        `# Your task: ${task.phase.toUpperCase()} item ${(task.itemIndex ?? 0) + 1} of ${task.itemsGoal ?? "?"}`,
        `Target concept: ${t.conceptId} "${graph.title(t.conceptId)}". Level ${LEVEL_TEXT[t.level]}. Cue: ${t.cue}. Mode: ${t.mode}.`,
        t.compose.length
          ? `Compose with: ${t.compose.map((c) => `${c} "${graph.title(c)}"`).join(", ")}. The item must genuinely need these together.`
          : "",
        task.phase === "review"
          ? `Spaced review: last seen ${cs?.lastSeen ? Math.round(daysBetween(cs.lastSeen, now)) + " days ago" : "unknown"}, predicted recall ${fmtPct(r)}. Use a fresh surface the learner has not seen in this session.`
          : "",
        task.relearn
          ? 'The learner failed this concept earlier in this session. First one compact re-explanation card (kind "explain", under 120 words, one visual or worked example), then a new retrieval item (kind "review") in a different surface.'
          : `One card of kind "${task.phase}" with a graded interaction (mcq, numeric, order, fill, or free for L4-L5 derivations). Set interaction.level ${t.level} and cue "${t.cue}"; 3-4 hints; a full worked solution.`,
        "Do not repeat or lightly reword items already in the transcript.",
        'control.next "continue".',
      ];
      return lines.filter(Boolean).join("\n");
    }
  }
}

export function buildStepPrompt(
  graph: CourseGraph,
  learner: LearnerModel,
  session: Session,
  task: StepTask,
  now: Date,
): string {
  const ids = relevantConcepts(graph, session, task.target ?? null);
  const parts = [
    learnerSection(graph, learner, ids, now),
    transcript(session),
    taskText(task, graph, session, learner, now),
  ];
  if (task.speculative)
    parts.push(
      'Note: this step is prepared in advance while the learner is still answering the latest step, so its answers are not in the transcript yet. Assume it goes well; do not refer to its results or to "your last answer".',
    );
  if (task.targetPages?.length) {
    parts.splice(
      2,
      0,
      [
        "# Script pages for this item",
        ...task.targetPages.map(
          (p) => `${pageHeader(p)}\n${p.text.trim()}`,
        ),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

export function buildGradePrompt(
  card: Card,
  answer: string,
  attempt: number,
  previousFeedback: string | null,
): string {
  const it = card.interaction!;
  return [
    "# Your task: GRADE one answer",
    "Do not produce cards. Grade the learner's answer to the item below. Score 0..1 by correctness and rubric coverage; equivalent formulations, notation and spelling differences count as correct. verdict: correct (score ≥ 0.8), partial (0.4-0.8) or incorrect. feedback: 1-3 sentences in Markdown with LaTeX: what is right, and for partial or incorrect answers a nudge (a question or a pointer) toward what is missing. Do not give away the full answer in feedback. missing: rubric points not covered. misconceptions: wrong beliefs visible in the answer, phrased as the belief.",
    `\nItem (${card.kind}): ${it.prompt}`,
    it.rubric?.length
      ? `Rubric:\n${it.rubric.map((r) => `- ${r}`).join("\n")}`
      : "",
    `Model answer (for you only): ${it.modelAnswer ?? it.solution}`,
    attempt > 1
      ? `This is attempt ${attempt}. Your previous feedback: ${previousFeedback ?? ""}`
      : "",
    `\nLearner's answer:\n"""\n${answer.slice(0, 4000)}\n"""`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Grades the reasoning behind a closed-format answer (choice, number, order, blanks), often transcribed from speech. */
export function buildReasoningGradePrompt(
  card: Card,
  answer: string,
  answerCorrect: boolean,
  reasoning: string,
  attempt: number,
  previousFeedback: string | null,
): string {
  const it = card.interaction!;
  return [
    "# Your task: GRADE the reasoning behind one answer",
    "Do not produce cards. The learner answered the item below and explained how they got there; the explanation is often transcribed from speech, so ignore filler words, false starts and transcription errors in formulas. The final answer was already checked automatically. Grade the REASONING only. score 0..1: 1 = a sound argument that leads to the answer (it may skip routine steps), 0.5 = the right idea with a real gap or a wrong step, 0 = a guess, no argument, or a wrong idea. If the final answer is wrong but the reasoning is sound, say where the slip is. If the final answer is right but the reasoning is wrong or a guess, score low and say what is missing. verdict: correct (score ≥ 0.8), partial (0.4-0.8) or incorrect. feedback: 1-3 sentences in Markdown with LaTeX on the reasoning: what holds up and, if anything is off, a nudge (a question or a pointer). Do not give away the full answer. missing: steps or ideas the reasoning lacks. misconceptions: wrong beliefs visible in the reasoning, phrased as the belief.",
    `\nItem (${card.kind}): ${it.prompt}`,
    it.rubric?.length
      ? `Rubric:\n${it.rubric.map((r) => `- ${r}`).join("\n")}`
      : "",
    `Worked solution (for you only): ${it.solution || it.modelAnswer || ""}`,
    attempt > 1
      ? `This is attempt ${attempt}. Your previous feedback: ${previousFeedback ?? ""}`
      : "",
    `\nLearner's answer: ${answer.slice(0, 600)} (automatic check: ${answerCorrect ? "correct" : "not correct"})`,
    `Learner's reasoning:\n"""\n${reasoning.slice(0, 6000)}\n"""`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChatPrompt(
  graph: CourseGraph,
  learner: LearnerModel,
  session: Session,
  question: string,
  current: Card | null,
  now: Date,
): string {
  const ids = relevantConcepts(graph, session, null);
  const pending =
    current?.interaction && current.interaction.type !== "continue"
      ? `The learner is currently working on: "${truncate(current.interaction.prompt, 300)}". If the question would give away this item's answer, reply with a nudge (a guiding question or the relevant idea) instead.`
      : "";
  return [
    learnerSection(graph, learner, ids, now),
    transcript(session, 8),
    `# Your task: ANSWER A SIDE QUESTION\nThe learner asks: """${question.slice(0, 2000)}"""\n${pending}\nAnswer like a good tutor: short (under 120 words), concrete, with an equation or a visual block if it helps; end with a question that checks understanding when appropriate. Output blocks and speech only.`,
  ].join("\n\n");
}

export const TEST_PROMPT =
  "Reply with ok = true and the name of the model you are.";
