import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp, DEFAULT_PINS, PIN_NAMES, resolvePins, pinSummary } from "../server.mjs"
import { TEAM_COLORS, tablePoints, decisionsFor } from "../public/js/catalog.js"
import { boardFor } from "../public/js/model.js"
import { tableStory } from "../public/js/report.js"
import { pick } from "./routes.js"

const PINS = { host: "host-test", leader: "arch-test", race: "race-test" }
const ENV = { HOST_PIN: PINS.host, LEADER_PIN: PINS.leader, RACE_PIN: PINS.race }
let server
let base
let dir
let app

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "podium-"))
  app = createApp({ dataDir: dir, env: ENV })
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
const readBrief = (teamId, station) => call(`/api/teams/${teamId}/brief`, { station })
const tap = (teamId, station, choices) => call(`/api/teams/${teamId}/choices`, { station, choices })
/** Lock all three dials of a table one tap at a time (the reference build); returns the last response. */
async function lockAll(teamId, station) {
  let last
  for (const [key, value] of Object.entries(pick(station))) last = await tap(teamId, station, { [key]: value })
  return last
}
const teamOf = (json, id) => json.teams.find((t) => t.id === id)

test("setup: 1–10 teams with a name and a colour, and one budget level for the session", async () => {
  assert.equal((await host("/api/host/setup", { teams: [] })).status, 400)
  assert.equal((await host("/api/host/setup", { teams: Array.from({ length: 11 }, () => ({ name: "X" })) })).status, 400)
  assert.equal((await call("/api/host/setup", { teams: [{ name: "A" }] }, "wrong")).status, 403)
  const one = await host("/api/host/setup", { teams: [{ name: "Solo" }] })
  assert.equal(one.status, 200, "a single team is allowed")
  const ten = await host("/api/host/setup", { teams: Array.from({ length: 10 }, (_, i) => ({ name: `Team ${i + 1}` })), budget: "tight" })
  assert.equal(ten.status, 200)
  assert.equal(ten.json.teams.length, 10)
  assert.deepEqual(ten.json.teams.map((t) => t.color), TEAM_COLORS)
  assert.ok(ten.json.teams.every((t) => t.tier === undefined), "no per-team tiers")
  for (const key of ["briefRead", "attempts", "previous", "plans", "reviews"]) assert.deepEqual(ten.json.teams[0][key], {}, `a new team has an empty ${key}`)
  assert.equal(ten.json.settings.budget, "tight")
  assert.deepEqual(ten.json.settings.stations, ["network", "oem", "dc", "compute"])
  const s = ten.json.settings
  assert.equal(s.briefMinutes + s.playMinutes + s.raceMinutes + s.readoutMinutes, 50)
  const weird = await host("/api/host/setup", { teams: [{ name: "<b>Bad</b>\u0000" }], budget: "infinite" })
  assert.equal(weird.json.settings.budget, "standard", "an unknown budget level becomes Standard")
  assert.ok(!weird.json.teams[0].name.includes("\u0000"))
})

test("phases: the brief phase blocks choices, play allows them, ending play locks every table", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "A" }, { name: "B" }] })
  const [a] = setup.json.teams
  const tryChoice = () => tap(a.id, "network", { link: "redundant" })
  assert.equal((await tryChoice()).status, 409, "no choices in the lobby")
  const plan = await host("/api/host/phase", { action: "set", briefMinutes: 4, playMinutes: 30, raceMinutes: 1, readoutMinutes: 15, budget: "generous" })
  assert.equal(plan.json.settings.playMinutes, 30, "the plan is editable")
  assert.equal(plan.json.settings.budget, "generous", "the budget level is set in the lobby")
  const brief = await host("/api/host/phase", { action: "brief" })
  assert.equal(brief.json.brief.status, "running")
  assert.equal((await readBrief(a.id, "network")).status, 200, "a team can confirm it read the brief during the brief phase")
  const blocked = await tryChoice()
  assert.equal(blocked.status, 409)
  assert.match(blocked.json.error, /Read the brief/)
  assert.equal((await host("/api/host/phase", { action: "brief" })).status, 409, "the brief starts once")
  assert.ok((await host("/api/host/phase", { action: "add", minutes: 1 })).json.brief.endsAt > brief.json.brief.endsAt, "+1 min extends the brief")
  const play = await host("/api/host/phase", { action: "play" })
  assert.equal(play.json.clock.status, "running")
  assert.equal(play.json.brief.status, "done")
  assert.equal(play.json.clock.totalMs, 30 * 60_000)
  assert.equal((await tryChoice()).status, 200, "play allows choices once the brief is read")
  assert.equal((await host("/api/host/phase", { action: "readout" })).status, 409, "no readouts before the race")
  assert.equal((await host("/api/host/phase", { action: "end" })).json.clock.status, "ended")
  const locked = await tap(a.id, "network", { path: "crossconnect" })
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

test("the brief gate: the server refuses choices at a table until that team has read that table's brief", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Gate" }] })
  const [a] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  const refused = await tap(a.id, "oem", { vendor: "tier1" })
  assert.equal(refused.status, 409)
  assert.match(refused.json.error, /Read the brief first/)
  assert.deepEqual(teamOf((await call("/api/state")).json, a.id).choices, {}, "nothing was stored")
  const read = await readBrief(a.id, "oem")
  assert.equal(read.status, 200)
  assert.ok(read.json.team.briefRead.oem > 0)
  assert.equal(read.json.team.briefRead.dc, undefined, "the flag is per team and per table")
  assert.equal((await tap(a.id, "oem", { vendor: "tier1" })).status, 200, "the same tap is accepted once the brief is read")
  assert.equal((await tap(a.id, "dc", { location: "colo" })).status, 409, "another table still needs its own brief")
  assert.equal((await readBrief(a.id, "nope")).status, 400)
})

test("one-shot choices: the first tap locks a dial, the server refuses any change, three locks make the plan", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Alpha" }, { name: "Beta" }] })
  const [a] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  await readBrief(a.id, "network")
  const first = await tap(a.id, "network", { link: "redundant" })
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.locked, ["link"])
  assert.equal(first.json.plan, null)
  assert.equal(first.json.attempts, 0)
  const again = await tap(a.id, "network", { link: "single" })
  assert.equal(again.status, 409, "a locked dial cannot change")
  assert.match(again.json.error, /locked/i)
  assert.equal(teamOf((await call("/api/state")).json, a.id).choices.link, "redundant", "the first pick stands")
  const same = await tap(a.id, "network", { link: "redundant" })
  assert.equal(same.status, 409, "even tapping the same setting again is refused: one tap decides it")
  const mixed = await tap(a.id, "network", { path: "crossconnect", link: "single" })
  assert.equal(mixed.status, 207, "a batch with one accepted and one refused key answers 207")
  assert.deepEqual(mixed.json.rejected, ["link"])
  assert.deepEqual(mixed.json.locked.sort(), ["link", "path"])
  const bad = await tap(a.id, "network", { link: "bogus", size: "medium" })
  assert.equal(bad.status, 409, "a batch where nothing is accepted answers 409")
  assert.match(bad.json.error, /not a setting on this table|locked/)
  const third = await tap(a.id, "network", { garage: pick("network").garage })
  assert.equal(third.status, 200)
  assert.equal(third.json.locked.length, 3)
  assert.ok(third.json.plan, "the third lock builds the plan at once")
  assert.equal(third.json.attempts, 1)
  assert.equal(third.json.plan.decisions.length, 3)
  assert.equal(third.json.plan.inZone, true)
  assert.equal(third.json.plan.fit, boardFor("network", pick("network")).fit, "the server builds the same board as the iPad")
  assert.equal(third.json.plan.board.targets.length, 3)
  const frozen = await tap(a.id, "network", { link: "single" })
  assert.equal(frozen.status, 409)
  assert.match(frozen.json.error, /All three choices are locked: call the Solutions Architect/)
  assert.equal((await tap(a.id, "network", { path: "public" })).status, 409, "nothing on a locked table changes")
})

test("pitch, rejection and approval: a rejection reopens only that team at that table and counts attempts", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Alpha" }, { name: "Beta" }] })
  const [a, b] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  for (const t of [a, b]) for (const station of ["network", "oem"]) await readBrief(t.id, station)
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).status, 409, "lock all three before calling the SA")
  await lockAll(a.id, "network")
  await lockAll(a.id, "oem")
  await lockAll(b.id, "network")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).json.position, 1)
  assert.equal((await call(`/api/teams/${b.id}/call`, { station: "network" })).json.position, 2)

  const login = await call("/api/login", { pin: PINS.leader, station: "network" })
  assert.deepEqual(login.json, { role: "architect", station: "network" })
  assert.equal((await call("/api/login", { pin: PINS.leader })).status, 400, "a Solutions Architect must pick a table")
  const arch = (path, body, station = "network") => call(path, { station: "network", ...body }, PINS.leader, station)
  assert.equal((await arch("/api/architect/availability", { available: true }, "dc")).status, 403, "an SA only acts for their own table")
  assert.equal((await call("/api/architect/availability", { station: "network", available: true }, "nope", "network")).status, 403)
  assert.equal((await arch("/api/architect/pitch", { action: "start", team: a.id })).status, 409, "Available first")
  assert.equal((await arch("/api/architect/availability", { available: true })).status, 200)
  const pitch = await arch("/api/architect/pitch", { action: "start", team: a.id, by: "Sam" })
  assert.equal(pitch.status, 200)
  assert.equal(pitch.json.pitches.network.endsAt - pitch.json.pitches.network.startedAt, 30_000)
  assert.equal(pitch.json.pitches.network.attempt, 1)
  assert.equal(pitch.json.architects.network.available, false, "busy while pitching")
  assert.equal((await arch("/api/architect/decide", { team: a.id, decision: "sendBack" })).status, 400, "the old verb is gone: approve or reject")

  const rejected = await arch("/api/architect/decide", { team: a.id, decision: "reject", reason: "Explain the fail-over" })
  assert.equal(rejected.status, 200)
  const ta = teamOf(rejected.json, a.id)
  assert.equal(ta.reviews.network.status, "rejected")
  assert.equal(ta.reviews.network.reason, "Explain the fail-over")
  assert.equal(ta.reviews.network.attempt, 1)
  assert.equal(ta.plans.network, undefined, "the rejected plan is gone")
  assert.deepEqual(ta.previous.network, pick("network"), "last time's picks are kept as ghosts")
  for (const d of decisionsFor("network")) assert.equal(ta.choices[d.id], undefined, `${d.id} is open again`)
  assert.ok(ta.plans.oem, "the same team's other table is untouched")
  for (const d of decisionsFor("oem")) assert.equal(ta.choices[d.id], pick("oem")[d.id])
  assert.ok(teamOf(rejected.json, b.id).plans.network, "the other team at this table is untouched")
  assert.equal(ta.attempts.network, 1, "the rejected design was attempt 1")
  assert.deepEqual(rejected.json.queues.network.map((e) => e.team), [b.id], "the rejected team leaves the queue")
  assert.equal(rejected.json.architects.network.available, true)

  const retap = await tap(a.id, "network", { link: "redundant" })
  assert.equal(retap.status, 200, "the dials are open again")
  assert.equal((await tap(a.id, "network", { link: "single" })).status, 409, "and each new tap locks instantly")
  const relocked = await lockAll(a.id, "network")
  assert.equal(relocked.json.attempts, 2, "three new locks make attempt 2")
  assert.ok(relocked.json.plan)
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).json.position, 2)
  const pitch2 = await arch("/api/architect/pitch", { action: "start", team: a.id })
  assert.equal(pitch2.json.pitches.network.attempt, 2)
  const ok = await arch("/api/architect/decide", { team: a.id, decision: "approve" })
  const approved = teamOf(ok.json, a.id)
  assert.equal(approved.reviews.network.status, "approved")
  assert.equal(approved.reviews.network.attempt, 2)
  assert.equal(approved.pitch.network, tablePoints(approved.plans.network.fit, true), "approval scores the locked board's FIT")
  assert.equal(approved.reviews.network.fit, approved.plans.network.fit)
  assert.equal(ok.json.architects.network.available, true)
  assert.match(tableStory(approved, "network").text, /Approved on the second attempt/)
  const after = await tap(a.id, "network", { link: "single" })
  assert.equal(after.status, 409)
  assert.match(after.json.error, /approved/)
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).status, 409, "no second pitch once approved")

  await readBrief(a.id, "dc")
  await lockAll(a.id, "dc")
  assert.equal((await call("/api/host/race", { racePassword: PINS.race }, PINS.host)).status, 409, "the race needs play to end first")
  assert.equal((await call("/api/host/race", { racePassword: "nope", endClock: true }, PINS.host)).status, 403)
  const race = await call("/api/host/race", { racePassword: PINS.race, endClock: true, seed: "gate" }, PINS.host)
  assert.equal(race.status, 200)
  const rows = Object.fromEntries(race.json.race.result.results.map((r) => [r.id, r]))
  assert.equal(rows[a.id].pitch, approved.pitch.network, "only the approved table scores")
  assert.deepEqual(rows[a.id].notApproved.sort(), ["dc", "oem"], "locked but not approved tables race on today's setup")
  assert.equal(rows[b.id].pitch, 0)
  const readout = await host("/api/host/phase", { action: "readout" })
  assert.ok(readout.json.readout.endsAt > Date.now())
  assert.equal((await call("/api/health")).json.phase, "readout")
  await host("/api/host/unrace", {})
  assert.equal(app.getState().readout, null)
})

test("end of play: a table still adjusting after a rejection races on today's setup, and the readout explains", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Late" }] })
  const [a] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  await readBrief(a.id, "dc")
  await lockAll(a.id, "dc")
  const arch = (path, body) => call(path, { station: "dc", ...body }, PINS.leader, "dc")
  await arch("/api/architect/availability", { available: true })
  await call(`/api/teams/${a.id}/call`, { station: "dc" })
  await arch("/api/architect/pitch", { action: "start", team: a.id })
  await arch("/api/architect/decide", { team: a.id, decision: "reject", reason: "No N+1" })
  assert.equal((await tap(a.id, "dc", { location: "colo" })).status, 200, "one dial relocked: adjusting")
  await host("/api/host/phase", { action: "end" })
  assert.equal((await tap(a.id, "dc", { cooling: "liquid" })).status, 409, "time is up")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "dc" })).status, 409, "no plan to pitch")
  const team = teamOf((await call("/api/state")).json, a.id)
  const story = tableStory(team, "dc")
  assert.equal(story.status, "rejected")
  assert.match(story.text, /Rejected on the first attempt \("No N\+1"\) and still adjusting when time ran out, so this table raced on today's setup/)
  const race = await call("/api/host/race", { racePassword: PINS.race, seed: "late" }, PINS.host)
  const row = race.json.race.result.results.find((r) => r.id === a.id)
  assert.ok(row.notApproved.includes("dc"), "the table was tried but not approved: it races on today's setup")
  assert.equal(row.pitch, 0)
  assert.equal(row.found, 0, "nothing found: today's setup at every table")
  await host("/api/host/unrace", {})
})

test("a plan locked before time ran out can still be pitched and approved after it", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Just" }] })
  const [a] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  await readBrief(a.id, "compute")
  await lockAll(a.id, "compute")
  await host("/api/host/phase", { action: "end" })
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "compute" })).status, 200, "the queue stays open for a plan locked in time")
  const arch = (path, body) => call(path, { station: "compute", ...body }, PINS.leader, "compute")
  await arch("/api/architect/availability", { available: true })
  assert.equal((await arch("/api/architect/pitch", { action: "start", team: a.id })).status, 200)
  const ok = await arch("/api/architect/decide", { team: a.id, decision: "approve" })
  assert.equal(teamOf(ok.json, a.id).reviews.compute.status, "approved")
})

test("the approval gate scores FIT: an approved over-cap board earns far less than an in-zone one; tuning is logged", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Zone" }, { name: "Over" }] })
  const [zone, over] = setup.json.teams
  await host("/api/host/phase", { action: "play" })
  for (const t of [zone, over]) await readBrief(t.id, "oem")
  await lockAll(zone.id, "oem")
  for (const [k, v] of Object.entries({ vendor: "dgx", payment: "buy", support: "4h" })) await tap(over.id, "oem", { [k]: v })
  const sim = await call(`/api/teams/${zone.id}/sim`, { station: "oem" })
  assert.equal(sim.json.runs.inZone, true)
  assert.ok(sim.json.runs.firstZoneAt > 0 && sim.json.runs.lastFit >= 80, "the host feed sees the latest FIT")
  const arch = (path, body) => call(path, { station: "oem", ...body }, PINS.leader, "oem")
  await arch("/api/architect/availability", { available: true })
  const points = {}
  for (const t of [zone, over]) {
    const plan = teamOf((await call("/api/state")).json, t.id).plans.oem
    await call(`/api/teams/${t.id}/call`, { station: "oem" })
    await arch("/api/architect/pitch", { action: "start", team: t.id })
    const res = await arch("/api/architect/decide", { team: t.id, decision: "approve" })
    points[t.id] = { plan, pitch: teamOf(res.json, t.id).pitch.oem }
  }
  assert.equal(points[over.id].plan.status, "over")
  assert.ok(points[over.id].plan.fit <= 40)
  assert.ok(points[zone.id].pitch >= points[over.id].pitch * 2, `in zone ${points[zone.id].pitch} vs over the cap ${points[over.id].pitch}`)
})

test("removed routes and retired tables are gone", async () => {
  await host("/api/host/setup", { teams: [{ name: "A" }] })
  for (const path of ["/api/host/architect", "/api/leader/architect", "/api/teams/t1/architect", "/api/host/clock", "/api/teams/t1/submit"]) {
    assert.equal((await call(path, {}, PINS.host)).status, 404, path)
  }
  await host("/api/host/phase", { action: "play" })
  for (const old of ["ai", "storage", "governance"]) assert.equal((await call("/api/teams/t1/choices", { station: old, choices: {} })).status, 400, `${old} is not a table`)
  assert.equal((await call("/api/login", { pin: PINS.leader, station: "ai" })).status, 400)
})

test("PINs: one event PIN by default, the environment may override, and nothing in the saved game can set one", async () => {
  assert.deepEqual(DEFAULT_PINS, { host: "SKO27", leader: "SKO27", race: "SKO27" })
  assert.deepEqual(PIN_NAMES, { host: "HOST_PIN", leader: "LEADER_PIN", race: "RACE_PIN" })
  assert.deepEqual(resolvePins({}), DEFAULT_PINS)
  assert.deepEqual(resolvePins({ HOST_PIN: "h1" }), { host: "h1", leader: "SKO27", race: "SKO27" })
  const summary = pinSummary({ HOST_PIN: "secret-value" })
  assert.match(summary, /HOST_PIN \(from the environment\)/)
  assert.match(summary, /LEADER_PIN \(default\)/)
  assert.ok(!summary.includes("secret-value") && !summary.includes("SKO27"), "the summary never carries a PIN value")

  const other = await mkdtemp(join(tmpdir(), "podium-pins-"))
  try {
    await writeFile(join(other, "state.json"), JSON.stringify({ id: "pinned", version: 3, settings: {}, clock: { status: "lobby" }, teams: [], pins: { host: "evil", leader: "evil", race: "evil" } }))
    const fresh = createApp({ dataDir: other, env: {} })
    const srv = createServer(fresh.handle)
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve))
    const url = `http://127.0.0.1:${srv.address().port}`
    const post = (body) => fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    try {
      assert.equal(fresh.getState().pins, undefined, "a pins key in the file is dropped")
      assert.equal((await post({ pin: "evil" })).status, 403, "the saved file cannot set a PIN")
      assert.equal((await (await post({ pin: "SKO27" })).json()).role, "host", "the event PIN with no table signs the host in")
      assert.deepEqual(await (await post({ pin: "SKO27", station: "dc" })).json(), { role: "architect", station: "dc" }, "the event PIN with a table signs the Solutions Architect in, scoped to that table")
      assert.equal((await post({ pin: "SKO27", station: "ai" })).status, 400, "a retired table is refused")
      const sa = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json", "x-pin": "SKO27" }, body: JSON.stringify({ pin: "SKO27", station: "dc" }) })
      assert.equal((await sa.json()).role, "architect")
      const raced = await fetch(`${url}/api/race/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "SKO27" }) })
      assert.equal(raced.status, 400, "the race password is accepted (no teams yet is the only complaint)")
    } finally {
      fresh.close()
      await new Promise((resolve) => srv.close(resolve))
    }
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})

test("PIN-protected routes rate limit repeated failed attempts per client IP", async () => {
  const ip = "203.0.113.77"
  for (let i = 0; i < 10; i++) assert.equal((await call("/api/login", { pin: `bad-${i}` }, null, null, ip)).status, 403)
  const limited = await call("/api/login", { pin: PINS.host }, null, null, ip)
  assert.equal(limited.status, 429)
  assert.equal((await call("/api/login", { pin: PINS.host }, null, null, "203.0.113.78")).status, 200, "other clients are unaffected")
})

test("state survives a server restart", async () => {
  const setup = await host("/api/host/setup", { teams: [{ name: "Keep A" }, { name: "Keep B" }] })
  await host("/api/host/phase", { action: "play" })
  const [a] = setup.json.teams
  await call(`/api/teams/${a.id}/checkin`, { station: "dc" })
  await readBrief(a.id, "dc")
  await tap(a.id, "dc", { location: "colo" })
  await tap(a.id, "dc", { cooling: "liquid" })
  const before = app.getState()
  const restarted = createApp({ dataDir: dir, env: ENV })
  try {
    const again = restarted.getState()
    assert.equal(again.id, before.id)
    assert.deepEqual(again.teams[0].choices, { location: "colo", cooling: "liquid" })
    assert.equal(again.teams[0].plans.dc, undefined, "two locks are not a plan")
    assert.ok(again.teams[0].briefRead.dc > 0)
    assert.equal(again.tables.dc.team, a.id)
    assert.equal(again.clock.endsAt, before.clock.endsAt)
  } finally {
    restarted.close()
  }
})

test("an old save migrates: locked plans become three locks (attempt 1), sent back becomes rejected, pins are dropped", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-old-"))
  try {
    const plan = { id: "OLD01", station: "network", at: 1000, budget: "standard", choices: pick("network"), fit: 90, status: "zone", inZone: true, decisions: [], board: { seconds: 0.3, values: {} } }
    await writeFile(join(other, "state.json"), JSON.stringify({
      id: "old", version: 9, settings: { stations: ["compute", "ai", "storage", "network", "oem"], gameMinutes: 90 }, clock: { status: "running", endsAt: Date.now() + 60_000 }, pins: { host: "x" },
      teams: [
        { id: "t1", name: "Old", rank: 3, choices: { cpu: "grace", link: "redundant" }, architect: { enabled: true } },
        { id: "t2", name: "Locked", choices: { ...pick("network"), ...pick("oem") }, plans: { network: plan }, submitted: { network: 1000 }, reviews: { network: { status: "approved", by: "A", at: 2000, points: 25 }, oem: { status: "sentBack", by: "B", at: 3000, reason: "Again" } }, pitch: { network: 25 } },
      ],
    }))
    const old = createApp({ dataDir: other, env: {} })
    old.close()
    const s = old.getState()
    assert.equal(s.pins, undefined)
    assert.deepEqual(s.settings.stations, ["compute", "network", "oem"])
    assert.equal(s.settings.playMinutes, 35)
    assert.equal(s.settings.budget, "standard")
    const [t1, t2] = s.teams
    assert.deepEqual(t1.choices, { link: "redundant" })
    assert.equal(t1.architect, undefined)
    assert.equal(t1.tier, undefined)
    assert.equal(t1.rank, undefined)
    assert.equal(t1.attempts.network, undefined, "one lock is not an attempt")
    assert.ok(t1.briefRead.network > 0, "a table already being played counts as a read brief")
    assert.equal(t2.reviews.network.status, "approved")
    assert.equal(t2.reviews.network.attempt, 1)
    assert.equal(t2.attempts.network, 1)
    assert.equal(t2.reviews.oem.status, "rejected", "sent back becomes rejected")
    assert.ok(t2.plans.oem, "three old locks without a plan become attempt 2 after a rejection")
    assert.equal(t2.attempts.oem, 2)
    assert.equal(t2.reviews.oem.attempt, 1)
    assert.ok(t2.briefRead.oem > 0)
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})

test("a damaged state file is kept aside and a blank game starts", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-bad-"))
  try {
    await writeFile(join(other, "state.json"), "{ not json")
    const fresh = createApp({ dataDir: other, env: ENV })
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
