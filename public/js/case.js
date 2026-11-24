/**
 * The business case: Audi F1's IT estate in the Hinwil data room (as is, or upgraded) versus
 * 500 kW committed in our Zurich campus, for 2027 and for the 2028 load. Pure arithmetic over
 * customer.js (`caseModel`), plus the page that renders it with live sliders. No dependencies.
 *
 * Formulae (per option o, per year y with IT load L kW):
 *   served kW        = min(L, o.capacity[y])                      what the site can actually power
 *   shortfall kW     = L − served                                 flagged, never hidden in the cost
 *   facility kWh/yr  = served × loadFactor × 8760 × o.pue[y]      loadFactor 0.85 = average vs installed
 *   electricity CHF  = facility kWh × tariff[o.site]              Rp/kWh slider ÷ 100
 *   colo fee CHF     = feePerKWMonth × max(committed[y], L) × 12  campus only; 2028 commitment rises
 *   CO2 t/yr         = facility kWh × gCO2/kWh ÷ 1e6
 *   yearly cash      = electricity + colo fee
 *   cost-cap charge  = yearly cash + plant capex ÷ 10             straight-line, zero residual (D6.1.1.k);
 *                                                                 conservative: treats fee, fit-out and
 *                                                                 plant as in-cap (C3, C3-open)
 *   one-off 2027     = o.capex2027                                patch / retrofit / fit-out + migration
 *   one-off 2028     = o.capex2028(L2028)                         new hall at CHF/kW × shortfall, or
 *                                                                 the campus expansion fit-out
 *   3-year TCO       = one-off 2027 + one-off 2028 + cash(2027) + 2 × cash(2028)   2027, 2028, 2029
 * IT hardware is identical in every option and left out of the comparison.
 */
import { CUSTOMER, FIGURES as F, annotatedFigures, costCapCHF, chf, chfFull } from "./customer.js"

const HOURS = 8760
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d

/** Slider defaults, all from customer.js. */
export const DEFAULT_INPUTS = {
  hinwilRp: Math.round(F.tariffs.hinwilCHFPerKWh * 100),
  campusRp: Math.round(F.tariffs.campusCHFPerKWh * 100),
  load2027: F.load.it2027KW,
  load2028: F.load.it2028KW,
  feePerKWMonth: F.offer.feeCHFPerKWMonth,
}

export const SLIDERS = [
  { id: "hinwilRp", label: "Hinwil electricity (EKZ, all-in)", unit: "Rp/kWh", min: 8, max: 30, step: 0.5, source: "D-a" },
  { id: "campusRp", label: "Campus electricity (ewz, pass-through)", unit: "Rp/kWh", min: 8, max: 30, step: 0.5, source: "D-b" },
  { id: "load2027", label: "2027 IT load", unit: "kW", min: 300, max: 500, step: 10, source: "B-a" },
  { id: "load2028", label: "2028 IT load", unit: "kW", min: 600, max: 1000, step: 10, source: "B-b" },
  { id: "feePerKWMonth", label: "Campus fee", unit: "CHF/kW/month", min: 120, max: 250, step: 5, source: "D-d" },
]

/** A new Hinwil hall's design PUE: better than the retrofit, worse than a purpose-built campus. */
const NEW_HALL_PUE = 1.3

/** The three options. `capacity`/`pue` are per year; `capex2028` depends on the 2028 load. */
function options(inputs) {
  const room = F.room
  const offer = F.offer
  const newHall = (load, have) => Math.max(0, load - have) * room.newHallCapexPerKWCHF
  const blendedPue = (load, have, havePue) => (load <= have ? havePue : round((have * havePue + (load - have) * NEW_HALL_PUE) / load, 2))
  return [
    {
      id: "asis",
      name: "Hinwil data room, as is",
      short: "As is",
      site: "hinwil",
      tariff: inputs.hinwilRp / 100,
      capacity: { 2027: room.capacityKW, 2028: room.capacityKW },
      pue: { 2027: room.pue, 2028: room.pue },
      fee: 0,
      committed: { 2027: 0, 2028: 0 },
      capex2027: 300_000,
      capex2028: () => 0,
      resilience: `${room.resilience} (single utility feed)`,
      heatReuse: "None",
      co2: F.tariffs.gridCO2gPerKWh,
      treatment: "Electricity in the cap; the room's existing plant is already depreciated. Nothing to exclude.",
      notes: ["A-a", "A-b", "A-c"],
    },
    {
      id: "upgrade",
      name: "Hinwil data room, upgraded",
      short: "Upgraded",
      site: "hinwil",
      tariff: inputs.hinwilRp / 100,
      capacity: { 2027: room.upgradedCapacityKW, 2028: Math.max(room.upgradedCapacityKW, inputs.load2028) },
      pue: { 2027: room.upgradedPue, 2028: blendedPue(inputs.load2028, room.upgradedCapacityKW, room.upgradedPue) },
      fee: 0,
      committed: { 2027: 0, 2028: 0 },
      capex2027: room.upgradeCapexCHF,
      capex2028: (load) => newHall(load, room.upgradedCapacityKW),
      resilience: `${room.upgradedResilience} after the retrofit`,
      heatReuse: "Possible with a heat pump (excluded Sustainability Initiative Cost)",
      co2: F.tariffs.gridCO2gPerKWh,
      treatment: "Electricity in the cap. Plant depreciation (chillers, UPS, switchgear) in the cap unless the auditors classify it as building or leasehold improvement (Property, excluded). Heat-recovery kit excluded.",
      notes: ["A-e", "D8"],
    },
    {
      id: "campus",
      name: `Zurich campus, ${offer.committedKW} kW committed`,
      short: "Zurich campus",
      site: "campus",
      tariff: inputs.campusRp / 100,
      capacity: { 2027: offer.committedKW, 2028: offer.expansionRightKW },
      pue: { 2027: offer.designPue, 2028: offer.designPue },
      fee: inputs.feePerKWMonth,
      committed: { 2027: offer.committedKW, 2028: Math.max(offer.committedKW, inputs.load2028) },
      capex2027: offer.fitOutCHF + offer.migrationCHF,
      capex2028: (load) => (load > offer.committedKW ? offer.expansionFitOutCHF : 0),
      resilience: `${offer.power} power, ${offer.cooling} cooling`,
      heatReuse: "Waste heat to district heating (campus-side)",
      co2: F.tariffs.gridCO2gPerKWh,
      treatment: "Electricity pass-through in the cap. The fee is modelled in the cap; its space component may qualify as Property Costs (excluded) and the fit-out as leasehold improvement, both to confirm with the team's Cost Cap Administration contact (C3-open).",
      notes: ["D-d", "D5", "D6"],
    },
  ]
}

function year(o, load, y) {
  const served = Math.min(load, o.capacity[y])
  const shortfall = load - served
  const kwh = served * F.load.loadFactor * HOURS * o.pue[y]
  const electricity = kwh * o.tariff
  const fee = o.fee * Math.max(o.committed[y], load) * 12
  const co2t = (kwh * o.co2) / 1e6
  return { load, served, shortfall, pue: o.pue[y], kwh, electricity, fee, cash: electricity + fee, co2t, capacity: o.capacity[y] }
}

/** The whole case for one set of slider inputs. */
export function caseModel(inputs = DEFAULT_INPUTS) {
  const opts = options(inputs)
  const plantYears = F.fia.depreciationYearsPlant
  const rows = opts.map((o) => {
    const y27 = year(o, inputs.load2027, 2027)
    const y28 = year(o, inputs.load2028, 2028)
    const capex2028 = o.capex2028(inputs.load2028)
    const tco = o.capex2027 + capex2028 + y27.cash + 2 * y28.cash
    const costCap2027 = y27.cash + o.capex2027 / plantYears
    const costCap2028 = y28.cash + (o.capex2027 + capex2028) / plantYears
    return {
      id: o.id, name: o.name, short: o.short, resilience: o.resilience, heatReuse: o.heatReuse, treatment: o.treatment, notes: o.notes,
      y2027: y27, y2028: y28,
      capex2027: o.capex2027, capex2028,
      tco, costCap2027, costCap2028,
      headroom2028: o.capacity[2028] - inputs.load2028,
      viable2027: y27.shortfall === 0,
      viable2028: y28.shortfall === 0,
    }
  })
  const campus = rows.find((r) => r.id === "campus")
  const upgrade = rows.find((r) => r.id === "upgrade")
  return {
    inputs,
    rows,
    delta: { tco: upgrade.tco - campus.tco, costCap2027: upgrade.costCap2027 - campus.costCap2027, co2: upgrade.y2027.co2t + 2 * upgrade.y2028.co2t - (campus.y2027.co2t + 2 * campus.y2028.co2t) },
    costCap: costCapCHF,
  }
}

/* ------------------------------------------------------------ the page */

const fmtKWh = (kwh) => `${(kwh / 1e6).toFixed(2)} GWh`
const pct = (x) => `${(x * 100).toFixed(1)}%`
const kW = (x) => `${Math.round(x).toLocaleString("en-US")} kW`

function rowsFor(m) {
  const flag = (r, y) => (r[y].shortfall > 0 ? ` · short by ${kW(r[y].shortfall)}` : "")
  return [
    ["Usable IT capacity 2027", (r) => kW(r.y2027.capacity) + flag(r, "y2027")],
    ["IT load served 2027", (r) => `${kW(r.y2027.served)} of ${kW(r.y2027.load)}`],
    ["PUE", (r) => `${r.y2027.pue.toFixed(2)}${r.y2028.pue !== r.y2027.pue ? ` → ${r.y2028.pue.toFixed(2)} in 2028` : ""}`],
    ["Facility electricity 2027", (r) => fmtKWh(r.y2027.kwh)],
    ["Electricity cost 2027", (r) => chfFull(r.y2027.electricity)],
    ["Colocation fee 2027", (r) => (r.y2027.fee ? chfFull(r.y2027.fee) : "—")],
    ["One-off 2027", (r) => chfFull(r.capex2027)],
    ["Yearly cost-cap charge 2027", (r) => `${chfFull(r.costCap2027)} (${pct(r.costCap2027 / m.costCap.market)} of the cap)`],
    ["2028 IT load", (r) => `${kW(r.y2028.served)} of ${kW(r.y2028.load)}${flag(r, "y2028")}`],
    ["One-off 2028", (r) => (r.capex2028 ? chfFull(r.capex2028) : "—")],
    ["Yearly cash 2028", (r) => chfFull(r.y2028.cash)],
    ["3-year TCO 2027–2029", (r) => `${chfFull(r.tco)}${r.viable2027 && r.viable2028 ? "" : " · does not carry the load"}`, "tco"],
    ["CO2 2027 (location-based)", (r) => `${r.y2027.co2t.toFixed(0)} t`],
    ["Resilience", (r) => r.resilience],
    ["2028 headroom", (r) => (r.headroom2028 >= 0 ? `+${kW(r.headroom2028)}${r.capex2028 && r.id !== "campus" ? " after the new hall" : ""}` : `${kW(r.headroom2028)} (new hall needed)`)],
    ["Heat reuse", (r) => r.heatReuse],
    ["Cost-cap treatment", (r) => r.treatment, "small"],
  ]
}

function render(root, el, m) {
  const rows = rowsFor(m)
  const table = el("table", { class: "grid case-grid", id: "caseTable" },
    el("thead", {}, el("tr", {}, el("th", {}, ""), m.rows.map((r) => el("th", { class: r.id === "campus" ? "campus" : "" }, r.name)))),
    el("tbody", {}, rows.map(([label, fn, cls]) => el("tr", { class: cls || "" }, el("th", { scope: "row" }, label), m.rows.map((r) => el("td", { class: r.id === "campus" ? "campus" : "", "data-row": label, "data-option": r.id }, fn(r)))))))
  const campus = m.rows.find((r) => r.id === "campus")
  const upgrade = m.rows.find((r) => r.id === "upgrade")
  const asis = m.rows.find((r) => r.id === "asis")
  /* The headline is honest in both directions: each cell says whether the campus is lower or higher. */
  const abs = (x) => chf(Math.abs(x))
  const headline = el("div", { class: "case-headline", id: "caseHeadline" },
    el("div", { class: m.delta.tco >= 0 ? "good" : "bad" }, el("b", {}, abs(m.delta.tco)), el("span", {}, `3-year TCO ${m.delta.tco >= 0 ? "below" : "above"} the Hinwil upgrade path`)),
    el("div", { class: m.delta.costCap2027 >= 0 ? "good" : "bad" }, el("b", {}, abs(m.delta.costCap2027)), el("span", {}, `${m.delta.costCap2027 >= 0 ? "lower" : "higher"} yearly cost-cap charge in 2027 (fee modelled in-cap)`)),
    el("div", { class: m.delta.co2 >= 0 ? "good" : "bad" }, el("b", {}, `${Math.abs(m.delta.co2).toFixed(0)} t`), el("span", {}, `CO2 ${m.delta.co2 >= 0 ? "avoided" : "added"} over three years vs the upgrade`)),
    el("div", { class: campus.headroom2028 >= 0 ? "good" : "bad" }, el("b", {}, kW(campus.headroom2028)), el("span", {}, "campus headroom above the 2028 load")))
  const path = el("section", { class: "panel case-2028", id: "path2028" },
    el("h2", {}, "The 2028 path"),
    el("p", { class: "muted" }, `From 1 January 2028 the FIA allows GPU cores for the CFD solver (F4.4.1) and the estate is planned to double to ${kW(m.inputs.load2028)} [B-b, C6]. What each option needs to carry it:`),
    el("ul", {},
      el("li", {}, el("b", {}, `${asis.name}: `), asis.viable2028 ? "fits." : `${kW(-asis.headroom2028)} short. Not a 2028 option without a new hall at ${chfFull(F.room.newHallCapexPerKWCHF)} per kW [D8].`),
      el("li", {}, el("b", {}, `${upgrade.name}: `), upgrade.capex2028 ? `the retrofit tops out at ${kW(F.room.upgradedCapacityKW)}; a new hall for the rest costs about ${chfFull(upgrade.capex2028)} and 12–18 months of building [D8].` : "the retrofit covers the 2028 load."),
      el("li", {}, el("b", {}, `${campus.name}: `), `the contractual expansion right to ${kW(F.offer.expansionRightKW)} covers it; the commitment rises to ${kW(m.rows[2].y2028.load)} at the same fee${campus.capex2028 ? `, plus ${chfFull(campus.capex2028)} of fit-out for the liquid-cooled GPU rows` : ""}. No second move, no second FIA re-declaration (F4.4.3).`)))
  root.replaceChildren(headline, el("div", { class: "table-scroll" }, table), path)
}

function sourcesList(el) {
  const items = annotatedFigures(CUSTOMER)
  return el("section", { class: "panel case-sources", id: "caseSources" },
    el("h2", {}, "Every figure, and where it comes from"),
    el("p", { class: "muted small" }, `Status per figure: VERIFIED points at a numbered row of ${CUSTOMER.sourcesDoc} (public source, URL and access date ${CUSTOMER.accessed}); ASSUMPTION carries its one-line rationale. Change any figure in public/js/customer.js and this page, the tables and the briefs follow.`),
    el("div", { class: "table-scroll" }, el("table", { class: "grid small" },
      el("thead", {}, el("tr", {}, el("th", {}, "Figure"), el("th", {}, "Value"), el("th", {}, "Status"), el("th", {}, "Source or rationale"))),
      el("tbody", {}, items.map((x) => el("tr", { class: x.status.toLowerCase() },
        el("td", {}, el("code", {}, x.path)),
        el("td", {}, typeof x.value === "object" && x.value !== null ? JSON.stringify(x.value) : String(x.value)),
        el("td", {}, el("span", { class: `status ${x.status.toLowerCase()}` }, x.status)),
        el("td", {}, x.status === "VERIFIED" ? `[${x.ref}]${x.note ? ` ${x.note}` : ""}` : x.ref)))))))
}

export function mountCase(root, el) {
  const inputs = { ...DEFAULT_INPUTS }
  const out = el("div", { class: "case-out" })
  const controls = el("section", { class: "panel case-controls no-print-inputs", id: "caseControls" },
    el("h2", {}, "Assumptions you can move"),
    el("p", { class: "muted small" }, "Every slider starts at the planning value from customer.js; the table recomputes as you move it. Print shows the values, not the sliders."),
    el("div", { class: "sliders" }, SLIDERS.map((s) => {
      const value = el("output", { id: `${s.id}Value` }, `${inputs[s.id]} ${s.unit}`)
      const input = el("input", { type: "range", id: s.id, min: s.min, max: s.max, step: s.step, value: inputs[s.id], "aria-label": s.label })
      input.addEventListener("input", () => {
        inputs[s.id] = Number(input.value)
        value.textContent = `${inputs[s.id]} ${s.unit}`
        render(out, el, caseModel(inputs))
      })
      return el("label", { class: "slider" }, el("span", {}, s.label, " ", el("small", { class: "muted" }, `[${s.source}]`)), input, value)
    })),
    el("button", { class: "btn small-btn", id: "resetCase", type: "button", onclick: () => { Object.assign(inputs, DEFAULT_INPUTS); for (const s of SLIDERS) { root.querySelector(`#${s.id}`).value = inputs[s.id]; root.querySelector(`#${s.id}Value`).textContent = `${inputs[s.id]} ${s.unit}` } render(out, el, caseModel(inputs)) } }, "Reset to planning values"))
  render(out, el, caseModel(inputs))
  root.append(controls, out, sourcesList(el))
}
