# Audi F1 Team × Digital Realty — the four pure modules (explain, attribution, strategies, optimiser)

Four dependency-free ES modules under `public/js/sim/`, no DOM, built from the explain brief and the strategies brief
against the committed `model.js`. They run in the browser and under Node 22 (`node --test`). Nothing existing was
changed: the modules import the committed `model.js` / `assumptions.js` / `customer.js` and carry **transitional**
shims for the model changes the briefs ask for; the shims switch themselves off once those land (see §3).

## 1. Exports

### `explain.js` — plain-English copy and the safe template resolver

| Export | What it is |
|---|---|
| `EXPLAIN` | 145 entries keyed `control.<id>` (44), `tile.<id>` (37), `flag.<id>` (21), `driver.<id>` (12), `strategy.A/B/C`, `term.<id>` (28). Each `{ id, kind, title, term, one, more[], analogy, inPlan, zero?, source, terms[], pending?, plan? }`. British English, one-liners ≤ 160 chars, no unexpanded acronym unless the title expands it. |
| `CONTROL_IDS`, `TILE_IDS`, `FLAG_IDS`, `DRIVER_IDS`, `STRATEGY_IDS`, `TERM_IDS` | Id lists in display order. |
| `PENDING_IDS` | Entries for controls/flags the committed model lacks: `control.cpuArch`, `control.expansionRight`, `control.mlPartitionKW`, `control.mlPlacement`, `flag.arch`, `flag.armport`, `driver.cpuArch`. |
| `PLAN_IDS` | The 17 entries of the two-season planning tool (tiles `stat-golive`, `stat-loss`, `stat-critical`, `stat-stepup`, `stat-cash-total`, `stat-tco3`, `stat-sec-total`; timeline flags `slip`, `late27`, `midatp`, `shutdown`, `boundary`, `early28`, `late28`, `midatp28`, `order28`, `slip28`). Their templates read `explainContext({ plan })`. |
| `CPU_ARCH` | Mirror of the proposed `K.compute.cpuArch` table (explain brief 2.5): label, bar label, `workPerAuh` and `kwFactor` per season. Used only for copy; the model's table wins when present. |
| `fillTemplate(templateOrEntry, ctx, { onMissing })` | Resolves `{dotted.path}`, numbers, `'strings'`, `+ − * /`, parentheses and whitelisted `fmt.*(…)` calls with a tokenizer + recursive-descent parser. No `eval`, no `Function`, no prototype walking. Unresolved → `—` and `onMissing(path)`. |
| `explainText(id, ctx, { pruned, onMissing })` | `inPlan` filled, or the `zero` copy for a pruned driver; `""` for terms. |
| `labels(plainEnglish)` | `{ title(id), unitWord(unit), barLabel(driverId, option?) }`; model mode appends the technical term. |
| `explainContext({ result, attribution?, both?, plan?, fmt?, plainEnglish? })` | `{ x, s, t, p, a, d, K, fmt, labelsFor }` from an `evaluate()` result: `d` holds the derived facts the templates use (site names, power fit, cost lines with zero defaults, envelope share, ML partition, architecture, timeline/plan facts…), `a` the attribution rows by id plus `total`, `baseline`, `n`, `top`. |

### `attribution.js` — Shapley attribution of the lap-time gain

| Export | What it is |
|---|---|
| `DRIVERS`, `DRIVER_ORDER` | Twelve groups in the brief's order: power, cpuArch (pending), processor, clock, gpu, data, cooling, resilience, timing, energy, commercial, connectivity. Each `{ id, label, inputs[], pending? }`. |
| `HELD` | Inputs never attributed: `season`, `position`, `confidence`, `venue`. |
| `OUTCOMES` | `["sec","aeroSec","reinvestSec","savedCHF","effMauhDelta","strategyPoints","points"]`. |
| `attribute(planInputs, options)` | `{ method, drivers[], total, baseline, plan, evaluations, exact, samples, order, active, n, inputs, ms, cached }`. Rows `{ id, label, sec, aeroSec, reinvestSec, savedCHF, effMauhDelta, strategyPoints, points, share, pruned }`. Options: `method: "shapley" \| "waterfall"`, `order`, `evaluateFn` (default committed `evaluate`), `valueFn`, `drivers`, `venueInBaseline`, `maxExact` (12), `samples` (200), `seed`, `cache`. Exact Shapley over the active (non-null) drivers; sampled permutations above `maxExact`; memoised per model function and per plan. Σ rows == total to 1e-9 in every column; points are allocated ∝ seconds (brief J-j). |
| `waterfallSteps(result, order?, { outcome, includePruned })` | `[{ id:"baseline", from, to, value }, …drivers…, { id:"total" }]` for drawing; the ordered waterfall is a drawing only. |
| `checkCoverage(drivers?)` | `{ missing, duplicates, pending }` against `CONTROLS`; both lists empty on the committed model. |
| `outcomesOf`, `sumError`, `clearAttributionCache`, `PENDING_BASE`, `PENDING_INPUTS` | Helpers and the pending-input defaults (`cpuArch: "today"`, `mlPartitionKW: 0`, `mlPlacement: "dr"`). |

### `strategies.js` — the 500 kW envelope and strategies A / B / C

| Export | What it is |
|---|---|
| `ENVELOPE` | Offer 500 kW, base estate 375, demand estate {375, 760}, cooling ceilings {air 20, rear-door 70, DLC 150}, CCF floors {64: 2.4, 96: 2.3, 128: 2.4, 192: 2.25}, 60 cage positions at 8 kW, cap guard-rail CHF 4 M, liquid rows CHF 0.45 M. Reads `K` where the key exists, else the brief's value. |
| `STRATEGIES`, `STRATEGY_ORDER`, `SEASONS`, `COMMON`, `strategyByKey` | A consolidate · B density · C efficient, each `{ key, id, name, tagline, story, shared, 2027, 2028, cutover, timeline[], provides: { dr, hpe }, risks[], openQuestions[] }` as in brief 2.1 / 2.3. |
| `planInputs(plan, season)`, `planFromInputs(inputs)`, `sharedOf(plan)` | Plan ⇄ single-season input sets; `ml` → `mlPartitionKW`; `expansionRight` forced `false`. |
| `envelopeCheck(scenario, { mlKW, mlPlacement })` | Brief 1.2 fit rows → `{ fits, reasons[], guardrails[], ok, offerKW, drIT, headroomKW, drHeadroomKW, share, hinwilIT, hinwilCap, racks: { estate, cluster, ml, total }, … }`. Allowance > 100 % and cap > CHF 4 M are guard-rails, not fit rows. |
| `envelopeEvaluate(inputs, { mlKW, liquidRows })` **transitional** | `evaluate()` with the estate re-split (base 375 for scenarios, demand estate for Today), the ML partition placed, the † liquid-rows one-off, plus `envelope`, `perf.secExact`, `perf.pointsExact`; `status: "bad"` when the plan does not fit. Delegates to the model once `TRANSITIONAL` is false. |
| `evaluatePlan(plan, { position, confidence, venue, evaluateFn })` | `{ 2027, 2028, fits, ok, reasons }` with a `summary` per season. |
| `evaluateStrategy(idOrKey, opts)`, `evaluateStrategies()`, `summary(ev)`, `clearStrategyCache()` | Memoised for the default model. |
| `estateForScenario`, `simulateWithEstate`, `envelopeOf`, `TRANSITIONAL` | The shim and its switch (see §3). |

### `optimiser.js` — seeded coordinate descent over the plan

| Export | What it is |
|---|---|
| `OBJECTIVES`, `OBJECTIVE_ORDER` | `fastest2028` (sec28 + 0.1·sec27, side condition sec27 ≥ 0.10), `points`, `headroom`, `balanced`, each `{ id, label, formula, sideCondition, score(result) }`. |
| `SEARCH_SPACE`, `LOCKED_BY_DEFAULT`, `FIXED` | Shared and per-season controls with their value grids and `lockedByDefault` (policy controls, `committedKW`, `gpuModel`, `leadWeeks`, `mlPartitionKW`). `nodes` is derived by the fill move. |
| `optimise({ start, objective, evaluatePlan, fits, locked, restarts, maxSweeps, maxPlans, seed, fill, onProgress, shouldStop })` | `{ objective, best, score, result, fits, start, startScore, startResult, diff, evaluations, candidates, ms, trace[], stopped, … }`. Deterministic for a seed (mulberry32); memoised per canonical plan; every returned plan passes `fits`. |
| `diffPlans(a, b)` | `[{ scope: "shared" \| 2027 \| 2028, id, from, to }]`. |
| `fillNodes`, `clampPlan`, `canonicalPlan`, `defaultFits`, `scorePlan`, `randomPlan`, `mulberry32`, `ccfFloor`, `DEFAULTS` | Building blocks, all exported for the UI and the worker. |

Headline numbers reproduced: strategies at P8 / 60 % give +0.137 / +0.369 s (A), +0.224 / +0.467 s (B), +0.193 / +0.464 s (C) for 2027 / 2028 with the brief's kW, cap and TCO figures; `attribute()` gives the brief's tables (dr2027 +0.137 s over 8 active drivers, 256 evaluations; gl2028 +0.390 s over 11, ≈ 60 ms); `optimise({ start: STRATEGIES.A, objective: "fastest2028" })` reaches +0.51 s in 2028 in ≈ 1,600 evaluations.

## 2. Wiring

* **Explainer**: build `ctx = explainContext({ result, attribution, both, plan, fmt })` once per render and fill
  `EXPLAIN[id].inPlan` with `fillTemplate` (or `explainText`). `labels(plainEnglish)` drives the plain-English
  toggle. The copy is keyed by the ids the UI already uses (`stat-*`, `gauge-*`, `bar-*`, flag ids, control ids).
* **Waterfall**: `attribute(inputs)` for the current inputs; draw `waterfallSteps(result)`; the bar label is
  `labelsFor.barLabel(id, x.cpuArch)`; a pruned driver shows the entry's `zero` text.
* **Strategy cards**: `evaluateStrategies()` for the three cards; a card's "use this plan" loads `planInputs(s, season)`
  into the simulator. Pass `evaluateFn: envelopeEvaluate` to `attribute()` to attribute a strategy under the envelope.
* **Optimiser**: run it in a Web Worker (§4); `diffPlans(start, best)` feeds the "what changed" list.

### Model changes the modules expect (strategies brief 5.3, explain brief 2.5)

| # | Change in `model.js` / `assumptions.js` | Shim that then goes |
|---|---|---|
| 5.2 | `K.facility.envelopeKW`, `estateBaseKW`, `estateDemandKW`, `cageRackPositions`, `estateRackKW`; `K.compute.ccfFloorGHz`; `K.prices.drLiquidRowsCHF`; `K.optimiser` | `ENVELOPE` fallbacks; `DEFAULTS` in `optimiser.js` |
| 1 | `expansionRight` removed; `committedKW` 250–500, default 500 | `planInputs` forcing `expansionRight: false`; the fit row in `envelopeCheck` |
| 2 | `mlPartitionKW`, `mlPlacement` controls | `PENDING_BASE` / `RELEVANT` handling in `attribution.js`; `mlOf()` in `strategies.js` |
| 3 | `facility()` splits the estate (`x.baseline` set by `todayInputs()`), places the ML partition, `drCapacity = envelopeKW`, `drHeadroomKW`, `racks` | `estateForScenario`, `simulateWithEstate` (the try/finally over `K.facility.restOfEstateKW`), `withLiquidRows` |
| 4 | `envelope(x, hw, fac)` on `simulate()`, `status: "bad"` when it does not fit | `envelopeEvaluate` (delegates as soon as `TRANSITIONAL` is false); `envelopeOf` |
| 6–7 | CCF floor and density clamp as `bad` flags | `clampPlan` keeps clamping for the search; `defaultFits` stops re-checking |
| 8 | `liquidrows` one-off | `withLiquidRows` |
| 9–10 | presets re-based; `evaluateBothSeasons({ 2027, 2028 })` | nothing in the modules |
| 2.5 | `cpuArch` control, `K.compute.cpuArch`, `comp.eff.arch`, flags `arch` / `armport` | the `CPU_ARCH` mirror in `explain.js`; `pending` on the cpuArch entries and driver |

Two things for the integrator to watch. (a) Once `todayInputs()` sets `x.baseline = true` (change 3), decide what
the attribution's coalitions carry: `attribute()` builds every coalition from `todayInputs()` (`baseFor()` in
`attribution.js`) plus the plan's values for the drivers in the coalition. Recommended rule: keep `baseline: true`
only while the **power** driver (`location`, `committedKW`, `hinwilRetrofit`, `expansionRight`) is absent, so v(∅)
stays the real Today (760 kW estate in 2028) and the estate re-split is credited to the move, where it belongs.
(b) The tip of the customer branch exports `perfBlock(scenario, today)`; `envelopeEvaluate` can call it instead of
its inline copy once merged (keep `secExact` / `pointsExact` unrounded for the optimiser).

## 3. Transitional couplings (exact imported names)

| Module | Imports | Transitional use |
|---|---|---|
| `explain.js` | `CONTROLS`, `DEFAULTS` from `model.js`; `K` from `assumptions.js`; `costCapCHF` from `customer.js` | `CPU_ARCH` mirror; `ENVELOPE_KW` fallback when `K.facility.envelopeKW` is absent |
| `attribution.js` | `evaluate`, `simulate`, `normalize`, `todayInputs`, `aeroSeconds`, `reinvestSeconds`, `CONTROLS` from `model.js`; `K` | `PENDING_BASE` / `RELEVANT` for the pending inputs; the `venueInBaseline` option (model limitation b) |
| `strategies.js` | `evaluate`, `simulate`, `normalize`, `todayInputs`, `aeroSeconds`, `reinvestSeconds` from `model.js`; `K`; `FIGURES` from `customer.js` | `TRANSITIONAL`, `estateForScenario`, `simulateWithEstate`, `withLiquidRows`, the inline perf block in `envelopeEvaluate` |
| `optimiser.js` | `K`; `ENVELOPE`, `SEASONS`, `evaluatePlan`, `sharedOf` from `strategies.js` | `DEFAULTS` fallbacks until `K.optimiser` exists |

`simulateWithEstate` mutates `K.facility.restOfEstateKW[season]` for the duration of one `simulate()` call and
restores it in `finally`; it is the only side effect in the four modules and disappears with change 3.

## 4. Web Worker shape for the optimiser

```js
// public/js/sim/optimiser.worker.js (to be added by the integrator)
import { optimise } from "./optimiser.js"          // pulls strategies.js → model.js, all pure
let stop = false
self.onmessage = ({ data }) => {
  if (data.type === "stop") { stop = true; return }
  stop = false
  const r = optimise({
    ...data.options,                                   // start, objective, locked, restarts, maxPlans, seed, fill
    onProgress: (p) => self.postMessage({ type: "progress", done: p.done, total: p.total, bestScore: p.bestScore }),
    shouldStop: () => stop,
  })
  self.postMessage({ type: "done", best: r.best, score: r.score, diff: r.diff, evaluations: r.evaluations, ms: r.ms, stopped: r.stopped, trace: r.trace })
}
```

`onProgress` fires every 100 evaluations and at the end; `shouldStop` is read before every evaluation and the best
plan so far is returned. Results are plain data (no functions), so they cross `postMessage` as they are. Without
worker support, run `optimise()` on the main thread with `maxPlans ≈ 1500` per chunk and resume from `r.best`.

## 5. Tests

```sh
npm test                                   # everything (tests/*.test.js), the four module suites included
node --test tests/sim.explain.test.js      # coverage, copy rules, templates fill for presets × seasons, safe resolver
node --test tests/sim.attribution.test.js  # Σ == total, order invariance, null player, < 150 ms, venue, sampling
node --test tests/sim.strategies.test.js   # A/B/C fit both seasons, brief 2.4 numbers ±0.01 s, fit rows, K restored
node --test tests/sim.optimiser.test.js    # deterministic, every plan fits, ≥ +0.45 s in 2028, shouldStop, diffPlans
```

The four suites (37 tests) run in about 1.5 s together. The explain coverage test scans every UI source under
`public/js/sim/` for declared tile ids, so a new `stat-*` tile without an `EXPLAIN` entry fails the build.
