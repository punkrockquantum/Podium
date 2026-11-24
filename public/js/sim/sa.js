/**
 * Solutions Architect view: what the plan asks of the campus per season, which public Digital Realty
 * services answer it, who owns each piece, the discovery checklist and a live risk register. Pure
 * functions over an `evaluatePlan` result; the UI adds notes (localStorage) and the print/JSON export.
 *
 * Service names are the public Digital Realty names (fact pack rows G5, G6, G8–G10); owner roles are
 * generic and marked ASSUMPTION (G-f). HPE hardware and support reach the team through HPE GreenLake (H3).
 */
import { K } from "./assumptions.js"
import { FIGURES as F } from "../customer.js"
import { SEASONS } from "./plan.js"
import { fmtDate, isoDate } from "./timeline.js"
import { fmt } from "./dom.js"

const S = K.services
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d
const COOLING = { air: "Air-cooled rows", reardoor: "Rear-door heat exchangers", dlc: "Direct-to-chip liquid cooling with CDUs" }
const REDUNDANCY = { n: "N", n1: "N+1", "2n": "2N UPS, N+2 cooling" }
const SUPPORT = { nbd: "HPE Tech Care Basic (9×5, next business day on-site)", "4h": "HPE Tech Care Essential (24×7, 4-hour on-site)", mission: "HPE Tech Care Critical (24×7, 6-hour hardware repair) with on-site spares" }
const TRACKSIDE = { internet: "Encrypted tunnels over the public internet", carrier: "One carrier circuit (100 Mbps)", dual: "Two diverse carrier circuits", dualsat: "Two carriers plus satellite backup" }

const ROLE_SCOPE = {
  "Sales engineering": "Requirements, sizing, the commercial proposal and the 500 kW envelope (ZUR4 for anything beyond it)",
  "Design engineering": "Suite layout, power whips, rear-door or liquid rows, CDU provision, redundancy",
  Interconnection: "Cross-connects, Campus/Metro Connect, cloud on-ramps, carrier meet-me rooms, SwissIX",
  Sustainability: "Renewable supply, PUE and CO₂ reporting, heat-reuse participation",
  "Customer success / Remote Hands": "Onboarding, Remote Hands, maintenance windows aligned to ATP boundaries",
}

export const ROLES = [
  { id: "team", label: "Audi F1 Team", side: "customer", scope: "Decides the estate, files the FIA declarations, owns the cost-cap treatment and the paddock link", status: "VERIFIED" },
  { id: "hpe", label: "HPE via HPE GreenLake", side: "partner", scope: "Supplies, installs and supports the cluster; meters GreenLake capacity; refresh cadence", status: "VERIFIED" },
  { id: "carrier", label: "Dark-fibre carrier", side: "partner", scope: "Hinwil ↔ campus routes (Swisscom, Litecom or ewz), route files, SLA", status: "VERIFIED" },
  { id: "fia", label: "FIA Technical Department", side: "regulator", scope: "Receives the F4.4.3 declaration and the ATP reports; may inspect the cluster", status: "VERIFIED" },
  ...S.roles.map((r) => ({ id: r.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, ""), label: `Digital Realty · ${r}`, side: "dr", scope: ROLE_SCOPE[r] || "", status: "ASSUMPTION" })),
]

export const roleLabel = (id) => ROLES.find((r) => r.id === id)?.label || id

// ---------------------------------------------------------------------------------------------
// Requirements per season
// ---------------------------------------------------------------------------------------------

/** What the campus must provide for a season of the plan: [{ id, area, label, value, detail, owner, service, status }]. */
export function requirements(result, year) {
  const s = result.seasons[year]
  const x = s.inputs
  const { hw, fac, comp, net, money } = s.sim
  const atDr = x.location !== "hinwil"
  const t = result.timeline.seasons[year]
  const req = []
  const add = (id, area, label, value, detail, owner, service, status = "derived") => req.push({ id, area, label, value, detail, owner, service, status })

  if (!atDr) {
    add("site", "Site", "Location", "Hinwil room (no colocation)", `${Math.round(fac.hinwilIT)} kW of IT in a ${fac.hinwilCapacity} kW room${fac.powerShortKW > 0 ? `: short by ${Math.round(fac.powerShortKW)} kW` : ""}.`, "team", null)
    return req
  }
  add("site", "Site", "Location", x.location === "hybrid" ? "Hybrid: solver estate on the campus, Mission Control and office IT in Hinwil" : "Digital Realty Zurich campus", S.sites, "sales-engineering", "PlatformDIGITAL® colocation", "VERIFIED")
  add("power", "Power", "IT load at the campus", `${Math.round(fac.drIT)} kW of ${fac.drCapacity} kW`, `${hw.clusterKW} kW cluster + ${Math.round(fac.drIT - hw.clusterKW)} kW rest of estate${fac.mlAtDr ? ` (incl. ${fac.mlAtDr} kW ML partition)` : ""}; ${Math.round(fac.facilityKW)} kW at the wall at PUE ${fac.pue.toFixed(2)}; ${fac.drHeadroomKW >= 0 ? `${Math.round(fac.drHeadroomKW)} kW inside the envelope` : "over the envelope"}.`, "design-engineering", "PlatformDIGITAL® colocation")
  add("commit", "Power", "Committed capacity", `${x.committedKW} kW committed · ${fac.drCapacity} kW hard envelope`, `${Math.round(fac.drHeadroomKW)} kW of headroom inside the offer; billed on ${Math.round(fac.billedKW)} kW. Commercial note: the offer has no expansion right; ZUR4 adds 15 MW on the campus in 2028 for anything beyond 500 kW.`, "sales-engineering", "PlatformDIGITAL® colocation")
  if (fac.mlAtDr > 0) add("ml", "Power", "ML partition", `${fac.mlAtDr} kW at the campus (${fac.racks.ml} rack${fac.racks.ml === 1 ? "" : "s"})`, "Unrestricted machine learning on simulation results; inside the same envelope and cage, outside the ATR count.", "design-engineering", "PlatformDIGITAL® colocation")
  add("racks", "Space", "Cage positions", `${fac.racks.total} of ${K.facility.cageRackPositions} rack positions`, `${fac.racks.estate} estate racks at ${K.facility.estateRackKW} kW, ${fac.racks.cluster} cluster rack${fac.racks.cluster === 1 ? "" : "s"}${fac.racks.ml ? `, ${fac.racks.ml} ML rack${fac.racks.ml === 1 ? "" : "s"}` : ""}.`, "design-engineering", "PlatformDIGITAL® colocation")
  add("redundancy", "Power", "Redundancy", REDUNDANCY[x.redundancy], `Modelled availability ${fac.availability * 100} %; ZUR2 runs 2N UPS and N+2 cooling.`, "design-engineering", "PlatformDIGITAL® colocation", x.redundancy === "2n" ? "VERIFIED" : "derived")
  add("space", "Space", "Racks", `${hw.racks} rack${hw.racks === 1 ? "" : "s"} at ${x.rackKW} kW${hw.bufferNodes ? ` + GreenLake buffer (${hw.bufferNodes} nodes)` : ""}`, `${x.nodes} CPU nodes${x.gpus ? `, ${x.gpus} GPUs` : ""}, ${x.storage === "nas" ? "NAS" : x.storage === "pfs" ? "parallel file system" : "parallel file system with flash tier"}; cage or suite with the team's own access list.`, "design-engineering", "PlatformDIGITAL® colocation")
  add("cooling", "Cooling", "Cooling", COOLING[x.cooling], `Limit ≈ ${fac.coolingMax} kW per rack on this cooling${fac.thermalEff < 1 ? `; ${x.rackKW} kW racks would throttle ${Math.round((1 - fac.thermalEff) * 100)} %` : ""}.${x.cooling === "dlc" ? " CDUs, facility water loop and leak detection in the row." : ""}`, "design-engineering", x.cooling === "dlc" ? "High-density colocation (liquid)" : "High-density colocation", x.cooling === "air" ? "derived" : "VERIFIED")
  add("fibre", "Connectivity", "Hinwil ↔ campus dark fibre", `${x.fibrePairs === 2 ? "Two diverse routes" : "One route"} · ${x.fibreGbps}G`, `≈ ${F.sites.campus.fibreKm} km of fibre, ${F.sites.campus.rttMs} ms round trip; link availability ${(K.trackside.fibreAvailability[x.fibrePairs] * 100).toFixed(3)} %. Carrier-provided; terminated in the campus meet-me room.`, "interconnection", S.darkFibre, "VERIFIED")
  add("xc", "Connectivity", "Cross-connects", "2 × cross-connects (fibre routes to the cage)", "Ordered through the Digital Realty customer portal; continuity-tested by Remote Hands.", "interconnection", "ServiceFabric® Cross Connect", "VERIFIED")
  if (x.cloudOnRamp) add("cloud", "Connectivity", "Cloud on-ramps", "AWS Direct Connect · Azure ExpressRoute", "Private on-ramps for unrestricted ML and analytics bursts; not part of the Restricted CFD estate.", "interconnection", S.cloudOnRamps, "VERIFIED")
  add("internet", "Connectivity", "Internet and peering", x.cloudOnRamp ? "IP bandwidth + SwissIX port (optional)" : "IP bandwidth (optional SwissIX)", S.swissix, "interconnection", "ServiceFabric® Internet Exchange / IP Bandwidth", "VERIFIED")
  add("paddock", "Connectivity", "Paddock link", TRACKSIDE[x.trackside], `Terminates at ${x.location === "hybrid" ? "Hinwil (Mission Control)" : "the campus"}; ${net.venue.name} round trip ${net.venue.rttMs} ms, data-to-decision ${net.venue.decisionSec} s; ${fmt.weekends(net.weekendsLost)}.`, "team", null)
  add("hands", "Operations", "Remote Hands", x.support === "mission" ? "24×7 on-demand + scheduled" : "Scheduled + on-demand", S.remoteHands, "customer-success-remote-hands", "Remote Hands", "VERIFIED")
  add("support", "Operations", "HPE support", SUPPORT[x.support], x.consumption === "greenlake" ? S.greenlakeStartup : S.hpeSupport, "hpe", "HPE Tech Care via HPE GreenLake", "VERIFIED")
  add("windows", "Operations", "Maintenance windows", "At ATP boundaries or in the shutdowns", `Six ATPs a year (${K.timeline.atpRule}); summer shutdown ${K.timeline.summerShutdown.days} days, winter ${K.timeline.winterShutdown.days} days.`, "customer-success-remote-hands", "Customer portal", "VERIFIED")
  add("renewable", "Sustainability", "Electricity", x.renewable ? "100 % renewable, market-based" : "Grid mix", `${Math.round(fac.drMWh)} MWh a year at the campus; market-based CO₂ ${money.co2MarketT} t.`, "sustainability", "Renewable supply (portfolio)", "VERIFIED")
  if (x.heatReuse) add("heat", "Sustainability", "Heat reuse", `${Math.round(fac.heatMWh)} MWh of heat offered`, "Waste heat to neighbours now and to the Opfikon network from 2029.", "sustainability", "Heat-reuse programme", "VERIFIED")
  add("fia", "Compliance", "FIA declaration", t.goLive ? `F4.4.3 declaration by ${fmtDate(t.declarationDue)}` : "No change in this season", "Cluster, location, cores and CCF declared within a month of the change; FIA access for inspection on request.", "team", null, "VERIFIED")
  add("cap", "Compliance", "Cost-cap treatment of the fee", `${x.propertySharePct} % as Property Costs`, "The invoice should separate the property element (rent, lease, leasehold improvements) from services so the team's finance function can apply D5.1.1.j.", "sales-engineering", "Invoice structure", "ASSUMPTION")
  if (t.goLive) add("ready", "Timeline", atDr && year === 2027 ? "Suite ready for installation" : "Step-up ready", fmtDate(t.feasible ?? t.goLive), `Go-live ${fmtDate(t.goLive)}${t.slackDays ? ` · ${t.slackDays} days of slack` : ""}${t.critical ? ` · critical path: ${t.critical}` : ""}.`, "design-engineering", "Project delivery", "derived")
  return req
}

/** The requirement lines of a season as rows for the hand-over table, with the 2028 delta flagged. */
export function requirementDelta(result) {
  const r27 = requirements(result, 2027)
  const r28 = requirements(result, 2028)
  return r28.map((r) => ({ ...r, changed: r27.find((q) => q.id === r.id)?.value !== r.value }))
}

// ---------------------------------------------------------------------------------------------
// Service mapping
// ---------------------------------------------------------------------------------------------

export function serviceMap(result) {
  const x27 = result.inputs[2027]
  const x28 = result.inputs[2028]
  const atDr = x27.location !== "hinwil" || x28.location !== "hinwil"
  const rows = [
    { id: "colo", need: "Space, power and cooling for the Restricted CFD estate", service: "PlatformDIGITAL® colocation (cabinet, cage or suite)", detail: S.colocation, source: "G5", applies: atDr },
    { id: "hd", need: `${Math.max(x27.rackKW, x28.rackKW)} kW racks`, service: "High-density colocation", detail: "Rear-door heat exchangers to 70 kW per rack; direct liquid cooling by design engineering", source: "G5", applies: atDr },
    { id: "xc", need: "Fibre routes into the cage; carrier meet-me", service: "ServiceFabric® Cross Connect", detail: S.interconnection, source: "G8", applies: atDr },
    { id: "campus", need: "Second site on another campus building (ZUR4 from 2028, a separate commercial conversation)", service: "ServiceFabric® Campus Connect / Metro Connect", detail: "Links between ZUR1–ZUR4 and across the metro", source: "G8", applies: atDr && x28.redundancy === "2n" },
    { id: "cloud", need: "Unrestricted ML and analytics bursts", service: "Cloud on-ramps: AWS Direct Connect, Azure ExpressRoute", detail: S.cloudOnRamps, source: "G6", applies: x27.cloudOnRamp || x28.cloudOnRamp },
    { id: "ix", need: "Internet and peering", service: "Internet Exchange (SwissIX) / IP Bandwidth", detail: S.swissix, source: "G10", applies: atDr },
    { id: "hands", need: "Rack & stack, maintenance-window support", service: "Remote Hands", detail: S.remoteHands, source: "G9", applies: atDr },
    { id: "sus", need: "Renewable electricity, PUE and CO₂ reporting, heat reuse", service: "Sustainability programme", detail: "100 % renewable across the European portfolio; heat to the Opfikon network from 2029", source: "G4", applies: atDr },
    { id: "fibre", need: `Dark fibre Hinwil ↔ campus (${x27.fibrePairs === 2 || x28.fibrePairs === 2 ? "two diverse routes" : "one route"})`, service: "Carrier dark fibre (not a Digital Realty service)", detail: S.darkFibre, source: "D10", applies: atDr, external: true },
    { id: "hpe", need: "Cluster, support and refresh", service: "HPE via HPE GreenLake", detail: `${S.hpeSupport}. ${S.greenlakeStartup}`, source: "H3", applies: true, external: true },
  ]
  return rows.filter((r) => r.applies)
}

// ---------------------------------------------------------------------------------------------
// Discovery checklist
// ---------------------------------------------------------------------------------------------

export const CHECKLIST = [
  { id: "position", group: "FIA envelope", q: "Which constructors' position does the team plan its 2027 and 2028 allowance against, and when does it re-plan after ATP 3?", rule: "F4.6.1" },
  { id: "gpu-rule", group: "FIA envelope", q: "How does the team expect GPU cores to be charged against AUh from 2028 (no conversion is published yet)?", rule: "F4.4.1 · open" },
  { id: "declaration", group: "FIA envelope", q: "Who files the F4.4.3 declaration and the ATP reports, and does the FIA need access to the suite?", rule: "F4.4.3 · F4.6.4" },
  { id: "hinwil", group: "Estate today", q: "What is the Hinwil room's real power and cooling envelope, and what stays there (Mission Control, simulator, office IT)?" },
  { id: "estate", group: "Estate today", q: "Node count, cores, declared CCF, memory, interconnect and storage of today's cluster; what moves and what is replaced?" },
  { id: "power", group: "Power & cooling", q: "IT kW per season inside the 500 kW envelope, the ML partition's size and placement, and growth beyond 2028 (ZUR4)." },
  { id: "cooling", group: "Power & cooling", q: "Rack density and cooling choice per season; liquid-loop requirements (CDU, supply temperature, leak detection) for the GPU partition." },
  { id: "redundancy", group: "Power & cooling", q: "Redundancy requirement (N+1 vs 2N) and acceptable maintenance windows against the ATP calendar." },
  { id: "fibre", group: "Connectivity", q: "Dark-fibre carrier(s), route diversity and KMZ files Hinwil ↔ Glattbrugg; latency budget for the engineers' workflow." },
  { id: "xc", group: "Connectivity", q: "Cross-connects, cloud on-ramps (AWS, Azure) and SwissIX peering needed; who terminates the paddock link?" },
  { id: "ops", group: "Operations", q: "Remote Hands scope, HPE support tier and spares; who holds the keys to the cage?" },
  { id: "timeline", group: "Timeline", q: "Contract date, cutover target (ATP boundary), parallel-running weeks and the 2028 step-up date." },
  { id: "finance", group: "Commercials", q: "How will the team's finance function treat the colocation fee (Property Costs share) and the fit-out (leasehold improvement)?", rule: "D5.1.1.j" },
  { id: "sustainability", group: "Sustainability", q: "Renewable certificates, heat-reuse participation and CO₂ reporting the team needs for its own reporting." },
  { id: "security", group: "Security & compliance", q: "Physical access lists, FIA confidentiality, data residency in Switzerland and audit logging." },
]

// ---------------------------------------------------------------------------------------------
// Live risk register
// ---------------------------------------------------------------------------------------------

const LEVELS = ["low", "medium", "high"]
const lvl = (i) => LEVELS[Math.max(0, Math.min(2, i))]

export function riskRegister(result) {
  const x27 = result.inputs[2027]
  const x28 = result.inputs[2028]
  const t27 = result.timeline.seasons[2027]
  const t28 = result.timeline.seasons[2028]
  const atDr = x27.location !== "hinwil"
  const risks = []
  const add = (id, title, likelihood, impact, owner, mitigation, season = null, status = "open", source = "") => risks.push({ id, title, likelihood: lvl(likelihood), impact: lvl(impact), owner, mitigation, season, status, source, score: (likelihood + 1) * (impact + 1) })

  if (atDr) {
    add("lead", "Fit-out, fibre or hardware lead time slips past the cutover boundary", t27.slackDays < 7 ? 2 : t27.slackDays < 28 ? 1 : 0, 2, "design-engineering", `Critical path: ${t27.critical || "—"}; ${t27.slackDays ?? 0} days of slack to ${t27.goLive ? fmtDate(t27.goLive) : "—"}. Hold a fallback at the next ATP boundary.`, 2027, t27.slipDays > 0 ? "triggered" : "open", "G-e · D-e · H-f")
    add("fibre-civil", "Dark fibre needs civil works (26+ weeks) on one of the routes", 1, 2, "interconnection", "Pick routes on existing utility ducts (Swisscom, Litecom, ewz); order the second route in parallel.", 2027, "open", "D-e")
    add("single-route", "One fibre route puts the whole solver estate behind one cable", x27.fibrePairs === 1 ? 2 : 0, 2, "interconnection", "Two diverse routes (99.995 % modelled).", 2027, x27.fibrePairs === 1 ? "open" : "mitigated", "D6")
    add("midatp", "A cutover inside a period wastes solver days of a use-it-or-lose-it allowance", t27.seasonLoss > 0 ? 2 : 0, 1, "team", "Move at an ATP boundary or in a shutdown; keep parallel running so the switch is a one-day queue drain.", 2027, t27.seasonLoss > 0 ? "triggered" : "mitigated", "C9 · F4.6.1")
    add("late27", "The 2027 estate is live only after Round 1", t27.goLive && t27.shareOld > 0.3 ? 2 : t27.goLive && t27.shareOld > 0.15 ? 1 : 0, 1, "team", `${t27.goLive ? `${Math.round(t27.shareOld * 100)} % of 2027 on today's setup. ` : ""}Sign earlier or accept ATP 3 as the first period on the new estate.`, 2027, "open", "C7")
    add("property", "Finance treats less of the fee as Property Costs than planned", 1, 1, "sales-engineering", "Structure the invoice so rent, lease and leasehold improvements are separable from services.", null, "open", "C3")
    add("power-stepup", "2028 power or liquid rows not ready for the step-up", t28.changes && t28.fitOutNeeded ? 1 : 0, 2, "design-engineering", `${t28.orderBy ? `Order by ${fmtDate(t28.orderBy)}` : "No 2028 fit-out in this plan"}; the step-up stays inside the ${K.facility.envelopeKW} kW envelope (${Math.round(result.seasons[2028].sim.fac.drIT)} kW).`, 2028, t28.slipDays > 0 ? "triggered" : "open", "G-e")
  } else {
    add("hinwil-short", "The Hinwil room cannot power the estate", result.seasons[2027].sim.fac.powerShortKW > 0 || result.seasons[2028].sim.fac.powerShortKW > 0 ? 2 : 0, 2, "team", "Retrofit the room or move the solver estate to the campus.", null, "open", "A-e")
  }
  add("gpu-rule", "GPU-to-AUh conversion rule not published", x28.solverGpus > 0 ? 2 : 1, x28.solverGpus > 0 ? 2 : 0, "team", `Modelled at ${x28.gpuChargePct} % of FP64 core-equivalents; keep the GPU partition sized to re-balance when the rule lands.`, 2028, "open", "C10")
  add("early28", "GPU partition delivered long before 1 January 2028", t28.earlyDays > K.timeline.earlyStepUpBurnInWeeks * 7 ? 2 : 0, 1, "hpe", `Deliver ${K.timeline.earlyStepUpBurnInWeeks} weeks early for burn-in; later weeks are charge without ATR value (≈ CHF ${Math.round((t28.earlyCostCHF || 0) / 1000)}k).`, 2028, t28.earlyCostCHF > 0 ? "triggered" : "mitigated", "F4.4.1")
  add("thermal", "Rack density exceeds the cooling limit and silicon throttles while accruing AUh", result.seasons[2027].sim.fac.thermalEff < 1 || result.seasons[2028].sim.fac.thermalEff < 1 ? 2 : 0, 2, "design-engineering", "Match density to cooling: rear-door to 70 kW, direct liquid beyond.", null, "open", "G5")
  add("support", "A failed node inside a period is allowance never recovered", x27.support === "nbd" ? 2 : x27.support === "4h" ? 1 : 0, 1, "hpe", "4-hour or mission-critical support with on-site spares; Remote Hands for the physical swap.", null, "open", "H3")
  add("calendar28", "2028 pre-season and Round 1 dates not yet published", 1, 0, "team", "Modelled on the 2027 pattern; re-plan when the 2028 calendar is out.", 2028, "open", "C-a")
  risks.sort((a, b) => b.score - a.score)
  return risks
}

// ---------------------------------------------------------------------------------------------
// Solution brief (JSON hand-over)
// ---------------------------------------------------------------------------------------------

export const HPE_FOOTNOTE = "HPE hardware, HPE Tech Care support and the GreenLake metering are supplied by HPE through HPE GreenLake; Digital Realty provides the facility, power, cooling, interconnection and Remote Hands. Figures are a planning model, not a quotation."

export function solutionBrief(result, { notes = {}, generatedAt = "" } = {}) {
  const seasons = {}
  for (const y of SEASONS) {
    const s = result.seasons[y]
    seasons[y] = {
      inputs: s.inputs,
      requirements: requirements(result, y),
      figures: {
        lapTimeSec: s.perf.sec, effectiveMauh: s.effectiveMauh, usage: s.usage,
        kwAtDigitalRealty: s.sim.fac.drIT, envelopeKW: s.envelope.offerKW, fitsEnvelope: s.envelope.fits,
        trackside: s.trackside,
        capChargeCHF: s.money.capCharge, capChargeDeltaCHF: s.money.capChargeDelta, yearlyCHF: s.money.yearly, cashCHF: s.money.cash,
        availabilityPct: s.availabilityPct, co2MarketT: s.money.co2MarketT, oneOffs: s.money.oneOffs,
      },
      goLive: result.timeline.seasons[y].goLive ? isoDate(result.timeline.seasons[y].goLive) : null,
    }
  }
  return {
    schema: "audi-f1-digital-realty-solution-brief/1",
    generatedAt,
    plan: result.plan,
    health: result.health,
    seasons,
    services: serviceMap(result),
    roles: ROLES,
    risks: riskRegister(result),
    checklist: CHECKLIST.map((c) => ({ ...c, note: notes[c.id] || "" })),
    timeline: {
      inputs: result.timeline.inputs,
      milestones: result.timeline.milestones.map((m) => ({ ...m, date: isoDate(m.date) })),
      tasks: result.timeline.tasks.map((t) => ({ ...t, start: isoDate(t.start), end: isoDate(t.end) })),
      flags: result.timeline.flags,
    },
    footnote: HPE_FOOTNOTE,
  }
}

export { round }
