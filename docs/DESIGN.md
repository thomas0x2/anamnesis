# How Anamnesis works inside

This page is for anyone changing the code. [LEARNING_SCIENCE.md](LEARNING_SCIENCE.md) explains why the app teaches the way it does; this page explains how.

## Processes

```
┌──────────────────────── Electron main process (Node) ────────────────────────┐
│ src/main/index.ts       window, app:// protocol, CSP, permissions, IPC        │
│ src/node/claudeCli.ts   runs `claude -p …` per request, streams events back   │
│ src/node/agent.ts       one long-lived `claude -p` tutor agent per chat       │
│ src/node/mcpBridge.ts   loopback MCP server exposing the app's tools to it    │
│ src/node/store.ts       JSON files in the data folder                         │
└──────────────────────────────────▲───────────────────────────────────────────┘
                                   │ src/preload/index.ts: window.anamnesis (the only bridge)
┌──────────────────────────────────┴──── renderer (React, sandboxed) ──────────┐
│ engine/app.ts       app state; turns answers into evidence, memory, points    │
│ engine/chat.ts      a tutor chat: agent events, runs the agent's tools        │
│ engine/session.ts   one session: phase machine, cards, model calls            │
│ engine/script.ts    the lecture notes: pdf.js text index                      │
│ views/ components/ demos/ voice/                                              │
│ backend/            electron | http (dev server) | demo (in-browser)          │
└───────────────────────────────────────────────────────────────────────────────┘
                      src/shared/: pure logic used by every process
```

All learning logic is plain TypeScript in `src/shared/` and runs in the renderer: the learner model, FSRS, item selection, grading, rewards, stats, prompts, schemas and output normalization. The main process only runs the CLI, stores files and hands over the PDF bytes, so the logic can be unit tested without Electron.

The renderer talks to one `Backend` interface (`src/renderer/src/backend/`) with three implementations:

* **electron**: the preload bridge. IPC channels: `llm:generate`, `llm:cancel`, `llm:test`, `store:read|write|list`, `settings:get|set`, `script:read|choose`, `material:read|pick`, `folder:pick|scan`, `shell:open`, `app:info`. `material:read` takes a course and material id and reads only a `.pdf` path listed in that course's materials file. Streaming events come back on `llm:event`, keyed by request id.
* **http**: `scripts/dev-server.ts`, which does what the main process does, so the UI can run in a normal browser for development, screenshots and the end-to-end test.
* **demo**: entirely in the browser, with localStorage and the scripted tutor (`?backend=demo`).

The scripted tutor (`src/shared/fakeTutor.ts`) can also stand in for Claude in the desktop app (Settings → Tutor).

## The tutor agent (default)

Since the agent rebuild every session (learn, practice, review, open chat) is driven by a tutor agent, in the spirit of an agent harness: the model drives, the app supplies tools that create the learning interface and keep the learner model. The agent's cards appear on the same session screen as the guided sessions: the phase header follows the tools it uses (probe cards, `show_plan`, cards for a plan node, the reflect card), `show_plan` opens the plan review and waits until the learner confirms it, practice and review show the item list, and the results screen follows `finish`. The tutor's text appears as short notes between the cards, with a message box below. Practice and review items are still picked by the app (spacing, level staircase) and listed in the prompt; the agent names the item with `ask`'s `item` field, so levels and memory update as in guided practice. Unfinished guided sessions are not resumed in agent mode (their evidence stays). **Settings → Learning → How the tutor works** switches back to the guided sessions described in the next section.

```
learner ── chat box ──▶ ChatController ──agentSend──▶ claude -p (stream-json in/out, one per chat)
                             ▲                               │ calls mcp__anamnesis__<tool>
                             │ tool_call events              ▼
                       renders a card, waits  ◀── McpBridge (127.0.0.1, bearer token per chat)
                       for the answer, grades ──agentToolResult──▶ tools/call response
```

* **Process.** `AgentHost` (`src/node/agent.ts`) starts `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --tools "" --mcp-config <bridge> --strict-mcp-config --allowedTools mcp__anamnesis …` with the agent system prompt. Built-in tools are off, so the agent can only use the app's tools. Learner messages go in over stdin; assistant text, streamed tool inputs and tool calls come back as `AgentEvent`s (`src/shared/agentTypes.ts`). A chat keeps its Claude Code session id, so a reopened chat continues with `--resume`.
* **Bridge.** `McpBridge` is a minimal MCP server (Streamable HTTP, JSON-RPC: `initialize`, `tools/list`, `tools/call`). A `tools/call` is answered as an SSE stream that stays open with keep-alive comments until the app has a result, so a question can wait as long as the learner needs. The CLI is told not to move waiting tool calls to the background (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` and related variables in `agent.ts`); without that it gives up waiting after two minutes.
* **Tools** (`src/shared/agentTools.ts`): `explain` (a content card; waits until read), `ask` (one interactive question of kind probe, predict, check, practice, review or reflect; waits for the answer and returns the graded result with confidence, hints, attempts, reasoning and misconceptions), `show_plan` and `update_plan` (the dependency tree in the side panel), `read_script` (page text or a search in the lecture notes), `course` (concept details), `learner` (the learner model and what is due), `update_learner` (notes, misconceptions, profile) and `finish` (takeaways card, session summary). Card inputs use the same block and interaction schemas as the guided sessions.
* **Cards.** `ChatController` (`src/renderer/src/engine/chat.ts`) puts each card into a `SessionController` in agent mode (constructed with `onCardDone`): it has no phase machine but grades, records evidence, updates memory and awards points exactly like a guided session. When the learner types while a card is waiting, the message becomes that card's tool result ("the learner wrote instead…"); the card is set aside: it stays answerable until the tutor's next card, which goes ahead of it instead of waiting behind it, and answering it meanwhile reaches the agent with its next card result. A message typed while the agent is still working never waits for the end of the turn (a tutoring turn runs on from card to card): the next card the agent shows is turned back unshown with the message, so it answers first. The agent answers in its text or in a card's `reply` field, shown as a tutor note above the card (it sometimes keeps an answer to itself in its thinking otherwise).
* **Prompt.** `buildAgentSystemPrompt` reuses the teaching doctrine of the guided prompt (without its JSON-output framing), adds how a session runs with tools, the course concept index, the session goal and the relevant part of the learner model.
* **Demo.** `FakeAgentHost` (`src/shared/fakeAgent.ts`) emits the same events and makes the same tool calls with the scripted content, for the in-browser demo, the dev server's fake mode and the end-to-end test.
* **Transport.** Electron: IPC `agent:start|send|result|stop`, events on `agent:event`. Dev server: `POST /api/agent/start` returns an NDJSON event stream for the agent's lifetime; `send`, `result` and `stop` are plain POSTs.

## A learn session (guided mode)

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
* **Blocks:** `text`, `equation`, `callout`, `steps`, `plot`, `widget`, `demo`, `mermaid`, `script`, `code`, `table`.
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

## Courses and materials

The built-in course (`courses/numcs/course.json`) is the only course in the repository. Learners add others in the app; everything about them lives in the data folder.

```
courses-index.json                      the learner's courses (CourseMeta: name, language, exam format, code language, folder)
courses/<id>/materials.json             the course's PDFs (Material) and the folder files the learner ignored
courses/<id>/map.json                   CourseExtension: chapters and concepts added from materials, links on base concepts
courses/<id>/text/<materialId>.json     extracted page text, labels and outline of one PDF (local only)
courses/<id>/state.json                 the course's learner model, rewards, calibration, session list
courses/<id>/chats-index.json           the course's tutor chats
courses/<id>/folder.json                the folder a built-in course watches
profile.json                            the learner profile, shared by all courses
```

The built-in course keeps its old file names (`state.json`, `chats-index.json`, `script-index.json`), so existing data needs no migration. Its script is the material `script` at offset 0.

**The course the app uses** is `buildCourse(base, extension)` (`src/shared/courseMap.ts`): the base course (the bundled file, or an empty course made from `CourseMeta`) plus the extension's chapters and concepts, with extra `sources` and `exercises` patched onto base concepts. `AppController.courseView` holds it with its graph; switching course leaves the open session, saves, loads the other course's files and remounts the views (`ui.courseKey`).

**App page numbers.** Every material gets an offset when it is first read (`nextOffset`: the next multiple of 1000 after the materials already placed), and page *p* of the PDF has app page number offset + *p*. One number names a page across all PDFs of a course, so concept ranges, script blocks, `read_script` and the reader work as before. `MaterialLibrary` (`engine/script.ts`, which replaced the single-PDF index) maps numbers back to a material and its own page (`locate`, `label`: "04 Pointers, p. 12"), opens at most three PDFs at a time and searches all of them. Prompts show excerpts as `[page 1012 · 04 Pointers, p. 12]`.

**Adding a material.** Files come from the file dialog or from the course folder (`scanPdfs` in `src/node/files.ts`: PDFs up to four levels deep). The folder is scanned when the course opens and when the window comes to the front (at most once a minute); new files are added right away when the course has "add automatically" on, otherwise they wait in `pending` for the learner. `inferKind` guesses the kind from the file name and folder (`Serie/`, `exercise`, `Lösung`, `mock exam`, `skript`, …), and the learner can change it.

A queue (`runQueue` in `src/shared/courseWork.ts`, started by `AppController.processQueue`) handles one material at a time and survives restarts:

1. **Read.** pdf.js extracts the text of every page and the outline; the result is cached.
2. **Map.** The pages are split into chunks of about 45,000 characters (`chunkPages`). For each chunk one CLI call (`kind: 'map'`, `MAP_SYSTEM`, `mapSchema`, `buildMapPrompt`) gets the course so far (chapters, every concept with its prerequisites) and the page text, and returns new chapters, new concepts, links to existing concepts and problem-set tasks with the concepts they practise. `normalizeMapOutput` makes ids unique, keeps only known prerequisites, breaks cycles, puts concepts with an unknown chapter into a chapter named after the material, clamps pages to the PDF and converts them to app page numbers; `applyMapDelta` merges the result without duplicates. The map is saved and the views update after every chunk, so the first concepts can be learned while the rest is read. The map file also records how many parts of each material it holds (`CourseExtension.done`, written in the same file as the concepts by `markParts`), so a material that was interrupted (app closed, crash) resumes at the next part (`partsDone`) and never merges a part twice, even if the materials list was not saved in time.

**Dropped connections.** A map call runs under a watchdog (`generateWatched`, `src/shared/retry.ts`): when nothing arrives from the model for 4 minutes (the CLI's own "retrying the API" notices do not count), the call is cancelled and counted as a timeout. `generateWithRetry` then tries the part again with a new request, up to 4 attempts, after 15 s, 45 s and 2 min, and waits while the computer is offline; the job line says what it is waiting for. Login problems and a missing CLI are not retried. When all attempts fail, the material shows the error and **Retry**, which continues from the part that failed (**Start over** removes what the material added and maps it again). A failure that looks like a lost connection is marked `retryable`: it goes on by itself when the window gets the `online` event or the course is opened again.

**Courses that are not open.** `BackgroundWork` (`src/renderer/src/engine/background.ts`) goes over the other courses on start, every 5 minutes, when the window comes to the front and after a course switch: it scans each watched folder that adds files by itself (at most every 2 minutes; notebooks become problem sets), builds the queued materials, and maps the topics of online problem sets. The build code is the same as for the open course: it runs on a `CourseHost`, backed by the app's stores for the open course and by the course's files in the background. One course at a time and one model call at a time; finished builds show a toast with the course's short name. Opening a course first lets the background go (`release`: the call is cancelled, nothing is written after), so only one side writes a course's files; the stopped part resumes in the open course.

**Topics of online problem sets.** Code Expert series, GitLab exercises, Jupyter notebooks and tasks added by hand have no pages to map. `mapTasks` (`courseWork.ts`, prompt and rules in `src/shared/taskMap.ts`) sends their statements with the concepts of the map, up to 8 tasks per call, and the model picks the concepts each practises (only ids from the map). A task is mapped again when the map has grown since or its statement changed (`TaskTopics` records who picked the topics, the map size and a fingerprint of the statement). Topics picked in Edit are the learner's and stay; clearing them hands them back to the AI. Until the AI has answered, the names of concepts found in the statement (`guessConcepts`) stand in.

Removing a material (`removeMaterial`) takes out its links and tasks and the concepts it introduced, except those the learner already has evidence on and those other concepts build on. "Map again" removes the material's contributions the same way and maps it from scratch.

**Prompts for learner-made courses.** `coreRules(course)` returns `CORE_RULES` unchanged for the built-in course; for other courses it swaps the course intro (name, lecturer, language of the materials), the exam format, the code language and the NumCS-specific examples, and notes that the numerical demos fit only some courses. Concept lines in prompts and in the agent's `course` tool list all sources and problem-set tasks (`conceptPlaces`), and practice items get the pages of the concept's first range.

The demo tutor maps deterministically (`fakeMapOutput`: one concept per few pages, tasks linked to existing concepts), which the end-to-end test uses: it creates a course from a folder of generated PDFs, adds a file later, learns a concept in it and checks that switching back keeps the first course's progress.

## Exam preparation

`src/shared/exam.ts`, `views/ExamView.tsx`. Each course has `courses/<id>/exam.json` (`ExamPrep`): the exam date, how many problem sets the course will have (they appear one by one, so the goal is `max(that, sets added)`), the number of mock exams to write, a manual status per material (`records`) and the learner's submissions. Problem sets are materials of kind `exercises`, mock exams of kind `exam`; `solutionFor` pairs a problem set with a `solutions` material by the numbers in its title. `prepProgress` gives done counts, days left and the pace (items left per week); `prepSummary` goes into the tutor agent's prompt.

**Checking a solution.** The learner uploads PDFs, images or text, or types answers, and says how they worked (`alone`, `notes`, `help`; mock exams also whether under exam conditions). The files are saved by the main process to `courses/<id>/work/<submission>/` (safe names, readable types only, 40 MB each). One `work` request (`WORK_SYSTEM`, `buildWorkPrompt`, `workSchema`) gets the problem statement's text, the official solution's text if there is one, the concept list (concepts linked to the material first) and the file paths. For that request only, the CLI runs with `--tools Read --add-dir <submission folder>`: it can read handwritten scans and photos, and reads outside that folder are denied (print mode cannot ask). The main process accepts only paths matching `courses/<id>/work/<id>/<name>` inside the data folder (`resolveWorkFiles`).

`normalizeWork` clamps scores, derives verdicts and drops unknown concept ids. `applyWork` turns each attempted task into evidence on its 1-3 concepts (kind `work`, weight 1.4, level 3; mock exams kind `exam`, weight 1.8, level 4 under exam conditions), with `notes` and `help` counted as one or two hints, records misconceptions and tutor notes, and awards points (more for mock exams, less with help). Tasks left out add no evidence. A re-check replaces the shown grade but does not add the evidence twice. Grading continues when the learner switches course: the result is written to that course's files.

## The lecture notes

`src/renderer/src/engine/script.ts` (`MaterialLibrary`, one per course; see Courses and materials for page numbering). The learner picks a PDF once; the main process remembers the path and hands over the bytes. pdf.js extracts each page's text in the renderer (`src/shared/pdfText.ts` joins text items into lines, repairs hyphenation and finds labels such as `Definition 2.2.1` at the start of a line), and the result is cached in the data folder (`script-index.json` for the built-in script, `courses/<id>/text/<material>.json` otherwise). "Re-read" rebuilds it. Neither the PDFs nor their text are ever part of the repository: `*.pdf` and caches are git-ignored.

A learn session sends up to `maxPages` (8 by default) pages of the goal's range in the system prompt; a practice or review item sends up to 3 pages of its concept. With **Ground steps in the script** off, no page text is sent, and the tutor works from section and theorem numbers. Script blocks, the course map and the reader (Materials → Open) open the exact page in the app's own viewer (`PdfPage.tsx`).

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
* **Models per task.** `settings.tasks` holds a provider (`claude` or `gemini`), model and effort for each kind of work: `tutor` (steps, open chat, the agent), `map` (course maps) and `grading` (grades and solution checks). `routeFor` (`src/shared/models.ts`) picks the task of a request (`taskOf`) and fills in the model and effort; effort `auto` keeps what the app asks for per call (low for quick grading, high for checking a solution). `src/node/providers.ts` sends the call to the Claude Code CLI or the Gemini API and is shared by the desktop app and the browser dev server. Settings from before tasks existed (`cli.model`, `cli.effort`, `cli.mapModel`) are carried over once (`migrateSettings`).
* **Gemini.** Structured calls use `models/<model>:streamGenerateContent?alt=sse` with the app's JSON schema as `responseJsonSchema` (`src/node/gemini.ts`); streamed JSON is parsed as it arrives for the partial cards, the learner's files go inline (`inlineData`, about 18 MB per call). Effort becomes `thinkingConfig.thinkingLevel` (low/medium/high, plus xhigh on Gemini 4 Neon and Hydrogen; higher efforts are clamped to the model's top level), or a `thinkingBudget` for 2.x models. A task with no model runs on `gemini-4-hydrogen`. The tutor agent on Gemini (`src/node/geminiAgent.ts`) runs the same app tools as function declarations in a loop: each function call becomes a `tool_call` event and waits for the app's result, which goes back as a `functionResponse`. The model's parts are kept exactly as received (thought signatures must be sent back with function calls), the conversation is sent in full each call and saved per chat in `gemini-chats/<session>.json`, so a reopened chat continues. A chat that moves from Gemini to Claude starts a fresh Claude Code session. The model list in Settings comes from `GET /v1beta/models` with the saved key, filtered to text models. The key check is loose (Google issues keys in more than one format), so a bad key shows up on Test the connection. Gemini usage is not priced in the app (Google AI Studio shows it).
* **Account.** `cli.auth` is `subscription` (the Claude Code login) or `api-key` (API credits). The key is saved by the main process with Electron `safeStorage` (system keychain) in `secrets/anthropic-api-key.bin` (the Google key in `secrets/google-api-key.bin`), outside the JSON store the renderer can read; the renderer only sees whether a key is saved and its last four characters. For each call `applyAuth` sets `ANTHROPIC_API_KEY` in the CLI's environment (Claude Code then bills the key, not the login); on the subscription it removes any `ANTHROPIC_API_KEY` inherited from the shell, so nothing is billed by surprise. With API credits chosen and no key saved, calls fail at once with a message that says where to add one. On Linux without a keyring (`basic_text` backend) the key is not saved. The browser dev server takes the keys from its own `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`.
* **Cost.** The main process adds each call's `total_cost_usd` (as Claude Code reports it) to `usage.json` per day, account and kind of work (`src/shared/usage.ts`); Settings shows today and this month.
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
| `script-index.json` | the extracted text of the built-in course's lecture notes (local only) |
| `courses-index.json`, `courses/<id>/…` | courses the learner added, materials, maps, per-course state (see Courses and materials) |
| `profile.json` | the learner profile, shared by all courses |
| `courses/<id>/exam.json`, `courses/<id>/work/<submission>/` | exam date and goals, problem sets and mock exams done, uploaded solutions and their grades |

Settings → Data exports the learner model, answers and points as one JSON file, imports such a file, or resets everything.

## Voice

`src/renderer/src/voice/`. Speech to text runs Whisper through transformers.js in a web worker, on WebGPU when available and WASM otherwise. The model (tiny, base or small, English-only or multilingual) is downloaded once from Hugging Face and cached, and audio never leaves the computer. With **Gemini** chosen as the speech recognition model (`sttModel: 'gemini'`), the recording is encoded as 16 kHz WAV and sent from the main process to `generateContent` with the Google key, inline, together with a prompt holding the course name and concept titles: transcribe verbatim, never translate, write spoken math as LaTeX (`src/shared/stt.ts`, `transcribeGemini` in `src/node/gemini.ts`). It uses the tutor's Gemini model if the tutor runs on Gemini, else the default Gemini model, with low thinking. If it fails (no key, offline, an error) the local Whisper Base transcribes instead and a note says so. Speech output uses the system voices through the Web Speech API and reads each card's `speech` field: a short spoken version of the card with the maths said out loud.

## Visuals

* **Demos** (`src/renderer/src/demos/`): 14 interactive components that the tutor configures with `demo.params`. They compute with `src/shared/numerics.ts` (Lagrange and barycentric interpolation, Lebesgue functions, Chebyshev nodes and polynomials, the DFT and trigonometric interpolation, splines, quadrature rules, fixed-point and Newton iterations, the SVD of a 2×2 matrix, least squares), which is unit tested.
* **Plots** (`Chart.tsx`, `src/renderer/src/lib/axes.ts`): math.js expressions or explicit points, linear or logarithmic axes, with tested tick generation.
* **Diagrams:** Mermaid for algorithms and concept maps, dagre for the plan tree.
* **Widgets** (`src/renderer/src/widgets/`): the default for interactive content. The tutor writes a few lines of JavaScript against the widget kit (`kit.js`, global `K`: `K.demo` with sliders, choices, toggles, buttons, a play clock; plot views with functions, curves, points, areas, arrows, vector fields, heat maps, level curves and draggable handles; panels with cells and bit patterns; a readout; helpers such as an RK4 `K.ode`). The app sends the kit, its stylesheet (`kit.css`, the Ma tokens) and the IBM Plex fonts with the code into `widget.html`, a sandboxed iframe with an opaque origin and a CSP that allows inline code only and no network. The frame sizes itself to the content, and errors are shown in the widget and returned to the tutor with the card's result so it can fix the code. The prompt documents the kit (`# Widget kit` in `prompts.ts`). The built-in demos stay as ready-made references the tutor may pick when one shows exactly the idea.
* **Sketches** (legacy): free-form HTML from older transcripts still renders in `sketch.html`; the tutor no longer writes them.

Model-written expressions are evaluated by a locked-down math.js instance (`src/shared/mathx.ts`) in which `import`, `evaluate`, `parse`, `createUnit`, `simplify` and `derivative` are unavailable.

## Security

* The renderer runs sandboxed, with context isolation and without Node integration. `src/preload/index.ts` is the only bridge and exposes a fixed set of calls.
* App pages are served from a custom `app://` protocol with a strict Content Security Policy. The only outside hosts it allows are Hugging Face's, for the one-time Whisper download.
* Navigation away from the app is blocked, and external links open in the system browser.
* The only permission granted is the microphone, and only to the app's own pages.
* The dev server listens on 127.0.0.1 only and refuses requests with a foreign Host or Origin header, and writes without a JSON content type.
* The CLI runs without built-in tools, so model output can never act on the computer. The one exception is checking an uploaded solution: that request may use Read, confined to the submission's folder. The tutor agent can only call the app's own tools, through a server that listens on 127.0.0.1, needs a random bearer token per chat and refuses requests with an Origin header.

## Testing

* `npm test` runs the unit tests (vitest) for the learner model, FSRS, grading, item selection, stats and rewards, the course graph's integrity, prompts and schemas, the normalization of sloppy and partial output, the partial JSON parser, numerics, chart axes, Markdown and LaTeX repair, the math sandbox and the CLI arguments. Shared fixtures are in `tests/unit/helpers.ts`.
* `npm run e2e` uses Playwright to walk through onboarding, a learn session with the scripted agent (probes, plan review, teaching, a question typed while a card waits), a practice session with the agent, an open chat, a guided practice session and every screen with the scripted tutor, in the browser or, with `--electron`, in the built app. It fails on any console error.
* `src/shared/fakeTutor.ts` produces every card kind, block type and interaction deterministically. It powers the demo mode and the end-to-end run.
* `scripts/try-step.ts` sends one real step through the CLI and prints the cards and timings, for work on the prompts.
