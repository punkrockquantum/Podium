/**
 * The table iPad in a real (headless) Chrome, from a brand-new game with no host action: the table
 * opens straight on the customer's brief (no team to pick), the brief gate, nothing selected on load,
 * one tap locks a dial for good, the page never snaps back to the top while polling, and the call
 * to the Solutions Architect. Skipped when Chrome is not installed (set PODIUM_CHROME to point at one).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp, DEFAULT_PINS } from "../server.mjs"
import { CUSTOMER_TEAM } from "../public/js/catalog.js"
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
const T1 = CUSTOMER_TEAM.id
/** Poll the server until the state satisfies `check`, or fail after `ms`. */
async function waitState(check, label, ms = 8000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const s = await stateNow()
    if (check(s)) return s
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

test("the table, from a new game: opens on the brief with no team to pick → brief gate → nothing selected → one tap locks for good → scroll holds → call the SA", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  try {
    /* A brand-new game: no host has done anything, no timer, and the customer is already there. */
    const fresh = await stateNow()
    assert.deepEqual(fresh.teams.map((t) => [t.id, t.name]), [[T1, CUSTOMER_TEAM.name]], "the game starts with the customer")
    assert.equal(fresh.clock.status, "open", "and no timer")

    /* The table opens straight on 1 · Brief: nothing to choose, type or tap first. */
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.querySelector('[data-tab="brief"].active')`, 8000, "the Brief tab")
    assert.equal(await count(page, "#teamName, #addTeam, #teamGrid, [data-team], .team-grid, .step-zero"), 0, "no team picker, no Add your team box")
    assert.ok(!(await text(page, "body")).includes("Choose your team"), "the page never asks for a team")
    assert.ok(!(await text(page, "body")).includes("Switch team"))
    assert.equal(await count(page, 'input[type="password"]'), 0, "no PIN is asked for at the table")
    assert.equal(await count(page, "#teamStrip input, #teamStrip button"), 0, "nothing to type or switch in the header chip")
    await page.waitFor(`(document.querySelector("#teamStrip .team-chip")?.textContent || "").includes(${JSON.stringify(CUSTOMER_TEAM.name)})`, 8000, "the customer's name in the header chip")
    assert.equal(await text(page, "#timer"), "No timer", "the header shows the untimed session")
    await page.waitFor(`document.getElementById("readBrief")`, 8000, "the brief gate")
    await waitState((s) => s.tables.compute?.team === T1, "the customer seated at this table")

    /* A second iPad at another table also opens on its brief: the one customer plays every table. */
    const other = await chrome.page()
    try {
      await other.goto(`${base}/station.html?station=dc`)
      await other.waitFor(`document.querySelector('[data-tab="brief"].active') && document.getElementById("readBrief")`, 8000, "the brief on the other iPad")
      assert.equal(await count(other, "#teamName, #addTeam, [data-team]"), 0, "no team picker there either")
      const both = await waitState((s) => s.tables.dc?.team === T1, "the customer seated at the second table")
      assert.equal(both.tables.compute?.team, T1, "the first table keeps its seat")
      assert.deepEqual(both.teams.map((t) => t.id), [T1], "still one participant")
      assert.deepEqual(other.errors, [], "no JavaScript errors on the second iPad")
    } finally {
      await other.close()
    }

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
    assert.ok((await text(page, '[data-dial="size"] .dial-setting')).includes("Twelve nodes"), "the setting line shows the locked choice")
    assert.equal(await disabled(page, '[data-dial="size"] .seg-btn[data-option="large"]'), true, "the other settings are disabled")
    await page.evaluate(`document.querySelector('[data-dial="size"] .seg-btn[data-option="large"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); true`)
    await sleep(1300)
    assert.equal(await count(page, '[data-dial="size"] .seg-btn.on'), 1)
    assert.ok(await page.evaluate(`document.querySelector('[data-dial="size"] .seg-btn[data-option="medium"]').classList.contains("on")`), "the first tap stands")
    const refused = await post(`/api/teams/${T1}/choices`, { station: "compute", choices: { size: "large" } })
    assert.equal(refused.status, 409, "the server refuses a second choice on a locked dial")
    assert.match(refused.json.error, /That choice is locked/)
    assert.equal((await stateNow()).teams[0].choices.size, "medium")
    const held = await page.evaluate("window.scrollY")
    assert.ok(Math.abs(held - after) <= 2, `locking a dial did not move the page (${after} → ${held})`)

    /* The other two dials: all three locked, then Call the Solutions Architect. */
    await page.click('[data-dial="chips"] .seg-btn[data-option="cpu"]')
    await page.waitFor(`document.querySelector('[data-dial="chips"] .seg-btn[data-option="cpu"].on')`, 8000, "the second lock")
    assert.ok((await text(page, "#oneShotBanner")).includes("Each choice locks the moment you tap it"), "the one-shot warning stands while dials are still open")
    const boardTop = () => page.evaluate(`document.getElementById("tuneBoard").getBoundingClientRect().top + window.scrollY`)
    const topBefore = await boardTop()
    await page.click('[data-dial="storage"] .seg-btn[data-option="parallel"]')
    await page.waitFor(`document.querySelector(".lock-count.all")`, 8000, "the All three locked counter")
    assert.equal(await text(page, ".lock-count"), "🔒 All three locked")
    await page.waitFor(`document.getElementById("lockedBanner")`, 8000, "the All three locked banner")
    assert.ok((await text(page, "#lockedBanner")).includes("All three locked (attempt 1): go to Pitch and call the Solutions Architect."), "one banner carries the next step")
    assert.equal(await count(page, "#oneShotBanner"), 0, "the one-shot warning has gone: no second banner with the same message")
    assert.equal(await count(page, "main .state-banner"), 1, "exactly one banner above the board")
    const topAfter = await boardTop()
    assert.ok(Math.abs(topAfter - topBefore) <= 3, `the banner swap kept the board in place (${topBefore} → ${topAfter})`)
    assert.ok(Math.abs((await page.evaluate("window.scrollY")) - held) <= 2, "the third lock did not move the page")
    assert.equal(await count(page, ".seg-btn.on"), 3)
    assert.equal(await count(page, '#tuneBoard .seg-btn:not(:disabled)'), 0, "every setting is disabled once the table is locked")
    await page.click('[data-tab="pitch"]')
    await page.waitFor(`document.querySelector("#callSa")`, 8000, "the Call the Solutions Architect button")
    assert.ok((await text(page, "#callSa")).includes("Call the Solutions Architect"))
    assert.ok((await text(page, "#callSa")).includes("Attempt 1"))
    await page.click("#callSa button")
    await page.waitFor(`(document.getElementById("pitchStatus")?.textContent || "").includes("Waiting for the SA") || (document.body.textContent || "").includes("Waiting for the SA")`, 8000, "the waiting banner")
    const state = await stateNow()
    assert.deepEqual(state.queues.compute.map((q) => q.team), [T1])
    assert.equal(state.teams[0].attempts.compute, 1)

    /* Reloading opens on the brief again, with the locks kept and nothing else selected. */
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.querySelector('[data-tab="brief"].active')`, 8000, "the Brief tab after reload")
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
  assert.deepEqual((state.queues.compute || []).map((q) => q.team), [T1], "the first test left the customer in the queue")
  const signIn = await post("/api/login", { pin: DEFAULT_PINS.leader, station: "compute" })
  assert.equal(signIn.json?.role, "architect", "the SA signs in with the PIN and a table: nothing else to switch on")
  const pitch = await post("/api/architect/pitch", { station: "compute", team: T1, action: "start" }, DEFAULT_PINS.leader, "compute")
  assert.equal(pitch.status, 200, JSON.stringify(pitch.json))
  const verdict = await post("/api/architect/decide", { station: "compute", team: T1, decision: "reject", reason: "Storage is thin for 12 nodes" }, DEFAULT_PINS.leader, "compute")
  assert.equal(verdict.status, 200, JSON.stringify(verdict.json))

  const page = await chrome.page()
  try {
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.getElementById("rejectedBanner")`, 8000, "the rejection banner")
    assert.ok((await text(page, "#rejectedBanner")).includes("Rejected: Storage is thin for 12 nodes"))
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

test("host controls: one masked PIN field → the four tables grid → start and reset the timer without moving the table → run the race; the PIN is on no screen", { skip, timeout: 60_000 }, async () => {
  const pin = DEFAULT_PINS.host
  const host = await chrome.page()
  const table = await chrome.page()
  const confirmYes = async (page) => {
    await page.waitFor(`document.querySelector(".drawer.confirm .btn.danger")`, 5000, "the confirmation")
    await page.click(".drawer.confirm .btn.danger")
  }
  const shows = (page) => page.evaluate(`(document.documentElement.outerHTML + location.href).includes(${JSON.stringify(pin)})`)
  try {
    /* The table sits on the Tune step, scrolled down, while the host works the timer. */
    await table.goto(`${base}/station.html?station=compute`)
    await table.waitFor(`document.querySelector('[data-tab="tune"]') && !document.querySelector('[data-tab="tune"]').disabled`, 8000, "the customer's table")
    await table.click('[data-tab="tune"]')
    await table.waitFor(`document.querySelectorAll("#tuneBoard .dial").length === 3`, 8000, "three dials")
    await table.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); true`)
    await sleep(300)
    const scrolled = await table.evaluate("window.scrollY")
    const headerHeight = () => table.evaluate(`document.querySelector(".topbar").getBoundingClientRect().height`)
    const idleHeight = await headerHeight()

    /* The host page opens on a single masked PIN field. */
    await host.goto(`${base}/host.html`)
    await host.waitFor(`document.getElementById("pinInput")`, 8000, "the PIN field")
    assert.equal(await count(host, 'input[type="password"]'), 1, "one PIN field")
    assert.equal(await host.evaluate(`document.getElementById("pinInput").getAttribute("autocomplete")`), "off")
    assert.equal(await count(host, "#hostControls"), 0, "nothing is shown before the PIN")
    await host.type("#pinInput", "not-the-pin")
    await host.click("#loginGo")
    await host.waitFor(`[...document.querySelectorAll(".toast")].some((t) => t.textContent === "Wrong PIN")`, 5000, "the Wrong PIN message")
    assert.equal(await count(host, "#hostControls"), 0, "a wrong PIN opens nothing")
    await host.type("#pinInput", pin)
    await host.click("#loginGo")
    await host.waitFor(`document.getElementById("hostControls") && document.getElementById("startTimer")`, 8000, "the host controls")
    assert.equal(await text(host, "#bigTimer"), "No timer")
    assert.equal(await host.evaluate(`document.getElementById("timerMinutes").value`), "35", "the timer offers 35 minutes")
    await host.waitFor(`document.querySelectorAll("#tablesGrid [data-table]").length === 4`, 8000, "the four tables in the grid")
    assert.equal(await count(host, "#teamAdmin, [data-team-name], #addTeam, #teamName"), 0, "no team setup on the host console")
    assert.ok((await text(host, '#tablesGrid [data-table="compute"]')).includes("Attempt 2"), "the grid shows the compute table on attempt 2")
    assert.ok((await text(host, '#tablesGrid [data-table="compute"]')).includes("Locked"), "locked and waiting for the SA")
    assert.ok((await text(host, "#tablesTotal")).includes("Total"), "a total row under the four tables")
    assert.ok((await text(host, "#hostControls")).includes(CUSTOMER_TEAM.name), "the console names the customer")

    /* Start timer: the tables count down, in the same header, at the same scroll position. */
    await host.click("#startTimer")
    await host.waitFor(`/^3[45]:\\d\\d$/.test(document.getElementById("bigTimer").textContent) && document.getElementById("pauseTimer")`, 8000, "the countdown")
    await table.waitFor(`/^3[45]:\\d\\d$/.test(document.getElementById("timer").textContent)`, 8000, "the countdown on the table")
    assert.equal((await stateNow()).clock.status, "running")
    assert.ok(Math.abs((await headerHeight()) - idleHeight) < 1, "the table header kept its height when the timer started")
    assert.ok(Math.abs((await table.evaluate("window.scrollY")) - scrolled) <= 2, "starting the timer did not move the table")

    /* Reset timer: back to an untimed, open session. */
    await host.click("#resetTimer")
    await confirmYes(host)
    await host.waitFor(`document.getElementById("bigTimer").textContent === "No timer" && document.getElementById("startTimer")`, 8000, "the timer reset")
    await table.waitFor(`document.getElementById("timer").textContent === "No timer"`, 8000, "No timer on the table again")
    assert.equal((await stateNow()).clock.status, "open")
    assert.ok(Math.abs((await table.evaluate("window.scrollY")) - scrolled) <= 2, "resetting the timer did not move the table")

    /* The race runs at any time, with no timer: the 2027 plan against today's Hinwil setup. */
    await host.click("#hostRunRace")
    await confirmYes(host)
    await host.waitFor(`document.getElementById("showReadouts") && document.getElementById("clearRace")`, 8000, "the race to have run")
    const raced = await stateNow()
    assert.deepEqual(raced.race.result.results.map((r) => r.id).sort(), [T1, "today"].sort(), "two cars raced")

    assert.equal(await shows(host), false, "the PIN is nowhere on the host page or in its address")
    assert.equal(await shows(table), false, "nor on the table")
    assert.equal(JSON.stringify(raced).includes(pin), false, "nor in the shared state")
    assert.deepEqual(host.errors, [], "no JavaScript errors on the host controls")
    assert.deepEqual(table.errors, [], "no JavaScript errors on the table")
  } finally {
    await host.close()
    await table.close()
  }
})
