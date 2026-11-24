/**
 * The three strategic approaches as two-season plans, and the 500 kW envelope they must fit.
 * Pure ES module, no DOM.
 *
 *   STRATEGIES.A / .B / .C, STRATEGY_ORDER      the decision tables of strategies brief 2.1 with the stories of 2.3
 *   evaluateStrategy("B", { position, confidence, venue, evaluateFn })  → { 2027, 2028, fits, strategy }
 *   evaluatePlan(plan, options)                 any { shared, 2027, 2028 } plan, both seasons + fit
 *   envelopeCheck(scenario)                     the model's envelope plus the optimiser guard-rails (brief 3.3)
 *   envelopeEvaluate(inputs)                    model.evaluate() with the guard-rails attached (the optimiser's evaluateFn)
 *   toPlan(strategy)                            the strategy as a plan.js plan (meta, shared, seasons, timeline)
 *   summary(seasonResult)                       one flat row for a card or a comparison table
 *
 * The envelope itself (fit test, ceilings, clamps) lives in model.js: `simulate()` returns `s.envelope` and
 * `facility()` places the estate (375 kW base at the campus, today's 375 / 760 kW demand in the Hinwil room).
 * Figures here are plan-level when evaluated through plan.js (part of a season on the old estate); the brief's
 * steady-state numbers come out of `evaluateStrategy()` (one season, no blend).
 */
import { evaluate } from "./model.js"
import { K } from "./assumptions.js"
import { SHARED_IDS, normalizePlan } from "./plan.js"

// ---------------------------------------------------------------------------------------------
// The envelope (brief 1.1): the constants the model uses, re-exported for the cards and the optimiser
// ---------------------------------------------------------------------------------------------

const F = K.facility
export const ENVELOPE = Object.freeze({
  drOfferKW: F.envelopeKW,
  baseEstateKW: F.estateBaseKW,
  demandEstateKW: Object.freeze({ ...F.estateDemandKW }),
  hybridHinwilKW: F.hybridHinwilKW,
  hinwilRoomKW: F.hinwilCapacityKW,
  hinwilRetrofitKW: K.prices.hinwilRetrofitKW,
  coolingMaxKWPerRack: Object.freeze({ ...K.compute.coolingMaxKWPerRack }),
  cageRackPositions: F.cageRackPositions,
  estateRackKW: F.estateRackKW,
  ccfFloorGHz: Object.freeze({ ...K.compute.ccfFloorGHz }),
  usageMax: 1.0,
  capChargeMaxCHF: K.optimiser.capGuardRailCHF,
  liquidRowsCHF: K.prices.drLiquidRowsCHF,
  mlPlacements: Object.freeze(["dr", "hinwil", "cloud"]),
})

// ---------------------------------------------------------------------------------------------
// The strategies (brief 2.1, 2.3)
// ---------------------------------------------------------------------------------------------

/** Shared assumptions of all three plans (COMMON in the prototype). */
export const COMMON = Object.freeze({
  position: 8, confidence: 60, pueMode: "derived", tariffRp: 15, renewable: true, heatReuse: true,
  hinwilRetrofit: false, fitOutCHF: 800_000, migrationCHF: 400_000, migrationTiming: "boundary",
  propertySharePct: 50, venue: "singapore", gpuChargePct: 100, location: "dr", committedKW: 500, cpuArch: "today",
})

const CUTOVER_2027 = "Declaration and cutover at the ATP 1/2 boundary (8 Mar 2027), after the Bahrain test; the Hinwil cluster carries ATP 1."
const SITE_TIMELINE = [
  { when: "Dec 2026 – Feb 2027", what: "Contract, cage fit-out, pre-cabling to the Meet-Me-Room (15 business days), cross-connects (3 business days); dark fibre ordered in week 1 (3–6-month build)" },
  { when: "24–27 Feb 2027", what: "Bahrain test on the Hinwil cluster" },
  { when: "8 Mar 2027 (ATP 1/2 boundary)", what: "New declaration (cluster, location, cores, CCF) and cutover; estate migrated wave by wave in ATPs 2–3" },
]

export const STRATEGIES = Object.freeze({
  A: Object.freeze({
    key: "A",
    id: "consolidate",
    name: "A · Consolidate and de-risk",
    tagline: "Move today's CPU estate into Digital Realty Zurich as it is, fill the allowance, stay CPU-only through 2028.",
    story: "Move the whole estate into 2N rear-door rows at Digital Realty, buy the cluster you already know, fill the allowance every period, and bank 99.98 % availability and PUE 1.25 instead of a power-short room at 1.6. No new technology until the FIA writes the GPU rule.",
    shared: Object.freeze({
      ...COMMON,
      cooling: "reardoor", rackKW: 30, redundancy: "2n", consumption: "buy", committedPct: 80, termYears: 5,
      support: "4h", fibrePairs: 2, fibreGbps: 100, trackside: "dual", edge: true, cloudOnRamp: false,
    }),
    2027: Object.freeze({ nodes: 12, coresPerNode: 128, clockGHz: 3.7, memoryGB: 768, interconnect: "ibndr", storage: "pfs", gpus: 0, solverGpus: 0, gpuModel: "b200", refreshYears: 4, leadWeeks: 0, mlPartitionKW: 0, mlPlacement: "dr" }),
    2028: Object.freeze({ nodes: 12, coresPerNode: 128, clockGHz: 3.7, memoryGB: 768, interconnect: "ibndr", storage: "pfs", gpus: 4, solverGpus: 0, gpuModel: "b200", refreshYears: 4, leadWeeks: -4, mlPartitionKW: 0, mlPlacement: "dr" }),
    cutover: { 2027: CUTOVER_2027, 2028: "Four unrestricted B200s added in Nov–Dec 2027 (lead −4 weeks) for meshing and machine learning; no solver change, no re-declaration of the solver." },
    timeline: [
      ...SITE_TIMELINE,
      { when: "Dec 2026 – Feb 2027", what: "New 12-node cluster delivered straight to Glattbrugg (8–14 weeks)" },
      { when: "Nov – Dec 2027", what: "4 unrestricted B200 GPUs installed for meshing and ML; CPU solver unchanged for 2028" },
    ],
    provides: {
      dr: ["Private cage with 2N A+B feeds", "Rear-door heat exchangers and chilled water", "100 % renewable power and heat reuse", "Meet-Me-Room, cross-connects to the Hinwil fibre and the paddock carriers"],
      hpe: ["Bought cluster: ProLiant / Cray XD CPU nodes, InfiniBand NDR, parallel file system", "4-hour support", "No GreenLake"],
    },
    risks: [
      "The 3.7 GHz CCF buys the least work per AUh of the three (clock^0.6 law): A is the only strategy that cannot reach the top of the midfield spread in 2027.",
      "A bought fleet is depreciated inside the cap (CHF 1.3 M over 4 years) with no flexibility if the FIA revises limits (F4.4.8).",
      "CPU-only in 2028 forgoes the GPU rule.",
    ],
    openQuestions: [
      "Does the customer want to re-use existing Hinwil nodes (the model buys new)?",
      "Is a 60-position cage available in ZUR2 or ZUR3 for March 2027?",
      "Dark-fibre route feasibility (Swisscom feasibility study first).",
    ],
  }),
  B: Object.freeze({
    key: "B",
    id: "density",
    name: "B · Density and the 2028 GPU step-up",
    tagline: "A base-clock, liquid-cooled HPE fleet in 2027; a power-neutral swap to a GPU solver partition for 1 January 2028 inside the same 500 kW.",
    story: "Build the 2028 car's CFD platform now: 70 kW liquid rows, Slingshot and a flash tier so turnaround drops from 9 h to 4 h, mission-critical support so a failed node never costs a period, and a power-neutral swap on 1 January 2028 from 18 CPU nodes to 3 nodes plus 4 B200 solver GPUs and a 50 kW ML partition — all inside the same 500 kW.",
    shared: Object.freeze({
      ...COMMON,
      cooling: "dlc", rackKW: 70, redundancy: "2n", consumption: "greenlake", committedPct: 80, termYears: 5,
      support: "mission", fibrePairs: 2, fibreGbps: 100, trackside: "dualsat", edge: true, cloudOnRamp: true,
    }),
    2027: Object.freeze({ nodes: 18, coresPerNode: 128, clockGHz: 2.4, memoryGB: 768, interconnect: "slingshot", storage: "flash", gpus: 0, solverGpus: 0, gpuModel: "b200", refreshYears: 3, leadWeeks: 0, mlPartitionKW: 0, mlPlacement: "dr" }),
    2028: Object.freeze({ nodes: 3, coresPerNode: 128, clockGHz: 2.4, memoryGB: 768, interconnect: "slingshot", storage: "flash", gpus: 16, solverGpus: 4, gpuModel: "b200", refreshYears: 3, leadWeeks: -6, mlPartitionKW: 50, mlPlacement: "dr" }),
    cutover: { 2027: "CPU fleet declared at the ATP 1/2 boundary (8 Mar 2027).", 2028: "GPU rows delivered 6 weeks before 1 Jan 2028, burned in during ATP 6 of 2027 as unrestricted hardware (legal: pre/post-processing), re-declared for 1 Jan 2028 (the ATP 6/1 boundary); the GreenLake buffer absorbs the swap and the released CPU nodes return under the GreenLake term." },
    timeline: [
      ...SITE_TIMELINE,
      { when: "Mid Nov 2027", what: "GPU hosts delivered (lead −6 weeks); burn-in during ATP 6 as unrestricted pre/post-processing hardware" },
      { when: "1 Jan 2028 (ATP 6/1 boundary)", what: "Re-declaration: 3 CPU nodes + 4 B200 solver GPUs; 15 CPU nodes returned under the GreenLake term; 50 kW ML partition live" },
    ],
    provides: {
      dr: ["DLC-ready rows (CDUs and manifolds in the customer fit-out †)", "2N A+B feeds", "100 % renewable power and heat reuse", "ServiceFabric on-ramps (AWS Direct Connect, Azure ExpressRoute) for the ML burst", "Cross-connects"],
      hpe: ["HPE GreenLake: Cray XD2000-class DLC nodes, Slingshot, flash tier, XD685-class GPU hosts", "Mission-critical 24×7 support with on-site spares", "80 % reserved / 20 % buffer, 3-year refresh on a 5-year term"],
    },
    risks: [
      "The GPU-to-AUh rule is unpublished: at a 100 % FP64 charge 4 B200s eat about 83 % of the allowance (hence only 3 CPU nodes); if the FIA charges less, B gains most (+0.56 / +0.64 / +0.69 s at 75 / 50 / 25 %), if it charges more B must shed GPUs mid-season.",
      "Highest in-cap charge of the three (CHF 2.59 M in 2027).",
      "The 50 kW ML partition leaves only 41 kW of headroom in 2028.",
      "Liquid fit-out is a leasehold improvement the customer must fund (CHF 0.45 M †).",
    ],
    openQuestions: [
      "GreenLake treatment of a mid-term GPU swap.",
      "Whether a 3-year refresh on a 5-year term is priced (the model does not price it).",
      "ML partition size: 50 kW is the maximum that leaves room for the GPU hosts.",
    ],
  }),
  C: Object.freeze({
    key: "C",
    id: "efficient",
    name: "C · Cost-cap-optimised hybrid cloud",
    tagline: "Restricted CFD at Digital Realty sized so the allowance is never idle at the lowest in-cap cost; unrestricted ML and analytics burst to the cloud on-ramps; a hedged GPU step in 2028.",
    story: "The ATR makes CFD demand perfectly predictable — the same allowance every period — so reserve 100 % of a base-clock GreenLake fleet at the lowest unit rate, fill 96–99 % of the allowance, and push everything that does not accrue AUh (ML on results, analytics, FEA bursts) over the on-ramps instead of buying kW for it. In 2028 take a hedged two-GPU step so the team learns the GPU solver without betting the allowance on the FIA's conversion.",
    shared: Object.freeze({
      ...COMMON,
      cooling: "reardoor", rackKW: 30, redundancy: "2n", consumption: "greenlake", committedPct: 100, termYears: 5,
      support: "4h", fibrePairs: 2, fibreGbps: 100, trackside: "dual", edge: true, cloudOnRamp: true,
    }),
    2027: Object.freeze({ nodes: 18, coresPerNode: 128, clockGHz: 2.4, memoryGB: 768, interconnect: "ibndr", storage: "pfs", gpus: 0, solverGpus: 0, gpuModel: "b200", refreshYears: 4, leadWeeks: 0, mlPartitionKW: 0, mlPlacement: "cloud" }),
    2028: Object.freeze({ nodes: 11, coresPerNode: 128, clockGHz: 2.4, memoryGB: 768, interconnect: "ibndr", storage: "pfs", gpus: 4, solverGpus: 2, gpuModel: "b200", refreshYears: 4, leadWeeks: -4, mlPartitionKW: 0, mlPlacement: "cloud" }),
    cutover: { 2027: "Declaration at 8 Mar 2027 (ATP 1/2 boundary).", 2028: "2028 hardware 4 weeks early, re-declared for 1 Jan 2028; the GreenLake 20 % buffer carries the 18 → 11 node re-shape." },
    timeline: [
      ...SITE_TIMELINE,
      { when: "Early Dec 2027", what: "2 solver + 2 unrestricted B200s delivered (lead −4 weeks); CPU fleet re-shaped 18 → 11 nodes under the GreenLake buffer" },
      { when: "1 Jan 2028 (ATP 6/1 boundary)", what: "Re-declaration: 11 CPU nodes at 2.4 GHz + 2 B200 solver GPUs" },
    ],
    provides: {
      dr: ["Private cage with 2N A+B feeds", "Rear-door rows", "100 % renewable power and heat reuse", "ServiceFabric on-ramps: the cloud is the ML partition (mlPlacement = cloud)", "Cross-connects"],
      hpe: ["HPE GreenLake: 18 → 11 CPU nodes, InfiniBand NDR, parallel file system", "4-hour support", "100 % reserved on a 5-year term with the 20 % buffer for the 2028 re-shape"],
    },
    risks: [
      "Cloud egress and burst costs are a flat CHF 180 k a year in the model; a heavy ML programme could cost more than a 50 kW partition.",
      "A 100 % reservation removes flexibility if the allowance changes (P7 → 6.0 MAUh, P9 → 6.6).",
      "The two-GPU step gives only about 41 % of the allowance to GPUs, so the 2028 gain depends on the CPU fleet staying at base clock.",
    ],
    openQuestions: [
      "Data-residency rules for simulation data in public cloud (the ATR declaration names locations for the solver only, F4.4.2).",
      "GreenLake's minimum reserved share.",
    ],
  }),
})

export const STRATEGY_ORDER = Object.freeze(["A", "B", "C"])
export const SEASONS = Object.freeze([2027, 2028])

/** Find a strategy by key ("A") or id ("consolidate"). */
export function strategyByKey(idOrKey) {
  if (STRATEGIES[idOrKey]) return STRATEGIES[idOrKey]
  return Object.values(STRATEGIES).find((s) => s.id === idOrKey) || null
}

// ---------------------------------------------------------------------------------------------
// Plans → model inputs
// ---------------------------------------------------------------------------------------------

const SEASON_KEYS = ["nodes", "coresPerNode", "clockGHz", "memoryGB", "interconnect", "storage", "gpus", "solverGpus", "gpuModel", "gpuChargePct", "refreshYears", "leadWeeks", "mlPartitionKW", "mlPlacement"]

/** The shared part of a plan: `plan.shared`, or (prototype shape) every non-season key of the plan itself. */
export function sharedOf(plan) {
  if (plan.shared) return plan.shared
  const out = {}
  for (const [k, v] of Object.entries(plan)) if (!SEASONS.includes(Number(k)) && !["key", "id", "name", "tagline", "story", "timeline", "risks", "provides", "openQuestions", "cutover", "ml", "plan"].includes(k)) out[k] = v
  return out
}

/** Model inputs for one season of a plan (the 500 kW offer has no expansion right, E2: none is passed). */
export function planInputs(plan, season) {
  const seasonSet = plan[season] || {}
  const x = { ...sharedOf(plan), ...seasonSet, season }
  if (x.mlPartitionKW === undefined) x.mlPartitionKW = seasonSet.ml ?? (plan.ml && plan.ml[season]) ?? 0
  if (x.mlPlacement === undefined) x.mlPlacement = "dr"
  delete x.ml
  return x
}

/** A single-season input set as a plan (both seasons get the same set). */
export function planFromInputs(inputs) {
  const shared = {}
  const seasonal = {}
  for (const [k, v] of Object.entries(inputs)) {
    if (k === "season") continue
    if (SEASON_KEYS.includes(k)) seasonal[k] = v
    else shared[k] = v
  }
  return { shared, 2027: { ...seasonal }, 2028: { ...seasonal } }
}

// ---------------------------------------------------------------------------------------------
// Envelope + guard-rails over the model
// ---------------------------------------------------------------------------------------------

const r1 = (v) => Math.round(v * 10) / 10

/**
 * The model's envelope (`s.envelope`: fit test of brief 1.2) plus the optimiser guard-rails of 3.3
 * (`guardrails`, `ok`). `s` is a simulate() result.
 */
export function envelopeCheck(s) {
  const e = s.envelope
  const guardrails = []
  if (s.comp.usage > ENVELOPE.usageMax + 1e-9) guardrails.push(`allowance ${Math.round(s.comp.usage * 100)} % > 100 % (F4.6.10)`)
  if (s.money.capCharge > ENVELOPE.capChargeMaxCHF) guardrails.push(`cap charge CHF ${(s.money.capCharge / 1e6).toFixed(2)} M > CHF ${(ENVELOPE.capChargeMaxCHF / 1e6).toFixed(1)} M guard-rail`)
  const badFlags = s.flags.filter((f) => f.level === "bad")
  if (badFlags.length) guardrails.push("model flags: " + badFlags.map((f) => f.title).join("; "))
  return { ...e, guardrails, ok: e.fits && guardrails.length === 0, hinwilCap: e.hinwilCapacity, drHeadroomKW: e.headroomKW, facilityKW: r1(e.facilityKW) }
}

/** model.evaluate() with the guard-rails attached to `envelope`; the optimiser scores `perf.secExact`. */
export function envelopeEvaluate(raw) {
  const r = evaluate(raw)
  const envelope = envelopeCheck(r.scenario)
  return { ...r, envelope, scenario: { ...r.scenario, envelope } }
}

// ---------------------------------------------------------------------------------------------
// Plans and strategies, both seasons
// ---------------------------------------------------------------------------------------------

/** A season result's envelope (with guard-rails when the result came through envelopeEvaluate). */
export function envelopeOf(result) {
  const e = result.envelope || (result.scenario && result.scenario.envelope)
  return e && e.guardrails ? e : envelopeCheck(result.scenario)
}

/** Strategy timeline: contract at the planning date, declaration and cutover targeted at the ATP 1/2 boundary (8 Mar 2027; plan.js shows the slip the lead times impose), GPU re-declaration for 1 Jan 2028. */
export const STRATEGY_TIMELINE = Object.freeze({ contractDate: "2026-11-24", cutoverDate: "2027-03-08", parallelWeeks: 2, stepUpDate: "2028-01-01" })

/**
 * The strategy as a plan.js plan: plan-wide values (position, confidence, venue, one-offs) in `shared`, everything
 * else in the 2027 season set, 2028 holding only what differs (detached), plus the timeline. Returns null for an
 * unknown strategy.
 */
export function toPlan(idOrKey) {
  const st = typeof idOrKey === "string" ? strategyByKey(idOrKey) : idOrKey
  if (!st) return null
  return planFromSets(st, { name: st.name, strategy: st.key, timeline: { ...STRATEGY_TIMELINE } })
}

/**
 * A plan.js plan from optimiser-shaped sets `{ shared, 2027, 2028 }`: plan-wide values (SHARED_IDS) go to `shared`,
 * every other shared control becomes a 2027 value that 2028 inherits, and 2028 keeps only what differs from 2027.
 */
export function planFromSets(sets, { name = "Plan", preset = "custom", strategy = null, origin = null, timeline = null } = {}) {
  const shared = {}
  const season27 = {}
  for (const [k, v] of Object.entries(sharedOf(sets))) (SHARED_IDS.includes(k) ? shared : season27)[k] = v
  Object.assign(season27, sets[2027] || {})
  const season28 = {}
  for (const [k, v] of Object.entries(sets[2028] || {})) if (season27[k] !== v) season28[k] = v
  for (const s of [season27, season28]) { delete s.season; delete s.ml; delete s.expansionRight; delete s.legacyExpansionRight }
  const meta = { name, preset, ...(strategy ? { strategy } : {}), ...(origin ? { origin } : {}) }
  return { meta, shared, seasons: { 2027: season27, 2028: season28 }, ...(timeline ? { timeline } : {}) }
}

/** The strategy as a plan.js plan carrying the simulator's position, confidence and venue (the only inputs the cards borrow). */
export function strategyPlan(id, { position, confidence, venue } = {}) {
  const plan = toPlan(id)
  if (!plan) return null
  for (const [k, v] of Object.entries({ position, confidence, venue })) if (v !== undefined && v !== null) plan.shared[k] = v
  return plan
}

/**
 * The strategy a plan.js plan is exactly equal to (inputs and timeline, at the plan's own position, confidence and
 * venue), or null; `plan.meta.strategy` without a match means "edited in the planner".
 */
export function matchingStrategy(plan) {
  const p = normalizePlan(plan)
  const key = (q) => JSON.stringify({ s: q.shared, y: q.seasons, t: q.timeline })
  const pk = key(p)
  for (const id of STRATEGY_ORDER) if (key(normalizePlan(strategyPlan(id, p.shared))) === pk) return id
  return null
}

/**
 * Evaluate a { shared, 2027, 2028 } plan in both seasons. `position`, `confidence` and `venue` override the plan's
 * shared values (the strategy cards follow the simulator's sliders); `evaluateFn` defaults to the transitional
 * `envelopeEvaluate` and may be the merged model's `evaluate`.
 */
export function evaluatePlan(plan, { position, confidence, venue, evaluateFn = envelopeEvaluate } = {}) {
  const out = {}
  for (const season of SEASONS) {
    const inputs = planInputs(plan, season)
    if (position !== undefined) inputs.position = position
    if (confidence !== undefined) inputs.confidence = confidence
    if (venue !== undefined) inputs.venue = venue
    const r = evaluateFn(inputs)
    const envelope = envelopeOf(r)
    out[season] = { ...r, envelope, inputs, summary: summary({ ...r, envelope }) }
  }
  out.fits = SEASONS.every((y) => out[y].envelope.fits)
  out.ok = SEASONS.every((y) => out[y].envelope.ok !== false && out[y].scenario.status !== "bad")
  out.reasons = Object.fromEntries(SEASONS.map((y) => [y, [...out[y].envelope.reasons, ...(out[y].envelope.guardrails || [])]]))
  return out
}

const strategyCache = new Map()

/** Both seasons of a strategy ("A" / "consolidate"); memoised for the default model. */
export function evaluateStrategy(idOrKey, { position, confidence, venue, evaluateFn } = {}) {
  const strategy = strategyByKey(idOrKey)
  if (!strategy) throw new Error(`unknown strategy "${idOrKey}"`)
  const key = evaluateFn ? null : `${strategy.key}|${position ?? ""}|${confidence ?? ""}|${venue ?? ""}`
  if (key && strategyCache.has(key)) return strategyCache.get(key)
  const result = { strategy, ...evaluatePlan(strategy, { position, confidence, venue, evaluateFn }) }
  if (key) strategyCache.set(key, result)
  return result
}

/** All three, in display order. */
export function evaluateStrategies(options = {}) {
  return STRATEGY_ORDER.map((k) => evaluateStrategy(k, options))
}

export function clearStrategyCache() { strategyCache.clear() }

/** One flat row per season for a card or the comparison table (the prototype's summary()). */
export function summary(ev) {
  const s = ev.scenario, p = ev.perf, e = ev.envelope || envelopeOf(ev)
  return {
    season: s.inputs.season, fits: e.fits, ok: e.ok, reasons: e.reasons, guardrails: e.guardrails || [],
    sec: p.sec, decisionDeltaSec: p.decisionDeltaSec, weekendsAtRisk: s.net.weekendsLost,
    effMauh: s.comp.effectiveMauh, usedMauh: s.comp.usedMauh, usagePct: Math.round(s.comp.usage * 1000) / 10, allowance: s.fia.allowance.mauh,
    capCHF: s.money.capCharge, capDeltaCHF: p.capChargeDelta, yearlyCHF: s.money.yearly, tco3CHF: s.money.tco3, oneOffCHF: s.money.oneOffTotal,
    availabilityPct: s.comp.availabilityPct, pue: s.fac.pue, co2MarketT: s.money.co2MarketT, co2LocationT: s.money.co2LocationT, heatMWh: s.money.heatMWh,
    drIT: e.drIT, drHeadroomKW: e.headroomKW, facilityKW: e.facilityKW, clusterKW: e.clusterKW, estateAtDr: e.estateAtDr, mlPartitionKW: e.mlPartitionKW, racks: e.racks && e.racks.total, clusterRacks: s.hw.racks,
    hinwilIT: e.hinwilIT, turnaroundH: s.comp.turnaroundHours, runsPerWeek: s.comp.runsPerWeek, decisionSec: s.net.venue.decisionSec, linkAvail: s.net.linkAvailability,
    hardwareCHF: s.hw.hardwareCHF, status: s.status, flags: s.flags.filter((f) => f.level !== "ok" && f.level !== "info").map((f) => `${f.level}: ${f.title}`),
  }
}
