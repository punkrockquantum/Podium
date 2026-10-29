/**
 * Host demo mode: a scripted, narrated walkthrough with a pretend team.
 * Pure: every step builds a fresh in-memory game from constants. It never calls the server or reads the real game.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam } from "./model.js"
import { simulateStation, REFERENCE_BUILD } from "./sim.js"
import { runRace, systemScore } from "./race.js"
import { architectReport } from "./architect.js"
import { buildPlan } from "./plandata.js"
import { PITCH_MS } from "./approval.js"

const T0 = Date.UTC(2027, 9, 22, 9, 0, 0)
const MIN = 60_000
const OPTS = { races: 24, sprints: 6 }
const DEMO_STATION = "ai"
const TUNING = { precision: "fp8", batchCap: 128, continuousBatching: true, kvTier: true }

const pick = (stationId, build = REFERENCE_BUILD) =>
  Object.fromEntries(C.visibleDecisions(stationId).map((d) => [d.id, build[d.id]]).filter(([, v]) => v !== undefined))

function blankTeam(id, name, rank, color) {
  return { id, name, rank, color, choices: {}, touched: {}, submitted: {}, scores: {}, pitch: {}, visits: {}, sims: {}, plans: {}, reviews: {}, architect: { enabled: false, tuning: {}, gain: 1 } }
}

function lockIn(team, station, at, idSuffix) {
  team.touched[station] = true
  team.submitted[station] = at
  team.plans[station] = buildPlan(team, station, OPTS, { id: `DEMO${idSuffix}`, at })
}

function approve(team, station, at, by) {
  const plan = team.plans[station]
  const points = C.tablePoints(plan.score, true)
  team.reviews[station] = { status: "approved", by, at, startedAt: at - PITCH_MS, durationMs: PITCH_MS, planId: plan.id, score: plan.score, points }
  team.scores[station] = { total: points, at }
  team.pitch[station] = points
}

function sendBack(team, station, at, by, reason) {
  const plan = team.plans[station]
  team.reviews[station] = { status: "sentBack", by, at, startedAt: at - PITCH_MS, durationMs: PITCH_MS, planId: plan.id, score: plan.score, reason }
  delete team.plans[station]
  delete team.submitted[station]
}

const leaderOf = (station) => C.byId(C.STATIONS, station).leader

/** Each step adds to the previous one; `screen` tells the host which view to show. */
export const DEMO_STEPS = [
  { id: "setup", title: "1 · Set up the game", screen: "feed", narration: "The host names the teams and sets each one's 2026 finishing position. Front-runners get a smaller CapEx envelope and less CFD time; backmarkers get more. Our pretend team, Demo Racing, finished P6." },
  { id: "start", title: "2 · Start the clock", screen: "feed", narration: "One game clock runs for everyone. Teams move freely between tables. When it hits zero every table locks, and any table that is not approved races on its default options and scores 0." },
  { id: "checkin", title: "3 · Choose your team", screen: "feed", narration: "Demo Racing walks to the AI & GPUs table and taps its name under Choose your team. The iPad opens on 1 Brief, and the live feed shows where the team is, its current step and a heartbeat." },
  { id: "brief", title: "4 · Read the brief", screen: "station", narration: "Every table's Brief has the same three panels: the mission, the team's constraints (CapEx headroom, OpEx allowance, compute cap) and what the leader is scoring. Start designing goes to Decide." },
  { id: "decide", title: "5 · Make the decisions", screen: "station", narration: "Six decisions, three or four cards each. Every card says why it matters to the customer and what it does to CapEx, OpEx and power. \"FIA rule\" marks a regulation; \"est.\" marks an estimate. The defaults are deliberately not optimal." },
  { id: "sim", title: "6 · Run simulation", screen: "station", narration: "The simulation scores performance, cost, FIA compliance and resilience, with up to three hints. 80% or more is Optimised. About three runs per visit is plenty." },
  { id: "lock", title: "7 · Lock in: the plan output", screen: "plan", narration: "Lock in freezes the table and produces a one-page plan with its ID, a plain-English summary, decisions, money, power, lead time and score. The team takes a screenshot. It scores nothing until the leader approves it." },
  { id: "call", title: "8 · Call the leader", screen: "leader", narration: "Call the leader puts the team in this table's pitch queue; the iPad shows Waiting for leader and the queue position. The table leader, logged in on the host screen, sees the queue with waiting times and reads the design in plain English." },
  { id: "free", title: "9 · Leader grants Architect, then is Available", screen: "leader", narration: "Before meeting the team the leader grants Architect (the host can too); the badge appears on the leader panel, the live feed, the team's iPad and the standings. Then the leader taps Available." },
  { id: "pitch", title: "10 · Start pitch: 30 seconds", screen: "leader", narration: "The leader taps Start pitch: a 30-second countdown on the leader's screen and \"Pitching\" on the team's iPad. The leader becomes Busy. At zero the leader is prompted to decide." },
  { id: "approve", title: "11 · Approve or send back", screen: "leader", narration: "Approve: the table scores its simulation plus 10% and races as designed. Send back (with a one-line reason the team sees): the plan unlocks so the team can revise and pitch again while the clock allows. Either way the leader is Available again." },
  { id: "architect", title: "12 · Architect mode", screen: "architect", narration: "Architect unlocks the Token Efficiency Calculator: precision, batching, KV cache, HBM, power cap, interconnect and speculative decoding. The gain in good tokens per second carries into the race." },
  { id: "tables", title: "13 · Every table", screen: "approvals", narration: "The team repeats this at each table. The host's approvals grid shows every team × table: draft, locked, waiting, pitching, approved or sent back, with counts. Rival Bravo was sent back at Connectivity." },
  { id: "end", title: "14 · Time is up", screen: "approvals", narration: "At zero every table locks. Leaders can still hear and approve pitches for plans locked in before time; anything not approved scores 0 and races on its defaults." },
  { id: "race", title: "15 · Run the race", screen: "race", narration: "On the race screen, Run race with the race password: 56 laps of the Circuit of the Americas in 30 seconds, with incidents caused by each team's approved choices. Then the podium and what each team could do differently." },
]

/** The pretend game after step `index` (0-based). Always a new object. */
export function buildDemo(index) {
  const upTo = Math.max(0, Math.min(DEMO_STEPS.length - 1, Math.round(Number(index) || 0)))
  const done = new Set(DEMO_STEPS.slice(0, upTo + 1).map((s) => s.id))
  const demo = blankTeam("demo", "Demo Racing", 6, C.TEAM_COLORS[0])
  const rivalA = blankTeam("rivala", "Rival Alpha", 2, C.TEAM_COLORS[1])
  const rivalB = blankTeam("rivalb", "Rival Bravo", 9, C.TEAM_COLORS[2])
  const stations = C.STATIONS.map((s) => s.id)
  const state = {
    id: "demo",
    version: upTo + 1,
    demo: true,
    settings: { stations, gameMinutes: 60, visitMinutes: 10, ...OPTS },
    clock: { status: "lobby", totalMs: 60 * MIN, endsAt: null, remainingMs: 60 * MIN },
    teams: [demo, rivalA, rivalB],
    tables: {},
    queues: {},
    leaders: {},
    pitches: {},
    race: null,
  }
  const presence = {}
  let now = T0

  if (done.has("start")) {
    now += 2 * MIN
    state.clock = { status: "running", totalMs: 60 * MIN, startedAt: now, endsAt: now + 60 * MIN, remainingMs: 60 * MIN }
    rivalA.visits.compute = { first: now, last: now, count: 1 }
    state.tables.compute = { team: rivalA.id, since: now }
    presence[rivalA.id] = { station: "compute", step: "decide", at: now }
  }
  if (done.has("checkin")) {
    now += 1 * MIN
    demo.visits[DEMO_STATION] = { first: now, last: now, count: 1 }
    state.tables[DEMO_STATION] = { team: demo.id, since: now }
    presence[demo.id] = { station: DEMO_STATION, step: "brief", at: now }
  }
  if (done.has("decide")) {
    now += 3 * MIN
    Object.assign(demo.choices, pick(DEMO_STATION))
    demo.touched[DEMO_STATION] = true
    presence[demo.id] = { station: DEMO_STATION, step: "decide", at: now }
  }
  if (done.has("sim")) {
    now += 1 * MIN
    demo.sims[DEMO_STATION] = { total: 2, visit: 2, visitNo: 1, lastScore: simulateStation(demo, OPTS, DEMO_STATION).score, lastAt: now }
    presence[demo.id] = { station: DEMO_STATION, step: "sim", at: now }
  }
  if (done.has("lock")) {
    now += 1 * MIN
    lockIn(demo, DEMO_STATION, now, "A")
    presence[demo.id] = { station: DEMO_STATION, step: "pitch", at: now }
  }
  if (done.has("call")) {
    now += 1 * MIN
    state.leaders[DEMO_STATION] = { available: false, since: now }
    state.queues[DEMO_STATION] = [{ team: demo.id, at: now, confirmed: false, slot: null }]
  }
  if (done.has("free")) {
    now += 2 * MIN
    demo.architect = { enabled: true, tuning: {}, gain: 1, grantedAt: now, grantedBy: leaderOf(DEMO_STATION), grantedStation: DEMO_STATION }
    state.leaders[DEMO_STATION] = { available: true, since: now }
  }
  if (done.has("pitch")) {
    now += 1 * MIN
    state.pitches[DEMO_STATION] = { team: demo.id, startedAt: now, endsAt: now + PITCH_MS, by: leaderOf(DEMO_STATION) }
    state.leaders[DEMO_STATION] = { available: false, since: now, busyWith: demo.id }
  }
  if (done.has("approve")) {
    now += PITCH_MS
    approve(demo, DEMO_STATION, now, leaderOf(DEMO_STATION))
    delete state.pitches[DEMO_STATION]
    state.queues[DEMO_STATION] = []
    state.leaders[DEMO_STATION] = { available: true, since: now }
  }
  if (done.has("architect")) {
    now += 2 * MIN
    const gain = architectReport(demo, TUNING).gain
    demo.architect = { ...demo.architect, enabled: true, tuning: { ...TUNING }, gain }
    presence[demo.id] = { station: DEMO_STATION, step: "architect", at: now }
  }
  if (done.has("tables")) {
    now += 30 * MIN
    let n = 0
    for (const id of stations.filter((s) => s !== DEMO_STATION)) {
      Object.assign(demo.choices, pick(id))
      demo.visits[id] = { first: now, last: now, count: 1 }
      lockIn(demo, id, now, String.fromCharCode(66 + n++))
      approve(demo, id, now, leaderOf(id))
    }
    for (const id of ["compute", "dc", "storage"]) {
      rivalA.visits[id] = { first: now, last: now, count: 1 }
      lockIn(rivalA, id, now, `R${id[0].toUpperCase()}`)
      approve(rivalA, id, now, leaderOf(id))
    }
    rivalA.visits.ai = { first: now, last: now, count: 1 }
    lockIn(rivalA, "ai", now, "RA")
    state.queues.ai = [{ team: rivalA.id, at: now, confirmed: false, slot: null }]
    rivalB.visits.network = { first: now, last: now, count: 1 }
    lockIn(rivalB, "network", now, "RN")
    sendBack(rivalB, "network", now, leaderOf("network"), "One WAN path is not redundant: add a diverse backup.")
    delete state.tables[DEMO_STATION]
    state.tables.governance = { team: demo.id, since: now }
    presence[demo.id] = { station: "governance", step: "pitch", at: now }
    presence[rivalB.id] = { station: "network", step: "decide", at: now }
  }
  if (done.has("end")) {
    now += 20 * MIN
    state.clock = { status: "ended", totalMs: 60 * MIN, endsAt: null, remainingMs: 0, endedAt: now, endedBy: "time" }
    state.tables = {}
  }
  if (done.has("race")) {
    now += 2 * MIN
    const entries = state.teams.map((t) => {
      const raced = effectiveTeam(t, stations)
      const evaluation = evaluate(raced, OPTS)
      const pitch = Object.fromEntries(raced.approved.map((id) => [id, t.pitch[id] || 0]))
      return { id: t.id, name: t.name, color: t.color, pitch, missed: raced.missed, notApproved: raced.notApproved, architect: Boolean(t.architect?.enabled), visited: Object.keys(t.visits).length, system: systemScore(evaluation, stations), evaluation }
    })
    const result = runRace(entries, "podium-demo", stations)
    for (const row of result.results) row.visited = entries.find((e) => e.id === row.id).visited
    state.race = { seed: "podium-demo", ranAt: now, result }
  }
  return { step: DEMO_STEPS[upTo], index: upTo, total: DEMO_STEPS.length, state, presence: { now, presence }, focus: { team: demo.id, station: DEMO_STATION } }
}
