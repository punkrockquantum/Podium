/**
 * The four briefs the teams read before they decide: the Audi F1 Team edition. Written for a sales
 * audience in plain English with the figures the game actually uses (catalog.js, which derives them
 * from customer.js). Every public figure carries a [tag] into docs/audi-f1-sources.md: letters and
 * numbers (A3, C1, D2) are VERIFIED public facts; letter-dash rows (B-a, D-d) are planning
 * ASSUMPTIONS with their rationale. The host's budget level moves the cap lines, which the view
 * notes under the rules.
 *
 * Shape per table: situation → what the team wants → the rules → the three decisions (one line per
 * setting) → how a provider helps → words to know. 350–550 words each. Pure data; briefview.js
 * renders it.
 */
import { FIGURES as F, chf, chfFull, kwYearCHF } from "./customer.js"

/** The gate opens when the team reaches the end of the brief, or after this many seconds. */
export const BRIEF_GATE_SECONDS = 30

const d = (name, what, settings, balance) => ({ name, what, settings, balance })
const w = (term, gloss) => ({ term, gloss })
const kw = F.load.it2027KW
const years = F.fia.depreciationYearsIT

export const BRIEFS = {
  network: {
    title: "Connectivity brief",
    situation: [
      `Every lap, the car streams data to the garage, and the garage sends it to Mission Control in Hinwil, where the strategists call the stop [A3, A6]. In 2027 the compute they lean on may sit ${F.sites.hinwil.kmToZurich} km away in the Zurich campus, so the link runs circuit → Zurich campus → Hinwil for all ${F.calendar.races} race weekends [E1].`,
    ],
    wants: [
      "A round trip from the circuit to the campus of 120 ms or less.",
      "The link up 99.9% of the race weekend or better.",
      "Every choice inside Audi F1's operational requirements.",
    ],
    rules: [
      "Audi F1 requirement: race-critical links to Mission Control run on two diverse paths. One route breaks the team's standard, not an FIA rule.",
      "Audi F1 requirement: car data leaves the garage only over the managed wired network. Ad-hoc Wi-Fi is outside the policy.",
      `This table's caps: ${chf(500_000)} of 2027 capital and ${chf(600_000)} a year of cost-cap charge (yearly cost plus capital written off over ${years} years [C3]). Over either cap, the board counts for nothing.`,
    ],
    decisions: [
      d("Paths Hinwil ↔ Zurich campus", `How many dark-fibre routes join Hinwil to the campus: about ${F.sites.campus.fibreKm} km of fibre, ${F.sites.campus.rttMs} ms round trip [B-d].`, [
        `Single route: ${chf(60_000)} capital, ${chf(48_000)} a year, up 99.5% of the time, and a breach of the two-paths requirement.`,
        `Two diverse routes: ${chf(120_000)} capital, ${chf(96_000)} a year (about CHF 4,000 per route a month [B-e]), up 99.95%.`,
        `Two routes + satellite: ${chf(200_000)} capital, ${chf(150_000)} a year, up 99.99%.`,
      ], "More routes mean fewer blind laps, but each route costs money every year."),
      d("Route from the circuit to Zurich", "What the paddock traffic rides on to the campus; it sets most of the latency [B-f].", [
        `Public internet: nothing to build, ${chf(30_000)} a year, about 180 ms with jitter.`,
        `Private circuit into the campus: ${chf(100_000)} capital, ${chf(250_000)} a year, about 100 ms.`,
        `Private WAN + edge PoP: ${chf(300_000)} capital, ${chf(350_000)} a year, about 85 ms.`,
      ], "Faster routes cost more. Add the garage figure below for your total latency."),
      d("Car data out of the garage", "How the car's data leaves the garage.", [
        "Unmanaged garage Wi-Fi: free and 15 ms faster, but outside the policy.",
        `Wired umbilical: no capital, ${chf(40_000)} a year, adds about 15 ms.`,
        `Umbilical + garage edge node: ${chf(200_000)} capital, ${chf(80_000)} a year, saves about 20 ms.`,
      ], "The compliant options are the umbilical with or without an edge node; the node buys speed for money."),
    ],
    provider: [
      "A carrier-neutral campus sells diverse fibre from Hinwil, a private circuit from every paddock and satellite backup as one managed service: the team builds and monitors nothing.",
      `At ${F.sites.campus.rttMs} ms, engineers in Hinwil cannot tell where the cluster is [B-d].`,
    ],
    words: [
      w("Latency", "The time a message takes to go there and back, in milliseconds (ms). Lower is better."),
      w("Availability", "The share of time the link works: 99.9% is about nine minutes down over a race weekend."),
      w("Diverse paths", "Two routes sharing no duct, exchange or cable, so one digger cannot cut both."),
      w("Dark fibre", "A fibre pair leased for the team's exclusive use."),
      w("Edge node", "A small garage server that caches telemetry and keeps engineers working through a link blip."),
      w("Cost-cap charge", "What a year's spending adds to the FIA cost cap: running costs plus a slice of anything bought."),
    ],
  },

  oem: {
    title: "OEMs brief",
    situation: [
      `Hinwil's servers are a generation old and the team is growing fast: around ${F.people.hinwilHeadcount} people in Hinwil today, aiming at ${F.people.targetHeadcount.toLocaleString("en-US")} [A9]. The 2027 refresh must fit under the FIA cost cap of USD 215M, about ${chf(F.fia.costCapCHFIllustrative, 0)} at the FIA's fixed rate [C1, C2], and be in service before the Bahrain test on ${F.fia.preSeasonTest.replace("Bahrain, ", "")} [C7].`,
    ],
    wants: [
      "At least twice (2.0×) today's performance.",
      "A failed node fixed within 4 hours on a race weekend.",
      "Hardware delivered in 12 weeks or less, before the Bahrain test.",
    ],
    rules: [
      `The FIA sets no separate capital limit: bought kit enters the cost cap as straight-line depreciation (FIA D6.1.1.k; here over ${years} years), leases and as-a-service as the yearly charge [C3]. The capital envelope is Audi F1's own cash limit.`,
      `This table's caps: ${chf(3_000_000)} of 2027 capital and ${chf(1_900_000)} a year of cost-cap charge. Over either cap, the board counts for nothing.`,
    ],
    decisions: [
      d("Hardware", "Which systems the team buys. The price is the sticker price before you choose how to pay.", [
        `Incumbent, last generation: ${chf(2_000_000)}, 1.4× today's performance, delivered in 4 weeks.`,
        `Dell, HPE or Lenovo: ${chf(3_400_000)}, 2.2× performance, 10 weeks (4 weeks as-a-service, because the OEM holds stock).`,
        `NVIDIA DGX, newest: ${chf(5_500_000)}, 3.2× performance, 18 weeks.`,
      ], "Newer kit runs more simulations per franc, but only if it arrives before the Bahrain test."),
      d("How you pay", "Whether the price lands on capital now or on the yearly charge.", [
        `Buy outright: the whole price this year from capital; a quarter of it hits the cost cap every year for ${years} years.`,
        "Lease: no capital; about 32% of the price every year over three years.",
        "As-a-service: no capital; about 35% of the price every year, and the OEM bundles support. Dell, HPE and Lenovo offer it.",
      ], "Buying spends the envelope in one go; leasing and as-a-service move the cost into the yearly charge."),
      d("Race-weekend support", "How fast the OEM fixes a failed node. Priced as a share of the hardware price each year.", [
        "Basic: parts by post, fixed in about 72 hours; adds 2% a year.",
        "Next business day: fixed in 24 hours, so Monday after a Sunday race; adds 4% a year.",
        "4-hour, 24/7: an engineer and parts on site within 4 hours; adds 6% a year (2% under as-a-service).",
      ], "A Saturday failure must be fixed before Sunday's race, and faster cover costs more every year."),
    ],
    provider: [
      "OEMs offer leasing and as-a-service so the team refreshes now and pays monthly, inside the cost cap, with support included.",
      "Their financing arms hold the stock, which is why as-a-service hardware arrives in weeks rather than months; a campus with an OEM staging area takes delivery and racks it.",
    ],
    words: [
      w("OEM", "The maker of the servers: Dell, HPE, Lenovo, Supermicro or NVIDIA."),
      w("Cost cap", "The FIA's yearly limit on what a team may spend on performance: USD 215M in 2026–2030 [C1]."),
      w("Depreciation", "Spreading a purchase over its useful life; the FIA counts each year's slice in the cap [C3]."),
      w("Capital envelope", "Audi F1's own limit on cash spent up front this year."),
      w("Lease", "Paying for hardware yearly over a fixed term instead of buying it."),
      w("As-a-service", "Hardware supplied, supported and paid for monthly, like a subscription."),
      w("Lead time", "The weeks between ordering hardware and having it on site."),
    ],
  },

  dc: {
    title: "Datacenter & Power brief",
    situation: [
      `Audi F1's 2027 IT estate needs about ${kw} kW: CFD, simulators, design and Mission Control [B-a]. Today it lives in the Hinwil data room: about ${F.room.capacityKW} kW on one feed at a PUE near ${F.room.pue} [A-a, A-b]. In 2028 the Hinwil load nearly doubles to ${F.load.it2028KW} kW as GPUs join the solver [B-b]. Electricity counts in the cost cap [C3].`,
    ],
    wants: [
      "Power and cooling for 100% of the 2027 IT load.",
      "A PUE of 1.30 or less: power to chips, not fans.",
      "N+1 or 2N on power and cooling.",
    ],
    rules: [
      "Audi F1 requirement: race-critical infrastructure runs on N+1 or 2N power and cooling. A single feed breaks the team's standard.",
      "FIA F4.4.3: a moved CFD cluster is re-declared within a month [C4].",
      `This table's caps: ${chf(1_900_000)} of 2027 capital and ${chf(2_100_000)} a year of cost-cap charge (fees, power, plant written off over ${F.fia.depreciationYearsPlant} years), plus the site's power supply. Over any of them, the board counts for nothing.`,
      `Yearly power bill ≈ IT kW × PUE × price per kW a year: about ${Math.round(F.tariffs.hinwilCHFPerKWh * 100)} Rp per kWh on EKZ in Hinwil, ${Math.round(F.tariffs.campusCHFPerKWh * 100)} Rp on ewz at the campus [D2, D3, D-a, D-b].`,
    ],
    decisions: [
      d("Where the 2027 cluster lives", "The site sets the power price, supply, backup and 2028 headroom.", [
        `Hinwil data room (today): ${chf(300_000)} to patch up, no fee, power ${chfFull(kwYearCHF(F.tariffs.hinwilCHFPerKWh))} per kW a year, a ${F.room.capacityKW} kW supply, PUE +0.15, single feed.`,
        `Zurich campus, ${F.offer.committedKW} kW: ${chf(F.offer.fitOutCHF + F.offer.migrationCHF)} fit-out and migration, ${chfFull(F.offer.feeCHFPerKWMonth)} per kW a month, power ${chfFull(kwYearCHF(F.tariffs.campusCHFPerKWh))} per kW a year, 2N power, N+1 cooling, a hard 500 kW envelope, no expansion right [D-d].`,
        `Remote low-cost region: ${chf(900_000)} to fit out, ${chfFull(110)} per kW a month, power ${chfFull(kwYearCHF(F.tariffs.remoteCHFPerKWh))} per kW a year, a 2,000 kW supply, PUE −0.05, single feed, 900 km away.`,
      ], "Cheap power tempts, but only the campus has the backup Audi F1 requires and 2028 headroom."),
      d("Cooling", "How the heat leaves the racks: each option cools a fixed amount and sets the PUE.", [
        "Air: free, cools 300 kW, PUE 1.45.",
        `Rear-door water: ${chf(F.offer.rearDoorCHF)}, cools 420 kW, PUE 1.28.`,
        `Direct-to-chip liquid: ${chf(F.offer.liquidLoopCHF)}, cools all ${F.offer.committedKW} kW on offer (plant sized well beyond it), PUE 1.12, 2028 GPU-ready [D9].`,
      ], "Better cooling costs more up front but cuts the yearly power bill."),
      d("Power setting", "How hard the chips run: it changes the kW to power and cool.", [
        `Capped at 85%: ${Math.round(kw * 0.85)} kW, about 4% slower.`,
        `Standard: ${kw} kW.`,
        `Max boost: ${Math.round(kw * 1.1)} kW, about 5% faster.`,
      ], "Running harder needs more cooling and costs more every year."),
    ],
    provider: [
      `A ${F.offer.committedKW} kW commitment in the Zurich campus buys 2N power, N+1 cooling and liquid-ready rows for a monthly fee instead of a ${chf(F.room.upgradeCapexCHF, 0)} Hinwil building project [A-e], with the 2028 GPU step-up inside it and waste heat to district heating [D5].`,
      "Power is metered per rack at the ewz tariff: a power cap is a lower bill and cost-cap charge.",
    ],
    words: [
      w("kW", `Kilowatts: ${kw} kW is about 300 homes.`),
      w("PUE", "Site power divided by IT power: 1.30 means 30% extra on cooling and losses."),
      w("N+1 and 2N", "One spare of everything critical; two complete, independent systems."),
      w("Colocation", "Renting space, power and cooling for your own servers."),
      w("Direct-to-chip liquid", "Cold plates on every chip."),
      w("Rp", "Rappen: 16 Rp is CHF 0.16."),
    ],
  },

  compute: {
    title: "CFD Supercomputer brief",
    situation: [
      `Aero gains come from CFD: simulating airflow over the car thousands of times a season. The FIA limits each team's CFD compute in Aero Units per eight-week period [C4]. Audi F1 sits P${F.fia.atrPosition} in 2026 [A12], so the first periods of 2027 allow ${F.fia.atrPercent}% of the baseline: ${F.fia.mauhAllowance} MAUh instead of ${F.fia.mauhBaseline} [C5]. The cluster must do the most work inside that allowance, every node kept busy.`,
    ],
    wants: [
      "At least 10 design cycles a week.",
      `Compute at 100% of the ${F.fia.mauhAllowance} MAUh allowance or less.`,
      "Nodes fed with data 90% of the time.",
    ],
    rules: [
      `FIA F4.6.1: the solver may use ${F.fia.mauhAllowance} MAUh per period. Going over cuts the next period's limits (F4.6.10) [C4, C5].`,
      "FIA F4.4.1: in 2027 the solver runs only on declared CPU cores, counted at their peak clock. GPU cores join on 1 January 2028 [C4, C6].",
      `This table's caps: ${chf(2_400_000)} of 2027 capital, ${chf(600_000)} a year of cost-cap charge, and ${F.room.cfdAllocationKW} kW allocated to CFD. Over any of them, the board counts for nothing.`,
    ],
    decisions: [
      d("Declared cluster size", "How many nodes: cycles, cost, power and allowance share all scale with it.", [
        "8 nodes: the size of today's ageing cluster.",
        `12 nodes: sized to the ${F.fia.mauhAllowance} MAUh allowance [B-c].`,
        "20 nodes: well past the allowance.",
      ], "More nodes mean more design cycles, until the allowance stops you."),
      d("Chips", `What is in each node; figures are per node. One ${F.cluster.coresPerNode}-core node at ${F.cluster.ccfGHz} GHz uses about 8.2% of the allowance [B-c].`, [
        `CPU-only solver: ${chf(65_000)}, ${chf(4_500)} a year, 1.2 kW, 0.9 cycles a week, 8.2% of the allowance.`,
        `CPU solver + GPU partition: ${chf(140_000)}, ${chf(9_000)} a year, 3 kW, 1 cycle a week, 8.2%; the GPUs only pre- and post-process.`,
        `GPU solver: ${chf(300_000)}, ${chf(24_000)} a year, 12 kW, 1.3 cycles a week, 12.3%, and not allowed before 2028.`,
      ], "Multiply by the node count: 12 CPU nodes is 10.8 cycles and 99% of the allowance; 20 is 165%."),
      d("Storage", "What feeds the nodes; nodes waiting for data do no simulating.", [
        `Office NAS: ${chf(120_000)}, ${chf(15_000)} a year; feeds about 10 CPU nodes or 4 GPU nodes.`,
        `Parallel file system: ${chf(450_000)}, ${chf(45_000)} a year; feeds 30 CPU nodes, 20 mixed or 13 GPU nodes.`,
        `Parallel + flash cache: ${chf(700_000)}, ${chf(70_000)} a year; feeds 40 CPU nodes or 17 GPU nodes.`,
      ], "Storage must keep up with the nodes you buy, or expensive nodes sit idle."),
    ],
    provider: [
      "Partners size the cluster to the MAUh allowance, so no paid-for node sits idle, and benchmark the team's CFD code to pick the chips that do most inside it.",
      "Liquid-ready rows in the campus take the 2028 GPU partition without another move or re-declaration [C6].",
    ],
    words: [
      w("CFD", "Computational fluid dynamics: simulating airflow over the car on computers, not in a wind tunnel."),
      w("Design cycle", "One round of simulating a design change and reading the result."),
      w("MAUh", "Aero Units: cores × seconds × peak GHz ÷ 3600; a MAUh is a million [C4]."),
      w("Sliding scale", "The better a team's position, the less CFD it may run: 70% for P1, 105% for P8 [C5]."),
      w("Node", "One server in the cluster."),
      w("GPU", "A graphics processor: fast, barred from the solver until 2028 [C6]."),
      w("Parallel file system", "Storage spread across many servers so every node can read at once."),
    ],
  },
}

export const briefFor = (stationId) => BRIEFS[stationId] || null

/** Every sentence of a brief, in reading order (for word counts and tests). */
export function briefText(stationId) {
  const b = briefFor(stationId)
  if (!b) return ""
  const parts = [b.title, ...b.situation, ...b.wants, ...b.rules]
  for (const dec of b.decisions) parts.push(dec.name, dec.what, ...dec.settings, dec.balance)
  parts.push(...b.provider, ...b.words.map((x) => `${x.term}: ${x.gloss}`))
  return parts.join(" ")
}

export const briefWordCount = (stationId) => briefText(stationId).split(/\s+/).filter(Boolean).length
