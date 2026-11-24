# Audi F1 Team × Digital Realty — how the Swiss infrastructure planning tool works

The planning tool (`public/sim.html`, code in `public/js/sim/`) holds **one plan for two seasons, 2027 and 2028**:
the Restricted CFD cluster, where it lives, how it is paid for, how the paddock is connected and **when** each change
lands. Each season is evaluated by the same deterministic engine (`model.js`, sections 1–6) and the plan layer
(`plan.js`, `timeline.js`, sections 7–10) blends the two estates over the deployment timeline. The result is read
as **seconds per lap found over a season against Today's setup** in the same season, plus the FIA, money,
availability and CO₂ lines for each season and the health of the plan as a whole. The Solutions Architect view
(`sa.js`, section 11) derives what the plan asks of the Zurich campus. The integration pass added the **500 kW
envelope** (section 3a), the **processor family** (`cpuArch`, section 3b), three **strategies** and an **optimiser**
(section 14), the **attribution** behind "Where the seconds come from" (section 15) and the **explainers** (section 16);
championship positions and points are no longer outcomes (section 17).

Everything is recomputed on every input change by pure functions; the constants live in `public/js/customer.js`
(`FIGURES`) and `public/js/sim/assumptions.js` (`K`), each keyed to a row of
[`audi-f1-sources.md`](audi-f1-sources.md). Row keys in brackets below point there.

The provider is **Digital Realty** (Zurich campus, Glattbrugg/Opfikon). On the OEM side: **HPE GreenLake and AMD
EPYC are the team's publicly announced 2023 CFD platform** (HPE press release of 15 November 2023, row A15); every
2027/2028 configuration in this tool is **our proposal**, not a statement about the team's actual suppliers (A-f).

## 1. Inputs

| Group | Inputs |
|---|---|
| FIA envelope | season (2027 / 2028), constructors' position used for the sliding scale (P1–P11; it sets the allowance and nothing else), model confidence (0–100 %) |
| Compute | CPU nodes, cores per node, declared clock (CCF, floored at the part's base clock), **processor architecture** (`cpuArch`), memory per node, interconnect, storage tier, accelerators and how many run Restricted CFD, accelerator class (eight parts, section 3b), assumed GPU charge factor, consumption model (buy / HPE GreenLake), GreenLake reserved share and term, support SLA, refresh cadence, delivery vs 1 January |
| Facility | location (Hinwil / Digital Realty / hybrid), Hinwil retrofit, committed kW (≤ 500), **ML / unrestricted-GPU partition** (kW and placement), rack density, cooling, redundancy, PUE (derived or override), electricity price, 100 % renewable, heat reuse, fit-out and migration one-offs, migration timing, share of the fee treated as Property Costs |
| Connectivity | Hinwil ↔ campus fibre routes and bandwidth, paddock link, edge compute in the garage, cloud on-ramps, venue for the latency readout |

`normalize()` fills defaults and clamps every input to the control schema (`GROUPS`), so the model never sees a
value outside the FIA envelope or the catalogue: solver GPUs ≤ GPUs, Hinwil scenarios cannot buy heat reuse,
Digital Realty scenarios cannot retrofit the Hinwil room, and the declared clock never falls below the **CCF floor**
of the chosen core count and processor family (`ccfFloor`, H3: 2.4 GHz for 64 and 128 cores, 2.3 for 96, 2.25 for
192; F4.4.2). There is no expansion right any more: the envelope is 500 kW in both seasons (G-h).

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
* **arch** [K-a … K-e]: the processor family's useful work per AUh at equal generation and clock — Today's
  standard-cache Zen 4 1.00; standard cache, newest generation 1.05 (2027) / 1.12 (2028); big cache (3D V-Cache)
  1.20 / 1.30; Intel Xeon with fast memory 1.08 / 1.15; Arm (Grace → Vera) 1.00 / 1.07. Each option also sets the
  node kW factor, the per-node price delta and the CCF floor; parts that launch in 2027 (Venice-X, Xeon 7) raise the
  `arch` flag for 2028 and Arm takes two weeks off the delivery slider for solver re-validation (`armport`).
* **thermal** [G5, G-g]: at the campus the cooling ceilings are **hard**: air 20, rear-door 70, direct liquid 150 kW
  per rack. A rack-density slider is clamped at the ceiling (the control says why) and a cooling option that would
  not fit the chosen density is marked *won't fit*. Only Hinwil can still run racks denser than the cooling carries,
  and there the silicon throttles: `max(0.6, 1 − 0.5 × overage / limit)`; accelerators on air cooling lose 30 %. The
  declared CCF still accrues AUh.
* **availability** [G-d, H-c, D6]: facility availability by redundancy (N 99.5 %, N+1 99.9 %, 2N 99.99 %) × node
  failures (`servers × MTTR × 0.5 / 200,000 h`, MTTR 36 / 4 / 2 h by support tier) × half the Hinwil ↔ campus fibre
  unavailability (99.9 % one route, 99.995 % two) when the cluster is at the campus.
* **delivery** [H-e]: `1 − max(0, weeks late) / 52`; ATP 1 starts on 1 January.
* **migration** [C9]: a mid-period move loses 7 solver days of a use-it-or-lose-it allowance.
* **power** [A-a, G-c, G-h]: IT load of the site hosting the cluster vs its capacity (Hinwil 300 kW, 450 kW
  retrofitted; Digital Realty the committed kW, at most the 500 kW offer): `min(1, capacity / load)`. Today's
  baseline keeps the J-f estate (375 kW in 2027, 760 kW in 2028) so it stays power-short and comparable; a plan that
  moves to the campus carries the **estate rule** of J-g instead: the base estate is 375 kW in both seasons plus the
  explicit ML / unrestricted-GPU partition (0–400 kW, default 0, placed at Digital Realty, in Hinwil or in the
  cloud). Hybrid keeps 150 kW in Hinwil.

Turnaround of a standard full-car run (6,000 reference core-hours) on 8 CPU nodes or 4 GPUs, plus pre/post-processing
of 1.5 h that unrestricted GPUs cut to 0.5 h; runs per period and per week follow from the effective MAUh.

### 3a. The 500 kW envelope (`envelope()`, `ceilings()`, `fitToEnvelope()`) [G-e, G-f, G-g, G-h]

Digital Realty's offer is **500 kW of critical IT at the rack, 2N A+B** (each feed ≤ 50 % loaded in normal
operation, so 2N does not halve the usable kW; cooling and losses are billed through metered power, G-e) in **60
rack positions** (G-f). For every season the model adds up what the plan puts at the campus — the cluster (nodes ×
kW per node × the architecture's kW factor, plus the accelerators), the base estate (375 kW at 8 kW per rack, 47
racks) and the ML partition when it is placed there — and compares it with 500 kW and 60 racks:

* `drIT` kW and `racks.total`, `headroomKW = 500 − drIT`, `fits` when both limits hold; the tone is green ≤ 450 kW,
  amber 450–500, red over (plan health: *"Fits the 500 kW envelope: 399 / 500 kW (2027)"*, or *"Not possible"*).
* **Ceilings** per control: the largest node count, GPU count, ML partition and rack density that still fit, given
  the rest of the plan; a slider is clamped there and the readout explains the clamp (*"the 500 kW envelope allows
  37 nodes"*; *"direct liquid ceiling 150 kW/rack"*). Options that cannot fit are marked *won't fit* rather than
  hidden. Setting a 2027 control re-clamps the dependent 2028 controls.
* **Fit to the envelope** trims, in order, the ML partition, the solver GPUs, the nodes and the rack density until
  the season fits, and reports what it changed.
* There is **no expansion right**: more kW is a separate commercial conversation (ZUR4, 2028). The ≈ 760 kW the estate
  would draw if it stayed in Hinwil (J-f) therefore does not fit at the campus; the business case carries it only as the
  Hinwil paths' 2028 demand, the campus hosts the 2028 estate inside 500 kW (≈ 405 kW in the GreenLake preset), and the
  ML / GPU partition that fits is ≤ ≈ 100 kW.

### 3b. Processor families and accelerators [K1 … K13, K-a … K-e, J2, J-i]

`cpuArch` is a per-season control with five options: **Today's processors** (the 2023 GreenLake cluster's Zen 4,
A-f), **standard cache, newest generation** (Turin → Venice), **big cache** (Genoa-X → Venice-X, H2 2027), **Intel
Xeon, fast memory** (Xeon 6 + MRDIMM → Xeon 7) and **Arm** (Grace → Vera). Architecture is a separate multiplier at
equal generation and declared clock (K-e); the clock exponent (J-d) and the generation factor (H-d) are unchanged.
The FIA counts cores × clock, not work done, so the architecture gain is free under the allowance; it costs power
(kW factor) and money (per-node delta) and, for the 2027 launches, lead time.

The accelerator table has eight parts (H200, B200, GB200, Rubin (projected), MI300X, MI325X, MI355X, MI430X) with
their FP64 vector peaks, kW including a share of the host (J2, J-i) and prices (H-a, J-i). B300-class parts (FP64
1.2 TFLOPS) are for unrestricted work only. The charge per solver GPU is still `fp64 × 1000 / 32` core-equivalents at
the charge factor (J-c); an MI430X at a 100 % charge exceeds a P8 allowance on its own (flag).

## 4. Trackside [I1, I-a … I-e]

* Round-trip to Zurich by venue on a private carrier path (Monza 8 … Melbourne 290 ms), + 35 ms jitter allowance on
  the public internet, + 0.35 ms when Mission Control's data lands at the campus first.
* Bandwidth headroom = link Mbps / 105 Mbps telemetry peak (two cars × 1.5 TB per weekend, peak × 3).
* Link availability = paddock profile (99.0 / 99.5 / 99.95 / 99.99 %) × the Hinwil ↔ campus fibre.
* Data-to-decision = 6.0 s + 2 round trips − 1.5 s with an edge node in the garage.
* **Trackside value is read in its own units**, never in points: the data-to-decision time at the chosen venue
  (and its delta vs Today), the link availability and the **race weekends at risk** = (1 − link availability) × 24
  weekends. The Overview's *Trackside value* row and the strategy cards carry these three numbers. The quality index
  (50 % decision time, 30 % availability, 20 % headroom) is still computed for the Solutions Architect risk register
  but no longer converted into championship points (section 17).

## 5. Money, cost cap, sustainability [C11, G-c, H-a, H-b]

Yearly lines: cluster depreciation (hardware ÷ refresh years) **or** the HPE GreenLake charge
(hardware ÷ term × uplift × max(reserved share, metered utilisation), uplift 1.25 at a 100 % reserve rising to 1.35 at
60 %); support (2 / 4 / 6 % of hardware value; GreenLake includes next-business-day); software 4 % (buy only);
electricity (IT kW × 0.85 load factor × 8,760 h × PUE × tariff, +1 Rp for a renewable tariff in Hinwil); Digital
Realty fee (max(committed, actual) kW × CHF 180 × 12); cross-connects; fibre (CHF 48k per route × 1.0 / 1.4 / 2.2 for
10 / 100 / 400G); paddock connectivity (30k / 250k / 400k / 480k); edge (80k + 200k ÷ 4); cloud on-ramps (180k);
depreciation of fit-out and plant over 10 years.

One-offs: Digital Realty fit-out, migration; Hinwil retrofit (CHF 3.0 M) or keeping the room alive (0.3 M), a liquid
loop at Hinwil (0.45 M) or rear-door branch (0.3 M), the liquid rows at the campus when the cluster is direct-liquid
cooled there (0.45 M, J-h); edge hardware.

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
cap counts against the scenario. The result is read as **seconds per lap vs Today's setup** and stays in seconds:
the former conversion into a constructors' position swing and championship points, the lap-time ladder and the
strategy points were removed in the integration pass (section 17). The copy still uses J-e's lay conversion
("about a tenth of a second a lap per place in the midfield", J-k) to give the seconds a feel.

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
Seconds per lap per season come from section 6 with `W_season` against `W(today, season)`; the money
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
liquid loop, 16 for the 2028 step-up rows) [G-e]; dark fibre 14 weeks for one route, +2 for a second diverse route
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
the step-up rows when the 2028 estate needs more racks at the campus or changes cooling, inside the 500 kW envelope), never before the contract or the
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
estate that does not fit the 500 kW envelope (with the *Fit to the envelope* action), a campus estate without
fibre, 2N on a single fibre route, a plan that changes nothing, a 2028 GPU partition that is idle). The Overview shows the worst level per
decision card and the full list; the compact badge in the plan bar counts what is left to tune.

## 10. Presets (plan-level, 60 % confidence, P8)

| Preset | 2027 | 2028 | Cost-cap charge (2027 / 2028) | Health |
|---|---|---|---|---|
| Today: stay at Hinwil | 0 s · Hinwil · 99 % of allowance · 99.39 % availability | 0 s · Hinwil · 99 % · 99.39 % | CHF 1.25 M / 1.98 M | **bad**: Hinwil room 94 kW short in 2027, 479 kW short in 2028 |
| Digital Realty Zurich from 2027 | +0.08 s · 399 of 500 kW · 99 % · 99.89 % · live 3 May 2027 (ATP 3 boundary, 33 % of the season on today's room, no allowance lost) | +0.37 s · 399 of 500 kW · 99 % · 99.89 % | CHF 2.20 M / 2.20 M (+0.95 M / +0.22 M vs today) | **warn**: live after Round 1 (12 Mar) |
| Digital Realty Zurich 2027 + HPE GreenLake GPU step-up 2028 | +0.08 s · 399 of 500 kW · 99 % · 99.89 % (same move, GreenLake) | +0.42 s · 405 of 500 kW · 94 % of allowance · 99.98 % · step-up ordered 28 Aug 2027, live 1 Jan 2028 | CHF 2.13 M / 2.56 M (+0.89 M / +0.58 M) | **warn**: live after Round 1 (12 Mar) |

Two-season totals: cash CHF 3.6 M (today), 6.6 M (DR 2027), 7.4 M (DR + GreenLake step-up); lap time over both
seasons +0.45 s and +0.51 s. The GreenLake step-up preset was re-based to the 500 kW envelope (8 GPU nodes at 60 kW
racks on direct liquid, 405 kW; the former 760 kW estate does not fit). The headline numbers move with every control;
`npm test` pins their direction, their order and the schedule rules, not the decimals.

## 11. Solutions Architect view (`sa.js`)

Derived from the same result, nothing is entered twice: **requirements per season** (site, IT load at PUE, committed
kW against the 500 kW envelope, redundancy, racks and cooling, fibre routes and bandwidth, cross-connects, cloud on-ramps,
internet/IX, paddock link, Remote Hands, HPE support tier, maintenance windows against the ATP calendar, renewable
supply and heat reuse, the F4.4.3 declaration, cost-cap treatment, ready-by date), each with an owner and the public
Digital Realty service that answers it (PlatformDIGITAL® colocation, ServiceFabric® Campus/Metro/Cross Connect,
Internet Exchange and IP Bandwidth, cloud on-ramps, Remote Hands, SwissIX; dark fibre and HPE are external) [G5,
G6, G8, G9, G10, D10, H3]; **owner roles** (generic Digital Realty roles, ASSUMPTION G-f); a **discovery
checklist** whose notes stay in the browser; a **live risk register** (likelihood × impact, triggered by the current
plan, with mitigations); and a **solution brief** for print plus a JSON hand-over, both carrying the HPE-via-GreenLake
footnote.

## 12. Pictures drawn from the plan (`visuals.js`, `diagrams.js`)

Nothing in a picture is typed in: each SVG reads the result of the season it shows.

* **Swiss schematic map** (Overview): Hinwil, the Glattbrugg campus and Neuburg, the fibre (one or two routes) and
  where the Restricted CFD estate runs in each season.
* **Gantt** (Deployment, compact strip on the Overview): the six ATPs of each year as bands, the two shutdowns, the
  pre-season tests, Round 1 and the 1 January 2028 rule line as markers, one row per task coloured by owner, the
  milestones with their lead-time status; the marker and milestone labels are placed in lanes so they never overlap.
* **Architecture** (Compute, 2027 | 2028 switch): the Hinwil site and the campus cage, the fibre between them, the CPU
  partition as one chip per node (GreenLake buffer nodes dashed), the GPU partition with the solver GPUs highlighted
  (or greyed before 2028), the fabric and storage tier, the consumption model, and the campus services underneath
  (cross-connects, cloud on-ramps, Remote Hands with the HPE support tier, power and cooling); at Hinwil the row shows
  the room's headroom or shortfall instead.
* **Rack layout** (Facility, 2027 | 2028 switch): the cluster racks (`ceil(clusterKW / rackKW)`, at most ten drawn)
  filled to their average load, amber when the density exceeds the cooling limit, a rear-door panel or a liquid
  manifold plus CDU per the cooling choice, A/B feeds per the redundancy, the rest of the estate as one block (no
  rack plan exists for it in the model) within the 60 positions of the cage.

## 13. What the model does not do (see also sections 14–17)

* No stochastic simulation: availability and failures are expected values.
* No GPU conversion rule exists yet (F4.4.1); the FP64 normalisation and the charge-factor slider are assumptions.
* Wind-tunnel hours, RATGs and occupancy hours follow the sliding scale but are not traded against compute.
* Indexation of the cost cap and FX movements are ignored; the cap is shown at the Initial Applicable Rate.
* The rest of the IT estate costs the same in every scenario and is only modelled for power and PUE.
* Lead times are planning values, not quotations; the 2028 calendar is the 2027 pattern until the FIA publishes it;
  the summer shutdown start is the team's choice and is assumed, not known.
* Allowance carried between periods (F4.6.10 deductions) and the FIA's exact treatment of a mid-period hardware
  change are simplified to "solver days lost"; the model never moves allowance between periods.

## 14. Strategies and the optimiser (`strategies.js`, `optimiser.js`, `optimiserRunner.js`)

**Three strategies** are fixed plans transcribed from the strategies brief — **A · Consolidate and de-risk**,
**B · Density and the 2028 GPU step-up**, **C · Cost-cap-optimised hybrid cloud** — each as `{ shared, 2027, 2028 }`
input sets with a strategy timeline (contract 24 Nov 2026, cutover target 8 Mar 2027, two parallel weeks, step-up
1 Jan 2028). `planFromSets()` turns a set into a plan.js plan (plan-wide values into `shared`, the 2027 set into
`seasons.2027`, only the 2028 values that differ into `seasons.2028`, with `meta.strategy` as lineage);
`strategyPlan(id, { position, confidence, venue })` borrows exactly those three inputs from the current plan;
`matchingStrategy(plan)` recognises an untouched strategy (any edit, including the timeline, breaks the match and the
plan bar reads *Custom (from B)* until the user reloads the strategy or keeps the edit).

**Plan-level, not steady-state.** The briefs' headline figures were computed steady-state: each season evaluated as
if the strategy's estate ran all year. The tool's figures are **plan-level**: the strategy is loaded into a plan and
evaluated with the go-live blend of section 7, exactly as the planner shows it after *Load*. Two things move: the
8 March 2027 target **slips** to the first day the lead times allow, inside ATP 2 (A and C to 30 March, B — direct liquid rows
and a 16-week fit-out — to 20 April 2027), and 2027 is then blended with today's room for the months before the
cutover. 2028 is the full season on the stepped-up estate, so it matches steady state. At P8 and 60 %:

| Strategy | 2027 plan-level (steady-state) | 2028 | kW of 500 (2027 / 2028) | Allowance used | Cost-cap charge | Availability | Cutover |
|---|---|---|---|---|---|---|---|
| A | **+0.10 s** (+0.14) | **+0.37 s** (+0.37) | 399 / 404 | 99 % / 99 % | CHF 2.20 M / 2.27 M | 99.98 % / 99.97 % | 30 Mar 2027 (slips 3 wk) |
| B | **+0.15 s** (+0.22) | **+0.47 s** (+0.47) | 401 / 459 | 96 % / 96 % | CHF 2.59 M / 2.55 M | 99.98 % / 99.98 % | 20 Apr 2027 (slips 6 wk) |
| C | **+0.14 s** (+0.19) | **+0.46 s** (+0.46) | 399 / 399 | 96 % / 99 % | CHF 2.42 M / 2.33 M | 99.97 % / 99.98 % | 30 Mar 2027 (slips 3 wk) |

All three fit the envelope in both seasons and carry the same plan-health warning (live after Round 1 on 12 March).
The Strategies tab shows the cards, a side-by-side table with Today (best value per row marked), a chart and *Load /
Compare / Race now* per strategy; cards re-evaluate when position, confidence or venue change.

**The optimiser** ("Find the best use of 500 kW") is coordinate descent over the unlocked controls: from the user's
plan plus seven seeded random starts (24 with *Thorough*), up to 12 sweeps per start, hard caps of 6,000 (20,000)
plan evaluations, seed 2027 (J-l). The search space is every shared and per-season control except the ones locked
by default (processor family, GPU model, support, fibre, trackside, edge, cloud on-ramps, committed kW, ML partition
and delivery — each with a *why* and an unlock), with the node count filled to the allowance and the declared clock
held at or above the CCF floor. Three objectives: **Fastest 2028 car** (`sec2028 + 0.1 · sec2027`, 2027 ≥ +0.10 s),
**Most cost-cap headroom** (`−(cap2027 + cap2028) + 0.1 · Σ sec`, both seasons ≥ +0.10 s) and **Balanced**
(`mean(sec) − 0.03 · mean(cap M) + 0.5 · (mean(availability) − 0.99) + 0.01 · (5 − mean(decision s))`). Every
candidate must fit the 500 kW envelope in both seasons and use ≤ 100 % of the allowance. Candidates are **scored
steady-state** (≈ 80 µs a plan) because the plan-level evaluation is ≈ 5× dearer; the proposal is then run through
`plan.js` with the user's go-live dates and the tiles, the diff table and *Load this proposal* show the **plan-level**
figures. A shared control that the start plan had detached for 2028 is folded back to the 2027 value and reported.
The search runs in a module web worker (`optimiser.worker.js`) with progress and *Stop* (keeps the best so far), and
falls back to the main thread in chunks when workers are unavailable; a default run is ≈ 1,500 plans in ≈ 0.2 s.

From the GreenLake preset: *Fastest 2028* proposes 37 × 64-core nodes at 2.4 GHz on Slingshot with direct liquid and
2N for 2027, 7 such nodes plus the GPU partition for 2028 → +0.15 s / +0.51 s, 404 / 394 kW, CHF 2.27 M / 1.97 M
inside the cap; *Balanced* lands on the same cluster with InfiniBand in 2028 (+0.15 / +0.51 s); *Most cost-cap
headroom* trades lap time for CHF 1.91 M / 1.81 M (+0.07 / +0.41 s).

## 15. Attribution — "Where the seconds come from" (`attribution.js`, `plan.js seasonAttributionFn`) [J-j]

Twelve **drivers** group the controls (fixed display order): power (location, retrofit, committed kW, ML
partition), processor family (`cpuArch`), processor generation (refresh), declared clock, graphics processors
(GPUs, solver GPUs, model, charge), data (memory, interconnect, storage), cooling (rack density, cooling), resilience
(redundancy, support), timing (delivery, migration timing), energy (PUE, tariff, renewable, heat reuse), commercial
(consumption, reserved share, term, one-offs, property share) and connectivity (fibre, paddock link, edge, cloud).
Season, position, confidence and venue are **held** (part of the question, not of the answer).

Each driver's bar is its exact **Shapley value**: the average, over every order in which the drivers could be
switched from Today's value to the plan's, of the seconds it adds when switched — so the bars always sum to the
headline exactly (efficiency axiom) and a driver whose inputs equal Today's is pruned to zero (null player). The same
is done for the aero and reinvestment channels, the CHF saved inside the cap and the effective MAUh; the waterfall
offers seconds, CHF and allowance as modes. An exact evaluation needs 2ⁿ runs for n active drivers (≤ 4,096); with
more than nine active drivers the method samples permutations.

**Plan level.** `seasonAttributionFn(result, year)` wraps `simulate()` so that each coalition is evaluated with the
**plan's go-live blend held fixed**: in 2027 the coalition's estate carries `shareNew` of the season against Today's
room for `shareOld` (plus the schedule loss), in 2028 the step-up blend of section 7. The bars therefore sum to the
**plan-level** headline the tiles show; the months a late 2028 step-up leaves on the 2027 estate appear as a
*baseline step*, not as a driver. At steady state the same bars would be larger in 2027 (no months on today's room).
Plan-level attribution for the GreenLake preset in 2028 (+0.425 s): power +0.321 (76 %), gpu +0.073 (17 %), data
+0.047 (11 %), processor +0.036 (9 %), cooling +0.036 (8 %), clock −0.060 (−14 %), connectivity −0.034 (−8 %); strategy
B in 2028 (+0.467 s): power +0.313, gpu +0.180, cooling +0.058, data +0.054, processor +0.023, clock −0.134,
connectivity −0.032. The attribution runs after each render (≈ 10–40 ms a season), so sliders never wait for it.

## 16. Explainers (`explain.js`, `explainPanel.js`)

Every control label, tile, flag, driver bar, strategy and deployment milestone carries a **?** (a 20 px glyph with a
44 × 44 px hit target) that opens **one shared panel** (`#explain-panel`: a side panel at ≥ 1200 px, a popover below
the button on narrower screens; Escape, Tab trap, outside click, one at a time, focus returned to the button). Each
entry is data in `explain.js`: title, the model's term, a one-liner (≤ 160 characters, no unexpanded acronym, British
spelling), layered *More* paragraphs, one analogy, an *In this plan* template filled live from the season's result
(`{x.…}` inputs, `{s.…}` the plan, `{t.…}` Today, `{p.…}` performance, `{a.…}` attribution, `{d.plan.…}` plan facts)
with a *zero* variant for pruned drivers, source chips (FIA rule ids and fact-pack rows; *model* for a modelling
choice) and glossary terms. `fillTemplate()` is a tiny safe resolver (dotted paths, arithmetic, whitelisted `fmt.*`),
not `eval`. **Plain English** (a `role="switch"`, default on for the Team view and off for the Solutions Architect
view, persisted as `podium.sim.plainEnglish`, `pe=0/1` in share links) swaps control and tile labels for the plain
titles (the model term stays as the tooltip), writes "million unit-hours" for MAUh, shows a flag's one-liner under
it and opens *More* expanded; off, the model's own labels return and the source chips come first. Printing adds an
**Explained** appendix: every active driver bar and every flag of both seasons with title, one-liner and the plan's
line. The *Model & sources* page carries the glossary.

## 17. What was removed: positions and points

Championship positions and points are **no outcome of this tool any more**: the position swing (0.10 s per place),
the points per place (25), the strategy points from trackside quality (± 6), the lap-time ladder, the "P8 → P5"
readouts and the points columns of the compare table, the strategy cards and the optimiser objectives are gone, and
nothing points-related renders anywhere (`npm test` checks the UI text). What replaced them: lap time stays in
**seconds per lap vs Today** per season and over both seasons; trackside value is read as **data-to-decision
seconds, link availability and race weekends at risk** (section 4). The **FIA input** *Constructors' position used
for the sliding scale* stays, because it sets the allowance (F4.6.1); J-e survives only as the copy's lay conversion
(J-k).
