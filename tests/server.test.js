import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../server.mjs"
import { REFERENCE_BUILD } from "../public/js/sim.js"
import { TEAM_COLORS } from "../public/js/catalog.js"

const PINS = { host: "host-test", leader: "arch-test", race: "race-test" }
let server
let base
let dir
let app

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "podium-"))
  app = createApp({ dataDir: dir, pins: PINS })
  server = createServer(app.handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  app.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
})

async function call(path, body, pin, station, ip) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}), ...(station ? { "x-station": station } : {}), ...(ip ? { "cf-connecting-ip": ip } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const host = (path, body) => call(path, body, PINS.host)
const pick = (station) => Object.fromEntries(Object.entries(REFERENCE_BUILD).filter(([k]) => ({ link: "network", path: "network", garage: "network", vendor: "oem", payment: "oem", support: "oem", location: "dc", cooling: "dc", power: "dc", size: "compute", chips: "compute", storage: "compute" })[k] === station))

test("setup: 1–10 teams, each with a name, a colour and a tier", async () => {
  assert.equal((await host("/api/host/setup", { teams: [] })).status, 400)
  assert.equal((await host("/api/host/setup", { teams: Array.from({ length: 11 }, () => ({ name: "X" })) })).status, 400)
  assert.equal((await call("/api/host/setup", { teams: [{ name: "A" }] }, "wrong")).status, 403)
  const one = await host("/api/host/setup", { teams: [{ name: "Solo", tier: 3 }] })
  assert.equal(one.status, 200, "a single team is allowed")
  const ten = await host("/api/host/setup", { teams: Array.from({ length: 10 }, (_, i) => ({ name: `Team ${i + 1}`, tier: (i % 3) + 1 })) })
  assert.equal(ten.status, 200)
  assert.equal(ten.json.teams.length, 10)
  assert.deepEqual(ten.json.teams.map((t) => t.color), TEAM_COLORS)
  assert.deepEqual(ten.json.teams.slice(0, 3).map((t) => t.tier), [1, 2, 3])
  assert.deepEqual(ten.json.settings.stations, ["network", "oem", "dc", "compute"])
  const s = ten.json.settings
  assert.equal(s.briefMinutes + s.playMinutes + s.raceMinutes + s.readoutMinutes, 50)
  const weird = await host("/api/host/setup", { teams: [{ name: "<b>Bad</b>\u0000", tier: 99 }] })
  assert.equal(weird.json.teams[0].tier, 2, "an invalid tier becomes Midfield")
  assert.ok(!weird.json.teams[0].name.includes("\u0000"))
})

test("phases: the brief blocks choices, play allows them, ending play locks every table", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "A", tier: 2 }, { name: "B", tier: 1 }] })
  const [a] = setup.json.teams
  const tryChoice = () => call(`/api/teams/${a.id}/choices`, { station: "network", choices: { link: "redundant" } })
  assert.equal((await tryChoice()).status, 409, "no choices in the lobby")
  assert.equal((await host("/api/host/phase", { action: "set", briefMinutes: 4, playMinutes: 30, raceMinutes: 1, readoutMinutes: 15 })).json.settings.playMinutes, 30, "the plan is editable")
  const brief = await host("/api/host/phase", { action: "brief" })
  assert.equal(brief.json.brief.status, "running")
  const blocked = await tryChoice()
  assert.equal(blocked.status, 409)
  assert.match(blocked.json.error, /Listen to the brief/)
  assert.equal((await host("/api/host/phase", { action: "brief" })).status, 409, "the brief starts once")
  assert.ok((await host("/api/host/phase", { action: "add", minutes: 1 })).json.brief.endsAt > brief.json.brief.endsAt, "+1 min extends the brief")
  const play = await host("/api/host/phase", { action: "play" })
  assert.equal(play.json.clock.status, "running")
  assert.equal(play.json.brief.status, "done")
  assert.equal(play.json.clock.totalMs, 30 * 60_000)
  assert.equal((await tryChoice()).status, 200, "play allows choices")
  assert.equal((await host("/api/host/phase", { action: "readout" })).status, 409, "no readouts before the race")
  assert.equal((await host("/api/host/phase", { action: "end" })).json.clock.status, "ended")
  const locked = await tryChoice()
  assert.equal(locked.status, 409)
  assert.match(locked.json.error, /Time is up/)
  assert.equal((await host("/api/host/phase", { action: "add", minutes: 2 })).json.clock.status, "running", "the host can re-open play")
})

test("the brief ends on time and offers play", async () => {
  await host("/api/host/setup", { teams: [{ name: "A" }] })
  await host("/api/host/phase", { action: "set", briefMinutes: 0.5 })
  const started = await host("/api/host/phase", { action: "brief" })
  app.getState().brief.endsAt = Date.now() - 1
  const after = await call("/api/state")
  assert.equal(after.json.brief.status, "done")
  assert.ok(started.json.brief.endsAt > 0)
  assert.equal((await host("/api/host/phase", { action: "play" })).json.clock.status, "running")
})

test("pitch and approval: the Architect is scoped to one table, and only approved tables count", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Alpha", tier: 2 }, { name: "Beta", tier: 2 }] })
  const [a, b] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  for (const station of ["network", "oem", "dc", "compute"]) {
    assert.equal((await call(`/api/teams/${a.id}/choices`, { station, choices: pick(station) })).status, 200)
  }
  assert.equal((await call(`/api/teams/${a.id}/choices`, { station: "network", choices: { link: "bogus", size: "medium" } })).status, 207, "invalid or other-table choices are rejected")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).status, 409, "lock in before calling the Architect")
  const locked = await call(`/api/teams/${a.id}/submit`, { station: "network" })
  assert.equal(locked.status, 200)
  assert.equal(locked.json.plan.decisions.length, 3)
  assert.equal(locked.json.plan.band, "Optimised")
  assert.ok(["Low", "Med", "High"].includes(locked.json.plan.ledger.fia))
  assert.equal((await call(`/api/teams/${a.id}/choices`, { station: "network", choices: { link: "single" } })).status, 409, "a locked plan is frozen")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).json.position, 1)

  const login = await call("/api/login", { pin: PINS.leader, station: "network" })
  assert.deepEqual(login.json, { role: "architect", station: "network" })
  assert.equal((await call("/api/login", { pin: PINS.leader })).status, 400, "an Architect must pick a table")
  const arch = (path, body, station = "network") => call(path, { station: "network", ...body }, PINS.leader, station)
  assert.equal((await arch("/api/architect/availability", { available: true }, "dc")).status, 403, "an Architect only acts for their own table")
  assert.equal((await call("/api/architect/availability", { station: "network", available: true }, "nope", "network")).status, 403)
  assert.equal((await arch("/api/architect/pitch", { action: "start", team: a.id })).status, 409, "Available first")
  assert.equal((await arch("/api/architect/availability", { available: true })).status, 200)
  const pitch = await arch("/api/architect/pitch", { action: "start", team: a.id, by: "Sam" })
  assert.equal(pitch.status, 200)
  assert.equal(pitch.json.pitches.network.endsAt - pitch.json.pitches.network.startedAt, 30_000)
  assert.equal(pitch.json.architects.network.available, false, "busy while pitching")

  const back = await arch("/api/architect/decide", { team: a.id, decision: "sendBack", reason: "Explain the fail-over" })
  assert.equal(back.status, 200)
  const ta = back.json.teams.find((t) => t.id === a.id)
  assert.equal(ta.reviews.network.status, "sentBack")
  assert.equal(ta.reviews.network.reason, "Explain the fail-over")
  assert.equal(ta.plans.network, undefined, "sent back unlocks the plan")

  await call(`/api/teams/${a.id}/submit`, { station: "network" })
  await call(`/api/teams/${a.id}/call`, { station: "network" })
  await arch("/api/architect/pitch", { action: "start", team: a.id })
  const ok = await arch("/api/architect/decide", { team: a.id, decision: "approve" })
  const approved = ok.json.teams.find((t) => t.id === a.id)
  assert.equal(approved.reviews.network.status, "approved")
  assert.ok(approved.pitch.network > 0)
  assert.equal(ok.json.architects.network.available, true)

  await call(`/api/teams/${a.id}/submit`, { station: "dc" })
  assert.equal((await call("/api/host/race", { racePassword: PINS.race }, PINS.host)).status, 409, "the race needs play to end first")
  assert.equal((await call("/api/host/race", { racePassword: "nope", endClock: true }, PINS.host)).status, 403)
  const race = await call("/api/host/race", { racePassword: PINS.race, endClock: true, seed: "gate" }, PINS.host)
  assert.equal(race.status, 200)
  const rows = Object.fromEntries(race.json.race.result.results.map((r) => [r.id, r]))
  assert.equal(rows[a.id].pitch, approved.pitch.network, "only the approved table scores")
  assert.deepEqual(rows[a.id].notApproved, ["dc"], "locked in but not approved")
  assert.equal(rows[b.id].missed.length, 4)
  assert.equal(rows[b.id].pitch, 0)
  const readout = await host("/api/host/phase", { action: "readout" })
  assert.ok(readout.json.readout.endsAt > Date.now())
  assert.equal((await call("/api/health")).json.phase, "readout")
  await host("/api/host/unrace", {})
  assert.equal(app.getState().readout, null)
})

test("removed Architect-mode routes and retired tables are gone", async () => {
  await host("/api/host/setup", { teams: [{ name: "A" }] })
  for (const path of ["/api/host/architect", "/api/leader/architect", "/api/teams/t1/architect", "/api/host/clock"]) {
    assert.equal((await call(path, {}, PINS.host)).status, 404, path)
  }
  await host("/api/host/phase", { action: "play" })
  for (const old of ["ai", "storage", "governance"]) assert.equal((await call("/api/teams/t1/submit", { station: old })).status, 400, `${old} is not a table`)
  assert.equal((await call("/api/login", { pin: PINS.leader, station: "ai" })).status, 400)
})

test("PIN-protected routes rate limit repeated failed attempts per client IP", async () => {
  const ip = "203.0.113.77"
  for (let i = 0; i < 10; i++) assert.equal((await call("/api/login", { pin: `bad-${i}` }, null, null, ip)).status, 403)
  const limited = await call("/api/login", { pin: PINS.host }, null, null, ip)
  assert.equal(limited.status, 429)
  assert.equal((await call("/api/login", { pin: PINS.host }, null, null, "203.0.113.78")).status, 200, "other clients are unaffected")
})

test("state survives a server restart", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Keep A", tier: 3 }, { name: "Keep B", tier: 1 }] })
  await host("/api/host/phase", { action: "play" })
  const [a] = setup.json.teams
  await call(`/api/teams/${a.id}/checkin`, { station: "dc" })
  await call(`/api/teams/${a.id}/choices`, { station: "dc", choices: { location: "colo", cooling: "liquid" } })
  await call(`/api/teams/${a.id}/submit`, { station: "dc" })
  const before = app.getState()
  const restarted = createApp({ dataDir: dir, pins: PINS })
  try {
    const again = restarted.getState()
    assert.equal(again.id, before.id)
    assert.deepEqual(again.teams[0].choices, { location: "colo", cooling: "liquid" })
    assert.deepEqual(again.teams[0].plans.dc, before.teams[0].plans.dc)
    assert.equal(again.teams[0].tier, 3)
    assert.equal(again.tables.dc.team, a.id)
    assert.equal(again.clock.endsAt, before.clock.endsAt)
  } finally {
    restarted.close()
  }
})

test("an old six-table save loads into the four-table game", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-old-"))
  try {
    await writeFile(join(other, "state.json"), JSON.stringify({ id: "old", version: 9, settings: { stations: ["compute", "ai", "storage"], gameMinutes: 90 }, clock: { status: "lobby" }, teams: [{ id: "t1", name: "Old", rank: 3, choices: { cpu: "grace", link: "redundant" }, architect: { enabled: true } }] }))
    const old = createApp({ dataDir: other, pins: PINS })
    old.close()
    const s = old.getState()
    assert.deepEqual(s.settings.stations, ["compute"])
    assert.equal(s.settings.playMinutes, 35)
    assert.deepEqual(s.teams[0].choices, { link: "redundant" })
    assert.equal(s.teams[0].architect, undefined)
    assert.equal(s.teams[0].tier, 2)
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})

test("a damaged state file is kept aside and a blank game starts", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-bad-"))
  try {
    await writeFile(join(other, "state.json"), "{ not json")
    const fresh = createApp({ dataDir: other, pins: PINS })
    fresh.close()
    assert.equal(fresh.getState().teams.length, 0)
    assert.ok((await readdir(other)).some((name) => name.startsWith("state.json.damaged-")))
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})

test("reset returns to an empty game; static files are served; traversal is refused", async () => {
  assert.equal((await call("/api/host/reset", {}, "nope")).status, 403)
  const reset = await host("/api/host/reset", {})
  assert.equal(reset.json.teams.length, 0)
  assert.equal(reset.json.clock.status, "lobby")
  const res = await fetch(`${base}/station.html`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("x-content-type-options"), "nosniff")
  for (const bad of ["/..%2f..%2fserver.mjs", "/%E0%A4%A", "/../package.json"]) {
    const r = await fetch(base + bad)
    assert.ok([400, 403, 404].includes(r.status), `${bad} → ${r.status}`)
    assert.ok(!(await r.text()).includes("createApp"))
  }
})
