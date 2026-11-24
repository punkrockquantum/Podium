/**
 * Podium 2027, Audi F1 Team edition: the game catalog. Four tables; each is a customer problem
 * with visible targets, visible cap lines and three dials. Pure data plus small lookups, shared by
 * the server, every screen and the tests.
 *
 * The customer is the Audi F1 Team (Hinwil); the question is 500 kW of colocation in our Zurich
 * campus versus staying on-prem. Money is in Swiss francs; the yearly line is the cost-cap charge
 * (operating cost plus straight-line depreciation, FIA D6.1.1.k). Every customer figure comes from
 * customer.js, which cites docs/audi-f1-sources.md or states its assumption. Teaching estimates,
 * not quotes.
 */
import { FIGURES as F, capSharePerNode, kwYearCHF, costCapCHF, nodesAtAllowance } from "./customer.js"

export const byId = (list, id) => list.find((item) => item.id === id) || null

/* ------------------------------------------------------------ the customer and the session budget */

/**
 * Single-customer edition: the game has exactly one participant, the customer, created by the
 * server on boot and on every restart (id, name and colour from customer.js). Nobody adds, renames
 * or removes a team, so the game holds one.
 */
export const CUSTOMER_TEAM = { id: F.team.id, name: F.team.name, color: F.team.color }
export const MAX_TEAMS = 1

/**
 * The finale's two entrants: the customer's 2027 plan (approved tables as tuned, the rest on
 * today's setup) races the customer's existing Hinwil setup (0.00 s found at every table). `short`
 * is the label on the track map and the timing tower, where the full names do not fit.
 */
export const FINALE_ENTRANTS = {
  plan: { id: CUSTOMER_TEAM.id, name: `${CUSTOMER_TEAM.name} · 2027 plan`, short: "2027 plan", color: CUSTOMER_TEAM.color },
  today: { id: "today", name: `${CUSTOMER_TEAM.name} · today's Hinwil setup`, short: "Hinwil today", color: "#8b93a3" },
}

/** One budget for the whole session, set by the host. It moves every cap line. */
export const BUDGET_LEVELS = [
  { id: "tight", name: "Tight", mult: 0.85, line: "Every cap line is 15% lower: one clean answer per table, if you find it." },
  { id: "standard", name: "Standard", mult: 1, line: "The 2027 planning envelopes: two or three good answers per table." },
  { id: "generous", name: "Generous", mult: 1.25, line: "Every cap line is 25% higher: premium options come within reach." },
]
export const DEFAULT_BUDGET = "standard"
export const budgetFor = (id) => byId(BUDGET_LEVELS, id) || byId(BUDGET_LEVELS, DEFAULT_BUDGET)

/** The FIA cost cap the infrastructure envelopes are carved from (USD, Art. D4.1.2), and its CHF views. */
export const COST_CAP = F.fia.costCapUSD
export const COST_CAP_CHF = costCapCHF
export const CUSTOMER_NAME = F.name
export const EDITION = F.edition

/* ------------------------------------------------------------ the four tables */

const fmtMs = (v) => `${Math.round(v)} ms`
const fmtPct1 = (v) => `${v.toFixed(v >= 99.95 ? 2 : 1)}%`
const fmtPct = (v) => `${Math.round(v)}%`
const fmtX = (v) => `${v.toFixed(1)}×`
const fmtH = (v) => `${Math.round(v)} h`
const fmtWk = (v) => `${Math.round(v)} weeks`
const fmtPue = (v) => v.toFixed(2)
const fmtN = (v) => `${Math.round(v * 10) / 10}`
const passFmt = (pass, fail) => (v) => (v ? pass : fail)

const NEED_KW = F.load.it2027KW
const COMMITTED_KW = F.offer.committedKW
const MAUH = F.fia.mauhAllowance
const ATR_PCT = F.fia.atrPercent

/**
 * Targets: `min` (at least), `max` (at most) or `pass`. `lo`/`hi` are the ends of the gauge; the
 * green zone runs from the target to the good end. Cap lines are the 2027 planning envelopes the
 * team set for each area (an Audi F1 requirement in the game, not an FIA figure).
 */
export const STATIONS = [
  {
    id: "network",
    name: "Connectivity",
    color: "#38bdf8",
    architect: "Connectivity Solutions Architect",
    problem: "Link the Zurich campus to Hinwil, the trackside garage and Neuburg fast and reliably at every race.",
    today: "Factory and garage on one encrypted tunnel over the public internet; car data on the wired umbilical.",
    looking: "Two diverse paths to Hinwil, a private route from every circuit, inside both cap lines.",
    caps: { capex: 500_000, opex: 600_000 },
    targets: [
      { id: "latency", name: "Trackside → Zurich round trip", kind: "max", target: 120, lo: 0, hi: 250, fmt: fmtMs, zone: "120 ms or less", miss: "Latency is still too high" },
      { id: "availability", name: "Race-weekend availability", kind: "min", target: 99.9, lo: 98.5, hi: 100, fmt: fmtPct1, zone: "99.9% or more", miss: "The link is offline too often" },
      { id: "fia", name: "Rules & requirements", kind: "pass", fmt: passFmt("Pass", "Breach"), zone: "Pass", miss: "The design breaks a rule or an Audi F1 requirement" },
    ],
    lesson: {
      why: "Strategy calls only win races if race data reaches Mission Control fast and never drops.",
      provider: "The campus sells diverse dark-fibre routes and private circuits to every circuit as one managed service.",
    },
  },
  {
    id: "oem",
    name: "OEMs",
    color: "#f97316",
    architect: "OEM Solutions Architect",
    problem: "Refresh the 2027 hardware before the Bahrain test without breaking the capital envelope or the cost cap.",
    today: "Last-generation servers bought outright from the incumbent, with basic support.",
    looking: "Twice today's performance, in Zurich before 24 February 2027, fixed within four hours, inside both lines.",
    caps: { capex: 3_000_000, opex: 1_900_000 },
    targets: [
      { id: "perf", name: "Performance vs today", kind: "min", target: 2, lo: 1, hi: 3.5, fmt: fmtX, zone: "2.0× or more", miss: "Not enough performance over today's kit" },
      { id: "fix", name: "Race-weekend fix time", kind: "max", target: 4, lo: 0, hi: 72, fmt: fmtH, zone: "4 hours or less", miss: "A failed node would wait too long for a fix" },
      { id: "lead", name: "Delivery lead time", kind: "max", target: 12, lo: 0, hi: 24, fmt: fmtWk, zone: "12 weeks or less", miss: "The hardware would arrive after the Bahrain test" },
    ],
    lesson: {
      why: "New hardware only helps if it is racked before pre-season testing and fixed fast on a race weekend.",
      provider: "OEMs offer leasing and as-a-service, so the team refreshes without spending the capital envelope.",
    },
  },
  {
    id: "dc",
    name: "Datacenter & Power",
    color: "#a855f7",
    architect: "Datacenter Solutions Architect",
    problem: `House, power and cool the ${NEED_KW} kW 2027 estate, with a path to 2028, inside the cost cap.`,
    today: `The Hinwil data room: air cooling, about ${F.room.capacityKW} kW, one utility feed, no 2028 headroom (planning assumption).`,
    looking: "Capacity for 2027 with 2028 headroom, PUE 1.30 or better, N+1 or 2N, inside both cap lines.",
    caps: { capex: 1_900_000, opex: 2_100_000 },
    need: NEED_KW,
    targets: [
      { id: "capacity", name: "Power & cooling vs 2027 need", kind: "min", target: 100, lo: 0, hi: 200, fmt: fmtPct, zone: "100% or more", miss: "The site cannot power and cool the 2027 estate" },
      { id: "pue", name: "PUE (power efficiency)", kind: "max", target: 1.3, lo: 1, hi: 1.8, fmt: fmtPue, zone: "1.30 or less", miss: "Too much power goes on cooling" },
      { id: "nplus1", name: "Resilience (N+1 or 2N)", kind: "pass", fmt: passFmt("N+1 / 2N", "None"), zone: "N+1 or 2N", miss: "There is no N+1 backup for power and cooling" },
    ],
    lesson: {
      why: "Chips only run at full speed when power and cooling keep up, and every facility kWh counts against the cost cap.",
      provider: "A 500 kW commitment in a 2N/N+1 campus gives capacity, PUE 1.2 and 2028 headroom as a monthly fee, not a building project.",
    },
  },
  {
    id: "compute",
    name: "CFD Supercomputer",
    color: "#22c55e",
    architect: "CFD Solutions Architect",
    problem: `Run the aero programme inside the team's ${MAUH} MAUh ATR allowance, with each design cycle back the same day.`,
    today: "An ageing eight-node CPU cluster on shared office storage, well under the allowance.",
    looking: `Ten or more design cycles a week, at or under ${ATR_PCT}% of the baseline MAUh, every node kept fed.`,
    caps: { capex: 2_400_000, opex: 600_000 },
    hallKW: F.room.cfdAllocationKW,
    targets: [
      { id: "cycles", name: "Design cycles a week", kind: "min", target: 10, lo: 0, hi: 20, fmt: fmtN, zone: "10 or more", miss: "Too few design cycles a week" },
      { id: "usage", name: "Solver compute vs MAUh allowance", kind: "max", target: 100, lo: 0, hi: 180, fmt: fmtPct, zone: "100% or less", miss: "The cluster is over the ATR compute allowance" },
      { id: "feed", name: "Nodes kept fed", kind: "min", target: 90, lo: 40, hi: 100, fmt: fmtPct, zone: "90% or more", miss: "Storage cannot keep the nodes fed" },
    ],
    lesson: {
      why: `Aero gains come from design cycles per week inside the FIA's ${MAUH} MAUh allowance (F4.6.1), on declared CPU cores until 2028.`,
      provider: "Partners size the declared cluster to the allowance and pair it with storage that keeps nodes fed.",
    },
  },
]

/** Tables from earlier versions: old links show a friendly message instead of an error. */
export const RETIRED_STATIONS = { ai: "AI & strategy", storage: "Storage", governance: "Governance" }

/* ------------------------------------------------------------ dials (3 per table × 3 settings) */

/**
 * opt(id, name, text, as, data): `text` is the setting in one short sentence; `as` is how a hint
 * names it ("a private circuit into the campus would fix that"). A `rule` marks a breach: `ruleLabel`
 * is what the board shows ("FIA F4.4.1" or "Audi F1 requirement") and `ruleText` explains it.
 */
const opt = (id, name, text, as, data = {}) => ({ id, name, text, as, ...data })

const REQ = "Audi F1 requirement"
const NODES = { small: 8, medium: Math.floor(nodesAtAllowance), large: 20 }
const NODE_WORDS = { 8: "Eight", 12: "Twelve", 13: "Thirteen", 20: "Twenty" }
const nodeWord = (n) => NODE_WORDS[n] || String(n)

export const DECISIONS = [
  /* Connectivity */
  {
    id: "link", station: "network", name: "Paths Hinwil ↔ Zurich campus", today: "single",
    why: "If the only path to Mission Control drops, the pit wall loses its strategy calls mid-race.",
    how: "The campus provides two diverse dark-fibre routes from Hinwil plus a satellite backup, monitored around the clock.",
    options: [
      opt("single", "Single route", "One dark-fibre pair on one route, about 0.35 ms.", "a single route", { capex: 60_000, opex: 48_000, avail: 99.5, rule: "req-paths", ruleLabel: REQ, ruleText: `${REQ}: race-critical links to Mission Control run on two diverse paths.` }),
      opt("redundant", "Two diverse routes", "Two dark-fibre pairs on separate routes into the campus.", "two diverse fibre routes", { capex: 120_000, opex: 96_000, avail: 99.95 }),
      opt("satellite", "Two routes + satellite", "Two diverse routes plus a LEO satellite backup link.", "a satellite backup", { capex: 200_000, opex: 150_000, avail: 99.99 }),
    ],
  },
  {
    id: "path", station: "network", name: "Route from the circuit to Zurich", today: "public",
    why: "Every millisecond between the garage and Zurich is added to every strategy call on the pit wall.",
    how: "A private circuit from each paddock into the campus gives steady latency at 24 Grands Prix.",
    options: [
      opt("public", "Public internet", "Encrypted tunnels over the public internet, jitter and all.", "the public internet", { capex: 0, opex: 30_000, ms: 180 }),
      opt("crossconnect", "Private circuit into the campus", "A carrier circuit from the paddock into the campus meet-me room.", "a private circuit into the campus", { capex: 100_000, opex: 250_000, ms: 100 }),
      opt("darkfibre", "Private WAN + edge PoP", "A private global WAN with a point of presence near each circuit.", "a private WAN with edge PoPs", { capex: 300_000, opex: 350_000, ms: 85 }),
    ],
  },
  {
    id: "garage", station: "network", name: "Car data out of the garage", today: "umbilical",
    why: "How car data leaves the garage decides how fast engineers see it, and whether security signs it off.",
    how: "An edge node in the garage keeps telemetry flowing to Zurich and Hinwil when the link blips.",
    options: [
      opt("wifi", "Unmanaged garage Wi-Fi", "Dump car data over ad-hoc garage Wi-Fi: fast, outside the policy.", "garage Wi-Fi", { capex: 0, opex: 0, ms: -15, rule: "req-wired", ruleLabel: REQ, illegal: true, ruleText: `${REQ}: car data leaves the garage only over the managed wired network.` }),
      opt("umbilical", "Wired umbilical", "Dump car data over the managed wired Gigabit umbilical.", "the wired umbilical", { capex: 0, opex: 40_000, ms: 15 }),
      opt("edge", "Umbilical + garage edge node", "Wired umbilical plus an edge compute and cache node.", "an edge node in the garage", { capex: 200_000, opex: 80_000, ms: -20 }),
    ],
  },

  /* OEMs */
  {
    id: "vendor", station: "oem", name: "Hardware", today: "incumbent",
    why: "Newer hardware runs more simulations per franc, but only if it is racked before the Bahrain test.",
    how: "OEMs book current-generation delivery slots ahead of the season and hold stock for as-a-service.",
    options: [
      opt("incumbent", "Incumbent, last generation", "More of today's servers from the current supplier.", "the incumbent's last-generation kit", { price: 2_000_000, perf: 1.4, lead: 4, aas: false }),
      opt("tier1", "Dell, HPE or Lenovo", "Current-generation x86 servers, with an as-a-service option.", "current-generation Dell, HPE or Lenovo servers", { price: 3_400_000, perf: 2.2, lead: 10, aasLead: 4, aas: true }),
      opt("dgx", "NVIDIA DGX, newest", "The newest GPU systems, with long delivery times.", "NVIDIA DGX", { price: 5_500_000, perf: 3.2, lead: 18, aas: false }),
    ],
  },
  {
    id: "payment", station: "oem", name: "How you pay", today: "buy",
    why: "Buying spends the capital envelope now and still charges the cap through depreciation; leasing spreads it.",
    how: "Leasing and as-a-service let the team refresh now and pay monthly, as an operating cost inside the cap.",
    options: [
      opt("buy", "Buy outright", `Pay the whole price this year; depreciate over ${F.fia.depreciationYearsIT} years.`, "buying outright", { rate: 0 }),
      opt("lease", "Lease", "Lease over three years: about a third of the price yearly.", "leasing", { rate: 0.32 }),
      opt("aas", "As-a-service", "Pay monthly; the OEM holds stock and bundles support.", "as-a-service", { rate: 0.35 }),
    ],
  },
  {
    id: "support", station: "oem", name: "Race-weekend support", today: "basic",
    why: "A node that fails on Saturday must be back before Sunday's race.",
    how: "OEM 4-hour on-site support puts an engineer and parts in the Zurich campus, 24/7.",
    options: [
      opt("basic", "Basic", "Parts by post; your own team swaps them.", "basic support", { hours: 72, rate: 0.02, aasRate: 0 }),
      opt("nbd", "Next business day", "An engineer the next working day: Monday, after a race.", "next-business-day support", { hours: 24, rate: 0.04, aasRate: 0.005 }),
      opt("4h", "4-hour, 24/7", "An engineer and parts on site within four hours.", "4-hour support", { hours: 4, rate: 0.06, aasRate: 0.02 }),
    ],
  },

  /* Datacenter & Power */
  {
    id: "location", station: "dc", name: "Where the 2027 cluster lives", today: "factory",
    why: "The site sets capacity, the power price, resilience and whether the 2028 load has a home.",
    how: `A ${COMMITTED_KW} kW commitment in the Zurich campus brings 2N power and N+1 cooling as a monthly fee.`,
    options: [
      opt("factory", "Hinwil data room (today)", `The room at the factory: about ${F.room.capacityKW} kW on one utility feed.`, "the Hinwil data room", { capex: 300_000, plantYears: F.fia.depreciationYearsPlant, kwPrice: kwYearCHF(F.tariffs.hinwilCHFPerKWh), fee: 0, siteKW: F.room.capacityKW, pueAdd: 0.15, nplus1: false, resilience: "N" }),
      opt("colo", `Zurich campus, ${COMMITTED_KW} kW`, `${COMMITTED_KW} kW committed ${F.sites.hinwil.kmToZurich} km away: 2N power, N+1 cooling, liquid-ready.`, "the Zurich campus", { capex: F.offer.fitOutCHF + F.offer.migrationCHF, plantYears: F.fia.depreciationYearsPlant, kwPrice: kwYearCHF(F.tariffs.campusCHFPerKWh), fee: F.offer.feeCHFPerKWMonth * 12 * COMMITTED_KW, siteKW: COMMITTED_KW, expansionKW: F.offer.expansionRightKW, pueAdd: 0, nplus1: true, resilience: "2N power / N+1 cooling" }),
      opt("cheap", "Remote low-cost region", "A hall 900 km away with cheap power and one grid feed.", "the remote low-cost region", { capex: 900_000, plantYears: F.fia.depreciationYearsPlant, kwPrice: kwYearCHF(F.tariffs.remoteCHFPerKWh), fee: 110 * 12 * COMMITTED_KW, siteKW: 2000, pueAdd: -0.05, nplus1: false, resilience: "N", note: "A new RCFD location must be re-declared to the FIA within a month (F4.4.3)." }),
    ],
  },
  {
    id: "cooling", station: "dc", name: "Cooling", today: "air",
    why: "Hot chips on weak cooling slow down when the team needs them, and PUE is the power bill.",
    how: "Liquid-ready rows let the team run accelerators at full power and reuse the heat, without building a plant.",
    options: [
      opt("air", "Air", "Fans and cold aisles: fine for CPUs, weak for accelerators.", "air cooling", { capex: 0, coolKW: 300, pue: 1.45 }),
      opt("reardoor", "Rear-door water", "Water-cooled doors on the back of every rack.", "rear-door water cooling", { capex: F.offer.rearDoorCHF, coolKW: 420, pue: 1.28 }),
      opt("liquid", "Direct-to-chip liquid", "Liquid cold plates on every chip; 2028 GPU rows ready.", "direct-to-chip liquid cooling", { capex: F.offer.liquidLoopCHF, coolKW: 1000, pue: 1.12 }),
    ],
  },
  {
    id: "power", station: "dc", name: "Power setting", today: "standard",
    why: "Running chips harder needs more power and cooling, and every facility kWh is a cost-cap franc.",
    how: "The campus meters power per rack, so a power cap turns straight into a lower bill.",
    options: [
      opt("cap85", "Capped at 85%", "Chips capped at 85% power: about 4% slower.", "an 85% power cap", { needMult: 0.85, speed: 0.96 }),
      opt("standard", "Standard", "Chips at their standard power limit.", "the standard power limit", { needMult: 1, speed: 1 }),
      opt("boost", "Max boost", "Chips unlocked to 110% power: about 5% faster.", "max boost", { needMult: 1.1, speed: 1.05 }),
    ],
  },

  /* CFD Supercomputer */
  {
    id: "size", station: "compute", name: "Declared cluster size", today: "small",
    why: `More nodes mean more design cycles, until the ${MAUH} MAUh allowance stops you.`,
    how: "Partners size the declared cluster to the allowance, so no paid-for node sits idle or breaks it.",
    options: [
      opt("small", `${NODES.small} nodes`, `${nodeWord(NODES.small)} nodes: the size of today's ageing cluster.`, `${nodeWord(NODES.small).toLowerCase()} nodes`, { nodes: NODES.small }),
      opt("medium", `${NODES.medium} nodes`, `${nodeWord(NODES.medium)} nodes: sized to the ${MAUH} MAUh allowance.`, `${nodeWord(NODES.medium).toLowerCase()} nodes`, { nodes: NODES.medium }),
      opt("large", `${NODES.large} nodes`, `${nodeWord(NODES.large)} nodes: well past the MAUh allowance.`, `${nodeWord(NODES.large).toLowerCase()} nodes`, { nodes: NODES.large }),
    ],
  },
  {
    id: "chips", station: "compute", name: "Chips", today: "cpu",
    why: "In 2027 the solver runs on declared CPU cores; GPUs only help before and after the solve.",
    how: "OEMs benchmark the team's CFD code on declared CPUs and add GPUs for post-processing and 2028.",
    options: [
      opt("cpu", "CPU-only solver", "Declared 128-core nodes: legal CFD inside the allowance.", "CPU-only nodes", { nodePrice: F.cluster.nodePriceCHF, nodeOpex: 4_500, nodeKW: F.cluster.nodeKW, cycles: 0.9, capShare: capSharePerNode, io: 4 }),
      opt("mixed", "CPU solver + GPU partition", "Declared CPUs for the solve, GPUs for post-processing and ML.", "a CPU solver with a GPU partition", { nodePrice: 140_000, nodeOpex: 9_000, nodeKW: 3.0, cycles: 1.0, capShare: capSharePerNode, io: 6 }),
      opt("gpu", "GPU solver (2028 rule)", "GPUs run the solver itself: not allowed before 1 Jan 2028.", "a GPU solver", { nodePrice: 300_000, nodeOpex: 24_000, nodeKW: 12, cycles: 1.3, capShare: capSharePerNode * 1.5, io: 9, rule: "F4.4.1", ruleLabel: "FIA F4.4.1", ruleText: "FIA F4.4.1: in 2027 the RCFD solver runs only on declared CPU cores; GPU cores are allowed from 1 January 2028." }),
    ],
  },
  {
    id: "storage", station: "compute", name: "Storage", today: "basic",
    why: "Slow storage leaves expensive declared nodes waiting for data instead of solving.",
    how: "A parallel file system from a storage partner keeps every node fed at full speed.",
    options: [
      opt("basic", "Office NAS", "Shared office storage on the corporate network.", "the office NAS", { price: 120_000, opex: 15_000, kw: 5, bandwidth: 40 }),
      opt("parallel", "Parallel file system", "A parallel file system built for CFD.", "a parallel file system", { price: 450_000, opex: 45_000, kw: 10, bandwidth: 120 }),
      opt("cache", "Parallel + flash cache", "A parallel file system plus a flash cache.", "a flash cache", { price: 700_000, opex: 70_000, kw: 12, bandwidth: 160 }),
    ],
  },
]

export const decision = (id) => byId(DECISIONS, id)
export const decisionsFor = (stationId) => DECISIONS.filter((d) => d.station === stationId)
/** "What the customer has today": every unapproved table races on this. */
export const BASELINE_CHOICES = Object.fromEntries(DECISIONS.map((d) => [d.id, d.today]))
export const validChoice = (id, value) => Boolean(decision(id)?.options.some((o) => o.id === value))
/** One in-zone answer per table at the Standard budget (demo mode and the tests). */
export const REFERENCE_BUILD = {
  link: "redundant", path: "crossconnect", garage: "umbilical",
  vendor: "tier1", payment: "aas", support: "4h",
  location: "colo", cooling: "liquid", power: "cap85",
  size: "medium", chips: "cpu", storage: "parallel",
}

/* ------------------------------------------------------------ scoring and the session */

export const APPROVAL_BONUS = 1.1
/** Table points are a quarter of the approved FIT plus 10%, so four tables give about 100. */
export const tablePoints = (fit, approved) => (approved ? Math.round((Math.max(0, Math.min(100, fit)) * APPROVAL_BONUS) / 4) : 0)
export const PITCH_MAX = tablePoints(100, true)

/** The session runs untimed unless the host starts the timer: 35 minutes by default, 120 at most. */
export const SESSION = {
  timerMinutes: 35,
  maxMinutes: 120,
}

/** The finale stays Austin: the United States Grand Prix is on the 2027 calendar (22–24 Oct 2027). */
export const FINALE = { race: "Austin, Texas 2027 Grand Prix", circuit: "Circuit of the Americas", laps: 56, lapKm: 5.513, turns: 20 }
