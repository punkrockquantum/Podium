/**
 * The four briefs the teams read before they decide. Written for a sales audience: plain English,
 * round numbers, and everything a careful reader needs to work out an in-zone answer without trial
 * and error. Every figure is the game's own (see catalog.js); the host's budget level moves the cap
 * lines, which the view notes under the rules.
 *
 * Shape per table: situation → what the team wants → the rules → the three decisions (one line per
 * setting) → how a provider helps → words to know. Pure data; briefview.js renders it.
 */

/** The gate opens when the team reaches the end of the brief, or after this many seconds. */
export const BRIEF_GATE_SECONDS = 30

const d = (name, what, settings, balance) => ({ name, what, settings, balance })
const w = (term, gloss) => ({ term, gloss })

export const BRIEFS = {
  network: {
    title: "Connectivity brief",
    situation: [
      "Every lap, the car streams data to the garage, and the garage sends it on to the strategists at the factory. They decide when to pit and which tyres to fit. The link from the track to the factory is the pit wall's lifeline.",
    ],
    wants: [
      "Data at the factory in 120 ms or less (round trip).",
      "The link up 99.9% of the race weekend or better.",
      "Every choice legal under the FIA rules.",
    ],
    rules: [
      "The FIA wants two encrypted tunnels on separate paths between track and factory [FIA 5.3]. One tunnel is a breach.",
      "Car data must leave the garage on the wired umbilical, never over Wi-Fi [FIA 5.2].",
      "This table's caps: $600k of CapEx and $700k of yearly OpEx. Over either cap, the FIA rejects the budget and the board counts for nothing.",
    ],
    decisions: [
      d("Paths to the factory", "How many routes carry the tunnel from the track to the factory.", [
        "Single tunnel: $50k CapEx, $100k a year, up 99.0% of the time, and a breach of FIA 5.3.",
        "Two diverse paths: $150k CapEx, $220k a year, up 99.9% of the time.",
        "Two paths + satellite: $300k CapEx, $380k a year, up 99.99% of the time.",
      ], "More paths mean fewer dropped calls, but each path costs money every year."),
      d("Route to the data centre", "What the tunnels ride on between the factory and the data centre. This sets most of the latency.", [
        "Public internet: free to build, $30k a year, about 180 ms.",
        "Private cross-connect: $100k CapEx, $250k a year, about 95 ms.",
        "Dark fibre: $400k CapEx, $450k a year, about 70 ms.",
      ], "The faster the route, the more it costs. Add the garage figure below to get your total latency."),
      d("Car data out of the garage", "How the car's data leaves the garage on its way to the factory.", [
        "Garage Wi-Fi: free and fast, but banned [FIA 5.2].",
        "Wired umbilical: no CapEx, $50k a year, adds about 15 ms.",
        "Umbilical + edge cache: $250k CapEx, $100k a year, saves about 20 ms.",
      ], "The legal options are the umbilical with or without a cache; the cache buys speed for money."),
    ],
    provider: [
      "Carriers and connectivity partners sell two diverse fibre routes and satellite backup as one managed service, so the customer does not build or monitor the links.",
      "A carrier-neutral data centre offers a private cross-connect: steady low latency without laying fibre.",
    ],
    words: [
      w("Latency", "The time a message takes to go there and back, in milliseconds (ms). Lower is better."),
      w("Availability", "The share of time the link is working. 99.9% means about nine minutes down over a race weekend."),
      w("Encrypted tunnel", "A protected connection over a network, so nobody else can read the data."),
      w("Cross-connect", "A private cable inside a data centre between the customer and the network, bypassing the public internet."),
      w("Dark fibre", "A fibre line leased for the customer's exclusive use."),
      w("Edge cache", "A small store of data in the garage that keeps telemetry flowing if the link blips."),
      w("CapEx", "Money spent once, up front, on equipment. OpEx is what is paid every year to run things."),
    ],
  },

  oem: {
    title: "OEMs brief",
    situation: [
      "The factory's servers are a generation old. The team wants a refresh this season, but the FIA's cost cap limits what it can spend, and the first race is only a few months away.",
    ],
    wants: [
      "At least twice (2.0×) today's performance.",
      "A failed node fixed within 4 hours on a race weekend.",
      "Hardware delivered in 12 weeks or less, before the first race.",
    ],
    rules: [
      "Everything bought outright counts against the CapEx envelope; anything paid monthly or yearly counts as OpEx under the $215M cost cap.",
      "This table's caps: $3.4M of CapEx and $1.9M of yearly OpEx. Over either cap, the FIA rejects the budget and the board counts for nothing.",
    ],
    decisions: [
      d("Hardware", "Which systems the team buys. The price is the sticker price before you choose how to pay.", [
        "Incumbent, last generation: $2.4M, 1.4× today's performance, delivered in 4 weeks.",
        "Dell, HPE or Lenovo: $4.0M, 2.2× performance, 10 weeks (4 weeks as-a-service, because the OEM holds stock).",
        "NVIDIA DGX, newest: $6.5M, 3.2× performance, 18 weeks.",
      ], "Newer kit runs more simulations per dollar, but only if it arrives before the first race."),
      d("How you pay", "Whether the price lands on CapEx now or on OpEx every year.", [
        "Buy outright: the whole price this year, from CapEx.",
        "Lease: no CapEx; about 32% of the price every year as OpEx, over three years.",
        "As-a-service: no CapEx; about 35% of the price every year, and the OEM bundles support. Dell, HPE and Lenovo offer it.",
      ], "Buying spends the envelope in one go; leasing and as-a-service move the cost into the yearly cap."),
      d("Race-weekend support", "How fast the OEM fixes a failed node. Priced as a share of the hardware price each year.", [
        "Basic: parts by post, fixed in about 72 hours; adds 2% a year.",
        "Next business day: fixed in 24 hours, so Monday after a Sunday race; adds 4% a year.",
        "4-hour, 24/7: an engineer and parts on site within 4 hours; adds 6% a year (2% under as-a-service).",
      ], "A Saturday failure must be fixed before Sunday's race, and faster cover costs more every year."),
    ],
    provider: [
      "OEMs offer leasing and as-a-service so the customer refreshes now and pays monthly, inside the cost cap, with support included.",
      "Their financing arms hold the stock, which is why as-a-service hardware arrives in weeks rather than months.",
    ],
    words: [
      w("OEM", "The maker of the servers: Dell, HPE, Lenovo, Supermicro or NVIDIA."),
      w("CapEx envelope", "The FIA's four-year limit on money spent up front on equipment."),
      w("OpEx", "What is paid every year to run things, counted under the $215M cost cap."),
      w("Lease", "Paying for hardware yearly over a fixed term instead of buying it."),
      w("As-a-service", "Hardware supplied, supported and paid for monthly, like a subscription."),
      w("Lead time", "The weeks between ordering hardware and having it on site."),
      w("Node", "One server in the cluster."),
    ],
  },

  dc: {
    title: "Datacenter & Power brief",
    situation: [
      "The team's 400 kW simulation cluster has to live somewhere with enough power and cooling. Hot chips on weak cooling slow down, and a single power failure in a race week would stop the strategists cold.",
    ],
    wants: [
      "Power and cooling for 100% of the cluster's need.",
      "A PUE of 1.30 or less, so power goes to chips, not fans.",
      "N+1 backup on power and cooling.",
    ],
    rules: [
      "Race-critical infrastructure needs N+1 power and cooling [FIA 4.1]. A site without it is a breach.",
      "This table's caps: $1.0M of CapEx and $1.0M of yearly OpEx, plus the site's own power supply. Over any of them, the FIA rejects the budget and the board counts for nothing.",
      "Your yearly power bill is roughly: cluster kW × PUE × the site's price per kW.",
    ],
    decisions: [
      d("Where it lives", "The site that houses the cluster. It sets the power price, the supply and the backup.", [
        "Factory server room: $300k to fit out, $1,500 per kW a year, a 300 kW supply, PUE +0.10, no backup [FIA 4.1].",
        "Colo near the factory: no CapEx, $1,900 per kW a year, a 1,500 kW supply, N+1 included.",
        "Cheap-power region: no CapEx, $900 per kW a year, a 2,000 kW supply, PUE −0.05, no backup [FIA 4.1].",
      ], "Cheap power looks tempting, but only the colo has the backup the FIA requires."),
      d("Cooling", "How the heat leaves the racks. Each option cools a fixed amount and sets the PUE.", [
        "Air: no CapEx, cools 280 kW, PUE 1.50.",
        "Rear-door water: $400k, cools 450 kW, PUE 1.30.",
        "Direct-to-chip liquid: $750k, cools 800 kW, PUE 1.12.",
      ], "Better cooling costs more up front but cuts every year's power bill through a lower PUE."),
      d("Power setting", "How hard the chips run. It changes the kW the site must power and cool.", [
        "Capped at 85%: the cluster needs 340 kW and runs about 4% slower.",
        "Standard: the cluster needs 400 kW.",
        "Max boost: the cluster needs 440 kW and runs about 5% faster.",
      ], "Running harder needs more cooling and costs more every year; a cap trims the bill."),
    ],
    provider: [
      "A colo with liquid-ready halls gives the customer N+1 power and cooling as a monthly service, instead of a building project.",
      "Providers meter power per rack, so a power cap turns straight into a lower bill.",
    ],
    words: [
      w("kW", "Kilowatts: how much power the cluster draws. 400 kW is about 300 homes."),
      w("PUE", "Power usage effectiveness: total site power divided by chip power. 1.30 means 30% extra goes on cooling and losses."),
      w("N+1", "One spare of everything critical (power feed, chiller), so one failure changes nothing."),
      w("Colo", "A colocation data centre: the customer rents space, power and cooling in someone else's hall."),
      w("Direct-to-chip liquid", "Cold plates with liquid flowing through them, bolted onto each chip."),
      w("CapEx", "Money spent once, up front. OpEx is what is paid every year."),
    ],
  },

  compute: {
    title: "CFD Supercomputer brief",
    situation: [
      "Aero gains come from CFD: simulating airflow over the car thousands of times a season. The FIA caps how much computing each team may use, so the cluster must do the most work inside that cap, with every node kept busy.",
    ],
    wants: [
      "At least 10 design cycles a week.",
      "Compute at 100% of the FIA cap or less.",
      "Nodes kept fed with data 90% of the time or more.",
    ],
    rules: [
      "The FIA measures every team's CFD compute and caps it [FIA 2.4]. Going over the cap is a breach, however fast the cluster is.",
      "GPUs are billed at their peak FP64 rate whatever precision they run, so they use up the allowance faster [FIA 2.2].",
      "This table's caps: $3.6M of CapEx and $500k of yearly OpEx, and the hall supplies 400 kW. Over any of them, the board counts for nothing.",
    ],
    decisions: [
      d("Cluster size", "How many nodes. Cycles a week, cost, power and the share of the FIA cap all scale with it.", [
        "8 nodes: the size of today's ageing cluster.",
        "16 nodes: sized to the FIA cap.",
        "28 nodes: well past the FIA cap.",
      ], "More nodes mean more design cycles, until the FIA cap stops you."),
      d("Chips", "What is in each node. Figures are per node.", [
        "CPU only: $150k, $15k a year, 10 kW, about 0.75 cycles a week, 5.6% of the FIA cap.",
        "Mixed CPU + GPU: $185k, $22k a year, 13 kW, about 0.8 cycles a week, 5.3% of the cap.",
        "GPU heavy: $300k, $35k a year, 18 kW, 1 cycle a week, 6.5% of the cap.",
      ], "Multiply by the node count: 16 nodes of CPU is 12 cycles and 90% of the cap; 16 GPU nodes is 104%."),
      d("Storage", "What feeds the nodes their data. Nodes waiting for data do no simulating.", [
        "Office NAS: $150k, $20k a year; feeds about 10 CPU nodes or 4 GPU nodes.",
        "Parallel file system: $600k, $60k a year; feeds 30 CPU nodes, 20 mixed or 13 GPU nodes.",
        "Parallel + flash cache: $900k, $90k a year; feeds 40 CPU nodes or 17 GPU nodes.",
      ], "Storage must keep up with the nodes you buy, or expensive nodes sit idle."),
    ],
    provider: [
      "Partners size the cluster to the FIA cap, so no paid-for node sits idle, and benchmark the customer's CFD code to pick the chips that do the most inside it.",
      "A storage partner's parallel file system keeps every node fed at full speed.",
    ],
    words: [
      w("CFD", "Computational fluid dynamics: simulating airflow over the car on computers instead of in a wind tunnel."),
      w("Design cycle", "One round of simulating a design change and reading the result."),
      w("Compute cap", "The FIA's limit on how much computing power a team may use for CFD each period."),
      w("Node", "One server in the cluster."),
      w("GPU", "A graphics processor used for maths-heavy computing; fast, but billed at its peak rate by the FIA."),
      w("FP64", "Double-precision maths: the rate the FIA uses to measure every chip."),
      w("Parallel file system", "Storage spread across many servers so hundreds of nodes can read at once."),
      w("Flash cache", "Fast solid-state storage in front of the main store, for the hottest data."),
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
