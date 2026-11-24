/**
 * "Where the seconds come from": attribution of a plan's advantage over Today's setup to twelve named drivers.
 * Pure ES module, no DOM.
 *
 *   attribute(plan)                              → exact Shapley values over the active drivers
 *   attribute(plan, { method: "waterfall", order }) → an ordered, path-dependent decomposition (drawing only)
 *   waterfallSteps(result, order)                → cumulative bars for the chart
 *   checkCoverage()                              → every control is in exactly one driver or held
 *
 * Method (explain brief 1.3, J-j): the value of a coalition S is `evaluate()` run on Today's inputs with the plan's
 * values copied in for the drivers in S. The Shapley value averages each driver's marginal effect over every order
 * the drivers could be applied in, so the bars add up to the plan's total exactly and do not depend on who tells
 * the story first. Drivers whose inputs equal Today's are null players: their value is exactly zero, so they are
 * left out of the 2ⁿ enumeration and reported as `pruned`. Pace points are not attributed per driver; they are
 * allocated in proportion to seconds (brief 1.6 c). Above `maxExact` active drivers the sampled-permutation
 * estimate is used.
 *
 * The committed model has no `cpuArch`, `mlPartitionKW` or `mlPlacement` input yet. They are already mapped to
 * drivers here; `normalize()` passes unknown keys through untouched, so a plan may carry them and an injected
 * `evaluateFn` (strategies.js → `envelopeEvaluate`, later the merged model) can act on them.
 */
import { evaluate, simulate, normalize, todayInputs, aeroSeconds, reinvestSeconds, CONTROLS } from "./model.js"
import { K } from "./assumptions.js"

// ---------------------------------------------------------------------------------------------
// Drivers (display order of brief 3.5; inputs per brief 1.1)
// ---------------------------------------------------------------------------------------------

export const DRIVERS = Object.freeze([
  { id: "power", label: "Enough power for every server (the move)", inputs: ["location", "committedKW", "hinwilRetrofit", "expansionRight"], note: "expansionRight only while that control exists" },
  { id: "cpuArch", label: "Big-cache processor architecture", inputs: ["cpuArch"], pending: true },
  { id: "processor", label: "Newer processor generation", inputs: ["refreshYears"] },
  { id: "clock", label: "More cores at a lower declared clock", inputs: ["nodes", "coresPerNode", "clockGHz"] },
  { id: "gpu", label: "Graphics processors on the solver", inputs: ["gpus", "solverGpus", "gpuModel", "gpuChargePct", "mlPartitionKW", "mlPlacement"], note: "the ML partition travels with the GPU step-up" },
  { id: "data", label: "No waiting on data", inputs: ["storage", "interconnect", "memoryGB"] },
  { id: "cooling", label: "No overheating", inputs: ["cooling", "rackKW"] },
  { id: "resilience", label: "Two of everything, fast repairs", inputs: ["redundancy", "support"] },
  { id: "timing", label: "Delivered early, moved between periods", inputs: ["leadWeeks", "migrationTiming"] },
  { id: "energy", label: "Cheaper, greener electricity", inputs: ["pueMode", "pueValue", "tariffRp", "renewable", "heatReuse"] },
  { id: "commercial", label: "Pay-as-you-go and the money cap", inputs: ["consumption", "committedPct", "termYears", "propertySharePct", "fitOutCHF", "migrationCHF"] },
  { id: "connectivity", label: "Faster decisions at the track", inputs: ["fibrePairs", "fibreGbps", "trackside", "edge", "cloudOnRamp"] },
].map(Object.freeze))

export const DRIVER_ORDER = DRIVERS.map((d) => d.id)
export const HELD = Object.freeze(["season", "position", "confidence", "venue"])
export const OUTCOMES = Object.freeze(["sec", "aeroSec", "reinvestSec", "savedCHF", "effMauhDelta", "strategyPoints", "points"])

/** Today's value of the inputs the committed model does not have yet (explain brief 2.5, strategies brief 5.3). */
export const PENDING_BASE = Object.freeze({ cpuArch: "today", mlPartitionKW: 0, mlPlacement: "dr" })
export const PENDING_INPUTS = Object.keys(PENDING_BASE)

/** Inputs that cannot move the result unless a sibling input in the same driver enables them. */
const RELEVANT = {
  solverGpus: (p) => p.gpus > 0,
  gpuModel: (p) => p.gpus > 0,
  gpuChargePct: (p) => p.gpus > 0 && p.solverGpus > 0,
  committedPct: (p) => p.consumption === "greenlake",
  termYears: (p) => p.consumption === "greenlake",
  pueValue: (p) => p.pueMode === "override",
  mlPlacement: (p) => (Number(p.mlPartitionKW) || 0) > 0,
}

/** Every control is in exactly one driver or held; pending inputs are listed so the integrator sees them. */
export function checkCoverage(drivers = DRIVERS) {
  const all = drivers.flatMap((d) => d.inputs)
  const covered = new Set([...HELD, ...all])
  const missing = Object.keys(CONTROLS).filter((id) => !covered.has(id))
  const duplicates = all.filter((id, i) => all.indexOf(id) !== i)
  const pending = all.filter((id) => !CONTROLS[id] && !HELD.includes(id))
  return { missing, duplicates, pending }
}

// ---------------------------------------------------------------------------------------------
// Value function: the outcome vector of a plan vs Today
// ---------------------------------------------------------------------------------------------

const zeroVector = () => Object.fromEntries(OUTCOMES.map((o) => [o, 0]))

/** Outcomes from an `evaluate()`-shaped result `{ scenario, today, perf }`. */
export function outcomesOf(result) {
  const perf = result.perf
  const conf = (perf.confidence ?? result.scenario.inputs.confidence) / 100
  return {
    sec: perf.sec,
    aeroSec: perf.aeroSec * conf,
    reinvestSec: perf.reinvestSec * conf,
    savedCHF: perf.savedCHF,
    effMauhDelta: perf.effectiveMauhDelta,
    strategyPoints: perf.strategyPoints,
    points: perf.points,
  }
}

/** Replicates `evaluate()`'s performance block for a (scenario, today) pair: used when Today carries the venue. */
function perfFor(scenario, today) {
  const x = scenario.inputs
  const conf = x.confidence / 100
  const aero = aeroSeconds(scenario.comp.effectiveMauh) - aeroSeconds(today.comp.effectiveMauh)
  const saved = today.money.capCharge - scenario.money.capCharge
  const reinvest = reinvestSeconds(saved)
  const sec = (aero + reinvest) * conf
  const perf = K.performance
  const [lo, hi] = perf.midfield
  const scenarioPosition = Math.min(Math.max(x.position - sec / perf.secPerPosition, Math.min(lo, x.position)), Math.max(hi, x.position))
  return {
    sec, aeroSec: aero * conf, reinvestSec: reinvest * conf, savedCHF: saved,
    effMauhDelta: scenario.comp.effectiveMauh - today.comp.effectiveMauh,
    strategyPoints: (scenario.net.quality - today.net.quality) * K.trackside.strategyPointsSwing * conf,
    points: (x.position - scenarioPosition) * perf.pointsPerPosition,
  }
}

function makeValueFn({ evaluateFn, valueFn, venueInBaseline }) {
  if (valueFn) return valueFn
  if (!venueInBaseline) return (inputs) => outcomesOf(evaluateFn(inputs))
  return (inputs) => {
    const r = evaluateFn(inputs)
    const today = simulate({ ...r.today.inputs, venue: r.scenario.inputs.venue })
    return perfFor(r.scenario, today)
  }
}

// ---------------------------------------------------------------------------------------------
// Caches: evaluations keyed by their inputs (per value function) and results keyed by the plan
// ---------------------------------------------------------------------------------------------

const VALUE_CACHE_LIMIT = 32_768
const RESULT_CACHE_LIMIT = 64
const valueCaches = new WeakMap()
const resultCache = new Map()

/** Memoise `value` on the inputs' values; the store belongs to the model function so injected models never mix. */
function memoised(value, modelFn, keys, tag) {
  let store = valueCaches.get(modelFn)
  if (!store) { store = new Map(); valueCaches.set(modelFn, store) }
  return (inputs) => {
    let key = tag
    for (const k of keys) key += inputs[k] + "\u001f"
    const hit = store.get(key)
    if (hit) return hit
    const out = value(inputs)
    if (store.size >= VALUE_CACHE_LIMIT) store.clear()
    store.set(key, out)
    return out
  }
}

export function clearAttributionCache() {
  resultCache.clear()
  valueCaches.delete(evaluate)
}

// ---------------------------------------------------------------------------------------------
// Coalitions
// ---------------------------------------------------------------------------------------------

function normalisePlan(planInputs) {
  const p = normalize(planInputs)
  if (p.mlPartitionKW !== undefined) p.mlPartitionKW = Math.max(0, Number(p.mlPartitionKW) || 0)
  return p
}

function baseFor(p) {
  const base = todayInputs(p.season, p.position, p.confidence)
  base.venue = p.venue
  for (const k of PENDING_INPUTS) if (p[k] !== undefined) base[k] = PENDING_BASE[k]
  return base
}

function differs(p, base, id) {
  if (p[id] === undefined || p[id] === base[id]) return false
  const relevant = RELEVANT[id]
  return relevant ? relevant(p) : true
}

function activeDrivers(drivers, p, base) {
  return drivers.filter((d) => d.inputs.some((id) => differs(p, base, id)))
}

function coalitionInputs(base, p, active, mask) {
  const x = { ...base }
  for (let i = 0; i < active.length; i++) if (mask & (1 << i)) for (const id of active[i].inputs) if (p[id] !== undefined) x[id] = p[id]
  return x
}

const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>>= 1 } return c }
const factorial = (k) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f }

/** Seeded PRNG for the sampled fallback (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function exactShapley(value, base, p, active) {
  const n = active.length
  const size = 1 << n
  const v = new Array(size)
  for (let mask = 0; mask < size; mask++) v[mask] = value(coalitionInputs(base, p, active, mask))
  const w = Array.from({ length: n }, (_, s) => (factorial(s) * factorial(n - s - 1)) / factorial(n))
  const phi = active.map(zeroVector)
  for (let mask = 0; mask < size; mask++) {
    const ws = w[popcount(mask)]
    const without = v[mask]
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue
      const withI = v[mask | (1 << i)]
      const target = phi[i]
      for (const o of OUTCOMES) target[o] += ws * (withI[o] - without[o])
    }
  }
  return { phi, plan: v[size - 1], baseline: v[0], evaluations: size, exact: true }
}

function sampledShapley(value, base, p, active, samples, seed) {
  const n = active.length
  const rand = mulberry32(seed)
  const seen = new Map()
  let evaluations = 0
  const valueOfMask = (mask) => {
    let hit = seen.get(mask)
    if (!hit) { hit = value(coalitionInputs(base, p, active, mask)); seen.set(mask, hit); evaluations++ }
    return hit
  }
  const phi = active.map(zeroVector)
  const order = Array.from({ length: n }, (_, i) => i)
  for (let s = 0; s < samples; s++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    let mask = 0
    let prev = valueOfMask(0)
    for (const i of order) {
      mask |= 1 << i
      const cur = valueOfMask(mask)
      for (const o of OUTCOMES) phi[i][o] += (cur[o] - prev[o]) / samples
      prev = cur
    }
  }
  return { phi, plan: valueOfMask((1 << n) - 1), baseline: valueOfMask(0), evaluations, exact: false, samples }
}

function orderedWaterfall(value, base, p, active, order) {
  const seq = order ? order.map((id) => active.find((d) => d.id === id)).filter(Boolean) : active
  for (const d of active) if (!seq.includes(d)) seq.push(d)
  let x = { ...base }
  const baseline = value(x)
  let prev = baseline
  const phi = active.map(zeroVector)
  for (const d of seq) {
    for (const id of d.inputs) if (p[id] !== undefined) x[id] = p[id]
    const cur = value(x)
    const target = phi[active.indexOf(d)]
    for (const o of OUTCOMES) target[o] = cur[o] - prev[o]
    prev = cur
  }
  return { phi, plan: prev, baseline, evaluations: seq.length + 1, exact: true, order: seq.map((d) => d.id) }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Attribute a plan's advantage over Today to the drivers.
 *
 * @param planInputs   the plan (raw inputs; normalised here, unknown keys such as `cpuArch` pass through)
 * @param options.method        "shapley" (default) or "waterfall"
 * @param options.order         driver ids for the waterfall method (default: display order)
 * @param options.evaluateFn    `evaluate`-shaped model function (default: the committed `evaluate`)
 * @param options.valueFn       alternative: returns the outcome vector directly
 * @param options.drivers       driver table (default DRIVERS; any order gives the same Shapley values)
 * @param options.venueInBaseline  evaluate Today at the plan's venue too (model limitation b); default false
 *                               keeps the bars consistent with the committed headline tile
 * @param options.maxExact      above this many active drivers use the sampled estimate (default 12)
 * @param options.samples, options.seed   sampled estimate: permutations (default 200) and PRNG seed
 * @param options.cache         memoise evaluations and results (default true)
 * @returns { drivers: [{ id, label, sec, aeroSec, reinvestSec, savedCHF, effMauhDelta, strategyPoints, points, share, pruned }],
 *            total, baseline, plan, evaluations, ms, method, exact, active, n, inputs }
 *          `total` is what the bars add up to (plan minus baseline); `baseline` is Today vs Today (zero unless
 *          `evaluateFn` carries a venue effect); `plan` is the plan's own outcome vector.
 */
export function attribute(planInputs, options = {}) {
  const {
    method = "shapley", order = null, evaluateFn = evaluate, valueFn = null, drivers = DRIVERS,
    venueInBaseline = false, maxExact = 12, samples = 200, seed = 1, cache = true,
  } = options
  const t0 = performance.now()
  const p = normalisePlan(planInputs)
  const base = baseFor(p)
  const cacheKey = cache && evaluateFn === evaluate && !valueFn
    ? `${method}|${order ? order.join(",") : ""}|${venueInBaseline}|${maxExact}|${samples}|${seed}|${drivers.map((d) => d.id).join(",")}|${JSON.stringify(p, Object.keys(p).sort())}`
    : null
  if (cacheKey && resultCache.has(cacheKey)) return { ...resultCache.get(cacheKey), ms: performance.now() - t0, cached: true }

  const active = activeDrivers(drivers, p, base)
  const keys = Object.keys(base).sort()
  const rawValue = makeValueFn({ evaluateFn, valueFn, venueInBaseline })
  const value = cache ? memoised(rawValue, valueFn || evaluateFn, keys, venueInBaseline ? "v\u001f" : "e\u001f") : rawValue

  let core
  if (method === "waterfall") core = orderedWaterfall(value, base, p, active, order)
  else if (active.length <= maxExact) core = exactShapley(value, base, p, active)
  else core = sampledShapley(value, base, p, active, samples, seed)

  const total = zeroVector()
  for (const o of OUTCOMES) total[o] = core.plan[o] - core.baseline[o]
  const rows = drivers.map((d) => {
    const i = active.indexOf(d)
    const row = { id: d.id, label: d.label, ...(i >= 0 ? core.phi[i] : zeroVector()), pruned: i < 0 }
    row.points = total.sec !== 0 ? (total.points * row.sec) / total.sec : 0
    row.share = total.sec !== 0 ? row.sec / total.sec : 0
    return row
  })
  const result = {
    method: method === "waterfall" ? "waterfall" : core.exact ? "shapley" : "shapley-sampled",
    drivers: rows, total, baseline: core.baseline, plan: core.plan,
    evaluations: core.evaluations, exact: core.exact, samples: core.samples, order: core.order,
    active: active.map((d) => d.id), n: active.length, inputs: p,
    ms: performance.now() - t0, cached: false,
  }
  if (cacheKey) {
    if (resultCache.size >= RESULT_CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value)
    resultCache.set(cacheKey, result)
  }
  return result
}

/**
 * Cumulative bars for the chart from an attribution result: Today's baseline, one step per driver in `order`
 * (default: the result's order; pruned drivers are left out unless `includePruned`), then the plan total.
 * Each step has `from`, `to` and `value` for `outcome` (default "sec").
 */
export function waterfallSteps(result, order = null, { outcome = "sec", includePruned = false } = {}) {
  const byId = new Map(result.drivers.map((r) => [r.id, r]))
  const ids = order ? [...order.filter((id) => byId.has(id)), ...result.drivers.map((r) => r.id).filter((id) => !order.includes(id))] : result.drivers.map((r) => r.id)
  const baseline = result.baseline ? result.baseline[outcome] || 0 : 0
  let cursor = baseline
  const steps = [{ id: "baseline", label: "Today", kind: "baseline", from: 0, to: baseline, value: baseline }]
  for (const id of ids) {
    const r = byId.get(id)
    if (r.pruned && !includePruned) continue
    const value = r[outcome] || 0
    steps.push({ id: r.id, label: r.label, kind: "driver", from: cursor, to: cursor + value, value, share: r.share, pruned: r.pruned })
    cursor += value
  }
  steps.push({ id: "total", label: "This plan", kind: "total", from: 0, to: cursor, value: cursor })
  return steps
}

/** |Σ drivers − total| per outcome: the efficiency check the tests use. */
export function sumError(result) {
  return Object.fromEntries(OUTCOMES.map((o) => [o, Math.abs(result.drivers.reduce((s, d) => s + d[o], 0) - result.total[o])]))
}
