/**
 * Demo mode: a narrated walkthrough with a pretend game. Pure: it builds a fake state for each step
 * and never touches the real game.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam } from "./model.js"
import { runRace, systemScore } from "./race.js"
import { buildPlan } from "./plandata.js"

export const DEMO_STEPS = [
  { id: "brief", screen: "problem", title: "1. Brief: the scenario (5 min)", narration: "Each table opens on its scenario: a live picture of the customer's problem (here, the F1 car in the CFD wind tunnel), the targets as gauges with a green zone, and the cap lines. On today's setup it finds 0.00 s per lap." },
  { id: "tune", screen: "tuneOff", title: "2. Scenario & Tune (35 min)", narration: "Teams turn three dials and the scene reacts at once: more streamlines, bigger downforce arrows, a new lap time. Tap a dial below, or Turn a dial for me, and watch the seconds found per lap change. This board is still out of the zone." },
  { id: "zone", screen: "tuneOn", title: "3. In the zone", narration: "Every gauge is green and every bar is under its cap line: the airflow is smooth and the tunnel shows the lap time found. In the zone is worth 0.25–0.35 s per lap; a cap or FIA breach is not allowed and finds nothing." },
  { id: "pitch", screen: "plan", title: "4. Lock in and pitch", narration: "The team locks in, takes a screenshot of the snapshot (the scene and its seconds found), and taps Call the Architect. Their iPad shows Waiting for Architect." },
  { id: "approve", screen: "architect", title: "5. The Architect approves", narration: "The Architect sees the same scene and board the team tuned, starts a 30-second pitch, then approves or sends it back with a reason. The approvals grid adds up each team's seconds found." },
  { id: "race", screen: "race", title: "6. The race (30 s)", narration: "Each team's pace is the seconds it found per lap across its approved tables, plus race incidents. Every other table races on the customer's existing setup, and the incidents name the dial that caused them." },
  { id: "readout", screen: "readout", title: "7. Readouts (9 min)", narration: "Every team gets a readout: You found X s per lap; the race said where you finished. Then each table's final scene, the lessons and what to do differently, naming the dial and how a provider helps." },
]

const IDS = C.STATIONS.map((s) => s.id)
const STATION = "compute"
/** A CFD board one dial short of the zone: sized to the FIA cap, but the office NAS starves the nodes. */
export const NEARLY = { size: "medium", chips: "cpu", storage: "basic" }

const approved = (team, ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: C.byId(C.STATIONS, id).architect, at: 0, points: C.tablePoints(evaluate(team, C.DEFAULT_BUDGET, IDS).fit[id], true) }]))

function pretendTeams() {
  const base = (i, name, choices) => ({ id: `d${i}`, name, color: C.TEAM_COLORS[i - 1], choices, touched: {}, submitted: {}, scores: {}, pitch: {}, visits: {}, sims: {}, plans: {}, reviews: {} })
  return [
    base(1, "Demo Racing", { ...C.REFERENCE_BUILD }),
    base(2, "Pretend GP", { ...C.REFERENCE_BUILD, link: "single", cooling: "air", power: "boost" }),
    base(3, "Sample Motorsport", {}),
  ]
}

export function buildDemo(index) {
  const i = Math.max(0, Math.min(DEMO_STEPS.length - 1, Number(index) || 0))
  const step = DEMO_STEPS[i]
  const teams = pretendTeams()
  const [focus, second] = teams
  if (step.id === "brief") focus.choices = {}
  if (step.id === "tune") focus.choices = { ...focus.choices, ...NEARLY }
  const state = {
    id: "demo",
    version: 1,
    settings: { ...C.SESSION, budget: C.DEFAULT_BUDGET, stations: IDS },
    brief: { status: step.id === "brief" ? "running" : "done", endsAt: Date.now() + 4 * 60_000 },
    clock: { status: step.id === "brief" ? "lobby" : ["race", "readout"].includes(step.id) ? "ended" : "running", totalMs: C.SESSION.playMinutes * 60_000, endsAt: Date.now() + 21 * 60_000, remainingMs: null },
    readout: step.id === "readout" ? { startedAt: Date.now(), endsAt: Date.now() + 9 * 60_000 } : null,
    tables: { [STATION]: { team: focus.id, since: Date.now() } },
    queues: {},
    architects: { [STATION]: { available: true } },
    pitches: {},
    teams,
    race: null,
  }
  const at = DEMO_STEPS.findIndex((x) => x.id === "pitch")
  if (i >= at) {
    focus.plans[STATION] = buildPlan(focus, STATION, { id: "DEMO1", at: Date.now(), budget: C.DEFAULT_BUDGET })
    state.queues[STATION] = [{ team: focus.id, at: Date.now() - 45_000 }]
  }
  if (step.id === "approve") {
    state.pitches[STATION] = { team: focus.id, startedAt: Date.now(), endsAt: Date.now() + 30_000, by: C.byId(C.STATIONS, STATION).architect }
    state.architects[STATION] = { available: false, busyWith: focus.id }
    focus.reviews = approved(focus, ["oem", "dc"])
    second.reviews = approved(second, ["compute"])
  }
  if (i >= DEMO_STEPS.findIndex((x) => x.id === "race")) {
    focus.reviews = approved(focus, IDS)
    second.reviews = approved(second, ["network", "compute"])
    for (const t of [focus, second]) {
      for (const id of Object.keys(t.reviews)) {
        t.pitch[id] = t.reviews[id].points
        t.plans[id] ||= buildPlan(t, id, { id: `D${t.id}${id}`, at: Date.now(), budget: C.DEFAULT_BUDGET })
      }
    }
    state.queues = {}
    const entries = teams.map((t) => {
      const raced = effectiveTeam(t, IDS)
      const evaluation = evaluate(raced, C.DEFAULT_BUDGET, IDS)
      return { id: t.id, name: t.name, color: t.color, pitch: t.pitch, missed: raced.missed, notApproved: raced.notApproved, system: systemScore(evaluation, IDS), evaluation }
    })
    state.race = { seed: "demo", ranAt: Date.now(), ranBy: "demo", budget: C.DEFAULT_BUDGET, result: runRace(entries, "demo", IDS) }
  }
  return { index: i, total: DEMO_STEPS.length, step, state, focus: { team: focus.id, station: STATION } }
}
