# Podium 2027

A 50-minute team game for sales teams about solving a Formula 1 team's infrastructure problems. Up to
ten teams visit four tables. Each table is one customer problem: the team **reads the brief**, then
**locks three decisions, one tap each**, aiming to put every target gauge in its green zone **without
crossing a cost cap line**. Each team then pitches its board to the table's Solutions Architect (SA)
in 30 seconds and watches the approved boards race the Austin 2027 Grand Prix on the projector. Every
team then gets a one-screen readout: the lessons it achieved, and what it could have done differently.

The point for the players is to learn **why each choice matters to the customer** and **how a
provider helps**. Prices, speeds and rules are **teaching estimates**, not quotes. The "FIA rules"
are a simplified, fictional version of the real regulations.

## Contents

1. [The game in one minute](#1-the-game-in-one-minute)
2. [The 50-minute session](#2-the-50-minute-session)
3. [Screens, roles and PINs](#3-screens-roles-and-pins)
4. [Teams and the budget level](#4-teams-and-the-budget-level)
5. [The four tables](#5-the-four-tables)
6. [FIT, scoring and approval](#6-fit-scoring-and-approval)
7. [The race and the readouts](#7-the-race-and-the-readouts)
8. [Running an event](#8-running-an-event)
9. [Background service and public tunnel](#9-background-service-and-public-tunnel)
10. [Troubleshooting](#10-troubleshooting)
11. [Code and API](#11-code-and-api)
12. [Tests](#12-tests)

---

## 1. The game in one minute

- **Teams:** 1 to 10. Each has a name and one of ten colours. Every team plays the same four problems
  on the same budget.
- **Tables:** four, one iPad each, each with its own Solutions Architect: Connectivity, OEMs,
  Datacenter & Power and the CFD Supercomputer.
- **One outcome everywhere: Seconds found per lap.** Today's setup finds 0.00 s; a table in the
  zone finds 0.25–0.35 s; a cap or FIA breach is *not allowed* and finds nothing. A team's total
  (up to about 1.4 s) is what the host grid, the projector's **lap-time ladder**, the race and the
  readout all show.
- **At each table**, the team picks itself from the team list, then works through three steps, which
  look the same on every table:
  1. **Brief:** the table's brief, written for a sales audience (`public/js/briefs.js`): *The
     situation*, *What the team wants* (with the numbers), *The rules* (the FIA rule numbers, both
     cost caps and what a breach costs), *Your three decisions* (what each setting does to
     performance, cost, power and risk, and the balance to strike), *How a provider helps* and
     *Words to know*. Everything needed to find an in-zone answer is in the brief. The **Tune** and
     **Pitch** steps stay closed until the team taps **I've read the brief. Take me to the
     decisions.**, which unlocks when the brief has been scrolled to its end or after 30 seconds (the
     server enforces it too).
  2. **Tune:** a live picture of the customer's problem sits at the top (an F1 car in the CFD wind
     tunnel, the data hall, the data path from Austin to the factory, the rack row and its budget),
     with the problem sentence, the targets drawn on the scene, the seconds found and one
     plain-English outcome line ("You've found 0.31 s per lap and you're inside both caps"). Below
     it: 2–3 **targets** as gauges with a green zone, the **cap lines** (CapEx, yearly OpEx, and
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

## 2. The 50-minute session

| Phase | Default | What happens |
| --- | --- | --- |
| Brief | 5 min | The host explains the game. iPads show "Listen to the brief" and block choices. |
| Play | 35 min | Teams move freely between tables: read the brief, lock three choices, pitch. When time is up, every table locks. |
| Race | 30 s | The host or the projector runs the race with the race password. |
| Readout | 9 min | The projector cycles through each team's readout; anyone can pick one to hold it on screen. |

The host can change the four lengths before the session starts (1–120 minutes; the race is always
30 seconds). During a phase the host can add or remove minutes, and can pause, resume or end play.
The projector always shows the current phase, its countdown and the live standings.

**Host controls, in order:** **Start brief** → **Start play** (or **Skip to play**) → **Pause**,
**−5/−1/+1/+5 min** → **End play** → **Run race** (race password) → **Show readouts**.
Adding minutes after play has ended reopens play.

---

## 3. Screens, roles and PINs

| Screen | Address | Who |
| --- | --- | --- |
| Landing page | `/` | Everyone: the four tables, the roles, and short instructions. |
| Table iPad | `/station.html?station=<id>` | Teams. No PIN. Ids: `network`, `oem`, `dc`, `compute`. |
| Host console | `/host.html` | The **session host**, or a **Solutions Architect** (the PIN plus their table). |
| Projector | `/race.html` | The big screen: phase, countdown, standings, the race, the readouts. |
| Team readout | `/race.html?team=t1` | One team's readout (`t1` to `t10`). The host console lists every link. |

The old table ids `ai`, `storage` and `governance` show "This table is not in play" with links to
the four tables.

**One PIN: `SKO27`.** The host, the Solutions Architects and the race password all use it, and it is
the default in the code, in `start.command` and in the background-service installer, so a fresh
install or a restart always accepts SKO27. The three roles are still separate environment variables,
so an event can give them different values if it ever wants to:

| Variable | Default | Used for |
| --- | --- | --- |
| `HOST_PIN` | `SKO27` | The session host. |
| `LEADER_PIN` | `SKO27` | The Solutions Architects. One shared PIN; each SA picks their table. (The variable keeps its old name so existing installs keep working.) |
| `RACE_PIN` | `SKO27` | The race password, on the projector and the host console. |

**Session host** sees everything: setup, the session plan, the approvals grid (locks, attempts,
pitches, seconds found and FIT), the readout links, the live feed, every pitch queue, and restart.
**Act as SA** lets the host run any table's queue.

**A Solutions Architect** opens the host console, chooses the **Solutions Architect** tab, enters the
PIN, picks a table and, optionally, a name. They see only their table: the **Available** toggle, the
queue, **Start pitch** (a 30-second timer), the board exactly as the team locked it, which attempt
this is, the table's brief, and **Approve** or **Reject** with a reason (up to 120 characters). The
server refuses SA actions for any other table.

---

## 4. Teams and the budget level

The host sets up 1–10 teams with a name; colours are assigned in order (ten distinct colours). There
are no per-team tiers: every team plays the same problems.

**The budget level** is one setting for the whole session, chosen at setup or in the lobby. It moves
every table's CapEx and OpEx cap lines, never the physical power limits.

| Level | Cap lines | Effect |
| --- | --- | --- |
| Tight | 85% of Standard | One or two clean answers per table: a harder, more focused session. |
| Standard (default) | The season's allowance | Two to five answers per table. |
| Generous | 125% of Standard | Premium options come within reach (for example buying Dell, HPE or Lenovo outright, or dark fibre). |

Each table has its own slice of the infrastructure allowance, so a board is self-contained: what you
see on the table is everything that scores it.

---

## 5. The four tables

Each table has a brief, a problem, 2–3 targets, its cap lines and three dials. ★ marks today's setup.
The briefs (`public/js/briefs.js`, 450–520 words each) carry every figure below in plain English, so
a team that reads carefully can work out an in-zone answer before its first tap.

### Connectivity (`network`): Connectivity Solutions Architect

*Problem:* get car data from the track to the factory strategists fast and reliably at every race.
*Caps (Standard):* CapEx $600k, OpEx $700k a year.
*Targets:* round-trip latency 120 ms or less · weekend availability 99.9% or more · FIA compliance.

| Dial | Settings |
| --- | --- |
| Paths to the factory | ★ Single tunnel (breaks FIA 5.3) · Two diverse paths · Two paths + satellite |
| Route to the data centre | ★ Public internet · Private cross-connect · Dark fibre |
| Car data out of the garage | Garage Wi-Fi (breaks FIA 5.2) · ★ Wired umbilical · Umbilical + edge cache |

### OEMs (`oem`): OEM Solutions Architect

*Problem:* refresh the hardware this season without blowing the CapEx envelope or the yearly cost cap.
*Caps:* CapEx $3.4M, OpEx $1.9M a year.
*Targets:* performance 2.0× today or more · race-weekend fix time 4 hours or less · lead time 12 weeks
or less.

| Dial | Settings |
| --- | --- |
| Hardware | ★ Incumbent, last generation · Dell, HPE or Lenovo · NVIDIA DGX, newest |
| How you pay | ★ Buy outright · Lease · As-a-service (Dell, HPE or Lenovo only; DGX falls back to a lease) |
| Race-weekend support | ★ Basic · Next business day · 4-hour, 24/7 |

### Datacenter & Power (`dc`): Datacenter Solutions Architect

*Problem:* house, power and cool the 400 kW cluster so it runs at full speed, inside the cost cap.
*Caps:* CapEx $1.0M, OpEx $1.0M a year, plus facility power against the site's supply.
*Targets:* power and cooling 100% of need or more · PUE 1.30 or less · N+1 backup.

| Dial | Settings |
| --- | --- |
| Where it lives | ★ Factory server room (300 kW, no N+1, FIA 4.1) · Colo near the factory · Cheap-power region (single grid feed, FIA 4.1) |
| Cooling | ★ Air · Rear-door water · Direct-to-chip liquid |
| Power setting | Capped at 85% · ★ Standard · Max boost |

### CFD Supercomputer (`compute`): CFD Solutions Architect

*Problem:* run the season's aero simulations inside the FIA compute cap, with each design cycle back
the same day.
*Caps:* CapEx $3.6M, OpEx $500k a year, plus cluster power against the 400 kW hall.
*Targets:* 10 or more design cycles a week · compute 100% of the FIA cap or less · nodes kept fed 90%
or more.

| Dial | Settings |
| --- | --- |
| Cluster size | ★ 8 nodes · 16 nodes · 28 nodes |
| Chips | ★ CPU only · Mixed CPU + GPU · GPU heavy |
| Storage | ★ Office NAS · Parallel file system · Parallel + flash cache |

**In-zone answers at Standard** (FIT in brackets; the tests require at least two per table):

- Connectivity: two paths + cross-connect + umbilical (95); + edge cache (87); satellite +
  cross-connect + umbilical (87).
- OEMs: Dell/HPE/Lenovo lease + 4-hour (94); Dell/HPE/Lenovo as-a-service + 4-hour (94).
- Datacenter & Power: colo + rear-door + 85% cap (93); colo + liquid + 85% cap (91); and three more
  colo combinations.
- CFD: 16 nodes + CPU + parallel (91); 16 nodes + CPU + flash cache (88); 16 nodes + mixed + parallel
  (84).

**Today's setup** scores 18 (Connectivity: breaks FIA 5.3), 33 (OEMs), 20 (Datacenter & Power: the
factory room cannot power the cluster) and 61 (CFD: too few cycles).

---

## 6. FIT, scoring and approval

### The scenes and seconds found per lap

Every table's board opens on a live SVG scene (`public/js/scene.js`, CSS animation plus SMIL motion
for packets; no libraries). It is built once and updated in place on every dial, and paused when the
tab is hidden or the device asks for reduced motion. Thumbnails (pitch preview, lock-in snapshot,
readout) are still.

| Table | The scene | What reacts |
| --- | --- | --- |
| CFD Supercomputer | An F1 car in a **wind tunnel**, a tunnel display and an "Aero efficiencies found this week" counter | Streamline count follows design cycles; the flow turns smooth once nodes are fed (≥ 90%) and cycles reach 10; downforce arrows grow; the display shows "Lap time −0.xx s"; over the FIA cap a red FIA 2.4 flag flashes and cycles read "not allowed". |
| Datacenter & Power | A hall cross-section with six racks, a PUE meter and a power meter against the kW available | Rack glow follows GPU speed; throttled racks dim and read "GPUs running at 70%"; heat shimmer with air cooling (throttled or boosted); air flow, rear-door strips or liquid loops by cooling; N+1 generators appear at the colo. |
| Connectivity | COTA on the left, the factory on the right, packets travelling between them | Packet speed follows latency ("Strategy call lands in 110 ms"); a second path appears with two paths, a satellite and a third path with satellite backup; packets drop on the public internet or a single tunnel; garage Wi-Fi flashes an FIA 5.2 flag; an edge cache appears in the garage. |
| OEMs | A rack row, a performance bar against 2× today, CapEx and OpEx jars, a support clock and a lead-time calendar | Old servers slide out for current-generation or DGX ones; the bar fills; the jars fill by payment model (buy, lease, as-a-service); the clock reads 72 h, next day or 4 h; the delivery marker moves against the first race. |

Each scene carries one label per dial (8 words or fewer), with the seconds that dial found against
today's setting, for example "Liquid cooling: GPUs at 100% (+0.19 s)".

**Seconds found per lap** (`outcomeOf` in `public/js/model.js`), per table:

- a cap or FIA breach: **0.00 s, not allowed** ("Over the CapEx cap: the FIA would reject this");
- in the zone: **0.25 + 0.10 × (FIT − 80) ÷ 20**, so 0.25–0.35 s (more spare budget, more time);
- otherwise: **0.20 × progress from today's FIT towards 80**, so 0.00–0.20 s, with the line naming
  the worst miss ("Latency too high: the strategy call arrives too late").

The reference build finds 0.32 + 0.32 + 0.31 + 0.31 = 1.26 s per lap at Standard.

**FIT (0–100)** is one number per board. Each target has a closeness from 0 to 1, where 1 means it is
in its green zone. When every target is in the zone, FIT is 80 plus up to 20 for spare budget (the
average share of each money cap left unused, with half a cap spare earning the full 20). Otherwise FIT
is 70 × the average closeness. **Any cap breach (CapEx, OpEx or power) or FIA breach caps FIT at
40**, so an over-cap board can never score well. The board shows FIT as a ring with one sentence and
one hint that names the single dial setting that fixes the most urgent problem.

**Approval gates everything.** When the Solutions Architect approves a locked board, the team earns
`round(FIT × 1.1 ÷ 4)` table points (up to 28 per table). A table that is never locked (*missed*),
or locked but not approved (*not approved*), earns nothing and races on today's setup. A rejected
team's dials reopen at that table only (its previous picks shown as *last time* ghosts); it locks
three new choices and queues for the SA again while play is running, and the attempt count goes up.
A board locked before play ended can still be pitched and approved afterwards.

**Penalties** are rolled in the race with fixed chances:

| Breach | Table | Chance | Points |
| --- | --- | --- | --- |
| Single tunnel (FIA 5.3) | Connectivity | 60% | −5 |
| Garage Wi-Fi (FIA 5.2) | Connectivity | 80% | −6 and +5 s |
| No N+1 power (FIA 4.1) | Datacenter & Power | 50% | −6 |
| Over the FIA compute cap (FIA 2.4) | CFD | 50% | −8 |
| Over a CapEx or OpEx cap line | any | certain | −10 |

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
and reorder as approvals land.
Incidents follow visible dial settings, and each names its dial:

- **Connectivity:** a drop on a single tunnel, public-internet jitter, a fibre cut (satellite backup
  survives it, two paths lose 0.8 s, a single tunnel loses 4 s), the edge cache's gain, and the Wi-Fi
  time penalty.
- **OEMs:** last-generation kit runs too few what-ifs, late delivery, and a failed node (saved by
  4-hour support, costly with basic support).
- **Datacenter & Power:** a power blip without N+1, throttling when cooling falls short, and a heat
  spike (air cooling and max boost suffer; an 85% cap stays stable).
- **CFD:** too few design cycles, slow storage, the flash cache's gain, and tripping the hall's power.

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
- the incidents that affected the team.

Readouts are at `/race.html?team=<id>` and are listed on the host console. In the readout phase the
projector cycles through every team every 20 seconds; tap a team in the chooser to hold it.

**Demo mode** (on the host console) walks through seven steps with sample data on the CFD table:
scenario → tune (out of the zone, with live dials and a **Turn a dial for me** button that changes
the wind tunnel) → in the zone → pitch → approve → race → readout. It does not touch the real game.

---

## 8. Running an event

**Requirements.** Node.js 18 or newer. There are no npm packages: do not run `npm install`.

**Quick start on a Mac.** Double-click `start.command`. It finds Node (including nvm), starts Podium
on this Mac only and opens `http://localhost:8080/`. From Terminal: `npm start`.

**On Wi-Fi for iPads.**

```bash
npm run start:lan            # every role uses the PIN SKO27
```

The line starting `iPads` gives the room address, for example `http://192.168.1.20:8080/`. Every
device must be on the same network. If the background service (section 9) is running, stop it first:
`launchctl bootout gui/$(id -u)/com.podium.server`.

Lock each iPad to its table page with **Guided Access** (Settings → Accessibility → Guided Access,
then triple-click the side button).

**Rehearsal checklist.**

- [ ] The PIN SKO27 accepted on the host console (host and Solutions Architect tabs) and for Run race.
- [ ] Teams created; budget level and phase lengths set.
- [ ] Four iPads on their table pages; the team grid shows every team.
- [ ] Each Solutions Architect logged in on their own device, scoped to their table, and marked Available.
- [ ] Projector on `/race.html`; the race password tested.
- [ ] One pitch rehearsed: I've read the brief → three taps (Locked 3 of 3) → Call the Solutions Architect → Start pitch → Approve, and one Reject to see the dials reopen as Attempt 2.
- [ ] Laptop on power, with sleep disabled.

---

## 9. Background service and public tunnel

**Background service (macOS).** A LaunchAgent (`com.podium.server`) starts Podium at login on port
8080 and restarts it within about two seconds if it stops.

```bash
HOST_PIN=… LEADER_PIN=… RACE_PIN=… sh scripts/install-service.sh   # install (asks for PINs if not given)
launchctl kickstart -k gui/$(id -u)/com.podium.server                # restart
launchctl bootout gui/$(id -u)/com.podium.server                     # stop until next login
sh scripts/uninstall-service.sh                                      # remove, keep the game
```

The PINs are written into the LaunchAgent plist, which only your user can read.

**Data.** The game is saved to `data/state.json` after every change, so restarts keep it. Logs go to
`data/logs/`. Set `DATA_DIR` to store the game elsewhere. Back up `data/state.json` before an event.
An unreadable save is renamed `state.json.damaged-<time>` and a blank game starts. Saves from the old
six-table game load into the four-table game, keeping only valid choices.

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
restarts.** Anyone with the URL can act as a team, and the PIN is the well-known SKO27, so share the
URL only with the people testing or playing, and restart the experience afterwards.

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `node: command not found` | Install Node 18+ from [nodejs.org](https://nodejs.org), or use `start.command`, which finds nvm. |
| Port 8080 in use | `lsof -nP -iTCP:8080 -sTCP:LISTEN`, or `PORT=8090 npm start`. If it is Podium, a second start just opens the browser. |
| "Podium needs its server" | An `.html` file was opened from Finder. Use `http://localhost:8080/`. |
| "Reconnecting to the game server" | The server is restarting. It recovers on its own; choices are re-sent. |
| "Listen to the brief" on an iPad | The brief is running. Choices open when the host presses **Start play**. |
| "Time is up" on an iPad | Play has ended. Locked plans can still be pitched; the host can add minutes to reopen play. |
| "Waiting for the SA" | No Solutions Architect is marked Available at that table. The SA toggles **Available**, or the host uses **Act as SA**. |
| A team's dials are greyed out | The brief gate: the team has not tapped **I've read the brief** on this iPad for this table (the server refuses choices until it does), or the table is locked, waiting for the SA, or approved. |
| "That choice is locked" | One tap decides a dial. Only a **Reject** by the SA reopens that team's dials at that table. |
| "Too many failed PIN attempts" | Ten wrong PINs from one address in five minutes lock it out for five minutes. |
| Tunnel shows Cloudflare 530 / 1033 | `tail -40 ~/Library/Logs/Podium/tunnel.log`; re-run `sh scripts/tunnel-url.sh` (the URL may have changed); re-run `install-tunnel.sh`. |

---

## 11. Code and API

```text
server.mjs               Node HTTP server: static files, JSON API, state, persistence (no dependencies)
public/index.html        landing page            public/station.html   table iPad
public/host.html         host / SA console        public/race.html     projector and readouts
public/js/briefs.js      the four briefs (situation, wants, rules, decisions, provider, words to know)
public/js/briefview.js   renders a brief, with the #briefEnd sentinel the brief gate watches
public/js/catalog.js     tables, problems, targets, caps, dials, budget levels, today's setup (the game data)
public/js/model.js       boardFor(): gauges, cap bars, FIA chips, FIT, seconds found, sentence and hint; evaluate() for the race
public/js/scene.js       the live scenario per table (wind tunnel, hall, data path, rack row) and its labels
public/js/board.js       the tuning board (scene, SVG gauges, cap bars, FIT ring, dials), shared by every screen
public/js/session.js     phases and countdowns
public/js/race.js        the seeded race and its incidents
public/js/report.js      the podium and each team's readout
public/js/plan.js, plandata.js, summary.js   the locked board snapshot and the SA's summary
public/js/station.js, host.js, raceview.js, readoutview.js, approval.js, podium.js, ui.js, demo.js
scripts/                 macOS service and tunnel helpers
tests/                   node:test suites
```

The browser and the server share the same ES modules, so the board an iPad shows is exactly the board the server locks in (the server is authoritative at lock-in). State is one
JSON document; every change increments `version`, and clients poll `GET /api/state?since=<version>`.

**Routes.** Host routes need `x-pin: <HOST_PIN>`. SA routes need `x-pin: <LEADER_PIN>` and
`x-station: <table>`, and the host PIN works for any table. Failed PIN attempts are rate limited per
client IP (`CF-Connecting-IP` behind the tunnel).

| Route | Purpose |
| --- | --- |
| `GET /api/state`, `GET /api/health`, `GET /api/presence` | Read the game; health includes the phase. |
| `POST /api/login` | `{pin, station?}` → `{role: "host" \| "architect", station?}`. |
| `POST /api/host/setup` | `{teams: [{name}], stations?, budget?}` with 1–10 teams; `budget` is `tight`, `standard` or `generous`. |
| `POST /api/host/phase` | `{action: set (phase minutes and `budget`, lobby only) \| brief \| play \| pause \| resume \| add \| end \| readout}`. |
| `POST /api/host/race`, `POST /api/race/run` | Run the race (`racePassword`, optional `seed`, `endClock`). |
| `POST /api/host/unrace`, `/api/host/queue`, `/api/host/reset` | Clear the race, manage queues, start an empty game. |
| `POST /api/architect/availability`, `/pitch`, `/decide` | Available toggle, start/stop a pitch, approve or reject (`{team, station, decision: "approve" \| "reject", reason?}`). |
| `POST /api/teams/<id>/checkin \| brief \| sim \| choices \| call \| presence \| checkout` | Team actions from a table iPad (no PIN). `brief` records that the brief was read for `{station}`; `choices` locks one dial at a time (`{station, choices: {dial: setting}}`) and is refused before the brief is read, for a dial already locked, or outside play. |

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
- **Server:** setup and budget validation, the phases, the brief gate, one-tap locks, call, pitch,
  approve and reject (reopening one team at one table, attempts counted), the approval gate scoring
  FIT, SA scoping, rate limiting, persistence, old-save migration, a
  damaged save, and static-file safety.
- **UX:** one vocabulary (Scenario, Tune, Seconds found per lap, FIT, In the zone, Today's setup…),
  the two tabs, scene labels of 8 words or fewer across every dial combination, the demo dial
  changing the wind tunnel, no retired product names, no tiers or old score bands, dead modules
  removed, the phases, the demo steps, and the landing page.
