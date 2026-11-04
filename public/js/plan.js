/** The board snapshot a team gets when it locks in a table (station, host and demo mode). */
import * as C from "./catalog.js"
import { createBoard, miniFit, STATUS_WORD } from "./board.js"
import { el, WORDS } from "./ui.js"

/** The frozen board, read-only: the same gauges and bars the team tuned. */
export function frozenBoard(plan, opts = {}) {
  const view = createBoard({ stationId: plan.station, budget: plan.budget, interactive: false, showProblem: false, ...opts })
  view.update(plan.choices, { locked: true, board: plan.board })
  return view.el
}

/** The one-page plan. `review` is the Architect's decision for this table, if any. */
export function planSheet(team, plan, { review = null, screenshotPrompt = true } = {}) {
  const station = C.byId(C.STATIONS, plan.station)
  const approved = review?.status === "approved"
  return el("div", { class: "plan-sheet", id: "planSheet" },
    screenshotPrompt ? el("div", { class: "shot" }, `📸 ${WORDS.screenshot}`) : null,
    el("div", { class: "meta" }, el("span", {}, `Plan ${plan.id}`), el("span", {}, `${C.budgetFor(plan.budget).name} budget`), el("span", {}, new Date(plan.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))),
    el("div", { class: "row plan-head" }, miniFit(plan.fit, { status: plan.status, size: 56 }),
      el("div", {}, el("h2", {}, `${team.name} · ${station?.name || plan.station}`), el("b", {}, `${WORDS.fit} ${plan.fit} · ${STATUS_WORD[plan.status]}`), el("div", { class: "small" }, plan.sentence))),
    el("table", {}, el("tbody", {}, plan.decisions.map((d) => el("tr", {}, el("td", {}, d.name), el("td", {}, el("b", {}, d.label), el("div", { class: "small" }, d.text)))))),
    frozenBoard(plan, { showDials: false, id: null }),
    el("div", { class: "meta" },
      el("span", {}, approved ? `Approved by ${review.by}` : `Not approved yet: until the Architect approves it, this table races on ${WORDS.todaySetup.toLowerCase()}`),
      el("span", {}, `Table points: ${C.tablePoints(plan.fit, approved)} / ${C.PITCH_MAX}`)))
}

/** Plain-English summary block for the Architect: the dials, the gauges, the caps and the FIT. */
export function summaryBlock(summary) {
  return el("div", { class: "summary-block" },
    el("ul", { class: "choices-list" }, summary.sentences.map((line) => el("li", {}, line))),
    el("ul", { class: "consequences" }, [...summary.targets, ...summary.caps].map((line) => el("li", {}, line))),
    el("div", { class: "score-line" }, el("b", {}, `${WORDS.fit} ${summary.fit}`), ` ${STATUS_WORD[summary.status]}. ${summary.sentence}`))
}

/** "Your Architect is free: go and pitch now" or "Queue position N". */
export function queueStatus(state, teamId, stationId) {
  const list = state?.queues?.[stationId] || []
  const at = list.findIndex((entry) => entry.team === teamId)
  if (at < 0) return null
  const free = Boolean(state?.architects?.[stationId]?.available) && at === 0
  return { free, position: at + 1, text: free ? WORDS.architectFree : WORDS.queuePosition(at + 1), entry: list[at] }
}
