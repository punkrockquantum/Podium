/**
 * The planning tool in a real (headless) Chrome: `/` and `/sim.html` open the Overview with zero JavaScript
 * errors, every route renders and back/forward work, a decision card moves both seasons while a detached 2028
 * control moves only 2028, the Deployment schedule reacts to its dates, the Solutions Architect view keeps its
 * checklist notes, the printable brief carries no `undefined`/`NaN`, Copy link restores route and plan, saved
 * plans and A/B compare work, and nothing overflows at 1024×768 (including the legacy pages and the business case).
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

const ROUTES = ["overview", "strategies", "fia", "compute", "facility", "connectivity", "deployment", "commercials", "compare", "sa", "model"]
const CLEAN = /\bundefined\b|\bNaN\b|Infinity|\[object /
const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ""`)
const count = (page, selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
const visible = (page, selector) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); return Boolean(n) && !n.hidden && n.offsetParent !== null })()`)
const bodyText = (page) => page.evaluate("document.body.innerText")
const route = (page) => page.evaluate("document.body.dataset.route")
const setRange = (page, selector, value) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error("no " + ${JSON.stringify(selector)}); n.value = ${JSON.stringify(String(value))}; n.dispatchEvent(new Event('input', { bubbles: true })); return n.value })()`)
const settle = () => sleep(150)
/** Wait for the plan to render: the ribbon on the Overview, the plan bar everywhere. */
const ready = (page) => page.waitFor("document.querySelector('#plan-bar') && document.body.dataset.route", 10_000, "the planning tool")
/** Open the tool with a clean browser state (plans, notes and slots live in localStorage). */
async function openFresh(page, path = "/sim.html") {
  await page.goto(`${base}${path}`)
  await page.evaluate("localStorage.clear()")
  await page.goto("about:blank")
  await page.goto(`${base}${path}`)
  await ready(page)
  await settle()
}
/** Navigate by hash from inside the page (a hash change is not a page load). */
async function go(page, hash) {
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`)
  await page.waitFor(`document.body.dataset.route === ${JSON.stringify(hash.replace(/^#\//, "").replace(/\?.*$/, ""))}`, 5000, `route ${hash}`)
  await settle()
}

test("/ and /sim.html open the Overview with zero JavaScript errors", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page, "/")
  assert.deepEqual(page.errors, [], "no JS errors on /")
  assert.match(await text(page, ".sim-top h1"), /Swiss infrastructure planning tool/)
  assert.match(await text(page, ".brand"), /Audi F1 Team × Digital Realty/)
  assert.equal(await route(page), "overview")
  assert.equal(await page.evaluate("location.hash"), "#/overview", "a bare URL lands on the overview route")
  assert.equal(await count(page, "#presets .chip[data-preset]"), 3)
  assert.equal(await page.evaluate("document.querySelector('#preset-dr2027').getAttribute('aria-pressed')"), "true", "Digital Realty Zurich from 2027 is the starting plan")
  assert.equal(await page.evaluate("document.querySelector('#case-link').getAttribute('href')"), "/case.html")
  assert.equal(await page.evaluate("document.body.classList.contains('sim-page')"), true)

  await page.goto(`${base}/sim.html`)
  await ready(page)
  await settle()
  assert.deepEqual(page.errors, [], "no JS errors on /sim.html")
  assert.match(await text(page, "#sec-2027"), /^\+0\.\d\d s$/)
  assert.match(await text(page, "#sec-2028"), /^\+0\.\d\d s$/)
  assert.equal(await count(page, "#decisions .decision"), 6, "six decision cards")
  assert.equal(await count(page, "#decisions .decision .tune"), 6)
  assert.ok((await count(page, "#ribbon .ribbon-row")) >= 7, "envelope, trackside, ATR, cap, availability, CHF/yr and CO₂ rows")
  assert.match(await text(page, "#ribbon-envelope"), /kW at Digital Realty of 500/)
  assert.match(await text(page, "#ribbon-trackside"), /s to decide/)
  assert.equal(await count(page, "#map-card svg.map"), 1, "the Swiss schematic map")
  assert.equal(await count(page, "#timeline-compact svg.gantt"), 1, "the compact timeline")
  assert.equal(await count(page, "#envelope-gauge-2027, #envelope-gauge-2028"), 2, "an envelope gauge per season")
  assert.match(await text(page, "#envelope-gauge-2027"), /kW at Digital Realty of 500 · 2027/)
  assert.equal(await count(page, "#envelope-health .envelope-line"), 2, "a plan-health envelope line per season")
  assert.match(await text(page, "#envelope-health"), /Fits the 500 kW envelope: \d{3} \/ 500 kW \(2027\)/)
  assert.equal(await count(page, "#race-now-2027, #race-now-2028"), 2, "Race now for the 2027 and the 2028 car")
  assert.ok((await count(page, "#health .health-item")) >= 1, "plan health lists its reasons")
  assert.match(await text(page, "#plan-health-badge"), /Consistent|to tune|to fix/)
  const body0 = await bodyText(page)
  assert.doesNotMatch(body0, CLEAN)
  assert.doesNotMatch(body0, /Position swing|points?\b(?! of)|ladder/i, "nothing points-related renders")
  await page.close()
})

test("every route renders, the nav follows the hash and back/forward work", { skip, timeout: 90_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  const expectations = {
    fia: "#fia-seasons .season-card", compute: "#compute-seasons .season-card", facility: "#facility-seasons .season-card",
    connectivity: "#connectivity-seasons .season-card", deployment: "#gantt-card svg.gantt", commercials: "#commercials-seasons .season-card",
    compare: "#compare-table", sa: "#sa-requirements .req-table", model: "#sources-table tbody tr", strategies: "#strategy-grid .strategy-card",
  }
  for (const id of ROUTES.slice(1)) {
    await go(page, `#/${id}`)
    assert.deepEqual(page.errors, [], `no JS errors on #/${id}`)
    assert.ok((await count(page, expectations[id])) >= 1, `#/${id} shows ${expectations[id]}`)
    assert.equal(await page.evaluate(`document.querySelector('#routes .route[aria-current="page"]')?.dataset.route`), id === "compare" ? undefined : id, `the nav marks ${id}`)
    assert.match(await page.evaluate("document.title"), id === "sa" ? /Solutions Architect/ : id === "fia" ? /FIA envelope/ : new RegExp(id === "model" ? "Model" : id === "compare" ? "Compare" : id.charAt(0).toUpperCase() + id.slice(1)))
    assert.doesNotMatch(await bodyText(page), CLEAN, `#/${id} is clean`)
  }
  assert.equal(await page.evaluate("document.body.dataset.view"), "team", "the Model & sources page is a team view")
  for (const id of ["fia", "compute", "facility", "connectivity"]) {
    await go(page, `#/${id}`)
    assert.ok((await count(page, `.view-${id} .plan-control`)) >= (id === "fia" ? 2 : 4), `${id} carries its per-season controls`)
    assert.equal(await count(page, `.view-${id} .role-strip .role`), 3, `${id} says who decides, provides and supplies`)
  }
  // Component views carry the FIA badges and the why-lines from the model
  await go(page, "#/compute")
  assert.ok((await count(page, ".view-compute .plan-control .fia-badge")) >= 3)
  assert.ok((await count(page, ".view-compute .plan-control .why")) >= 10)
  // The architecture diagram draws the chosen season and switches with the toggle
  assert.equal(await count(page, "#card-architecture svg.arch"), 1, "compute shows the architecture diagram")
  assert.match(await page.evaluate("document.querySelector('#card-architecture svg.arch').getAttribute('aria-label')"), /^2027 architecture: \d+ CPU nodes/)
  assert.ok((await count(page, "#card-architecture .chip")) >= 8, "CPU nodes are drawn as chips")
  await page.click("#card-architecture .seg[data-season='2028']")
  await settle()
  assert.match(await page.evaluate("document.querySelector('#card-architecture svg.arch').getAttribute('aria-label')"), /^2028 architecture/)
  assert.match(await text(page, "#diagram-architecture-note"), /inherits 2027|differ in 2028/)
  await go(page, "#/facility")
  assert.equal(await count(page, "#card-racks svg.racks"), 1, "facility shows the rack layout")
  assert.ok((await count(page, "#card-racks .rack")) >= 1, "cluster racks are drawn")
  assert.match(await page.evaluate("document.querySelector('#card-racks svg.racks').getAttribute('aria-label')"), /rack layout: \d+ cluster racks at \d+ kW/)
  // Back/forward: compute → facility → connectivity, then back and forward again
  await go(page, "#/facility")
  await go(page, "#/connectivity")
  await page.evaluate("history.back()")
  await page.waitFor("document.body.dataset.route === 'facility'", 5000, "back to facility")
  await page.evaluate("history.forward()")
  await page.waitFor("document.body.dataset.route === 'connectivity'", 5000, "forward to connectivity")
  // The in-page skip link is not a route
  await page.evaluate("location.hash = '#main'")
  await sleep(200)
  assert.equal(await route(page), "connectivity", "an anchor hash does not navigate")
  // Tune the details → opens the component view
  await go(page, "#/overview")
  await page.click("#decision-compute .tune")
  await page.waitFor("document.body.dataset.route === 'compute'", 5000, "Tune the details → compute")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("a decision card moves both seasons; a detached control moves only 2028", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  await page.click("#preset-dr2027")
  await settle()
  const sec27a = await text(page, "#sec-2027")
  const sec28a = await text(page, "#sec-2028")
  const cap28a = await text(page, "#ribbon-cap .ribbon-cell:last-child b")
  assert.equal(await page.evaluate("document.querySelector('#preset-custom').hidden"), true)

  await setRange(page, "#quick-nodes", 24)
  await settle()
  const sec27b = await text(page, "#sec-2027")
  const sec28b = await text(page, "#sec-2028")
  assert.notEqual(sec27b, sec27a, "2027 follows the quick control")
  assert.notEqual(sec28b, sec28a, "2028 inherits the 2027 change")
  assert.notEqual(await text(page, "#ribbon-cap .ribbon-cell:last-child b"), cap28a, "the cost-cap charge moves with the cluster")
  assert.match(await text(page, "#decision-compute .decision-summary.s2027"), /24 nodes/)
  assert.equal(await text(page, "#decision-compute .decision-summary.s2028"), "Same as 2027")
  assert.equal(await page.evaluate("document.querySelector('#preset-custom').hidden"), false, "editing a preset marks the plan as custom")
  assert.match(await text(page, "#ribbon .ribbon-foot"), /same estate as 2027/)

  await go(page, "#/compute")
  assert.equal(await text(page, "#pc-nodes-out-2027"), "24")
  assert.equal(await text(page, "#pc-nodes-out-2028"), "24")
  assert.equal(await page.evaluate("document.querySelector('[data-control=nodes]').dataset.detached"), "false")
  assert.equal(await visible(page, "[data-control=nodes] .inherit-pill"), true)
  assert.equal(await visible(page, "#pc-nodes-2028"), false, "the 2028 input is hidden while it inherits")
  await page.click("[data-control=nodes] .inherit-pill")
  await settle()
  assert.equal(await page.evaluate("document.querySelector('[data-control=nodes]').dataset.detached"), "true")
  assert.equal(await visible(page, "#pc-nodes-2028"), true)
  await setRange(page, "#pc-nodes-2028", 8)
  await settle()
  assert.equal(await text(page, "#pc-nodes-out-2027"), "24", "2027 keeps its value")
  assert.equal(await text(page, "#pc-nodes-out-2028"), "8", "2028 takes its own value")
  const s27 = await text(page, "#compute-seasons .season-card.s2027")
  const s28 = await text(page, "#compute-seasons .season-card.s2028")
  assert.match(s27, /24 nodes/)
  assert.match(s28, /8 nodes/)
  await go(page, "#/overview")
  assert.equal(await text(page, "#sec-2027"), sec27b, "2027 is untouched by the 2028 change")
  assert.notEqual(await text(page, "#sec-2028"), sec28b, "2028 changed")
  assert.match(await text(page, "#ribbon .ribbon-foot"), /1 control differs/)
  await go(page, "#/compute")
  await page.click("[data-control=nodes] .reattach")
  await settle()
  assert.equal(await text(page, "#pc-nodes-out-2028"), "24", "re-attaching returns 2028 to the 2027 value")
  assert.equal(await page.evaluate("document.querySelector('[data-control=nodes]').dataset.detached"), "false")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("the Deployment schedule: contract date, cutover boundary and parallel running change the consequences", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  await page.click("#preset-dr2027")
  await settle()
  await go(page, "#/deployment")
  assert.match(await text(page, "#stat-golive"), /3 May 2027/)
  assert.match(await text(page, "#stat-loss"), /0\.0 % of ATP 3/)
  assert.ok((await count(page, "#milestones .milestones-table tbody tr")) >= 5)
  assert.ok((await count(page, "#sign-by .signby")) >= 3)
  assert.equal(await count(page, "#gantt-card svg.gantt rect.task"), await count(page, "#gantt-card svg.gantt text.task-label"), "one bar per task")

  // A late contract slips the cutover past the target and flags it
  await page.type("#tl-contract", "2027-03-01")
  await settle()
  assert.match(await text(page, "#stat-golive"), /slipped \d+ days/)
  assert.match(await text(page, "#timeline-flags"), /slips|inside ATP/i)
  const lossMid = await text(page, "#stat-loss")
  assert.doesNotMatch(lossMid, /^0\.0 %/, "a mid-period cutover wastes allowance")

  // Parallel running shrinks the loss at the switch
  await setRange(page, "#tl-parallel", 0)
  await settle()
  const lossNoParallel = parseFloat((await text(page, "#stat-loss")).replace(/[^\d.]/g, ""))
  await setRange(page, "#tl-parallel", 4)
  await settle()
  const lossParallel = parseFloat((await text(page, "#stat-loss")).replace(/[^\d.]/g, ""))
  assert.ok(lossParallel < lossNoParallel, `parallel running cuts the loss (${lossParallel} < ${lossNoParallel})`)

  // Back to the default contract and a later boundary: nothing lost again
  await page.type("#tl-contract", "2026-12-15")
  await page.evaluate("(() => { const s = document.querySelector('#tl-cutover'); s.value = '2027-06-28'; s.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await settle()
  assert.match(await text(page, "#stat-golive"), /28 Jun 2027/)
  assert.match(await text(page, "#stat-loss"), /0\.0 % of ATP 4/)
  assert.match(await text(page, "#decision-deployment, #stat-golive"), /./)
  await go(page, "#/overview")
  assert.match(await text(page, "#decision-deployment .decision-summary.s2027"), /cutover 28 Jun 2027/)
  assert.doesNotMatch(await bodyText(page), CLEAN)
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("Solutions Architect view: ?view=sa opens it, notes persist, the printable brief is clean", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page, "/sim.html?view=sa")
  assert.equal(await route(page), "sa")
  assert.equal(await page.evaluate("document.body.dataset.view"), "sa")
  assert.equal(await page.evaluate("document.querySelector('#view-switch .seg[data-view=sa]').getAttribute('aria-pressed')"), "true")
  assert.equal(await page.evaluate("location.search"), "", "the view parameter is consumed")
  assert.ok((await count(page, "#req-2027 tbody tr")) >= 12, "requirements, one row each")
  assert.equal(await count(page, "#req-2027 tbody tr"), await count(page, "#req-2027 tbody td.y28"), "every requirement shows its 2028 value or 'same'")
  assert.ok((await count(page, "#req-2027 tbody td.y28.same")) >= 8, "most requirements carry over unchanged in an inherited plan")
  // The estate that moves is 375 kW in both seasons inside the 500 kW envelope, so the power line carries over
  assert.match(await text(page, "#req-2027 tr[data-req=power] td.y27"), /\d kW of 500 kW/)
  assert.equal(await text(page, "#req-2027 tr[data-req=power] td.y28"), "same")
  assert.match(await text(page, "#req-2027 tr[data-req=commit]"), /500 kW hard envelope/)
  assert.match(await text(page, "#sa-requirements .card-head"), /changes? in 2028|2028 same as 2027/)
  assert.match(await text(page, "#req-2028"), /2028/)
  assert.ok((await count(page, "#sa-services .service-list li")) >= 6, "public Digital Realty services mapped")
  assert.ok((await count(page, "#risk-table tr[data-risk]")) >= 6, "risk register")
  assert.ok((await count(page, "#sa-roles .role-list li")) >= 6)
  assert.equal(await count(page, "#sa-checklist .check-item"), 15)
  assert.match(await text(page, "#hpe-footnote"), /HPE GreenLake/)
  const body = await bodyText(page)
  assert.doesNotMatch(body, CLEAN)
  assert.doesNotMatch(body, /Solution Architect(?!s)/, "the role is always written Solutions Architect")

  const firstNote = await page.evaluate("document.querySelector('#sa-checklist .check-item textarea').id")
  await page.type(`#${firstNote}`, "Checked with the team on site")
  await settle()
  await page.goto("about:blank")
  await page.goto(`${base}/sim.html#/sa`)
  await ready(page)
  await settle()
  assert.equal(await page.evaluate(`document.querySelector('#${firstNote}').value`), "Checked with the team on site", "notes survive a reload")
  assert.match(await text(page, "#sa-checklist"), /1 of 15 noted|1 noted/)

  // Printable brief: the chrome goes, the content stays, and nothing is undefined
  await page.emulateMedia("print")
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('#routes')).display"), "none", "the nav is hidden in print")
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('#plan-bar .actions')).display"), "none", "the actions are hidden in print")
  assert.notEqual(await page.evaluate("getComputedStyle(document.querySelector('#sa-requirements')).display"), "none")
  assert.notEqual(await page.evaluate("getComputedStyle(document.querySelector('#risk-table')).display"), "none")
  assert.doesNotMatch(await bodyText(page), CLEAN)
  await page.emulateMedia("")

  // The view switch returns to the team overview; the SA tab is remembered for the next visit
  await page.click("#view-switch .seg[data-view=team]")
  await page.waitFor("document.body.dataset.route === 'overview'", 5000, "back to the overview")
  assert.equal(await page.evaluate("document.body.dataset.view"), "team")
  await page.click("#view-switch .seg[data-view=sa]")
  await page.waitFor("document.body.dataset.route === 'sa'", 5000, "to the SA view")
  await page.goto("about:blank")
  await page.goto(`${base}/sim.html`)
  await ready(page)
  assert.equal(await route(page), "sa", "reopening the tool returns to the last view")
  await page.click("#clear-notes")
  await settle()
  assert.equal(await page.evaluate(`document.querySelector('#${firstNote}').value`), "")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("Copy link restores the route and the plan; saved plans and A/B compare work", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  await page.click("#preset-gl2028")
  await settle()
  await go(page, "#/compute")
  await setRange(page, "#pc-nodes-2027", 20)
  await settle()
  await page.click("[data-control=clockGHz] .inherit-pill")
  await setRange(page, "#pc-clockGHz-2028", 2.8)
  await settle()
  await page.type("#plan-name", "Board deck v1")
  await settle()
  await page.click("#share-link")
  await sleep(200)
  const hash = await page.evaluate("location.hash")
  assert.match(hash, /^#\/compute\?p=[A-Za-z0-9_-]+&pe=[01]$/, "the link carries the route, the plan and the Plain English setting")

  const fresh = await chrome.page()
  await fresh.goto(`${base}/sim.html`)
  await fresh.evaluate("localStorage.clear()")
  await fresh.goto("about:blank")
  await fresh.goto(`${base}/sim.html${hash}`)
  await ready(fresh)
  await settle()
  assert.equal(await route(fresh), "compute")
  assert.equal(await fresh.evaluate("location.hash"), "#/compute", "the plan parameter is consumed")
  assert.equal(await text(fresh, "#pc-nodes-out-2027"), "20")
  assert.equal(await text(fresh, "#pc-nodes-out-2028"), "8", "the preset's own 2028 step-up (8 GPU nodes) survives the link")
  assert.equal(await text(fresh, "#pc-clockGHz-out-2028"), "2.8 GHz")
  assert.equal(await fresh.evaluate("document.querySelector('[data-control=clockGHz]').dataset.detached"), "true")
  assert.equal(await fresh.evaluate("document.querySelector('#plan-name').value"), "Board deck v1")
  assert.equal(await fresh.evaluate("document.querySelector('#preset-custom').hidden"), false)
  assert.deepEqual(fresh.errors, [])
  await fresh.close()

  // A legacy single-season link imports as a plan where 2028 inherits
  const legacy = await page.evaluate("import('/js/sim/store.js').then((m) => m.encodeHash({ nodes: 18, location: 'dr', season: 2027 }))")
  await page.goto("about:blank")
  await page.goto(`${base}/sim.html${legacy}`)
  await ready(page)
  await settle()
  assert.equal(await route(page), "overview")
  assert.match(await text(page, "#decision-compute .decision-summary.s2027"), /18 nodes/)
  assert.equal(await page.evaluate("document.querySelector('#plan-name').value"), "Imported scenario")

  // Save / Load
  await page.click("#save-open")
  await settle()
  await page.type("#save-name", "Board deck v2")
  await page.click("#save-plan")
  await settle()
  assert.match(await text(page, "#saved-list"), /Board deck v2/)
  assert.equal(await page.evaluate("document.querySelector('#plan-name').value"), "Board deck v2")

  // Compare: A = current (custom), B = the GreenLake step-up preset
  await go(page, "#/compare")
  await page.click("#compare-a")
  await settle()
  await page.click("#preset-gl2028")
  await settle()
  await page.click("#compare-b")
  await settle()
  const header = await text(page, "#compare-table thead")
  assert.match(header, /A: Board deck v2/)
  assert.match(header, /B: Digital Realty Zurich 2027 \+ HPE GreenLake GPU step-up 2028/)
  const headline = await text(page, "#compare-table tr.headline")
  assert.doesNotMatch(headline, /—/, "both slots and the current column carry both seasons")
  assert.ok((await count(page, "#compare-table .both .y28")) >= 8, "every row shows 2027 and 2028")
  assert.doesNotMatch(await bodyText(page), CLEAN)

  // Export produces a download link (no navigation, no error)
  await page.evaluate("window.__downloads = []; HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download) }")
  await page.click("#export-json")
  assert.deepEqual(await page.evaluate("window.__downloads"), ["audi-f1-digital-realty-plan-gl2028.json"])
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("Strategies: three plan-level cards, the side-by-side table, Load / edited / Compare, and the optimiser in a web worker", { skip, timeout: 90_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  await go(page, "#/strategies")
  assert.deepEqual(page.errors, [], "no JS errors on #/strategies")
  // cards
  assert.equal(await count(page, "#strategy-grid .strategy-card"), 3)
  for (const k of ["A", "B", "C"]) {
    assert.ok(await visible(page, `#strategy-${k}`), `card ${k} is visible`)
    assert.equal(await count(page, `#strategy-decisions-${k} tbody tr`), 9, `card ${k}: nine decision rows`)
    assert.equal(await count(page, `#strategy-gauge-${k}-2027, #strategy-gauge-${k}-2028`), 2, `card ${k}: two envelope gauges`)
    assert.equal(await count(page, `#strategy-tiles-${k} .stat`), 8, `card ${k}: outcome tiles for both seasons`)
    assert.ok(await visible(page, `#strategy-timeline-${k} svg.timeline-strip`), `card ${k}: timeline strip`)
    assert.ok((await count(page, `#strategy-risks-${k} .badge`)) >= 3, `card ${k}: risk badges`)
    assert.ok(await visible(page, `#strategy-load-${k}`), `card ${k}: Load this strategy`)
    assert.ok(await visible(page, `#strategy-compare-${k}`), `card ${k}: Compare`)
    assert.equal(await count(page, `#race-now-${k}-2027, #race-now-${k}-2028`), 2, `card ${k}: Race now for both cars`)
  }
  const headline = await page.evaluate("[...document.querySelectorAll('.strategy-tiles .headline-stat .stat-value')].map((v) => v.textContent)")
  assert.match(headline[0], /^\+0\.(09|10) s\+0\.3[67] s$/, `A plan-level: ${headline[0]}`)
  assert.match(headline[1], /^\+0\.1[45] s\+0\.4[67] s$/, `B plan-level: ${headline[1]}`)
  assert.match(headline[2], /^\+0\.1[34] s\+0\.4[67] s$/, `C plan-level: ${headline[2]}`)
  assert.match(await text(page, "#strategy-timeline-B svg"), /GPU re-declaration 1 Jan 2028/)
  assert.match(await text(page, "#strategy-decisions-B"), /20 Apr 2027/, "B's cutover slips from the 8 Mar target to 20 Apr 2027 at plan level")
  // table and chart
  assert.equal(await count(page, "#strategies-compare-table thead th"), 9, "Metric + four columns per season")
  assert.ok((await count(page, "#strategies-compare-table td.best")) >= 10, "best values are marked")
  assert.equal(await count(page, "#strategies-chart .chart-bar"), 6, "three strategies × two seasons")
  assert.doesNotMatch(await bodyText(page), /Position swing|points?\b(?! of)|ladder/i, "nothing points-related renders")
  // optimiser panel ids
  for (const id of ["#optimiser", "#optimiser-objective", "#optimiser-run", "#optimiser-progress", "#optimiser-result"]) assert.ok((await count(page, id)) === 1, `${id} present`)
  assert.equal(await count(page, "#optimiser-objective .seg"), 3, "three objectives (no points objective)")
  assert.equal(await page.evaluate("document.querySelector('#optimiser-progress').hidden"), true)
  await page.click("#optimiser-run")
  await page.waitFor("document.querySelector('#optimiser-run').textContent !== 'Stop' && document.querySelector('#optimiser-diff')", 30_000, "the optimiser result")
  assert.deepEqual(page.errors, [], "no JS errors from the optimiser")
  const timing = await text(page, "#optimiser-progress-text")
  assert.match(timing, /^[\d,]+ plans in \d+\.\d s \((web worker|main thread)\)/, timing)
  assert.ok(Number(timing.match(/in ([\d.]+) s/)[1]) < 5, `the default search finishes in a few seconds (${timing})`)
  assert.ok((await count(page, "#optimiser-diff tbody tr")) >= 2, "the diff table lists the changed controls")
  const sec28 = await page.evaluate("document.querySelector('#optimiser-result .optimiser-season[data-season=\"2028\"] .headline-stat .stat-value').textContent")
  assert.match(sec28, /^\+0\.(4[5-9]|5\d) s$/, `fastest 2028 from the default plan: ${sec28}`)
  assert.ok(await visible(page, "#optimiser-load"), "Load is offered")
  assert.ok(await visible(page, "#optimiser-save"), "Save as scenario is offered")
  assert.ok(await visible(page, "#optimiser-copy"), "Copy link is offered")
  assert.doesNotMatch(await bodyText(page), CLEAN, "the optimiser result is clean")
  // the progress bar is scaled to the search itself: full, and still shown, when the result appears
  assert.equal(await page.evaluate("document.querySelector('#optimiser-progress').hidden"), false)
  assert.equal(await page.evaluate("document.querySelector('#optimiser-progress').position"), 1, "the bar reads 100 % when the result appears")
  // "Start from" names the loaded plan, and Save as scenario keeps a whole name
  assert.equal(await page.evaluate("document.querySelector('#optimiser-start').value"), "current")
  assert.equal(await page.evaluate("document.querySelector('#optimiser-start option[value=current]').textContent"), "the current plan · Digital Realty Zurich from 2027")
  await page.click("#optimiser-save")
  await settle()
  await page.click("#save-open")
  await settle()
  const savedNames = await page.evaluate("[...document.querySelectorAll('#saved-list .saved-name')].map((n) => n.textContent)")
  assert.deepEqual(savedNames, ["Optimiser proposal · Fastest 2028 car"], "the whole objective name is kept")
  await page.click("#save-open")
  await settle()
  // Load the proposal → Overview, chip, fits
  await page.click("#optimiser-load")
  await page.waitFor("document.body.dataset.route === 'overview'", 5000, "Overview after Load")
  await settle()
  assert.equal(await text(page, "#preset-custom"), "Optimiser proposal")
  assert.match(await text(page, "#envelope-health"), /Fits the 500 kW envelope: \d{3} \/ 500 kW \(2027\)/)
  // Load strategy B → chip, edit → lineage, card shows edited with Reload / Keep
  await go(page, "#/strategies")
  await page.click("#strategy-load-B")
  await page.waitFor("document.body.dataset.route === 'overview'", 5000, "Overview after Load this strategy")
  await settle()
  assert.equal(await text(page, "#preset-custom"), "Strategy B · Density and the 2028 GPU step-up")
  assert.match(await text(page, "#envelope-health"), /401 \/ 500 kW \(2027\)[\s\S]*459 \/ 500 kW \(2028\)/)
  await go(page, "#/strategies")
  assert.equal(await page.evaluate("document.querySelector('#optimiser-start').value"), "B", "Start from follows the loaded strategy")
  await go(page, "#/compute")
  const nodes = await page.evaluate("document.querySelector('#pc-nodes-2027').value")
  await setRange(page, "#pc-nodes-2027", Number(nodes) - 1)
  await settle()
  assert.equal(await text(page, "#preset-custom"), "Custom (from B)")
  await go(page, "#/strategies")
  assert.equal(await page.evaluate("document.querySelector('#optimiser-start').value"), "current", "an edited strategy is the current plan")
  assert.equal(await page.evaluate("document.querySelector('#optimiser-start option[value=current]').textContent"), "the current plan · B · Density and the 2028 GPU step-up")
  assert.equal(await page.evaluate("document.querySelector('#strategy-B').classList.contains('is-edited')"), true)
  assert.equal(await text(page, "#strategy-B .strategy-head .badge"), "edited in the planner")
  assert.equal(await text(page, "#strategy-load-B"), "Reload the strategy")
  assert.ok(await visible(page, "#strategy-keep-B"))
  await page.click("#strategy-keep-B")
  await settle()
  assert.equal(await text(page, "#preset-custom"), "Custom plan")
  assert.equal(await page.evaluate("document.querySelector('#strategy-B').classList.contains('is-edited')"), false)
  // Compare puts the strategy into the first free slot and opens the compare page
  await page.click("#strategy-compare-C")
  await page.waitFor("document.body.dataset.route === 'compare'", 5000, "Compare after the card's Compare")
  await settle()
  assert.match(await text(page, "#compare-table thead"), /A: Strategy C/)
  // a preset-bar pick is followed too, and the long preset name shows in full on two lines at 1440 and one at 1024
  await go(page, "#/strategies")
  await page.click("#preset-gl2028")
  await settle()
  assert.equal(await page.evaluate("document.querySelector('#optimiser-start').value"), "current")
  assert.match(await page.evaluate("document.querySelector('#optimiser-start option[value=current]').textContent"), /GreenLake GPU step-up 2028$/)
  const nameBox = "(() => { const n = document.querySelector('#plan-name'); return { tag: n.tagName, value: n.value, clipped: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1, h: n.clientHeight } })()"
  const at1440 = await page.evaluate(nameBox)
  assert.equal(at1440.value, "Digital Realty Zurich 2027 + HPE GreenLake GPU step-up 2028")
  assert.equal(at1440.clipped, false, `the plan name is not clipped at 1440 (${JSON.stringify(at1440)})`)
  assert.ok(at1440.h > 44 && at1440.h < 70, `two lines at 1440 (${at1440.h}px)`)
  const small = await launchChrome({ width: 1024, height: 768 })
  try {
    const narrow = await small.page()
    await openFresh(narrow)
    await narrow.click("#preset-gl2028")
    await settle()
    const at1024 = await narrow.evaluate(nameBox)
    assert.equal(at1024.clipped, false, `the plan name is not clipped at 1024 (${JSON.stringify(at1024)})`)
    assert.ok(at1024.h <= 44, `one line at 1024 (${at1024.h}px)`)
    assert.deepEqual(narrow.errors, [], "no JS errors at 1024px")
  } finally {
    await small.close()
  }
  // the cards follow the position slider (the only inputs they borrow)
  await go(page, "#/fia")
  await setRange(page, "#pc-position-2027", 5)
  await go(page, "#/strategies")
  const p5 = await page.evaluate("[...document.querySelectorAll('.strategy-tiles .headline-stat .stat-value')].map((v) => v.textContent)")
  assert.notEqual(p5[1], headline[1], "strategy B re-evaluates at P5")
  assert.deepEqual(page.errors, [], "no JS errors in the strategies flow")
})

test("the planning tool, the business case and the legacy pages hold together at 1024×768", { skip, timeout: 120_000 }, async () => {
  const small = await launchChrome({ width: 1024, height: 768 })
  try {
    const page = await small.page()
    await page.goto(`${base}/sim.html`)
    await page.evaluate("localStorage.clear()")
    for (const id of ROUTES) {
      await page.goto("about:blank")
      await page.goto(`${base}/sim.html#/${id}`)
      await ready(page)
      await settle()
      assert.deepEqual(page.errors, [], `#/${id}: no JS errors at 1024px`)
      assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, `#/${id}: no horizontal overflow at 1024px`)
      if (["fia", "compute", "facility", "connectivity"].includes(id)) {
        const columns = await page.evaluate("getComputedStyle(document.querySelector('.view-layout')).gridTemplateColumns.split(' ').length")
        assert.equal(columns, 2, `${id}: controls and outcomes side by side`)
      }
    }
    for (const path of ["/case.html", "/home.html", "/station.html", "/host.html", "/race.html"]) {
      await page.goto("about:blank")
      await page.goto(`${base}${path}`)
      await sleep(400)
      assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, `${path}: no horizontal overflow at 1024px`)
      assert.deepEqual(page.errors, [], `${path}: no JS errors at 1024px`)
    }
    await page.close()
  } finally {
    await small.close()
  }
})

test("Explainers: ? on controls, tiles, flags and bars opens one shared panel; waterfall, Plain English and the printed appendix", { skip, timeout: 90_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  await page.evaluate("document.querySelector('#preset-gl2028').click()")
  await settle()
  const ev = (s) => page.evaluate(s)

  // the affordance: a 20 px glyph with a 44 × 44 hit target, labelled for assistive tech
  assert.ok((await count(page, ".explain-btn")) >= 10, "the Overview carries ? buttons on its tiles")
  const btnBox = await ev("(() => { const b = document.querySelector('[data-explain=\"tile.envelope\"]'); const r = b.getBoundingClientRect(); const a = getComputedStyle(b, '::after'); return { w: Math.round(r.width), h: Math.round(r.height), inset: a.inset || a.top, label: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), expanded: b.getAttribute('aria-expanded') } })()")
  assert.equal(btnBox.w, 20); assert.equal(btnBox.h, 20)
  assert.match(btnBox.inset, /-12px/, "the hit target extends 12 px around the glyph (44 × 44)")
  assert.match(btnBox.label, /^Explain: /); assert.equal(btnBox.popup, "dialog"); assert.equal(btnBox.expanded, "false")

  // open → side panel at 1440 px, focus moves in, live 'In this plan' lines per season
  await ev("document.querySelector('[data-explain=\"tile.envelope\"]').click()")
  await page.waitFor("!document.querySelector('#explain-panel').hidden", 3000, "the explainer panel opens")
  assert.equal(await ev("document.querySelector('#explain-panel').dataset.mode"), "side")
  assert.equal(await ev("document.querySelector('#explain-panel').getAttribute('role')"), "dialog")
  assert.equal(await ev("document.querySelector('[data-explain=\"tile.envelope\"]').getAttribute('aria-expanded')"), "true")
  assert.equal(await ev("document.querySelector('#explain-panel').contains(document.activeElement)"), true, "focus moves into the panel")
  assert.equal(await text(page, "#explain-title"), "Share of the 500 kW offer")
  assert.match(await text(page, "#explain-inplan"), /2027: \d{3} kW of 500 \(\d+ %\)/)
  assert.match(await text(page, "#explain-inplan"), /2028: \d{3} kW of 500/)
  assert.ok((await count(page, "#explain-panel .chip-source")) >= 1, "source chips")
  assert.equal(await ev("document.querySelector('#explain-panel details').open"), true, "Plain English on: More is expanded")

  // one at a time: a second ? replaces the first; the live line follows the plan
  await ev("document.querySelector('[data-explain=\"tile.gauge-mauh\"]').click()")
  await settle()
  assert.equal(await count(page, "[aria-expanded=\"true\"]"), 1, "only one ? is expanded")
  assert.equal(await text(page, "#explain-title"), "Computing allowance used")
  const before = await text(page, "#explain-inplan")
  await ev("const i = document.querySelector('#quick-position'); i.value = 5; i.dispatchEvent(new Event('input', { bubbles: true }))")
  await sleep(300)
  assert.notEqual(await text(page, "#explain-inplan"), before, "the 'In this plan' line updates live")
  assert.equal(await ev("document.querySelector('#explain-panel').hidden"), false, "the panel stays open through a re-render")

  // Escape closes and returns focus to the (re-rendered) opener; a click outside closes too
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await settle()
  assert.equal(await ev("document.querySelector('#explain-panel').hidden"), true, "Escape closes")
  assert.equal(await ev("document.activeElement === document.querySelector('[data-explain=\"tile.gauge-mauh\"]')"), true, "focus returns to the ?")
  await ev("document.querySelector('[data-explain=\"tile.envelope\"]').click()")
  await settle()
  await ev("document.querySelector('#main').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
  await settle()
  assert.equal(await ev("document.querySelector('#explain-panel').hidden"), true, "a click outside closes")

  // the waterfall: one per season, bars in the fixed order, a hidden table, a bar opens the driver explainer
  await page.waitFor("document.querySelectorAll('#waterfall-2028 .wf-row.kind-driver').length > 0", 5000, "the 2028 waterfall")
  const bars = await ev("[...document.querySelectorAll('#waterfall-2028 .wf-row.kind-driver')].map((g) => g.dataset.driver)")
  assert.ok(bars.length >= 6, `active drivers drawn (${bars.length})`)
  const order = ["power", "cpuArch", "processor", "clock", "gpu", "data", "cooling", "resilience", "timing", "energy", "commercial", "connectivity"]
  assert.deepEqual(bars, order.filter((id) => bars.includes(id)), "bars keep the fixed driver order")
  assert.equal(await count(page, "#waterfall-2028 .waterfall-table tbody tr"), bars.length + 1, "the hidden table repeats every bar plus the total")
  assert.match(await text(page, "#waterfall-2028 .wf-value.total"), /^\+0\.\d\d s$/)
  assert.match(await text(page, "#waterfall-card"), /Unchanged from Today/)
  await ev("document.querySelector('#waterfall-2028 .wf-row[data-driver=\"gpu\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))")
  await settle()
  assert.equal(await text(page, "#explain-title"), "Graphics processors on the solver")
  assert.match(await text(page, "#explain-inplan"), /2028: /)
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await ev("document.querySelector('.wf-modes [data-mode=\"savedCHF\"]').click()")
  await settle()
  assert.equal(await ev("document.querySelector('#waterfall-2027').dataset.mode"), "savedCHF")
  assert.match(await text(page, "#waterfall-2027 .wf-value.total"), /CHF/)

  // Plain English: default on for the Team view; off swaps the labels back, persists and travels in the link
  assert.equal(await ev("document.querySelector('#plain-english').getAttribute('aria-checked')"), "true")
  await go(page, "#/compute")
  assert.equal(await text(page, "#pc-nodes-label"), "Processor servers")
  assert.equal(await ev("document.querySelector('#pc-nodes-label').title"), "CPU nodes", "the model term stays on hover")
  await ev("document.querySelector('#plain-english').click()")
  await settle()
  assert.equal(await text(page, "#pc-nodes-label"), "CPU nodes")
  assert.equal(await ev("localStorage.getItem('podium.sim.plainEnglish')"), "0")
  await page.goto("about:blank") // a reload (not a hash change) must come back with the stored choice
  await page.goto(`${base}/sim.html#/compute`)
  await ready(page)
  await settle()
  assert.equal(await ev("document.querySelector('#plain-english').getAttribute('aria-checked')"), "false", "the choice survives a reload")
  assert.equal(await text(page, "#pc-nodes-label"), "CPU nodes")
  await page.click("#share-link")
  await sleep(200)
  assert.match(await ev("location.hash"), /&pe=0$/, "the link carries pe=0")
  await ev("location.hash = '#/overview?pe=1'")
  await sleep(400)
  assert.equal(await ev("document.querySelector('#plain-english').getAttribute('aria-checked')"), "true", "pe=1 in a link turns it on")

  // the Solutions Architect view defaults to off when nothing is stored
  await ev("localStorage.removeItem('podium.sim.plainEnglish')")
  await page.goto("about:blank") // a hash-only change would not be a page load
  await openFresh(page, "/sim.html#/sa")
  assert.equal(await ev("document.querySelector('#plain-english').getAttribute('aria-checked')"), "false")

  // the printed 'Explained' appendix: every active bar and flag, hidden on screen, one line each
  await page.goto("about:blank")
  await openFresh(page)
  await page.evaluate("document.querySelector('#preset-gl2028').click()")
  await sleep(400)
  assert.equal(await ev("getComputedStyle(document.querySelector('#explained-appendix')).display"), "none")
  await page.emulateMedia("print")
  await sleep(200)
  assert.equal(await ev("getComputedStyle(document.querySelector('#explained-appendix')).display"), "block")
  assert.ok((await count(page, "#explained-appendix li")) >= 10, "driver bars and flags for both seasons")
  assert.equal(await ev("getComputedStyle(document.querySelector('.explain-btn')).display"), "none", "no ? in print")
  assert.doesNotMatch(await text(page, "#explained-appendix"), CLEAN)
  await page.emulateMedia("")
  assert.deepEqual(page.errors, [], "no JS errors")
})

test("every tile, gauge, bar, ribbon row, flag, milestone, Gantt task and Solutions Architect row carries a ? on every route and preset", { skip, timeout: 120_000 }, async () => {
  const page = await chrome.page()
  await openFresh(page)
  const ev = (s) => page.evaluate(s)
  // Everything that reads as a figure, flag or row: the element itself is the button (Gantt rows, waterfall bars) or it contains a ? button
  const AUDIT = `(() => {
    const SEL = {
      stat: ".stat", gauge: ".gauge", bar: ".bar", ribbon: ".ribbon-row", flag: "li.flag",
      milestone: ".milestones-table tbody tr:not(.task-row)", ganttTask: ".gantt .task-row", taskRow: ".milestones-table tbody tr.task-row",
      req: "#sa-requirements tbody tr", service: ".service-list .service", role: ".role-list .role-item", risk: "#risk-table tbody tr", check: ".checklist .check-item",
    }
    const out = { missing: [], counted: 0 }
    for (const [kind, sel] of Object.entries(SEL)) for (const n of document.querySelectorAll(sel)) {
      if (kind === "milestone" && n.textContent.includes("beyond 2028")) continue
      out.counted++
      if (!(n.matches("[data-explain]") || n.querySelector(".explain-btn, [data-explain]"))) out.missing.push(kind + ": " + n.textContent.trim().slice(0, 50))
    }
    return out
  })()`
  const totals = {}
  for (const preset of ["today", "dr2027", "gl2028"]) {
    await ev(`document.querySelector('#preset-${preset}').click()`)
    await settle()
    for (const r of ROUTES.filter((x) => x !== "model")) {
      await go(page, `#/${r}`)
      const a = await ev(AUDIT)
      assert.deepEqual(a.missing, [], `${preset} /#/${r}: without a ?`)
      totals[r] = (totals[r] || 0) + a.counted
    }
  }
  assert.ok(totals.fia >= 20 && totals.compute >= 30 && totals.facility >= 25 && totals.connectivity >= 20, `tiles audited: ${JSON.stringify(totals)}`)
  assert.ok(totals.deployment >= 30 && totals.sa >= 150 && totals.commercials >= 20 && totals.overview >= 20, `rows audited: ${JSON.stringify(totals)}`)
  // a hybrid plan shows the Hinwil gauge on the Overview, with its ?
  await go(page, "#/facility")
  await ev("document.querySelector('[data-control=\"location\"] .seg[data-value=\"hybrid\"]').click()")
  await settle()
  await go(page, "#/overview")
  assert.equal(await count(page, "#hinwil-gauge-2027 [data-explain=\"tile.hinwil-gauge\"]"), 1, "the hybrid Hinwil gauge carries a ?")
  assert.deepEqual((await ev(AUDIT)).missing, [], "hybrid Overview")
  await go(page, "#/facility")
  assert.deepEqual((await ev(AUDIT)).missing, [], "hybrid Facility")

  // Gantt task rows: the row is the button; keyboard opens the shared panel, one at a time, Escape returns focus
  await ev("document.querySelector('#preset-gl2028').click()")
  await settle()
  await go(page, "#/deployment")
  const rows = await ev("[...document.querySelectorAll('.gantt .task-row[role=button]')].map((g) => g.dataset.explain)")
  assert.ok(rows.includes("task.fitout") && rows.includes("task.hardware") && rows.includes("task.burnin"), `task rows: ${rows}`)
  assert.equal(await ev("document.querySelectorAll('.milestones-table .task-row .explain-btn').length"), rows.length, "the table repeats a ? per task")
  await ev("document.querySelector('.gantt .task-row[data-explain=\"task.fibre\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))")
  await settle()
  assert.equal(await ev("document.querySelector('#explain-panel').hidden"), false)
  assert.equal(await text(page, "#explain-title"), "Dark fibre build")
  assert.match(await text(page, "#explain-inplan"), /2027: Dark fibre Hinwil ↔ Zurich campus .* weeks, the carrier/)
  assert.equal(await ev("document.querySelector('.gantt .task-row[data-explain=\"task.fibre\"]').getAttribute('aria-expanded')"), "true")
  await ev("document.querySelector('[data-explain=\"milestone.cutover\"]').click()")
  await settle()
  assert.equal(await count(page, "[aria-expanded=\"true\"]"), 1, "one ? at a time, across SVG rows and buttons")
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await settle()
  assert.equal(await ev("document.querySelector('#explain-panel').hidden"), true)

  // Solutions Architect rows: a requirement's ? repeats the row's live value per season; a risk's ? names its status
  await go(page, "#/sa")
  await ev("document.querySelector('#sa-requirements tr[data-req=\"power\"] .explain-btn').click()")
  await settle()
  assert.equal(await text(page, ".explain-kind"), "Requirement")
  assert.match(await text(page, "#explain-inplan"), /2027: \d{3} kW of 500 kW/)
  assert.match(await text(page, "#explain-inplan"), /2028: \d{3} kW of 500 kW/)
  await ev("document.querySelector('#risk-table tr[data-risk=\"gpu-rule\"] .explain-btn').click()")
  await settle()
  assert.match(await text(page, "#explain-inplan"), /likelihood, .* impact, open/)
  await ev("document.querySelector('.check-item[data-id=\"timeline\"] .explain-btn').click()")
  await settle()
  assert.match(await text(page, "#explain-inplan"), /Signed \d+ \w+ 2026; Live \d+ \w+ 2027; 2028 step-up 1 Jan 2028/)
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  assert.deepEqual(page.errors, [], "no JS errors")
})
