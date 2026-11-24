/**
 * The three strategic approaches as two-season plans, and the 500 kW envelope they must fit.
 * Pure ES module, no DOM.
 *
 *   STRATEGIES.A / .B / .C, STRATEGY_ORDER      the decision tables of strategies brief 2.1 with the stories of 2.3
 *   evaluateStrategy("B", { position, confidence, venue, evaluateFn })  → { 2027, 2028, fits, strategy }
 *   evaluatePlan(plan, options)                 any { shared, 2027, 2028 } plan, both seasons + fit
 *   envelopeCheck(scenario, { mlKW, mlPlacement }) → the fit test of brief 1.2 plus the optimiser guard-rails
 *   summary(seasonResult)                       one flat row for a card or a comparison table
 *
 * TRANSITIONAL until model.js has the envelope (strategies brief 5.3; see docs/audi-f1-modules.md):
 *   envelopeEvaluate(inputs, { mlKW })  wraps the committed model without editing it. The committed `facility()`
 *   reads `K.facility.restOfEstateKW[season]` (375 / 760 kW) at call time and places it at the site that hosts the
 *   cluster; here it is set to `estateBaseKW + mlPartitionKW` for the scenario call and restored in `finally`, and
 *   `evaluate()`'s performance block is replicated so Today is still computed at the committed demand estate.
 *   Once `simulate()` returns `s.envelope` (and `K.facility.envelopeKW` exists) the wrapper simply delegates to
 *   the model's `evaluate`, so the integrator can delete `simulateWithEstate` / `envelopeEvaluate` and pass
 *   `evaluate` as `evaluateFn`.
 */
import { evaluate, simulate, normalize, todayInputs, aeroSeconds, reinvestSeconds } from "./model.js"
import { K } from "./assumptions.js"
import { FIGURES } from "../customer.js"

// ---------------------------------------------------------------------------------------------
// The envelope (brief 1.1); every constant falls back to the committed K until the additions of 5.2 land
// ---------------------------------------------------------------------------------------------

const F = K.facility
export const ENVELOPE = Object.freeze({
  drOfferKW: F.envelopeKW ?? 500,
  baseEstateKW: F.estateBaseKW ?? 375,
  demandEstateKW: Object.freeze({ ...(F.estateDemandKW ?? F.restOfEstateKW ?? { 2027: 375, 2028: 760 }) }),
  hybridHinwilKW: F.hybridHinwilKW ?? 150,
  hinwilRoomKW: F.hinwilCapacityKW ?? 300,
  hinwilRetrofitKW: K.prices.hinwilRetrofitKW ?? 450,
  coolingMaxKWPerRack: Object.freeze({ ...(K.compute.coolingMaxKWPerRack ?? { air: 20, reardoor: 70, dlc: 150 }) }),
  cageRackPositions: F.cageRackPositions ?? 60,
  estateRackKW: F.estateRackKW ?? 8,
  ccfFloorGHz: Object.freeze({ ...(K.compute.ccfFloorGHz ?? { 64: 2.4, 96: 2.3, 128: 2.4, 192: 2.25 }) }),
  usageMax: 1.0,
  capChargeMaxCHF: (K.optimiser && K.optimiser.capGuardRailCHF) ?? 4_000_000,
  liquidRowsCHF: K.prices.drLiquidRowsCHF ?? (FIGURES.offer && FIGURES.offer.liquidLoopCHF) ?? 450_000,
  mlPlacements: Object.freeze(["dr", "hinwil", "cloud"]),
})

/** True while the committed model has no envelope of its own (the wrapper below then does the estate placement). */
export const TRANSITIONAL = !(F.envelopeKW && F.estateBaseKW)

// ---------------------------------------------------------------------------------------------
// The strategies (brief 2.1, 2.3)
// ---------------------------------------------------------------------------------------------

/** Shared assumptions of all three plans (COMMON in the prototype). */
export const COMMON = Object.freeze({
  position: 8, confidence: 60, pueMode: "derived", tariffRp: 15, renewable: true, heatReuse: true,
  expansionRight: false, hinwilRetrofit: false, fitOutCHF: 800_000, migrationCHF: 400_000, migrationTiming: "boundary",
  propertySharePct: 50, venue: "singapore", gpuChargePct: 100, location: "dr", committedKW: 500,
})

const CUTOVER_2027 = "Declaration and cutover at the P1/P2 boundary (8 Mar 2027), after the Bahrain test; the Hinwil cluster carries P1."
const SITE_TIMELINE = [
  { when: "Dec 2026 – Feb 2027", what: "Contract, cage fit-out, pre-cabling to the Meet-Me-Room (15 business days), cross-connects (3 business days); dark fibre ordered in week 1 (3–6-month build)" },
  { when: "24–27 Feb 2027", what: "Bahrain test on the Hinwil cluster" },
  { when: "8 Mar 2027 (P1/P2 boundary)", what: "New declaration (cluster, location, cores, CCF) and cutover; estate migrated wave by wave in P2–P3" },
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
    cutover: { 2027: "CPU fleet declared at the P1/P2 boundary (8 Mar 2027).", 2028: "GPU rows delivered 6 weeks before 1 Jan 2028, burned in during P6 2027 as unrestricted hardware (legal: pre/post-processing), re-declared for 1 Jan 2028 (P6/P1 boundary); the GreenLake buffer absorbs the swap and the released CPU nodes return under the GreenLake term." },
    timeline: [
      ...SITE_TIMELINE,
      { when: "Mid Nov 2027", what: "GPU hosts delivered (lead −6 weeks); burn-in during P6 as unrestricted pre/post-processing hardware" },
      { when: "1 Jan 2028 (P6/P1 boundary)", what: "Re-declaration: 3 CPU nodes + 4 B200 solver GPUs; 15 CPU nodes returned under the GreenLake term; 50 kW ML partition live" },
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
    cutover: { 2027: "Declaration at 8 Mar 2027 (P1/P2 boundary).", 2028: "2028 hardware 4 weeks early, re-declared for 1 Jan 2028; the GreenLake 20 % buffer carries the 18 → 11 node re-shape." },
    timeline: [
      ...SITE_TIMELINE,
      { when: "Early Dec 2027", what: "2 solver + 2 unrestricted B200s delivered (lead −4 weeks); CPU fleet re-shaped 18 → 11 nodes under the GreenLake buffer" },
      { when: "1 Jan 2028 (P6/P1 boundary)", what: "Re-declaration: 11 CPU nodes at 2.4 GHz + 2 B200 solver GPUs" },
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

/** Model inputs for one season of a plan. The expansion right is never part of the offer (E2). */
export function planInputs(plan, season) {
  const seasonSet = plan[season] || {}
  const x = { ...sharedOf(plan), ...seasonSet, season, expansionRight: false }
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
// Transitional envelope wrapper over the committed model
// ---------------------------------------------------------------------------------------------

const restoreEstate = F.restOfEstateKW ? { ...F.restOfEstateKW } : null

/** Rest-of-estate kW the scenario places at the site hosting the cluster (hybrid: the model keeps 150 kW at Hinwil). */
export function estateForScenario(x, mlKW = 0, mlPlacement = "dr") {
  // Staying in Hinwil means trying to run the whole committed demand there (E9: the room keeps its own ceiling).
  if (x.location === "hinwil") return ENVELOPE.demandEstateKW[x.season] + (mlPlacement === "hinwil" ? mlKW : 0)
  return ENVELOPE.baseEstateKW + (mlPlacement === "dr" ? mlKW : 0)
}

/** simulate() with the scenario's estate placed, then the committed constant restored. */
export function simulateWithEstate(raw, mlKW = 0, mlPlacement = "dr") {
  const x = normalize(raw)
  if (!restoreEstate || !TRANSITIONAL) return simulate(x)
  F.restOfEstateKW[x.season] = estateForScenario(x, mlKW, mlPlacement)
  try { return simulate(x) } finally { F.restOfEstateKW[x.season] = restoreEstate[x.season] }
}

const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000

function mlOf(inputs, mlKW) {
  const kW = Math.max(0, Number(mlKW ?? inputs.mlPartitionKW ?? inputs.ml ?? 0) || 0)
  const placement = ENVELOPE.mlPlacements.includes(inputs.mlPlacement) ? inputs.mlPlacement : "dr"
  return { kW, placement }
}

/**
 * The fit test of brief 1.2 (`fits`, `reasons`) plus the optimiser guard-rails of 3.3 (`guardrails`, `ok`).
 * `s` is a simulate() result; the ML partition comes from `s.inputs` or the options.
 */
export function envelopeCheck(s, { mlKW, mlPlacement } = {}) {
  const x = s.inputs
  const ml = mlOf(x, mlKW)
  if (mlPlacement) ml.placement = mlPlacement
  const reasons = []
  const guardrails = []
  const atDr = x.location !== "hinwil"
  const atHinwil = x.location !== "dr"
  const drIT = s.fac.drIT
  const hinwilIT = s.fac.hinwilIT + (atHinwil && x.location === "hybrid" && ml.placement === "hinwil" ? ml.kW : 0)
  const hinwilCap = x.hinwilRetrofit ? ENVELOPE.hinwilRetrofitKW : ENVELOPE.hinwilRoomKW
  const coolingMax = ENVELOPE.coolingMaxKWPerRack[x.cooling]

  if (atDr && drIT > ENVELOPE.drOfferKW + 1e-9) reasons.push(`Digital Realty: ${drIT.toFixed(0)} kW > ${ENVELOPE.drOfferKW} kW offer`)
  if (x.location === "hybrid" && hinwilIT > hinwilCap + 1e-9) reasons.push(`Hinwil keeps ${hinwilIT.toFixed(0)} kW against ${hinwilCap} kW`)
  if (atDr && x.rackKW > coolingMax) reasons.push(`${x.rackKW} kW racks exceed the ${coolingMax} kW ${x.cooling === "air" ? "air" : x.cooling === "reardoor" ? "rear-door" : "direct-liquid"} ceiling`)
  const estateAtDr = atDr ? Math.max(0, drIT - s.hw.clusterKW - (ml.placement === "dr" ? ml.kW : 0)) : 0
  const mlAtDr = atDr && ml.placement === "dr" ? ml.kW : 0
  const racks = {
    estate: atDr ? Math.ceil(estateAtDr / ENVELOPE.estateRackKW) : 0,
    cluster: s.hw.racks,
    ml: mlAtDr > 0 ? Math.ceil(mlAtDr / x.rackKW) : 0,
  }
  racks.total = racks.estate + racks.cluster + racks.ml
  if (atDr && racks.total > ENVELOPE.cageRackPositions) reasons.push(`${racks.total} racks > ${ENVELOPE.cageRackPositions} cage positions`)
  if (x.expansionRight) reasons.push("Expansion right is not part of the 500 kW offer (commercial note)")
  if (x.season < K.fia.gpuAllowedFrom && x.solverGpus > 0) reasons.push(`GPU solver not allowed in ${x.season} (F4.4.1)`)
  const floor = ENVELOPE.ccfFloorGHz[x.coresPerNode]
  if (x.nodes > 0 && floor && x.clockGHz < floor - 1e-9) reasons.push(`CCF ${x.clockGHz} GHz below the ${floor} GHz base clock of a ${x.coresPerNode}-core part (F4.4.2)`)
  if (ml.placement === "cloud" && ml.kW > 0 && !x.cloudOnRamp) reasons.push("ML partition in the cloud needs the cloud on-ramps")

  if (s.comp.usage > ENVELOPE.usageMax + 1e-9) guardrails.push(`allowance ${Math.round(s.comp.usage * 100)} % > 100 % (F4.6.10)`)
  if (s.money.capCharge > ENVELOPE.capChargeMaxCHF) guardrails.push(`cap charge CHF ${(s.money.capCharge / 1e6).toFixed(2)} M > CHF ${(ENVELOPE.capChargeMaxCHF / 1e6).toFixed(1)} M guard-rail`)
  if (s.status === "bad") guardrails.push("model flags: " + s.flags.filter((f) => f.level === "bad").map((f) => f.title).join("; "))

  const headroomKW = atDr ? r1(ENVELOPE.drOfferKW - drIT) : null
  return {
    fits: reasons.length === 0, reasons, guardrails, ok: reasons.length === 0 && guardrails.length === 0,
    offerKW: ENVELOPE.drOfferKW, drIT, headroomKW, drHeadroomKW: headroomKW, share: atDr ? drIT / ENVELOPE.drOfferKW : 0,
    hinwilIT: r1(hinwilIT), hinwilCap, estateAtDr: r1(estateAtDr), clusterKW: s.hw.clusterKW,
    mlPartitionKW: ml.kW, mlPlacement: ml.placement, mlAtDr,
    racks, facilityKW: r1(drIT * s.fac.pueDr),
  }
}

/** The CHF 0.45 M liquid-rows one-off at the campus the committed model does not charge yet (5.3 change 8, †). */
function withLiquidRows(scenario) {
  const x = scenario.inputs
  if (!(x.location !== "hinwil" && x.cooling === "dlc" && scenario.fac.drIT > 0)) return scenario
  if (scenario.money.oneOffs.some((o) => o.id === "liquidrows")) return scenario
  const oneOff = { id: "liquidrows", label: "Liquid rows at Digital Realty (CDUs, manifolds) †", chf: ENVELOPE.liquidRowsCHF, cap: "excluded", why: "Leasehold improvement; the committed model does not charge it yet" }
  const money = { ...scenario.money, oneOffs: [...scenario.money.oneOffs, oneOff], oneOffTotal: scenario.money.oneOffTotal + oneOff.chf, tco3: scenario.money.tco3 + oneOff.chf }
  return { ...scenario, money }
}

/**
 * evaluate() replicated for the 500 kW envelope: the scenario with its estate placed, Today at the committed
 * demand estate, plus `envelope` (also attached as `scenario.envelope`) and the unrounded `perf.secExact` /
 * `perf.pointsExact` the optimiser scores with. Returns the same shape as model.evaluate().
 */
export function envelopeEvaluate(raw, { mlKW, liquidRows = true } = {}) {
  const x = normalize(raw)
  const ml = mlOf({ ...x, ...(raw && raw.mlPartitionKW !== undefined ? { mlPartitionKW: raw.mlPartitionKW } : {}), ...(raw && raw.mlPlacement !== undefined ? { mlPlacement: raw.mlPlacement } : {}) }, mlKW)
  x.mlPartitionKW = ml.kW
  x.mlPlacement = ml.placement
  if (!TRANSITIONAL) {
    // the merged model owns the envelope: delegate, and only keep the exact fields the optimiser needs
    const r = evaluate(x)
    const envelope = r.scenario.envelope || envelopeCheck(r.scenario, { mlKW: ml.kW, mlPlacement: ml.placement })
    const perf = { ...r.perf, secExact: r.perf.secExact ?? r.perf.sec, pointsExact: r.perf.pointsExact ?? r.perf.points }
    return { ...r, envelope, perf }
  }
  let scenario = simulateWithEstate(x, ml.kW, ml.placement)
  if (liquidRows) scenario = withLiquidRows(scenario)
  const today = simulate(todayInputs(x.season, x.position, x.confidence))
  const conf = x.confidence / 100
  const aero = aeroSeconds(scenario.comp.effectiveMauh) - aeroSeconds(today.comp.effectiveMauh)
  const saved = today.money.capCharge - scenario.money.capCharge
  const reinvest = reinvestSeconds(saved)
  const rawSec = aero + reinvest
  const sec = rawSec * conf
  const perf = K.performance
  const positionsGained = sec / perf.secPerPosition
  const [lo, hi] = perf.midfield
  const scenarioPosition = Math.min(Math.max(x.position - positionsGained, Math.min(lo, x.position)), Math.max(hi, x.position))
  const points = (x.position - scenarioPosition) * perf.pointsPerPosition
  const strategyPoints = (scenario.net.quality - today.net.quality) * K.trackside.strategyPointsSwing * conf
  const ladder = []
  for (let p = Math.min(lo, x.position); p <= Math.max(hi, x.position); p++) ladder.push({ position: p, sec: r2((p - x.position) * perf.secPerPosition) })
  const envelope = envelopeCheck(scenario, { mlKW: ml.kW, mlPlacement: ml.placement })
  scenario = { ...scenario, inputs: { ...scenario.inputs, mlPartitionKW: ml.kW, mlPlacement: ml.placement }, envelope }
  if (!envelope.fits && scenario.status !== "bad") scenario = { ...scenario, status: "bad" }
  return {
    scenario, today, envelope,
    perf: {
      aeroSec: r3(aero), reinvestSec: r3(reinvest), rawSec: r3(rawSec), sec: r3(sec), secExact: sec, pointsExact: points,
      savedCHF: Math.round(saved), confidence: x.confidence,
      aeroTodaySec: r3(aeroSeconds(today.comp.effectiveMauh)), aeroScenarioSec: r3(aeroSeconds(scenario.comp.effectiveMauh)),
      positionsGained: r2(positionsGained), scenarioPosition: r2(scenarioPosition), points: r1(points),
      strategyPoints: r1(strategyPoints), ladder,
      effectiveMauhDelta: r3(scenario.comp.effectiveMauh - today.comp.effectiveMauh),
      capChargeDelta: scenario.money.capCharge - today.money.capCharge,
      yearlyDelta: scenario.money.yearly - today.money.yearly,
      co2Delta: r1(scenario.money.co2MarketT - today.money.co2MarketT),
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Plans and strategies, both seasons
// ---------------------------------------------------------------------------------------------

/** A season result's envelope, whichever model produced it. */
export function envelopeOf(result) {
  return result.envelope || (result.scenario && result.scenario.envelope) || envelopeCheck(result.scenario)
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
    sec: p.sec, position: p.scenarioPosition, points: p.points, strategyPoints: p.strategyPoints,
    effMauh: s.comp.effectiveMauh, usedMauh: s.comp.usedMauh, usagePct: Math.round(s.comp.usage * 1000) / 10, allowance: s.fia.allowance.mauh,
    capCHF: s.money.capCharge, capDeltaCHF: p.capChargeDelta, yearlyCHF: s.money.yearly, tco3CHF: s.money.tco3, oneOffCHF: s.money.oneOffTotal,
    availabilityPct: s.comp.availabilityPct, pue: s.fac.pue, co2MarketT: s.money.co2MarketT, co2LocationT: s.money.co2LocationT, heatMWh: s.money.heatMWh,
    drIT: e.drIT, drHeadroomKW: e.headroomKW, facilityKW: e.facilityKW, clusterKW: e.clusterKW, estateAtDr: e.estateAtDr, mlPartitionKW: e.mlPartitionKW, racks: e.racks && e.racks.total, clusterRacks: s.hw.racks,
    hinwilIT: e.hinwilIT, turnaroundH: s.comp.turnaroundHours, runsPerWeek: s.comp.runsPerWeek, decisionSec: s.net.venue.decisionSec, linkAvail: s.net.linkAvailability,
    hardwareCHF: s.hw.hardwareCHF, status: s.status, flags: s.flags.filter((f) => f.level !== "ok" && f.level !== "info").map((f) => `${f.level}: ${f.title}`),
  }
}
