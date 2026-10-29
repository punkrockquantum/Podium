import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate, effectiveTeam, completedStations } from "../public/js/model.js"
import { simulateStation, simulateTeam, bandFor, REFERENCE_BUILD } from "../public/js/sim.js"
import { GOOD, ROUTES, stationDefaults } from "./builds.js"

const STATION_IDS = C.STATIONS.map((s) => s.id)

test("bands: optimised from 80, competitive from 60", () => {
  assert.equal(bandFor(80), "Optimised")
  assert.equal(bandFor(79), "Competitive")
  assert.equal(bandFor(60), "Competitive")
  assert.equal(bandFor(59), "Needs work")
})

for (const rank of [5, 7, 9]) {
  test(`P${rank}: every table has at least two different optimised builds, and its defaults are not optimised`, () => {
    for (const id of STATION_IDS) {
      const routes = Object.entries(ROUTES[id])
      const optimised = routes.filter(([, choices]) => simulateStation({ rank, choices: { ...GOOD, ...choices } }, {}, id).score >= 80)
      assert.ok(optimised.length >= 2, `${id}: only ${optimised.map(([name]) => name)} reach 80`)
      const distinct = new Set(optimised.map(([, choices]) => JSON.stringify(choices)))
      assert.equal(distinct.size, optimised.length)
      const defaults = simulateStation({ rank, choices: { ...GOOD, ...stationDefaults(id) } }, {}, id)
      assert.ok(defaults.score < 80, `${id} defaults scored ${defaults.score}`)
      assert.notEqual(defaults.band, "Optimised")
      assert.ok(defaults.hints.length >= 1 && defaults.hints.length <= 3, `${id} defaults should come with 1–3 hints`)
    }
  })
}

test("an all-default team is not optimised anywhere; the reference build is optimised everywhere", () => {
  const blank = simulateTeam({ rank: 7, choices: {} }, {}, STATION_IDS)
  for (const id of STATION_IDS) assert.ok(blank.stations[id].score < 80, `${id} default ${blank.stations[id].score}`)
  assert.ok(blank.score < 70)
  const good = simulateTeam({ rank: 7, choices: REFERENCE_BUILD }, {}, STATION_IDS)
  for (const id of STATION_IDS) assert.ok(good.stations[id].score >= 80, `${id} reference ${good.stations[id].score}`)
  assert.equal(good.band, "Optimised")
  assert.ok(good.race.aeroIndex > blank.race.aeroIndex && good.race.strategy > blank.race.strategy)
})

test("hints point at the problem without giving the answer", () => {
  const r = simulateStation({ rank: 7, choices: { ...GOOD, ...stationDefaults("ai") } }, {}, "ai")
  const optionNames = C.DECISIONS.filter((d) => d.station === "ai").flatMap((d) => (d.options || []).map((o) => o.name))
  for (const hint of r.hints) for (const name of optionNames) assert.ok(!hint.includes(name), `hint names an option: ${hint}`)
  assert.ok(r.hints.some((h) => /fit|memory|HBM/i.test(h)))
})

test("simulation uses the same evaluation as the race", () => {
  const team = { rank: 6, choices: { ...GOOD, cpu: "grace" } }
  const ev = evaluate(team)
  assert.deepEqual(simulateStation(team, {}, "compute", ev), simulateStation(team, {}, "compute"))
  assert.equal(simulateTeam(team, {}).race.aeroIndex, ev.aero.index)
})

test("tables that are not approved race on their defaults", () => {
  const approvedAt = (ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved" }]))
  const team = { rank: 7, choices: { ...GOOD }, submitted: { compute: 1, ai: 1, dc: 1 }, plans: { dc: { id: "LOCKD" } }, reviews: { ...approvedAt(["compute", "ai"]), storage: { status: "sentBack", reason: "Too slow" } } }
  assert.deepEqual(completedStations(team), ["compute", "ai"], "locked in is not enough: only approved tables count")
  const raced = effectiveTeam(team)
  assert.deepEqual(raced.notApproved, ["dc", "storage"])
  assert.deepEqual(raced.missed, ["network", "governance"])
  for (const d of C.DECISIONS) {
    if (["compute", "ai"].includes(d.station)) assert.equal(raced.choices[d.id], GOOD[d.id], d.id)
    else assert.equal(raced.choices[d.id], undefined, d.id)
  }
  const full = evaluate({ ...team, reviews: approvedAt(STATION_IDS) })
  const partial = evaluate(raced)
  assert.ok(partial.strategy < full.strategy)
  assert.ok(partial.penalties.length > full.penalties.length)
})

test("defaults are deliberately sub-optimal on every table", () => {
  const ev = evaluate({ rank: 7, choices: {} })
  assert.equal(ev.ai.memory.state, "offload", "400B in FP32 on 80 GB parts cannot fit")
  assert.ok(ev.penalties.some((p) => p.id === "tunnels"), "a single tunnel breaches FIA 5.3")
  assert.ok(ev.power.pue > 1.3, "air-cooled hall")
  assert.ok(ev.penalties.some((p) => ["segaudit", "logs", "curfew"].includes(p.id)))
})
