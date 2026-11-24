# Podium 2027 · Audi F1 Team edition

A team game for sales teams (about 50 minutes) about solving a Formula 1 team's infrastructure
problems. **This build is the Audi F1 Team edition**: the customer is the Audi F1 Team (Hinwil,
Canton of Zurich), we are the colocation provider, and the decision on the table is **500 kW of
colocation in our Zurich campus versus staying on-prem in Hinwil**, as a credible 2027 plan with a
contractual path to 2028. See [Audi F1 Team edition](#audi-f1-team-edition) for the scenario, the
figures and how to change them.

**There is nothing to set up:** once the server is running the game is open, and teams add
themselves on the table iPads. Up to ten teams visit four tables. Each table is one customer problem: the team **reads the brief**, then
**locks three decisions, one tap each**, aiming to put every target gauge in its green zone **without
crossing a cap line**. Each team then pitches its board to the table's Solutions Architect (SA)
in 30 seconds and watches the approved boards race the Austin 2027 Grand Prix on the projector. Every
team then gets a one-screen readout: the lessons it achieved, what it could have done differently,
and one line on the 2028 path.

The point for the players is to learn **why each choice matters to the customer** and **how a
provider helps**. Every customer-specific figure lives in one file, `public/js/customer.js`, and is
either a VERIFIED public fact (with its source in `docs/audi-f1-sources.md`) or a labelled planning
ASSUMPTION. Prices are planning figures, not quotes. FIA references are to the real 2026 Financial
Regulations and the 2027 Aerodynamic Testing Restrictions (Section F, Art. F4); the team's own
operational standards appear as "Audi F1 requirement", never as a made-up FIA article.

## Contents

1. [The game in one minute](#1-the-game-in-one-minute)
2. [The session and the optional timer](#2-the-session-and-the-optional-timer)
3. [Screens, roles and the host PIN](#3-screens-roles-and-the-host-pin)
4. [Teams and the budget level](#4-teams-and-the-budget-level)
5. [The four tables](#5-the-four-tables)
6. [FIT, scoring and approval](#6-fit-scoring-and-approval)
7. [The race and the readouts](#7-the-race-and-the-readouts)
8. [Running an event](#8-running-an-event)
9. [Background service and public tunnel](#9-background-service-and-public-tunnel)
10. [Troubleshooting](#10-troubleshooting)
11. [Code and API](#11-code-and-api)
12. [Tests](#12-tests)
13. [Audi F1 Team edition](#audi-f1-team-edition)

---

## 1. The game in one minute

- **No setup, no host coordination.** Open the app and play: a new game is open, untimed and empty.
  The host only steps in to start a timer (optional) and to run the race.
- **Teams:** up to 10, and they create themselves. On any table iPad, under **Choose your team**,
  type a name and tap **Add your team**: no PIN, one tap, and the team is in with the next of ten
  colours. It appears in the team list on every other iPad. Every team plays the same four problems
  on the same budget.
- **Tables:** four, one iPad each, each with its own Solutions Architect: Connectivity, OEMs,
  Datacenter & Power and the CFD Supercomputer.
- **One outcome everywhere: Seconds found per lap.** Today's setup finds 0.00 s; a table in the
  zone finds 0.25–0.35 s; a cap or FIA breach is *not allowed* and finds nothing. A team's total
  (up to about 1.4 s) is what the host grid, the projector's **lap-time ladder**, the race and the
  readout all show.
- **At each table**, the team adds itself (its first table) or taps its name in the team list (every
  table after that), then works through three steps, which look the same on every table:
  1. **Brief:** the table's brief, written for a sales audience (`public/js/briefs.js`): *The
     situation*, *What the team wants* (with the numbers), *The rules* (the real FIA articles, the Audi F1
     requirements, both cap lines and what a breach costs), *Your three decisions* (what each setting does to
     performance, cost, power and risk, and the balance to strike), *How a provider helps* and
     *Words to know*. Everything needed to find an in-zone answer is in the brief. The **Tune** and
     **Pitch** steps stay closed until the team taps **I've read the brief. Take me to the
     decisions.**, which unlocks when the brief has been scrolled to its end or after 30 seconds (the
     server enforces it too).
  2. **Tune:** a live picture of the customer's problem sits at the top (an F1 car in the CFD wind
     tunnel, the data hall, the data path from the circuit through the Zurich campus to Hinwil, the rack row and its budget),
     with the problem sentence, the targets drawn on the scene, the seconds found and one
     plain-English outcome line ("You've found 0.31 s per lap and you're inside both caps"). Below
     it: 2–3 **targets** as gauges with a green zone, the **cap lines** (2027 capital, yearly cost-cap charge, and
     power where it matters), the **FIT** ring and three dials with three settings each. A grey
     needle and marker show **Today's setup**. **Nothing is selected when the table opens**, and
     **each choice locks the moment you tap it**: the dial reads *Tap once to lock* until the tap,
     then shows the locked setting; the counter reads **Locked 1 of 3**, and there is no undo. Every
     lock changes the scene, the needles and the bars at once. Each dial says *Why it matters to the
     F1 team* and *How a provider helps*. The first time a board gets **In the zone**, the team sees
     **What you just learned**. On scroll, the scene shrinks to a sticky strip of fixed height that
     keeps animating and keeps the seconds in view.
  3. **Pitch:** when all three are locked, **Call the Solutions Architect**, join the queue, pitch for
     30 seconds, and get **Approved** or **Rejected** (with a reason). A rejection reopens only that
     team's dials at that table, with last time's picks shown as ghosts; the team locks three new
     choices and calls the SA again, which takes time and the SA may be busy. Every attempt is
     counted (**Attempt 2**, **Attempt 3**…) and shown to the SA and in the readout.
- **Only approved boards count.** A table that was skipped, still adjusting or not approved races on
  **today's setup** (the customer's existing infrastructure, 0.00 s), and the readout says so.
- **The finale:** a 56-lap race animated in 30 seconds, then a readout for every team.

---

## 2. The session and the optional timer

The session needs no host to begin. The moment the server runs, every table is open: teams add
themselves, read the brief, lock their choices and pitch. By default there is **No timer**; the
header of every screen says so, in the place where a countdown would be.

| Phase | Clock shows | What happens |
| --- | --- | --- |
| Open session (default) | No timer | Play is open and nothing expires. |
| Play | A countdown | The host started the timer. Play is open until it reaches zero. |
| Paused | The frozen countdown | The host paused the timer. Tables stay open. |
| Time is up | TIME | The timer reached zero: every table locks. A board locked before then can still be pitched and approved. |
| Race | RACE | The race has run (30 seconds on the projector). Decisions are locked. |
| Readouts | RACE | The projector cycles through each team's readout; anyone can pick one to hold it on screen. |

**The timer is optional**, and lives in the host controls (section 3):

- **Start timer:** type the minutes (35 unless changed, 1–120) and tap **Start timer**.
- **Pause** / **Resume**, and **−5 / −1 / +1 / +5 min** while it runs.
- **Reset timer:** back to an untimed, open session.
- When the timer reaches zero the tables lock. **Start timer**, adding minutes or **Reset timer**
  reopens play.

**The race can run at any time**, with or without a timer: from the host controls, or from the
projector with the race password (the host PIN). Running it ends play. **Show readouts** follows,
and **Clear the race** discards the result and reopens play with no timer.

The projector always shows the current phase, the countdown when a timer is running, and the live
standings.

---

## 3. Screens, roles and the host PIN

| Screen | Address | Who |
| --- | --- | --- |
| Landing page | `/` | Everyone: the four tables first, then four lines on how to play, and small links to the projector and the host controls. |
| Table iPad | `/station.html?station=<id>` | Teams. No PIN. Ids: `network`, `oem`, `dc`, `compute`. |
| Host controls | `/host.html` | The **session host**, or a **Solutions Architect** (the host PIN plus their table). |
| Projector | `/race.html` | The big screen: phase, countdown, standings, the race, the readouts. |
| Team readout | `/race.html?team=t1` | One team's readout. The host controls list every link once the race has run. |

The old table ids `ai`, `storage` and `governance` show "This table is not in play" with links to
the four tables.

### The host PIN

One PIN protects everything a team must not be able to do: the timer, the race, clearing the race,
restarting, the budget level, renaming or removing a team, and every Solutions Architect action. The
server checks it on each of those requests. Adding a team, checking in, reading the brief, locking
choices and calling the SA need no PIN.

**The PIN is never shown.** No page, instruction, placeholder, message, address or log line contains
it; the screens only ever say "the host PIN". It is typed into a masked field, and a wrong PIN clears
the field. Ten wrong PINs from one address in five minutes lock that address out for five minutes.

**For whoever installs Podium:** the PIN is `SKO27` unless you change it. That default is set in
`server.mjs` (`DEFAULT_PINS`) and in the background-service installer (`EVENT_PIN` in
`scripts/install-service.sh`). The host, the Solutions Architects and the race password all use it.
To use different values, set these environment variables before starting the server or running the
installer (1–64 letters, digits, `_` or `-`); tell the people who need them in person, not on a
screen:

| Variable | Used for |
| --- | --- |
| `HOST_PIN` | The session host: everything in the host controls. |
| `LEADER_PIN` | The Solutions Architects. One shared PIN; each SA picks their table. (The variable keeps its old name so existing installs keep working.) |
| `RACE_PIN` | The race password asked for on the projector. |

### The host controls

`/host.html` opens on a single masked field for the host PIN. Entering it opens one page of controls:

- **Timer:** **Start timer** (minutes, default 35), **Pause** / **Resume**, add or remove minutes,
  **Reset timer** (section 2).
- **Race:** **Run race**, then **Show readouts** and **Clear the race**.
- **Approvals grid:** every team against every table: locks, attempts, pitches, seconds found and FIT.
- **Pitch queues:** one per table, with **Act as SA** to run any table's queue.
- **Live feed**, and the **readout links** once the race has run.
- **Teams:** the compact list of teams that have added themselves, each with **Rename** and
  **Remove**.
- **Budget level** (section 4).
- **Restart the experience:** one confirmation, then an empty, open, untimed game on the Standard
  budget. **Demo mode** and **Log out** sit beside it.

There is nothing to prepare before the session: no team list to type, no plan to edit.

### Solutions Architects

**A Solutions Architect** opens the same page, enters the host PIN, picks their table (and,
optionally, a name) and taps **Open my table**. A sign-in that names a table opens that table's SA
view; a sign-in without one opens the host controls. The SA is **Available** from the moment they
sign in, so there is nothing to switch on. They see only their table: the queue, **Start pitch** (a
30-second timer), the board exactly as the team locked it, which attempt this is, the table's brief,
and **Approve** or **Reject** with a reason (up to 120 characters). The server refuses SA actions
for any other table.

---

## 4. Teams and the budget level

**Teams add themselves.** On a table iPad, **Choose your team** lists the teams so far and, below
them, **Add your team**: type a name, tap once, and the team is in and sitting at that table. At its
next table the team just taps its name.

- Names are checked by the server: trimmed, 32 characters or fewer, control characters removed, not
  empty, and not the same as another team's name whatever the capitals ("There is already a team
  called …").
- Colours are given in order from the ten team colours; a removed team's colour is free again.
- **Ten teams at most.** After that the iPads say all ten places are taken and to ask the host to
  remove one.
- One address can add 30 teams in ten minutes, then has to wait: enough for any room, too few to
  flood the game.
- The host can **Rename** or **Remove** a team in the host controls until the race has run. Removing
  a team discards its choices and its place in every queue.
- There are no per-team tiers: every team plays the same problems.

**The budget level** is one setting for the whole session. It starts at **Standard**, and the host
can change it in the host controls until the first dial is locked (after that it would move the
cap lines under teams that have already decided; **Restart the experience** returns to Standard). It
moves every table's capital and cost-cap charge lines, never the physical power limits.

| Level | Cap lines | Effect |
| --- | --- | --- |
| Tight | 85% of Standard | One or two clean answers per table: a harder, more focused session. |
| Standard (default) | The season's allowance | Two to five answers per table. |
| Generous | 125% of Standard | Premium options come within reach (for example buying Dell, HPE or Lenovo outright, or dark fibre). |

Each table has its own slice of the infrastructure allowance, so a board is self-contained: what you
see on the table is everything that scores it.

---

## 5. The four tables

Each table has a brief, a problem, 2–3 targets, its cap lines and three dials. ★ marks today's setup
(everything on-prem in Hinwil). The briefs (`public/js/briefs.js`, 350–550 words each) carry every
figure below in plain English with `[source]` tags into `docs/audi-f1-sources.md`, so a team that
reads carefully can work out an in-zone answer before its first tap. Money is in CHF. The two cap
lines per table are the **2027 capital envelope** (one-off cash, an Audi F1 requirement) and the
**yearly cost-cap charge** (running cost plus straight-line depreciation of anything bought, which is
how purchased kit reaches the FIA cost cap, Financial Regulations D6.1.1.k).

### Connectivity (`network`): Connectivity Solutions Architect

*Problem:* link the Zurich campus to Hinwil, the trackside garage and Neuburg fast and reliably at every race.
*Caps (Standard):* capital CHF 500k, cost-cap charge CHF 600k a year.
*Targets:* trackside → Zurich round trip 120 ms or less · race-weekend availability 99.9% or more · rules and requirements pass.

| Dial | Settings |
| --- | --- |
| Paths Hinwil ↔ Zurich campus | ★ Single route (breaks the Audi F1 two-paths requirement) · Two diverse routes · Two routes + satellite |
| Route from the circuit to Zurich | ★ Public internet · Private circuit into the campus · Private WAN + edge PoP |
| Car data out of the garage | Unmanaged garage Wi-Fi (breaks the Audi F1 wired-data requirement) · ★ Wired umbilical · Umbilical + garage edge node |

### OEMs (`oem`): OEM Solutions Architect

*Problem:* refresh Hinwil's hardware for 2027 under the cost cap, delivered before the Bahrain test, fixed fast on race weekends.
*Caps:* capital CHF 3.0M, cost-cap charge CHF 1.9M a year.
*Targets:* performance 2.0× today or more · race-weekend fix time 4 hours or less · lead time 12 weeks
or less.

| Dial | Settings |
| --- | --- |
| Hardware | ★ Incumbent, last generation (CHF 2.0M) · Dell, HPE or Lenovo (CHF 3.4M) · NVIDIA DGX, newest (CHF 5.5M) |
| How you pay | ★ Buy outright (depreciated over 4 years) · Lease · As-a-service (Dell, HPE or Lenovo only; DGX falls back to a lease) |
| Race-weekend support | ★ Basic · Next business day · 4-hour, 24/7 |

### Datacenter & Power (`dc`): Datacenter Solutions Architect

*Problem:* house, power and cool the 400 kW 2027 estate, with a path to 2028, inside the cost cap.
*Caps:* capital CHF 1.9M, cost-cap charge CHF 2.1M a year (fees, metered power, plant depreciation over 10 years), plus the IT load against the site's supply.
*Targets:* power and cooling 100% of the 2027 need or more · PUE 1.30 or less · N+1 or 2N (an Audi F1 requirement).

| Dial | Settings |
| --- | --- |
| Where the 2027 cluster lives | ★ Hinwil data room (300 kW, single feed) · Zurich campus, 500 kW (CHF 180 per kW a month, 2N power, N+1 cooling, expansion right to 1,000 kW) · Remote low-cost region (single grid feed; F4.4.3 re-declaration) |
| Cooling | ★ Air · Rear-door water · Direct-to-chip liquid |
| Power setting | Capped at 85% · ★ Standard · Max boost |

### CFD Supercomputer (`compute`): CFD Solutions Architect

*Problem:* run the season's aero simulations inside the team's 6.3 MAUh allowance (P8 in 2026 → 105% of
the 6 MAUh baseline, FIA F4.6.1), on declared CPU cores in 2027 (F4.4.1), each design cycle back the same day.
*Caps:* capital CHF 2.4M, cost-cap charge CHF 600k a year, plus cluster power against the room's 120 kW CFD allocation.
*Targets:* 10 or more design cycles a week · solver compute 100% of the MAUh allowance or less · nodes kept fed 90%
or more.

| Dial | Settings |
| --- | --- |
| Declared cluster size | ★ 8 nodes · 12 nodes (sized to the allowance) · 20 nodes |
| Chips | ★ CPU-only solver · CPU solver + GPU partition · GPU solver (not allowed before 1 Jan 2028, F4.4.1) |
| Storage | ★ Office NAS · Parallel file system · Parallel + flash cache |

**In-zone answers at Standard** (FIT in brackets; the tests require at least two per table):

- Connectivity: two diverse routes + private circuit + umbilical (95); satellite + private circuit +
  umbilical (91); two routes + private circuit + edge node (86); two routes + private WAN + umbilical (84).
- OEMs: Dell/HPE/Lenovo as-a-service + 4-hour (97); Dell/HPE/Lenovo lease + 4-hour (96). Buying
  Dell/HPE/Lenovo outright only fits the Generous envelope.
- Datacenter & Power: Zurich campus + rear-door + 85% cap (88); campus + rear-door + standard (87);
  campus + liquid + 85% cap (87); campus + liquid + standard or boost (86).
- CFD: 12 nodes + CPU + parallel (96); 12 nodes + CPU + flash cache (91). 12 nodes + GPU partition +
  parallel fits the Generous allowance.

**Today's setup** scores 27 (Connectivity: a single route breaks the Audi F1 requirement), 33 (OEMs),
27 (Datacenter & Power: the 300 kW Hinwil room cannot power the 400 kW 2027 load) and 63 (CFD: too
few cycles).

---

## 6. FIT, scoring and approval

### The scenes and seconds found per lap

Every table's board opens on a live SVG scene (`public/js/scene.js`, CSS animation plus SMIL motion
for packets; no libraries). It is built once and updated in place on every dial, and paused when the
tab is hidden or the device asks for reduced motion. Thumbnails (pitch preview, lock-in snapshot,
readout) are still.

| Table | The scene | What reacts |
| --- | --- | --- |
| CFD Supercomputer | An F1 car in a **wind tunnel**, a tunnel display and an "Aero efficiencies found this week" counter | Streamline count follows design cycles; the flow turns smooth once nodes are fed (≥ 90%) and cycles reach 10; downforce arrows grow; the display shows "Lap time −0.xx s"; over the MAUh allowance a red FIA F4.6.1 flag flashes and cycles read "not allowed". |
| Datacenter & Power | A hall cross-section with six racks (signed Hinwil data room, Zurich campus · 500 kW or Remote low-cost region), a PUE meter and a power meter against the kW available | Rack glow follows cluster speed; throttled racks dim and read "Cluster running at 70%"; heat shimmer with air cooling (throttled or boosted); air flow, rear-door strips or liquid loops by cooling; N+1 generators appear at the campus. |
| Connectivity | The circuit on the left, the Zurich campus and Hinwil Mission Control on the right, packets travelling between them | Packet speed follows latency ("Strategy call lands in 110 ms"); a second route appears with two routes, a satellite and a third path with satellite backup; packets drop on the public internet or a single route; garage Wi-Fi flashes an "Audi F1 req." flag; an edge node appears in the garage. |
| OEMs | A rack row, a performance bar against 2× today, capital and cost-cap jars, a support clock and a lead-time calendar | Old servers slide out for current-generation or DGX ones; the bar fills; the jars fill by payment model (buy, lease, as-a-service); the clock reads 72 h, next day or 4 h; the delivery marker moves against the Bahrain test. |

Each scene carries one label per dial (8 words or fewer), with the seconds that dial found against
today's setting, for example "Liquid cooling: cluster at 100% (+0.16 s)".

**Seconds found per lap** (`outcomeOf` in `public/js/model.js`), per table:

- a cap, FIA-rule or Audi F1 requirement breach: **0.00 s, not allowed** ("Over the capital envelope: the finance board would not sign it");
- in the zone: **0.25 + 0.10 × (FIT − 80) ÷ 20**, so 0.25–0.35 s (more spare budget, more time);
- otherwise: **0.20 × progress from today's FIT towards 80**, so 0.00–0.20 s, with the line naming
  the worst miss ("Latency too high: the strategy call arrives too late").

The reference build finds 0.32 + 0.34 + 0.28 + 0.33 = 1.27 s per lap at Standard.

**FIT (0–100)** is one number per board. Each target has a closeness from 0 to 1, where 1 means it is
in its green zone. When every target is in the zone, FIT is 80 plus up to 20 for spare budget (the
average share of each money cap left unused, with half a cap spare earning the full 20). Otherwise FIT
is 70 × the average closeness. **Any cap breach (capital, cost-cap charge or power), FIA-rule or requirement breach caps FIT at
40**, so an over-cap board can never score well. The board shows FIT as a ring with one sentence and
one hint that names the single dial setting that fixes the most urgent problem.

**Approval gates everything.** When the Solutions Architect approves a locked board, the team earns
`round(FIT × 1.1 ÷ 4)` table points (up to 28 per table). A table that is never locked (*missed*),
or locked but not approved (*not approved*), earns nothing and races on today's setup. A rejected
team's dials reopen at that table only (its previous picks shown as *last time* ghosts); it locks
three new choices and queues for the SA again while play is open, and the attempt count goes up.
A board locked before the timer ran out can still be pitched and approved afterwards.

**Penalties** are rolled in the race with fixed chances. FIA articles are stewards' matters; an
ignored Audi F1 requirement bites operationally; an envelope overrun is a finance review:

| Breach | Table | Chance | Points |
| --- | --- | --- | --- |
| Single route (Audi F1 requirement) | Connectivity | 60% | −5 (operations) |
| Garage Wi-Fi (Audi F1 requirement) | Connectivity | 80% | +5 s at the stop, no points |
| GPU solver before 2028 (FIA F4.4.1) | CFD | 60% | −8 |
| Over the MAUh allowance (FIA F4.6.1) | CFD | 60% | −8 |
| Over the capital envelope (finance) or the cost-cap charge line (FIA) | any | certain | −10 |

A site without N+1 or 2N breaks a target, not a rule: it costs the zone and shows up as a power blip
in the race rather than as a penalty.

**Final score** = table points + race points × 4 − penalty points. Race points follow F1:
25, 18, 15, 12, 10, 8, 6, 4, 2, 1.

---

## 7. The race and the readouts

The race is the Austin 2027 Grand Prix at the Circuit of the Americas: 56 laps animated in 30
seconds. It is deterministic for a seed, so a rerun with the same seed gives the same result.

Lap pace is **96 s minus the team's seconds found per lap**: the sum over the four boards it raced
(approved boards as tuned, the rest on today's setup at 0.00 s). Strategy quality follows the
Connectivity and CFD FITs. Before the race the projector shows the **lap-time ladder**: one car per
team, in its colour, as far right as its approved seconds, with four mini FIT gauges; cars slide
and reorder as approvals land. With no teams yet, the projector says so and waits: each team gets a
car the moment it adds itself.
Incidents follow visible dial settings, and each names its dial:

- **Connectivity:** a drop on a single route to Mission Control, public-internet jitter, a fibre cut
  between Hinwil and Zurich (satellite backup survives it, two routes lose 0.8 s, a single route
  loses 4 s), the garage edge node's gain, and a Wi-Fi stall at the stop.
- **OEMs:** last-generation kit runs too few what-ifs, late delivery, and a failed node (saved by
  4-hour support, costly with basic support).
- **Datacenter & Power:** a power blip without N+1, throttling when cooling falls short, and a heat
  spike (air cooling and max boost suffer; an 85% cap stays stable).
- **CFD:** too few design cycles, slow storage, the flash cache's gain, and tripping the room's 120 kW CFD allocation.

**Balance** (checked in the tests over 200 seeds for every budget level): a team with four approved
in-zone boards beats the same boards with two tables unapproved at least 85% of the time, and beats
today's setup at least 95% of the time.

**Each readout** shows:

- one line: "You found 1.26 s per lap; the race said P1 of 10, a win and 128 points.";
- the seconds found, the finishing position, the championship position and the points;
- each table's final scene thumbnail with its seconds and FIT, grey if it raced on today's setup;
- **What went well:** 2–3 lessons achieved (each in-zone approved board says why it matters);
- **What you could have done differently:** 2–3 suggestions, each naming the dial, the better
  setting, the seconds and FIT gain, why it matters and how a provider helps;
- **2028 path:** one line on whether the boards the race used carry the 800 kW 2028 load and the
  GPU-solver rule (where the cluster lives, its cooling, the chips, the routes);
- the incidents that affected the team.

Readouts are at `/race.html?team=<id>` and are listed in the host controls. Once the host taps
**Show readouts**, the projector cycles through every team every 20 seconds; tap a team in the
chooser to hold it.

**Demo mode** (in the host controls) walks through eight steps with sample data on the CFD table:
add your team and the brief → tune (out of the zone, with live dials and a **Lock a dial for me**
button that changes the wind tunnel) → in the zone → pitch → rejected → approved → race → readout.
It does not touch the real game.

---

## 8. Running an event

**Requirements.** Node.js 18 or newer. There are no npm packages: do not run `npm install`.

**Quick start on a Mac.** Double-click `start.command`. It finds Node (including nvm), starts Podium
on this Mac only and opens `http://localhost:8080/`. From Terminal: `npm start`.

**On Wi-Fi for iPads.**

```bash
npm run start:lan            # the host PIN is the default unless HOST_PIN is set (section 3)
```

The line starting `iPads` gives the room address, for example `http://192.168.1.20:8080/`. Every
device must be on the same network. If the background service (section 9) is running, stop it first:
`launchctl bootout gui/$(id -u)/com.podium.server`.

Lock each iPad to its table page with **Guided Access** (Settings → Accessibility → Guided Access,
then triple-click the side button).

**On the day.** There is no setup step. Open each iPad on its table page and the projector on
`/race.html`; teams add themselves as they sit down. Start the timer if you want one, and run the
race when the room is ready.

**Rehearsal checklist.**

- [ ] The host PIN opens the host controls, and with a table chosen opens that table's SA view.
- [ ] Four iPads on their table pages, each showing **Add your team**. A test team added on one iPad
      appears in the list on the others.
- [ ] Projector on `/race.html`, showing "No timer" and the lap-time ladder as teams appear.
- [ ] One pitch rehearsed: Add your team → I've read the brief → three taps (Locked 3 of 3) → Call the
      Solutions Architect → Start pitch → Approve, and one Reject to see the dials reopen as Attempt 2.
- [ ] If you want a countdown: **Start timer**, then **Reset timer**, tried once.
- [ ] **Run race** tried from the projector (the race password is the host PIN), then **Clear the
      race**.
- [ ] **Restart the experience** before the doors open, so the game is empty.
- [ ] Laptop on power, with sleep disabled.

---

## 9. Background service and public tunnel

**Background service (macOS).** A LaunchAgent (`com.podium.server`) starts Podium at login on port
8080 and restarts it within about two seconds if it stops.

```bash
sh scripts/install-service.sh                                        # install; HOST_PIN=… LEADER_PIN=… RACE_PIN=… in front to change the PINs
launchctl kickstart -k gui/$(id -u)/com.podium.server                # restart
launchctl bootout gui/$(id -u)/com.podium.server                     # stop until next login
sh scripts/uninstall-service.sh                                      # remove, keep the game
```

The PINs are written into the LaunchAgent plist, which only your user can read.

**Data.** The game is saved to `data/state.json` after every change, so restarts keep it. Logs go to
`data/logs/`. Set `DATA_DIR` to store the game elsewhere. Back up `data/state.json` before an event.
An unreadable save is renamed `state.json.damaged-<time>` and a blank game starts. Older saves load
as they are: a game the host had set up but not started, or one in the host-run brief, opens as an
untimed open session with its teams, choices, locked boards, reviews and attempts kept; a running or
paused timer keeps running or stays paused; a finished race and its readouts are kept. Saves from the
old six-table game load into the four-table game, keeping only valid choices.

**Public tunnel for testing.** A Cloudflare Quick Tunnel gives a temporary HTTPS address with no
account. It needs `cloudflared` (`brew install cloudflared`).

```bash
sh scripts/install-tunnel.sh      # install and start com.podium.tunnel
sh scripts/tunnel-url.sh          # print the current https://….trycloudflare.com address
sh scripts/uninstall-tunnel.sh    # remove it
sh scripts/start-tunnel-window.sh # fallback: run it in a Terminal window
```

The tunnel uses HTTP/2 over TCP 443 (`PODIUM_TUNNEL_PROTOCOL=quic` switches to QUIC). Its runner
lives in `~/Library/Application Support/Podium/` and its log in `~/Library/Logs/Podium/tunnel.log`,
because macOS stops LaunchAgents from reading `~/Documents`. **The URL changes whenever the tunnel
restarts.** Anyone with the URL can add a team and play, so share the URL only with the people
testing or playing, set your own PINs for anything public (section 3), and restart the experience
afterwards.

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `node: command not found` | Install Node 18+ from [nodejs.org](https://nodejs.org), or use `start.command`, which finds nvm. |
| Port 8080 in use | `lsof -nP -iTCP:8080 -sTCP:LISTEN`, or `PORT=8090 npm start`. If it is Podium, a second start just opens the browser. |
| "Podium needs its server" | An `.html` file was opened from Finder. Use `http://localhost:8080/`. |
| "Reconnecting to the game server" | The server is restarting. It recovers on its own; choices are re-sent. |
| An iPad shows no teams | Nobody has added one yet. Type a name under **Add your team** and tap once. |
| "There is already a team called …" | That name is taken (capitals do not count). Tap the team in the list, or choose another name. |
| "All 10 team places are taken" | Ten teams is the limit. The host can **Remove** one in the host controls. |
| "Too many new teams from this device" | One address added 30 teams in ten minutes. Wait a few minutes, or tap an existing team. |
| The header says "No timer" | That is the default: play is open and nothing expires. The host can **Start timer** in the host controls. |
| "Time is up" on an iPad | The timer reached zero. Locked boards can still be pitched; the host can **Start timer**, add minutes or **Reset timer** to reopen play. |
| "The race has run: decisions are locked" | The host can **Clear the race** to reopen play. |
| "Waiting for the SA" | The team is in the queue. The table's SA taps **Start pitch**, or the host uses **Act as SA**. |
| "Wrong PIN" / "Host PIN required" | The field wants the host PIN. Whoever installed Podium has it (section 3); it is not shown on any screen. |
| The budget level will not change | A dial is already locked somewhere. **Restart the experience** returns to Standard and reopens the choice. |
| A team's dials are greyed out | The brief gate: the team has not tapped **I've read the brief** on this iPad for this table (the server refuses choices until it does), or the table is locked, waiting for the SA, or approved. |
| "That choice is locked" | One tap decides a dial. Only a **Reject** by the SA reopens that team's dials at that table. |
| "Too many failed PIN attempts" | Ten wrong PINs from one address in five minutes lock it out for five minutes. |
| Tunnel shows Cloudflare 530 / 1033 | `tail -40 ~/Library/Logs/Podium/tunnel.log`; re-run `sh scripts/tunnel-url.sh` (the URL may have changed); re-run `install-tunnel.sh`. |

---

## 11. Code and API

```text
server.mjs               Node HTTP server: static files, JSON API, state, persistence (no dependencies)
public/index.html        landing page            public/station.html   table iPad
public/host.html         host controls / SA view  public/race.html     projector and readouts
public/case.html         the business case (Hinwil on-prem vs the Zurich campus, 2027 and 2028)
public/js/customer.js    every customer-specific figure, annotated VERIFIED (source row) or ASSUMPTION (rationale)
public/js/case.js        caseModel(): the business-case arithmetic (formulae in the header comment) and its page
public/js/briefs.js      the four briefs (situation, wants, rules, decisions, provider, words to know)
public/js/briefview.js   renders a brief, with the #briefEnd sentinel the brief gate watches
public/js/catalog.js     tables, problems, targets, caps, dials, budget levels, today's setup (the game data)
public/js/model.js       boardFor(): gauges, cap bars, rule chips (FIA articles and Audi F1 requirements), FIT, seconds found, sentence and hint; evaluate() for the race
public/js/scene.js       the live scenario per table (wind tunnel, hall, data path, rack row) and its labels
public/js/board.js       the tuning board (scene, SVG gauges, cap bars, FIT ring, dials), shared by every screen
public/js/session.js     the phase (open, play, paused, ended, race, readout) and the countdown: the single source
public/js/race.js        the seeded race and its incidents
public/js/report.js      the podium and each team's readout, including the 2028 path line
public/js/plan.js, plandata.js, summary.js   the locked board snapshot and the SA's summary
public/js/station.js, host.js, raceview.js, readoutview.js, approval.js, podium.js, ui.js, demo.js
docs/audi-f1-sources.md  the fact pack behind customer.js: every public source (URL, access date) and every assumption
scripts/                 macOS service and tunnel helpers
tests/                   node:test suites
```

The browser and the server share the same ES modules, so the board an iPad shows is exactly the board the server locks in (the server is authoritative at lock-in). State is one
JSON document; every change increments `version`, and clients poll `GET /api/state?since=<version>`.

**Routes.** Host routes need the header `x-pin: <HOST_PIN>`. SA routes need `x-pin: <LEADER_PIN>` and
`x-station: <table>`, and the host PIN works for any table. A PIN travels only in that header or in
the JSON body of a login or race request: never in an address, a response or a log line. PINs are
compared in constant time, and failed attempts are rate limited per client IP (`CF-Connecting-IP`
behind the tunnel). Team routes need no PIN.

| Route | Purpose |
| --- | --- |
| `GET /api/state`, `GET /api/health`, `GET /api/presence` | Read the game; health includes the phase. |
| `POST /api/login` | `{pin, station?}` → `{role: "host" \| "architect", station?}`. With a table it signs in that table's SA (and marks them Available); without one, the host. |
| `POST /api/teams` | No PIN. `{name}` → `201 {team}`: a team adds itself. `400` for an empty or over-long name, `409` for a duplicate name, a full game (10 teams) or once time is up or the race has run, `429` past 30 new teams per address in ten minutes. |
| `POST /api/host/timer` | `{action: start \| pause \| resume \| add \| reset, minutes?}`. `start` takes 1–120 whole minutes (default 35); `add` takes whole minutes, negative to remove; `reset` returns to no timer. Refused once the race has run. |
| `POST /api/host/race` | Run the race on the host PIN (optional `seed`). Ends play. |
| `POST /api/race/run` | Run the race from the projector: `{password, seed?}`, where `password` is the race password. |
| `POST /api/host/readout`, `POST /api/host/unrace` | Show the readouts; clear the race and reopen play with no timer. |
| `POST /api/host/team` | `{team, action: rename \| remove, name?}`. Refused once the race has run. |
| `POST /api/host/budget` | `{budget: tight \| standard \| generous}`. Refused once any dial is locked. |
| `POST /api/host/queue`, `POST /api/host/reset` | Manage a pitch queue; restart with an empty, open, untimed game. |
| `POST /api/architect/availability`, `/pitch`, `/decide` | Available toggle, start/stop a pitch, approve or reject (`{team, station, decision: "approve" \| "reject", reason?}`). |
| `POST /api/teams/<id>/checkin \| brief \| sim \| choices \| call \| presence \| checkout` | Team actions from a table iPad (no PIN). `brief` records that the brief was read for `{station}`; `choices` locks one dial at a time (`{station, choices: {dial: setting}}`) and is refused before the brief is read, for a dial already locked, or once time is up or the race has run. |

---

## 12. Tests

```bash
npm test
```

The suites (`node:test`, no dependencies) cover:

- **Catalog and model:** 4 tables × 3 dials × 3 settings, the word limits (problem ≤ 20 words, setting
  ≤ 12, why/how ≤ 18), FIT (a cap or FIA breach caps it at 40), at least two in-zone answers per
  table inside the caps, today's setup out of the zone everywhere, the budget level moving the cap
  lines, the plan, summary and race reading the same board, seconds found (0.00 on today's setup,
  0.25–0.35 in the zone, breaches not allowed) and the team total (approved tables only).
- **Race:** determinism, incidents tied to dials, pace from the seconds found, the balance over 200
  seeds per budget level (printed as `[balance]` lines), and a 10-team race with board thumbnails,
  lessons, suggestions and "You found X s per lap" in every readout.
- **Server:** a new game open with no host action, teams adding themselves (name checks, duplicates,
  the 10-team limit, the per-address limit), the timer (start, pause, resume, add, reset, expiry), the
  host PIN on every host and SA route and in no response, the brief gate, one-tap locks, call, pitch,
  approve and reject (reopening one team at one table, attempts counted), the race at any time and
  clearing it, SA scoping, rate limiting, persistence, migration of older saves, a damaged save, and
  static-file safety.
- **UX:** one vocabulary (Scenario, Tune, Seconds found per lap, FIT, In the zone, Today's setup…),
  the two tabs, scene labels of 8 words or fewer across every dial combination, the demo dial
  changing the wind tunnel, no retired product names, no tiers or old score bands, dead modules
  removed, the phases, the demo steps, the landing page, and the host PIN appearing in no file under
  `public/` and exactly once in this README.
- **Browser** (headless Chrome, skipped if Chrome is not installed): from an empty game with no host
  action, a team adds itself on a table iPad, reads the brief, locks three dials and calls the SA; the
  page never moves while polling; a rejection reopens the dials; the host controls open behind one
  masked PIN field, start and reset the timer and run the race; no JavaScript errors.

---

## Audi F1 Team edition

### The scenario

The customer is the **Audi F1 Team** (entrant "Audi Revolut F1 Team"; the Sauber Group in Hinwil,
Canton of Zurich, became Audi's works team for 2026). Its race cars, race operations ("Mission
Control"), wind tunnel and today's data room are in Hinwil, about 30 km from Zurich; the power unit
comes from Neuburg an der Donau and a technology centre opened in Bicester in 2025. We are the
colocation provider. The decision on the table: **500 kW of colocation in our Zurich campus for 2027,
with a contractual expansion right to 1,000 kW for 2028, versus staying on-prem in Hinwil.**

Everything the game says about the customer is one of two things:

- a **VERIFIED** public fact: the row in `docs/audi-f1-sources.md` gives the source URL and the access
  date (24 Nov 2026), for example the 2026 Financial Regulations (USD 215M cost cap, Art. D4.1.2; no
  separate capital allowance, straight-line depreciation under D6.1.1.k; Property Costs and
  heat-recovery kit excluded), the 2027 Aerodynamic Testing Restrictions (Section F Art. F4: 6 MAUh
  per period at 100%, AUh = cores × seconds × peak GHz ÷ 3600, CPU-only solver until GPUs are allowed
  on 1 January 2028, re-declaration within a month of a change of location), Audi's P8 in the 2026
  championship (105% on the sliding scale, so 6.3 MAUh), ElCom/EKZ/ewz 2026–2027 tariffs, Zurich
  data-centre norms and the 2027 calendar (Austin, 22–24 October, stays the game's finale);
- a labelled **ASSUMPTION** with a one-line rationale: today's room (≈ 300 kW, PUE ≈ 1.6, single
  feed), the 2027 IT load (≈ 400 kW) and the 2028 load (≈ 800 kW), our fee (CHF 180 per kW per
  month, power metered on top), fit-out and migration (CHF 1.2M), the all-in planning tariffs
  (16 Rp/kWh Hinwil, 15 Rp/kWh campus), the planning FX (1 USD = 0.84 CHF) and the node arithmetic
  behind "12 nodes sized to the allowance".

Nothing is claimed about the customer's internal IT, contracts, partners or prices beyond the public
record; the team's own operational standards (two diverse paths, wired car data, N+1/2N) are shown as
"Audi F1 requirement", never as an FIA article.

### How to run tomorrow's demo

1. `npm start` (or `PORT=8199 DATA_DIR=/tmp/podium-audi node server.mjs` for a throwaway game), then
   open `http://localhost:8080/`. The header reads *Audi F1 Team · Hinwil → Zurich campus · 2027
   plan, 2028 path*.
2. Open the **Business case** (`/case.html`, linked from the landing page and the host console) on
   the projector first: Hinwil as is, Hinwil upgraded and the Zurich campus side by side for 2027 and
   2028 (IT load, PUE, facility kWh, electricity in CHF, fee, one-off, yearly cost-cap charge, 3-year
   TCO 2027–2029, CO2, resilience, 2028 headroom, heat reuse, cost-cap treatment). Move the sliders
   (electricity prices, 2027 and 2028 loads, fee) live; **Print** gives a clean handout with the
   values and the sources.
3. Play the four tables as usual (section 1). The briefs carry the real numbers with `[source]` tags;
   the in-zone answers at Standard are listed in section 5. **Datacenter & Power** is the table that
   makes the sale: the Hinwil room cannot power the 2027 load, the remote region has one grid feed,
   and only the campus meets the Audi F1 N+1/2N requirement with 2028 headroom.
4. Run the race from the host console. Each readout ends with a **2028 path** line.
5. **Demo mode** on the host console still plays all eight steps end to end with the edition's
   boards.

### Every assumption, and how to change it

All customer-specific figures live in **`public/js/customer.js`** as annotated entries:
`v(value, "A3")` is VERIFIED (the key points at a row of `docs/audi-f1-sources.md`) and
`a(value, "why")` is an ASSUMPTION with its rationale. `FIGURES` is the same tree with the annotations
stripped, and `annotatedFigures()` lists every entry for the business-case page's sources table. The
catalog, the briefs, the scenes, the race, the readouts, the business case and this README all derive
from it; change a figure there and everything follows (then run `npm test`, which pins the
in-zone counts and the word limits).

| Figure | Value | Status | Where |
| --- | --- | --- | --- |
| 2027 IT load | 400 kW (350–450) | ASSUMPTION B-a | `load.it2027KW` |
| 2028 IT load | 800 kW (700–900) | ASSUMPTION B-b | `load.it2028KW` |
| Today's room | 300 kW, PUE 1.6, single feed | ASSUMPTION A-a..A-c | `room.*` |
| Hinwil upgrade | CHF 3.0M → 450 kW, PUE 1.4, N+1 | ASSUMPTION A-e | `room.upgrade*` |
| Campus offer | 500 kW, PUE 1.2, 2N/N+1, CHF 180/kW/month, CHF 1.2M fit-out + migration, expansion right 1,000 kW | ASSUMPTION D-d | `offer.*` |
| Electricity | Hinwil 16 Rp/kWh (EKZ 2027 MV 17.11/12.91 + CHF 8/kW/month), campus 15 Rp/kWh (ewz 2027 NNC) | ASSUMPTION D-a/D-b on VERIFIED D2/D3 | `tariffs.*` |
| Grid CO2 | 75 g CO2eq/kWh | ASSUMPTION D-c on VERIFIED D4 | `tariffs.gridCO2gPerKWh` |
| FX | 1 USD = 0.84 CHF planning; FIA rate 1.1316 USD/CHF | ASSUMPTION E-a / VERIFIED C2 | `fx.*` |
| Cost cap | USD 215M (CHF 190.0M at the FIA rate) | VERIFIED C1 | `fia.costCapUSD` |
| ATR | P8 → 105% → 6.3 MAUh, 336 runs, 84 wind-on hours | VERIFIED A12, C4, C5 | `fia.atr*`, `fia.mauh*` |
| Depreciation | IT 4 years, plant 10 years | ASSUMPTION | `fia.depreciationYears*` |
| Cluster node | 128 cores, 3.7 GHz, 75% solver share, 1.2 kW, CHF 65k | ASSUMPTION | `cluster.*` |

The game's own money lines (each table's capital envelope and cost-cap charge allowance, option
prices) are in `public/js/catalog.js`, derived from `customer.js` where they touch the customer.

### Where the facts live

- `docs/audi-f1-sources.md`: the fact pack. Sections A (customer), B (load assumptions), C (FIA
  regulations), D (Swiss context), E (calendar and FX), F (how the figures flow into the product).
  Every row is VERIFIED (URL + access date) or ASSUMPTION (rationale).
- `public/js/customer.js`: the same figures as code.
- `public/case.html` + `public/js/case.js`: the business case, with the formulae in a comment at the
  top of `case.js`.

**Open questions for the customer** (the assumptions that matter most): the data room's real
capacity, PUE and resilience today; the 2027 and 2028 IT load; whether the colocation fee's space
component can be presented as Property Costs and the fit-out as a leasehold improvement under the
Financial Regulations (`C3-open`); the team's depreciation policy for plant; and whether the 2028
GPU partition is planned for the first 2028 period.

