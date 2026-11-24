/** Building blocks shared by the plan views: per-season control sections, season columns, role strips, health lists. */
import { GROUPS, CONTROLS } from "../model.js"
import { SHARED_IDS, TIMELINE_IDS, isDetached, controlValue } from "../plan.js"
import { el, fmt } from "../dom.js"
import { planControl, badge } from "../widgets.js"
import { fmtDate } from "../timeline.js"

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
  for (const g of groups) for (const c of g.controls) {
    if (c.id === "season" || TIMELINE_IDS.includes(c.id) || exclude.includes(c.id)) continue
    const row = planControl(c, viewOf(c, state), handlers)
    rows[c.id] = row
    node.append(row)
  }
  return {
    node,
    sync(st) { for (const [id, row] of Object.entries(rows)) row.sync(viewOf(CONTROLS[id], st)) },
  }
}

function viewOf(control, state) {
  const { plan, result } = state
  const shared = SHARED_IDS.includes(control.id)
  const x27 = result.inputs[2027]
  const x28 = result.inputs[2028]
  const show27 = !control.showIf || control.showIf(x27)
  const show28 = !control.showIf || control.showIf(x28)
  return {
    shared,
    v27: controlValue(plan, 2027, control.id),
    v28: controlValue(plan, 2028, control.id),
    detached: !shared && isDetached(plan, control.id),
    hidden: !show27 && !show28,
    na27: !show27,
    na28: !show28,
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
    i.rule ? el("span", { class: "fia-badge" }, i.rule) : null)))
}

/** A row of stats for the ribbon: label + 2027 + 2028 values. */
export const ribbonRow = (label, v27, v28, { sub27 = "", sub28 = "", id } = {}) => el("div", { class: "ribbon-row", id },
  el("div", { class: "ribbon-label" }, label),
  el("div", { class: "ribbon-cell s2027" }, el("b", {}, v27), sub27 ? el("span", { class: "muted small" }, sub27) : null),
  el("div", { class: "ribbon-cell s2028" }, el("b", {}, v28), sub28 ? el("span", { class: "muted small" }, sub28) : null))

export const statusLabel = (s) => (s === "ok" ? "OK" : s === "warn" ? "Check" : s === "bad" ? "Fix" : "Note")

export { fmt }
