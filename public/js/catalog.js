/**
 * Podium catalog: every choosable option, what it costs, and the one-line reason it matters.
 *
 * Tags shown on option cards:
 *   "FIA rule"  the option exists because the 2027 Infrastructure Specification mandates or bans it.
 *   "est."      a teaching estimate (prices, lead times, speeds), not a quote.
 * Industry figures (datasheet memory and bandwidth, CBRE 2026 colocation rents, published cloud and
 * OEM list prices) carry no tag. Source notes for the commercial terms: OEM commercial research,
 * October 2026 (HPE GreenLake, Dell APEX, Lenovo TruScale terms; CBRE Global Data Center Trends 2026;
 * AWS Capacity Blocks; NVIDIA AI Enterprise pricing guide).
 */

/* ------------------------------------------------------------------ season & regulations */

export const SEASON = {
  weeks: 52,
  firstRaceWeek: 10,
  finaleWeek: 49,
  atpCount: 6,
  /** One Aerodynamic Testing Period: 52 / 6 weeks of wall-clock hours. */
  atpHours: (52 / 6) * 168,
  /** Share of wall-clock a cluster is actually schedulable (maintenance, queue gaps). PODIUM. */
  availability: 0.9,
}

/** FIA 1.1: base cap, calendar scalers. */
export const COST_CAP = { base: 215_000_000, baseRaces: 24, perRace: 1_800_000, perSprint: 300_000 }

export function costCap(races = 24, sprints = 6) {
  return COST_CAP.base + (races - COST_CAP.baseRaces) * COST_CAP.perRace + sprints * COST_CAP.perSprint
}

/**
 * The slice of the cost cap the infrastructure department is allotted this year (PODIUM). Going
 * over the allowance takes money from car development; going past the headroom breaches the cap.
 */
export const INFRA_OPEX = { allowance: 4_400_000, headroom: 800_000 }

/** Fixed OpEx every team pays: CFD/CAD/PLM/OS licences are OpEx-deductible (FIA 1.1). PODIUM figure. */
export const BASE_LICENCES = 1_600_000

/**
 * FIA 1.2 CapEx tiers (4-year envelope) and what each tier already committed in 2024–2026 on wind
 * tunnel, dynos, DiL and earlier IT (PODIUM). The remainder is the 2027 infrastructure envelope.
 */
export const CAPEX_TIERS = [
  { id: 1, name: "Tier 1 (P1–P4)", ranks: [1, 2, 3, 4], envelope: 45_000_000, committed: 39_000_000 },
  { id: 2, name: "Tier 2 (P5–P7)", ranks: [5, 6, 7], envelope: 55_000_000, committed: 47_000_000 },
  { id: 3, name: "Tier 3 (P8–P10 & new)", ranks: [8, 9, 10], envelope: 65_000_000, committed: 55_000_000 },
]

export function tierForRank(rank) {
  return CAPEX_TIERS.find((tier) => tier.ranks.includes(rank)) || CAPEX_TIERS[2]
}

/** FIA 2.4 sliding scale. */
export const ATR = [
  { rank: 1, mult: 0.7, mauh: 4.2, ratg: 1400, windOn: 56 },
  { rank: 2, mult: 0.75, mauh: 4.5, ratg: 1500, windOn: 60 },
  { rank: 3, mult: 0.8, mauh: 4.8, ratg: 1600, windOn: 64 },
  { rank: 4, mult: 0.85, mauh: 5.1, ratg: 1700, windOn: 68 },
  { rank: 5, mult: 0.9, mauh: 5.4, ratg: 1800, windOn: 72 },
  { rank: 6, mult: 0.95, mauh: 5.7, ratg: 1900, windOn: 76 },
  { rank: 7, mult: 1.0, mauh: 6.0, ratg: 2000, windOn: 80 },
  { rank: 8, mult: 1.05, mauh: 6.3, ratg: 2100, windOn: 84 },
  { rank: 9, mult: 1.1, mauh: 6.6, ratg: 2200, windOn: 88 },
  { rank: 10, mult: 1.15, mauh: 6.9, ratg: 2300, windOn: 92 },
]

export function atrForRank(rank) {
  return ATR.find((row) => row.rank === rank) || ATR[6]
}

/**
 * MAUh unit. FIA 2.1 writes AUh = core-hours × GFLOPS/core / 10^6 and MAUh = AUh / 10^6. Applied
 * literally, a 6 MAUh cap would be ~10^11 core-hours, which no cluster on Earth could reach, so the
 * game applies the 10^6 once (MAUh = core-hours × GFLOPS/core / 10^6), the convention F1 teams
 * actually report. That assumption is printed on the compute station brief.
 */
export const MAUH_DIVISOR = 1e6

/** Sparse CFD solvers are memory-bound: about 0.25 FLOP per byte moved (PODIUM, typical RANS/LES). */
export const CFD_FLOP_PER_BYTE = 0.25
/** A compute-bound kernel reaches about half of theoretical peak (PODIUM). */
export const COMPUTE_EFFICIENCY = 0.5

/* ------------------------------------------------------------------ geography */

/** Team factory and race support centre: "Motorsport Valley", Oxfordshire. */
export const FACTORY = { name: "Factory & Race Support Centre (Oxfordshire)", lat: 51.75, lon: -1.26 }

/** A representative 24-race calendar (circuit coordinates). The finale is the race the game runs. */
export const CIRCUITS = [
  { name: "Melbourne", lat: -37.85, lon: 144.97 },
  { name: "Shanghai", lat: 31.34, lon: 121.22 },
  { name: "Suzuka", lat: 34.84, lon: 136.54 },
  { name: "Bahrain", lat: 26.03, lon: 50.51 },
  { name: "Jeddah", lat: 21.63, lon: 39.1 },
  { name: "Miami", lat: 25.96, lon: -80.24 },
  { name: "Montréal", lat: 45.5, lon: -73.52 },
  { name: "Monaco", lat: 43.73, lon: 7.42 },
  { name: "Barcelona", lat: 41.57, lon: 2.26 },
  { name: "Spielberg", lat: 47.22, lon: 14.76 },
  { name: "Silverstone", lat: 52.07, lon: -1.02 },
  { name: "Spa", lat: 50.44, lon: 5.97 },
  { name: "Budapest", lat: 47.58, lon: 19.25 },
  { name: "Zandvoort", lat: 52.39, lon: 4.54 },
  { name: "Monza", lat: 45.62, lon: 9.28 },
  { name: "Madrid", lat: 40.46, lon: -3.62 },
  { name: "Baku", lat: 40.37, lon: 49.85 },
  { name: "Singapore", lat: 1.29, lon: 103.86 },
  { name: "Austin (COTA)", lat: 30.13, lon: -97.64 },
  { name: "Mexico City", lat: 19.4, lon: -99.09 },
  { name: "São Paulo", lat: -23.7, lon: -46.7 },
  { name: "Las Vegas", lat: 36.11, lon: -115.17 },
  { name: "Lusail", lat: 25.49, lon: 51.45 },
  { name: "Abu Dhabi", lat: 24.47, lon: 54.6 },
]

/** The race the game runs: the 2027 United States Grand Prix at the Circuit of the Americas. */
export const FINALE = {
  name: "Austin (Circuit of the Americas)",
  race: "Austin, Texas 2027 Grand Prix",
  lat: 30.13,
  lon: -97.64,
  laps: 56,
  lapKm: 5.513,
  turns: 20,
}

export function greatCircleKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* ------------------------------------------------------------------ OEM partners */

/**
 * OEM partners. List-price ladder rebased to Supermicro = 1.00 (Dell and Lenovo 1.15, HPE 1.18,
 * NVIDIA DGX 1.35), support as a share of hardware a year, and lead-time deltas in weeks, from the
 * October 2026 OEM commercial research. `aas` is the OEM's own consumption programme (none for
 * Supermicro). Node power multipliers and CFD tuning are estimates.
 */
export const OEMS = [
  {
    id: "nvidia",
    name: "NVIDIA DGX (reference systems)",
    short: "NVIDIA DGX",
    src: "IND",
    priceMult: 1.35,
    leadDelta: 2,
    airPowerMult: 1.0,
    liquidPowerMult: 1.0,
    supportPct: 0.09,
    cfdMult: 1.0,
    liquidFitDelta: 0,
    nvaieIncluded: true,
    systems: "DGX H100/H200, DGX B200, DGX B300, DGX GB200/GB300 NVL72",
    learn: "The GPU maker's own box: the reference every other design is measured against. List price, the platform's own lead time, NVIDIA Enterprise support. CPU-only CFD nodes come through NVIDIA's partner channel at list.",
  },
  {
    id: "dell",
    name: "Dell Technologies PowerEdge",
    short: "Dell",
    src: "IND",
    priceMult: 1.15,
    leadDelta: -1,
    airPowerMult: 1.02,
    liquidPowerMult: 0.98,
    supportPct: 0.06,
    cfdMult: 1.0,
    liquidFitDelta: 0,
    aas: { name: "Dell APEX", monthlyPct: 0.032, committed: 0.75 },
    systems: "PowerEdge XE9680 / XE9680L, XE9712 (NVL72), XE9780/XE9785, XE7745",
    learn: "A large OEM: about 3% under list and a week sooner (estimate), global ProSupport, and a 21-inch rack-scale liquid design for NVL72.",
  },
  {
    id: "supermicro",
    name: "Supermicro",
    short: "Supermicro",
    src: "IND",
    priceMult: 1.0,
    leadDelta: -3,
    airPowerMult: 1.06,
    liquidPowerMult: 1.03,
    supportPct: 0.04,
    cfdMult: 1.0,
    liquidFitDelta: -3,
    systems: "SYS-821GE / AS-8125GS (HGX), SYS-A21GE (B200), SRS-GB200-NVL72 with in-rack 250 kW CDU",
    learn: "A volume OEM: about 5% under list and two weeks sooner. Its NVL72 rack brings its own coolant distribution unit, so the hall only needs facility water: a shorter liquid fit-out. Nodes draw a little more power.",
  },
  {
    id: "hpe",
    name: "HPE (Cray XD / ProLiant XD)",
    short: "HPE",
    src: "IND",
    priceMult: 1.18,
    leadDelta: 1,
    airPowerMult: 1.04,
    liquidPowerMult: 0.97,
    supportPct: 0.07,
    cfdMult: 1.04,
    liquidFitDelta: 0,
    aas: { name: "HPE GreenLake Flex", monthlyPct: 0.033, committed: 0.8 },
    aasAi: { name: "HPE Private Cloud AI", monthlyPct: 0.035, committed: 0.8, nvaieIncluded: true },
    systems: "HPE Cray XD670, ProLiant Compute XD685, GB200 NVL72",
    learn: "An HPC OEM: about 3% over list and a week later, but direct-liquid options that cut node power and an HPC software stack tuned for MPI CFD (PODIUM: +4% CFD scaling).",
  },
  {
    id: "lenovo",
    name: "Lenovo ThinkSystem (Neptune liquid)",
    short: "Lenovo",
    src: "IND",
    priceMult: 1.15,
    leadDelta: 1,
    airPowerMult: 1.03,
    liquidPowerMult: 0.96,
    supportPct: 0.06,
    cfdMult: 1.02,
    liquidFitDelta: 0,
    heatReuseReady: true,
    aas: { name: "Lenovo TruScale", monthlyPct: 0.031, committed: 0.75 },
    systems: "ThinkSystem SR780a V3 (hybrid liquid), SR675 V3, SC777 V4 (every tray on water)",
    learn: "An HPC OEM: about 2% over list and a week later. Warm-water Neptune cooling puts every tray on water, so almost no fans and heat that is warm enough to reuse (PODIUM: heat-reuse credit +25%).",
  },
]

/* ------------------------------------------------------------------ CPU nodes for CFD */

/**
 * Two-socket CFD nodes (estimates; these CPUs also appear as GPU hosts: Intel
 * Xeon 6, AMD EPYC 9005 and NVIDIA Grace). FP64 ops per clock from the core designs: Zen 5 and
 * Xeon P-cores run two 512-bit FMAs (32 DP FLOPs/clk), Zen 4 double-pumps 256-bit (16), Neoverse V2
 * has four 128-bit FMAs (16). Memory bandwidth is the theoretical per-socket figure. Prices and
 * node power are estimates.
 */
export const CPUS = [
  {
    id: "epyc9575f",
    name: "AMD EPYC 9575F",
    vendor: "AMD",
    arch: "Zen 5, 64 cores",
    src: "PODIUM",
    coresPerSocket: 64,
    sockets: 2,
    baseGHz: 3.3,
    boostGHz: 5.0,
    fp64PerClk: 32,
    memBW: 614,
    memKind: "DDR5-6400, 12 channels",
    cacheFactor: 1.0,
    nodeKW: 1.3,
    nodePrice: 42_000,
    learn: "High clocks and full AVX-512: huge peak FLOPS per core. CFD is memory-bound, so most of that peak sits idle, and the FIA bills the peak.",
  },
  {
    id: "epyc9684x",
    name: "AMD EPYC 9684X (3D V-Cache)",
    vendor: "AMD",
    arch: "Zen 4 + 1.1 GB L3, 96 cores",
    src: "PODIUM",
    coresPerSocket: 96,
    sockets: 2,
    baseGHz: 2.55,
    boostGHz: 3.7,
    fp64PerClk: 16,
    memBW: 461,
    memKind: "DDR5-4800, 12 channels + 1.1 GB stacked cache",
    cacheFactor: 1.9,
    nodeKW: 1.0,
    nodePrice: 46_000,
    learn: "A huge stacked cache keeps CFD mesh blocks on-chip (game: 1.9× effective bandwidth). Lower peak FLOPS per core, so each core-hour costs fewer MAUh.",
  },
  {
    id: "xeon6980p",
    name: "Intel Xeon 6980P",
    vendor: "Intel",
    arch: "Granite Rapids, 128 cores",
    src: "PODIUM",
    coresPerSocket: 128,
    sockets: 2,
    baseGHz: 2.0,
    boostGHz: 3.9,
    fp64PerClk: 32,
    memBW: 844,
    memKind: "MRDIMM-8800, 12 channels",
    cacheFactor: 1.0,
    nodeKW: 1.25,
    nodePrice: 60_000,
    learn: "The most cores and the fastest DIMMs, but bandwidth is shared by 128 cores, so each core starves on a CFD mesh.",
  },
  {
    id: "xeonmax9480",
    name: "Intel Xeon CPU Max 9480 (HBM)",
    vendor: "Intel",
    arch: "Sapphire Rapids + 64 GB HBM2e, 56 cores",
    src: "PODIUM",
    coresPerSocket: 56,
    sockets: 2,
    baseGHz: 1.9,
    boostGHz: 3.5,
    fp64PerClk: 32,
    memBW: 1000,
    memKind: "64 GB HBM2e per socket (declare HBM in the FIA manifest, 2.3)",
    cacheFactor: 1.0,
    nodeKW: 0.9,
    nodePrice: 44_000,
    learn: "HBM on a CPU: about 1 TB/s per socket for only 56 cores. The best bandwidth per core on the board. HBM must be declared in the annual hardware manifest (FIA 2.3).",
  },
  {
    id: "grace",
    name: "NVIDIA Grace CPU Superchip",
    vendor: "NVIDIA",
    arch: "2 × 72 Arm Neoverse V2",
    src: "PODIUM",
    coresPerSocket: 72,
    sockets: 2,
    baseGHz: 3.1,
    boostGHz: 3.4,
    fp64PerClk: 16,
    memBW: 500,
    memKind: "LPDDR5X, ~1 TB/s per superchip",
    cacheFactor: 1.0,
    nodeKW: 0.75,
    nodePrice: 36_000,
    learn: "Arm cores with LPDDR5X: modest peak, solid bandwidth, the lowest power per node. The same Grace CPU that hosts the GPUs inside NVL72 racks.",
  },
]

/** FIA 2.1: turbo must be locked by BIOS/firmware or billed at absolute max boost. */
export const CLOCKS = [
  { id: "turbo", name: "Turbo unlocked", src: "FIA", lock: null, powerMult: 1.12, learn: "Cores boost when they can, so the FIA bills every core-hour at the absolute maximum boost clock (FIA 2.1). Memory-bound CFD barely goes faster." },
  { id: "base", name: "Locked at base clock", src: "FIA", lock: 1.0, powerMult: 1.0, learn: "BIOS-locked at base: billed at the base clock (FIA 2.1)." },
  { id: "lock85", name: "Throttled to 85% of base", src: "FIA", lock: 0.85, powerMult: 0.86, learn: "Firmware locks the clock 15% under base. Peak FLOPS billed drops 15%; a memory-bound solver loses almost nothing. More cores are needed to spend the allocation in time." },
  { id: "lock70", name: "Throttled to 70% of base", src: "FIA", lock: 0.7, powerMult: 0.72, learn: "A deep clock lock: 30% fewer MAUh per core-hour. Turnaround slows unless the cluster grows." },
]

export const CLUSTER_NODES = [1, 2, 4, 8, 12, 16, 24]

/** How the aero programme spends its MAUh (FIA 2.2 normalisation is the whole lesson). */
export const SOLVERS = [
  { id: "cpu", name: "CPU RCFD only", src: "FIA", learn: "Classic: every MAUh is spent by the CPU cluster's MPI solver." },
  {
    id: "surrogate",
    name: "CPU RCFD + GPU AI surrogate pre-screen",
    src: "FIA",
    share: 0.15,
    learn: "15% of the MAUh runs an AI surrogate on your GPUs that pre-screens geometry ideas, so the CPU cluster only meshes the promising ones. FIA 2.2 bills the GPU at its FP64 peak even though the surrogate runs in FP8/FP4, so a GPU with small FP64 is cheap to bill.",
  },
  {
    id: "gpu",
    name: "GPU-native FP32 CFD solver",
    src: "FIA",
    learn: "Run the whole RCFD solver in FP32 on the GPUs. FIA 2.2 bills the hardware's FP64 peak, so on a GPU with tiny FP64 this is a loophole. Expect a Technical Directive at the ATP 4 reset (30 June) that bills it at FP32 peak; from then the CPU cluster carries the programme.",
  },
]

/** FIA 2.5: RATG discipline. */
export const GEOMETRY = [
  { id: "free", name: "Free iteration on sub-models", src: "FIA", opex: 0, factor: 0.82, learn: "Engineers tweak extracted sub-models freely. Any topological edit becomes a new RATG (FIA 2.5), so the geometry cap runs out before the MAUh do." },
  { id: "disciplined", name: "PLM-governed sub-model reuse", src: "FIA", opex: 350_000, factor: 1.0, learn: "PLM tooling keeps extracted sub-model boundaries identical so they are free (FIA 2.5), and logs every new RATG. $350k a year of licences and process (estimate)." },
]

/* ------------------------------------------------------------------ AI & strategy platforms */

/**
 * Accelerator platforms. Memory, bandwidth and FP64/FP32 peaks are rounded public datasheet figures
 * (Blackwell Ultra cut FP64 to ~1.3 TFLOPS). `capex` is a Supermicro-base rack price (the OEM ladder
 * multiplies it), `cloudRate` a one-year neocloud reservation in $/GPU-hour, `burstRate` the AWS
 * EC2 Capacity Block rate for a 72-hour race-weekend block. Tokens per GPU are teaching estimates.
 */
export const PLATFORMS = [
  { id: "spark", name: "DGX Spark shelf", tag: "DESKTOP AI BOX", src: "IND", gpu: "GB10", gpusPerRack: 16, hbmGB: 128, hbmTBs: 0.273, pflops: 0.5, rackKW: 3, cooling: "air", tokPerGpu: 100, capex: 64_000, leadWeeks: 6, fp64TF: 0.5, fp32TF: 31, cloudRate: null, learn: "Sixteen desktop GB10 boxes: 128 GB of unified memory each but 273 GB/s, so a few tokens a second. A developer's box, not a race-weekend strategy engine." },
  { id: "l40s", name: "L40S Server ×2", tag: "BUDGET PCIE", src: "IND", gpu: "L40S", gpusPerRack: 16, hbmGB: 48, hbmTBs: 0.864, pflops: 0.73, rackKW: 9, cooling: "air", tokPerGpu: 750, capex: 160_000, leadWeeks: 3, fp64TF: 1.4, fp32TF: 91, cloudRate: 1.2, learn: "PCIe cards with 48 GB of GDDR6 and no NVLink: cheap and in stock, slow per GPU." },
  { id: "rtx6000", name: "RTX PRO 6000 Server ×2", tag: "BUDGET BLACKWELL", src: "IND", gpu: "RTX PRO 6000 Blackwell", gpusPerRack: 16, hbmGB: 96, hbmTBs: 1.6, pflops: 2, rackKW: 14, cooling: "air", tokPerGpu: 2200, capex: 240_000, leadWeeks: 3, fp64TF: 1.9, fp32TF: 120, cloudRate: 1.8, learn: "Blackwell on a PCIe card, 96 GB GDDR7, FP4. A fifth of an HGX rack's price per GPU; fine for small models." },
  { id: "h100", name: "HGX H100 ×2", tag: "THE CLASSIC", src: "IND", gpu: "H100 SXM", gpusPerRack: 16, hbmGB: 80, hbmTBs: 3.35, pflops: 2, rackKW: 22, cooling: "air", tokPerGpu: 3000, capex: 600_000, leadWeeks: 6, fp64TF: 67, fp32TF: 67, cloudRate: 3.0, burstRate: 5.97, learn: "The GPU that started the AI boom. Big FP64 (67 TFLOPS tensor), so the FIA bills it heavily for any aero work (datasheet)." },
  { id: "h200", name: "HGX H200 ×2", tag: "MORE MEMORY", src: "IND", gpu: "H200", gpusPerRack: 16, hbmGB: 141, hbmTBs: 4.8, pflops: 2, rackKW: 22, cooling: "air", tokPerGpu: 4200, capex: 680_000, leadWeeks: 8, fp64TF: 67, fp32TF: 67, cloudRate: 3.8, burstRate: 6.87, learn: "Hopper with 141 GB HBM3e: much faster inference, same FP64 bill (datasheet)." },
  { id: "b200", name: "HGX B200 ×2", tag: "FP4 POWER", src: "IND", gpu: "B200", gpusPerRack: 16, hbmGB: 180, hbmTBs: 8, pflops: 9, rackKW: 30, cooling: "air", tokPerGpu: 11000, capex: 850_000, leadWeeks: 10, fp64TF: 37, fp32TF: 75, cloudRate: 6.0, burstRate: 14.21, learn: "Blackwell with FP4: roughly double Hopper's tokens. 30 kW a rack: too hot for open air." },
  { id: "b300", name: "HGX B300 ×2", tag: "BEST ON AIR", src: "IND", gpu: "B300", gpusPerRack: 16, hbmGB: 288, hbmTBs: 8, pflops: 14, rackKW: 30, cooling: "air", tokPerGpu: 15000, capex: 1_200_000, leadWeeks: 12, fp64TF: 1.3, fp32TF: 75, cloudRate: 7.5, burstRate: 16.15, learn: "Blackwell Ultra: 288 GB a GPU and FP4. FP64 was cut to ~1.3 TFLOPS, so under FIA 2.2 its aero work is billed at almost nothing (datasheet)." },
  { id: "b300n", name: "HGX B300 node ×1", tag: "ONE BLACKWELL NODE", src: "IND", gpu: "B300", gpusPerRack: 8, hbmGB: 288, hbmTBs: 8, pflops: 14, rackKW: 15, cooling: "air", tokPerGpu: 15000, capex: 600_000, leadWeeks: 12, fp64TF: 1.3, fp32TF: 75, cloudRate: 7.5, burstRate: 16.15, learn: "One 8-GPU Blackwell Ultra node: half a rack's price for a smaller job." },
  { id: "gb200", name: "GB200 NVL72", tag: "72 GPUS AS ONE", src: "IND", gpu: "B200 + Grace", gpusPerRack: 72, hbmGB: 186, hbmTBs: 8, pflops: 10, rackKW: 132, cooling: "liquid", tokPerGpu: 12500, capex: 3_200_000, leadWeeks: 16, fp64TF: 45, fp32TF: 80, cloudRate: 8.5, burstRate: 10.58, learn: "72 GPUs on one NVLink domain, 132 kW a rack, liquid only." },
  { id: "gb300", name: "GB300 NVL72", tag: "REASONING RACK", src: "IND", gpu: "B300 + Grace", gpusPerRack: 72, hbmGB: 288, hbmTBs: 8, pflops: 15, rackKW: 142, cooling: "liquid", tokPerGpu: 17500, capex: 4_800_000, leadWeeks: 20, fp64TF: 1.3, fp32TF: 80, cloudRate: 10, burstRate: 12.5, learn: "Blackwell Ultra NVL72, 142 kW, liquid only, a 20-week lead." },
  { id: "vr", name: "Vera Rubin NVL72", tag: "HBM4 NEXT GEN", src: "IND", gpu: "Rubin + Vera", gpusPerRack: 72, hbmGB: 288, hbmTBs: 20, pflops: 35, rackKW: 210, cooling: "liquid", tokPerGpu: 42000, capex: 6_500_000, leadWeeks: 30, fp64TF: 30, fp32TF: 120, cloudRate: 12, learn: "HBM4, the most tokens per watt, ~210 kW a rack (estimate), a 30-week lead and scarce supply." },
  {
    id: "tpu",
    name: "Hyperscaler custom accelerator (cloud)",
    tag: "CUSTOM SILICON · CLOUD",
    src: "PODIUM",
    custom: true,
    cloudOnly: true,
    gpu: "TPU / Trainium-class ASIC",
    gpusPerRack: 16,
    hbmGB: 96,
    hbmTBs: 3,
    pflops: 4,
    rackKW: 0,
    cooling: "none",
    tokPerGpu: 6000,
    capex: 0,
    leadWeeks: 2,
    fp64TF: null,
    fp32TF: null,
    cloudRate: 1.9,
    portNre: 300_000,
    learn: "A cloud provider's own inference silicon, rented by the chip-hour: H200-class tokens for about 60% of the price (estimate). No FP64, so no aero work; porting the strategy models costs about $300k of engineering, and you are tied to one cloud. All 100% OpEx under the cost cap (FIA 1.1).",
  },
  {
    id: "asic",
    name: "Partner ASIC derivative (board + firmware)",
    tag: "CUSTOM SILICON · PARTNER",
    src: "PODIUM",
    custom: true,
    buyOnly: true,
    gpu: "Partner inference ASIC, team board and firmware",
    gpusPerRack: 32,
    hbmGB: 64,
    hbmTBs: 4,
    pflops: 6,
    rackKW: 16,
    cooling: "air",
    tokPerGpu: 9000,
    capex: 800_000,
    nre: 6_000_000,
    leadWeeks: 44,
    slipRisk: 0.3,
    slipWeeks: 16,
    fp64TF: null,
    fp32TF: null,
    cloudRate: null,
    learn: "A silicon partner's existing inference chip on a board and firmware tuned for your strategy models: about twice a B300's tokens per watt. $4–8M of engineering (game: $6M) plus $0.8M a rack, 34–52 weeks (game: 44), and a 30% chance it slips 16 weeks. It runs nothing else.",
  },
  {
    id: "custom",
    name: "True custom silicon (own tape-out)",
    tag: "CUSTOM SILICON · TAPE-OUT",
    src: "PODIUM",
    custom: true,
    buyOnly: true,
    gpu: "Team-designed 3 nm accelerator",
    gpusPerRack: 32,
    hbmGB: 96,
    hbmTBs: 6,
    pflops: 10,
    rackKW: 18,
    cooling: "air",
    tokPerGpu: 14000,
    capex: 1_000_000,
    nre: 150_000_000,
    leadWeeks: 130,
    slipRisk: 0.5,
    slipWeeks: 26,
    fp64TF: null,
    fp32TF: null,
    cloudRate: null,
    learn: "Your own chip: a $150M+ programme and 2–4 years to first silicon (game: 130 weeks). It cannot arrive this season and no team's CapEx can carry it. That is the lesson: custom silicon is a hyperscaler game.",
  },
]

export const AI_RACKS = [0, 1, 2, 3, 4, 6, 8]

/**
 * Memory and interconnect facts per platform (PODIUM, rounded from public datasheets): which HBM
 * configurations each accelerator is sold with, the high-speed domain a model can be sharded across
 * (NVLink 8 in HGX, 72 in NVL72; PCIe cards have none), and which number formats run natively.
 */
const PLATFORM_MEMORY = {
  spark: { nvlink: 1, memKind: "LPDDR5X unified", hbmTiers: [], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  l40s: { nvlink: 1, memKind: "GDDR6", hbmTiers: [], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  rtx6000: { nvlink: 1, memKind: "GDDR7", hbmTiers: [], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  h100: { nvlink: 8, memKind: "HBM3", hbmTiers: ["hbm80", "hbm141"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  h200: { nvlink: 8, memKind: "HBM3e", hbmTiers: ["hbm141"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  b200: { nvlink: 8, memKind: "HBM3e", hbmTiers: ["hbm192", "hbm288"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  b300: { nvlink: 8, memKind: "HBM3e 12-high", hbmTiers: ["hbm288"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  b300n: { nvlink: 8, memKind: "HBM3e 12-high", hbmTiers: ["hbm288"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  gb200: { nvlink: 72, memKind: "HBM3e", hbmTiers: ["hbm192", "hbm288"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  gb300: { nvlink: 72, memKind: "HBM3e 12-high", hbmTiers: ["hbm288"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  vr: { nvlink: 72, memKind: "HBM4", hbmTiers: ["hbm288"], precisions: ["fp64", "fp32", "bf16", "fp8", "int8"] },
  tpu: { nvlink: 16, memKind: "HBM (cloud)", hbmTiers: ["hbm80", "hbm141", "hbm192"], precisions: ["bf16", "fp8", "int8"] },
  asic: { nvlink: 8, memKind: "HBM3e (partner)", hbmTiers: ["hbm80", "hbm141", "hbm192", "hbm288"], precisions: ["fp8", "int8"] },
  custom: { nvlink: 8, memKind: "HBM3e (custom)", hbmTiers: ["hbm80", "hbm141", "hbm192", "hbm288"], precisions: ["fp8", "int8"] },
}
for (const platform of PLATFORMS) Object.assign(platform, PLATFORM_MEMORY[platform.id])

/**
 * Strategy-model size. Tokens are relative to a 70B-class model (the industry throughput figures);
 * accuracy scales the strategy calls; inference latency adds to the pit-wall decision loop.
 * For the CFD surrogate, a bigger model screens fewer designs per GPU-hour but ranks them better.
 */
export const MODEL_SIZES = [
  { id: "7b", name: "7B-class distilled model", src: "PODIUM", params: 7, tok: 5, acc: 0.82, kvGB: 6, inferMs: 12, surrogateCost: 0.3, surrogateAcc: 0.75, learn: "Small and quick: about five times the tokens of a 70B model on the same GPU and ~12 ms an answer, but it misses subtle tyre and weather interactions (≈18% weaker strategy calls)." },
  { id: "70b", name: "70B-class model", src: "PODIUM", params: 70, tok: 1, acc: 1, kvGB: 40, inferMs: 45, surrogateCost: 1, surrogateAcc: 1, learn: "The workhorse: good race reasoning, ~45 ms an answer. 140 GB of weights in BF16, 70 GB in FP8: it needs sharding on 80 GB parts." },
  { id: "400b", name: "400B-class frontier model", src: "PODIUM", params: 400, tok: 0.2, acc: 1.08, kvGB: 120, inferMs: 140, surrogateCost: 4, surrogateAcc: 1.12, learn: "The sharpest calls (+8%), but a fifth of the tokens per GPU, ~140 ms an answer and 400 GB of weights even in FP8: it needs a big NVLink domain or it spills." },
]

/**
 * Number format for weights and activations. Speed is relative to FP8 (the format the token
 * figures assume). FIA 2.2 bills every GPU-hour at FP64 peak whatever format it runs, so a lower
 * precision never lowers the MAUh bill; it changes how much work each billed hour does and how much
 * memory the model needs.
 */
export const PRECISIONS = [
  { id: "fp64", name: "FP64 weights", src: "FIA", bytes: 8, speed: 0.04, acc: 1, kvBytes: 8, learn: "Double precision everywhere: the format the FIA bills at, so it feels 'honest', but tensor cores barely run it. 8 bytes a parameter and about a twenty-fifth of the speed: no accuracy gain for inference." },
  { id: "fp32", name: "FP32 weights", src: "PODIUM", bytes: 4, speed: 0.15, acc: 1, kvBytes: 4, learn: "Training-style full precision: 4 bytes a parameter (a 70B model is 280 GB) and roughly a seventh of FP8 speed. Same MAUh bill as FP8." },
  { id: "bf16", name: "BF16 weights", src: "PODIUM", bytes: 2, speed: 0.6, acc: 1, kvBytes: 2, learn: "The standard serving format: 2 bytes a parameter, no measurable accuracy loss, about 60% of FP8 speed." },
  { id: "fp8", name: "FP8 quantised", src: "PODIUM", bytes: 1, speed: 1, acc: 0.985, kvBytes: 1, learn: "Hopper, Blackwell and Rubin run FP8 natively: half the memory of BF16, the fastest tokens, ~1.5% accuracy loss after calibration. The FIA still bills the GPU at FP64 peak." },
  { id: "int8", name: "INT8 quantised", src: "PODIUM", bytes: 1, speed: 0.95, acc: 0.97, kvBytes: 1, learn: "Integer weights: the native format of most custom inference silicon. Same memory as FP8, a little more accuracy loss (~3%) unless the model was trained for it." },
]

/** HBM configurations (PODIUM prices per accelerator, datasheet capacities and bandwidths). */
export const HBM_TIERS = [
  { id: "hbm80", name: "80 GB HBM3", src: "PODIUM", gb: 80, tbs: 3.35, perGpu: 0, step: 0, learn: "H100-class memory: 3.35 TB/s. A 70B model only fits in FP8; KV cache for long race contexts spills." },
  { id: "hbm141", name: "141 GB HBM3e", src: "PODIUM", gb: 141, tbs: 4.8, perGpu: 6_000, step: 1, learn: "H200-class: 76% more capacity and 43% more bandwidth, so decode-bound inference runs ~1.3× faster on the same GPU core (+$6k a GPU, estimate)." },
  { id: "hbm192", name: "192 GB HBM3e", src: "PODIUM", gb: 192, tbs: 8, perGpu: 12_000, step: 2, learn: "Blackwell-class 8-high stacks at 8 TB/s: a 70B model in BF16 plus its KV cache on one GPU (+$12k a GPU, estimate)." },
  { id: "hbm288", name: "288 GB HBM3e 12-high", src: "PODIUM", gb: 288, tbs: 8, perGpu: 20_000, step: 3, learn: "Blackwell Ultra / Rubin-class 12-high stacks: room for long contexts and big models without sharding; more watts and the most expensive memory (+$20k a GPU, estimate)." },
]

/** NVIDIA AI Enterprise list price per GPU a year (included with DGX and HPE Private Cloud AI). */
export const NVAIE_PER_GPU = 4_500
/** Cloud egress a year: hyperscalers bill ~$0.09/GB; neoclouds are typically free. */
export const CLOUD_EGRESS = { hyperscaler: 30_000, neocloud: 0 }
/** AWS-style Capacity Blocks for the race weekends only: 24 weekends × 72 hours. */
export const BURST_HOURS = 24 * 72

/** Strategy, telemetry analytics and engineering agents on a race weekend (PODIUM demand). */
export const AI_DEMAND_TOKS = 180_000

export const DEPLOYMENTS = [
  { id: "buy", name: "Buy (CapEx)", src: "FIA", learn: "Owned hardware counts against the rolling 4-year CapEx envelope (FIA 1.2). Power, space and support are OpEx." },
  { id: "lease", name: "Lease (OpEx)", src: "FIA", leasePct: 0.32, learn: "Leased servers are billed operationally, so 100% counts against the $215M OpEx cap (FIA 1.1): about 32% of the price a year (estimate). Saves CapEx; costs cap space." },
  { id: "cloud", name: "Cloud GPUs (OpEx)", src: "FIA", learn: "Rented cloud instances (AWS, Azure, Google Cloud, Oracle Cloud, IBM Cloud) are 100% OpEx (FIA 1.1). No power, cooling or lead time of your own; a one-year reservation at a game rate card." },
]

/** GPU power caps: inference is memory-bound, so a lower board power loses little speed. PODIUM. */
export const TGP_MODES = [
  { id: "eco70", name: "Power-capped 70%", src: "PODIUM", perf: 0.8, power: 0.7, learn: "Cap board power at 70%: about 80% of the tokens for 70% of the watts." },
  { id: "eco85", name: "Power-capped 85%", src: "PODIUM", perf: 0.93, power: 0.85, learn: "The sweet spot for inference: about 93% of the tokens for 85% of the watts." },
  { id: "std", name: "Standard TGP", src: "PODIUM", perf: 1.0, power: 1.0, learn: "Datasheet board power." },
  { id: "boost", name: "Push: max boost", src: "PODIUM", perf: 1.06, power: 1.15, needsLiquid: true, learn: "Raise power limits and clocks: +6% tokens for +15% watts, and hot spots. Without liquid or immersion cooling the racks throttle and fail more often." },
]

/** ORCA PT-3: photonic quantum accelerator at Digital Realty London (LHR19). */
export const ORCA = {
  id: "orca",
  name: "ORCA PT-3 photonic quantum accelerator",
  src: "IND",
  capex: 5_000_000,
  kw: 6,
  leadWeeks: 14,
  space: 2,
  boost: 0.1,
  learn: "Photonic boson sampling at room temperature in two cabinets beside the GPUs; one is installed at Digital Realty's London Innovation Lab (LHR19). Here it samples pit-strategy permutations (game extension: up to +10% strategy quality beside the GPUs in London, less over a remote link).",
}

/* ------------------------------------------------------------------ data centre, power, cooling */

/**
 * Locations: Digital Realty PlatformDIGITAL metros. Colocation $/kW-month are CBRE Global Data
 * Center Trends 2026 asking rents (H2 2025, 250–500 kW wholesale); energy $/MWh and block ladders are
 * estimates. Liquid-ready space carries a 15% premium (applied in the model).
 */
export const LOCATIONS = [
  { id: "lon", name: "London (Digital Realty)", src: "IND", lat: 51.51, lon: -0.13, mwh: 165, kwMonth: 213, blocksMW: [0.25, 0.5, 1], liquidWeeks: 0, orcaLocal: true, learn: "80 km from the factory, home of the London Innovation Lab with ORCA and 150 kW+ liquid racks. Dear, tight power." },
  { id: "ams", name: "Amsterdam (Digital Realty)", src: "IND", lat: 52.37, lon: 4.9, mwh: 115, kwMonth: 180, blocksMW: [0.5, 1, 2], liquidWeeks: 3, learn: "Cheaper power, a short sea crossing; liquid halls take three extra weeks." },
  { id: "fra", name: "Frankfurt (Digital Realty)", src: "IND", lat: 50.11, lon: 8.68, mwh: 140, kwMonth: 250, blocksMW: [0.25, 0.5, 1, 2], liquidWeeks: 0, learn: "Europe's interconnection hub, mid-price power." },
  { id: "par", name: "Paris (Digital Realty)", src: "IND", lat: 48.86, lon: 2.35, mwh: 95, kwMonth: 190, blocksMW: [0.5, 1, 2, 3], liquidWeeks: 0, learn: "Nuclear power: the cheapest big European market." },
  { id: "iad", name: "Ashburn (Digital Realty)", src: "IND", lat: 39.04, lon: -77.49, mwh: 78, kwMonth: 173, blocksMW: [0.25, 0.5, 1, 2], liquidWeeks: 0, learn: "Cheap power and every cloud on-ramp, but a transatlantic hop from the factory." },
  { id: "dfw", name: "Dallas (Digital Realty)", src: "IND", lat: 32.78, lon: -96.8, mwh: 62, kwMonth: 173, blocksMW: [0.25, 0.5, 1, 2], liquidWeeks: 0, learn: "The cheapest power on the board, big blocks only, far from Europe and the Middle East." },
  { id: "onprem", name: "Factory server room (on-prem)", src: "PODIUM", lat: 51.75, lon: -1.26, mwh: 170, kwMonth: 0, blocksMW: [0.15, 0.25, 0.35], liquidWeeks: 20, liquidRetrofit: 400_000, puePenalty: 0.22, onprem: true, learn: "Your own room: no colocation fee, but a legacy plant (+0.22 PUE), 0.35 MW at most, and a 20-week, $400k retrofit for liquid (estimates)." },
]

/**
 * Halls: rack cap kW, rack positions, fit-out weeks, per-rack kit and PUE (air PUE 1.38 is Digital
 * Realty's published portfolio figure; the rest are estimates). Rear-door $25–35k a rack, direct-to-chip
 * manifold and CDU share ~$45k a rack, immersion tanks $60–80k (OEM commercial research).
 */
export const HALLS = [
  { id: "A", name: "Open air hall", src: "IND", cooling: "air", maxRackKW: 15, rackSpace: 24, fitOutWeeks: 0, rackNrc: 0, pue: 1.38, learn: "Ready now, ~15 kW a rack, PUE 1.38 (Digital Realty's published portfolio figure)." },
  { id: "C", name: "Cold aisle containment", src: "IND", cooling: "air", maxRackKW: 30, rackSpace: 22, fitOutWeeks: 2, rackNrc: 0, pue: 1.29, learn: "Doors and panels split cold and hot air: 15–30 kW a rack, two-week fit-out, PUE 1.29( DOE FEMP and Schneider Electric WP135 bands)." },
  { id: "I", name: "In-row coolers", src: "IND", cooling: "air", maxRackKW: 55, rackSpace: 20, fitOutWeeks: 4, rackNrc: 15_000, pue: 1.32, learn: "Close-coupled coolers between racks: ~55 kW a rack, $12k a rack, four weeks." },
  { id: "R", name: "Rear-door heat exchangers", src: "IND", cooling: "air", maxRackKW: 70, rackSpace: 18, fitOutWeeks: 6, rackNrc: 30_000, pue: 1.28, learn: "A water coil on each rack's back door (Motivair, Vertiv, nVent class): 40–70 kW a rack of air-cooled servers, $35k a rack, six weeks for chilled water." },
  { id: "L", name: "Direct-to-chip liquid", src: "IND", cooling: "liquid", maxRackKW: 240, rackSpace: 12, fitOutWeeks: 10, rackNrc: 45_000, pue: 1.2, learn: "Cold plates on every chip: up to 240 kW a rack, the only home for NVL72 and Vera Rubin, a 10-week fit-out, PUE 1.20." },
  { id: "X", name: "Single-phase immersion tanks", src: "PODIUM", cooling: "immersion", maxRackKW: 100, rackSpace: 14, fitOutWeeks: 12, rackNrc: 70_000, pue: 1.07, noRackScale: true, learn: "Servers sink in dielectric fluid: ~100 kW a tank, PUE ~1.07, $60k a tank, 12 weeks (estimates). NVL72 racks are not built for tanks, and OEM warranties need sign-off: a small reliability risk." },
]

/** 10–20% power headroom is green; under 10% trips on a hot day; short throttles. */
export const POWER_HEADROOM = { tripBelow: 0.1, wasteAbove: 0.35 }

export const HEAT_REUSE = {
  id: "heat",
  name: "Heat reuse to district heating",
  src: "PODIUM",
  capex: 250_000,
  creditPerKWYear: 175,
  learn: "Liquid and immersion loops run warm enough to sell heat: about $175 per kW of IT a year back as an OpEx credit (estimate), $250k of heat exchangers. Not possible on air.",
}

/* ------------------------------------------------------------------ storage & data */

/** FIA 2.3: parallel file systems must record tamper-evident metadata. PODIUM prices. */
export const PFS = [
  { id: "lustre", name: "Lustre (appliance)", src: "PODIUM", capexPerPB: 380_000, opexPerPB: 40_000, auditNrc: 60_000, kwPerPB: 6, io: 1.0, tamper: true, learn: "Open-source parallel FS on an appliance; changelogs plus an audit module give tamper-evident metadata (FIA 2.3)." },
  { id: "scale", name: "IBM Storage Scale (GPFS)", src: "PODIUM", capexPerPB: 450_000, opexPerPB: 70_000, auditNrc: 0, kwPerPB: 6, io: 1.03, tamper: true, learn: "Immutable filesets and file audit logging built in; the strongest metadata performance. Licences are OpEx." },
  { id: "beegfs", name: "BeeGFS", src: "PODIUM", capexPerPB: 300_000, opexPerPB: 30_000, auditNrc: 80_000, kwPerPB: 5, io: 0.97, tamper: true, learn: "Lean and cheap; tamper-evident metadata needs an add-on and engineering time." },
  { id: "nas", name: "Scale-out NAS (NFS)", src: "PODIUM", capexPerPB: 250_000, opexPerPB: 25_000, auditNrc: 0, kwPerPB: 5, io: 0.85, tamper: false, learn: "Simple and cheap, but not a parallel file system: CFD I/O stalls, and there is no tamper-evident run metadata for FIA audit (2.3)." },
]
PFS.push({ id: "staas", name: "Storage as a service (Evergreen//One / Keystone class)", src: "IND", capexPerPB: 0, opexPerPB: 500_000, auditNrc: 0, kwPerPB: 0, io: 1.0, tamper: true, staas: true, learn: "A performance-tier parallel file service billed per PB a year ($430–560k/PB-yr at 1–3 PB over 36 months; game: $500k). No CapEx and no power or space of your own, all OpEx, and the vendor refreshes the kit." })
export const PFS_PB = [1, 2, 4]
export const PFS_NEED_PB = 2

export const ARCHIVES = [
  { id: "tape", name: "Tape library (on-prem)", src: "FIA", capex: 220_000, opex: 20_000, compliant: true, learn: "A tape library is named CapEx (FIA 1.2). Cheap to keep run folders for audit for years." },
  { id: "cloud", name: "Cloud archive tier", src: "PODIUM", capex: 0, opex: 90_000, compliant: true, learn: "Cold object storage in the cloud: no CapEx, 100% OpEx, plus retrieval egress during an audit (estimate)." },
  { id: "none", name: "Purge after each ATP", src: "FIA", capex: 0, opex: 0, compliant: false, learn: "Delete run folders to save space. FIA 2.3 requires time-stamped run folders to be retained for audit." },
]

/** Data tiers (kW, CapEx, lead; estimates) for the strategy AI's knowledge store. */
export const DATA_TIERS = [
  { id: "local", name: "Local NVMe only", src: "IND", kw: 0, capex: 0, leadWeeks: 0, grounding: 0.8, learn: "Each server keeps its own drives: free, but the strategy assistant cannot search a decade of race telemetry." },
  { id: "file", name: "File & Object Storage", src: "IND", kw: 12, capex: 400_000, leadWeeks: 6, grounding: 0.93, learn: "Shared telemetry history and model checkpoints ($400k, 12 kW)." },
  { id: "vector", name: "Vector Index Storage", src: "IND", kw: 18, capex: 550_000, leadWeeks: 6, grounding: 1.0, learn: "The assistant embeds the question and finds the right past stints instantly ($550k, 18 kW)." },
]

/** KV cache tier: $250k, 10 kW, 4 weeks (estimate). */
export const KV_TIER = {
  id: "kv",
  name: "KV Cache Tier",
  src: "IND",
  kw: 10,
  capex: 250_000,
  leadWeeks: 4,
  tokMult: 1.18,
  learn: "Parks the GPUs' attention notes so repeat what-if questions skip prefill: strategy sims re-ask the same race state thousands of times (+18% effective throughput is a game value).",
}

/** Host options: Grace host memory $450k 12 kW; BlueField DPU $700k 8 kW. */
export const HOSTS = [
  { id: "standard", name: "Standard hosts", src: "IND", capex: 0, kw: 0, tokMult: 1.0, learn: "Plain x86 hosts beside the GPUs." },
  { id: "grace", name: "Grace CPU host memory", src: "IND", capex: 450_000, kw: 12, tokMult: 1.05, learn: "Park whole long contexts (a full race's telemetry) in CPU memory: $450k, 12 kW." },
  { id: "dpu", name: "BlueField DPUs", src: "IND", capex: 700_000, kw: 8, tokMult: 1.03, isolation: true, learn: "DPUs move data and enforce tenant isolation in hardware: $700k, 8 kW. Here that isolation also hard-separates F1 from sister-company tenants (Article F6)." },
]

/* ------------------------------------------------------------------ networks */

/** Route physics: fibre 4.9 µs/km, route inflation, overhead, jitter, loss. */
export const FIBRE_S_PER_KM = 4.9e-6
export const ROUTE = {
  cross: { inflation: 1.0, overheadS: 0.000005, jitterFrac: 0, loss: 0 },
  fiber: { inflation: 1.2, overheadS: 0, jitterFrac: 0, loss: 0 },
  hollow: { inflation: 1.2 * 0.68, overheadS: 0, jitterFrac: 0, loss: 0 },
  fabric: { inflation: 1.2, overheadS: 0.0003, jitterFrac: 0.02, loss: 0 },
  mcp: { inflation: 1.2, overheadS: 0.0003, jitterFrac: 0.02, loss: 0 },
  eye: { inflation: 1.2, overheadS: 0.003, jitterFrac: 0.05, loss: 0.001 },
  peer: { inflation: 1.5, overheadS: 0.008, jitterFrac: 0.12, loss: 0.002 },
  public: { inflation: 2.4, overheadS: 0.025, jitterFrac: 0.35, loss: 0.005 },
  wave: { inflation: 1.15, overheadS: 0.0002, jitterFrac: 0, loss: 0 },
  mpls: { inflation: 1.4, overheadS: 0.005, jitterFrac: 0.03, loss: 0.0003 },
  sdwan: { inflation: 2.0, overheadS: 0.012, jitterFrac: 0.12, loss: 0.001 },
  leo: { inflation: 1.3, overheadS: 0.03, jitterFrac: 0.25, loss: 0.008 },
}

export function roundTripS(km, routeId) {
  const route = ROUTE[routeId] || ROUTE.fiber
  return 2 * Math.max(0, km) * route.inflation * FIBRE_S_PER_KM + route.overheadS
}

/**
 * WAN products (Digital Realty ServiceFabric 10G port ~$1,200 a month + $1,300 a connection; cross
 * connect $500 + $400/mo; dark fibre $60k + $40k optics + $2,500/mo; transit $3,000/mo; others are
 * estimates). `reach`: whether the product can reach a race circuit (cross connects stay in the
 * building; dark fibre is a metro/regional product).
 */
export const NETWORKS = [
  { id: "fabric", name: "ServiceFabric (Digital Realty)", src: "IND", nrc: 0, mrc: 2_500, leadDays: 15, reachTrack: true, gbps: 10, orcaRetain: 0.7, learn: "Private software-defined interconnection: a 10G port and connections to clouds, partners, metros. 15-day port SLA, connections live in minutes, almost no jitter." },
  { id: "mcp", name: "ServiceFabric MCP (agent-configured)", src: "IND", nrc: 0, mrc: 2_500, leadDays: 15, reachTrack: true, gbps: 10, orcaRetain: 0.7, agentic: true, learn: "The same fabric, configured by an AI agent through Digital Realty's early-access MCP server: same wire and price, and it re-sizes bandwidth between race weekends." },
  { id: "cross", name: "Cross Connect", src: "IND", nrc: 500, mrc: 400, leadDays: 7, reachTrack: false, gbps: 100, orcaRetain: 1, learn: "A physical cable between two cages in one building. Nothing faster, and it cannot leave the building." },
  { id: "fiber", name: "Dark Fiber", src: "IND", nrc: 100_000, mrc: 2_500, leadDays: 84, reachTrack: false, maxKm: 1500, gbps: 100, orcaRetain: 0.55, learn: "Unlit fibre you light with your own optics between your own sites, ≤1,500 km: pure physics delay, 12-week build." },
  { id: "hollow", name: "Hollow-core fibre (photonic)", src: "PODIUM", nrc: 400_000, mrc: 4_000, leadDays: 140, reachTrack: false, maxKm: 300, gbps: 100, orcaRetain: 0.6, photonic: true, learn: "Light travels in air, ~47% faster than in glass: about 32% less delay than dark fibre. ≤300 km, $400k to install, 20 weeks, few suppliers (estimates)." },
  { id: "wave", name: "Optical wavelength (DWDM 100G lambda)", src: "PODIUM", nrc: 50_000, mrc: 9_000, leadDays: 60, reachTrack: false, maxKm: 3000, gbps: 100, orcaRetain: 0.55, photonic: true, learn: "A carrier lights a dedicated 100G colour on its photonic line system: near dark-fibre delay over up to 3,000 km without buying glass, 8-week provisioning (estimates)." },
  { id: "mpls", name: "Carrier MPLS VPN", src: "PODIUM", nrc: 20_000, mrc: 6_500, leadDays: 75, reachTrack: true, gbps: 1, orcaRetain: 0.5, learn: "A private, SLA-backed carrier network: steady latency (1.4× the great circle + 5 ms) and class-of-service, but pricey and a 10-week order. Pair it with encryption for FIA 5.3 (estimates)." },
  { id: "sdwan", name: "SD-WAN over dual Internet (encrypted)", src: "PODIUM", nrc: 15_000, mrc: 2_000, leadDays: 14, reachTrack: true, gbps: 1, orcaRetain: 0.4, encrypted: true, learn: "Encrypted overlay tunnels across two ISPs with per-packet path steering: cheaper than MPLS and quick to deploy, better than raw transit (2.0× + 12 ms, 12% jitter), still Internet underneath (estimates)." },
  { id: "leo", name: "LEO satellite (Starlink-class)", src: "PODIUM", nrc: 4_000, mrc: 900, leadDays: 7, reachTrack: true, gbps: 0.25, medium: "space", orcaRetain: 0.3, learn: "A flat-panel terminal on the garage roof: ~30–50 ms, 250 Mb/s, works at any circuit and shares no ground path with your fibre. A superb diverse backup, too thin to be the primary (estimates)." },
  { id: "peer", name: "Peering at an IX", src: "IND", nrc: 1_000, mrc: 1_800, leadDays: 21, reachTrack: true, gbps: 10, orcaRetain: 0.4, learn: "Hand traffic straight to other networks at an exchange: shorter than transit, still shared, 12% jitter." },
  { id: "eye", name: "Eyeball-adjacent hand-off", src: "IND", nrc: 2_000, mrc: 2_000, leadDays: 28, reachTrack: true, gbps: 10, orcaRetain: 0.45, learn: "Private hand-offs next to the ISPs: steadier than transit, not as quick as ServiceFabric." },
  { id: "public", name: "Public Internet transit", src: "IND", nrc: 1_000, mrc: 3_000, leadDays: 21, reachTrack: true, gbps: 1, orcaRetain: 0.35, learn: "ISP transit: 2.4× the great circle plus 25 ms of hops, 35% jitter, 0.5% loss, no SLA." },
]

export const HQ_LINKS = NETWORKS.filter((net) => ["fabric", "mcp", "cross", "fiber", "hollow", "wave", "mpls", "sdwan", "public"].includes(net.id))
export const TRACK_WANS = NETWORKS.filter((net) => ["fabric", "mcp", "cross", "fiber", "mpls", "sdwan", "leo", "peer", "eye", "public"].includes(net.id))

/** Live race traffic (telemetry, video, strategy) needs about 1 Gb/s to the circuit. PODIUM. */
export const TRACK_NEED_GBPS = 1

/** Cluster fabrics (PODIUM prices per compute rack; GPU nodes carry 400G/800G ConnectX NICs). */
export const FABRICS = [
  { id: "eth100", name: "100G Ethernet", src: "PODIUM", capexPerRack: 60_000, kwPerRack: 1.0, cfd: 0.88, ai: 0.85, leadWeeks: 2, risk: 0, learn: "Cheap and familiar; MPI and GPU-to-GPU traffic wait on it." },
  { id: "ib", name: "InfiniBand NDR 400G", src: "PODIUM", capexPerRack: 140_000, kwPerRack: 1.5, cfd: 1.0, ai: 0.97, leadWeeks: 6, risk: 0, learn: "The HPC standard: lowest MPI latency, lossless." },
  { id: "roce800", name: "800G Ethernet RoCE (Spectrum-X class)", src: "PODIUM", capexPerRack: 160_000, kwPerRack: 1.8, cfd: 0.98, ai: 1.0, leadWeeks: 6, risk: 0, learn: "AI-tuned Ethernet with ConnectX-8 800G SuperNICs (the NICs shipped with B300 and GB300)." },
  { id: "cpo", name: "Co-packaged optics photonic switches", src: "PODIUM", capexPerRack: 210_000, kwPerRack: 1.1, cfd: 1.02, ai: 1.04, leadWeeks: 14, risk: 0.03, photonic: true, learn: "Optics on the switch package: ~30% less power per port and lower latency than pluggables, at a premium, a long lead and early-life operational risk (estimates)." },
]

export const EDGE_RACKS = [1, 2, 3]
export const EDGE = { capex: 180_000, freightPerYear: 95_000, leadWeeks: 4 }

/** FIA 5.1 / 5.2: telemetry pipelines (two are illegal on purpose). */
export const TELEMETRY = [
  { id: "std", name: "SECU direct + ATLAS RF + garage umbilical", src: "FIA", capex: 0, edge: 1.0, learn: "Sensors wire straight into the McLaren Applied TAG-320 SECU, live data rides the FIA ATLAS band, full dumps go over the wired Gigabit umbilical in the garage." },
  { id: "compress", name: "Lossy caching & compression on the edge servers", src: "FIA", capex: 90_000, edge: 1.08, learn: "After the SECU, trackside edge servers cache and compress telemetry before the WAN (FIA 5.3 allows local ingestion and lossy caching)." },
  { id: "fpga", name: "FPGA pre-processor between sensors and SECU", src: "FIA", capex: 150_000, edge: 1.12, illegal: "5.1", learn: "An FPGA cleans sensor signals before they reach the SECU for sharper live data." },
]

/** FIA 5.3: the circuit ↔ factory WAN must use redundant, encrypted tunnels. */
export const TUNNELS = [
  { id: "redundant", name: "Redundant encrypted tunnels (IPsec over SD-WAN / MPLS, two paths)", src: "FIA", capex: 40_000, opex: 30_000, learn: "Two always-on encrypted tunnels, one on each WAN path, with automatic fail-over: what FIA 5.3 mandates. Needs a backup WAN to be truly redundant." },
  { id: "single", name: "One encrypted tunnel", src: "FIA", capex: 10_000, opex: 10_000, illegal: "5.3", points: 5, learn: "Encrypted, but a single tunnel: one failure takes the pit wall offline, and it does not meet the redundancy FIA 5.3 requires." },
  { id: "clear", name: "Unencrypted transport (trust the carrier)", src: "FIA", capex: 0, opex: 0, illegal: "5.3", points: 10, learn: "No encryption at all, relying on the carrier's network. Cheapest and simplest, and a clear breach of FIA 5.3." },
]

/** FIA 5.2: car data dumps go over the wired Gigabit umbilical in the garage; wireless is garage-only. */
export const GARAGE_NETS = [
  { id: "umbilical", name: "Wired Gigabit umbilical for car dumps (FIA mandated)", src: "FIA", capex: 0, opex: 0, edge: 1, learn: "The mandated path: full car data dumps go over the wired Gigabit umbilical when the car is in the garage. Engineers' laptops share the garage switch." },
  { id: "umbilicalwifi", name: "Umbilical + garage-only Wi-Fi 6E/7 for engineers", src: "PODIUM", capex: 60_000, opex: 20_000, edge: 1.03, learn: "Keep the mandated umbilical for the car and add a 6 GHz Wi-Fi 6E/7 network inside the garage for engineers and tablets: faster review between runs, no RF on track (estimates)." },
  { id: "wifidump", name: "Wi-Fi 7 replaces the umbilical for car dumps", src: "FIA", capex: 45_000, opex: 10_000, edge: 1.05, illegal: "5.2", points: 8, learn: "Dump the car over Wi-Fi 7 as it rolls into the garage: no cable to plug. FIA 5.2 mandates the wired umbilical for dumps." },
]

/** FIA 5.2: no private wireless on track or in the pit lane; garage ↔ hotel/office links are allowed. */
export const CELLULAR = [
  { id: "none", name: "No private cellular", src: "FIA", capex: 0, opex: 0, learn: "Engineers use the garage network and the hotel's Internet." },
  { id: "hotel", name: "Private 5G garage ↔ hotel/office (allowed)", src: "PODIUM", capex: 120_000, opex: 40_000, resilience: 0.05, learn: "A private 5G cell links the garage to the engineering office and hotel: a second, independent path for engineers that never touches the track (estimates)." },
  { id: "ontrack", name: "Private 5G on track / pit lane for live dumps", src: "FIA", capex: 120_000, opex: 40_000, edge: 1.06, illegal: "5.2", seconds: 10, points: 5, learn: "A private 5G cell streams high-frequency dumps while the car is on track. FIA 5.2 bans team wireless on track and in the pit lane." },
]

/** FIA 5.3: live strategy must run at HQ or approved cloud, not on hidden track hardware. */
export const STRATEGY_VENUES = [
  { id: "hq", name: "HQ data centre / approved cloud", src: "FIA", learn: "Strategy models run where the GPUs are; trackside only ingests and caches." },
  { id: "trackside", name: "Hidden GPU node in the garage rack", src: "FIA", capex: 300_000, illegal: "5.3", learn: "A GPU node in the garage runs strategy locally: no WAN round trip at all." },
]

/* ------------------------------------------------------------------ Article F6 & governance */

export const SEGREGATION = [
  { id: "shared", name: "Shared IT with the sister companies", src: "FIA", capex: 0, opex: 0, illegal: "F6 3.3", learn: "One AD forest, one SAN, shared Git and CAD vaults with Applied Science and Hypercars. Cheapest by far." },
  { id: "logical", name: "Logical: VLANs, separate AD forests, MFA, RBAC namespaces", src: "FIA", capex: 600_000, opex: 300_000, auditRisk: 0.1, learn: "Separate subnets and directory trees, zero shared service accounts, MFA per domain, partitioned storage namespaces (F6 3.3)." },
  { id: "physical", name: "Physical + logical: dedicated SAN/NAS, badge zones", src: "FIA", capex: 1_800_000, opex: 500_000, auditRisk: 0.02, learn: "Dedicated arrays, RFID/biometric zones between F1 and non-F1 areas, immutable 3-year access logs (F6 3.2–3.3)." },
  { id: "zerotrust", name: "Zero-trust with DPU-enforced isolation", src: "FIA", capex: 1_000_000, opex: 400_000, auditRisk: 0.03, needsDpu: true, learn: "Identity-based micro-segmentation enforced in BlueField DPUs (pick them at the Storage & Data table). Without DPUs it is only as good as the logical option." },
]

export const DATAFLOWS = [
  { id: "diode", name: "Hardware data diode F1 → non-F1, logged and filmed", src: "FIA", capex: 150_000, opex: 30_000, learn: "A one-way valve: IP may leave F1 with sign-off and a video record; nothing comes back (F6 3.3)." },
  { id: "manual", name: "Manual transfer desk with sign-off", src: "FIA", capex: 20_000, opex: 120_000, auditRisk: 0.08, learn: "People move approved files by hand: compliant but slow and error-prone." },
  { id: "bidir", name: "Two-way sync with the Applied Science CFD team", src: "FIA", capex: 0, opex: 0, illegal: "F6 3.3", detect: 0.6, aeroBoost: 0.08, learn: "Share meshes and solver tweaks both ways with the sister company's aero team: free know-how." },
]

export const WORKFORCE = [
  { id: "none", name: "No transfers", src: "FIA", aeroBoost: 0, learn: "Keep the F1 workforce as it is." },
  { id: "lockout", name: "Hire 4 Applied Science CFD engineers with 3-month lockout", src: "FIA", opex: 0, aeroBoost: 0.04, liveShare: 0.75, learn: "They sit out 3 months with no network or facility access, then commit 12 months to F1 (F6 3.4): useful from April." },
  { id: "immediate", name: "Move them in on Monday", src: "FIA", opex: 0, aeroBoost: 0.05, illegal: "F6 3.4", detect: 0.7, learn: "No cooling-off: they start next week with everything they know." },
]

export const CURFEW = [
  { id: "auto", name: "Automated curfew lockdown (DCIM + beam sensors)", src: "FIA", capex: 60_000, breachRisk: 0.02, learn: "Garage racks power-schedule themselves and alarms tie to the FIA beam sensors (5.4)." },
  { id: "manual", name: "Manual procedures", src: "FIA", capex: 0, breachRisk: 0.25, learn: "Engineers remember not to boot racks on Wednesday–Friday nights (5.4)." },
]

export const LOGS = [
  { id: "worm", name: "Immutable 3-year WORM log store", src: "FIA", capex: 80_000, opex: 15_000, learn: "Badge and event logs written once, kept three years (F6 3.2–3.3)." },
  { id: "standard", name: "Standard 12-month SIEM retention", src: "FIA", capex: 0, opex: 0, auditRisk: 0.4, learn: "The SIEM keeps a year of logs and rolls over." },
]

/* ------------------------------------------------------------------ commercial models */

/**
 * How the team pays for hardware the OEM ships (CFD nodes and owned AI racks). P is the equivalent
 * purchase price. Buy and the $1-buyout finance lease are CapEx (substance over form); an FMV lease
 * and an OEM as-a-service programme are 100% OpEx under the cost cap (FIA 1.1 / 1.2).
 */
export const PAYMENTS = [
  { id: "buy", name: "Buy outright", src: "IND", capexShare: 1, why: "Cheapest over three years, but every dollar comes out of the CapEx envelope (FIA 1.2).", learn: "CapEx = the purchase price; support is OpEx each year." },
  { id: "lease", name: "Operating lease (FMV)", src: "IND", capexShare: 0, est: true, why: "Zero CapEx: a yearly rental against the cost cap; the lessor keeps the residual value.", learn: "Rate factor a year: 24 months 46%, 36 months 28%, 60 months 20% of the price, plus support." },
  { id: "finance", name: "$1-buyout finance lease", src: "IND", capexShare: 1, fia: "1.2", est: true, why: "Feels like a lease, but you end up owning it: the FIA books it as CapEx, plus ~4.5% interest a year.", learn: "Substance over form: a bargain purchase option makes it a purchase." },
  { id: "aas", name: "OEM as-a-service (GreenLake / APEX / TruScale)", src: "IND", capexShare: 0, est: true, why: "Zero CapEx and support included, ~3–3.6% of the price a month, but a 36-month commitment you pay in full if you leave early.", learn: "HPE GreenLake Flex reserves 80% (the rest is metered buffer); Dell APEX and Lenovo TruScale commit about 75%. Supermicro has no programme." },
]
export const LEASE_RATES = { 24: 0.46, 36: 0.28, 60: 0.2 }
export const FINANCE_INTEREST = 0.045
export const CONTRACT_TERMS = [24, 36, 60]
export const AAS_MIN_MONTHS = 36

/** How the AI table sources its accelerators. */
export const SOURCING = [
  { id: "own", name: "Own racks in your data centre", src: "IND", why: "Paid the way the compute table chose (buy, lease, finance or as-a-service); needs power, cooling and lead time.", learn: "Owned or leased racks sit in your hall and draw your power block." },
  { id: "cloud", name: "Reserved cloud GPUs (1 year)", src: "IND", fia: "1.1", why: "No hall, no lead time, 100% OpEx all year at a neocloud rate card.", learn: "One-year reservation at neocloud rates; egress is free. Hyperscalers cost 1.6–2.4× more." },
  { id: "burst", name: "Race-weekend burst (cloud Capacity Blocks)", src: "IND", fia: "1.1", est: true, why: "Rent the peak only: 24 race weekends × 72 hours, at a higher hourly rate plus hyperscaler egress.", learn: "AWS EC2 Capacity Blocks: pre-paid 72-hour blocks (1,728 hours a year). Strategy runs live; nothing is left for midweek engineering." },
]

/** Colocation contract terms. `mult` scales the $/kW-month; `metered` bills drawn kW, not the block. */
export const COLO_TERMS = [
  { id: "top5", name: "5-year take-or-pay", src: "IND", mult: 1.0, why: "The standard wholesale deal: a fair rate, but you pay for every contracted kW, drawn or not.", learn: "Rent is billed on the contracted block." },
  { id: "top10", name: "10-year take-or-pay", src: "IND", mult: 0.88, est: true, why: "About 12% cheaper per kW, locked for a decade: great if the block is right-sized, painful if not.", learn: "Long commitments buy a lower rate." },
  { id: "metered", name: "Flexible 1-year, pay for drawn kW", src: "IND", mult: 1.3, metered: true, est: true, why: "Pay only for what the racks draw, at a 30% premium: nothing stranded, but the dearest kilowatt.", learn: "Retail-style metered power: no stranded capacity." },
]

/** Power and cooling redundancy. `mult` scales rent; `trip` scales the chance a fault takes the racks down. */
export const REDUNDANCY = [
  { id: "n", name: "N (one power path)", src: "IND", mult: 1.0, trip: 3, why: "Cheapest, but one UPS or feed fault stops the racks on a race weekend.", learn: "No spare plant." },
  { id: "n1", name: "N+1 (one spare of everything)", src: "IND", mult: 1.08, trip: 1, est: true, why: "A spare UPS, chiller and feed: rides through one failure for ~8% more rent.", learn: "The common colocation standard." },
  { id: "2n", name: "2N (two independent paths)", src: "IND", mult: 1.25, trip: 0.35, est: true, why: "Two complete power trains: near-zero outage risk for ~25% more rent.", learn: "Concurrent maintainability and fault tolerance." },
]

/** Liquid-ready colocation space costs this much more per kW-month (CBRE). */
export const LIQUID_RENT_PREMIUM = 0.15

/* ------------------------------------------------------------------ stations & decisions */

/**
 * The tables in the room. Each owns 4–6 decisions; teams visit them freely against the game clock.
 * `brief` is three plain-English lines a salesperson can say in a minute.
 */
export const STATIONS = [
  {
    id: "compute",
    name: "CFD Supercomputer",
    leader: "Head of Aero Computing",
    color: "#e10600",
    clauses: ["FIA 2.1 MAUh billed at FP64 peak", "FIA 2.1 turbo must be locked", "FIA 1.2 CapEx envelope"],
    brief: [
      "The FIA caps aero computing, not hardware: every core-hour is billed at the chip's peak speed, so a locked clock and memory bandwidth win.",
      "Pick the OEM who builds and supports the racks. The same OEM ships your AI racks.",
      "Decide how to pay: buying uses CapEx, leasing and as-a-service use OpEx. The CapEx envelope is small for top teams.",
    ],
    partners: ["Supermicro", "Dell", "HPE", "Lenovo", "NVIDIA", "AMD", "Intel"],
  },
  {
    id: "ai",
    name: "AI & GPUs",
    leader: "Head of Race Strategy",
    color: "#00a19c",
    clauses: ["FIA 1.1 cloud is 100% OpEx", "FIA 5.3 strategy runs at HQ or approved cloud"],
    brief: [
      "Race strategy needs about 180,000 tokens a second on race weekends.",
      "Own racks, reserve cloud GPUs, or rent only the race weekends.",
      "Model size, number format and the GPU power cap decide how much each GPU delivers.",
    ],
    partners: ["NVIDIA", "Neoclouds and AWS", "Custom-silicon partners"],
  },
  {
    id: "dc",
    name: "Data Centre & Power",
    leader: "Head of Facilities",
    color: "#ff8000",
    clauses: ["FIA 1.1 colocation and power are OpEx", "FIA 1.2 racks and PDUs are CapEx"],
    brief: [
      "Choose the metro, the cooling and how many kW you contract: rent is per kW a month whether you use it or not.",
      "Air cools ~15 kW a rack, rear doors ~70, direct-to-chip liquid ~240, immersion ~100.",
      "Redundancy and contract length trade rent against outage risk and flexibility.",
    ],
    partners: ["Digital Realty (PlatformDIGITAL)", "Vertiv / Motivair (rear doors, CDUs)", "Immersion vendors"],
  },
  {
    id: "storage",
    name: "Storage & Memory",
    leader: "Head of Data Engineering",
    color: "#ffd700",
    clauses: ["FIA 2.3 parallel file system with tamper-evident metadata", "FIA 2.3 run folders retained"],
    brief: [
      "CFD needs a parallel file system that keeps a tamper-evident record (FIA 2.3).",
      "Run folders must be kept for audit.",
      "The strategy AI needs its history searchable, a KV cache for repeat questions, and enough GPU memory.",
    ],
    partners: ["Lustre / BeeGFS", "Everpure / NetApp (storage as a service)", "NVIDIA"],
  },
  {
    id: "network",
    name: "Connectivity",
    leader: "Head of Trackside IT",
    color: "#3671c6",
    clauses: ["FIA 5.2 wired umbilical, no wireless on track", "FIA 5.3 redundant encrypted WAN"],
    brief: [
      "Strategy calls travel circuit → data centre → factory: every kilometre adds delay, every hop adds jitter.",
      "The WAN must be redundant and encrypted (FIA 5.3); car dumps go over the wired umbilical (FIA 5.2).",
      "Inside the hall, the cluster fabric and cross-connects decide how well CFD and AI scale.",
    ],
    partners: ["Digital Realty (ServiceFabric, cross-connects)", "Carriers", "Photonics suppliers"],
  },
  {
    id: "governance",
    name: "Rules & Budget",
    leader: "CFO & Compliance Director",
    color: "#229971",
    clauses: ["F6 3.3 segregation from sister companies", "F6 3.4 workforce quarantine", "FIA 5.4 curfew", "FIA 1.1 cost cap"],
    brief: [
      "F1 IT must be separated from the sister companies: people, networks, data.",
      "Data may leave F1 with sign-off; nothing may come back.",
      "Check the whole bill: CapEx envelope, OpEx allowance and cost-cap headroom.",
    ],
    partners: ["Security partners", "Digital Realty (private suites)", "Auditors"],
  },
]

/** Pick options from a list by id and overlay plain-English names, reasons and tags. */
function offer(list, picks) {
  return picks.map(([id, extra]) => {
    const base = list.find((item) => item.id === id)
    if (!base) throw new Error(`catalog: unknown option ${id}`)
    return { ...base, ...extra }
  })
}

const TRACKSIDE = [
  { id: "basic", name: "One encrypted tunnel, wired umbilical", src: "FIA", fia: "5.3", sets: { tunnels: "single", garage: "umbilical", cellular: "none" }, why: "Cheapest, but one fault cuts the pit wall off and FIA 5.3 asks for two tunnels." },
  { id: "fia", name: "FIA standard: two encrypted tunnels + umbilical", src: "FIA", fia: "5.3", sets: { tunnels: "redundant", garage: "umbilical", cellular: "none" }, why: "Exactly what the rules ask: automatic fail-over between two encrypted paths." },
  { id: "plus", name: "FIA standard + garage Wi-Fi 7 + private 5G to the hotel", src: "IND", est: true, sets: { tunnels: "redundant", garage: "umbilicalwifi", cellular: "hotel" }, why: "Legal extras: faster engineer review and a second path that never touches the track." },
  { id: "wireless", name: "All wireless: Wi-Fi car dumps + 5G on track", src: "FIA", fia: "5.2", sets: { tunnels: "redundant", garage: "wifidump", cellular: "ontrack" }, why: "Fastest data, and banned: FIA 5.2 forbids team wireless on track and car dumps off the umbilical." },
]

const AUDIT = [
  { id: "basic", name: "Manual curfew, 12-month logs", src: "FIA", fia: "5.4", sets: { curfew: "manual", logs: "standard" }, why: "Free, but a forgotten rack at night or a missing log is a penalty." },
  { id: "logs", name: "Manual curfew, 3-year immutable logs", src: "FIA", fia: "F6 3.2", sets: { curfew: "manual", logs: "worm" }, why: "Audit-proof logs; the curfew still depends on people remembering." },
  { id: "full", name: "Automated curfew + 3-year immutable logs", src: "FIA", fia: "5.4", sets: { curfew: "auto", logs: "worm" }, why: "Racks power down on schedule and every event is kept: nothing to argue about." },
]

/**
 * Every decision: which station owns it, its options (or values) and the default an unvisited team
 * gets. `hidden` decisions are fixed at `def` and never shown. Options with `sets` expand into the
 * hidden decisions they bundle.
 */
export const DECISIONS = [
  { id: "oem", station: "compute", name: "OEM partner", options: offer(OEMS, [
    ["supermicro", { name: "Supermicro", why: "Lowest price (the 1.00 baseline), in stock 3 weeks sooner, thinner support, no as-a-service." }],
    ["dell", { name: "Dell PowerEdge", why: "+15% on price, a week sooner, ProSupport, and APEX if you want it as a service." }],
    ["hpe", { name: "HPE (Cray XD / ProLiant)", why: "+18%, a week later, HPC tuning for CFD (+4%), GreenLake and Private Cloud AI services." }],
    ["lenovo", { name: "Lenovo (Neptune water cooling)", why: "+15%, a week later, warm-water cooling that cuts node power, TruScale as a service." }],
    ["nvidia", { name: "NVIDIA DGX", why: "+35% and two weeks later, but AI Enterprise software ($4,500 a GPU a year) is included." }],
  ]), def: "nvidia" },
  { id: "payment", station: "compute", name: "How you pay for the hardware", options: PAYMENTS, def: "buy" },
  { id: "term", station: "compute", name: "Contract term (leases and as-a-service)", values: CONTRACT_TERMS, def: 36, unit: "months" },
  { id: "cpu", station: "compute", name: "CFD processor", options: offer(CPUS, [
    ["epyc9575f", { name: "AMD EPYC 9575F (fast clocks)", est: true, why: "Huge peak speed, but CFD waits on memory and the FIA bills the peak." }],
    ["epyc9684x", { name: "AMD EPYC 9684X (stacked cache)", est: true, why: "A giant cache keeps the mesh on-chip: more useful work per billed hour." }],
    ["xeonmax9480", { name: "Intel Xeon Max 9480 (HBM on the CPU)", est: true, fia: "2.3", why: "The most memory bandwidth per core; HBM must be declared to the FIA." }],
    ["grace", { name: "NVIDIA Grace (Arm)", est: true, why: "Low power per node with solid bandwidth; a modest peak keeps the bill low." }],
  ]), def: "epyc9575f" },
  { id: "clock", station: "compute", name: "Clock policy", options: offer(CLOCKS, [
    ["turbo", { name: "Turbo unlocked", fia: "2.1", why: "Billed at maximum boost on every core-hour, and CFD barely runs faster." }],
    ["base", { name: "Locked at base clock", fia: "2.1", why: "Billed at the base clock: the honest default." }],
    ["lock85", { name: "Locked 15% under base", fia: "2.1", why: "15% less billed per core-hour for almost no loss on memory-bound CFD." }],
  ]), def: "turbo" },
  { id: "nodes", station: "compute", name: "CFD nodes", values: [4, 8, 12, 16], def: 4, unit: "nodes" },
  { id: "solver", station: "compute", hidden: true, options: SOLVERS, def: "cpu" },
  { id: "geometry", station: "compute", hidden: true, options: GEOMETRY, def: "disciplined" },

  { id: "platform", station: "ai", name: "Accelerator", options: offer(PLATFORMS, [
    ["h100", { name: "HGX H100 (last generation)", why: "Cheap and in stock in weeks, but 80 GB a GPU and a fraction of Blackwell's tokens." }],
    ["b300", { name: "HGX B300 (Blackwell Ultra, 30 kW a rack)", why: "288 GB a GPU and FP4: the most tokens on air-friendly racks; needs rear doors or liquid at 30 kW." }],
    ["gb300", { name: "GB300 NVL72 (72 GPUs as one, 142 kW)", why: "One giant GPU for big models: liquid cooling only and a 20-week lead." }],
    ["asic", { name: "Partner ASIC derivative", est: true, why: "Twice the tokens per watt, but $6M of engineering, 44 weeks and a 30% chance it slips." }],
    ["custom", { name: "True custom silicon (own chip)", est: true, why: "$150M and 130 weeks: no team can afford it this season. That is the point." }],
  ]), def: "h100" },
  { id: "deploy", station: "ai", name: "How you source it", options: SOURCING, def: "own" },
  { id: "racks", station: "ai", name: "Racks (or cloud equivalent)", values: [1, 2, 3, 4], def: 2, unit: "racks" },
  { id: "tgp", station: "ai", name: "GPU power cap", options: offer(TGP_MODES, [
    ["eco70", { name: "Capped at 70%", est: true, why: "80% of the tokens for 70% of the watts." }],
    ["eco85", { name: "Capped at 85%", est: true, why: "The sweet spot: 93% of the tokens for 85% of the watts." }],
    ["std", { name: "Datasheet power", why: "Full speed, full power bill." }],
    ["boost", { name: "Max boost", est: true, why: "+6% tokens for +15% watts; throttles and fails without liquid cooling." }],
  ]), def: "std" },
  { id: "modelSize", station: "ai", name: "Strategy model size", options: offer(MODEL_SIZES, [
    ["7b", { name: "Small (7B)", est: true, why: "Five times the tokens and instant answers, but weaker strategy calls." }],
    ["70b", { name: "Medium (70B)", est: true, why: "Good race reasoning and fast enough: the workhorse." }],
    ["400b", { name: "Frontier (400B)", est: true, why: "The sharpest calls, but a fifth of the tokens and it needs a lot of GPU memory." }],
  ]), def: "400b" },
  { id: "precision", station: "ai", name: "Number format", options: offer(PRECISIONS, [
    ["fp32", { name: "FP32 (4 bytes)", est: true, why: "Training-style precision: four times the memory of FP8 and a seventh of the speed." }],
    ["bf16", { name: "BF16 (2 bytes)", est: true, why: "The safe serving standard: no accuracy loss, about 60% of FP8 speed." }],
    ["fp8", { name: "FP8 (1 byte)", est: true, why: "Half the memory of BF16 and the fastest tokens, ~1.5% accuracy loss." }],
    ["int8", { name: "INT8 (1 byte)", est: true, why: "What most custom chips run natively; a little more accuracy loss." }],
  ]), def: "fp32" },
  { id: "orca", station: "ai", hidden: true, options: [{ id: "off", name: "None", src: "IND" }, { ...ORCA, id: "on" }], def: "off" },

  { id: "location", station: "dc", name: "Metro", options: offer(LOCATIONS, [
    ["lon", { name: "London", why: "80 km from the factory; $213/kW-month rent and dear power." }],
    ["fra", { name: "Frankfurt", why: "Europe's interconnection hub; the dearest rent ($250/kW-month)." }],
    ["iad", { name: "Ashburn (Virginia)", why: "$173/kW-month, cheap power, every cloud on-ramp; an ocean from the factory." }],
    ["dfw", { name: "Dallas (Texas)", why: "$173/kW-month and the cheapest power, 300 km from the Austin race, 7,600 km from the factory." }],
  ]), def: "lon" },
  { id: "hall", station: "dc", name: "Cooling", options: offer(HALLS, [
    ["A", { name: "Air (open hall)", why: "Ready now, ~15 kW a rack, PUE 1.38." }],
    ["R", { name: "Rear-door heat exchangers", est: true, why: "Water coils on the rack doors: ~70 kW a rack, $30k a rack, 6 weeks." }],
    ["L", { name: "Direct-to-chip liquid", est: true, why: "Cold plates: up to 240 kW a rack, PUE 1.20, $45k a rack, 10 weeks, +15% rent." }],
    ["X", { name: "Immersion tanks", est: true, why: "PUE ~1.07 and ~100 kW a tank, $70k a tank, 12 weeks, +15% rent; NVL72 racks do not fit." }],
  ]), def: "A" },
  { id: "block", station: "dc", name: "Power contracted", values: [0.25, 0.5, 1, 2], def: 0.5, unit: "MW" },
  { id: "terms", station: "dc", name: "Colocation contract", options: COLO_TERMS, def: "top5" },
  { id: "redundancy", station: "dc", name: "Power redundancy", options: REDUNDANCY, def: "n" },
  { id: "heat", station: "dc", hidden: true, options: [{ id: "off", name: "No heat reuse", src: "IND" }, { ...HEAT_REUSE, id: "on" }], def: "off" },

  { id: "pfs", station: "storage", name: "CFD file system", options: offer(PFS, [
    ["nas", { name: "Scale-out NAS", fia: "2.3", why: "Cheap and simple, but CFD stalls and there is no tamper-evident record." }],
    ["lustre", { name: "Lustre appliance", fia: "2.3", est: true, why: "The parallel standard with an audit trail, bought as CapEx." }],
    ["beegfs", { name: "BeeGFS", fia: "2.3", est: true, why: "The cheapest parallel option; the audit add-on costs engineering time." }],
    ["staas", { name: "Storage as a service", fia: "2.3", est: true, why: "No CapEx, no power or space: ~$500k per PB a year, all OpEx." }],
  ]), def: "nas" },
  { id: "pfsPB", station: "storage", name: "Capacity", values: PFS_PB, def: 1, unit: "PB" },
  { id: "archive", station: "storage", name: "Audit archive", options: offer(ARCHIVES, [
    ["none", { name: "Delete after each test period", fia: "2.3", why: "Saves space and breaks FIA 2.3: run folders must be kept." }],
    ["tape", { name: "Tape library", fia: "2.3", est: true, why: "Cheap to keep for years; CapEx." }],
    ["cloud", { name: "Cloud archive", est: true, why: "No CapEx, a small OpEx bill, slow to retrieve in an audit." }],
  ]), def: "none" },
  { id: "dataTier", station: "storage", name: "Strategy knowledge store", options: offer(DATA_TIERS, [
    ["local", { name: "Local drives only", why: "Free, but the assistant cannot search a decade of race data." }],
    ["file", { name: "Shared file and object store", est: true, why: "History and checkpoints in one place: better-grounded answers." }],
    ["vector", { name: "Vector index", est: true, why: "Finds the right past stint instantly: the best-grounded strategy calls." }],
  ]), def: "local" },
  { id: "kv", station: "storage", name: "KV cache tier", options: [
    { id: "off", name: "Off", src: "IND", why: "GPUs re-read every prompt from scratch on repeat questions." },
    { ...KV_TIER, id: "on", name: "On", est: true, why: "Repeat what-ifs skip the prompt: ~18% more effective throughput for $250k." },
  ], def: "off" },
  { id: "hbm", station: "storage", name: "GPU memory (HBM)", options: offer(HBM_TIERS, [
    ["hbm80", { name: "80 GB", est: true, why: "Big models must be split across GPUs; long contexts spill." }],
    ["hbm141", { name: "141 GB", est: true, why: "~1.3× faster inference on the same GPU for $6k a GPU." }],
    ["hbm192", { name: "192 GB", est: true, why: "A 70B model plus its notes on one GPU." }],
    ["hbm288", { name: "288 GB", est: true, why: "Room for long contexts and big models; the dearest memory." }],
  ]), def: "hbm80" },
  { id: "hosts", station: "storage", hidden: true, options: HOSTS, def: "standard" },

  { id: "wan", station: "network", name: "Primary WAN to the circuit", options: offer(TRACK_WANS, [
    ["public", { name: "Public internet", why: "Cheapest; 2.4× the distance, jitter and packet loss, no SLA." }],
    ["sdwan", { name: "SD-WAN over two ISPs", est: true, why: "Encrypted and quick to deploy; still the internet underneath." }],
    ["mpls", { name: "Carrier MPLS", est: true, why: "Steady and SLA-backed, but dear and a 10-week order." }],
    ["fabric", { name: "Digital Realty ServiceFabric", why: "Private interconnection, almost no jitter, live in 15 days." }],
  ]), def: "public" },
  { id: "wanBackup", station: "network", name: "Backup WAN", options: [
    { id: "none", name: "No backup", src: "FIA", fia: "5.3", why: "One path: one cut and the pit wall is blind." },
    ...offer(TRACK_WANS, [
      ["leo", { name: "LEO satellite", est: true, why: "Shares nothing with your fibre: the most diverse backup, thin but cheap." }],
      ["sdwan", { name: "SD-WAN over two ISPs", est: true, why: "Cheap, encrypted second path over different carriers." }],
      ["mpls", { name: "Carrier MPLS", est: true, why: "A steady second path with an SLA, at a price." }],
    ]),
  ], def: "none" },
  { id: "hqLink", station: "network", name: "Data centre ↔ factory link", options: offer(HQ_LINKS, [
    ["public", { name: "Public internet", why: "Cheap and jittery: every strategy call waits on it." }],
    ["fiber", { name: "Dark fibre (≤1,500 km)", est: true, why: "Pure light-speed delay between your own sites; a 12-week build." }],
    ["hollow", { name: "Hollow-core fibre (≤300 km)", est: true, why: "Light in air: ~32% less delay than glass, $400k and 20 weeks." }],
    ["fabric", { name: "Digital Realty ServiceFabric", why: "Private and global: the only clean option from a US metro." }],
  ]), def: "public" },
  { id: "fabric", station: "network", name: "Cluster fabric", options: offer(FABRICS, [
    ["eth100", { name: "100G Ethernet", est: true, why: "Cheap and familiar; CFD and GPUs wait on it." }],
    ["ib", { name: "InfiniBand 400G", est: true, why: "The HPC standard: lowest latency for CFD." }],
    ["roce800", { name: "800G AI Ethernet", est: true, why: "Tuned for GPU traffic; nearly InfiniBand for CFD." }],
    ["cpo", { name: "Co-packaged optics (photonics)", est: true, why: "~30% less power per port and lower latency; a premium, a long lead, early-life risk." }],
  ]), def: "eth100" },
  { id: "trackside", station: "network", name: "Trackside network package", options: TRACKSIDE, def: "basic" },
  { id: "edge", station: "network", name: "Trackside edge racks", values: EDGE_RACKS, def: 1, unit: "racks" },
  { id: "tunnels", station: "network", hidden: true, options: TUNNELS, def: "single" },
  { id: "garage", station: "network", hidden: true, options: GARAGE_NETS, def: "umbilical" },
  { id: "cellular", station: "network", hidden: true, options: CELLULAR, def: "none" },
  { id: "telemetry", station: "network", hidden: true, options: TELEMETRY, def: "compress" },
  { id: "venue", station: "network", hidden: true, options: STRATEGY_VENUES, def: "hq" },

  { id: "segregation", station: "governance", name: "Separation from sister companies", options: offer(SEGREGATION, [
    ["shared", { name: "Shared IT", fia: "F6 3.3", why: "Cheapest by far, and a clear Article F6 breach." }],
    ["logical", { name: "Logical separation", fia: "F6 3.3", why: "Separate networks, directories and MFA: compliant, a small audit risk." }],
    ["physical", { name: "Private suite + separate storage", fia: "F6 3.3", why: "A caged suite and dedicated arrays: the safest, the dearest." }],
    ["zerotrust", { name: "Zero-trust with hardware isolation (DPUs)", fia: "F6 3.3", est: true, capex: 1_400_000, needsDpu: false, why: "Identity-based isolation enforced in BlueField DPUs: near-physical safety for less." }],
  ]), def: "shared" },
  { id: "dataflow", station: "governance", name: "Data flow with sister companies", options: offer(DATAFLOWS, [
    ["manual", { name: "Manual transfer desk", fia: "F6 3.3", why: "Compliant but slow, and people make mistakes." }],
    ["diode", { name: "One-way data diode", fia: "F6 3.3", why: "Data can leave F1, nothing comes back: provably compliant." }],
    ["bidir", { name: "Two-way sync with the sister CFD team", fia: "F6 3.3", why: "Free know-how, and banned: data must never flow back into F1." }],
  ]), def: "manual" },
  { id: "workforce", station: "governance", name: "Hiring from sister companies", options: offer(WORKFORCE, [
    ["none", { name: "No transfers", why: "No risk, no extra help." }],
    ["lockout", { name: "Hire 4 engineers with a 3-month lockout", fia: "F6 3.4", why: "Useful from April, fully compliant." }],
    ["immediate", { name: "Move them in on Monday", fia: "F6 3.4", why: "Instant help, and a breach of the quarantine rule." }],
  ]), def: "none" },
  { id: "audit", station: "governance", name: "Curfew and audit logs", options: AUDIT, def: "basic" },
  { id: "curfew", station: "governance", hidden: true, options: CURFEW, def: "manual" },
  { id: "logs", station: "governance", hidden: true, options: LOGS, def: "standard" },
]

export const DEFAULT_CHOICES = Object.fromEntries(DECISIONS.map((decision) => [decision.id, decision.def]))

/** Decisions a player sees, per station. */
export function visibleDecisions(stationId) {
  return DECISIONS.filter((d) => !d.hidden && (!stationId || d.station === stationId))
}

/** Race against time: the host's game clock is the hard limit; a visit timer is only a guide. */
export const GAME_CLOCK = { minutes: 60, visitMinutes: 10, minMinutes: 5, maxMinutes: 240 }

/**
 * A table counts only once its leader approves the pitched design. An approved table is worth its
 * system score (the simulation of the locked plan) plus a 10% pitch bonus; anything else is worth 0.
 */
export const APPROVAL_BONUS = 0.1
/** Championship points a table is worth: system score × 1.1 / 4, so ≤ 27.5 a table. */
export const TABLE_POINTS_DIVISOR = 4
export const PITCH_MAX = Math.round((100 * (1 + APPROVAL_BONUS)) / TABLE_POINTS_DIVISOR)

export function tablePoints(score, approved = true) {
  if (!approved) return 0
  return Math.round(((Number(score) || 0) * (1 + APPROVAL_BONUS)) / TABLE_POINTS_DIVISOR)
}

/** Badge for an option card: an FIA rule reference, an estimate marker, or nothing. */
export function optionTag(option) {
  if (!option) return null
  if (option.fia) return { kind: "fia", text: `FIA rule ${option.fia}` }
  if (option.est) return { kind: "est", text: "est." }
  return null
}

export const TEAM_COLORS = ["#e10600", "#00a19c", "#ff8000", "#3671c6", "#ffd700", "#229971", "#b6babd", "#ff87bc", "#6692ff", "#c92d4b"]

export function byId(list, id) {
  return list.find((item) => item.id === id) || null
}

export function decision(id) {
  return byId(DECISIONS, id)
}

/** True when `value` is a legal pick for decision `id`. */
export function validChoice(id, value) {
  const d = decision(id)
  if (!d || d.hidden) return false
  if (d.values) return d.values.includes(Number(value))
  return d.options.some((option) => option.id === value)
}
