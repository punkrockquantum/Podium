/**
 * The table iPad in a real (headless) Chrome, from a brand-new empty game with no host action: the
 * team adds itself, the brief gate, nothing selected on load, one tap locks a dial for good, the
 * page never snaps back to the top while polling, and the call to the Solutions Architect.
 * Skipped when Chrome is not installed (set PODIUM_CHROME to point at one).
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

test("the table, from an empty game: add your team → brief gate → nothing selected → one tap locks for good → scroll holds → call the SA", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  try {
    /* A brand-new game: no host has done anything, no timer, no teams. */
    const fresh = await stateNow()
    assert.equal(fresh.teams.length, 0, "the game starts with no teams")
    assert.equal(fresh.clock.status, "open", "and no timer")

    /* 0 · Add your team: type a name, tap once, and the table opens on its brief. */
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.getElementById("teamName")`, 8000, "the Add your team box")
    assert.ok((await text(page, "#noTeams")).includes("No teams yet"), "an empty list says so")
    assert.ok((await text(page, "#addTeamBox")).includes("Add your team"))
    assert.equal(await count(page, 'input[type="password"]'), 0, "no PIN is asked for at the table")
    assert.equal(await text(page, "#timer"), "No timer", "the header shows the untimed session")
    await page.click("#addTeam")
    await page.waitFor(`(document.getElementById("addTeamError")?.textContent || "").includes("Type a team name first")`, 8000, "the empty-name message")
    assert.equal((await stateNow()).teams.length, 0, "an empty name adds nobody")
    await page.type("#teamName", "  Red  ")
    await page.click("#addTeam")
    await page.waitFor(`document.querySelector('[data-tab="brief"].active')`, 8000, "the Brief tab")
    const joined = await stateNow()
    assert.deepEqual(joined.teams.map((t) => [t.id, t.name]), [["t1", "Red"]], "the team is on the server, trimmed")
    assert.equal(joined.tables.compute?.team, "t1", "and sitting at this table")

    /* A second iPad sees Red in its list, and a second team adds itself there: no host involved. */
    const other = await chrome.page()
    try {
      await other.goto(`${base}/station.html?station=dc`)
      await other.waitFor(`document.querySelector('[data-team="t1"]')`, 8000, "Red on the other iPad")
      await other.type("#teamName", "red")
      await other.click("#addTeam")
      await other.waitFor(`(document.getElementById("addTeamError")?.textContent || "").includes("already a team called")`, 8000, "the duplicate-name message")
      await other.type("#teamName", "Blue")
      await other.click("#addTeam")
      await other.waitFor(`document.querySelector('[data-tab="brief"].active')`, 8000, "Blue's brief")
      assert.deepEqual((await stateNow()).teams.map((t) => t.name), ["Red", "Blue"])
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
  assert.deepEqual((state.queues.compute || []).map((q) => q.team), ["t1"], "the first test left Red in the queue")
  const signIn = await post("/api/login", { pin: DEFAULT_PINS.leader, station: "compute" })
  assert.equal(signIn.json?.role, "architect", "the SA signs in with the PIN and a table: nothing else to switch on")
  const pitch = await post("/api/architect/pitch", { station: "compute", team: "t1", action: "start" }, DEFAULT_PINS.leader, "compute")
  assert.equal(pitch.status, 200, JSON.stringify(pitch.json))
  const verdict = await post("/api/architect/decide", { station: "compute", team: "t1", decision: "reject", reason: "Storage is thin for 12 nodes" }, DEFAULT_PINS.leader, "compute")
  assert.equal(verdict.status, 200, JSON.stringify(verdict.json))

  const page = await chrome.page()
  try {
    await page.goto(`${base}/station.html?station=compute`)
    await page.waitFor(`document.querySelector('[data-team="t1"]')`, 8000, "the team list")
    await page.click('[data-team="t1"]')
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

test("host controls: one masked PIN field → start and reset the timer without moving the table → run the race; the PIN is on no screen", { skip, timeout: 60_000 }, async () => {
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
    await table.waitFor(`document.querySelector('[data-team="t1"]')`, 8000, "the team list")
    await table.click('[data-team="t1"]')
    await table.waitFor(`document.querySelector('[data-tab="tune"]') && !document.querySelector('[data-tab="tune"]').disabled`, 8000, "Red's table")
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
    assert.ok(await count(host, "#teamAdmin [data-team-name]") >= 2, "the teams that added themselves are listed")

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

    /* The race runs at any time, with no timer. */
    await host.click("#hostRunRace")
    await confirmYes(host)
    await host.waitFor(`document.getElementById("showReadouts") && document.getElementById("clearRace")`, 8000, "the race to have run")
    const raced = await stateNow()
    assert.equal(raced.race.result.results.length, raced.teams.length, "every team raced")

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
