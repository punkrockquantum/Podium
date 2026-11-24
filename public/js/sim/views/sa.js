/** Solutions Architect view: requirements per season, service mapping, owner roles, discovery checklist (notes persisted), live risk register and the solution brief export. */
import { el, clear, fmt } from "../dom.js"
import { badge, stat } from "../widgets.js"
import { requirements, requirementDelta, serviceMap, riskRegister, solutionBrief, CHECKLIST, ROLES, roleLabel, HPE_FOOTNOTE } from "../sa.js"
import { fmtDate } from "../timeline.js"
import * as store from "../planstore.js"

const SIDE = { customer: "Customer", partner: "Partner", regulator: "Regulator", dr: "Digital Realty" }

export function saView(ctx) {
  let notes = store.loadNotes()
  const head = el("div", { class: "view-head sa-head" })
  const reqCard = el("section", { class: "card", id: "sa-requirements" })
  const servicesCard = el("section", { class: "card", id: "sa-services" })
  const rolesCard = el("section", { class: "card", id: "sa-roles" })
  const risksCard = el("section", { class: "card", id: "sa-risks" })
  const checklistCard = el("section", { class: "card", id: "sa-checklist" })
  const briefCard = el("section", { class: "card", id: "sa-brief" })
  const node = el("div", { class: "view view-sa" }, head, el("div", { class: "sa-grid" }, reqCard, servicesCard, rolesCard, risksCard, checklistCard, briefCard))

  // The checklist is built once; notes persist per item
  const noted = el("span", { class: "badge level-info", id: "notes-count" })
  const countNotes = () => { const n = CHECKLIST.filter((c) => (notes[c.id] || "").trim()).length; noted.textContent = `${n} of ${CHECKLIST.length} noted` }
  countNotes()
  clear(checklistCard).append(
    el("div", { class: "card-head row" }, el("h3", {}, "Discovery checklist"), noted),
    el("p", { class: "card-sub" }, "What to confirm with the team before the design is frozen. Notes stay in this browser."),
    el("ol", { class: "checklist" }, ...CHECKLIST.map((c) => {
      const ta = el("textarea", { class: "note", id: `note-${c.id}`, rows: 2, placeholder: "Notes…", "aria-label": `Notes: ${c.q}` })
      ta.value = notes[c.id] || ""
      ta.addEventListener("input", () => { notes = { ...notes, [c.id]: ta.value }; store.saveNotes(notes); done.className = `check-done ${ta.value.trim() ? "yes" : ""}`; countNotes() })
      const done = el("span", { class: `check-done ${(notes[c.id] || "").trim() ? "yes" : ""}`, "aria-hidden": "true" })
      return el("li", { class: "check-item", dataset: { id: c.id } },
        el("div", { class: "check-head" }, done, el("span", { class: "check-group" }, c.group), c.rule ? el("span", { class: "fia-badge" }, c.rule) : null),
        el("p", { class: "check-q" }, c.q), ta)
    })),
    el("button", { type: "button", class: "btn btn-small", id: "clear-notes", onclick: () => { notes = {}; store.saveNotes(notes); for (const ta of checklistCard.querySelectorAll("textarea")) { ta.value = ""; ta.dispatchEvent(new Event("input")) } } }, "Clear notes"))

  function update(state) {
    const { plan, result } = state
    const r27 = requirements(result, 2027)
    const r28 = requirementDelta(result)
    const services = serviceMap(result)
    const risks = riskRegister(result)
    clear(head).append(
      el("div", { class: "sa-title" }, el("h2", {}, "Solutions Architect view"), badge("info", "Digital Realty internal")),
      el("p", { class: "card-sub" }, `What “${plan.meta.name}” asks of the Zurich campus in each season, which public Digital Realty services answer it, who owns each piece and what could go wrong. ${HPE_FOOTNOTE}`),
      el("div", { class: "stats four" },
        stat("2027 IT load at the campus", `${Math.round(result.seasons[2027].sim.fac.drIT)} kW`, result.inputs[2027].location === "hinwil" ? "stays in Hinwil" : `${result.seasons[2027].sim.hw.racks} rack(s) · ${result.inputs[2027].cooling} · ${result.inputs[2027].redundancy.toUpperCase().replace("N1", "N+1")}`),
        stat("2028 IT load at the campus", `${Math.round(result.seasons[2028].sim.fac.drIT)} kW`, result.inputs[2028].location === "hinwil" ? "stays in Hinwil" : `${result.seasons[2028].sim.hw.racks} rack(s) · ${result.inputs[2028].cooling} · ${result.inputs[2028].redundancy.toUpperCase().replace("N1", "N+1")}`),
        stat("Suite ready by", result.timeline.seasons[2027].goLive ? fmtDate(result.timeline.seasons[2027].feasible) : "—", result.timeline.seasons[2027].goLive ? `cutover ${fmtDate(result.timeline.seasons[2027].goLive)}` : "no move in this plan"),
        stat("Open risks", String(risks.filter((k) => k.status !== "mitigated").length), `${risks.filter((k) => k.status === "triggered").length} triggered by the current plan`)))
    // One row per requirement: the 2027 value, then what 2028 changes (highlighted) or "same"
    const statusBadge = (q) => badge(q.status === "VERIFIED" ? "ok" : q.status === "ASSUMPTION" ? "info" : "warn", q.status === "derived" ? "from plan" : q.status)
    const detailCell = (q) => el("td", {}, el("b", {}, q.label), el("div", { class: "muted small" }, q.detail))
    const rows28 = new Map(r28.map((q) => [q.id, q]))
    const changedCount = r28.filter((q) => q.changed).length
    const onlyIn28 = r28.filter((q) => !r27.some((p) => p.id === q.id))
    clear(reqCard).append(
      el("div", { class: "card-head row" }, el("h3", {}, "Requirements derived from the plan"), badge(changedCount ? "warn" : "ok", changedCount ? `${changedCount} change${changedCount === 1 ? "" : "s"} in 2028` : "2028 same as 2027")),
      el("p", { class: "card-sub" }, "Every line comes from the plan; the 2028 column shows only what differs from 2027 (highlighted)."),
      el("div", { class: "table-wrap" }, el("table", { class: "table req-table", id: "req-2027" },
        el("thead", {}, el("tr", {}, el("th", {}, "Area"), el("th", {}, "Requirement"), el("th", {}, "2027"), el("th", {}, "2028"), el("th", {}, "Service"), el("th", {}, "Owner"), el("th", {}, "Status"))),
        el("tbody", {}, ...r27.map((q) => {
          const n = rows28.get(q.id)
          const changed = Boolean(n && n.changed)
          return el("tr", { class: `${q.status === "ASSUMPTION" ? "status-assumption" : ""} ${changed ? "changed" : ""}`, dataset: { req: q.id } },
            el("td", {}, q.area), detailCell(q), el("td", { class: "y27" }, q.value),
            el("td", { class: `y28 ${changed ? "diff" : "same"}` }, n ? (changed ? n.value : "same") : "—"),
            el("td", { class: "small" }, q.service || "—"), el("td", { class: "small" }, roleLabel(q.owner)), el("td", {}, statusBadge(q)))
        })))),
      onlyIn28.length ? el("div", { class: "table-wrap", id: "req-2028" }, el("h4", {}, "Only in 2028"), el("table", { class: "table req-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "Area"), el("th", {}, "Requirement"), el("th", {}, "2028"), el("th", {}, "Service"), el("th", {}, "Owner"), el("th", {}, "Status"))),
        el("tbody", {}, ...onlyIn28.map((q) => el("tr", { class: "changed", dataset: { req: q.id } }, el("td", {}, q.area), detailCell(q), el("td", { class: "y28 diff" }, q.value), el("td", { class: "small" }, q.service || "—"), el("td", { class: "small" }, roleLabel(q.owner)), el("td", {}, statusBadge(q)))))))
        : el("p", { class: "muted small", id: "req-2028" }, `2028 adds no requirement of its own${changedCount ? `; ${changedCount} of the ${r27.length} above change value` : ""}.`))
    clear(servicesCard).append(
      el("h3", {}, "Service mapping"),
      el("p", { class: "card-sub" }, "Public Digital Realty service names, each keyed to a fact-pack row; carrier fibre and HPE are partner services."),
      el("ul", { class: "service-list" }, ...services.map((s) => el("li", { class: `service ${s.external ? "external" : ""}` },
        el("div", { class: "service-need" }, s.need), el("div", { class: "service-name" }, s.service, el("span", { class: "fia-badge src" }, s.source)), el("div", { class: "muted small" }, s.detail)))))
    clear(rolesCard).append(
      el("h3", {}, "Who owns what"),
      el("p", { class: "card-sub" }, "Digital Realty roles are generic (ASSUMPTION); the team, HPE, the carrier and the FIA are as published."),
      el("ul", { class: "role-list" }, ...ROLES.map((r) => el("li", { class: `role-item side-${r.side}` }, el("span", { class: "role-side" }, SIDE[r.side] || r.side), el("b", {}, r.label), el("span", { class: "muted small" }, r.scope), badge(r.status === "VERIFIED" ? "ok" : "info", r.status)))))
    clear(risksCard).append(
      el("h3", {}, "Risk register (live)"),
      el("p", { class: "card-sub" }, "Likelihood and status follow the plan: change the schedule or the estate and the register moves."),
      el("div", { class: "table-wrap" }, el("table", { class: "table risk-table", id: "risk-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "Risk"), el("th", {}, "L"), el("th", {}, "I"), el("th", {}, "Owner"), el("th", {}, "Mitigation"), el("th", {}, "Status"))),
        el("tbody", {}, ...risks.map((k) => el("tr", { class: `risk-${k.status} lvl-${k.likelihood}`, dataset: { risk: k.id } },
          el("td", {}, el("b", {}, k.title), k.season ? el("span", { class: "season-tag" }, String(k.season)) : null, k.source ? el("span", { class: "fia-badge src" }, k.source) : null),
          el("td", {}, badge(k.likelihood === "high" ? "bad" : k.likelihood === "medium" ? "warn" : "ok", k.likelihood)),
          el("td", {}, badge(k.impact === "high" ? "bad" : k.impact === "medium" ? "warn" : "ok", k.impact)),
          el("td", { class: "small" }, roleLabel(k.owner)),
          el("td", { class: "small" }, k.mitigation),
          el("td", {}, badge(k.status === "triggered" ? "bad" : k.status === "mitigated" ? "ok" : "info", k.status))))))))
    clear(briefCard).append(
      el("h3", {}, "Solution brief"),
      el("p", { class: "card-sub" }, "Print this view as the hand-over brief, or export the JSON for the design team."),
      el("div", { class: "actions-row" },
        el("button", { type: "button", class: "btn", id: "brief-print", onclick: () => window.print() }, "Print the brief"),
        el("button", { type: "button", class: "btn", id: "brief-json", onclick: () => store.downloadJson(solutionBrief(result, { notes, generatedAt: new Date().toISOString() }), `audi-f1-digital-realty-solution-brief-${plan.meta.preset || "custom"}.json`) }, "Export JSON hand-over")),
      el("p", { class: "footnote", id: "hpe-footnote" }, badge("info", "Footnote"), " ", HPE_FOOTNOTE))
  }
  return { node, update }
}

export { fmt }
