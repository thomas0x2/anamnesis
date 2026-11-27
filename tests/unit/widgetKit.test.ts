// The widget kit runs tutor code that was written on the fly, so it has to take the shapes the tutor
// is likely to produce, not only the documented ones. Runs the kit in a real browser (Playwright);
// skipped where Playwright and its Chromium are not installed.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type Page = { setContent(h: string): Promise<void>; addScriptTag(o: { content: string }): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; evaluate<T>(expr: string): Promise<T>; close(): Promise<void> }
type Browser = { newPage(): Promise<Page>; close(): Promise<void> }
let chromium: { launch(): Promise<Browser> } | null = null
try {
  chromium = require('playwright').chromium
} catch {
  chromium = null
}

const kit = readFileSync(resolve('src/renderer/src/widgets/kit.js'), 'utf8')

describe.skipIf(!chromium)('widget kit', () => {
  let browser: Browser | null = null
  beforeAll(async () => {
    try {
      browser = await chromium!.launch()
    } catch {
      browser = null // Playwright without its browser
    }
  })
  afterAll(async () => {
    await browser?.close()
  })

  /** Runs widget code the way widget.html does; returns the frame's text, the errors it posted and whether it showed the error box. */
  async function run(code: string): Promise<{ text: string; errors: string[]; failed: boolean }> {
    if (!browser) return { text: '', errors: [], failed: false }
    const page = await browser.newPage()
    await page.setContent('<div id="k-root"></div>')
    await page.addScriptTag({ content: "window.__errs = []; window.parent.postMessage = function (m) { if (m && m.type === 'widget-error') window.__errs.push(m.message) }" })
    await page.addScriptTag({ content: kit })
    await page.addScriptTag({ content: 'try {\n' + code + '\n} catch (err) { window.K && K._report(err) }' })
    await page.waitForTimeout(150)
    // a string, not a function: the test project has no DOM types
    const res = await page.evaluate<{ text: string; errors: string[]; failed: boolean }>(
      "({ text: document.getElementById('k-root').innerText, errors: window.__errs, failed: !!document.querySelector('.k-error') })"
    )
    await page.close()
    return res
  }

  it('lets draw destructure a single view as an array (the argv memory widget)', async () => {
    const r = await run(`K.demo({
      params: { cmd: K.choice({ label: "Command", options: ["./prog", "./prog 42", "./prog alice bob"], value: "./prog alice bob" }) },
      views: [K.panel({ title: "argv" })],
      draw(p, [mem], out) {
        const args = p.cmd.split(" ")
        mem.cells(args.concat(["NULL"]), { labels: args.map((_, i) => "argv[" + i + "]").concat(["argv[argc]"]) })
        for (const a of args) mem.cells(a + "\\0", { title: a })
        out("argc", args.length)
      }
    })`)
    expect(r.errors).toEqual([])
    expect(r.failed).toBe(false)
    expect(r.text).toContain('argv[argc]')
    expect(r.text).toContain('alice')
  })

  it('also takes g[0] and for...of on a single view', async () => {
    const r = await run(`K.demo({ views: [K.plot({})], draw(p, g) { for (const v of g) v.fn(x => x * x); g[0].hline(0) } })`)
    expect(r.errors).toEqual([])
  })

  it('forwards view methods on the array of several views', async () => {
    const r = await run(`K.demo({ views: [K.plot({}), K.panel({ title: "mem" })], draw(p, g) { g.fn(x => x); g.cells([1, 2, 3]); g[1].text("ok") } })`)
    expect(r.errors).toEqual([])
    expect(r.text).toContain('ok')
  })

  it('normalizes data in the wrong shape instead of crashing', async () => {
    const r = await run(`K.demo({
      params: { m: K.choice({ label: "mode", options: { a: "Mode A", b: "Mode B" } }) },
      views: [K.plot({}), K.panel({})],
      draw(p, [g, mem], out) {
        g.path({ x: [0, 1, 2], y: [0, 1, 4] })
        g.points([{ x: 0, y: 1 }, { x: 1, y: 2 }])
        g.bars([[0, 1, 2], [3, 4, 5]])
        mem.cells({ rdi: 1, rsi: 2 }, { highlight: 0 })
        mem.cells(new Set([7, 8]))
        mem.bits(5, 8, { groups: new Set([4, 4]), labels: "nibbles" })
        mem.tags("one tag")
        out.table("h", { r1: [1, 2] })
        out("mode", p.m)
      }
    })`)
    expect(r.errors).toEqual([])
    expect(r.text).toContain('Mode A')
    expect(r.text).toContain('rdi')
  })

  it('still reports a real mistake, says where, and tells the learner plainly', async () => {
    const r = await run(`K.demo({ draw(p, g) { undefinedThing.x } })`)
    expect(r.failed).toBe(true)
    expect(r.errors[0]).toMatch(/^in draw: .*undefinedThing/)
    expect(r.text).toContain('This demo could not be drawn')
  })

  it('runs the example in the tutor prompt', async () => {
    const doc = readFileSync(resolve('src/shared/prompts.ts'), 'utf8')
    const example = doc.slice(doc.indexOf('Example:\nK.demo(') + 'Example:\n'.length, doc.indexOf('\nKeep a widget to one idea'))
    expect(example.startsWith('K.demo(')).toBe(true)
    const r = await run(example)
    expect(r.errors).toEqual([])
  })
})
