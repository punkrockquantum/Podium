/** Commercials: run-rate and cash per season, what sits inside and outside the cost cap, the 3-year view and the link to the business case. */
import { costCapCHF, FIGURES as F } from "../../customer.js"
import { el, clear, fmt } from "../dom.js"
import { gauge, stat, badge } from "../widgets.js"
import { controlsSection, seasonCols, roleStrip } from "./common.js"

export function commercialsView(ctx) {
  const controls = controlsSection(["facility"], ctx, { title: "Commercial controls", subtitle: "The accounting choices and one-offs are held once for the plan; the fee and tariff follow the facility choices." , exclude: ["location", "hinwilRetrofit", "committedKW", "expansionRight", "rackKW", "cooling", "redundancy", "pueMode", "pueValue", "renewable", "heatReuse"] })
  const outputs = el("div", { class: "outputs", id: "outputs-commercials" })
  const node = el("div", { class: "view view-commercials" },
    el("div", { class: "view-head" }, el("h2", {}, "Commercials"), el("p", { class: "card-sub" }, "Run-rate per season, cash in each year including one-offs, the cost-cap charge and the 3-year view. Figures are a planning model, not a quotation.")),
    roleStrip({
      team: "How the colocation fee is split between Property Costs and services, the depreciation or GreenLake charge inside the cap, what is reinvested in the car.",
      dr: "Committed-kW fee, fit-out as a leasehold improvement, cross-connects, invoices structured so the property element is separable.",
      hpe: "GreenLake monthly charge (reserved share plus metered use) or the purchase price depreciated over the refresh cadence; support.",
    }),
    el("div", { class: "view-layout" }, controls.node, outputs))

  function update(state) {
    controls.sync(state)
    const { result } = state
    const s27 = result.seasons[2027]
    const s28 = result.seasons[2028]
    const x27 = result.inputs[2027]
    const x28 = result.inputs[2028]
    const caseQuery = new URLSearchParams({ load2027: String(Math.round(Math.max(300, Math.min(500, s27.sim.fac.drIT || s27.sim.fac.hinwilIT)))), load2028: String(Math.round(Math.max(600, Math.min(1000, s28.sim.fac.drIT || s28.sim.fac.hinwilIT)))), campusRp: String(x27.location === "hinwil" ? F.tariffs.campusCHFPerKWh * 100 : x27.tariffRp), feePerKWMonth: String(F.offer.feeCHFPerKWMonth) })
    const summary = el("section", { class: "card" },
      el("h3", {}, "Two seasons, one cheque book"),
      el("div", { class: "stats three" },
        stat("Cash 2027 + 2028", fmt.chf(result.totals.cash), `${fmt.chfDelta(result.totals.cashDelta)} vs staying as today (${fmt.chf(result.totals.todayCash)})`, { id: "stat-cash-total" }),
        stat("3-year TCO (2028 estate)", fmt.chf(result.totals.tco3), `today's setup: ${fmt.chf(result.totals.todayTco3)}`, { id: "stat-tco3" }),
        stat("Lap time, both seasons", fmt.sec(result.totals.sec), `${fmt.signed(result.totals.points, 0)} points over two seasons at ${state.plan.shared.confidence} % confidence`, { id: "stat-sec-total" })),
      el("p", { class: "muted small" }, "Run-rate is the estate's yearly cost once it is in; cash blends the old and the new estate by the share of the year each runs and adds that year's one-offs."),
      el("div", { class: "actions-row" },
        el("a", { class: "btn btn-link", id: "case-link-figures", href: `/case.html?${caseQuery.toString()}`, target: "_blank", rel: "noopener" }, "Open the business case with these figures ↗"),
        el("span", { class: "muted small" }, `Passes the IT load per season (${Math.round(s27.sim.fac.totalIT)} / ${Math.round(s28.sim.fac.totalIT)} kW) and the tariff to the slider page.`)))
    const cols = seasonCols(result, (year, s) => {
      const sim = s.sim
      const x = sim.inputs
      return [
        el("div", { class: "gauges two" },
          gauge({ label: "Cost-cap charge", value: sim.money.capShare, max: 0.05, display: fmt.pct(sim.money.capShare, 1), sub: `of ${fmt.chf(costCapCHF.fia, 0)}`, tone: "ok" }),
          gauge({ label: "Outside the cap", value: sim.money.excludedYearly, max: Math.max(1, sim.money.yearly), display: fmt.chf(sim.money.excludedYearly), sub: `of ${fmt.chf(sim.money.yearly)} a year`, tone: "ok" })),
        el("div", { class: "stats" },
          stat("Run-rate", fmt.chf(sim.money.yearly), `${fmt.chfDelta(s.money.yearlyDelta)} vs today`),
          stat("Inside the cap", fmt.chf(sim.money.capCharge), `${fmt.chfDelta(s.money.capChargeDelta)} vs today · ${fmt.chf(sim.money.excludedYearly)} outside`),
          stat(`Cash in ${year}`, fmt.chf(s.money.cash), `${fmt.chf(s.money.oneOffTotal)} one-offs · ${fmt.chfDelta(s.money.cashDelta)} vs today`),
          stat("Cap per effective MAUh", sim.money.costPerEffectiveMauh ? fmt.chf(sim.money.costPerEffectiveMauh) : "—", "cost-cap charge per effective MAUh a year")),
        el("table", { class: "table money-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Line"), el("th", { class: "num" }, "CHF / year"), el("th", { class: "num" }, "In the cap"))),
          el("tbody", {}, ...sim.money.lines.map((l) => el("tr", {}, el("td", {}, l.label), el("td", { class: "num" }, fmt.chfFull(l.chf)), el("td", { class: "num" }, l.cap > 0 ? fmt.chfFull(l.cap) : "excluded"))),
            ...s.money.oneOffs.map((o) => el("tr", { class: "oneoff" }, el("td", {}, `${o.label} (one-off)`, el("span", { class: "muted small" }, ` ${o.why}`)), el("td", { class: "num" }, fmt.chfFull(o.chf)), el("td", { class: "num" }, o.cap === "included" ? `in ${year}` : "excluded"))))),
        el("p", { class: "muted small" }, `${x.propertySharePct} % of the colocation fee treated as Property Costs (D5.1.1.j) · ${x.consumption === "greenlake" ? "GreenLake charge" : `depreciation over ${x.refreshYears} years (D6.1.1.k)`}.`),
      ]
    }, { id: "commercials-seasons" })
    clear(outputs).append(summary, cols, el("p", { class: "footnote" }, badge("info", "Working assumption"), " ", "HPE hardware and support are supplied through HPE GreenLake; the GreenLake uplift, buffer and metering are planning assumptions (fact pack H1–H3, H-f)."))
  }
  return { node, update }
}
