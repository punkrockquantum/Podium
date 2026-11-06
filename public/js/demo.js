/**
 * Demo mode: a narrated walkthrough with a pretend game. Pure: it builds a fake state for each step
 * and never touches the real game.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam } from "./model.js"
import { runRace, systemScore } from "./race.js"
import { buildPlan } from "./plandata.js"

export const DEMO_STEPS = [
  { id: "brief", screen: "brief", title: "1. Brief: read it together (5 min)", narration: "Each table opens on its brief: the situation, the targets with their numbers, the FIA rules and both cost caps, what each setting does, and every term explained. Tune and Pitch stay closed until the team taps “I've read the brief”, which unlocks at the end of the brief or after 30 seconds. The warning is the point: each choice locks the moment you tap it." },
  { id: "tune", screen: "tuneOff", title: "2. Tune: one tap locks a dial (35 min)", narration: "No Lock-in button, no confirmation, no undo. The first tap on a dial locks it: the padlock appears, the other settings go quiet and the counter reads Locked 1 of 3. The scene, the gauges, the cap bars and the seconds found per lap update at once, so the team sees the consequence immediately. Tap a dial, or Lock a dial for me." },
  { id: "zone", screen: "tuneOn", title: "3. In the zone", narration: "Every gauge is green and every bar is under its cap line: the airflow is smooth and the tunnel shows the lap time found. In the zone is worth 0.25–0.35 s per lap; a cap or FIA breach is not allowed and finds nothing. When the third dial locks, the table locks itself." },
  { id: "pitch", screen: "plan", title: "4. All three locked: call the Solutions Architect", narration: "With all three locked the only step left is Call the Solutions Architect. The team joins the SA's queue (the SA may be busy with another team) and pitches for 30 seconds: why each choice helps the customer and how a provider helps." },
  { id: "reject", screen: "rejected", title: "5. Rejected: adjust and call again", narration: "The SA rejected the design with a short reason, shown on the team's iPad. Only this team's dials at this table reopen, with last time's picks shown as dashed “last time” ghosts. Each new tap locks instantly; three locks make attempt 2 and the team calls the SA again. That costs time, which is the lesson." },
  { id: "approve", screen: "architect", title: "6. The Solutions Architect approves", narration: "The SA sees the board exactly as the team locked it, which attempt this is, and the table's brief; starts the 30-second pitch; then taps Approve or Reject. The approvals grid shows every team's status, attempt and seconds found." },
  { id: "race", screen: "race", title: "7. The race (30 s)", narration: "Each team's pace is the seconds it found per lap across its approved tables, plus race incidents. Anything not approved when time ran out, including a table still adjusting after a rejection, races on the customer's existing setup, and the incidents name the dial that caused them." },
  { id: "readout", screen: "readout", title: "8. Readouts (9 min)", narration: "Every team gets a readout: You found X s per lap; the race said where you finished. Then each table's final scene with its story (Approved on the second attempt), the lessons and what to do differently, naming the dial and how a provider helps." },
]

const IDS = C.STATIONS.map((s) => s.id)
const STATION = "compute"
/** A CFD board one dial short of the zone: sized to the FIA cap, but the office NAS starves the nodes. */
export const NEARLY = { size: "medium", chips: "cpu", storage: "basic" }
const REJECT_REASON = "Storage starves the nodes: the cluster waits for data"

const approved = (team, ids, attempt = 1) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: C.byId(C.STATIONS, id).architect, at: 0, attempt, points: C.tablePoints(evaluate(team, C.DEFAULT_BUDGET, IDS).fit[id], true) }]))

function pretendTeams() {
  const base = (i, name, choices) => ({ id: `d${i}`, name, color: C.TEAM_COLORS[i - 1], choices, touched: {}, submitted: {}, scores: {}, pitch: {}, visits: {}, sims: {}, plans: {}, reviews: {}, briefRead: Object.fromEntries(IDS.map((id) => [id, 1])), attempts: {}, previous: {} })
  return [
    base(1, "Demo Racing", { ...C.REFERENCE_BUILD }),
    base(2, "Pretend GP", { ...C.REFERENCE_BUILD, link: "single", cooling: "air", power: "boost" }),
    base(3, "Sample Motorsport", {}),
  ]
}

const stationChoices = (choices, id) => Object.fromEntries(C.decisionsFor(id).map((d) => [d.id, choices[d.id]]).filter(([, v]) => v !== undefined))

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
  const at = (id) => DEMO_STEPS.findIndex((x) => x.id === id)
  if (step.id === "pitch") {
    focus.plans[STATION] = buildPlan(focus, STATION, { id: "DEMO1", at: Date.now(), budget: C.DEFAULT_BUDGET })
    focus.attempts[STATION] = 1
    state.queues[STATION] = [{ team: focus.id, at: Date.now() - 45_000 }]
  }
  if (step.id === "reject") {
    /* The first design (the office NAS starving the nodes) was rejected: the dials are open again with ghosts. */
    focus.previous[STATION] = { ...NEARLY }
    focus.reviews[STATION] = { status: "rejected", by: C.byId(C.STATIONS, STATION).architect, at: Date.now() - 60_000, reason: REJECT_REASON, attempt: 1 }
    focus.attempts[STATION] = 1
    for (const key of Object.keys(stationChoices(focus.choices, STATION))) delete focus.choices[key]
  }
  if (step.id === "approve") {
    focus.previous[STATION] = { ...NEARLY }
    focus.plans[STATION] = buildPlan(focus, STATION, { id: "DEMO2", at: Date.now(), budget: C.DEFAULT_BUDGET })
    focus.attempts[STATION] = 2
    state.pitches[STATION] = { team: focus.id, startedAt: Date.now(), endsAt: Date.now() + 30_000, by: C.byId(C.STATIONS, STATION).architect, attempt: 2 }
    state.architects[STATION] = { available: false, busyWith: focus.id }
    focus.reviews = approved(focus, ["oem", "dc"])
    focus.attempts.oem = 1
    focus.attempts.dc = 1
    second.reviews = approved(second, ["compute"])
    second.attempts.compute = 1
  }
  if (i >= at("race")) {
    focus.reviews = { ...approved(focus, IDS), [STATION]: approved(focus, [STATION], 2)[STATION] }
    focus.attempts = { ...Object.fromEntries(IDS.map((id) => [id, 1])), [STATION]: 2 }
    focus.previous[STATION] = { ...NEARLY }
    second.reviews = approved(second, ["network", "compute"])
    second.attempts = { network: 1, compute: 1 }
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
