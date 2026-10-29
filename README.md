# Podium 2027

A live team game about building a Formula 1 team's IT infrastructure under the FIA's 2027 cost and
technical rules. Teams move between six tables, make design decisions on iPads, pitch each design to
a table leader in 30 seconds, and then watch their approved designs race the Austin, Texas 2027
Grand Prix on a projector.

This README is the complete reference: how to run an event, how the game works, what every table
asks, how scoring and the race work, and how the code is built. It is written for event hosts first
and developers second. You do not need to be a developer to run Podium.

Prices, lead times and speeds in the game are **teaching estimates**, not quotes.

## Contents

1. [What Podium 2027 is](#1-what-podium-2027-is)
2. [The FIA 2027 rules the game uses](#2-the-fia-2027-rules-the-game-uses)
3. [The game format](#3-the-game-format)
4. [Roles, screens, addresses and PINs](#4-roles-screens-addresses-and-pins)
5. [How to play](#5-how-to-play)
6. [The six tables in detail](#6-the-six-tables-in-detail)
7. [OEMs and commercial models](#7-oems-and-commercial-models)
8. [Scoring](#8-scoring)
9. [Architect mode and the Token Efficiency Calculator](#9-architect-mode-and-the-token-efficiency-calculator)
10. [The race](#10-the-race)
11. [Install and run locally](#11-install-and-run-locally)
12. [Running a live event on Wi-Fi](#12-running-a-live-event-on-wi-fi)
13. [Keeping it running: the background service](#13-keeping-it-running-the-background-service)
14. [Sharing it publicly for testing](#14-sharing-it-publicly-for-testing)
15. [Troubleshooting](#15-troubleshooting)
16. [Architecture and API](#16-architecture-and-api)
17. [Tests](#17-tests)
18. [Licence and credits](#18-licence-and-credits)

---

## 1. What Podium 2027 is

Podium 2027 is a 60-minute auditorium game. Each team is an F1 team's infrastructure department.
It has to design the CFD supercomputer, the AI that runs race strategy, the data centre, the
storage, the connectivity between circuit, data centre and factory, and the governance that keeps
it all legal.

**Who it is for.** Sales and technical sellers who work with data-centre operators, equipment
makers (OEMs) and their customers. The game puts them in the customer's chair.

**What players learn.**

- **Data centres.** Rent is per kilowatt per month, whether you use it or not. Cooling type sets how
  much power a rack can draw. Redundancy and contract length trade rent against risk.
- **OEMs.** The same GPUs cost different amounts from different makers, arrive at different times and
  come with different support and as-a-service programmes.
- **Customers and cost caps.** A cost cap splits money into CapEx (buying equipment, limited by a
  four-year envelope) and OpEx (running it, limited by the annual cap). How you pay matters as much
  as what you buy.
- **Trade-offs.** No option is free. Faster usually costs power, cheaper usually costs risk, and
  some of the most attractive options are illegal.
- **Pitching.** Every design has to be defended to a leader in 30 seconds and approved before it
  counts.

---

## 2. The FIA 2027 rules the game uses

The game is built on a fictional "FIA 2027 Infrastructure Specification" modelled on the real
Financial and Technical Regulations. Each rule below shows up in play as a constraint on the brief,
an option tag ("FIA rule 5.2") or a penalty.

| Rule | What it says in the game | How it shows up |
| --- | --- | --- |
| Cost cap (FIA 1.1) | $215M a year of OpEx, adjusted for the calendar (24 races and 6 sprints by default). Cloud, SaaS, colocation, power and licences are OpEx. | The infrastructure department gets a $4.4M OpEx allowance with $0.8M headroom. Going over the allowance takes aero gain away; going further is a minor (−10 points) or major (−25 points) breach plus a 10% ATR cut. |
| CapEx envelope (FIA 1.2) | A rolling four-year CapEx envelope by tier: Tier 1 (P1–P4) $45M, Tier 2 (P5–P7) $55M, Tier 3 (P8–P10) $65M. Earlier spending (wind tunnel, dynos, simulator) is already committed. | What is left for 2027 is $6M (Tier 1), $8M (Tier 2) or $10M (Tier 3). Exceeding it costs −10 points. A $1-buyout finance lease counts as CapEx (substance over form). |
| Aerodynamic Testing Restrictions (FIA 2.4) | A sliding scale by championship position: P1 gets 70% of the base allowance, P10 gets 115%. The CFD allowance runs from 4.2 MAUh (P1) to 6.9 MAUh (P10). | Each team's compute cap on its brief. Cost-cap breaches and Article F6 breaches cut the ATR by 10%. |
| FP64 normalisation (FIA 2.1) | CFD is billed in MAUh: core-hours × FP64 GFLOPS per core at **peak** clock. Turbo must be locked. | Unlocked turbo is billed at maximum boost. A clock locked below base is billed lower for almost no loss on memory-bound CFD. The game applies the 10⁶ divisor once (the convention teams report); the compute brief says so. |
| CFD records (FIA 2.3) | A parallel file system with tamper-evident metadata, and run folders retained for audit. HBM on the CPU must be declared. | Scale-out NAS is not tamper-evident (−5 points, 50% chance). Deleting run folders breaks retention (−5 points, 50%). |
| Article F6 segregation (3.2, 3.3, 3.4) | F1 IT is separated from sister companies (people, networks, data). Data may leave F1, nothing may come back. Staff from sister companies serve a 3-month quarantine. Access logs cover three years. | Shared IT: −15 points and a 10% ATR cut. Two-way sync: −20 points, the borrowed aero gain is struck out, ATR cut. Immediate transfers: −8 points and their work is struck out. Short logs: −3 points. |
| Trackside (FIA 5.1–5.4) | Car data dumps over the **wired umbilical**, and no team wireless on track (5.2). The circuit ↔ factory WAN uses **redundant encrypted tunnels**; strategy runs at HQ or approved cloud (5.3). Racks obey the curfew (5.4). | Wi-Fi car dumps: points and +5 s at the stop. Private 5G on track: a time penalty and points. A single tunnel, or two tunnels on one path, is non-redundant. A rack booting during curfew: 3-place grid drop. |

---

## 3. The game format

- **Teams.** 2 to 10 teams. The host sets each team's 2026 finishing position (P1–P10), which sets its
  CapEx tier and ATR allowance. Front-runners get less money and less CFD; backmarkers get more.
- **Tables.** Six tables, one per part of the infrastructure, each with its own leader. The host can
  play with five or six. Each table has 4–6 decisions with 2–5 options.
- **The clock.** One game clock for everyone, 60 minutes by default (the host can set 1 to 240).
  There is also a soft visit guide of about 10 minutes per table. When the clock hits zero, every
  table locks.
- **Free movement.** Teams go to any table in any order and may come back. Each table iPad shows
  "Choose your team"; a team taps its name to work there.
- **Per table:** read the brief, decide, run the simulation, lock in a one-page plan, call the leader,
  pitch for 30 seconds, and get **Approved** or **Sent back** with a reason.
- **Approval gates everything.** Only an approved table scores and races as designed. A table that
  was never locked in (**missed**) or locked in but not approved (**not approved**) scores 0 and races
  on that table's **default options**, which are deliberately weak. A team that is sent back can
  revise, lock in again and re-pitch while the clock allows. A plan locked in before the clock ran out
  can still be pitched and approved after it.
- **The finale.** The host or projector runs the Austin, Texas 2027 Grand Prix at the Circuit of the
  Americas: 56 laps of 5.513 km, animated in 30 seconds, followed by the podium and the race report.

---

## 4. Roles, screens, addresses and PINs

| Screen | Address | Who uses it |
| --- | --- | --- |
| Landing page | `http://localhost:8080/` | Everyone: short instructions for each role and links to every screen. |
| Host console | `http://localhost:8080/host.html` | **Session host** (host PIN) or **Table leader** (leader PIN + the table they lead). |
| Table iPad | `http://localhost:8080/station.html?station=<id>` | Teams. One iPad per table. No PIN. |
| Projector / race screen | `http://localhost:8080/race.html` | The big screen: live standings, **Run race** (race password), the race and the report. |
| Team report | `http://localhost:8080/race.html?team=t1` | A team's own report after the race (`t1` is the first team, `t2` the second, and so on). |

Table ids for the iPad address: `compute`, `ai`, `dc`, `storage`, `network`, `governance`.
On the Wi-Fi network, replace `localhost` with the laptop's address (see section 12).

**Host console logins.**

- **Session host:** the host PIN. Sees everything: setup, the clock, the live feed, the approvals grid,
  every pitch queue, Architect grants, the race and restart.
- **Table leader:** choose the **Table leader** tab, enter the leader PIN, pick your table and
  optionally your name, then **Open my table**. A leader sees only that table. The clock, game setup,
  restart and race controls are hidden, and the server refuses leader actions for any other table.

**The three PINs.** Each is an environment variable checked by the server.

| Variable | Rehearsal default | Used for |
| --- | --- | --- |
| `HOST_PIN` | `2027` | The session host on the host console. |
| `LEADER_PIN` | `1950` | Table leaders on the host console. One shared PIN; each leader picks a table. |
| `RACE_PIN` | `SKO27` | The race password: **Run race** on the projector and **End clock & run race** on the host console. |

The server prints a warning at startup naming every PIN still on its default. To set them for a
manual start:

```bash
HOST_PIN=your-host-pin LEADER_PIN=your-leader-pin RACE_PIN=your-race-password npm run start:lan
```

For the background service, pass the same variables to `scripts/install-service.sh` (section 13).
PINs may be 1–64 letters, digits, `_` or `-`.

---

## 5. How to play

### Host walkthrough

1. Open the host console and enter the host PIN (**Enter race control**).
2. **Create the game.** Name each team (2–10) and set its 2026 finishing position. Tick the tables in
   play (at least five). Set the game clock (default 60 minutes) and the visit guide (default 10).
   Races and sprints default to 24 and 6; leave them unless you are changing the season the cost cap
   is based on. **Create game**. **Re-create game** later wipes the current game and asks first.
3. Optional: **Demo mode** (see below).
4. **Start the clock.** It shows on the host console, the projector and every iPad. You can pause,
   resume, and add or remove 1 or 5 minutes, or **End now**.
5. Watch the **live feed**: where each team is, its current step, its latest simulation, lock-ins,
   approvals, Architect status (and who granted it) and when its iPad was last seen. iPads send a
   heartbeat every 5 seconds; the feed turns amber after 12 s and red after 30 s without one.
6. Watch the **Approvals** grid: every team × table as Draft, Locked in, Waiting for leader, Pitching,
   Approved or Sent back, with counts.
7. Manage each **pitch queue**: confirm, move up or down, set a slot (`HH:MM`), remove, or clear.
   **Lead this table** opens that table's leader panel if you need to stand in for a leader.
8. **Grant** Architect to a team from the feed (leaders can grant it too).
9. When the clock ends, run the race from the projector, or use **End clock & run race** on the host
   console. Both need the race password. An optional seed makes the race repeatable.
10. **Restart the experience** asks for the host PIN again, then wipes every team, choice, plan, queue
    and score. All screens return to the landing page.

### Team walkthrough

1. At a table iPad, tap your team under **Choose your team**. You land on **1 · Brief**.
2. Read the mission, your constraints (CapEx headroom, OpEx allowance, compute cap) and what the
   leader is scoring. Tap **Start designing**.
3. On **2 · Decide**, tap one card per decision. Each decision says why it matters to the customer.
   **FIA rule** tags mark regulation-driven options; **est.** marks a teaching estimate. The
   **running ledger** shows CapEx, OpEx, power, lead time and FIA flags for the whole plan.
4. On **3 · Simulate**, tap **Run simulation**: a 0–100% score and up to three hints. 80% or more is
   Optimised. About three runs per visit is enough. **Whole-team view** shows every table.
5. On **4 · Pitch**, tap **Lock in**. The plan output shows a plain-English summary, the decisions,
   money, power, lead time, score and a five-character plan ID. **Take a screenshot.**
6. Tap **Call the leader**. The iPad shows **Waiting for leader** with your queue position, and tells
   you to go and pitch when the leader is free.
7. Pitch. The iPad shows **Pitching: 0:30** during the countdown, then **Approved**, or
   **Sent back: <reason>**. Sent back unlocks the plan: change it, lock in again and call the leader.
8. Move on and choose your team at the next table. **Switch team** hands the iPad to someone else;
   **Return to home** checks you out of the table.
9. After the race, **View race report** on the Pitch tab opens your team's report.

### Table-leader walkthrough

Leaders use the host console on their own laptop or iPad, not the table iPad.

1. Open `/host.html`, choose **Table leader**, enter the leader PIN, pick your table, type your name,
   **Open my table**.
2. Tap **Available / Busy**. Available tells the team at the front of the queue to come now.
3. The **pitch queue** lists teams in order with how long each has waited. **Review** shows the team's
   design in full sentences (for example "They chose Dell servers paid monthly through APEX, so there
   is no CapEx but a 36-month commitment…"), the consequences (CapEx against headroom, yearly OpEx
   against the allowance, power, lead time, FIA flags) and the simulation score with its four parts.
4. **Grant Architect** (or **Revoke Architect**) for a team before you meet it, for example while it
   is queued.
5. **Start pitch** (you must be Available). A 30-second countdown runs on your screen and the team's
   iPad, and you become Busy. At zero you are prompted to decide. You may decide earlier.
6. **Approve**, or type an optional one-line reason (up to 120 characters) and **Send back**. Either
   records who decided, when and how long the pitch ran, and returns you to Available.
   **Cancel pitch** stops a pitch without a decision.

### Demo mode

On the host console, **Demo mode** walks the room through the whole game in 15 narrated steps with a
pretend team, Demo Racing (P6), and two rivals: setup, start, choose team, brief, decide, simulate,
lock in, call the leader, Architect and Available, the 30-second pitch, approval, Architect tuning,
other tables (one sent back, one queued), the end of the clock, and the race with its podium and
suggestions. Demo mode runs entirely in the browser and never changes the real game. **Exit demo**
when you are done.

---

## 6. The six tables in detail

Every table has the same anatomy: a brief, 4–6 visible decisions, the running ledger, the
simulation, the plan output and the pitch. The lists below are generated from the game's catalog,
so every option and reason is exactly what players see. "Default" is what a team races with if
the table is missed or not approved.

### CFD Supercomputer (`compute`)

**Leader:** Head of Aero Computing. **Rules on the brief:** FIA 2.1 MAUh billed at FP64 peak; FIA 2.1 turbo must be locked; FIA 1.2 CapEx envelope.

**Mission (the brief the team reads):**

- The FIA caps aero computing, not hardware: every core-hour is billed at the chip's peak speed, so a locked clock and memory bandwidth win.
- Pick the OEM who builds and supports the racks. The same OEM ships your AI racks.
- Decide how to pay: buying uses CapEx, leasing and as-a-service use OpEx. The CapEx envelope is small for top teams.

**Partners named on the table:** Supermicro, Dell, HPE, Lenovo, NVIDIA, AMD, Intel.

**Decisions** (the default, which a team gets if this table is missed or not approved, is marked):

- **OEM partner.** Who builds and supports the hardware sets the price, the lead time and which as-a-service plans you can use.
  - Supermicro: Lowest price (the 1.00 baseline), in stock 3 weeks sooner, thinner support, no as-a-service.
  - Dell PowerEdge: +15% on price, a week sooner, ProSupport, and APEX if you want it as a service.
  - HPE (Cray XD / ProLiant): +18%, a week later, HPC tuning for CFD (+4%), GreenLake and Private Cloud AI services.
  - Lenovo (Neptune water cooling): +15%, a week later, warm-water cooling that cuts node power, TruScale as a service.
  - NVIDIA DGX **(default)**: +35% and two weeks later, but AI Enterprise software ($4,500 a GPU a year) is included.
- **How you pay for the hardware.** Decides whether hardware hits the CapEx envelope now or the OpEx cost cap every year.
  - Buy outright **(default)**: Cheapest over three years, but every dollar comes out of the CapEx envelope (FIA 1.2).
  - Operating lease (FMV) *(est.)*: Zero CapEx: a yearly rental against the cost cap; the lessor keeps the residual value.
  - $1-buyout finance lease *(FIA rule 1.2)*: Feels like a lease, but you end up owning it: the FIA books it as CapEx, plus ~4.5% interest a year.
  - OEM as-a-service (GreenLake / APEX / TruScale) *(est.)*: Zero CapEx and support included, ~3–3.6% of the price a month, but a 36-month commitment you pay in full if you leave early.
- **Contract term (leases and as-a-service).** Longer leases and service contracts cost less a year but commit you for longer.
  - Choices: 24, 36 (default), 60 months.
- **CFD processor.** The FIA bills every core-hour at peak speed, so the chip that does the most CFD per billed hour wins.
  - AMD EPYC 9575F (fast clocks) **(default)** *(est.)*: Huge peak speed, but CFD waits on memory and the FIA bills the peak.
  - AMD EPYC 9684X (stacked cache) *(est.)*: A giant cache keeps the mesh on-chip: more useful work per billed hour.
  - Intel Xeon Max 9480 (HBM on the CPU) *(FIA rule 2.3)*: The most memory bandwidth per core; HBM must be declared to the FIA.
  - NVIDIA Grace (Arm) *(est.)*: Low power per node with solid bandwidth; a modest peak keeps the bill low.
- **Clock policy.** A locked clock is billed lower; turbo burns allowance on speed CFD cannot use.
  - Turbo unlocked **(default)** *(FIA rule 2.1)*: Billed at maximum boost on every core-hour, and CFD barely runs faster.
  - Locked at base clock *(FIA rule 2.1)*: Billed at the base clock: the honest default.
  - Locked 15% under base *(FIA rule 2.1)*: 15% less billed per core-hour for almost no loss on memory-bound CFD.
- **CFD nodes.** More nodes finish CFD sooner but spend the allowance faster and draw more power.
  - Choices: 4 (default), 8, 12, 16 nodes.

### AI & GPUs (`ai`)

**Leader:** Head of Race Strategy. **Rules on the brief:** FIA 1.1 cloud is 100% OpEx; FIA 5.3 strategy runs at HQ or approved cloud.

**Mission (the brief the team reads):**

- Race strategy needs about 180,000 tokens a second on race weekends.
- Own racks, reserve cloud GPUs, or rent only the race weekends.
- Model size, number format and the GPU power cap decide how much each GPU delivers.

**Partners named on the table:** NVIDIA, Neoclouds and AWS, Custom-silicon partners.

**Decisions** (the default, which a team gets if this table is missed or not approved, is marked):

- **Accelerator.** The accelerator sets tokens per second, rack power, cooling needs, price and lead time.
  - HGX H100 (last generation) **(default)**: Cheap and in stock in weeks, but 80 GB a GPU and a fraction of Blackwell's tokens.
  - HGX B300 (Blackwell Ultra, 30 kW a rack): 288 GB a GPU and FP4: the most tokens on air-friendly racks; needs rear doors or liquid at 30 kW.
  - GB300 NVL72 (72 GPUs as one, 142 kW): One giant GPU for big models: liquid cooling only and a 20-week lead.
  - Partner ASIC derivative *(est.)*: Twice the tokens per watt, but $6M of engineering, 44 weeks and a 30% chance it slips.
  - True custom silicon (own chip) *(est.)*: $150M and 130 weeks: no team can afford it this season. That is the point.
- **How you source it.** Owning racks is cheapest at scale; cloud and burst trade CapEx for OpEx and speed.
  - Own racks in your data centre **(default)**: Paid the way the compute table chose (buy, lease, finance or as-a-service); needs power, cooling and lead time.
  - Reserved cloud GPUs (1 year) *(FIA rule 1.1)*: No hall, no lead time, 100% OpEx all year at a neocloud rate card.
  - Race-weekend burst (cloud Capacity Blocks) *(FIA rule 1.1)*: Rent the peak only: 24 race weekends × 72 hours, at a higher hourly rate plus hyperscaler egress.
- **Racks (or cloud equivalent).** Enough capacity for race-weekend strategy demand, without paying for idle GPUs.
  - Choices: 1, 2 (default), 3, 4 racks.
- **GPU power cap.** Capping GPU power trades a little speed for a lot less power and heat.
  - Capped at 70% *(est.)*: 80% of the tokens for 70% of the watts.
  - Capped at 85% *(est.)*: The sweet spot: 93% of the tokens for 85% of the watts.
  - Datasheet power **(default)**: Full speed, full power bill.
  - Max boost *(est.)*: +6% tokens for +15% watts; throttles and fails without liquid cooling.
- **Strategy model size.** Bigger models give sharper calls but need more memory and answer more slowly.
  - Small (7B) *(est.)*: Five times the tokens and instant answers, but weaker strategy calls.
  - Medium (70B) *(est.)*: Good race reasoning and fast enough: the workhorse.
  - Frontier (400B) **(default)** *(est.)*: The sharpest calls, but a fifth of the tokens and it needs a lot of GPU memory.
- **Number format.** Fewer bytes per number fit more model in memory and run faster, at a small accuracy cost.
  - FP32 (4 bytes) **(default)** *(est.)*: Training-style precision: four times the memory of FP8 and a seventh of the speed.
  - BF16 (2 bytes) *(est.)*: The safe serving standard: no accuracy loss, about 60% of FP8 speed.
  - FP8 (1 byte) *(est.)*: Half the memory of BF16 and the fastest tokens, ~1.5% accuracy loss.
  - INT8 (1 byte) *(est.)*: What most custom chips run natively; a little more accuracy loss.

### Data Centre & Power (`dc`)

**Leader:** Head of Facilities. **Rules on the brief:** FIA 1.1 colocation and power are OpEx; FIA 1.2 racks and PDUs are CapEx.

**Mission (the brief the team reads):**

- Choose the metro, the cooling and how many kW you contract: rent is per kW a month whether you use it or not.
- Air cools ~15 kW a rack, rear doors ~70, direct-to-chip liquid ~240, immersion ~100.
- Redundancy and contract length trade rent against outage risk and flexibility.

**Partners named on the table:** Digital Realty (PlatformDIGITAL), Vertiv / Motivair (rear doors, CDUs), Immersion vendors.

**Decisions** (the default, which a team gets if this table is missed or not approved, is marked):

- **Metro.** The metro sets power and rent prices and the distance to the factory and the circuits.
  - London **(default)**: 80 km from the factory; $213/kW-month rent and dear power.
  - Frankfurt: Europe's interconnection hub; the dearest rent ($250/kW-month).
  - Ashburn (Virginia): $173/kW-month, cheap power, every cloud on-ramp; an ocean from the factory.
  - Dallas (Texas): $173/kW-month and the cheapest power, 300 km from the Austin race, 7,600 km from the factory.
- **Cooling.** The cooling type decides how many kW a rack can draw and how efficient the hall is.
  - Air (open hall) **(default)**: Ready now, ~15 kW a rack, PUE 1.38.
  - Rear-door heat exchangers *(est.)*: Water coils on the rack doors: ~70 kW a rack, $30k a rack, 6 weeks.
  - Direct-to-chip liquid *(est.)*: Cold plates: up to 240 kW a rack, PUE 1.20, $45k a rack, 10 weeks, +15% rent.
  - Immersion tanks *(est.)*: PUE ~1.07 and ~100 kW a tank, $70k a tank, 12 weeks, +15% rent; NVL72 racks do not fit.
- **Power contracted.** You pay rent on the whole contracted block, so size it to the load plus headroom.
  - Choices: 0.25, 0.5 (default), 1, 2 MW.
- **Colocation contract.** Longer take-or-pay contracts cut the rate; metered pays only for what you draw, at a premium.
  - 5-year take-or-pay **(default)**: The standard wholesale deal: a fair rate, but you pay for every contracted kW, drawn or not.
  - 10-year take-or-pay *(est.)*: About 12% cheaper per kW, locked for a decade: great if the block is right-sized, painful if not.
  - Flexible 1-year, pay for drawn kW *(est.)*: Pay only for what the racks draw, at a 30% premium: nothing stranded, but the dearest kilowatt.
- **Power redundancy.** More power paths cost rent but keep the racks up when a UPS fails on a race weekend.
  - N (one power path) **(default)**: Cheapest, but one UPS or feed fault stops the racks on a race weekend.
  - N+1 (one spare of everything) *(est.)*: A spare UPS, chiller and feed: rides through one failure for ~8% more rent.
  - 2N (two independent paths) *(est.)*: Two complete power trains: near-zero outage risk for ~25% more rent.

### Storage & Memory (`storage`)

**Leader:** Head of Data Engineering. **Rules on the brief:** FIA 2.3 parallel file system with tamper-evident metadata; FIA 2.3 run folders retained.

**Mission (the brief the team reads):**

- CFD needs a parallel file system that keeps a tamper-evident record (FIA 2.3).
- Run folders must be kept for audit.
- The strategy AI needs its history searchable, a KV cache for repeat questions, and enough GPU memory.

**Partners named on the table:** Lustre / BeeGFS, Everpure / NetApp (storage as a service), NVIDIA.

**Decisions** (the default, which a team gets if this table is missed or not approved, is marked):

- **CFD file system.** The CFD file system must keep up with the solvers and keep the record the FIA audits.
  - Scale-out NAS **(default)** *(FIA rule 2.3)*: Cheap and simple, but CFD stalls and there is no tamper-evident record.
  - Lustre appliance *(FIA rule 2.3)*: The parallel standard with an audit trail, bought as CapEx.
  - BeeGFS *(FIA rule 2.3)*: The cheapest parallel option; the audit add-on costs engineering time.
  - Storage as a service *(FIA rule 2.3)*: No CapEx, no power or space: ~$500k per PB a year, all OpEx.
- **Capacity.** Enough capacity for a season of aero data without paying for empty disks.
  - Choices: 1 (default), 2, 4 PB.
- **Audit archive.** The FIA requires an audit trail; the archive decides how long and how safely you keep it.
  - Delete after each test period **(default)** *(FIA rule 2.3)*: Saves space and breaks FIA 2.3: run folders must be kept.
  - Tape library *(FIA rule 2.3)*: Cheap to keep for years; CapEx.
  - Cloud archive *(est.)*: No CapEx, a small OpEx bill, slow to retrieve in an audit.
- **Strategy knowledge store.** Where the strategy AI finds race knowledge decides how grounded and fast its answers are.
  - Local drives only **(default)**: Free, but the assistant cannot search a decade of race data.
  - Shared file and object store *(est.)*: History and checkpoints in one place: better-grounded answers.
  - Vector index *(est.)*: Finds the right past stint instantly: the best-grounded strategy calls.
- **KV cache tier.** A KV cache tier lets repeat what-if questions skip work and serve more tokens.
  - Off **(default)**: GPUs re-read every prompt from scratch on repeat questions.
  - On *(est.)*: Repeat what-ifs skip the prompt: ~18% more effective throughput for $250k.
- **GPU memory (HBM).** GPU memory size and speed decide whether the model fits and how fast it generates.
  - 80 GB **(default)** *(est.)*: Big models must be split across GPUs; long contexts spill.
  - 141 GB *(est.)*: ~1.3× faster inference on the same GPU for $6k a GPU.
  - 192 GB *(est.)*: A 70B model plus its notes on one GPU.
  - 288 GB *(est.)*: Room for long contexts and big models; the dearest memory.

### Connectivity (`network`)

**Leader:** Head of Trackside IT. **Rules on the brief:** FIA 5.2 wired umbilical, no wireless on track; FIA 5.3 redundant encrypted WAN.

**Mission (the brief the team reads):**

- Strategy calls travel circuit → data centre → factory: every kilometre adds delay, every hop adds jitter.
- The WAN must be redundant and encrypted (FIA 5.3); car dumps go over the wired umbilical (FIA 5.2).
- Inside the hall, the cluster fabric and cross-connects decide how well CFD and AI scale.

**Partners named on the table:** Digital Realty (ServiceFabric, cross-connects), Carriers, Photonics suppliers.

**Decisions** (the default, which a team gets if this table is missed or not approved, is marked):

- **Primary WAN to the circuit.** The link to the circuits carries every strategy call; distance and jitter cost seconds.
  - Public internet **(default)**: Cheapest; 2.4× the distance, jitter and packet loss, no SLA.
  - SD-WAN over two ISPs *(est.)*: Encrypted and quick to deploy; still the internet underneath.
  - Carrier MPLS *(est.)*: Steady and SLA-backed, but dear and a 10-week order.
  - Digital Realty ServiceFabric: Private interconnection, almost no jitter, live in 15 days.
- **Backup WAN.** A second, different path keeps the pit wall connected when the first one fails.
  - No backup **(default)** *(FIA rule 5.3)*: One path: one cut and the pit wall is blind.
  - LEO satellite *(est.)*: Shares nothing with your fibre: the most diverse backup, thin but cheap.
  - SD-WAN over two ISPs *(est.)*: Cheap, encrypted second path over different carriers.
  - Carrier MPLS *(est.)*: A steady second path with an SLA, at a price.
- **Data centre ↔ factory link.** The data centre to factory link sets how quickly aero results reach the engineers.
  - Public internet **(default)**: Cheap and jittery: every strategy call waits on it.
  - Dark fibre (≤1,500 km) *(est.)*: Pure light-speed delay between your own sites; a 12-week build.
  - Hollow-core fibre (≤300 km) *(est.)*: Light in air: ~32% less delay than glass, $400k and 20 weeks.
  - Digital Realty ServiceFabric: Private and global: the only clean option from a US metro.
- **Cluster fabric.** The cluster network decides how well CFD and AI scale across racks.
  - 100G Ethernet **(default)** *(est.)*: Cheap and familiar; CFD and GPUs wait on it.
  - InfiniBand 400G *(est.)*: The HPC standard: lowest latency for CFD.
  - 800G AI Ethernet *(est.)*: Tuned for GPU traffic; nearly InfiniBand for CFD.
  - Co-packaged optics (photonics) *(est.)*: ~30% less power per port and lower latency; a premium, a long lead, early-life risk.
- **Trackside network package.** The FIA rules how car data and team networks may run at the circuit.
  - One encrypted tunnel, wired umbilical **(default)** *(FIA rule 5.3)*: Cheapest, but one fault cuts the pit wall off and FIA 5.3 asks for two tunnels.
  - FIA standard: two encrypted tunnels + umbilical *(FIA rule 5.3)*: Exactly what the rules ask: automatic fail-over between two encrypted paths.
  - FIA standard + garage Wi-Fi 7 + private 5G to the hotel *(est.)*: Legal extras: faster engineer review and a second path that never touches the track.
  - All wireless: Wi-Fi car dumps + 5G on track *(FIA rule 5.2)*: Fastest data, and banned: FIA 5.2 forbids team wireless on track and car dumps off the umbilical.
- **Trackside edge racks.** Edge racks at the circuit keep working when the WAN does not, but must be flown to every race.
  - Choices: 1 (default), 2, 3 racks.

### Rules & Budget (`governance`)

**Leader:** CFO & Compliance Director. **Rules on the brief:** F6 3.3 segregation from sister companies; F6 3.4 workforce quarantine; FIA 5.4 curfew; FIA 1.1 cost cap.

**Mission (the brief the team reads):**

- F1 IT must be separated from the sister companies: people, networks, data.
- Data may leave F1 with sign-off; nothing may come back.
- Check the whole bill: CapEx envelope, OpEx allowance and cost-cap headroom.

**Partners named on the table:** Security partners, Digital Realty (private suites), Auditors.

**Decisions** (the default, which a team gets if this table is missed or not approved, is marked):

- **Separation from sister companies.** Article F6 requires separation from sister companies; how you do it sets cost and audit risk.
  - Shared IT **(default)** *(FIA rule F6 3.3)*: Cheapest by far, and a clear Article F6 breach.
  - Logical separation *(FIA rule F6 3.3)*: Separate networks, directories and MFA: compliant, a small audit risk.
  - Private suite + separate storage *(FIA rule F6 3.3)*: A caged suite and dedicated arrays: the safest, the dearest.
  - Zero-trust with hardware isolation (DPUs) *(FIA rule F6 3.3)*: Identity-based isolation enforced in BlueField DPUs: near-physical safety for less.
- **Data flow with sister companies.** How data moves between companies decides what you may share and what the FIA catches.
  - Manual transfer desk **(default)** *(FIA rule F6 3.3)*: Compliant but slow, and people make mistakes.
  - One-way data diode *(FIA rule F6 3.3)*: Data can leave F1, nothing comes back: provably compliant.
  - Two-way sync with the sister CFD team *(FIA rule F6 3.3)*: Free know-how, and banned: data must never flow back into F1.
- **Hiring from sister companies.** New hires from rivals bring knowledge the FIA restricts for a cooling-off period.
  - No transfers **(default)**: No risk, no extra help.
  - Hire 4 engineers with a 3-month lockout *(FIA rule F6 3.4)*: Useful from April, fully compliant.
  - Move them in on Monday *(FIA rule F6 3.4)*: Instant help, and a breach of the quarantine rule.
- **Curfew and audit logs.** Curfew and log rules are audited; automation and immutable logs avoid penalties.
  - Manual curfew, 12-month logs **(default)** *(FIA rule 5.4)*: Free, but a forgotten rack at night or a missing log is a penalty.
  - Manual curfew, 3-year immutable logs *(FIA rule F6 3.2)*: Audit-proof logs; the curfew still depends on people remembering.
  - Automated curfew + 3-year immutable logs *(FIA rule 5.4)*: Racks power down on schedule and every event is kept: nothing to argue about.

**FIA flags by table.** These are the penalties each table can cause, with their probability of
being caught and their cost (from `model.js`):

- **Rules & Budget:** shared IT (F6, certain, −15 and 10% ATR cut); gaps in the segregation document
  (−4); two-way sync (−20, aero gain struck out, ATR cut); manual transfer without a video record (−4);
  immediate transfers (−8, work struck out); short logs (−3); curfew breach (3-place grid drop);
  cost-cap minor/major breach (−10 / −25 and ATR cut); CapEx envelope exceeded (−10).
- **Storage & Memory:** CFD metadata not tamper-evident (−5); run folders purged (−5).
- **Connectivity:** private 5G on track (time penalty and points); Wi-Fi car dumps (points and +5 s at
  the stop); a single or unencrypted tunnel (points); two tunnels on one path (−5 at audit). The model
  also knows strategy on hidden garage hardware (5-place grid drop and 5 s) and hardware between
  sensors and the SECU (disqualified), but no current option triggers them: those hidden decisions are
  fixed at their legal defaults.
- **CFD Supercomputer, AI & GPUs, Data Centre & Power** have no direct penalties, but their choices
  drive cost (and therefore cap breaches) and the race incidents in section 10.

---

## 7. OEMs and commercial models

**The five OEMs** (list-price ladder rebased to Supermicro = 1.00). The OEM chosen at the CFD table
also ships the AI racks.

| OEM | Price | Lead time | Notes | As-a-service |
| --- | --- | --- | --- | --- |
| Supermicro | 1.00 | 3 weeks sooner | Lowest price, thinner support; its NVL72 rack brings its own CDU (shorter liquid fit-out); nodes draw a little more power. | None (falls back to a lease) |
| Dell PowerEdge | 1.15 | 1 week sooner | ProSupport, rack-scale liquid for NVL72. | Dell APEX (~3.2% a month, ~75% committed) |
| HPE Cray XD / ProLiant XD | 1.18 | 1 week later | Direct-liquid options and an HPC stack tuned for CFD (+4% scaling). | GreenLake Flex (~3.3%, 80% reserved); Private Cloud AI for GPUs (~3.5%, AI Enterprise included) |
| Lenovo ThinkSystem Neptune | 1.15 | 1 week later | Warm-water cooling cuts node power; heat-reuse credit +25%. | Lenovo TruScale (~3.1%, ~75% committed) |
| NVIDIA DGX | 1.35 | 2 weeks later | The reference system; NVIDIA AI Enterprise included. | None |

**How you pay** (CFD nodes and owned AI racks):

| Model | Booked as | What it teaches |
| --- | --- | --- |
| Buy outright | CapEx (support is OpEx) | Cheapest over three years, but every dollar comes from the CapEx envelope. |
| Operating lease (FMV) | 100% OpEx | Yearly rate factor: 24 months 46%, 36 months 28%, 60 months 20% of the price, plus support. |
| $1-buyout finance lease | CapEx, plus ~4.5% interest | Feels like a lease, but you own it: substance over form. |
| OEM as-a-service (APEX / GreenLake / TruScale) | 100% OpEx | Support included, ~3–3.6% of the price a month, a 36-month minimum commitment. |

**AI sourcing.** Own racks (paid the way the CFD table chose; need power, cooling and lead time),
reserved cloud GPUs for a year (100% OpEx, neocloud rates, free egress; hyperscalers cost 1.6–2.4×
more), or race-weekend burst through cloud Capacity Blocks (24 weekends × 72 hours = 1,728 hours a
year, a higher hourly rate plus hyperscaler egress, nothing left for midweek work).

**Storage as a service** has no CapEx, power or space: about $500k per PB a year, all OpEx.

**Licences.** Every team pays $1.6M a year of fixed CFD/CAD/PLM/OS licences (OpEx). NVIDIA GPUs pay
NVIDIA AI Enterprise at $4,500 per GPU a year unless the OEM bundles it (NVIDIA DGX, or HPE Private
Cloud AI as a service). Custom chips pay no NVIDIA licence.

**Partner ASIC vs true custom silicon.** A partner ASIC derivative gives about twice the tokens per
watt, but costs $6M of engineering, takes 44 weeks and has a 30% chance of slipping past the race
(if it slips, strategy runs without it). True custom silicon costs $150M and takes 130 weeks: no team
can afford it this season, which is the lesson.

**The tier pull.** Nothing in the code favours one payment model by tier; the pull comes from the
envelope. A Tier 1 team has only $6M of CapEx left, so buying the reference build outright overshoots
it and as-a-service scores much better. A Tier 3 team has $10M left, so buying is cheaper over the
term and beats as-a-service. The tests check both directions.

---

## 8. Scoring

**System score (0–100%).** "Run simulation" scores a table on four parts, weighted:

| Part | Weight | Question |
| --- | --- | --- |
| Performance | 35% | Does it do the job (aero work, tokens per second, latency, capacity)? |
| Cost efficiency | 20% | Does it fit the CapEx envelope and OpEx allowance for a sensible share of the budget? |
| FIA compliance | 25% | Expected penalty points (probability × cost) at this table. |
| Resilience | 20% | What happens when something fails (backups, redundancy, headroom, lead-time risk)? |

**Bands.** 80% and above is **Optimised**, 60% and above **Competitive**, below that **Needs work**.
Tables are scored on constraints and efficiency, never by matching one golden build, so every table
has at least two different optimised designs and the defaults are never optimised (the tests prove
this for P5, P7 and P9 teams).

**Approval gate and bonus.** A table's points are `round(system score × 1.1 / 4)` once its leader
approves it, so one table is worth up to 28 points. A table that is not approved, sent back or missed
is worth 0, and races on its defaults.

**Architect gain** multiplies a granted team's useful AI tokens (between 0.5× and 3×), which feeds the
AI performance, the simulation and the race (section 9).

**FIA penalty points** are listed in sections 2 and 6. In the race each penalty is sampled once with
its probability.

**Championship score:**

```text
approved table points + 4 × race points − FIA penalty points
```

Race points are 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for P1 to P10. The podium on the report shows the
championship standings; each step also says where the team finished the race.

---

## 9. Architect mode and the Token Efficiency Calculator

Architect mode is granted per team by the host or by a table leader. It adds the **Token Efficiency
Calculator** at the end of the team's Decide tab. It starts from the team's own AI plan (platform,
racks, memory, power cap, model size, cooling and power price) and lets the team tune how the GPUs
serve tokens. **Apply tuning** saves the tune; the gain (good tokens per second, tuned vs base) is
clamped between 0.5× and 3×.

The levers:

| Lever | Options | What it does |
| --- | --- | --- |
| Precision / quantisation | BF16, FP8, INT8, FP4 | Fewer bytes per weight: more fits and every token re-reads less. FP4 needs Blackwell-class GPUs. |
| Batch size | 8, 32, 128, no cap | How many answers one model copy generates at once; a low cap leaves memory idle. |
| Continuous batching | Off, On | Slot new requests in as others finish instead of waiting for a whole batch. |
| KV cache tier | Off, On | Park the GPUs' notes between turns so follow-ups skip re-reading the prompt. |
| KV cache hit rate | Automatic, 50%, 80%, 95% | Share of the reusable context the cache really serves. |
| HBM per GPU | As planned, 141, 192, 288 GB | Decode speed is set by how fast weights are re-read. |
| GPU power cap | 70%, 85%, 100%, 115% boost | Inference is memory-bound: 85% power keeps about 93% of the tokens. |
| Interconnect | As built, NVLink Switch across racks (2× island) | A model that needs more GPUs than one island spills onto slow links. |
| Speculative decoding | Off, 1.5×, 2×, 2.5× | A draft model guesses tokens the big model checks in one pass. |

**What the numbers mean.** The calculator shows, for the base plan and the tuned plan: tokens per
second, **goodput** (tokens that arrive in time to be useful), cost per million tokens, joules per
token, the bottleneck (memory, compute or capacity) and how much of the 180,000 tokens a second
race-weekend demand is covered. The gain is tuned goodput ÷ base goodput.

---

## 10. The race

**The animation.** The projector plays the Austin, Texas 2027 Grand Prix in **30 seconds**: 56 laps
of 5.513 km on the Circuit of the Americas map, anticlockwise. You see team-coloured dots with
labels, a lap counter, a live timing tower with gaps, DRS passes on the back straight, pit stops
through a pit-lane spur (rejoining lower), a Safety Car that bunches the field, and a ticker.
**Skip to the report** jumps to the end. The same seed always gives the same race.

**Pace.** Each car's lap time comes from its resources (championship position), its aero gain from
CFD, and the system score of its approved design: `96 s + (rank − 5.5) × 0.07 − aero gain −
1.2 × (system score − 0.6)`, plus tyre degradation, bounded lap noise (±0.45 s), DRS (−0.25 s within
1 s of the car ahead) and incidents. Strategy quality decides the planned stop and whether a team
reacts to the Safety Car (an 11 s stop instead of 20 s).

**Race-wide events** (random per seed): a Safety Car (75% of races, 4 laps), a fibre cut near Austin
(45%), and a heat spike (50%).

**Incidents** (each says the team, the cause and the effect, for example "Lost 2 places: their only
WAN link dropped for 40 s"):

| Incident | Triggered by | Prevented or softened by |
| --- | --- | --- |
| WAN drop | Any primary WAN; worst with no backup | A diverse backup WAN (LEO is the most diverse) |
| Fibre cut | Race-wide event | Redundant tunnels plus a diverse backup ride through it; two links in one trench lose 1.5 s; one link loses 4 s |
| Thermal throttling / heat | An air-cooled hall with hot GPUs, max boost; the heat spike | Liquid cooling plus an 85% or 70% power cap stays stable |
| Breaker trip | Low power headroom, N redundancy | Headroom and N+1 / 2N |
| Immersion pump fault | Immersion tanks | Another cooling type |
| Optics fault | Co-packaged optics | Another fabric |
| Public-internet jitter | Public internet to the circuit or factory | Private interconnection: the undercut call is a lap late otherwise |
| Burst unavailable | Race-weekend burst cloud | Owned or reserved GPUs: otherwise a wrong wing guess |
| KV cache | KV cache tier on | (a gain: the stop is called a lap earlier) |
| Architect | A saved Architect gain above 1× | (a gain: tyre drop-off modelled a lap sooner) |
| ASIC slip | Partner ASIC | Another accelerator |
| FIA time penalty | 5G on track, Wi-Fi car dumps | The FIA standard trackside package |
| FIA audit penalty | No retention, shared IT, short logs, NAS, manual transfers | Tape or cloud archive, segregation, immutable logs, Lustre/BeeGFS/STaaS |
| Grid drop | Curfew breach (manual curfew) | Automated curfew |

**Weighting and randomness.** Approved optimisation, Architect gain and FIA penalties decide the order;
lap noise, incident odds and the Safety Car lap are bounded. Over 200 seeds, a fully approved
optimised team beats the same choices with two tables unapproved at least 85% of the time and beats
an all-defaults team at least 95% of the time (the balance test, section 17).

**The report.** After the animation:

1. **The podium**: 1st in the centre and highest, 2nd on the left, 3rd on the right, in team colours
   with championship points and the race position.
2. **What you could do differently**: 1–3 suggestions per team, from tables not approved or missed,
   a better option at an approved table and why ("X instead of Y would have scored N more"), FIA
   penalties, and incidents that cost places.
3. **The classification**: position, grid, gap, stop lap, tables (approved / not approved / missed),
   race points, table points, penalties and score; then final standings and awards.
4. **The debrief** per team: what each table cost or bought.

The report stays on the projector after the race and is available to each team at
`/race.html?team=<id>` (linked from the iPad's Pitch tab as **View race report**). The race runs once
per game from the race screen; the host can take it back to run it again.

---

## 11. Install and run locally

**Requirements.**

- Node.js 18 or newer (`node -v`). Install the LTS build from [https://nodejs.org](https://nodejs.org)
  if missing. There are no npm packages: do not run `npm install`.
- A current browser (Safari or Chrome).
- macOS for the double-click launcher and the background services. `npm start` also works on Windows
  and Linux.

**Quick start on a Mac.** In Finder, double-click `start.command`. The first time, macOS may refuse a
downloaded script: right-click it, choose **Open**, then **Open** again. It finds Node (including nvm
installs), starts the server on this Mac only and opens `http://localhost:8080/`. Leave the Terminal
window open; close it or press Ctrl+C to stop. If Podium is already running, it just opens the page.

**From Terminal (any OS):**

```bash
cd /path/to/Podium
npm start
```

**Windows / Linux.** Use `npm start` (or `node server.mjs`) and open `http://localhost:8080/` yourself.
The `scripts/*.sh` service and tunnel helpers are macOS only.

**What success looks like.** The landing page heading reads "Build the infrastructure that wins the
finale." with links to the host console, the projector and the six tables. Terminal prints the same
links, and warns which PINs are still on the rehearsal defaults.

Do not double-click the `.html` files: opened as files they show "Podium needs its server".

---

## 12. Running a live event on Wi-Fi

`npm start` listens only on this Mac (127.0.0.1). For iPads, use Wi-Fi mode, which listens on all
interfaces on port 8080:

1. Stop the local server (close the `start.command` window) or the background service:
   `launchctl bootout gui/$(id -u)/com.podium.server`.
2. Start Wi-Fi mode with real PINs:

   ```bash
   HOST_PIN=your-host-pin LEADER_PIN=your-leader-pin RACE_PIN=your-race-password npm run start:lan
   ```

3. Read the line starting `iPads`, for example `http://192.168.1.20:8080/`. That is the room address.
   Every device must be on the same network; a VPN on the laptop often hides the address.
4. On each iPad open `http://<address>:8080/station.html?station=<id>`; on the projector open
   `/race.html`; leaders open `/host.html`. In Safari, Share → Add to Home Screen gives a full-screen icon.
5. Lock each iPad to its page with **Guided Access** (Settings → Accessibility → Guided Access, then
   triple-click the side button).

**Rehearsal checklist.**

- [ ] PINs set (no default-PIN warning in Terminal).
- [ ] Game created with the right team names and finishing positions.
- [ ] Each iPad on its table page; one test team chosen and visible in the host's live feed.
- [ ] Each leader logged in on their own device, scoped to their table.
- [ ] Projector on `/race.html`; the race password tested.
- [ ] One full pitch rehearsed: Call the leader → Start pitch → Approve.
- [ ] Demo mode rehearsed if you will present it.
- [ ] Laptop on power with sleep disabled.

---

## 13. Keeping it running: the background service

On a Mac, a per-user LaunchAgent (`com.podium.server`) starts Podium at login and restarts it within
about two seconds if it stops. It serves this Mac only, on port 8080.

```bash
HOST_PIN=your-host-pin LEADER_PIN=your-leader-pin RACE_PIN=your-race-password sh scripts/install-service.sh
```

The installer writes the three PINs into the LaunchAgent's EnvironmentVariables (the plist is readable
only by your user). It takes each PIN from the environment, or asks for it with hidden typing; if you
press Enter or there is no terminal, it uses the rehearsal default and warns. Re-run it to change a
PIN, after moving the folder, or after changing Node.

```bash
launchctl kickstart -k gui/$(id -u)/com.podium.server   # restart
launchctl bootout gui/$(id -u)/com.podium.server        # stop until next login or reinstall
sh scripts/uninstall-service.sh                         # remove the service, keep the game
```

With the service running, `start.command` and `npm start` notice it and only open the browser.
`npm run start:lan` cannot share port 8080 with it: stop the service first.

**Data and logs.** The game is saved to `data/state.json` after every change, so restarts and reboots
keep it. Logs: `data/logs/server.log` and `data/logs/server.err.log`. Set `DATA_DIR` to store the
game elsewhere.

**Backups and restore.** Copy `data/state.json` somewhere safe before an event. To restore, stop
Podium, copy the backup over `data/state.json`, and start it again. An unreadable save file is renamed
`data/state.json.damaged-<time>` and a blank game starts; copy it back once it is valid JSON.

---

## 14. Sharing it publicly for testing

A Cloudflare Quick Tunnel gives this Mac a temporary public HTTPS address without a Cloudflare
account. It needs `cloudflared` (`brew install cloudflared`, or the macOS binary from
[Cloudflare's releases](https://github.com/cloudflare/cloudflared/releases) in `~/bin`).

```bash
sh scripts/install-tunnel.sh      # install and start the tunnel service (com.podium.tunnel)
sh scripts/tunnel-url.sh          # print the current https://….trycloudflare.com address
sh scripts/uninstall-tunnel.sh    # stop and remove it
```

The tunnel service runs `scripts/run-tunnel.sh`, which restarts `cloudflared` after 5 seconds if it
stops. It uses HTTP/2 over TCP 443 (set `PODIUM_TUNNEL_PROTOCOL=quic` to use QUIC), which works on
networks and VPNs that block QUIC. Because macOS privacy protection stops LaunchAgents from touching
`~/Documents`, the service's copy of the runner lives in `~/Library/Application Support/Podium/` and
its log in `~/Library/Logs/Podium/tunnel.log`. The installer also removes Gatekeeper's quarantine flag
from `cloudflared` if a script download added one.

**Fallback.** If the service cannot run, `sh scripts/start-tunnel-window.sh` opens a Terminal window
running the same loop. The tunnel lives only while that window stays open.

**Things to know.**

- **The URL changes** every time the tunnel restarts (reboot, network change, crash). Run
  `sh scripts/tunnel-url.sh` again and re-share it.
- **Keep the Mac awake and online.** On power, run `caffeinate -dims` in a Terminal, or turn on
  System Settings → Battery → Options → Prevent automatic sleeping on power adapter.
- **Anyone with the URL can act as a team.** Teams have no login. Rotate the host and leader PINs
  before sharing (`install-service.sh`, section 13) and keep them private.
- The server rate-limits failed PIN attempts (section 16). Quick Tunnels have no uptime guarantee:
  they are for short-lived testing, not production.

---

## 15. Troubleshooting

**`npm: command not found` or `node: command not found`.** Node is not installed, or it came from nvm
and this Terminal has not loaded it. Install from [https://nodejs.org](https://nodejs.org), or
double-click `start.command`, which finds an nvm install on its own.

**Port 8080 is already in use.** See what has it, then stop it or use another port:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
PORT=8090 npm start
```

If the thing on 8080 is Podium (for example the background service), a second `npm start` just opens
the browser.

**"Podium needs its server".** An `.html` file was opened from Finder. Start Podium and use
`http://localhost:8080/`.

**"Reconnecting to the game server".** The server stopped or is restarting. Start it again
(`start.command`, `npm start`, or `launchctl kickstart -k gui/$(id -u)/com.podium.server`). Short gaps
recover on their own; choices made during a gap are sent when the server is back.

**An iPad shows "Choose your team" again.** That is the start of every table until this browser tab
has a team. It also returns after **Switch team**, **Return to home** or a new tab. Reloading the same
tab keeps the team.

**"The host has not created the teams yet"** (projector: "No teams yet", "Waiting for the host"). Open
the host console and **Create game**.

**Wi-Fi mode prints no iPad address.** The laptop is not on Wi-Fi, a VPN is in the way, or macOS
blocked the interface list. Join Wi-Fi, disconnect the VPN and run `npm run start:lan` again.

**"Too many failed PIN attempts".** Ten wrong PINs from one address within five minutes lock that
address out of PIN-protected actions for five minutes. Wait, then use the right PIN.

**The tunnel URL shows Cloudflare error 530 / 1033.** The tunnel is not connected. Check:

- Is it running? `launchctl print gui/$(id -u)/com.podium.tunnel` should show `state = running` and a
  `pid`.
- The log: `tail -40 ~/Library/Logs/Podium/tunnel.log`. "Registered tunnel connection" means it is up.
  "QUIC … handshake did not complete" means the network blocks QUIC: the scripts already use HTTP/2.
  "certificate signed by unknown authority" means a TLS-inspecting proxy or VPN; try another network.
- A brand-new URL can take up to a minute to resolve. If the tunnel restarted, the URL changed: run
  `sh scripts/tunnel-url.sh`.
- `last exit code = 78`, `126` or `spawn failed` with an empty log means launchd cannot reach a file in
  `~/Documents`. Re-run `sh scripts/install-tunnel.sh` (it keeps everything outside Documents), or use
  `sh scripts/start-tunnel-window.sh`.

**Restoring a backup.** Stop Podium, `cp /path/to/your-backup.json data/state.json`, start Podium.

---

## 16. Architecture and API

**File layout.**

```text
server.mjs              Node HTTP server: static files, the JSON API, state, persistence (no dependencies)
start.command           macOS double-click launcher
public/                 index.html, host.html, station.html, race.html, css/app.css
public/js/catalog.js    every option, price, rule and table (the single source of game data)
public/js/decisioncopy.js  one "why it matters" line per decision
public/js/model.js      evaluate(): physics, ledger, risks and FIA penalties for a team's choices
public/js/sim.js        the simulation score, bands and hints
public/js/tokenomics.js, architect.js   the Token Efficiency Calculator and Architect gain
public/js/approval.js   pitch timing, statuses and the approvals grid
public/js/summary.js, plandata.js, plan.js   plain-English summaries and the plan output
public/js/race.js       the seeded lap-by-lap race and incident engine
public/js/report.js, podium.js, raceview.js, cota.js   the race screen, podium and report
public/js/host.js, station.js, ui.js, demo.js   the host console, table iPad, shared UI, demo mode
scripts/                install/uninstall the server and tunnel services, tunnel helpers
tests/                  node:test suites
data/                   state.json and logs (not in git)
```

The browser and the server share the same modules (`catalog.js`, `model.js`, `race.js` and friends),
so the iPad, the host and the race all compute identical numbers.

**State model.** One game in `data/state.json`: `id`, `version` (bumped on every change), `settings`
(minutes, tables, races, sprints), `clock`, `tables` (which team is at which table), `queues`,
`leaders` (available or busy), `pitches` (live 30-second pitches), `teams` and `race`. Each team holds
`choices`, `touched`, `plans` (locked plan outputs), `submitted`, `reviews` (approved or sent back,
with who, when and duration), `pitch` and `scores` (approved table points), `visits`, `sims` and
`architect`. Heartbeats are kept in memory only. Writes go to a temp file then rename. Clients poll
`GET /api/state?since=<version>&game=<id>` and get `{unchanged: true}` when nothing changed; there is
no SSE or WebSocket.

**Endpoints.** Bodies are JSON (≤ 64 KB). "Host" means header `x-pin` = host PIN. "Leader" means the
host PIN, or the leader PIN with header `x-station` equal to the table in the body.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | Liveness: version, team count, pid. |
| GET | `/api/state` | none | The whole game (or `unchanged`). |
| GET | `/api/presence` | none | iPad heartbeats from the last 10 minutes. |
| POST | `/api/login` | PIN in body | Returns `host`, or `leader` with the chosen `station`. |
| POST | `/api/host/setup` | Host | Create the game (teams, tables, minutes, races, sprints). |
| POST | `/api/host/clock` | Host | `start`, `pause`, `resume`, `set`, `add`, `end`. |
| POST | `/api/host/queue` | Host | `confirm`, `up`, `down`, `remove`, `slot`, `clear`. |
| POST | `/api/host/architect` | Host | Grant or revoke Architect. |
| POST | `/api/host/race` | Host + race password | End the clock if needed and run the race. |
| POST | `/api/host/unrace` | Host | Take the race back. |
| POST | `/api/host/reset` | Host | Wipe the game. |
| POST | `/api/race/run` | Race password | Run the race from the projector (once per game). |
| POST | `/api/leader/availability` | Leader | Available or Busy. |
| POST | `/api/leader/architect` | Leader | Grant or revoke Architect for a team. |
| POST | `/api/leader/pitch` | Leader | `start` or `cancel` a 30-second pitch. |
| POST | `/api/leader/decide` | Leader | `approve` or `sendBack` (with an optional reason). |
| POST | `/api/teams/:id/checkin` | none | Seat a team at a table. |
| POST | `/api/teams/:id/choices` | none | Change choices at a table (validated against the catalog). |
| POST | `/api/teams/:id/sim` | none | Record a simulation run. |
| POST | `/api/teams/:id/submit` | none | Lock in and produce the plan output. |
| POST | `/api/teams/:id/call` | none | Join the table's pitch queue. |
| POST | `/api/teams/:id/unlock` | Leader | Unlock a plan (clears its review and queue place). |
| POST | `/api/teams/:id/architect` | none (needs a grant) | Save an Architect tuning. |
| POST | `/api/teams/:id/presence` | none | Heartbeat. |
| POST | `/api/teams/:id/checkout` | none | Leave a table. |

**Rate limiting.** Every PIN-protected route counts failed PINs and race passwords per client IP
(Cloudflare's `CF-Connecting-IP` when present). Ten failures in five minutes return `429` with
`Retry-After` until the window passes. Counters are in memory and reset on restart.

**Security notes.**

- PINs are compared in constant time and never logged. Rehearsal defaults (`2027`, `1950`, `SKO27`)
  are in the code; the server warns while any is in use. Set real PINs for anything beyond rehearsal.
- One leader PIN is shared by all leaders; the server limits each leader to the table chosen at login,
  but anyone with the PIN can choose any table.
- Teams have no authentication: anyone who can reach the server can act as any team.
- `CF-Connecting-IP` is trusted for rate limiting. On a LAN without the tunnel a client could send
  that header itself, so the limit is a speed bump, not a lock.
- Static files are served from `public/` only, with traversal refused and `nosniff` set.

---

## 17. Tests

```bash
npm test
```

That runs `node --test "tests/*.test.js"` with no dependencies. The suites cover:

- **Model** (`model.test.js`): defaults, hidden decisions, FIA billing, penalties, memory, precision,
  HBM, connectivity, CapEx overspend, OEM price direction.
- **Commercial** (`commercial.test.js`): CapEx vs OpEx booking, lease rates, as-a-service fallback,
  cloud and burst, storage as a service, licences, colocation terms, the tier pull.
- **Simulation and builds** (`sim.test.js`, `builds.js`): bands, two optimised builds per table for
  P5, P7 and P9, non-optimal defaults, hints, unapproved tables racing on defaults.
- **Features** (`features.test.js`): table points, Architect gain, demo purity, the ban on the retired
  brand name.
- **Race** (`race.test.js`): determinism per seed, disciplined builds beating defaults, unapproved tables
  costing places.
- **Approval flow** (`approval.test.js`): leader login and scoping, the pitch lifecycle, Architect by a
  leader, approval gating, the race password and its default, the 30-second duration, incidents
  referencing choices, the report, summaries, demo steps, and the **balance test** over 200 seeds
  (it prints a `[balance]` line: a fully approved optimised team must beat the same team with two
  tables unapproved ≥ 85% of the time and an all-defaults team ≥ 95%).
- **Server** (`server.test.js`): the full API flow, the PIN rate limit, the clock, restart persistence,
  damaged-file recovery, static files and traversal.
- **UX** (`ux.test.js`): one vocabulary and tab order across tables.

---

## 18. Licence and credits

Released under **CC0 1.0 Universal** (public domain dedication); see `LICENSE`.

Podium 2027 is a teaching game. The "FIA 2027 Infrastructure Specification" is a fictional
specification modelled on the FIA's published Financial and Technical Regulations. Company and
product names (Supermicro, Dell, HPE, Lenovo, NVIDIA, AMD, Intel, Digital Realty, AWS and others) are
used to describe real-world categories and belong to their owners; no endorsement is implied. Market
figures draw on public sources such as CBRE's Global Data Center Trends 2026, OEM programme terms and
published cloud and software price guides, and are simplified into teaching estimates.
