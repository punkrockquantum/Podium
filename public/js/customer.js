/**
 * Audi F1 Team edition: the single source of truth for every customer-specific figure.
 *
 * Every entry is either
 *   v(value, "A3")        VERIFIED  — the key points at a row of docs/audi-f1-sources.md, or
 *   a(value, "why...")    ASSUMPTION — a planning value with its one-line rationale.
 * `FIGURES` is the same tree with the annotations stripped, for code that just needs the number.
 *
 * Change a figure here and the catalog, briefs, scenes, race, readouts, business case and README
 * follow. Nothing in this file describes the customer's internal IT beyond what the public record
 * supports; the rest is labelled as a planning assumption on screen.
 */

const v = (value, source, note) => ({ value, source, ...(note ? { note } : {}) })
const a = (value, assumption) => ({ value, assumption })
const isEntry = (x) => x && typeof x === "object" && !Array.isArray(x) && "value" in x && ("source" in x || "assumption" in x)

export const CUSTOMER = {
  name: "Audi F1 Team",
  entrant: v("Audi Revolut F1 Team", "A1", "Official 2026 entrant name; the product uses the short public name."),
  edition: "Hinwil → Zurich campus · 2027 plan, 2028 path",
  provider: "our Zurich campus",
  sourcesDoc: "docs/audi-f1-sources.md",
  accessed: "2026-11-24",

  /* ------------------------------------------------------------ sites */
  sites: {
    hinwil: {
      label: "Hinwil F1 Factory",
      role: v("Race-car development, race operations (Mission Control), wind tunnel and today's data room", "A3"),
      canton: "Canton of Zurich",
      kmToZurich: v(30, "A3", "Audi: \"around 30 kilometers from Zurich\""),
    },
    campus: {
      label: "Zurich campus",
      role: "Our colocation campus (the provider's site)",
      fibreKm: a(35, "Fibre routes run 1.2–1.5× the ~30 km road distance Hinwil–Zurich"),
      rttMs: a(0.35, "Light in fibre ≈ 4.9 µs/km one way → 35 km ≈ 0.17 ms one way"),
    },
    neuburg: {
      label: "Neuburg an der Donau",
      role: v("Audi Formula Racing: power unit development, 22 test benches, PU simulator", "A4"),
      rttMsToZurich: a(7, "~300 km Zurich–Neuburg; carrier Ethernet via Munich ≈ 5–8 ms RTT"),
    },
    bicester: {
      label: "Bicester Technology Centre",
      role: v("UK Technology Centre opened July 2025 (Bicester Motion)", "A5"),
      rttMsToZurich: a(18, "~900 km; typical UK–Zurich carrier RTT 15–20 ms"),
    },
    trackside: {
      label: "Trackside garage",
      role: v("24 Grands Prix in 22 countries in 2027; the garage links to Mission Control in Hinwil", "E1"),
      rttMsToZurich: a(100, "Austin ↔ Zurich on a private circuit ≈ 100–110 ms; European rounds 10–25 ms"),
    },
  },

  /* ------------------------------------------------------------ people and calendar */
  people: {
    hinwilHeadcount: v(800, "A9", "~800 in Hinwil, March–April 2026"),
    targetHeadcount: v(1400, "A9", "Binotto, July 2026: around 1,400 to match the top teams"),
  },
  calendar: {
    races: v(24, "E1", "2027: 24 Grands Prix in 22 countries"),
    austin: v("United States Grand Prix, Austin, 22–24 Oct 2027", "E1", "The game's finale, on the 2027 calendar"),
  },

  /* ------------------------------------------------------------ IT load, today's room */
  load: {
    todayKW: a(260, "A ~300 kW room running close to full: the cluster plus enterprise IT"),
    it2027KW: a(400, "B-a: bottom-up estate (RCFD solver ≈25, CFD pre/post + ML ≈60, FEA/vehicle dynamics ≈60, simulator ≈30, enterprise IT ≈150, trackside ≈25, buffer ≈50)"),
    it2027RangeKW: a([350, 450], "B-a"),
    it2028KW: a(800, "B-b: GPU cores allowed for the RCFD solver from 1 Jan 2028 (FIA F4.4.1); a first liquid-cooled GPU partition adds ≈300–450 kW"),
    it2028RangeKW: a([700, 900], "B-b"),
    loadFactor: a(0.85, "Average draw vs installed IT load for an HPC-heavy estate"),
  },
  room: {
    capacityKW: a(300, "A-a: the Hinwil data room's usable IT capacity; ~1.3× short of the 2027 need"),
    pue: a(1.6, "A-b: legacy air-cooled room; Uptime 2025 survey average 1.54, legacy worse (D7)"),
    resilience: a("N", "A-c: single utility feed, UPS, one generator; N+1 on cooling at best"),
    age: a("Commissioned in the Sauber 'Albert' HPC era (2006–2012), extended since", "A-d"),
    upgradeCapexCHF: a(3_000_000, "A-e: retrofit to 450 kW at N+1 and PUE ≈1.4 at roughly half Zurich's USD 14.2/W greenfield cost (D8)"),
    upgradedCapacityKW: a(450, "A-e: what the existing shell and grid connection can take"),
    upgradedPue: a(1.4, "A-e: new chillers and containment in an old shell"),
    upgradedResilience: a("N+1", "A-e"),
    newHallCapexPerKWCHF: a(12_000, "D8: Zurich greenfield USD 14.2/W ≈ CHF 12,000 per IT kW at 0.84"),
    cfdAllocationKW: a(120, "The room's power allocation for the CFD partition (solver, pre/post, ML)"),
  },

  /* ------------------------------------------------------------ our offer */
  offer: {
    committedKW: a(500, "The 2027 commitment: the 400 kW estate plus 25% headroom"),
    expansionRightKW: a(1000, "Contractual expansion right covering the 2028 load (B-b) with margin"),
    designPue: a(1.2, "D5: modern Zurich campuses design to ~1.1–1.2; our hall's design PUE with liquid-ready rows"),
    power: "2N",
    cooling: "N+1",
    liquidReady: true,
    heatReuse: v("Waste heat to the district-heating network, as at Dielsdorf (Energie 360° / Green, Nov 2026)", "D5"),
    feeCHFPerKWMonth: a(180, "D-d: inside the European band (CBRE Q1 2026 Frankfurt ≤ EUR 225; broker asks EUR 130–200 with power on top); Zurich publishes no benchmark"),
    fitOutCHF: a(800_000, "D-d: cage, racks, in-rack power, CDU provision and cabling ≈ CHF 1,600 per kW"),
    migrationCHF: a(400_000, "D-d: move, parallel running, services"),
    expansionFitOutCHF: a(600_000, "2028 fit-out for the GPU rows (+300 kW): liquid manifolds, CDUs, busway"),
    liquidLoopCHF: a(450_000, "Customer-side direct-to-chip loop: CDUs, manifolds, hoses for ~1 MW of rows"),
    rearDoorCHF: a(300_000, "Rear-door heat exchangers for ~40 racks"),
  },

  /* ------------------------------------------------------------ tariffs and FX */
  tariffs: {
    hinwilCHFPerKWh: a(0.16, "D-a: EKZ 2027 MV tariff 17.11 winter / 12.91 summer Rp/kWh plus CHF 8/kW/month demand charge (D2)"),
    campusCHFPerKWh: a(0.15, "D-b: ewz 2027 NNC grid 2.84/1.42 Rp/kWh + CHF 13/kW/month + levies 4.15 + market energy (D3), metered pass-through"),
    remoteCHFPerKWh: a(0.09, "A low-cost region (e.g. Nordics) at EUR 70–90/MWh all-in, FX 0.92"),
    ekz2027: v({ winterRp: 17.11, summerRp: 12.91, demandCHFPerKWMonth: 8.0 }, "D2"),
    ewz2027: v({ gridHtRp: 2.84, gridNtRp: 1.42, demandCHFPerKWMonth: 13.0, leviesRp: 4.15 }, "D3"),
    elcom2027MedianC6Rp: v(19.37, "D1"),
    gridCO2gPerKWh: a(75, "D-c: midpoint of the Swiss consumer-mix 57 (2024) and 90 (2025) g CO2eq/kWh (D4)"),
    remoteCO2gPerKWh: a(30, "A hydro/wind-heavy region"),
  },
  fx: {
    usdToChf: a(0.84, "E-a: SNB 0.8389 on 23 Nov 2026, rounded"),
    fiaUsdPerChf: v(1.1316, "C2", "FIA Initial Applicable Rate, fixed for the regulation cycle"),
    eurToChf: a(0.92, "SNB 0.9209 on 23 Nov 2026"),
  },

  /* ------------------------------------------------------------ FIA figures */
  fia: {
    costCapUSD: v(215_000_000, "C1", "D4.1.2: USD 215M + indexation; +USD 1.8M per Competition above 24"),
    costCapCHFIllustrative: v(189_992_000, "C1", "FIA's own illustrative CHF figure for 2026"),
    capexLimit: v(null, "C3", "No separate capital-expenditure allowance in the 2026 Financial Regulations: plant and equipment enter the cap through straight-line depreciation (D6.1.1.k)"),
    depreciationYearsIT: a(4, "Typical useful life for servers and storage under IAS 16; straight-line, zero residual (D6.1.1.k)"),
    depreciationYearsPlant: a(10, "Typical useful life for cooling plant, UPS, switchgear and fit-out"),
    propertyExcluded: v(true, "C3", "Property depreciation and Property Costs are excluded (D5.1.1.j, D5.1.1.o.i)"),
    heatRecoveryExcluded: v(true, "C3", "Heat pumps and heat-recovery units are Sustainability Initiative Costs, excluded"),
    coloFeeInCap: a(true, "C3-open: treated conservatively as an in-cap service cost"),
    atrArticle: "F4",
    atrPosition: v(8, "A12", "Audi P8 in 2026 as of 22 Nov 2026, two rounds to go (provisional)"),
    atrPercent: v(105, "C5", "C = 105% for P8; P9 → 110%, P10 → 115%"),
    mauhBaseline: v(6, "C4", "MAUh per ATP at C = 100%"),
    mauhAllowance: v(6.3, "C5", "6 × 105%"),
    runsAllowance: v(336, "C5"),
    windOnHours: v(84, "C5"),
    atpHoursAvg: v(1460, "C4", "6 ATPs a year, 8760 h / 6"),
    auhDefinition: v("AUh = NCU × NSS × CCF / 3600 (cores × solver seconds × peak GHz)", "C4"),
    cpuOnlyUntil: v("2027-12-31", "C4", "F4.4.1: GPU cores allowed from 1 Jan 2028"),
    relocationNotice: v("Re-declare the compute resource within one month of a change of location (F4.4.3)", "C4"),
    preSeasonTest: v("Bahrain, 24–27 Feb 2027", "C7"),
    round1: v("Bahrain, 12–14 Mar 2027", "C7"),
  },

  /* ------------------------------------------------------------ the RCFD cluster the allowance buys */
  cluster: {
    coresPerNode: a(128, "Dual-socket 64-core HPC node"),
    ccfGHz: a(3.7, "Max turbo counts as CCF when enabled (F4.4.4)"),
    solverShare: a(0.75, "Share of wall-clock the declared cores spend in the solver"),
    nodeKW: a(1.2, "Dual-socket HPC node with memory and interconnect under load"),
    nodePriceCHF: a(65_000, "Current-generation 2-socket node with 768 GB and 200G interconnect"),
  },
}

/** The same tree with the annotations stripped: FIGURES.load.it2027KW === 400. */
function strip(node) {
  if (isEntry(node)) return node.value
  if (Array.isArray(node)) return node.map(strip)
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, strip(x)]))
  return node
}
export const FIGURES = strip(CUSTOMER)

/** Every annotated figure as a flat list: [{ path, value, status, ref }] for the case page and the README. */
export function annotatedFigures(node = CUSTOMER, path = []) {
  if (isEntry(node)) return [{ path: path.join("."), value: node.value, status: node.source ? "VERIFIED" : "ASSUMPTION", ref: node.source || node.assumption, note: node.note || "" }]
  if (!node || typeof node !== "object" || Array.isArray(node)) return []
  return Object.entries(node).flatMap(([k, x]) => annotatedFigures(x, [...path, k]))
}

/* ------------------------------------------------------------ derived figures (one place) */

const F = FIGURES
/** MAUh one declared node uses per ATP: cores × GHz × solver hours / 1e6. */
export const mauhPerNodePerAtp = (F.cluster.coresPerNode * F.cluster.ccfGHz * F.fia.atpHoursAvg * F.cluster.solverShare) / 1e6
/** Nodes the team's allowance keeps busy. */
export const nodesAtAllowance = F.fia.mauhAllowance / mauhPerNodePerAtp
/** Share of the allowance one node uses, in percent. */
export const capSharePerNode = Math.round((100 / nodesAtAllowance) * 100) / 100
/** CHF per facility-kW-year at a tariff: tariff × 8760 h × load factor. */
export const kwYearCHF = (tariff) => Math.round(tariff * 8760 * F.load.loadFactor)
/** The cost cap in CHF at the FIA's regulatory rate and at the planning market rate. */
export const costCapCHF = { fia: Math.round(F.fia.costCapUSD / F.fx.fiaUsdPerChf), market: Math.round(F.fia.costCapUSD * F.fx.usdToChf) }

/** Short money for gauges and labels: "CHF 1.2M", "CHF 450k", "CHF 12". */
export const chf = (value, digits = 1) => {
  const sign = value < 0 ? "−" : ""
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${sign}CHF ${(abs / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${sign}CHF ${Math.round(abs / 1e3)}k`
  return `${sign}CHF ${Math.round(abs)}`
}
/** Full money for tables and briefs: "CHF 1,191". */
export const chfFull = (value) => `${value < 0 ? "−" : ""}CHF ${Math.round(Math.abs(value)).toLocaleString("en-US")}`
