/**
 * Plain-English explainers for the simulator: the copy behind every `?` button, the "Where the seconds come
 * from" bars and the glossary, plus three tiny helpers. Pure ES module, no DOM.
 *
 *   EXPLAIN["control.clockGHz"]  → { title, one, more[], analogy, inPlan, zero?, source, terms?, term? }
 *   fillTemplate(template, ctx)  → the `inPlan` template filled from a context (safe resolver, no eval)
 *   labels(plainEnglish)         → { title(id), unitWord(unit), barLabel(driverId, option) }
 *   explainContext({ result, attribution, both, fmt }) → the ctx the templates expect
 *
 * Copy follows the explain brief (section 3): British English, reading age 12–14, no unexpanded acronym in the
 * one-liner, one analogy per entry, every entry tagged with FIA rule ids and fact-pack rows. There are no
 * position or points entries: trackside value is data-to-decision seconds, link availability and race weekends.
 *
 * Template grammar: `{expr}` where expr is a dotted path into the ctx (`x.nodes`, `s.comp.usage`, `a.power.sec`,
 * `d.option.cooling`), a number, a 'string', arithmetic (+ − × ÷ with the usual precedence, unary minus) or a
 * whitelisted formatter call `fmt.name(expr, …)`. Anything unresolved renders as "—" and is reported through
 * `onMissing`, so a test can catch a template that outruns the model.
 */
import { CONTROLS, DEFAULTS } from "./model.js"
import { K } from "./assumptions.js"
import { costCapCHF } from "../customer.js"
import { requirements, serviceMap, riskRegister, ROLES, CHECKLIST } from "./sa.js"

// ---------------------------------------------------------------------------------------------
// Small tables the copy and the context need
// ---------------------------------------------------------------------------------------------

/** The processor-family table (K.compute.cpuArch, explain brief 2.5) with the plain labels the bars and copy use. */
export const CPU_ARCH = Object.fromEntries(Object.entries(K.compute.cpuArch).map(([id, o]) => [id, { label: o.label, bar: o.bar, workPerAuh: o.workPerAuh, kwFactor: o.kwFactor }]))

const ML_PLACEMENT = { dr: "the campus", hinwil: "the Hinwil room", cloud: "the cloud" }
const COOLING_WORD = { air: "Air cooling", reardoor: "Rear-door cooling", dlc: "Direct liquid cooling" }
const SITE_WORD = { hinwil: "Hinwil room", dr: "Digital Realty Zurich" }
const ENVELOPE_KW = K.facility.envelopeKW

/**
 * Tile ids by the label the views pass to stat(), gauge(), bar() and ribbonRow(), so every tile gets its `?`
 * without touching each call site. Pure data: widgets.js reads it for the DOM, the coverage test for the audit.
 */
export const TILE_BY_LABEL = Object.freeze({
  "Seconds per lap vs Today": "headline-sec", "Seconds a lap found": "headline-sec", "From more useful computing": "stat-aero", "From money kept inside the cap": "stat-reinvest",
  "Turnaround per run": "stat-turnaround", "Design iterations": "stat-runs", "Availability": "stat-availability", "Work per metered AUh": "stat-work",
  "PUE": "stat-pue", "PUE · CO₂": "stat-pue", "Run-rate": "stat-yearly", "Inside the cap": "stat-cap", "Inside the cost cap": "stat-cap", "Cap per effective MAUh": "stat-tco",
  "CO₂ market-based": "stat-co2", "CO₂ (market-based)": "stat-co2", "Heat reused": "stat-heat", "Data-to-decision": "stat-decision", "Race weekends at risk": "stat-weekends", "Link availability": "stat-link",
  "Bandwidth headroom": "stat-headroom", "Cost-cap charge": "gauge-cap", "Allowance turned into work": "gauge-eff", "Effective MAUh": "gauge-eff", "Effective MAUh (season)": "gauge-eff",
  "Cash 2027 + 2028": "stat-cash-total", "3-year TCO (2028 estate)": "stat-tco3", "Lap time, both seasons": "stat-sec-total", "kW at Digital Realty of 500": "envelope",
  "Go-live": "stat-golive", "Allowance lost at the switch": "stat-loss", "Critical path": "stat-critical", "2028 step-up": "stat-stepup", "Where the seconds come from": "waterfall",
  "Interconnect": "eff-bars", "Storage I/O": "eff-bars", "Cooling": "eff-bars", "Schedule": "eff-bars", "Power": "eff-bars", "Cost lines": "money-lines", "Cost lines and one-offs": "money-lines",
  // FIA, Compute, Facility and Connectivity drill-down tiles
  "Allowance per period": "stat-allowance", "Wind tunnel": "stat-windtunnel", "GPU solver": "stat-gpusolver", "Cost cap": "stat-costcap",
  "Cluster": "stat-cluster", "Cluster depreciation": "stat-itcharge", "HPE GreenLake charge": "stat-itcharge",
  "Where": "stat-where", "Racks": "stat-racks", "Redundancy": "stat-redundancy", "Electricity": "stat-electricity", "Cage positions": "bar-cage",
  "Hinwil ↔ campus": "stat-fibre", "Cloud on-ramps": "stat-onramps",
  // Commercials and the Solutions Architect head
  "Outside the cap": "gauge-outside",
  "2027 IT load at the campus": "stat-campus-load", "2028 IT load at the campus": "stat-campus-load", "Suite ready by": "stat-ready", "Open risks": "stat-risks",
})
export function tileIdFor(label) {
  if (typeof label !== "string") return null
  if (TILE_BY_LABEL[label]) return TILE_BY_LABEL[label]
  if (/^MAUh used/.test(label)) return "gauge-mauh"
  if (/IT load vs/.test(label)) return "bar-power"
  if (/^kW at Digital Realty of/.test(label)) return "envelope"
  if (/^kW kept at Hinwil/.test(label)) return "hinwil-gauge"
  if (/^Cash in /.test(label)) return "stat-cash-total"
  return null
}

/** Plain words for the model's units when the Plain English toggle is on. */
const UNIT_WORDS = {
  MAUh: "million unit-hours",
  AUh: "unit-hours",
  CCF: "declared clock",
  PUE: "power overhead",
  "Rp/kWh": "rappen per kilowatt-hour",
  "kW/rack": "kW per cabinet",
  TFLOPS: "trillion precise sums a second",
  RTT: "round trip",
  TCO: "total cost",
}

// ---------------------------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------------------------

const CONTROL_ENTRIES = {
  season: {
    title: "Season",
    one: "Choose the season the plan is judged in. 2027 is the last processor-only year; from 2028 graphics processors may join.",
    more: [
      "The FIA sets what counts each season. In 2027 only ordinary processors may run the restricted airflow maths.",
      "From 1 January 2028 graphics processors may too, but the FIA has not yet said how they will be charged.",
      "The money cap also changes slightly each year.",
    ],
    analogy: "Two school years with slightly different exam rules.",
    inPlan: "Judged in {x.season}: {d.seasonSolver}.",
    source: "F4.4.1 · C6 · C10",
    terms: ["term.atr", "term.gpu"],
  },
  position: {
    title: "Last year's finishing position",
    one: "Where the team finished last year. Lower places get more allowance.",
    more: [
      "The FIA gives more wind-tunnel and computing time to teams that finished lower. First place gets 70 % of the base amount, tenth gets 115 %.",
      "Eighth, the default here, gets 105 %: 6.3 million allocation-unit hours per eight-week period.",
      "The team's own result moves this slider.",
    ],
    analogy: "A golf handicap: the further behind you are, the more shots you are given.",
    inPlan: "Position P{x.position}: {s.fia.pct} % of the base amount, {s.fia.allowance.mauh} million unit-hours per period.",
    source: "F4.6.1 · C5",
    terms: ["term.atr", "term.auh"],
  },
  confidence: {
    title: "Model confidence",
    one: "How much of the modelled gain you choose to believe.",
    more: [
      "The model turns computing into lap time with a curve fitted to public statements, not measurements from this team.",
      "The confidence slider scales every modelled gain. 60 % is the default; 100 % is \"the curve is exactly right\".",
      "It never changes costs or the allowance, only the seconds.",
    ],
    analogy: "A weather forecast's \"60 % chance of rain\".",
    inPlan: "At {x.confidence} %: every modelled gain is multiplied by {x.confidence / 100}.",
    source: "J-a · J-b · model",
    terms: ["term.correlation"],
  },
  nodes: {
    title: "Processor servers",
    one: "How many processor servers run the airflow maths.",
    more: [
      "Each server holds two processors. More servers finish more runs each period, until the allowance is used up; after that the extra servers sit idle.",
      "Each server draws about 1.2 kW, which is why the room's power matters.",
    ],
    analogy: "More tills at the supermarket, until the shop runs out of customers.",
    inPlan: "{x.nodes} servers × {x.coresPerNode} cores = {s.hw.cores} cores, using {fmt.pct(s.comp.usage)} of the allowance.",
    source: "F4.4.4 · C9 · B-c",
    terms: ["term.auh", "term.atp"],
  },
  coresPerNode: {
    title: "Cores per server",
    one: "How many cores (little calculators) each server holds.",
    more: [
      "A core is one calculator inside a processor. Today's parts have 96 per processor, 192 per server.",
      "More cores per server mean fewer servers for the same allowance, less space, and a cheaper per-core electricity bill.",
    ],
    analogy: "A bus with more seats needs fewer buses.",
    inPlan: "{x.coresPerNode} cores per server, {s.hw.cores} cores in total.",
    source: "K5 · K6",
    terms: ["term.auh"],
  },
  clockGHz: {
    title: "Declared clock",
    one: "The speed the team promises the FIA its cores run at. Slower is cheaper under the allowance.",
    more: [
      "The FIA charges allowance per core per clock tick. Declaring a slower clock buys more core-hours for the same allowance.",
      "Slower cores do less work each, but less than proportionally, because airflow maths spends most of its time waiting for memory, not calculating.",
      "The clock may not be declared below the chip's base speed, and if turbo is left on the fastest turbo speed is charged.",
    ],
    analogy: "Driving at 100 km/h instead of 130 uses far less fuel per kilometre; you still get there.",
    inPlan: "Declared at {fmt.num(x.clockGHz, 1)} GHz: {fmt.num(s.comp.clockWorkPerAuh, 2)}× the useful work per unit of a 3.7 GHz machine.",
    source: "F4.4.2 · F4.4.4 · J-d",
    terms: ["term.auh", "term.declaredClock", "term.bandwidth"],
  },
  cpuArch: {
    title: "Processor family",
    one: "The processor family. Some finish the same maths with far fewer trips to memory, and the FIA does not charge for that.",
    more: [
      "Airflow maths updates tens of millions of small boxes of air from their neighbours, thousands of times. The numbers come from memory, and the core waits for them.",
      "A processor with a very large on-chip store (3D V-Cache) or faster memory waits less, so it finishes sooner at the same declared clock. The FIA counts cores and clock, not work done, so this speed is free under the allowance.",
      "Costs: a little more power and money per server. Parts for 2028 (Venice-X, Xeon 7) launch in 2027: order early. Arm parts need the team's own code re-tested.",
    ],
    analogy: "A cook with every ingredient on the counter instead of in the cellar.",
    inPlan: "{d.archLabel}: {fmt.num(d.archFactor, 2)}× the useful work per unit vs Today's processors, at {fmt.pct(d.archPowerDelta)} more power per server.",
    source: "K2 · K3 · K4 · K-b · A15",
    terms: ["term.vcache", "term.bandwidth", "term.ipc"],
  },
  memoryGB: {
    title: "Memory per server",
    one: "How much working memory each server has. Too little and big runs slow down.",
    more: [
      "A full-car airflow model needs several hundred gigabytes spread across the servers. If a server has too little, the run has to be split more finely and spends more time passing messages.",
      "More than enough adds cost but no speed.",
    ],
    analogy: "A desk big enough for all the papers you are working on.",
    inPlan: "{x.memoryGB} GB per server: memory factor {fmt.num(s.comp.eff.memory, 2)}×.",
    source: "H-a · model",
    terms: ["term.cfd"],
  },
  interconnect: {
    title: "Server-to-server network",
    one: "The network the servers use to talk to each other mid-run.",
    more: [
      "Each server owns one slice of the air around the car and must swap border values with its neighbours every step. A slow or busy network leaves cores waiting.",
      "InfiniBand and Slingshot are built for this; ordinary Ethernet is not.",
    ],
    analogy: "A relay team: the baton pass is where time is lost.",
    inPlan: "{d.option.interconnect}: network factor {fmt.num(s.comp.eff.interconnect, 3)}× ({fmt.pct(1 - s.comp.eff.interconnect, 1)} of core time lost waiting).",
    source: "H-a · H2 · model",
    terms: ["term.interconnect"],
  },
  storage: {
    title: "Storage",
    one: "Where the run files live and how fast they load and save.",
    more: [
      "Each run reads a mesh of several hundred gigabytes and writes results of the same size. Ordinary network storage delivers a few gigabytes a second; a parallel file system delivers tens.",
      "While cores wait for files, their metered time still counts. The team's 2023 cluster already uses Cray ClusterStor parallel storage.",
    ],
    analogy: "Filling a bath from a garden hose or a fire hose.",
    inPlan: "{d.option.storage}: storage factor {fmt.num(s.comp.eff.io, 2)}×.",
    source: "H-a · A15 · model",
    terms: ["term.pfs"],
  },
  gpus: {
    title: "Graphics processors",
    one: "How many graphics processors the plan has for preparing and reviewing runs.",
    more: [
      "Graphics processors do many simple sums at once. Outside the restricted solver they speed up meshing (cutting the air into boxes), post-processing (turning numbers into pictures) and machine learning.",
      "They draw up to 1.65 kW each and need strong cooling.",
    ],
    analogy: "Hiring extra kitchen porters so the chef never waits for clean pans.",
    inPlan: "{x.gpus} graphics processors, {x.solverGpus} of them on the restricted solver.",
    source: "F4.4.4 · J2",
    terms: ["term.gpu"],
  },
  solverGpus: {
    title: "Graphics processors on the solver",
    one: "How many of those graphics processors run the restricted airflow maths (allowed from 2028).",
    more: [
      "From 1 January 2028 graphics processors may run the restricted solver. The FIA has not published how to charge them.",
      "The model treats each as a set of ordinary cores doing the same precise maths (FP64), scaled by the charge factor below. In 2027 they fall back to preparation work.",
    ],
    analogy: "New players allowed on the pitch next season, with the rulebook for their fouls still being written.",
    inPlan: "{x.solverGpus} solver graphics processors ≈ {fmt.num(s.hw.gpu.coreEquivalents, 0)} core-equivalents each, charged at {x.gpuChargePct} %.",
    source: "F4.4.1 · C6 · C10 · J-c",
    terms: ["term.gpu", "term.fp64"],
  },
  gpuModel: {
    title: "Graphics processor type",
    one: "Which graphics processor. The model charges them by their precise-maths speed.",
    more: [
      "Processors for AI are built for fast, rough maths; airflow maths needs precise maths (64-bit). The model converts each part's precise-maths speed into \"how many ordinary cores is this worth\" and charges that.",
      "A part that is 8× faster at precise maths is charged 8× more; a part with almost no precise maths (B300-class) does little useful solver work.",
    ],
    analogy: "A van rated by how much it carries, not how fast it goes.",
    inPlan: "{d.option.gpuModel}: {s.hw.gpu.fp64} TFLOPS of precise maths ≈ {fmt.num(s.hw.gpu.coreEquivalents, 0)} core-equivalents, {s.hw.gpu.kW} kW each.",
    source: "J2 · J-c · C10",
    terms: ["term.fp64", "term.gpu"],
  },
  gpuChargePct: {
    title: "Assumed charge for graphics processors",
    one: "A guess at how harshly the FIA will charge graphics processors. 100 % is the worst case.",
    more: [
      "Nobody knows yet. At 100 % every core-equivalent is charged in full; at 50 % half.",
      "The headline figure changes a lot with this slider, so the plan should still work at 100 %.",
    ],
    analogy: "Budgeting for the full ticket price before you know the discount.",
    inPlan: "Charged at {x.gpuChargePct} %: {fmt.num(s.comp.gpuMauh, 2)} million unit-hours per period for the solver graphics processors.",
    source: "C10 · J-c",
    terms: ["term.auh", "term.fp64"],
  },
  consumption: {
    title: "Buy or pay monthly",
    one: "Buy the hardware, or pay HPE for it as a service each month (GreenLake).",
    more: [
      "Buying puts the cost through the money cap as depreciation over the refresh period. GreenLake spreads it as a monthly charge with a reserved minimum; the team's 2023 cluster is already on GreenLake.",
      "Both count inside the cap; what changes is timing, flexibility and how fast the team can add capacity.",
    ],
    analogy: "Buying a car vs leasing it.",
    inPlan: "{d.option.consumption}: {d.lines.it.label}, {fmt.chf(d.lines.it.chf)} a year.",
    source: "A15 · H1 · H-b",
    terms: ["term.greenlake", "term.capcharge"],
  },
  committedPct: {
    title: "Reserved GreenLake share",
    one: "How much of the GreenLake capacity is reserved whatever happens.",
    more: [
      "GreenLake charges a reserved minimum plus actual use above it.",
      "A high reserve is cheaper per unit but less flexible; a low reserve costs more per unit when the cluster is busy.",
    ],
    analogy: "A phone plan with included minutes.",
    inPlan: "{x.committedPct} % reserved: charged on {fmt.pct(s.money.utilisation)} of the list rate.",
    source: "H1 · H-b",
    terms: ["term.greenlake"],
  },
  termYears: {
    title: "GreenLake contract length",
    one: "How long the GreenLake contract runs.",
    more: ["Three years tracks the refresh cadence; five years is cheaper per month but locks in older hardware."],
    analogy: "A short or long lease.",
    inPlan: "{x.termYears}-year term: {fmt.chf(d.lines.it.chf)} a year.",
    source: "H-b",
    terms: ["term.greenlake"],
  },
  support: {
    title: "Repair speed",
    one: "How fast a broken server is fixed.",
    more: [
      "Next-business-day fixes mean a failed server sits idle for a day or more; a 4-hour or 24×7 contract gets it back inside the shift.",
      "Lost hours are lost allowance: the FIA does not pause the clock for breakdowns.",
    ],
    analogy: "Breakdown cover that comes in an hour, not tomorrow.",
    inPlan: "{d.option.support}: about {fmt.num(s.comp.lostHoursPerYear, 0)} hours a year lost to failures ({fmt.pct(1 - s.comp.eff.availability, 2)} of the allowance).",
    source: "H-c · J3",
    terms: ["term.atp"],
  },
  refreshYears: {
    title: "How often processors are replaced",
    one: "How often the processors are replaced. Newer chips do more per tick, and only ticks are charged.",
    more: [
      "The FIA counts clock ticks. A processor from three years ago and one from this year tick at the same declared speed, but the new one finishes more work per tick.",
      "A three-year cadence keeps the fleet on the latest generation at the cost of faster depreciation inside the cap.",
    ],
    analogy: "Replacing a phone every three years instead of five: same bars, much faster.",
    inPlan: "{x.refreshYears}-year cadence: silicon factor {fmt.num(s.comp.eff.ipc, 2)}× per tick; {d.lines.it.label} {fmt.chf(d.lines.it.chf)} a year.",
    source: "H-d · J3",
    terms: ["term.ipc", "term.capcharge"],
  },
  leadWeeks: {
    title: "Switch-on date",
    one: "When the hardware is switched on, relative to 1 January.",
    more: [
      "The allowance runs in eight-week periods from 1 January. A cluster delivered six weeks late loses six weeks of allowance that cannot be carried over.",
      "Early delivery costs a few weeks of running costs and is worth it.",
    ],
    analogy: "Arriving at the exam after it has started.",
    inPlan: "{d.leadLabel}: {fmt.pct(1 - s.comp.eff.delivery, 1)} of the year's allowance unusable.",
    source: "F4.1.4 · C7 · H-e",
    terms: ["term.atp"],
  },
  location: {
    title: "Where the servers live",
    one: "Where the servers live: today's room at Hinwil, the Digital Realty campus, or both.",
    more: [
      "The Hinwil room is part of the factory, close to the wind tunnel, but it cannot power or cool the full estate.",
      "The campus has the power, cooling and redundancy, 25 km away, joined by fibre. Hybrid keeps a small part at Hinwil.",
      "The campus fee has a property part outside the cap.",
    ],
    analogy: "Cooking in the home kitchen or renting space in a professional one.",
    inPlan: "{d.option.location}: {d.siteName} carries {fmt.num(d.sitePowerKW, 0)} kW of IT against {d.siteCapKW} kW available.",
    source: "A-a · G1 · G7 · C3",
    terms: ["term.darkfibre", "term.capcharge"],
  },
  hinwilRetrofit: {
    title: "Upgrade the Hinwil room",
    one: "Spend on the Hinwil room so it can power more servers.",
    more: [
      "Adds switchgear and cooling to the existing room.",
      "The money is a property cost outside the cap, but the room still has a ceiling and no second power feed.",
    ],
    analogy: "Extending the house instead of moving.",
    inPlan: "Hinwil room capacity {s.fac.hinwilCapacity} kW; {d.retrofitNote}.",
    source: "A-e · C3",
    terms: ["term.capcharge", "term.redundancy"],
  },
  committedKW: {
    title: "Power reserved at the campus",
    one: "How much power the team reserves at the campus.",
    more: [
      "The campus bills a fee per reserved kilowatt whether or not it is used.",
      "Reserve too little and servers go unpowered; too much and money is wasted. The offer on the table is 500 kW in both seasons.",
    ],
    analogy: "Booking a table for eight when six might come.",
    inPlan: "{x.committedKW} kW reserved against {fmt.num(s.fac.drIT, 0)} kW of IT load at the campus.",
    source: "G-c · D-d",
    terms: ["term.capcharge"],
  },
  mlPartitionKW: {
    title: "Machine-learning partition",
    one: "Power set aside for machine-learning and other unrestricted graphics processors.",
    more: [
      "This work does not count against the FIA allowance, but it does count against the 500 kW at the campus (or the room at Hinwil) wherever it is placed.",
      "The model takes it off what is left for the metered cluster.",
    ],
    analogy: "A second fridge in the same kitchen: useful, but it shares the sockets.",
    inPlan: "{d.ml.kW} kW for machine learning at {d.ml.placementLabel}: {fmt.num(d.envelope.drIT, 0)} of {d.envelope.offerKW} kW used at the campus.",
    source: "G-h · J-g",
    terms: ["term.gpu", "term.onramp"],
  },
  mlPlacement: {
    title: "Where the machine-learning partition lives",
    one: "Where the machine-learning partition lives: the campus, Hinwil, or the cloud.",
    more: [
      "At the campus it uses envelope power; at Hinwil it uses the room's power.",
      "In the cloud it uses neither but is paid for by the hour inside the cap.",
    ],
    analogy: "Keeping the second fridge in the kitchen, the garage, or renting one.",
    inPlan: "{d.ml.placementLabel}: {d.ml.note}.",
    source: "G-h · J-g · model",
    terms: ["term.onramp", "term.capcharge"],
  },
  rackKW: {
    title: "Power per cabinet",
    one: "How much power is packed into each cabinet of servers.",
    more: [
      "Dense cabinets save space and cable but need stronger cooling. Air cooling tops out around 20 kW a cabinet, rear doors around 70, direct liquid 150.",
      "Above the limit chips slow themselves down while the FIA still charges the declared clock.",
    ],
    analogy: "A crowded room gets hot fast.",
    inPlan: "{x.rackKW} kW per cabinet, {s.hw.racks} cabinets; cooling limit {s.fac.coolingMax} kW.",
    source: "G5 · D9 · model",
    terms: ["term.dlc", "term.reardoor"],
  },
  cooling: {
    title: "Cooling",
    one: "How the heat is taken away: fans, a cold door, or water to the chip.",
    more: [
      "Air moves heat with fans and chillers (highest electricity overhead). A rear-door heat exchanger is a radiator on the cabinet door.",
      "Direct-to-chip liquid pipes water onto the processors; it supports the densest racks, cuts the power overhead most, and makes the heat easy to reuse.",
      "Hinwil needs plumbing for the water options.",
    ],
    analogy: "Cooling a laptop with a fan, a cold table, or a water block.",
    inPlan: "{d.option.cooling}: power overhead {fmt.num(s.fac.pue, 2)}; thermal factor {fmt.num(s.comp.eff.thermal, 2)}×.",
    source: "G-b · H2 · D5",
    terms: ["term.dlc", "term.reardoor", "term.pue"],
  },
  redundancy: {
    title: "Spares for power and cooling",
    one: "Whether power and cooling have spares: none, one spare, or a full second set.",
    more: [
      "\"N\" means exactly enough. \"N+1\" keeps one spare of each. \"2N\" doubles everything so maintenance never stops the cluster.",
      "Each step costs more and loses fewer hours a year.",
    ],
    analogy: "One spare tyre vs a second car.",
    inPlan: "{d.option.redundancy}: availability {fmt.availability(s.comp.availabilityPct / 100)}, about {fmt.num(s.comp.lostHoursPerYear, 0)} hours a year lost.",
    source: "G-d · A-c",
    terms: ["term.redundancy"],
  },
  pueMode: {
    title: "Power overhead: derived or your own",
    one: "Let the model work out the power overhead, or type your own.",
    more: [
      "Power usage effectiveness is total site power divided by server power.",
      "Derived uses the cooling and site chosen; override lets you test a figure from a quote.",
    ],
    analogy: "Letting the sat-nav pick the route or typing one in.",
    inPlan: "{d.pueModeLabel}: PUE {fmt.num(s.fac.pue, 2)}.",
    source: "G-b · A-b · model",
    terms: ["term.pue"],
  },
  pueValue: {
    title: "Your own power overhead figure",
    one: "Your own figure for the power overhead.",
    more: ["1.15 is a very efficient liquid-cooled hall; 1.6 is an old air-cooled room. Every 0.1 is about 7 % on the electricity bill."],
    analogy: "The service charge on top of the bill.",
    inPlan: "PUE {fmt.num(x.pueValue, 2)}: {fmt.chf(d.lines.power.chf)} a year for electricity.",
    source: "D7 · G-b",
    terms: ["term.pue"],
  },
  tariffRp: {
    title: "Electricity price",
    one: "The price of electricity, in rappen per kilowatt-hour.",
    more: [
      "Hinwil buys from the local utility; the campus buys at scale.",
      "The whole electricity bill counts inside the money cap, so every rappen saved is money for the car.",
    ],
    analogy: "The unit price on an energy bill.",
    inPlan: "{x.tariffRp} Rp/kWh: {fmt.chf(d.lines.power.chf)} a year inside the cap.",
    source: "D-a · D-b",
    terms: ["term.capcharge"],
  },
  renewable: {
    title: "Renewable electricity",
    one: "Buy electricity certified as renewable.",
    more: [
      "Changes the reported CO₂ (market-based), not the lap time or the bill in this model.",
      "The campus's European sites already run on renewable supply.",
    ],
    analogy: "Choosing the green tariff.",
    inPlan: "{d.renewableNote}.",
    source: "D4 · D-c",
    terms: [],
  },
  heatReuse: {
    title: "Heat reuse",
    one: "Send the servers' heat to the local heating network (campus only).",
    more: [
      "The campus feeds waste heat to nearby homes. It does not change lap time; it avoids CO₂ elsewhere and is a story for sponsors.",
      "Needs the campus and works best with liquid cooling.",
    ],
    analogy: "Warming the house with the oven you were using anyway.",
    inPlan: "{fmt.num(s.money.heatMWh, 0)} MWh a year reused, about {fmt.num(s.money.co2HeatAvoidedT, 0)} t CO₂ avoided.",
    source: "G4 · D5",
    terms: ["term.dlc"],
  },
  fitOutCHF: {
    title: "Campus fit-out (one-off)",
    one: "One-off cost to prepare the campus space.",
    more: ["Cages, cabinets, power whips, cabling. It is a property cost, outside the money cap, depreciated over the lease."],
    analogy: "Fitting out a new shop.",
    inPlan: "Fit-out {fmt.chf(x.fitOutCHF)} one-off, outside the cap.",
    source: "C3 · G-c",
    terms: ["term.capcharge"],
  },
  migrationCHF: {
    title: "Moving cost (one-off)",
    one: "One-off cost of moving the cluster and running both for a while.",
    more: ["Transport, re-installation, parallel running and re-declaration. Counts inside the cap in the year of the move."],
    analogy: "Removal vans and a month of double rent.",
    inPlan: "Migration {fmt.chf(x.migrationCHF)} one-off, inside the cap.",
    source: "F4.4.3 · model",
    terms: ["term.capcharge"],
  },
  migrationTiming: {
    title: "When to move",
    one: "Move between two allowance periods, or in the middle of one.",
    more: [
      "The FIA needs a fresh declaration within a month of a move.",
      "Moving mid-period loses about seven solver days; moving at a period boundary loses almost nothing.",
    ],
    analogy: "Moving house during the school holidays.",
    inPlan: "{d.option.migrationTiming}: migration factor {fmt.num(s.comp.eff.migration, 3)}×.",
    source: "F4.4.3 · model",
    terms: ["term.atp"],
  },
  propertySharePct: {
    title: "Property share of the campus fee",
    one: "How much of the campus fee counts as property (outside the money cap).",
    more: [
      "The fee pays for space, power and cooling. Space is property, which the cap excludes; the rest is inside.",
      "The split must be agreed with the FIA's cost-cap office; 50 % is the model's default.",
    ],
    analogy: "Splitting a hotel bill into the room and the meals.",
    inPlan: "{x.propertySharePct} % of {fmt.chf(d.lines.fee.chf)} outside the cap: {fmt.chf(d.lines.fee.cap)} a year inside.",
    source: "C3 · C3-open",
    terms: ["term.capcharge"],
  },
  fibrePairs: {
    title: "Fibre routes to the campus",
    one: "How many separate fibre routes join Hinwil to the campus.",
    more: [
      "One route is a single point of failure (a digger cuts it, the wind tunnel loses its cluster).",
      "Two routes on different paths keep going.",
    ],
    analogy: "Two roads out of town.",
    inPlan: "{d.option.fibrePairs}: link availability {fmt.availability(s.net.linkAvailability)}.",
    source: "G-a · B-e · model",
    terms: ["term.darkfibre"],
  },
  fibreGbps: {
    title: "Fibre speed",
    one: "How fast the fibre is.",
    more: [
      "Run files are hundreds of gigabytes. At 10G a result takes minutes to copy to Hinwil; at 100G or 400G it is seconds.",
      "Also carries the wind-tunnel and simulator data.",
    ],
    analogy: "A one-lane or three-lane motorway.",
    inPlan: "{d.option.fibreGbps} between Hinwil and the campus; the paddock link offers {s.net.profile.mbps} Mbps.",
    source: "B-e · I1",
    terms: ["term.darkfibre"],
  },
  trackside: {
    title: "Garage-to-factory link",
    one: "How the garage talks to the factory on race weekends.",
    more: [
      "Public internet is cheap but variable. A carrier service has guaranteed speed and latency. Two carriers with a satellite backup is the safest and dearest.",
      "Faster, steadier links mean quicker strategy calls and fewer lost sessions.",
    ],
    analogy: "Texting over free Wi-Fi or a private line.",
    inPlan: "{d.option.trackside}: {fmt.num(s.net.venue.rttMs, 0)} ms round trip at {s.net.venue.name}, decision in {fmt.num(s.net.venue.decisionSec, 1)} s.",
    source: "I-a · I-b · B-f",
    terms: ["term.rtt"],
  },
  edge: {
    title: "Edge computers in the garage",
    one: "Small computers in the garage that pre-digest telemetry before sending it home.",
    more: [
      "Takes about 1.5 seconds off the time from data to decision, and keeps working when the link stutters.",
      "Costs money inside the cap.",
    ],
    analogy: "Sorting the post before it goes to head office.",
    inPlan: "{d.edgeNote}.",
    source: "I-d",
    terms: ["term.edge"],
  },
  cloudOnRamp: {
    title: "Private cloud connections",
    one: "Private connections from the campus to the big clouds.",
    more: [
      "Lets the team burst non-restricted work (machine learning, data) to AWS or Azure over a private link.",
      "Costs money inside the cap; no lap-time effect in this model.",
    ],
    analogy: "A side door into the warehouse.",
    inPlan: "{d.cloudNote}.",
    source: "G6",
    terms: ["term.onramp"],
  },
  venue: {
    title: "Race for the latency readout",
    one: "Which race the latency readout is shown for.",
    more: [
      "Round-trip time to Hinwil differs by venue.",
      "The venue changes the data-to-decision readout; Today is read at the same venue, so the seconds per lap never move.",
    ],
    analogy: "Checking the signal at different stadiums.",
    inPlan: "{s.net.venue.name}: {fmt.num(s.net.venue.rttMs, 0)} ms round trip.",
    source: "I-a",
    terms: ["term.rtt"],
  },
}

const TILE_ENTRIES = {
  "headline-sec": {
    title: "Seconds a lap found",
    term: "Seconds per lap vs Today",
    one: "Seconds a lap this plan finds over the season, compared with keeping today's setup.",
    more: [
      "Two channels add up: more useful computing (better aero), and money kept inside the cap that goes into the car.",
      "Scaled by your confidence.",
    ],
    analogy: "The stopwatch.",
    inPlan: "{fmt.sec(p.sec)} per lap vs Today at {x.confidence} % confidence: {fmt.sec(d.aeroSec)} from computing, {fmt.sec(d.reinvestSec)} from money.",
    source: "J-a · J-b · model",
    terms: ["term.shapley", "term.capcharge"],
  },
  "stat-aero": {
    title: "From more useful computing",
    term: "Aero programme",
    one: "Lap time from doing more useful airflow computing in the same allowance.",
    more: [
      "Each design iteration teaches the team something.",
      "The curve rises steeply at first and flattens: twice the computing is not twice the lap time.",
    ],
    analogy: "Revising more for the same exam time.",
    inPlan: "{fmt.num(s.comp.effectiveMauh, 2)} vs {fmt.num(t.comp.effectiveMauh, 2)} effective million unit-hours per period.",
    source: "J-a · J1",
    terms: ["term.auh", "term.cfd"],
  },
  "stat-reinvest": {
    title: "From money kept inside the cap",
    term: "Cost-cap reinvestment",
    one: "Lap time from money kept inside the cost cap.",
    more: [
      "Every franc the IT programme saves inside the cap is a franc for car parts.",
      "The model gives ±0.3 s at most for CHF 3 M saved or spent, with diminishing returns. Negative means the plan spends more inside the cap than Today.",
    ],
    analogy: "Spending the money you saved on the bills.",
    inPlan: "{fmt.chfDelta(-p.capChargeDelta)} inside the cap a year → {fmt.sec(d.reinvestSec)} per lap.",
    source: "J-b · C1",
    terms: ["term.costcap", "term.capcharge"],
  },
  "stat-decision": {
    title: "Data to decision",
    term: "Data-to-decision seconds",
    one: "How long it takes for a reading at the track to become a call on the pit wall, in seconds.",
    more: [
      "Telemetry goes from the garage to Hinwil and back: a base of 6 s plus two round trips, minus 1.5 s when edge compute in the garage pre-digests it.",
      "Under about 5 s the engineers decide inside the same lap; the venue slider picks the circuit the readout is shown for.",
    ],
    analogy: "The delay between a question and the answer on a long-distance call.",
    inPlan: "{fmt.num(s.net.venue.decisionSec, 1)} s at {s.net.venue.name} vs {fmt.num(t.net.venue.decisionSec, 1)} s Today ({fmt.signed(-p.decisionDeltaSec, 1)} s).",
    source: "I-a · I-d",
    terms: ["term.rtt", "term.edge"],
  },
  "stat-weekends": {
    title: "Race weekends at risk",
    term: "Race weekends at risk",
    one: "How many of the season's race weekends the model expects to run without the factory link.",
    more: [
      "Link availability times the 24 race weekends: a 99.9 % link loses about 0.02 weekends a season, a public-internet link ten times that.",
      "A second route or a satellite back-up moves this, not lap time.",
    ],
    analogy: "The number of matches the TV broadcast drops out for.",
    inPlan: "{fmt.num(s.net.weekendsLost, 2)} of {s.net.raceWeekends} weekends vs {fmt.num(t.net.weekendsLost, 2)} Today, link {fmt.availability(s.net.linkAvailability)}.",
    source: "I-b · C7",
    terms: [],
  },
  "season-strip": {
    title: "2027 plan, 2028 path",
    term: "Season strip",
    one: "The same plan in 2027 and 2028 side by side.",
    more: ["2028 adds graphics processors and a larger estate; a plan good in one year may fail in the other."],
    analogy: "The two halves of a season.",
    inPlan: "2027: {fmt.sec(d.sec2027)} · 2028: {fmt.sec(d.sec2028)}.",
    source: "model",
    terms: [],
  },
  "gauge-mauh": {
    title: "Computing allowance used",
    term: "MAUh used",
    one: "How much of the FIA's computing allowance the plan uses each eight-week period.",
    more: [
      "Below 90 % wastes allowance. Above 100 % the cluster must idle part of the period.",
      "Aim for 95–100 %.",
    ],
    analogy: "A fuel gauge that refills every eight weeks.",
    inPlan: "{fmt.pct(s.comp.usage)} of {s.fia.allowance.mauh} million unit-hours.",
    source: "C9 · C5 · F4.6.1",
    terms: ["term.auh", "term.atp"],
  },
  "gauge-cap": {
    title: "Share of the money cap",
    term: "Cost-cap charge",
    one: "How much of the team's money cap the IT programme takes.",
    more: [
      "The cap is about USD 215 M a season; 1–2 % is normal for IT.",
      "Every tenth of a percent is CHF 190k of car.",
    ],
    analogy: "The IT slice of the pie.",
    inPlan: "{fmt.pct(s.money.capShare, 1)} of {fmt.chf(d.costCap, 0)}.",
    source: "C1 · C2 · E-a",
    terms: ["term.costcap"],
  },
  "gauge-eff": {
    title: "Allowance turned into work",
    term: "Effective ratio",
    one: "How much of the allowance turns into useful work.",
    more: [
      "Waiting for data, overheating, breakdowns, late delivery and unpowered servers all waste charged time.",
      "100 % means every charged hour did useful work at today's speed; above 100 % means newer, slower-clocked or bigger-cache cores do more per charged hour.",
    ],
    analogy: "Miles per gallon for computing.",
    inPlan: "{fmt.pct(s.comp.effectiveRatio)}: {fmt.num(s.comp.effectiveMauh, 2)} effective of {fmt.num(s.comp.usedMauh, 2)} charged.",
    source: "model",
    terms: ["term.auh", "term.ipc"],
  },
  "stat-turnaround": {
    title: "Time per design iteration",
    term: "Turnaround per run",
    one: "How long one design iteration takes, from mesh to pictures.",
    more: ["Solver time on the metered cores plus preparation and review, which graphics processors speed up."],
    analogy: "The oven time for one batch.",
    inPlan: "{fmt.hours(s.comp.turnaroundHours)}: {fmt.hours(s.comp.solverHours)} solver + {fmt.hours(s.comp.prePostHours)} preparation and review.",
    source: "H-a · model",
    terms: ["term.turnaround"],
  },
  "stat-runs": {
    title: "Design ideas tested a week",
    term: "Design iterations",
    one: "How many design ideas the team can test a week.",
    more: ["More iterations means more chances to find lap time. Limited by the allowance, the cores and the turnaround."],
    analogy: "Attempts at a puzzle per week.",
    inPlan: "{fmt.num(s.comp.runsPerWeek, 0)} a week, {fmt.num(s.comp.runsPerAtp, 0)} per period.",
    source: "model",
    terms: ["term.turnaround", "term.atp"],
  },
  "stat-availability": {
    title: "Time the cluster is working",
    term: "Availability",
    one: "How much of the time the cluster is actually working.",
    more: ["Breakdowns, power, cooling and the fibre link all take hours away. Lost hours are lost allowance."],
    analogy: "Days the factory is open.",
    inPlan: "{fmt.availability(s.comp.availabilityPct / 100)}: {fmt.num(s.comp.lostHoursPerYear, 0)} hours a year lost.",
    source: "G-d · H-c",
    terms: ["term.redundancy"],
  },
  "stat-work": {
    title: "Useful work per charged unit",
    term: "Work per metered AUh",
    one: "How much useful work each charged unit does, compared with today's machine.",
    more: [
      "Multiplies clock, silicon generation, processor family, network, storage and cooling factors.",
      "The FIA charges units; the team gets work.",
    ],
    analogy: "Value for money.",
    inPlan: "{fmt.num(s.comp.workPerAuh, 2)}× per unit: clock {fmt.num(s.comp.clockWorkPerAuh, 2)} · silicon {fmt.num(s.comp.eff.ipc, 2)} · family {fmt.num(d.archFactor, 2)} · network {fmt.num(s.comp.eff.interconnect, 3)} · storage {fmt.num(s.comp.eff.io, 2)} · cooling {fmt.num(s.comp.eff.thermal, 2)}.",
    source: "J-d · H-d · K-b",
    terms: ["term.auh", "term.ipc", "term.vcache"],
  },
  "eff-bars": {
    title: "Where charged time leaks",
    term: "Efficiency factors",
    one: "Six places where charged time leaks away. 100 % is no leak.",
    more: [
      "Each bar is the share of charged core time not lost to that cause.",
      "Power below 100 % means the room cannot power all the servers.",
    ],
    analogy: "Six taps that should all be fully open.",
    inPlan: "Network {fmt.pct(s.comp.eff.interconnect, 1)} · storage {fmt.pct(s.comp.eff.io, 1)} · cooling {fmt.pct(s.comp.eff.thermal, 1)} · availability {fmt.pct(s.comp.eff.availability, 1)} · delivery {fmt.pct(s.comp.eff.delivery, 1)} · power {fmt.pct(s.comp.eff.power, 1)}.",
    source: "model",
    terms: ["term.interconnect", "term.pfs"],
  },
  "stat-pue": {
    title: "Power overhead",
    term: "PUE",
    one: "The site's power overhead: total power divided by server power.",
    more: [
      "1.15 (liquid-cooled campus) to 1.6 (air-cooled room).",
      "Everything above 1.0 is cooling and losses, paid for inside the cap.",
    ],
    analogy: "The service charge on the bill.",
    inPlan: "PUE {fmt.num(s.fac.pue, 2)}: {d.pueSource}.",
    source: "G-b · A-b · D7",
    terms: ["term.pue"],
  },
  "stat-yearly": {
    title: "Yearly cost",
    term: "Yearly cost",
    one: "What the plan costs a year, everything included.",
    more: ["Depreciation or service charge, support, software, electricity, campus fee, network, cloud and plant. One-offs shown separately."],
    analogy: "The yearly household budget.",
    inPlan: "{fmt.chf(s.money.yearly)} a year, {fmt.chfDelta(p.yearlyDelta)} vs Today; {fmt.chf(s.money.oneOffTotal)} one-off.",
    source: "model",
    terms: ["term.capcharge"],
  },
  "stat-cap": {
    title: "Inside the money cap",
    term: "Inside the cost cap",
    one: "The part of the yearly cost that counts against the money cap.",
    more: ["Property costs (space, fit-out, plant) are outside the cap. Everything else is inside and competes with car parts."],
    analogy: "The part of the bill that comes out of pocket money.",
    inPlan: "{fmt.chf(s.money.capCharge)} inside the cap, {fmt.chfDelta(p.capChargeDelta)} vs Today; {fmt.chf(s.money.excludedYearly)} a year outside.",
    source: "C3",
    terms: ["term.capcharge", "term.costcap"],
  },
  "stat-tco": {
    title: "Three-year total cost",
    term: "3-year TCO",
    one: "Three-year total cost, and what each unit of useful computing costs the cap.",
    more: ["Adds three years of running costs and the one-offs. The second figure is the price of one effective million unit-hours."],
    analogy: "Total cost of owning a car for three years.",
    inPlan: "{fmt.chf(s.money.tco3)} over three years; {fmt.chf(d.costPerEffectiveMauh)} of cap per effective million unit-hours.",
    source: "model",
    terms: ["term.auh"],
  },
  "stat-co2": {
    title: "Carbon",
    term: "CO₂ (market-based)",
    one: "Carbon from the electricity, two ways of counting.",
    more: ["Market-based uses the contract (renewable or not); location-based uses the Swiss grid mix."],
    analogy: "Two ways of reading the same meter.",
    inPlan: "{fmt.num(s.money.co2MarketT, 0)} t market-based, {fmt.num(s.money.co2LocationT, 0)} t location-based, {fmt.signed(p.co2Delta, 0)} t vs Today.",
    source: "D4 · D-c",
    terms: [],
  },
  "stat-heat": {
    title: "Heat given to local homes",
    term: "Heat reused",
    one: "Heat from the servers given to local homes.",
    more: ["Only at the campus; best with liquid cooling."],
    analogy: "Oven heat warming the kitchen.",
    inPlan: "{fmt.num(s.money.heatMWh, 0)} MWh a year reused, about {fmt.num(s.money.co2HeatAvoidedT, 0)} t CO₂ avoided.",
    source: "G4",
    terms: ["term.dlc"],
  },
  "bar-power": {
    title: "Server power against supply",
    term: "IT load vs capacity",
    one: "Server power against what the room or campus can supply.",
    more: ["Red means servers that cannot be switched on. Today's Hinwil room is the binding limit in both seasons."],
    analogy: "Plugging too many heaters into one socket.",
    inPlan: "{fmt.num(d.sitePowerKW, 0)} kW against {d.siteCapKW} kW: {d.powerFit}.",
    source: "A-a · D-d",
    terms: [],
  },
  "money-lines": {
    title: "Cost lines",
    term: "Cost lines and one-offs",
    one: "Each cost line, and whether it counts inside the cap.",
    more: [
      "The servers themselves, spread over the years they are used; support and software; electricity; renting power and space at the campus; cables inside the campus to carriers and clouds; the paddock link; edge and cloud.",
      "Building works are outside the cap. One-offs are listed below the yearly lines.",
    ],
    analogy: "Lines on a bill.",
    inPlan: "{d.lineCount} yearly lines: {fmt.chf(s.money.yearly)} a year, {fmt.chf(s.money.capCharge)} inside the cap; {d.oneOffCount} one-offs totalling {fmt.chf(s.money.oneOffTotal)}.",
    source: "C3 · G-c · H-a",
    terms: ["term.capcharge", "term.crossconnect"],
  },
  "venue-strip": {
    title: "Round trip from each race",
    term: "Venue strip",
    one: "Round-trip time from each race to Hinwil.",
    more: ["Light in fibre takes about 5 ms per 1,000 km. The number sets how fast the pit wall gets answers from the factory."],
    analogy: "Ping times to different servers.",
    inPlan: "{s.net.venue.name}: {fmt.num(s.net.venue.rttMs, 0)} ms, decision in {fmt.num(s.net.venue.decisionSec, 1)} s.",
    source: "I-a",
    terms: ["term.rtt"],
  },
  "stat-decision": {
    title: "Data to decision",
    term: "Data-to-decision",
    one: "How long from a car crossing the line to a strategy answer from the factory.",
    more: ["Link latency, edge pre-processing, and the factory's turnaround. Under five seconds is a pit-wall call made in time."],
    analogy: "How long it takes to get an answer back from a colleague.",
    inPlan: "{fmt.num(s.net.venue.decisionSec, 1)} s at {s.net.venue.name}, {fmt.signed(d.decisionDelta, 1)} s vs Today.",
    source: "I-d",
    terms: ["term.rtt", "term.edge"],
  },
  "stat-headroom": {
    title: "Link headroom",
    term: "Bandwidth headroom",
    one: "How much faster than the telemetry peak the link is.",
    more: ["Below 1× the car's data cannot all get home live. Above 3× there is room for video and simulator traffic."],
    analogy: "Lanes left free on the motorway.",
    inPlan: "{fmt.num(s.net.headroom, 1)}×: {s.net.profile.mbps} Mbps against a {s.net.telemetryPeakMbps} Mbps peak.",
    source: "I-c · I-b",
    terms: ["term.bandwidth"],
  },
  "stat-link": {
    title: "Link uptime",
    term: "Link availability",
    one: "How often the garage-to-factory link is up.",
    more: ["Each 0.1 % of downtime is a few race-weekend sessions a season without factory support."],
    analogy: "The share of calls that connect.",
    inPlan: "{fmt.availability(s.net.linkAvailability)}: about {fmt.num(s.net.weekendsLost, 2)} race weekends a season at risk.",
    source: "I-b",
    terms: [],
  },
  envelope: {
    title: "Share of the 500 kW offer",
    term: "kW at Digital Realty of 500",
    one: "How much of the 500 kW the campus offer this plan uses.",
    more: [
      "The offer is 500 kW of server power in both seasons with two independent feeds.",
      "The gauge adds the cluster, the machine-learning partition and the rest of the estate that moves. Over 500 is \"Not possible\": the plan must shrink or move something to the cloud.",
    ],
    analogy: "A suitcase weight limit at the airport.",
    inPlan: "{fmt.num(d.envelope.drIT, 0)} kW of {d.envelope.offerKW} ({fmt.pct(d.envelope.share)}); {fmt.num(d.envelope.headroomKW, 0)} kW to spare.",
    source: "G-h · G-e · D-d",
    terms: ["term.redundancy"],
  },
  "compare-table": {
    title: "Two plans side by side",
    term: "Compare A / B against Today",
    one: "Two saved plans side by side with Today.",
    more: ["Set a plan as A, change it, set B. Every row is a tile above."],
    analogy: "Two quotes on one page.",
    inPlan: "Every row is a tile above; set a plan as A, change it, set B.",
    source: "model",
    terms: [],
  },
  waterfall: {
    title: "Where the seconds come from",
    term: "Attribution waterfall",
    one: "Where the seconds come from: each bar is one part of the plan and its share of the lap time.",
    more: [
      "Shares are averaged over every order the changes could be made in, so they add up exactly and do not depend on who tells the story first.",
      "Negative bars are parts that cost lap time, usually through money spent inside the cap.",
    ],
    analogy: "Splitting a restaurant bill fairly by what each person ordered.",
    inPlan: "{a.n} parts explain {fmt.sec(a.total.sec)}: biggest {a.top.label} ({fmt.sec(a.top.sec)}, {fmt.pct(a.top.share)}).",
    source: "model · 1.3",
    terms: ["term.shapley"],
  },
  // Plan-level tiles added by the two-season planning tool (plan.js / timeline.js on the customer branch).
  // They read the `plan` facts of explainContext({ plan }), which default to "no move" when no plan result is given.
  "stat-golive": {
    title: "When the 2027 estate goes live",
    term: "2027 go-live",
    one: "The day the new estate takes over the metered runs, and how much of 2027 runs on today's setup before that.",
    more: ["Counted from the contract date through fit-out, fibre, hardware delivery and burn-in. A late go-live hands part of the season to today's room."],
    analogy: "The move-in date on a house purchase.",
    inPlan: "{d.plan.goLiveLabel}: {fmt.pct(d.plan.shareOld27)} of 2027 on today's setup{d.plan.slipNote}.",
    source: "C13 · G-e · H-f",
    terms: ["term.atp"],
    plan: true,
  },
  "stat-loss": {
    title: "Allowance lost at the switch",
    term: "Allowance lost at the switch",
    one: "Share of the eight-week allowance lost while the cluster moves.",
    more: ["Moving at a period boundary or with parallel running loses almost nothing; a mid-period move without it loses about seven solver days."],
    analogy: "Days of a prepaid gym pass lost while you move house.",
    inPlan: "{fmt.pct(d.plan.periodLoss27, 1)} of the period, {fmt.pct(d.plan.seasonLoss27, 2)} of the season: {d.plan.downtimeDays27} solver days.",
    source: "F4.6.1 · C9",
    terms: ["term.atp"],
    plan: true,
  },
  "stat-critical": {
    title: "What sets the earliest date",
    term: "Critical path",
    one: "The longest chain of work between signing and the switch; it sets the earliest possible go-live.",
    more: ["Fibre, the campus fit-out, hardware delivery or the Hinwil works. Shortening anything else does not move the date."],
    analogy: "The slowest leg of a relay decides the finish time.",
    inPlan: "{d.plan.criticalLabel}: {fmt.num(d.plan.totalWeeks27, 0)} weeks from contract to the earliest switch.",
    source: "G-e · D-e · H-f",
    terms: [],
    plan: true,
  },
  "stat-stepup": {
    title: "The 2028 change",
    term: "2028 step-up",
    one: "When the 2028 hardware arrives and whether it is early, on time or late for the first metered run.",
    more: ["Graphics processors may run the solver from 1 January 2028. Early delivery costs carrying weeks; late delivery runs part of 2028 on the 2027 estate."],
    analogy: "Booking the removal van for the right week.",
    inPlan: "{d.plan.stepUpLabel}{d.plan.stepUpNote}.",
    source: "F4.4.1 · C10 · H-f",
    terms: ["term.gpu"],
    plan: true,
  },
  "stat-cash-total": {
    title: "Cash over the two seasons",
    term: "Cash 2027 + 2028",
    one: "Everything paid out over 2027 and 2028, old and new estate together, against staying as today.",
    more: ["Blends the old and the new estate by the share of each year they run, then adds that year's one-offs."],
    analogy: "Two years of bank statements added up.",
    inPlan: "{fmt.chf(d.plan.cash)} over both seasons, {fmt.chfDelta(d.plan.cashDelta)} vs staying as today ({fmt.chf(d.plan.todayCash)}).",
    source: "C3 · G-c · H-a",
    terms: ["term.capcharge"],
    plan: true,
  },
  "stat-tco3": {
    title: "Three-year total cost of the 2028 estate",
    term: "3-year TCO (2028 estate)",
    one: "Three-year total cost of the 2028 estate plus the 2027 one-offs it does not already carry, against today's room in 2028.",
    more: ["Like for like: the same estate size in the same season. The steady state once the plan is in."],
    analogy: "Total cost of owning a car for three years.",
    inPlan: "{fmt.chf(d.plan.tco3)} against {fmt.chf(d.plan.todayTco3)} for today's room carried into 2028.",
    source: "model · C3",
    terms: [],
    plan: true,
  },
  "stat-sec-total": {
    title: "Lap time over both seasons",
    term: "Lap time, both seasons",
    one: "The 2027 and 2028 lap-time gains added together.",
    more: ["Each season is measured against today's setup in that season, at the confidence you set."],
    analogy: "Two race results added into a championship score.",
    inPlan: "{fmt.sec(d.plan.secTotal)} over two seasons at {x.confidence} % confidence.",
    source: "J-a · J-c",
    terms: [],
    plan: true,
  },
  // The FIA, Compute, Facility and Connectivity drill-down tiles
  "stat-allowance": {
    title: "Computing allowance per period",
    term: "Allowance per period",
    one: "How much metered computing the FIA lets the team use in each eight-week period, set by last season's finishing position.",
    more: [
      "The sliding scale: first place gets 70 % of the base amount, tenth or lower 115 %. Eighth place is 105 %: 6.3 million unit-hours per period.",
      "Each period is counted on its own; unused allowance is lost.",
    ],
    analogy: "Pocket money that is higher for the children who did worse last term.",
    inPlan: "Position P{x.position}: {s.fia.pct} % of the base amount, {fmt.num(s.fia.allowance.mauh, 2)} million unit-hours per period.",
    source: "F4.6.1 · C5 · C9",
    terms: ["term.atr", "term.auh", "term.atp"],
  },
  "stat-windtunnel": {
    title: "Wind-tunnel allowance",
    term: "Wind tunnel",
    one: "The wind-tunnel runs and hours the same sliding scale allows per period; nothing in this plan changes them.",
    more: [
      "The tunnel and the computing share one scale: the same finishing position sets both.",
      "Shown so the computing allowance is seen next to its sibling; the plan only moves the computing.",
    ],
    analogy: "The other half of the same ration book.",
    inPlan: "{s.fia.allowance.runs} runs, {s.fia.allowance.windOn} wind-on hours and {s.fia.allowance.occupancy} hours of occupancy per period.",
    source: "F4.6.1 · C5 · A10",
    terms: ["term.atr"],
  },
  "stat-gpusolver": {
    title: "Graphics processors on the solver",
    term: "GPU solver",
    one: "Whether graphics processors may run the restricted airflow solver this season: not before 1 January 2028.",
    more: [
      "In 2027 only ordinary processors count; graphics processors may still do preparation, review and machine learning.",
      "From 2028 they may join the solver, but the FIA has not yet said how they will be charged against the allowance.",
    ],
    analogy: "A new player allowed on the pitch only from next season.",
    inPlan: "{d.gpuSolverNote}.",
    source: "F4.4.1 · C6 · C10",
    terms: ["term.gpu", "term.fp64"],
  },
  "stat-costcap": {
    title: "The money cap",
    term: "Cost cap",
    one: "The cap on what the team may spend on the car in a season, and the share of it this estate takes.",
    more: [
      "About USD 215 M a season; most IT costs count against it, property costs do not.",
      "One to two percent for IT is normal; every tenth of a percent is about CHF 190k of car.",
    ],
    analogy: "The household budget, with the IT bill as one slice.",
    inPlan: "{fmt.chf(d.costCap, 0)} a season; this estate takes {fmt.pct(s.money.capShare, 1)} of it ({fmt.chf(s.money.capCharge)}).",
    source: "C1 · C2 · E-a",
    terms: ["term.costcap", "term.capcharge"],
  },
  "stat-cluster": {
    title: "The cluster",
    term: "Cluster",
    one: "The servers that do the metered airflow computing: how many, how many cores, at what declared clock, in how many racks.",
    more: [
      "Cores × seconds × declared clock is what the FIA charges, so the count and the clock are the two numbers that matter most.",
      "Graphics processors are listed separately with how many of them sit on the solver.",
    ],
    analogy: "The engine: cylinders, revs and the size of the bay it sits in.",
    inPlan: "{d.clusterLine}.",
    source: "F4.4.4 · B-c · H2",
    terms: ["term.auh", "term.declaredClock"],
  },
  "stat-itcharge": {
    title: "Yearly cost of the servers",
    term: "Cluster depreciation / HPE GreenLake charge",
    one: "What the servers themselves cost a year: a bought cluster spread over its refresh years, or the monthly HPE GreenLake charge.",
    more: [
      "Bought: the hardware price divided by the years before the next refresh.",
      "HPE GreenLake: a reserved share paid monthly over the term, buffer servers included; counted inside the money cap either way.",
    ],
    analogy: "Buying the car outright or leasing it by the month.",
    inPlan: "{d.consumptionLabel}: {fmt.chf(d.lines.it.chf)} a year{d.itChargeNote}.",
    source: "H-a · H-b · H1",
    terms: ["term.greenlake", "term.capcharge"],
  },
  "stat-where": {
    title: "Where the cluster lives",
    term: "Where",
    one: "Which room runs the metered cluster: today's Hinwil room, the Digital Realty Zurich campus, or a split with Mission Control left in Hinwil.",
    more: [
      "Hinwil's room is about 300 kW and power-short; the campus offer is 500 kW with two independent feeds.",
      "Hybrid moves the solver estate and keeps the race-weekend operations room at the factory.",
    ],
    analogy: "The garage at home or a rented workshop.",
    inPlan: "{d.siteName}: {d.locationNote}.",
    source: "A-a · G1 · D-d",
    terms: ["term.envelope"],
  },
  "stat-racks": {
    title: "Racks and their density",
    term: "Racks",
    one: "How many racks the cluster takes and how many kilowatts go into each; the cooling choice sets the ceiling per rack.",
    more: [
      "Air to about 20 kW a rack, rear-door heat exchangers to 70, direct liquid to 150.",
      "Denser racks need fewer cage positions but more cooling.",
    ],
    analogy: "How many hobs you can run on one kitchen circuit.",
    inPlan: "{d.racksWord} at {x.rackKW} kW with {d.coolingLower}; limit about {s.fac.coolingMax} kW a rack.",
    source: "G-g · G5 · D9",
    terms: ["term.rackdensity", "term.reardoor", "term.dlc"],
  },
  "stat-redundancy": {
    title: "Spare power and cooling",
    term: "Redundancy",
    one: "How many spares the power and cooling paths have, and the facility availability the model gives for it.",
    more: [
      "N has no spare, N+1 one spare, 2N a complete second set; ZUR2 runs 2N power and N+2 cooling.",
      "An hour down inside a period is allowance that never comes back, which is why race teams buy spares.",
    ],
    analogy: "One spare tyre versus a second car.",
    inPlan: "{d.redundancyLabel}: {fmt.availability(s.fac.availability)} facility availability.",
    source: "G-d · D-d · A-c",
    terms: ["term.redundancy"],
  },
  "stat-electricity": {
    title: "Electricity",
    term: "Electricity",
    one: "The site's electricity for the year, servers plus cooling and losses, and what it costs at the tariff chosen.",
    more: [
      "Server power × hours × the power overhead of the site; the campus overhead is lower than the Hinwil room's.",
      "Electricity counts inside the money cap whatever its colour; renewable supply changes the carbon, not the cap.",
    ],
    analogy: "The yearly power bill for the whole building.",
    inPlan: "{fmt.num(s.fac.totalMWh, 0)} MWh a year: {fmt.chf(d.lines.power.chf)} at {x.tariffRp} rappen per kWh{d.renewableSuffix}.",
    source: "D-a · D-b · G-b",
    terms: ["term.pue"],
  },
  "bar-cage": {
    title: "Cage positions used",
    term: "Cage positions",
    one: "How many of the 60 rack positions in the Digital Realty cage the estate takes.",
    more: [
      "Estate racks are counted at 8 kW each; the cluster and the machine-learning partition at the density you chose.",
      "Over 60 means a bigger cage or denser rows.",
    ],
    analogy: "Parking spaces in a rented garage.",
    inPlan: "{d.envelope.racks} of {d.envelope.cageRackPositions} positions: {d.cageBreakdown}.",
    source: "G-h · G5",
    terms: ["term.rackdensity"],
  },
  "stat-fibre": {
    title: "Fibre between Hinwil and the campus",
    term: "Hinwil ↔ campus",
    one: "The private fibre that joins the factory to the campus: one route or two different ones, and the bandwidth on it.",
    more: [
      "About 40 km, under half a millisecond each way, so engineers in Hinwil work on the cluster as if it were next door.",
      "Two routes on different paths turn a dug-up cable from a lost week into a non-event.",
    ],
    analogy: "Two different roads to the same town.",
    inPlan: "{d.fibreLine}.",
    source: "B-e · D10 · G-a · I-b",
    terms: ["term.darkfibre"],
  },
  "stat-onramps": {
    title: "Private doors into the clouds",
    term: "Cloud on-ramps",
    one: "Whether the plan buys private connections from the campus into AWS and Azure for the work the FIA does not meter.",
    more: [
      "Machine learning on the results and analytics bursts run there; the restricted solver never does.",
      "Charged inside the money cap like any service.",
    ],
    analogy: "A side door straight into the warehouse.",
    inPlan: "{d.cloudNote}.",
    source: "G6 · G8",
    terms: ["term.onramp"],
  },
  "gauge-outside": {
    title: "Money outside the cap",
    term: "Outside the cap",
    one: "The part of the yearly cost the FIA does not count against the money cap: property costs such as space, fit-out and building plant.",
    more: [
      "The share of the campus fee treated as property costs sits here; power, support and links sit inside.",
      "More outside the cap means more cap left for car parts.",
    ],
    analogy: "The rent someone else pays, next to your own pocket money.",
    inPlan: "{fmt.chf(s.money.excludedYearly)} of {fmt.chf(s.money.yearly)} a year outside the cap ({fmt.pct(d.outsideShare)}).",
    source: "C3 · G-c",
    terms: ["term.capcharge", "term.costcap"],
  },
  "hinwil-gauge": {
    title: "What stays in the Hinwil room",
    term: "kW kept at Hinwil",
    one: "In a hybrid plan, the server power that stays in the factory room against what the room can supply.",
    more: ["Mission Control, the simulator and office IT stay; the solver estate moves. Over the room's capacity is \"Not possible\"."],
    analogy: "What is left in the old garage after the move.",
    inPlan: "{fmt.num(s.fac.hinwilIT, 0)} kW of {s.fac.hinwilCapacity} kept in Hinwil.",
    source: "A-a · A-e",
    terms: [],
  },
  // Solutions Architect head tiles
  "stat-campus-load": {
    title: "Server power at the campus",
    term: "IT load at the campus",
    one: "The kilowatts of servers the season puts on the Digital Realty campus, against the 500 kW offer.",
    more: [
      "The metered cluster plus the rest of the estate that moves with it and any machine-learning partition placed there.",
      "At the wall the figure is higher by the site's power overhead.",
    ],
    analogy: "The load on a fuse board, with the fuse rating next to it.",
    inPlan: "{fmt.num(d.envelope.drIT, 0)} kW of {d.envelope.offerKW} at the campus{d.campusLoadNote}.",
    source: "G-h · G-b · D-d",
    terms: ["term.envelope", "term.pue"],
    sa: true,
  },
  "stat-ready": {
    title: "When the suite must be ready",
    term: "Suite ready by",
    one: "The first day fit-out, fibre, hardware and burn-in are all done; the switch can happen then or at the next period boundary.",
    more: [
      "Counted forward from the contract date through the longest lead time.",
      "Slack is the gap between ready and the chosen cutover; a slip means ready came later than the target.",
    ],
    analogy: "The day the removal van can actually come.",
    inPlan: "{d.plan.readyLabel}; {d.plan.goLiveLabel}.",
    source: "G-e · D-e · H-f",
    terms: ["term.atp"],
    sa: true,
  },
  "stat-risks": {
    title: "Open risks",
    term: "Open risks",
    one: "How many entries of the live risk register are still open, and how many the current plan has actually triggered.",
    more: [
      "Likelihood and status follow the plan: a tighter schedule or a single fibre route moves the register.",
      "Mitigated entries are the ones the plan already answers.",
    ],
    analogy: "The snag list on a building site.",
    inPlan: "{d.sa.openRisks} open, {d.sa.triggeredRisks} triggered by this plan.",
    source: "G-f · model",
    terms: [],
    sa: true,
  },
}

const FLAG_ENTRIES = {
  mauh: {
    title: "Computing allowance",
    one: "Whether the plan uses the FIA's computing allowance well: under 90 % wastes it, over 100 % idles servers.",
    more: ["The allowance is eight-week buckets that do not roll over. Over-use is a sporting breach; the model instead throttles the cluster to fit."],
    analogy: "A pre-paid card that resets every eight weeks.",
    inPlan: "{fmt.pct(s.comp.usage)} of {s.fia.allowance.mauh} million unit-hours per period.",
    source: "C5 · C9 · F4.6.1",
    terms: ["term.auh", "term.atp"],
  },
  gpu: {
    title: "Graphics processors on the solver",
    one: "Whether graphics processors are allowed on the solver this season and how they are charged.",
    more: ["Allowed from 2028; charging rule not yet published; the model's conversion is a worst-case assumption."],
    analogy: "Playing a new position before the referee has published the rules.",
    inPlan: "{x.solverGpus} on the solver in {x.season}, charged at {x.gpuChargePct} %.",
    source: "C6 · C10 · J-c",
    terms: ["term.gpu", "term.fp64"],
  },
  clock: {
    title: "Declared clock",
    one: "The clock speed declared to the FIA and what it buys.",
    more: ["May not be declared below the base clock; with turbo on the top turbo speed is charged."],
    analogy: "Promising the taxman a number and being held to it.",
    inPlan: "Declared at {fmt.num(x.clockGHz, 1)} GHz: {fmt.num(s.comp.clockWorkPerAuh, 2)}× the useful work per unit of a 3.7 GHz machine.",
    source: "F4.4.2 · F4.4.4 · C9",
    terms: ["term.declaredClock"],
  },
  power: {
    title: "Power for the servers",
    one: "Whether the room or campus can power all the servers.",
    more: ["Short by N kW means N kW of servers never run while still being paid for."],
    analogy: "More heaters than sockets.",
    inPlan: "{fmt.num(d.sitePowerKW, 0)} kW against {d.siteCapKW} kW at {d.siteName}: {d.powerFit}.",
    source: "A-a · D-d",
    terms: [],
  },
  racks: {
    title: "Rack positions in the cage",
    one: "Whether the rows fit the 60 rack positions of the Digital Realty cage.",
    more: [
      "The rest of the estate is counted at 8 kW per rack position; the cluster and any ML partition at the rack density you chose.",
      "Denser racks need fewer positions, which is one reason to choose rear-door or direct-liquid cooling.",
    ],
    analogy: "Shelf space, not just the electricity bill.",
    inPlan: "{d.envelope.racks} of {d.envelope.cageRackPositions} rack positions used at {d.siteName}.",
    source: "G-g · G-h",
    terms: ["term.rackdensity"],
  },
  expansion: {
    title: "No expansion right in the offer",
    one: "The 500 kW offer has no expansion right; a plan saved with one is read without it.",
    more: [
      "More kW is a separate commercial conversation: ZUR4 adds 15 MW on the campus in 2028.",
      "The figures in this tool are unchanged by the old setting; only this note remains.",
    ],
    analogy: "A lease with no option on the flat next door.",
    inPlan: "{d.expansionNote}",
    source: "G11 · G-g",
    terms: ["term.envelope"],
  },
  hybridpower: {
    title: "Power at Hinwil in a hybrid plan",
    one: "In a hybrid plan, whether the Hinwil part still fits the room.",
    more: ["Hinwil's limit still applies to what stays there."],
    analogy: "The old kitchen still has only two rings.",
    inPlan: "Hinwil keeps {fmt.num(s.fac.hinwilIT, 0)} kW against {s.fac.hinwilCapacity} kW.",
    source: "A-a",
    terms: [],
  },
  cooling: {
    title: "Cooling the cabinets",
    one: "Whether the cabinets can be cooled at their density.",
    more: ["Above the limit chips slow themselves down; the FIA still charges the declared clock. Graphics processors on air cooling lose about 30 %."],
    analogy: "A car with a small radiator on a hot day.",
    inPlan: "{x.rackKW} kW per cabinet against a {s.fac.coolingMax} kW limit: thermal factor {fmt.num(s.comp.eff.thermal, 2)}×.",
    source: "G5 · G-b · model",
    terms: ["term.dlc", "term.reardoor"],
  },
  declare: {
    title: "FIA paperwork for a move",
    one: "What a move means for the FIA paperwork and the calendar.",
    more: ["Re-declare within a month; mid-period moves lose about seven solver days."],
    analogy: "Changing address with the school mid-term.",
    inPlan: "{d.option.migrationTiming}: migration factor {fmt.num(s.comp.eff.migration, 3)}×.",
    source: "F4.4.3",
    terms: ["term.atp"],
  },
  loop: {
    title: "Plumbing for water cooling at Hinwil",
    one: "The plumbing Hinwil would need for water cooling.",
    more: ["A one-off building cost, outside the cap, with a lead time."],
    analogy: "Installing central heating in an old house.",
    inPlan: "{d.option.cooling} in the Hinwil room: a one-off building cost outside the cap.",
    source: "A-e · model",
    terms: ["term.dlc", "term.reardoor"],
  },
  delivery: {
    title: "Hardware arriving late",
    one: "Hardware arriving after 1 January loses allowance for good.",
    more: ["Each late week is about 2 % of the year's allowance."],
    analogy: "Missing the first weeks of term.",
    inPlan: "{d.leadLabel}: {fmt.pct(1 - s.comp.eff.delivery, 1)} of the year's allowance unusable.",
    source: "F4.1.4 · C7",
    terms: ["term.atp"],
  },
  arch: {
    title: "Processor launches in 2027",
    one: "The processor chosen for this season launches in 2027 (Venice-X / Xeon 7): order early, or pick a part that ships now.",
    more: ["Lead time belongs in the Delivery slider."],
    analogy: "Pre-ordering a phone that has not launched.",
    inPlan: "{d.archLabel} for {x.season}: {d.leadLabel}.",
    source: "K7 · K9",
    terms: ["term.vcache"],
  },
  armport: {
    title: "Arm processors need the code re-tested",
    one: "Arm processors need the team's own airflow code re-tested before the first metered run.",
    more: ["A porting and validation campaign; the model takes two weeks off the delivery slider unless cleared."],
    analogy: "Moving your recipes to a new kind of oven.",
    inPlan: "{d.archLabel}: {d.leadLabel}.",
    source: "K-d",
    terms: ["term.cfd"],
  },
  // Timeline flags raised by the deployment schedule (timeline.js on the customer branch); read explainContext({ plan }).
  slip: {
    title: "The cutover date slips",
    one: "The target cutover date cannot be met from this contract date; the go-live slips to the earliest feasible day.",
    more: ["The longest lead time (fibre, fit-out, hardware) is the critical path. Sign earlier to hold the date."],
    analogy: "The builder cannot finish before you planned to move in.",
    inPlan: "{d.plan.goLiveLabel}, slipped {d.plan.slipDays27} days; {d.plan.criticalLabel} is the critical path.",
    source: "G-e · D-e · H-f",
    terms: [],
    plan: true,
  },
  late27: {
    title: "Live after the season starts",
    one: "The 2027 estate is live after the pre-season test or the first race, so part of 2027 runs on today's setup.",
    more: ["If go-live falls in 2028, every 2027 period runs on today's room."],
    analogy: "Joining the team mid-season.",
    inPlan: "{d.plan.goLiveLabel}: {fmt.pct(d.plan.shareOld27)} of 2027 on today's setup.",
    source: "F4.1.4 · C7",
    terms: ["term.atp"],
    plan: true,
  },
  midatp: {
    title: "A move inside a period",
    one: "The cutover falls inside an eight-week period, so some of that period's allowance is lost.",
    more: ["Parallel running keeps it to a one-day switch; a move at the boundary loses nothing."],
    analogy: "Changing trains between stations instead of at one.",
    inPlan: "{fmt.pct(d.plan.periodLoss27, 1)} of the period's allowance lost; {d.plan.downtimeDays27} solver days.",
    source: "F4.6.1 · C9",
    terms: ["term.atp"],
    plan: true,
  },
  shutdown: {
    title: "A move in the shutdown",
    one: "The cutover falls in the summer or winter shutdown, when no metered runs happen, so nothing is lost.",
    more: ["Compute may not run in the shutdown except for upgrades and maintenance, which is exactly what a move is."],
    analogy: "Rewiring the office over the holidays.",
    inPlan: "{d.plan.goLiveLabel}: in a shutdown, no allowance lost.",
    source: "F3.1.1 · F3.1.2.b",
    terms: ["term.atp"],
    plan: true,
  },
  boundary: {
    title: "A move at the boundary",
    one: "The cutover sits on a period boundary: the old allowance is used up first and the new declaration follows within a month.",
    more: ["The cleanest timing the rules allow."],
    analogy: "Changing phone contracts on the renewal date.",
    inPlan: "{d.plan.goLiveLabel}: at a period boundary, no allowance lost.",
    source: "F4.4.3 · F4.6.1",
    terms: ["term.atp"],
    plan: true,
  },
  early28: {
    title: "2028 hardware arrives early",
    one: "The 2028 hardware lands before graphics processors are allowed in the solver, so it waits at a carrying cost.",
    more: ["Up to four early weeks count as burn-in; beyond that the kit is idle money."],
    analogy: "Paying rent on a flat you cannot move into yet.",
    inPlan: "{d.plan.stepUpLabel}{d.plan.stepUpNote}.",
    source: "F4.4.1 · H-f",
    terms: ["term.gpu"],
    plan: true,
  },
  late28: {
    title: "2028 hardware arrives late",
    one: "The 2028 hardware lands after 1 January 2028, so part of the season runs on the 2027 estate.",
    more: ["Order earlier or keep the 2028 change smaller."],
    analogy: "The new car arriving after the first race.",
    inPlan: "{d.plan.stepUpLabel}{d.plan.stepUpNote}.",
    source: "F4.1.4 · H-f",
    terms: ["term.atp"],
    plan: true,
  },
  midatp28: {
    title: "The 2028 change inside a period",
    one: "The 2028 step-up lands inside an eight-week period, so some of that period's allowance is lost at the switch.",
    more: ["Move the step-up date to a boundary or keep parallel running."],
    analogy: "Changing trains between stations.",
    inPlan: "{d.plan.stepUpLabel}: {fmt.pct(d.plan.periodLoss28, 1)} of the period's allowance lost.",
    source: "F4.6.1 · C9",
    terms: ["term.atp"],
    plan: true,
  },
  order28: {
    title: "Order date for the 2028 hardware",
    one: "The latest day to order the 2028 hardware so that it lands on time.",
    more: ["Lead time of the chosen buying route plus burn-in, counted back from the step-up date."],
    analogy: "The last posting date before Christmas.",
    inPlan: "Order by {d.plan.orderByLabel}; {d.plan.stepUpLabel}.",
    source: "H-f",
    terms: [],
    plan: true,
  },
  slip28: {
    title: "The 2028 step-up slips",
    one: "The planned 2028 step-up date cannot be met; it slips to the earliest feasible day.",
    more: ["The order date is already past or the lead time is longer than the gap."],
    analogy: "The removal van is booked for a day the keys are not ready.",
    inPlan: "{d.plan.stepUpLabel}, slipped {d.plan.slipDays28} days.",
    source: "H-f · G-e",
    terms: [],
    plan: true,
  },
}

const DRIVER_ENTRIES = {
  power: {
    title: "Enough power for every server (the move)",
    term: "facility power factor",
    one: "Today's room cannot power the whole cluster; the campus can, so every server runs.",
    more: [
      "Today's Hinwil room has about 300 kW for servers. The modelled estate needs more: in 2027 about 94 kW more, in 2028 about 480 kW more, so a share of the cluster never switches on while the allowance ticks away.",
      "At the campus every server has power, two independent feeds and spare cooling. This bar also carries the campus fee, cross-connects and the fit-out, and anything that only works at the campus (heat reuse).",
      "Caveat: the room's 300 kW is an assumption to confirm with the team; the bar moves with it.",
    ],
    analogy: "Twelve heaters, sockets for nine.",
    inPlan: "Today's {d.todaySiteName} is {fmt.num(t.fac.powerShortKW, 0)} kW short, so only {fmt.pct(t.comp.eff.power)} of the cluster runs. At {d.siteName} {fmt.pct(s.comp.eff.power)} runs: {fmt.sec(a.power.sec)} per lap ({fmt.pct(a.power.share)} of the gain), {fmt.chfDelta(a.power.savedCHF)} a year inside the cap.",
    zero: "The plan stays in the same room as Today, so there is no power effect.",
    source: "A-a · D-d · G-c · G-d",
    terms: ["term.redundancy", "term.capcharge"],
  },
  cpuArch: {
    title: "Processor architecture",
    term: "architecture factor on work per AUh",
    one: "Processors with a very large on-chip store finish the airflow maths sooner at the same declared clock, and the FIA does not charge for that.",
    more: [
      "The FIA charges cores × seconds × declared clock. It does not measure how much work a core does per tick.",
      "Airflow maths spends most of each tick waiting for numbers from memory. A processor with 1.1 GB of on-chip store (3D V-Cache) or with far faster memory waits much less, so the same charged hour does 20–30 % more work.",
      "Costs: a little more power and money per server; the 2028 parts launch in 2027; Arm parts need the team's code re-tested.",
    ],
    analogy: "A cook with every ingredient on the counter, not in the cellar.",
    inPlan: "{d.archLabel}: {fmt.num(d.archFactor, 2)}× the useful work per charged unit at the same declared clock. Worth {fmt.sec(a.cpuArch.sec)} per lap ({fmt.pct(a.cpuArch.share)}) for {fmt.chfDelta(a.cpuArch.savedCHF)} a year inside the cap.",
    zero: "Same processor family as Today.",
    source: "K2 · K3 · K4 · K-b · C9",
    terms: ["term.vcache", "term.bandwidth", "term.auh"],
  },
  processor: {
    title: "Newer processor generation",
    term: "ipc by refresh cadence",
    one: "Newer processors do more work per tick, and the FIA only counts ticks.",
    more: [
      "A fleet refreshed every three years is always on the newest generation; every five years is two generations behind by the end.",
      "The model gives +8 % per step up, −8 % per step down, for the same charged hours. Faster refresh costs more depreciation inside the cap, which this bar also carries.",
    ],
    analogy: "A new phone with the same signal bars does everything faster.",
    inPlan: "A {x.refreshYears}-year refresh instead of Today's {t.inputs.refreshYears}: silicon factor {fmt.num(s.comp.eff.ipc, 2)} vs {fmt.num(t.comp.eff.ipc, 2)} per charged unit. {fmt.sec(a.processor.sec)} per lap ({fmt.pct(a.processor.share)}), {fmt.chfDelta(a.processor.savedCHF)} a year inside the cap.",
    zero: "Same refresh cadence as Today.",
    source: "H-d · J3",
    terms: ["term.ipc", "term.capcharge"],
  },
  clock: {
    title: "More cores at a lower declared clock",
    term: "nodes × cores × CCF vs clock^0.6",
    one: "Declaring a slower clock buys more core-hours for the same allowance; a smaller cluster still gets through less work, so this bar can go either way.",
    more: [
      "The allowance is charged per core per clock tick. Declaring 2.4 GHz instead of 3.7 buys 54 % more core-hours for the same charge.",
      "Each slower core does less, but not proportionally less (clock^0.6), because airflow maths waits on memory.",
      "The catch: extra cores need power and money, a cluster bigger than the allowance can keep busy idles, and a cluster that shrinks (to make room for graphics processors, or to fit the 500 kW) gets through less work however well each core is charged. In those cases this bar is negative. The clock may not be declared below the chip's base speed.",
    ],
    analogy: "Driving at 100 km/h instead of 130 to go further on the same tank; fewer vans still deliver fewer parcels.",
    inPlan: "{x.nodes} servers × {x.coresPerNode} cores at {fmt.num(x.clockGHz, 1)} GHz vs Today's {t.inputs.nodes} × {t.inputs.coresPerNode} at {fmt.num(t.inputs.clockGHz, 1)} GHz: each charged unit buys {fmt.num(s.comp.clockWorkPerAuh, 2)}× the work, {d.clockNote}; {fmt.pct(s.comp.usage)} of the allowance used. {fmt.sec(a.clock.sec)} per lap ({fmt.pct(a.clock.share)}).",
    zero: "Same cluster size and declared clock as Today.",
    source: "F4.4.2 · F4.4.4 · J-d · C9",
    terms: ["term.declaredClock", "term.auh"],
  },
  gpu: {
    title: "Graphics processors on the solver",
    term: "solver GPUs, FP64-normalised charge",
    one: "From 2028 graphics processors may run the airflow maths. They do more precise maths per watt than ordinary cores, but how the FIA charges them is open.",
    more: [
      "The model charges a graphics processor as the number of ordinary cores with the same precise-maths speed, multiplied by your charge-factor guess. On that basis a B200-class part is worth about 313 cores and does about 1.3× their useful work.",
      "Graphics processors also speed up preparation and review in every season.",
      "They draw 1–1.7 kW each, need liquid or rear-door cooling, and in a plan that stays at Hinwil they deepen the power shortage.",
    ],
    analogy: "New players allowed on the pitch next season, rules for their fouls still being written.",
    inPlan: "{x.solverGpus} {d.gpuLabel} on the solver, charged at {x.gpuChargePct} % ({fmt.num(s.hw.gpu.coreEquivalents, 0)} core-equivalents each): {fmt.sec(a.gpu.sec)} per lap ({fmt.pct(a.gpu.share)}), {fmt.num(a.gpu.effMauhDelta, 2)} million effective unit-hours.",
    zero: "No graphics processors in this plan (or none on the solver).",
    source: "F4.4.1 · C6 · C10 · J2 · J-c",
    terms: ["term.gpu", "term.fp64"],
  },
  data: {
    title: "No waiting on data",
    term: "io × interconnect × memory factors",
    one: "Cores that wait for files or for each other still burn metered time. Faster storage, network and enough memory stop the waiting.",
    more: [
      "Each run loads and saves hundreds of gigabytes, and every step the servers swap border values.",
      "Ordinary network storage and Ethernet leave cores idle for a tenth of their charged time; a parallel file system with InfiniBand or Slingshot brings that close to zero. Enough memory per server keeps big runs from fragmenting.",
      "The team's 2023 cluster already uses Cray ClusterStor parallel storage.",
    ],
    analogy: "A relay team with clean baton passes.",
    inPlan: "Storage factor {fmt.num(t.comp.eff.io, 2)} → {fmt.num(s.comp.eff.io, 2)}, network factor {fmt.num(t.comp.eff.interconnect, 3)} → {fmt.num(s.comp.eff.interconnect, 3)}: {fmt.sec(a.data.sec)} per lap ({fmt.pct(a.data.share)}), {fmt.chfDelta(a.data.savedCHF)} a year inside the cap.",
    zero: "Same storage, network and memory as Today.",
    source: "H-a · H2 · A15",
    terms: ["term.pfs", "term.interconnect"],
  },
  cooling: {
    title: "No overheating",
    term: "thermal factor and PUE by cooling",
    one: "Hot chips slow themselves down while the declared clock is still charged; good cooling stops that and cuts the power bill.",
    more: [
      "Air cooling tops out near 20 kW a cabinet; rear-door heat exchangers near 70; direct-to-chip liquid near 150. Above the limit chips throttle.",
      "Liquid cooling also drops the site overhead (PUE 1.15 instead of 1.6), which is money inside the cap.",
      "At Hinwil, water cooling needs a one-off plumbing job.",
    ],
    analogy: "A car with a big radiator on a hot day.",
    inPlan: "{d.coolingLabel} at {x.rackKW} kW per cabinet (limit {s.fac.coolingMax} kW), PUE {fmt.num(s.fac.pue, 2)} vs {fmt.num(t.fac.pue, 2)}: {fmt.sec(a.cooling.sec)} per lap ({fmt.pct(a.cooling.share)}), of which {fmt.sec(a.cooling.reinvestSec)} from a lower electricity bill ({fmt.chfDelta(a.cooling.savedCHF)} a year).",
    zero: "Same cooling and cabinet density as Today.",
    source: "G5 · G-b · D5 · H2",
    terms: ["term.dlc", "term.reardoor", "term.pue"],
  },
  resilience: {
    title: "Two of everything, fast repairs",
    term: "availability × node failures by support tier",
    one: "Spare power, spare cooling and fast repairs mean fewer lost hours, and lost hours are lost allowance.",
    more: [
      "N+1 keeps one spare of everything; 2N doubles it. A 4-hour support contract gets a failed server back the same shift.",
      "Today's room loses about 53 hours a year; the 2N campus with 4-hour support about 10, with 24×7 about 2.",
      "Each tier costs more inside the cap, which this bar also carries.",
    ],
    analogy: "A spare tyre vs a second car.",
    inPlan: "Availability {fmt.availability(t.comp.availabilityPct / 100)} → {fmt.availability(s.comp.availabilityPct / 100)} ({fmt.num(t.comp.lostHoursPerYear, 0)} → {fmt.num(s.comp.lostHoursPerYear, 0)} hours a year lost): {fmt.sec(a.resilience.sec)} per lap, {fmt.chfDelta(a.resilience.savedCHF)} a year inside the cap.",
    zero: "Same redundancy and support as Today.",
    source: "G-d · H-c · A-c",
    terms: ["term.redundancy"],
  },
  timing: {
    title: "Delivered early, moved between periods",
    term: "delivery × migration factors",
    one: "Hardware that is live on 1 January and moves between allowance periods wastes none of the allowance.",
    more: [
      "Each week late is about 2 % of the year's allowance gone for good.",
      "A mid-period move loses about seven solver days to re-declaration and re-commissioning. The plan controls both.",
    ],
    analogy: "Arriving before the exam starts, and moving house in the holidays.",
    inPlan: "Delivery {d.leadLabel}, move {d.migrationLabel}: delivery factor {fmt.num(s.comp.eff.delivery, 2)}, migration factor {fmt.num(s.comp.eff.migration, 3)}: {fmt.sec(a.timing.sec)} per lap.",
    zero: "Live on 1 January and moved at a period boundary: nothing lost.",
    source: "F4.1.4 · F4.4.3 · C7 · H-e",
    terms: ["term.atp"],
  },
  energy: {
    title: "Cheaper, greener electricity",
    term: "electricity line: PUE × tariff, CO₂, heat reuse",
    one: "Less electricity for the same computing is money back inside the cap, and less carbon.",
    more: [
      "The site overhead (PUE), the tariff and the renewable contract set the bill and the CO₂. Heat reuse at the campus avoids CO₂ elsewhere.",
      "This bar carries only the electricity and carbon lines; the cooling choice that drives the PUE sits in \"No overheating\", and heat reuse only works at the campus.",
    ],
    analogy: "Switching to a cheaper, greener energy tariff.",
    inPlan: "PUE {fmt.num(s.fac.pue, 2)}, {x.tariffRp} Rp/kWh: electricity {fmt.chf(d.lines.power.chf)} a year ({fmt.chfDelta(a.energy.savedCHF)} inside the cap), CO₂ {fmt.signed(p.co2Delta, 0)} t vs Today: {fmt.sec(a.energy.sec)} per lap.",
    zero: "Same tariff, PUE setting and contracts as Today.",
    source: "D-a · D-b · D4 · G4",
    terms: ["term.pue", "term.capcharge"],
  },
  commercial: {
    title: "Pay-as-you-go and the money cap",
    term: "GreenLake vs depreciation, Property share, one-offs",
    one: "How you pay changes what counts inside the money cap, and money inside the cap is car development.",
    more: [
      "GreenLake spreads the hardware cost as a monthly charge and lets the team add capacity without a new purchase.",
      "The campus fee's property share is outside the cap; the rest is inside. Fit-out is outside, migration is inside.",
      "This bar carries only those money choices; it never changes computing.",
    ],
    analogy: "Leasing instead of buying, and knowing which bills the taxman lets you deduct.",
    inPlan: "{d.consumptionLabel}, {x.propertySharePct} % of the campus fee treated as property: {fmt.chfDelta(a.commercial.savedCHF)} a year inside the cap, {fmt.sec(a.commercial.sec)} per lap.",
    zero: "Same way of paying as Today.",
    source: "H1 · H-b · C3 · C3-open",
    terms: ["term.greenlake", "term.capcharge", "term.costcap"],
  },
  connectivity: {
    title: "Faster decisions at the track",
    term: "fibre availability, trackside quality → data-to-decision seconds",
    one: "Better links to the track and the campus mean quicker, safer race-day calls; they cost money inside the cost cap, which the car's development then cannot spend.",
    more: [
      "A carrier or satellite-backed link cuts the round trip and keeps sessions online; edge compute in the garage pre-digests telemetry; two fibre routes keep the wind tunnel connected to its cluster.",
      "The lap-time chart only counts what the links cost inside the cost cap (every franc spent there is a franc less for car development), so this bar is usually negative. What the links buy shows up elsewhere: data-to-decision seconds and race weekends kept online.",
    ],
    analogy: "A private phone line to the pit wall: it comes out of the same budget as the car.",
    inPlan: "{d.tracksideLabel}{d.edgeSuffix}, {d.fibreLabel}: decision in {fmt.num(s.net.venue.decisionSec, 1)} s vs {fmt.num(t.net.venue.decisionSec, 1)} s, link {fmt.availability(s.net.linkAvailability)}. {d.connectivityNote}",
    zero: "Same links as Today.",
    source: "I-a · I-b · I-d · I-e · B-e · G6",
    terms: ["term.rtt", "term.edge", "term.darkfibre", "term.onramp"],
  },
}

const STRATEGY_INPLAN = "{a.n} parts explain {fmt.sec(a.total.sec)} in {x.season}: the move {fmt.sec(a.power.sec)} ({fmt.pct(a.power.share)}), data {fmt.sec(a.data.sec)}, processors {fmt.sec(a.processor.sec)}, clock {fmt.sec(a.clock.sec)}, graphics processors {fmt.sec(a.gpu.sec)}, cooling {fmt.sec(a.cooling.sec)}; trackside {fmt.sec(a.connectivity.sec)} for a decision in {fmt.num(s.net.venue.decisionSec, 1)} s."

const STRATEGY_ENTRIES = {
  A: {
    title: "A · Consolidate and de-risk",
    term: "consolidate",
    one: "Move what we have to a place that can run all of it.",
    more: [
      "Nearly all of the gain is the move: today's room cannot power the whole cluster in either season, so part of it never runs. At the campus everything runs, and that is most of the 2028 gain.",
      "Parallel storage and InfiniBand stop cores waiting for data, and a four-year instead of five-year fleet does more work per charged hour.",
      "It leaves the cluster size and the declared clock alone, so there is no clock gain and no 2028 solver step for graphics processors; the four unrestricted graphics processors cost a little through power and cap money.",
      "It adds the least to the cost inside the cap of the three strategies; the trackside package costs a little lap time and brings the pit-wall decision to about five seconds.",
    ],
    analogy: "Moving the whole workshop into a bigger building before buying new tools.",
    inPlan: STRATEGY_INPLAN,
    source: "1.5 · 2.4 · model",
    terms: ["term.shapley", "term.pfs", "term.redundancy"],
  },
  B: {
    title: "B · Density and the 2028 GPU step-up",
    term: "density",
    one: "Spend the allowance as cleverly as the rules allow, then add graphics processors the day they are legal.",
    more: [
      "In 2027, eighteen wide servers declared at the 2.4 GHz base clock buy far more core-hours per charged unit than today's 3.7 GHz machines; a three-year fleet adds a newer-generation bonus on top.",
      "In 2028 four solver graphics processors are the single biggest technology bar of any plan. Cutting the CPU cluster to three servers to make power and allowance room costs lap time, so the swap nets less than the GPU bar alone and frees power for a machine-learning partition.",
      "Direct liquid cooling earns lap time in 2028 mostly through a PUE of 1.15 on the electricity bill; Slingshot and flash storage keep the cores fed; the move itself is still the largest bar.",
      "It spends the most inside the cap, and the whole 2028 case rests on the FIA's unpublished charge for graphics processors: at a 100 % charge the GPU bar shrinks. The bullets on the card carry the live plan-level figures.",
    ],
    analogy: "Buying the oven for next year's menu and learning to cook on it now.",
    inPlan: STRATEGY_INPLAN,
    source: "1.5 · 2.4 · model",
    terms: ["term.shapley", "term.declaredClock", "term.gpu", "term.dlc"],
  },
  C: {
    title: "C · Cost-cap-optimised hybrid cloud",
    term: "efficient",
    one: "Take B's clock trick, hedge the graphics-processor bet, keep the cap bill down.",
    more: [
      "The same 2027 clock-and-width effect as B on cheaper rear-door rows and InfiniBand, with a four-year fleet.",
      "In 2028 a two-GPU step with eleven CPU servers kept, so the clock bar stays nearly neutral and the plan does not depend on the GPU charge rule.",
      "The move is the largest bar in both seasons; storage and network and rear-door cooling add the rest.",
      "Cap spend sits between A and B; its trackside and cloud on-ramp package costs the most lap time of the three for the same five-second pit-wall decision. The bullets on the card carry the live plan-level figures.",
    ],
    analogy: "Renting the extra kitchen only on the days you need it.",
    inPlan: STRATEGY_INPLAN,
    source: "1.5 · 2.4 · model",
    terms: ["term.shapley", "term.onramp", "term.greenlake"],
  },
}

const MILESTONE_ENTRIES = {
  contract: { title: "Contract signature", one: "The day the colocation contract is signed; every lead time in the plan counts from here.", more: ["Fit-out, dark fibre and the hardware order all start at signature, so a later signature moves the cutover.", "The tool plans from today's date unless you set a later contract date."], analogy: "The day you pick up the keys.", inPlan: "{d.plan.goLiveLabel}{d.plan.slipNote}.", source: "G11 · D-e · model", terms: ["term.crossconnect", "term.darkfibre"] },
  cutover: { title: "Cutover", one: "The day the airflow-computing cluster runs from the new estate; the plan targets an eight-week period boundary.", more: ["Moving at a period boundary avoids losing allowance mid-period; a mid-period move loses a share of that period.", "The go-live follows the longest lead time: fit-out, fibre or hardware."], analogy: "Moving house on the first of the month.", inPlan: "{d.plan.goLiveLabel}, {d.plan.criticalLabel} on the critical path{d.plan.slipNote}.", source: "F4.1.4 · C13 · model", terms: ["term.atp"] },
  declaration: { title: "New declaration", one: "The FIA must be told about the new cluster, its location, cores and declared clock before it runs restricted airflow computing.", more: ["The regulations ask for the declaration ahead of use; the tool places it at the cutover boundary."], analogy: "Registering a new car before driving it.", inPlan: "Declared for the {d.plan.atpLabel27} boundary; {d.plan.goLiveLabel}.", source: "F4.4.3 · C7", terms: ["term.declaredClock"] },
  "stepup-order": { title: "Order the 2028 step-up", one: "The last day to order the 2028 hardware so it is delivered and burned in before 1 January 2028.", more: ["Lead time counts back from the step-up date; a late order pushes the GPU partition into the 2028 season."], analogy: "Ordering the turkey in time for Christmas.", inPlan: "Order by {d.plan.orderByLabel}; {d.plan.stepUpLabel}{d.plan.stepUpNote}.", source: "C13 · model", terms: ["term.gpu"] },
  stepup: { title: "2028 step-up", one: "The day the 2028 estate goes live, usually 1 January 2028 when graphics processors may join the solver.", more: ["A step-up that lands after 1 January leaves part of 2028 on the 2027 estate; one that lands early costs money before it is legal to use."], analogy: "The new term starting.", inPlan: "{d.plan.stepUpLabel}{d.plan.stepUpNote}.", source: "F4.4.4 · C10 · model", terms: ["term.gpu", "term.atp"] },
  declaration28: { title: "Re-declaration for 2028", one: "The FIA must be told about the 2028 cluster, graphics processors included, before it runs restricted airflow computing.", more: ["Same rule as the 2027 declaration; placed at the 1 January boundary."], analogy: "Re-registering the car after a rebuild.", inPlan: "{d.plan.stepUpLabel}.", source: "F4.4.3 · C7", terms: ["term.declaredClock"] },
  refresh: { title: "Next refresh", one: "When the fleet is next replaced under the refresh cadence; outside the 2027–2028 window in most plans.", more: ["A shorter cadence gives newer, more efficient processors sooner but costs more each year."], analogy: "Changing the family car every few years.", inPlan: "Refresh every {x.refreshYears} years.", source: "L4 · model", terms: ["term.ipc"] },
}

// The Gantt's task rows (timeline.js leadTasks / buildTimeline); the id is the task id without its season prefix.
const TASK_ENTRIES = {
  fitout: { title: "Campus fit-out", one: "Digital Realty builds the suite or cage: racks, power whips, rear-door or liquid rows. Twelve weeks, sixteen with a liquid loop.", more: ["The 2028 step-up fit-out adds liquid rows, cooling units and whips inside the same 500 kW envelope.", "Usually the longest lead time, so it sets the earliest switch day."], analogy: "Fitting out the shop before the stock arrives.", inPlan: "{d.task.fitout.line}.", source: "G-e · G11", terms: ["term.reardoor", "term.dlc"] },
  fibre: { title: "Dark fibre build", one: "The carrier lights the route between Hinwil and the campus; a second route adds weeks but removes the single point of failure.", more: ["Fourteen weeks for a first route on existing ducts; civil works would take 26 weeks or more.", "The switch needs the fibre; burn-in does not."], analogy: "Laying the road before the removal van can use it.", inPlan: "{d.task.fibre.line}.", source: "D-e · D10", terms: ["term.darkfibre"] },
  hardware: { title: "HPE delivery", one: "The cluster arrives: four to eight weeks pre-staged under HPE GreenLake, ten to eighteen weeks built to order.", more: ["GreenLake ships staged capacity with buffer servers; a purchase waits on the factory.", "The order date for 2028 counts back from 1 January so the graphics processors are burned in by then."], analogy: "Next-day delivery versus made to measure.", inPlan: "{d.task.hardware.line}.", source: "H-f · H1", terms: ["term.greenlake"] },
  works: { title: "Hinwil works", one: "Changes to the factory room when the estate stays there: a rear-door cooling branch, chilled water or a liquid loop.", more: ["Only in plans that keep the cluster in Hinwil with denser cooling or a retrofit of the room."], analogy: "Rewiring the garage at home.", inPlan: "{d.task.works.line}.", source: "A-e · G-e", terms: ["term.reardoor"] },
  xc: { title: "Cross-connects", one: "The cables from the cage to the carriers' meet-me room, ordered once the suite exists; three business days each under the portal service levels.", more: ["Follows the fit-out; the fibre routes land on them, and so do the cloud on-ramps."], analogy: "Plugging the house into the street.", inPlan: "{d.task.xc.line}.", source: "G11 · G8", terms: ["term.crossconnect"] },
  burnin: { title: "Acceptance and burn-in", one: "Four weeks of benchmarks and soak testing before the cluster is trusted with metered runs and declared to the FIA.", more: ["Needs the room and the hardware, not the fibre.", "The benchmarks also give the declared clock and core count for the FIA filing."], analogy: "Running the new boiler for a month before winter.", inPlan: "{d.task.burnin.line}.", source: "H-f · F4.4.3", terms: ["term.declaredClock"] },
  parallel: { title: "Parallel running", one: "Both clusters run side by side so the queue drains on the old one and restarts on the new one in a day instead of a week.", more: ["About CHF 20k a week: the old room's electricity, the overlap of the fee and staff.", "It turns a mid-period switch from seven lost solver days into one."], analogy: "Keeping the old flat for a fortnight while you move.", inPlan: "{d.task.parallel.line}.", source: "C9 · G-c", terms: ["term.atp"] },
}

// Solutions Architect view: requirement rows, service cards, risk entries, checklist items and owner roles (sa.js).
// Written for a Digital Realty solutions architect new to Formula 1; the "In this plan" line repeats the row's live value.
const REQ_ENTRIES = {
  site: { title: "Where the estate sits", one: "Which building hosts the team's airflow-computing estate: the Hinwil factory room, the Zurich campus, or a split between the two.", more: ["Hybrid keeps Mission Control (the race-weekend operations room) and office IT in Hinwil and moves only the solver estate.", "The campus is ZUR1–ZUR3 in Glattbrugg/Opfikon; ZUR4 opens in 2028."], analogy: "Choosing between the garage at home and a rented workshop.", inPlan: "{d.sa.req.site.line}", source: "G1 · A-a · G7", terms: ["term.envelope"] },
  power: { title: "Server power the campus must feed", one: "The kilowatts of servers the plan puts on the campus this season: the metered cluster plus the rest of the estate that moves with it.", more: ["At the wall the figure is higher by the site's power overhead (cooling and losses).", "The offer is 500 kW of critical server power; the row shows what is left inside it."], analogy: "The load on a fuse board, with the fuse rating next to it.", inPlan: "{d.sa.req.power.line}", source: "G-h · G-b · D-d", terms: ["term.envelope", "term.pue"] },
  commit: { title: "Committed capacity", one: "The 500 kW the team commits to and pays for in both seasons, with no right to expand; more kW is a separate conversation about ZUR4.", more: ["Billing follows the committed kW, not the metered load; headroom is paid for whether used or not.", "ZUR4 adds 15 MW on the campus in 2028, but that is a new deal, not an option inside this one."], analogy: "A fixed-size storage unit: the rent is the same however full it is.", inPlan: "{d.sa.req.commit.line}", source: "G-h · G-c · G2", terms: ["term.envelope"] },
  ml: { title: "The machine-learning partition", one: "Servers for machine learning on the simulation results: not metered by the FIA, but drawing power from the same 500 kW and the same cage.", more: ["The FIA counts only the restricted airflow solver; analysis of its results is free of the allowance but not of electricity.", "It can also live in the cloud or in Hinwil; here the plan puts it on the campus."], analogy: "The office next to the workshop: no production, same electricity bill.", inPlan: "{d.sa.req.ml.line}", source: "J-g · G-h", terms: ["term.mlpartition"] },
  racks: { title: "Cage positions", one: "How many of the 60 rack positions in the cage the estate takes: estate racks at 8 kW each, the dense cluster racks and any machine-learning racks.", more: ["Denser racks need fewer positions; the cooling choice sets how dense a rack may be.", "Over 60 means a bigger cage or denser rows."], analogy: "Parking spaces in a rented garage.", inPlan: "{d.sa.req.racks.line}", source: "G-h · G5", terms: ["term.rackdensity"] },
  redundancy: { title: "Power and cooling redundancy", one: "How many spares the power and cooling paths have: N (none), N+1 (one spare) or 2N (a complete second set).", more: ["ZUR2 runs 2N power and N+2 cooling; the model gives each tier a facility availability.", "For a team, an hour down inside a period is allowance that never comes back."], analogy: "One spare tyre versus a second car.", inPlan: "{d.sa.req.redundancy.line}", source: "G-d · D-d", terms: ["term.redundancy"] },
  space: { title: "Racks for the cluster", one: "How many racks the metered cluster itself needs, at what density, and what goes in them.", more: ["Servers, graphics processors and storage; HPE GreenLake adds a few buffer servers.", "A cage or suite with the team's own access list keeps the FIA-declared hardware separate."], analogy: "The number of shelves and how heavily each is loaded.", inPlan: "{d.sa.req.space.line}", source: "G5 · H1 · H3", terms: ["term.rackdensity", "term.pfs"] },
  cooling: { title: "Cooling for the rows", one: "Air, rear-door heat exchangers or direct-to-chip liquid: the choice sets the ceiling per rack and what design engineering must provide.", more: ["Air to about 20 kW a rack, rear-door to 70, direct liquid to 150.", "Liquid rows need cooling distribution units, a facility water loop and leak detection."], analogy: "A desk fan, a radiator on the door, or water pipes on the engine.", inPlan: "{d.sa.req.cooling.line}", source: "G5 · G-g · G8", terms: ["term.reardoor", "term.dlc"] },
  fibre: { title: "Dark fibre to Hinwil", one: "Private fibre between the factory and the campus, one route or two different ones; engineers in Hinwil work on the cluster as if it were next door.", more: ["About 40 km, under half a millisecond each way; a carrier builds and owns it, terminated in the campus meet-me room.", "Two routes on different paths turn a dug-up cable from a lost week into a non-event."], analogy: "Two different roads to the same town.", inPlan: "{d.sa.req.fibre.line}", source: "B-e · D10 · G-a", terms: ["term.darkfibre"] },
  xc: { title: "Cross-connects", one: "Cables inside the campus from the team's cage to the carriers' meet-me room, ordered through the portal and tested by Remote Hands.", more: ["Three business days each under the portal service levels; two for the two fibre routes.", "Cloud on-ramps and internet exchange ports are further cross-connects."], analogy: "The last few metres of wiring from the street to the house.", inPlan: "{d.sa.req.xc.line}", source: "G11 · G8 · G-c", terms: ["term.crossconnect"] },
  cloud: { title: "Cloud on-ramps", one: "Private connections from the campus into AWS and Azure for the work the FIA does not meter: machine learning and analytics bursts.", more: ["ServiceFabric on-ramps avoid the public internet; the restricted solver never runs in the cloud under this plan.", "Charged inside the money cap like any service."], analogy: "A side door straight into the warehouse.", inPlan: "{d.sa.req.cloud.line}", source: "G6 · G8", terms: ["term.onramp"] },
  internet: { title: "Internet and peering", one: "Internet bandwidth and, optionally, a port on the SwissIX exchange at ZUR1 for direct traffic with other networks.", more: ["The team's own internet need is small; peering matters for short paths to clouds and partners."], analogy: "A public road next to the private driveways.", inPlan: "{d.sa.req.internet.line}", source: "G10 · G8", terms: [] },
  paddock: { title: "The paddock link", one: "How the race garage talks to the factory on a race weekend: internet tunnels, one carrier circuit, two, or two plus satellite.", more: ["It ends where Mission Control is: in Hinwil for hybrid plans, at the campus otherwise.", "The row carries the round trip for the chosen race and how long a reading takes to become a decision."], analogy: "The phone line from the away ground back to head office.", inPlan: "{d.sa.req.paddock.line}", source: "I-a · I-b · I-d", terms: ["term.rtt", "term.edge"] },
  hands: { title: "Remote Hands", one: "Digital Realty staff doing physical work in the cage on the team's behalf: swaps, reboots, cabling, at any hour.", more: ["Scheduled for planned windows, on demand for a failed server inside a period.", "Mission-critical support tiers pair with 24×7 on-demand hands."], analogy: "A caretaker with the keys who can be called at night.", inPlan: "{d.sa.req.hands.line}", source: "G9 · H3", terms: [] },
  support: { title: "HPE support tier", one: "How fast HPE fixes a broken server: next business day, four hours, or six-hour repair with spares on site.", more: ["A failed server inside an eight-week period is allowance never recovered, so race teams buy the faster tiers.", "Delivered through HPE GreenLake, not by Digital Realty."], analogy: "Breakdown cover: basic, same-day, or a mechanic round the corner.", inPlan: "{d.sa.req.support.line}", source: "H3 · H1", terms: ["term.greenlake"] },
  windows: { title: "Maintenance windows", one: "When the campus may take a planned outage: at the boundary between two testing periods or during the summer and winter shutdowns.", more: ["The FIA counts airflow computing in six periods a year; a cluster down mid-period burns allowance that does not roll over.", "In the shutdowns the FIA bans airflow computing except for maintenance, which makes them ideal windows."], analogy: "Doing the roadworks during the school holidays.", inPlan: "{d.sa.req.windows.line}", source: "C13 · C14 · F4.1.4", terms: ["term.atp"] },
  renewable: { title: "Renewable electricity", one: "Whether the campus electricity is bought as 100 % renewable, and the carbon the team reports for it on a contract basis.", more: ["Digital Realty's European portfolio is matched to renewables; the team reports both the contract figure and the Swiss grid-mix figure.", "Electricity is inside the money cap whatever its colour."], analogy: "Choosing the green tariff on the household bill.", inPlan: "{d.sa.req.renewable.line}", source: "D4 · D-c · G-b", terms: [] },
  heat: { title: "Heat reuse", one: "Waste heat from the rows offered to neighbours now and to the Opfikon district heating network from 2029.", more: ["Liquid-cooled rows give warm water that is easiest to reuse.", "Reported as carbon avoided elsewhere, not as a saving on the team's bill."], analogy: "Warming the greenhouse with the oven's exhaust.", inPlan: "{d.sa.req.heat.line}", source: "G4 · D5", terms: ["term.dlc"] },
  fia: { title: "The FIA declaration", one: "The FIA must be told about the cluster, its location, cores and declared clock within a month of a change; it may inspect the suite.", more: ["The filing is the team's, but the campus must allow FIA access on request and keep the declared hardware identifiable.", "A second declaration follows the 2028 step-up."], analogy: "Registering a vehicle after a rebuild, with an inspection possible.", inPlan: "{d.sa.req.fia.line}", source: "F4.4.3 · C15", terms: ["term.declaredClock"] },
  cap: { title: "Cost-cap treatment of the fee", one: "How much of the colocation fee the team's finance function may class as property costs, which the money cap does not count.", more: ["Rent, lease and leasehold improvements can sit outside the cap; services such as power and Remote Hands sit inside.", "The invoice should separate the two so the split is defensible to the FIA's auditors."], analogy: "Splitting the bill into rent and services so each is clear.", inPlan: "{d.sa.req.cap.line}", source: "C3 · D5.1.1.j", terms: ["term.capcharge", "term.costcap"] },
  ready: { title: "Suite ready for installation", one: "The first day the suite, fibre, hardware and burn-in are all done; the switch can happen then or at the next period boundary.", more: ["Counted forward from the contract date through the longest lead time.", "Slack is the gap between ready and the chosen cutover; a slip means ready came later than the target."], analogy: "The day the removal van can actually come.", inPlan: "{d.sa.req.ready.line}", source: "G-e · D-e · H-f", terms: ["term.atp"] },
}

const SERVICE_ENTRIES = {
  colo: { title: "PlatformDIGITAL® colocation", one: "Space, power and cooling in a cabinet, cage or suite on the Zurich campus; the home of the restricted airflow-computing estate.", more: ["Two independent power feeds to every rack, the team's own access list, the 500 kW envelope.", "The team keeps its servers and its FIA filings; Digital Realty keeps the building running."], analogy: "Renting a workshop with the power and the air conditioning included.", inPlan: "{d.sa.service.colo.line}", source: "G5 · G1 · G-c", terms: ["term.envelope"] },
  hd: { title: "High-density colocation", one: "Rows built for racks far denser than office IT: rear-door heat exchangers to 70 kW a rack, direct liquid beyond that by design.", more: ["Airflow solvers pack many cores into few racks, so density is the norm, not the exception.", "Liquid rows need cooling distribution units and a facility water loop."], analogy: "A kitchen wired for industrial ovens rather than a toaster.", inPlan: "{d.sa.service.hd.line}", source: "G5 · G-g", terms: ["term.reardoor", "term.dlc"] },
  xc: { title: "ServiceFabric® Cross Connect", one: "The cables inside the campus that join the team's cage to carriers, clouds and partners in the meet-me room.", more: ["Ordered through the portal with a three-business-day service level; continuity-tested by Remote Hands."], analogy: "The last few metres of wiring from the street to the house.", inPlan: "{d.sa.service.xc.line}", source: "G8 · G11", terms: ["term.crossconnect"] },
  campus: { title: "Campus Connect / Metro Connect", one: "Dedicated links between buildings on the campus (ZUR1–ZUR4) and across the Zurich metro, for a second site or a future ZUR4 hall.", more: ["Listed for 2N plans as the path to a second room; ZUR4's 15 MW in 2028 is a separate commercial conversation."], analogy: "A private corridor between two buildings you rent.", inPlan: "{d.sa.service.campus.line}", source: "G8 · G2 · G-h", terms: [] },
  cloud: { title: "Cloud on-ramps", one: "Private connections into AWS Direct Connect and Azure ExpressRoute from the campus, for the team's unmetered machine learning and analytics.", more: ["Avoids the public internet; the restricted solver stays on the declared cluster."], analogy: "A side door straight into the warehouse.", inPlan: "{d.sa.service.cloud.line}", source: "G6 · G8", terms: ["term.onramp"] },
  ix: { title: "Internet Exchange and IP bandwidth", one: "A port on the SwissIX exchange at ZUR1 and plain internet bandwidth, for traffic with other networks and the outside world.", more: ["SwissIX ports run to 400G; the team's need is modest but sensitive to delay."], analogy: "A junction onto the public motorway.", inPlan: "{d.sa.service.ix.line}", source: "G10", terms: [] },
  hands: { title: "Remote Hands", one: "Digital Realty staff doing physical work in the cage for the team at any hour: swaps, reboots, cabling, maintenance-window support.", more: ["Requested through the portal, scheduled or on demand."], analogy: "A caretaker with the keys who can be called at night.", inPlan: "{d.sa.service.hands.line}", source: "G9", terms: [] },
  sus: { title: "Sustainability programme", one: "Renewable electricity across the European portfolio, power-overhead and carbon reporting, and heat offered to the Opfikon network from 2029.", more: ["The team reports contract-based and grid-mix carbon; heat reuse counts as carbon avoided elsewhere."], analogy: "The green tariff and the recycling scheme in one contract.", inPlan: "{d.sa.service.sus.line}", source: "G4 · D4 · G-b", terms: ["term.pue"] },
  fibre: { title: "Carrier dark fibre", one: "Private fibre from Hinwil to the campus, built and owned by a carrier such as Swisscom, Litecom or ewz; not a Digital Realty service.", more: ["Terminated in the campus meet-me room; a second route on a different path is the usual resilience step.", "Civil works on a route can take 26 weeks or more, so routes on existing ducts are preferred."], analogy: "Renting the road, not a bus ticket.", inPlan: "{d.sa.service.fibre.line}", source: "D10 · B-e · D-e", terms: ["term.darkfibre"] },
  hpe: { title: "HPE via HPE GreenLake", one: "The cluster itself, its support and its refresh, supplied by HPE as a metered service installed in the cage; a partner service, not Digital Realty's.", more: ["GreenLake delivers pre-staged capacity in four to eight weeks with buffer servers; a purchase takes ten to eighteen.", "Support tiers run from next business day to six-hour repair with spares on site."], analogy: "Leasing the machines with the mechanic included.", inPlan: "{d.sa.service.hpe.line}", source: "H1 · H3 · H-f", terms: ["term.greenlake"] },
}

const RISK_ENTRIES = {
  lead: { title: "Lead times slip past the boundary", one: "If fit-out, fibre or hardware takes longer than planned, the switch misses its period boundary and part of the season stays on today's room.", more: ["Likelihood follows the slack in the current schedule; triggered when the plan already shows a slip.", "Hold a fallback at the next boundary rather than switching mid-period."], analogy: "Missing the ferry and waiting for the next one rather than swimming.", inPlan: "{d.sa.risk.lead.line}", source: "G-e · D-e · H-f", terms: ["term.atp"] },
  "fibre-civil": { title: "Fibre needs civil works", one: "A route that needs new ducts can take 26 weeks or more to build, far longer than the fit-out.", more: ["Choose routes on existing utility ducts; order the second route in parallel, not after the first."], analogy: "Digging a new driveway versus using the one that is there.", inPlan: "{d.sa.risk.fibreCivil.line}", source: "D-e · D10", terms: ["term.darkfibre"] },
  "single-route": { title: "One fibre route", one: "With a single route the whole solver estate hangs on one cable; a dug-up road takes the engineers' link down with it.", more: ["Two diverse routes give about 99.995 % modelled availability; mitigated when the plan has two."], analogy: "A town with one bridge.", inPlan: "{d.sa.risk.singleRoute.line}", source: "B-e · I-b", terms: ["term.darkfibre"] },
  midatp: { title: "A mid-period cutover", one: "Switching inside one of the FIA's eight-week periods wastes solver days of an allowance that does not roll over.", more: ["Move at a period boundary or in a shutdown; parallel running turns the switch into a one-day queue drain.", "Triggered when the schedule lands inside a period."], analogy: "Changing hotels halfway through a prepaid week.", inPlan: "{d.sa.risk.midatp.line}", source: "C9 · F4.6.1", terms: ["term.atp"] },
  late27: { title: "Live after Round 1", one: "If the new estate goes live after the first race, the opening periods of 2027 run on today's power-short room.", more: ["Likelihood follows the share of 2027 on today's setup; signing earlier is the lever."], analogy: "Moving into the new house after the school year has started.", inPlan: "{d.sa.risk.late27.line}", source: "C7 · F4.1.4", terms: ["term.atp"] },
  property: { title: "Less of the fee counted as property", one: "The team's auditors may class less of the colocation fee as property costs than planned, pushing more of it inside the money cap.", more: ["Structure the invoice so rent, lease and leasehold improvements are separable from services."], analogy: "A landlord's bill that mixes rent and cleaning on one line.", inPlan: "{d.sa.risk.property.line}", source: "C3", terms: ["term.capcharge"] },
  "power-stepup": { title: "2028 power or liquid rows late", one: "If the step-up rows (power whips, liquid loop, cooling units) are not ready, the 2028 graphics processors wait.", more: ["Order by the date the timeline shows; the step-up stays inside the 500 kW envelope."], analogy: "The new oven arriving before the kitchen is rewired.", inPlan: "{d.sa.risk.powerStepup.line}", source: "G-e · G-h", terms: ["term.dlc"] },
  "hinwil-short": { title: "The Hinwil room cannot power the estate", one: "Today's 300 kW room is short of the estate's power in both seasons; servers that cannot be switched on do no metered work.", more: ["Retrofit the room or move the solver estate to the campus."], analogy: "More appliances than the fuse board can carry.", inPlan: "{d.sa.risk.hinwilShort.line}", source: "A-e · A-a", terms: [] },
  "gpu-rule": { title: "No GPU-to-AUh rule yet", one: "The FIA has not said how GPUs will be charged against the allowance from 2028; the model assumes a share of processor-equivalents.", more: ["Keep the GPU partition sized so it can be rebalanced when the rule lands; the risk is high for plans that put GPUs on the solver."], analogy: "Buying the ticket before the fare is published.", inPlan: "{d.sa.risk.gpuRule.line}", source: "C10 · J-c · F4.4.1", terms: ["term.gpu", "term.auh"] },
  early28: { title: "GPU partition delivered too early", one: "Graphics processors delivered long before 1 January 2028 cost money every week they cannot legally run the solver.", more: ["Four weeks early is burn-in; later weeks are charge without value, shown as a carrying cost."], analogy: "Paying rent on a flat you cannot move into yet.", inPlan: "{d.sa.risk.early28.line}", source: "F4.4.1 · H-f", terms: ["term.gpu"] },
  thermal: { title: "Racks hotter than the cooling allows", one: "Racks denser than the cooling ceiling throttle their chips, so the team pays allowance for slower work.", more: ["Match density to cooling: rear-door to 70 kW a rack, direct liquid beyond."], analogy: "An engine that loses power when it overheats.", inPlan: "{d.sa.risk.thermal.line}", source: "G5 · G-g", terms: ["term.rackdensity"] },
  support: { title: "A failed node inside a period", one: "A broken server waiting for next-business-day support burns allowance that never comes back.", more: ["Four-hour or mission-critical support with on-site spares; Remote Hands do the physical swap."], analogy: "Breakdown cover that takes a day to arrive.", inPlan: "{d.sa.risk.support.line}", source: "H3 · G9", terms: [] },
  calendar28: { title: "2028 calendar not yet published", one: "The 2028 pre-season and Round 1 dates are not out; the model uses the 2027 pattern.", more: ["Re-plan when the 2028 calendar is published; low impact on the campus design."], analogy: "Planning next year's holiday before the term dates are out.", inPlan: "{d.sa.risk.calendar28.line}", source: "C-a", terms: [] },
}

const CHECK_ENTRIES = {
  position: { title: "Why the finishing position matters", one: "Last season's finishing position sets how much computing the FIA allows per period; worse teams get more, so it sizes the cluster.", more: ["First place gets 70 % of the base amount, tenth or lower 115 %; the scale is re-read after the third period.", "Ask which position the team plans against and when it will re-plan."], analogy: "Handicaps in golf: the weaker player gets more strokes.", inPlan: "This plan assumes position P{x.position}: {s.fia.pct} % of the base amount.", source: "F4.6.1 · C5", terms: ["term.atr"] },
  "gpu-rule": { title: "The unwritten GPU rule", one: "From 2028 GPUs may run the solver, but the FIA has not said how they count against the allowance; the answer sizes the 2028 rows.", more: ["Ask what charge the team assumes and how it would rebalance if the rule is stricter."], analogy: "Designing the car park before the parking charges are published.", inPlan: "{d.gpuSolverNote}; modelled at {x.gpuChargePct} % of processor-equivalents.", source: "F4.4.1 · C10 · J-c", terms: ["term.gpu"] },
  declaration: { title: "Who files with the FIA", one: "The team must declare the cluster to the FIA and report each period; the campus may need to admit an inspector.", more: ["Agree the access process for an FIA visit and how the declared hardware is identified in the cage."], analogy: "Knowing who holds the paperwork before the inspector calls.", inPlan: "{d.plan.declarationLabel}; {d.plan.declaration28Label}.", source: "F4.4.3 · C15", terms: ["term.declaredClock"] },
  hinwil: { title: "What stays in Hinwil", one: "The real power and cooling of the factory room, and what stays there: Mission Control, the driving simulator, office IT.", more: ["It decides whether a hybrid plan works and how much estate moves."], analogy: "Measuring the old garage before deciding what goes to the new one.", inPlan: "{d.hinwilLine}.", source: "A-a · A3 · A-e", terms: ["term.dil"] },
  estate: { title: "Today's cluster", one: "Server count, cores, declared clock, memory, network and storage of today's cluster, and what moves rather than being replaced.", more: ["Moved hardware needs racks and power at the campus from day one; replaced hardware arrives on HPE's lead time."], analogy: "An inventory before the removal van comes.", inPlan: "{d.clusterLine}.", source: "A15 · A-f · H-a", terms: ["term.declaredClock"] },
  power: { title: "Power per season inside 500 kW", one: "Server kilowatts for 2027 and 2028 inside the 500 kW envelope, the machine-learning partition, and growth beyond 2028 (ZUR4).", more: ["The 2028 step-up must fit the same 500 kW; anything beyond is a ZUR4 conversation."], analogy: "Checking the suitcase weight for both legs of the trip.", inPlan: "{fmt.num(d.envelope.drIT, 0)} kW of {d.envelope.offerKW} at the campus; machine learning: {d.ml.note}.", source: "G-h · J-g · G2", terms: ["term.envelope", "term.mlpartition"] },
  cooling: { title: "Density and cooling per season", one: "Rack density and cooling choice per season, and the liquid-loop details (cooling units, supply temperature, leak detection) for any dense partition.", more: ["Liquid rows take longer to fit out (16 weeks) and change the suite design."], analogy: "Deciding between a radiator and underfloor heating before the floor goes down.", inPlan: "{d.coolingLabel} at {x.rackKW} kW a rack; limit about {s.fac.coolingMax} kW.", source: "G5 · G-e · G-g", terms: ["term.dlc", "term.rackdensity"] },
  redundancy: { title: "Redundancy and windows", one: "Whether the team needs N+1 or 2N, and which maintenance windows it will accept against the FIA's period calendar.", more: ["Boundaries between periods and the two shutdowns are the natural windows."], analogy: "Agreeing when the water can be turned off.", inPlan: "{d.redundancyLabel}; windows at period boundaries or in the shutdowns.", source: "G-d · C13", terms: ["term.redundancy", "term.atp"] },
  fibre: { title: "Fibre routes and latency", one: "Which carriers, how different the two routes really are, and the delay the engineers' workflow can live with.", more: ["Route files show whether two routes share a duct.", "About 0.4 ms each way is invisible to the workflow."], analogy: "Checking that the two roads do not share the same bridge.", inPlan: "{d.fibreLine}.", source: "D10 · D-e · G-a", terms: ["term.darkfibre", "term.rtt"] },
  xc: { title: "Cross-connects, clouds and the paddock", one: "Which cross-connects, cloud on-ramps and exchange ports the team needs, and who terminates the race-weekend link.", more: ["The paddock link ends where Mission Control is; the on-ramps serve the unmetered work."], analogy: "Listing every cable before the electrician arrives.", inPlan: "{d.cloudNote}; paddock link: {d.tracksideLabel}.", source: "G8 · G6 · I-b", terms: ["term.crossconnect", "term.onramp"] },
  ops: { title: "Hands, support and keys", one: "What Remote Hands should cover, which HPE support tier the team buys, and who holds the keys to the cage.", more: ["A failed server inside a period is lost allowance, so hands and support tiers matter more than in office IT."], analogy: "Agreeing who has the spare key and who calls the plumber.", inPlan: "{d.supportLabel}; {d.consumptionLabel}.", source: "G9 · H3", terms: ["term.greenlake"] },
  timeline: { title: "Dates that drive the design", one: "Contract date, the period boundary targeted for the switch, parallel-running weeks and the 2028 step-up date.", more: ["Every lead time counts from signature; the first feasible switch day falls out of them."], analogy: "Working back from the wedding date.", inPlan: "{d.plan.contractLabel}; {d.plan.goLiveLabel}; {d.plan.stepUpLabel}.", source: "C13 · G-e · H-f", terms: ["term.atp"] },
  finance: { title: "How finance treats the fee", one: "How the team's finance function will class the colocation fee and the fit-out against the money cap.", more: ["Property costs sit outside the cap; the invoice structure decides how much qualifies."], analogy: "Keeping the rent receipt separate from the shopping.", inPlan: "{x.propertySharePct} % of the fee as property costs: {fmt.chf(s.money.excludedYearly)} a year outside the cap.", source: "C3 · D5.1.1.j", terms: ["term.capcharge"] },
  sustainability: { title: "Certificates, heat and reporting", one: "Which renewable certificates, heat-reuse participation and carbon figures the team needs for its own reporting.", more: ["Contract-based and grid-mix carbon, plus heat offered to the network."], analogy: "Collecting the receipts the auditor will ask for.", inPlan: "{d.renewableNote}; {fmt.num(s.money.heatMWh, 0)} MWh of heat reused.", source: "D4 · G4 · D-c", terms: [] },
  security: { title: "Access, secrecy and residency", one: "Physical access lists, FIA confidentiality, keeping data in Switzerland and audit logging for the cage.", more: ["A rival team's data on the same campus is normal in colocation; the cage and the access list are the boundary."], analogy: "Separate locked rooms in a shared building.", inPlan: "Estate at {d.siteName}; access list and FIA inspection access are the team's to define.", source: "G5 · F4.4.3", terms: [] },
}

const ROLE_ENTRIES = {
  team: { title: "Audi F1 Team", one: "The customer: decides the estate, files the FIA declarations, owns the money-cap treatment and the race-weekend link.", more: ["Everything the FIA regulates stays with the team; Digital Realty never files anything."], analogy: "The homeowner who signs the forms.", inPlan: "{d.sa.role.team.line}", source: "A1 · F4.4.3", terms: [] },
  hpe: { title: "HPE via HPE GreenLake", one: "Supplies, installs and supports the cluster and meters the GreenLake capacity; sets the hardware lead time.", more: ["The team has used GreenLake since 2023; the support tier decides how fast a failed server is fixed."], analogy: "The appliance maker with its own repair service.", inPlan: "{d.sa.role.hpe.line}", source: "H1 · H3 · A15", terms: ["term.greenlake"] },
  carrier: { title: "Dark-fibre carrier", one: "Builds and owns the fibre routes between Hinwil and the campus (Swisscom, Litecom or ewz), with route files and a service level.", more: ["Not a Digital Realty service; terminated in the campus meet-me room."], analogy: "The road builder.", inPlan: "{d.sa.role.carrier.line}", source: "D10 · B-e", terms: ["term.darkfibre"] },
  fia: { title: "FIA Technical Department", one: "Receives the declaration and the period reports and may inspect the cluster; the regulator everything is designed around.", more: ["Declarations within a month of a change; reports 14 days after each period."], analogy: "The referee.", inPlan: "{d.sa.role.fia.line}", source: "F4.4.3 · C15", terms: ["term.atr"] },
  "sales-engineering": { title: "Digital Realty · Sales engineering", one: "Requirements, sizing, the commercial proposal and the 500 kW envelope; owns the ZUR4 conversation for anything beyond it.", more: ["A generic role name (ASSUMPTION); the fact pack lists the public services, not the org chart."], analogy: "The estate agent who sizes the house.", inPlan: "{d.sa.role.salesEngineering.line}", source: "G-f · G-h", terms: ["term.envelope"] },
  "design-engineering": { title: "Digital Realty · Design engineering", one: "Suite layout, power whips, rear-door or liquid rows, cooling distribution units, redundancy and the fit-out lead time.", more: ["A generic role name (ASSUMPTION)."], analogy: "The architect and the builder.", inPlan: "{d.sa.role.designEngineering.line}", source: "G-f · G-e", terms: ["term.dlc"] },
  interconnection: { title: "Digital Realty · Interconnection", one: "Cross-connects, Campus and Metro Connect, cloud on-ramps, carrier meet-me rooms and the SwissIX port.", more: ["A generic role name (ASSUMPTION)."], analogy: "The electrician who wires every room to the street.", inPlan: "{d.sa.role.interconnection.line}", source: "G-f · G8", terms: ["term.crossconnect"] },
  sustainability: { title: "Digital Realty · Sustainability", one: "Renewable supply, power-overhead and carbon reporting, and the team's part in heat reuse.", more: ["A generic role name (ASSUMPTION)."], analogy: "The energy adviser.", inPlan: "{d.sa.role.sustainability.line}", source: "G-f · G4", terms: [] },
  "customer-success-remote-hands": { title: "Digital Realty · Customer success / Remote Hands", one: "Onboarding, Remote Hands and maintenance windows lined up with the FIA's period boundaries.", more: ["A generic role name (ASSUMPTION)."], analogy: "The caretaker and the front desk.", inPlan: "{d.sa.role.customerSuccessRemoteHands.line}", source: "G-f · G9", terms: ["term.atp"] },
}

const TERM_ENTRIES = {
  atr: { title: "ATR — Aerodynamic Testing Restrictions", one: "The FIA's limits on wind-tunnel time and airflow computing, set every eight weeks by championship position.", analogy: "A salary cap for testing.", source: "F4 · C5" },
  auh: { title: "AUh / MAUh — Allocation Unit hours (millions of)", one: "The FIA's unit of computing: cores × seconds × declared clock ÷ 3,600. One MAUh is a million of them. Eighth place gets 6.3 MAUh per period.", analogy: "Units on a pre-paid electricity meter.", source: "F4.4.4 · C9" },
  atp: { title: "ATP — Aerodynamic Testing Period", one: "One of the eight-week windows the allowance is counted in; unused allowance does not roll over.", analogy: "A school half-term.", source: "F4.1.4 · C8" },
  costcap: { title: "Cost cap", one: "The money cap on what a team may spend on the car each season, about USD 215 M. Most IT costs count; property costs do not.", analogy: "The household budget.", source: "C1 · C3" },
  declaredClock: { title: "Declared clock (CCF)", one: "The clock speed the team promises the FIA its cores run at. Charged in full; may not be below the chip's base speed; with turbo on, the top turbo speed counts.", analogy: "A declared speed limit you are billed at.", source: "F4.4.2 · F4.4.4" },
  cfd: { title: "CFD — computational fluid dynamics", one: "Simulating the air around the car by splitting it into tens of millions of small boxes and solving the physics in each.", analogy: "A wind tunnel made of maths.", source: "C4" },
  correlation: { title: "Wind-tunnel correlation", one: "Checking that the computer's answers match the wind tunnel and the track; without it, more computing is just more wrong answers faster.", analogy: "Marking homework against the answer sheet.", source: "J-a" },
  dil: { title: "DIL simulator — driver-in-the-loop", one: "The team's full-size driving simulator at Hinwil; it runs on separate computing, not the allowance.", analogy: "A flight simulator for the car.", source: "A3" },
  pue: { title: "PUE — power usage effectiveness", one: "Total site power divided by server power. 1.15 is excellent; 1.6 is an old air-cooled room.", analogy: "The service charge on top of the bill.", source: "G-b · D7" },
  redundancy: { title: "N / N+1 / 2N", one: "How many spares the power and cooling have: none, one, or a complete second set.", analogy: "One spare tyre vs a second car.", source: "G-d" },
  dlc: { title: "Direct-to-chip liquid cooling", one: "Water pipes bolted onto the processors. Supports the densest cabinets and the lowest power overhead, and makes heat reuse easy.", analogy: "A water-cooled engine instead of air-cooled.", source: "G8" },
  reardoor: { title: "Rear-door heat exchanger", one: "A radiator in the cabinet's back door that takes the heat away before it reaches the room.", analogy: "A cold plate on the oven door.", source: "G5" },
  greenlake: { title: "HPE GreenLake", one: "HPE's way of selling computers as a monthly service with a reserved minimum, installed where you choose. The team has used it since 2023.", analogy: "Leasing a car with a mileage allowance.", source: "A15 · H1" },
  crossconnect: { title: "Cross-connect", one: "A cable inside the campus from the team's cabinets to a carrier, cloud or partner.", analogy: "A direct line to the shop next door.", source: "G-c" },
  darkfibre: { title: "Dark fibre", one: "A fibre-optic cable you rent whole and light with your own equipment; private, fast and fixed-price.", analogy: "Renting the road, not a bus ticket.", source: "B-e · D10" },
  onramp: { title: "Cloud on-ramp", one: "A private connection from the campus into AWS or Azure, avoiding the public internet.", analogy: "A side door into the warehouse.", source: "G6" },
  fp64: { title: "FP64 — double precision", one: "Very precise maths (64-bit). Airflow solvers need it; AI chips are built for faster, rougher maths and vary hugely in how much FP64 they keep.", analogy: "Measuring in tenths of a millimetre, not centimetres.", source: "J2" },
  vcache: { title: "3D V-Cache", one: "AMD's way of stacking an extra store of fast memory on top of the processor, tripling the on-chip cache. Airflow maths runs 20–60 % faster at the same clock.", analogy: "A bigger pantry next to the stove.", source: "K2 · K3 · K4" },
  bandwidth: { title: "Memory bandwidth", one: "How fast a processor can pull numbers from its memory, in gigabytes a second. Airflow maths is usually limited by this, not by clock speed.", analogy: "The width of the pipe, not the pressure.", source: "K1 · K6" },
  ipc: { title: "Work per clock tick", one: "How much a core gets done each tick. Newer designs do more; the FIA only counts ticks.", analogy: "Steps per stride.", source: "H-d" },
  interconnect: { title: "Interconnect (InfiniBand, Slingshot, Ethernet)", one: "The network the servers use to talk to each other mid-run; the fast kinds are built for tiny, frequent messages.", analogy: "A relay team's baton pass.", source: "H2" },
  pfs: { title: "Parallel file system (Lustre, ClusterStor)", one: "Storage spread over many servers so hundreds of cores can read and write at once.", analogy: "Many checkouts instead of one.", source: "A15 · H-a" },
  gpu: { title: "GPU — graphics processor", one: "A chip that does thousands of simple sums at once; brilliant for pictures, AI and, with care, airflow maths.", analogy: "A thousand pocket calculators working together.", source: "J2" },
  turnaround: { title: "Turnaround", one: "The time from \"test this idea\" to \"here are the pictures\", one design iteration.", analogy: "Oven time for one batch.", source: "model" },
  shapley: { title: "Fair share (Shapley value)", one: "Splitting a joint result among its causes by averaging each cause's effect over every order they could have happened in. The shares add up to the total.", analogy: "Splitting a bill by what each person actually ordered.", source: "J-j" },
  capcharge: { title: "Inside the cap / outside the cap", one: "Costs the FIA counts against the money cap (servers, electricity, support, links) versus costs it does not (property: space, fit-out, building plant).", analogy: "Pocket money vs rent paid by someone else.", source: "C3" },
  rtt: { title: "Round-trip time", one: "How long a message takes to go to the factory and back. Light in fibre: about 5 ms per 1,000 km.", analogy: "The echo delay on a long phone call.", source: "I-a" },
  edge: { title: "Edge compute", one: "Small computers at the track that pre-digest data before sending it home.", analogy: "Sorting the post before it goes to head office.", source: "I-d" },
  envelope: { title: "The 500 kW envelope", one: "Digital Realty's offer: 500 kW of critical power for the servers in both seasons, a hard ceiling with no expansion right.", analogy: "A fuse box rated for the whole house.", source: "G11 · G-g" },
  rackdensity: { title: "Rack density", one: "How many kilowatts of servers go into one rack; the cooling choice sets the ceiling (air 20, rear-door 70, direct liquid 150 kW).", analogy: "How many hobs you can run on one kitchen circuit.", source: "G-h · G5" },
  mlpartition: { title: "ML partition", one: "Servers for machine learning and other work the FIA does not meter; they still draw power wherever they stand.", analogy: "The office next to the workshop: no production, same electricity bill.", source: "D11 · J-g" },
}

// ---------------------------------------------------------------------------------------------
// Assembly and id lists
// ---------------------------------------------------------------------------------------------

const withPrefix = (prefix, entries, extra = () => ({})) =>
  Object.fromEntries(Object.entries(entries).map(([id, e]) => [`${prefix}.${id}`, { id, kind: prefix, ...extra(id, e), ...e }]))

export const EXPLAIN = Object.freeze({
  ...withPrefix("control", CONTROL_ENTRIES, (id) => ({ term: CONTROLS[id] ? CONTROLS[id].label : undefined })),
  ...withPrefix("tile", TILE_ENTRIES),
  ...withPrefix("flag", FLAG_ENTRIES),
  ...withPrefix("driver", DRIVER_ENTRIES),
  ...withPrefix("strategy", STRATEGY_ENTRIES),
  ...withPrefix("milestone", MILESTONE_ENTRIES),
  ...withPrefix("task", TASK_ENTRIES),
  ...withPrefix("req", REQ_ENTRIES, () => ({ sa: true })),
  ...withPrefix("service", SERVICE_ENTRIES, () => ({ sa: true })),
  ...withPrefix("risk", RISK_ENTRIES, () => ({ sa: true })),
  ...withPrefix("check", CHECK_ENTRIES, () => ({ sa: true })),
  ...withPrefix("role", ROLE_ENTRIES, () => ({ sa: true })),
  ...withPrefix("term", TERM_ENTRIES, (id, e) => ({ more: [e.one], inPlan: null, terms: [] })),
})

export const CONTROL_IDS = Object.keys(CONTROL_ENTRIES)
export const TILE_IDS = Object.keys(TILE_ENTRIES)
export const FLAG_IDS = Object.keys(FLAG_ENTRIES)
export const DRIVER_IDS = Object.keys(DRIVER_ENTRIES)
export const STRATEGY_IDS = Object.keys(STRATEGY_ENTRIES)
export const TERM_IDS = Object.keys(TERM_ENTRIES)
export const MILESTONE_IDS = Object.keys(MILESTONE_ENTRIES)
export const TASK_IDS = Object.keys(TASK_ENTRIES)
export const REQ_IDS = Object.keys(REQ_ENTRIES)
export const SERVICE_IDS = Object.keys(SERVICE_ENTRIES)
export const RISK_IDS = Object.keys(RISK_ENTRIES)
export const CHECK_IDS = Object.keys(CHECK_ENTRIES)
export const ROLE_IDS = Object.keys(ROLE_ENTRIES)
/** Entries whose templates read the Solutions Architect facts (`d.sa`) of explainContext({ plan }); they degrade to "not in this plan" without one. */
export const SA_IDS = Object.entries(EXPLAIN).filter(([, e]) => e.sa).map(([id]) => id)
/** Entries for controls or flags the model does not have yet (none since the integration pass; kept for the tests). */
export const PENDING_IDS = Object.entries(EXPLAIN).filter(([, e]) => e.pending).map(([id]) => id)
/** Entries for the two-season planning tool's tiles and timeline flags; their templates read explainContext({ plan }). */
export const PLAN_IDS = Object.entries(EXPLAIN).filter(([, e]) => e.plan).map(([id]) => id)

// ---------------------------------------------------------------------------------------------
// Template resolver (no eval, no Function)
// ---------------------------------------------------------------------------------------------

const FMT_WHITELIST = ["chf", "chfDelta", "chfFull", "sec", "num", "pct", "signed", "hours", "ms", "availability", "position"]

function tokenize(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === " " || c === "\t") { i++; continue }
    if ("+-*/(),".includes(c)) { tokens.push({ t: c }); i++; continue }
    if (c === "'") {
      let j = i + 1
      let str = ""
      while (j < src.length && src[j] !== "'") str += src[j++]
      if (j >= src.length) throw new Error("unterminated string")
      tokens.push({ t: "str", v: str })
      i = j + 1
      continue
    }
    if (/[0-9]/.test(c) && !/[A-Za-z_]/.test(src[i - 1] || "")) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      // a number followed by a letter or dot-ident is a path segment such as 2027.perf (handled by the path branch)
      if (/[A-Za-z_]/.test(src[j] || "")) { /* fall through to path */ } else {
        tokens.push({ t: "num", v: Number(src.slice(i, j)) })
        i = j
        continue
      }
    }
    if (/[A-Za-z_0-9]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++
      tokens.push({ t: "path", v: src.slice(i, j) })
      i = j
      continue
    }
    throw new Error(`unexpected character "${c}"`)
  }
  return tokens
}

function lookup(ctx, path, report) {
  let node = ctx
  for (const part of path.split(".")) {
    if (node === null || node === undefined || typeof node !== "object" && typeof node !== "function") { report(path); return undefined }
    if (!(part in node)) { report(path); return undefined }
    node = node[part]
  }
  if (node === undefined || node === null) report(path)
  return node
}

/** Parse and evaluate one `{…}` expression against ctx. */
function evaluateExpression(src, ctx, report) {
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (t) => { const tok = next(); if (!tok || tok.t !== t) throw new Error(`expected ${t}`); return tok }

  const factor = () => {
    const tok = next()
    if (!tok) throw new Error("unexpected end")
    if (tok.t === "-") { const v = factor(); return typeof v === "number" ? -v : NaN }
    if (tok.t === "(") { const v = sum(); expect(")"); return v }
    if (tok.t === "num") return tok.v
    if (tok.t === "str") return tok.v
    if (tok.t === "path") {
      if (tok.v.startsWith("fmt.") && peek() && peek().t === "(") {
        const name = tok.v.slice(4)
        next()
        const args = []
        if (peek() && peek().t !== ")") {
          args.push(sum())
          while (peek() && peek().t === ",") { next(); args.push(sum()) }
        }
        expect(")")
        const fn = FMT_WHITELIST.includes(name) && ctx.fmt && typeof ctx.fmt[name] === "function" ? ctx.fmt[name] : null
        if (!fn) { report(`fmt.${name}`); return undefined }
        return fn(...args)
      }
      return lookup(ctx, tok.v, report)
    }
    throw new Error(`unexpected token ${tok.t}`)
  }
  const term = () => {
    let v = factor()
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = next().t
      const r = factor()
      v = op === "*" ? v * r : v / r
    }
    return v
  }
  const sum = () => {
    let v = term()
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = next().t
      const r = term()
      v = op === "+" ? (typeof v === "string" || typeof r === "string" ? `${v}${r}` : v + r) : v - r
    }
    return v
  }
  const value = sum()
  if (pos !== tokens.length) throw new Error("trailing tokens")
  return value
}

function render(value) {
  if (value === undefined || value === null) return "—"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—"
    if (Number.isInteger(value) && Math.abs(value) >= 10_000) return value.toLocaleString("en-US")
    return String(Math.round(value * 1e6) / 1e6)
  }
  if (typeof value === "boolean") return value ? "yes" : "no"
  return String(value)
}

/**
 * Fill a template (or an entry's `inPlan`) from `ctx`. Unresolved paths, unknown formatters and syntax errors
 * render as "—" and are passed to `onMissing(what, template)`.
 */
export function fillTemplate(template, ctx = {}, { onMissing } = {}) {
  const src = typeof template === "string" ? template : template && typeof template.inPlan === "string" ? template.inPlan : ""
  const report = (what) => { if (onMissing) onMissing(what, src) }
  return src.replace(/\{([^{}]*)\}/g, (_, expr) => {
    try {
      const value = evaluateExpression(expr.trim(), ctx, report)
      if (value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))) {
        if (typeof value === "number") report(expr.trim())
        return "—"
      }
      return render(value)
    } catch (e) {
      report(`syntax: ${expr.trim()} (${e.message})`)
      return "—"
    }
  })
}

/** The "In this plan" text for an entry: the filled template, or the `zero` text when the driver is pruned. */
export function explainText(id, ctx, { pruned = false, onMissing } = {}) {
  const entry = EXPLAIN[id]
  if (!entry) return ""
  if (pruned && entry.zero) return entry.zero
  return entry.inPlan ? fillTemplate(entry.inPlan, ctx, { onMissing }) : ""
}

// ---------------------------------------------------------------------------------------------
// Labels for the Plain English toggle
// ---------------------------------------------------------------------------------------------

/**
 * `title(id)`: plain title when Plain English is on, the model's own label otherwise (`id` may be an EXPLAIN key
 * or a bare control id). `unitWord(unit)`: "MAUh" → "million unit-hours" when on. `barLabel(driverId, option)`:
 * the waterfall bar label; the processor-family bar follows the chosen option; with Plain English off the model
 * term is appended in brackets.
 */
export function labels(plainEnglish = true) {
  const entryFor = (id) => EXPLAIN[id] || EXPLAIN[`control.${id}`] || EXPLAIN[`tile.${id}`] || EXPLAIN[`driver.${id}`] || null
  return {
    plainEnglish,
    title(id) {
      const e = entryFor(id)
      if (!e) return String(id)
      return plainEnglish ? e.title : e.term || e.title
    },
    unitWord(unit) {
      return plainEnglish ? UNIT_WORDS[unit] || unit : unit
    },
    barLabel(driverId, option) {
      const e = EXPLAIN[`driver.${driverId}`]
      if (!e) return String(driverId)
      let label = e.title
      if (driverId === "cpuArch" && option && CPU_ARCH[option]) label = CPU_ARCH[option].bar
      return plainEnglish || !e.term ? label : `${label} (${e.term})`
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Context builder: everything the templates reference, derived from one evaluate() result
// ---------------------------------------------------------------------------------------------

function optionLabel(id, value) {
  const c = CONTROLS[id]
  if (!c) return String(value)
  if (id === "cpuArch") return (CPU_ARCH[value] || CPU_ARCH.today).label
  if (c.type === "toggle") return value ? "On" : "Off"
  if (c.type === "range") {
    if (c.format) return c.format(value)
    return `${value}${c.unit ? ` ${c.unit}` : ""}`
  }
  const opt = (c.options || []).find((o) => o.value === value)
  return opt ? opt.label : String(value)
}

const DAY_MS = 86_400_000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const dateLabel = (ms) => {
  const n = typeof ms === "string" ? Date.parse(ms) : Number(ms)
  if (!Number.isFinite(n)) return "not set"
  const dt = new Date(n)
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`
}
const PATH_WORD = { fibre: "The fibre route", fitout: "The campus fit-out", hardware: "Hardware delivery", hinwil: "The Hinwil works", works: "The Hinwil works", expansion: "The 2028 step-up fit-out", parallel: "Parallel running", burnin: "Burn-in" }

/**
 * Facts for the plan-level tiles and timeline flags from a plan.js `evaluatePlan()` result
 * (`{ timeline: { seasons: { 2027, 2028 } }, totals }`). Every field has a value when no plan is given.
 */
function planFacts(plan, x) {
  const seasons = (plan && plan.timeline && plan.timeline.seasons) || {}
  const t27 = seasons[2027] || {}
  const t28 = seasons[2028] || {}
  const totals = (plan && plan.totals) || {}
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const earlyWeeks = Math.round(num(t28.earlyDays) / 7)
  const contractMs = (plan && plan.timeline && Array.isArray(plan.timeline.milestones) && (plan.timeline.milestones.find((m) => m.id === "contract") || {}).date) || (plan && plan.timeline && plan.timeline.inputs && plan.timeline.inputs.contractDate) || null
  const stepUpNote = !t28.changes ? "" : earlyWeeks > 0 ? `, ${earlyWeeks} weeks before graphics processors are allowed` : num(t28.shareOld) > 0 ? `, ${Math.round(num(t28.shareOld) * 100)} % of 2028 on the 2027 estate` : ", on time for 1 January"
  return {
    changes27: Boolean(t27.changes),
    goLiveLabel: t27.goLive ? `Live ${dateLabel(t27.goLive)}` : "No move in 2027",
    shareOld27: t27.goLive ? num(t27.shareOld) : t27.changes ? 1 : 0,
    slipDays27: num(t27.slipDays),
    slipNote: num(t27.slipDays) > 0 ? `, slipped ${num(t27.slipDays)} days` : num(t27.slackDays) > 0 ? `, ${num(t27.slackDays)} days of slack` : "",
    periodLoss27: num(t27.periodLoss),
    seasonLoss27: num(t27.seasonLoss),
    downtimeDays27: num(t27.downtimeDays),
    atpLabel27: (t27.atp && t27.atp.label) || "no period",
    criticalLabel: PATH_WORD[t27.critical] || (t27.critical ? String(t27.critical) : "Nothing on the critical path"),
    totalWeeks27: num(t27.totalWeeks),
    stepUpLabel: t28.changes ? (t28.goLive ? `2028 step-up ${dateLabel(t28.goLive)}` : "2028 step-up date not set") : "No 2028 step-up: 2028 runs the 2027 estate",
    stepUpNote,
    earlyWeeks28: earlyWeeks,
    earlyCostCHF: num(t28.earlyCostCHF),
    shareOld28: num(t28.shareOld),
    periodLoss28: num(t28.periodLoss),
    slipDays28: num(t28.slipDays),
    orderByLabel: t28.orderBy ? dateLabel(t28.orderBy) : "not set",
    cash: num(totals.cash),
    todayCash: num(totals.todayCash),
    cashDelta: num(totals.cashDelta),
    tco3: num(totals.tco3),
    todayTco3: num(totals.todayTco3),
    secTotal: num(totals.sec),
    confidence: x.confidence,
    readyLabel: t27.feasible ? `Ready ${dateLabel(t27.feasible)}` : t27.changes ? "Ready date not set" : "No move in 2027",
    contractLabel: t27.changes && contractMs ? `Signed ${dateLabel(contractMs)}` : "No contract in this plan",
    declarationLabel: t27.declarationDue ? `2027 declaration due by ${dateLabel(t27.declarationDue)}` : "No new declaration in 2027",
    declaration28Label: t28.declarationDue ? `2028 declaration due by ${dateLabel(t28.declarationDue)}` : "No new declaration in 2028",
  }
}

const camel = (id) => String(id).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const isPlanResult = (plan) => Boolean(plan && plan.seasons && plan.inputs && plan.timeline && plan.timeline.seasons && plan.seasons[2027] && plan.seasons[2028])

/**
 * Facts for the Gantt task rows: one line per task kind for the season (`y27-*` for 2027, `y28-*` for 2028),
 * "Not needed in this season" when the plan has no such task.
 */
function taskFacts(plan, season) {
  const out = {}
  for (const id of Object.keys(TASK_ENTRIES)) out[id] = { line: "Not needed in this season" }
  const tasks = (plan && plan.timeline && Array.isArray(plan.timeline.tasks) && plan.timeline.tasks) || []
  const prefix = `y${String(season).slice(2)}-`
  const owner = { team: "the team", dr: "Digital Realty", hpe: "HPE GreenLake", carrier: "the carrier", fia: "the FIA" }
  for (const t of tasks) {
    if (!String(t.id).startsWith(prefix)) continue
    const kind = String(t.id).slice(prefix.length)
    if (out[kind]) out[kind] = { line: `${t.label}: ${dateLabel(t.start)} to ${dateLabel(t.end)}, ${t.weeks} weeks, ${owner[t.owner] || t.owner}` }
  }
  return out
}

/**
 * Facts for the Solutions Architect rows: the live requirement line per season, the service, risk and role lines
 * (plan-level) and the risk counts. Every key exists with a "not in this plan" line when no plan.js result is given.
 */
function saFacts(plan, season) {
  const req = {}
  for (const id of Object.keys(REQ_ENTRIES)) req[camel(id)] = { line: "Not needed in this season" }
  const service = {}
  for (const id of Object.keys(SERVICE_ENTRIES)) service[camel(id)] = { line: "Not needed in this plan" }
  const risk = {}
  for (const id of Object.keys(RISK_ENTRIES)) risk[camel(id)] = { line: "Not raised for this plan" }
  const role = {}
  for (const id of Object.keys(ROLE_ENTRIES)) role[camel(id)] = { line: "No requirement row in this season" }
  const out = { req, service, risk, role, openRisks: 0, triggeredRisks: 0 }
  if (!isPlanResult(plan)) return out
  const rows = requirements(plan, season)
  for (const q of rows) if (req[camel(q.id)]) req[camel(q.id)] = { line: q.detail ? `${q.value} — ${q.detail}` : String(q.value) }
  for (const r of ROLES) {
    const mine = rows.filter((q) => q.owner === r.id)
    if (role[camel(r.id)] && mine.length) role[camel(r.id)] = { line: `Owns ${mine.length} requirement row${mine.length === 1 ? "" : "s"} in ${season}: ${mine.map((q) => q.label).join(", ")}` }
  }
  for (const sv of serviceMap(plan)) if (service[camel(sv.id)]) service[camel(sv.id)] = { line: `${sv.need} → ${sv.service}` }
  const risks = riskRegister(plan)
  for (const k of risks) if (risk[camel(k.id)]) risk[camel(k.id)] = { line: `${k.likelihood} likelihood, ${k.impact} impact, ${k.status}${k.season ? ` (${k.season})` : ""}: ${k.mitigation}` }
  out.openRisks = risks.filter((k) => k.status !== "mitigated").length
  out.triggeredRisks = risks.filter((k) => k.status === "triggered").length
  return out
}

/**
 * Build the template context from an `evaluate()` result (`result`), the attribution for the same inputs (optional),
 * both seasons' results (`both`, optional, for the season strip), a plan.js result (`plan`, optional, for the
 * plan-level tiles and timeline flags) and the `fmt` helpers from dom.js.
 */
export function explainContext({ result, attribution = null, both = null, plan = null, fmt = null, plainEnglish = true } = {}) {
  if (!result) throw new Error("explainContext needs an evaluate() result")
  const s = result.scenario
  const t = result.today
  const p = result.perf
  const x = s.inputs
  const conf = (x.confidence ?? DEFAULTS.confidence) / 100
  const season = x.season

  const option = {}
  for (const id of Object.keys(CONTROLS)) option[id] = optionLabel(id, x[id])

  const lineIds = ["it", "support", "software", "power", "fee", "cross", "fibre", "trackside", "edge", "cloud", "plant"]
  const lines = Object.fromEntries(lineIds.map((id) => [id, { id, label: "—", chf: 0, cap: 0 }]))
  for (const l of s.money.lines) lines[l.id] = { id: l.id, label: l.label, chf: l.chf, cap: l.cap }
  if (lines.it.label === "—") lines.it.label = x.consumption === "buy" ? `Cluster depreciation (${x.refreshYears} yr)` : `HPE GreenLake charge (${x.termYears} yr)`

  const siteKey = s.fac.clusterSite
  const sitePowerKW = siteKey === "hinwil" ? s.fac.hinwilIT : s.fac.drIT
  const siteCapKW = siteKey === "hinwil" ? s.fac.hinwilCapacity : s.fac.drCapacity
  const arch = CPU_ARCH[x.cpuArch] ? x.cpuArch : K.compute.cpuArchToday
  const archTable = K.compute.cpuArch[arch]
  const archFactor = s.comp.eff.arch ?? archTable.workPerAuh[season] ?? 1
  const archPowerDelta = (archTable.kwFactor[season] ?? 1) - 1
  const mlKW = x.mlPartitionKW
  const mlPlacement = ML_PLACEMENT[x.mlPlacement] ? x.mlPlacement : "dr"
  const envelope = s.envelope
  const drIT = envelope.drIT
  const offerKW = envelope.offerKW ?? ENVELOPE_KW
  const headroomKW = envelope.headroomKW ?? (drIT > 0 ? offerKW - drIT : offerKW)

  const d = {
    option,
    lines,
    lineCount: s.money.lines.length,
    oneOffCount: s.money.oneOffs.length,
    siteName: SITE_WORD[siteKey],
    todaySiteName: SITE_WORD[t.fac.clusterSite],
    sitePowerKW,
    siteCapKW,
    todayShortKW: t.fac.powerShortKW,
    powerFit: s.fac.powerShortKW > 0 ? `short by ${Math.round(s.fac.powerShortKW)} kW` : "within capacity",
    seasonSolver: season >= K.fia.gpuAllowedFrom ? "graphics processors may run the solver" : "processor-only solver",
    confidenceFactor: conf,
    aeroSec: p.aeroSec * conf,
    reinvestSec: p.reinvestSec * conf,
    costCap: costCapCHF.fia,
    costPerEffectiveMauh: s.money.costPerEffectiveMauh ?? 0,
    pueModeLabel: x.pueMode === "override" ? "Override" : "Derived",
    pueSource: x.pueMode === "override" ? "your own figure" : `derived from ${COOLING_WORD[x.cooling].toLowerCase()} at ${SITE_WORD[siteKey]}`,
    coolingLabel: COOLING_WORD[x.cooling],
    renewableNote: x.renewable ? `Renewable contract: market-based CO₂ ${Math.round(s.money.co2MarketT)} t a year` : `Grid mix: ${Math.round(s.money.co2MarketT)} t CO₂ a year`,
    edgeNote: x.edge ? "Edge on: 1.5 s less from data to decision" : "No edge compute in the garage",
    edgeSuffix: x.edge ? " with edge compute" : "",
    cloudNote: x.cloudOnRamp ? `On: ${fmt && fmt.chf ? fmt.chf(lines.cloud.chf) : `CHF ${lines.cloud.chf}`} a year inside the cap` : "Off: no private cloud connections",
    expansionNote: "The 500 kW offer has no expansion right; ZUR4 adds 15 MW on the campus in 2028 (a separate conversation)",
    retrofitNote: x.hinwilRetrofit ? `retrofit to ${K.prices.hinwilRetrofitKW} kW, one-off CHF ${(K.prices.hinwilRetrofitCHF / 1e6).toFixed(1)} M outside the cap` : "no retrofit, the room stays as it is",
    ml: {
      kW: mlKW,
      placement: mlPlacement,
      placementLabel: ML_PLACEMENT[mlPlacement],
      note: mlPlacement === "cloud" ? `${mlKW} kW rented by the hour inside the cap, no campus power` : `${mlKW} kW drawn from ${ML_PLACEMENT[mlPlacement]}`,
    },
    envelope: { drIT, headroomKW, offerKW, share: envelope.share ?? (offerKW > 0 ? drIT / offerKW : 0), fits: envelope.fits, reasons: envelope.reasons, racks: envelope.racks?.total ?? 0, cageRackPositions: envelope.cageRackPositions ?? K.facility.cageRackPositions },
    envelopeNote: envelope.fits ? `fits: ${Math.round(drIT)} of ${offerKW} kW` : `not possible: ${(envelope.reasons || []).join("; ")}`,
    leadLabel: CONTROLS.leadWeeks.format(x.leadWeeks),
    migrationLabel: x.migrationTiming === "midperiod" ? "mid-period" : "at a period boundary",
    archLabel: CPU_ARCH[arch].label,
    archFactor,
    archPowerDelta,
    gpuLabel: option.gpuModel,
    gpuKW: s.hw.gpu.kW,
    tracksideLabel: option.trackside,
    fibreLabel: x.location === "hinwil" ? "no campus fibre" : `${option.fibrePairs.toLowerCase()} at ${option.fibreGbps}`,
    consumptionLabel: x.consumption === "buy" ? "Bought and depreciated" : `HPE GreenLake, ${x.committedPct} % reserved over ${x.termYears} years`,
    redundancyLabel: option.redundancy,
    supportLabel: option.support,
    venueName: s.net.venue.name,
    decisionDelta: s.net.venue.decisionSec - t.net.venue.decisionSec,
    sec2027: both && both[2027] ? both[2027].perf.sec : season === 2027 ? p.sec : undefined,
    sec2028: both && both[2028] ? both[2028].perf.sec : season === 2028 ? p.sec : undefined,
    plan: planFacts(plan, x),
    // the drill-down tiles
    gpuSolverNote: s.fia.gpuSolverAllowed ? `Allowed: ${s.comp.gpuSolverN} solver graphics processor${s.comp.gpuSolverN === 1 ? "" : "s"} declared` : "Not allowed: processor-only solver until 1 January 2028",
    clusterLine: `${x.nodes} server${x.nodes === 1 ? "" : "s"}, ${intWord(s.hw.cores)} cores at ${x.clockGHz.toFixed(1)} GHz declared${x.gpus ? `, ${x.gpus} graphics processor${x.gpus === 1 ? "" : "s"} (${s.comp.gpuSolverN} on the solver)` : ""}, ${s.hw.racks} rack${s.hw.racks === 1 ? "" : "s"}`,
    itChargeNote: x.consumption === "buy" ? ` (${fmt && fmt.chf ? fmt.chf(s.hw.hardwareCHF) : `CHF ${intWord(s.hw.hardwareCHF)}`} over ${x.refreshYears} years)` : ` with ${s.hw.bufferNodes} buffer server${s.hw.bufferNodes === 1 ? "" : "s"}`,
    locationNote: x.location === "hybrid" ? "the solver estate moves, Mission Control stays in Hinwil" : x.location === "dr" ? "the whole estate on the campus" : "everything in the existing room",
    racksWord: `${s.hw.racks} rack${s.hw.racks === 1 ? "" : "s"}`,
    coolingLower: COOLING_WORD[x.cooling].toLowerCase(),
    renewableSuffix: x.renewable ? ", renewable contract" : ", grid mix",
    cageBreakdown: `${s.fac.racks.estate} estate rack${s.fac.racks.estate === 1 ? "" : "s"} at ${K.facility.estateRackKW} kW, ${s.fac.racks.cluster} cluster rack${s.fac.racks.cluster === 1 ? "" : "s"}${s.fac.racks.ml ? `, ${s.fac.racks.ml} machine-learning rack${s.fac.racks.ml === 1 ? "" : "s"}` : ""}`,
    fibreLine: x.location === "hinwil" ? "No campus fibre: the estate stays in the room" : `${x.fibrePairs === 2 ? "Two diverse routes" : "One route"} at ${x.fibreGbps}G: ${(K.trackside.fibreAvailability[x.fibrePairs] * 100).toFixed(3)} % available, ${fmt && fmt.chf ? fmt.chf(lines.fibre.chf) : `CHF ${intWord(lines.fibre.chf)}`} a year`,
    outsideShare: s.money.yearly > 0 ? s.money.excludedYearly / s.money.yearly : 0,
    campusLoadNote: x.location === "hinwil" ? ": the estate stays in Hinwil" : `: ${s.hw.racks} rack${s.hw.racks === 1 ? "" : "s"}, ${COOLING_WORD[x.cooling].toLowerCase()}, ${option.redundancy}`,
    hinwilLine: `${Math.round(s.fac.hinwilIT)} kW of servers in a ${s.fac.hinwilCapacity} kW room${s.fac.powerShortKW > 0 ? `: short by ${Math.round(s.fac.powerShortKW)} kW` : ""}`,
    task: taskFacts(plan, season),
    sa: saFacts(plan, season),
  }

  const a = {}
  if (attribution && Array.isArray(attribution.drivers)) {
    for (const row of attribution.drivers) a[row.id] = row
    a.total = attribution.total
    a.baseline = attribution.baseline
    a.method = attribution.method
    const active = attribution.drivers.filter((r) => !r.pruned)
    a.n = active.length
    a.top = active.reduce((best, r) => (!best || Math.abs(r.sec) > Math.abs(best.sec) ? r : best), null) || { label: "nothing", sec: 0, share: 0 }
  }
  d.clockNote = clockNote(x, s, t, a.clock)
  d.connectivityNote = connectivityNote(a.connectivity, fmt)

  return { x, s, t, p, a, d, K, fmt: fmt || {}, labelsFor: labels(plainEnglish) }
}

const intWord = (n) => Math.round(n).toLocaleString("en-US")
const pctWord = (v) => `${Math.round(Math.abs(v) * 100)} %`

/**
 * Why the "lower declared clock" bar has the sign it has, in plain words: the model's CPU work scales with
 * cores × clock^0.6 (J-d) while the charge scales with cores × clock, so a cheaper charge per unit still loses
 * when the cluster has fewer core-hours than Today's, or idles when it has more than the allowance can keep busy.
 */
function clockNote(x, s, t, row) {
  const planCores = x.nodes * x.coresPerNode
  const todayCores = t.inputs.nodes * t.inputs.coresPerNode
  const exp = K.compute.clockWorkExponent
  const ratio = todayCores > 0 && t.inputs.clockGHz > 0 ? (planCores * x.clockGHz ** exp) / (todayCores * t.inputs.clockGHz ** exp) : 1
  const negative = Boolean(row && row.sec < 0)
  const cores = planCores === todayCores ? `the same ${intWord(planCores)} cores` : `${intWord(planCores)} cores instead of Today's ${intWord(todayCores)}`
  if (planCores === 0) return `but with no processor servers left the processor cluster does no work at all${negative ? ", which is why this bar is negative" : ""}`
  if (s.comp.usage > 1) return `but with ${cores} the cluster is bigger than the allowance can keep busy (${pctWord(s.comp.idleShare)} of it idles)${negative ? ", and idle servers still cost power and money, which is why this bar is negative" : ""}`
  if (ratio < 0.995) return `but with ${cores} the cluster on its own gets through about ${pctWord(1 - ratio)} less work than Today's${negative ? ", which is why this bar is negative" : ""}`
  const work = ratio > 1.005 ? `about ${pctWord(ratio - 1)} more work than Today's` : "about the same work as Today's"
  const servers = x.nodes + Math.ceil((x.gpus || 0) / 8)
  const todayServers = t.inputs.nodes + Math.ceil((t.inputs.gpus || 0) / 8)
  return `and with ${cores} the cluster on its own gets through ${work}${negative ? `; what makes this bar negative is the cost of running ${servers} servers instead of ${todayServers}: power, money and more parts to fail` : ""}`
}

/** Why the connectivity bar has the sign it has: the lap-time chart only sees what the links cost or save inside the cap. */
function connectivityNote(row, fmt) {
  const chf = row ? row.savedCHF || 0 : 0
  const sec = row ? row.sec || 0 : 0
  const money = (v) => (fmt && typeof fmt.chf === "function" ? fmt.chf(Math.abs(v)) : `CHF ${intWord(Math.abs(v))}`)
  const lap = fmt && typeof fmt.sec === "function" ? fmt.sec(sec) : `${sec >= 0 ? "+" : ""}${sec.toFixed(2)} s`
  if (chf < -500) return `The links cost ${money(chf)} a year more inside the cost cap, money the car's development cannot spend${sec < 0 ? ", which is why this bar is negative" : ""}: ${lap} per lap. The pay-back is faster decisions and race weekends kept online, which this chart does not count.`
  if (chf > 500) return `The links save ${money(chf)} a year inside the cost cap, money the car's development can spend: ${lap} per lap.`
  return `The links cost nothing extra inside the cost cap: ${lap} per lap${sec < 0 ? ", from a fibre link that is down more often" : ""}.`
}
