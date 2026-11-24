# Audi F1 Team × Digital Realty — how the Swiss infrastructure planning tool works

The planning tool (`public/sim.html`, code in `public/js/sim/`) holds **one plan for two seasons, 2027 and 2028**:
the Restricted CFD cluster, where it lives, how it is paid for, how the paddock is connected and **when** each change
lands. Each season is evaluated by the same deterministic engine (`model.js`, sections 1–6) and the plan layer
(`plan.js`, `timeline.js`, sections 7–10) blends the two estates over the deployment timeline. The result is read
as **seconds per lap found over a season against Today's setup** in the same season, plus the FIA, money,
availability and CO₂ lines for each season and the health of the plan as a whole. The Solutions Architect view
(`sa.js`, section 11) derives what the plan asks of the Zurich campus.

Everything is recomputed on every input change by pure functions; the constants live in `public/js/customer.js`
(`FIGURES`) and `public/js/sim/assumptions.js` (`K`), each keyed to a row of
[`audi-f1-sources.md`](audi-f1-sources.md). Row keys in brackets below point there.

The provider is **Digital Realty** (Zurich campus, Glattbrugg/Opfikon). The OEM dimension assumes **HPE via HPE
GreenLake**: the sales lead's working assumption for the demo, not a statement about the team's actual suppliers.

## 1. Inputs

| Group | Inputs |
|---|---|
| FIA envelope | season (2027 / 2028), constructors' position used for the sliding scale (P1–P11), model confidence (0–100 %) |
| Compute | CPU nodes, cores per node, declared clock (CCF), memory per node, interconnect, storage tier, accelerators and how many run Restricted CFD, accelerator class, assumed GPU charge factor, consumption model (buy / HPE GreenLake), GreenLake reserved share and term, support SLA, refresh cadence, delivery vs 1 January |
| Facility | location (Hinwil / Digital Realty / hybrid), Hinwil retrofit, committed kW, 2028 expansion right, rack density, cooling, redundancy, PUE (derived or override), electricity price, 100 % renewable, heat reuse, fit-out and migration one-offs, migration timing, share of the fee treated as Property Costs |
| Connectivity | Hinwil ↔ campus fibre routes and bandwidth, paddock link, edge compute in the garage, cloud on-ramps, venue for the latency readout |

`normalize()` fills defaults and clamps every input to the control schema (`GROUPS`), so the model never sees a
value outside the FIA envelope or the catalogue: solver GPUs ≤ GPUs, Hinwil scenarios cannot buy heat reuse or an
expansion right, Digital Realty scenarios cannot retrofit the Hinwil room.

## 2. FIA envelope [C8, C9, C10, C11]

* Allowance per ATP at position P: `allowance = baseline × scale[P] / 100`, with baseline 6 MAUh, 320 runs, 80 wind-on
  hours, 400 occupancy hours, 2,000 RATGs and the scale 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 115 % for P1…P11.
* `AUh = cores × solver seconds × CCF / 3600`, so per ATP: `cpuMAUh = cores × CCF × 1,460 h × 0.75 / 10⁶`
  (0.75 is the share of wall-clock the declared cores spend in the solver [J-d]).
* Solver GPUs are allowed from the 2028 season only. Each is charged `fp64 TFLOPS × 1000 / 32` AUh per hour
  (FP64 normalisation against a core's 32 FLOP per cycle [J2, J-c]) times the **GPU charge factor** slider; before
  2028 the request is flagged "not allowed" and the GPUs are treated as unrestricted pre/post-processing.
* `usage = usedMAUh / allowance`. Above 100 % the cluster is **throttled**: it can only run `1 / usage` of the period
  and the rest idles (flag: over capacity; over-use would be deducted from the next period, F4.6.10). Below 90 % the
  flag says how much of the allowance is left on the table.
* Cost cap: USD 215 M at the Initial Applicable Rate 1.1316 = CHF 190.0 M; the scenario's Relevant Costs are shown
  as a share of it.

## 3. Effective compute

Useful solver work per ATP, in "effective MAUh" (work a perfect cluster at the 3.7 GHz reference would do with the
same AUh):

```
cpuWork  = cores × hoursRun × 3.7 × (CCF / 3.7)^0.6 × ipc × memory × interconnect × io × thermal
gpuWork  = solverGPUs × hoursRun × (fp64 × 1000 / 32) × 1.3 × gpuFabric × io × gpuThermal
effective MAUh = (cpuWork + gpuWork) × availability × delivery × migration × power / 10⁶
```

* **Clock** [J-d]: AUh grow with CCF¹, memory-bound CFD work with CCF⁰·⁶, so a lower declared clock (never below the
  base clock, F4.4.2) buys more work per MAUh at the price of more nodes.
* **ipc** [H-d]: 1.08 / 1.00 / 0.92 for a 3 / 4 / 5-year refresh cadence; the FIA charges clock, not instructions.
* **memory** [J-d]: 0.95 for 384 GB nodes, else 1.0.
* **interconnect** [J-d]: `1 − loss × min(nodes, 8) / 8` with loss 3.0 / 2.0 / 1.0 / 0.8 % for 100G Ethernet,
  200G Ethernet, InfiniBand NDR and HPE Slingshot; GPU jobs use 0.90 / 0.95 / 1.0 / 1.0.
* **io** [J-d]: demand 0.4 GB/s per CPU node + 1.5 GB/s per GPU against 3 / 25 / 80 GB/s for NAS / parallel file
  system / flash tier; when starved, `io = 0.75 + 0.25 × supply / demand`.
* **thermal** [G5]: racks denser than the cooling can carry (air ≈ 20, rear-door 70, direct liquid 150 kW)
  throttle the silicon: `max(0.6, 1 − 0.5 × overage / limit)`; accelerators on air cooling lose 30 %. The declared
  CCF still accrues AUh.
* **availability** [G-d, H-c, D6]: facility availability by redundancy (N 99.5 %, N+1 99.9 %, 2N 99.99 %) × node
  failures (`servers × MTTR × 0.5 / 200,000 h`, MTTR 36 / 4 / 2 h by support tier) × half the Hinwil ↔ campus fibre
  unavailability (99.9 % one route, 99.995 % two) when the cluster is at the campus.
* **delivery** [H-e]: `1 − max(0, weeks late) / 52`; ATP 1 starts on 1 January.
* **migration** [C9]: a mid-period move loses 7 solver days of a use-it-or-lose-it allowance.
* **power** [A-a, G-c]: IT load of the site hosting the cluster vs its capacity (Hinwil 300 kW, 450 kW retrofitted;
  Digital Realty the committed kW, or 1,000 kW with the expansion right): `min(1, capacity / load)`. The rest of the
  estate is 375 kW in 2027 and 760 kW in 2028 [J-f]; hybrid keeps 150 kW in Hinwil.

Turnaround of a standard full-car run (6,000 reference core-hours) on 8 CPU nodes or 4 GPUs, plus pre/post-processing
of 1.5 h that unrestricted GPUs cut to 0.5 h; runs per period and per week follow from the effective MAUh.

## 4. Trackside [I1, I-a … I-e]

* Round-trip to Zurich by venue on a private carrier path (Monza 8 … Melbourne 290 ms), + 35 ms jitter allowance on
  the public internet, + 0.35 ms when Mission Control's data lands at the campus first.
* Bandwidth headroom = link Mbps / 105 Mbps telemetry peak (two cars × 1.5 TB per weekend, peak × 3).
* Link availability = paddock profile (99.0 / 99.5 / 99.95 / 99.99 %) × the Hinwil ↔ campus fibre.
* Data-to-decision = 6.0 s + 2 round trips − 1.5 s with an edge node in the garage.
* A quality index (50 % decision time, 30 % availability, 20 % headroom) maps to ± 6 championship points a season
  between a slow, fragile loop and a fast, resilient one; shown separately from lap time.

## 5. Money, cost cap, sustainability [C11, G-c, H-a, H-b]

Yearly lines: cluster depreciation (hardware ÷ refresh years) **or** the HPE GreenLake charge
(hardware ÷ term × uplift × max(reserved share, metered utilisation), uplift 1.25 at a 100 % reserve rising to 1.35 at
60 %); support (2 / 4 / 6 % of hardware value; GreenLake includes next-business-day); software 4 % (buy only);
electricity (IT kW × 0.85 load factor × 8,760 h × PUE × tariff, +1 Rp for a renewable tariff in Hinwil); Digital
Realty fee (max(committed, actual) kW × CHF 180 × 12); cross-connects; fibre (CHF 48k per route × 1.0 / 1.4 / 2.2 for
10 / 100 / 400G); paddock connectivity (30k / 250k / 400k / 480k); edge (80k + 200k ÷ 4); cloud on-ramps (180k);
depreciation of fit-out and plant over 10 years.

One-offs: Digital Realty fit-out, migration, the expansion fit-out when the 2028 estate exceeds the commitment;
Hinwil retrofit (CHF 3.0 M) or keeping the room alive (0.3 M), a liquid loop (0.45 M) or rear-door branch (0.3 M);
edge hardware.

**Cost-cap charge** = the yearly lines that are Relevant Costs: everything above except Property (fit-out, retrofit
and plant depreciation; the Property share of the colocation fee, slider, default 50 %, open point C3) and
Sustainability Initiative Costs. **3-year TCO** = hardware (purchase, or 3 × GreenLake) + 3 × operating lines +
one-offs. PUE is derived from site and cooling [G-b] unless overridden. CO₂: location-based at 75 g/kWh for all
electricity; market-based 0 for Digital Realty (100 % renewable) and for a renewable Hinwil tariff. Heat reuse
recovers 25 % of the campus IT energy before 2029 (60 % once the Opfikon network runs) and displaces gas at
200 kg CO₂/MWh.

Electricity is charged for the whole estate even where a site cannot power it, so the money comparison stays
like-for-like; a power shortfall is charged to performance only.

## 6. Season performance [J-a, J-b, J-e]

```
Δt_aero     = 1.2 × [ ln(1 + W_scenario / 4) − ln(1 + W_today / 4) ]        (W = effective MAUh per ATP)
Δt_reinvest = ±0.3 × (1 − e^(−|saved cost-cap charge| / CHF 3 M))           (sign of the saving)
Δt          = (Δt_aero + Δt_reinvest) × confidence
```

The aero curve is calibrated so that the marginal value of allowance around a 6 MAUh programme is ≈ 0.09 s per 12.5
ATR points (between Binotto's "a tenth" and Wolff's "two tenths", J1) and a full allowance finds ≈ 1.1 s over a
season. Reinvestment of cap savings is worth ≈ 0.085 s per CHF 1 M with diminishing returns; spending more inside the
cap counts against the scenario. The result is read as **seconds per lap vs Today's setup**, converted to a
position swing at 0.10 s per constructors' position (clamped to P5–P11) and 25 points per position, plus the
strategy points from section 4. The lap-time ladder shows the P5–P11 rungs around the team's position.

"Today's setup" is the Hinwil room as it is, carried into the selected season: 12 nodes at 3.7 GHz on 200G Ethernet
and NAS storage, air cooling, N redundancy, a five-year-old fleet, one carrier circuit to the paddock. In 2027 it is
≈ 94 kW short of the estate; in 2028 ≈ 479 kW short, which is why the 2028 deltas are large.

## 7. Two seasons, one plan (`plan.js`)

A plan is `{ meta, shared, seasons: { 2027, 2028 }, timeline }`:

* **shared** — held once for both seasons: constructors' position, model confidence, venue, the Property share of
  the fee, the fit-out and migration one-offs.
* **seasons.2027** — every per-season control (compute, facility, connectivity).
* **seasons.2028** — only the controls that are **detached**: everything else reads *"Same as 2027"* and inherits
  the 2027 value. Editing a 2028 control detaches it; *Same as 2027* re-attaches it. `deltas.changed` lists the
  controls whose effective 2028 value differs from 2027; `deltas.stepUp` is true when any of them is a compute or
  facility control (a real step-up of the estate rather than a commercial or connectivity tweak).
* **timeline** — contract date, cutover target, parallel-running weeks, 2028 step-up date (section 8).
* `leadWeeks` and `migrationTiming` from the single-season engine are **planned by the timeline**: the plan layer
  passes `leadWeeks = 0`, `migrationTiming = "boundary"` and a computed `scheduleLoss` (below) into `simulate()`.

Each season blends the estates that actually run during it:

```
W_2027 = shareOld27 × W(today, 2027) + shareNew27 × W(plan 2027)·(1 − loss27)
W_2028 = shareToday28 × W(today, 2028) + shareCarry28 × W(plan 2027 in 2028) + shareNew28 × W(plan 2028)·(1 − loss28)
```

`shareNew` is the fraction of the calendar year after go-live (2027: the cutover; 2028: the step-up, or 1 January
when nothing steps up). `shareCarry28` is the part of 2028 still on the 2027 estate before the step-up;
`shareToday28` is only non-zero when the 2027 move itself slips into 2028. `loss` is the season's allowance lost at
the switch (section 8) divided by `shareNew`, so `scheduleLoss` acts as an efficiency on the new estate only.
Seconds per lap and points per season come from section 6 with `W_season` against `W(today, season)`; the money
lines are per season (yearly, cost-cap charge, cash = blended yearly + that year's one-offs), the totals add the two
seasons, and *3-year TCO* compares the 2028 estate (plus the 2027 one-offs it does not already carry) with today's
room carried into 2028.

Presets are full two-season plans: **Today: stay at Hinwil** (nothing moves) · **Digital Realty Zurich from 2027**
(the 2027 scenario, 2028 inherits it) · **Digital Realty Zurich 2027 + HPE GreenLake GPU step-up 2028** (same
2027 under GreenLake, 2028 detaches nodes, clock, GPUs, Slingshot, flash, Tech Care Critical, 3-year refresh, 60 kW
racks on direct liquid, 2N, 400G fibre, dual-path paddock link and cloud on-ramps).

## 8. Deployment timeline (`timeline.js`) [C7, C9, C10, C13, C14, C15, C-a, D-e, G-e, G8, H-f, A-e]

**Calendar.** Six Aerodynamic Testing Periods a year (F4.1.4, C13): ATP 1 runs from 1 January to the end of week 9,
ATP 2 and 3 eight weeks each, ATP 4 ten weeks (it contains the summer shutdown), ATP 5 eight weeks, ATP 6 to
31 December. Weeks start on a Monday and week 1 is the ISO week containing 4 January, so the boundaries are:

| | ATP 1 | ATP 2 | ATP 3 | ATP 4 | ATP 5 | ATP 6 |
|---|---|---|---|---|---|---|
| 2027 | 1 Jan – 7 Mar | 8 Mar – 2 May | 3 May – 27 Jun | 28 Jun – 5 Sep | 6 Sep – 31 Oct | 1 Nov – 31 Dec |
| 2028 | 1 Jan – 5 Mar | 6 Mar – 30 Apr | 1 May – 25 Jun | 26 Jun – 3 Sep | 4 Sep – 29 Oct | 30 Oct – 31 Dec |

Windows and markers: the 14-day summer shutdown (F3.1.1.a; assumed to start on the first Monday of August) and the
nine-day winter shutdown from 24 December (F3.1.1.b), the 2027 pre-season test and Round 1 (VERIFIED, C7), the 2028
equivalents (ASSUMPTION: the 2027 pattern, C-a), GPU legality on 1 January 2028 (F4.4.1, C10) and the planning
date 24 November 2026.

**Lead times (all ASSUMPTION, planning values).** From the contract date: Digital Realty fit-out 12 weeks (16 with a
liquid loop, 16 for the 2028 expansion rows) [G-e]; dark fibre 14 weeks for one route, +2 for a second diverse route
[D-e]; HPE hardware 6 weeks under GreenLake (pre-staged, 4–8) or 14 weeks purchased built-to-order (10–18) [H-f];
Hinwil works 10 weeks [A-e]; cross-connects 1 week after the suite is ready [G8]; acceptance and burn-in 2 weeks
[H-f]; then the parallel-running weeks the team chooses. The **earliest feasible cutover** is
`max(burn-in end, fibre ready) + parallel weeks`; the critical path is whichever task ends last. If the target is
feasible the plan lands on the target (slack shown), otherwise the cutover **slips** to the first feasible day and
the plan is flagged.

**What a switch costs.** Allowance is use-it-or-lose-it per ATP (F4.6.10, C9), so a switch inside a period wastes
solver days: 7 without parallel running (physical move, re-cabling, re-commissioning), 1 with it (the queue drains
on the old cluster and restarts on the new one) — and **0 at an ATP boundary or inside a shutdown**. The period
loss is `downtimeDays / ATP days`, the season loss is `periodLoss / 6`, and parallel running costs CHF 20k a week
(old room's electricity, overlapping fee and staff). A switch after Round 1 is flagged: the first ATPs of the
season still run on today's room.

**2028 step-up.** The step-up kit is ordered on `stepUpDate − lead time` (GreenLake or purchase, plus fit-out for
the expansion rows when the 2028 estate exceeds the 2027 room or changes cooling), never before the contract or the
planning date, so a tight date slips. A GPU partition that lands **before 1 January 2028** cannot run the solver
(F4.4.1): the first four weeks count as burn-in, every week beyond that is carrying cost (the 2028 estate's extra
yearly charge, pro rata) with no ATR value. A step-up after 1 January leaves `shareCarry28` of the season on the
2027 estate; inside ATP 1 it also loses solver days like any other switch.

**Declarations.** A new F4.4.3 declaration is due within one month of a change of hardware, core count or location,
or at the ATP report 14 days after the period ends if that is earlier (F4.6.4) [C15]; both are milestones. The
*Sign by* strip works the lead times backwards from every boundary of 2027: the contract date each cutover needs.

Milestones: contract, cutover, declaration (2027), step-up order, step-up, declaration (2028), next refresh.

## 9. Plan health

`planHealth()` turns the two seasons and the timeline into one status (ok / warn / bad) with one-line reasons that
each point at a component route: the engine's per-season flags (MAUh over capacity, power shortfall, cooling,
clock, GPUs before 2028, delivery, availability …), the timeline flags (slip, late cutover, switch inside a
period, early or late step-up, declaration due) and plan-level checks (a GPU partition declared for 2027, a 2028
estate beyond the commitment without the expansion right, a campus estate without fibre, 2N on a single fibre
route, a plan that changes nothing, a 2028 GPU partition that is idle). The Overview shows the worst level per
decision card and the full list; the compact badge in the plan bar counts what is left to tune.

## 10. Presets (headline at 60 % confidence, P8)

| Preset | 2027 | 2028 | Cost-cap charge (2027 / 2028) | Health |
|---|---|---|---|---|
| Today: stay at Hinwil | 0 s · P8 · 99 % of allowance · 3.84 eff. MAUh | 0 s · P8 · 99 % · 1.95 eff. MAUh | CHF 1.25 M / 1.98 M | **bad**: Hinwil room 94 kW short in 2027, 479 kW short in 2028 |
| Digital Realty Zurich from 2027 | ≈ +0.08 s · P8 → P7 · +20 pts · live 3 May 2027 (ATP 3 boundary, 33 % of the season on today's room, no allowance lost) | ≈ +0.33 s · P8 → P5 · +75 pts | CHF 2.20 M / 3.04 M (+0.95 M / +1.06 M vs today) | **warn**: live after Round 1 (12 Mar) |
| Digital Realty Zurich 2027 + HPE GreenLake GPU step-up 2028 | ≈ +0.08 s · P7 · +21 pts (same move, GreenLake) | ≈ +0.39 s · P5 · +75 pts · 94 % of allowance · 7.21 eff. MAUh · step-up ordered 28 Aug 2027, live 1 Jan 2028 | CHF 2.13 M / 3.37 M (+0.89 M / +1.39 M) | **warn**: live after Round 1 (12 Mar) |

Two-season totals: cash CHF 3.6 M (today), 7.8 M (DR 2027), 8.7 M (DR + GreenLake step-up); lap time over both
seasons +0.41 s and +0.47 s. The headline numbers move with every control; `npm test` pins their direction, their
order and the schedule rules, not the decimals.

## 11. Solutions Architect view (`sa.js`)

Derived from the same result, nothing is entered twice: **requirements per season** (site, IT load at PUE, committed
kW and expansion right, redundancy, racks and cooling, fibre routes and bandwidth, cross-connects, cloud on-ramps,
internet/IX, paddock link, Remote Hands, HPE support tier, maintenance windows against the ATP calendar, renewable
supply and heat reuse, the F4.4.3 declaration, cost-cap treatment, ready-by date), each with an owner and the public
Digital Realty service that answers it (PlatformDIGITAL® colocation, ServiceFabric® Campus/Metro/Cross Connect,
Internet Exchange and IP Bandwidth, cloud on-ramps, Remote Hands, SwissIX; dark fibre and HPE are external) [G5,
G6, G8, G9, G10, D10, H3]; **owner roles** (generic Digital Realty roles, ASSUMPTION G-f); a **discovery
checklist** whose notes stay in the browser; a **live risk register** (likelihood × impact, triggered by the current
plan, with mitigations); and a **solution brief** for print plus a JSON hand-over, both carrying the HPE-via-GreenLake
footnote.

## 12. What the model does not do

* No stochastic simulation: availability and failures are expected values.
* No GPU conversion rule exists yet (F4.4.1); the FP64 normalisation and the charge-factor slider are assumptions.
* Wind-tunnel hours, RATGs and occupancy hours follow the sliding scale but are not traded against compute.
* Indexation of the cost cap and FX movements are ignored; the cap is shown at the Initial Applicable Rate.
* The rest of the IT estate costs the same in every scenario and is only modelled for power and PUE.
* Lead times are planning values, not quotations; the 2028 calendar is the 2027 pattern until the FIA publishes it;
  the summer shutdown start is the team's choice and is assumed, not known.
* Allowance carried between periods (F4.6.10 deductions) and the FIA's exact treatment of a mid-period hardware
  change are simplified to "solver days lost"; the model never moves allowance between periods.
