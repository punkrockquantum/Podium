/**
 * Demo mode: a narrated walkthrough with a pretend game. Pure: it builds a fake state for each step
 * and never touches the real game.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam } from "./model.js"
import { REFERENCE_BUILD } from "./sim.js"
import { runRace, systemScore } from "./race.js"
import { buildPlan } from "./plandata.js"

export const DEMO_STEPS = [
  { id: "brief", screen: "brief", title: "1. Brief (5 min)", narration: "The host starts the brief. Every table shows Listen to the brief; nobody can choose yet. Each table has three short bullets and one line on what its Architect is looking for." },
  { id: "play", screen: "decide", title: "2. Play (35 min)", narration: "Play starts. At each of the four tables the team picks one card for each of three decisions, then runs the simulation: one score, one sentence, one hint." },
  { id: "pitch", screen: "plan", title: "3. Lock in and pitch", narration: "The team locks in, takes a screenshot of the plan page, and taps Call the Architect. Their iPad shows Waiting for Architect." },
  { id: "approve", screen: "architect", title: "4. The Architect approves", narration: "On the host screen the Architect reads the three choices in plain English, starts a 30-second pitch, then approves or sends it back with a reason." },
  { id: "race", screen: "race", title: "5. The race (30 s)", narration: "After play the host runs the race with the race password. Approved tables race as designed; every other table races on its defaults and scores 0." },
  { id: "readout", screen: "readout", title: "6. Readouts (9 min)", narration: "Every team gets a readout: the result, what went well, and what to do differently, naming the better option and why." },
]

const IDS = C.STATIONS.map((s) => s.id)
const approved = (ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: C.byId(C.STATIONS, id).architect, at: 0, points: 24, score: 90 }]))

function pretendTeams() {
  const base = (i, name, tier, choices) => ({ id: `d${i}`, name, color: C.TEAM_COLORS[i - 1], tier, choices, touched: {}, submitted: {}, scores: {}, pitch: {}, visits: {}, sims: {}, plans: {}, reviews: {} })
  return [
    base(1, "Demo Racing", 2, { ...REFERENCE_BUILD }),
    base(2, "Pretend GP", 1, { ...REFERENCE_BUILD, link: "single", cooling: "air", power: "boost" }),
    base(3, "Sample Motorsport", 3, {}),
  ]
}

export function buildDemo(index) {
  const i = Math.max(0, Math.min(DEMO_STEPS.length - 1, Number(index) || 0))
  const step = DEMO_STEPS[i]
  const teams = pretendTeams()
  const [focus, second] = teams
  const station = "network"
  const state = {
    id: "demo",
    version: 1,
    settings: { ...C.SESSION, stations: IDS },
    brief: { status: step.id === "brief" ? "running" : "done", endsAt: Date.now() + 4 * 60_000 },
    clock: { status: ["brief"].includes(step.id) ? "lobby" : ["race", "readout"].includes(step.id) ? "ended" : "running", totalMs: C.SESSION.playMinutes * 60_000, endsAt: Date.now() + 21 * 60_000, remainingMs: null },
    readout: step.id === "readout" ? { startedAt: Date.now(), endsAt: Date.now() + 9 * 60_000 } : null,
    tables: { [station]: { team: focus.id, since: Date.now() } },
    queues: {},
    architects: { [station]: { available: true } },
    pitches: {},
    teams,
    race: null,
  }
  if (i >= 2) {
    focus.plans[station] = buildPlan(focus, station, { id: "DEMO1", at: Date.now() })
    state.queues[station] = [{ team: focus.id, at: Date.now() - 45_000 }]
  }
  if (step.id === "approve") {
    state.pitches[station] = { team: focus.id, startedAt: Date.now(), endsAt: Date.now() + 30_000, by: C.byId(C.STATIONS, station).architect }
    state.architects[station] = { available: false, busyWith: focus.id }
  }
  if (i >= 4) {
    focus.reviews = approved(IDS)
    second.reviews = approved(["network", "compute"])
    for (const t of [focus, second]) for (const id of Object.keys(t.reviews)) t.pitch[id] = 24
    state.queues = {}
    const entries = teams.map((t) => {
      const raced = effectiveTeam(t, IDS)
      const evaluation = evaluate(raced)
      return { id: t.id, name: t.name, color: t.color, pitch: t.pitch, missed: raced.missed, notApproved: raced.notApproved, system: systemScore(evaluation, IDS), evaluation }
    })
    state.race = { seed: "demo", ranAt: Date.now(), ranBy: "demo", result: runRace(entries, "demo", IDS) }
  }
  return { index: i, total: DEMO_STEPS.length, step, state, focus: { team: focus.id, station } }
}
