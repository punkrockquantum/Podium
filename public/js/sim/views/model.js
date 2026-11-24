/** "How the model works" and "Assumptions & sources": every constant with its VERIFIED / ASSUMPTION status and fact-pack row. */
import { DEFAULTS } from "../model.js"
import { K, assumptionRows, PROVIDER } from "../assumptions.js"
import { EXPLAIN, TERM_IDS } from "../explain.js"
import { CUSTOMER, annotatedFigures } from "../../customer.js"
import { el } from "../dom.js"
import { badge, explainButton } from "../widgets.js"

export function modelView() {
  const steps = [
    ["Two seasons, one plan", "Every control is set for 2027; 2028 inherits it until you change it for 2028. The sliding-scale position, model confidence, the latency venue and the one-off / accounting choices are held once for the plan."],
    ["FIA envelope", `The sliding scale gives P${DEFAULTS.position} ${K.fia.scale[DEFAULTS.position - 1]} % of the 6 MAUh baseline per period. AUh = cores × solver seconds × declared clock ÷ 3600, so the FIA charges clock and time, not useful work. GPUs may run the solver from 1 January 2028; no conversion rule exists yet, so the model charges FP64 core-equivalents and lets you test a kinder factor.`],
    ["Effective compute", "Work per metered AUh rises with a lower declared clock (memory-bound CFD scales with clock^0.6), newer silicon, a faster fabric and storage that keeps up; it falls with throttling above the allowance, thermal limits, outages, a room that cannot power the estate and allowance lost at the cutover."],
    ["Deployment timeline", `Six Aerodynamic Testing Periods a year (${K.timeline.atpRule}). A season's effective work is the share of the year on the old estate × its work plus the share on the new estate × its work; a cutover inside a period wastes ${K.timeline.cutoverDowntimeDays} solver days of that period (${K.timeline.switchDays} with parallel running), nothing at a period boundary or inside a shutdown. Lead times run from the contract date; if the target cannot be met the cutover slips to the first feasible day. A GPU partition live before 1 January 2028 costs its charge without ATR value after ${K.timeline.earlyStepUpBurnInWeeks} weeks of burn-in.`],
    ["The 500 kW envelope", `Digital Realty's offer is ${K.facility.envelopeKW} kW of critical IT in both seasons, a hard ceiling with no expansion right (more kW is a separate conversation: ZUR4 adds 15 MW in 2028). The estate that moves is ${K.facility.estateBaseKW} kW plus the cluster plus any ML partition placed at the campus; rack density may not exceed the cooling ceiling (air ${K.compute.coolingMaxKWPerRack.air}, rear-door ${K.compute.coolingMaxKWPerRack.reardoor}, direct liquid ${K.compute.coolingMaxKWPerRack.dlc} kW), the rows must fit ${K.facility.cageRackPositions} cage positions, and the declared clock may not go below the part's base clock. Every slider shows its live ceiling and clamps; a plan over the envelope is "Not possible" until it is fitted.`],
    ["Season performance", `Lap time found over a season follows Δt = ${K.performance.aeroA} · ln(1 + W / ${K.performance.aeroW0}) in effective MAUh per period, calibrated to about 0.09 s per 12.5 % step of the sliding scale. Cost-cap savings redeployed into the car add up to ${K.performance.reinvestMaxSec} s (≈ 0.085 s per CHF 1 M); spending more inside the cap counts against you. The confidence slider scales everything. Plan-level figures blend the old and the new estate by the go-live date, so they sit below the steady-state figures of a single season until the move is complete.`],
    ["Money & cap", "Depreciation or the GreenLake charge, support, software, power, the committed-kW fee, fibre, paddock links, edge and cloud on-ramps are Relevant Costs. Fit-out, plant and the Property share of the fee sit outside the cap (D5.1.1.j); heat recovery is a Sustainability Initiative Cost. Cash per year blends the old and the new estate by the share of the year each runs and adds that year's one-offs (fit-out, migration, parallel running, early step-up)."],
    ["Trackside", `Round-trip latency by venue, telemetry headroom against a 105 Mbps peak, link availability over ${K.trackside.raceWeekends} weekends and a data-to-decision loop (6 s base, two round trips, −1.5 s with an edge node). Trackside value is reported in its own units: data-to-decision seconds against a ${K.trackside.decisionTargetSec} s target, link availability and race weekends at risk. The tool does not convert anything into championship positions or points.`],
  ]
  const rowsK = assumptionRows().map((r) => ({ ...r, origin: "simulator" }))
  const rowsC = annotatedFigures(CUSTOMER).map((r) => ({ path: r.path, value: r.value, status: r.status, source: r.status === "VERIFIED" ? r.ref : "—", note: r.status === "VERIFIED" ? r.note || "" : r.ref, origin: "customer" }))
  const all = [...rowsK, ...rowsC]
  const verified = all.filter((r) => r.status === "VERIFIED").length
  const show = (v) => (typeof v === "object" ? JSON.stringify(v) : String(v))
  const node = el("div", { class: "view view-model" },
    el("section", { class: "section how", id: "how" },
      el("div", { class: "section-head" }, el("h2", {}, "How the model works"), el("p", { class: "card-sub" }, "Deterministic, pure functions; every number in this tool is recomputed from the controls. Full formulae in ", el("code", {}, "docs/audi-f1-model.md"), ".")),
      el("ol", { class: "how-steps" }, ...steps.map(([t, d]) => el("li", {}, el("b", {}, t), el("p", {}, d)))),
      el("p", { class: "muted small" }, "What it does not do: no stochastic simulation, no trade between wind-tunnel hours and CFD, no indexation or FX movement on the cap, and the rest of the IT estate costs the same in every plan.")),
    el("section", { class: "section sources", id: "assumptions" },
      el("div", { class: "section-head" },
        el("h2", {}, "Assumptions & sources"),
        el("p", { class: "card-sub" }, `${all.length} constants: ${verified} VERIFIED against a primary source, ${all.length - verified} planning ASSUMPTIONS, each keyed to a row of the fact pack (`, el("code", {}, "docs/audi-f1-sources.md"), ").")),
      el("p", { class: "footnote", id: "oem-footnote" }, badge("info", "Working assumption"), " ", PROVIDER.oemNote),
      el("details", { class: "sources-details", open: false },
        el("summary", {}, "Show every constant"),
        el("div", { class: "table-wrap" }, el("table", { class: "table sources-table", id: "sources-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Constant"), el("th", {}, "Value"), el("th", {}, "Status"), el("th", {}, "Row"), el("th", {}, "Note"))),
          el("tbody", {}, ...all.map((r) => el("tr", { class: `status-${r.status.toLowerCase()}` },
            el("td", { class: "mono" }, `${r.origin === "customer" ? "customer." : "sim."}${r.path}`),
            el("td", { class: "mono" }, show(r.value)),
            el("td", {}, badge(r.status === "VERIFIED" ? "ok" : "info", r.status)),
            el("td", { class: "mono" }, r.source),
            el("td", { class: "small" }, r.note)))))))),
    el("section", { class: "section glossary", id: "glossary" },
      el("div", { class: "section-head" }, el("h2", {}, "Glossary"), el("p", { class: "card-sub" }, "Every term the explainers use, in one line each. The same entries open from the glossary chips in an explainer.")),
      el("dl", { class: "glossary-grid" }, ...TERM_IDS.flatMap((id) => { const t = EXPLAIN[`term.${id}`]; return [el("dt", { id: `term-${id}` }, t.title, explainButton(`term.${id}`, t.title)), el("dd", {}, t.one, t.analogy ? el("span", { class: "muted" }, ` Think of it as ${t.analogy.charAt(0).toLowerCase()}${t.analogy.slice(1)}`) : null)] }))))
  return { node, update() {} }
}
