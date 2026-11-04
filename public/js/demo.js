/**
 * Demo mode: a narrated walkthrough with a pretend game. Pure: it builds a fake state for each step
 * and never touches the real game.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam } from "./model.js"
import { runRace, systemScore } from "./race.js"
import { buildPlan } from "./plandata.js"

export const DEMO_STEPS = [
  { id: "brief", screen: "problem", title: "1. Brief and the problem (5 min)", narration: "Each table opens on its problem: one sentence, the targets as gauges with a green zone, and the cap lines. The grey needle is what the customer has today, and it sits outside the zone." },
  { id: "tune", screen: "tuneOff", title: "2. Tune (35 min)", narration: "Teams turn three dials. Every tap moves the needles and the cost bars at once. Here the board is still out of the zone: the hint says which dial to try next." },
  { id: "zone", screen: "tuneOn", title: "3. In the zone", narration: "All three gauges are green and every bar is under its cap line, so FIT is 80 or more. The first time a board gets there, the team sees What you just learned: why it matters to the customer and how a provider helps." },
  { id: "pitch", screen: "plan", title: "4. Lock in and pitch", narration: "The team locks in, takes a screenshot of the board snapshot, and taps Call the Architect. Their iPad shows Waiting for Architect." },
  { id: "approve", screen: "architect", title: "5. The Architect approves", narration: "The Architect sees the same board the team tuned, starts a 30-second pitch, then approves or sends it back with a reason. The approvals grid fills with FIT gauges." },
  { id: "race", screen: "race", title: "6. The race (30 s)", narration: "Approved boards race as tuned and the outcome follows their FIT. Every other table races on the customer's existing setup, and the incidents name the dial that caused them." },
  { id: "readout", screen: "readout", title: "7. Readouts (9 min)", narration: "Every team gets a readout: each table's board and FIT, the lessons it achieved, and what to do differently, naming the dial, the better setting and how a provider helps." },
]

const IDS = C.STATIONS.map((s) => s.id)
const STATION = "network"
/** A network board one dial short of the zone: two paths, but still on the public internet. */
const NEARLY = { link: "redundant", path: "public", garage: "umbilical" }

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
