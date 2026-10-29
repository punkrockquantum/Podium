/**
 * Podium 2027: the game catalog. Four tables, three decisions each, three options per decision.
 * Pure data plus small lookups, shared by the server, every screen and the tests.
 *
 * Money is in US dollars; OpEx is a year. Every figure is a teaching estimate, not a quote.
 */

export const byId = (list, id) => list.find((item) => item.id === id) || null

/* ------------------------------------------------------------ teams */

export const MAX_TEAMS = 10
export const MIN_TEAMS = 1

/** Ten distinct colours that stay readable on the dark theme and on a projector. */
export const TEAM_COLORS = ["#e10600", "#00a3ff", "#ffd60a", "#22c55e", "#ff7a00", "#c084fc", "#00e5d4", "#ff4fa3", "#f5f5f5", "#a3e635"]

/** Tier = how strong the team was in 2026: front-runners get less CapEx headroom and compute. */
export const TIERS = [
  { id: 1, name: "Front-runner", label: "Front-runner (Tier 1)", capex: 6_000_000, compute: 0.7, pace: -0.15, line: "Fastest car, tightest limits: $6M CapEx headroom and 70% compute allowance." },
  { id: 2, name: "Midfield", label: "Midfield (Tier 2)", capex: 8_000_000, compute: 1.0, pace: 0, line: "Balanced: $8M CapEx headroom and the full 100% compute allowance." },
  { id: 3, name: "Challenger", label: "Challenger (Tier 3)", capex: 10_000_000, compute: 1.15, pace: 0.15, line: "Slower car, most room to catch up: $10M CapEx headroom and 115% compute." },
]
export const tierFor = (team) => byId(TIERS, Number(team?.tier)) || TIERS[1]

/** The OpEx every team may spend a year on infrastructure. Up to TOLERANCE over costs aero; more is a breach. */
export const OPEX_ALLOWANCE = 5_000_000
export const OPEX_TOLERANCE = 500_000
export const OPEX_MAJOR = 1_500_000
/** Software, staff and spares every team pays whatever it chooses. */
export const FIXED_OPEX = 1_000_000

/* ------------------------------------------------------------ the four tables */

export const STATIONS = [
  {
    id: "network",
    name: "Connectivity",
    color: "#38bdf8",
    architect: "Connectivity Architect",
    brief: [
      "Race data must reach the factory and back within a strategy call.",
      "FIA rule 5.3: two encrypted tunnels on separate paths.",
      "FIA rule 5.2: car data dumps go over the wired umbilical.",
    ],
    looking: "A fast, legal link that survives a cut fibre without blowing the budget.",
  },
  {
    id: "oem",
    name: "OEMs",
    color: "#f97316",
    architect: "OEM Architect",
    brief: [
      "Choose who builds and supports the supercomputer, and how you pay.",
      "Buying uses CapEx headroom; leasing or as-a-service uses yearly OpEx.",
      "A failed node on race weekend is only as bad as your support contract.",
    ],
    looking: "A vendor and payment plan that fits your tier's limits, with support that matches the risk.",
  },
  {
    id: "dc",
    name: "Datacenter & Power",
    color: "#a855f7",
    architect: "Datacenter Architect",
    brief: [
      "Where the hardware lives, how it is cooled and how hard it runs.",
      "Hot chips on weak cooling throttle; far-away sites add latency.",
      "FIA rule 4.1: race-critical infrastructure needs N+1 power and cooling.",
    ],
    looking: "Cooling that matches the chips, a site near the factory, and power headroom on a hot day.",
  },
  {
    id: "compute",
    name: "CFD Supercomputer",
    color: "#22c55e",
    architect: "CFD Architect",
    brief: [
      "CFD turns compute into downforce; the strategy model needs it too.",
      "FIA rule 2.4: aero testing is capped by your tier's compute allowance.",
      "Bigger is not better above the cap: you pay for idle nodes.",
    ],
    looking: "A cluster sized to the allowance, the right chips, and storage that keeps it fed.",
  },
]

/** Tables from the earlier six-table game: old links show a friendly message instead of an error. */
export const RETIRED_STATIONS = { ai: "AI & strategy", storage: "Storage", governance: "Governance" }

/* ------------------------------------------------------------ decisions (3 per table × 3 options) */

const opt = (id, name, text, why, data = {}) => ({ id, name, text, why, ...data })

export const DECISIONS = [
  /* Connectivity */
  {
    id: "link", station: "network", name: "Factory link", def: "single",
    why: "If the link drops, the pit wall loses its strategy calls.",
    options: [
      opt("single", "Single tunnel", "One encrypted tunnel to the factory over one path.", "Cheapest, but one cut and the pit wall is blind.", { capex: 50_000, opex: 100_000, res: 0.3, fia: "5.3" }),
      opt("redundant", "Redundant tunnels", "Two encrypted tunnels on two separate fibre paths.", "Meets FIA 5.3; a cut fails over in seconds.", { capex: 150_000, opex: 200_000, res: 0.85 }),
      opt("satellite", "Redundant + satellite", "Two tunnels plus a satellite backup for the worst day.", "Stays online even if both fibres are cut.", { capex: 250_000, opex: 300_000, res: 1 }),
    ],
  },
  {
    id: "path", station: "network", name: "Latency path", def: "public",
    why: "Every millisecond is added to every strategy call.",
    options: [
      opt("public", "Public internet", "Tunnels ride the public internet to the data centre.", "Cheap, but jitter can delay a pit call.", { capex: 0, opex: 20_000, perf: 0.45, ms: 140 }),
      opt("crossconnect", "Private cross-connect", "A private interconnect straight into the data centre.", "Low, steady latency for a fair price.", { capex: 100_000, opex: 250_000, perf: 0.95, ms: 70 }),
      opt("darkfibre", "Dark fibre", "Your own fibre from the factory to the data centre.", "Lowest latency, but expensive to light.", { capex: 600_000, opex: 350_000, perf: 1, ms: 55 }),
    ],
  },
  {
    id: "garage", station: "network", name: "Garage data", def: "umbilical",
    why: "How car data leaves the garage decides legality and speed.",
    options: [
      opt("wifi", "Wi-Fi dumps", "Dump car data over garage Wi-Fi: fast and banned.", "Breaks FIA 5.2: expect a time penalty.", { capex: 0, opex: 0, perf: 1, res: 0.5, fia: "5.2", illegal: true }),
      opt("umbilical", "Wired umbilical", "Dump car data over the wired Gigabit umbilical.", "Legal and reliable; engineers wait a little.", { capex: 0, opex: 50_000, perf: 0.75, res: 0.7 }),
      opt("edge", "Umbilical + edge cache", "Wired umbilical plus an edge cache in the garage.", "Legal, and telemetry keeps flowing if the link blips.", { capex: 300_000, opex: 100_000, perf: 1, res: 1 }),
    ],
  },

  /* OEMs */
  {
    id: "vendor", station: "oem", name: "Vendor", def: "dgx",
    why: "The vendor sets the price, the delivery and the software stack.",
    options: [
      opt("supermicro", "Supermicro", "Fast delivery and the lowest price; you integrate more yourself.", "Most hardware per dollar, thinner support.", { priceMult: 1, perf: 0.8, value: 1, support: 0.8, aas: false, strategy: 1 }),
      opt("tier1", "Dell, HPE or Lenovo", "Mainstream servers with full support and an as-a-service programme.", "The only route to as-a-service payment.", { priceMult: 1.15, perf: 0.9, value: 0.85, support: 1, aas: true, strategy: 1 }),
      opt("dgx", "NVIDIA DGX", "Reference systems with NVIDIA's full software stack, at a premium.", "Best tuned for AI, but the dearest and slowest.", { priceMult: 1.35, perf: 0.75, value: 0.55, support: 1, aas: false, strategy: 1.05 }),
    ],
  },
  {
    id: "payment", station: "oem", name: "How you pay", def: "buy",
    why: "Buying spends CapEx headroom; leasing spends yearly OpEx.",
    options: [
      opt("buy", "Buy", "Buy the hardware outright on this year's CapEx.", "No yearly bill, but uses your CapEx headroom.", { opexRate: 0 }),
      opt("lease", "Lease", "Lease over three years: about 30% of the price a year.", "Saves CapEx; adds a yearly OpEx bill.", { opexRate: 0.3 }),
      opt("aas", "As-a-service", "Pay monthly with support included (Dell, HPE or Lenovo only).", "No CapEx, support included; the highest yearly bill.", { opexRate: 0.36 }),
    ],
  },
  {
    id: "support", station: "oem", name: "Support", def: "basic",
    why: "A failed node on race weekend waits for this contract.",
    options: [
      opt("basic", "Basic", "Parts by post; you swap them yourselves.", "Cheapest; a failed node can stay down all weekend.", { rate: 0.03, aasRate: 0, res: 0.4 }),
      opt("nbd", "Next business day", "An engineer on site the next business day.", "Covers most failures, but not a Sunday race.", { rate: 0.06, aasRate: 0, res: 0.8 }),
      opt("4h", "4-hour", "An engineer and parts on site within four hours, 24/7.", "A failed node is back before the race.", { rate: 0.09, aasRate: 0.03, res: 1 }),
    ],
  },

  /* Datacenter & Power */
  {
    id: "location", station: "dc", name: "Location", def: "factory",
    why: "The site sets power prices, resilience and latency to the factory.",
    options: [
      opt("factory", "Home factory", "A server room at the factory, on the factory's power.", "No rent, but dear power and no N+1 (FIA 4.1).", { capex: 200_000, kwYear: 1500, maxKW: 300, pueAdd: 0.1, ms: 0, perf: 0.9, res: 0.4, fia: "4.1" }),
      opt("colo", "Colo near factory", "A colocation hall 30 km from the factory.", "N+1 power and cooling, close to the engineers.", { capex: 0, kwYear: 2000, maxKW: 1500, pueAdd: 0, ms: 2, perf: 1, res: 0.95 }),
      opt("cheap", "Cheap-power region", "A hall in a cheap, green power region far away.", "Low bills, but every call travels much further.", { capex: 0, kwYear: 900, maxKW: 2000, pueAdd: 0, ms: 40, perf: 0.4, res: 0.85 }),
    ],
  },
  {
    id: "cooling", station: "dc", name: "Cooling", def: "air",
    why: "Hot chips on weak cooling throttle when you need them most.",
    options: [
      opt("air", "Air", "Cold aisles and fans: fine for CPUs, weak for GPUs.", "Cheapest; throttles hot chips on a hot day.", { capex: 0, pue: 1.45, heatLimit: 1, res: 0.7 }),
      opt("reardoor", "Rear-door", "Water-cooled rear doors on every rack.", "Handles mixed racks; better efficiency.", { capex: 350_000, pue: 1.3, heatLimit: 1.3, res: 0.9 }),
      opt("liquid", "Direct-to-chip liquid", "Liquid cold plates on every CPU and GPU.", "Cools anything and cuts the power bill.", { capex: 800_000, pue: 1.15, heatLimit: 2, res: 0.9 }),
    ],
  },
  {
    id: "power", station: "dc", name: "Power plan", def: "standard",
    why: "Running harder is faster until something overheats.",
    options: [
      opt("standard", "Standard", "Run every chip at its standard power limit.", "The default balance of speed and heat.", { kwMult: 1, heat: 0, perf: 1, dcPerf: 0.95, res: 0.8 }),
      opt("cap85", "Capped at 85%", "Cap every chip at 85% power.", "About 4% slower, much cooler, lower bills.", { kwMult: 0.85, heat: -0.15, perf: 0.96, dcPerf: 0.95, res: 1 }),
      opt("boost", "Max boost", "Unlock max boost on every chip.", "About 5% faster until it overheats.", { kwMult: 1.15, heat: 0.3, perf: 1.05, dcPerf: 1, res: 0.5 }),
    ],
  },

  /* CFD Supercomputer */
  {
    id: "size", station: "compute", name: "Cluster size", def: "small",
    why: "The FIA caps aero compute; idle nodes above the cap are wasted money.",
    options: [
      opt("small", "Small", "8 nodes: about 60% of your compute allowance.", "Cheap, but leaves aero and strategy on the table.", { price: 2_000_000, kw: 120, capacity: 0.6, strategy: 0.75, res: 0.5 }),
      opt("medium", "Medium", "16 nodes: matches your compute allowance.", "Uses every hour the FIA allows.", { price: 3_600_000, kw: 220, capacity: 1, strategy: 1, res: 0.9 }),
      opt("large", "Large", "28 nodes: 40% more than the allowance.", "Idle above the cap, and a temptation to overrun it.", { price: 6_000_000, kw: 380, capacity: 1.4, strategy: 1, res: 1, fia: "2.4" }),
    ],
  },
  {
    id: "chips", station: "compute", name: "Chips", def: "cpu",
    why: "CPUs suit CFD; GPUs run the AI strategy model.",
    options: [
      opt("cpu", "CPU only", "High-memory CPUs: efficient CFD, a slow strategy model.", "Cheapest and coolest; weak race-day AI.", { priceMult: 1, kwMult: 1, cfd: 1, strategy: 0.55, heat: 0.8 }),
      opt("mixed", "Mixed", "CPUs for CFD plus a GPU partition for strategy.", "The best of both, needs better than air cooling.", { priceMult: 1.3, kwMult: 1.2, cfd: 1.1, strategy: 0.85, heat: 1.1 }),
      opt("gpu", "GPU heavy", "Mostly GPUs: superb AI, CFD billed at peak FP64.", "Best strategy model; hot and dear.", { priceMult: 1.7, kwMult: 1.45, cfd: 1, strategy: 1, heat: 1.5 }),
    ],
  },
  {
    id: "storage", station: "compute", name: "Storage", def: "basic",
    why: "Slow storage leaves expensive nodes waiting for data.",
    options: [
      opt("basic", "Basic", "Network-attached storage shared with the office.", "Cheap; CFD and strategy jobs wait for data.", { price: 300_000, kw: 10, io: 0.8, strategy: 0.9, res: 0.4 }),
      opt("parallel", "Fast parallel", "A parallel file system built for CFD.", "Keeps every node busy.", { price: 800_000, kw: 20, io: 1, strategy: 1, res: 0.85 }),
      opt("cache", "Fast + cache", "Parallel file system plus a flash cache for what-ifs.", "Repeat strategy questions answer instantly.", { price: 1_200_000, kw: 25, io: 1.1, strategy: 1.08, res: 1 }),
    ],
  },
]

export const decision = (id) => byId(DECISIONS, id)
export const decisionsFor = (stationId) => DECISIONS.filter((d) => d.station === stationId)
export const DEFAULT_CHOICES = Object.fromEntries(DECISIONS.map((d) => [d.id, d.def]))
export const validChoice = (id, value) => Boolean(decision(id)?.options.some((o) => o.id === value))

/* ------------------------------------------------------------ scoring and the session */

export const APPROVAL_BONUS = 1.1
/** Table points are a quarter of the approved score plus 10%, so four tables give about 100. */
export const tablePoints = (score, approved) => (approved ? Math.round((Math.max(0, Math.min(100, score)) * APPROVAL_BONUS) / 4) : 0)
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
