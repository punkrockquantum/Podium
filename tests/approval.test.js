import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as C from "../public/js/catalog.js"
import { evaluate, effectiveTeam } from "../public/js/model.js"
import { REFERENCE_BUILD } from "../public/js/sim.js"
import { runRace, RACE_SECONDS, LAPS, systemScore } from "../public/js/race.js"
import { designStatus, approvalGrid, PITCH_SECONDS, PITCH_MS } from "../public/js/approval.js"
import { designSummary } from "../public/js/summary.js"
import { podium, suggestionsFor } from "../public/js/report.js"
import { DEMO_STEPS, buildDemo } from "../public/js/demo.js"
import { createApp, DEFAULT_PINS } from "../server.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const IDS = C.STATIONS.map((s) => s.id)
const PINS = { host: "host-a", leader: "lead-a", race: "race-a" }
const approvedAt = (ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: "Leader" }]))

let server
let base
let dir
let app

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "podium-approval-"))
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

async function freshGame(names = ["Alpha", "Bravo"]) {
  const setup = await call("/api/host/setup", { teams: names.map((name) => ({ name, rank: 5 })), gameMinutes: 30 }, PINS.host)
  await call("/api/host/clock", { action: "start" }, PINS.host)
  return setup.json.teams
}

test("leader login picks one table, and a leader is scoped to it", async () => {
  const [a] = await freshGame()
  assert.equal((await call("/api/login", { pin: PINS.leader })).status, 400, "a leader must pick a table")
  assert.equal((await call("/api/login", { pin: PINS.leader, station: "nowhere" })).status, 400)
  assert.deepEqual((await call("/api/login", { pin: PINS.leader, station: "dc" })).json, { role: "leader", station: "dc" })
  assert.equal((await call("/api/login", { pin: PINS.host })).json.role, "host")
  assert.equal((await call("/api/login", { pin: "nope", station: "dc" })).status, 403)

  for (const [path, body] of [["/api/host/clock", { action: "pause" }], ["/api/host/setup", { teams: [{ name: "X" }, { name: "Y" }] }], ["/api/host/race", { racePassword: PINS.race }], ["/api/host/reset", {}], ["/api/host/architect", { team: a.id, enabled: true }]]) {
    assert.equal((await call(path, body, PINS.leader, "dc")).status, 403, `${path} is host-only`)
  }
  assert.equal((await call("/api/leader/availability", { station: "dc", available: true }, PINS.leader)).status, 403, "no table header")
  assert.equal((await call("/api/leader/availability", { station: "ai", available: true }, PINS.leader, "dc")).status, 403, "another table")
  assert.equal((await call("/api/leader/availability", { station: "dc", available: true }, PINS.leader, "dc")).status, 200)
  assert.equal((await call("/api/leader/availability", { station: "ai", available: true }, PINS.host)).status, 200, "the host may act for any table")
  assert.equal((await call(`/api/teams/${a.id}/unlock`, { station: "ai" }, PINS.leader, "dc")).status, 403, "unlock is scoped too")
})

test("the 30-second pitch: start, status, Busy, decide, Available; send back lets the team revise and re-pitch", async () => {
  const [a, b] = await freshGame()
  const lead = (path, body) => call(path, { station: "dc", ...body }, PINS.leader, "dc")
  await call(`/api/teams/${a.id}/choices`, { station: "dc", choices: { location: "fra", hall: "L" } })
  let s = app.getState()
  assert.equal(designStatus(s, s.teams[0], "dc").status, "draft")
  await call(`/api/teams/${a.id}/submit`, { station: "dc" })
  s = app.getState()
  assert.equal(designStatus(s, s.teams[0], "dc").status, "locked")
  await call(`/api/teams/${a.id}/call`, { station: "dc" })
  s = app.getState()
  assert.equal(designStatus(s, s.teams[0], "dc").label, "Waiting for leader")

  assert.equal((await lead("/api/leader/pitch", { action: "start", team: a.id })).status, 409, "the leader must be Available to start")
  await lead("/api/leader/availability", { available: true })
  assert.equal((await lead("/api/leader/pitch", { action: "start", team: b.id })).status, 409, "a team must lock in before pitching")
  const started = await lead("/api/leader/pitch", { action: "start", team: a.id, by: "Grace" })
  assert.equal(started.status, 200)
  const pitch = started.json.pitches.dc
  assert.equal(pitch.endsAt - pitch.startedAt, PITCH_MS)
  assert.equal(PITCH_SECONDS, 30)
  assert.equal(started.json.leaders.dc.available, false, "Busy while pitching")
  assert.equal(designStatus(started.json, started.json.teams[0], "dc").label, "Pitching")
  assert.equal((await lead("/api/leader/availability", { available: true })).status, 409, "cannot go Available mid-pitch")
  assert.equal((await lead("/api/leader/pitch", { action: "start", team: a.id })).status, 409, "one pitch at a time")
  assert.equal((await lead("/api/leader/decide", { team: a.id, decision: "maybe" })).status, 400)

  const reason = `Add a power cap\u0007 ${"x".repeat(300)}`
  const back = await lead("/api/leader/decide", { team: a.id, decision: "sendBack", reason })
  assert.equal(back.status, 200)
  const alpha = back.json.teams[0]
  assert.equal(alpha.reviews.dc.status, "sentBack")
  assert.ok(alpha.reviews.dc.reason.startsWith("Add a power cap  x"), "control characters are stripped")
  assert.ok(alpha.reviews.dc.reason.length <= 120)
  assert.equal(alpha.reviews.dc.by, "Grace", "who decided")
  assert.ok(alpha.reviews.dc.durationMs >= 0 && Number.isFinite(alpha.reviews.dc.at), "when, and how long the pitch ran")
  assert.equal(alpha.plans.dc, undefined, "sent back unlocks the plan")
  assert.equal(alpha.pitch.dc, undefined, "and scores nothing")
  assert.equal(back.json.leaders.dc.available, true)
  assert.equal(back.json.pitches.dc, undefined)
  assert.match(designStatus(back.json, alpha, "dc").label, /^Sent back: Add a power cap/)

  assert.equal((await call(`/api/teams/${a.id}/choices`, { station: "dc", choices: { tgp: "eco85", hall: "X" } })).status, 207, "the team can revise (tgp belongs to another table)")
  await call(`/api/teams/${a.id}/submit`, { station: "dc" })
  await call(`/api/teams/${a.id}/call`, { station: "dc" })
  s = app.getState()
  assert.equal(designStatus(s, s.teams[0], "dc").status, "waiting", "a revised plan queues again")
  await lead("/api/leader/pitch", { action: "start", team: a.id })
  const ok = await lead("/api/leader/decide", { team: a.id, decision: "approve" })
  const plan = ok.json.teams[0].plans.dc
  assert.equal(ok.json.teams[0].pitch.dc, C.tablePoints(plan.score, true))
  assert.equal(ok.json.teams[0].reviews.dc.by, C.byId(C.STATIONS, "dc").leader, "defaults to the table's leader title")

  const grid = approvalGrid(ok.json)
  assert.equal(grid.counts.approved, 1)
  assert.equal(grid.total, 12)
  assert.equal(grid.rows[0].cells.dc.status, "approved")
})

test("a leader can grant and revoke Architect for a team before meeting it", async () => {
  const [a] = await freshGame()
  assert.equal((await call("/api/leader/architect", { station: "ai", team: a.id, enabled: true }, PINS.leader, "dc")).status, 403)
  const granted = await call("/api/leader/architect", { station: "ai", team: a.id, enabled: true, by: "Lin" }, PINS.leader, "ai")
  assert.equal(granted.status, 200)
  assert.equal(granted.json.teams[0].architect.enabled, true)
  assert.equal(granted.json.teams[0].architect.grantedBy, "Lin")
  assert.equal(granted.json.teams[0].architect.grantedStation, "ai")
  assert.equal((await call(`/api/teams/${a.id}/architect`, { tuning: { precision: "fp8" } })).status, 200, "the team can now tune")
  const revoked = await call("/api/leader/architect", { station: "ai", team: a.id, enabled: false }, PINS.leader, "ai")
  assert.equal(revoked.json.teams[0].architect.enabled, false)
  assert.equal(revoked.json.teams[0].architect.revokedBy, C.byId(C.STATIONS, "ai").leader)
  assert.equal((await call(`/api/teams/${a.id}/architect`, { tuning: { precision: "fp8" } })).status, 403)
})

test("approval gates scoring and the race: unapproved tables score 0 and race on the default build", async () => {
  const [a, b] = await freshGame()
  for (const t of [a, b]) {
    await call(`/api/teams/${t.id}/choices`, { station: "network", choices: { wan: "fabric", wanBackup: "leo", hqLink: "fiber" } })
    await call(`/api/teams/${t.id}/submit`, { station: "network" })
  }
  const lead = (path, body) => call(path, { station: "network", ...body }, PINS.host)
  await lead("/api/leader/availability", { available: true })
  await lead("/api/leader/pitch", { action: "start", team: a.id })
  await lead("/api/leader/decide", { team: a.id, decision: "approve" })
  const run = await call("/api/race/run", { password: PINS.race, seed: "gate", endClock: true })
  assert.equal(run.status, 200)
  const rows = Object.fromEntries(run.json.race.result.results.map((r) => [r.id, r]))
  assert.ok(rows[a.id].pitch > 0)
  assert.equal(rows[b.id].pitch, 0, "locked in but not approved: 0 table points")
  assert.deepEqual(rows[b.id].notApproved, ["network"], "reported as not approved, distinct from missed")
  assert.ok(!rows[b.id].missed.includes("network"))
  assert.ok(rows[b.id].missed.includes("ai"))
  const raced = effectiveTeam(app.getState().teams[1], IDS)
  assert.equal(raced.choices.wan, undefined, "the race used the default WAN")
  assert.equal(evaluate(raced).choices.wan, C.decision("wan").def)
})

test("the race password is checked on the server; the default is SKO27", async () => {
  await freshGame()
  assert.equal((await call("/api/race/run", { password: "wrong", endClock: true })).status, 403)
  assert.equal((await call("/api/race/run", {})).status, 403)
  assert.equal((await call("/api/race/run", { password: PINS.race })).status, 409, "the clock is still running")
  assert.equal((await call("/api/race/run", { password: PINS.race, endClock: true })).status, 200)
  assert.equal((await call("/api/race/run", { password: PINS.race })).status, 409, "the race runs once from the race screen")
  assert.equal(DEFAULT_PINS.race, "SKO27")
  const saved = process.env.RACE_PIN
  delete process.env.RACE_PIN
  const other = await mkdtemp(join(tmpdir(), "podium-racepin-"))
  const plain = createApp({ dataDir: other, pins: { host: "h", leader: "l" } })
  const srv = createServer(plain.handle)
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve))
  try {
    const url = `http://127.0.0.1:${srv.address().port}`
    const post = (path, body, pin) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}) }, body: JSON.stringify(body) })
    await post("/api/host/setup", { teams: [{ name: "A" }, { name: "B" }] }, "h")
    assert.equal((await post("/api/race/run", { password: "SKO27" })).status, 200)
  } finally {
    plain.close()
    await new Promise((resolve) => srv.close(resolve))
    await rm(other, { recursive: true, force: true })
    if (saved !== undefined) process.env.RACE_PIN = saved
  }
  const install = await readFile(join(ROOT, "scripts/install-service.sh"), "utf8")
  for (const name of ["HOST_PIN", "LEADER_PIN", "RACE_PIN"]) assert.match(install, new RegExp(`<key>${name}</key>`), `the LaunchAgent sets ${name}`)
})

test("the race plays in 30 seconds and the race screen uses that duration", async () => {
  assert.equal(RACE_SECONDS, 30)
  const raceview = await readFile(join(ROOT, "public/js/raceview.js"), "utf8")
  assert.match(raceview, /RACE_SECONDS/)
  assert.doesNotMatch(raceview, /RACE_SECONDS\s*=\s*\d/, "no local override of the duration")
  const team = { id: "a", name: "A", color: "#f00", rank: 5, choices: REFERENCE_BUILD }
  const r = runRace([team, { ...team, id: "b", name: "B", choices: {} }].map((t) => ({ ...t, pitch: {}, evaluation: evaluate(t) })), "dur", IDS)
  assert.equal(r.seconds, 30)
  for (const row of r.results) {
    assert.equal(row.cum.length, LAPS, "cumulative times for the animation")
    assert.ok(row.cum.every((t, i) => i === 0 || t > row.cum[i - 1]))
    assert.ok(row.pitLap >= 1 && row.pitLoss > 0, "every car stops once")
  }
})

/** Many seeds of one race with three contrasting designs. */
function incidentRaces(n = 40) {
  const single = { ...REFERENCE_BUILD, wan: "public", wanBackup: "none", hqLink: "public", hall: "A", tgp: "boost", deploy: "own", trackside: "wireless", archive: "none", segregation: "shared", kv: "off" }
  const robust = { ...REFERENCE_BUILD, wan: "fabric", wanBackup: "leo", hall: "L", tgp: "eco85", deploy: "own", kv: "on" }
  const teams = [
    { id: "fragile", name: "Fragile GP", color: "#f00", rank: 5, choices: single },
    { id: "robust", name: "Robust GP", color: "#0f0", rank: 5, choices: robust, architect: { enabled: true, gain: 1.4 } },
    { id: "burst", name: "Burst GP", color: "#00f", rank: 5, choices: { ...REFERENCE_BUILD, deploy: "burst" } },
  ]
  return Array.from({ length: n }, (_, i) => runRace(teams.map((t) => ({ ...t, pitch: {}, evaluation: evaluate(t) })), `inc-${i}`, IDS))
}

test("incidents come from the approved choices and say who, why and what it cost", () => {
  const races = incidentRaces()
  const events = races.flatMap((r) => r.events.filter((e) => e.team))
  const of = (team, id) => events.filter((e) => e.team === team && e.incident === id)
  assert.ok(of("fragile", "wan").concat(of("fragile", "fibreCut")).some((e) => /only WAN link dropped for 40 s/.test(e.text)), "a single WAN link drops")
  assert.ok(of("fragile", "heat").some((e) => /air-cooled hall throttled/.test(e.text)), "an air-cooled hall throttles in the heat")
  assert.ok(of("fragile", "jitter").some((e) => /public-internet jitter/.test(e.text) && /undercut/.test(e.text)), "public internet mistimes the undercut")
  assert.ok(events.some((e) => e.team === "fragile" && /FIA time penalty/.test(e.text) && /5G|Wi-Fi/.test(e.text)), "banned wireless earns a time penalty")
  assert.ok(events.some((e) => e.team === "fragile" && /FIA audit penalty/.test(e.text)), "no retention or shared IT draws an FIA audit penalty")
  assert.ok(of("burst", "burst").some((e) => /cloud burst capacity was unavailable/.test(e.text) && /wrong wing/.test(e.text)))
  assert.ok(of("robust", "kv").some((e) => /KV cache/.test(e.text)))
  assert.ok(of("robust", "architect").some((e) => /Architect/.test(e.text)))
  assert.ok(of("robust", "fibreSafe").some((e) => /redundant tunnels plus a diverse backup/.test(e.text)), "redundant tunnels plus LEO survive a fibre cut")
  assert.ok(of("robust", "heatSafe").some((e) => /liquid cooling plus a 85% power cap/.test(e.text)), "liquid plus an 85% cap stays stable in the heat")
  assert.equal(of("robust", "jitter").length, 0, "a private WAN has no jitter incident")
  for (const e of events.filter((x) => x.incident && x.station)) {
    assert.ok(e.text.startsWith(e.team === "fragile" ? "Fragile GP" : e.team === "robust" ? "Robust GP" : "Burst GP"), "the team name leads the line")
    assert.match(e.text, /^(.+)\. (Lost|Gained|Held) /, "plain-English effect")
  }
  assert.ok(events.some((e) => /^Fragile GP\. Lost \d place/.test(e.text)), "places lost are counted")
  assert.deepEqual(incidentRaces(3), incidentRaces(3), "deterministic for the seed")
})

test("balance over 200 seeds: approval and optimisation decide the order, with bounded randomness", () => {
  const pairs = []
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) pairs.push([IDS[i], IDS[j]])
  const entry = (id, team) => {
    const raced = effectiveTeam(team, IDS)
    const evaluation = evaluate(raced)
    return { id, name: id, color: "#fff", pitch: {}, evaluation, system: systemScore(evaluation, IDS) }
  }
  let beatsPartial = 0
  let beatsDefaults = 0
  const N = 200
  for (let s = 0; s < N; s++) {
    const pair = pairs[s % pairs.length]
    const full = entry("full", { rank: 5, choices: REFERENCE_BUILD, reviews: approvedAt(IDS) })
    const partial = entry("partial", { rank: 5, choices: REFERENCE_BUILD, reviews: approvedAt(IDS.filter((id) => !pair.includes(id))) })
    const defaults = entry("defaults", { rank: 5, choices: {} })
    const pos = Object.fromEntries(runRace([full, partial, defaults], `balance-${s}`, IDS).results.map((r) => [r.id, r.position ?? 99]))
    if (pos.full < pos.partial) beatsPartial += 1
    if (pos.full < pos.defaults) beatsDefaults += 1
  }
  console.log(`[balance] all-approved beats two-unapproved in ${beatsPartial}/${N} (${(beatsPartial / N * 100).toFixed(1)}%), beats all-defaults in ${beatsDefaults}/${N} (${(beatsDefaults / N * 100).toFixed(1)}%)`)
  assert.ok(beatsPartial / N >= 0.85, `beats two-unapproved ${beatsPartial}/${N}`)
  assert.ok(beatsDefaults / N >= 0.95, `beats all-defaults ${beatsDefaults}/${N}`)
  assert.ok(beatsPartial < N, "randomness is bounded but real: the partial team sometimes wins")
})

test("the race report: podium order and 1–3 suggestions per team", () => {
  const teams = [
    { id: "a", name: "Alpha", color: "#f00", rank: 5, choices: REFERENCE_BUILD, reviews: approvedAt(IDS) },
    { id: "b", name: "Bravo", color: "#0f0", rank: 5, choices: REFERENCE_BUILD, reviews: approvedAt(["dc", "storage", "network", "governance"]), plans: { ai: { id: "X" } } },
    { id: "c", name: "Charlie", color: "#00f", rank: 5, choices: {} },
  ]
  const race = runRace(teams.map((t) => {
    const raced = effectiveTeam(t, IDS)
    return { id: t.id, name: t.name, color: t.color, pitch: {}, missed: raced.missed, notApproved: raced.notApproved, evaluation: evaluate(raced) }
  }), "report", IDS)
  const p = podium(race)
  assert.deepEqual(p.map((x) => x.place), [2, 1, 3], "2nd left, 1st centre, 3rd right")
  assert.equal(p[1].id, race.standings[0].id)
  for (const t of teams) {
    const tips = suggestionsFor(t, race.results.find((r) => r.id === t.id), IDS)
    assert.ok(tips.length >= 1 && tips.length <= 3, `${t.name}: ${tips.length}`)
    for (const tip of tips) assert.ok(tip.text.length > 20)
  }
  const bravo = suggestionsFor(teams[1], race.results.find((r) => r.id === "b"), IDS)
  assert.match(bravo[0].text, /Get AI & GPUs approved/)
  assert.ok(bravo.some((tip) => /never locked in CFD Supercomputer/.test(tip.text)))
  const charlie = suggestionsFor(teams[2], race.results.find((r) => r.id === "c"), IDS)
  assert.ok(charlie.some((tip) => tip.kind === "penalty" && /FIA penalty/.test(tip.text)))
  const better = suggestionsFor({ ...teams[0], choices: { ...REFERENCE_BUILD, archive: "none" } }, null, IDS)
  assert.ok(better.some((tip) => tip.kind === "choice" && / instead of /.test(tip.text)), "names the better option")
})

test("plain-English design summaries: full sentences, consequences and the score", () => {
  const team = { rank: 5, choices: { ...REFERENCE_BUILD, oem: "dell", payment: "aas", platform: "b300", racks: 2, tgp: "eco85", hall: "L", location: "fra" } }
  const compute = designSummary(team, "compute")
  assert.match(compute.sentences[0], /^They chose Dell .* paid monthly through .*APEX, so there is no CapEx but a 36-month commitment\.$/)
  const ai = designSummary(team, "ai")
  assert.match(ai.sentences[0], /^Two racks of HGX B300.*capped at 85% power\.$/)
  assert.match(designSummary(team, "dc").sentences[0], /Frankfurt, cooled with direct-to-chip liquid/)
  for (const id of IDS) {
    const s = designSummary(team, id)
    assert.ok(s.sentences.length >= 2 && s.sentences.every((line) => /^[A-Z].*\.$/.test(line)), id)
    assert.deepEqual(s.consequences.map((c) => c.split(":")[0]), ["CapEx", "Yearly OpEx", "Power", "Lead time", "FIA flags"])
    assert.ok(Number.isFinite(s.score) && s.parts.length === 4)
  }
  assert.match(designSummary({ rank: 5, choices: {} }, "governance").consequences.at(-1), /F6/)
})

test("demo mode walks the approval flow", () => {
  const ids = DEMO_STEPS.map((s) => s.id)
  for (const id of ["call", "free", "pitch", "approve", "tables", "race"]) assert.ok(ids.includes(id), id)
  const at = (id) => buildDemo(ids.indexOf(id)).state
  assert.equal(at("pitch").pitches.ai.team, "demo")
  assert.equal(at("approve").teams[0].reviews.ai.status, "approved")
  assert.equal(at("free").teams[0].architect.grantedBy, C.byId(C.STATIONS, "ai").leader)
  assert.equal(at("tables").teams[2].reviews.network.status, "sentBack")
  assert.ok(at("race").race.result.results.every((r) => r.cum.length === LAPS))
})
