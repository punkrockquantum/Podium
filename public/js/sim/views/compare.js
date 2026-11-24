/** Compare plans: Today's setup, slots A and B and the current plan side by side, both seasons in every cell. */
import { CONTROLS } from "../model.js"
import { evaluatePlan, presetPlan } from "../plan.js"
import { el, clear, fmt } from "../dom.js"
import { fmtDate } from "../timeline.js"

export function compareView(ctx) {
  const node = el("div", { class: "view view-compare" },
    el("div", { class: "view-head" }, el("h2", {}, "Compare plans"), el("p", { class: "card-sub" }, "Set the current plan as A or B, change anything, and read the columns side by side; every cell shows 2027 over 2028. Slots persist in this browser.")),
    el("div", { class: "actions-row", id: "compare-actions" },
      el("button", { type: "button", class: "btn", id: "compare-a", onclick: () => ctx.actions.setSlot("A") }, "Set current as A"),
      el("button", { type: "button", class: "btn", id: "compare-b", onclick: () => ctx.actions.setSlot("B") }, "Set current as B")),
    el("div", { class: "table-wrap", id: "compare-wrap" }))
  const wrap = node.querySelector("#compare-wrap")

  function update(state) {
    const { slots, result } = state
    const today = evaluatePlan({ ...presetPlan("today"), shared: { ...presetPlan("today").shared, position: state.plan.shared.position, confidence: state.plan.shared.confidence } })
    const columns = [
      { key: "today", label: "Today's setup", result: today },
      ...["A", "B"].map((slot) => (slots[slot] ? { key: slot, label: `${slot}: ${slots[slot].label}`, result: evaluatePlan(slots[slot].plan), slot } : { key: slot, label: `${slot}: empty`, result: null, slot })),
      { key: "current", label: `Current: ${state.plan.meta.name}`, result },
    ]
    const both = (f) => (r) => el("span", { class: "both" }, el("span", { class: "y27" }, f(r.seasons[2027], r, 2027)), el("span", { class: "y28" }, f(r.seasons[2028], r, 2028)))
    const metrics = [
      ["Seconds per lap vs Today", both((s) => fmt.sec(s.perf.sec)), "headline"],
      ["Position", both((s, r) => `${fmt.position(r.plan.shared.position)} → ${fmt.position(s.perf.scenarioPosition)}`)],
      ["Effective MAUh (season)", both((s) => fmt.num(s.effectiveMauh, 2))],
      ["Allowance used", both((s) => fmt.pct(s.usage))],
      ["Availability", both((s) => fmt.availability(s.availabilityPct / 100))],
      ["Location", both((s) => CONTROLS.location.options.find((o) => o.value === s.inputs.location).label)],
      ["Cluster", both((s) => `${s.inputs.nodes} n · ${s.inputs.clockGHz.toFixed(1)} GHz${s.inputs.gpus ? ` · ${s.inputs.gpus} GPU` : ""}`)],
      ["Go-live", both((s, r, y) => (r.timeline.seasons[y].goLive ? fmtDate(r.timeline.seasons[y].goLive, { short: true }) : "—"))],
      ["PUE", both((s) => s.sim.fac.pue.toFixed(2))],
      ["Run-rate", both((s) => fmt.chf(s.money.yearly))],
      ["Inside the cost cap", both((s) => fmt.chf(s.money.capCharge))],
      ["Cash in the year", both((s) => fmt.chf(s.money.cash))],
      ["3-year TCO (2028 estate)", (r) => fmt.chf(r.totals.tco3)],
      ["CO₂ market-based", both((s) => `${fmt.num(s.money.co2MarketT, 0)} t`)],
      ["Plan health", (r) => (r.health.status === "ok" ? "OK" : r.health.status === "warn" ? `Check (${r.health.counts.warn})` : `Fix (${r.health.counts.bad})`)],
    ]
    clear(wrap).append(el("table", { class: "table compare-table", id: "compare-table" },
      el("thead", {}, el("tr", {}, el("th", {}, "Metric"), ...columns.map((c) => el("th", { class: `col-${c.key}` }, c.label,
        c.slot && slots[c.slot] ? el("span", { class: "col-actions" }, el("button", { type: "button", class: "btn btn-tiny", onclick: () => ctx.actions.loadSlot(c.slot) }, "Load"), el("button", { type: "button", class: "btn btn-tiny", onclick: () => ctx.actions.clearSlot(c.slot) }, "Clear")) : null)))),
      el("tbody", {}, ...metrics.map(([label, f, cls]) => el("tr", { class: cls || "" }, el("td", {}, label), ...columns.map((c) => el("td", { class: `col-${c.key}` }, c.result ? f(c.result) : "—")))))))
  }
  return { node, update }
}
