/**
 * "Run simulation": an optimisation indication for one table, or the whole team, built only from
 * evaluate() (the same physics, ledger, risks and penalties the race samples). Each table is scored
 * on constraint satisfaction and efficiency, never by matching one golden build, so several
 * different designs can reach the optimised band.
 */
import * as C from "./catalog.js"
import { evaluate, aeroGainFor } from "./model.js"

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))

export const BANDS = [
  { id: "optimised", min: 80, name: "Optimised" },
  { id: "competitive", min: 60, name: "Competitive" },
  { id: "work", min: 0, name: "Needs work" },
]
export const WEIGHTS = { performance: 0.35, cost: 0.2, compliance: 0.25, resilience: 0.2 }
export const SUGGESTED_RUNS = 3

/** Which table owns each FIA penalty. */
export const PENALTY_STATION = {
  f6: "governance", segaudit: "governance", bidir: "governance", manualflow: "governance", workforce: "governance",
  logs: "governance", curfew: "governance", cap: "governance", capex: "governance",
  pfs: "storage", archive: "storage",
  fpga: "network", "5g": "network", umbilical: "network", tunnels: "network", trackside: "network",
}

/** Share of the year's infrastructure money (CapEx left + OpEx allowance) a table can reasonably use. */
const BUDGET_SHARE = { compute: 0.22, ai: 0.32, dc: 0.22, storage: 0.14, network: 0.1, governance: 0.18 }

export function bandFor(score) {
  return BANDS.find((band) => score >= band.min).name
}

/**
 * One optimised build for every table (used by the debrief to price a missed table). It is only
 * one of several routes to the optimised band; the tests prove others.
 */
export const REFERENCE_BUILD = {
  oem: "supermicro", payment: "buy", term: 36, cpu: "xeonmax9480", nodes: 8, clock: "lock85",
  platform: "b300", deploy: "own", racks: 1, tgp: "eco85", modelSize: "70b", precision: "fp8",
  location: "lon", hall: "R", block: 0.25, terms: "top5", redundancy: "n1",
  pfs: "lustre", pfsPB: 2, archive: "tape", dataTier: "vector", kv: "on", hbm: "hbm288",
  wan: "fabric", wanBackup: "leo", hqLink: "fiber", fabric: "ib", trackside: "fia", edge: 2,
  segregation: "zerotrust", dataflow: "diode", workforce: "lockout", audit: "full",
}

/** Expected penalty points for a table: probability × points, with grid places and seconds as points. */
export function expectedPenalty(ev, stationId) {
  let points = 0
  let dsq = false
  for (const pen of ev.penalties) {
    if (stationId && PENALTY_STATION[pen.id] !== stationId) continue
    if (pen.dsq) dsq = true
    points += pen.p * ((pen.points || 0) + (pen.grid || 0) * 1.5 + (pen.seconds || 0) * 0.8)
  }
  return { points, dsq }
}

function stationSpend(ev, stationId) {
  const items = [...ev.ledger.capexItems, ...ev.ledger.opexItems].filter((item) => item.station === stationId && !/licences \(fixed\)/.test(item.label))
  return items.reduce((total, item) => total + item.amount, 0)
}

function budgetFit(ev) {
  const L = ev.ledger
  let fit = { ok: 1, over: 0.85, minor: 0.55, major: 0.3 }[L.capState]
  if (L.capexOver > 0) fit *= 0.55
  return fit
}

function costScore(ev, stationId, extra = 1) {
  const budget = ev.ledger.capexRemaining + ev.ledger.opexAllowance
  const spend = stationSpend(ev, stationId)
  const fair = BUDGET_SHARE[stationId] * budget
  const value = spend <= fair ? 1 : (fair / spend) ** 0.8
  return clamp(value * budgetFit(ev) * extra, 0, 1)
}

function complianceScore(ev, stationId, extra = 1) {
  const pen = expectedPenalty(ev, stationId)
  if (pen.dsq) return 0
  return clamp((1 - pen.points / 12) * extra, 0, 1)
}

/* ------------------------------------------------------------------ per-table metrics */

function metrics(ev, stationId) {
  const ch = ev.choices
  const hints = []
  const hint = (when, weight, text) => when && hints.push({ weight, text })
  let performance = 1
  let resilience = 1
  let cost = costScore(ev, stationId)
  let compliance = complianceScore(ev, stationId)

  if (stationId === "compute") {
    const p7 = C.atrForRank(7).mult
    const indexNorm = ev.aero.index * (p7 / ev.atr.mult)
    performance = clamp(aeroGainFor(indexNorm) / aeroGainFor(1.6), 0, 1)
    const turnaround = ev.cfd.turnaround * (ev.cfd.usedCoreHours < ev.cfd.allowedCoreHours * 0.98 ? 0.8 : 1)
    resilience = clamp(1 - Math.max(0, ev.lead.cfd - 6) / 30, 0.5, 1) * turnaround
    if (ev.cfd.solver === "gpu") compliance *= 0.85
    const com = ev.commercial
    const headroom = ev.ledger.capexRemaining - ev.ledger.capex
    const rentingWithHeadroom = com.opexHardware > 0 && com.capexHardware === 0 && headroom > com.hardware * 1.5 && ev.ledger.capState !== "ok"
    const capexTight = com.capexHardware > 0 && (ev.ledger.capexOver > 0 || headroom < 0.05 * ev.ledger.capexRemaining)
    cost = costScore(ev, stationId, (ev.cfd.weeksToBurn < 0.4 ? 0.8 : 1) * (rentingWithHeadroom ? 0.8 : 1))
    hint(capexTight, 3, "The CapEx envelope is (nearly) full: paying for hardware as OpEx would free it, at a price.")
    hint(rentingWithHeadroom, 2, "You are paying a service premium on the cost cap while CapEx headroom sits unused.")
    hint(ch.payment === "finance", 1, "Check how the FIA (and your auditors) book a lease you end up owning.")
    hint(ev.cfd.rates.efficiency < 0.05, 3, "Most of each billed MAUh is not doing CFD. Look at what the FIA bills per core-hour and how memory-bound the solver is.")
    hint(ch.clock === "turbo", 3, "Check FIA 2.1: how is an unlocked clock billed?")
    hint(ch.geometry === "free", 2, "Your geometry allowance (RATGs) runs out before the MAUh do.")
    hint(ev.cfd.usedCoreHours < ev.cfd.allowedCoreHours * 0.98, 2, "The cluster cannot spend the ATP allocation in time: turnaround, not the cap, is the limit.")
    hint(ev.cfd.weeksToBurn < 0.4, 1, "The cluster finishes the allocation in days and then idles: right-size it.")
    hint(ch.solver === "surrogate" && ev.cfd.surrogateBoost < 1.1, 2, "The surrogate barely helps: what precision, model size and GPUs does it run on?")
    hint(ev.cfd.solver === "gpu", 1, "GPU-native CFD is a loophole until the ATP 4 Technical Directive: price the risk in your pitch.")
  } else if (stationId === "ai") {
    const cov = ev.ai.coverage
    const live = Math.sqrt(ev.lead.aiLive || 0)
    const latency = clamp(1 - (ev.ai.inferS - 0.06) / 0.3, 0.4, 1)
    performance = ev.ai.gpus === 0 ? 0 : clamp(Math.min(1, cov) * Math.min(1, ev.ai.accuracy / 0.97) * latency * live * ev.cooling.thermal, 0, 1)
    const thermalRisk = ev.risks.filter((r) => r.id === "thermal").reduce((a, r) => a + r.p, 0)
    const slip = ev.risks.filter((r) => r.id === "asicSlip").reduce((a, r) => a + r.p, 0)
    resilience = clamp((ev.lead.aiLive || 0) * (1 - thermalRisk) * (1 - 0.8 * slip), 0, 1)
    cost = costScore(ev, stationId, cov > 1.8 ? clamp(1.8 / cov, 0.6, 1) : 1)
    hint(ev.ai.gpus === 0, 3, "No accelerators: strategy runs on laptops.")
    hint(ev.ai.memory.state === "offload", 3, "Weights plus KV cache do not fit: think bytes per parameter, HBM per accelerator, and where the KV cache can live.")
    hint(ev.ai.memory.state === "spill", 1, "The KV cache is spilling out of HBM: it works, but every answer is slower.")
    hint(ev.ai.precSpeed < 0.5, 2, "Inference is running in a slow number format. The FIA bill is the same in any format.")
    hint(cov < 0.9 && ev.ai.gpus > 0, 2, "The strategy engine cannot keep up with race-weekend demand.")
    hint(cov > 1.8, 2, "Lots of idle silicon: it still costs money, power and cap space.")
    hint(ev.ai.inferS > 0.12, 2, "Each strategy answer takes too long: model size, precision and memory all add latency.")
    hint(ev.cooling.thermal < 1, 3, "These racks are throttling: what can the hall cool, and what power mode are they in?")
    hint((ev.lead.aiLive || 0) < 0.85, 2, "The AI platform goes live after the season has started.")
    hint(ev.ai.accuracy < 0.85, 1, "Fast, but the calls are less sharp: is the model big enough for race reasoning?")
  } else if (stationId === "dc") {
    const h = ev.power.headroom
    const ladder = C.byId(C.LOCATIONS, ch.location).blocksMW
    const metered = C.byId(C.COLO_TERMS, ch.terms)?.metered
    const stranded = !metered && h > 0.35 && ladder.some((mw) => mw < ev.power.blockMW && 1 - ev.power.facilityKW / (mw * 1000) >= C.POWER_HEADROOM.tripBelow)
    const power = h < 0 ? 0.4 : h < 0.1 ? 0.75 : stranded ? 0.75 : 1
    const pue = clamp(1 - (ev.power.pue - 1.2) / 0.45, 0.5, 1)
    const lead = ev.lead.hall > C.SEASON.firstRaceWeek ? 0.85 : 1
    performance = clamp(ev.cooling.thermal * (ev.space.over ? 0.85 : 1) * power * pue * lead, 0, 1)
    const trip = ev.risks.filter((r) => ["power", "immersion"].includes(r.id)).reduce((a, r) => a + r.p, 0)
    resilience = clamp(1 - 1.5 * trip, 0, 1) * (h < 0.1 ? 0.8 : 1)
    cost = costScore(ev, stationId, stranded ? 0.8 : 1)
    hint(ev.cooling.thermal < 1, 3, "Some racks are hotter than this hall can cool.")
    hint(h < 0, 3, "The facility draws more than the power contract.")
    hint(h >= 0 && h < 0.1, 2, "Under 10% power headroom: a hot day trips the contract.")
    hint(stranded, 2, "You are paying for power you never use: a smaller block would still leave headroom.")
    hint(ev.power.pue > 1.3, 1, "Every kW of IT costs extra kW of cooling here: look at the PUE.")
    hint(ev.space.over, 2, "More racks than rack positions.")
    hint(ev.lead.hall > C.SEASON.firstRaceWeek, 1, "The hall is ready after the first race.")
    hint(ch.redundancy === "n", 2, "One power path: what happens to the racks when a UPS fails on a race weekend?")
  } else if (stationId === "storage") {
    const pfs = C.byId(C.PFS, ch.pfs)
    const capacity = ch.pfsPB < C.PFS_NEED_PB ? 0.85 : ch.pfsPB > C.PFS_NEED_PB ? 0.95 : 1
    const grounding = C.byId(C.DATA_TIERS, ch.dataTier).grounding
    const aiMemory = ch.kv === "on" || ch.hosts === "grace" ? 1 : 0.9
    const pfsOffered = C.decision("pfs").options.find((o) => o.id === ch.pfs) || pfs
    performance = clamp(0.5 * pfsOffered.io * capacity + 0.5 * grounding * aiMemory / 0.93 * 0.93, 0, 1)
    const archive = C.byId(C.ARCHIVES, ch.archive)
    resilience = clamp((archive.compliant ? 1 : 0.6) * (ch.pfsPB >= C.PFS_NEED_PB ? 1 : 0.85), 0, 1)
    hint(!pfs.tamper, 3, "Read FIA 2.3 on what the CFD file system must record.")
    hint(!archive.compliant, 3, "The FIA can audit run folders long after the ATP.")
    hint(ch.pfsPB < C.PFS_NEED_PB, 2, "Scratch is too small for a season of run folders.")
    hint(ch.pfsPB > C.PFS_NEED_PB, 1, "More capacity than the programme needs.")
    hint(grounding < 0.9, 2, "The strategy assistant cannot search past races.")
    hint(aiMemory < 1, 1, "Repeat what-if questions redo all their work: where could the attention state live?")
  } else if (stationId === "network") {
    const net = ev.network
    const lossy = C.ROUTE[net.wanRoute]?.loss || 0
    const latency = clamp(1 - (net.loopS - 0.04) / 0.25, 0.3, 1) * (1 - 5 * lossy)
    performance = clamp(latency * (0.75 + 0.25 * net.bwScore) * Math.min(1, net.edgeScore) ** 0.5, 0, 1)
    const cpo = ev.risks.filter((r) => r.id === "cpo").reduce((a, r) => a + r.p, 0)
    resilience = clamp(Math.min(1, net.redundancy) * (1 - 2 * net.blackoutP) * (1 - 2 * cpo), 0, 1)
    hint(net.loopS > 0.12, 3, "The track → data centre → factory loop is slow: route inflation and hops matter more than distance alone.")
    hint(ch.wanBackup === "none", 3, "One WAN path: what does FIA 5.3 ask for?")
    hint(ch.tunnels !== "redundant", 3, "Check FIA 5.3 on how the circuit ↔ factory traffic must be carried.")
    hint(net.bwScore < 1, 2, "The primary link is too thin for live race traffic.")
    hint(ch.garage === "wifidump" || ch.cellular === "ontrack" || ch.telemetry === "fpga" || ch.venue === "trackside", 3, "Something here breaks Section 5: read 5.1–5.3 again.")
    hint(net.edgeScore < 1, 1, "Trackside ingest is a bottleneck.")
    hint(ch.fabric === "eth100", 1, "The cluster fabric limits how CFD and AI scale.")
  } else if (stationId === "governance") {
    const workforce = C.byId(C.WORKFORCE, ch.workforce)
    const dataflow = C.byId(C.DATAFLOWS, ch.dataflow)
    performance = clamp(0.82 + (workforce.aeroBoost && !workforce.illegal ? 0.12 : 0) + (dataflow.id === "diode" ? 0.06 : 0), 0, 1)
    const curfew = C.byId(C.CURFEW, ch.curfew)
    const audit = ev.penalties.filter((p) => ["segaudit", "manualflow", "logs"].includes(p.id)).reduce((a, p) => a + p.p, 0)
    resilience = clamp(1 - 2 * (curfew.breachRisk || 0) - audit, 0, 1)
    cost = costScore(ev, stationId) * 0.5 + budgetFit(ev) * 0.5
    hint(ch.segregation === "shared", 3, "Article F6 3.3: what must be separate between F1 and the sister companies?")
    hint(ch.dataflow === "bidir", 3, "Which direction may data flow under F6 3.3?")
    hint(ch.workforce === "immediate", 3, "F6 3.4: what happens to engineers moving into F1?")
    hint(ch.logs === "standard", 2, "How long must access logs be kept, and how?")
    hint(ch.curfew === "manual", 2, "Curfews are policed by sensors, not memory (5.4).")
    hint(ev.ledger.capState !== "ok", 2, "Infrastructure OpEx is over the allowance.")
    hint(ev.ledger.capexOver > 0, 3, "CapEx is over the envelope.")
  }
  hint(stationId !== "governance" && budgetFit(ev) < 1, 2.5, ev.ledger.capexOver > 0 ? "The team is over its CapEx envelope: every table's spend counts towards it." : "The team's infrastructure OpEx is over the allowance: every table's spend counts towards it.")
  return { performance, cost, compliance, resilience, hints }
}

/** Optimisation indication for one table, using the team's current choices everywhere else. */
export function simulateStation(team, opts, stationId, ev = evaluate(team, opts)) {
  const m = metrics(ev, stationId)
  const parts = { performance: m.performance, cost: m.cost, compliance: m.compliance, resilience: m.resilience }
  let score = 100 * Object.entries(WEIGHTS).reduce((total, [key, w]) => total + w * parts[key], 0)
  if (Object.values(parts).some((value) => value < 0.6)) score = Math.min(score, 74)
  if (parts.compliance < 0.75) score = Math.min(score, 65)
  score = Math.round(clamp(score, 0, 100))
  const hints = m.hints.sort((a, b) => b.weight - a.weight).slice(0, 3).map((h) => h.text)
  if (!hints.length && score < 80) hints.push("Balanced, but not outstanding on any axis: what would make this table's case to the leader sharper?")
  return { station: stationId, score, band: bandFor(score), parts, hints }
}

/** Whole-team view: every table in play plus what the race will see. */
export function simulateTeam(team, opts, stationIds = C.STATIONS.map((s) => s.id)) {
  const ev = evaluate(team, opts)
  const stations = Object.fromEntries(stationIds.map((id) => [id, simulateStation(team, opts, id, ev)]))
  const score = Math.round(stationIds.reduce((total, id) => total + stations[id].score, 0) / Math.max(1, stationIds.length))
  const pen = expectedPenalty(ev)
  return {
    score,
    band: bandFor(score),
    stations,
    race: { aeroIndex: ev.aero.index, lapGain: ev.aero.gain, strategy: ev.strategy, expectedPenaltyPoints: pen.points, dsq: pen.dsq, capex: ev.ledger.capex, opex: ev.ledger.opex },
  }
}
