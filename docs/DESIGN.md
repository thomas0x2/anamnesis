# How Anamnesis works inside

This page is for anyone changing the code. [LEARNING_SCIENCE.md](LEARNING_SCIENCE.md) explains why the app teaches the way it does; this page explains how.

## Processes

```
┌──────────────────────── Electron main process (Node) ────────────────────────┐
│ src/main/index.ts       window, app:// protocol, CSP, permissions, IPC        │
│ src/node/claudeCli.ts   runs `claude -p …` per request, streams events back   │
│ src/node/store.ts       JSON files in the data folder                         │
└──────────────────────────────────▲───────────────────────────────────────────┘
                                   │ src/preload/index.ts: window.anamnesis (the only bridge)
┌──────────────────────────────────┴──── renderer (React, sandboxed) ──────────┐
│ engine/app.ts       app state; turns answers into evidence, memory, points    │
│ engine/session.ts   one session: phase machine, cards, model calls            │
│ engine/script.ts    the lecture notes: pdf.js text index                      │
│ views/ components/ demos/ voice/                                              │
│ backend/            electron | http (dev server) | demo (in-browser)          │
└───────────────────────────────────────────────────────────────────────────────┘
                      src/shared/: pure logic used by every process
```

All learning logic is plain TypeScript in `src/shared/` and runs in the renderer: the learner model, FSRS, item selection, grading, rewards, stats, prompts, schemas and output normalization. The main process only runs the CLI, stores files and hands over the PDF bytes, so the logic can be unit tested without Electron.

The renderer talks to one `Backend` interface (`src/renderer/src/backend/`) with three implementations:

* **electron**: the preload bridge. IPC channels: `llm:generate`, `llm:cancel`, `llm:test`, `store:read|write|list`, `settings:get|set`, `script:read|choose`, `shell:open`, `app:info`. Streaming events come back on `llm:event`, keyed by request id.
* **http**: `scripts/dev-server.ts`, which does what the main process does, so the UI can run in a normal browser for development, screenshots and the end-to-end test.
* **demo**: entirely in the browser, with localStorage and the scripted tutor (`?backend=demo`).

The scripted tutor (`src/shared/fakeTutor.ts`) can also stand in for Claude in the desktop app (Settings → Tutor).

## A learn session

```
probe (1–2 rounds) → plan → learner reviews the plan → teach node 1 … node k → wrap → done
```

`SessionController` (`src/renderer/src/engine/session.ts`) is the phase machine. Transitions happen in `afterStepComplete`, once every card of the latest step has a response.

* **Probe.** The tutor writes 1 to 3 diagnostic cards. After the first round it may decide it knows enough and plan right away (`control.next = "phase_done"`). Otherwise a second round follows; after two rounds the session moves on regardless.
* **Plan.** The tutor returns 3 to 8 nodes, each `known` (an anchor), `shaky` (gets a quick refresher), `new` or the single `goal`. Each node lists the nodes it requires, the requirements must form a DAG (`src/shared/graph.ts`), and a node can map to a course concept. The learner sees the tree (`PlanGraph.tsx`, laid out with dagre) and can mark nodes as already known (skipped) or to be taught. The first lesson is already being written while they look at it.
* **Teach.** For each pending node in order, one model call writes predict → explain → check. The node passes when every check card on it reaches an effective score of at least 0.6 (`nodePassed`). Otherwise it is taught again with a different explanation; after two attempts it is marked shaky and the walk continues.
* **Wrap.** An explain-back card (free text or voice, graded against a rubric) and a summary card with the key takeaways and the pages to reread.

Practice and review sessions have no phases. A queue of targets is computed when the session starts (`practiceQueue` and `reviewQueue` in `src/shared/selection.ts`), and each item is one step with one card. In a review session a failed item inserts a relearn item (a short re-explanation, then a new question) after one other item.

Sessions are saved half a second after every change, so a session interrupted by closing the app resumes where it stopped. A step that was still streaming keeps the cards that had arrived.

## One tutor step

Every model call for a step returns one JSON object, which the app renders as cards:

```ts
{
  assessment: string | null       // one sentence on what the latest answers show
  cards: Card[]
  plan: Plan | null               // PLAN only
  model: ModelUpdate | null       // tutor notes, misconceptions, profile observations
  control: { next: 'continue' | 'phase_done' | 'session_done', nodeId, nodeStatus }
}
```

The request has three parts (`src/shared/prompts.ts`):

1. **System prompt.** Identical for every call in a session, so it is prompt-cached: the tutor rules (`CORE_RULES`: pedagogy, phases, difficulty levels, exam format, block and interaction types, the demo catalogue, output format), the session context (goal, its summary and why it matters, its prerequisites in the course graph, or the practice scope), and the script pages of the goal.
2. **User prompt.** What changes from call to call: one line per relevant concept from the learner model (mastery and its band, memory, level, facets, misconceptions, the tutor's and the learner's notes), the learner profile, the session transcript so far (each card, the answer, attempts, hints, confidence, verdict), and the task for this call.
3. **JSON schema** (`src/shared/schema.ts`), passed as `--json-schema`. It is deliberately flat, one block shape with optional fields instead of a deep `oneOf`, which models fill more reliably.

The output goes through `normalizeStep` (`src/shared/normalize.ts`). Its rule is never to crash a session on a bad field: it repairs what it can (ids, option letters, unknown concept ids replaced by the session's concept, doubly escaped LaTeX via `src/shared/mdtex.ts`) and drops what it cannot.

### Streaming

The CLI streams the structured output as `input_json_delta` events of a `StructuredOutput` tool call. `claudeCli.ts` forwards the JSON accumulated so far, `src/shared/partialJson.ts` parses the prefix (closing open arrays and objects, dropping a dangling key), and `completeCardsFromPartial` hands over each card once it is complete. The first card appears while the others are still being written, and the learner can answer it right away. The status line shows "reading your model", "thinking" with a token count, and "writing cards".

### Speculation

While the learner works on a step, the controller already generates the step that comes next if they succeed (`predictNext`, `maybeSpeculate`): the next plan node, the wrap, or the next practice item. The prompt tells the model that the step is prepared in advance. When the actual next task matches (`taskKey`), the prepared generation is used, often already complete; otherwise it is cancelled. The same happens during plan review: the first lesson starts while the learner reads the plan and is dropped if they change the path.

### Failures

A step that fails before any card arrived is retried once automatically (invalid output, timeout and other errors). A step that fails after some cards arrived keeps them, so the learner can carry on, and offers a retry. A missing CLI or an expired login gets a message that says how to fix it.

## Cards, answers and grading

* **Card kinds:** `probe`, `predict`, `check`, `practice`, `review`, `reflect`, `explain`, `summary`, `message`.
* **Blocks:** `text`, `equation`, `callout`, `steps`, `plot`, `demo`, `mermaid`, `sketch`, `script`, `code`, `table`.
* **Interactions:** `mcq` (single or multiple), `numeric`, `free`, `order`, `fill`, `continue`. Every graded interaction carries 2 to 4 hints, a worked solution, the concept ids it gives evidence about, a confidence prompt and, for practice and review, the level and cue.
* **Attempts** (`MAX_ATTEMPTS`): one for probe and predict cards, three for check, practice and review, two for the explain-back.

Closed formats are graded locally and instantly (`src/shared/grading.ts`):

* `mcq`: single choice is right or wrong. Multiple choice scores (right picks − wrong picks) / number of correct options, capped at 0.75 unless exact.
* `numeric`: the key and the answer are both evaluated with math.js, so `1/3`, `2^-10`, `π/4` and `1,5` all work. Within tolerance is right, within 2% relative earns half credit ("check rounding"), and a sign error is named.
* `order`: the share of pairs in the right order, capped at 0.75 unless exact.
* `fill`: each blank against its accepted spellings, ignoring whitespace and case, comparing numbers numerically.

Free text goes to a second, low-effort call (`buildGradePrompt`, `gradeSchema`) with the rubric, the model answer and the previous feedback. It returns a score, a verdict, feedback, the missing points and any misconceptions.

`AppController.recordCard` (`src/renderer/src/engine/app.ts`) then turns the response into evidence for the item's concepts, updates memory and the practice level of the primary concept, records misconceptions and the calibration point, and computes the rewards.

## The learner model

One `ConceptState` per course concept (`src/shared/mastery.ts`), stored in `state.json`.

**Mastery** is a discounted Beta posterior over "answers items on this concept correctly". It starts at $\alpha = \beta = 1$. Evidence with weight $w$ and effective score $e$ updates it as

$$
\alpha \leftarrow 1 + (\alpha - 1)\,0.9^{w} + w\,e, \qquad
\beta \leftarrow 1 + (\beta - 1)\,0.9^{w} + w\,(1 - e).
$$

The discount lets old evidence fade, so the estimate can move when understanding changes. The mind model shows the mean $\alpha/(\alpha+\beta)$ with a band of one standard deviation. Weights: prediction 0.3, probe 0.6, check 1, review 1, explain-back 1.2, practice $1 + 0.15\,(\ell - 1)$ at level $\ell$. The secondary concepts of a composed item get 0.6 of the weight.

**Effective score** after help, with raw score $s$, $h$ hints and $a$ attempts:

$$
e = s \cdot \max\bigl(0.3,\; 1 - 0.2\,h - 0.25\,(a - 1)\bigr),
$$

and $e = 0$ for a revealed solution.

**Facets** are exponential moving averages: understanding from checks, explain-backs and (weakly) predictions; transfer from items at level 3 or above or with unfamiliar cues; independence from how little help was needed.

**Memory** is one FSRS-6 card per concept (`src/shared/fsrs.ts`, published default parameters), updated only by retrieval items (checks, practice, reviews, explain-backs) and only for the item's primary concept. The rating comes from behaviour (`ratingFor`): Again for a revealed solution or a score below 0.5; Hard with two or more hints, a score below 0.8 or confidence at "unsure" or lower; Easy for a clean answer of at least 0.95 given as certain; otherwise Good. A second attempt counts the score at 75% for the rating. The next review is due when predicted recall drops to the target retention, at least one day after a success and at most 365 days; after a failure it is due within half a day. Reviews on the same day use FSRS-6's short-term stability update.

**Status** (`deriveStatus`): unseen → introduced → developing (mean ≥ 0.5) → proficient (mean ≥ 0.8, mean − sd ≥ 0.65, an unaided L3 solve) → mastered (in addition: unaided successes at L2 or above on three separate days spanning at least five days, an unaided L4 solve, and current recall ≥ 0.8).

**Practice level** (`updateLevel`): L1 to L5 per concept. Three successes in a row (effective score ≥ 0.8) on items at or above the current level raise it; one failure (below 0.5) on an item at or above the level lowers it.

**Misconceptions** come from three sources: a chosen distractor that the item maps to a misconception, the free-text grader, and the tutor's model updates. Similar texts merge (at least 60% word overlap), and each one is active or resolved.

**Notes**: the tutor's note per concept (replaced, not appended), the learner's own note (shown to the tutor as trusted), and profile notes on how the learner learns (picked during onboarding, added by the tutor, or written by the learner).

## Choosing what comes next

`src/shared/selection.ts`.

**Practice queue.** The pool is the concepts in scope that have been seen (or the first six if none have). Each concept gets a priority

$$
p = 0.45\,(1 - m) + 0.25\,f + 0.15\,a + t,
$$

with $m$ the mastery mean, $f = 1$ when the concept is due and $1 - R$ otherwise (0.5 without a memory card), $a = 1$ with an active misconception, and $t$ = 0.15 for core concepts and 0.05 for the rest. The queue repeatedly takes the highest priority that is not the previous concept and still within its repeat budget, then multiplies that priority by 0.55.

**Targets.** Each item gets a level (the concept's staircase level), a mode and a cue:

| Level | Mode | Cue |
|---|---|---|
| 1 | recall | familiar |
| 2 | apply | familiar, every third item shifted |
| 3 | compose with a neighbour, or discriminate | shifted |
| 4 | alternately discriminate and compose | novel |
| 5 | exam | novel |

Composition partners (one at L3 and L4, two at L5) are neighbours in the course graph, meaning ancestors up to two steps away, siblings and direct descendants, that the learner already has at "developing" or better. Practice targets are rebuilt when each item starts, so a level change earlier in the session applies.

**Review queue.** Concepts whose FSRS due date has passed, least retrievable first, one level below their practice level (at most L3) and with a shifted cue.

## Rewards and stats

`src/shared/rewards.ts` computes insight points for each response (the table is in [LEARNING_SCIENCE.md](LEARNING_SCIENCE.md#12-rewards-that-inform)); the milestones are proficient, mastered, level up and walking the whole plan.

`src/shared/stats.ts` derives everything from the evidence log:

* **Chapter readiness:** the mean over a chapter's concepts (without the extra tier) of a status score (0, 0.25, 0.5, 0.8, 1 from unseen to mastered) times memory, where memory counts at least 0.3.
* **Calibration:** accuracy per confidence level against what that level claims (25%, 50%, 75%, 95%), the Brier score and the signed bias.
* **Accuracy by level** (practice and reviews only), **activity per day** (without pretests), **help per item per week**, and the **review forecast** for the coming week.

Every chart has a table view.

## The course graph

`courses/numcs/course.json` maps the script's structure without its text: 87 concepts in 9 chapters (0 for refreshers, then chapters 1 to 8 of the script). Each concept has an id, an English and a German title, a one-sentence summary, why it matters, the concepts it requires, its PDF page range, the script labels it covers (such as `Satz 2.2.3`), suitable demos and a tier (73 core, 13 support, 1 extra). PDF page numbers are one higher than the printed ones.

`src/shared/graph.ts` provides ancestors, descendants, siblings and topological order. `tests/unit/graph.test.ts` checks that ids are unique, every requirement exists, the graph is acyclic and page ranges sit inside their chapters.

To support another course, write a new course file and replace the course-specific parts of `CORE_RULES` (course name, exam format, demo catalogue).

## The lecture notes

`src/renderer/src/engine/script.ts`. The learner picks their PDF once; the main process remembers the path and hands over the bytes. pdf.js extracts each page's text in the renderer (`src/shared/pdfText.ts` joins text items into lines, repairs hyphenation and finds labels such as `Definition 2.2.1` at the start of a line), and the result is cached as `script-index.json` in the data folder. The index is rebuilt when the file's size or page count changes. Neither the PDF nor its text is ever part of the repository: `*.pdf` and caches are git-ignored.

A learn session sends up to `maxPages` (8 by default) pages of the goal's range in the system prompt; a practice or review item sends up to 3 pages of its concept. With **Ground steps in the script** off, no page text is sent, and the tutor works from section and theorem numbers. Script blocks and the Script screen open the exact page in the app's own viewer (`PdfPage.tsx`).

## The Claude Code CLI

`src/node/claudeCli.ts` runs each request as

```
claude -p --output-format stream-json --verbose --include-partial-messages
       --json-schema <schema> --system-prompt-file <file>
       --tools "" --strict-mcp-config --disable-slash-commands --setting-sources ""
       --no-session-persistence --effort <level> [--model <m>] [--fallback-model <f>]
```

with the user prompt on stdin, in the app's own working folder inside the data folder; the system prompt goes to a temporary file that is deleted after the run. With no tools, no MCP servers, no slash commands, no settings and no session persistence, the CLI can only answer.

* It uses the learner's own Claude login, and their Claude Code default model unless Settings names one. A fallback model is passed only when it differs from the main one.
* The binary is looked up on the login shell's `PATH`, because apps started from the macOS Dock do not inherit it, or at a path set in Settings.
* Tutor steps use the configured effort; grading and side questions use low effort.
* Each request has a timeout (SIGTERM, then SIGKILL) and can be cancelled, which the session controller does for speculation it no longer needs.
* Errors are classified (CLI not found, login, rate limit, timeout, invalid output, cancelled) so the UI can say what to do.

## Storage

`src/node/store.ts` writes JSON files to the data folder (`~/Library/Application Support/Anamnesis` on macOS, or `ANAMNESIS_DATA_DIR`) atomically, as a temporary file followed by a rename, and keeps one `.bak` of each. Names are validated so that no write can leave the folder.

| File | Contents |
|---|---|
| `state.json` | the learner model, rewards, calibration points and the session list |
| `sessions/<id>.json` | one session: its steps, cards, answers and side questions |
| `settings.json` | tutor, voice, learning and script settings |
| `script-index.json` | the extracted text of the lecture notes (local only) |

Settings → Data exports the learner model, answers and points as one JSON file, imports such a file, or resets everything.

## Voice

`src/renderer/src/voice/`. Speech to text runs Whisper through transformers.js in a web worker, on WebGPU when available and WASM otherwise. The model (tiny, base or small, English-only or multilingual) is downloaded once from Hugging Face and cached, and audio never leaves the computer. Speech output uses the system voices through the Web Speech API and reads each card's `speech` field: a short spoken version of the card with the maths said out loud.

## Visuals

* **Demos** (`src/renderer/src/demos/`): 14 interactive components that the tutor configures with `demo.params`. They compute with `src/shared/numerics.ts` (Lagrange and barycentric interpolation, Lebesgue functions, Chebyshev nodes and polynomials, the DFT and trigonometric interpolation, splines, quadrature rules, fixed-point and Newton iterations, the SVD of a 2×2 matrix, least squares), which is unit tested.
* **Plots** (`Chart.tsx`, `src/renderer/src/lib/axes.ts`): math.js expressions or explicit points, linear or logarithmic axes, with tested tick generation.
* **Diagrams:** Mermaid for algorithms and concept maps, dagre for the plan tree.
* **Sketches:** model-written HTML and JavaScript in a sandboxed iframe with an opaque origin and a Content Security Policy that allows inline code only and no network.

Model-written expressions are evaluated by a locked-down math.js instance (`src/shared/mathx.ts`) in which `import`, `evaluate`, `parse`, `createUnit`, `simplify` and `derivative` are unavailable.

## Security

* The renderer runs sandboxed, with context isolation and without Node integration. `src/preload/index.ts` is the only bridge and exposes a fixed set of calls.
* App pages are served from a custom `app://` protocol with a strict Content Security Policy. The only outside hosts it allows are Hugging Face's, for the one-time Whisper download.
* Navigation away from the app is blocked, and external links open in the system browser.
* The only permission granted is the microphone, and only to the app's own pages.
* The dev server listens on 127.0.0.1 only and refuses requests with a foreign Host or Origin header, and writes without a JSON content type.
* The CLI runs without tools, so model output can never act on the computer.

## Testing

* `npm test` runs the unit tests (vitest) for the learner model, FSRS, grading, item selection, stats and rewards, the course graph's integrity, prompts and schemas, the normalization of sloppy and partial output, the partial JSON parser, numerics, chart axes, Markdown and LaTeX repair, the math sandbox and the CLI arguments. Shared fixtures are in `tests/unit/helpers.ts`.
* `npm run e2e` uses Playwright to walk through onboarding, a full learn session (probe, plan, teach, wrap), a practice session and every screen with the scripted tutor, in the browser or, with `--electron`, in the built app. It fails on any console error.
* `src/shared/fakeTutor.ts` produces every card kind, block type and interaction deterministically. It powers the demo mode and the end-to-end run.
* `scripts/try-step.ts` sends one real step through the CLI and prints the cards and timings, for work on the prompts.
