/**
 * The infrastructure performance simulator in a real (headless) Chrome: `/` and `/sim.html` load with
 * zero JavaScript errors, sliders move the headline and the compliance badges, the season toggle and
 * every preset work, A/B compare fills its columns, and the printable page carries no `undefined`/`NaN`.
 * Skipped when Chrome is not installed (set PODIUM_CHROME to point at one).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../server.mjs"
import { findChrome, launchChrome } from "./helpers/chrome.js"

const chromeBinary = findChrome()
const skip = chromeBinary ? false : "Chrome is not installed (set PODIUM_CHROME)"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let server
let base
let dir
let app
let chrome

before(async () => {
  if (skip) return
  dir = await mkdtemp(join(tmpdir(), "podium-sim-browser-"))
  app = createApp({ dataDir: dir, env: {} })
  server = createServer(app.handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  chrome = await launchChrome({ width: 1440, height: 900 })
})

after(async () => {
  if (skip) return
  await chrome?.close()
  app?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (dir) await rm(dir, { recursive: true, force: true })
})

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent || ""`)
const count = (page, selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
const flagLevels = (page) => page.evaluate(`[...document.querySelectorAll('#flags .flag')].map((f) => f.dataset.flag + ':' + f.dataset.level).join('|')`)
const setSlider = (page, id, value) => page.evaluate(`(() => { const n = document.querySelector('[data-control=${JSON.stringify(id)}] input[type=range]'); n.value = ${JSON.stringify(String(value))}; n.dispatchEvent(new Event('input', { bubbles: true })); return n.value })()`)
const settle = () => sleep(120)

test("/ serves the simulator and /sim.html loads with zero JavaScript errors", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await page.evaluate("localStorage.clear()")
  await page.goto(`${base}/`)
  await page.waitFor("document.querySelector('#headline-sec')", 10_000, "the headline on /")
  assert.deepEqual(page.errors, [], "no JS errors on /")
  assert.match(await text(page, ".sim-top h1"), /Infrastructure performance simulator/)
  assert.match(await text(page, ".brand"), /Audi F1 Team × Digital Realty/)
  assert.match(await text(page, ".title .subtitle"), /2027 plan · 2028 path/)
  assert.equal(await count(page, "#presets .chip[data-preset]"), 3)
  assert.equal(await page.evaluate("document.querySelector('#case-link').getAttribute('href')"), "/case.html")
  assert.equal(await page.evaluate("document.body.classList.contains('sim-page')"), true)

  await page.goto(`${base}/sim.html`)
  await page.waitFor("document.querySelector('#headline-sec')", 10_000, "the headline on /sim.html")
  assert.deepEqual(page.errors, [], "no JS errors on /sim.html")
  assert.ok((await count(page, "#controls .control")) >= 30, "all control groups rendered")
  assert.equal(await count(page, "#controls .control-card"), 4)
  assert.ok((await count(page, "#flags .flag")) >= 4)
  assert.match(await text(page, "#oem-footnote"), /working assumption/)
  const body = await page.evaluate("document.body.innerText")
  assert.doesNotMatch(body, /\bundefined\b|\bNaN\b/)
  await page.close()
})

test("three sliders change the headline and the compliance badges", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await page.evaluate("localStorage.clear()")
  await page.goto(`${base}/sim.html`)
  await page.waitFor("document.querySelector('#headline-sec')", 10_000, "headline")
  await page.click("#preset-dr2027")
  await settle()
  const headline0 = await text(page, "#headline-sec")
  const flags0 = await flagLevels(page)
  assert.match(flags0, /mauh:ok/)
  assert.match(headline0, /^\+0\.\d\d s$/)

  await setSlider(page, "nodes", 24)
  await settle()
  const headline1 = await text(page, "#headline-sec")
  const flags1 = await flagLevels(page)
  assert.notEqual(flags1, flags0, "the MAUh badge changes when the cluster outgrows the allowance")
  assert.match(flags1, /mauh:warn/)
  assert.match(await text(page, "#flags .flag[data-flag=mauh] .flag-title"), /Over capacity/)
  assert.equal(await text(page, "[data-control=nodes] output"), "24")

  await setSlider(page, "clockGHz", 2.5)
  await settle()
  const headline2 = await text(page, "#headline-sec")
  assert.notEqual(headline2, headline1, "the declared clock moves the headline")
  assert.match(await text(page, "#flags .flag[data-flag=clock] .flag-title"), /2\.5 GHz/)

  await setSlider(page, "rackKW", 120)
  await settle()
  const flags3 = await flagLevels(page)
  assert.match(flags3, /cooling:(warn|bad)/, "rack density beyond rear-door cooling raises a cooling flag")
  assert.notEqual(await text(page, "#headline-sec"), headline2)

  await setSlider(page, "confidence", 0)
  await settle()
  assert.equal(await text(page, "#headline-sec"), "0.00 s", "zero confidence zeroes the headline")
  assert.equal(await page.evaluate("document.querySelector('#preset-custom').hidden"), false, "editing a preset marks the scenario as custom")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("season toggle, every preset, A/B compare and the printable page", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await page.evaluate("localStorage.clear()")
  await page.goto(`${base}/sim.html`)
  await page.waitFor("document.querySelector('#headline-sec')", 10_000, "headline")

  await page.click("#season-toggle .seg[data-value='2028']")
  await settle()
  assert.equal(await page.evaluate("document.querySelector('#season-toggle .seg[data-value=\"2028\"]').getAttribute('aria-pressed')"), "true")
  assert.match(await text(page, "#headline"), /2028 season/)
  assert.match(await text(page, "[data-control=season] .seg[aria-pressed=true]"), /2028/)

  const results = {}
  for (const id of ["today", "dr2027", "gl2028"]) {
    await page.click(`#preset-${id}`)
    await settle()
    assert.equal(await page.evaluate(`document.querySelector('#preset-${id}').getAttribute('aria-pressed')`), "true")
    results[id] = await text(page, "#headline-sec")
    const body = await page.evaluate("document.body.innerText")
    assert.doesNotMatch(body, /\bundefined\b|\bNaN\b|Infinity/, `${id}: clean page`)
  }
  assert.equal(results.today, "0.00 s", "Today is the baseline")
  assert.match(await text(page, "#headline-sub"), /baseline/)
  assert.match(results.dr2027, /^\+0\.\d\d s$/)
  assert.match(results.gl2028, /^\+0\.\d\d s$/)
  assert.ok(parseFloat(results.gl2028.slice(1)) > parseFloat(results.dr2027.slice(1)), "the 2028 path beats the 2027 plan")
  assert.match(await text(page, "#flags .flag[data-flag=gpu] .flag-title"), /2 solver GPUs/)
  assert.match(await text(page, "#season-toggle .seg[aria-pressed=true]"), /2028/)

  await page.click("#compare-a")
  await settle()
  await page.click("#preset-dr2027")
  await settle()
  await page.click("#compare-b")
  await settle()
  const header = await text(page, "#compare-table thead")
  assert.match(header, /A: DR \+ GreenLake 2028/)
  assert.match(header, /B: DR 2027/)
  const headlineRow = await text(page, "#compare-table tr.headline")
  assert.doesNotMatch(headlineRow, /—/, "both slots and the current column carry a headline")

  await page.click("#save-open")
  await settle()
  await page.type("#save-name", "Board deck v1")
  await page.click("#save-scenario")
  await settle()
  assert.match(await text(page, "#saved-list"), /Board deck v1/)

  await page.evaluate("document.querySelector('.sources-details').open = true; document.querySelector('.money-lines').open = true")
  const printable = await page.evaluate("document.body.innerText")
  assert.doesNotMatch(printable, /\bundefined\b|\bNaN\b/)
  assert.ok((await count(page, "#sources-table tbody tr")) >= 100, "the sources table lists the constants")
  assert.match(printable, /VERIFIED/)
  assert.match(printable, /ASSUMPTION/)
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("the simulator holds together at 1024×768", { skip, timeout: 60_000 }, async () => {
  const small = await launchChrome({ width: 1024, height: 768 })
  try {
    const page = await small.page()
    await page.goto(`${base}/sim.html`)
    await page.waitFor("document.querySelector('#headline-sec')", 10_000, "headline")
    assert.deepEqual(page.errors, [])
    const columns = await page.evaluate("getComputedStyle(document.querySelector('.sim-layout')).gridTemplateColumns.split(' ').length")
    assert.equal(columns, 2, "controls and outcomes side by side")
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "no horizontal overflow")
    await page.close()
  } finally {
    await small.close()
  }
})
