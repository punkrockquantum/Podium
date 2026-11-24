import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  EXPLAIN, fillTemplate, labels, explainContext, explainText, CPU_ARCH,
  CONTROL_IDS, TILE_IDS, FLAG_IDS, DRIVER_IDS, STRATEGY_IDS, TERM_IDS, PENDING_IDS, PLAN_IDS,
} from "../public/js/sim/explain.js"
import { CONTROLS, PRESET_ORDER, presetInputs, evaluate, simulate, DEFAULTS } from "../public/js/sim/model.js"
import { DRIVERS, attribute } from "../public/js/sim/attribution.js"
import { STRATEGIES, STRATEGY_ORDER } from "../public/js/sim/strategies.js"
import { fmt } from "../public/js/sim/dom.js"

const here = dirname(fileURLToPath(import.meta.url))
const simDir = join(here, "../public/js/sim")
const OWN_MODULES = new Set(["explain.js", "attribution.js", "strategies.js", "optimiser.js"])
/** Every UI source file of the simulator (app.js and its views), minus the four pure modules under test. */
function uiSources(dir = simDir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...uiSources(path))
    else if (name.endsWith(".js") && !(dir === simDir && OWN_MODULES.has(name))) out.push(readFileSync(path, "utf8"))
  }
  return out
}
const uiSource = uiSources().join("\n")
const kinds = { control: CONTROL_IDS, tile: TILE_IDS, flag: FLAG_IDS, driver: DRIVER_IDS, strategy: STRATEGY_IDS, term: TERM_IDS }
const entriesOf = (kind) => kinds[kind].map((id) => [`${kind}.${id}`, EXPLAIN[`${kind}.${id}`]])

// Acronyms that must not appear unexpanded in a one-liner (brief 3.0) unless the title itself expands them.
const ACRONYMS = ["MAUh", "AUh", "CCF", "PUE", "CFD", "FP64", "ATR", "ATP", "GPU", "DLC", "TCO", "SLA", "NAS", "PFS", "RTT", "IPC", "kW/rack"]
const AMERICAN = /\b(colou?r(?<!colour)|optimiz(e|es|ed|ing|ation)|center|analyz(e|es|ed|ing)|utilization|organization|favor\b|behavior|catalog\b|defense|liter(s)?\b|kilometer|gray\b|modeling|modeled|traveled|canceled)\b/
const RETIRED_BRAND = new RegExp(["F", "L", "U", "X"].join(""), "i")
// Timeline flags raised by timeline.js on the customer branch (deployment view)
const TIMELINE_FLAGS = ["slip", "late27", "midatp", "shutdown", "boundary", "early28", "late28", "midatp28", "order28", "slip28"]

test("explain: every current control, tile, flag, driver, strategy and term has an entry", () => {
  for (const id of Object.keys(CONTROLS)) assert.ok(EXPLAIN[`control.${id}`], `control.${id} missing`)
  for (const id of ["cpuArch", "mlPartitionKW", "mlPlacement", "expansionRight"]) assert.ok(EXPLAIN[`control.${id}`], `control.${id} missing (pending control)`)

  // tile ids declared by the UI (stat-*, gauge-*, bar-*, headline-sec; headline-sub/-alert are text lines) plus the tiles the briefs add
  const appTileIds = [...uiSource.matchAll(/id:\s*"((?:stat|gauge|bar)-[a-z0-9-]+|headline-sec)"/g)].map((m) => m[1])
  assert.ok(appTileIds.length >= 7, `expected the UI to declare its tiles, found ${appTileIds.length}`)
  for (const id of new Set(appTileIds)) assert.ok(EXPLAIN[`tile.${id}`], `tile.${id} missing`)
  for (const id of ["headline-sec", "stat-aero", "stat-reinvest", "gauge-mauh", "gauge-cap", "stat-tco", "bar-power", "stat-decision"]) assert.ok(EXPLAIN[`tile.${id}`], `tile.${id} missing`)
  for (const id of ["season-strip", "venue-strip", "compare-table", "eff-bars", "waterfall", "envelope"]) assert.ok(EXPLAIN[`tile.${id}`], `tile.${id} missing`)
  for (const id of ["stat-golive", "stat-loss", "stat-critical", "stat-stepup", "stat-cash-total", "stat-tco3", "stat-sec-total"]) assert.ok(EXPLAIN[`tile.${id}`], `tile.${id} missing (planning tool)`)
  for (const id of TIMELINE_FLAGS) assert.ok(EXPLAIN[`flag.${id}`] && EXPLAIN[`flag.${id}`].plan, `flag.${id} missing (timeline)`)
  assert.equal(PLAN_IDS.length, 7 + TIMELINE_FLAGS.length)

  // flag ids emitted by the model over presets × seasons and some extremes
  const seen = new Set()
  const probes = [
    ...PRESET_ORDER.flatMap((p) => [2027, 2028].map((season) => presetInputs(p, season, { season }))),
    presetInputs("today", 2027, { cooling: "dlc", rackKW: 150, location: "hinwil" }),
    presetInputs("today", 2027, { cooling: "reardoor", location: "hinwil", leadWeeks: 6, nodes: 40 }),
    presetInputs("dr2027", 2027, { location: "hybrid", migrationTiming: "midperiod", gpus: 4, solverGpus: 2, cooling: "air", rackKW: 60 }),
    presetInputs("dr2027", 2027, { nodes: 0 }),
    presetInputs("gl2028", 2028, { expansionRight: false, committedKW: 250 }),
  ]
  for (const x of probes) for (const f of simulate(x).flags) seen.add(f.id)
  assert.ok(seen.size >= 8, `expected at least 8 distinct flag ids, saw ${[...seen]}`)
  for (const id of seen) assert.ok(EXPLAIN[`flag.${id}`], `flag.${id} missing`)
  for (const id of ["arch", "armport"]) assert.ok(EXPLAIN[`flag.${id}`], `flag.${id} missing (pending flag)`)

  for (const d of DRIVERS) assert.ok(EXPLAIN[`driver.${d.id}`], `driver.${d.id} missing`)
  assert.deepEqual(DRIVER_IDS, DRIVERS.map((d) => d.id), "driver entries follow the attribution display order")
  for (const k of STRATEGY_ORDER) assert.ok(EXPLAIN[`strategy.${k}`], `strategy.${k} missing`)
  for (const [, e] of Object.entries(EXPLAIN)) for (const t of e.terms || []) assert.ok(EXPLAIN[t], `${e.kind}.${e.id} links to unknown ${t}`)
  assert.ok(TERM_IDS.length >= 25)
  assert.ok(PENDING_IDS.includes("control.cpuArch") && PENDING_IDS.includes("driver.cpuArch"))
})

test("explain: copy rules — shape, one-liner length, no unexpanded acronym, British spelling", () => {
  for (const [id, e] of Object.entries(EXPLAIN)) {
    assert.ok(e.title && e.one && e.analogy && e.source, `${id} incomplete`)
    assert.ok(Array.isArray(e.more) && e.more.length >= 1, `${id} needs 'more' bullets`)
    assert.ok(e.one.length <= 160, `${id} one-liner is ${e.one.length} chars: ${e.one}`)
    assert.ok(e.analogy.length <= 120, `${id} analogy too long`)
    for (const a of ACRONYMS) {
      const re = new RegExp(`(^|[^A-Za-z])${a.replace("/", "\\/")}([^A-Za-z]|$)`)
      if (re.test(e.one)) assert.ok(e.title.includes(a), `${id} one-liner uses ${a} without the title expanding it`)
    }
    const text = [e.one, ...e.more, e.analogy, e.zero || ""].join(" ")
    assert.ok(!AMERICAN.test(text), `${id} uses an American spelling: ${(text.match(AMERICAN) || [])[0]}`)
    assert.ok(!RETIRED_BRAND.test(JSON.stringify(e)), `${id} mentions the retired product name`)
    if (e.kind === "driver") assert.ok(e.zero, `${id} needs a 'zero' text for the pruned case`)
    if (e.kind !== "term") assert.equal(typeof e.inPlan, "string", `${id} needs an inPlan template`)
  }
  for (const id of ["control.clockGHz", "driver.clock", "tile.gauge-mauh"]) assert.match(EXPLAIN[id].source, /F4|C\d/)
})

test("explain: every template fills for every preset × season without braces, undefined, NaN or Infinity", () => {
  for (const preset of PRESET_ORDER) for (const season of [2027, 2028]) {
    const inputs = presetInputs(preset, season, { season })
    const result = evaluate(inputs)
    const both = { 2027: evaluate({ ...inputs, season: 2027 }), 2028: evaluate({ ...inputs, season: 2028 }) }
    const attribution = attribute(inputs)
    const ctx = explainContext({ result, attribution, both, fmt })
    for (const [id, e] of Object.entries(EXPLAIN)) {
      if (!e.inPlan) continue
      const missing = []
      const out = fillTemplate(e, ctx, { onMissing: (w) => missing.push(w) })
      assert.deepEqual(missing, [], `${id} [${preset} ${season}] unresolved: ${missing.join(", ")}`)
      assert.ok(!/[{}]/.test(out), `${id} [${preset} ${season}] left braces: ${out}`)
      assert.ok(!/undefined|NaN|Infinity|—/.test(out), `${id} [${preset} ${season}] bad value: ${out}`)
      assert.ok(out.length > 0)
    }
  }
})

test("explain: templates also fill for the strategies and with pending inputs present", () => {
  for (const k of STRATEGY_ORDER) for (const season of [2027, 2028]) {
    const inputs = { ...STRATEGIES[k].shared, ...STRATEGIES[k][season], season, cpuArch: "bigcache" }
    const result = evaluate(inputs)
    const ctx = explainContext({ result, attribution: attribute(inputs), fmt })
    assert.equal(ctx.d.archLabel, CPU_ARCH.bigcache.label)
    for (const id of ["strategy.A", "strategy.B", "strategy.C", "driver.cpuArch", "control.cpuArch", "control.mlPartitionKW", "control.mlPlacement", "tile.envelope"]) {
      const out = fillTemplate(EXPLAIN[id], ctx, { onMissing: (w) => assert.fail(`${id}: unresolved ${w}`) })
      assert.ok(!/[{}]|undefined|NaN/.test(out), `${id}: ${out}`)
    }
  }
})

test("explain: plan-level tiles and timeline flags fill from a plan.js result, and degrade to 'no move' without one", () => {
  const result = evaluate(presetInputs("dr2027"))
  const noPlan = explainContext({ result, fmt })
  assert.equal(noPlan.d.plan.goLiveLabel, "No move in 2027")
  assert.equal(noPlan.d.plan.stepUpLabel, "No 2028 step-up: 2028 runs the 2027 estate")
  assert.equal(noPlan.d.plan.cash, 0)
  const planShaped = {
    timeline: {
      seasons: {
        2027: { changes: true, goLive: Date.UTC(2027, 2, 8), slipDays: 12, shareOld: 0.18, downtimeDays: 1, periodLoss: 0.018, seasonLoss: 0.003, atp: { label: "ATP 2" }, critical: "fibre", totalWeeks: 14.5, slackDays: 0 },
        2028: { changes: true, goLive: Date.UTC(2027, 11, 6), earlyDays: 26, earlyCostCHF: 48_000, shareOld: 0, periodLoss: 0, slipDays: 0, orderBy: Date.UTC(2027, 8, 27) },
      },
    },
    totals: { cash: 7_800_000, todayCash: 6_100_000, cashDelta: 1_700_000, tco3: 10_200_000, todayTco3: 8_900_000, sec: 0.51, points: 23.4 },
  }
  const ctx = explainContext({ result, plan: planShaped, fmt })
  assert.equal(ctx.d.plan.goLiveLabel, "Live 8 Mar 2027")
  assert.equal(ctx.d.plan.criticalLabel, "The fibre route")
  assert.equal(ctx.d.plan.stepUpLabel, "2028 step-up 6 Dec 2027")
  assert.equal(ctx.d.plan.stepUpNote, ", 4 weeks before graphics processors are allowed")
  assert.equal(ctx.d.plan.orderByLabel, "27 Sep 2027")
  for (const id of PLAN_IDS) {
    for (const c of [ctx, noPlan]) {
      const out = fillTemplate(EXPLAIN[id], c, { onMissing: (w) => assert.fail(`${id}: unresolved ${w}`) })
      assert.ok(!/[{}]|undefined|NaN|Infinity|—/.test(out), `${id}: ${out}`)
    }
  }
  assert.equal(fillTemplate(EXPLAIN["tile.stat-golive"], ctx), "Live 8 Mar 2027: 18 % of 2027 on today's setup, slipped 12 days.")
  assert.equal(fillTemplate(EXPLAIN["tile.stat-loss"], ctx), "1.8 % of the period, 0.30 % of the season: 1 solver days.")
  assert.equal(fillTemplate(EXPLAIN["tile.stat-critical"], ctx), "The fibre route: 15 weeks from contract to the earliest switch.")
  assert.equal(fillTemplate(EXPLAIN["tile.stat-cash-total"], ctx), "CHF 7.8 M over both seasons, +CHF 1.7 M vs staying as today (CHF 6.1 M).")
  assert.equal(fillTemplate(EXPLAIN["tile.stat-sec-total"], ctx), "+0.51 s over two seasons, worth about +23 points at 60 % confidence.")
  assert.equal(fillTemplate(EXPLAIN["flag.order28"], ctx), "Order by 27 Sep 2027; 2028 step-up 6 Dec 2027.")
  // a string date and a late 2028 landing
  const late = explainContext({ result, fmt, plan: { timeline: { seasons: { 2028: { changes: true, goLive: "2028-02-14", shareOld: 0.12 } } } } })
  assert.equal(late.d.plan.stepUpLabel, "2028 step-up 14 Feb 2028")
  assert.equal(late.d.plan.stepUpNote, ", 12 % of 2028 on the 2027 estate")
})

test("explain: fillTemplate is a safe resolver (arithmetic, whitelisted fmt, '—' + onMissing for the rest)", () => {
  const ctx = { x: { nodes: 8, confidence: 60 }, s: { comp: { usage: 0.94 } }, fmt, both: { 2027: { v: 1 } } }
  assert.equal(fillTemplate("{x.nodes} nodes", ctx), "8 nodes")
  assert.equal(fillTemplate("{x.nodes * 2 + 1}", ctx), "17")
  assert.equal(fillTemplate("{x.confidence / 100}", ctx), "0.6")
  assert.equal(fillTemplate("{fmt.pct(s.comp.usage)}", ctx), "94 %")
  assert.equal(fillTemplate("{fmt.pct(1 - s.comp.usage, 1)}", ctx), "6.0 %")
  assert.equal(fillTemplate("{fmt.chf(1234567)}", ctx), "CHF 1.2 M")
  assert.equal(fillTemplate("{both.2027.v}", ctx), "1")
  assert.equal(fillTemplate("{'a' + 'b'}", ctx), "ab")
  assert.equal(fillTemplate("{-x.nodes}", ctx), "-8")
  const missing = []
  const out = fillTemplate("{x.missing} {fmt.evil(1)} {1 +} {y.z} {fmt.num(x.nodes, 1)}", ctx, { onMissing: (w) => missing.push(w) })
  assert.equal(out, "— — — — 8.0")
  assert.ok(missing.some((m) => m === "x.missing") && missing.some((m) => m === "fmt.evil") && missing.some((m) => m.startsWith("syntax")) && missing.includes("y.z"))
  assert.equal(fillTemplate("{constructor.constructor('return 1')()}", ctx, { onMissing: () => {} }), "—", "no code execution through the resolver")
  assert.equal(fillTemplate("{x.nodes.toString}", ctx, { onMissing: () => {} }).includes("function"), false)
  assert.equal(fillTemplate("plain text", ctx), "plain text")
  assert.equal(fillTemplate(EXPLAIN["control.nodes"], { ...ctx, x: { nodes: 8, coresPerNode: 128 }, s: { hw: { cores: 1024 }, comp: { usage: 0.94 } } }), "8 servers × 128 cores = 1024 cores, using 94 % of the allowance.")
})

test("explain: explainText falls back to the 'zero' copy for a pruned driver", () => {
  const inputs = presetInputs("dr2027")
  const result = evaluate(inputs)
  const a = attribute(inputs)
  const ctx = explainContext({ result, attribution: a, fmt })
  const pruned = a.drivers.find((d) => d.pruned)
  assert.ok(pruned, "dr2027 has at least one pruned driver")
  assert.equal(explainText(`driver.${pruned.id}`, ctx, { pruned: true }), EXPLAIN[`driver.${pruned.id}`].zero)
  assert.match(explainText("driver.power", ctx), /Hinwil room is \d+ kW short/)
  assert.equal(explainText("term.atr", ctx), "")
})

test("explain: labels() swaps plain titles, unit words and bar labels", () => {
  const plain = labels(true)
  const model = labels(false)
  assert.equal(plain.title("clockGHz"), "Declared clock")
  assert.equal(model.title("clockGHz"), CONTROLS.clockGHz.label)
  assert.equal(plain.title("tile.gauge-mauh"), "Computing allowance used")
  assert.equal(model.title("tile.gauge-mauh"), "MAUh used")
  assert.equal(plain.unitWord("MAUh"), "million unit-hours")
  assert.equal(model.unitWord("MAUh"), "MAUh")
  assert.equal(plain.unitWord("kW"), "kW")
  assert.equal(plain.barLabel("power"), "Enough power for every server (the move)")
  assert.match(model.barLabel("power"), /\(facility power factor\)$/)
  assert.equal(plain.barLabel("cpuArch", "bigcache"), CPU_ARCH.bigcache.bar)
  assert.equal(plain.barLabel("cpuArch"), EXPLAIN["driver.cpuArch"].title)
  assert.equal(plain.title("nonsense"), "nonsense")
})

test("explain: explainContext derives the plain-English facts the templates need", () => {
  const result = evaluate(presetInputs("gl2028"))
  const ctx = explainContext({ result, fmt })
  assert.equal(ctx.d.siteName, "Digital Realty Zurich")
  assert.equal(ctx.d.todaySiteName, "Hinwil room")
  assert.equal(ctx.d.option.cooling, "Direct liquid")
  assert.equal(ctx.d.option.consumption, "HPE GreenLake")
  assert.equal(ctx.d.option.cpuArch, CPU_ARCH.today.label)
  assert.equal(ctx.d.ml.kW, 0)
  assert.equal(ctx.d.envelope.offerKW, 500)
  assert.ok(ctx.d.envelope.drIT > 500, "the committed gl2028 estate is over the 500 kW offer until it is re-based")
  assert.equal(ctx.d.sec2028, result.perf.sec)
  assert.equal(ctx.d.leadLabel, "6 wk early")
  assert.ok(Math.abs(ctx.d.aeroSec + ctx.d.reinvestSec - result.perf.sec) < 0.0021)
  assert.equal(ctx.x.confidence, DEFAULTS.confidence)
  assert.equal(ctx.a.n, undefined, "no attribution → no bars")
  assert.throws(() => explainContext({}), /needs an evaluate\(\) result/)
})
