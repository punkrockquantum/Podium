/**
 * The table iPad in a real (headless) Chrome: the brief gate, nothing selected on load, one tap
 * locks a dial for good, the page never snaps back to the top while polling, and the call to the
 * Solutions Architect. Skipped when Chrome is not installed (set PODIUM_CHROME to point at one).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp, DEFAULT_PINS } from "../server.mjs"
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
  dir = await mkdtemp(join(tmpdir(), "podium-browser-"))
  app = createApp({ dataDir: dir, env: {} })
  server = createServer(app.handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  await post("/api/host/setup", { teams: [{ name: "Red" }, { name: "Blue" }], budget: "standard" }, DEFAULT_PINS.host)
  await post("/api/host/phase", { action: "play" }, DEFAULT_PINS.host)
  chrome = await launchChrome({ width: 820, height: 1000 })
})

after(async () => {
  if (skip) return
  await chrome?.close()
  app?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function post(path, body, pin, station) {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}), ...(station ? { "x-station": station } : {}) }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const stateNow = () => fetch(`${base}/api/state`).then((r) => r.json())
const count = (page, selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent || ""`)
const disabled = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled`)

test("the table: brief gate → nothing selected → one tap locks for good → scroll holds → call the SA", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  try {
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.querySelector('[data-team="t1"]')`, 8000, "the team list")
    await page.click('[data-team="t1"]')
    await page.waitFor(`document.querySelector('[data-tab="brief"].active')`, 8000, "the Brief tab")

    /* 1 · Brief: Tune and Pitch are closed, the gate button waits for the end of the brief. */
    assert.equal(await disabled(page, '[data-tab="tune"]'), true, "Tune is disabled before the brief is read")
    assert.equal(await disabled(page, '[data-tab="pitch"]'), true, "Pitch is disabled before the brief is read")
    assert.equal(await disabled(page, "#readBrief"), true, "the gate is closed before the end of the brief")
    assert.ok((await text(page, ".brief")).includes("Words to know"), "the brief is on screen")
    assert.ok((await text(page, "#oneShotWarning")).includes("Each choice locks the moment you tap it"), "the one-shot warning is on the brief")
    await page.evaluate(`document.getElementById("briefEnd").scrollIntoView(); true`)
    await page.waitFor(`document.getElementById("readBrief") && !document.getElementById("readBrief").disabled`, 8000, "the gate to open on reaching the end")
    await page.click("#readBrief")
    await page.waitFor(`document.querySelector('[data-tab="tune"].active')`, 8000, "the Tune tab")
    assert.ok((await stateNow()).teams[0].briefRead.compute, "the server recorded the read brief")

    /* 2 · Tune: nothing is selected on load, every dial says "Tap once to lock". */
    await page.waitFor(`document.querySelectorAll("#tuneBoard .dial").length === 3`, 8000, "three dials")
    assert.equal(await count(page, ".seg-btn.on"), 0, "nothing is selected when the table opens")
    assert.equal(await count(page, ".dial.open"), 3, "all three dials are open")
    assert.equal(await text(page, '[data-dial="size"] .dial-setting'), "Tap once to lock")
    assert.equal(await text(page, ".lock-count"), "Locked 0 of 3")

    /* Scrolling: the page stays where the reader left it across several polls. */
    await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); true`)
    await sleep(300)
    const before = await page.evaluate("window.scrollY")
    assert.ok(before > 300, `the page scrolled (${before}px)`)
    await sleep(3200)
    const after = await page.evaluate("window.scrollY")
    assert.ok(Math.abs(after - before) <= 2, `the page stayed put while polling (${before} → ${after})`)

    /* One tap locks the dial; a second tap on the same dial changes nothing. */
    await page.click('[data-dial="size"] .seg-btn[data-option="medium"]')
    await page.waitFor(`document.querySelector('[data-dial="size"] .seg-btn[data-option="medium"].on')`, 8000, "the lock to show")
    assert.equal(await text(page, ".lock-count"), "Locked 1 of 3")
    assert.ok((await text(page, '[data-dial="size"] .dial-setting')).includes("Sixteen nodes"), "the setting line shows the locked choice")
    assert.equal(await disabled(page, '[data-dial="size"] .seg-btn[data-option="large"]'), true, "the other settings are disabled")
    await page.evaluate(`document.querySelector('[data-dial="size"] .seg-btn[data-option="large"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); true`)
    await sleep(1300)
    assert.equal(await count(page, '[data-dial="size"] .seg-btn.on'), 1)
    assert.ok(await page.evaluate(`document.querySelector('[data-dial="size"] .seg-btn[data-option="medium"]').classList.contains("on")`), "the first tap stands")
    const refused = await post("/api/teams/t1/choices", { station: "compute", choices: { size: "large" } })
    assert.equal(refused.status, 409, "the server refuses a second choice on a locked dial")
    assert.match(refused.json.error, /That choice is locked/)
    assert.equal((await stateNow()).teams[0].choices.size, "medium")
    const held = await page.evaluate("window.scrollY")
    assert.ok(Math.abs(held - after) <= 2, `locking a dial did not move the page (${after} → ${held})`)

    /* The other two dials: all three locked, then Call the Solutions Architect. */
    await page.click('[data-dial="chips"] .seg-btn[data-option="cpu"]')
    await page.waitFor(`document.querySelector('[data-dial="chips"] .seg-btn[data-option="cpu"].on')`, 8000, "the second lock")
    await page.click('[data-dial="storage"] .seg-btn[data-option="parallel"]')
    await page.waitFor(`document.querySelector(".lock-count.all")`, 8000, "the All three locked counter")
    assert.equal(await text(page, ".lock-count"), "🔒 All three locked")
    assert.ok((await text(page, "#oneShotBanner")).includes("All three locked"), "the banner turns into the next step, keeping its place")
    assert.equal(await count(page, ".seg-btn.on"), 3)
    assert.equal(await count(page, '#tuneBoard .seg-btn:not(:disabled)'), 0, "every setting is disabled once the table is locked")
    await page.click('[data-tab="pitch"]')
    await page.waitFor(`document.querySelector("#callSa")`, 8000, "the Call the Solutions Architect button")
    assert.ok((await text(page, "#callSa")).includes("Call the Solutions Architect"))
    assert.ok((await text(page, "#callSa")).includes("Attempt 1"))
    await page.click("#callSa button")
    await page.waitFor(`(document.getElementById("pitchStatus")?.textContent || "").includes("Waiting for the SA") || (document.body.textContent || "").includes("Waiting for the SA")`, 8000, "the waiting banner")
    const state = await stateNow()
    assert.deepEqual(state.queues.compute.map((q) => q.team), ["t1"])
    assert.equal(state.teams[0].attempts.compute, 1)

    /* Reloading shows the locks and nothing else selected. */
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.querySelector('[data-tab="tune"]') && !document.querySelector('[data-tab="tune"]').disabled`, 8000, "the Tune tab enabled after reload")
    await page.click('[data-tab="tune"]')
    await page.waitFor(`document.querySelectorAll("#tuneBoard .seg-btn.on").length === 3`, 8000, "three locks after reload")
    assert.equal(await text(page, ".lock-count"), "🔒 All three locked")
    assert.equal(await count(page, ".dial.open"), 0, "no dial is open once all three are locked")

    assert.deepEqual(page.errors, [], "no JavaScript errors on the table")
  } finally {
    await page.close()
  }
})

test("a rejection reopens the dials with last time's picks as ghosts, and the attempt counts up", { skip, timeout: 60_000 }, async () => {
  const state = await stateNow()
  assert.deepEqual(state.queues.compute.map((q) => q.team), ["t1"], "the first test left Red in the queue")
  const available = await post("/api/architect/availability", { station: "compute", available: true }, DEFAULT_PINS.leader, "compute")
  assert.equal(available.status, 200, JSON.stringify(available.json))
  const pitch = await post("/api/architect/pitch", { station: "compute", team: "t1", action: "start" }, DEFAULT_PINS.leader, "compute")
  assert.equal(pitch.status, 200, JSON.stringify(pitch.json))
  const verdict = await post("/api/architect/decide", { station: "compute", team: "t1", decision: "reject", reason: "Storage is thin for 16 nodes" }, DEFAULT_PINS.leader, "compute")
  assert.equal(verdict.status, 200, JSON.stringify(verdict.json))

  const page = await chrome.page()
  try {
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.querySelector('[data-team="t1"]')`, 8000, "the team list")
    await page.click('[data-team="t1"]')
    await page.waitFor(`document.getElementById("rejectedBanner")`, 8000, "the rejection banner")
    assert.ok((await text(page, "#rejectedBanner")).includes("Rejected: Storage is thin for 16 nodes"))
    await page.click('[data-tab="tune"]')
    await page.waitFor(`document.querySelectorAll("#tuneBoard .dial.open").length === 3`, 8000, "three open dials")
    assert.equal(await count(page, ".seg-btn.on"), 0, "nothing is selected after a rejection")
    assert.equal(await count(page, ".seg-btn.ghost"), 3, "last time's three picks show as ghosts")
    assert.ok(await page.evaluate(`document.querySelector('[data-dial="size"] .seg-btn[data-option="medium"]').classList.contains("ghost")`))
    await page.click('[data-dial="size"] .seg-btn[data-option="medium"]')
    await page.click('[data-dial="chips"] .seg-btn[data-option="cpu"]')
    await page.click('[data-dial="storage"] .seg-btn[data-option="cache"]')
    await page.waitFor(`document.querySelector(".lock-count.all")`, 8000, "three locks on attempt 2")
    await page.click('[data-tab="pitch"]')
    await page.waitFor(`document.querySelector("#callSa")`, 8000, "the call button on attempt 2")
    assert.ok((await text(page, "#callSa")).includes("Attempt 2"))
    assert.deepEqual(page.errors, [], "no JavaScript errors after a rejection")
  } finally {
    await page.close()
  }
})
