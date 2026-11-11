import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp, DEFAULT_PINS, PIN_NAMES, resolvePins, pinSummary } from "../server.mjs"
import { TEAM_COLORS, TEAM_NAME_MAX, tablePoints, decisionsFor } from "../public/js/catalog.js"
import { boardFor } from "../public/js/model.js"
import { tableStory } from "../public/js/report.js"
import { phaseOf } from "../public/js/session.js"
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
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}
const host = (path, body) => call(path, body, PINS.host)
const addTeam = (name, ip) => call("/api/teams", { name }, null, null, ip)
/** A brand-new empty game (the host's Restart), then teams adding themselves with no PIN. Returns the teams. */
async function newGame(...names) {
  const reset = await host("/api/host/reset", {})
  assert.equal(reset.status, 200)
  const teams = []
  for (const name of names) {
    const made = await addTeam(name)
    assert.equal(made.status, 201, JSON.stringify(made.json))
    teams.push(made.json.team)
  }
  return teams
}
const readBrief = (teamId, station) => call(`/api/teams/${teamId}/brief`, { station })
const tap = (teamId, station, choices) => call(`/api/teams/${teamId}/choices`, { station, choices })
/** Lock all three dials of a table one tap at a time (the reference build); returns the last response. */
async function lockAll(teamId, station) {
  let last
  for (const [key, value] of Object.entries(pick(station))) last = await tap(teamId, station, { [key]: value })
  return last
}
const teamOf = (json, id) => json.teams.find((t) => t.id === id)
const stateNow = async () => (await call("/api/state")).json
const timer = (body) => host("/api/host/timer", body)

test("a fresh game is open at once: with no host action a team adds itself, reads the brief and locks a dial", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-fresh-"))
  const fresh = createApp({ dataDir: other, env: ENV })
  const srv = createServer(fresh.handle)
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${srv.address().port}`
  const post = async (path, body) => {
    const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: res.status, json: await res.json() }
  }
  try {
    const health = await (await fetch(`${url}/api/health`)).json()
    assert.equal(health.phase, "open", "a new game is open, untimed play")
    assert.equal(health.teams, 0)
    const s = fresh.getState()
    assert.equal(s.clock.status, "open")
    assert.equal(s.clock.endsAt, null, "nothing expires")
    assert.equal(s.settings.budget, "standard", "the budget level is Standard with no action needed")
    assert.equal(s.brief, undefined, "the host-run brief phase is gone")
    const made = await post("/api/teams", { name: "  Walk Ins  " })
    assert.equal(made.status, 201)
    assert.equal(made.json.team.name, "Walk Ins", "the name is trimmed")
    assert.equal(made.json.team.id, "t1")
    assert.equal(made.json.team.color, TEAM_COLORS[0])
    for (const key of ["briefRead", "attempts", "previous", "plans", "reviews", "choices"]) assert.deepEqual(made.json.team[key], {}, `a new team has an empty ${key}`)
    assert.equal((await post("/api/teams/t1/checkin", { station: "network" })).status, 200, "check-in needs no host")
    const early = await post("/api/teams/t1/choices", { station: "network", choices: { link: "redundant" } })
    assert.equal(early.status, 409, "the brief gate is the team's own and still server-enforced")
    assert.match(early.json.error, /Read the brief first/)
    assert.equal((await post("/api/teams/t1/brief", { station: "network" })).status, 200)
    assert.equal((await post("/api/teams/t1/choices", { station: "network", choices: { link: "redundant" } })).status, 200, "untimed play accepts choices")
    assert.equal(fresh.getState().teams[0].choices.link, "redundant")
  } finally {
    fresh.close()
    await new Promise((resolve) => srv.close(resolve))
    await rm(other, { recursive: true, force: true })
  }
})

test("self-registration: names are validated and trimmed, duplicates refused whatever the case, colours in order, ten teams at most", async () => {
  await newGame()
  for (const bad of ["", "   ", "\u0000\u0007", null, 7, { name: "x" }, ["x"]]) {
    const res = await addTeam(bad)
    assert.equal(res.status, 400, `${JSON.stringify(bad)} is refused`)
    assert.match(res.json.error, /Type a team name first/)
  }
  const long = await addTeam("x".repeat(TEAM_NAME_MAX + 1))
  assert.equal(long.status, 400)
  assert.match(long.json.error, /32 characters or fewer/)
  assert.equal((await addTeam("y".repeat(TEAM_NAME_MAX))).status, 201, "the limit itself is allowed")
  const odd = await addTeam("  <b>Rack</b>\u0000 &\tRoll\u200b ")
  assert.equal(odd.status, 201)
  assert.equal(odd.json.team.name, "<b>Rack</b> & Roll", "control and invisible characters are stripped, spaces collapsed")
  const first = await addTeam("Photon Racing")
  assert.equal(first.status, 201)
  for (const same of ["Photon Racing", "photon racing", "  PHOTON   RACING "]) {
    const dup = await addTeam(same)
    assert.equal(dup.status, 409, `"${same}" is a duplicate`)
    assert.match(dup.json.error, /already a team called .Photon Racing.\. Pick it from the list/)
  }
  for (let i = 4; i <= 10; i++) assert.equal((await addTeam(`Team ${i}`)).status, 201)
  const s = await stateNow()
  assert.equal(s.teams.length, 10)
  assert.deepEqual(s.teams.map((t) => t.color), TEAM_COLORS, "the ten colours, in order")
  assert.deepEqual(s.teams.map((t) => t.id), Array.from({ length: 10 }, (_, i) => `t${i + 1}`))
  assert.ok(s.teams.every((t) => t.tier === undefined), "no per-team tiers")
  const full = await addTeam("One Too Many")
  assert.equal(full.status, 409)
  assert.match(full.json.error, /All 10 team places are taken/)
  assert.equal((await stateNow()).teams.length, 10)

  /* The host can remove a team (PIN); the freed place and colour go to the next team, with a new id. */
  assert.equal((await call("/api/host/team", { team: "t3", action: "remove" })).status, 403, "removing a team needs the host PIN")
  assert.equal((await host("/api/host/team", { team: "t3", action: "remove" })).status, 200)
  const next = await addTeam("Late Brakers")
  assert.equal(next.status, 201)
  assert.equal(next.json.team.id, "t11", "ids are never reused")
  assert.equal(next.json.team.color, TEAM_COLORS[2], "the freed colour is reused")
})

test("team creation is capped per address, and a restart clears the count", async () => {
  await newGame()
  const ip = "198.51.100.9"
  for (let i = 0; i < 30; i++) {
    const made = await addTeam(`Churn ${i}`, ip)
    assert.equal(made.status, 201, `team ${i}`)
    assert.equal((await host("/api/host/team", { team: made.json.team.id, action: "remove" })).status, 200)
  }
  const capped = await addTeam("Churn 30", ip)
  assert.equal(capped.status, 429)
  assert.match(capped.json.error, /Too many new teams/)
  assert.equal((await addTeam("Elsewhere", "198.51.100.10")).status, 201, "other addresses are unaffected")
  await newGame()
  assert.equal((await addTeam("After restart", ip)).status, 201)
})

test("host team controls: rename (validated like a new name) and remove (queue, seat and live pitch cleared)", async () => {
  const [a, b] = await newGame("Alhpa", "Beta")
  assert.equal((await host("/api/host/team", { team: a.id, action: "rename", name: "beta" })).status, 409, "a rename cannot take another team's name")
  assert.equal((await host("/api/host/team", { team: a.id, action: "rename", name: " " })).status, 400)
  assert.equal((await host("/api/host/team", { team: "t99", action: "rename", name: "X" })).status, 404)
  assert.equal((await host("/api/host/team", { team: a.id, action: "explode" })).status, 400)
  const renamed = await host("/api/host/team", { team: a.id, action: "rename", name: "  Alpha " })
  assert.equal(teamOf(renamed.json, a.id).name, "Alpha")
  assert.equal((await host("/api/host/team", { team: a.id, action: "rename", name: "ALPHA" })).status, 200, "a team may change the case of its own name")
  await call(`/api/teams/${b.id}/checkin`, { station: "dc" })
  await readBrief(b.id, "dc")
  await lockAll(b.id, "dc")
  await call(`/api/teams/${b.id}/call`, { station: "dc" })
  assert.equal((await call("/api/architect/pitch", { station: "dc", action: "start", team: b.id }, PINS.leader, "dc")).status, 200)
  const removed = await host("/api/host/team", { team: b.id, action: "remove" })
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.json.teams.map((t) => t.id), [a.id])
  assert.deepEqual(removed.json.queues.dc, [])
  assert.equal(removed.json.tables.dc, undefined)
  assert.equal(removed.json.pitches.dc, undefined)
  assert.equal(removed.json.architects.dc.available, true)
  assert.equal((await tap(b.id, "dc", { location: "colo" })).status, 404, "a removed team is gone")
})

test("the budget level: Standard by default, the host can change it until the first dial is locked", async () => {
  const [a] = await newGame("Budget")
  assert.equal((await stateNow()).settings.budget, "standard")
  assert.equal((await call("/api/host/budget", { budget: "tight" })).status, 403)
  assert.equal((await host("/api/host/budget", { budget: "infinite" })).status, 400)
  assert.equal((await host("/api/host/budget", { budget: "generous" })).json.settings.budget, "generous")
  await readBrief(a.id, "oem")
  assert.equal((await host("/api/host/budget", { budget: "tight" })).json.settings.budget, "tight", "reading a brief does not fix the budget")
  await tap(a.id, "oem", { vendor: "tier1" })
  const late = await host("/api/host/budget", { budget: "standard" })
  assert.equal(late.status, 409)
  assert.match(late.json.error, /already locked choices on the Tight budget/)
  assert.equal((await host("/api/host/budget", { budget: "tight" })).status, 200, "setting the level it already has is fine")
})

test("the timer is optional: start, pause, resume, add and remove minutes, expiry locks the tables, reset reopens untimed play", async () => {
  const [a] = await newGame("Timed")
  await readBrief(a.id, "network")
  assert.equal(phaseOf(await stateNow()), "open")
  assert.equal((await timer({ action: "pause" })).status, 409, "nothing to pause without a timer")
  assert.equal((await timer({ action: "add", minutes: 5 })).status, 409, "nothing to add to without a timer")
  for (const minutes of [0, -5, 1.5, 121, "soon", true, [35]]) assert.equal((await timer({ action: "start", minutes })).status, 400, `${JSON.stringify(minutes)} minutes is refused`)
  assert.equal((await timer({ action: "explode" })).status, 400)

  const started = await timer({ action: "start" })
  assert.equal(started.status, 200)
  assert.equal(started.json.clock.status, "running")
  assert.equal(started.json.clock.totalMs, 35 * 60_000, "35 minutes by default")
  assert.ok(Math.abs(started.json.clock.endsAt - started.json.now - 35 * 60_000) < 2000)
  assert.equal(phaseOf(started.json), "play")
  assert.equal((await call("/api/health")).json.phase, "play")
  assert.equal((await tap(a.id, "network", { link: "redundant" })).status, 200, "timed play accepts choices")

  const paused = await timer({ action: "pause" })
  assert.equal(paused.json.clock.status, "paused")
  assert.equal(paused.json.clock.endsAt, null)
  assert.ok(paused.json.clock.remainingMs > 34 * 60_000)
  assert.equal(phaseOf(paused.json), "paused")
  assert.equal((await timer({ action: "pause" })).status, 409)
  assert.equal((await tap(a.id, "network", { path: "crossconnect" })).status, 200, "tables stay open while the timer is paused")
  const more = await timer({ action: "add", minutes: 5 })
  assert.ok(Math.abs(more.json.clock.remainingMs - paused.json.clock.remainingMs - 5 * 60_000) < 5, "+5 min while paused")
  const resumed = await timer({ action: "resume" })
  assert.equal(resumed.json.clock.status, "running")
  assert.equal(resumed.json.clock.remainingMs, null)
  assert.equal((await timer({ action: "resume" })).status, 409)
  const less = await timer({ action: "add", minutes: -1 })
  assert.ok(Math.abs(resumed.json.clock.endsAt - less.json.clock.endsAt - 60_000) < 5, "−1 min while running")
  assert.equal((await timer({ action: "add", minutes: 0 })).status, 400)
  assert.equal((await timer({ action: "add", minutes: 2.5 })).status, 400)

  const restarted = await timer({ action: "start", minutes: 10 })
  assert.equal(restarted.json.clock.totalMs, 10 * 60_000, "Start timer again sets a new length")
  const cut = await timer({ action: "add", minutes: -30 })
  assert.equal(cut.json.clock.status, "ended", "removing more than is left ends play")
  assert.equal((await timer({ action: "start", minutes: 20 })).json.clock.status, "running", "Start timer reopens play")

  /* Expiry: the server ends play when the timer reaches zero. */
  app.getState().clock.endsAt = Date.now() - 1
  const expired = await stateNow()
  assert.equal(expired.clock.status, "ended")
  assert.equal(expired.clock.endedBy, "time")
  assert.equal(phaseOf(expired), "ended")
  const locked = await tap(a.id, "network", { garage: pick("network").garage })
  assert.equal(locked.status, 409)
  assert.match(locked.json.error, /Time is up/)
  const late = await addTeam("Too Late")
  assert.equal(late.status, 409, "no new teams once time is up")
  assert.match(late.json.error, /Time is up/)
  assert.equal((await timer({ action: "add", minutes: -1 })).status, 409)
  assert.equal((await timer({ action: "add", minutes: 2 })).json.clock.status, "running", "adding minutes reopens play")
  app.getState().clock.endsAt = Date.now() - 1
  assert.equal((await stateNow()).clock.status, "ended")

  const reset = await timer({ action: "reset" })
  assert.equal(reset.json.clock.status, "open")
  assert.equal(reset.json.clock.endsAt, null)
  assert.equal(reset.json.clock.endedAt, null)
  assert.equal(phaseOf(reset.json), "open")
  assert.equal((await tap(a.id, "network", { garage: pick("network").garage })).status, 200, "Reset timer reopens play, untimed")
  assert.equal((await addTeam("In Time")).status, 201)
  app.getState().clock.endsAt = Date.now() - 1
  assert.equal((await stateNow()).clock.status, "open", "an open session never expires")
})

test("every host and SA route needs its PIN; team routes do not; a PIN never appears in a response", async () => {
  const [a] = await newGame("Guarded")
  const hostRoutes = [
    ["/api/host/timer", { action: "start", minutes: 5 }],
    ["/api/host/timer", { action: "reset" }],
    ["/api/host/race", {}],
    ["/api/host/readout", {}],
    ["/api/host/unrace", {}],
    ["/api/host/reset", {}],
    ["/api/host/budget", { budget: "generous" }],
    ["/api/host/team", { team: a.id, action: "rename", name: "Hijacked" }],
    ["/api/host/team", { team: a.id, action: "remove" }],
    ["/api/host/queue", { station: "network", action: "clear" }],
  ]
  let n = 0
  for (const [path, body] of hostRoutes) {
    for (const pin of [null, "wrong", PINS.leader, PINS.race]) {
      const res = await call(path, body, pin, null, `192.0.2.${++n}`)
      assert.equal(res.status, 403, `${path} ${JSON.stringify(body)} with ${pin || "no PIN"}`)
      assert.match(res.json.error, /Host PIN required/)
    }
  }
  for (const [path, body] of [["/api/architect/availability", { station: "dc", available: true }], ["/api/architect/pitch", { station: "dc", action: "start", team: a.id }], ["/api/architect/decide", { station: "dc", team: a.id, decision: "approve" }]]) {
    assert.equal((await call(path, body, null, "dc", `192.0.2.${++n}`)).status, 403, `${path} with no PIN`)
    assert.equal((await call(path, body, PINS.race, "dc", `192.0.2.${++n}`)).status, 403, `${path} with the wrong PIN`)
    assert.equal((await call(path, body, PINS.leader, "oem", `192.0.2.${++n}`)).status, 403, `${path} from another table's SA`)
  }
  assert.equal((await call("/api/race/run", { password: PINS.host }, null, null, `192.0.2.${++n}`)).status, 403, "the projector needs the race password")
  assert.equal((await call("/api/race/run", {}, null, null, `192.0.2.${++n}`)).status, 403)
  const after = await stateNow()
  assert.deepEqual(after.teams.map((t) => t.name), ["Guarded"], "nothing changed")
  assert.equal(after.clock.status, "open")
  assert.equal(after.settings.budget, "standard")
  assert.equal(after.race, null)

  /* Team actions carry no PIN at all. */
  assert.equal((await call(`/api/teams/${a.id}/checkin`, { station: "dc" })).status, 200)
  assert.equal((await readBrief(a.id, "dc")).status, 200)
  assert.equal((await lockAll(a.id, "dc")).status, 200)
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "dc" })).status, 200)
  assert.equal((await call(`/api/teams/${a.id}/presence`, { station: "dc", step: "pitch" })).status, 200)

  /* No response carries a PIN: the state, health, a good login, a bad login. */
  const login = await call("/api/login", { pin: PINS.host })
  const bad = await call("/api/login", { pin: "nope" }, null, null, `192.0.2.${++n}`)
  for (const res of [await call("/api/state"), await call("/api/health"), await call("/api/presence"), login, bad, await host("/api/host/timer", { action: "reset" })]) {
    for (const pin of [...Object.values(PINS), ...Object.values(DEFAULT_PINS)]) assert.ok(!res.text.includes(pin), "a response carries a PIN value")
  }
})

test("the brief gate: the server refuses choices at a table until that team has read that table's brief", async () => {
  const [a] = await newGame("Gate")
  const refused = await tap(a.id, "oem", { vendor: "tier1" })
  assert.equal(refused.status, 409)
  assert.match(refused.json.error, /Read the brief first/)
  assert.deepEqual(teamOf(await stateNow(), a.id).choices, {}, "nothing was stored")
  const read = await readBrief(a.id, "oem")
  assert.equal(read.status, 200)
  assert.ok(read.json.team.briefRead.oem > 0)
  assert.equal(read.json.team.briefRead.dc, undefined, "the flag is per team and per table")
  assert.equal((await tap(a.id, "oem", { vendor: "tier1" })).status, 200, "the same tap is accepted once the brief is read")
  assert.equal((await tap(a.id, "dc", { location: "colo" })).status, 409, "another table still needs its own brief")
  assert.equal((await readBrief(a.id, "nope")).status, 400)
})

test("one-shot choices: the first tap locks a dial, the server refuses any change, three locks make the plan", async () => {
  const [a] = await newGame("Alpha", "Beta")
  await readBrief(a.id, "network")
  const first = await tap(a.id, "network", { link: "redundant" })
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.locked, ["link"])
  assert.equal(first.json.plan, null)
  assert.equal(first.json.attempts, 0)
  const again = await tap(a.id, "network", { link: "single" })
  assert.equal(again.status, 409, "a locked dial cannot change")
  assert.match(again.json.error, /locked/i)
  assert.equal(teamOf(await stateNow(), a.id).choices.link, "redundant", "the first pick stands")
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

test("pitch, rejection and approval: a rejection reopens only that team at that table and counts attempts; the race runs at any time", async () => {
  const [a, b] = await newGame("Alpha", "Beta")
  for (const t of [a, b]) for (const station of ["network", "oem"]) await readBrief(t.id, station)
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).status, 409, "lock all three before calling the SA")
  await lockAll(a.id, "network")
  await lockAll(a.id, "oem")
  await lockAll(b.id, "network")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "network" })).json.position, 1)
  assert.equal((await call(`/api/teams/${b.id}/call`, { station: "network" })).json.position, 2)

  assert.equal((await stateNow()).architects.network, undefined, "no SA has signed in yet")
  const login = await call("/api/login", { pin: PINS.leader, station: "network" })
  assert.deepEqual(login.json, { role: "architect", station: "network" })
  assert.equal((await stateNow()).architects.network.available, true, "signing in makes the SA Available: no toggle needed")
  assert.equal((await call("/api/login", { pin: PINS.leader })).status, 400, "a Solutions Architect must pick a table")
  const arch = (path, body, station = "network") => call(path, { station: "network", ...body }, PINS.leader, station)
  assert.equal((await arch("/api/architect/availability", { available: true }, "dc")).status, 403, "an SA only acts for their own table")
  assert.equal((await call("/api/architect/availability", { station: "network", available: true }, "nope", "network")).status, 403)
  assert.equal((await arch("/api/architect/availability", { available: false })).status, 200, "the toggle still exists")
  const pitch = await arch("/api/architect/pitch", { action: "start", team: a.id, by: "Sam" })
  assert.equal(pitch.status, 200, "Available is not a prerequisite for starting a pitch")
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
  assert.equal((await host("/api/host/readout", {})).status, 409, "no readouts before the race")
  assert.equal(phaseOf(await stateNow()), "open", "no timer has run")
  const race = await host("/api/host/race", { seed: "gate" })
  assert.equal(race.status, 200, "the host runs the race at any time, with no timer")
  assert.equal(race.json.clock.status, "ended", "running the race ends play")
  assert.equal(race.json.clock.endedBy, "host")
  const rows = Object.fromEntries(race.json.race.result.results.map((r) => [r.id, r]))
  assert.equal(rows[a.id].pitch, approved.pitch.network, "only the approved table scores")
  assert.deepEqual(rows[a.id].notApproved.sort(), ["dc", "oem"], "locked but not approved tables race on today's setup")
  assert.equal(rows[b.id].pitch, 0)
  assert.equal((await host("/api/host/race", { seed: "again" })).status, 409, "the race runs once until it is cleared")
  assert.equal((await call("/api/race/run", { password: PINS.race })).status, 409)
  assert.equal((await tap(b.id, "oem", { vendor: "tier1" })).status, 409, "the race locks every table")
  assert.equal((await addTeam("After The Flag")).status, 409)
  assert.equal((await timer({ action: "start" })).status, 409, "no timer once the race has run")
  assert.equal((await timer({ action: "reset" })).status, 409)
  assert.equal((await host("/api/host/team", { team: b.id, action: "remove" })).status, 409, "the result names the teams")
  assert.equal((await call("/api/health")).json.phase, "race")
  const readout = await host("/api/host/readout", {})
  assert.ok(readout.json.readout.startedAt > 0)
  assert.equal(readout.json.readout.endsAt, undefined, "readouts have no countdown")
  assert.equal((await call("/api/health")).json.phase, "readout")

  const cleared = await host("/api/host/unrace", {})
  assert.equal(cleared.json.race, null)
  assert.equal(cleared.json.readout, null)
  assert.equal(cleared.json.clock.status, "open", "clearing the race reopens play, untimed")
  assert.equal((await tap(b.id, "oem", { vendor: "tier1" })).status, 200)
  assert.equal(teamOf(await stateNow(), a.id).reviews.network.status, "approved", "approvals survive clearing the race")
})

test("the projector runs the race with the race password, during a running timer, and an empty game has nothing to race", async () => {
  await newGame()
  const empty = await call("/api/race/run", { password: PINS.race })
  assert.equal(empty.status, 400)
  assert.match(empty.json.error, /No teams yet/)
  assert.equal((await host("/api/host/race", {})).status, 400)
  assert.equal((await addTeam("Solo")).status, 201)
  await timer({ action: "start", minutes: 15 })
  const race = await call("/api/race/run", { password: PINS.race, seed: "projector" })
  assert.equal(race.status, 200)
  assert.equal(race.json.race.ranBy, "race screen")
  assert.equal(race.json.clock.status, "ended")
  assert.equal(race.json.race.result.results.length, 1)
  await host("/api/host/unrace", {})
})

test("time up: a table still adjusting after a rejection races on today's setup, and the readout explains", async () => {
  const [a] = await newGame("Late")
  await readBrief(a.id, "dc")
  await lockAll(a.id, "dc")
  const arch = (path, body) => call(path, { station: "dc", ...body }, PINS.leader, "dc")
  await call(`/api/teams/${a.id}/call`, { station: "dc" })
  await arch("/api/architect/pitch", { action: "start", team: a.id })
  await arch("/api/architect/decide", { team: a.id, decision: "reject", reason: "No N+1" })
  assert.equal((await tap(a.id, "dc", { location: "colo" })).status, 200, "one dial relocked: adjusting")
  await timer({ action: "start", minutes: 1 })
  app.getState().clock.endsAt = Date.now() - 1
  assert.equal((await tap(a.id, "dc", { cooling: "liquid" })).status, 409, "time is up")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "dc" })).status, 409, "no plan to pitch")
  const team = teamOf(await stateNow(), a.id)
  const story = tableStory(team, "dc")
  assert.equal(story.status, "rejected")
  assert.match(story.text, /Rejected on the first attempt \("No N\+1"\) and still adjusting when time ran out, so this table raced on today's setup/)
  const race = await host("/api/host/race", { seed: "late" })
  const row = race.json.race.result.results.find((r) => r.id === a.id)
  assert.ok(row.notApproved.includes("dc"), "the table was tried but not approved: it races on today's setup")
  assert.equal(row.pitch, 0)
  assert.equal(row.found, 0, "nothing found: today's setup at every table")
  await host("/api/host/unrace", {})
})

test("a plan locked before time ran out can still be pitched and approved after it", async () => {
  const [a, b] = await newGame("Just", "Missed")
  await readBrief(a.id, "compute")
  await readBrief(b.id, "compute")
  await lockAll(a.id, "compute")
  await tap(b.id, "compute", { size: "medium" })
  await timer({ action: "start", minutes: 1 })
  app.getState().clock.endsAt = Date.now() - 1
  assert.equal((await stateNow()).clock.status, "ended")
  assert.equal((await call(`/api/teams/${a.id}/call`, { station: "compute" })).status, 200, "the queue stays open for a plan locked in time")
  assert.equal((await call(`/api/teams/${b.id}/call`, { station: "compute" })).status, 409, "a table that was not locked in time has nothing to pitch")
  const arch = (path, body) => call(path, { station: "compute", ...body }, PINS.leader, "compute")
  assert.equal((await arch("/api/architect/pitch", { action: "start", team: a.id })).status, 200)
  const ok = await arch("/api/architect/decide", { team: a.id, decision: "approve" })
  assert.equal(teamOf(ok.json, a.id).reviews.compute.status, "approved")
})

test("the approval gate scores FIT: an approved over-cap board earns far less than an in-zone one; tuning is logged", async () => {
  const [zone, over] = await newGame("Zone", "Over")
  for (const t of [zone, over]) await readBrief(t.id, "oem")
  await lockAll(zone.id, "oem")
  for (const [k, v] of Object.entries({ vendor: "dgx", payment: "buy", support: "4h" })) await tap(over.id, "oem", { [k]: v })
  const sim = await call(`/api/teams/${zone.id}/sim`, { station: "oem" })
  assert.equal(sim.json.runs.inZone, true)
  assert.ok(sim.json.runs.firstZoneAt > 0 && sim.json.runs.lastFit >= 80, "the host feed sees the latest FIT")
  const arch = (path, body) => call(path, { station: "oem", ...body }, PINS.leader, "oem")
  const points = {}
  for (const t of [zone, over]) {
    const plan = teamOf(await stateNow(), t.id).plans.oem
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
  await newGame("A")
  for (const path of ["/api/host/setup", "/api/host/phase", "/api/host/architect", "/api/leader/architect", "/api/teams/t1/architect", "/api/host/clock", "/api/teams/t1/submit"]) {
    assert.equal((await call(path, {}, PINS.host)).status, 404, path)
  }
  for (const old of ["ai", "storage", "governance"]) assert.equal((await call("/api/teams/t1/choices", { station: old, choices: {} })).status, 400, `${old} is not a table`)
  assert.equal((await call("/api/login", { pin: PINS.leader, station: "ai" })).status, 400)
})

test("PINs: one event PIN by default, the environment may override, and nothing in the saved game can set one", async () => {
  const eventPin = DEFAULT_PINS.host
  assert.match(eventPin, /^[A-Za-z0-9_-]{4,64}$/)
  assert.deepEqual(DEFAULT_PINS, { host: eventPin, leader: eventPin, race: eventPin }, "one PIN for every role by default")
  assert.deepEqual(PIN_NAMES, { host: "HOST_PIN", leader: "LEADER_PIN", race: "RACE_PIN" })
  assert.deepEqual(resolvePins({}), DEFAULT_PINS)
  assert.deepEqual(resolvePins({ HOST_PIN: "h1" }), { host: "h1", leader: eventPin, race: eventPin })
  const summary = pinSummary({ HOST_PIN: "secret-value" })
  assert.match(summary, /HOST_PIN \(from the environment\)/)
  assert.match(summary, /LEADER_PIN \(default\)/)
  assert.ok(!summary.includes("secret-value") && !summary.includes(eventPin), "the summary never carries a PIN value")

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
      assert.equal((await (await post({ pin: eventPin })).json()).role, "host", "the event PIN with no table signs the host in")
      assert.deepEqual(await (await post({ pin: eventPin, station: "dc" })).json(), { role: "architect", station: "dc" }, "the event PIN with a table signs the Solutions Architect in, scoped to that table")
      assert.equal((await post({ pin: eventPin, station: "ai" })).status, 400, "a retired table is refused")
      const sa = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json", "x-pin": eventPin }, body: JSON.stringify({ pin: eventPin, station: "dc" }) })
      assert.equal((await sa.json()).role, "architect")
      const raced = await fetch(`${url}/api/race/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: eventPin }) })
      assert.equal(raced.status, 400, "the race password is accepted (no teams yet is the only complaint)")
      const text = await (await fetch(`${url}/api/state`)).text()
      assert.ok(!text.includes(eventPin) && !text.includes("evil"), "the state never carries a PIN")
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
  assert.equal((await call("/api/host/timer", { action: "start" }, PINS.host, null, ip)).status, 429, "the timer is behind the same limit")
  assert.equal((await call("/api/login", { pin: PINS.host }, null, null, "203.0.113.78")).status, 200, "other clients are unaffected")
  assert.equal((await addTeam("Not Limited", ip)).status === 429, false, "joining as a team is not a PIN route")
})

test("state survives a server restart", async () => {
  const [a] = await newGame("Keep A", "Keep B")
  await timer({ action: "start", minutes: 20 })
  await call(`/api/teams/${a.id}/checkin`, { station: "dc" })
  await readBrief(a.id, "dc")
  await tap(a.id, "dc", { location: "colo" })
  await tap(a.id, "dc", { cooling: "liquid" })
  const before = app.getState()
  const restarted = createApp({ dataDir: dir, env: ENV })
  try {
    const again = restarted.getState()
    assert.equal(again.id, before.id)
    assert.deepEqual(again.teams.map((t) => [t.id, t.name, t.color]), before.teams.map((t) => [t.id, t.name, t.color]))
    assert.equal(again.teamSeq, 2)
    assert.deepEqual(again.teams[0].choices, { location: "colo", cooling: "liquid" })
    assert.equal(again.teams[0].plans.dc, undefined, "two locks are not a plan")
    assert.ok(again.teams[0].briefRead.dc > 0)
    assert.equal(again.tables.dc.team, a.id)
    assert.equal(again.clock.status, "running")
    assert.equal(again.clock.endsAt, before.clock.endsAt)
  } finally {
    restarted.close()
  }
})

test("an old save migrates: locked plans become three locks (attempt 1), sent back becomes rejected, pins are dropped", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-old-"))
  try {
    const plan = { id: "OLD01", station: "network", at: 1000, budget: "standard", choices: pick("network"), fit: 90, status: "zone", inZone: true, decisions: [], board: { seconds: 0.3, values: {} } }
    const endsAt = Date.now() + 60_000
    await writeFile(join(other, "state.json"), JSON.stringify({
      id: "old", version: 9, settings: { stations: ["compute", "ai", "storage", "network", "oem"], gameMinutes: 90, briefMinutes: 5, playMinutes: 35 }, clock: { status: "running", endsAt }, pins: { host: "x" },
      teams: [
        { id: "t1", name: "Old", rank: 3, choices: { cpu: "grace", link: "redundant" }, architect: { enabled: true } },
        { id: "t2", name: "Locked", choices: { ...pick("network"), ...pick("oem") }, plans: { network: plan }, submitted: { network: 1000 }, reviews: { network: { status: "approved", by: "A", at: 2000, points: 25 }, oem: { status: "sentBack", by: "B", at: 3000, reason: "Again" } }, pitch: { network: 25 } },
      ],
    }))
    const old = createApp({ dataDir: other, env: {} })
    old.close()
    const s = old.getState()
    assert.equal(s.pins, undefined)
    assert.deepEqual(s.settings, { budget: "standard", stations: ["compute", "network", "oem"] }, "the session plan's minutes are gone")
    assert.equal(s.clock.status, "running", "a running timer carries on")
    assert.equal(s.clock.endsAt, endsAt)
    assert.equal(s.teamSeq, 2)
    const [t1, t2] = s.teams
    assert.deepEqual(t1.choices, { link: "redundant" })
    assert.equal(t1.color, TEAM_COLORS[0], "a team saved without a colour gets one")
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

test("a save from the host-run game migrates: lobby, brief and brief-over become open untimed play, keeping teams, choices, plans, reviews, attempts and a finished race", async () => {
  const other = await mkdtemp(join(tmpdir(), "podium-phases-"))
  const plan = { id: "KEEP1", station: "network", at: 1000, budget: "tight", choices: pick("network"), fit: 90, status: "zone", inZone: true, decisions: [], board: { seconds: 0.3, values: {} } }
  const teams = () => [
    { id: "t1", name: "Scuderia Silicon", color: "#e10600", choices: { ...pick("network"), vendor: "tier1" }, touched: { network: 900, oem: 950 }, submitted: { network: 1000 }, scores: { network: { total: 25, at: 2000 } }, pitch: { network: 25 }, visits: {}, sims: {},
      plans: { network: plan }, reviews: { network: { status: "approved", by: "Sam", at: 2000, points: 25, attempt: 2 } }, briefRead: { network: 800, oem: 940 }, attempts: { network: 2 }, previous: { network: { link: "single" } } },
    { id: "t2", name: "Photon Racing", color: "#00a3ff", choices: {}, touched: {}, submitted: {}, scores: {}, pitch: {}, visits: {}, sims: {}, plans: {}, reviews: {}, briefRead: {}, attempts: {}, previous: {} },
  ]
  const settings = { briefMinutes: 5, playMinutes: 35, raceMinutes: 1, readoutMinutes: 9, budget: "tight", stations: ["network", "oem", "dc", "compute"] }
  const lobbyClock = { status: "lobby", totalMs: 35 * 60_000, endsAt: null, remainingMs: null, endedAt: null, endedBy: null }
  const load = async (saved) => {
    await writeFile(join(other, "state.json"), JSON.stringify({ id: "host-run", version: 41, settings, readout: null, tables: {}, queues: { network: [] }, architects: {}, pitches: {}, race: null, ...saved, teams: teams() }))
    const loaded = createApp({ dataDir: other, env: ENV })
    return loaded
  }
  try {
    const old = { lobby: { status: "idle", endsAt: null }, brief: { status: "running", startedAt: Date.now(), endsAt: Date.now() + 240_000 }, briefDone: { status: "done", endsAt: Date.now() - 5 } }
    for (const [phase, brief] of Object.entries(old)) {
      const loaded = await load({ brief, clock: lobbyClock })
      const s = loaded.getState()
      try {
        assert.equal(phaseOf(s), "open", `${phase} becomes open play`)
        assert.deepEqual(s.clock, { status: "open", totalMs: 0, endsAt: null, remainingMs: null, endedAt: null, endedBy: null, pausedAt: null }, `${phase}: no timer`)
        assert.equal(s.brief, undefined, "the host-run brief is dropped")
        assert.deepEqual(s.settings, { budget: "tight", stations: ["network", "oem", "dc", "compute"] }, "the budget level is kept")
        assert.equal(s.id, "host-run")
        assert.equal(s.version, 41)
        assert.equal(s.teamSeq, 2, "the next team to add itself is t3")
        const [t1, t2] = s.teams
        assert.deepEqual([t1.id, t1.name, t1.color, t2.id, t2.name, t2.color], ["t1", "Scuderia Silicon", "#e10600", "t2", "Photon Racing", "#00a3ff"])
        assert.deepEqual(t1.choices, { ...pick("network"), vendor: "tier1" })
        assert.deepEqual(t1.plans.network, plan)
        assert.deepEqual(t1.reviews.network, { status: "approved", by: "Sam", at: 2000, points: 25, attempt: 2 })
        assert.deepEqual(t1.attempts, { network: 2 })
        assert.deepEqual(t1.previous, { network: { link: "single" } })
        assert.deepEqual(t1.briefRead, { network: 800, oem: 940 })
        assert.equal(t1.pitch.network, 25)
      } finally {
        loaded.close()
      }
    }

    /* The migrated game is playable with no host action: the old team locks another dial, and a new team joins as t3. */
    const loaded = await load({ brief: old.brief, clock: lobbyClock })
    const srv = createServer(loaded.handle)
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve))
    const url = `http://127.0.0.1:${srv.address().port}`
    const post = async (path, body) => {
      const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      return { status: res.status, json: await res.json() }
    }
    try {
      assert.equal((await post("/api/teams/t1/choices", { station: "oem", choices: { payment: "lease" } })).status, 200)
      const joined = await post("/api/teams", { name: "Walk Ins" })
      assert.equal(joined.status, 201)
      assert.equal(joined.json.team.id, "t3")
      assert.equal(joined.json.team.color, TEAM_COLORS[2])
    } finally {
      loaded.close()
      await new Promise((resolve) => srv.close(resolve))
    }

    /* A finished race, mid-readout: the result and the readout survive, and play stays closed until the race is cleared. */
    const race = { seed: "old-race", ranAt: 5000, ranBy: "host", budget: "tight", result: { results: [{ id: "t1", position: 1 }, { id: "t2", position: 2 }], standings: [{ id: "t1" }, { id: "t2" }], events: [] } }
    const raced = await load({ brief: { status: "done", endsAt: 100 }, clock: { ...lobbyClock, status: "ended", remainingMs: 0, endedAt: 4000, endedBy: "host" }, race, readout: { startedAt: 6000, endsAt: 6000 + 9 * 60_000 } })
    try {
      const s = raced.getState()
      assert.deepEqual(s.race, race, "the finished race is kept as it was")
      assert.deepEqual(s.readout, { startedAt: 6000 }, "the readout carries on, without its countdown")
      assert.equal(phaseOf(s), "readout")
      assert.equal(s.clock.status, "ended")
      assert.equal(s.clock.endedAt, 4000)
      assert.deepEqual(s.teams[0].plans.network, plan)
    } finally {
      raced.close()
    }

    /* Time was up but the race had not run: it stays "time is up" (a plan locked in time can still be pitched). */
    const ended = await load({ brief: { status: "done", endsAt: 100 }, clock: { ...lobbyClock, status: "ended", remainingMs: 0, endedAt: 4000, endedBy: "time" } })
    try {
      assert.equal(phaseOf(ended.getState()), "ended")
      assert.equal(ended.getState().clock.endedAt, 4000)
    } finally {
      ended.close()
    }

    /* A paused timer stays paused with its time. */
    const paused = await load({ brief: { status: "done", endsAt: 100 }, clock: { ...lobbyClock, status: "paused", remainingMs: 61_000, pausedAt: 3000 } })
    try {
      assert.equal(phaseOf(paused.getState()), "paused")
      assert.equal(paused.getState().clock.remainingMs, 61_000)
    } finally {
      paused.close()
    }
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
    assert.equal(fresh.getState().clock.status, "open")
    assert.ok((await readdir(other)).some((name) => name.startsWith("state.json.damaged-")))
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})

test("reset returns to an empty, open game; static files are served; traversal is refused", async () => {
  const [a] = await newGame("Soon Gone")
  await host("/api/host/budget", { budget: "generous" })
  await timer({ action: "start", minutes: 5 })
  const beforeId = (await stateNow()).id
  assert.equal((await call("/api/host/reset", {}, "nope")).status, 403)
  const reset = await host("/api/host/reset", {})
  assert.equal(reset.json.teams.length, 0)
  assert.equal(reset.json.clock.status, "open", "a reset game is open for play, untimed")
  assert.equal(reset.json.settings.budget, "standard")
  assert.notEqual(reset.json.id, beforeId, "a new game id tells every iPad to forget its team")
  assert.equal((await call("/api/health")).json.phase, "open")
  assert.equal((await tap(a.id, "dc", { location: "colo" })).status, 404)
  const again = await addTeam("First Again")
  assert.equal(again.json.team.id, "t1")
  for (const page of ["/", "/station.html", "/host.html", "/race.html", "/js/station.js", "/css/app.css"]) {
    const res = await fetch(base + page)
    assert.equal(res.status, 200, page)
    assert.equal(res.headers.get("x-content-type-options"), "nosniff")
  }
  for (const bad of ["/..%2f..%2fserver.mjs", "/%E0%A4%A", "/../package.json"]) {
    const r = await fetch(base + bad)
    assert.ok([400, 403, 404].includes(r.status), `${bad} → ${r.status}`)
    assert.ok(!(await r.text()).includes("createApp"))
  }
})
