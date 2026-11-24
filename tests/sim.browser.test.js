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

const ROUTES = ["overview", "fia", "compute", "facility", "connectivity", "deployment", "commercials", "compare", "sa", "model"]
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
    compare: "#compare-table", sa: "#sa-requirements .req-table", model: "#sources-table tbody tr",
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
  assert.match(hash, /^#\/compute\?p=[A-Za-z0-9_-]+$/, "the link carries the route and the plan")

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
