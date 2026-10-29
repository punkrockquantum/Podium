# Podium 2027

A 50-minute team game about building a Formula 1 team's IT infrastructure. Up to ten teams visit
four tables, make three decisions at each on an iPad, pitch each design to that table's Architect in
30 seconds, and then watch their approved designs race the Austin 2027 Grand Prix on the projector.
Every team then gets a one-screen readout of what went well and what it could have done differently.

Prices, speeds and rules are **teaching estimates**, not quotes. The "FIA rules" are a simplified,
fictional version of the real regulations.

## Contents

1. [The game in one minute](#1-the-game-in-one-minute)
2. [The 50-minute session](#2-the-50-minute-session)
3. [Screens, roles and PINs](#3-screens-roles-and-pins)
4. [Teams and tiers](#4-teams-and-tiers)
5. [The four tables](#5-the-four-tables)
6. [Scoring and approval](#6-scoring-and-approval)
7. [The race and the readouts](#7-the-race-and-the-readouts)
8. [Running an event](#8-running-an-event)
9. [Background service and public tunnel](#9-background-service-and-public-tunnel)
10. [Troubleshooting](#10-troubleshooting)
11. [Code and API](#11-code-and-api)
12. [Tests](#12-tests)

---

## 1. The game in one minute

- **Teams:** 1 to 10. Each has a name, one of ten colours, and a tier: Front-runner, Midfield or
  Challenger.
- **Tables:** four, one iPad each, each with its own Architect: Connectivity, OEMs, Datacenter & Power
  and the CFD Supercomputer.
- **At each table**, the team works through four tabs:
  1. **Brief:** three bullets, plus what the Architect is looking for.
  2. **Decide:** three decisions with three options each.
  3. **Simulate:** one score, one sentence and one hint.
  4. **Pitch:** **Lock in**, take a screenshot of the plan, **Call the Architect**, pitch for 30
     seconds, and get **Approved** or **Sent back**.
- **Only approved tables count.** A table that was skipped or not approved races on its default
  options, which are deliberately weak.
- **The finale:** a 56-lap race animated in 30 seconds, then a readout for every team.

---

## 2. The 50-minute session

| Phase | Default | What happens |
| --- | --- | --- |
| Brief | 5 min | The host explains the game. iPads show "Listen to the brief" and block choices. |
| Play | 35 min | Teams move freely between tables: decide, simulate, lock in, pitch. When time is up, every table locks. |
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
| Host console | `/host.html` | The **session host** (host PIN), or an **Architect** (Architect PIN plus their table). |
| Projector | `/race.html` | The big screen: phase, countdown, standings, the race, the readouts. |
| Team readout | `/race.html?team=t1` | One team's readout (`t1` to `t10`). The host console lists every link. |

The old table ids `ai`, `storage` and `governance` show "This table is not in play" with links to
the four tables.

**The PINs** are environment variables. The server warns at startup about any PIN still on its
rehearsal default.

| Variable | Rehearsal default | Used for |
| --- | --- | --- |
| `HOST_PIN` | `2027` | The session host. |
| `LEADER_PIN` | `1950` | The Architects. One shared PIN; each Architect picks their table. (The variable keeps its old name so existing installs keep working.) |
| `RACE_PIN` | `SKO27` | The race password, on the projector and the host console. |

**Session host** sees everything: setup, the session plan, the approvals grid, the readout links, the
live feed, every pitch queue, and restart. **Act as Architect** lets the host run any table's queue.

**An Architect** opens the host console, chooses the **Architect** tab, enters the Architect PIN,
picks a table and, optionally, a name. They see only their table: the **Available** toggle, the
queue, **Start pitch** (a 30-second timer), the locked plan, and **Approve** or **Send back** with a
reason. The server refuses Architect actions for any other table.

---

## 4. Teams and tiers

The host sets up 1–10 teams with a name, a colour (ten distinct colours, assigned in order) and a
tier. The tier makes the game fair: faster cars get tighter limits.

| Tier | Meaning | CapEx headroom | Compute allowance | Car pace |
| --- | --- | --- | --- | --- |
| Front-runner (Tier 1) | Fastest car, tightest limits | $6M | 70% | 0.15 s/lap quicker |
| Midfield (Tier 2) | Balanced | $8M | 100% | baseline |
| Challenger (Tier 3) | Slower car, most room to catch up | $10M | 115% | 0.15 s/lap slower |

Every team has the same yearly OpEx allowance: **$5.0M**, with $0.5M of tolerance before a breach.

---

## 5. The four tables

Each table has three decisions with three options; the default (marked ★) is what an unapproved table
races on. The plan's ledger shows four numbers: **CapEx**, **yearly OpEx**, **power** (facility kW)
and **FIA risk** (Low, Med or High).

### Connectivity (`network`): Connectivity Architect

*Looking for:* a fast, legal link that survives a cut fibre without blowing the budget.

| Decision | Options |
| --- | --- |
| Factory link | ★ Single tunnel (breaks FIA 5.3 redundancy) · Redundant tunnels · Redundant + satellite |
| Latency path | ★ Public internet · Private cross-connect · Dark fibre |
| Garage data | Wi-Fi dumps (illegal, FIA 5.2: time penalty) · ★ Wired umbilical · Umbilical + edge cache |

### OEMs (`oem`): OEM Architect

*Looking for:* a vendor and payment plan that fits your tier's limits, with support that matches the
risk.

| Decision | Options |
| --- | --- |
| Vendor | Supermicro · Dell, HPE or Lenovo · ★ NVIDIA DGX |
| How you pay | ★ Buy (CapEx) · Lease (≈30% a year, OpEx) · As-a-service (Dell, HPE or Lenovo only; support included) |
| Support | ★ Basic · Next business day · 4-hour |

### Datacenter & Power (`dc`): Datacenter Architect

*Looking for:* cooling that matches the chips, a site near the factory, and power headroom on a hot
day.

| Decision | Options |
| --- | --- |
| Location | ★ Home factory (no N+1, FIA 4.1) · Colo near factory · Cheap-power region (+latency) |
| Cooling | ★ Air · Rear-door · Direct-to-chip liquid |
| Power plan | ★ Standard · Capped at 85% · Max boost |

### CFD Supercomputer (`compute`): CFD Architect

*Looking for:* a cluster sized to the allowance, the right chips, and storage that keeps it fed.

| Decision | Options |
| --- | --- |
| Cluster size | ★ Small (≈60% of allowance) · Medium (matches it) · Large (140%, FIA 2.4 overrun risk) |
| Chips | ★ CPU only · Mixed CPU + GPU · GPU heavy |
| Storage | ★ Basic · Fast parallel · Fast + cache |

Every option on the iPad shows a sentence of at most about 12 words and a one-line "why".

**The tables interact.** Hot chips (GPU heavy, max boost) throttle on air cooling. A far site adds
latency to every strategy call. A big cluster or a premium vendor can push the team over its CapEx
headroom, and leasing moves the cost onto OpEx. The simulation shows the effects as you choose.

**Known strong routes.** Each of these scores Optimised (80 or more) for every tier; the tests
require at least two per table:

- Connectivity: redundant tunnels + cross-connect + edge cache (93); satellite + cross-connect + edge
  cache (92); redundant tunnels + dark fibre + wired umbilical (87).
- OEMs: Dell/HPE/Lenovo lease + 4-hour (95); Dell/HPE/Lenovo as-a-service + next business day (91);
  Supermicro lease + 4-hour (89).
- Datacenter & Power: colo + liquid + 85% cap (95); colo + rear-door + 85% cap (94); cheap-power
  region + liquid + standard (91).
- CFD: medium + mixed + fast + cache (89); medium + mixed + fast parallel (88); medium + CPU only +
  fast parallel (88).

The defaults score 66 (Connectivity), 76 (OEMs), 74 (Datacenter & Power) and 68 (CFD).

---

## 6. Scoring and approval

**The simulation score** (0–100) for a table blends performance (35%), cost (20%), compliance (25%)
and resilience (20%). Bands: **Optimised** at 80 or more, **Competitive** at 60 or more, otherwise
**Needs work**. The hint names the biggest thing to fix.

**Approval gates everything.** When the Architect approves a plan, the team earns
`round(score × 1.1 ÷ 4)` table points (up to 28 per table). A table that is never locked in
(*missed*), or locked in but not approved (*not approved*), earns nothing and races on its defaults.
A sent-back team can revise, lock in again and re-pitch while play is running. A plan locked in
before play ended can still be pitched and approved afterwards.

**FIA penalties** are rolled in the race with fixed chances:

| Risk | Table | Chance | Points |
| --- | --- | --- | --- |
| Single tunnel (FIA 5.3) | Connectivity | 60% | −5 |
| Wi-Fi car dumps (FIA 5.2) | Connectivity | 80% | −6 and +5 s |
| No N+1 at the factory (FIA 4.1) | Datacenter & Power | 50% | −6 |
| Large cluster overruns the allowance (FIA 2.4) | CFD | 50% | −8 |
| Over CapEx headroom | OEMs | certain | −10 |
| OpEx over tolerance / major breach | OEMs | certain | −10 / −25 |

**Final score** = table points + race points × 4 − penalty points. Race points follow F1:
25, 18, 15, 12, 10, 8, 6, 4, 2, 1.

---

## 7. The race and the readouts

The race is the Austin 2027 Grand Prix at the Circuit of the Americas: 56 laps animated in 30
seconds. It is deterministic for a seed, so a rerun with the same seed gives the same result.

Lap pace comes from the tier, the aero gain from the CFD table, and a "system" score across the four
tables. Incidents tie back to the tables:

- **Connectivity:** a tunnel drop on a single tunnel, public-internet jitter, a fibre cut (a
  satellite backup survives it, redundant tunnels lose 0.8 s, a single tunnel loses 4 s), and the
  edge cache's gain.
- **OEMs:** a failed node, saved by 4-hour support and costly with basic support.
- **Datacenter & Power:** a heat spike (air cooling and max boost suffer; liquid plus the 85% cap
  stays stable), max boost overheating, and room power limits. The cheap-power region adds 40 ms to
  every call.
- **CFD:** a small cluster gives a poor strategy model, slow storage delays answers, and the flash
  cache's gain.

**Balance** (checked in the tests over 200 seeds for every tier): a team with all four tables
approved on a strong design beats the same design with two tables unapproved at least 85% of the
time, and beats an all-defaults team at least 95% of the time.

**Each readout** shows:

- the finishing position, the championship position and the points;
- 2–3 things that went well;
- 2–3 things that could have been done differently, each naming the better option and why;
- the incidents that affected the team.

Readouts are at `/race.html?team=<id>` and are listed on the host console. In the readout phase the
projector cycles through every team every 20 seconds; tap a team in the chooser to hold it.

**Demo mode** (on the host console) walks through six steps with sample data: brief → play → pitch →
approve → race → readout. It does not touch the real game.

---

## 8. Running an event

**Requirements.** Node.js 18 or newer. There are no npm packages: do not run `npm install`.

**Quick start on a Mac.** Double-click `start.command`. It finds Node (including nvm), starts Podium
on this Mac only and opens `http://localhost:8080/`. From Terminal: `npm start`.

**On Wi-Fi for iPads.**

```bash
HOST_PIN=your-host-pin LEADER_PIN=your-architect-pin RACE_PIN=your-race-password npm run start:lan
```

The line starting `iPads` gives the room address, for example `http://192.168.1.20:8080/`. Every
device must be on the same network. If the background service (section 9) is running, stop it first:
`launchctl bootout gui/$(id -u)/com.podium.server`.

Lock each iPad to its table page with **Guided Access** (Settings → Accessibility → Guided Access,
then triple-click the side button).

**Rehearsal checklist.**

- [ ] PINs set (no default-PIN warning in Terminal).
- [ ] Teams created with names and tiers; phase lengths set.
- [ ] Four iPads on their table pages; the team grid shows every team.
- [ ] Each Architect logged in on their own device, scoped to their table, and marked Available.
- [ ] Projector on `/race.html`; the race password tested.
- [ ] One pitch rehearsed: Lock in → Call the Architect → Start pitch → Approve.
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
restarts.** Anyone with the URL can act as a team, so set real PINs before sharing it.

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
| "Waiting for Architect" | No Architect is marked Available at that table. The Architect toggles **Available**, or the host uses **Act as Architect**. |
| "Too many failed PIN attempts" | Ten wrong PINs from one address in five minutes lock it out for five minutes. |
| Tunnel shows Cloudflare 530 / 1033 | `tail -40 ~/Library/Logs/Podium/tunnel.log`; re-run `sh scripts/tunnel-url.sh` (the URL may have changed); re-run `install-tunnel.sh`. |

---

## 11. Code and API

```text
server.mjs               Node HTTP server: static files, JSON API, state, persistence (no dependencies)
public/index.html        landing page            public/station.html   table iPad
public/host.html         host / Architect console public/race.html     projector and readouts
public/js/catalog.js     tables, decisions, options, tiers, colours, session defaults (the game data)
public/js/model.js       evaluate(): ledger, power, latency, aero and FIA penalties for a team
public/js/sim.js         per-table score, band, sentence and hint
public/js/session.js     phases and countdowns
public/js/race.js        the seeded race and its incidents
public/js/report.js      the podium and each team's readout
public/js/plan.js, plandata.js, summary.js   the locked-in plan and the Architect's summary
public/js/station.js, host.js, raceview.js, readoutview.js, approval.js, podium.js, ui.js, demo.js
scripts/                 macOS service and tunnel helpers
tests/                   node:test suites
```

The browser and the server share the same ES modules, so scoring is identical on both. State is one
JSON document; every change increments `version`, and clients poll `GET /api/state?since=<version>`.

**Routes.** Host routes need `x-pin: <HOST_PIN>`. Architect routes need `x-pin: <LEADER_PIN>` and
`x-station: <table>`, and the host PIN works for any table. Failed PIN attempts are rate limited per
client IP (`CF-Connecting-IP` behind the tunnel).

| Route | Purpose |
| --- | --- |
| `GET /api/state`, `GET /api/health`, `GET /api/presence` | Read the game; health includes the phase. |
| `POST /api/login` | `{pin, station?}` → `{role: "host" \| "architect", station?}`. |
| `POST /api/host/setup` | `{teams: [{name, tier}], stations?}` with 1–10 teams. |
| `POST /api/host/phase` | `{action: set \| brief \| play \| pause \| resume \| add \| end \| readout}`. |
| `POST /api/host/race`, `POST /api/race/run` | Run the race (`racePassword`, optional `seed`, `endClock`). |
| `POST /api/host/unrace`, `/api/host/queue`, `/api/host/reset` | Clear the race, manage queues, start an empty game. |
| `POST /api/architect/availability`, `/pitch`, `/decide` | Available toggle, start/stop a pitch, approve or send back. |
| `POST /api/teams/<id>/checkin \| sim \| choices \| submit \| call \| presence \| checkout` | Team actions from a table iPad (no PIN; choices only during play). |

---

## 12. Tests

```bash
npm test
```

The suites (`node:test`, no dependencies) cover:

- **Catalog:** 4 tables × 3 decisions × 3 options, the word limits, 10 colours, the tiers and a
  50-minute session.
- **Model and simulation:** the ledger, payment and cooling physics, penalties, the approval gate,
  and at least two Optimised routes per table for every tier.
- **Race:** determinism, every incident, the balance over 200 seeds (printed as `[balance]` lines),
  and a 10-team race with a full readout for every team.
- **Server:** setup validation, the phases (the brief blocks choices, play allows them, ending play
  locks), lock-in, call, pitch, approve and send back, Architect scoping, rate limiting, persistence,
  old-save migration, a damaged save, and static-file safety.
- **UX:** one vocabulary (Architect, never "leader"), dead modules removed, the phases, and the demo
  steps.
