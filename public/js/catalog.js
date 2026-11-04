/**
 * Podium 2027: the game catalog. Four tables; each is a customer problem with visible targets,
 * visible cost caps and three dials. Pure data plus small lookups, shared by the server, every
 * screen and the tests.
 *
 * The F1 team is the customer. Money is in US dollars; OpEx is a year. Every figure is a teaching
 * estimate, not a quote.
 */

export const byId = (list, id) => list.find((item) => item.id === id) || null

/* ------------------------------------------------------------ teams and the session budget */

export const MAX_TEAMS = 10
export const MIN_TEAMS = 1

/** Ten distinct colours that stay readable on the dark theme and on a projector. */
export const TEAM_COLORS = ["#e10600", "#00a3ff", "#ffd60a", "#22c55e", "#ff7a00", "#c084fc", "#00e5d4", "#ff4fa3", "#f5f5f5", "#a3e635"]

/** One budget for every team, set by the host for the whole session. It moves every cap line. */
export const BUDGET_LEVELS = [
  { id: "tight", name: "Tight", mult: 0.85, line: "Every cap line is 15% lower: one clean answer per table, if you find it." },
  { id: "standard", name: "Standard", mult: 1, line: "The season's real allowance: two or three good answers per table." },
  { id: "generous", name: "Generous", mult: 1.25, line: "Every cap line is 25% higher: premium options come within reach." },
]
export const DEFAULT_BUDGET = "standard"
export const budgetFor = (id) => byId(BUDGET_LEVELS, id) || byId(BUDGET_LEVELS, DEFAULT_BUDGET)

/** The FIA cost cap the infrastructure allowance is carved from (shown for context). */
export const COST_CAP = 215_000_000

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

/**
 * Targets: `min` (at least), `max` (at most) or `pass`. `lo`/`hi` are the ends of the gauge; the
 * green zone runs from the target to the good end.
 */
export const STATIONS = [
  {
    id: "network",
    name: "Connectivity",
    color: "#38bdf8",
    architect: "Connectivity Architect",
    problem: "Get car data from the track to the factory strategists fast and reliably at every race.",
    today: "One encrypted tunnel over the public internet; car data on the wired umbilical.",
    looking: "A fast, legal link that survives a cut fibre, inside both caps.",
    caps: { capex: 600_000, opex: 700_000 },
    targets: [
      { id: "latency", name: "Round-trip latency", kind: "max", target: 120, lo: 0, hi: 250, fmt: fmtMs, zone: "120 ms or less", miss: "Latency is still too high" },
      { id: "availability", name: "Weekend availability", kind: "min", target: 99.9, lo: 98.5, hi: 100, fmt: fmtPct1, zone: "99.9% or more", miss: "The link is offline too often" },
      { id: "fia", name: "FIA compliance", kind: "pass", fmt: passFmt("Pass", "Breach"), zone: "Pass", miss: "The design breaks an FIA rule" },
    ],
    lesson: {
      why: "Strategy calls only win races if race data arrives fast and never drops.",
      provider: "Connectivity partners sell diverse fibre paths and private interconnects as a managed service.",
    },
  },
  {
    id: "oem",
    name: "OEMs",
    color: "#f97316",
    architect: "OEM Architect",
    problem: "Refresh the hardware this season without blowing the CapEx envelope or the yearly cost cap.",
    today: "Last-generation servers bought outright from the incumbent, with basic support.",
    looking: "Twice today's performance, on site before the first race, fixed fast, inside both caps.",
    caps: { capex: 3_400_000, opex: 1_900_000 },
    targets: [
      { id: "perf", name: "Performance vs today", kind: "min", target: 2, lo: 1, hi: 3.5, fmt: fmtX, zone: "2.0× or more", miss: "Not enough performance over today's kit" },
      { id: "fix", name: "Race-weekend fix time", kind: "max", target: 4, lo: 0, hi: 72, fmt: fmtH, zone: "4 hours or less", miss: "A failed node would wait too long for a fix" },
      { id: "lead", name: "Delivery lead time", kind: "max", target: 12, lo: 0, hi: 24, fmt: fmtWk, zone: "12 weeks or less", miss: "The hardware would arrive after the first race" },
    ],
    lesson: {
      why: "New hardware only helps if it arrives before the first race and is fixed fast.",
      provider: "OEMs offer leasing and as-a-service, so customers refresh without spending the CapEx envelope.",
    },
  },
  {
    id: "dc",
    name: "Datacenter & Power",
    color: "#a855f7",
    architect: "Datacenter Architect",
    problem: "House, power and cool the 400 kW cluster so it runs at full speed, inside the cost cap.",
    today: "The factory server room: air cooling, one power feed, no backup.",
    looking: "Enough power and cooling, an efficient PUE and N+1 backup, inside both caps.",
    caps: { capex: 1_000_000, opex: 1_000_000 },
    need: 400,
    targets: [
      { id: "capacity", name: "Power & cooling vs need", kind: "min", target: 100, lo: 0, hi: 200, fmt: fmtPct, zone: "100% or more", miss: "The site cannot power and cool the cluster" },
      { id: "pue", name: "PUE (power efficiency)", kind: "max", target: 1.3, lo: 1, hi: 1.8, fmt: fmtPue, zone: "1.30 or less", miss: "Too much power goes on cooling" },
      { id: "nplus1", name: "N+1 backup", kind: "pass", fmt: passFmt("N+1", "None"), zone: "N+1", miss: "There is no N+1 backup for power and cooling" },
    ],
    lesson: {
      why: "Chips only run at full speed when power and cooling keep up, with a backup.",
      provider: "A colo with liquid-ready halls gives N+1 power and cooling as OpEx, not a building project.",
    },
  },
  {
    id: "compute",
    name: "CFD Supercomputer",
    color: "#22c55e",
    architect: "CFD Architect",
    problem: "Run the season's aero simulations inside the FIA compute cap, with each design cycle back the same day.",
    today: "An ageing eight-node CPU cluster on shared office storage.",
    looking: "Ten or more design cycles a week, under the FIA cap, with every node kept fed.",
    caps: { capex: 3_600_000, opex: 500_000 },
    hallKW: 400,
    targets: [
      { id: "cycles", name: "Design cycles a week", kind: "min", target: 10, lo: 0, hi: 20, fmt: fmtN, zone: "10 or more", miss: "Too few design cycles a week" },
      { id: "usage", name: "Compute vs FIA cap", kind: "max", target: 100, lo: 0, hi: 180, fmt: fmtPct, zone: "100% or less", miss: "The cluster is over the FIA compute cap" },
      { id: "feed", name: "Nodes kept fed", kind: "min", target: 90, lo: 40, hi: 100, fmt: fmtPct, zone: "90% or more", miss: "Storage cannot keep the nodes fed" },
    ],
    lesson: {
      why: "Aero gains come from design cycles per week, inside the FIA's compute cap.",
      provider: "Partners size the cluster to the cap and pair it with storage that keeps nodes fed.",
    },
  },
]

/** Tables from earlier versions: old links show a friendly message instead of an error. */
export const RETIRED_STATIONS = { ai: "AI & strategy", storage: "Storage", governance: "Governance" }

/* ------------------------------------------------------------ dials (3 per table × 3 settings) */

/**
 * opt(id, name, text, as, data): `text` is the setting in one short sentence; `as` is how a hint
 * names it ("a private cross-connect would fix that").
 */
const opt = (id, name, text, as, data = {}) => ({ id, name, text, as, ...data })

export const DECISIONS = [
  /* Connectivity */
  {
    id: "link", station: "network", name: "Paths to the factory", today: "single",
    why: "If the only link drops, the pit wall loses its strategy calls mid-race.",
    how: "Carriers provide two diverse fibre routes plus satellite backup, monitored around the clock.",
    options: [
      opt("single", "Single tunnel", "One encrypted tunnel over one fibre path.", "a single tunnel", { capex: 50_000, opex: 100_000, avail: 99.0, fia: "5.3", fiaText: "FIA 5.3 asks for two encrypted tunnels on separate paths." }),
      opt("redundant", "Two diverse paths", "Two encrypted tunnels on two separate fibre routes.", "two tunnels on diverse paths", { capex: 150_000, opex: 220_000, avail: 99.9 }),
      opt("satellite", "Two paths + satellite", "Two diverse tunnels plus a satellite backup link.", "a satellite backup", { capex: 300_000, opex: 380_000, avail: 99.99 }),
    ],
  },
  {
    id: "path", station: "network", name: "Route to the data centre", today: "public",
    why: "Every millisecond of latency is added to every strategy call on the pit wall.",
    how: "A private cross-connect in a carrier-neutral data centre gives steady low latency without building fibre.",
    options: [
      opt("public", "Public internet", "Tunnels ride the public internet, jitter and all.", "the public internet", { capex: 0, opex: 30_000, ms: 180 }),
      opt("crossconnect", "Private cross-connect", "A private interconnect straight into the data centre.", "a private cross-connect", { capex: 100_000, opex: 250_000, ms: 95 }),
      opt("darkfibre", "Dark fibre", "Your own dedicated fibre from factory to data centre.", "dark fibre", { capex: 400_000, opex: 450_000, ms: 70 }),
    ],
  },
  {
    id: "garage", station: "network", name: "Car data out of the garage", today: "umbilical",
    why: "How car data leaves the garage decides how fast engineers see it, and legality.",
    how: "An edge cache in the garage keeps telemetry flowing when the link to the factory blips.",
    options: [
      opt("wifi", "Garage Wi-Fi", "Dump car data over garage Wi-Fi: fast, but banned.", "garage Wi-Fi", { capex: 0, opex: 0, ms: -15, fia: "5.2", illegal: true, fiaText: "FIA 5.2: car data must leave the garage on the wired umbilical." }),
      opt("umbilical", "Wired umbilical", "Dump car data over the wired Gigabit umbilical.", "the wired umbilical", { capex: 0, opex: 50_000, ms: 15 }),
      opt("edge", "Umbilical + edge cache", "Wired umbilical plus an edge cache in the garage.", "an edge cache in the garage", { capex: 250_000, opex: 100_000, ms: -20 }),
    ],
  },

  /* OEMs */
  {
    id: "vendor", station: "oem", name: "Hardware", today: "incumbent",
    why: "Newer hardware runs more simulations per dollar, but only if it arrives in time.",
    how: "OEMs offer current-generation systems with delivery slots booked ahead of the season.",
    options: [
      opt("incumbent", "Incumbent, last generation", "More of today's servers from the current supplier.", "the incumbent's last-generation kit", { price: 2_400_000, perf: 1.4, lead: 4, aas: false }),
      opt("tier1", "Dell, HPE or Lenovo", "Current-generation servers, with an as-a-service option.", "current-generation Dell, HPE or Lenovo servers", { price: 4_000_000, perf: 2.2, lead: 10, aasLead: 4, aas: true }),
      opt("dgx", "NVIDIA DGX, newest", "The newest GPU systems, with long delivery times.", "NVIDIA DGX", { price: 6_500_000, perf: 3.2, lead: 18, aas: false }),
    ],
  },
  {
    id: "payment", station: "oem", name: "How you pay", today: "buy",
    why: "Buying spends the CapEx envelope now; leasing moves the cost into yearly OpEx.",
    how: "Leasing and as-a-service let the customer refresh now and pay monthly, inside the cap.",
    options: [
      opt("buy", "Buy outright", "Pay the whole price this year from CapEx.", "buying outright", { rate: 0 }),
      opt("lease", "Lease", "Lease over three years: about a third of the price yearly.", "leasing", { rate: 0.32 }),
      opt("aas", "As-a-service", "Pay monthly; the OEM holds stock and bundles support.", "as-a-service", { rate: 0.35 }),
    ],
  },
  {
    id: "support", station: "oem", name: "Race-weekend support", today: "basic",
    why: "A node that fails on Saturday must be back before Sunday's race.",
    how: "OEM 4-hour on-site support puts an engineer and parts at the factory, 24/7.",
    options: [
      opt("basic", "Basic", "Parts by post; your own team swaps them.", "basic support", { hours: 72, rate: 0.02, aasRate: 0 }),
      opt("nbd", "Next business day", "An engineer the next working day: Monday, after a race.", "next-business-day support", { hours: 24, rate: 0.04, aasRate: 0.005 }),
      opt("4h", "4-hour, 24/7", "An engineer and parts on site within four hours.", "4-hour support", { hours: 4, rate: 0.06, aasRate: 0.02 }),
    ],
  },

  /* Datacenter & Power */
  {
    id: "location", station: "dc", name: "Where it lives", today: "factory",
    why: "The site sets the power price, the backup and the room the cluster has.",
    how: "A colo near the factory provides N+1 power and cooling as a monthly service.",
    options: [
      opt("factory", "Factory server room", "The room at the factory, on one power feed.", "the factory server room", { capex: 300_000, kwPrice: 1500, siteKW: 300, pueAdd: 0.1, nplus1: false, fia: "4.1", fiaText: "FIA 4.1: race-critical infrastructure needs N+1 power and cooling." }),
      opt("colo", "Colo near the factory", "A colocation hall 30 km away with N+1 power.", "a colo near the factory", { capex: 0, kwPrice: 1900, siteKW: 1500, pueAdd: 0, nplus1: true }),
      opt("cheap", "Cheap-power region", "A remote hall with cheap power and one grid feed.", "the cheap-power region", { capex: 0, kwPrice: 900, siteKW: 2000, pueAdd: -0.05, nplus1: false, fia: "4.1", fiaText: "FIA 4.1: race-critical infrastructure needs N+1 power and cooling." }),
    ],
  },
  {
    id: "cooling", station: "dc", name: "Cooling", today: "air",
    why: "Hot chips on weak cooling slow down exactly when the team needs them.",
    how: "Liquid-ready halls let the customer run GPUs at full power without building a facility.",
    options: [
      opt("air", "Air", "Fans and cold aisles: fine for CPUs, weak for GPUs.", "air cooling", { capex: 0, coolKW: 280, pue: 1.5 }),
      opt("reardoor", "Rear-door water", "Water-cooled doors on the back of every rack.", "rear-door water cooling", { capex: 400_000, coolKW: 450, pue: 1.3 }),
      opt("liquid", "Direct-to-chip liquid", "Liquid cold plates on every chip.", "direct-to-chip liquid cooling", { capex: 750_000, coolKW: 800, pue: 1.12 }),
    ],
  },
  {
    id: "power", station: "dc", name: "Power setting", today: "standard",
    why: "Running chips harder needs more power and cooling, and costs more every year.",
    how: "Providers meter power per rack, so a power cap turns straight into a lower bill.",
    options: [
      opt("cap85", "Capped at 85%", "Chips capped at 85% power: about 4% slower.", "an 85% power cap", { needMult: 0.85, speed: 0.96 }),
      opt("standard", "Standard", "Chips at their standard power limit.", "the standard power limit", { needMult: 1, speed: 1 }),
      opt("boost", "Max boost", "Chips unlocked to 110% power: about 5% faster.", "max boost", { needMult: 1.1, speed: 1.05 }),
    ],
  },

  /* CFD Supercomputer */
  {
    id: "size", station: "compute", name: "Cluster size", today: "small",
    why: "More nodes mean more design cycles, until the FIA compute cap stops you.",
    how: "Partners size the cluster to the FIA cap, so no paid-for node sits idle.",
    options: [
      opt("small", "8 nodes", "Eight nodes: the size of today's ageing cluster.", "eight nodes", { nodes: 8 }),
      opt("medium", "16 nodes", "Sixteen nodes: sized to the FIA compute cap.", "sixteen nodes", { nodes: 16 }),
      opt("large", "28 nodes", "Twenty-eight nodes: well past the FIA compute cap.", "twenty-eight nodes", { nodes: 28 }),
    ],
  },
  {
    id: "chips", station: "compute", name: "Chips", today: "cpu",
    why: "CFD runs well on CPUs; GPUs are faster but burn the FIA allowance faster.",
    how: "OEMs benchmark the customer's CFD code to pick the chips that do most inside the cap.",
    options: [
      opt("cpu", "CPU only", "High-memory CPUs: efficient CFD within the allowance.", "CPU-only nodes", { nodePrice: 150_000, nodeOpex: 15_000, nodeKW: 10, cycles: 0.75, capShare: 5.625, io: 4 }),
      opt("mixed", "Mixed CPU + GPU", "CPUs for CFD plus a small GPU partition.", "mixed CPU and GPU nodes", { nodePrice: 185_000, nodeOpex: 22_000, nodeKW: 13, cycles: 0.8, capShare: 5.3, io: 6 }),
      opt("gpu", "GPU heavy", "Mostly GPUs: fastest, but billed at peak FP64.", "GPU-heavy nodes", { nodePrice: 300_000, nodeOpex: 35_000, nodeKW: 18, cycles: 1, capShare: 6.5, io: 9 }),
    ],
  },
  {
    id: "storage", station: "compute", name: "Storage", today: "basic",
    why: "Slow storage leaves expensive nodes waiting for data instead of simulating.",
    how: "A parallel file system from a storage partner keeps every node fed at full speed.",
    options: [
      opt("basic", "Office NAS", "Shared office storage on the corporate network.", "the office NAS", { price: 150_000, opex: 20_000, kw: 5, bandwidth: 40 }),
      opt("parallel", "Parallel file system", "A parallel file system built for CFD.", "a parallel file system", { price: 600_000, opex: 60_000, kw: 10, bandwidth: 120 }),
      opt("cache", "Parallel + flash cache", "A parallel file system plus a flash cache.", "a flash cache", { price: 900_000, opex: 90_000, kw: 12, bandwidth: 160 }),
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

/** A 50-minute session: brief, play, race, readout. Every phase is editable on the host screen. */
export const SESSION = {
  briefMinutes: 5,
  playMinutes: 35,
  raceMinutes: 1,
  readoutMinutes: 9,
  maxMinutes: 120,
}
export const sessionTotal = (s = SESSION) => s.briefMinutes + s.playMinutes + s.raceMinutes + s.readoutMinutes

export const FINALE = { race: "Austin, Texas 2027 Grand Prix", circuit: "Circuit of the Americas", laps: 56, lapKm: 5.513, turns: 20 }
