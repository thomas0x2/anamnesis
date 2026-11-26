# Anamnesis

A dark desktop tutor that teaches the way memory research says works: short interactive steps, questions before answers, nudges instead of solutions, and a persistent model of your understanding that decides what comes next. It ships with a full course map for **Numerical Methods for CS** (NumCS, ETH Zurich, HS26), and you can add any other course by giving it the course's PDFs.

The tutor is Claude, run through the **Claude Code CLI** on your own Claude login. It reads the relevant pages of your course materials, so it uses their notation and numbering, and every card can open the exact page.

> *Anamnesis* (ἀνάμνησις): recollection. Plato's idea that learning is remembering. Here, learning is retrieving.

## What it does

**Any course, built from its PDFs.** NumCS comes with a hand-made map of 87 concepts. For any other course, choose **New course…** in the course menu next to the logo, then add its materials: the script, each week's slides, problem sets, solutions, old exams. Each PDF is read on your computer and Claude turns it into concepts with their prerequisites, linked to what the map already has; a problem set adds no duplicates but ties each task to the concepts it practises. Point a course at the folder where you save its files and new PDFs are picked up as they appear (when the app opens or comes to the front), so the course map, the "ready to learn" list and practice grow week by week. Every course keeps its own progress; how you like to learn is shared.

**A tutor agent behind every session.** Learning a topic, practice and spaced reviews all run with a tutor agent that builds each card on the fly with its tools: the probe questions, the plan of reasoning steps you review, the explanations with equations, plots and interactive demos, the checks, the right page of the script. It reads your mind model before it decides what to do and writes to it afterwards. The session screen stays the familiar one (phases, plan review, side panel, results), with the tutor's short notes between the cards and a message box at the bottom: type or dictate a question at any moment, even in the middle of a card. The Tutor page starts an open conversation. (Settings → Learning switches back to the fixed guided sessions below.)

**Learn a concept in three phases**

1. **Probe.** A few quick diagnostic questions (with an honest "I don't know" button) find out what you already know about the goal and its prerequisites.
2. **Plan.** The tutor builds a dependency tree of reasoning steps from what you already understand to the goal. You see it, can mark steps you already know (they are skipped) or have them taught, then start walking it.
3. **Teach.** Each step runs *predict → explain → check*: you guess the next step first, the tutor builds on your guess, then a check in a new surface shows whether it landed. A failed check gets a different explanation, not the same one again. At the end you explain the whole chain back in your own words (typed or spoken).

**Practice that gets harder.** Each concept has a difficulty staircase from L1 (recall) to L5 (exam transfer). Three clean answers in a row raise the level, one miss lowers it. Harder levels compose concepts and make cues less familiar, and include exam-style "(S)/(M) which statement is wrong" items and numpy code completion. Topics are interleaved.

**Spaced reviews.** Every concept has an FSRS-6 memory model. Reviews come back just before you would forget, least-remembered first.

**Nudges, not answers.** Hints form a ladder from "what is asked?" to almost the whole step. The full solution is always one click away, but using it counts honestly.

**A mind model you can inspect.** Mastery with an uncertainty band, memory strength, practice level, understanding, independence and transfer, misconceptions (active and resolved), the tutor's notes and your own notes, and the evidence behind every number. Everything is editable.

**Honest stats.** Readiness per chapter, calibration (how often you are right when you say you are sure), accuracy by difficulty, activity, upcoming reviews, help needed over time. Every chart has a table view.

**Visual.** Fourteen interactive demos (interpolation and the Runge phenomenon, Lebesgue functions, Chebyshev polynomials, cancellation, Fourier series, roots of unity, trigonometric interpolation, aliasing, splines, quadrature, fixed-point cobwebs, Newton, the SVD, least squares), plots, diagrams and small sketches.

**Voice.** Answers can be spoken: Whisper runs locally on your computer (the model downloads once), or, if you choose it in Settings → Voice, Gemini transcribes the recording with your Google AI key (better with technical terms, and it writes spoken math as LaTeX; the audio is sent to Google, and the local model takes over if Gemini fails). Cards can be read aloud with your system voices.

**Study time and breaks.** The app counts the time you actively study (per session, day and course; Stats, Today and the clock in the top bar) and the tutor suggests a break at a natural pause when one is due: by default 10 minutes after 50 minutes of study and 25 minutes after about 2.5 hours, with ideas that get you away from the screen. A break screen counts it down.

**Insight points.** Points reward evidence of understanding (a prediction you committed to, a check solved without help, an explanation of the whole chain, a confident error you corrected), never time spent or clicks. Every award says what earned it.

## Quick start (macOS)

You need [Node.js](https://nodejs.org) 22 or newer and the Claude Code CLI.

```bash
# 1. Claude Code, once: install and sign in with your Claude account
npm install -g @anthropic-ai/claude-code
claude            # follow the login, then quit

# 2. The app
git clone https://github.com/thomas0x2/anamnesis.git
cd anamnesis
npm install
npm run dev       # starts the app with hot reload
```

After a `git pull`, run `npm ci` before `npm run dev`: the app refuses to start when the installed packages do not match `package-lock.json` (old packages break things quietly, such as math showing as raw `$…$`). Settings shows the build at the bottom (commit and date), so you can check you are on the latest version.

On first start a short welcome tour connects the tutor (it tests the CLI), asks for your copy of `lnNPIinf26.pdf` (the NumCS lecture notes), and lets you tick a few notes about how you learn. The PDF is read once and indexed locally.

To add another course: course menu (next to the logo) → **New course…**, fill in the name and, if you know it, the exam format, choose the folder where you keep its PDFs, and let the app read them. Mapping a set of slides takes about a minute; a long script is read in parts and takes a few minutes. The **Materials** page lists every file, what it added to the map, and lets you change a file's kind, map it again or remove it.

**Exam prep** tracks each course toward its exam: set the exam date, how many problem sets the course will have and how many mock exams you want to write (two by default), and see what is done and the pace you need. Problem sets are the files of kind "problem set", mock exams those of kind "exam". **Check my solution** takes a scan, photos or a tablet PDF of your own solution (handwriting is fine) or typed answers: Claude reads it, grades every task against the problem statement (and the official solution, if the course has one), and the grade updates the concepts each task tests in your mind model. Say honestly how you worked (on your own, with notes, with help): work done with help counts less.

**Plan** looks across all your courses. It estimates the work left before each exam (learning the concepts of the map that are not yet proficient, the reviews due, and the problem sets and mock exams still to do, timed from the minutes you log) and spreads it over the days until a week before the exam, so you see about how long to study each day in total and per course, split into learning, problem sets and mock exams. Courses are ordered by how much of today's share is still open (time studied today and your recent pace come from the study time log); behind or close to the exam moves a course up. For every problem set and mock exam still to do it marks whether you can fully solve it with the topics you have covered, names the missing topics otherwise, and suggests the topic that brings a set closest. Today shows the course to start with.

**Paying with API credits instead of your Claude plan.** If you keep hitting your plan's usage limits, the app can bill an Anthropic API key instead: create a key in the [Anthropic Console](https://console.anthropic.com/settings/keys), add credits under [Billing](https://console.anthropic.com/settings/billing), then in **Settings → Tutor** choose **API credits** and paste the key. It is stored encrypted with the macOS keychain and only handed to Claude Code (as `ANTHROPIC_API_KEY`) for the app's own calls. **Cost** shows what the Claude calls cost today and this month. You can switch back to the subscription at any time.

**Claude or Gemini, per task.** Settings → Tutor sets the provider (Claude or Google Gemini), model and effort separately for the tutor, for building course maps and for grading, so bulk work can run on a cheaper model. Gemini runs through the Gemini API on your own key: create one in [Google AI Studio](https://aistudio.google.com/apikey) (turn on billing there for higher limits) and paste it into **Google AI API key**; it is stored encrypted like the Anthropic key. The model field suggests current models and, once a key is saved, lists the ones your key can use; any other model name works too. Without a model name it uses Gemini 4 Hydrogen; Neon, Carbon and Argon are suggested too. Effort maps to Gemini's thinking levels (low, medium, high, and Extra for Neon and Hydrogen).

To build a standalone app: `npm run dist:mac`, then open `dist/mac-arm64/Anamnesis.app` (or `dist/mac/` on Intel). Drag it to Applications if you like.

No Claude yet? Choose **Use the demo tutor** in the welcome tour or in Settings. It runs a scripted tutor that shows every card type and screen, with generic content.

## Settings worth knowing

* **Model and effort.** By default the CLI uses your Claude Code default model. Settings → Tutor lets you name a model, a fallback model, and the effort level (higher is slower but more careful).
* **Script pages per step.** How many PDF pages the tutor gets as context for one step (default 8).
* **Voice.** Speech recognition (a local Whisper size, or Gemini in the cloud) and language (English, German or auto), speech output, voice and rate.
* **Learning.** Target retention for reviews (default 90%) and items per practice session.
* **Study time and breaks.** Whether the tutor suggests breaks, and the rhythm: 50/10 (default), 25/5, 90/15 or your own, with a long break every few hours.
* **Data.** Export everything as JSON, import it again, or reset.

## Privacy and the lecture notes

* PDFs never leave your computer as files and are not part of this repository. Only the text of the few pages relevant to the current step is sent to Claude, inside your own Claude Code session. When you add a material, its text is sent to Claude once (in parts) to build the course map; the map of a course you create is stored in your data folder, not in this repository. Check that your course's materials may be used this way.
* The script's title page asks that it not be uploaded to generative AI without the author's consent. The author agreed to this use for this app demo. If that agreement does not cover you, turn off **Settings → Lecture notes → Ground steps in the script**; the tutor then works from section and theorem numbers, and you can still open every page in the app.
* Solutions you upload for checking are copied to your data folder (`courses/<id>/work/`) and read by Claude from there. For that one request the CLI gets the Read tool, limited to that submission's folder.
* Your learner model, sessions, settings, courses and their maps are JSON files in `~/Library/Application Support/Anamnesis` (written atomically, with one backup each).
* The CLI runs with no built-in tools, no slash commands and no settings, in an empty working folder. The tutor agent can only use the app's own tools (cards, plan, mind model, script pages), served on 127.0.0.1 with a per-chat token. It cannot read or change anything else on your computer.

## Development

```bash
npm run dev          # Electron with hot reload
npm test             # unit tests (vitest): learner model, FSRS, grading, numerics, parsing, prompts
npm run typecheck    # main + renderer
npm run build        # production build into out/
npm run e2e          # browser end-to-end run with the scripted tutor (needs Playwright)
npm run e2e -- --electron   # the same flow in the built desktop app (run npm run build first)
```

Running the UI in a normal browser (for development or screenshots):

```bash
ANAMNESIS_FAKE=1 ANAMNESIS_SCRIPT=/path/to/lnNPIinf26.pdf npm run dev-server   # API on 127.0.0.1:5318
npm run web                                                                   # UI on 127.0.0.1:5317
```

Leave out `ANAMNESIS_FAKE=1` to use the real CLI from the browser. `?backend=demo` in the URL runs entirely in the browser with the scripted tutor.

`node_modules/.bin/jiti scripts/try-step.ts <conceptId> [phase] [pdfPath]` sends one real tutor step through the CLI and prints the cards and timings, which is handy when changing prompts.

Project layout:

```
courses/numcs/course.json   the built-in course graph: 87 concepts, prerequisites, script pages, demos
src/shared/                 pure logic shared by all processes (learner model, FSRS, grading, prompts, schemas, numerics)
src/node/                   Claude Code CLI runner, the tutor agent and its MCP tool bridge, JSON storage
src/main/, src/preload/     Electron main process and the bridge to the renderer
src/renderer/src/           React UI: engine/ (app state, sessions, script index), views/, components/, voice/
scripts/                    dev server, end-to-end run, prompt tryout
tests/unit/                 unit tests
docs/                       the learning science behind the design, and the architecture
```

More: [docs/LEARNING_SCIENCE.md](docs/LEARNING_SCIENCE.md) explains which findings shaped which feature, and [docs/DESIGN.md](docs/DESIGN.md) describes how the app works inside.

## Credits

Inspired by [learnharness](https://github.com/amosblomqvist/learnharness). Memory model: [FSRS-6](https://github.com/open-spaced-repetition) by the open-spaced-repetition project. Built with Electron, React, KaTeX, pdf.js, math.js, Mermaid, dagre and transformers.js.

The NumCS course content belongs to the lecture notes by V. Gradinaru (ETH Zurich). This repository contains only a map of the script's structure (concept names, prerequisites, page ranges), not its text. Courses you add are built on your computer from your own files and never become part of the repository.
