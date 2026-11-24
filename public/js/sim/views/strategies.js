/**
 * Strategies: three fixed plans (A · Consolidate and de-risk, B · Density and the 2028 GPU step-up, C · Cost-cap-
 * optimised hybrid cloud) as cards, a side-by-side table with Today, a small chart and the optimiser panel
 * "Find the best use of 500 kW". Every figure is plan-level: the strategy is loaded into a plan.js plan with the
 * strategy timeline and evaluated with the go-live blend, exactly as the planner would show it after "Load".
 * The cards borrow only position, confidence and venue from the current plan.
 */
import { CONTROLS, ccfFloor } from "../model.js"
import { K } from "../assumptions.js"
import { evaluatePlan, normalizePlan, presetPlan, seasonInputs, controlDisplay, SHARED_IDS, SEASON_IDS, envelopeLine } from "../plan.js"
import { STRATEGIES, STRATEGY_ORDER, strategyPlan, matchingStrategy, planFromSets } from "../strategies.js"
import { OBJECTIVES, OBJECTIVE_ORDER, SEARCH_SPACE, LOCKED_BY_DEFAULT, DEFAULTS, startFromPlan } from "../optimiser.js"
import { createOptimiserRunner } from "../optimiserRunner.js"
import { el, svg, clear, fmt, fill } from "../dom.js"
import { envelopeGauge, badge, stat, waterfall, explainButton } from "../widgets.js"
import { raceNowButtons } from "./overview.js"
import { fmtDate, parseDate, atpCalendar } from "../timeline.js"
import { PROVIDER } from "../assumptions.js"
import { seasonAttributionFn } from "../plan.js"
import { attribute } from "../attribution.js"
import { EXPLAIN, explainContext, explainText } from "../explain.js"

const COOLING = { air: "air", reardoor: "rear-door", dlc: "direct liquid" }
const RED = { n: "N", n1: "N+1", "2n": "2N" }
const label = (id, v) => controlDisplay(id, v)
const SEASONS = [2027, 2028]
const letterOf = (key) => key
const nameOf = (st) => st.name.replace(/^[A-C]\s*·\s*/, "")

// ---------------------------------------------------------------------------------------------
// Plan-level evaluation of a strategy, memoised on the three borrowed inputs
// ---------------------------------------------------------------------------------------------

const memo = new Map()
function strategyResult(key, shared) {
  const k = `${key}|${shared.position}|${shared.confidence}|${shared.venue}`
  let hit = memo.get(k)
  if (!hit) {
    const plan = normalizePlan(strategyPlan(key, shared))
    hit = { plan, result: evaluatePlan(plan) }
    memo.set(k, hit)
  }
  return hit
}
/** Plan-level attribution of a strategy, per season; memoised with the result. Costs ≈ 100 ms per strategy, so cards fill it in after they render. */
function strategyAttribution(key, shared) {
  const hit = strategyResult(key, shared)
  if (!hit.attribution) hit.attribution = Object.fromEntries(SEASONS.map((y) => [y, attribute(seasonInputs(hit.plan, y), { evaluateFn: seasonAttributionFn(hit.result, y), cache: false })]))
  return hit.attribution
}

function todayResult(shared) {
  const k = `today|${shared.position}|${shared.confidence}`
  let hit = memo.get(k)
  if (!hit) {
    const base = presetPlan("today")
    const plan = normalizePlan({ ...base, shared: { ...base.shared, position: shared.position, confidence: shared.confidence } })
    hit = { plan, result: evaluatePlan(plan) }
    memo.set(k, hit)
  }
  return hit
}

// ---------------------------------------------------------------------------------------------
// Card pieces
// ---------------------------------------------------------------------------------------------

/** Decision rows: [label, value2027, value2028]; equal values span both columns. */
function decisionRows(plan, result) {
  const x = Object.fromEntries(SEASONS.map((y) => [y, seasonInputs(plan, y)]))
  const t = result.timeline.seasons
  const row = (name, f) => [name, f(x[2027], 2027), f(x[2028], 2028)]
  return [
    row("Cluster", (s) => `${s.nodes} × ${s.coresPerNode} c @ ${s.clockGHz.toFixed(1)} GHz${s.cpuArch !== "today" ? ` · ${label("cpuArch", s.cpuArch).split(" · ")[0]}` : ""}`),
    row("Fabric · storage", (s) => `${label("interconnect", s.interconnect)} · ${label("storage", s.storage)}`),
    row("GPUs", (s) => (s.gpus ? `${s.gpus} × ${label("gpuModel", s.gpuModel).split(" · ")[0].replace(/-class.*$/, "")} (${s.solverGpus} solver)` : "none")),
    row("ML partition", (s) => (s.mlPartitionKW ? `${s.mlPartitionKW} kW · ${label("mlPlacement", s.mlPlacement)}` : "0 kW")),
    row("Consumption", (s) => (s.consumption === "greenlake" ? `GreenLake ${s.committedPct} % · ${s.termYears} yr · refresh ${s.refreshYears} yr` : `Purchase · refresh ${s.refreshYears} yr`)),
    row("Site", (s) => `${label("location", s.location)} · ${COOLING[s.cooling]} ${s.rackKW} kW · ${RED[s.redundancy]}`),
    row("Support", (s) => label("support", s.support)),
    row("Links", (s) => (s.location === "hinwil" ? `no campus fibre · ${label("trackside", s.trackside)}` : `${s.fibrePairs} × ${s.fibreGbps}G · ${label("trackside", s.trackside)} · edge ${s.edge ? "on" : "off"}`)),
    ["Cutover", t[2027].goLive ? fmtDate(t[2027].goLive) : "—", t[2028].goLive ? fmtDate(t[2028].goLive) : "same estate"],
  ]
}

function decisionTable(plan, result, key) {
  return el("table", { class: "table decision-table", id: `strategy-decisions-${key}` },
    el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "2027"), el("th", {}, "2028"))),
    el("tbody", {}, ...decisionRows(plan, result).map(([name, v27, v28]) => el("tr", {}, el("td", { class: "decision-name" }, name),
      ...(v27 === v28 ? [el("td", { colspan: "2", class: "decision-both" }, v27)] : [el("td", { class: "y27" }, v27), el("td", { class: "y28" }, v28)])))))
}

function bothValues(f, result) {
  return el("span", { class: "both" }, ...SEASONS.map((y) => el("span", { class: `y${String(y).slice(2)}` }, f(result.seasons[y], y))))
}

function outcomeTiles(result, today, key) {
  const capDelta = (s, y) => fmt.chfDelta(s.money.capCharge - today.seasons[y].money.capCharge)
  return el("div", { class: "strategy-tiles", id: `strategy-tiles-${key}` },
    stat("Seconds per lap vs Today", bothValues((s) => fmt.sec(s.perf.sec), result), null, { class: "headline-stat" }),
    stat("Effective MAUh", bothValues((s) => `${fmt.num(s.effectiveMauh, 2)} · ${Math.round(s.usage * 100)} %`, result), "of the allowance"),
    stat("Inside the cost cap", bothValues((s, y) => `${fmt.chf(s.money.capCharge)} (${capDelta(s, y)})`, result), "vs Today"),
    stat("Run-rate", bothValues((s) => fmt.chf(s.money.yearly), result), `3-yr TCO ${fmt.chf(result.totals.tco3)}`),
    stat("Availability", bothValues((s) => fmt.availability(s.availabilityPct / 100), result)),
    stat("Data-to-decision", bothValues((s) => `${fmt.num(s.trackside.decisionSec, 1)} s`, result), "at the race track"),
    stat("PUE · CO₂", bothValues((s) => `${s.sim.fac.pue.toFixed(2)} · ${fmt.num(s.money.co2MarketT, 0)} t`, result), "market-based"),
    stat("Race weekends at risk", bothValues((s) => fmt.num(s.trackside.weekendsAtRisk, 2), result), "link availability"))
}

/** Horizontal strip Dec 2026 → Jan 2028: ATP boundaries as ticks ("ATP 1" … "ATP 6", then 2028's "ATP 1" beside the 1 Jan 2028 marker), plan milestones as markers (labels on four rows). */
function timelineStrip(st, result, key) {
  const from = Date.UTC(2026, 11, 1)
  const to = Date.UTC(2028, 1, 1)
  const W = 320
  const H = 104
  const axisY = 52
  const x = (ms) => 10 + ((Math.min(Math.max(ms, from), to) - from) / (to - from)) * (W - 20)
  const ms = result.timeline.milestones
  const at = (id) => ms.find((m) => m.id === id)?.date
  const d = (m) => fmtDate(m, { short: true, year: false })
  const markers = [
    { label: `contract ${d(at("contract"))}`, date: at("contract"), kind: "team" },
    { label: "Bahrain test 24 Feb", date: Date.UTC(2027, 1, 24), kind: "fia" },
    { label: "target 8 Mar", date: parseDate("2027-03-08"), kind: "target" },
    { label: `cutover ${d(at("cutover"))}`, date: at("cutover"), kind: "team", strong: true },
    { label: `declaration ${d(at("declaration"))}`, date: at("declaration"), kind: "fia" },
    { label: `order step-up ${d(at("stepup-order"))}`, date: at("stepup-order"), kind: "team" },
    { label: st.key === "A" ? "1 Jan 2028" : "GPU re-declaration 1 Jan 2028", date: at("stepup") || Date.UTC(2028, 0, 1), kind: "fia", strong: true },
  ].filter((m) => Number.isFinite(m.date))
  // greedy label packing: the first of four rows whose last label ends before this one starts (≈ 4.6 px per character)
  const rows = [12, 26, 80, 94]
  const rowEnd = rows.map(() => -Infinity)
  const placed = markers.map((m) => {
    const px = x(m.date)
    const w = m.label.length * 4.6
    const anchor = px < 60 ? "start" : px > W - 60 ? "end" : "middle"
    const left = anchor === "start" ? px : anchor === "end" ? px - w : px - w / 2
    let row = rowEnd.findIndex((end) => end < left - 4)
    if (row < 0) row = rowEnd.indexOf(Math.min(...rowEnd))
    rowEnd[row] = left + w
    return { ...m, px, anchor, ty: rows[row] }
  })
  const ticks = [...atpCalendar(2027), ...atpCalendar(2028).slice(0, 1)]
  const node = svg("svg", { class: "timeline-strip", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Timeline of strategy ${key}: ${markers.map((m) => m.label).join(", ")}` },
    svg("line", { x1: 10, x2: W - 10, y1: axisY, y2: axisY, class: "strip-axis" }),
    ...ticks.map((p) => svg("g", {}, svg("line", { x1: x(p.start), x2: x(p.start), y1: axisY - 5, y2: axisY + 5, class: "strip-tick" }), svg("text", { x: x(p.start) + 2, y: axisY + 15, class: "strip-tick-text" }, `ATP ${p.index}`))),
    ...placed.map((m) => svg("g", { class: `strip-marker kind-${m.kind} ${m.strong ? "strong" : ""}` },
      svg("line", { x1: m.px, x2: m.px, y1: axisY, y2: m.ty < axisY ? m.ty + 3 : m.ty - 9, class: "strip-lead" }),
      svg("circle", { cx: m.px, cy: axisY, r: m.strong ? 4.5 : 3 }),
      svg("text", { x: m.px, y: m.ty, "text-anchor": m.anchor, class: "strip-text" }, m.label))))
  return el("div", { class: "strategy-timeline", id: `strategy-timeline-${key}` }, node,
    el("ol", { class: "strategy-steps" }, ...st.timeline.map((t) => el("li", {}, el("b", {}, t.when), " — ", t.what))))
}

/** "How this strategy finds its advantage": the strategy's framing line, then the top drivers of each season from the attribution, each with its `?`. */
function advantage(key, hit, attribution, plainEnglish) {
  const st = EXPLAIN[`strategy.${key}`]
  const items = []
  for (const y of SEASONS) {
    const a = attribution[y]
    const sr = hit.result.seasons[y]
    const ctx = explainContext({ result: { scenario: sr.sim, today: sr.today, perf: sr.perf }, attribution: a, both: { 2027: { perf: hit.result.seasons[2027].perf }, 2028: { perf: hit.result.seasons[2028].perf } }, plan: hit.result, fmt, plainEnglish })
    const top = a.drivers.filter((d) => !d.pruned && Math.abs(d.sec) >= 0.005).sort((p, q) => Math.abs(q.sec) - Math.abs(p.sec)).slice(0, 2)
    for (const d of top) {
      const e = EXPLAIN[`driver.${d.id}`]
      if (!e) continue
      items.push(el("li", { dataset: { season: String(y), driver: d.id } },
        el("span", { class: "season-tag" }, String(y)), " ", el("b", {}, `${fmt.sec(d.sec)} ${e.title}`), explainButton(`driver.${d.id}`, e.title), " — ", explainText(`driver.${d.id}`, ctx) || e.one))
    }
  }
  return el("div", { class: "strategy-advantage", id: `strategy-advantage-${key}` },
    el("h4", {}, "How this strategy finds its advantage", explainButton("tile.waterfall", "Where the seconds come from")),
    st ? el("p", { class: "strategy-framing" }, st.one) : null,
    el("ul", { class: "advantage-list" }, ...items),
    el("div", { class: "strategy-waterfalls" }, ...SEASONS.map((y) => el("div", { class: "strategy-waterfall" }, el("span", { class: "muted small" }, `${y} · ${fmt.sec(hit.result.seasons[y].perf.sec)}`), waterfall({ attribution: attribution[y], season: y, plainEnglish, cpuArch: hit.result.inputs[y].cpuArch, compact: true, id: `strategy-waterfall-${key}-${y}`, status: hit.result.seasons[y].status })))))
}

const riskLevel = (text) => (/unpublished|headroom|shed|must fund|highest|retrofit|single|no gpu|cpu-only|flat/i.test(text) ? "warn" : "info")
function riskBadges(st, key) {
  return el("div", { class: "strategy-risks", id: `strategy-risks-${key}` }, ...st.risks.map((r) => {
    const short = r.length > 64 ? `${r.slice(0, 62).replace(/[,;:(]?\s*\S*$/, "")}…` : r
    const b = badge(riskLevel(r), short)
    b.title = r
    return b
  }))
}

// ---------------------------------------------------------------------------------------------
// Comparison table and chart
// ---------------------------------------------------------------------------------------------

const ROWS = [
  { label: "Seconds per lap vs Today", f: (s) => fmt.sec(s.perf.sec), v: (s) => s.perf.sec, best: "max", cls: "headline" },
  { label: "Effective MAUh", f: (s) => fmt.num(s.effectiveMauh, 2), v: (s) => s.effectiveMauh, best: "max" },
  { label: "Allowance used", f: (s) => fmt.pct(s.usage) },
  { label: "Inside the cost cap", f: (s) => fmt.chf(s.money.capCharge), v: (s) => s.money.capCharge, best: "min" },
  { label: "Run-rate", f: (s) => fmt.chf(s.money.yearly), v: (s) => s.money.yearly, best: "min" },
  { label: "3-year TCO (2028 estate)", f: (s, r) => fmt.chf(r.totals.tco3), v: (s, r) => r.totals.tco3, best: "min" },
  { label: "Availability", f: (s) => fmt.availability(s.availabilityPct / 100), v: (s) => s.availabilityPct, best: "max" },
  { label: "Data-to-decision", f: (s) => `${fmt.num(s.trackside.decisionSec, 1)} s`, v: (s) => s.trackside.decisionSec, best: "min" },
  { label: "Race weekends at risk", f: (s) => fmt.num(s.trackside.weekendsAtRisk, 2), v: (s) => s.trackside.weekendsAtRisk, best: "min" },
  { label: "PUE", f: (s) => s.sim.fac.pue.toFixed(2), v: (s) => s.sim.fac.pue, best: "min" },
  { label: "kW at Digital Realty of 500", f: (s) => (s.envelope.drIT > 0 ? `${Math.round(s.envelope.drIT)} kW${s.envelope.fits ? "" : " · not possible"}` : "Hinwil") },
  { label: "Racks of 60", f: (s) => (s.envelope.drIT > 0 ? `${s.envelope.racks.total}` : "—") },
  { label: "CO₂ market-based", f: (s) => `${fmt.num(s.money.co2MarketT, 0)} t`, v: (s) => s.money.co2MarketT, best: "min" },
  { label: "Go-live", f: (s, r, y) => (r.timeline.seasons[y].goLive ? fmtDate(r.timeline.seasons[y].goLive, { short: true }) : "—") },
]

function compareTable(columns) {
  // columns: [{ key, label, result }] in strategy order; Today first
  const head = (y) => columns.map((c) => el("th", { class: `col-${c.key} s${y}` }, `${c.label} ${y}`))
  const bestKeys = (row, y) => {
    if (!row.v) return new Set()
    const cands = columns.filter((c) => c.key !== "today")
    const vals = cands.map((c) => row.v(c.result.seasons[y], c.result, y))
    const target = row.best === "max" ? Math.max(...vals) : Math.min(...vals)
    return new Set(cands.filter((c, i) => Math.abs(vals[i] - target) < 1e-9).map((c) => c.key))
  }
  return el("table", { class: "table compare-table strategies-table", id: "strategies-compare-table" },
    el("thead", {}, el("tr", {}, el("th", {}, "Metric"), ...head(2027), ...head(2028))),
    el("tbody", {}, ...ROWS.map((row) => el("tr", { class: row.cls || "" }, el("td", {}, row.label),
      ...SEASONS.flatMap((y) => { const best = bestKeys(row, y); return columns.map((c) => el("td", { class: `col-${c.key} ${best.has(c.key) && best.size < columns.length - 1 ? "best" : ""}` }, row.f(c.result.seasons[y], c.result, y))) })))))
}

function chart(columns, proposal) {
  const W = 560
  const H = 170
  const left = 44
  const groups = columns.filter((c) => c.key !== "today")
  const maxSec = Math.max(0.6, ...groups.flatMap((c) => SEASONS.map((y) => c.result.seasons[y].perf.sec)), proposal ? proposal.seasons[2028].perf.sec : 0) * 1.1
  const y0 = 120
  const ys = (v) => y0 - (v / maxSec) * 92
  const gw = (W - left - 20) / groups.length
  const capMax = Math.max(...groups.flatMap((c) => SEASONS.map((y) => c.result.seasons[y].money.capCharge)))
  return svg("svg", { class: "strategies-chart", id: "strategies-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Seconds per lap vs Today per strategy and season, with the cost-cap charge as dots" },
    ...[0, 0.2, 0.4, 0.6].filter((v) => v <= maxSec).map((v) => svg("g", {}, svg("line", { x1: left, x2: W - 16, y1: ys(v), y2: ys(v), class: "chart-grid" }), svg("text", { x: left - 6, y: ys(v) + 4, "text-anchor": "end", class: "chart-axis" }, `+${v.toFixed(1)} s`))),
    ...groups.flatMap((c, i) => {
      const gx = left + i * gw + gw / 2
      return [
        ...SEASONS.map((y, j) => {
          const v = c.result.seasons[y].perf.sec
          const bx = gx - 30 + j * 32
          return svg("g", { class: `chart-bar s${y}` },
            svg("rect", { x: bx, y: ys(v), width: 28, height: Math.max(1, y0 - ys(v)), rx: 3 }),
            svg("text", { x: bx + 14, y: ys(v) - 4, "text-anchor": "middle", class: "chart-value" }, fmt.sec(v)),
            svg("text", { x: bx + 14, y: y0 + 13, "text-anchor": "middle", class: "chart-axis" }, String(y)))
        }),
        svg("text", { x: gx, y: y0 + 28, "text-anchor": "middle", class: "chart-group" }, `${c.key} · ${nameOf(STRATEGIES[c.key])}`),
        ...SEASONS.map((y, j) => svg("g", { class: "chart-dot-group" },
          svg("circle", { cx: gx - 30 + j * 60, cy: y0 + 40, r: 2.5 + 4 * (c.result.seasons[y].money.capCharge / capMax), class: "chart-dot" }),
          svg("text", { x: gx - 22 + j * 60, y: y0 + 43, class: "chart-axis" }, fmt.chf(c.result.seasons[y].money.capCharge).replace("CHF ", "")))),
      ]
    }),
    svg("text", { x: left, y: y0 + 44, "text-anchor": "end", class: "chart-axis" }, "cap CHF"),
    proposal ? svg("g", { class: "chart-proposal" },
      svg("line", { x1: left, x2: W - 16, y1: ys(proposal.seasons[2028].perf.sec), y2: ys(proposal.seasons[2028].perf.sec), class: "chart-dashed" }),
      svg("text", { x: W - 18, y: ys(proposal.seasons[2028].perf.sec) - 4, "text-anchor": "end", class: "chart-value" }, `optimiser best 2028 ${fmt.sec(proposal.seasons[2028].perf.sec)}`)) : null)
}

// ---------------------------------------------------------------------------------------------
// The optimiser panel
// ---------------------------------------------------------------------------------------------

const LOCK_IDS = [...LOCKED_BY_DEFAULT.shared.map((id) => ({ scope: "shared", id })), ...LOCKED_BY_DEFAULT.season.map((id) => ({ scope: "season", id }))]
const lockWhy = (scope, id) => SEARCH_SPACE[scope][id]?.why || "policy"

/** Changed controls between two plan.js plans, per season: [{ id, scope: "both" | 2027 | 2028, from, to, note }]. */
function planDiff(startPlan, proposal) {
  const a = Object.fromEntries(SEASONS.map((y) => [y, seasonInputs(startPlan, y)]))
  const b = Object.fromEntries(SEASONS.map((y) => [y, seasonInputs(proposal, y)]))
  const rows = []
  for (const id of [...SHARED_IDS, ...SEASON_IDS]) {
    if (!CONTROLS[id]) continue
    const ch = SEASONS.filter((y) => a[y][id] !== b[y][id])
    if (!ch.length) continue
    const note = (y) => {
      if (id === "clockGHz") return `CCF floor ${ccfFloor(b[y]).toFixed(2)} GHz for ${b[y].coresPerNode} cores`
      if (id === "rackKW") return `${COOLING[b[y].cooling]} ceiling ${K.compute.coolingMaxKWPerRack[b[y].cooling]} kW/rack`
      if (id === "nodes") return "filled to the allowance"
      return ""
    }
    if (ch.length === 2 && a[2027][id] === a[2028][id] && b[2027][id] === b[2028][id]) rows.push({ id, scope: "both", from: a[2027][id], to: b[2027][id], note: note(2028) })
    else for (const y of ch) rows.push({ id, scope: y, from: a[y][id], to: b[y][id], note: note(y) })
  }
  return rows
}

function optimiserPanel(ctx, host) {
  const runner = createOptimiserRunner()
  const opt = { objective: "fastest2028", startFrom: "current", unlocked: new Set(), thorough: false, running: false, result: null, error: null }
  let lastShared = null

  const objectivePicker = el("div", { class: "segmented objective-picker", id: "optimiser-objective", role: "radiogroup", "aria-label": "Objective" },
    ...OBJECTIVE_ORDER.map((id) => el("button", { type: "button", class: "seg", role: "radio", dataset: { objective: id }, "aria-checked": String(id === opt.objective), "aria-pressed": String(id === opt.objective), title: `${OBJECTIVES[id].formula} · ${OBJECTIVES[id].sideCondition}`, onclick: () => { opt.objective = id; syncControls() } }, OBJECTIVES[id].label)))
  const startPicker = el("select", { class: "select", id: "optimiser-start", "aria-label": "Start from", onchange: (e) => { opt.startFrom = e.target.value } },
    el("option", { value: "current" }, "the current plan"),
    ...STRATEGY_ORDER.map((k) => el("option", { value: k }, `Strategy ${k} · ${nameOf(STRATEGIES[k])}`)))
  const unlockList = el("ul", { class: "unlock-list" }, ...LOCK_IDS.map(({ scope, id }) => {
    const box = el("input", { type: "checkbox", id: `unlock-${id}`, onchange: (e) => { if (e.target.checked) opt.unlocked.add(id); else opt.unlocked.delete(id) } })
    return el("li", {}, el("label", { for: `unlock-${id}` }, box, " ", el("b", {}, CONTROLS[id]?.label || id), el("span", { class: "muted small" }, ` · locked: ${lockWhy(scope, id)}`)))
  }))
  const thorough = el("input", { type: "checkbox", id: "optimiser-thorough", onchange: (e) => { opt.thorough = e.target.checked } })
  const runBtn = el("button", { type: "button", class: "btn btn-primary", id: "optimiser-run", onclick: () => (opt.running ? stop() : run()) }, "Find the best use of 500 kW")
  const progress = el("progress", { id: "optimiser-progress", max: "1", value: "0", hidden: true })
  const progressText = el("span", { class: "muted small", id: "optimiser-progress-text" }, "")
  const resultBox = el("div", { class: "optimiser-result", id: "optimiser-result", "aria-live": "polite" })

  const panel = el("section", { class: "card optimiser", id: "optimiser" },
    el("div", { class: "card-head" }, el("h3", {}, "Find the best use of 500 kW"), el("p", { class: "card-sub" }, "Coordinate descent with random restarts over the cluster, site and commercial controls; every candidate is scored through the model and rejected unless both seasons fit the envelope, keep the declared CCF at or above base clock and use no more than the allowance.")),
    el("div", { class: "optimiser-controls" },
      el("div", { class: "control-block" }, el("span", { class: "control-label" }, "Objective"), objectivePicker),
      el("div", { class: "control-block" }, el("label", { class: "control-label", for: "optimiser-start" }, "Start from"), startPicker),
      el("details", { class: "advanced", id: "optimiser-advanced" }, el("summary", {}, "Advanced: let the optimiser change policy controls"),
        unlockList,
        el("label", { class: "toggle-row", for: "optimiser-thorough" }, thorough, ` Thorough (${DEFAULTS.thoroughRestarts} restarts, up to ${fmt.num(DEFAULTS.thoroughMaxPlans)} plans instead of ${DEFAULTS.restarts} and ${fmt.num(DEFAULTS.maxPlans)})`)),
      el("div", { class: "run-row" }, runBtn, progress, progressText)),
    resultBox,
    el("p", { class: "footnote optimiser-footnote" }, "Every proposal fits the 500 kW envelope in both seasons, keeps the declared CCF at or above base clock and uses ≤ 100 % of the allowance. The model values only the Restricted-CFD programme and cost-cap reinvestment; operational controls are locked unless you unlock them. The search ranks candidates on their steady-state season figures; the tiles below are the proposal run through the plan with your go-live dates."))
  host.append(panel)

  function syncControls() {
    for (const b of objectivePicker.querySelectorAll(".seg")) { b.setAttribute("aria-checked", String(b.dataset.objective === opt.objective)); b.setAttribute("aria-pressed", String(b.dataset.objective === opt.objective)) }
    runBtn.textContent = opt.running ? "Stop" : "Find the best use of 500 kW"
    runBtn.classList.toggle("running", opt.running)
    startPicker.disabled = opt.running
    for (const i of unlockList.querySelectorAll("input")) i.disabled = opt.running
    thorough.disabled = opt.running
  }

  function startPlanFor(state) {
    if (opt.startFrom === "current") return state.plan
    return strategyResult(opt.startFrom, state.plan.shared).plan
  }

  async function run() {
    const state = ctx.getState()
    const startPlan = startPlanFor(state)
    const { sets, dropped } = startFromPlan(startPlan)
    const locked = { shared: LOCKED_BY_DEFAULT.shared.filter((id) => !opt.unlocked.has(id)), season: LOCKED_BY_DEFAULT.season.filter((id) => !opt.unlocked.has(id)) }
    opt.running = true
    opt.error = null
    opt.result = null
    syncControls()
    progress.hidden = false
    progress.value = 0
    progressText.textContent = "starting…"
    renderResult(state)
    const t0 = performance.now()
    try {
      const r = await runner.run({ start: sets, objective: opt.objective, locked, thorough: opt.thorough, seed: DEFAULTS.seed }, {
        onProgress: ({ done, total, bestScore }) => {
          progress.max = String(total)
          progress.value = String(done)
          progressText.textContent = `${fmt.num(done)} of ${fmt.num(total)} plans · best score ${Number.isFinite(bestScore) ? bestScore.toFixed(3) : "—"}`
        },
      })
      const wallMs = performance.now() - t0
      const proposal = normalizePlan(planFromSets(r.best, { name: "Optimiser proposal", origin: "optimiser", timeline: startPlan.timeline }))
      const result = evaluatePlan(proposal)
      const startResult = evaluatePlan(startPlan)
      opt.result = { raw: r, proposal, result, startPlan, startResult, startLabel: opt.startFrom === "current" ? state.plan.meta.name : `Strategy ${opt.startFrom}`, dropped, wallMs, mode: runner.mode, objective: opt.objective, diff: planDiff(startPlan, proposal) }
      progressText.textContent = `${fmt.num(r.evaluations)} plans in ${(wallMs / 1000).toFixed(1)} s (${runner.mode === "worker" ? "web worker" : "main thread"})${r.stopped ? " · stopped early" : ""}`
    } catch (err) {
      opt.error = err && err.message ? err.message : String(err)
      progressText.textContent = ""
    } finally {
      opt.running = false
      progress.hidden = true
      syncControls()
      renderResult(ctx.getState())
      host.dispatchEvent(new CustomEvent("optimiser-result", { bubbles: true }))
    }
  }
  function stop() { runner.stop() }

  function renderResult(state) {
    clear(resultBox)
    if (opt.error) { resultBox.append(el("p", { class: "flag level-bad" }, `The optimiser could not run: ${opt.error}`)); return }
    if (opt.running) { resultBox.append(el("p", { class: "muted" }, "Searching… the page stays responsive; press Stop to keep the best plan found so far.")); return }
    const R = opt.result
    if (!R) { resultBox.append(el("p", { class: "muted small", id: "optimiser-empty" }, "No proposal yet. Pick an objective and a start, then run the search; a default run takes about a second.")); return }
    const { proposal, result, startResult, raw } = R
    const tiles = el("div", { class: "optimiser-tiles" }, ...SEASONS.map((y) => {
      const s = result.seasons[y]
      const s0 = startResult.seasons[y]
      return el("div", { class: "optimiser-season", dataset: { season: String(y) } },
        el("h4", {}, String(y)),
        stat("Seconds per lap vs Today", fmt.sec(s.perf.sec), `start ${fmt.sec(s0.perf.sec)} · ${fmt.signed(s.perf.sec - s0.perf.sec, 2, " s")}`, { class: "headline-stat" }),
        stat("Inside the cost cap", fmt.chf(s.money.capCharge), `start ${fmt.chf(s0.money.capCharge)} · ${fmt.chfDelta(s.money.capCharge - s0.money.capCharge)}`),
        stat("kW at Digital Realty of 500", s.envelope.drIT > 0 ? `${Math.round(s.envelope.drIT)} kW` : "Hinwil", `${Math.round(s.usage * 100)} % of the allowance · ${fmt.availability(s.availabilityPct / 100)}`),
        envelopeGauge(result.envelope[y], y, { id: `optimiser-gauge-${y}`, size: 96 }))
    }))
    const changed = R.diff
    const unchanged = [...SHARED_IDS, ...SEASON_IDS].filter((id) => CONTROLS[id]).length - new Set(changed.map((d) => d.id)).size
    const diffTable = el("table", { class: "table diff-table", id: "optimiser-diff" },
      el("thead", {}, el("tr", {}, el("th", {}, "Control"), el("th", {}, "Season"), el("th", {}, "From"), el("th", {}, "To"), el("th", {}, "Note"))),
      el("tbody", {}, ...(changed.length ? changed.map((d) => el("tr", {}, el("td", {}, CONTROLS[d.id].label), el("td", {}, d.scope === "both" ? "both" : String(d.scope)), el("td", {}, controlDisplay(d.id, d.from)), el("td", { class: "diff-to" }, controlDisplay(d.id, d.to)), el("td", { class: "muted small" }, d.note)))
        : [el("tr", {}, el("td", { colspan: "5", class: "muted" }, "The start plan is already the best this search can find for the chosen objective."))]),
        el("tr", { class: "diff-unchanged" }, el("td", { colspan: "5", class: "muted small" }, `${unchanged} unchanged`))))
    const notes = [
      `Objective: ${OBJECTIVES[R.objective].label} (${OBJECTIVES[R.objective].formula}); score ${raw.score.toFixed(3)} from ${Number.isFinite(raw.startScore) ? raw.startScore.toFixed(3) : "a start outside the rules"} after ${fmt.num(raw.evaluations)} plan evaluations in ${(R.wallMs / 1000).toFixed(1)} s on the ${R.mode === "worker" ? "web worker" : "main thread"}${raw.stopped ? " (stopped early)" : ""}.`,
      R.dropped.length ? `The optimiser keeps ${R.dropped.map((id) => CONTROLS[id]?.label || id).join(", ")} the same in both seasons, so the start used 2027's values for these; rows marked 2028 above include that fold-back.` : null,
      !result.envelope.fits ? "The proposal does not fit the envelope at plan level; check the start plan's timeline." : null,
    ].filter(Boolean)
    resultBox.append(
      el("div", { class: "card-head row" }, el("h4", {}, `Proposal from ${R.startLabel}`), el("span", { class: "muted small" }, `health: ${result.health.status === "ok" ? "OK" : result.health.status === "warn" ? `check (${result.health.counts.warn})` : `fix (${result.health.counts.bad})`}`)),
      tiles,
      el("h4", { class: "diff-title" }, "What changes vs the start"),
      el("div", { class: "table-wrap" }, diffTable),
      el("div", { class: "actions-row" },
        el("button", { type: "button", class: "btn btn-primary", id: "optimiser-load", onclick: () => ctx.actions.loadPlan(proposal, "Optimiser proposal loaded", { route: "overview" }) }, "Load"),
        el("button", { type: "button", class: "btn", id: "optimiser-save", onclick: () => ctx.actions.savePlan(proposal, `Optimiser proposal · ${OBJECTIVES[R.objective].label}`) }, "Save as scenario"),
        el("button", { type: "button", class: "btn", id: "optimiser-copy", onclick: () => ctx.actions.copyLink(proposal) }, "Copy link")),
      ...notes.map((n) => el("p", { class: "muted small" }, n)))
  }

  function update(state) {
    // the "start from" default follows the last loaded strategy; the panel itself keeps its own state
    if (state.plan.meta.strategy && lastShared !== state.plan.meta.strategy) { opt.startFrom = state.plan.meta.strategy; startPicker.value = opt.startFrom; lastShared = state.plan.meta.strategy }
    if (!opt.running && opt.result === null) renderResult(state)
  }
  update(ctx.getState())
  syncControls()
  return { node: panel, update, get proposal() { return opt.result ? opt.result.result : null }, get busy() { return opt.running } }
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export function strategiesView(ctx) {
  const node = el("div", { class: "view view-strategies" },
    el("div", { class: "view-head" }, el("h2", {}, "Three ways to use 500 kW at Digital Realty Zurich"), el("p", { class: "card-sub" }, "Three complete plans for 2027 and 2028, each inside the 500 kW offer. The cards follow the current plan's constructors' position, confidence and race venue; everything else is fixed. Figures are plan-level: the 2027 season blends today's estate and the new one by the go-live date.")),
    el("div", { class: "strategy-grid", id: "strategy-grid" }),
    el("section", { class: "card", id: "strategies-compare" },
      el("div", { class: "card-head" }, el("h3", {}, "Side by side"), el("p", { class: "card-sub" }, "Today's setup and the three strategies, both seasons; the best value in each row per season is marked.")),
      el("div", { class: "table-wrap", id: "strategies-table-wrap" }),
      el("div", { class: "chart-wrap", id: "strategies-chart-wrap" }),
      el("p", { class: "footnote" }, "Plan-level figures: 2027 is blended by the go-live date (the strategies' 8 March 2027 target slips to the first day the lead times allow, which can be inside a period), 2028 is the full season on the stepped-up estate. Steady-state season figures are in the model notes."),
      el("p", { class: "footnote oem-footnote" }, PROVIDER.oemNote)),
    el("div", { id: "optimiser-host" }))
  const grid = node.querySelector("#strategy-grid")
  const tableWrap = node.querySelector("#strategies-table-wrap")
  const chartWrap = node.querySelector("#strategies-chart-wrap")
  const panel = optimiserPanel(ctx, node.querySelector("#optimiser-host"))
  node.addEventListener("optimiser-result", () => update(ctx.getState()))

  function card(key, state, loaded, edited) {
    const st = STRATEGIES[key]
    const { plan, result } = strategyResult(key, state.plan.shared)
    const today = todayResult(state.plan.shared).result
    const status = loaded ? badge("ok", "loaded in the planner") : edited ? badge("warn", "edited in the planner") : null
    const editLines = edited ? SEASONS.filter((y) => !state.result.envelope[y].fits).map((y) => { const l = envelopeLine(state.result.envelope[y], y); return el("p", { class: `envelope-line tone-${l.tone} small` }, `your edit: ${l.text}`) }) : []
    const advantageHost = el("div", { class: "strategy-advantage-host" }, el("p", { class: "muted small" }, "Working out where the seconds come from…"))
    const hit = strategyResult(key, state.plan.shared)
    const fillAdvantage = () => { if (advantageHost.isConnected) fill(advantageHost, advantage(key, hit, strategyAttribution(key, state.plan.shared), state.plainEnglish)) }
    if (hit.attribution) fillAdvantage(); else setTimeout(fillAdvantage, 30 + 90 * STRATEGY_ORDER.indexOf(key))
    return el("article", { class: `card strategy-card strategy-${key} ${loaded ? "is-loaded" : ""} ${edited ? "is-edited" : ""}`, id: `strategy-${key}`, "aria-labelledby": `strategy-title-${key}` },
      el("header", { class: "strategy-head" },
        el("span", { class: "strategy-letter", "aria-hidden": "true" }, letterOf(key)),
        el("div", { class: "strategy-title" }, el("h3", { id: `strategy-title-${key}` }, nameOf(st), explainButton(`strategy.${key}`, st.name)), el("p", { class: "strategy-tagline" }, st.tagline)),
        status),
      el("p", { class: "strategy-story" }, st.story),
      decisionTable(plan, result, key),
      el("div", { class: "strategy-gauges" }, ...SEASONS.map((y) => envelopeGauge(result.envelope[y], y, { id: `strategy-gauge-${key}-${y}`, size: 96 }))),
      ...editLines,
      outcomeTiles(result, today, key),
      advantageHost,
      timelineStrip(st, result, key),
      riskBadges(st, key),
      el("footer", { class: "strategy-footer" },
        el("div", { class: "actions-row" },
          edited
            ? [el("button", { type: "button", class: "btn btn-primary", id: `strategy-load-${key}`, onclick: () => ctx.actions.loadPlan(plan, `Strategy ${key} reloaded`, { route: "overview" }) }, "Reload the strategy"),
              el("button", { type: "button", class: "btn", id: `strategy-keep-${key}`, onclick: () => ctx.actions.clearLineage() }, "Keep my edit")]
            : el("button", { type: "button", class: "btn btn-primary", id: `strategy-load-${key}`, disabled: loaded ? "" : null, onclick: () => ctx.actions.loadPlan(plan, `Strategy ${key} loaded: ${nameOf(st)}`, { route: "overview" }) }, loaded ? "Loaded" : "Load this strategy"),
          el("button", { type: "button", class: "btn", id: `strategy-compare-${key}`, onclick: () => ctx.actions.compareStrategy(plan, `Strategy ${key}`) }, "Compare")),
        raceNowButtons(result, plan, { strategy: key, compact: true })))
  }

  let lastKey = null
  function update(state) {
    const match = matchingStrategy(state.plan)
    const lineage = state.plan.meta.strategy || null
    const key = JSON.stringify([state.plan.shared.position, state.plan.shared.confidence, state.plan.shared.venue, match, lineage, state.result.envelope.fits, state.plainEnglish, panel.proposal ? panel.proposal.seasons[2028].perf.sec : null])
    panel.update(state)
    if (key === lastKey) return
    lastKey = key
    fill(grid, ...STRATEGY_ORDER.map((k) => card(k, state, match === k, match !== k && lineage === k)))
    const columns = [{ key: "today", label: "Today", result: todayResult(state.plan.shared).result }, ...STRATEGY_ORDER.map((k) => ({ key: k, label: k, result: strategyResult(k, state.plan.shared).result }))]
    fill(tableWrap, compareTable(columns))
    fill(chartWrap, chart(columns, panel.proposal))
  }
  return { node, update }
}
