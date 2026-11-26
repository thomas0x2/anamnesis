// End-to-end run of the whole demo flow with the scripted tutor, in a real browser or in Electron.
//
//   npm run e2e                 browser: starts the dev server (fake tutor, empty temp data) and Vite
//   npm run e2e -- --electron   the built desktop app (run `npm run build` first; on Linux CI wrap in xvfb-run)
//   E2E_HEADED=1                show the browser window
//   E2E_SHOTS=/some/dir         save a screenshot of every new card kind
//
// It walks onboarding, a full learn session (probe → plan → teach → wrap), a practice session,
// and opens every main screen. It fails on any page error or console error.
// Needs Playwright: `npm i -D playwright && npx playwright install chromium` if it is not installed globally.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
let playwright
try {
  playwright = require('playwright')
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const electronMode = process.argv.includes('--electron')
const shotsDir = process.env.E2E_SHOTS ? resolve(process.env.E2E_SHOTS) : null
const dataDir = mkdtempSync(join(tmpdir(), 'anamnesis-e2e-'))
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const children = []
const errors = []
let failed = false

function start(cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  p.stdout.on('data', (d) => (log += d))
  p.stderr.on('data', (d) => (log += d))
  p.log = () => log
  children.push(p)
  return p
}

async function waitFor(url, ms = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`timed out waiting for ${url}`)
}

function cleanup() {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

const step = (msg) => console.log(`· ${msg}`)

/** A small valid PDF with one line of text per page (fixtures for the materials flow; no course content). */
function makePdf(lines) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const kids = []
  for (const line of lines) {
    const text = line.replace(/[()\\]/g, '')
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const content = objs.length
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`)
    kids.push(`${objs.length} 0 R`)
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

/** A second course built from PDFs in a folder: create it, read and map the files, add one more later, switch back. */
async function coursesFlow(page) {
  const folder = join(dataDir, 'fixture-course')
  mkdirSync(join(folder, 'Exercises'), { recursive: true })
  writeFileSync(join(folder, '01-Basics.pdf'), makePdf(Array.from({ length: 12 }, (_, i) => `Basics slide ${i + 1}: state space models`)))
  writeFileSync(join(folder, 'Exercises', 'serie1.pdf'), makePdf(['Exercise 1: modelling', 'Exercise 2: linearisation']))
  const pointsBefore = (await page.locator('.points').textContent())?.trim()

  await page.locator('.course-btn').click()
  await page.getByRole('menuitem', { name: /New course/ }).click()
  await page.getByPlaceholder('Systems Programming and Computer Architecture').fill('Fixture Systems')
  await page.getByPlaceholder('SPCA').fill('FS')
  await page.getByPlaceholder('/path/to/the/course/folder (optional)').fill(folder)
  await page.getByRole('button', { name: 'Create course' }).click()
  await page.locator('.course-btn', { hasText: 'FS' }).waitFor()
  step('new course created from the course menu')
  await page.locator('.course-notice').waitFor()
  await nav(page, 'Materials').click()
  await page.getByRole('heading', { name: 'Materials', level: 1 }).waitFor()
  await page.locator('.mat-row', { hasText: '01-Basics.pdf' }).locator('.mat-status', { hasText: 'mapped' }).waitFor({ timeout: 60_000 })
  await page.locator('.mat-row', { hasText: 'serie1.pdf' }).locator('.mat-status', { hasText: 'mapped' }).waitFor({ timeout: 60_000 })
  const kind = await page.locator('.mat-row', { hasText: 'serie1.pdf' }).locator('select').inputValue()
  if (kind !== 'exercises') throw new Error(`serie1.pdf was taken for ${kind}, not a problem set`)
  step('the folder was scanned, both PDFs read and mapped (the problem set recognised)')
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-materials.png`) })

  // next week: a new file appears in the folder
  writeFileSync(join(folder, '02-Feedback.pdf'), makePdf(Array.from({ length: 6 }, (_, i) => `Feedback slide ${i + 1}: closed loop`)))
  await page.getByRole('button', { name: /Check now/ }).click()
  await page.locator('.mat-row', { hasText: '02-Feedback.pdf' }).locator('.mat-status', { hasText: 'mapped' }).waitFor({ timeout: 60_000 })
  step('a PDF added to the folder later extends the map')

  // a build that fails can be retried, and goes on without starting over
  writeFileSync(join(folder, '03-Flaky.pdf'), makePdf(['Flaky slide 1: observers [fake: fail once]', 'Flaky slide 2: observers']))
  await page.getByRole('button', { name: /Check now/ }).click()
  const flaky = page.locator('.mat-row', { hasText: '03-Flaky.pdf' })
  await flaky.locator('.mat-status', { hasText: 'failed' }).waitFor({ timeout: 60_000 })
  await flaky.getByRole('button', { name: 'Retry' }).click()
  await flaky.locator('.mat-status', { hasText: 'mapped' }).waitFor({ timeout: 60_000 })
  step('a failed build shows Retry, and retrying finishes it')

  await nav(page, 'Course map').click()
  await page.getByRole('heading', { name: 'Course map', level: 1 }).waitFor()
  const sub = (await page.locator('.page-head .sub').first().textContent()) ?? ''
  const n = Number(/(\d+) concepts/.exec(sub)?.[1] ?? 0)
  if (n < 3) throw new Error(`expected concepts from the materials on the map, got "${sub}"`)
  step(`the course map has ${n} concepts from the materials`)
  await nav(page, 'Materials').click()
  await page.locator('.mat-row', { hasText: '01-Basics.pdf' }).getByRole('button', { name: /Open/ }).click()
  await page.getByRole('heading', { name: 'Reader', level: 1 }).waitFor()
  await page.locator('canvas.pdf-page').waitFor()
  step('the reader opens a material')
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-reader.png`) })

  await nav(page, 'Today').click()
  await page.getByRole('button', { name: 'Start with a probe' }).click()
  if (!((await runSession(page, 'new course learn')) > 0)) throw new Error('the learn session in the new course earned no points')

  // exam preparation: the date and goal, then the learner's own solution to the problem set, checked
  await nav(page, 'Exam prep').click()
  await page.getByRole('heading', { name: 'Exam prep', level: 1 }).waitFor()
  const inDays = new Date(Date.now() + 60 * 86_400_000)
  const ymd = `${inDays.getFullYear()}-${String(inDays.getMonth() + 1).padStart(2, '0')}-${String(inDays.getDate()).padStart(2, '0')}`
  await page.getByLabel('Exam date').fill(ymd)
  await page.getByLabel('Number of problem sets').fill('10')
  await page.getByLabel('Number of problem sets').press('Enter')
  await page.locator('.page-head .sub', { hasText: '60 days until the exam' }).waitFor()
  await page.locator('.exam-goal', { hasText: 'problem sets' }).getByText('of 10 done').waitFor()
  const row = page.locator('.work-row', { hasText: 'Serie 1' })
  const pts0 = Number(((await page.locator('.points').textContent()) ?? '').replace(/\D/g, ''))
  await row.getByRole('button', { name: 'Check my solution' }).click()
  await page.getByLabel('Solution files').setInputFiles({ name: 'my-solution.pdf', mimeType: 'application/pdf', buffer: Buffer.from(makePdf(['Task 1: x = 2', 'Task 2: wrong ??'])) })
  await page.getByText('my-solution.pdf').waitFor()
  await page.getByRole('button', { name: 'With the script or my notes' }).click()
  await page.locator('.modal').getByRole('button', { name: 'Check my solution' }).click()
  await row.locator('.work-status', { hasText: 'done' }).waitFor({ timeout: 60_000 })
  if ((await row.locator('.work-task').count()) < 2) throw new Error('the checked solution shows no graded tasks')
  await row.locator('.chip', { hasText: 'not attempted' }).waitFor()
  const pts1 = Number(((await page.locator('.points').textContent()) ?? '').replace(/\D/g, ''))
  if (!(pts1 > pts0)) throw new Error(`a checked solution earned no points (${pts0} -> ${pts1})`)
  await page.locator('.exam-goal', { hasText: 'problem sets' }).locator('.big', { hasText: '1' }).waitFor()
  step('exam date and goal set; a solution was uploaded, graded per task and counted toward the goal')
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-exam.png`) })
  const tagged = row.locator('.work-task .chip.outline').first()
  await tagged.click()
  await page.getByRole('heading', { name: 'Mind model', level: 1 }).waitFor()
  await page.getByText('Problem set').first().waitFor()
  step('the graded tasks updated the concepts in the mind model')

  // a problem set without a PDF (a coding task on Code Expert): add it, log a result, have the code checked
  await nav(page, 'Exam prep').click()
  await page.getByRole('button', { name: 'Online task' }).click()
  await page.getByLabel('Title').fill('Exercise 4: Lists')
  await page.getByLabel('Link', { exact: true }).fill('expert.ethz.ch/ex4')
  await page.getByLabel('Search concepts').fill('e')
  await page.locator('.concept-pick-item').first().click()
  await page.locator('.modal').getByRole('button', { name: 'Add' }).click()
  const online = page.locator('.work-row', { hasText: 'Exercise 4: Lists' })
  await online.locator('.work-platform', { hasText: 'Code Expert' }).waitFor()
  await online.getByRole('button', { name: 'Log result' }).click()
  await page.getByLabel('Points or tests passed').fill('6')
  await page.getByLabel('Maximum').fill('8')
  await page.locator('.modal').getByRole('button', { name: 'Log result' }).click()
  await online.locator('.work-status', { hasText: 'done' }).waitFor()
  await online.locator('.submission .big', { hasText: '6/8' }).waitFor()
  await page.locator('.exam-goal', { hasText: 'problem sets' }).locator('.big', { hasText: '2' }).waitFor()
  step('an online task was added, a result logged, and it counts toward the goal')
  await online.getByRole('button', { name: 'Check my work' }).click()
  await page.getByLabel('Solution files').setInputFiles({ name: 'list.c', mimeType: 'text/x-c', buffer: Buffer.from('int main(void) { return 0; }\n') })
  await page.getByText('list.c').waitFor()
  await page.locator('.modal').getByRole('button', { name: 'Check my work' }).click()
  await online.locator('.work-task').first().waitFor({ timeout: 60_000 })
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-exam-online.png`) })
  step('code for the online task was uploaded and checked per task')

  // correct a logged result afterwards
  await online.locator('.submission', { hasText: 'logged result' }).getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Points or tests passed').fill('5')
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click()
  await online.locator('.submission .big', { hasText: '5/8' }).waitFor()
  step('a logged result was edited afterwards')

  // the platform window (played by the dev server in fake mode): open a page, import a task and its code from it
  await page.getByLabel('Platform link').fill('https://expert.ethz.ch/ide/ex5')
  await page.locator('.platform-bar').getByRole('button', { name: 'Open in app' }).click()
  await page.getByRole('button', { name: 'Online task' }).click()
  await page.getByRole('button', { name: 'Fill from the open page' }).click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="Title"]')?.value === 'Exercise 4: Lists', null, { timeout: 5000 }).catch(() => {
    throw new Error('the task title was not taken from the page')
  })
  await page.getByLabel('Title').fill('Exercise 5: Reverse')
  await page.locator('.modal').getByRole('button', { name: 'Add' }).click()
  const imported = page.locator('.work-row', { hasText: 'Exercise 5: Reverse' })
  await imported.getByText('statement pasted').waitFor()
  await imported.getByRole('button', { name: 'Import from page' }).click()
  await page.locator('.import-page', { hasText: 'result 7/8' }).waitFor()
  await page.locator('.modal').getByRole('button', { name: 'Import' }).click()
  await imported.locator('.submission .big', { hasText: '7/8' }).waitFor()
  await imported.locator('.work-task').first().waitFor({ timeout: 60_000 })
  step('a task, the test result and the code were imported from the platform page and checked')

  await nav(page, 'Today').click()
  await page.locator('.exam-notice', { hasText: 'Exam in 60 days' }).waitFor()
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-today-exam.png`) })
  step('Today shows the exam countdown and the goal')
  await page.locator('.mastery-map .cell.here').first().waitFor()
  await page.locator('.exam-pace .pace-note', { hasText: /of 12/ }).waitFor()
  await page.locator('.activity .day.today').waitFor()
  if (shotsDir) {
    await page.setViewportSize({ width: 1380, height: 2000 })
    await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-today-progress.png`) })
    await page.setViewportSize({ width: 1380, height: 900 })
  }
  step('Today shows where you are on the course, the pace toward the exam and recent activity')

  // the plan across courses: this course has an exam date, so it is scheduled first; NumCS has none yet
  await page.locator('.plan-notice', { hasText: 'Start with FS' }).waitFor()
  await nav(page, 'Plan').click()
  await page.locator('.plan-course.first', { hasText: 'Fixture Systems' }).waitFor()
  await page.locator('.plan-course.first .plan-step').first().waitFor()
  await page.locator('.plan-rest .plan-course', { hasText: 'no exam date' }).waitFor()
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-plan.png`) })
  step('the plan puts the course with an exam date first, with its daily time and next steps')
  await nav(page, 'Today').click()

  await page.locator('.course-btn').click()
  await page.getByRole('menuitemradio', { name: /NumCS/ }).click()
  await page.locator('.course-btn', { hasText: 'NumCS' }).waitFor()
  const pointsAfter = (await page.locator('.points').textContent())?.trim()
  if (pointsAfter !== pointsBefore) throw new Error(`switching back changed the points: ${pointsBefore} -> ${pointsAfter}`)
  step('switching back to the first course keeps its progress')
}
let shotN = 0
const seenKinds = new Set()
let reasoned = false

/** Answer whatever the current card asks until the session's done screen appears. */
async function runSession(page, label) {
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(200)
    if (await page.locator('.done-hero').count()) {
      const pts = Number(((await page.locator('.done-hero .pts').textContent()) ?? '').replace(/[^\d]/g, ''))
      step(`${label}: done after ${i} moves, +${pts} insight points`)
      return pts
    }
    const walk = page.getByRole('button', { name: /Start walking the tree/ })
    if (await walk.count()) {
      await walk.click()
      continue
    }
    const card = page.locator('.card.current').last()
    if (!(await card.count())) continue
    await answerCard(page, card, label)
  }
  throw new Error(`${label}: the session did not finish`)
}

/** An agent session: the same screen, with cards the agent's tools create; answer them until the results show and the agent is idle. */
async function runChat(page, label, { askMidway = false } = {}) {
  let asked = false
  page.setDefaultTimeout(5_000)
  for (let i = 0; i < 500; i++) {
    await page.waitForTimeout(200)
    const idle = (await page.locator('.agent-status.idle').count()) > 0
    const open = page.locator('.session .card.current:not(.plan-review)')
    if (idle && (await page.locator('.done-hero').count()) && !(await open.count())) {
      const pts = Number(((await page.locator('.done-hero .pts').textContent()) ?? '').replace(/[^\d]/g, ''))
      page.setDefaultTimeout(30_000)
      step(`${label}: agent session done after ${i} moves, +${pts} insight points`)
      return pts
    }
    const walk = page.getByRole('button', { name: /Start walking the tree/ })
    if (await walk.count()) {
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-plan.png`) })
      await walk.click().catch(() => {})
      continue
    }
    if (askMidway && !asked && (await page.locator('.agent-status.waiting').count()) && (await open.count())) {
      // write to the tutor while it waits on a card: the message becomes the card's result and gets an answer
      const box = page.getByRole('textbox', { name: 'Message to the tutor' })
      await box.fill('Why are the weights computed only once?')
      await box.press('Enter')
      await page.locator('.assistant-msg', { hasText: 'you asked: Why are the weights' }).waitFor({ timeout: 15_000 })
      asked = true
      step(`${label}: a question typed mid-card got an answer`)
      // the tutor's next card waits until the open card is done; a placeholder holds its place meanwhile
      await page.locator('.card-waiting').waitFor({ timeout: 15_000 })
      step(`${label}: the next card waits behind a visible placeholder`)
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-asked.png`) })
      continue
    }
    // a cheat sheet suggestion in the stream: add it to the sheet
    const addCheat = page.locator('.cheat-suggest').getByRole('button', { name: 'Add', exact: true })
    if (await addCheat.count()) {
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-cheat-suggestion.png`) })
      await addCheat.first().click()
      await page.locator('.cheat-suggest .chip.good').first().waitFor()
      cheatAdded = true
      step(`${label}: the tutor suggested a cheat sheet entry and it was added`)
    }
    if (!(await open.count())) continue
    // the agent can add cards while we act: a card that vanished mid-answer is not an error
    await answerCard(page, open.last(), label).catch((e) => {
      if (!/Timeout|detached|not attached/i.test(String(e))) throw e
    })
  }
  throw new Error(`${label}: the agent session did not finish`)
}

/**
 * Math must never show as source: every rendered Markdown element (cards, options, feedback, chat) is checked for
 * dollar signs or TeX commands left in its visible text (code and KaTeX output excluded).
 */
let mathChecks = 0
let cheatAdded = false
let peekChecked = false
async function assertMathRendered(page, where) {
  const raw = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('.md')) {
      const c = el.cloneNode(true)
      c.querySelectorAll('code, pre, .katex, .katex-display, textarea, input').forEach((x) => x.remove())
      const t = (c.textContent || '').replace(/\s+/g, ' ')
      if (/\$[^$]*[\\^_{]|\\(frac|cdot|varepsilon|approx|times|sum|ell|prod|sqrt|alpha|lambda)\b|\\[()[\]]/.test(t)) bad.push(t.slice(0, 160))
    }
    return bad
  })
  if (raw.length) throw new Error(`${where}: math shown as source: ${JSON.stringify(raw.slice(0, 3))}`)
  mathChecks++
}

async function answerCard(page, card, label) {
  await assertMathRendered(page, label)
  // once: a script reference opens the page viewer, and its close button (not only Esc) closes it
  const peekOpen = card.locator('.btn', { hasText: /^\s*Open\s*$/ })
  if (!peekChecked && (await peekOpen.count())) {
    await peekOpen.first().click()
    const peek = page.locator('.peek')
    await peek.waitFor()
    await peek.getByTitle('Close (Esc)').click()
    await peek.waitFor({ state: 'detached', timeout: 5000 })
    peekChecked = true
    step('the script page viewer closes with its close button')
  }
  {
    const kind = ((await card.locator('.kind').first().textContent().catch(() => '')) || '').trim()
    if (shotsDir && kind && !seenKinds.has(kind)) {
      seenKinds.add(kind)
      await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-${kind.replace(/\W+/g, '_')}.png`) })
    }
    const next = card.locator('.actions .btn.primary', { hasText: /Continue|Next|Finish|See results/ })
    if (await next.count()) {
      await next.first().click()
      return
    }
    const opts = card.locator('.option:not([disabled])')
    if ((await opts.count()) && !(await card.locator('.option.selected').count())) await opts.first().click()
    const num = card.locator('.numeric-input input, input.numeric-input')
    // right for the scripted tutor's practice item (λ0 for nodes 0, 1, 2); wrong for the others, which exercises retries and reveals
    if ((await num.count()) && !(await num.first().inputValue())) await num.first().fill('1/2')
    // once per run: explain the reasoning behind a numeric answer (graded together with the answer)
    const explain = card.locator('button.reasoning-toggle')
    if (label === 'practice' && !reasoned && (await num.count()) && (await explain.count())) {
      // one click starts listening (a fake microphone here); the close button discards the recording
      await page.evaluate(() => {
        window.__micOk = true
        const real = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
        if (!navigator.mediaDevices) return
        navigator.mediaDevices.getUserMedia = async (c) => {
          if (!window.__micOk) throw new Error('no microphone in this test')
          try {
            const ctx = new AudioContext()
            const osc = ctx.createOscillator()
            const dst = ctx.createMediaStreamDestination()
            osc.connect(dst)
            osc.start()
            return dst.stream
          } catch {
            return real(c)
          }
        }
      })
      await explain.click()
      const rec = card.locator('.reasoning-mic.rec')
      if (await rec.waitFor({ timeout: 3_000 }).then(() => true, () => false)) {
        if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-listening.png`) })
        if (await card.locator('.conf-btn:not([disabled])').count()) throw new Error('the answer can be submitted while still dictating')
        step('practice: one click on "Explain your reasoning" starts listening')
        await card.getByRole('button', { name: 'Answer without reasoning' }).click()
        await card.locator('.reasoning-box').waitFor({ state: 'detached' })
        // the dictation shortcut does the same from anywhere on the card (the answer wins over the chat composer)
        await page.locator('body').click({ position: { x: 5, y: 300 } })
        await page.keyboard.press(electronMode && process.platform === 'darwin' ? 'Meta+D' : 'Control+D')
        await rec.waitFor({ timeout: 3_000 })
        if (await page.locator('.composer .talk.recording').count()) throw new Error('the shortcut started the chat dictation instead of the answer')
        step('practice: the dictation shortcut starts talking through the reasoning')
        await card.getByRole('button', { name: 'Answer without reasoning' }).click()
        await card.locator('.reasoning-box').waitFor({ state: 'detached' })
      }
      // no microphone: the panel opens for typing
      await page.evaluate(() => (window.__micOk = false))
      await explain.click()
      await card.locator('.reasoning-box textarea').waitFor()
      reasoned = true
      step('practice: explaining the reasoning behind a numeric answer')
    }
    const ta = card.locator('textarea')
    if ((await ta.count()) && !(await ta.first().inputValue()))
      await ta.first().fill('The weights depend only on the nodes, so they are computed once in O(n^2); dividing by the interpolant of 1 cancels the node polynomial and leaves an O(n) formula per point.')
    const blanks = card.locator('input.blank')
    for (let b = 0; b < (await blanks.count()); b++) if (!(await blanks.nth(b).inputValue())) await blanks.nth(b).fill('lam/(t-x)')
    const conf = card.locator('.conf-btn:not([disabled])')
    if (await conf.count()) {
      const withReasoning = (await card.locator('.reasoning-box textarea').count()) > 0
      if (withReasoning && shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-reasoning.png`) })
      await conf.nth(2).click()
      if (withReasoning) {
        await card.locator('.reasoning-done, .feedback:not(.neutral)').first().waitFor({ timeout: 15_000 })
        if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-reasoning-graded.png`) })
        step(`${label}: reasoning graded with the answer`)
      }
      return
    }
    const again = card.locator('.actions .btn.primary', { hasText: 'Check again' })
    if (await again.count()) {
      const reveal = card.locator('button', { hasText: 'Show solution' })
      if (await reveal.count()) {
        await reveal.first().click()
        return
      }
    }
    const check = card.locator('.actions .btn.primary:not([disabled])')
    if (await check.count()) {
      await check.first().click()
      return
    }
    const dk = card.locator('button', { hasText: "I don't know yet" })
    if (await dk.count()) await dk.first().click()
  }
}

const nav = (page, name) => page.locator('nav.topnav').getByRole('button', { name, exact: true })

async function flow(page) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

  step('onboarding')
  const welcome = page.getByRole('dialog', { name: 'Welcome' })
  await welcome.waitFor({ timeout: 90_000 })
  await welcome.getByRole('button', { name: /Next/ }).click()
  await welcome.getByRole('button', { name: 'Use the demo tutor' }).click()
  await welcome.getByRole('button', { name: 'Using the demo tutor' }).waitFor()
  await welcome.getByRole('button', { name: /Next/ }).click()
  await welcome.getByRole('button', { name: 'Skip' }).click()
  await welcome.locator('.check-item input').first().check()
  await welcome.getByRole('button', { name: 'Start learning' }).click()
  await welcome.waitFor({ state: 'detached' })

  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-today.png`) })
  // the exam allows a cheat sheet: the tutor gets suggest_cheatsheet and proposes entries while teaching
  await nav(page, 'Exam prep').click()
  await page.getByRole('group', { name: 'Cheat sheet allowed' }).getByRole('button', { name: 'Allowed', exact: true }).click()
  await page.getByLabel('Page sides allowed').fill('2')
  await page.getByLabel('Page sides allowed').press('Enter')
  await page.locator('.cheat-group .eyebrow', { hasText: 'on the sheet · 0 of about 44' }).waitFor()
  step('exam prep: the cheat sheet is allowed (2 page sides)')
  await nav(page, 'Today').click()

  step('learn session (tutor agent with tools)')
  await page.getByRole('button', { name: 'Start with a probe' }).click()
  await page.locator('.session .phases').waitFor()
  if (!((await runChat(page, 'learn', { askMidway: true })) > 0)) throw new Error('the learn session earned no points')
  if (!(await page.locator('.session-side .plan-node').count())) throw new Error('the plan panel is missing')
  step('learn session: plan panel shows the dependency tree')
  if (!cheatAdded) throw new Error('the tutor suggested no cheat sheet entry')
  await nav(page, 'Exam prep').click()
  await page.locator('.cheat-group .eyebrow', { hasText: 'on the sheet · 1 of about 44' }).waitFor()
  await page.locator('.cheat-row.accepted', { hasText: 'Barycentric weights' }).locator('.katex').first().waitFor()
  await assertMathRendered(page, 'cheat sheet')
  step('the suggested entry is on the cheat sheet in Exam prep')
  if (shotsDir) {
    await page.locator('section[aria-label="Cheat sheet"]').scrollIntoViewIfNeeded()
    await page.locator('section[aria-label="Cheat sheet"]').screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-cheatsheet.png`) })
  }
  await nav(page, 'Today').click()

  step('practice session (agent)')
  await nav(page, 'Today').click()
  await page.getByRole('button', { name: 'Practice a mix' }).click()
  await page.locator('.session .phases').waitFor()
  if (!((await runChat(page, 'practice')) > 0)) throw new Error('the practice session earned no points')
  if (!(await page.locator('.session-side .queue-item').count())) throw new Error('the item list is missing')

  step('open chat from the Tutor screen')
  await nav(page, 'Tutor').click()
  const box = page.getByRole('textbox', { name: 'Message to the tutor' })
  await box.fill('Explain barycentric interpolation to me')
  await box.press('Enter')
  await page.locator('.session .card.current').first().waitFor({ timeout: 15_000 })
  step('open chat: the tutor answers with a card')
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-open-chat.png`) })
  await nav(page, 'Tutor').click()

  step('guided session (classic mode)')
  await page.locator('.topbar').getByRole('button', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Guided sessions' }).click()
  if (electronMode) {
    // speech to text can go to Gemini; the settings say plainly that the recording then leaves the computer
    const sttSelect = page.getByLabel('Speech recognition model')
    const before = await sttSelect.inputValue()
    await sttSelect.selectOption('gemini')
    await page.getByText('sent to Google').waitFor()
    await page.getByText('Prepare the local fallback').waitFor()
    await sttSelect.selectOption(before)
    await page.getByText('audio never leaves your Mac').waitFor()
    step('speech recognition can be switched to Gemini, with the privacy note')
  }
  await nav(page, 'Today').click()
  await page.getByRole('button', { name: 'Practice a mix' }).click()
  if (!((await runSession(page, 'practice')) > 0)) throw new Error('the practice session earned no points')

  for (const [name, heading] of [
    ['Course map', 'Course map'],
    ['Mind model', 'Mind model'],
    ['Stats', 'Stats'],
    ['Materials', 'Materials']
  ]) {
    await nav(page, name).click()
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor()
    step(`${name} screen renders`)
    await assertMathRendered(page, name)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-screen-${name.replace(/\W+/g, '_')}.png`) })
    if (name === 'Course map') {
      const pctButton = page.locator('.map-zoom .zoom-pct')
      const before = await pctButton.textContent()
      await page.getByRole('button', { name: 'Zoom out' }).click()
      await page.waitForFunction((b) => document.querySelector('.map-zoom .zoom-pct')?.textContent !== b, before)
      step(`course map zooms out (${before} -> ${await pctButton.textContent()})`)
    }
  }
  await page.locator('.topbar').getByRole('button', { name: /Settings/ }).click()
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
  step('Settings screen renders')
  // paying with API credits instead of the subscription (the scripted tutor still answers: ANAMNESIS_FAKE)
  await page.getByRole('button', { name: 'Claude or Gemini', exact: true }).click()
  await page.getByRole('button', { name: 'API credits' }).click()
  if (electronMode) {
    const keyBox = page.getByRole('textbox', { name: 'Anthropic API key' })
    await keyBox.fill('not-a-key')
    await page.getByRole('button', { name: 'Save the Anthropic API key' }).click()
    await page.getByText('does not look like an Anthropic API key').waitFor()
    const canStore = await page.getByText('No encrypted storage on this system').count()
    if (!canStore) {
      await keyBox.fill('sk-ant-api03-e2e-' + 'x'.repeat(40))
      await page.getByRole('button', { name: 'Save the Anthropic API key' }).click()
      await page.getByText('sk-ant-…xxxx').waitFor()
      await page.getByRole('button', { name: 'Remove the Anthropic API key' }).click()
      await keyBox.waitFor()
    }
    step(`API credits: a malformed key is refused${canStore ? ' (no keychain here, so saving is refused too)' : ', a key is saved encrypted and removed'}`)
  } else {
    await page.getByText('ANTHROPIC_API_KEY').waitFor()
    step('API credits: the browser version points to ANTHROPIC_API_KEY')
  }
  await page.getByText(/Today \$/).waitFor()
  await page.getByRole('button', { name: 'Claude subscription' }).click()

  // a model per task: course maps on Gemini asks for a Google key; the model and effort are saved
  const mapProvider = page.getByRole('group', { name: 'Course maps: provider' })
  await mapProvider.getByRole('button', { name: 'Gemini' }).click()
  if (electronMode) await page.getByRole('textbox', { name: 'Google AI API key' }).waitFor()
  else await page.getByText('GEMINI_API_KEY').waitFor()
  const mapModel = page.getByLabel('Course maps: model')
  await mapModel.fill('gemini-3.5-flash-lite')
  await mapModel.press('Enter')
  await page.getByRole('group', { name: 'Course maps: effort' }).getByRole('button', { name: 'Low' }).click()
  // Gemini thinking stops at high
  if (await page.getByRole('group', { name: 'Course maps: effort' }).getByRole('button', { name: 'Max' }).count()) throw new Error('Gemini offers a Max effort')
  await page.waitForFunction(() => document.querySelector('[aria-label="Course maps: model"]')?.value === 'gemini-3.5-flash-lite')
  await mapProvider.getByRole('button', { name: 'Claude' }).click()
  await page.getByRole('row', { name: 'Google AI API key' }).or(page.getByText('Google AI API key', { exact: true })).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {
    throw new Error('the Google key row stays without a Gemini task')
  })
  await page.getByRole('button', { name: 'Demo tutor', exact: true }).click()
  step('a model per task: switching course maps to Gemini asks for a Google key, effort levels follow the provider')
  if (!electronMode) await coursesFlow(page)
  else {
    // a dialog opened from the top bar must sit outside its window-drag region: on macOS that region
    // swallows clicks on inputs (Playwright's synthetic clicks are not affected, so check the CSS)
    await page.locator('.course-btn').click()
    await page.getByRole('menuitem', { name: /New course/ }).click()
    const region = await page.getByPlaceholder('SPCA').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
    if (region === 'drag') throw new Error('the New course dialog fields are inside a window-drag region')
    await page.keyboard.press('Escape')
    step('the New course dialog is outside the window-drag region')
  }
}

try {
  if (electronMode) {
    step('launching the built desktop app')
    const args = [join(root, 'out/main/index.js')]
    if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
    const app = await playwright._electron.launch({ executablePath: require('electron'), args, env: { ...process.env, ANAMNESIS_DATA_DIR: dataDir } })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1380, height: 900 }).catch(() => {})
    await flow(page)
    await app.close()
  } else {
    step('starting the dev server (scripted tutor) and Vite')
    const server = start(join(root, 'node_modules/.bin/jiti'), ['scripts/dev-server.ts'], { PORT: '5318', ANAMNESIS_DATA_DIR: dataDir, ANAMNESIS_FAKE: '1' })
    const vite = start(join(root, 'node_modules/.bin/vite'), ['--config', 'vite.web.config.ts'])
    try {
      await waitFor('http://127.0.0.1:5318/api/info')
      await waitFor('http://127.0.0.1:5317/')
    } catch (e) {
      console.error(server.log(), vite.log())
      throw e
    }
    const browser = await playwright.chromium.launch({ headless: !process.env.E2E_HEADED })
    const page = await browser.newPage({ viewport: { width: 1380, height: 900 } })
    await page.goto('http://127.0.0.1:5317/', { waitUntil: 'load', timeout: 90_000 })
    await flow(page)
    await browser.close()
  }
  if (errors.length) {
    failed = true
    console.error(`\n${errors.length} error(s) in the page:\n${errors.slice(0, 20).join('\n')}`)
  }
} catch (e) {
  failed = true
  console.error(`\nE2E failed: ${e?.stack ?? e}`)
  if (errors.length) console.error(errors.slice(0, 20).join('\n'))
} finally {
  cleanup()
}
if (!failed && !mathChecks) {
  failed = true
  console.error('\nE2E failed: math rendering was never checked')
} else if (!failed) console.log(`· math rendered as KaTeX in all ${mathChecks} checks`)
console.log(failed ? '\nE2E: FAILED' : '\nE2E: passed')
process.exit(failed ? 1 : 0)
