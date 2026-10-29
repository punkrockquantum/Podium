/** The one-page plan a team gets when it locks in a table (station, host feed and demo mode). */
import * as C from "./catalog.js"
import { el, money, pct } from "./ui.js"

const PARTS = { performance: "Performance", cost: "Cost efficiency", compliance: "FIA compliance", resilience: "Resilience" }

/** The one-page plan. `review` is the leader's decision for this table, if any. */
export function planSheet(team, plan, { review = null, screenshotPrompt = true } = {}) {
  const station = C.byId(C.STATIONS, plan.station)
  const when = new Date(plan.at)
  const approved = review?.status === "approved"
  const points = C.tablePoints(plan.score, approved)
  const reviewText = approved ? `Approved by ${review.by}` : "Not approved yet: this table scores 0 until the leader approves it"
  return el("div", { class: "plan-sheet", id: "planSheet" },
    screenshotPrompt ? el("div", { class: "shot" }, "📸 Take a screenshot of this page now") : null,
    el("div", { class: "meta" }, el("span", {}, `Plan ${plan.id}`), el("span", {}, when.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))),
    el("h2", {}, `${team.name} · ${station?.name || plan.station}`),
    el("div", { class: "meta" }, el("span", {}, `P${team.rank} in 2026 · ${C.tierForRank(team.rank).name}`), plan.architectGain && plan.architectGain !== 1 ? el("span", {}, `Architect ×${plan.architectGain.toFixed(2)}`) : null),
    plan.summary?.sentences?.length ? el("p", { class: "plain-summary" }, plan.summary.sentences.join(" ")) : null,
    el("table", {}, el("tbody", {}, plan.decisions.map((d) => el("tr", {}, el("td", {}, d.name), el("td", {}, el("b", {}, d.label)))))),
    el("div", { class: "figs" },
      el("div", {}, el("b", {}, money(plan.table.capex)), "Table CapEx"),
      el("div", {}, el("b", {}, `${money(plan.table.opex)}/yr`), "Table OpEx"),
      el("div", {}, el("b", {}, `${Math.round(plan.team.facilityKW)} kW`), "Team facility power"),
      el("div", {}, el("b", {}, plan.table.leadWeeks ? `${plan.table.leadWeeks} wk` : "—"), "Lead time"),
      el("div", {}, el("b", {}, `${money(plan.team.capex)} / ${money(plan.team.capexRemaining)}`), "Team CapEx / envelope"),
      el("div", {}, el("b", {}, `${money(plan.team.opex)} / ${money(plan.team.opexAllowance)}`), "Team OpEx / allowance")),
    el("div", { class: "row" }, el("span", { class: "score" }, `${plan.score}%`), el("div", {}, el("b", {}, plan.band), el("div", { class: "small" }, "System score from the simulation"))),
    el("table", {}, el("tbody", {}, Object.entries(PARTS).map(([id, name]) => el("tr", {}, el("td", {}, name), el("td", {}, el("b", {}, pct(plan.parts[id]))))))),
    el("div", { class: "meta" },
      el("span", {}, reviewText),
      el("span", {}, `Table points: ${points} / ${C.PITCH_MAX}`)),
  )
}

/** Plain-English summary block: what they chose, what it means, the score (host leader panel, race report). */
export function summaryBlock(summary, { compact = false } = {}) {
  return el("div", { class: "summary-block" },
    el("p", { class: "plain-summary" }, summary.sentences.join(" ")),
    compact ? null : el("ul", { class: "consequences" }, summary.consequences.map((line) => el("li", {}, line))),
    summary.watch?.length && !compact ? el("ul", { class: "watch" }, summary.watch.map((line) => el("li", {}, line))) : null,
    el("div", { class: "score-line" }, el("b", {}, `${summary.score}%`), ` ${summary.band}. `, summary.parts.map((p) => `${p.name} ${pct(p.value)}`).join(" · ")))
}

/** "Leader is free: go and pitch now" or "Queue position N: see the session host to book your slot". */
export function queueStatus(state, teamId, stationId) {
  const list = state?.queues?.[stationId] || []
  const at = list.findIndex((entry) => entry.team === teamId)
  if (at < 0) return null
  const leader = state?.leaders?.[stationId]
  const entry = list[at]
  if (leader?.available && at === 0) return { free: true, position: 1, text: "Leader is free: go and pitch now", entry }
  const slot = entry.slot ? ` Your slot: ${entry.slot}${entry.confirmed ? " (confirmed)" : ""}.` : ""
  return { free: false, position: at + 1, text: `Queue position ${at + 1}: see the session host to book your slot.${slot}`, entry }
}
