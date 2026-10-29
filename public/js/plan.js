/** The one-page plan a team gets when it locks in a table (station, host and demo mode). */
import * as C from "./catalog.js"
import { el, pct, WORDS } from "./ui.js"
import { millions } from "./summary.js"

/** The one-page plan. `review` is the Architect's decision for this table, if any. */
export function planSheet(team, plan, { review = null, screenshotPrompt = true } = {}) {
  const station = C.byId(C.STATIONS, plan.station)
  const approved = review?.status === "approved"
  const L = plan.ledger
  return el("div", { class: "plan-sheet", id: "planSheet" },
    screenshotPrompt ? el("div", { class: "shot" }, `📸 ${WORDS.screenshot}`) : null,
    el("div", { class: "meta" }, el("span", {}, `Plan ${plan.id}`), el("span", {}, new Date(plan.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))),
    el("h2", {}, `${team.name} · ${station?.name || plan.station}`),
    el("div", { class: "meta" }, el("span", {}, C.tierFor(team).label)),
    el("table", {}, el("tbody", {}, plan.decisions.map((d) => el("tr", {}, el("td", {}, d.name), el("td", {}, el("b", {}, d.label), el("div", { class: "small" }, d.text)))))),
    el("div", { class: "figs" },
      el("div", {}, el("b", {}, `${millions(L.capex)} / ${millions(L.capexLimit)}`), "CapEx"),
      el("div", {}, el("b", {}, `${millions(L.opex)} / ${millions(L.opexLimit)}`), "OpEx a year"),
      el("div", {}, el("b", {}, `${Math.round(L.facilityKW)} kW`), "Power"),
      el("div", {}, el("b", {}, L.fia), "FIA risk")),
    el("div", { class: "row" }, el("span", { class: "score" }, `${plan.score}%`), el("div", {}, el("b", {}, plan.band), el("div", { class: "small" }, plan.sentence))),
    el("div", { class: "meta" },
      el("span", {}, approved ? `Approved by ${review.by}` : "Not approved yet: this table scores 0 until the Architect approves it"),
      el("span", {}, `Table points: ${C.tablePoints(plan.score, approved)} / ${C.PITCH_MAX}`)))
}

/** Plain-English summary block for the Architect: the three choices, the consequences, the score. */
export function summaryBlock(summary) {
  return el("div", { class: "summary-block" },
    el("ul", { class: "choices-list" }, summary.sentences.map((line) => el("li", {}, line))),
    el("ul", { class: "consequences" }, summary.consequences.map((line) => el("li", {}, line))),
    el("div", { class: "score-line" }, el("b", {}, `${summary.score}%`), ` ${summary.band}. `, summary.parts.map((p) => `${p.name} ${pct(p.value)}`).join(" · ")))
}

/** "Your Architect is free: go and pitch now" or "Queue position N". */
export function queueStatus(state, teamId, stationId) {
  const list = state?.queues?.[stationId] || []
  const at = list.findIndex((entry) => entry.team === teamId)
  if (at < 0) return null
  const free = Boolean(state?.architects?.[stationId]?.available) && at === 0
  return { free, position: at + 1, text: free ? WORDS.architectFree : WORDS.queuePosition(at + 1), entry: list[at] }
}
