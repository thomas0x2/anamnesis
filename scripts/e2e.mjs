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
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-${label}-asked.png`) })
      continue
    }
    if (!(await open.count())) continue
    // the agent can add cards while we act: a card that vanished mid-answer is not an error
    await answerCard(page, open.last(), label).catch((e) => {
      if (!/Timeout|detached|not attached/i.test(String(e))) throw e
    })
  }
  throw new Error(`${label}: the agent session did not finish`)
}

async function answerCard(page, card, label) {
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
      await explain.click()
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

const nav = (page, name) => page.locator('nav.sidebar').getByRole('button', { name, exact: true })

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
  step('learn session (tutor agent with tools)')
  await page.getByRole('button', { name: 'Start with a probe' }).click()
  await page.locator('.session .phases').waitFor()
  if (!((await runChat(page, 'learn', { askMidway: true })) > 0)) throw new Error('the learn session earned no points')
  if (!(await page.locator('.session-side .plan-node').count())) throw new Error('the plan panel is missing')
  step('learn session: plan panel shows the dependency tree')

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
  await page.locator('nav.sidebar').getByRole('button', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Guided sessions' }).click()
  await nav(page, 'Today').click()
  await page.getByRole('button', { name: 'Practice a mix' }).click()
  if (!((await runSession(page, 'practice')) > 0)) throw new Error('the practice session earned no points')

  for (const [name, heading] of [
    ['Course map', 'Course map'],
    ['Mind model', 'Mind model'],
    ['Stats', 'Stats'],
    ['Script', 'Script']
  ]) {
    await nav(page, name).click()
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor()
    step(`${name} screen renders`)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, `${String(++shotN).padStart(2, '0')}-screen-${name.replace(/\W+/g, '_')}.png`) })
    if (name === 'Course map') {
      const pctButton = page.locator('.map-zoom .zoom-pct')
      const before = await pctButton.textContent()
      await page.getByRole('button', { name: 'Zoom out' }).click()
      await page.waitForFunction((b) => document.querySelector('.map-zoom .zoom-pct')?.textContent !== b, before)
      step(`course map zooms out (${before} -> ${await pctButton.textContent()})`)
    }
  }
  await page.locator('nav.sidebar').getByRole('button', { name: /Settings/ }).click()
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
  step('Settings screen renders')
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
console.log(failed ? '\nE2E: FAILED' : '\nE2E: passed')
process.exit(failed ? 1 : 0)
