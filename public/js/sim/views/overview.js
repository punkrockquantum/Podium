/** The Overview: outcome ribbon for both seasons, the envelope gauges, the map, plan health, six decision cards and the compact timeline. */
import { CONTROLS } from "../model.js"
import { FIGURES as F } from "../../customer.js"
import { controlValue, controlDisplay, isDetached, envelopeLine } from "../plan.js"
import { el, clear, fmt } from "../dom.js"
import { inputWidget, envelopeGauge, hinwilGauge, badge, readout } from "../widgets.js"
import { swissMap, gantt } from "../visuals.js"
import { healthList, ribbonRow, statusDot, statusLabel } from "./common.js"
import { fmtDate, parseDate, cutoverOptions, isoDate } from "../timeline.js"
import { matchingStrategy } from "../strategies.js"

const COOLING = { air: "air", reardoor: "rear-door", dlc: "direct liquid" }
const RED = { n: "N", n1: "N+1", "2n": "2N" }
const label = (id, v) => controlDisplay(id, v)

const CARDS = [
  {
    id: "facility", route: "facility", title: "Where does the Restricted CFD estate run?",
    summary: (x, s) => `${label("location", x.location)} · ${x.location === "hinwil" ? `${s.sim.fac.hinwilCapacity} kW room` : `${Math.round(s.sim.fac.drIT)} of ${s.sim.fac.drCapacity} kW envelope${x.mlPartitionKW ? ` · ${x.mlPartitionKW} kW ML at ${label("mlPlacement", x.mlPlacement).toLowerCase()}` : ""}`} · ${RED[x.redundancy]} · ${COOLING[x.cooling]} at ${x.rackKW} kW/rack`,
    quick: { id: "location" },
  },
  {
    id: "compute", route: "compute", title: "What do we run?",
    summary: (x, s) => `${x.nodes} nodes × ${x.coresPerNode} cores at ${x.clockGHz.toFixed(1)} GHz${x.gpus ? ` · ${x.gpus} GPUs (${s.sim.comp.gpuSolverN} in the solver)` : " · no GPUs"} · ${x.consumption === "greenlake" ? "HPE GreenLake" : "purchased"} · ${label("interconnect", x.interconnect)}`,
    quick: { id: "nodes" },
  },
  {
    id: "connectivity", route: "connectivity", title: "How do we connect it?",
    summary: (x) => `${x.location === "hinwil" ? "no campus fibre" : `${x.fibrePairs === 2 ? "2 diverse fibre routes" : "1 fibre route"} · ${x.fibreGbps}G`} · ${label("trackside", x.trackside).toLowerCase()} · edge ${x.edge ? "on" : "off"} · on-ramps ${x.cloudOnRamp ? "on" : "off"}`,
    quick: { id: "fibrePairs" },
  },
  {
    id: "deployment", route: "deployment", title: "When do we move, and when do we step up?",
    summary: null, // built from the timeline
    quick: { id: "cutover" },
  },
  {
    id: "fia", route: "fia", title: "What does the FIA allow?",
    summary: (x, s) => `P${x.position} · ${fmt.num(s.sim.fia.allowance.mauh, 2)} MAUh per period (${s.sim.fia.pct} %) · ${Math.round(s.sim.comp.usage * 100)} % used · GPU solver ${s.sim.fia.gpuSolverAllowed ? "allowed" : "not before 2028"}`,
    quick: { id: "position" },
  },
  {
    id: "commercials", route: "commercials", title: "What does it cost, and where does it sit in the cap?",
    summary: (x, s) => `${fmt.chf(s.money.yearly)} a year · ${fmt.chf(s.money.capCharge)} inside the cap (${fmt.chfDelta(s.money.capChargeDelta)} vs today) · one-offs ${fmt.chf(s.money.oneOffTotal)}`,
    quick: { id: "propertySharePct" },
  },
]

export function overviewView(ctx) {
  const ribbon = el("section", { class: "card ribbon", id: "ribbon", "aria-live": "polite" })
  const mapCard = el("section", { class: "card map-card", id: "map-card" })
  const health = el("section", { class: "card health", id: "health" })
  const cards = {}
  const grid = el("div", { class: "decision-grid", id: "decisions" })
  for (const c of CARDS) {
    const summary27 = el("p", { class: "decision-summary s2027" })
    const summary28 = el("p", { class: "decision-summary s2028" })
    const dot = statusDot("ok", "OK")
    const quickHost = el("div", { class: "quick" })
    let quick = null
    if (c.quick.id === "cutover") {
      quick = el("select", { class: "select", "aria-label": "Cutover target" }, ...cutoverOptions().map((o) => el("option", { value: o.value }, o.label)))
      quick.addEventListener("change", () => ctx.actions.setTimeline({ cutoverDate: quick.value }))
      quick.sync = (v) => { quick.value = v }
      quickHost.append(el("span", { class: "quick-label" }, "Cutover target"), quick)
    } else {
      const control = CONTROLS[c.quick.id]
      quick = inputWidget(control, controlValue(ctx.getState().plan, 2027, control.id), (v) => ctx.actions.setControl(control.id === "position" || control.id === "propertySharePct" ? null : 2027, control.id, v), { id: `quick-${control.id}` })
      quickHost.append(el("span", { class: "quick-label" }, `${control.label}${["position", "propertySharePct"].includes(control.id) ? "" : " · 2027"}`), quick)
    }
    const node = el("section", { class: "card decision", id: `decision-${c.id}`, dataset: { route: c.route } },
      el("div", { class: "decision-head" }, dot, el("h3", {}, c.title)),
      el("div", { class: "decision-seasons" }, el("div", { class: "decision-season" }, el("span", { class: "season-tag" }, "2027"), summary27), el("div", { class: "decision-season" }, el("span", { class: "season-tag" }, "2028"), summary28)),
      quickHost,
      el("button", { type: "button", class: "btn btn-small tune", onclick: () => ctx.navigate(c.route) }, "Tune the details →"))
    cards[c.id] = { node, summary27, summary28, dot, quick, cfg: c }
    grid.append(node)
  }
  const timelineCard = el("section", { class: "card timeline-card", id: "timeline-compact" })
  const envelopeCard = el("section", { class: "card envelope-card", id: "envelope" })
  const node = el("div", { class: "view view-overview" },
    el("div", { class: "overview-hero" }, ribbon, el("div", { class: "hero-side" }, envelopeCard, mapCard)),
    health,
    el("div", { class: "view-head compact" }, el("h2", {}, "Six decisions"), el("p", { class: "card-sub" }, "Each card shows the 2027 choice and what 2028 inherits or changes. Tune the details in the component views.")),
    grid,
    timelineCard)

  function update(state) {
    const { plan, result } = state
    renderRibbon(ribbon, result, plan, ctx)
    renderEnvelope(envelopeCard, result, ctx)
    clear(mapCard).append(el("h3", {}, "Switzerland · where the estate runs"), swissMap(result), el("p", { class: "scene-caption" }, `Hinwil ↔ Digital Realty Zurich ≈ ${F.sites.campus.fibreKm} km of fibre; Neuburg carries the power unit, the UK Technology Centre composites and aero support.`))
    clear(health).append(
      el("div", { class: "health-head" }, el("h3", {}, "Plan health"), badge(result.health.status, statusLabel(result.health.status)), el("span", { class: "muted" }, result.health.headline)),
      envelopeHealth(result, ctx),
      healthList(result.health, ctx.navigate))
    for (const c of CARDS) {
      const card = cards[c.id]
      const s27 = result.seasons[2027]
      const s28 = result.seasons[2028]
      const items = result.health.items.filter((i) => i.route === c.route)
      const worst = items.some((i) => i.level === "bad") ? "bad" : items.some((i) => i.level === "warn") ? "warn" : "ok"
      card.dot.className = `status-dot level-${worst}`
      card.dot.title = statusLabel(worst)
      card.node.dataset.status = worst
      if (c.id === "deployment") {
        const t27 = result.timeline.seasons[2027]
        const t28 = result.timeline.seasons[2028]
        card.summary27.textContent = t27.changes ? `Contract ${fmtDate(parseDate(plan.timeline.contractDate))} → cutover ${fmtDate(t27.goLive)}${t27.atp ? ` (${t27.atBoundary ? "start of " : "inside "}${t27.atp.label})` : ""} · ${plan.timeline.parallelWeeks} wk parallel` : "No move: today's estate all season"
        card.summary28.textContent = t28.changes ? `Step-up live ${fmtDate(t28.goLive)}${t28.earlyDays > 0 ? ` · ${Math.round(t28.earlyDays / 7)} wk before GPUs are allowed` : ""}${t28.slipDays > 0 ? ` · slips ${t28.slipDays} days` : ""}` : "Same estate as 2027 · no step-up"
        card.quick.sync(plan.timeline.cutoverDate)
      } else {
        card.summary27.textContent = c.summary(result.inputs[2027], s27)
        const changed = result.deltas.changed.some((id) => groupOf(id) === c.id)
        card.summary28.textContent = changed ? c.summary(result.inputs[2028], s28) : c.id === "fia" || c.id === "commercials" ? c.summary(result.inputs[2028], s28) : "Same as 2027"
        card.quick.sync(controlValue(plan, 2027, c.quick.id))
      }
    }
    clear(timelineCard).append(
      el("div", { class: "card-head row" }, el("h3", {}, "Deployment timeline"), el("button", { type: "button", class: "btn btn-small", onclick: () => ctx.navigate("deployment") }, "Open the Gantt →")),
      gantt(result.timeline, { compact: true }),
      el("p", { class: "scene-caption" }, result.timeline.flags.filter((f) => f.level !== "info").slice(0, 2).map((f) => f.title).join(" · ") || "Six Aerodynamic Testing Periods a year; the move lands at a period boundary."))
  }
  return { node, update }
}

const GROUP_OF = { facility: ["location", "hinwilRetrofit", "committedKW", "mlPartitionKW", "mlPlacement", "rackKW", "cooling", "redundancy", "pueMode", "pueValue", "tariffRp", "renewable", "heatReuse"], compute: ["nodes", "coresPerNode", "clockGHz", "cpuArch", "memoryGB", "interconnect", "storage", "gpus", "solverGpus", "gpuModel", "gpuChargePct", "consumption", "committedPct", "termYears", "support", "refreshYears"], connectivity: ["fibrePairs", "fibreGbps", "trackside", "edge", "cloudOnRamp"] }
const groupOf = (id) => Object.keys(GROUP_OF).find((g) => GROUP_OF[g].includes(id)) || null

const LOCATION_WORD = { hinwil: "Hinwil", dr: "Digital Realty Zurich", hybrid: "Hybrid (Hinwil + Digital Realty Zurich)" }

/** The car spec the arcade's "Race now" hook takes, from a season of the plan result. */
const PRESET_TAG = { today: "Today's setup", dr2027: "From 2027", gl2028: "GreenLake step-up" }

export function raceCar(result, year, plan, { strategy } = {}) {
  const s = result.seasons[year]
  const x = result.inputs[year]
  const where = x.location === "hinwil" ? "Hinwil" : "Digital Realty Zurich"
  const head = `${where} ${year} · `
  const lineage = plan.meta.strategy
  const tag = strategy ? `Strategy ${strategy}` : PRESET_TAG[plan.meta.preset] || (lineage ? `Strategy ${lineage}${matchingStrategy(plan) === lineage ? "" : " (edited)"}` : plan.meta.origin === "optimiser" ? "Optimiser proposal" : plan.meta.name)
  const room = 48 - head.length
  const label = head + (tag.length > room ? `${tag.slice(0, Math.max(1, room - 1)).trimEnd()}…` : tag)
  return {
    season: year, label, short: strategy ? `${year} · ${strategy}` : String(year),
    secondsPerLapVsToday: s.perf.sec, effectiveMauh: s.effectiveMauh, allowanceUsedPct: s.usage * 100,
    availabilityPct: s.availabilityPct, dataToDecisionS: s.sim.net.venue.decisionSec, location: LOCATION_WORD[x.location],
  }
}

/** "Race now" for the 2027 and 2028 car: hands the plan's figures to the arcade (docs/audi-f1-arcade.md §1). */
export function raceNowButtons(result, plan, { strategy, compact = false } = {}) {
  const go = (year) => import("/js/arcade/launch.js").then((m) => m.launchRace(raceCar(result, year, plan, { strategy })))
  return el("div", { class: `race-now ${compact ? "compact" : ""}`, role: "group", "aria-label": "Race now" },
    ...[2027, 2028].map((year) => el("button", { type: "button", class: "btn btn-race", id: strategy ? `race-now-${strategy}-${year}` : `race-now-${year}`, dataset: { season: String(year) }, title: `Drive the ${year} car in the arcade with this plan's figures`, onclick: () => go(year) }, `Race now · ${year} car`)))
}

/** The envelope gauges: kW at Digital Realty of 500 per season (plus the Hinwil room in hybrid plans). */
function renderEnvelope(card, result, ctx) {
  const gauges = [2027, 2028].map((y) => {
    const env = result.envelope[y]
    const x = result.inputs[y]
    const items = [envelopeGauge(env, y, { id: `envelope-gauge-${y}` })]
    if (x.location === "hybrid") items.push(hinwilGauge(env, y, { id: `hinwil-gauge-${y}` }))
    if (x.location === "hinwil") items[0] = el("div", { class: "gauge gauge-empty", id: `envelope-gauge-${y}` }, el("div", { class: "gauge-display-text" }, "Hinwil room"), el("div", { class: "gauge-label" }, `kW at Digital Realty of ${env.offerKW} · ${y}`), el("div", { class: "muted small" }, `${Math.round(env.hinwilIT)} of ${env.hinwilCapacity} kW at Hinwil`))
    return el("div", { class: `envelope-season ${env.fits ? "" : "over"}`, dataset: { season: String(y) } }, ...items)
  })
  clear(card).append(
    el("div", { class: "card-head row" }, el("h3", {}, "The 500 kW envelope"), el("span", { class: "muted small" }, "critical IT at Digital Realty, both seasons")),
    el("div", { class: "envelope-gauges" }, ...gauges),
    el("p", { class: "scene-caption" }, result.envelope.fits ? "Within the offer in both seasons. More kW is a separate commercial conversation (ZUR4, 2028)." : "Over the offer: use \"Fit to the envelope\" in plan health or trim the ML partition, GPUs, nodes or rack density."))
}

/** The plan-health line per season: "Fits the 500 kW envelope: 399 / 500 kW (2027)", or "Not possible" with the Fit button. */
function envelopeHealth(result, ctx) {
  return el("ul", { class: "envelope-health", id: "envelope-health" }, ...[2027, 2028].map((y) => {
    const line = envelopeLine(result.envelope[y], y)
    return el("li", { class: `envelope-line tone-${line.tone}`, dataset: { season: String(y), tone: line.tone } },
      el("span", { class: `status-dot level-${line.tone}`, "aria-hidden": "true" }),
      el("span", { class: "envelope-text" }, line.text),
      line.tone === "bad" ? el("button", { type: "button", class: "btn btn-small fit-envelope", id: `fit-envelope-${y}`, onclick: () => ctx.actions.fitEnvelope(y) }, "Fit to the envelope") : null)
  }))
}

function renderRibbon(ribbon, result, plan, ctx) {
  const s27 = result.seasons[2027]
  const s28 = result.seasons[2028]
  const tone = (s) => (s.perf.sec > 0.005 ? "good" : s.perf.sec < -0.005 ? "bad" : "flat")
  const tr = (s) => `${fmt.num(s.trackside.decisionSec, 1)} s to decide`
  const trSub = (s) => `link ${fmt.availability(s.trackside.linkAvailability)} · ${fmt.num(s.trackside.weekendsAtRisk, 2)} weekends at risk`
  clear(ribbon).append(
    el("div", { class: "ribbon-head" },
      el("div", { class: "headline-kicker" }, `${plan.meta.name} · vs today's setup at ${plan.shared.confidence} % confidence`),
      el("div", { class: "ribbon-cols" }, el("span", {}), el("span", { class: "ribbon-year" }, "2027"), el("span", { class: "ribbon-year" }, "2028"))),
    el("div", { class: "ribbon-big" },
      el("div", { class: "ribbon-label" }, "Seconds per lap"),
      el("div", { class: `headline-number tone-${tone(s27)}`, id: "sec-2027" }, fmt.sec(s27.perf.sec)),
      el("div", { class: `headline-number tone-${tone(s28)}`, id: "sec-2028" }, fmt.sec(s28.perf.sec))),
    ribbonRow("kW at Digital Realty of 500", result.envelope[2027].drIT > 0 ? `${Math.round(result.envelope[2027].drIT)} kW` : "Hinwil", result.envelope[2028].drIT > 0 ? `${Math.round(result.envelope[2028].drIT)} kW` : "Hinwil", { sub27: result.envelope[2027].fits ? `${Math.round(result.envelope[2027].headroomKW)} kW to spare` : "Not possible", sub28: result.envelope[2028].fits ? `${Math.round(result.envelope[2028].headroomKW)} kW to spare` : "Not possible", id: "ribbon-envelope" }),
    ribbonRow("Trackside value", tr(s27), tr(s28), { sub27: trSub(s27), sub28: trSub(s28), id: "ribbon-trackside" }),
    ribbonRow("ATR allowance used", fmt.pct(s27.usage), fmt.pct(s28.usage), { sub27: `${fmt.num(s27.effectiveMauh, 2)} eff. MAUh`, sub28: `${fmt.num(s28.effectiveMauh, 2)} eff. MAUh`, id: "ribbon-atr" }),
    ribbonRow("Cost-cap charge", fmt.chf(s27.money.capCharge), fmt.chf(s28.money.capCharge), { sub27: `${fmt.chfDelta(s27.money.capChargeDelta)} vs today`, sub28: `${fmt.chfDelta(s28.money.capChargeDelta)} vs today`, id: "ribbon-cap" }),
    ribbonRow("Availability", fmt.availability(s27.availabilityPct / 100), fmt.availability(s28.availabilityPct / 100), { id: "ribbon-availability" }),
    ribbonRow("CHF per year", fmt.chf(s27.money.yearly), fmt.chf(s28.money.yearly), { sub27: `${fmt.chf(s27.money.cash)} cash in 2027`, sub28: `${fmt.chf(s28.money.cash)} cash in 2028`, id: "ribbon-yearly" }),
    ribbonRow("CO₂ (market-based)", `${fmt.num(s27.money.co2MarketT, 0)} t`, `${fmt.num(s28.money.co2MarketT, 0)} t`, { sub27: `${fmt.signed(s27.money.co2Delta, 0, " t")} vs today`, sub28: `${fmt.signed(s28.money.co2Delta, 0, " t")} vs today`, id: "ribbon-co2" }),
    raceNowButtons(result, plan),
    el("div", { class: "ribbon-foot muted small", id: "ribbon-foot" }, footLine(result)))
}

/** What 2028 does differently from 2027, in one line. */
function footLine(result) {
  const changed = result.deltas.changed
  if (!changed.length) return "2028 runs the same estate as 2027 (nothing detached)."
  const names = changed.map((id) => CONTROLS[id].label.toLowerCase()).slice(0, 4).join(", ") + (changed.length > 4 ? ` +${changed.length - 4} more` : "")
  return `${changed.length} control${changed.length === 1 ? "" : "s"} differ${changed.length === 1 ? "s" : ""} in 2028 (${names}) · ${fmt.sec(result.deltas.sec)} and ${fmt.chfDelta(result.deltas.capCharge)} in the cap vs 2027.`
}

export { readout, isDetached, isoDate }
