/**
 * Infrastructure performance simulator: the model.
 *
 * Pure functions, no DOM. `simulate(inputs)` evaluates one scenario; `evaluate(inputs)` evaluates the
 * scenario and "Today's setup" for the same season and derives the performance delta. Every constant
 * comes from public/js/customer.js (FIGURES) or public/js/sim/assumptions.js (K) and is keyed to a row
 * of docs/audi-f1-sources.md. The formulae are written out in docs/audi-f1-model.md.
 *
 * Units: kW are IT (critical) load unless named "facility"; money is CHF per year unless named one-off;
 * MAUh are per Aerodynamic Testing Period (ATP); seconds per lap are season-level lap-time found.
 */
import { FIGURES as F, costCapCHF } from "../customer.js"
import { K } from "./assumptions.js"

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d
const finite = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback)

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export const DEFAULTS = Object.freeze({
  season: 2027,
  position: F.fia.atrPosition,
  // Compute (HPE via HPE GreenLake)
  nodes: 12,
  coresPerNode: 128,
  clockGHz: 3.7,
  cpuArch: K.compute.cpuArchToday,
  gpus: 0,
  solverGpus: 0,
  gpuModel: "b200",
  gpuChargePct: 100,
  memoryGB: 768,
  interconnect: "eth200",
  storage: "pfs",
  consumption: "buy",
  committedPct: 80,
  termYears: 5,
  support: "4h",
  refreshYears: 4,
  leadWeeks: -4,
  // Facility (Digital Realty Zurich)
  location: "dr",
  hinwilRetrofit: false,
  committedKW: F.offer.committedKW,
  mlPartitionKW: 0,
  mlPlacement: "dr",
  rackKW: 30,
  cooling: "reardoor",
  redundancy: "n1",
  pueMode: "derived",
  pueValue: 1.25,
  tariffRp: Math.round(F.tariffs.campusCHFPerKWh * 100),
  renewable: true,
  heatReuse: true,
  fitOutCHF: F.offer.fitOutCHF,
  migrationCHF: F.offer.migrationCHF,
  migrationTiming: "boundary",
  propertySharePct: 50,
  // Connectivity & trackside
  fibrePairs: 2,
  fibreGbps: 100,
  trackside: "dual",
  edge: true,
  cloudOnRamp: false,
  venue: "singapore",
  // Model
  confidence: K.performance.confidenceDefault,
  // Share of the season's allowance lost to the deployment schedule (set by plan.js from the timeline; not a control)
  scheduleLoss: 0,
})

/** Named scenarios. "today" is the baseline every scenario is compared against (same season). */
export const PRESETS = {
  today: {
    id: "today",
    label: "Today: Hinwil on-prem",
    short: "Today",
    inputs: {
      nodes: 12, coresPerNode: 128, clockGHz: 3.7, cpuArch: "today", gpus: 0, solverGpus: 0, gpuModel: "b200", gpuChargePct: 100,
      memoryGB: 768, interconnect: "eth200", storage: "nas", consumption: "buy", committedPct: 80, termYears: 5,
      support: "nbd", refreshYears: 5, leadWeeks: 0,
      location: "hinwil", hinwilRetrofit: false, committedKW: F.offer.committedKW, mlPartitionKW: 0, mlPlacement: "hinwil", rackKW: 12, cooling: "air", redundancy: "n",
      pueMode: "derived", pueValue: 1.6, tariffRp: Math.round(F.tariffs.hinwilCHFPerKWh * 100), renewable: false, heatReuse: false,
      fitOutCHF: F.offer.fitOutCHF, migrationCHF: F.offer.migrationCHF, migrationTiming: "boundary", propertySharePct: 50,
      fibrePairs: 1, fibreGbps: 10, trackside: "carrier", edge: false, cloudOnRamp: false,
    },
  },
  dr2027: {
    id: "dr2027",
    label: "Digital Realty Zurich 2027",
    short: "DR 2027",
    inputs: {
      season: 2027,
      nodes: 12, coresPerNode: 128, clockGHz: 3.7, cpuArch: "today", gpus: 0, solverGpus: 0, gpuModel: "b200", gpuChargePct: 100,
      memoryGB: 768, interconnect: "ibndr", storage: "pfs", consumption: "buy", committedPct: 80, termYears: 5,
      support: "4h", refreshYears: 4, leadWeeks: -4,
      location: "dr", hinwilRetrofit: false, committedKW: F.offer.committedKW, mlPartitionKW: 0, mlPlacement: "dr", rackKW: 30, cooling: "reardoor", redundancy: "n1",
      pueMode: "derived", pueValue: 1.25, tariffRp: Math.round(F.tariffs.campusCHFPerKWh * 100), renewable: true, heatReuse: true,
      fitOutCHF: F.offer.fitOutCHF, migrationCHF: F.offer.migrationCHF, migrationTiming: "boundary", propertySharePct: 50,
      fibrePairs: 2, fibreGbps: 100, trackside: "dual", edge: true, cloudOnRamp: false,
    },
  },
  gl2028: {
    id: "gl2028",
    label: "Digital Realty + HPE GreenLake 2028",
    short: "DR + GreenLake 2028",
    inputs: {
      season: 2028,
      nodes: 8, coresPerNode: 128, clockGHz: 3.0, cpuArch: "today", gpus: 8, solverGpus: 2, gpuModel: "b200", gpuChargePct: 100,
      memoryGB: 768, interconnect: "slingshot", storage: "flash", consumption: "greenlake", committedPct: 80, termYears: 5,
      support: "mission", refreshYears: 3, leadWeeks: -6,
      location: "dr", hinwilRetrofit: false, committedKW: F.offer.committedKW, mlPartitionKW: 0, mlPlacement: "dr", rackKW: 60, cooling: "dlc", redundancy: "2n",
      pueMode: "derived", pueValue: 1.15, tariffRp: Math.round(F.tariffs.campusCHFPerKWh * 100), renewable: true, heatReuse: true,
      fitOutCHF: F.offer.fitOutCHF, migrationCHF: F.offer.migrationCHF, migrationTiming: "boundary", propertySharePct: 50,
      fibrePairs: 2, fibreGbps: 400, trackside: "dualsat", edge: true, cloudOnRamp: true,
    },
  },
}
export const PRESET_ORDER = ["today", "dr2027", "gl2028"]

/** The baseline ("Today's setup") carried into the given season, keeping position, confidence and the latency venue. */
export function todayInputs(season, position = DEFAULTS.position, confidence = DEFAULTS.confidence, venue = DEFAULTS.venue) {
  return normalize({ ...DEFAULTS, ...PRESETS.today.inputs, season, position, confidence, venue })
}

const ARCH = K.compute.cpuArch
const gpuMauhPerAtp = (fp64) => ((fp64 * 1000) / K.compute.coreFp64GFLOPSPerGHz) * K.fia.atpHours * K.compute.solverShare / 1e6
const gpuOptionLabel = (id) => {
  const g = K.compute.gpu[id]
  return `${g.label} · ${g.fp64} TFLOPS FP64 · ${g.kW} kW · ${gpuMauhPerAtp(g.fp64).toFixed(2)} MAUh per period at 100 %${g.exceedsAllowanceAt100 ? " (exceeds the allowance)" : ""}`
}

/**
 * Control schema shared by the UI, `normalize` and the tests. `why` is the one-line "why it matters";
 * `fia` is the badge text for rules the control touches; `showIf` hides controls that do not apply.
 */
export const GROUPS = [
  {
    id: "fia",
    title: "FIA envelope",
    subtitle: "Aerodynamic Testing Restrictions and the cost cap set the box; everything else decides how much of it you turn into lap time.",
    controls: [
      { id: "season", label: "Season", type: "segmented", options: [{ value: 2027, label: "2027" }, { value: 2028, label: "2028" }], why: "2027 is CPU-only for the Restricted CFD solver; from 1 January 2028 the FIA allows GPU cores (F4.4.1).", fia: "F4.4.1" },
      { id: "position", label: "Constructors' position used for the sliding scale", type: "range", min: 1, max: 11, step: 1, format: (v) => `P${v} · ${K.fia.scale[v - 1]} %`, why: "P1 gets 70 % of the baseline allowance, P10 or lower 115 %. ATPs 1–3 use last season's final position, ATPs 4–6 the position after ATP 3.", fia: "F4.6.1" },
      { id: "confidence", label: "Model confidence", type: "range", min: 0, max: 100, step: 5, unit: "%", why: "Scales every modelled lap-time gain. 100 % is the model's central estimate; the room decides how much of it to believe.", fia: null },
    ],
  },
  {
    id: "compute",
    title: "Compute (HPE via HPE GreenLake)",
    subtitle: "The Restricted CFD cluster: what you buy, how you run it and how you pay for it.",
    controls: [
      { id: "nodes", label: "CPU nodes", type: "range", min: 0, max: 40, step: 1, why: "More nodes finish more runs per period, until the MAUh allowance throttles them. The allowance counts cores × hours × clock, not work done.", fia: "F4.4.4" },
      { id: "coresPerNode", label: "Cores per node", type: "segmented", options: [64, 96, 128, 192].map((v) => ({ value: v, label: String(v) })), why: "Denser nodes cut interconnect traffic per core and rack count; the FIA counts physical cores, SMT is ignored.", fia: "F4.4.4" },
      { id: "clockGHz", label: "Declared clock (CCF)", type: "range", min: 2.0, max: 4.0, step: 0.1, unit: "GHz", format: (v) => `${v.toFixed(1)} GHz`, why: "AUh are charged at the peak clock you declare, but memory-bound CFD work grows slower than clock. Running lower and wider buys more work per MAUh at the price of more nodes. The CCF may not be declared below the base clock of the part (64 cores 2.4 GHz, 96 cores 2.3, 128 cores 2.4, 192 cores 2.25).", fia: "F4.4.2" },
      { id: "cpuArch", label: "Processor architecture", type: "select", options: Object.entries(ARCH).map(([value, o]) => ({ value, label: `${o.label} · ${(o.workPerAuh[2027] - 1) * 100 >= 0 ? "+" : ""}${Math.round((o.workPerAuh[2027] - 1) * 100)} % / ${(o.workPerAuh[2028] - 1) * 100 >= 0 ? "+" : ""}${Math.round((o.workPerAuh[2028] - 1) * 100)} % work per AUh` })), why: `Big caches and fast memory finish the same CFD work with fewer trips to memory, and the FIA charges cores × clock, not work done. A separate multiplier from the refresh cadence: equal core generation, equal declared clock. Parts: ${Object.values(ARCH).map((o) => `${o.label}: ${o.part[2027]} → ${o.part[2028]}`).join("; ")}. Parts for 2028 (Venice-X, Xeon 7) launch in 2027; Arm needs the team's solver re-validated.`, fia: "F4.4.4" },
      { id: "memoryGB", label: "Memory per node", type: "segmented", options: [{ value: 384, label: "384 GB" }, { value: 768, label: "768 GB" }, { value: 1536, label: "1.5 TB" }], why: "Small memory splits large meshes over more nodes; beyond 768 GB only very large meshes benefit.", fia: null },
      { id: "interconnect", label: "Interconnect", type: "select", options: [{ value: "eth100", label: "100G Ethernet" }, { value: "eth200", label: "200G Ethernet" }, { value: "ibndr", label: "InfiniBand NDR 400G" }, { value: "slingshot", label: "HPE Slingshot 400G" }], why: "Message-passing time counts toward AUh (F4.4.4). A faster fabric spends fewer of your metered seconds waiting.", fia: "F4.4.4" },
      { id: "storage", label: "Storage tier", type: "select", options: [{ value: "nas", label: "NAS (3 GB/s)" }, { value: "pfs", label: "Parallel file system (25 GB/s)" }, { value: "flash", label: "Parallel + flash tier (80 GB/s)" }], why: "Solvers that wait on I/O still burn metered core-hours.", fia: null },
      { id: "gpus", label: "Accelerators (GPUs)", type: "range", min: 0, max: 32, step: 1, why: "Unrestricted GPUs speed up meshing, post-processing and machine learning on simulation results, which do not accrue AUh (F4.4.4).", fia: "F4.4.4" },
      { id: "solverGpus", label: "… of which run Restricted CFD", type: "range", min: 0, max: 32, step: 1, showIf: (x) => x.gpus > 0, why: "Allowed from 2028 only. Each solver GPU is charged in FP64-normalised core-equivalents until the FIA publishes its rule.", fia: "F4.4.1 · 2028" },
      { id: "gpuModel", label: "Accelerator class", type: "select", options: Object.keys(K.compute.gpu).map((value) => ({ value, label: gpuOptionLabel(value) })), showIf: (x) => x.gpus > 0, why: "FP64 peak sets the assumed AUh charge (a part 8 × faster at precise maths is charged 8 × more, so an MI430X-class part exceeds the whole P8 allowance at a 100 % charge); power sets the cooling you need. B300-class parts have almost no FP64 and are not offered for the solver.", fia: "F4.4.1 · open" },
      { id: "gpuChargePct", label: "Assumed GPU charge factor", type: "range", min: 25, max: 100, step: 5, unit: "%", showIf: (x) => x.solverGpus > 0, why: "No GPU-to-AUh conversion is published. 100 % charges the full FP64 core-equivalent; lower values test a kinder rule.", fia: "F4.4.1 · open" },
      { id: "consumption", label: "Consumption model", type: "segmented", options: [{ value: "buy", label: "Buy" }, { value: "greenlake", label: "HPE GreenLake" }], why: "GreenLake meters usage above a reserved share and keeps a buffer on site; buying puts the whole cluster on the balance sheet and in the cost cap through depreciation.", fia: "D6.1.1.k" },
      { id: "committedPct", label: "GreenLake reserved capacity", type: "range", min: 60, max: 100, step: 5, unit: "%", showIf: (x) => x.consumption === "greenlake", why: "The share you commit to pay for every month; usage above it is metered, the 20 % buffer is charged only when used.", fia: null },
      { id: "termYears", label: "GreenLake term", type: "segmented", options: [{ value: 3, label: "3 years" }, { value: 5, label: "5 years" }], showIf: (x) => x.consumption === "greenlake", why: "A shorter term costs more per year and refreshes sooner.", fia: null },
      { id: "support", label: "Support SLA", type: "select", options: [{ value: "nbd", label: "Next business day" }, { value: "4h", label: "4-hour response" }, { value: "mission", label: "24×7 mission-critical, on-site spares" }], why: "A failed node in week 7 of a period is allowance you never get back.", fia: null },
      { id: "refreshYears", label: "Refresh cadence", type: "segmented", options: [{ value: 3, label: "3 yr" }, { value: 4, label: "4 yr" }, { value: 5, label: "5 yr" }], why: "Newer cores do more per clock, and the FIA charges clock, not work. Shorter cadences cost more per year.", fia: "F4.4.4" },
      { id: "leadWeeks", label: "Delivery vs 1 January", type: "range", min: -8, max: 12, step: 1, format: (v) => (v === 0 ? "On 1 Jan" : v < 0 ? `${-v} wk early` : `${v} wk late`), plannedBy: "timeline", why: "ATP 1 starts on 1 January. Every week the hardware is late wastes 1/52 of the year's allowance.", fia: "F4.1.4" },
    ],
  },
  {
    id: "facility",
    title: "Facility (Digital Realty Zurich)",
    subtitle: "Where the cluster lives decides power, cooling, availability, PUE and what the finance team can keep outside the cap.",
    controls: [
      { id: "location", label: "Location", type: "segmented", options: [{ value: "hinwil", label: "Hinwil room" }, { value: "dr", label: "Digital Realty Zurich" }, { value: "hybrid", label: "Hybrid" }], why: "Hybrid keeps Mission Control, the simulator and office IT in Hinwil and moves the heavy estate 30 km to the campus over dark fibre.", fia: "F4.4.3" },
      { id: "hinwilRetrofit", label: "Retrofit the Hinwil room", type: "toggle", showIf: (x) => x.location !== "dr", why: `CHF ${(K.prices.hinwilRetrofitCHF / 1e6).toFixed(1)} M for 450 kW, N+1 and about 0.2 off the PUE; a Property Cost outside the cap.`, fia: "D5.1.1.j" },
      { id: "committedKW", label: "Committed IT power at Digital Realty", type: "range", min: 250, max: K.facility.envelopeKW, step: 25, unit: "kW", showIf: (x) => x.location !== "hinwil", why: `The fee follows the commitment. The offer is ${K.facility.envelopeKW} kW of critical IT in both seasons: the estate must fit inside it; more kW is a separate commercial conversation (ZUR4 adds 15 MW on the campus in 2028).`, fia: null },
      { id: "mlPartitionKW", label: "Unrestricted ML / GPU partition", type: "range", min: 0, max: K.facility.mlPartitionMaxKW, step: 25, unit: "kW", why: "Machine learning and other unrestricted accelerators: no AUh, but the kW count against the envelope wherever the partition is placed. The model takes it off what is left for the metered cluster.", fia: "F4.4.4" },
      { id: "mlPlacement", label: "ML partition placement", type: "segmented", options: [{ value: "dr", label: "Digital Realty" }, { value: "hinwil", label: "Hinwil room" }, { value: "cloud", label: "Cloud (on-ramps)" }], showIf: (x) => x.mlPartitionKW > 0, why: "At the campus it uses envelope power; in the Hinwil room it uses the room's power; in the cloud it uses neither and is paid by the hour over the cloud on-ramps.", fia: null },
      { id: "rackKW", label: "Rack density", type: "range", min: 10, max: 150, step: 5, unit: "kW/rack", why: "Hard ceilings at Digital Realty: air 20 kW, rear-door exchangers 70 kW, direct liquid 150 kW per rack. In the Hinwil room too dense for the cooling means throttled silicon that still accrues AUh.", fia: null },
      { id: "cooling", label: "Cooling", type: "segmented", options: [{ value: "air", label: "Air" }, { value: "reardoor", label: "Rear-door" }, { value: "dlc", label: "Direct liquid" }], why: "Cooling sets the PUE and the rack density you can run; accelerators need rear-door or liquid. Direct liquid at the campus adds a one-off for CDUs and manifolds.", fia: null },
      { id: "redundancy", label: "Power & cooling redundancy", type: "segmented", options: [{ value: "n", label: "N" }, { value: "n1", label: "N+1" }, { value: "2n", label: "2N" }], why: `An outage inside a period is allowance lost. ZUR2 runs 2N UPS and N+2 cooling. 2N (A+B) does not halve the usable kW: each feed carries at most ${Math.round(K.facility.feedLoadingMax * 100)} % of its rating so one feed can carry everything after a failure.`, fia: null },
      { id: "pueMode", label: "PUE", type: "segmented", options: [{ value: "derived", label: "Derived" }, { value: "override", label: "Override" }], why: "Derived from site and cooling; override to test a quote.", fia: null },
      { id: "pueValue", label: "PUE override", type: "range", min: 1.1, max: 1.8, step: 0.05, format: (v) => v.toFixed(2), showIf: (x) => x.pueMode === "override", why: "Every 0.1 of PUE on 400 kW of IT is about CHF 45k of power a year inside the cap.", fia: null },
      { id: "tariffRp", label: "Electricity price", type: "range", min: 8, max: 25, step: 1, unit: "Rp/kWh", why: "Hinwil (EKZ) plans at about 16 Rp, the campus (ewz grid, market energy) at about 15 Rp. Power is a Relevant Cost in the cap.", fia: "D5" },
      { id: "renewable", label: "100 % renewable electricity", type: "toggle", why: "Digital Realty's European portfolio already runs on 100 % renewable energy; at Hinwil it is a tariff choice (+1 Rp).", fia: null },
      { id: "heatReuse", label: "Heat reuse", type: "toggle", showIf: (x) => x.location !== "hinwil", why: "The campus feeds its waste heat to the Opfikon network from 2029 and to neighbours before that; heat-recovery costs are Sustainability Initiative Costs, outside the cap.", fia: "D5.1.1" },
      { id: "fitOutCHF", label: "Fit-out (one-off)", type: "range", min: 0, max: 2_000_000, step: 50_000, format: (v) => `CHF ${(v / 1e6).toFixed(2)} M`, showIf: (x) => x.location !== "hinwil", why: "Cage, racks, in-rack power, CDU provision and cabling: a leasehold improvement, outside the cap.", fia: "D5.1.1.j" },
      { id: "migrationCHF", label: "Migration (one-off)", type: "range", min: 0, max: 1_000_000, step: 50_000, format: (v) => `CHF ${(v / 1e6).toFixed(2)} M`, showIf: (x) => x.location !== "hinwil", why: "Move, parallel running and services; an operating cost in the year of the move.", fia: null },
      { id: "migrationTiming", label: "Migration timing", type: "segmented", options: [{ value: "boundary", label: "At an ATP boundary" }, { value: "midperiod", label: "Mid-period" }], showIf: (x) => x.location !== "hinwil", plannedBy: "timeline", why: "A new declaration is due within a month of moving any part of the cluster (F4.4.3); moving inside a period wastes solver days of a use-it-or-lose-it allowance.", fia: "F4.4.3" },
      { id: "propertySharePct", label: "Share of the fee treated as Property Costs", type: "range", min: 0, max: 100, step: 10, unit: "%", showIf: (x) => x.location !== "hinwil", why: "Property Costs (rent, lease costs, leasehold improvements) are outside the cap; the service share of a colocation fee is inside. Open point for the team's finance function (C3).", fia: "D5.1.1.j" },
    ],
  },
  {
    id: "connectivity",
    title: "Connectivity & trackside",
    subtitle: "Hinwil ↔ campus fibre, the paddock link and where the first pass over telemetry happens.",
    controls: [
      { id: "fibrePairs", label: "Hinwil ↔ campus fibre routes", type: "segmented", options: [{ value: 1, label: "1 route" }, { value: 2, label: "2 diverse routes" }], showIf: (x) => x.location !== "hinwil", why: "Two diverse routes take the link from about 99.9 % to 99.995 %; the 30 km add about 0.35 ms either way.", fia: null },
      { id: "fibreGbps", label: "Fibre bandwidth", type: "segmented", options: [{ value: 10, label: "10G" }, { value: 100, label: "100G" }, { value: 400, label: "400G" }], showIf: (x) => x.location !== "hinwil", why: "Wind-tunnel and CFD datasets move between sites; 100G keeps engineers from noticing the distance.", fia: null },
      { id: "trackside", label: "Paddock link", type: "select", options: [{ value: "internet", label: "Public internet (encrypted tunnels)" }, { value: "carrier", label: "One carrier circuit (100 Mbps)" }, { value: "dual", label: "Two diverse carrier circuits" }, { value: "dualsat", label: "Two carriers + satellite backup" }], why: "Two cars generate about 1.5 TB each per weekend; the link's availability over 24 race weekends is the strategy loop's weakest point.", fia: "C8.5" },
      { id: "edge", label: "Edge compute in the garage", type: "toggle", why: "A first pass over telemetry at the track takes about 1.5 s out of the data-to-decision loop; F1's own trackside centre cut up to 0.3 s on delivery alone.", fia: null },
      { id: "cloudOnRamp", label: "Cloud on-ramps (ServiceFabric)", type: "toggle", why: "Private AWS Direct Connect and Azure ExpressRoute on the campus for unrestricted ML and analytics bursts, without touching the ATR.", fia: "F4.4.4" },
      { id: "venue", label: "Venue for the latency readout", type: "select", options: K.trackside.venues.map((v) => ({ value: v.id, label: `${v.name} · ${v.rtt} ms` })), why: "Round-trip to Zurich on a private carrier path.", fia: null },
    ],
  },
]

export const CONTROLS = Object.fromEntries(GROUPS.flatMap((g) => g.controls).map((c) => [c.id, c]))

const BOOL_IDS = ["hinwilRetrofit", "renewable", "heatReuse", "edge", "cloudOnRamp"]

/**
 * Fill defaults, coerce types and clamp every input to its control's range or option list. Legacy inputs that
 * still carry the removed `expansionRight` control are accepted: the key is dropped and `legacyExpansionRight`
 * is kept so `flags()` can say that the expansion right is a commercial note, not capacity (E2).
 */
export function normalize(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {}
  const x = { ...DEFAULTS, ...r }
  for (const c of Object.values(CONTROLS)) {
    if (c.type === "toggle") x[c.id] = Boolean(x[c.id])
    else if (c.type === "range") {
      const n = Number(x[c.id])
      const val = Number.isFinite(n) ? n : DEFAULTS[c.id]
      const stepped = Math.round((val - c.min) / c.step) * c.step + c.min
      x[c.id] = round(clamp(stepped, c.min, c.max), 4)
    } else {
      const values = c.options.map((o) => o.value)
      const asNum = Number(x[c.id])
      const match = values.includes(x[c.id]) ? x[c.id] : values.includes(asNum) ? asNum : DEFAULTS[c.id]
      x[c.id] = match
    }
  }
  for (const id of BOOL_IDS) x[id] = Boolean(x[id])
  x.scheduleLoss = round(clamp(finite(Number(x.scheduleLoss), 0), 0, 1), 6)
  x.legacyExpansionRight = Boolean(r.expansionRight) || Boolean(r.legacyExpansionRight)
  delete x.expansionRight
  x.solverGpus = Math.min(x.solverGpus, x.gpus)
  if (x.location === "hinwil") { x.heatReuse = false; if (x.mlPlacement === "dr") x.mlPlacement = "hinwil" }
  if (x.location === "dr") { x.hinwilRetrofit = false; if (x.mlPlacement === "hinwil") x.mlPlacement = "dr" }
  if (x.mlPartitionKW > 0 && x.mlPlacement === "cloud") x.cloudOnRamp = true
  return x
}

// ---------------------------------------------------------------------------------------------
// FIA envelope
// ---------------------------------------------------------------------------------------------

export function fiaEnvelope(x) {
  const pct = K.fia.scale[x.position - 1]
  const f = pct / 100
  const b = K.fia.baseline
  return {
    pct,
    allowance: { mauh: round(b.mauh * f, 3), runs: Math.round(b.runs * f), windOn: round(b.windOn * f, 1), occupancy: Math.round(b.occupancy * f), ratgs: Math.round(b.ratgs * f) },
    gpuSolverAllowed: x.season >= K.fia.gpuAllowedFrom,
    atpHours: K.fia.atpHours,
    costCapCHF: costCapCHF.fia,
  }
}

// ---------------------------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------------------------

/** The processor-architecture row for an input set (K.compute.cpuArch; unknown ids fall back to Today's). */
export const archOf = (x) => ARCH[x.cpuArch] || ARCH[K.compute.cpuArchToday]

/** Lowest declarable CCF: the base clock of the part by core count (H3) or of the chosen architecture, whichever is higher (F4.4.2). */
export function ccfFloor(x) {
  const byCores = K.compute.ccfFloorGHz[x.coresPerNode] ?? CONTROLS.clockGHz.min
  const byArch = archOf(x).baseGHz[x.season] ?? CONTROLS.clockGHz.min
  return round(Math.max(byCores, byArch), 4)
}

export function nodeKW(coresPerNode, clockGHz, archFactor = 1) {
  const k = K.compute.nodeKW
  return k.base + k.perCoreBlock * archFactor * (coresPerNode / 128) * (clockGHz / K.compute.refClockGHz) ** k.clockExponent
}

export function hardware(x) {
  const gpu = K.compute.gpu[x.gpuModel]
  const arch = archOf(x)
  const perNodeKW = nodeKW(x.coresPerNode, x.clockGHz, arch.kwFactor[x.season] ?? 1)
  const nodePrice = K.prices.nodeCHF * (x.coresPerNode / 128) ** K.prices.nodeCoreExponent + K.prices.memoryDeltaCHF[x.memoryGB] + K.prices.interconnectPerNodeCHF[x.interconnect] + (arch.nodeCHF[x.season] ?? 0)
  const gpuPrice = K.prices.gpuCHF[x.gpuModel]
  const clusterKW = x.nodes * perNodeKW + x.gpus * gpu.kW + K.compute.storageKW[x.storage]
  const hardwareCHF = x.nodes * nodePrice + x.gpus * gpuPrice + K.prices.storageCHF[x.storage]
  return {
    cores: x.nodes * x.coresPerNode,
    perNodeKW: round(perNodeKW, 3),
    clusterKW: round(clusterKW, 1),
    racks: clusterKW > 0 ? Math.max(1, Math.ceil(clusterKW / x.rackKW)) : 0,
    nodePriceCHF: Math.round(nodePrice),
    gpuPriceCHF: gpuPrice,
    hardwareCHF: Math.round(hardwareCHF),
    gpu: { ...gpu, id: x.gpuModel, coreEquivalents: round((gpu.fp64 * 1000) / (K.compute.coreFp64GFLOPSPerGHz * K.compute.refClockGHz), 0), mauhPerAtpAt100: round(gpuMauhPerAtp(gpu.fp64), 3) },
    arch: { id: x.cpuArch, label: arch.label, part: arch.part[x.season], workPerAuh: arch.workPerAuh[x.season] ?? 1, kwFactor: arch.kwFactor[x.season] ?? 1, nodeCHF: arch.nodeCHF[x.season] ?? 0, baseGHz: arch.baseGHz[x.season] },
    ccfFloorGHz: ccfFloor(x),
    bufferNodes: x.consumption === "greenlake" ? Math.max(1, Math.round(x.nodes * K.prices.greenlakeBuffer)) : 0,
  }
}

// ---------------------------------------------------------------------------------------------
// Facility
// ---------------------------------------------------------------------------------------------

/**
 * The estate that is not the modelled cluster or the ML partition (J-g). A cluster that stays in the Hinwil room
 * carries the business case's demand (375 / 760 kW, J-f) so Today stays power-short in 2028 (E9); a cluster that
 * moves takes the 375 kW base estate with it, and the 2028 GPU partition becomes the explicit `mlPartitionKW`.
 */
export function estateKW(x) {
  return x.location === "hinwil" ? K.facility.estateDemandKW[x.season] : K.facility.estateBaseKW
}

export function facility(x, hw) {
  const fk = K.facility
  const rest = estateKW(x)
  const ml = x.mlPartitionKW
  const mlAtDr = x.location !== "hinwil" && x.mlPlacement === "dr" ? ml : 0
  const mlAtHinwil = x.location !== "dr" && x.mlPlacement === "hinwil" ? ml : 0
  const mlInCloud = x.mlPlacement === "cloud" ? ml : 0
  let hinwilIT = 0
  let drIT = 0
  let estateAtDr = 0
  if (x.location === "hinwil") hinwilIT = rest + hw.clusterKW + mlAtHinwil
  else if (x.location === "dr") { estateAtDr = rest; drIT = rest + hw.clusterKW + mlAtDr }
  else { estateAtDr = Math.max(0, rest - fk.hybridHinwilKW); hinwilIT = fk.hybridHinwilKW + mlAtHinwil; drIT = estateAtDr + hw.clusterKW + mlAtDr }

  const hinwilCapacity = x.hinwilRetrofit ? K.prices.hinwilRetrofitKW : fk.hinwilCapacityKW
  const drCapacity = fk.envelopeKW
  const racks = {
    estate: estateAtDr > 0 ? Math.ceil(estateAtDr / fk.estateRackKW) : 0,
    cluster: drIT > 0 ? hw.racks : 0,
    ml: mlAtDr > 0 ? Math.ceil(mlAtDr / x.rackKW) : 0,
  }
  racks.total = racks.estate + racks.cluster + racks.ml

  const pueTable = K.facility.pue
  const pueHinwil = x.pueMode === "override" ? x.pueValue : Math.max(1.15, pueTable.hinwil[x.cooling] - (x.hinwilRetrofit ? K.facility.retrofitPueGain : 0))
  const pueDr = x.pueMode === "override" ? x.pueValue : pueTable.dr[x.cooling]
  const totalIT = hinwilIT + drIT
  const pue = totalIT > 0 ? (hinwilIT * pueHinwil + drIT * pueDr) / totalIT : pueDr

  const clusterSite = x.location === "hinwil" ? "hinwil" : "dr"
  const clusterIT = clusterSite === "hinwil" ? hinwilIT : drIT
  const clusterCapacity = clusterSite === "hinwil" ? hinwilCapacity : drCapacity
  const powerShortKW = Math.max(0, clusterIT - clusterCapacity)
  const powerEff = clusterIT > 0 ? Math.min(1, clusterCapacity / clusterIT) : 1
  const hinwilShortKW = Math.max(0, hinwilIT - hinwilCapacity)

  const coolingMax = K.compute.coolingMaxKWPerRack[x.cooling]
  const thermalEff = x.rackKW > coolingMax ? Math.max(0.6, 1 - 0.5 * ((x.rackKW - coolingMax) / coolingMax)) : 1
  const gpuThermalEff = x.gpus > 0 && x.cooling === "air" ? 0.7 : 1

  // Electricity is charged for the whole estate even where a site cannot power it, so the money
  // comparison stays like-for-like; a power shortfall is charged to performance (powerEff) only.
  const energy = (it, p) => (it * K.facility.loadFactor * 8760 * p) / 1000
  const hinwilMWh = energy(hinwilIT, pueHinwil)
  const drMWh = energy(drIT, pueDr)
  const heatShare = x.heatReuse && drIT > 0 ? (x.season >= 2029 ? K.facility.heatReuseShare.from2029 : K.facility.heatReuseShare.before2029) : 0
  const heatMWh = (drIT * K.facility.loadFactor * 8760 * heatShare) / 1000

  const availability = K.facility.availability[x.redundancy]

  return {
    clusterSite, hinwilIT: round(hinwilIT, 1), drIT: round(drIT, 1), totalIT: round(totalIT, 1),
    estateKW: rest, estateAtDr: round(estateAtDr, 1), mlAtDr, mlAtHinwil, mlInCloud,
    hinwilCapacity, drCapacity, drHeadroomKW: round(drCapacity - drIT, 1), powerShortKW: round(powerShortKW, 1), hinwilShortKW: round(hinwilShortKW, 1), powerEff,
    racks,
    pue: round(pue, 3), pueHinwil: round(pueHinwil, 3), pueDr: round(pueDr, 3),
    facilityKW: round(totalIT * pue, 1), drFacilityKW: round(drIT * pueDr, 1),
    coolingMax, thermalEff: round(thermalEff, 4), gpuThermalEff,
    hinwilMWh: round(hinwilMWh, 1), drMWh: round(drMWh, 1), totalMWh: round(hinwilMWh + drMWh, 1),
    heatMWh: round(heatMWh, 1), heatShare,
    availability,
    billedKW: drIT > 0 ? Math.max(x.committedKW, Math.min(drIT, drCapacity)) : 0,
  }
}

// ---------------------------------------------------------------------------------------------
// The 500 kW envelope: what "fits" means (E1–E12) and the closed-form ceilings the sliders draw
// ---------------------------------------------------------------------------------------------

const COOLING_WORD = { air: "air", reardoor: "rear-door", dlc: "direct-liquid" }

/**
 * The fit test every scenario is evaluated against. A scenario fits when every row holds; each failing row adds a
 * short reason. The allowance (usage > 100 %) is a warning the model already throttles for, not a fit row.
 */
export function envelope(x, hw = hardware(x), fac = facility(x, hw)) {
  const fk = K.facility
  const reasons = []
  const atDr = x.location !== "hinwil"
  if (atDr && fac.drIT > fk.envelopeKW + 1e-9) reasons.push(`Digital Realty: ${Math.round(fac.drIT)} kW > ${fk.envelopeKW} kW offer`)
  if (x.location === "hybrid" && fac.hinwilIT > fac.hinwilCapacity + 1e-9) reasons.push(`Hinwil keeps ${Math.round(fac.hinwilIT)} kW against ${fac.hinwilCapacity} kW`)
  if (atDr && x.rackKW > fac.coolingMax) reasons.push(`${x.rackKW} kW racks exceed the ${fac.coolingMax} kW ${COOLING_WORD[x.cooling]} ceiling`)
  if (atDr && fac.racks.total > fk.cageRackPositions) reasons.push(`${fac.racks.total} racks > ${fk.cageRackPositions} cage positions`)
  const notes = x.legacyExpansionRight ? ["Expansion right is not part of the 500 kW offer (commercial note)"] : []
  if (x.season < K.fia.gpuAllowedFrom && x.solverGpus > 0) reasons.push(`GPU solver not allowed in ${x.season} (F4.4.1)`)
  const floor = hw.ccfFloorGHz
  if (x.nodes > 0 && x.clockGHz < floor - 1e-9) reasons.push(`CCF ${x.clockGHz} GHz below the ${floor} GHz base clock of a ${x.coresPerNode}-core ${hw.arch.id === K.compute.cpuArchToday ? "part" : hw.arch.part} (F4.4.2)`)
  if (x.mlPlacement === "cloud" && x.mlPartitionKW > 0 && !x.cloudOnRamp) reasons.push("ML partition in the cloud needs the cloud on-ramps")
  const offerKW = fk.envelopeKW
  return {
    fits: reasons.length === 0, reasons, notes,
    offerKW, drIT: fac.drIT, headroomKW: atDr ? round(offerKW - fac.drIT, 1) : null, share: atDr ? round(fac.drIT / offerKW, 4) : 0,
    tone: !atDr ? (fac.powerShortKW > 0 ? "bad" : "ok") : fac.drIT > offerKW ? "bad" : fac.drIT > 0.9 * offerKW ? "warn" : "ok",
    hinwilIT: fac.hinwilIT, hinwilCapacity: fac.hinwilCapacity, estateAtDr: fac.estateAtDr, clusterKW: hw.clusterKW,
    mlPartitionKW: x.mlPartitionKW, mlPlacement: x.mlPlacement, mlAtDr: fac.mlAtDr,
    racks: fac.racks, cageRackPositions: fk.cageRackPositions, facilityKW: fac.drFacilityKW,
  }
}

const floorToStep = (v, step) => Math.floor((v + 1e-9) / step) * step

/**
 * Closed-form per-control ceilings (and the CCF floor) that keep the scenario inside the envelope with every other
 * input fixed: what the sliders draw as a tick and clamp to. Values are in the control's own units; `null` means
 * the envelope does not bind that control for this scenario (the cluster is in the Hinwil room).
 */
export function ceilings(raw) {
  const x = normalize(raw)
  const hw = hardware(x)
  const fac = facility(x, hw)
  const fk = K.facility
  const gpuKW = K.compute.gpu[x.gpuModel].kW
  const storageKW = K.compute.storageKW[x.storage]
  const atDr = x.location !== "hinwil"
  const c = CONTROLS
  const out = {
    clockGHz: { min: hw.ccfFloorGHz, max: c.clockGHz.max },
    rackKW: { max: atDr ? Math.min(c.rackKW.max, fac.coolingMax) : c.rackKW.max },
    committedKW: { max: fk.envelopeKW },
    solverGpus: { max: x.season >= K.fia.gpuAllowedFrom ? x.gpus : 0 },
    nodes: { max: c.nodes.max }, gpus: { max: c.gpus.max }, mlPartitionKW: { max: c.mlPartitionKW.max },
  }
  if (atDr) {
    const fixed = fac.estateAtDr + fac.mlAtDr + storageKW
    out.nodes.max = clamp(Math.floor((fk.envelopeKW - fixed - x.gpus * gpuKW) / hw.perNodeKW + 1e-9), 0, c.nodes.max)
    out.gpus.max = clamp(Math.floor((fk.envelopeKW - fixed - x.nodes * hw.perNodeKW) / gpuKW + 1e-9), 0, c.gpus.max)
    // the clock raises node power: the largest declared clock whose node kW still fits
    const kwPerNodeMax = x.nodes > 0 ? (fk.envelopeKW - fixed - x.gpus * gpuKW) / x.nodes : Infinity
    const kn = K.compute.nodeKW
    const archF = hw.arch.kwFactor
    const clockMax = kwPerNodeMax > kn.base ? K.compute.refClockGHz * ((kwPerNodeMax - kn.base) / (kn.perCoreBlock * archF * (x.coresPerNode / 128))) ** (1 / kn.clockExponent) : hw.ccfFloorGHz
    out.clockGHz.max = clamp(round(Math.floor(clockMax * 10 + 1e-6) / 10, 4), hw.ccfFloorGHz, c.clockGHz.max)
  }
  if (x.mlPlacement === "dr" && atDr) out.mlPartitionKW.max = clamp(floorToStep(fk.envelopeKW - fac.estateAtDr - hw.clusterKW, c.mlPartitionKW.step), 0, c.mlPartitionKW.max)
  else if (x.mlPlacement === "hinwil") out.mlPartitionKW.max = clamp(floorToStep(fac.hinwilCapacity - (x.location === "hinwil" ? estateKW(x) + hw.clusterKW : fk.hybridHinwilKW), c.mlPartitionKW.step), 0, c.mlPartitionKW.max)
  out.fits = envelope(x, hw, fac).fits
  return out
}

/**
 * The clamps in the order the "Fit to the envelope" button applies them: ML partition → GPUs → nodes → rack density
 * (→ CCF floor). Returns the clamped inputs and the list of changes.
 */
export function fitToEnvelope(raw) {
  let x = normalize(raw)
  const changes = []
  const apply = (id, value) => { if (value !== x[id]) { changes.push({ id, from: x[id], to: value }); x = normalize({ ...x, [id]: value }) } }
  for (const id of ["mlPartitionKW", "gpus", "nodes", "rackKW"]) {
    const cap = ceilings(x)[id].max
    if (x[id] > cap) apply(id, cap)
  }
  const floor = ceilings(x).clockGHz.min
  if (x.nodes > 0 && x.clockGHz < floor) apply("clockGHz", floor)
  return { inputs: x, changes, fits: ceilings(x).fits }
}

// ---------------------------------------------------------------------------------------------
// Compute: AUh, throttling, efficiency, effective work, turnaround
// ---------------------------------------------------------------------------------------------

export function compute(x, fia, hw, fac) {
  const c = K.compute
  const hours = fia.atpHours * c.solverShare
  const gpuSolverN = fia.gpuSolverAllowed ? x.solverGpus : 0
  const gpuAuhPerHour = (hw.gpu.fp64 * 1000) / c.coreFp64GFLOPSPerGHz
  const cpuAuh = hw.cores * x.clockGHz * hours
  const gpuAuh = gpuSolverN * gpuAuhPerHour * hours * (x.gpuChargePct / 100)
  const usedMauh = (cpuAuh + gpuAuh) / 1e6
  const usage = fia.allowance.mauh > 0 ? usedMauh / fia.allowance.mauh : 0
  const throttle = usage > 1 ? 1 / usage : 1
  const hoursRun = hours * throttle

  const icEff = 1 - c.interconnectLossPer8Nodes[x.interconnect] * (Math.min(x.nodes, c.jobNodesCpu) / c.jobNodesCpu)
  const ioDemand = x.nodes * c.ioDemandGBsPerCpuNode + x.gpus * c.ioDemandGBsPerGpu
  const ioSupply = c.storageGBs[x.storage]
  const ioEff = ioDemand <= ioSupply ? 1 : 0.75 + 0.25 * (ioSupply / ioDemand)
  const memF = c.memoryFactor[x.memoryGB]
  const ipc = c.ipcByRefresh[x.refreshYears]
  const archF = hw.arch.workPerAuh
  const clockWork = c.refClockGHz * (x.clockGHz / c.refClockGHz) ** c.clockWorkExponent
  const cpuPerCoreHour = clockWork * ipc * archF * memF * icEff * ioEff * fac.thermalEff
  const gpuPerHour = gpuAuhPerHour * c.gpuWorkPerAuh * c.interconnectGpuFactor[x.interconnect] * ioEff * fac.gpuThermalEff

  // A throttled cluster has idle nodes to fail over to, so failures only bite on the share that runs.
  const servers = x.nodes + Math.ceil(x.gpus / 8)
  const nodeLoss = Math.min(0.2, (servers * c.mttrHours[x.support] * c.failureImpact * throttle) / c.nodeMtbfHours)
  const fibreLoss = x.location === "hinwil" ? 0 : (1 - K.trackside.fibreAvailability[x.fibrePairs]) * 0.5
  const availEff = fac.availability * (1 - nodeLoss) * (1 - fibreLoss)
  // Arm parts need the proprietary solver re-validated before the first metered run (K-d): weeks off the delivery slider
  const armPortWeeks = archOf(x).portFlag && x.nodes > 0 ? c.armPortWeeks : 0
  const effectiveLeadWeeks = x.leadWeeks + armPortWeeks
  const deliveryEff = 1 - Math.max(0, effectiveLeadWeeks) / c.deliveryLossWeeksPerYear
  const migrationEff = x.location !== "hinwil" && x.migrationTiming === "midperiod" ? 1 - K.facility.migrationLossDays / 365 : 1
  const scheduleEff = 1 - x.scheduleLoss
  const siteEff = availEff * deliveryEff * migrationEff * scheduleEff * fac.powerEff

  const cpuWork = hw.cores * hoursRun * cpuPerCoreHour
  const gpuWork = gpuSolverN * hoursRun * gpuPerHour
  const effectiveMauh = ((cpuWork + gpuWork) * siteEff) / 1e6
  const effectiveRatio = fia.allowance.mauh > 0 ? effectiveMauh / fia.allowance.mauh : 0
  const workPerAuh = usedMauh > 0 ? (cpuWork + gpuWork) / 1e6 / Math.min(usedMauh, fia.allowance.mauh) : 0

  const runWork = c.runCoreHours * c.refClockGHz
  const cpuJobRate = Math.min(x.nodes, c.jobNodesCpu) * x.coresPerNode * cpuPerCoreHour
  const gpuJobRate = Math.min(gpuSolverN, c.jobGpus) * gpuPerHour
  const jobRate = Math.max(cpuJobRate, gpuJobRate)
  const solverHours = jobRate > 0 ? runWork / jobRate : Infinity
  const prePostHours = Math.max(0.5, 1.5 - 0.125 * (x.gpus - gpuSolverN))
  const turnaroundHours = solverHours + prePostHours
  const runsPerAtp = (effectiveMauh * 1e6) / runWork
  const weeksPerAtp = fia.atpHours / 168

  return {
    hours, hoursRun: round(hoursRun, 1), gpuSolverN, gpuBlocked: x.solverGpus > 0 && !fia.gpuSolverAllowed,
    cpuMauh: round(cpuAuh / 1e6, 3), gpuMauh: round(gpuAuh / 1e6, 3), usedMauh: round(usedMauh, 3), usage: round(usage, 4), throttle: round(throttle, 4),
    idleShare: round(1 - throttle, 4), unusedShare: round(Math.max(0, 1 - usage), 4),
    eff: { interconnect: round(icEff, 4), io: round(ioEff, 4), memory: memF, ipc, arch: archF, thermal: fac.thermalEff, gpuThermal: fac.gpuThermalEff, availability: round(availEff, 5), delivery: round(deliveryEff, 4), migration: round(migrationEff, 4), schedule: round(scheduleEff, 5), power: round(fac.powerEff, 4), site: round(siteEff, 5) },
    armPortWeeks, effectiveLeadWeeks,
    ioDemandGBs: round(ioDemand, 1), ioSupplyGBs: ioSupply,
    clockWorkPerAuh: round(clockWork / x.clockGHz, 4),
    workPerAuh: round(workPerAuh, 4),
    effectiveMauh: round(effectiveMauh, 3), effectiveRatio: round(effectiveRatio, 4),
    availabilityPct: round(availEff * 100, 3), lostHoursPerYear: round((1 - availEff) * 8760, 1),
    solverHours: finite(solverHours, Infinity), prePostHours, turnaroundHours: finite(turnaroundHours, Infinity),
    runsPerAtp: round(runsPerAtp, 0), runsPerWeek: round(runsPerAtp / weeksPerAtp, 1), runsPerDay: round(runsPerAtp / (fia.atpHours / 24), 1),
  }
}

// ---------------------------------------------------------------------------------------------
// Trackside
// ---------------------------------------------------------------------------------------------

export function trackside(x) {
  const t = K.trackside
  const profile = t.profiles[x.trackside]
  const fibreMs = x.location === "hinwil" ? 0 : F.sites.campus.rttMs
  const row = (v) => {
    const rtt = v.rtt + profile.jitterMs + fibreMs
    const decisionSec = t.decisionBaseSec + (t.decisionRoundTrips * rtt) / 1000 - (x.edge ? t.edgeSavingSec : 0)
    return { id: v.id, name: v.name, rttMs: round(rtt, 2), decisionSec: round(decisionSec, 2) }
  }
  const venues = t.venues.map(row)
  const venue = venues.find((v) => v.id === x.venue) || venues[0]
  const headroom = profile.mbps / t.telemetryPeakMbps
  const linkAvailability = profile.availability * (x.location === "hinwil" ? t.fibreAvailability[1] : t.fibreAvailability[x.fibrePairs])
  const quality = 0.5 * clamp((8 - venue.decisionSec) / 4, 0, 1) + 0.3 * clamp((linkAvailability - 0.98) / 0.02, 0, 1) + 0.2 * clamp(headroom / 2, 0, 1)
  const meanDecisionSec = venues.reduce((s, v) => s + v.decisionSec, 0) / venues.length
  return {
    profile: { id: x.trackside, ...profile },
    venue, venues,
    garageMs: t.garageMs,
    headroom: round(headroom, 2), telemetryPeakMbps: t.telemetryPeakMbps,
    linkAvailability: round(linkAvailability, 5),
    weekendsLost: round((1 - linkAvailability) * t.raceWeekends, 2),
    raceWeekends: t.raceWeekends,
    meanDecisionSec: round(meanDecisionSec, 2),
    decisionTargetSec: t.decisionTargetSec,
    inTime: venue.decisionSec <= t.decisionTargetSec,
    quality: round(quality, 4),
  }
}

// ---------------------------------------------------------------------------------------------
// Money, cost cap, sustainability
// ---------------------------------------------------------------------------------------------

export function costs(x, hw, fac, comp, net) {
  const p = K.prices
  const buy = x.consumption === "buy"
  const committed = x.committedPct / 100
  const utilisation = Math.max(committed, Math.min(1, comp.throttle))
  const glUplift = p.greenlakeUplift + (1 - committed) * p.greenlakeFlexPremium
  const itYearly = buy ? hw.hardwareCHF / x.refreshYears : (hw.hardwareCHF / x.termYears) * glUplift * utilisation
  const support = hw.hardwareCHF * (buy ? K.compute.supportRate[x.support] : Math.max(0, K.compute.supportRate[x.support] - K.compute.supportRate.nbd))
  const software = buy ? hw.hardwareCHF * K.compute.softwareRate : 0
  const hinwilTariff = (x.tariffRp + (x.renewable && fac.hinwilIT > 0 ? K.facility.renewableTariffUpliftRp : 0)) / 100
  const drTariff = x.tariffRp / 100
  const power = fac.hinwilMWh * 1000 * hinwilTariff + fac.drMWh * 1000 * drTariff
  const fee = fac.billedKW * p.feeCHFPerKWMonth * 12
  const crossConnects = fac.drIT > 0 ? 2 * p.crossConnectCHFPerMonth * 12 : 0
  const fibre = fac.drIT > 0 ? x.fibrePairs * p.fibrePairCHFPerYear * p.fibreBandwidthFactor[x.fibreGbps] : 0
  const tracksideCHF = p.tracksideCHFPerYear[x.trackside]
  const edgeOpex = x.edge ? p.edgeCHFPerYear : 0
  const edgeDep = x.edge ? p.edgeCapexCHF / F.fia.depreciationYearsIT : 0
  const cloud = x.cloudOnRamp ? p.cloudOnRampCHFPerYear : 0

  const oneOffs = []
  if (fac.drIT > 0) {
    oneOffs.push({ id: "fitout", label: "Digital Realty fit-out", chf: x.fitOutCHF, cap: "excluded", why: "Leasehold improvement: Property Costs (D5.1.1.j)" })
    oneOffs.push({ id: "migration", label: "Migration and parallel running", chf: x.migrationCHF, cap: "included", why: "Operating cost in the year of the move" })
    if (x.cooling === "dlc") oneOffs.push({ id: "liquidrows", label: "Liquid rows at Digital Realty (CDUs, manifolds)", chf: p.drLiquidRowsCHF, cap: "excluded", why: "Leasehold improvement for direct-liquid rows (J-h)" })
  }
  if (fac.hinwilIT > 0 && x.location === "hinwil") {
    if (x.hinwilRetrofit) oneOffs.push({ id: "retrofit", label: "Hinwil room retrofit", chf: p.hinwilRetrofitCHF, cap: "excluded", why: "Property: depreciation of buildings and plant is excluded (D5.1.1.o)" })
    else oneOffs.push({ id: "patch", label: "Keeping the Hinwil room alive", chf: p.hinwilPatchCHF, cap: "excluded", why: "Property repairs" })
    if (x.cooling === "dlc") oneOffs.push({ id: "loop", label: "Hinwil liquid loop", chf: K.facility.hinwilLiquidLoopCHF, cap: "excluded", why: "Building plant" })
    if (x.cooling === "reardoor") oneOffs.push({ id: "reardoor", label: "Hinwil rear-door branch", chf: K.facility.hinwilRearDoorCHF, cap: "excluded", why: "Building plant" })
  }
  if (x.edge) oneOffs.push({ id: "edge", label: "Edge compute in the garage", chf: p.edgeCapexCHF, cap: "included", why: `Depreciated over ${F.fia.depreciationYearsIT} years` })
  const oneOffTotal = oneOffs.reduce((s, o) => s + o.chf, 0)
  const plantDep = oneOffs.filter((o) => o.cap === "excluded").reduce((s, o) => s + o.chf, 0) / K.fia.depreciationYearsPlant

  const propertyShare = x.propertySharePct / 100
  const lines = [
    { id: "it", label: buy ? `Cluster depreciation (${x.refreshYears} yr)` : `HPE GreenLake charge (${x.termYears} yr, ${Math.round(utilisation * 100)} % metered)`, chf: itYearly, cap: itYearly },
    { id: "support", label: "Support", chf: support, cap: support },
    { id: "software", label: "Software and maintenance", chf: software, cap: software },
    { id: "power", label: "Electricity", chf: power, cap: power },
    { id: "fee", label: "Digital Realty committed kW", chf: fee, cap: fee * (1 - propertyShare) },
    { id: "cross", label: "Cross-connects", chf: crossConnects, cap: crossConnects },
    { id: "fibre", label: "Hinwil ↔ campus fibre", chf: fibre, cap: fibre },
    { id: "trackside", label: "Paddock connectivity", chf: tracksideCHF, cap: tracksideCHF },
    { id: "edge", label: "Edge compute", chf: edgeOpex + edgeDep, cap: edgeOpex + edgeDep },
    { id: "cloud", label: "Cloud on-ramps", chf: cloud, cap: cloud },
    { id: "plant", label: "Fit-out and plant depreciation", chf: plantDep, cap: 0 },
  ].filter((l) => l.chf > 0)
  const yearly = lines.reduce((s, l) => s + l.chf, 0)
  const capCharge = lines.reduce((s, l) => s + l.cap, 0)
  const opexForTco = support + software + power + fee + crossConnects + fibre + tracksideCHF + edgeOpex + cloud
  const tco3 = (buy ? hw.hardwareCHF : itYearly * 3) + 3 * opexForTco + oneOffTotal

  const co2Location = (fac.totalMWh * K.facility.gridCO2) / 1000
  const co2Market = (fac.hinwilMWh * (x.renewable ? 0 : K.facility.gridCO2)) / 1000
  const co2Heat = (fac.heatMWh * K.facility.heatDisplacedKgPerMWh) / 1000

  return {
    utilisation: round(utilisation, 3),
    lines: lines.map((l) => ({ ...l, chf: Math.round(l.chf), cap: Math.round(l.cap) })),
    oneOffs, oneOffTotal: Math.round(oneOffTotal),
    yearly: Math.round(yearly), capCharge: Math.round(capCharge), excludedYearly: Math.round(yearly - capCharge),
    capShare: round(capCharge / costCapCHF.fia, 5),
    tco3: Math.round(tco3),
    costPerEffectiveMauh: comp.effectiveMauh > 0 ? Math.round(capCharge / (comp.effectiveMauh * K.fia.atpPerYear)) : null,
    co2LocationT: round(co2Location, 1), co2MarketT: round(co2Market, 1), co2HeatAvoidedT: round(co2Heat, 1),
    heatMWh: fac.heatMWh,
    hardwareCHF: hw.hardwareCHF,
  }
}

// ---------------------------------------------------------------------------------------------
// Compliance flags
// ---------------------------------------------------------------------------------------------

export function flags(x, fia, hw, fac, comp, env = envelope(x, hw, fac)) {
  const out = []
  const add = (id, level, title, detail, rule = "") => out.push({ id, level, title, detail, rule })
  const pct = Math.round(comp.usage * 100)
  const atDr = x.location !== "hinwil"
  if (comp.usedMauh === 0) add("mauh", "bad", "No Restricted CFD capacity", "Add CPU nodes (or, from 2028, solver GPUs).", "F4.4")
  else if (comp.usage > 1) add("mauh", "warn", `Over capacity: ${pct} % of the ${fia.allowance.mauh} MAUh allowance`, `The cluster can only run ${Math.round(comp.throttle * 100)} % of the period; ${Math.round(comp.idleShare * 100)} % of it idles. Over-use is deducted from the next period (F4.6.10).`, "F4.6.1")
  else if (comp.usage < 0.9) add("mauh", "warn", `Under-using the allowance: ${pct} %`, `${Math.round(comp.unusedShare * 100)} % of the ${fia.allowance.mauh} MAUh allowance is left on the table each period.`, "F4.6.1")
  else add("mauh", "ok", `Within the allowance: ${pct} % of ${fia.allowance.mauh} MAUh`, `P${x.position} on the sliding scale: ${fia.pct} % of the baseline, ${fia.allowance.runs} wind-tunnel runs and ${fia.allowance.windOn} wind-on hours per period.`, "F4.6.1")

  if (comp.gpuBlocked) add("gpu", "bad", "GPU solver not allowed in " + x.season, `GPU cores for the Restricted CFD solver are permitted from 1 January 2028. The ${x.solverGpus} solver GPUs are treated as unrestricted pre/post-processing.`, "F4.4.1")
  else if (comp.gpuSolverN > 0) add("gpu", hw.gpu.exceedsAllowanceAt100 && x.gpuChargePct >= 100 ? "warn" : "ok", `${comp.gpuSolverN} solver GPUs charged at ${x.gpuChargePct} % of FP64 core-equivalents`, `≈ ${hw.gpu.coreEquivalents} core-equivalents each at ${K.compute.refClockGHz} GHz, ${hw.gpu.mauhPerAtpAt100} MAUh per period per GPU at a 100 % charge${hw.gpu.exceedsAllowanceAt100 ? ": one such part exceeds the whole allowance" : ""}; no FIA conversion is published yet.`, "F4.4.1 · open")
  else if (x.gpus > 0) add("gpu", "ok", `${x.gpus} GPUs outside the solver`, "Meshing, post-processing and machine learning on simulation results do not accrue AUh.", "F4.4.4")

  if (x.nodes > 0 && x.clockGHz < hw.ccfFloorGHz - 1e-9) add("clock", "bad", `CCF ${x.clockGHz.toFixed(1)} GHz below the ${hw.ccfFloorGHz} GHz base clock: not allowed`, `The declared clock may not be lower than the base clock of the part (${x.coresPerNode}-core ${hw.arch.part}).`, "F4.4.2")
  else add("clock", "info", `CCF declared at ${x.clockGHz.toFixed(1)} GHz`, `Charged ${x.clockGHz.toFixed(1)} AUh per core-hour; useful work per AUh ${round(comp.clockWorkPerAuh, 2)} × the ${K.compute.refClockGHz} GHz reference. Base clock of the part: ${hw.ccfFloorGHz} GHz.`, "F4.4.2")

  if (x.cpuArch !== K.compute.cpuArchToday) {
    const arch = archOf(x)
    if (arch.launchFlag && arch.launchFlag[x.season]) add("arch", "info", `${arch.part[x.season]} launches in 2027: order early`, `The ${x.season} part of the "${arch.label}" family is announced, not shipping; its lead time belongs in the delivery plan.`, "")
    if (arch.portFlag) add("armport", "warn", "Arm processors need the team's CFD code re-validated", `Porting and validation before the first metered run: ${K.compute.armPortWeeks} weeks taken off the delivery slider.`, "")
  }

  if (atDr) {
    if (fac.drIT > fac.drCapacity) add("power", "bad", `Digital Realty: ${Math.round(fac.drIT)} kW > ${fac.drCapacity} kW offer`, `${Math.round(fac.estateAtDr)} kW of estate, ${Math.round(hw.clusterKW)} kW of cluster${fac.mlAtDr ? ` and ${fac.mlAtDr} kW of ML partition` : ""} against the ${fac.drCapacity} kW envelope. Not possible: shrink the cluster or the ML partition, or move the partition to the cloud. More kW is a separate commercial conversation (ZUR4, 2028).`, "")
    else add("power", "ok", `${Math.round(fac.drIT)} kW of ${fac.drCapacity} kW at Digital Realty`, `${Math.round(fac.drHeadroomKW)} kW of headroom inside the offer; billed on ${Math.round(fac.billedKW)} kW (${x.committedKW} kW committed).`, "")
    if (fac.racks.total > K.facility.cageRackPositions) add("racks", "bad", `${fac.racks.total} racks > ${K.facility.cageRackPositions} cage positions`, `${fac.racks.estate} estate racks at ${K.facility.estateRackKW} kW, ${fac.racks.cluster} cluster racks${fac.racks.ml ? ` and ${fac.racks.ml} ML racks` : ""} at ${x.rackKW} kW.`, "")
  } else if (fac.powerShortKW > 0) add("power", "bad", `Hinwil room short by ${Math.round(fac.powerShortKW)} kW`, `${Math.round(fac.hinwilIT)} kW of IT load against ${fac.hinwilCapacity} kW. The model spreads the shortfall: ${Math.round((1 - fac.powerEff) * 100)} % of the cluster cannot run.`, "")
  else add("power", "ok", `${Math.round(fac.hinwilIT)} kW of ${fac.hinwilCapacity} kW`, `${Math.round(fac.hinwilCapacity - fac.hinwilIT)} kW of headroom at Hinwil.`, "")
  if (x.location === "hybrid" && fac.hinwilShortKW > 0) add("hybridpower", "warn", `Hinwil keeps ${Math.round(fac.hinwilIT)} kW against ${fac.hinwilCapacity} kW`, "", "")
  if (x.legacyExpansionRight) add("expansion", "info", "Expansion right is a commercial note, not capacity", `The 500 kW offer has no expansion right; the legacy input was ignored. ZUR4 adds 15 MW on the campus in 2028: more kW is a separate conversation.`, "")

  if (atDr && x.rackKW > fac.coolingMax) add("cooling", "bad", `${x.rackKW} kW racks exceed the ${fac.coolingMax} kW ${COOLING_WORD[x.cooling]} ceiling at Digital Realty`, "A hard ceiling of the campus offer: lower the density or change the cooling.", "")
  else if (!atDr && fac.thermalEff < 1) add("cooling", x.rackKW > fac.coolingMax * 1.5 ? "bad" : "warn", `${x.rackKW} kW racks on ${x.cooling === "air" ? "air" : x.cooling === "reardoor" ? "rear-door" : "direct liquid"} cooling (limit ≈ ${fac.coolingMax} kW)`, `Expect ${Math.round((1 - fac.thermalEff) * 100)} % thermal throttling: the silicon slows but the declared CCF still accrues AUh.`, "")
  else if (x.gpus > 0 && x.cooling === "air") add("cooling", "warn", "Accelerators on air cooling", "GPU rows need rear-door or direct liquid cooling; the model throttles GPU work by 30 %.", "")
  else add("cooling", "ok", `${x.rackKW} kW racks within the cooling limit (${fac.coolingMax} kW)`, hw.racks ? `${hw.racks} rack${hw.racks > 1 ? "s" : ""} for the cluster.` : "", "")

  if (atDr) add("declare", x.migrationTiming === "midperiod" ? "warn" : "info", x.migrationTiming === "midperiod" ? `Mid-period move costs ≈ ${K.facility.migrationLossDays} solver days` : "Move at an ATP boundary", "A new declaration (cluster, location, cores, CCF) is due within one month of the change.", "F4.4.3")
  if (x.location === "hinwil" && x.cooling !== "air") add("loop", "info", x.cooling === "dlc" ? "Hinwil needs a liquid loop" : "Hinwil needs a chilled-water branch", `One-off CHF ${((x.cooling === "dlc" ? K.facility.hinwilLiquidLoopCHF : K.facility.hinwilRearDoorCHF) / 1e6).toFixed(2)} M of building plant${x.hinwilRetrofit ? " inside the retrofit" : ""}.`, "")
  if (comp.effectiveLeadWeeks > 0) add("delivery", "warn", `Hardware ${comp.effectiveLeadWeeks} week${comp.effectiveLeadWeeks > 1 ? "s" : ""} after 1 January${comp.armPortWeeks ? ` (incl. ${comp.armPortWeeks} weeks of Arm re-validation)` : ""}`, `≈ ${Math.round((comp.effectiveLeadWeeks / 52) * 100)} % of the year's allowance cannot be used.`, "F4.1.4")
  return out
}

// ---------------------------------------------------------------------------------------------
// Scenario and comparison
// ---------------------------------------------------------------------------------------------

export function simulate(raw) {
  const x = normalize(raw)
  const fia = fiaEnvelope(x)
  const hw = hardware(x)
  const fac = facility(x, hw)
  const comp = compute(x, fia, hw, fac)
  const net = trackside(x)
  const money = costs(x, hw, fac, comp, net)
  const env = envelope(x, hw, fac)
  const flagList = flags(x, fia, hw, fac, comp, env)
  const worst = !env.fits || flagList.some((f) => f.level === "bad") ? "bad" : flagList.some((f) => f.level === "warn") ? "warn" : "ok"
  return { inputs: x, fia, hw, fac, comp, net, money, envelope: env, flags: flagList, status: worst }
}

export const aeroSeconds = (effectiveMauh) => K.performance.aeroA * Math.log(1 + Math.max(0, effectiveMauh) / K.performance.aeroW0)
export const reinvestSeconds = (savedCHF) => Math.sign(savedCHF) * K.performance.reinvestMaxSec * (1 - Math.exp(-Math.abs(savedCHF) / K.performance.reinvestScaleCHF))

/**
 * The performance block for a simulated scenario against a simulated baseline. `wScenario` / `wToday`
 * default to the two clusters' effective MAUh; plan.js passes season blends (part of the year on the old
 * estate, part on the new one) instead. The headline is seconds per lap vs Today; trackside value is
 * expressed as data-to-decision seconds, link availability and race weekends at risk (no points).
 */
export function perfBlock(scenario, today, { wScenario = scenario.comp.effectiveMauh, wToday = today.comp.effectiveMauh } = {}) {
  const x = scenario.inputs
  const conf = x.confidence / 100
  const aero = aeroSeconds(wScenario) - aeroSeconds(wToday)
  const saved = today.money.capCharge - scenario.money.capCharge
  const reinvest = reinvestSeconds(saved)
  const raw_ = aero + reinvest
  const sec = raw_ * conf
  return {
    aeroSec: round(aero, 3), reinvestSec: round(reinvest, 3), rawSec: round(raw_, 3), sec: round(sec, 3), secExact: sec,
    savedCHF: Math.round(saved), confidence: x.confidence,
    aeroTodaySec: round(aeroSeconds(wToday), 3), aeroScenarioSec: round(aeroSeconds(wScenario), 3),
    effectiveMauh: round(wScenario, 3), effectiveMauhToday: round(wToday, 3),
    effectiveMauhDelta: round(wScenario - wToday, 3),
    capChargeDelta: Math.round(scenario.money.capCharge - today.money.capCharge),
    yearlyDelta: Math.round(scenario.money.yearly - today.money.yearly),
    co2Delta: round(scenario.money.co2MarketT - today.money.co2MarketT, 1),
    // Trackside value, in the units the pit wall feels
    decisionSec: scenario.net.venue.decisionSec, decisionTodaySec: today.net.venue.decisionSec,
    decisionDeltaSec: round(today.net.venue.decisionSec - scenario.net.venue.decisionSec, 2),
    linkAvailability: scenario.net.linkAvailability, linkAvailabilityToday: today.net.linkAvailability,
    weekendsAtRisk: scenario.net.weekendsLost, weekendsAtRiskToday: today.net.weekendsLost,
    weekendsAtRiskDelta: round(today.net.weekendsLost - scenario.net.weekendsLost, 2),
    availabilityPct: scenario.comp.availabilityPct, availabilityTodayPct: today.comp.availabilityPct,
  }
}

/** Scenario vs Today's setup in the same season (and at the same latency venue); the performance block is the headline. */
export function evaluate(raw) {
  const scenario = simulate(raw)
  const x = scenario.inputs
  const today = simulate(todayInputs(x.season, x.position, x.confidence, x.venue))
  return { scenario, today, envelope: scenario.envelope, perf: perfBlock(scenario, today) }
}

/**
 * Both seasons of one input set (the "2027 plan · 2028 path" strip), or of a `{ 2027, 2028 }` pair of sets
 * (each may be partial: 2028 falls back to 2027's values).
 */
export function evaluateBothSeasons(raw) {
  const sets = raw && typeof raw === "object" && (raw[2027] || raw[2028]) ? raw : { 2027: raw, 2028: raw }
  const x27 = normalize({ ...(sets[2027] || sets[2028] || {}), season: 2027 })
  const x28 = normalize({ ...x27, ...(sets[2028] || {}), season: 2028 })
  return { 2027: evaluate(x27), 2028: evaluate(x28) }
}

/** Inputs for a preset in a given season. */
export function presetInputs(id, season = DEFAULTS.season, extra = {}) {
  const preset = PRESETS[id] || PRESETS.today
  return normalize({ ...DEFAULTS, ...preset.inputs, season: preset.inputs.season ?? season, ...extra })
}
