import test from "node:test"
import assert from "node:assert/strict"
import {
  DRIVERS, DRIVER_ORDER, HELD, OUTCOMES, attribute, waterfallSteps, checkCoverage, sumError, outcomesOf, clearAttributionCache,
} from "../public/js/sim/attribution.js"
import { CONTROLS, PRESET_ORDER, presetInputs, todayInputs, evaluate, normalize } from "../public/js/sim/model.js"
import { EXPLAIN } from "../public/js/sim/explain.js"
import { STRATEGIES, STRATEGY_ORDER, planInputs, envelopeEvaluate } from "../public/js/sim/strategies.js"

const walk = (node, path, visit) => {
  if (node === null || node === undefined || typeof node === "number" || typeof node === "string" || typeof node === "boolean") return visit(path, node)
  if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`, visit))
  if (typeof node === "object") return Object.entries(node).forEach(([k, x]) => walk(x, `${path}.${k}`, visit))
}
const assertFinite = (result, label) => walk(result, label, (path, value) => {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is ${value}`)
})
const EPS = 1e-9

test("attribution: twelve drivers in the display order, every control covered exactly once or held", () => {
  assert.equal(DRIVERS.length, 12)
  assert.deepEqual(DRIVER_ORDER, ["power", "cpuArch", "processor", "clock", "gpu", "data", "cooling", "resilience", "timing", "energy", "commercial", "connectivity"])
  assert.deepEqual(HELD, ["season", "position", "confidence", "venue"])
  const cov = checkCoverage()
  assert.deepEqual(cov.missing, [], `controls not in any driver: ${cov.missing}`)
  assert.deepEqual(cov.duplicates, [], `controls in two drivers: ${cov.duplicates}`)
  assert.deepEqual(cov.unknown, [], `driver inputs that are not controls: ${cov.unknown}`)
  assert.ok(DRIVERS.find((d) => d.id === "gpu").inputs.includes("mlPartitionKW"), "the ML partition travels with the GPU step-up")
  assert.ok(!DRIVERS.some((d) => d.inputs.includes("expansionRight")), "the expansion right is gone")
  assert.deepEqual(DRIVERS.find((d) => d.id === "cpuArch").inputs, ["cpuArch"])
  assert.deepEqual(OUTCOMES, ["sec", "aeroSec", "reinvestSec", "savedCHF", "effMauhDelta"], "no points or strategy-points column")
  for (const d of DRIVERS) assert.equal(d.label, EXPLAIN[`driver.${d.id}`].title, `${d.id}: bar label and explainer title agree`)
  for (const id of Object.keys(CONTROLS)) assert.ok(HELD.includes(id) || DRIVERS.some((d) => d.inputs.includes(id)), id)
})

test("attribution: Σ drivers == total per column (1e-9), no NaN, for all presets × seasons, and total == evaluate()", () => {
  for (const preset of PRESET_ORDER) for (const season of [2027, 2028]) {
    const plan = presetInputs(preset, season, { season })
    const r = attribute(plan, { cache: false })
    assertFinite(r.drivers, `${preset} ${season} drivers`)
    assertFinite(r.total, `${preset} ${season} total`)
    const err = sumError(r)
    for (const o of OUTCOMES) assert.ok(err[o] <= (o === "savedCHF" ? 1e-6 : EPS), `${preset} ${season} column ${o} off by ${err[o]}`)
    assert.ok(Math.abs(r.total.sec - evaluate(plan).perf.sec) < EPS, `${preset} ${season} total ≠ evaluate()`)
    for (const o of OUTCOMES) assert.ok(Math.abs(r.baseline[o]) < EPS, `${preset} ${season} baseline ${o} ≠ 0`)
    assert.equal(r.drivers.length, 12)
    assert.deepEqual(r.drivers.map((d) => d.id), DRIVER_ORDER)
    const shareSum = r.drivers.reduce((s, d) => s + d.share, 0)
    if (r.total.sec !== 0) assert.ok(Math.abs(shareSum - 1) < 1e-9, `${preset} ${season} shares sum to ${shareSum}`)
    for (const d of r.drivers) assert.ok(!("points" in d) && !("strategyPoints" in d), "no points on a bar")
    for (const d of r.drivers) if (d.pruned) for (const o of OUTCOMES) assert.equal(d[o], 0, `${d.id} pruned but non-zero ${o}`)
    assert.equal(r.method, "shapley")
    assert.equal(r.evaluations, 2 ** r.n)
  }
})

test("attribution: reproduces the brief's preset tables (dr2027 +0.137 over 8 drivers; gl2028 re-based to +0.425 over 11)", () => {
  const a = attribute(presetInputs("dr2027"), { cache: false })
  assert.equal(a.n, 8)
  assert.equal(a.evaluations, 256)
  assert.ok(Math.abs(a.total.sec - 0.137) < 0.0015)
  const row = (r, id) => r.drivers.find((d) => d.id === id)
  assert.ok(Math.abs(row(a, "power").sec - 0.084) < 0.002, "the move is the biggest bar")
  assert.ok(Math.abs(row(a, "data").sec - 0.035) < 0.002)
  assert.ok(Math.abs(row(a, "processor").sec - 0.030) < 0.002)
  assert.ok(row(a, "connectivity").sec < 0 && row(a, "connectivity").savedCHF < 0, "trackside costs lap time and money; its value is read in seconds to decide, not points")
  assert.ok(row(a, "clock").pruned && row(a, "gpu").pruned && row(a, "cpuArch").pruned && row(a, "commercial").pruned)
  const b = attribute(presetInputs("gl2028"), { cache: false })
  assert.equal(b.n, 11)
  assert.ok(Math.abs(b.total.sec - 0.425) < 0.0015, `gl2028 inside the 500 kW envelope: ${b.total.sec}`)
  assert.ok(Math.abs(row(b, "power").sec - 0.321) < 0.002 && Math.abs(row(b, "gpu").sec - 0.073) < 0.002 && Math.abs(row(b, "clock").sec + 0.060) < 0.002)
  assert.ok(Math.abs(row(b, "data").sec - 0.047) < 0.002 && Math.abs(row(b, "processor").sec - 0.036) < 0.002 && Math.abs(row(b, "cooling").sec - 0.036) < 0.002)
  assert.ok(row(b, "power").share > 0.7, "the move is three quarters of the 2028 gain")
})

test("attribution: order invariance — a shuffled driver table gives the same values", () => {
  const plan = presetInputs("gl2028")
  const a = attribute(plan, { cache: false })
  const shuffled = [...DRIVERS].reverse()
  const b = attribute(plan, { drivers: shuffled, cache: false })
  assert.deepEqual(b.drivers.map((d) => d.id), shuffled.map((d) => d.id))
  for (const d of a.drivers) {
    const e = b.drivers.find((x) => x.id === d.id)
    for (const o of OUTCOMES) assert.ok(Math.abs(d[o] - e[o]) <= 1e-9 * Math.max(1, Math.abs(d[o])), `${d.id}.${o}: ${d[o]} vs ${e[o]}`)
  }
  const w1 = attribute(plan, { method: "waterfall", cache: false })
  const w2 = attribute(plan, { method: "waterfall", order: [...DRIVER_ORDER].reverse(), cache: false })
  assert.equal(w1.method, "waterfall")
  assert.ok(Math.abs(w1.total.sec - w2.total.sec) < EPS, "both orders reach the same total")
  for (const o of OUTCOMES) assert.ok(sumError(w1)[o] < 1e-6 && sumError(w2)[o] < 1e-6)
  assert.ok(w1.drivers.some((d) => Math.abs(d.sec - w2.drivers.find((e) => e.id === d.id).sec) > 1e-4), "an ordered waterfall is path-dependent (the Shapley values are not)")
  assert.equal(w1.evaluations, w1.n + 1)
})

test("attribution: null player — a plan equal to Today gives all zeros, and only differing drivers are active", () => {
  for (const season of [2027, 2028]) {
    const r = attribute(todayInputs(season), { cache: false })
    assert.equal(r.n, 0)
    assert.equal(r.evaluations, 1)
    assert.equal(r.total.sec, 0)
    assert.ok(r.drivers.every((d) => d.pruned && d.sec === 0 && d.share === 0))
  }
  const one = attribute({ ...todayInputs(2027), storage: "pfs" }, { cache: false })
  assert.deepEqual(one.active, ["data"])
  assert.ok(one.drivers.find((d) => d.id === "data").sec > 0)
  assert.ok(Math.abs(one.drivers.find((d) => d.id === "data").share - 1) < EPS)
  // inputs that cannot act are not counted as changes (gpuModel with no GPUs, termYears when buying)
  const inert = attribute({ ...todayInputs(2027), gpuModel: "h200", termYears: 3, pueValue: 1.2 }, { cache: false })
  assert.equal(inert.n, 0)
})

test("attribution: monotone sanity — raising nodes within the allowance never lowers the clock driver's aero seconds", () => {
  // Today declares 12 × 128 cores at 3.7 GHz (98.8 % of the allowance), so room to add nodes exists only at a lower
  // declared clock: at the 2.4 GHz base clock the allowance carries 18 nodes.
  let previous = -Infinity
  for (let nodes = 12; nodes <= 18; nodes++) {
    const plan = { ...todayInputs(2027), clockGHz: 2.4, nodes }
    const r = attribute(plan, { cache: false })
    const clock = r.drivers.find((d) => d.id === "clock")
    assert.deepEqual(r.active, ["clock"])
    assert.ok(evaluate(plan).scenario.comp.usage <= 1, `nodes ${nodes} is within the allowance`)
    assert.ok(clock.aeroSec >= previous - 1e-6, `nodes ${nodes}: aero gain fell from ${previous} to ${clock.aeroSec}`)
    previous = clock.aeroSec
  }
  assert.ok(previous > 0, "18 slower nodes beat Today's 12 fast ones")
  // beyond the allowance the model throttles: extra nodes at Today's clock never gain (they only add overhead)
  for (const nodes of [13, 16, 24]) {
    const plan = { ...todayInputs(2027), nodes }
    assert.ok(evaluate(plan).scenario.comp.usage > 1)
    const clock = attribute(plan, { cache: false }).drivers.find((d) => d.id === "clock")
    assert.ok(clock.aeroSec <= 1e-6, `nodes ${nodes} at 3.7 GHz should not gain: ${clock.aeroSec}`)
  }
  const fewer = attribute({ ...todayInputs(2027), nodes: 6 }, { cache: false })
  assert.ok(fewer.drivers.find((d) => d.id === "clock").aeroSec < 0, "fewer nodes than Today is a loss on the clock bar")
})

test("attribution: the 2028 preset attributes in under 150 ms", () => {
  const plan = presetInputs("gl2028")
  attribute(plan, { cache: false }) // warm the JIT
  const times = []
  for (let i = 0; i < 3; i++) {
    clearAttributionCache()
    const t0 = performance.now()
    const r = attribute(plan)
    times.push(performance.now() - t0)
    assert.equal(r.evaluations, 2048)
    assert.equal(r.cached, false)
  }
  const best = Math.min(...times)
  assert.ok(best < 150, `best of three ${best.toFixed(1)} ms (all: ${times.map((t) => t.toFixed(0)).join(", ")})`)
  const hit = attribute(plan)
  assert.equal(hit.cached, true)
  assert.ok(hit.ms < 5, `cache hit took ${hit.ms} ms`)
})

test("attribution: the venue is carried into Today, so the baseline is exactly zero in every column", () => {
  const plan = { ...presetInputs("dr2027"), venue: "melbourne" }
  const a = attribute(plan, { cache: false })
  for (const o of OUTCOMES) assert.ok(Math.abs(a.baseline[o]) < EPS, `baseline ${o} = ${a.baseline[o]}`)
  assert.ok(Math.abs(a.total.sec - evaluate(plan).perf.sec) < EPS)
  const b = attribute(plan, { venueInBaseline: true, cache: false })
  assert.deepEqual(b.drivers.map((d) => d.sec), a.drivers.map((d) => d.sec), "the option is a no-op now that Today follows the plan's venue")
  for (const o of OUTCOMES) assert.ok(sumError(b)[o] < 1e-6)
})

test("attribution: cpuArch and the ML partition are real drivers, an injected evaluateFn is honoured, sampling kicks in above maxExact", () => {
  const base = presetInputs("gl2028")
  const pending = attribute({ ...base, cpuArch: "bigcache", mlPartitionKW: 50, mlPlacement: "dr" }, { cache: false })
  assert.equal(pending.n, 12, "cpuArch and the ML partition count as changes")
  assert.equal(pending.evaluations, 4096)
  const arch = pending.drivers.find((d) => d.id === "cpuArch")
  assert.ok(arch.sec > 0.05 && arch.sec < 0.09, `big-cache parts earn their own bar: ${arch.sec}`)
  assert.equal(arch.label, "Processor architecture")
  const sampled = attribute({ ...base, cpuArch: "bigcache" }, { maxExact: 6, samples: 60, seed: 3, cache: false })
  assert.equal(sampled.method, "shapley-sampled")
  assert.ok(sampled.evaluations < 4096)
  for (const o of OUTCOMES) assert.ok(sumError(sampled)[o] < 1e-6, `sampled ${o} still adds up`)
  assert.ok(Math.abs(sampled.total.sec - pending.total.sec) < 0.01)
  const again = attribute({ ...base, cpuArch: "bigcache" }, { maxExact: 6, samples: 60, seed: 3, cache: false })
  assert.deepEqual(again.drivers.map((d) => d.sec), sampled.drivers.map((d) => d.sec), "sampling is seeded")

  // strategy B 2028 (the brief's table): the four solver GPUs are the biggest technology bar, the CPU cut takes time back
  const plan = planInputs(STRATEGIES.B, 2028)
  const viaEnvelope = attribute(plan, { evaluateFn: envelopeEvaluate, cache: false })
  assert.ok(Math.abs(viaEnvelope.total.sec - envelopeEvaluate(plan).perf.sec) < 0.0011)
  assert.ok(Math.abs(viaEnvelope.total.sec - 0.467) < 0.0015)
  const bar = (id) => viaEnvelope.drivers.find((d) => d.id === id).sec
  assert.ok(Math.abs(bar("gpu") - 0.180) < 0.002, "B's four solver GPUs are the biggest technology bar")
  assert.ok(Math.abs(bar("clock") + 0.134) < 0.002, "the CPU cut to three nodes takes lap time back")
  assert.ok(Math.abs(bar("power") - 0.313) < 0.002 && Math.abs(bar("cooling") - 0.058) < 0.002)
  assert.deepEqual(viaEnvelope.drivers.map((d) => d.sec), attribute(plan, { cache: false }).drivers.map((d) => d.sec), "the default evaluate() is the same model")
  for (const k of STRATEGY_ORDER) for (const season of [2027, 2028]) {
    const r = attribute(planInputs(STRATEGIES[k], season), { evaluateFn: envelopeEvaluate, cache: false })
    for (const o of OUTCOMES) assert.ok(sumError(r)[o] < 1e-6, `${k} ${season} ${o}`)
    assert.equal(r.drivers[0].id, "power")
    assert.ok(r.drivers[0].sec === Math.max(...r.drivers.map((d) => d.sec)), `${k} ${season}: the move is the largest bar`)
  }
  // a valueFn returning the outcome vector directly
  const direct = attribute(base, { valueFn: (inputs) => outcomesOf(evaluate(inputs)), cache: false })
  assert.ok(Math.abs(direct.total.sec - evaluate(base).perf.sec) < EPS)
})

test("attribution: waterfallSteps stacks the bars from Today to the plan", () => {
  const r = attribute(presetInputs("gl2028"))
  const steps = waterfallSteps(r)
  assert.equal(steps[0].kind, "baseline")
  assert.equal(steps.at(-1).kind, "total")
  assert.ok(Math.abs(steps.at(-1).to - r.total.sec) < EPS)
  const drivers = steps.filter((s) => s.kind === "driver")
  assert.equal(drivers.length, r.n, "pruned drivers are left out by default")
  for (let i = 1; i < drivers.length; i++) assert.ok(Math.abs(drivers[i].from - drivers[i - 1].to) < EPS, "each bar starts where the previous ended")
  const ordered = waterfallSteps(r, ["connectivity", "power"], { includePruned: true })
  assert.equal(ordered[1].id, "connectivity")
  assert.equal(ordered[2].id, "power")
  assert.equal(ordered.filter((s) => s.kind === "driver").length, 12)
  const chf = waterfallSteps(r, null, { outcome: "savedCHF" })
  assert.ok(Math.abs(chf.at(-1).to - r.total.savedCHF) < 1e-6)
})

test("attribution: inputs are normalised before comparison (strings, clamping) and cached per plan", () => {
  const a = attribute({ ...presetInputs("dr2027"), nodes: "12", clockGHz: "3.7" })
  const b = attribute(presetInputs("dr2027"))
  assert.deepEqual(a.drivers.map((d) => d.sec), b.drivers.map((d) => d.sec))
  assert.deepEqual(a.inputs, normalize(presetInputs("dr2027")))
  assert.equal(b.cached, true)
})

// ---------------------------------------------------------------------------------------------
// Plan-level attribution (integration pass): the bars on the Overview and the strategy cards
// ---------------------------------------------------------------------------------------------

import { PLAN_PRESET_ORDER, presetPlan, normalizePlan, evaluatePlan as evaluateTwoSeasonPlan, seasonInputs, seasonAttributionFn, setTimeline } from "../public/js/sim/plan.js"
import { STRATEGY_ORDER as STRATEGY_KEYS, strategyPlan } from "../public/js/sim/strategies.js"

test("attribution: seasonAttributionFn makes the bars sum exactly to the plan-level headline for every preset and strategy", () => {
  const plans = [...PLAN_PRESET_ORDER.map((p) => presetPlan(p)), ...STRATEGY_KEYS.map((k) => strategyPlan(k))]
  for (const raw of plans) {
    const plan = normalizePlan(raw)
    const result = evaluateTwoSeasonPlan(plan)
    for (const year of [2027, 2028]) {
      const a = attribute(seasonInputs(plan, year), { evaluateFn: seasonAttributionFn(result, year), cache: false })
      const sum = a.drivers.reduce((acc, d) => acc + d.sec, 0) + a.baseline.sec
      assert.ok(Math.abs(sum - result.seasons[year].perf.sec) < 1e-9, `${plan.meta.name} ${year}: Σ ${sum} vs plan-level ${result.seasons[year].perf.sec}`)
      for (const d of a.drivers) for (const k of OUTCOMES) assert.ok(Number.isFinite(d[k]), `${plan.meta.name} ${year} ${d.id}.${k}`)
      assert.ok(a.ms < 400, `${plan.meta.name} ${year}: ${a.ms} ms`)
    }
  }
})

test("attribution: at plan level the go-live blend is held fixed, so 2027 differs from steady state and Today stays at zero", () => {
  const plan = normalizePlan(presetPlan("dr2027"))
  const result = evaluateTwoSeasonPlan(plan)
  const planLevel = attribute(seasonInputs(plan, 2027), { evaluateFn: seasonAttributionFn(result, 2027), cache: false })
  const steady = attribute(seasonInputs(plan, 2027), { cache: false })
  assert.ok(planLevel.total.sec < steady.total.sec, "2027 is blended by the go-live date, so it is worth less than a full season on the new estate")
  assert.ok(Math.abs(planLevel.baseline.sec) < 1e-9, "no carried estate in 2027: the baseline step is zero")
  assert.equal(planLevel.drivers.filter((d) => d.pruned).map((d) => d.id).length, steady.drivers.filter((d) => d.pruned).length, "the same drivers are active")

  const today = normalizePlan(presetPlan("today"))
  const tr = evaluateTwoSeasonPlan(today)
  for (const year of [2027, 2028]) {
    const a = attribute(seasonInputs(today, year), { evaluateFn: seasonAttributionFn(tr, year), cache: false })
    assert.ok(Math.abs(a.total.sec) < 1e-9 && a.drivers.every((d) => d.pruned), `Today ${year}: nothing to attribute`)
  }

  // a late 2028 step-up carries the 2027 estate for part of the season: that share is the baseline step, not a driver
  const late = normalizePlan(setTimeline(presetPlan("gl2028"), { stepUpDate: "2028-05-01" }))
  const lr = evaluateTwoSeasonPlan(late)
  const la = attribute(seasonInputs(late, 2028), { evaluateFn: seasonAttributionFn(lr, 2028), cache: false })
  assert.ok(lr.seasons[2028].blend.shareCarry > 0, "part of 2028 runs on the 2027 estate")
  assert.ok(la.baseline.sec > 0, `the carried 2027 estate shows as a baseline step (${la.baseline.sec})`)
  assert.ok(Math.abs(la.baseline.sec + la.drivers.reduce((acc, d) => acc + d.sec, 0) - lr.seasons[2028].perf.sec) < 1e-9)
})
