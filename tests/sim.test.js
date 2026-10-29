import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { simulateStation, simulateTeam, REFERENCE_BUILD } from "../public/js/sim.js"
import { designSummary } from "../public/js/summary.js"
import { ROUTES, GOOD } from "./routes.js"

test("the reference build is Optimised at every table for every tier", () => {
  for (const tier of C.TIERS) {
    for (const s of C.STATIONS) {
      const r = simulateStation({ tier: tier.id, choices: REFERENCE_BUILD }, s.id)
      assert.equal(r.band, "Optimised", `${tier.name} at ${s.id}: ${r.score}`)
    }
  }
})

test("at least two different optimised routes at every table, for every tier", () => {
  for (const [stationId, routes] of Object.entries(ROUTES)) {
    for (const tier of C.TIERS) {
      const optimised = Object.entries(routes).filter(([, choices]) => simulateStation({ tier: tier.id, choices: { ...GOOD, ...choices } }, stationId).score >= 80)
      assert.ok(optimised.length >= 2, `${stationId} for ${tier.name}: ${optimised.map(([name]) => name).join(", ")}`)
      const distinct = new Set(optimised.map(([, choices]) => JSON.stringify(choices)))
      assert.equal(distinct.size, optimised.length)
    }
  }
})

test("the defaults are not optimised anywhere", () => {
  for (const tier of C.TIERS) {
    for (const s of C.STATIONS) {
      const r = simulateStation({ tier: tier.id, choices: {} }, s.id)
      assert.notEqual(r.band, "Optimised", `${s.id} defaults for ${tier.name}: ${r.score}`)
    }
  }
})

test("one score, one sentence and one hint per table", () => {
  const r = simulateStation({ choices: { link: "single" } }, "network")
  assert.ok(r.score >= 0 && r.score <= 100)
  assert.match(r.sentence, /^Connectivity is (optimised|competitive|needs work) at \d+%/)
  assert.equal(typeof r.hint, "string")
  assert.match(r.hint, /cut fibre|FIA/)
  assert.ok(!/redundant|Redundant/.test(r.hint), "a hint points at the problem without naming the answer")
  const team = simulateTeam({ choices: REFERENCE_BUILD })
  assert.equal(Object.keys(team.stations).length, 4)
})

test("the Architect's summary explains the three choices and their consequences", () => {
  const s = designSummary({ tier: 1, choices: GOOD }, "oem")
  assert.equal(s.sentences.length, 3)
  assert.match(s.sentences[0], /^Vendor: Dell, HPE or Lenovo\./)
  assert.ok(s.consequences.some((line) => /as-a-service/.test(line)))
  assert.ok(s.consequences.some((line) => /Team ledger: CapEx/.test(line)))
  assert.equal(s.parts.length, 4)
})
