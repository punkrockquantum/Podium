/** Building blocks shared by the plan views: per-season control sections, season columns, role strips, health lists. */
import { GROUPS, CONTROLS } from "../model.js"
import { SHARED_IDS, TIMELINE_IDS, isDetached, controlValue, seasonCeilings, optionFit } from "../plan.js"
import { el, fmt } from "../dom.js"
import { planControl, badge, explainButton, tileIdFor } from "../widgets.js"
import { fmtDate } from "../timeline.js"

/** The controls whose sliders carry a live ceiling (model.ceilings) and the reason shown when they clamp. */
const CEILING_REASON = { nodes: "500 kW envelope", gpus: "500 kW envelope", solverGpus: "GPUs in the plan", mlPartitionKW: "what the envelope leaves", rackKW: "cooling ceiling", clockGHz: "CCF floor and the 500 kW envelope", committedKW: "the offer is 500 kW" }
const OPTION_FIT_IDS = ["cooling", "gpuModel", "mlPlacement", "location", "redundancy", "coresPerNode", "cpuArch"]

export const SEASONS = [2027, 2028]

/** The controls of one or more model groups as plan controls (2027 + 2028 with inherit/detach). Returns { node, sync(state) }. */
export function controlsSection(groupIds, ctx, { title, subtitle, exclude = [] } = {}) {
  const groups = GROUPS.filter((g) => groupIds.includes(g.id))
  const rows = {}
  const node = el("section", { class: "card control-card", id: `controls-${groupIds.join("-")}`, "aria-label": title || "Plan controls" },
    title ? el("div", { class: "card-head" }, el("h2", {}, title), subtitle ? el("p", { class: "card-sub" }, subtitle) : null) : null)
  const handlers = {
    onChange: (year, id, value) => ctx.actions.setControl(year, id, value),
    onDetach: (id) => ctx.actions.detach(id),
    onReattach: (id) => ctx.actions.reattach(id),
  }
  const state = ctx.getState()
  let ceil = ceilingsOf(state)
  for (const g of groups) for (const c of g.controls) {
    if (c.id === "season" || TIMELINE_IDS.includes(c.id) || exclude.includes(c.id)) continue
    const row = planControl(c, viewOf(c, state, ceil), handlers)
    rows[c.id] = row
    node.append(row)
  }
  return {
    node,
    sync(st) { ceil = ceilingsOf(st); for (const [id, row] of Object.entries(rows)) row.sync(viewOf(CONTROLS[id], st, ceil)) },
  }
}

const ceilingsOf = (state) => ({ 2027: seasonCeilings(state.plan, 2027), 2028: seasonCeilings(state.plan, 2028) })

/** The live ceiling of a control in a season, in the shape the slider widget takes, or null. */
function ceilingFor(control, ceil) {
  const c = ceil && ceil[control.id]
  if (!c) return null
  const out = { reason: CEILING_REASON[control.id] || "ceiling" }
  if (c.max !== undefined && c.max < control.max) out.max = c.max
  if (c.min !== undefined && c.min > control.min) out.min = c.min
  return out.max !== undefined || out.min !== undefined ? out : null
}

function viewOf(control, state, ceil = ceilingsOf(state)) {
  const { plan, result } = state
  const shared = SHARED_IDS.includes(control.id)
  const x27 = result.inputs[2027]
  const x28 = result.inputs[2028]
  const show27 = !control.showIf || control.showIf(x27)
  const show28 = !control.showIf || control.showIf(x28)
  const v27 = controlValue(plan, 2027, control.id)
  const v28 = controlValue(plan, 2028, control.id)
  const detached = !shared && isDetached(plan, control.id)
  let ceiling27 = control.type === "range" ? ceilingFor(control, ceil[2027]) : null
  const ceiling28 = control.type === "range" ? ceilingFor(control, ceil[2028]) : null
  // 2028 inherits an attached control, so the 2027 slider must stay inside both seasons' ceilings
  if (control.type === "range" && !shared && !detached && (ceiling27 || ceiling28)) {
    const both = { reason: (ceiling28 || ceiling27).reason }
    const maxes = [ceiling27?.max, ceiling28?.max].filter((v) => v !== undefined)
    const mins = [ceiling27?.min, ceiling28?.min].filter((v) => v !== undefined)
    if (maxes.length) both.max = Math.min(...maxes)
    if (mins.length) both.min = Math.max(...mins)
    if (ceiling28 && ((both.max !== undefined && both.max === ceiling28.max && (!ceiling27 || ceiling27.max !== both.max)) || (both.min !== undefined && both.min === ceiling28.min && (!ceiling27 || ceiling27.min !== both.min)))) both.reason = `${ceiling28.reason}, 2028`
    ceiling27 = both
  }
  const fitOptions = OPTION_FIT_IDS.includes(control.id) && control.options
  return {
    shared,
    v27, v28,
    detached,
    hidden: !show27 && !show28,
    na27: !show27,
    na28: !show28,
    ceiling27, ceiling28,
    atCeiling: Boolean((ceiling27 && ceiling27.max !== undefined && v27 >= ceiling27.max) || (ceiling28 && ceiling28.max !== undefined && v28 >= ceiling28.max)),
    disabled27: fitOptions ? optionFit(plan, 2027, control.id) : undefined,
    disabled28: fitOptions ? optionFit(plan, 2028, control.id) : undefined,
  }
}

/** Two columns, one per season, each a card with a season header and the blend note. `body(year, season)` returns nodes. */
export function seasonCols(result, body, { id } = {}) {
  return el("div", { class: "season-cols", id },
    ...SEASONS.map((year) => {
      const s = result.seasons[year]
      const t = result.timeline.seasons[year]
      const note = !t.changes ? (year === 2027 ? "Today's setup all season" : result.changes27 ? "Same estate as 2027" : "Today's setup all season")
        : t.goLive ? `${year === 2027 ? "Cutover" : "Step-up"} ${fmtDate(t.goLive)}${s.blend.shareOld > 0 ? ` · ${Math.round(s.blend.shareOld * 100)} % of the season on the ${year === 2027 ? "old" : "2027"} estate` : ""}` : ""
      return el("section", { class: `card season-card s${year} status-${s.status}`, dataset: { season: String(year) } },
        el("div", { class: "season-head" }, el("h3", {}, String(year)), el("span", { class: "muted small" }, note)),
        ...[body(year, s)].flat())
    }))
}

/** "The team decides · Digital Realty provides · HPE GreenLake provides" strip. */
export function roleStrip({ team, dr, hpe }) {
  return el("div", { class: "role-strip", role: "list" },
    el("div", { class: "role team", role: "listitem" }, el("h4", {}, "The team decides"), el("p", {}, team)),
    el("div", { class: "role dr", role: "listitem" }, el("h4", {}, "Digital Realty provides"), el("p", {}, dr)),
    el("div", { class: "role hpe", role: "listitem" }, el("h4", {}, "HPE GreenLake provides"), el("p", {}, hpe)))
}

export const statusDot = (status, title) => el("span", { class: `status-dot level-${status === "ok" ? "ok" : status}`, title: title || status, "aria-label": title || status })

/** The health items as one-line reasons that link to their route. */
export function healthList(health, navigate, { limit = 8, season = null } = {}) {
  const items = (season ? health.items.filter((i) => i.season === season || i.season === null) : health.items).slice(0, limit)
  if (!items.length) return el("p", { class: "muted small health-empty" }, "No open issues in this plan.")
  return el("ul", { class: "health-list" }, ...items.map((i) => el("li", { class: `health-item level-${i.level}`, dataset: { id: i.id, level: i.level } },
    badge(i.level, i.level === "bad" ? "Fix" : i.level === "warn" ? "Tune" : "Note"),
    el("span", { class: "health-season" }, i.season ? String(i.season) : "Plan"),
    el("button", { type: "button", class: "linkish health-title", onclick: () => navigate(i.route) }, i.title),
    i.rule ? el("span", { class: "fia-badge" }, i.rule) : null,
    explainButton(`flag.${String(i.id).replace(/^(\d{4}|tl)-/, "").replace(/-\d{4}$/, "")}`, i.title))))
}

/** A row of stats for the ribbon: label + 2027 + 2028 values. */
export const ribbonRow = (label, v27, v28, { sub27 = "", sub28 = "", id, explain } = {}) => el("div", { class: "ribbon-row", id },
  el("div", { class: "ribbon-label" }, label, explainButton(`tile.${explain || tileIdFor(label)}`, label)),
  el("div", { class: "ribbon-cell s2027" }, el("b", {}, v27), sub27 ? el("span", { class: "muted small" }, sub27) : null),
  el("div", { class: "ribbon-cell s2028" }, el("b", {}, v28), sub28 ? el("span", { class: "muted small" }, sub28) : null))

export const statusLabel = (s) => (s === "ok" ? "OK" : s === "warn" ? "Check" : s === "bad" ? "Fix" : "Note")

export { fmt }
