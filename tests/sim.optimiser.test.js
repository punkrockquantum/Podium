import test from "node:test"
import assert from "node:assert/strict"
import {
  OBJECTIVES, OBJECTIVE_ORDER, SEARCH_SPACE, FIXED, LOCKED_BY_DEFAULT, DEFAULTS, canonicalPlan, fillNodes, ccfFloor, clampPlan,
  defaultFits, scorePlan, mulberry32, randomPlan, optimise, diffPlans,
} from "../public/js/sim/optimiser.js"
import { STRATEGIES, STRATEGY_ORDER, SEASONS, ENVELOPE, evaluatePlan, evaluateStrategy } from "../public/js/sim/strategies.js"
import { CONTROLS } from "../public/js/sim/model.js"

const nodesOf = (plan) => SEASONS.map((y) => plan[y].nodes)

test("optimiser: objectives and search space match brief 3.1–3.2, locked-by-default controls are policy", () => {
  assert.deepEqual(OBJECTIVE_ORDER, ["fastest2028", "headroom", "balanced"], "no points objective")
  assert.match(OBJECTIVES.balanced.formula, /avail/)
  assert.match(OBJECTIVES.balanced.formula, /decisionSec/)
  assert.ok(!/points/i.test(OBJECTIVES.balanced.formula), "the balanced score uses availability and data-to-decision, not strategy points")
  for (const id of OBJECTIVE_ORDER) {
    const o = OBJECTIVES[id]
    assert.equal(o.id, id)
    assert.ok(o.label && o.formula && typeof o.score === "function", id)
  }
  assert.ok(OBJECTIVES.fastest2028.sideCondition.includes("0.10 s"))
  // every searched control is a real control, and every value is legal for it
  for (const [scope, table] of Object.entries(SEARCH_SPACE)) {
    for (const [id, spec] of Object.entries(table)) {
      assert.ok(Array.isArray(spec.values) && spec.values.length >= 2, `${scope}.${id} has values`)
      assert.equal(typeof spec.lockedByDefault, "boolean", `${scope}.${id}.lockedByDefault`)
      if (spec.lockedByDefault) assert.ok(spec.why, `${scope}.${id} says why it is locked`)
      const c = CONTROLS[id]
      assert.ok(c, `${scope}.${id} is a control`)
      for (const v of spec.values) {
        if (c.type === "toggle") assert.equal(typeof v, "boolean")
        else if (c.type === "range") assert.ok(v >= c.min && v <= c.max && Number.isInteger(Math.round((v - c.min) / c.step * 1e6) / 1e6), `${id} = ${v}`)
        else assert.ok(c.options.some((o) => o.value === v), `${id} = ${v}`)
      }
    }
  }
  assert.deepEqual(LOCKED_BY_DEFAULT.shared, ["support", "fibrePairs", "fibreGbps", "trackside", "edge", "cloudOnRamp", "committedKW"])
  assert.deepEqual(LOCKED_BY_DEFAULT.season, ["cpuArch", "gpuModel", "leadWeeks", "mlPartitionKW"])
  assert.match(SEARCH_SPACE.season.cpuArch.why, /A-f/, "the processor family is the sales lead's call")
  assert.equal(SEARCH_SPACE.season.nodes.derived, true)
  assert.deepEqual(SEARCH_SPACE.season.solverGpus.seasons, [2028])
  assert.equal(FIXED.expansionRight, undefined, "there is no expansion-right control any more")
  assert.deepEqual([DEFAULTS.restarts, DEFAULTS.maxSweeps, DEFAULTS.maxPlans, DEFAULTS.seed], [8, 12, 6000, 2027])
  assert.ok(DEFAULTS.thoroughRestarts > DEFAULTS.restarts && DEFAULTS.thoroughMaxPlans > DEFAULTS.maxPlans, "the Thorough toggle has a bigger budget")
  assert.equal(DEFAULTS.capGuardRailCHF, ENVELOPE.capChargeMaxCHF)
})

test("optimiser: canonicalPlan, clampPlan and fillNodes reproduce the strategies' node counts", () => {
  const a = canonicalPlan(STRATEGIES.A)
  assert.ok(!("expansionRight" in a.shared), "a legacy expansion right is dropped")
  assert.equal(canonicalPlan({ ...STRATEGIES.A, shared: { ...STRATEGIES.A.shared, expansionRight: true } }).shared.expansionRight, undefined)
  assert.equal(a.shared.cpuArch, "today")
  assert.equal(a.shared.position, 8)
  assert.equal(a.shared.name, undefined, "metadata stripped")
  assert.equal(a[2027].mlPartitionKW, 0)
  assert.equal(a[2028].mlPlacement, "dr")
  assert.equal(canonicalPlan({ ...STRATEGIES.B.shared, 2027: { ...STRATEGIES.B[2027], ml: 0 }, 2028: { ...STRATEGIES.B[2028], ml: 50 } })[2028].mlPartitionKW, 50)
  assert.equal(canonicalPlan(STRATEGIES.C)[2028].mlPlacement, "cloud")
  // fill reproduces 12 / 18 / 18 in 2027 and 12 / 3 / 11 in 2028 (brief 2.1 node counts)
  assert.deepEqual(STRATEGY_ORDER.map((k) => fillNodes(canonicalPlan(STRATEGIES[k])[2027], { season: 2027 })), [12, 18, 18])
  assert.deepEqual(STRATEGY_ORDER.map((k) => fillNodes(canonicalPlan(STRATEGIES[k])[2028], { season: 2028 })), [12, 3, 11])
  assert.equal(fillNodes({ coresPerNode: 128, clockGHz: 3.7, solverGpus: 4, gpuModel: "b200" }, { season: 2027 }), 12, "solver GPUs do not count before 2028")
  assert.ok(fillNodes({ coresPerNode: 128, clockGHz: 2.4, solverGpus: 0 }, { position: 1 }) < fillNodes({ coresPerNode: 128, clockGHz: 2.4, solverGpus: 0 }, { position: 10 }), "a lower position gets more allowance")
  assert.equal(fillNodes({ coresPerNode: 128, clockGHz: 0 }), 0)
  assert.equal(fillNodes({ coresPerNode: 64, clockGHz: 2.4, solverGpus: 0 }, { max: 10 }), 10)
  // clamps
  const p = clampPlan({ shared: { cooling: "air", rackKW: 70 }, 2027: { coresPerNode: 128, clockGHz: 2.3, gpus: 0, solverGpus: 3 }, 2028: { coresPerNode: 192, clockGHz: 2.3, gpus: 2, solverGpus: 6 } })
  assert.equal(p.shared.rackKW, 20)
  assert.equal(p[2027].clockGHz, 2.4)
  assert.equal(p[2027].solverGpus, 0)
  assert.equal(p[2028].clockGHz, 2.4, "today's parts floor at their 2.4 GHz base clock even at 192 cores")
  assert.equal(p[2028].gpus, 6, "gpus raised to carry the solver GPUs")
  const std28 = clampPlan({ shared: { cpuArch: "std" }, 2027: {}, 2028: { coresPerNode: 192, clockGHz: 2.3 } })
  assert.equal(std28[2028].clockGHz, 2.3, "a 2028 Venice part (1.7 GHz base) lets a 192-core node declare 2.3 GHz")
  // the floor is max(core-count base clock H3, the processor family's base clock for the season)
  assert.deepEqual([ccfFloor(64), ccfFloor(96), ccfFloor(128), ccfFloor(192), ccfFloor(32)], [2.4, 2.4, 2.4, 2.4, 2.4])
  assert.deepEqual([ccfFloor(96, "std", 2028), ccfFloor(192, "std", 2028), ccfFloor(32, "std", 2028)], [2.3, 2.25, 2.0])
  assert.deepEqual([ccfFloor(128, "arm", 2027), ccfFloor(128, "arm", 2028), ccfFloor(128, "bigcache", 2027)], [3.1, 3.0, 2.55])
})

test("optimiser: mulberry32 is deterministic and uniform enough; randomPlan respects locks", () => {
  const a = mulberry32(7), b = mulberry32(7)
  const xs = Array.from({ length: 1000 }, () => a())
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()))
  assert.ok(xs.every((x) => x >= 0 && x < 1))
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`)
  const start = canonicalPlan(STRATEGIES.A)
  const rand = mulberry32(1)
  for (let i = 0; i < 20; i++) {
    const p = randomPlan(start, rand)
    for (const id of LOCKED_BY_DEFAULT.shared) assert.equal(p.shared[id], start.shared[id], `locked ${id}`)
    for (const y of SEASONS) {
      for (const id of LOCKED_BY_DEFAULT.season) assert.equal(p[y][id], start[y][id], `locked ${y}.${id}`)
      assert.equal(p[y].nodes, start[y].nodes, "nodes are derived by the fill move, not drawn")
      assert.ok(p[y].clockGHz >= ccfFloor(p[y].coresPerNode) - 1e-9)
      assert.ok(p[y].solverGpus <= p[y].gpus)
    }
    assert.equal(p[2027].solverGpus, 0)
    assert.ok(p.shared.rackKW <= ENVELOPE.coolingMaxKWPerRack[p.shared.cooling])
    assert.equal(p.shared.position, 8)
  }
  const everything = randomPlan(start, mulberry32(2), { shared: [], season: [] }, { fill: false })
  assert.ok(SEARCH_SPACE.season.gpuModel.values.includes(everything[2027].gpuModel))
})

test("optimiser: defaultFits and scorePlan agree with the strategies' envelope results", () => {
  for (const k of STRATEGY_ORDER) {
    const r = evaluateStrategy(k)
    assert.equal(defaultFits(r), true, k)
    const s = scorePlan(STRATEGIES[k], "fastest2028")
    assert.equal(s.fits, true)
    assert.ok(Math.abs(s.score - (r[2028].perf.sec + 0.1 * r[2027].perf.sec)) < 0.002, `${k} score ${s.score}`)
    assert.throws(() => scorePlan(STRATEGIES[k], "points"), /unknown objective/)
    assert.ok(scorePlan(STRATEGIES[k], "headroom").score < 0 && scorePlan(STRATEGIES[k], "headroom").score > -10)
    assert.ok(Number.isFinite(scorePlan(STRATEGIES[k], "balanced").score))
  }
  const over = { ...STRATEGIES.B, 2028: { ...STRATEGIES.B[2028], mlPartitionKW: 100 } }
  assert.equal(scorePlan(over, "fastest2028").score, -Infinity, "a plan over 500 kW scores −∞")
  assert.equal(defaultFits(evaluatePlan(over)), false)
  const slow = { ...STRATEGIES.A, 2027: { ...STRATEGIES.A[2027], nodes: 1 } }
  assert.ok(scorePlan(slow, "fastest2028").score < 0, "below +0.10 s in 2027 the side condition punishes the score")
  assert.equal(scorePlan(slow, "headroom").score, -100)
  assert.ok(scorePlan(STRATEGIES.A, "fastest2028", { fill: true }).plan[2027].nodes === 12)
  assert.throws(() => scorePlan(STRATEGIES.A, "nope"))
  // a dishonest fits() is honoured
  assert.equal(scorePlan(STRATEGIES.A, "fastest2028", { fits: () => false }).score, -Infinity)
})

test("optimiser: fastest2028 from A reaches ≥ +0.50 s in 2028 within the default budget, deterministically (brief 3.4: +0.511 s)", () => {
  const t0 = performance.now()
  const r = optimise({ start: STRATEGIES.A, objective: "fastest2028" })
  const ms = performance.now() - t0
  assert.equal(r.objective, "fastest2028")
  assert.ok(r.fits, "the best plan fits")
  assert.ok(r.result[2028].perf.sec >= 0.50, `2028 ${r.result[2028].perf.sec}`)
  assert.ok(r.result[2027].perf.sec >= 0.10, `2027 side condition ${r.result[2027].perf.sec}`)
  assert.ok(r.score > r.startScore)
  assert.ok(Math.abs(r.startScore - (0.369 + 0.0137)) < 0.003, `start score ${r.startScore}`)
  assert.ok(r.result[2028].envelope.drIT <= 500 && r.result[2027].envelope.drIT <= 500)
  assert.equal(r.best.shared.cpuArch, "today", "the locked processor family is not searched")
  assert.ok(r.evaluations <= DEFAULTS.maxPlans && r.evaluations > 100, `evaluations ${r.evaluations}`)
  assert.equal(r.stopped, false)
  assert.ok(ms < 4000, `${ms} ms`)
  assert.ok(r.trace.length >= 2 && r.trace[0].move === "start" && r.trace.at(-1).score === r.score)
  assert.ok(r.diff.length > 0 && r.diff.every((d) => ["shared", 2027, 2028].includes(d.scope)))
  // deterministic for a seed, different (or equal) for another seed but never worse than the start
  const again = optimise({ start: STRATEGIES.A, objective: "fastest2028" })
  assert.deepEqual(again.best, r.best)
  assert.equal(again.score, r.score)
  assert.equal(again.evaluations, r.evaluations)
  const other = optimise({ start: STRATEGIES.A, objective: "fastest2028", seed: 99, restarts: 3, maxPlans: 1500 })
  assert.ok(other.score >= r.startScore)
  // the returned plan is canonical and keeps the locked policy controls
  for (const id of LOCKED_BY_DEFAULT.shared) assert.equal(r.best.shared[id], STRATEGIES.A.shared[id], `locked ${id}`)
  for (const y of SEASONS) for (const id of LOCKED_BY_DEFAULT.season) assert.equal(r.best[y][id], canonicalPlan(STRATEGIES.A)[y][id], `locked ${y}.${id}`)
  assert.ok(!("expansionRight" in r.best.shared))
  assert.equal(r.best[2027].solverGpus, 0)
})

test("optimiser: every returned plan fits both seasons for every objective from every strategy (reduced budget)", () => {
  for (const objective of OBJECTIVE_ORDER) {
    for (const k of STRATEGY_ORDER) {
      const r = optimise({ start: STRATEGIES[k], objective, restarts: 2, maxSweeps: 4, maxPlans: 600 })
      assert.ok(r.fits, `${objective} from ${k}`)
      const check = evaluatePlan(r.best)
      assert.equal(check.fits, true, `${objective} from ${k}: re-evaluated plan fits`)
      assert.equal(check.ok, true, `${objective} from ${k}: guard-rails`)
      for (const y of SEASONS) {
        assert.ok(check[y].scenario.comp.usage <= 1 + 1e-9)
        assert.ok(check[y].scenario.money.capCharge <= DEFAULTS.capGuardRailCHF)
        assert.notEqual(check[y].scenario.status, "bad")
      }
      assert.ok(r.score >= r.startScore - 1e-9, `${objective} from ${k}: never worse than the start`)
      assert.ok(r.evaluations <= 600)
      assert.equal(evaluatePlan(r.best)[2028].perf.sec, r.result[2028].perf.sec, "result matches a fresh evaluation")
    }
  }
})

test("optimiser: the headroom objective lowers the cap charge and balanced lifts both seasons", () => {
  const a = evaluateStrategy("A")
  const head = optimise({ start: STRATEGIES.A, objective: "headroom", restarts: 3, maxPlans: 2000 })
  assert.ok(head.result[2027].scenario.money.capCharge < a[2027].scenario.money.capCharge)
  assert.ok(head.result[2028].scenario.money.capCharge < a[2028].scenario.money.capCharge)
  for (const y of SEASONS) assert.ok(head.result[y].perf.sec >= 0.10)
  const bal = optimise({ start: STRATEGIES.A, objective: "balanced", restarts: 3, maxPlans: 2000 })
  assert.ok(bal.score > bal.startScore)
  assert.ok(bal.result[2027].perf.sec > a[2027].perf.sec && bal.result[2028].perf.sec > a[2028].perf.sec)
  assert.ok(bal.result[2027].availabilityPct === undefined || bal.result[2027].availabilityPct >= 99, "availability is part of the balanced score")
  assert.throws(() => optimise({ start: STRATEGIES.A, objective: "points" }), /unknown objective/)
})

test("optimiser: shouldStop, maxPlans and onProgress are honoured and the best so far is returned", () => {
  let calls = 0
  const stopAt = 150
  const ticks = []
  const r = optimise({
    start: STRATEGIES.A, objective: "fastest2028",
    shouldStop: () => ++calls > stopAt,
    onProgress: (p) => ticks.push(p),
  })
  assert.equal(r.stopped, true)
  assert.ok(r.evaluations <= stopAt && r.evaluations >= stopAt - 1, `evaluations ${r.evaluations}`)
  assert.ok(r.best && r.fits && r.score >= r.startScore)
  assert.ok(ticks.length >= 2, "progress at every 100 evaluations and at the end")
  assert.equal(ticks.at(-1).done, r.evaluations)
  assert.equal(ticks[0].total, DEFAULTS.maxPlans)
  assert.ok(ticks.every((t) => Number.isFinite(t.bestScore) && t.best && t.best.shared))
  const immediate = optimise({ start: STRATEGIES.A, shouldStop: () => true })
  assert.equal(immediate.evaluations, 0)
  assert.equal(immediate.stopped, true)
  assert.deepEqual(immediate.best, canonicalPlan(STRATEGIES.A), "with nothing evaluated the start plan comes back")
  assert.equal(immediate.score, -Infinity)
  const capped = optimise({ start: STRATEGIES.B, maxPlans: 50 })
  assert.equal(capped.evaluations, 50)
  assert.equal(capped.stopped, true)
  assert.ok(capped.fits && capped.score >= capped.startScore)
  assert.throws(() => optimise({}), /start plan/)
  assert.throws(() => optimise({ start: STRATEGIES.A, objective: "nope" }), /unknown objective/)
})

test("optimiser: locks are honoured, a flat lock list works and a custom objective is accepted", () => {
  const all = { shared: Object.keys(SEARCH_SPACE.shared), season: Object.keys(SEARCH_SPACE.season) }
  const frozen = optimise({ start: STRATEGIES.A, locked: all, fill: false, restarts: 4 })
  assert.deepEqual(frozen.diff, [], "with everything locked nothing can move")
  assert.equal(frozen.evaluations, 1)
  const onlyGpus = optimise({ start: STRATEGIES.A, locked: [...all.shared, ...all.season.filter((id) => !["gpus", "solverGpus"].includes(id))], restarts: 2, maxPlans: 300 })
  assert.ok(onlyGpus.diff.every((d) => ["gpus", "solverGpus", "nodes"].includes(d.id)), JSON.stringify(onlyGpus.diff))
  assert.ok(onlyGpus.score >= onlyGpus.startScore)
  const custom = optimise({ start: STRATEGIES.A, objective: { id: "cheap2027", score: (r) => -r[2027].scenario.money.capCharge }, restarts: 2, maxPlans: 400 })
  assert.equal(custom.objective, "cheap2027")
  assert.ok(custom.result[2027].scenario.money.capCharge <= evaluateStrategy("A")[2027].scenario.money.capCharge)
  // an injected evaluatePlan / fits pair is used instead of the transitional default
  let used = 0
  const r = optimise({ start: STRATEGIES.A, evaluatePlan: (p) => { used++; return evaluatePlan(p) }, fits: () => true, restarts: 1, maxSweeps: 1, maxPlans: 40 })
  assert.equal(used, r.evaluations)
})

test("optimiser: diffPlans lists exactly the changed controls, A→A is empty, and nodes follow the fill", () => {
  assert.deepEqual(diffPlans(STRATEGIES.A, STRATEGIES.A), [])
  const d = diffPlans(STRATEGIES.A, STRATEGIES.B)
  const find = (scope, id) => d.find((x) => x.scope === scope && x.id === id)
  assert.deepEqual(find("shared", "cooling"), { scope: "shared", id: "cooling", from: "reardoor", to: "dlc" })
  assert.deepEqual(find("shared", "rackKW"), { scope: "shared", id: "rackKW", from: 30, to: 70 })
  assert.deepEqual(find("shared", "consumption"), { scope: "shared", id: "consumption", from: "buy", to: "greenlake" })
  assert.deepEqual(find("shared", "support"), { scope: "shared", id: "support", from: "4h", to: "mission" })
  assert.deepEqual(find("shared", "trackside"), { scope: "shared", id: "trackside", from: "dual", to: "dualsat" })
  assert.deepEqual(find("shared", "cloudOnRamp"), { scope: "shared", id: "cloudOnRamp", from: false, to: true })
  assert.deepEqual(find(2027, "nodes"), { scope: 2027, id: "nodes", from: 12, to: 18 })
  assert.deepEqual(find(2027, "clockGHz"), { scope: 2027, id: "clockGHz", from: 3.7, to: 2.4 })
  assert.deepEqual(find(2027, "interconnect"), { scope: 2027, id: "interconnect", from: "ibndr", to: "slingshot" })
  assert.deepEqual(find(2028, "gpus"), { scope: 2028, id: "gpus", from: 4, to: 16 })
  assert.deepEqual(find(2028, "solverGpus"), { scope: 2028, id: "solverGpus", from: 0, to: 4 })
  assert.deepEqual(find(2028, "mlPartitionKW"), { scope: 2028, id: "mlPartitionKW", from: 0, to: 50 })
  assert.equal(find("shared", "location"), undefined)
  assert.equal(find("shared", "redundancy"), undefined)
  assert.equal(find(2027, "coresPerNode"), undefined)
  assert.equal(find(2027, "solverGpus"), undefined, "both 2027 solver counts are 0")
  const ids = d.map((x) => `${x.scope}.${x.id}`)
  assert.equal(new Set(ids).size, ids.length, "no duplicate rows")
  assert.deepEqual(diffPlans(STRATEGIES.C, STRATEGIES.C.shared && { ...STRATEGIES.C, 2028: { ...STRATEGIES.C[2028], nodes: 10 } }), [{ scope: 2028, id: "nodes", from: 11, to: 10 }])
  // the optimiser's diff is the diff between its canonical start and best
  const r = optimise({ start: STRATEGIES.A, restarts: 2, maxPlans: 300 })
  assert.deepEqual(r.diff, diffPlans(r.start, r.best))
  assert.ok(nodesOf(r.best).every((n) => n >= 0 && n <= 40))
})
