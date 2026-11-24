# Audi F1 Team × Digital Realty — the Austin arcade ("Race the plan")

A playable, early-2000s-style top-down arcade race at **`/arcade.html`** that turns the simulator's seconds per lap into
a car on the Circuit of the Americas. The user picks (or is handed) the 2027 or 2028 season car, races nine rivals
running Today's on-prem setup, drives with the arrow keys, and enters a name for the league table of best laps.
Everything is vanilla JavaScript and Canvas 2D with zero dependencies; the league is three routes on the existing
server. Nothing in the simulator, its model or its pages was changed: the arcade is new files plus a two-line hook
in `server.mjs` and a six-line key-press helper in `tests/helpers/chrome.js`.

Code: `public/js/arcade/` (`track.js`, `physics.js`, `ai.js`, `race.js`, `render.js`, `hud.js`, `audio.js`,
`league.js`, `launch.js`, `main.js`), `public/css/arcade.css`, `server/league.mjs`. Tests: `tests/arcade.physics.test.js`,
`tests/arcade.league.test.js`, `tests/arcade.browser.test.js`.

## 1. The "Race now" hook for the simulator

`public/js/arcade/launch.js` exports `launchRace(car)`: it stores the car in `sessionStorage["podium.arcade.car"]`
and navigates to `/arcade.html`. From any simulator module the whole integration is one line:

```js
import("/js/arcade/launch.js").then((m) => m.launchRace({ season, label, secondsPerLapVsToday, effectiveMauh, allowanceUsedPct, availabilityPct, dataToDecisionS, location }))
```

The car spec (every field optional except that at least one of `secondsPerLapVsToday`, `availabilityPct`,
`dataToDecisionS` or `label` is present):

| Field | Meaning | Arcade default |
|---|---|---|
| `season` | 2027 or 2028 | 2027 |
| `label` | shown on the card, HUD and league (≤ 48 chars, `<>` and control characters stripped) | "2027/2028 season car" |
| `secondsPerLapVsToday` | the simulator's headline, clamped to ±1 s | 0 |
| `effectiveMauh` | effective compute per period (display only) | — |
| `allowanceUsedPct` | share of the FIA allowance used (display only) | — |
| `availabilityPct` | clamped to 90–100 | 99.4 |
| `dataToDecisionS` | data-to-decision loop, clamped to 2–12 s | 6.3 |
| `location` | display only | — |
| `drivers` | optional `[{ name, seconds }]`, kept but unused so far | — |

Fallbacks, in order: the sessionStorage car; URL query `?season=2028&adv=0.39&avail=99.98&loop=4.8&label=...`
(also `mauh=`, `used=`, `location=`); otherwise the car picker. The picker always shows the three built-in cars,
computed live from `public/js/sim/model.js` (`PRESET_ORDER` → `evaluate(presetInputs(id))`) so they match the simulator,
with a static fallback (`BUILT_IN_FALLBACK`) when the model cannot be imported (file:// use). A handed-over car is
shown first, pre-selected and tagged "FROM THE PLAN"; "Choose another car" clears it. `/arcade.html#league` opens the
league table on its own (projector between races); "Back to the plan" links to `/`.

## 2. From the plan's figures to the game (the mapping)

`physics.carParams(spec)` is the whole mapping; the figures below are the three presets as of 24 Nov 2026 (P8, 60 %
confidence). ASSUMPTION: every constant is an arcade tuning value, chosen so that a clean lap with the 2028 car beats
the best rival, 2027 reaches the podium and Today finishes mid-pack (section 5).

| Plan figure | Game parameter | Formula | Today | DR Zurich 2027 | DR + GreenLake 2028 |
|---|---|---|---|---|---|
| Computation: `secondsPerLapVsToday` | **Aero efficiency** ("Aero +X %"): grip, top speed, acceleration, braking | aero% = 30 × s/lap; grip × (1 + a), vmax × (1 + 0.35 a), accel × (1 + 0.5 a), brake × (1 + 0.3 a) | 0.00 s → +0 % | 0.14 s → +4.1 % | 0.39 s → +11.7 % |
| Connectivity: `dataToDecisionS` | **Boost recharge** (Space: +14 m/s² for 3 s, cap +15 %) | 1.1 × loop | 6.3 s → 6.9 s | 4.84 s → 5.3 s | 4.84 s → 5.3 s |
| Connectivity: `dataToDecisionS` | **Pit-wall assist horizon** (how far ahead the ideal line and braking boards are drawn) | clamp(14 / loop, 1.5, 3.5) s of travel | 2.2 s | 2.9 s | 2.9 s |
| Connectivity: `dataToDecisionS` | **Assist precision** (jitter of the line and boards) | max(0, loop − 4.5) × 3 m | 5.4 m, dashed, faded | 1.0 m | 1.0 m |
| Reliability: `availabilityPct` | **Telemetry glitches** (power −65 % for 1.2 s, lightning icon, HUD flash) | (100 − avail) / 100 × 3.3 per second | 99.39 % → 1.2 a minute | 99.89 % → 0.2 a minute | 99.98 % → 0.03 a minute |
| Season | the 2028 card carries one plain sentence: from 1 Jan 2028 GPU cores may run the Restricted CFD solver (F4.4.1), so the same allowance buys more aero work: the bigger step | — | — | — | bigger aero step |

The nine rivals (`race.rivalSpecs()`) are Today's parameters with a pace spread: `secondsPerLapVsToday` of
+0.20, +0.10, +0.10, +0.05, 0, −0.05, −0.10, −0.20, −0.30 — ASSUMPTION: Today's midfield neighbours, P6 to P11 at the
model's 0.10 s per constructors' position, with the places nearest Today's pace doubled up. They keep Today's 99.4 %
availability (they glitch too) and 6.3 s loop, never boost, and carry generic names and colours ("On-prem rival A–I").
The player starts P5 on a 2 × 5 grid behind the first four.

## 3. The track

The centreline is the legacy finale's analytic COTA layout (`public/js/cota.js`: one closed cubic Bézier path of
straights, arcs and eased esses, drawn anticlockwise, with the 20 corner markers, the two DRS zones and the two sector
lines as fractions of the lap). `track.js` samples it into a closed polyline of 689 points 4 m apart.

ASSUMPTIONS: the game lap is **2,756 m, half the real 5,513 m**, so a lap takes about a minute; the asphalt is 18 m
wide (real 15–20 m) with 1 m grippy kerb bands on the curved sections and a 16 m grass runoff ending in a soft wall;
the racing line is the centreline pushed to the outside before and inside through each corner (narrow-minus-wide
curvature smoothing, at most 5.5 m off centre). T16 and T18 are added to the legacy marker list to make 20 boards.
Lap timing uses three gates passed in order — sector 1 line (0.4186), sector 2 line (0.7727), start/finish — so a
shortcut never scores; crossing times are interpolated inside the 1/120 s step (accurate to about 1 ms).

## 4. Physics, AI and the loop

* **Car** (`physics.js`): heading + velocity vector. Steering turns the heading at up to 2.3 rad/s at walking pace,
  falling as 1.22 × grip / v with speed; the tyres pull the velocity behind the heading at up to `grip` m/s², so full
  lock at speed leaves lateral velocity: a slide (tyre marks). Engine power follows 1 − (v / vmax)², negative above the
  cap so a car coming off the boost eases back; lifting off adds rolling and air drag; grass has 42 % grip, a constant
  drag and a speed cap near 80 km/h; the outer wall bounces at 25 % and keeps 72 % of speed; car-to-car contact is a
  circle collision (radius 2 m) trading closing speed with 1.2 % loss.
* **AI** (`ai.js`): a curvature speed profile per car (braking and acceleration passes), pure pursuit on the racing
  line, braking-aware speed control, lane changes to pass slower cars only where the next 90 m are straight,
  stuck recovery, staggered reactions at the start. **Rubber band** (documented here as required): a rival more than 8 s
  ahead of the player eases off by up to 6 % (0.4 % per second of gap); nothing is ever sped up, so a good lap is a
  good lap. Calibration runs disable it.
* **Loop** (`main.js`): requestAnimationFrame with fixed 1/120 s physics steps (at most 24 per frame), Canvas 2D at
  480 × 270 upscaled with `image-rendering: pixelated`, a camera that follows and rotates with the car, DOM HUD in a
  chunky monospace stack (no webfont files), fixed-north minimap canvas, optional CRT scanlines (C), optional WebAudio
  synth (muted by default, M), five-light start with a random hold, chequered flag, results ~1.6 s after the finish.
  Controls: arrows / WASD, Space boost, P pause, R restart, Esc back, M sound, C scanlines, H assist on/off, Enter race.
  Touch pads appear on coarse pointers.

## 5. Calibration (the AI in every seat, 3 laps, rubber band off)

`tests/arcade.physics.test.js` asserts the pattern on seeds 1–3; the eight-seed run on 24 Nov 2026:

| Player's car | Finishing positions (seeds 1–8) | Player best lap | Best rival lap (A, +0.20 s) |
|---|---|---|---|
| Today: Hinwil on-prem | P5 P5 P5 P5 P5 P5 P6 P5 | ≈ 0:58.0 | ≈ 0:57.0 |
| Digital Realty Zurich 2027 | P2 P2 P2 P3 P2 P2 P2 P4 | ≈ 0:57.1 | ≈ 0:57.0 |
| Digital Realty + HPE GreenLake 2028 | P1 P1 P2 P1 P1 P1 P1 P1 | ≈ 0:55.3 | ≈ 0:57.0 |

The boost is worth about 0.4 s a lap when used on the two straights; glitches cost Today about 0.3 s a lap. A human
on arrow keys will be slower than the AI; the pit-wall assist (line and braking boards) and the rubber band are what
keep the race close for them. The league's plausibility window is derived from the physics (26.2 s to 10 min).

## 6. The league API (`server/league.mjs`)

| Route | Body / query | Response |
|---|---|---|
| `GET /api/league?limit=50` | limit 1–500 (default 50) | `{ rows, total, limits }`, rows sorted by best lap then time of entry |
| `POST /api/league` | `{ name, bestLapMs, season, carLabel, advantageS, laps, finishPos }` | `{ ok, rank, kept, row, total }` |
| `POST /api/league/reset` | header `x-pin: <host PIN>` | `{ ok, rows: [], total: 0 }` (403 without the PIN; a wrong PIN counts as a failed attempt) |

Validation: `name` trimmed, control characters and `<>` stripped, 1–24 characters; `bestLapMs` an integer inside the
physics' plausible window; `season` 2027 or 2028; `carLabel` capped at 48 characters (default "Unknown car");
`advantageS` a finite number within ±5; `laps` 1–10; `finishPos` 1–10; unknown fields dropped; a sanitised row over
600 bytes refused; the server's 64 KB body cap applies. At most 500 rows are kept (a slower lap gets `kept: false`
and its would-be rank); ten posts a minute per address (soft limit: 429 with `retry-after: 60`). Rows are
`{ id, name, bestLapMs, season, carLabel, advantageS, laps, finishPos, at }` in `data/league.json` (`{ version: 1, rows }`),
written atomically like the game state; a damaged file is set aside. The client (`league.js`) falls back to
`localStorage["podium.arcade.league"]` when the API is unreachable and says so on the table.

## 7. Tests and hooks

`npm test` runs the three arcade files with the rest. The browser test drives a real headless Chrome through
`Input.dispatchKeyEvent` at 1440 × 900 and 1024 × 768 with zero JavaScript errors. `?test=1` exposes
`window.__arcade` (`pick(id)`, `start()`, `debugFinish(bestLapMs)`, `autopilot()`, `hudText()`, `race`, `state`) and
shortens the lights; `ARCADE_SHOTS=/dir` makes the test save the walkthrough screenshots. The default PIN never
appears under `public/`; the retired product name appears nowhere.
