/** Deployment: the Nov 2026 – Dec 2028 timeline with tunable contract date, cutover target, parallel running and 2028 step-up date. */
import { K } from "../assumptions.js"
import { el, fmt, fill } from "../dom.js"
import { badge, flagRow, stat, explainButton } from "../widgets.js"
import { gantt, ganttLegend } from "../visuals.js"
import { roleStrip } from "./common.js"
import { cutoverOptions, fmtDate, parseDate, isoDate, TIMELINE_RANGE } from "../timeline.js"

const OWNER = { team: "Team", dr: "Digital Realty", hpe: "HPE GreenLake", carrier: "Carrier", fia: "FIA" }
const PATH = { fitout: "fit-out", fibre: "dark fibre", hardware: "HPE delivery", works: "Hinwil works", burnin: "burn-in", parallel: "parallel running" }

export function deploymentView(ctx) {
  const dateInput = (id, label, key, why) => {
    const input = el("input", { type: "date", id, class: "text date", min: TIMELINE_RANGE[key][0], max: TIMELINE_RANGE[key][1], "aria-label": label })
    input.addEventListener("change", () => { if (input.value) ctx.actions.setTimeline({ [key]: input.value }) })
    const out = el("output", { class: "control-readout", for: id })
    const row = el("div", { class: "control control-date", dataset: { control: key } },
      el("div", { class: "control-head" }, el("label", { for: id, class: "control-label" }, label), out),
      input,
      el("p", { class: "why" }, why))
    row.sync = (v) => { input.value = v; out.textContent = fmtDate(parseDate(v)) }
    return row
  }
  const contract = dateInput("tl-contract", "Contract signature", "contractDate", "Lead times count from here: fit-out, dark fibre and the HPE delivery start the day the contract is signed.")
  const cutoverSel = el("select", { id: "tl-cutover", class: "select", "aria-label": "Cutover target" }, ...cutoverOptions().map((o) => el("option", { value: o.value }, o.label)))
  cutoverSel.addEventListener("change", () => ctx.actions.setTimeline({ cutoverDate: cutoverSel.value }))
  const cutoverOut = el("output", { class: "control-readout" })
  const cutover = el("div", { class: "control", dataset: { control: "cutoverDate" } },
    el("div", { class: "control-head" }, el("label", { for: "tl-cutover", class: "control-label" }, "Cutover target"), el("span", { class: "fia-badge" }, "F4.4.3"), cutoverOut),
    cutoverSel,
    el("p", { class: "why" }, "Move at an ATP boundary or inside a shutdown and no allowance is lost. If the lead times do not allow the target, the cutover slips to the first feasible day."))
  cutover.sync = (v) => { cutoverSel.value = v; cutoverOut.textContent = fmtDate(parseDate(v)) }
  const parallelInput = el("input", { type: "range", id: "tl-parallel", class: "slider", min: 0, max: 8, step: 1, "aria-label": "Parallel running" })
  parallelInput.addEventListener("input", () => ctx.actions.setTimeline({ parallelWeeks: Number(parallelInput.value) }))
  const parallelOut = el("output", { class: "control-readout", for: "tl-parallel" })
  const parallel = el("div", { class: "control control-range", dataset: { control: "parallelWeeks" } },
    el("div", { class: "control-head" }, el("label", { for: "tl-parallel", class: "control-label" }, "Parallel running"), parallelOut),
    parallelInput, el("div", { class: "slider-ticks", "aria-hidden": "true" }, el("span", {}, "0 wk"), el("span", {}, "8 wk")),
    el("p", { class: "why" }, `Both clusters run side by side before the switch: the queue drains on the old one and restarts on the new one in a day instead of ${K.timeline.cutoverDowntimeDays}. Costs about ${fmt.chf(K.timeline.parallelRunningCHFPerWeek)} a week.`))
  parallel.sync = (v) => { parallelInput.value = String(v); parallelOut.textContent = `${v} wk` }
  const stepUp = dateInput("tl-stepup", "2028 step-up date", "stepUpDate", "GPU cores may run the Restricted CFD solver from 1 January 2028 (F4.4.1). Earlier delivery is burn-in for four weeks and idle cost after that; later delivery is 2028 allowance the step-up cannot help with.")

  const controls = el("section", { class: "card control-card", id: "controls-timeline" },
    el("div", { class: "card-head" }, el("h2", {}, "Schedule"), el("p", { class: "card-sub" }, "Four dates decide what the two seasons get out of the plan.")),
    contract, cutover, parallel, stepUp)
  const chart = el("section", { class: "card gantt-card", id: "gantt-card" })
  const consequences = el("section", { class: "card", id: "consequences" })
  const milestones = el("section", { class: "card", id: "milestones" })
  const signBy = el("section", { class: "card", id: "sign-by" })
  const node = el("div", { class: "view view-deployment" },
    el("div", { class: "view-head" }, el("h2", {}, "Deployment"), el("p", { class: "card-sub" }, "November 2026 to the end of 2028: six Aerodynamic Testing Periods a year, the pre-season tests, GPU legality on 1 January 2028 and every milestone of the move.")),
    roleStrip({
      team: "Contract date, cutover boundary, parallel running, step-up date; the F4.4.3 declaration within a month of the change and the ATP report 14 days after each period.",
      dr: "Fit-out of the suite (12–16 weeks), cross-connects, maintenance windows at period boundaries; the 2028 step-up rows inside the 500 kW envelope.",
      hpe: "Delivery (GreenLake 4–8 weeks, purchase 10–18 weeks), acceptance and burn-in, the step-up kit, support during the move.",
    }),
    chart,
    el("div", { class: "view-layout" }, controls, el("div", { class: "outputs" }, consequences, milestones, signBy)))

  function update(state) {
    const { plan, result } = state
    const tl = result.timeline
    contract.sync(plan.timeline.contractDate)
    cutover.sync(plan.timeline.cutoverDate)
    parallel.sync(plan.timeline.parallelWeeks)
    stepUp.sync(plan.timeline.stepUpDate)
    const t27 = tl.seasons[2027]
    const t28 = tl.seasons[2028]
    fill(chart, 
      el("div", { class: "card-head row" }, el("h3", {}, "Gantt"), badge(tl.status === "ok" ? "ok" : tl.status, tl.status === "ok" ? "On plan" : tl.status === "warn" ? "Check" : "Late")),
      gantt(tl, { compact: false }),
      ganttLegend())
    fill(consequences, 
      el("h3", {}, "What the schedule does to the seasons"),
      el("div", { class: "stats" },
        stat("2027 go-live", t27.goLive ? fmtDate(t27.goLive) : "No move", t27.goLive ? `${t27.atBoundary ? "start of" : "inside"} ${t27.atp.label} · ${Math.round(t27.shareOld * 100)} % of 2027 on today's setup${t27.slipDays ? ` · slipped ${t27.slipDays} days` : t27.slackDays ? ` · ${t27.slackDays} days of slack` : ""}` : "both seasons on today's estate", { id: "stat-golive" }),
        stat("Allowance lost at the switch", t27.goLive ? `${(t27.periodLoss * 100).toFixed(1)} % of ${t27.atp.label}` : "—", t27.goLive ? `${t27.downtimeDays} solver day${t27.downtimeDays === 1 ? "" : "s"} · ${(t27.seasonLoss * 100).toFixed(2)} % of the season` : "", { id: "stat-loss" }),
        stat("Critical path", t27.critical ? PATH[t27.critical] || t27.critical : "—", t27.totalWeeks ? `${t27.totalWeeks} weeks from contract to the earliest cutover` : "", { id: "stat-critical" }),
        stat("2028 step-up", t28.changes ? fmtDate(t28.goLive) : "None", t28.changes ? `${t28.earlyDays > 0 ? `${Math.round(t28.earlyDays / 7)} wk before GPUs are allowed` : t28.shareOld > 0 ? `${Math.round(t28.shareOld * 100)} % of 2028 on the 2027 estate` : "on 1 January, no allowance lost"}${t28.earlyCostCHF ? ` · ${fmt.chf(t28.earlyCostCHF)} carrying cost` : ""}` : "2028 runs the 2027 estate", { id: "stat-stepup" })),
      el("ul", { class: "flags", id: "timeline-flags" }, ...tl.flags.map(flagRow)),
      tl.oneOffs.length ? el("p", { class: "muted small" }, "One-offs from the schedule: ", tl.oneOffs.map((o) => `${o.label} ${fmt.chf(o.chf)} (${o.year})`).join(" · ")) : null)
    fill(milestones, 
      el("h3", {}, "Milestones and lead times"),
      el("div", { class: "table-wrap" }, el("table", { class: "table milestones-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "What"), el("th", {}, "Owner"), el("th", {}, "Status"))),
        el("tbody", {},
          ...tl.milestones.filter((m) => !m.offChart).sort((a, b) => a.date - b.date).map((m) => el("tr", {}, el("td", { class: "mono" }, isoDate(m.date)), el("td", {}, m.label, m.rule ? el("span", { class: "fia-badge" }, m.rule) : null, explainButton(`milestone.${m.id}`, m.label)), el("td", {}, OWNER[m.owner] || m.owner), el("td", {}, badge(m.status === "ok" ? "ok" : "warn", m.status === "ok" ? "OK" : "Check")))),
          ...tl.tasks.map((t) => el("tr", { class: "muted" }, el("td", { class: "mono" }, `${isoDate(t.start)} → ${isoDate(t.end)}`), el("td", {}, t.label), el("td", {}, OWNER[t.owner] || t.owner), el("td", {}, `${t.weeks} wk`))),
          ...tl.milestones.filter((m) => m.offChart).map((m) => el("tr", { class: "muted" }, el("td", { class: "mono" }, isoDate(m.date)), el("td", {}, m.label), el("td", {}, OWNER[m.owner] || m.owner), el("td", {}, "beyond 2028")))))),
      el("p", { class: "muted small" }, `Lead times are planning assumptions (fact pack G-e, D-e, H-f): GreenLake ${K.timeline.leadWeeks.greenlake} wk, purchase ${K.timeline.leadWeeks.buy} wk, fit-out ${K.timeline.leadWeeks.fitOut}–${K.timeline.leadWeeks.fitOutLiquid} wk, dark fibre ${K.timeline.leadWeeks.fibre} wk (+${K.timeline.leadWeeks.fibreSecondRoute} for a second route), burn-in ${K.timeline.leadWeeks.burnIn} wk.`))
    fill(signBy, 
      el("h3", {}, "Sign by … to make …"),
      el("p", { class: "card-sub" }, t27.changes ? `With ${t27.totalWeeks} weeks from contract to cutover (incl. ${plan.timeline.parallelWeeks} wk parallel), each boundary needs a signature by:` : "No move in this plan."),
      t27.changes ? el("div", { class: "signby-grid" }, ...cutoverOptions().map((o) => {
        const d = t27.signBy[o.value]
        const late = d < parseDate(K.timeline.planningDate)
        return el("button", { type: "button", class: `signby ${o.value === plan.timeline.cutoverDate ? "current" : ""} ${late ? "late" : ""}`, onclick: () => ctx.actions.setTimeline({ cutoverDate: o.value }) },
          el("span", { class: "signby-target" }, o.label), el("b", {}, late ? "too late" : fmtDate(d)))
      })) : null)
  }
  return { node, update }
}
