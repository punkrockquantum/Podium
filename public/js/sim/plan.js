/**
 * A two-season plan: the same controls as the single-season model, held once for 2027 and, by default,
 * inherited by 2028 ("same as 2027") with per-control detach. `evaluatePlan` runs both seasons against
 * today's setup, blends each season by the deployment timeline (part of the year on the old estate, part
 * on the new one, minus any allowance lost at the cutover) and returns the figures, deltas and health
 * the Overview and the component views render. Pure functions, no DOM.
 */
import { CONTROLS, DEFAULTS, GROUPS, PRESETS, normalize, simulate, todayInputs, perfBlock, ceilings, fitToEnvelope, envelope, ccfFloor } from "./model.js"
import { buildTimeline, normalizeTimeline, TIMELINE_DEFAULTS, fmtDate, parseDate, isoDate, nextBoundary, weeksBetween, PLANNING_DATE } from "./timeline.js"
import { K } from "./assumptions.js"

export const PLAN_VERSION = 1
export const SEASONS = [2027, 2028]
/** Held once for the whole plan: the sliding-scale position, confidence, the latency venue and the one-off / accounting choices. */
export const SHARED_IDS = ["position", "confidence", "venue", "propertySharePct", "fitOutCHF", "migrationCHF"]
/** Superseded by the timeline: the plan sets them from the schedule rather than from a slider. */
export const TIMELINE_IDS = ["leadWeeks", "migrationTiming"]
/** Everything else is decided per season. */
export const SEASON_IDS = GROUPS.flatMap((g) => g.controls.map((c) => c.id)).filter((id) => id !== "season" && !SHARED_IDS.includes(id) && !TIMELINE_IDS.includes(id))
export const NAME_MAX = 60

/** A plan name within NAME_MAX: longer names are cut at a word boundary and end with an ellipsis, never mid-word. */
export function fitName(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ")
  if (s.length <= NAME_MAX) return s
  const cut = s.slice(0, NAME_MAX - 1)
  const at = cut.lastIndexOf(" ")
  return `${(at > NAME_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s·,;:–-]+$/, "")}…`
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const pick = (obj, ids) => Object.fromEntries(ids.filter((id) => obj[id] !== undefined).map((id) => [id, obj[id]]))

// ---------------------------------------------------------------------------------------------
// Presets: full two-season plans
// ---------------------------------------------------------------------------------------------

const seasonValues = (inputs) => pick(normalize({ ...DEFAULTS, ...inputs }), SEASON_IDS)
const sharedValues = (inputs) => pick(normalize({ ...DEFAULTS, ...inputs }), SHARED_IDS)

export const PLAN_PRESETS = {
  today: {
    id: "today",
    label: "Today: stay at Hinwil",
    short: "Stay at Hinwil",
    summary: "Both seasons on the existing room: air-cooled 12 kW racks, one carrier circuit, no GPU partition.",
    plan: {
      meta: { name: "Today: stay at Hinwil", preset: "today" },
      shared: sharedValues(PRESETS.today.inputs),
      seasons: { 2027: seasonValues(PRESETS.today.inputs), 2028: {} },
      timeline: { ...TIMELINE_DEFAULTS },
    },
  },
  dr2027: {
    id: "dr2027",
    label: "Digital Realty Zurich from 2027",
    short: "DR Zurich 2027",
    summary: "Move the Restricted CFD estate to the campus for 2027; 2028 runs the same estate (same as 2027).",
    plan: {
      meta: { name: "Digital Realty Zurich from 2027", preset: "dr2027" },
      shared: sharedValues(PRESETS.dr2027.inputs),
      seasons: { 2027: seasonValues(PRESETS.dr2027.inputs), 2028: {} },
      timeline: { contractDate: "2026-12-15", cutoverDate: "2027-05-03", parallelWeeks: 2, stepUpDate: "2028-01-01" },
    },
  },
  gl2028: {
    id: "gl2028",
    label: "Digital Realty Zurich 2027 + HPE GreenLake GPU step-up 2028",
    short: "DR 2027 + GreenLake GPU 2028",
    summary: "Same 2027 move on HPE GreenLake; on 1 January 2028 the partition steps up to GPUs, liquid rows and 2N inside the 500 kW envelope.",
    plan: {
      meta: { name: "Digital Realty Zurich 2027 + HPE GreenLake GPU step-up 2028", preset: "gl2028" },
      shared: sharedValues(PRESETS.dr2027.inputs),
      seasons: {
        2027: seasonValues({ ...PRESETS.dr2027.inputs, consumption: "greenlake" }),
        2028: { nodes: 8, clockGHz: 3.0, gpus: 8, solverGpus: 2, interconnect: "slingshot", storage: "flash", support: "mission", refreshYears: 3, rackKW: 60, cooling: "dlc", redundancy: "2n", fibreGbps: 400, trackside: "dualsat", cloudOnRamp: true },
      },
      timeline: { contractDate: "2026-12-15", cutoverDate: "2027-05-03", parallelWeeks: 2, stepUpDate: "2028-01-01" },
    },
  },
}
export const PLAN_PRESET_ORDER = ["today", "dr2027", "gl2028"]

export function presetPlan(id) {
  const p = PLAN_PRESETS[id] || PLAN_PRESETS.dr2027
  return normalizePlan(JSON.parse(JSON.stringify(p.plan)))
}

// ---------------------------------------------------------------------------------------------
// Shape, inheritance, detach
// ---------------------------------------------------------------------------------------------

/** Fill, coerce and clamp a plan; 2028 keeps only the controls it has detached. */
export function normalizePlan(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {}
  const seasons = r.seasons && typeof r.seasons === "object" ? r.seasons : {}
  const s27raw = seasons[2027] && typeof seasons[2027] === "object" ? seasons[2027] : {}
  const s28raw = seasons[2028] && typeof seasons[2028] === "object" ? seasons[2028] : {}
  const sharedRaw = r.shared && typeof r.shared === "object" ? r.shared : {}
  const shared = pick(normalize({ ...DEFAULTS, ...sharedRaw }), SHARED_IDS)
  const x27 = normalize({ ...DEFAULTS, ...shared, ...pick(s27raw, SEASON_IDS), season: 2027 })
  const s27 = pick(x27, SEASON_IDS)
  const detached = SEASON_IDS.filter((id) => s28raw[id] !== undefined && s28raw[id] !== null)
  const x28 = normalize({ ...x27, ...pick(s28raw, detached), season: 2028 })
  const s28 = pick(x28, detached)
  const meta = r.meta && typeof r.meta === "object" ? r.meta : {}
  const name = fitName(meta.name) || "Untitled plan"
  const preset = typeof meta.preset === "string" && PLAN_PRESETS[meta.preset] ? meta.preset : "custom"
  // A plan saved before the 500 kW envelope may still carry the removed expansion-right control: it is ignored,
  // and remembered only so plan health can say so (an info note, never a change to the figures)
  const legacy = meta.legacyExpansionRight === true || [sharedRaw, s27raw, s28raw].some((o) => o.expansionRight === true || o.legacyExpansionRight === true)
  // lineage: the strategy (A/B/C) or the optimiser proposal this plan was loaded from; the chip reads "Custom (from B)" once edited
  const strategy = typeof meta.strategy === "string" && /^[A-Z]$/.test(meta.strategy) ? meta.strategy : null
  const origin = typeof meta.origin === "string" && meta.origin ? meta.origin.slice(0, 40) : null
  return {
    meta: { name, preset, version: PLAN_VERSION, ...(meta.updatedAt ? { updatedAt: String(meta.updatedAt) } : {}), ...(legacy ? { legacyExpansionRight: true } : {}), ...(strategy ? { strategy } : {}), ...(origin ? { origin } : {}) },
    shared,
    seasons: { 2027: s27, 2028: s28 },
    timeline: normalizeTimeline(r.timeline),
  }
}

/** Full model inputs for a season of the plan (2028 inherits 2027 except where detached). */
export function seasonInputs(plan, year) {
  const p = plan
  const base = { ...DEFAULTS, ...p.shared, ...p.seasons[2027], season: year, ...(p.meta?.legacyExpansionRight ? { legacyExpansionRight: true } : {}) }
  if (year === 2028) Object.assign(base, p.seasons[2028])
  // The timeline decides delivery and the cutover; the two legacy controls stay neutral.
  base.leadWeeks = 0
  base.migrationTiming = "boundary"
  return normalize(base)
}

export const isDetached = (plan, id) => plan.seasons[2028][id] !== undefined
export const isShared = (id) => SHARED_IDS.includes(id)
export const isTimelineControl = (id) => TIMELINE_IDS.includes(id)

/** The value a control has in a season of the plan. */
export function controlValue(plan, year, id) {
  if (isShared(id)) return plan.shared[id]
  if (year === 2028 && isDetached(plan, id)) return plan.seasons[2028][id]
  return plan.seasons[2027][id] ?? DEFAULTS[id]
}

/** Set a control for a season; setting an inherited 2028 control detaches it. Returns a new plan. */
export function setControl(plan, year, id, value) {
  const next = JSON.parse(JSON.stringify(plan))
  if (isShared(id)) next.shared[id] = value
  else if (year === 2028) next.seasons[2028][id] = value
  else next.seasons[2027][id] = value
  next.meta.preset = "custom"
  return normalizePlan(next)
}

/** Detach a 2028 control from 2027 (its current inherited value becomes its own). */
export function detach(plan, id) {
  if (isShared(id) || isDetached(plan, id)) return plan
  const next = JSON.parse(JSON.stringify(plan))
  next.seasons[2028][id] = controlValue(plan, 2027, id)
  return normalizePlan(next)
}

/** Reattach a 2028 control to 2027 ("same as 2027"). */
export function reattach(plan, id) {
  if (!isDetached(plan, id)) return plan
  const next = JSON.parse(JSON.stringify(plan))
  delete next.seasons[2028][id]
  next.meta.preset = "custom"
  return normalizePlan(next)
}

export function setTimeline(plan, patch) {
  const next = JSON.parse(JSON.stringify(plan))
  next.timeline = { ...next.timeline, ...patch }
  next.meta.preset = "custom"
  return normalizePlan(next)
}

// ---------------------------------------------------------------------------------------------
// Ceilings, dependent re-clamps and the envelope fit (strategies brief 1.3)
// ---------------------------------------------------------------------------------------------

const COOLING_WORD = { air: "air", reardoor: "rear-door", dlc: "direct-liquid" }

/** The live ceilings of every clamped control in a season of the plan (closed form, from model.ceilings). */
export const seasonCeilings = (plan, year) => ceilings(seasonInputs(plan, year))

/**
 * The hard dependent ceilings a change can trip: rack density above the cooling ceiling, a declared clock below
 * the CCF floor of the part, more solver GPUs than GPUs. Returns the re-clamped value or null for each season.
 */
function dependentClamps(x) {
  const out = []
  const coolingMax = K.compute.coolingMaxKWPerRack[x.cooling]
  if (x.rackKW > coolingMax) out.push({ id: "rackKW", from: x.rackKW, to: coolingMax, reason: `${COOLING_WORD[x.cooling]} ceiling` })
  const floor = ccfFloor(x)
  if (x.nodes > 0 && x.clockGHz < floor - 1e-9) out.push({ id: "clockGHz", from: x.clockGHz, to: floor, reason: `${floor} GHz base clock` })
  return out
}

/** The seasons a change to `id` in `year` affects: 2027 changes flow into 2028 unless 2028 has detached the control. */
const affectedSeasons = (plan, year, id) => (isShared(id) ? SEASONS : year === 2028 ? [2028] : isDetached(plan, id) ? [2027] : SEASONS)

/**
 * Set a control and re-clamp its dependents (rack density to the cooling ceiling, declared clock to the CCF floor).
 * Returns `{ plan, changes: [{ year, id, from, to, reason }] }`; the UI shows "Also changed: …" for each change.
 */
export function setControlClamped(plan, year, id, value) {
  let next = setControl(plan, year, id, value)
  const changes = []
  for (const y of affectedSeasons(next, year, id)) {
    for (const c of dependentClamps(seasonInputs(next, y))) {
      if (c.id === id) continue
      // The dependent control follows the season the user changed: 2028 detaches only when 2027 does not carry it
      const target = y === 2028 && (year === 2028 || isDetached(next, c.id)) ? 2028 : 2027
      if (target === 2027 && isDetached(next, c.id) && y === 2028) continue
      next = setControl(next, target, c.id, c.to)
      if (!changes.some((d) => d.id === c.id && d.to === c.to)) changes.push({ year: y, id: c.id, from: c.from, to: c.to, reason: c.reason })
    }
  }
  return { plan: next, changes }
}

/**
 * Clamp a season of the plan into the 500 kW envelope (model.fitToEnvelope order: ML partition → GPUs → nodes →
 * rack density → CCF floor). 2028 changes detach the control. Returns `{ plan, changes, fits }`.
 */
export function fitPlanToEnvelope(plan, year) {
  const fit = fitToEnvelope(seasonInputs(plan, year))
  let next = plan
  for (const c of fit.changes) next = setControl(next, year, c.id, c.to)
  return { plan: next, changes: fit.changes.map((c) => ({ ...c, year })), fits: fit.fits }
}

/**
 * Which options of a select or segmented control would not fit the envelope in a season of the plan
 * (while the current value does). Returns `{ [value]: reason }`.
 */
export function optionFit(plan, year, id) {
  const control = CONTROLS[id]
  if (!control || !control.options) return {}
  const x = seasonInputs(plan, year)
  const now = envelope(normalize(x))
  if (!now.fits) return {}
  const out = {}
  for (const o of control.options) {
    if (o.value === x[id]) continue
    // The option is judged after the re-clamps that choosing it would trigger (rack density, CCF floor)
    const y = normalize({ ...x, [id]: o.value })
    for (const c of dependentClamps(y)) y[c.id] = c.to
    const env = envelope(normalize(y))
    if (!env.fits) out[o.value] = env.reasons[0]
  }
  return out
}

export function renamePlan(plan, name) {
  const next = JSON.parse(JSON.stringify(plan))
  next.meta.name = name
  return normalizePlan(next)
}

/** Apply a whole preset's season values but keep the plan's name when it is a custom one. */
export function applyPlanPreset(plan, id) {
  return presetPlan(id)
}

/** Which preset a plan matches exactly, or null. */
export function matchingPreset(plan) {
  const p = normalizePlan(plan)
  for (const id of PLAN_PRESET_ORDER) {
    const q = presetPlan(id)
    if (JSON.stringify({ s: p.shared, y: p.seasons, t: p.timeline }) === JSON.stringify({ s: q.shared, y: q.seasons, t: q.timeline })) return id
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

const ESTATE_IDS = ["nodes", "coresPerNode", "clockGHz", "cpuArch", "memoryGB", "interconnect", "storage", "gpus", "solverGpus", "gpuModel", "consumption", "location", "cooling", "rackKW", "redundancy", "committedKW", "hinwilRetrofit", "mlPartitionKW", "mlPlacement"]
const CPU_IDS = ["nodes", "coresPerNode", "clockGHz", "cpuArch", "memoryGB", "interconnect", "storage", "location"]
const ROUTE_OF_FLAG = { mauh: "compute", gpu: "compute", clock: "compute", arch: "compute", armport: "compute", power: "facility", racks: "facility", hybridpower: "facility", cooling: "facility", loop: "facility", expansion: "facility", declare: "deployment", delivery: "deployment" }

const itLine = (sim) => sim.money.lines.find((l) => l.id === "it")?.chf || 0

/**
 * Evaluate a plan for both seasons.
 * Returns { plan, inputs, today, sims, seasons: {2027, 2028}, deltas, timeline, health, totals }.
 */
export function evaluatePlan(rawPlan) {
  const plan = normalizePlan(rawPlan)
  const x27 = seasonInputs(plan, 2027)
  const x28 = seasonInputs(plan, 2028)
  const today27 = simulate(todayInputs(2027, plan.shared.position, plan.shared.confidence, plan.shared.venue))
  const today28 = simulate(todayInputs(2028, plan.shared.position, plan.shared.confidence, plan.shared.venue))
  const todayIds = SEASON_IDS.filter((id) => !["venue"].includes(id))
  const changes27 = todayIds.some((id) => x27[id] !== today27.inputs[id])
  const stepUp = SEASON_IDS.some((id) => x28[id] !== x27[id])
  const estateStepUp = ESTATE_IDS.some((id) => x28[id] !== x27[id])
  const cpuChange28 = CPU_IDS.some((id) => x28[id] !== x27[id])
  const pre27 = simulate(x27)
  const pre28 = simulate(x28)
  // The 2028 step-up needs campus works when it changes the cooling, the redundancy, the density or the rows at the campus
  const stepUpFitOutNeeded = x28.location !== "hinwil" && (x28.cooling !== x27.cooling || x28.redundancy !== x27.redundancy || x28.rackKW > x27.rackKW || pre28.fac.racks.total > pre27.fac.racks.total || pre28.fac.mlAtDr > pre27.fac.mlAtDr)

  const timeline = buildTimeline(plan.timeline, {
    x27, x28, changes27, stepUp: estateStepUp, cpuChange28, stepUpFitOutNeeded,
    itYearly27: itLine(pre27), itYearly28: itLine(pre28),
  })
  const t27 = timeline.seasons[2027]
  const t28 = timeline.seasons[2028]

  // 2027: today's estate until the cutover, then the plan's estate (minus any allowance lost at the switch)
  const shareOld27 = changes27 ? t27.shareOld : 0
  const shareNew27 = 1 - shareOld27
  const loss27 = shareNew27 > 0 ? clamp(t27.seasonLoss / shareNew27, 0, 1) : 0
  const sim27 = simulate({ ...x27, scheduleLoss: loss27 })
  const w27 = shareOld27 * today27.comp.effectiveMauh + shareNew27 * sim27.comp.effectiveMauh

  // 2028: the 2027 estate (or today's, if the move is still running) until the step-up, then the 2028 estate
  const carry28 = simulate({ ...x27, season: 2028 })
  const jan2028 = Date.UTC(2028, 0, 1)
  const shareToday28 = changes27 && t27.goLive ? clamp((t27.goLive - jan2028) / (366 * 86_400_000), 0, 1) : 0
  const shareOld28 = estateStepUp ? Math.max(t28.shareOld, shareToday28) : shareToday28
  const shareCarry28 = Math.max(0, shareOld28 - shareToday28)
  const shareNew28 = 1 - shareOld28
  const loss28 = shareNew28 > 0 ? clamp(t28.seasonLoss / shareNew28, 0, 1) : 0
  const sim28 = simulate({ ...x28, scheduleLoss: loss28 })
  const w28 = shareToday28 * today28.comp.effectiveMauh + shareCarry28 * carry28.comp.effectiveMauh + shareNew28 * (estateStepUp ? sim28.comp.effectiveMauh : carry28.comp.effectiveMauh * (1 - loss28))

  const perf27 = perfBlock(sim27, today27, { wScenario: w27, wToday: today27.comp.effectiveMauh })
  const perf28 = perfBlock(sim28, today28, { wScenario: w28, wToday: today28.comp.effectiveMauh })

  const oneOffs27 = [...sim27.money.oneOffs.filter((o) => changes27 || o.id === "edge" || o.id === "patch"), ...timeline.oneOffs.filter((o) => o.year === 2027)]
  const oneOffs28 = [...(estateStepUp ? sim28.money.oneOffs.filter((o) => ["liquidrows", "loop", "reardoor"].includes(o.id) && !sim27.money.oneOffs.some((p) => p.id === o.id)) : []), ...timeline.oneOffs.filter((o) => o.year === 2028)]
  const cash = (shares, oneOffs) => Math.round(shares.reduce((s, [share, sim]) => s + share * sim.money.yearly, 0) + oneOffs.reduce((s, o) => s + o.chf, 0))
  const cash27 = cash([[shareOld27, today27], [shareNew27, sim27]], oneOffs27)
  const cash28 = cash([[shareToday28, today28], [shareCarry28, carry28], [shareNew28, estateStepUp ? sim28 : carry28]], oneOffs28)
  const todayCash27 = Math.round(today27.money.yearly + today27.money.oneOffs.reduce((s, o) => s + o.chf, 0))
  const todayCash28 = Math.round(today28.money.yearly)

  const season = (year, sim, today, perf, shares, cashYear, todayCash, oneOffs, t) => ({
    year, inputs: sim.inputs, sim, today, perf,
    blend: { ...shares, goLive: t.goLive, lossShare: round(t.seasonLoss, 5), periodLoss: round(t.periodLoss, 5), downtimeDays: t.downtimeDays },
    money: {
      yearly: sim.money.yearly, capCharge: sim.money.capCharge, excludedYearly: sim.money.excludedYearly, capShare: sim.money.capShare,
      yearlyDelta: sim.money.yearly - today.money.yearly, capChargeDelta: sim.money.capCharge - today.money.capCharge,
      cash: cashYear, todayCash, cashDelta: cashYear - todayCash, oneOffs, oneOffTotal: oneOffs.reduce((s, o) => s + o.chf, 0),
      co2MarketT: sim.money.co2MarketT, co2Delta: round(sim.money.co2MarketT - today.money.co2MarketT, 1),
      costPerEffectiveMauh: sim.money.costPerEffectiveMauh,
    },
    availabilityPct: sim.comp.availabilityPct,
    usage: sim.comp.usage,
    effectiveMauh: round(perf.effectiveMauh, 3),
    envelope: sim.envelope,
    trackside: { decisionSec: sim.net.venue.decisionSec, decisionDeltaSec: perf.decisionDeltaSec, linkAvailability: sim.net.linkAvailability, weekendsAtRisk: sim.net.weekendsLost, venue: sim.net.venue.name },
    status: sim.status,
  })

  const seasons = {
    2027: season(2027, sim27, today27, perf27, { shareOld: round(shareOld27, 4), shareNew: round(shareNew27, 4), shareToday: round(shareOld27, 4), shareCarry: 0 }, cash27, todayCash27, oneOffs27, t27),
    2028: season(2028, sim28, today28, perf28, { shareOld: round(shareOld28, 4), shareNew: round(shareNew28, 4), shareToday: round(shareToday28, 4), shareCarry: round(shareCarry28, 4) }, cash28, todayCash28, oneOffs28, t28),
  }

  const deltas = {
    sec: round(perf28.sec - perf27.sec, 3),
    effectiveMauh: round(w28 - w27, 3),
    capCharge: sim28.money.capCharge - sim27.money.capCharge,
    yearly: sim28.money.yearly - sim27.money.yearly,
    co2: round(sim28.money.co2MarketT - sim27.money.co2MarketT, 1),
    detached: SEASON_IDS.filter((id) => isDetached(plan, id)),
    inherited: SEASON_IDS.filter((id) => !isDetached(plan, id)),
    changed: SEASON_IDS.filter((id) => x28[id] !== x27[id]),
    stepUp: estateStepUp,
  }

  const totals = {
    cash: cash27 + cash28,
    todayCash: todayCash27 + todayCash28,
    cashDelta: cash27 + cash28 - todayCash27 - todayCash28,
    // Steady state after the plan: the 2028 estate's 3-year TCO plus the 2027 one-offs it does not already carry,
    // against today's room carried into 2028 (like for like: same estate size, same season)
    tco3: Math.round(sim28.money.tco3 + oneOffs27.filter((o) => !sim28.money.oneOffs.some((p) => p.id === o.id)).reduce((s, o) => s + o.chf, 0)),
    todayTco3: today28.money.tco3,
    sec: round(perf27.sec + perf28.sec, 3),
  }

  const envelopeFits = sim27.envelope.fits && sim28.envelope.fits
  const health = planHealth({ plan, seasons, timeline, changes27, estateStepUp, x27, x28 })
  return { plan, inputs: { 2027: x27, 2028: x28 }, today: { 2027: today27, 2028: today28 }, seasons, deltas, timeline, health, totals, changes27, stepUp: estateStepUp, envelope: { fits: envelopeFits, 2027: sim27.envelope, 2028: sim28.envelope } }
}

/**
 * "Why not a boundary?" — the figures behind where the 2027 cutover lands, read from the plan's timeline plus one
 * re-evaluation of the same plan with its cutover target on the next ATP boundary (presentation only; the model is
 * unchanged). Null when the plan has no 2027 move.
 */
export function cutoverWhatIf(result) {
  const t27 = result && result.timeline && result.timeline.seasons && result.timeline.seasons[2027]
  if (!t27 || !t27.changes || !t27.goLive || !t27.atp) return null
  const tl = result.timeline.inputs
  const contract = Math.max(parseDate(tl.contractDate), PLANNING_DATE)
  const goLive = t27.goLive
  const boundary = nextBoundary(goLive)
  const noLoss = t27.atBoundary || Boolean(t27.shutdown)
  const season = result.seasons[2027]
  const allowance = season.sim.fia.allowance.mauh
  let lapCostSec = 0
  if (!noLoss && boundary > goLive) {
    const alt = evaluatePlan({ ...result.plan, timeline: { ...result.plan.timeline, cutoverDate: isoDate(boundary) } })
    lapCostSec = round(season.perf.sec - alt.seasons[2027].perf.sec, 3)
  }
  const signBy = t27.signBy ? t27.signBy[tl.cutoverDate] : null
  return {
    contract, goLive, feasible: t27.feasible, atp: t27.atp, atBoundary: t27.atBoundary, shutdown: t27.shutdown, noLoss,
    weeksIn: weeksBetween(t27.atp.start, goLive),
    periodLossPct: round(t27.periodLoss * 100, 1), mauhLost: round(t27.periodLoss * allowance, 2),
    boundary, waitWeeks: weeksBetween(goLive, boundary), lapCostSec,
    target: parseDate(tl.cutoverDate), targetLabel: targetLabel(tl.cutoverDate), slipped: t27.slipDays > 0, slackDays: t27.slackDays || 0,
    earlierWeeks: signBy ? weeksBetween(signBy, contract) : 0,
    snapTo: !noLoss && cutoverOptionValues().has(isoDate(boundary)) ? isoDate(boundary) : null,
  }
}

const cutoverOptionValues = () => new Set(buildTimeline({}, { x27: {}, x28: {}, changes27: false, stepUp: false, cpuChange28: false }).cutoverOptions.map((o) => o.value))
const targetLabel = (iso) => { const o = buildTimeline({}, { x27: {}, x28: {}, changes27: false, stepUp: false, cpuChange28: false }).cutoverOptions.find((c) => c.value === iso); return o ? o.label.replace(/ · .*$/, "") : fmtDate(parseDate(iso)) }
const weeksWord = (w) => (w >= 1.5 ? `${Math.round(w)} weeks` : w >= 0.75 ? "a week" : `${Math.max(1, Math.round(w * 7))} day${Math.round(w * 7) === 1 ? "" : "s"}`)
const moreWord = (w) => (w >= 1.5 ? `${Math.round(w)} more weeks` : w >= 0.75 ? "a week more" : `${Math.max(1, Math.round(w * 7))} more day${Math.round(w * 7) === 1 ? "" : "s"}`)
const lapWord = (s) => (Math.abs(s) < 0.005 ? "under 0.01 s/lap" : `about ${Math.abs(s).toFixed(2)} s/lap`)

/** One plain sentence with live figures: why the cutover lands where it does and what a boundary would cost or save. */
export function whyNotBoundaryLine(result) {
  const w = cutoverWhatIf(result)
  if (!w) return ""
  const signed = `Signed on ${fmtDate(w.contract)}`
  if (w.noLoss) {
    const where = w.shutdown ? `inside the ${w.shutdown.label.toLowerCase()}` : `at the ${w.atp.label} boundary`
    const slack = w.slackDays > 0 ? ` with ${weeksWord(w.slackDays / 7)} of slack` : ""
    return `${signed}, the lead times allow ${fmtDate(w.feasible)}; the cutover lands ${where} on ${fmtDate(w.goLive)}${slack}, so no allowance is lost.`
  }
  const into = `${weeksWord(w.weeksIn)} into ${w.atp.label}`
  const earlier = w.slipped && w.earlierWeeks >= 0.75 ? `; signing ${weeksWord(w.earlierWeeks)} earlier would reach the ${fmtDate(w.target, { year: false })} boundary` : ""
  const lands = w.slipped ? `the lead times put the first possible day at ${fmtDate(w.goLive)}, ${into}` : `the cutover target of ${fmtDate(w.goLive)} sits ${into}`
  return `${signed}, ${lands}. Going live then costs about ${w.periodLossPct} % of that period's allowance (${w.mauhLost} MAUh); waiting for the ${fmtDate(w.boundary, { year: false })} boundary costs nothing but runs ${moreWord(w.waitWeeks)} on today's room (${lapWord(w.lapCostSec)} over the season)${earlier}.`
}

/** The envelope health line for one season: tone by share of the 500 kW offer (green ≤ 90 %, amber ≤ 100 %, red over). */
/**
 * An `evaluate()`-shaped function for one season of an evaluated plan, for the attribution: the season's go-live
 * blend (shares of the season on today's setup, on the carried 2027 estate and on the season's own estate, and the
 * allowance lost at the switch) is held at the plan's values while the inputs vary, so the bars add up to the
 * plan-level headline exactly. For 2028 the months on the carried 2027 estate are a fixed baseline step.
 */
export function seasonAttributionFn(result, year) {
  const s = result.seasons[year]
  const today = s.today
  const b = s.blend
  const shareNew = b.shareNew
  const loss = shareNew > 0 ? clamp(b.lossShare / shareNew, 0, 1) : 0
  const wToday = today.comp.effectiveMauh
  const stepUp = year === 2028 && result.deltas.stepUp
  const carryW = year === 2028 && b.shareCarry > 0 ? simulate({ ...result.inputs[2027], season: 2028 }).comp.effectiveMauh : 0
  return (inputs) => {
    const x = { ...inputs, season: year }
    let scenario
    let w
    if (year === 2027) {
      // as in evaluatePlan: no estate change, no cutover (the whole season on the modified setup, nothing lost at a switch)
      const changes = ESTATE_IDS.some((id) => x[id] !== today.inputs[id])
      scenario = simulate({ ...x, scheduleLoss: changes ? loss : 0 })
      w = (changes ? b.shareOld : 0) * wToday + (changes ? shareNew : 1) * scenario.comp.effectiveMauh
    } else if (stepUp) {
      scenario = simulate({ ...x, scheduleLoss: loss })
      w = b.shareToday * wToday + b.shareCarry * carryW + shareNew * scenario.comp.effectiveMauh
    } else {
      scenario = simulate(x)
      w = b.shareToday * wToday + (b.shareCarry + shareNew) * scenario.comp.effectiveMauh * (1 - loss)
    }
    return { scenario, today, perf: perfBlock(scenario, today, { wScenario: w, wToday }) }
  }
}

export function envelopeLine(env, season) {
  if (!env) return null
  const kw = Math.round(env.drIT)
  if (env.drIT === 0) return { tone: "ok", text: `Nothing at Digital Realty (${season}): the cluster stays in the Hinwil room`, kw, offerKW: env.offerKW }
  if (!env.fits) return { tone: "bad", text: `Not possible (${season}): ${env.reasons[0]}`, kw, offerKW: env.offerKW }
  return { tone: env.tone === "warn" ? "warn" : "ok", text: `Fits the ${env.offerKW} kW envelope: ${kw} / ${env.offerKW} kW (${season})`, kw, offerKW: env.offerKW }
}

// ---------------------------------------------------------------------------------------------
// Health: one-line reasons the Overview can act on
// ---------------------------------------------------------------------------------------------

const LEVEL_RANK = { bad: 0, warn: 1, info: 2, ok: 3 }

export function planHealth({ plan, seasons, timeline, changes27, estateStepUp, x27, x28 }) {
  const items = []
  const add = (id, level, season, title, detail, route, rule = "") => items.push({ id, level, season, title, detail, route, rule })

  const ENVELOPE_FLAGS = new Set(["power", "racks", "cooling", "clock", "gpu"])
  for (const year of SEASONS) {
    const s = seasons[year]
    for (const f of s.sim.flags) {
      if (f.level === "ok" || f.level === "info") continue
      if (f.id === "declare" || f.id === "delivery") continue // the timeline owns these
      if (f.level === "bad" && !s.sim.envelope.fits && ENVELOPE_FLAGS.has(f.id)) continue // the envelope item below lists the reasons
      add(`${year}-${f.id}`, f.level, year, f.title, f.detail, ROUTE_OF_FLAG[f.id] || "compute", f.rule)
    }
  }
  for (const f of timeline.flags) {
    if (f.level === "ok" || f.level === "info") continue
    add(`tl-${f.id}`, f.level, f.season, f.title, f.detail, "deployment", f.rule)
  }
  // Plan-level consistency
  if (x27.solverGpus > 0) add("gpu27", "bad", 2027, "Solver GPUs planned for 2027", "GPU cores may run the Restricted CFD solver from 1 January 2028 only; keep them for pre/post-processing in 2027 or detach the 2028 estate.", "compute", "F4.4.1")
  for (const year of SEASONS) {
    const env = seasons[year].sim.envelope
    if (!env.fits) add(`envelope-${year}`, "bad", year, `Not possible: the ${year} estate does not fit the ${env.offerKW} kW envelope`, `${env.reasons.join("; ")}. Use "Fit to the envelope" or trim the ML partition, GPUs, nodes or rack density.`, "facility")
    if (env.notes.length) add(`expansion-${year}`, "info", year, "Expansion right ignored (commercial note)", "The 500 kW offer has no expansion right; ZUR4 adds 15 MW on the campus in 2028 and is a separate conversation.", "facility")
  }
  if (x27.location !== "hinwil" && x27.fibrePairs === 1) add("fibre", "warn", 2027, "One dark-fibre route Hinwil ↔ campus", "A single route puts the whole solver estate behind one cable; two diverse routes take the link to 99.995 %.", "connectivity")
  if (x27.location !== "hinwil" && x27.redundancy === "n") add("redundancy", "warn", 2027, "N power and cooling at the campus", "An outage inside a period is allowance lost; Digital Realty Zurich offers 2N UPS and N+2 cooling.", "facility")
  if (!changes27 && !estateStepUp) add("status-quo", "info", null, "Nothing changes against today's setup", "Both seasons run on the existing room; the plan is the baseline every other plan is measured against.", "overview")
  if (changes27 && seasons[2027].blend.shareOld >= 0.5) add("late-move", "warn", 2027, `${Math.round(seasons[2027].blend.shareOld * 100)} % of 2027 on today's setup`, "The move lands in the second half of the season; sign earlier or move at an earlier boundary.", "deployment")
  if (estateStepUp && x28.solverGpus === 0 && x28.gpus > 0) add("gpu-idle", "info", 2028, `${x28.gpus} GPUs outside the solver in 2028`, "From 2028 GPUs may run the Restricted CFD solver; consider a solver partition.", "compute", "F4.4.1")

  items.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (a.season || 0) - (b.season || 0))
  const status = items.some((i) => i.level === "bad") ? "bad" : items.some((i) => i.level === "warn") ? "warn" : "ok"
  const counts = { bad: items.filter((i) => i.level === "bad").length, warn: items.filter((i) => i.level === "warn").length, info: items.filter((i) => i.level === "info").length }
  const bySeason = { 2027: items.filter((i) => i.season === 2027), 2028: items.filter((i) => i.season === 2028), plan: items.filter((i) => !i.season) }
  const headline = status === "bad" ? `${counts.bad} blocking issue${counts.bad === 1 ? "" : "s"}` : status === "warn" ? `${counts.warn} thing${counts.warn === 1 ? "" : "s"} to tune` : "Plan is consistent with the regulations and the offer"
  return { status, counts, items, bySeason, headline }
}

// ---------------------------------------------------------------------------------------------
// Labels used by several views
// ---------------------------------------------------------------------------------------------

export function controlDisplay(id, value) {
  const c = CONTROLS[id]
  if (!c) return String(value)
  if (c.format) return c.format(value)
  if (c.type === "toggle") return value ? "On" : "Off"
  if (c.options) {
    const o = c.options.find((o) => o.value === value)
    if (o) return o.label
  }
  return c.unit ? `${value} ${c.unit}` : String(value)
}

export const describeTimeline = (tl) => `Contract ${fmtDate(parseDate(tl.contractDate))} · cutover ${fmtDate(parseDate(tl.cutoverDate))} · ${tl.parallelWeeks} wk parallel · step-up ${fmtDate(parseDate(tl.stepUpDate))}`

export { K }
