/**
 * "Find the best use of 500 kW": a deterministic local search over two-season plans.
 * Pure ES module, no DOM, no Worker (the Worker shape is in docs/audi-f1-modules.md).
 *
 *   optimise({ start, objective, evaluatePlan, fits, locked, restarts, maxSweeps, maxPlans, seed, fill, onProgress, shouldStop })
 *     → { best, score, result, evaluations, candidates, ms, trace, stopped, diff }
 *   OBJECTIVES      the four scores of strategies brief 3.1 (exact formulas and side-conditions)
 *   SEARCH_SPACE    every control the optimiser may move, its allowed values and whether it is locked by default (3.2)
 *   fillNodes()     the analytic fill move of 3.4 (nodes derived from the allowance)
 *   diffPlans(a, b) the changed controls between two plans, for the result table
 *
 * Algorithm (3.4): coordinate descent with random restarts. From the start plan and `restarts − 1` random plans
 * (uniform over the unlocked values; locked controls keep the start's values) sweep every unlocked control
 * (shared first, then 2027, then 2028), try every allowed value with the others fixed, accept the best improving
 * value, repeat until no control improves or `maxSweeps`. With `fill` on, `nodes` is not searched: after each
 * candidate is formed the node count is derived so the declared cluster uses as much of the allowance as it can
 * without exceeding it. Candidates that do not fit both seasons score −∞. Evaluations are memoised per plan, the
 * PRNG is seeded (mulberry32), so the same inputs give the same proposal.
 *
 * `evaluatePlan(plan)` and `fits(result)` are injected; they default to the transitional helpers in strategies.js
 * and will take the merged model's `evaluate` through `evaluatePlan(plan, { evaluateFn: evaluate })`.
 */
import { K } from "./assumptions.js"
import { ENVELOPE, SEASONS, evaluatePlan as evaluatePlanDefault, sharedOf } from "./strategies.js"

// ---------------------------------------------------------------------------------------------
// Objectives (3.1)
// ---------------------------------------------------------------------------------------------

const MIN_SEC = (K.optimiser && K.optimiser.minSec) ?? 0.10
const secOf = (r, y) => r[y].perf.secExact ?? r[y].perf.sec
const pointsOf = (r, y) => r[y].perf.pointsExact ?? r[y].perf.points
const capOf = (r, y) => r[y].scenario.money.capCharge

export const OBJECTIVES = Object.freeze({
  fastest2028: {
    id: "fastest2028",
    label: "Fastest 2028 car",
    formula: "sec2028 + 0.1 · sec2027",
    sideCondition: `sec2027 ≥ +${MIN_SEC.toFixed(2)} s (else score = −1 + sec2027)`,
    score: (r) => (secOf(r, 2027) >= MIN_SEC ? secOf(r, 2028) + 0.1 * secOf(r, 2027) : -1 + secOf(r, 2027)),
  },
  points: {
    id: "points",
    label: "Most points over both seasons",
    formula: "pts2027 + strategyPts2027 + pts2028 + strategyPts2028 + 10 · (sec2027 + sec2028)",
    sideCondition: null,
    score: (r) => pointsOf(r, 2027) + r[2027].perf.strategyPoints + pointsOf(r, 2028) + r[2028].perf.strategyPoints + 10 * (secOf(r, 2027) + secOf(r, 2028)),
  },
  headroom: {
    id: "headroom",
    label: "Most cost-cap headroom",
    formula: "−(cap2027 + cap2028) / 1e6 + 0.1 · (sec2027 + sec2028)",
    sideCondition: `both seasons ≥ +${MIN_SEC.toFixed(2)} s (else −100)`,
    score: (r) => (secOf(r, 2027) >= MIN_SEC && secOf(r, 2028) >= MIN_SEC ? -(capOf(r, 2027) + capOf(r, 2028)) / 1e6 + 0.1 * (secOf(r, 2027) + secOf(r, 2028)) : -100),
  },
  balanced: {
    id: "balanced",
    label: "Balanced: lap time, cap headroom, resilience, trackside",
    formula: "mean(sec) − 0.03 · mean(capM) + 0.5 · (mean(avail) − 0.99) + 0.01 · mean(strategyPts)",
    sideCondition: null,
    score: (r) => {
      const sec = (secOf(r, 2027) + secOf(r, 2028)) / 2
      const cap = (capOf(r, 2027) + capOf(r, 2028)) / 2 / 1e6
      const avail = (r[2027].scenario.comp.availabilityPct + r[2028].scenario.comp.availabilityPct) / 200
      const pts = (r[2027].perf.strategyPoints + r[2028].perf.strategyPoints) / 2
      return sec - 0.03 * cap + 0.5 * (avail - 0.99) + 0.01 * pts
    },
  },
})
export const OBJECTIVE_ORDER = Object.freeze(["fastest2028", "points", "headroom", "balanced"])

// ---------------------------------------------------------------------------------------------
// Search space (3.2)
// ---------------------------------------------------------------------------------------------

const range = (n) => Array.from({ length: n }, (_, i) => i)

export const SEARCH_SPACE = Object.freeze({
  shared: Object.freeze({
    location: { values: ["dr", "hybrid"], lockedByDefault: false },
    cooling: { values: ["air", "reardoor", "dlc"], lockedByDefault: false, note: "re-clamps rackKW to the cooling ceiling" },
    rackKW: { values: [20, 30, 50, 70, 100, 150], lockedByDefault: false, note: "clamped to the cooling ceiling" },
    redundancy: { values: ["n", "n1", "2n"], lockedByDefault: false },
    consumption: { values: ["buy", "greenlake"], lockedByDefault: false },
    committedPct: { values: [60, 80, 100], lockedByDefault: false },
    termYears: { values: [3, 5], lockedByDefault: false },
    support: { values: ["nbd", "4h", "mission"], lockedByDefault: true, why: "policy" },
    fibrePairs: { values: [1, 2], lockedByDefault: true, why: "policy" },
    fibreGbps: { values: [10, 100, 400], lockedByDefault: true, why: "policy" },
    trackside: { values: ["internet", "carrier", "dual", "dualsat"], lockedByDefault: true, why: "policy" },
    edge: { values: [false, true], lockedByDefault: true, why: "policy" },
    cloudOnRamp: { values: [false, true], lockedByDefault: true, why: "policy" },
    committedKW: { values: [300, 350, 400, 450, 500], lockedByDefault: true, why: "the offer is 500" },
  }),
  season: Object.freeze({
    nodes: { values: range(41), lockedByDefault: false, derived: true, note: "derived by the fill move when fill is on" },
    coresPerNode: { values: [64, 96, 128, 192], lockedByDefault: false, note: "re-clamps clockGHz to the CCF floor" },
    clockGHz: { values: [2.3, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.7, 4.0], lockedByDefault: false, note: "≥ CCF floor of the core count" },
    memoryGB: { values: [384, 768, 1536], lockedByDefault: false },
    interconnect: { values: ["eth100", "eth200", "ibndr", "slingshot"], lockedByDefault: false },
    storage: { values: ["nas", "pfs", "flash"], lockedByDefault: false },
    gpus: { values: [0, 2, 4, 6, 8, 12, 16, 24, 32], lockedByDefault: false, note: "≥ solverGpus" },
    solverGpus: { values: [0, 1, 2, 3, 4, 5, 6, 8], lockedByDefault: false, seasons: [2028], note: "2028 only" },
    gpuModel: { values: ["h200", "b200", "mi355x"], lockedByDefault: true, why: "L7: FP64 normalisation flips between parts on tiny differences" },
    refreshYears: { values: [3, 4, 5], lockedByDefault: false },
    leadWeeks: { values: [-6, -4, 0], lockedByDefault: true, why: "delivery is a plan, not a lever" },
    mlPartitionKW: { values: [0, 25, 50, 75, 100], lockedByDefault: true, why: "a business choice, not a performance lever in the model" },
  }),
})

/** Values the optimiser never moves; applied under the start plan's own values (the user's position and confidence win). */
export const FIXED = Object.freeze({
  position: 8, confidence: 60, gpuChargePct: 100, pueMode: "derived", tariffRp: 15, renewable: true, heatReuse: true,
  hinwilRetrofit: false, fitOutCHF: 800_000, migrationCHF: 400_000, migrationTiming: "boundary", propertySharePct: 50, venue: "singapore",
})

export const LOCKED_BY_DEFAULT = Object.freeze({
  shared: Object.keys(SEARCH_SPACE.shared).filter((k) => SEARCH_SPACE.shared[k].lockedByDefault),
  season: Object.keys(SEARCH_SPACE.season).filter((k) => SEARCH_SPACE.season[k].lockedByDefault),
})

export const DEFAULTS = Object.freeze({
  restarts: (K.optimiser && K.optimiser.restarts) ?? 8,
  maxSweeps: (K.optimiser && K.optimiser.maxSweeps) ?? 12,
  maxPlans: (K.optimiser && K.optimiser.maxPlans) ?? 6000,
  thoroughMaxPlans: (K.optimiser && K.optimiser.thoroughMaxPlans) ?? 20000,
  seed: (K.optimiser && K.optimiser.seed) ?? 2027,
  capGuardRailCHF: ENVELOPE.capChargeMaxCHF,
})

const META_KEYS = new Set(["key", "id", "name", "tagline", "story", "timeline", "risks", "provides", "openQuestions", "cutover", "ml", "plan", "shared"])

/** Canonical { shared, 2027, 2028 } copy of a plan (a STRATEGIES entry, a prototype-shaped plan or a user plan). */
export function canonicalPlan(plan) {
  const shared = { ...FIXED }
  for (const [k, v] of Object.entries(sharedOf(plan))) if (!META_KEYS.has(k) && !SEASONS.includes(Number(k))) shared[k] = v
  shared.expansionRight = false
  const out = { shared }
  for (const y of SEASONS) {
    const s = { ...(plan[y] || plan[SEASONS[0]] || {}) }
    if (s.mlPartitionKW === undefined) s.mlPartitionKW = s.ml ?? (plan.ml && plan.ml[y]) ?? 0
    if (s.mlPlacement === undefined) s.mlPlacement = "dr"
    delete s.ml
    if (y < K.fia.gpuAllowedFrom) s.solverGpus = 0
    out[y] = s
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Fill move (3.4) and dependent clamps
// ---------------------------------------------------------------------------------------------

/**
 * Node count that uses as much of the allowance as possible without exceeding it, from the F4.4.4 arithmetic:
 * allowance = 6 · scale[P] / 100 MAUh; gpuMAUh = solverGpus · coreEquivalents · hours · charge; perNodeMAUh = cores · CCF · hours.
 */
export function fillNodes(seasonSet, { position = FIXED.position, season = 2027, gpuChargePct = FIXED.gpuChargePct, max = 40 } = {}) {
  const allowance = (K.fia.baseline.mauh * K.fia.scale[position - 1]) / 100
  const hours = K.fia.atpHours * K.compute.solverShare
  const gpuN = season >= K.fia.gpuAllowedFrom ? seasonSet.solverGpus || 0 : 0
  const gpu = K.compute.gpu[seasonSet.gpuModel] || K.compute.gpu.b200
  const gpuMauh = (gpuN * ((gpu.fp64 * 1000) / K.compute.coreFp64GFLOPSPerGHz) * hours * (gpuChargePct / 100)) / 1e6
  const perNode = (seasonSet.coresPerNode * seasonSet.clockGHz * hours) / 1e6
  if (!(perNode > 0)) return 0
  return Math.max(0, Math.min(max, Math.floor((allowance - gpuMauh) / perNode + 1e-9)))
}

const CLOCKS = SEARCH_SPACE.season.clockGHz.values
const RACKS = SEARCH_SPACE.shared.rackKW.values
const GPUS = SEARCH_SPACE.season.gpus.values

export function ccfFloor(coresPerNode) { return ENVELOPE.ccfFloorGHz[coresPerNode] ?? 2.0 }

/** Keep a plan's dependent controls legal: CCF ≥ floor, rackKW ≤ cooling ceiling, solverGpus ≤ gpus, none in 2027. */
export function clampPlan(plan) {
  const ceiling = ENVELOPE.coolingMaxKWPerRack[plan.shared.cooling]
  if (ceiling && plan.shared.rackKW > ceiling) plan.shared.rackKW = [...RACKS].reverse().find((v) => v <= ceiling) ?? ceiling
  for (const y of SEASONS) {
    const s = plan[y]
    const floor = ccfFloor(s.coresPerNode)
    if (s.clockGHz < floor - 1e-9) s.clockGHz = CLOCKS.find((v) => v >= floor - 1e-9) ?? floor
    if (y < K.fia.gpuAllowedFrom) s.solverGpus = 0
    if (s.solverGpus > s.gpus) s.gpus = GPUS.find((g) => g >= s.solverGpus) ?? s.solverGpus
  }
  return plan
}

const clone = (plan) => ({ shared: { ...plan.shared }, 2027: { ...plan[2027] }, 2028: { ...plan[2028] } })

/** Allowed values of a control in context (CCF floor, cooling ceiling, GPU legality). */
function allowedValues(plan, scope, id) {
  const spec = scope === "shared" ? SEARCH_SPACE.shared[id] : SEARCH_SPACE.season[id]
  let values = spec.values
  if (scope !== "shared" && spec.seasons && !spec.seasons.includes(scope)) return []
  if (id === "clockGHz") values = values.filter((v) => v >= ccfFloor(plan[scope].coresPerNode) - 1e-9)
  if (id === "rackKW") values = values.filter((v) => v <= (ENVELOPE.coolingMaxKWPerRack[plan.shared.cooling] ?? Infinity))
  return values
}

function withValue(plan, scope, id, value) {
  const p = clone(plan)
  if (scope === "shared") p.shared[id] = value
  else p[scope][id] = value
  if (scope !== "shared" && id === "gpus") p[scope].solverGpus = Math.min(p[scope].solverGpus, value)
  return clampPlan(p)
}

// ---------------------------------------------------------------------------------------------
// Scoring with memoisation and the hard constraints (3.3)
// ---------------------------------------------------------------------------------------------

/** Default hard constraints: both seasons fit the envelope, no red flag, allowance ≤ 100 %, cap charge ≤ guard-rail. */
export function defaultFits(result, { capGuardRailCHF = DEFAULTS.capGuardRailCHF } = {}) {
  for (const y of SEASONS) {
    const r = result[y]
    if (!r) return false
    const env = r.envelope || (r.scenario && r.scenario.envelope)
    if (env && env.fits === false) return false
    if (r.scenario.status === "bad") return false
    if (r.scenario.comp.usage > ENVELOPE.usageMax + 1e-9) return false
    if (r.scenario.money.capCharge > capGuardRailCHF) return false
    if (y < K.fia.gpuAllowedFrom && r.scenario.inputs.solverGpus > 0) return false
    if (r.scenario.inputs.nodes > 0 && r.scenario.inputs.clockGHz < ccfFloor(r.scenario.inputs.coresPerNode) - 1e-9) return false
  }
  return true
}

const planKey = (plan) => JSON.stringify([plan.shared, plan[2027], plan[2028]], (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v))

/** Score one plan: { score, result, fits }. `score` is −Infinity when the plan does not fit. */
export function scorePlan(plan, objective, { evaluatePlan = evaluatePlanDefault, fits = defaultFits, fill = false } = {}) {
  const obj = typeof objective === "string" ? OBJECTIVES[objective] : objective
  if (!obj) throw new Error(`unknown objective "${objective}"`)
  const p = clampPlan(canonicalPlan(plan))
  if (fill) for (const y of SEASONS) p[y].nodes = fillNodes(p[y], { position: p.shared.position, season: y, gpuChargePct: p.shared.gpuChargePct })
  const result = evaluatePlan(p)
  const ok = fits(result)
  return { plan: p, score: ok ? obj.score(result) : -Infinity, result, fits: ok }
}

// ---------------------------------------------------------------------------------------------
// PRNG and random starts
// ---------------------------------------------------------------------------------------------

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isLocked(locked, scope, id) {
  return scope === "shared" ? locked.shared.includes(id) : locked.season.includes(id)
}

/** A random plan over the unlocked controls; locked controls (and everything outside the search space) keep `start`'s values. */
export function randomPlan(start, rand, locked = LOCKED_BY_DEFAULT, { fill = true } = {}) {
  const p = clone(start)
  const pick = (values) => values[Math.floor(rand() * values.length)]
  for (const id of Object.keys(SEARCH_SPACE.shared)) if (!isLocked(locked, "shared", id)) p.shared[id] = pick(SEARCH_SPACE.shared[id].values)
  for (const y of SEASONS) for (const id of Object.keys(SEARCH_SPACE.season)) {
    const spec = SEARCH_SPACE.season[id]
    if (isLocked(locked, "season", id) || (fill && spec.derived) || (spec.seasons && !spec.seasons.includes(y))) continue
    p[y][id] = pick(spec.values)
  }
  return clampPlan(p)
}

// ---------------------------------------------------------------------------------------------
// The optimiser
// ---------------------------------------------------------------------------------------------

function normaliseLocked(locked) {
  if (!locked) return LOCKED_BY_DEFAULT
  if (Array.isArray(locked)) return { shared: locked.filter((k) => SEARCH_SPACE.shared[k]), season: locked.filter((k) => SEARCH_SPACE.season[k]) }
  return { shared: locked.shared || [], season: locked.season || [] }
}

/**
 * @param options.start        the plan to start from (a STRATEGIES entry, the user's { shared, 2027, 2028 } or a prototype-shaped plan)
 * @param options.objective    id in OBJECTIVES (default "fastest2028") or an object with `score(result)`
 * @param options.evaluatePlan plan → { 2027, 2028 } results (default: strategies.evaluatePlan, transitional)
 * @param options.fits         result → boolean hard constraints (default: defaultFits)
 * @param options.locked       { shared: [ids], season: [ids] } or a flat array; default LOCKED_BY_DEFAULT; [] frees everything
 * @param options.restarts     number of starts including the user's (default K.optimiser.restarts or 8)
 * @param options.maxSweeps    sweeps per start (default 12)
 * @param options.maxPlans     hard cap on model evaluations (default 6000)
 * @param options.seed         PRNG seed (default 2027)
 * @param options.fill         derive `nodes` from the allowance (default true)
 * @param options.onProgress   ({ done, total, bestScore, best, restart, sweep }) every 100 evaluations and at the end
 * @param options.shouldStop   () → boolean, checked before every evaluation; the best so far is returned
 */
export function optimise(options = {}) {
  const {
    start, objective = "fastest2028", evaluatePlan = evaluatePlanDefault, fits = defaultFits,
    restarts = DEFAULTS.restarts, maxSweeps = DEFAULTS.maxSweeps, maxPlans = DEFAULTS.maxPlans, seed = DEFAULTS.seed,
    fill = true, onProgress = null, shouldStop = null, progressEvery = 100,
  } = options
  if (!start) throw new Error("optimise() needs a start plan")
  const obj = typeof objective === "string" ? OBJECTIVES[objective] : objective
  if (!obj || typeof obj.score !== "function") throw new Error(`unknown objective "${objective}"`)
  const locked = normaliseLocked(options.locked)
  const t0 = performance.now()
  const rand = mulberry32(seed)
  const memo = new Map()
  let evaluations = 0
  let candidates = 0
  let stopped = false
  let best = null
  const trace = []

  const progress = (restart, sweep) => { if (onProgress) onProgress({ done: evaluations, total: maxPlans, bestScore: best ? best.score : -Infinity, best: best ? best.plan : null, restart, sweep }) }

  const score = (plan) => {
    const p = clampPlan(clone(plan))
    if (fill) for (const y of SEASONS) p[y].nodes = fillNodes(p[y], { position: p.shared.position, season: y, gpuChargePct: p.shared.gpuChargePct })
    const key = planKey(p)
    candidates++
    let hit = memo.get(key)
    if (hit) return hit
    if (evaluations >= maxPlans || (shouldStop && shouldStop())) { stopped = true; return null }
    const result = evaluatePlan(p)
    evaluations++
    const ok = fits(result)
    hit = { plan: p, score: ok ? obj.score(result) : -Infinity, result, fits: ok }
    memo.set(key, hit)
    if (evaluations % progressEvery === 0) progress()
    return hit
  }
  const consider = (candidate, restart, sweep, move) => {
    if (!candidate) return false
    if (!best || candidate.score > best.score + 1e-9) {
      best = candidate
      trace.push({ restart, sweep, score: candidate.score, move })
      return true
    }
    return false
  }

  const startPlan = clampPlan(canonicalPlan(start))
  const startScored = score(startPlan)
  consider(startScored, 0, 0, "start")
  const starts = [startPlan]
  for (let i = 1; i < restarts; i++) starts.push(randomPlan(startPlan, rand, locked, { fill }))

  const moves = [
    ...Object.keys(SEARCH_SPACE.shared).filter((id) => !isLocked(locked, "shared", id)).map((id) => ["shared", id]),
    ...SEASONS.flatMap((y) => Object.keys(SEARCH_SPACE.season).filter((id) => !isLocked(locked, "season", id) && !(fill && SEARCH_SPACE.season[id].derived)).map((id) => [y, id])),
  ]

  outer: for (const [restart, s0] of starts.entries()) {
    let current = score(s0)
    if (!current) break
    consider(current, restart, 0, "restart")
    for (let sweep = 1; sweep <= maxSweeps; sweep++) {
      let improved = false
      for (const [scope, id] of moves) {
        const values = allowedValues(current.plan, scope, id)
        let bestHere = current
        for (const v of values) {
          const currentValue = scope === "shared" ? current.plan.shared[id] : current.plan[scope][id]
          if (v === currentValue) continue
          const cand = score(withValue(current.plan, scope, id, v))
          if (!cand) break outer
          if (cand.score > bestHere.score + 1e-9) bestHere = cand
        }
        if (bestHere !== current) {
          current = bestHere
          improved = true
          consider(current, restart, sweep, `${scope}.${id}`)
        }
      }
      if (!improved) break
    }
  }
  progress()
  const ms = performance.now() - t0
  return {
    objective: obj.id || "custom",
    best: best ? best.plan : startPlan,
    score: best ? best.score : -Infinity,
    result: best ? best.result : null,
    fits: best ? best.fits : false,
    start: startPlan,
    startScore: startScored ? startScored.score : -Infinity,
    startResult: startScored ? startScored.result : null,
    diff: best ? diffPlans(startPlan, best.plan) : [],
    evaluations, candidates, ms, trace, stopped, locked, fill, seed, restarts, maxSweeps, maxPlans,
  }
}

/** Changed controls between two plans: [{ scope: "shared" | 2027 | 2028, id, from, to }]. */
export function diffPlans(a, b) {
  const pa = canonicalPlan(a)
  const pb = canonicalPlan(b)
  const out = []
  for (const scope of ["shared", ...SEASONS]) {
    const keys = new Set([...Object.keys(pa[scope]), ...Object.keys(pb[scope])])
    for (const id of keys) {
      const from = pa[scope][id]
      const to = pb[scope][id]
      if (from !== to) out.push({ scope, id, from, to })
    }
  }
  return out
}
