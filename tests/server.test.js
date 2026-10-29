import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../server.mjs"

const PINS = { host: "host-test", leader: "lead-test", race: "race-test" }
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

async function call(path, body, pin, station) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}), ...(station ? { "x-station": station } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

test("full game flow over the API", async () => {
  assert.equal((await call("/api/health")).status, 200)
  assert.equal((await call("/api/host/setup", { teams: [{ name: "A", rank: 1 }, { name: "B", rank: 9 }] }, "wrong")).status, 403)
  assert.equal((await call("/api/host/setup", { teams: [{ name: "A", rank: 1 }] }, PINS.host)).status, 400)
  assert.equal((await call("/api/host/setup", { teams: [{ name: "A" }, { name: "B" }], stations: ["compute", "ai"] }, PINS.host)).status, 400)

  const setup = await call("/api/host/setup", { teams: [{ name: "Alpha", rank: 2 }, { name: "<b>Beta</b>", rank: 8 }], gameMinutes: 30 }, PINS.host)
  assert.equal(setup.status, 200)
  const [a, b] = setup.json.teams
  assert.equal(setup.json.settings.stations.length, 6)
  assert.equal(setup.json.clock.status, "lobby")
  assert.equal(setup.json.clock.totalMs, 30 * 60_000)

  assert.equal((await call(`/api/teams/${a.id}/choices`, { station: "compute", choices: { cpu: "grace" } })).status, 409, "no choices before the clock starts")
  assert.equal((await call("/api/host/clock", { action: "start" })).status, 403)
  assert.equal((await call("/api/host/clock", { action: "start" }, PINS.host)).json.clock.status, "running")

  const partial = await call(`/api/teams/${a.id}/choices`, { station: "compute", choices: { cpu: "grace", nodes: 8, platform: "b300", clock: "bogus" } })
  assert.equal(partial.status, 207)
  assert.deepEqual(partial.json.rejected.sort(), ["clock", "platform"])
  assert.equal(partial.json.team.choices.cpu, "grace")

  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "compute" })).status, 409, "lock in before calling the leader")
  const locked = await call(`/api/teams/${a.id}/submit`, { station: "compute" })
  assert.equal(locked.status, 200)
  const plan = locked.json.plan
  assert.match(plan.id, /^[A-Z2-9]{5}$/)
  assert.ok(plan.score > 0 && plan.decisions.length === 6 && plan.table.capex > 0)
  assert.equal(locked.json.team.pitch.compute, undefined, "locking in banks nothing: only approval scores")
  assert.equal((await call(`/api/teams/${a.id}/submit`, { station: "compute" })).json.plan.id, plan.id, "lock-in is idempotent")
  assert.equal((await call(`/api/teams/${a.id}/choices`, { station: "compute", choices: { nodes: 4 } })).status, 409, "a locked plan cannot change")

  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "compute" })).json.position, 1)
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "compute" })).json.position, 1, "calling twice keeps one place")
  assert.equal((await call("/api/leader/availability", { station: "compute", available: true })).status, 403)
  assert.equal((await call("/api/leader/availability", { station: "compute", available: true }, PINS.leader, "ai")).status, 403, "a leader only acts for the table chosen at login")
  const free = await call("/api/leader/availability", { station: "compute", available: true }, PINS.leader, "compute")
  assert.equal(free.json.leader.available, true)
  assert.equal((await call("/api/host/queue", { station: "compute", action: "slot", team: a.id, slot: "25:99" }, PINS.host)).status, 400)
  const slotted = await call("/api/host/queue", { station: "compute", action: "slot", team: a.id, slot: "10:45" }, PINS.host)
  assert.equal(slotted.json.queues.compute[0].slot, "10:45")
  assert.equal((await call("/api/host/queue", { station: "compute", action: "confirm", team: a.id }, PINS.host)).json.queues.compute[0].confirmed, true)

  assert.equal((await call(`/api/teams/${a.id}/verdict`, { station: "compute", verdict: "convinced" }, PINS.leader, "compute")).status, 404, "the verdict route is retired")
  const lead = (path, body) => call(path, { station: "compute", ...body }, PINS.leader, "compute")
  assert.equal((await lead("/api/leader/decide", { team: a.id, decision: "approve" })).status, 409, "no decision without a pitch")
  const started = await lead("/api/leader/pitch", { action: "start", team: a.id })
  assert.equal(started.status, 200)
  assert.equal(started.json.pitches.compute.team, a.id)
  assert.equal(started.json.leaders.compute.available, false, "starting a pitch makes the leader Busy")
  const approvedRes = await lead("/api/leader/decide", { team: a.id, decision: "approve", by: "Ada" })
  assert.equal(approvedRes.status, 200)
  const alphaNow = approvedRes.json.teams.find((t) => t.id === a.id)
  assert.equal(alphaNow.pitch.compute, Math.round((plan.score * 1.1) / 4), "approval scores the system score plus 10%")
  assert.equal(alphaNow.reviews.compute.status, "approved")
  assert.equal(alphaNow.reviews.compute.by, "Ada")
  assert.equal(approvedRes.json.leaders.compute.available, true, "deciding returns the leader to Available")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "compute" })).status, 409, "an approved team cannot queue again")
  assert.deepEqual(app.getState().queues.compute, [], "an approved team leaves the queue")

  assert.equal((await call(`/api/teams/${b.id}/architect`, { tuning: { precision: "fp8" } })).status, 403, "Architect needs the host's grant")
  await call("/api/host/architect", { team: b.id, enabled: true }, PINS.host)
  const tuned = await call(`/api/teams/${b.id}/architect`, { tuning: { precision: "fp8", continuousBatching: true, bogus: 1 } })
  assert.equal(tuned.status, 200)
  assert.deepEqual(tuned.json.team.architect.tuning, { precision: "fp8", continuousBatching: true })
  assert.equal(tuned.json.team.architect.gain, tuned.json.report.gain)

  await call(`/api/teams/${b.id}/checkin`, { station: "ai" })
  await call(`/api/teams/${b.id}/presence`, { station: "ai", step: "decide" })
  assert.equal((await call("/api/presence")).json.presence[b.id].step, "decide")
  await call(`/api/teams/${b.id}/checkout`, { station: "ai" })
  assert.equal(app.getState().tables.ai, undefined, "Return to home frees the table")
  assert.equal((await call("/api/presence")).json.presence[b.id], undefined)

  assert.equal((await call("/api/host/race", { seed: "test", endClock: true }, PINS.host)).status, 403, "the host also needs the race password")
  assert.equal((await call("/api/host/race", { seed: "test", racePassword: PINS.race }, PINS.host)).status, 409, "no race while the clock runs")
  const race = await call("/api/host/race", { seed: "test", endClock: true, racePassword: PINS.race }, PINS.host)
  assert.equal(race.status, 200)
  assert.equal(race.json.clock.status, "ended")
  assert.equal(race.json.race.result.results.length, 2)
  const alpha = race.json.race.result.results.find((r) => r.id === a.id)
  assert.ok(!alpha.missed.includes("compute"))
  assert.equal(alpha.missed.length, 5)
  assert.equal((await call(`/api/teams/${b.id}/choices`, { choices: { cpu: "grace" } })).status, 409)

  const state = await call(`/api/state?since=${race.json.version}&game=${race.json.id}`)
  assert.equal(state.json.unchanged, true)
  assert.notEqual((await call(`/api/state?since=${race.json.version}&game=other`)).json.unchanged, true, "a different game id forces a full resync")
})

test("PIN-protected routes rate limit repeated failed attempts per client IP", async () => {
  const headers = { "content-type": "application/json", "cf-connecting-ip": "203.0.113.77" }
  for (let i = 0; i < 10; i++) {
    const res = await fetch(base + "/api/login", { method: "POST", headers, body: JSON.stringify({ pin: "wrong" }) })
    assert.equal(res.status, 403)
  }
  const blocked = await fetch(base + "/api/login", { method: "POST", headers, body: JSON.stringify({ pin: PINS.host }) })
  assert.equal(blocked.status, 429)
  assert.match(blocked.headers.get("retry-after") || "", /^\d+$/)
})

test("the game clock: pause, add/remove minutes, expiry locks tables and unfinished tables race on defaults", async () => {
  const setup = await call("/api/host/setup", { teams: [{ name: "Done", rank: 5 }, { name: "Late", rank: 5 }], gameMinutes: 10, visitMinutes: 8 }, PINS.host)
  const [done, late] = setup.json.teams
  assert.equal(setup.json.settings.visitMinutes, 8)
  assert.equal((await call("/api/host/clock", { action: "add", minutes: 5 }, PINS.host)).json.clock.totalMs, 15 * 60_000)
  assert.equal((await call("/api/host/clock", { action: "set", minutes: 2 }, PINS.host)).json.clock.totalMs, 2 * 60_000)
  assert.equal((await call("/api/host/clock", { action: "pause" }, PINS.host)).status, 400)
  await call("/api/host/clock", { action: "start" }, PINS.host)

  const checkin = await call(`/api/teams/${done.id}/checkin`, { station: "network" })
  assert.equal(checkin.status, 200)
  assert.equal(checkin.json.team.visits.network.count, 1)
  await call(`/api/teams/${done.id}/checkin`, { station: "ai" })
  const moved = app.getState()
  assert.equal(moved.tables.ai.team, done.id)
  assert.equal(moved.tables.network, undefined, "checking in elsewhere frees the previous table")

  const sims = [1, 2, 3].map(() => call(`/api/teams/${done.id}/sim`, { station: "ai" }))
  const last = (await Promise.all(sims)).at(-1)
  assert.equal(last.status, 200, "simulation runs are counted, never blocked")
  assert.equal(app.getState().teams[0].sims.ai.visit, 3)
  await call(`/api/teams/${done.id}/checkin`, { station: "compute" })
  await call(`/api/teams/${done.id}/checkin`, { station: "ai" })
  assert.equal((await call(`/api/teams/${done.id}/sim`, { station: "ai" })).json.runs.visit, 1, "a new visit restarts the per-visit count")

  const ai = { platform: "b300", racks: 1, modelSize: "70b", precision: "fp8", hbm: "hbm288" }
  await call(`/api/teams/${done.id}/choices`, { station: "ai", choices: ai })
  await call(`/api/teams/${done.id}/submit`, { station: "ai" })
  await call(`/api/teams/${late.id}/choices`, { station: "ai", choices: ai })

  const paused = await call("/api/host/clock", { action: "pause" }, PINS.host)
  assert.equal(paused.json.clock.status, "paused")
  assert.ok(paused.json.clock.remainingMs > 0)
  assert.equal((await call("/api/host/clock", { action: "add", minutes: 1 }, PINS.host)).json.clock.remainingMs > 60_000, true)
  await call("/api/host/clock", { action: "resume" }, PINS.host)
  assert.equal((await call("/api/host/race", { racePassword: PINS.race }, PINS.host)).status, 409)

  app.getState().clock.endsAt = Date.now() - 1
  const after = await call("/api/state")
  assert.equal(after.json.clock.status, "ended")
  assert.equal(after.json.clock.endedBy, "time")
  assert.deepEqual(after.json.tables, {})
  assert.equal((await call(`/api/teams/${late.id}/choices`, { station: "ai", choices: { tgp: "eco85" } })).status, 409)
  assert.equal((await call(`/api/teams/${late.id}/submit`, { station: "ai" })).status, 409)
  assert.equal((await call(`/api/teams/${late.id}/checkin`, { station: "dc" })).status, 409)
  const lead = (path, body) => call(path, { station: "ai", ...body }, PINS.leader, "ai")
  await lead("/api/leader/availability", { available: true })
  assert.equal((await lead("/api/leader/pitch", { action: "start", team: late.id })).status, 409, "no pitch for a table not locked in before time")
  assert.equal((await lead("/api/leader/pitch", { action: "start", team: done.id })).status, 200, "a plan locked in before time can still be pitched")
  assert.equal((await lead("/api/leader/decide", { team: done.id, decision: "approve" })).status, 200, "and approved")

  const race = await call("/api/host/race", { seed: "clock", racePassword: PINS.race }, PINS.host)
  assert.equal(race.status, 200)
  const rows = Object.fromEntries(race.json.race.result.results.map((r) => [r.id, r]))
  assert.ok(!rows[done.id].missed.includes("ai"))
  assert.ok(rows[late.id].missed.includes("ai"), "chosen but never locked in: the AI table is missed")
  assert.equal(rows[late.id].missed.length, 6)
  assert.ok(rows[done.id].visited >= 3)
  assert.ok(rows[done.id].strategy > rows[late.id].strategy, "the same AI choices count only for the team that locked them in")

  assert.equal((await call("/api/host/clock", { action: "add", minutes: 5 }, PINS.host)).status, 409, "the clock cannot reopen after the race")
  await call("/api/host/unrace", {}, PINS.host)
  const reopened = await call("/api/host/clock", { action: "add", minutes: 5 }, PINS.host)
  assert.equal(reopened.json.clock.status, "running", "the host can re-open an ended clock with extra minutes")
  const ended = await call("/api/host/clock", { action: "end" }, PINS.host)
  assert.equal(ended.json.clock.endedBy, "host")
})

test("state survives a server restart", async () => {
  const setup = await call("/api/host/setup", { teams: [{ name: "Keep A", rank: 3 }, { name: "Keep B", rank: 7 }] }, PINS.host)
  await call("/api/host/clock", { action: "start" }, PINS.host)
  const [a] = setup.json.teams
  await call(`/api/teams/${a.id}/checkin`, { station: "dc" })
  await call(`/api/teams/${a.id}/choices`, { station: "dc", choices: { location: "fra", hall: "L" } })
  await call(`/api/teams/${a.id}/submit`, { station: "dc" })
  const before = app.getState()

  const restarted = createApp({ dataDir: dir, pins: PINS })
  try {
    const again = restarted.getState()
    assert.equal(again.id, before.id)
    assert.equal(again.version, before.version)
    assert.deepEqual(again.teams[0].choices, { location: "fra", hall: "L" })
    assert.ok(again.teams[0].submitted.dc)
    assert.deepEqual(again.teams[0].plans.dc, before.teams[0].plans.dc, "the plan output survives a restart")
    assert.equal(again.tables.dc.team, a.id)
    assert.equal(again.clock.status, "running")
    assert.equal(again.clock.endsAt, before.clock.endsAt, "the clock keeps its absolute end time across a restart")
  } finally {
    restarted.close()
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

test("static files are served and traversal is refused", async () => {
  const res = await fetch(`${base}/station.html`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("x-content-type-options"), "nosniff")
  for (const bad of ["/..%2f..%2fserver.mjs", "/%E0%A4%A", "/../package.json"]) {
    const r = await fetch(base + bad)
    assert.ok([400, 403, 404].includes(r.status), `${bad} → ${r.status}`)
    assert.ok(!(await r.text()).includes("createApp"))
  }
})
