# Audi F1 Team × Digital Realty — how the infrastructure performance simulator works

The simulator (`public/sim.html`, code in `public/js/sim/`) takes one scenario — the Restricted CFD cluster,
where it lives, how it is paid for and how the paddock is connected — and turns it into FIA compliance,
effective compute, trackside responsiveness, money and sustainability, then into **seconds per lap found over a
season against Today's setup** in the same season. Everything is deterministic and recomputed on every input
change by pure functions in `public/js/sim/model.js`; the constants live in `public/js/customer.js` (`FIGURES`)
and `public/js/sim/assumptions.js` (`K`), each keyed to a row of [`audi-f1-sources.md`](audi-f1-sources.md).
Row keys in brackets below point there.

The provider is **Digital Realty** (Zurich campus). The OEM dimension assumes **HPE via HPE GreenLake**: the sales
lead's working assumption for the demo, not a statement about the team's actual suppliers.

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
≈ 95 kW short of the estate; in 2028 ≈ 480 kW short, which is why the 2028 deltas are large.

## 7. Presets (headline at 60 % confidence, P8)

| Preset | Season | Effective MAUh / ATP | Seconds per lap vs Today | Cost-cap charge Δ | Notes |
|---|---|---|---|---|---|
| Today: Hinwil on-prem | 2027 | 3.84 | 0 | 0 | 99 % of 6.3 MAUh used; room 94 kW short, NAS-starved, N redundancy |
| Digital Realty Zurich 2027 | 2027 | 6.15 | ≈ +0.13 s | ≈ +CHF 1.1 M | 12 nodes, InfiniBand NDR, parallel storage, rear-door rows, N+1, two fibre routes, edge |
| Digital Realty + HPE GreenLake 2028 | 2028 | 7.21 | ≈ +0.36 s | ≈ +CHF 2.3 M | 8 nodes at 3.0 GHz + 2 solver GPUs (6 unrestricted), Slingshot, flash, direct liquid, 2N, expansion right |

The headline numbers move with every slider; `npm test` pins their direction (monotonicity) and their order, not the
decimals.

## 8. What the model does not do

* No stochastic simulation: availability and failures are expected values.
* No GPU conversion rule exists yet (F4.4.1); the FP64 normalisation and the charge-factor slider are assumptions.
* Wind-tunnel hours, RATGs and occupancy hours follow the sliding scale but are not traded against compute.
* Indexation of the cost cap and FX movements are ignored; the cap is shown at the Initial Applicable Rate.
* The rest of the IT estate costs the same in every scenario and is only modelled for power and PUE.
