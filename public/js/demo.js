/**
 * Demo mode: a narrated walkthrough with a pretend game for the one customer. Pure: it builds a
 * fake state for each step and never touches the real game.
 */
import * as C from "./catalog.js"
import { evaluate } from "./model.js"
import { runRace, finaleEntries } from "./race.js"
import { buildPlan } from "./plandata.js"

export const DEMO_STEPS = [
  { id: "brief", screen: "brief", title: "1. The table opens on the brief", narration: `Nothing is set up first: the ${C.CUSTOMER_TEAM.name} is already in the game, and each of its four iPads opens straight on that table's brief: the situation, the targets with their numbers, the FIA rules, the customer's requirements and both cap lines, what each setting does, and every term explained. Tune and Pitch stay closed until the table taps “I've read the brief”, which unlocks at the end of the brief or after 30 seconds. The warning is the point: each choice locks the moment you tap it.` },
  { id: "tune", screen: "tuneOff", title: "2. Tune: one tap locks a dial", narration: "No Lock-in button, no confirmation, no undo. The first tap on a dial locks it: the padlock appears, the other settings go quiet and the counter reads Locked 1 of 3. The scene, the gauges, the cap bars and the seconds found per lap update at once, so the table sees the consequence immediately. Tap a dial, or Lock a dial for me." },
  { id: "zone", screen: "tuneOn", title: "3. In the zone", narration: "Every gauge is green and every bar is under its cap line: the airflow is smooth and the tunnel shows the lap time found. In the zone is worth 0.25–0.35 s per lap; a cap or FIA breach is not allowed and finds nothing. When the third dial locks, the table locks itself." },
  { id: "pitch", screen: "plan", title: "4. All three locked: call the Solutions Architect", narration: "With all three locked the only step left is Call the Solutions Architect. The table joins the SA's queue (the SA may be busy at another table) and pitches for 30 seconds: why each choice helps the customer and how a provider helps." },
  { id: "reject", screen: "rejected", title: "5. Rejected: adjust and call again", narration: "The SA rejected the design with a short reason, shown on the table's iPad. Only this table's dials reopen, with last time's picks shown as dashed “last time” ghosts. Each new tap locks instantly; three locks make attempt 2 and the table calls the SA again. That costs time, which is the lesson." },
  { id: "approve", screen: "architect", title: "6. The Solutions Architect approves", narration: "The SA sees the board exactly as the table locked it, which attempt this is, and the table's brief; starts the 30-second pitch; then taps Approve or Reject. The host's grid shows each of the four tables: status, attempt, seconds found, FIT and whether it is approved, and the total the race will use." },
  { id: "race", screen: "race", title: "7. The race (30 s): the 2027 plan against today", narration: `Two cars over ${C.FINALE.laps} laps at Austin: the ${C.CUSTOMER_TEAM.name}'s 2027 plan, whose pace is the seconds found per lap across the approved tables, against today's Hinwil setup at 0.00 s, plus race incidents. The host runs it whenever the room is ready, with or without a timer. Anything not approved by then, including a table still adjusting after a rejection, races on today's setup, and the incidents name the dial that caused them.` },
  { id: "readout", screen: "readout", title: "8. The readout", narration: "One readout for the customer: You found X s per lap; after 56 laps the 2027 plan finished so many seconds ahead of today's Hinwil setup. Then each table's final scene with its story (Approved on the second attempt), the lessons, what to do differently (naming the dial and how a provider helps) and the 2028 path." },
]

const IDS = C.STATIONS.map((s) => s.id)
const STATION = "compute"
/** A CFD board one dial short of the zone: sized to the MAUh allowance, but the office NAS starves the nodes. */
export const NEARLY = { size: "medium", chips: "cpu", storage: "basic" }
const REJECT_REASON = "Storage starves the nodes: the cluster waits for data"

const approved = (team, ids, attempt = 1) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: C.byId(C.STATIONS, id).architect, at: 0, attempt, points: C.tablePoints(evaluate(team, C.DEFAULT_BUDGET, IDS).fit[id], true) }]))

/** The pretend customer: the same team the server creates, with the reference build on its dials. */
function pretendCustomer() {
  return { id: C.CUSTOMER_TEAM.id, name: C.CUSTOMER_TEAM.name, color: C.CUSTOMER_TEAM.color, choices: { ...C.REFERENCE_BUILD }, touched: {}, submitted: {}, scores: {}, pitch: {}, visits: {}, sims: {}, plans: {}, reviews: {}, briefRead: Object.fromEntries(IDS.map((id) => [id, 1])), attempts: {}, previous: {} }
}

const stationChoices = (choices, id) => Object.fromEntries(C.decisionsFor(id).map((d) => [d.id, choices[d.id]]).filter(([, v]) => v !== undefined))

export function buildDemo(index) {
  const i = Math.max(0, Math.min(DEMO_STEPS.length - 1, Number(index) || 0))
  const step = DEMO_STEPS[i]
  const focus = pretendCustomer()
  if (step.id === "brief") focus.choices = {}
  if (step.id === "tune") focus.choices = { ...focus.choices, ...NEARLY }
  const state = {
    id: "demo",
    version: 1,
    settings: { budget: C.DEFAULT_BUDGET, stations: IDS },
    /* The pretend session is open and untimed, as a real one is until the host starts the timer. */
    clock: { status: ["race", "readout"].includes(step.id) ? "ended" : "open", totalMs: 0, endsAt: null, remainingMs: null, endedAt: null, endedBy: null, pausedAt: null },
    readout: step.id === "readout" ? { startedAt: Date.now() } : null,
    tables: { [STATION]: { team: focus.id, since: Date.now() } },
    queues: {},
    architects: { [STATION]: { available: true } },
    pitches: {},
    teams: [focus],
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
    /* Two other tables already approved; the network table is locked and waiting for its SA. */
    focus.reviews = approved(focus, ["oem", "dc"])
    focus.attempts.oem = 1
    focus.attempts.dc = 1
    focus.attempts.network = 1
    for (const id of ["oem", "dc", "network"]) focus.plans[id] = buildPlan(focus, id, { id: `DEMO-${id}`, at: Date.now(), budget: C.DEFAULT_BUDGET })
    for (const id of ["oem", "dc"]) focus.pitch[id] = focus.reviews[id].points
    state.queues.network = [{ team: focus.id, at: Date.now() - 20_000 }]
  }
  if (i >= at("race")) {
    focus.reviews = { ...approved(focus, IDS), [STATION]: approved(focus, [STATION], 2)[STATION] }
    focus.attempts = { ...Object.fromEntries(IDS.map((id) => [id, 1])), [STATION]: 2 }
    focus.previous[STATION] = { ...NEARLY }
    for (const id of Object.keys(focus.reviews)) {
      focus.pitch[id] = focus.reviews[id].points
      focus.plans[id] ||= buildPlan(focus, id, { id: `D${id}`, at: Date.now(), budget: C.DEFAULT_BUDGET })
    }
    state.queues = {}
    state.race = { seed: "demo", ranAt: Date.now(), ranBy: "demo", budget: C.DEFAULT_BUDGET, result: runRace(finaleEntries(focus, C.DEFAULT_BUDGET, IDS), "demo", IDS) }
  }
  return { index: i, total: DEMO_STEPS.length, step, state, focus: { team: focus.id, station: STATION } }
}
