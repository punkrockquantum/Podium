import { test } from "node:test"
import assert from "node:assert/strict"
import { evaluate, effectiveTeam } from "../public/js/model.js"
import { runRace, LAPS } from "../public/js/race.js"
import { REFERENCE_BUILD } from "../public/js/sim.js"

const STATIONS = ["compute", "ai", "dc", "storage", "network", "governance"]

function entries() {
  const teams = [
    { id: "t1", name: "Smart", color: "#f00", rank: 7, choices: { clock: "lock85", solver: "surrogate", geometry: "disciplined", platform: "b300", tgp: "eco85", hall: "L", dataTier: "nvme", kv: "on", hosts: "dpu", wan: "fabric", wanBackup: "public", hqLink: "fiber", fabric: "ib", edge: 2, telemetry: "compress", dataflow: "diode", segregation: "zerotrust", workforce: "lockout", curfew: "auto", logs: "worm", pfs: "lustre", pfsPB: 2, archive: "tape" } },
    { id: "t2", name: "Default", color: "#0f0", rank: 7, choices: {} },
    { id: "t3", name: "Cheater", color: "#00f", rank: 7, choices: { telemetry: "fpga", dataflow: "bidir" } },
  ]
  return teams.map((t) => ({ ...t, pitch: {}, evaluation: evaluate(t) }))
}

test("the race is deterministic for a seed", () => {
  const a = runRace(entries(), "seed-1", STATIONS)
  const b = runRace(entries(), "seed-1", STATIONS)
  assert.deepEqual(a, b)
  assert.equal(a.lapOrder.length, LAPS)
  assert.equal(a.results.length, 3)
})

test("the disciplined build out-scores the defaults across seeds", () => {
  let wins = 0
  for (let i = 0; i < 20; i += 1) {
    const r = runRace(entries(), `s${i}`, STATIONS)
    const score = Object.fromEntries(r.standings.map((s) => [s.id, s.score]))
    if (score.t1 > score.t2) wins += 1
  }
  assert.ok(wins >= 16, `smart beat default in ${wins}/20`)
})

const approved = (ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: "Leader" }]))

test("tables that were not approved cost the team in the race", () => {
  const full = { id: "full", name: "Full", color: "#f00", rank: 7, choices: REFERENCE_BUILD, reviews: approved(STATIONS), pitch: {} }
  const late = { ...full, id: "late", name: "Late", reviews: approved(["compute", "ai", "dc"]), plans: { storage: { id: "X" } } }
  let fullAhead = 0
  for (let k = 0; k < 20; k++) {
    const result = runRace([full, late].map((t) => ({ ...t, evaluation: evaluate(effectiveTeam(t, STATIONS)) })), `missed-${k}`, STATIONS)
    const [a, b] = ["full", "late"].map((id) => result.results.find((r) => r.id === id))
    if (a.position < b.position) fullAhead += 1
  }
  assert.ok(fullAhead >= 16, `full build ahead in ${fullAhead}/20 races`)
  const raced = effectiveTeam(late, STATIONS)
  assert.deepEqual(raced.notApproved, ["storage"], "locked in but not approved")
  assert.deepEqual(raced.missed, ["network", "governance"], "never locked in")
})
