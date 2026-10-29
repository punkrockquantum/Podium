/**
 * The evaluation model: from a team's 12 choices to money, power, FIA risk and race performance.
 * Pure and deterministic; the server, every screen, the race and the tests share it.
 */
import * as C from "./catalog.js"

/** The team's choices with every missing or invalid value replaced by the table default. */
export function choicesOf(team) {
  const out = {}
  for (const d of C.DECISIONS) {
    const value = team?.choices?.[d.id]
    out[d.id] = C.validChoice(d.id, value) ? value : d.def
  }
  return out
}

export const pickedOption = (decisionId, choices) => {
  const d = C.decision(decisionId)
  return d.options.find((o) => o.id === choices?.[decisionId]) || d.options.find((o) => o.id === d.def)
}

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value))

/** Strategy calls slow down as latency grows. */
export function latencyFactor(ms) {
  if (ms <= 60) return 1
  if (ms <= 80) return 0.97
  if (ms <= 120) return 0.9
  return 0.82
}

/** Expected FIA penalty points and the Low / Med / High label shown on the ledger. */
export function fiaRisk(penalties) {
  const expected = penalties.reduce((sum, p) => sum + p.p * p.points, 0)
  return { expected, label: expected < 2 ? "Low" : expected < 6 ? "Med" : "High" }
}

export function evaluate(team) {
  const ch = choicesOf(team)
  const o = (id) => pickedOption(id, ch)
  const tier = C.tierFor(team)
  const [link, path, garage, vendor, pay, support, loc, cool, plan, size, chips, storage] =
    ["link", "path", "garage", "vendor", "payment", "support", "location", "cooling", "power", "size", "chips", "storage"].map(o)

  /* Hardware and how it is paid for. As-a-service is only offered by Dell, HPE or Lenovo. */
  const hardware = (size.price * chips.priceMult + storage.price) * vendor.priceMult
  const payment = pay.id === "aas" && !vendor.aas ? "lease" : pay.id
  const payRate = C.byId(C.decision("payment").options, payment).opexRate
  const hwCapex = payment === "buy" ? hardware : 0
  const hwOpex = hardware * payRate
  const supportOpex = hardware * (payment === "aas" ? support.aasRate : support.rate)

  /* Power and heat. */
  const itKW = (size.kw * chips.kwMult + storage.kw) * plan.kwMult
  const pue = Math.round((cool.pue + loc.pueAdd) * 100) / 100
  const facilityKW = itKW * pue
  const heat = chips.heat + plan.heat
  const thermal = heat <= cool.heatLimit ? 1 : cool.heatLimit / heat
  const roomFit = facilityKW <= loc.maxKW ? 1 : loc.maxKW / facilityKW
  const throttle = thermal * roomFit
  const powerOpex = facilityKW * loc.kwYear

  /* Network and site. */
  const netCapex = link.capex + path.capex + garage.capex
  const netOpex = link.opex + path.opex + garage.opex
  const dcCapex = cool.capex + loc.capex

  const capex = hwCapex + netCapex + dcCapex
  const opex = C.FIXED_OPEX + hwOpex + supportOpex + powerOpex + netOpex
  const capexOver = Math.max(0, capex - tier.capex)
  const opexOver = Math.max(0, opex - C.OPEX_ALLOWANCE)
  const opexState = opexOver <= 0 ? "ok" : opexOver <= C.OPEX_TOLERANCE ? "over" : opexOver <= C.OPEX_MAJOR ? "minor" : "major"

  /* FIA penalties: each has a chance of being caught, points, and sometimes a time penalty. */
  const penalties = []
  const pen = (id, station, p, points, text, seconds = 0) => penalties.push({ id, station, p, points, seconds, text })
  if (link.id === "single") pen("tunnel", "network", 0.6, 5, "Only one encrypted tunnel to the factory (FIA 5.3 asks for two on separate paths).")
  if (garage.illegal) pen("wifi", "network", 0.8, 6, "Car data dumped over Wi-Fi instead of the wired umbilical (FIA 5.2).", 5)
  if (loc.id === "factory") pen("nplus1", "dc", 0.5, 6, "The factory server room has no N+1 power or cooling (FIA 4.1).")
  if (size.id === "large") pen("overrun", "compute", 0.5, 8, "The cluster ran CFD beyond the aero testing allowance (FIA 2.4).")
  if (capexOver > 0) pen("capex", "oem", 1, 10, `CapEx is ${fmtM(capexOver)} over the ${tier.name} headroom.`)
  if (opexState === "minor") pen("opexMinor", "oem", 1, 10, `Yearly OpEx is ${fmtM(opexOver)} over the allowance: a minor cost-cap breach.`)
  if (opexState === "major") pen("opexMajor", "oem", 1, 25, `Yearly OpEx is ${fmtM(opexOver)} over the allowance: a major cost-cap breach.`)
  const risk = fiaRisk(penalties)

  /* Performance: aero from CFD inside the allowance, strategy from AI, data and latency. */
  const latencyMs = path.ms + loc.ms
  const utilisation = Math.min(size.capacity, 1)
  const capCut = opexState === "over" ? 0.95 : 1
  const cfdEfficiency = utilisation * chips.cfd * storage.io * throttle * plan.perf
  const aeroIndex = tier.compute * cfdEfficiency * capCut
  const strategy = clamp(chips.strategy * size.strategy * storage.strategy * latencyFactor(latencyMs) * throttle * vendor.strategy, 0, 1.1)

  return {
    choices: ch,
    tier,
    payment,
    hardware,
    ledger: { capex, capexLimit: tier.capex, capexOver, opex, opexLimit: C.OPEX_ALLOWANCE, opexOver, opexState, facilityKW, fia: risk.label, fiaExpected: risk.expected },
    tables: {
      network: { capex: netCapex, opex: netOpex },
      oem: { capex: hwCapex, opex: hwOpex + supportOpex },
      dc: { capex: dcCapex, opex: powerOpex },
      compute: { capex: hwCapex, opex: hwOpex, price: hardware },
    },
    power: { itKW, pue, facilityKW, heat, thermal, roomFit, throttle, maxKW: loc.maxKW },
    network: { latencyMs, redundant: link.id !== "single", satellite: link.id === "satellite" },
    aero: { index: aeroIndex, efficiency: cfdEfficiency, utilisation, gain: aeroGainFor(aeroIndex) },
    strategy,
    penalties,
  }
}

/** Seconds a lap from aero. */
export const aeroGainFor = (index) => 0.5 * Math.max(0, index)

function fmtM(value) {
  return `$${(value / 1e6).toFixed(1)}M`
}

/** A table counts only once its Architect approved the pitched design. */
export function completedStations(team, stationIds = C.STATIONS.map((s) => s.id)) {
  return stationIds.filter((id) => team?.reviews?.[id]?.status === "approved")
}

/**
 * The team as the race sees it: choices only from approved tables; every other table keeps its
 * (deliberately weak) defaults. `missed` tables were never locked in; `notApproved` ones were.
 */
export function effectiveTeam(team, stationIds = C.STATIONS.map((s) => s.id)) {
  const done = new Set(completedStations(team, stationIds))
  const choices = {}
  for (const [key, value] of Object.entries(team?.choices || {})) {
    const d = C.decision(key)
    if (d && done.has(d.station)) choices[key] = value
  }
  const pending = stationIds.filter((id) => !done.has(id))
  const tried = (id) => Boolean(team?.plans?.[id] || team?.submitted?.[id] || team?.reviews?.[id])
  return { ...team, choices, approved: [...done], missed: pending.filter((id) => !tried(id)), notApproved: pending.filter(tried) }
}
