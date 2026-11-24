/**
 * Infrastructure performance simulator: every constant the model uses that is not already in
 * public/js/customer.js, annotated the same way. `v(value, "G1")` is VERIFIED against a row of
 * docs/audi-f1-sources.md; `a(value, "J-a", "why")` is an ASSUMPTION keyed to its rationale row.
 * `K` is the same tree with the annotations stripped, for the model; `assumptionRows()` lists every
 * entry for the "Assumptions & sources" panel.
 *
 * The provider is Digital Realty (Zurich campus, Glattbrugg/Opfikon). The OEM dimension is HPE via
 * HPE GreenLake: the sales lead's working assumption for this demo, not a statement about the
 * Audi F1 Team's actual suppliers.
 */
import { FIGURES as F } from "../customer.js"

const v = (value, source, note = "") => ({ value, status: "VERIFIED", source, note })
const a = (value, source, note = "") => ({ value, status: "ASSUMPTION", source, note })
const isEntry = (x) => x && typeof x === "object" && !Array.isArray(x) && "status" in x && "value" in x

export const PROVIDER = {
  name: "Digital Realty",
  campus: "Digital Realty Zurich campus (ZUR1–ZUR3, Glattbrugg/Opfikon; ZUR4 from 2028)",
  oem: "HPE via HPE GreenLake",
  oemNote: "HPE GreenLake is the sales lead's working assumption for the OEM dimension; it is not a claim about the Audi F1 Team's actual suppliers.",
}

export const A = {
  fia: {
    atpPerYear: v(6, "C8", "Six Aerodynamic Testing Periods a year (F4.1.4)"),
    atpHours: v(F.fia.atpHoursAvg, "C4", "8,760 h ÷ 6"),
    atp1Weeks: v(9, "C8", "ATP 1 runs from 1 January to the end of week 9"),
    baseline: v({ mauh: 6, runs: 320, windOn: 80, occupancy: 400, ratgs: 2000 }, "C8", "Per ATP at C = 100 % (F4.6.1)"),
    scale: v([70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 115], "C8", "C by constructors' position P1…P11; P10 or lower and new teams 115 %"),
    gpuAllowedFrom: v(2028, "C10", "GPU cores for the RCFD solver from 1 January 2028 (F4.4.1)"),
    auh: v("AUh = NCU × NSS × CCF ÷ 3600", "C9", "Cores × solver wall-clock seconds × peak GHz; message passing counts"),
    costCapUSD: v(F.fia.costCapUSD, "C11", "USD 215 M + indexation (D4.1.2)"),
    fiaUsdPerChf: v(F.fx.fiaUsdPerChf, "C2", "Initial Applicable Rate"),
    usdToChf: a(F.fx.usdToChf, "E-a", "Planning market rate"),
    depreciationYearsPlant: a(F.fia.depreciationYearsPlant, "C11", "Straight line, zero residual (D6.1.1.k); fit-out and plant over 10 years"),
    propertyShareOfFee: a(0.5, "C3-open", "Share of the colocation fee that a finance team might present as Property Costs (space) rather than service"),
    telemetry: v("Car → team telemetry only; team → car is prohibited (C8.5.3)", "C12"),
  },
  compute: {
    refClockGHz: a(3.7, "J-d", "Reference CCF: one reference core-hour = 1 AUh at 3.7 GHz on current silicon"),
    clockWorkExponent: a(0.6, "J-d", "Useful CFD work per core-hour scales with clock^0.6 (memory-bound); AUh scale with clock^1.0"),
    runCoreHours: a(6000, "J-d", "A standard full-car run: 6,000 reference core-hours (≈ 6 h on 1,024 cores)"),
    jobNodesCpu: a(8, "J-d", "A run decomposes efficiently over ≈ 8 CPU nodes"),
    jobGpus: a(4, "J-d", "… or ≈ 4 accelerators"),
    solverShare: a(F.cluster.solverShare, "J-d", "Share of wall-clock the declared cores spend in the solver on a well-run cluster"),
    interconnectLossPer8Nodes: a({ eth100: 0.03, eth200: 0.02, ibndr: 0.01, slingshot: 0.008 }, "J-d", "Scaling loss per 8 nodes of job size"),
    interconnectGpuFactor: a({ eth100: 0.9, eth200: 0.95, ibndr: 1.0, slingshot: 1.0 }, "J-d", "Multi-GPU jobs on slow fabrics lose more"),
    ioDemandGBsPerCpuNode: a(0.4, "J-d"),
    ioDemandGBsPerGpu: a(1.5, "J-d"),
    storageGBs: a({ nas: 3, pfs: 25, flash: 80 }, "J-d", "Sustained read/write of the storage tier"),
    memoryFactor: a({ 384: 0.95, 768: 1.0, 1536: 1.0 }, "J-d", "384 GB nodes split large meshes over more nodes; 1.5 TB only matters for very large meshes"),
    ipcByRefresh: a({ 3: 1.08, 4: 1.0, 5: 0.92 }, "H-d", "Newer cores do more per clock, and the FIA charges clock, not work"),
    coreFp64GFLOPSPerGHz: v(32, "J2", "Two 512-bit FMA units: 32 FP64 FLOP per cycle per core"),
    gpu: v({
      h200: { label: "NVIDIA H200-class", fp64: 34, kW: 0.9 },
      b200: { label: "NVIDIA B200-class", fp64: 37, kW: 1.25 },
      mi355x: { label: "AMD MI355X-class", fp64: 78.6, kW: 1.65 },
    }, "J2", "Peak FP64 TFLOPS per accelerator; kW includes a share of the host server"),
    gpuWorkPerAuh: a(1.3, "J-c", "GPU solvers achieve ≈ 1.3 × the useful work per FP64-normalised AUh of CPU solvers (HBM bandwidth)"),
    gpuChargeFactorDefault: a(1.0, "J-c", "GPUs charged at 100 % of their FP64-peak core-equivalent until the FIA publishes a rule"),
    nodeKW: a({ base: 0.25, perCoreBlock: 0.95, clockExponent: 1.3 }, "B-c", "Node kW = 0.25 + 0.95 × (cores ÷ 128) × (CCF ÷ 3.7)^1.3: ≈ 1.2 kW for a 128-core node at 3.7 GHz"),
    storageKW: a({ nas: 5, pfs: 10, flash: 12 }, "B-c"),
    coolingMaxKWPerRack: { air: a(20, "G5", "Air-cooled rows top out around 20 kW per rack"), reardoor: v(70, "G5", "Digital Realty high-density colocation: up to 70 kW per rack with rear-door heat exchangers"), dlc: a(150, "G5", "Direct-to-chip liquid rows; a third-party listing quotes ZUR2 at up to 150 kW per rack") },
    nodeMtbfHours: a(200_000, "H-c", "Per-node mean time between failures"),
    mttrHours: a({ nbd: 36, "4h": 4, mission: 2 }, "H-c"),
    failureImpact: a(0.5, "H-c", "A failed node degrades half the running jobs until it is back"),
    supportRate: a({ nbd: 0.02, "4h": 0.04, mission: 0.06 }, "H-c", "Yearly support as a share of hardware value"),
    softwareRate: a(0.04, "H-a", "Scheduler, compilers, monitoring and maintenance as a share of hardware value per year"),
    deliveryLossWeeksPerYear: a(52, "H-e", "A week of hardware missing after 1 January wastes 1/52 of the year's allowance"),
  },
  prices: {
    nodeCHF: a(F.cluster.nodePriceCHF, "H-a", "128 cores, 768 GB, before interconnect"),
    nodeCoreExponent: a(0.9, "H-a", "Price scales with cores^0.9"),
    memoryDeltaCHF: a({ 384: -8000, 768: 0, 1536: 25_000 }, "H-a"),
    interconnectPerNodeCHF: a({ eth100: 1500, eth200: 3000, ibndr: 6000, slingshot: 7000 }, "H-a", "NIC, optics and a share of the switches"),
    gpuCHF: a({ h200: 35_000, b200: 45_000, mi355x: 30_000 }, "H-a", "Per accelerator incl. host share"),
    storageCHF: a({ nas: 120_000, pfs: 450_000, flash: 700_000 }, "H-a"),
    greenlakeUplift: a(1.25, "H-b", "Financing plus managed service over the purchase-equivalent price"),
    greenlakeFlexPremium: a(0.25, "H-b", "Extra unit-rate uplift at a 0 % reserve, scaling linearly: a 60 % reserve pays 1.35 ×, a 100 % reserve 1.25 ×"),
    greenlakeBuffer: a(0.2, "H-b", "Buffer capacity installed on site, charged only when used"),
    hinwilPatchCHF: a(300_000, "A-a", "Keeping the as-is room alive through 2027 (the business case's 'as is' one-off)"),
    hinwilRetrofitCHF: a(F.room.upgradeCapexCHF, "A-e", "Retrofit to 450 kW, N+1, PUE ≈ 1.4"),
    hinwilRetrofitKW: a(F.room.upgradedCapacityKW, "A-e"),
    newHallCHFPerKW: a(F.room.newHallCapexPerKWCHF, "D8", "A new Hinwil hall at Zurich greenfield cost"),
    feeCHFPerKWMonth: a(F.offer.feeCHFPerKWMonth, "G-c", "Digital Realty committed kW, power metered on top"),
    fitOutCHFPerKW: a(1600, "G-c"),
    migrationCHF: a(F.offer.migrationCHF, "G-c"),
    expansionFitOutCHF: a(F.offer.expansionFitOutCHF, "G-c", "Liquid manifolds, CDUs and busway for the 2028 GPU rows"),
    crossConnectCHFPerMonth: a(300, "G-c"),
    fibrePairCHFPerYear: a(48_000, "B-e", "One diverse dark-fibre route Hinwil ↔ the campus"),
    fibreBandwidthFactor: a({ 10: 1.0, 100: 1.4, 400: 2.2 }, "B-e", "Optics and transponders"),
    tracksideCHFPerYear: a({ internet: 30_000, carrier: 250_000, dual: 400_000, dualsat: 480_000 }, "I-b", "Per season, 24 Grands Prix"),
    edgeCapexCHF: a(200_000, "I-d"),
    edgeCHFPerYear: a(80_000, "I-d"),
    cloudOnRampCHFPerYear: a(180_000, "G6", "ServiceFabric ports plus metered burst for unrestricted ML and analytics"),
  },
  facility: {
    pue: a({ hinwil: { air: 1.6, reardoor: 1.45, dlc: 1.3 }, dr: { air: 1.35, reardoor: 1.25, dlc: 1.15 } }, "G-b", "Derived PUE by site and cooling; the slider overrides it"),
    retrofitPueGain: a(0.2, "A-e", "New chillers and containment in the old shell"),
    availability: a({ n: 0.995, n1: 0.999, "2n": 0.9999 }, "G-d", "Facility availability by the customer's power topology"),
    drSitePower: v("ZUR2: 2N UPS, N+2 cooling; ZUR1/ZUR3: N+1 cooling", "G1"),
    hinwilCapacityKW: a(F.room.capacityKW, "A-a"),
    drExpansionRightKW: a(F.offer.expansionRightKW, "G-c", "Contractual expansion right at the same fee"),
    restOfEstateKW: a({ 2027: 375, 2028: 760 }, "J-f", "Everything that is not the modelled CFD cluster: enterprise IT, FEA, simulator, trackside and, in 2028, the unrestricted ML partition"),
    hinwilLiquidLoopCHF: a(450_000, "A-e", "A liquid loop for direct-liquid rows in the Hinwil room"),
    hinwilRearDoorCHF: a(300_000, "A-e", "Rear-door heat exchangers and a chilled-water branch in the Hinwil room"),
    hybridHinwilKW: a(150, "J-f", "Hybrid: Mission Control, simulator, edge and office IT stay in Hinwil"),
    loadFactor: a(F.load.loadFactor, "B-a", "Average draw vs installed IT load"),
    tariffHinwilRp: a(Math.round(F.tariffs.hinwilCHFPerKWh * 100), "D-a"),
    tariffDrRp: a(Math.round(F.tariffs.campusCHFPerKWh * 100), "D-b"),
    gridCO2: a(F.tariffs.gridCO2gPerKWh, "D-c", "Swiss consumer mix, location-based"),
    drRenewable: v("100 % renewable energy across Digital Realty's European portfolio; SDEA Platinum+ on ZUR2", "G1"),
    heatReuseShare: a({ before2029: 0.25, from2029: 0.6 }, "G4", "Share of IT energy recovered as heat: campus neighbours until the Opfikon network starts in 2029"),
    heatDisplacedKgPerMWh: a(200, "G4", "Gas heating displaced by recovered heat, kg CO2 per MWh"),
    renewableTariffUpliftRp: a(1, "D-a", "Buying a 100 % renewable tariff for the Hinwil room"),
    migrationLossDays: a(7, "C9", "Solver days lost when a move lands inside an ATP instead of at its boundary"),
  },
  trackside: {
    venues: a([
      { id: "monza", name: "Monza", rtt: 8 },
      { id: "bahrain", name: "Bahrain", rtt: 95 },
      { id: "abudhabi", name: "Abu Dhabi", rtt: 110 },
      { id: "austin", name: "Austin", rtt: 125 },
      { id: "singapore", name: "Singapore", rtt: 170 },
      { id: "suzuka", name: "Suzuka", rtt: 230 },
      { id: "melbourne", name: "Melbourne", rtt: 290 },
    ], "I-a", "Round-trip ms to Zurich on a private carrier path"),
    profiles: a({
      internet: { label: "Public internet (encrypted tunnels)", availability: 0.99, mbps: 200, jitterMs: 35 },
      carrier: { label: "One carrier circuit", availability: 0.995, mbps: 100, jitterMs: 0 },
      dual: { label: "Two diverse carrier circuits", availability: 0.9995, mbps: 200, jitterMs: 0 },
      dualsat: { label: "Two carriers + satellite backup", availability: 0.9999, mbps: 200, jitterMs: 0 },
    }, "I-b"),
    garageMs: v(8, "I1", "Inside the garage the transfer time is under 8 ms (McLaren)"),
    telemetryPeakMbps: a(105, "I-c", "Two cars, 1.5 TB each per weekend, peak × 3"),
    decisionBaseSec: a(6.0, "I-d"),
    decisionRoundTrips: a(2, "I-d"),
    edgeSavingSec: a(1.5, "I-d"),
    strategyPointsSwing: a(6, "I-e", "Points a season between a slow, fragile loop and a fast, resilient one"),
    fibreAvailability: a({ 1: 0.999, 2: 0.99995 }, "D6", "Hinwil ↔ campus: one route vs two diverse routes (Swisscom Fiber Line 99.80–99.90 % per route)"),
  },
  timeline: {
    planningDate: v("2026-11-24", "C13", "The date the plan is drawn up; lead times count from here or from the contract date"),
    atpRule: v("P1: 1 Jan → end of week 9; P2, P3, P5: 8 weeks; P4: 10 weeks incl. the summer shutdown; P6: → 31 Dec", "C13", "F4.1.4; weeks start on a Monday and week 1 is the first week with four or more days (ISO 8601)"),
    summerShutdown: a({ 2027: "2027-08-02", 2028: "2028-07-31", days: 14 }, "C14", "Fourteen consecutive days in July/August (F3.1.1.a), notified by the team; assumed to start on the first Monday of August"),
    winterShutdown: v({ monthDay: "12-24", days: 9 }, "C14", "Nine consecutive days from 24 December (F3.1.1.b); no CFD compute except system or software upgrade and maintenance (F3.1.2.b, F3.1.4.d)"),
    preSeason: {
      2027: v({ testStart: "2027-02-24", testEnd: "2027-02-27", round1: "2027-03-12" }, "C7", "Bahrain, four-day test; Round 1 Bahrain"),
      2028: a({ testStart: "2028-02-23", testEnd: "2028-02-26", round1: "2028-03-10" }, "C-a", "Not published: the 2027 pattern (four-day test in late February, Round 1 in mid-March)"),
    },
    gpuLegalFrom: v("2028-01-01", "C10", "GPU cores for the RCFD solver from 1 January 2028 (F4.4.1)"),
    declarationDays: v(30, "C15", "A new declaration within one month of a change of hardware, core count or location (F4.4.3)"),
    atpReportDays: v(14, "C15", "ATP report due within 14 days of the end of the period (F4.6.4); the declaration is due at the report if that is earlier"),
    leadWeeks: {
      greenlake: a(6, "H-f", "HPE GreenLake: pre-staged configurations and buffer capacity, 4–8 weeks from order to on-site capacity"),
      buy: a(14, "H-f", "Built-to-order HPC configuration purchased outright: 10–18 weeks"),
      fitOut: a(12, "G-e", "Digital Realty fit-out: suite or cage, racks, power whips, rear-door exchangers"),
      fitOutLiquid: a(16, "G-e", "Fit-out with a direct-to-chip liquid loop and CDUs"),
      expansion: a(16, "G-e", "2028 power step-up and liquid rows under the expansion right"),
      fibre: a(14, "D-e", "One dark-fibre route Hinwil ↔ Glattbrugg from existing ducts (10–16 weeks; 26+ with civil works)"),
      fibreSecondRoute: a(2, "D-e", "Extra weeks to deliver the second, diverse route"),
      crossConnects: a(1, "G8", "Cross-connects and campus/metro connectivity after the suite is ready"),
      burnIn: a(2, "H-f", "Acceptance, benchmarks and burn-in before the cluster is declared"),
      hinwilWorks: a(10, "A-e", "A rear-door branch or liquid loop in the Hinwil room"),
    },
    cutoverDowntimeDays: a(7, "C9", "Solver days lost when the cluster is moved without parallel running (physical move, re-cabling, re-commissioning)"),
    switchDays: a(1, "C9", "Solver days lost at a switch with parallel running: the queue drains on the old cluster and restarts on the new one"),
    parallelRunningCHFPerWeek: a(20_000, "G-c", "A week of parallel running: the old room's electricity, the overlap of the fee and staff"),
    earlyStepUpBurnInWeeks: a(4, "H-f", "Weeks of early delivery that count as burn-in rather than idle cost"),
  },
  services: {
    colocation: v("PlatformDIGITAL® colocation: cabinets, cages and suites; high-density colocation up to 70 kW per rack with rear-door exchangers", "G5"),
    interconnection: v("ServiceFabric® on PlatformDIGITAL®: Campus Connect, Metro Connect, Cross Connect, Internet Exchange, IP Bandwidth", "G8"),
    cloudOnRamps: v("AWS Direct Connect and Azure ExpressRoute on-ramps in Zurich; ExpressRoute Metro dual-homed across ZUR2 and Equinix ZH5", "G6"),
    remoteHands: v("Remote Hands: 24×7 on-demand and scheduled services (rack & stack, cross-connect continuity tests, maintenance-window support)", "G9"),
    swissix: v("SwissIX at Digital Realty ZUR1 (Opfikon), ports up to 400G, ordered as a cross-connect through the Digital Realty customer portal", "G10"),
    sites: v("ZUR1 Sägereistrasse 35 · ZUR2 Bäulerwisenstrasse 4 (2N UPS, N+2 cooling) · ZUR3 Bäulerwisenstrasse 6, all 8152 Glattbrugg · ZUR4 under construction, 15 MW, completion 2028", "G1"),
    darkFibre: v("Swisscom Fiber Line (99.80 % Basic / 99.90 % Premium), Litecom dark fibre on utility ducts with KMZ route files, ewz.fiber in ewz duct blocks with geo-redundant options", "D10"),
    hpeSupport: v("HPE Tech Care Basic (9×5, NBD on-site) · Essential (24×7, 4-hour on-site) · Critical (24×7, 6-hour hardware repair); HPE Complete Care for account-team led operations", "H3"),
    greenlakeStartup: v("GreenLake Flex Solutions: Startup (transition, kick-off, pre-delivery scheduling), then capacity planning meetings and buffer replenishment through change management", "H3"),
    roles: a(["Sales engineering", "Design engineering", "Interconnection", "Sustainability", "Customer success / Remote Hands"], "G-f", "Generic Digital Realty roles for the hand-over map; the actual organisation is not public"),
  },
  performance: {
    aeroA: a(1.2, "J-a", "Seconds per lap found over a season at W → ∞ scale"),
    aeroW0: a(4, "J-a", "Effective MAUh per period at which returns halve"),
    reinvestMaxSec: a(0.3, "J-b", "Ceiling of the reinvestment effect"),
    reinvestScaleCHF: a(3_000_000, "J-b", "Δt = 0.3 × (1 − e^(−saved ÷ 3 M)): ≈ 0.085 s for CHF 1 M"),
    secPerPosition: a(0.10, "J-e", "Lap-time spread per constructors' position in the midfield"),
    pointsPerPosition: a(25, "J-e"),
    midfield: a([5, 11], "J-e", "Positions the swing is clamped to"),
    confidenceDefault: a(60, "J-a", "Default model confidence (%)"),
  },
}

function strip(node) {
  if (isEntry(node)) return node.value
  if (Array.isArray(node)) return node.map(strip)
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, strip(x)]))
  return node
}
/** The constants without their annotations: K.fia.baseline.mauh === 6. */
export const K = strip(A)

/** Every annotated constant as a flat list for the sources panel: [{ path, value, status, source, note }]. */
export function assumptionRows(node = A, path = []) {
  if (isEntry(node)) return [{ path: path.join("."), value: node.value, status: node.status, source: node.source, note: node.note || "" }]
  if (!node || typeof node !== "object" || Array.isArray(node)) return []
  return Object.entries(node).flatMap(([k, x]) => assumptionRows(x, [...path, k]))
}
