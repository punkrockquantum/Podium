/**
 * The table simulation: one score (0–100), one sentence and one hint per table, from the same
 * evaluation the race uses. Pure; shared by the server, the tables, the Architect and the tests.
 */
import * as C from "./catalog.js"
import { evaluate, pickedOption } from "./model.js"

export const WEIGHTS = { performance: 0.35, cost: 0.2, compliance: 0.25, resilience: 0.2 }
export const PART_NAMES = { performance: "Performance", cost: "Cost", compliance: "FIA compliance", resilience: "Resilience" }
export const BANDS = [
  { min: 80, name: "Optimised" },
  { min: 60, name: "Competitive" },
  { min: 0, name: "Needs work" },
]
export const bandFor = (score) => BANDS.find((b) => score >= b.min).name

/** A balanced build that is Optimised at every table for every tier. */
export const REFERENCE_BUILD = {
  link: "redundant", path: "crossconnect", garage: "edge",
  vendor: "tier1", payment: "aas", support: "nbd",
  location: "colo", cooling: "liquid", power: "cap85",
  size: "medium", chips: "mixed", storage: "parallel",
}

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value))
/** 1 at or under budget, falling to 0 at budget + span. */
const spendScore = (spend, budget, span) => clamp(1 - Math.max(0, spend - budget) / span)

/** Expected FIA penalty points owned by one table (or every table). */
export function expectedPenalty(ev, stationId = null) {
  return ev.penalties.filter((p) => !stationId || p.station === stationId).reduce((sum, p) => sum + p.p * p.points, 0)
}

/** The four parts (0–1) of one table's score. */
export function stationParts(ev, stationId) {
  const ch = ev.choices
  const o = (id) => pickedOption(id, ch)
  const compliance = clamp(1 - expectedPenalty(ev, stationId) / 12)
  if (stationId === "network") {
    const t = ev.tables.network
    return {
      performance: 0.7 * o("path").perf + 0.3 * o("garage").perf,
      cost: spendScore(t.capex / 3 + t.opex, 600_000, 800_000),
      compliance,
      resilience: 0.7 * o("link").res + 0.3 * o("garage").res,
    }
  }
  if (stationId === "oem") {
    const L = ev.ledger
    const use = L.capex / L.capexLimit
    const capexScore = use <= 0.9 ? 1 : use <= 1 ? 0.85 : 0.2
    const opexScore = { ok: 1, over: 0.6, minor: 0.25, major: 0 }[L.opexState]
    const vendor = o("vendor")
    return {
      performance: vendor.perf,
      cost: 0.6 * Math.min(capexScore, opexScore) + 0.4 * vendor.value,
      compliance,
      resilience: o("support").res * vendor.support,
    }
  }
  if (stationId === "dc") {
    const t = ev.tables.dc
    const pueScore = clamp((1.6 - ev.power.pue) / 0.45)
    return {
      performance: 0.45 * ev.power.throttle * o("power").dcPerf + 0.3 * pueScore + 0.25 * o("location").perf,
      cost: spendScore(t.capex / 3 + t.opex, 700_000, 800_000),
      compliance,
      resilience: 0.5 * o("location").res + 0.25 * o("cooling").res + 0.25 * o("power").res,
    }
  }
  if (stationId === "compute") {
    return {
      performance: 0.6 * clamp(ev.aero.efficiency / 1.1) + 0.4 * clamp(ev.strategy),
      cost: spendScore(ev.hardware, 5_000_000, 4_000_000),
      compliance,
      resilience: 0.5 * o("size").res + 0.5 * o("storage").res,
    }
  }
  throw new Error(`Unknown table ${stationId}`)
}

/** Hints that point at the problem without naming the answer, most important first. */
function hintsFor(ev, stationId, parts) {
  const ch = ev.choices
  const out = []
  const add = (when, text) => when && out.push(text)
  if (stationId === "network") {
    add(ch.garage === "wifi", "The way car data leaves the garage breaks an FIA rule.")
    add(ch.link === "single", "One cut fibre would blind the pit wall, and FIA 5.3 asks for more.")
    add(ch.path === "public", "Jitter on this path could delay a pit call by a lap.")
    add(parts.cost < 0.75, "This table spends a lot for the latency it buys.")
  } else if (stationId === "oem") {
    add(ev.ledger.capexOver > 0, "CapEx is over your tier's headroom: look at how you pay.")
    add(["minor", "major"].includes(ev.ledger.opexState), "Yearly OpEx breaks the cost cap: something costs too much every year.")
    add(ch.payment === "aas" && ev.payment !== "aas", "This vendor has no as-a-service programme, so you are on a lease.")
    add(ch.support === "basic", "A failed node on race weekend would wait for parts by post.")
    add(ch.vendor === "dgx", "Premium systems are slow to arrive and dear: is it worth it?")
  } else if (stationId === "dc") {
    add(ev.power.thermal < 1, "The cooling cannot keep these chips cool at this power.")
    add(ev.power.roomFit < 1, "The site cannot supply the power this cluster draws.")
    add(ch.location === "factory", "The factory room has no N+1 power or cooling (FIA 4.1).")
    add(ch.location === "cheap", "The site is far away: every strategy call travels further.")
    add(ch.power === "boost", "Max boost leaves no heat headroom on a hot day.")
    add(ev.power.pue > 1.35, "A lot of the power bill is cooling, not computing.")
  } else if (stationId === "compute") {
    add(ch.size === "large", "Nodes above the FIA compute allowance sit idle or tempt an overrun.")
    add(ch.size === "small", "The cluster leaves much of your compute allowance unused.")
    add(ch.storage === "basic", "The nodes spend time waiting for data.")
    add(ch.chips === "cpu", "CFD is strong, but the race-day strategy model is weak.")
    add(parts.cost < 0.5, "The hardware bill is high for what the cap lets you use.")
  }
  return out
}

const STRONG = { performance: "fast", cost: "good value", compliance: "FIA-clean", resilience: "robust" }
const WEAK = { performance: "performance", cost: "cost", compliance: "FIA compliance", resilience: "resilience" }

/** One table's simulation: score, band, parts, one sentence and one hint. */
export function simulateStation(team, stationId, ev = evaluate(team)) {
  const parts = stationParts(ev, stationId)
  const score = Math.round(100 * Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * parts[k], 0))
  const band = bandFor(score)
  const ranked = Object.keys(WEIGHTS).sort((a, b) => parts[b] - parts[a])
  const name = C.byId(C.STATIONS, stationId).name
  const sentence = band === "Optimised"
    ? `${name} is ${band.toLowerCase()} at ${score}%: ${STRONG[ranked[0]]} and ${STRONG[ranked[1]]}.`
    : `${name} is ${band.toLowerCase()} at ${score}%: weakest on ${WEAK[ranked[3]]}.`
  const hints = hintsFor(ev, stationId, parts)
  return { station: stationId, score, band, parts, sentence, hint: hints[0] || "No obvious weak spot. Can you defend every choice in your pitch?", hints }
}

/** Every table's simulation and the mean. */
export function simulateTeam(team, stationIds = C.STATIONS.map((s) => s.id), ev = evaluate(team)) {
  const stations = Object.fromEntries(stationIds.map((id) => [id, simulateStation(team, id, ev)]))
  const score = stationIds.length ? Math.round(stationIds.reduce((sum, id) => sum + stations[id].score, 0) / stationIds.length) : 0
  return { score, band: bandFor(score), stations }
}
