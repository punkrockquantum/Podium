import test from "node:test"
import assert from "node:assert/strict"
import {
  STRATEGIES, STRATEGY_ORDER, SEASONS, COMMON, ENVELOPE, TRANSITIONAL, strategyByKey, planInputs, planFromInputs, sharedOf,
  evaluateStrategy, evaluateStrategies, evaluatePlan, envelopeEvaluate, envelopeCheck, simulateWithEstate, summary, clearStrategyCache,
} from "../public/js/sim/strategies.js"
import { K } from "../public/js/sim/assumptions.js"
import { CONTROLS, normalize, simulate, evaluate, presetInputs, todayInputs } from "../public/js/sim/model.js"

const walk = (node, path, visit) => {
  if (node === null || node === undefined || typeof node !== "object") return visit(path, node)
  if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`, visit))
  Object.entries(node).forEach(([k, x]) => walk(x, `${path}.${k}`, visit))
}
const assertNoNaN = (node, label) => walk(node, label, (path, v) => { if (typeof v === "number") assert.ok(!Number.isNaN(v), `${path} is NaN`) })

// Headline seconds per lap at P8, 60 % confidence (strategies brief 2.4)
const HEADLINE = { A: { 2027: 0.14, 2028: 0.37 }, B: { 2027: 0.22, 2028: 0.47 }, C: { 2027: 0.19, 2028: 0.46 } }

test("strategies: the decision tables of brief 2.1 are transcribed exactly", () => {
  assert.deepEqual(STRATEGY_ORDER, ["A", "B", "C"])
  assert.deepEqual(Object.values(STRATEGIES).map((s) => s.id), ["consolidate", "density", "efficient"])
  for (const k of STRATEGY_ORDER) {
    const s = STRATEGIES[k]
    assert.equal(s.key, k)
    assert.ok(s.name.startsWith(`${k} · `) && s.tagline && s.story, `${k} has a name, tagline and story`)
    assert.ok(Array.isArray(s.timeline) && s.timeline.length >= 4 && s.timeline.every((t) => t.when && t.what))
    assert.ok(Array.isArray(s.risks) && s.risks.length >= 3)
    assert.ok(s.provides.dr.length >= 3 && s.provides.hpe.length >= 2)
    assert.ok(s.openQuestions.length >= 2 && s.cutover[2027] && s.cutover[2028])
    assert.equal(s.shared.location, "dr")
    assert.equal(s.shared.committedKW, 500)
    assert.equal(s.shared.expansionRight, false)
    assert.equal(s.shared.redundancy, "2n")
    assert.equal(s.shared.fibrePairs, 2)
    assert.equal(s.shared.fibreGbps, 100)
    assert.equal(s.shared.edge, true)
    for (const [key, value] of Object.entries(COMMON)) assert.equal(s.shared[key], value, `${k}.shared.${key}`)
    for (const y of SEASONS) {
      assert.equal(s[y].coresPerNode, 128)
      assert.equal(s[y].memoryGB, 768)
      assert.equal(s[y].gpuModel, "b200")
      assert.equal(s[y].solverGpus <= s[y].gpus, true)
    }
    assert.equal(s[2027].solverGpus, 0)
    assert.equal(s[2027].leadWeeks, 0)
    // every shared and season value is a legal value of the committed control, or a pending control
    for (const [id, value] of [...Object.entries(s.shared), ...Object.entries(s[2027]), ...Object.entries(s[2028])]) {
      const c = CONTROLS[id]
      if (!c) { assert.ok(["mlPartitionKW", "mlPlacement"].includes(id), `${k}: unknown input ${id}`); continue }
      if (c.type === "toggle") assert.equal(typeof value, "boolean", `${k}.${id}`)
      else if (c.type === "range") assert.ok(value >= c.min && value <= c.max, `${k}.${id} = ${value} out of range`)
      else assert.ok(c.options.some((o) => o.value === value), `${k}.${id} = ${value} not an option`)
    }
  }
  const A = STRATEGIES.A, B = STRATEGIES.B, C = STRATEGIES.C
  assert.deepEqual([A.shared.cooling, A.shared.rackKW, A.shared.consumption, A.shared.support, A.shared.trackside, A.shared.cloudOnRamp], ["reardoor", 30, "buy", "4h", "dual", false])
  assert.deepEqual([B.shared.cooling, B.shared.rackKW, B.shared.consumption, B.shared.committedPct, B.shared.termYears, B.shared.support, B.shared.trackside, B.shared.cloudOnRamp], ["dlc", 70, "greenlake", 80, 5, "mission", "dualsat", true])
  assert.deepEqual([C.shared.cooling, C.shared.rackKW, C.shared.consumption, C.shared.committedPct, C.shared.termYears, C.shared.support, C.shared.trackside, C.shared.cloudOnRamp], ["reardoor", 30, "greenlake", 100, 5, "4h", "dual", true])
  assert.deepEqual([A[2027].nodes, A[2028].nodes, B[2027].nodes, B[2028].nodes, C[2027].nodes, C[2028].nodes], [12, 12, 18, 3, 18, 11])
  assert.deepEqual([A[2027].clockGHz, B[2027].clockGHz, C[2027].clockGHz], [3.7, 2.4, 2.4])
  assert.deepEqual([A[2027].interconnect, B[2027].interconnect, C[2027].interconnect], ["ibndr", "slingshot", "ibndr"])
  assert.deepEqual([A[2027].storage, B[2027].storage, C[2027].storage], ["pfs", "flash", "pfs"])
  assert.deepEqual([A[2028].gpus, A[2028].solverGpus, B[2028].gpus, B[2028].solverGpus, C[2028].gpus, C[2028].solverGpus], [4, 0, 16, 4, 4, 2])
  assert.deepEqual([A[2027].refreshYears, B[2027].refreshYears, C[2027].refreshYears], [4, 3, 4])
  assert.deepEqual([A[2028].leadWeeks, B[2028].leadWeeks, C[2028].leadWeeks], [-4, -6, -4])
  assert.deepEqual([B[2028].mlPartitionKW, B[2028].mlPlacement, C[2027].mlPlacement, C[2028].mlPlacement], [50, "dr", "cloud", "cloud"])
  assert.equal(strategyByKey("density"), B)
  assert.equal(strategyByKey("Z"), null)
  assert.ok(Object.isFrozen(STRATEGIES) && Object.isFrozen(A.shared))
})

test("strategies: the envelope constants follow the committed K and the brief", () => {
  assert.equal(TRANSITIONAL, !(K.facility.envelopeKW && K.facility.estateBaseKW))
  assert.equal(ENVELOPE.drOfferKW, 500)
  assert.equal(ENVELOPE.baseEstateKW, 375)
  assert.deepEqual(ENVELOPE.demandEstateKW, { 2027: 375, 2028: 760 })
  assert.deepEqual(ENVELOPE.coolingMaxKWPerRack, { air: 20, reardoor: 70, dlc: 150 })
  assert.deepEqual(ENVELOPE.ccfFloorGHz, { 64: 2.4, 96: 2.3, 128: 2.4, 192: 2.25 })
  assert.equal(ENVELOPE.cageRackPositions, 60)
  assert.equal(ENVELOPE.estateRackKW, 8)
  assert.equal(ENVELOPE.capChargeMaxCHF, 4_000_000)
  assert.equal(ENVELOPE.liquidRowsCHF, 450_000)
})

test("strategies: all three fit the envelope in both seasons with no warn/bad flags", () => {
  for (const k of STRATEGY_ORDER) {
    const r = evaluateStrategy(k)
    assert.equal(r.fits, true, `${k} fits`)
    assert.equal(r.ok, true, `${k} passes the guard-rails`)
    for (const y of SEASONS) {
      const e = r[y].envelope
      assert.deepEqual(e.reasons, [], `${k} ${y}`)
      assert.deepEqual(e.guardrails, [], `${k} ${y}`)
      assert.ok(e.drIT <= 500 && e.headroomKW > 0, `${k} ${y}: ${e.drIT} kW`)
      assert.ok(e.racks.total <= 60)
      assert.equal(r[y].scenario.status, "ok", `${k} ${y} status ${r[y].scenario.status}`)
      assert.deepEqual(r[y].summary.flags, [], `${k} ${y} flags`)
      assert.ok(r[y].scenario.comp.usage <= 1 && r[y].scenario.comp.usage > 0.95, `${k} ${y}: allowance ${r[y].scenario.comp.usage}`)
      assert.ok(r[y].scenario.money.capCharge < 4e6)
      assertNoNaN(r[y].summary, `${k} ${y} summary`)
      assert.equal(r[y].inputs.expansionRight, false)
    }
  }
})

test("strategies: headline seconds reproduce brief 2.4 within ±0.01 s (P8, 60 %), and the other key outputs", () => {
  const row = (r, y) => r[y].summary
  for (const k of STRATEGY_ORDER) {
    const r = evaluateStrategy(k)
    for (const y of SEASONS) assert.ok(Math.abs(r[y].perf.sec - HEADLINE[k][y]) <= 0.01, `${k} ${y}: ${r[y].perf.sec} vs ${HEADLINE[k][y]}`)
  }
  const A = evaluateStrategy("A"), B = evaluateStrategy("B"), C = evaluateStrategy("C")
  // kW at Digital Realty of 500 and the headroom
  assert.ok(Math.abs(row(A, 2027).drIT - 399) < 1 && Math.abs(row(A, 2028).drIT - 404) < 1)
  assert.ok(Math.abs(row(B, 2027).drIT - 401) < 1 && Math.abs(row(B, 2028).drIT - 459) < 1)
  assert.ok(Math.abs(row(C, 2027).drIT - 399) < 1 && Math.abs(row(C, 2028).drIT - 399) < 1)
  assert.ok(Math.abs(row(B, 2028).drHeadroomKW - 40.6) < 0.2)
  assert.equal(row(B, 2028).mlPartitionKW, 50)
  assert.equal(row(C, 2028).mlPartitionKW, 0, "C's ML partition is in the cloud: no kW")
  // cap charges and TCO (B carries the † liquid-rows one-off)
  assert.ok(Math.abs(row(A, 2027).capCHF - 2.20e6) < 0.02e6 && Math.abs(row(A, 2028).capCHF - 2.27e6) < 0.02e6)
  assert.ok(Math.abs(row(B, 2027).capCHF - 2.59e6) < 0.02e6 && Math.abs(row(B, 2028).capCHF - 2.55e6) < 0.02e6)
  assert.ok(Math.abs(row(C, 2027).capCHF - 2.42e6) < 0.02e6 && Math.abs(row(C, 2028).capCHF - 2.33e6) < 0.02e6)
  assert.ok(Math.abs(row(B, 2027).oneOffCHF - 1.85e6) < 0.01e6 && Math.abs(row(B, 2027).tco3CHF - 11.08e6) < 0.02e6)
  assert.ok(Math.abs(row(A, 2027).oneOffCHF - 1.40e6) < 0.01e6 && Math.abs(row(A, 2027).tco3CHF - 9.79e6) < 0.02e6)
  assert.ok(B[2027].scenario.money.oneOffs.some((o) => o.id === "liquidrows" && o.cap === "excluded"))
  assert.ok(!A[2027].scenario.money.oneOffs.some((o) => o.id === "liquidrows"))
  // effective MAUh, PUE, availability, strategy points, positions
  assert.ok(Math.abs(row(A, 2027).effMauh - 6.16) < 0.01 && Math.abs(row(B, 2027).effMauh - 7.71) < 0.01 && Math.abs(row(C, 2028).effMauh - 7.65) < 0.01)
  assert.deepEqual([row(A, 2027).pue, row(B, 2027).pue, row(C, 2027).pue], [1.25, 1.15, 1.25])
  assert.ok(row(A, 2027).availabilityPct > 99.97 && row(B, 2028).availabilityPct > 99.98)
  for (const r of [A, B, C]) for (const y of SEASONS) assert.equal(r[y].perf.strategyPoints, 1.3)
  assert.deepEqual([A[2028].perf.scenarioPosition, B[2028].perf.scenarioPosition, C[2028].perf.scenarioPosition], [5, 5, 5], "2028 positions saturate at P5 (L8)")
  assert.ok(Math.abs(A[2027].perf.scenarioPosition - 6.63) < 0.02 && Math.abs(B[2027].perf.scenarioPosition - 5.76) < 0.02)
  // order of ambition A < C < B on 2027 lap time
  assert.ok(A[2027].perf.sec < C[2027].perf.sec && C[2027].perf.sec < B[2027].perf.sec)
  // Today stays power-short at the committed demand estate
  const today = A[2027].today
  assert.ok(today.fac.powerShortKW > 90 && A[2028].today.fac.powerShortKW > 470)
})

test("strategies: the transitional wrapper restores K and leaves the committed evaluate() untouched", () => {
  const before = JSON.stringify(K.facility.restOfEstateKW)
  const committedBefore = evaluate(presetInputs("gl2028")).perf.sec
  evaluateStrategies()
  envelopeEvaluate({ ...planInputs(STRATEGIES.B, 2028), nodes: 40 })
  assert.throws(() => simulateWithEstate({ ...planInputs(STRATEGIES.B, 2028), get season() { throw new Error("boom") } }))
  assert.equal(JSON.stringify(K.facility.restOfEstateKW), before, "constants restored even when the model throws")
  assert.equal(evaluate(presetInputs("gl2028")).perf.sec, committedBefore)
  // the scenario sees the base estate, Today the demand estate
  const r = envelopeEvaluate(planInputs(STRATEGIES.A, 2028))
  assert.ok(Math.abs(r.scenario.fac.drIT - (375 + r.scenario.hw.clusterKW)) < 0.2)
  assert.ok(Math.abs(r.today.fac.hinwilIT - (760 + r.today.hw.clusterKW)) < 0.2)
  assert.equal(r.scenario.envelope, r.envelope)
  assert.equal(r.perf.confidence, 60)
  assert.ok(Math.abs(r.perf.secExact - r.perf.sec) < 0.0005 && Math.abs(r.perf.pointsExact - r.perf.points) < 0.05)
  // a Today-shaped scenario through the wrapper is Today: zero seconds, soft power shortfall, no fit failure
  const t = envelopeEvaluate(todayInputs(2028))
  assert.equal(t.perf.sec, 0)
  assert.equal(t.envelope.fits, true)
  assert.equal(t.envelope.ok, false)
  assert.ok(t.envelope.guardrails[0].includes("Hinwil room short"))
})

test("strategies: envelopeCheck implements the fit rows of brief 1.2 with reason texts", () => {
  const b2028 = planInputs(STRATEGIES.B, 2028)
  const reasons = (inputs) => envelopeEvaluate(inputs).envelope.reasons
  assert.ok(reasons({ ...b2028, mlPartitionKW: 100 }).some((s) => /Digital Realty: \d+ kW > 500 kW offer/.test(s)), "power at DR")
  assert.ok(reasons({ ...b2028, cooling: "air", rackKW: 70 }).some((s) => /70 kW racks exceed the 20 kW air ceiling/.test(s)), "rack density")
  assert.ok(reasons({ ...b2028, expansionRight: true }).some((s) => /Expansion right is not part of the 500 kW offer/.test(s)), "expansion right")
  assert.ok(reasons({ ...b2028, season: 2027 }).some((s) => /GPU solver not allowed in 2027/.test(s)), "solver GPUs before 2028")
  assert.ok(reasons({ ...b2028, clockGHz: 2.0 }).some((s) => /CCF 2 GHz below the 2.4 GHz base clock of a 128-core part/.test(s)), "CCF floor")
  assert.ok(reasons({ ...b2028, coresPerNode: 192, clockGHz: 2.3 }).length === 0, "192-core parts may declare 2.3 GHz")
  assert.ok(reasons({ ...b2028, location: "hybrid", mlPlacement: "hinwil", mlPartitionKW: 200 }).some((s) => /Hinwil keeps 350 kW against 300 kW/.test(s)), "power at Hinwil in hybrid")
  assert.ok(reasons({ ...b2028, mlPlacement: "cloud", cloudOnRamp: false }).some((s) => /cloud on-ramps/.test(s)), "cloud placement needs the on-ramps")
  assert.deepEqual(reasons({ ...b2028, mlPlacement: "cloud", cloudOnRamp: true }), [])
  // rack count: the estate takes 47 of the 60 positions at 8 kW; a big cluster plus an ML partition at 10 kW racks overflows
  const racks = envelopeEvaluate({ ...planInputs(STRATEGIES.B, 2028), cooling: "air", rackKW: 10, nodes: 40, gpus: 32, solverGpus: 4 }).envelope
  assert.equal(racks.racks.estate, 47)
  assert.ok(racks.racks.cluster >= 9 && racks.racks.ml === 5 && racks.racks.total > 60, JSON.stringify(racks.racks))
  assert.ok(racks.reasons.some((s) => /\d+ racks > 60 cage positions/.test(s)), racks.reasons.join("; "))
  // a direct simulate() result can be checked too (the preset's own expansion right, if it carries one, is a fit row of its own)
  const e = envelopeCheck(simulate({ ...presetInputs("dr2027"), expansionRight: false }))
  assert.equal(e.fits, true, e.reasons.join("; "))
  assert.equal(e.offerKW, 500)
  const over = envelopeCheck(simulate(presetInputs("gl2028")))
  assert.equal(over.fits, false, "the committed gl2028 with its 760 kW estate does not fit 500 kW")
  assert.ok(over.reasons.some((s) => /Digital Realty: \d+ kW > 500 kW offer/.test(s)))
  // the allowance and the cap guard-rail are guard-rails, not fit rows
  const g = envelopeEvaluate({ ...planInputs(STRATEGIES.A, 2027), nodes: 40 }).envelope
  assert.equal(g.fits, true)
  assert.ok(g.guardrails.some((s) => /allowance \d+ % > 100 %/.test(s)))
})

test("strategies: evaluatePlan takes any plan shape, follows position / confidence / venue, and accepts an injected model", () => {
  const prototypeShape = { ...STRATEGIES.A.shared, 2027: { ...STRATEGIES.A[2027], ml: 0 }, 2028: { ...STRATEGIES.A[2028], ml: 0 } }
  const a = evaluatePlan(prototypeShape)
  const b = evaluatePlan(STRATEGIES.A)
  for (const y of SEASONS) assert.equal(a[y].perf.sec, b[y].perf.sec)
  assert.deepEqual(sharedOf(prototypeShape).cooling, "reardoor")
  assert.equal(planInputs(STRATEGIES.B, 2028).mlPartitionKW, 50)
  assert.equal(planInputs({ shared: {}, 2028: { ml: 25 } }, 2028).mlPartitionKW, 25)

  const p10 = evaluateStrategy("B", { position: 10, confidence: 100 })
  assert.ok(p10[2028].perf.sec > evaluateStrategy("B")[2028].perf.sec)
  assert.equal(p10[2028].inputs.position, 10)
  assert.equal(evaluateStrategy("B", { venue: "melbourne" })[2027].scenario.net.venue.id, "melbourne")
  assert.equal(evaluateStrategy("B"), evaluateStrategy("B"), "memoised for the default model")
  clearStrategyCache()
  assert.notEqual(evaluateStrategy("B"), p10)

  // the committed evaluate() as evaluateFn: degrades gracefully (no envelope → envelopeCheck on the scenario)
  const viaModel = evaluatePlan(STRATEGIES.A, { evaluateFn: evaluate })
  assert.equal(viaModel[2027].perf.sec, 0.137)
  assert.equal(viaModel[2027].envelope.fits, true)
  assert.equal(viaModel[2028].envelope.fits, false, "without the estate re-split the committed model puts 760 kW at the campus")
  assert.equal(viaModel.fits, false)
  // a plan built from a single-season input set
  const plan = planFromInputs({ ...presetInputs("gl2028"), expansionRight: false, mlPartitionKW: 0 })
  const re = evaluatePlan(plan)
  assert.ok(re[2028].envelope.fits && Math.abs(re[2028].perf.sec - 0.43) < 0.01, "re-based gl2028 fits at +0.43 s")
  assert.ok(Math.abs(re[2028].envelope.drIT - 405) < 1)
  assert.ok(!re[2027].envelope.fits, "the same set in 2027 has solver GPUs before they are legal")
  assertNoNaN(summary(re[2028]), "summary")
})
