/**
 * Renders a table's brief (briefs.js) for the iPad, the SA's screen and demo mode. With `withEnd`
 * it appends the #briefEnd sentinel the brief gate watches: reaching it opens "I've read the brief".
 */
import * as C from "./catalog.js"
import { briefFor } from "./briefs.js"
import { el } from "./ui.js"

const list = (items) => el("ul", {}, items.map((text) => el("li", {}, text)))
const section = (title, ...body) => el("section", { class: "brief-section" }, el("h3", {}, title), ...body)

export function briefView(stationId, { withEnd = false, compact = false } = {}) {
  const station = C.byId(C.STATIONS, stationId)
  const b = briefFor(stationId)
  if (!station || !b) return el("div", { class: "brief" }, el("p", { class: "muted" }, "There is no brief for this table."))
  return el("article", { class: `brief${compact ? " compact" : ""}`, "data-station": stationId },
    el("header", { class: "brief-head" },
      el("span", { class: "problem-tag" }, `Brief · ${station.name}`),
      el("h2", {}, b.title),
      el("p", { class: "brief-problem" }, station.problem)),
    section("The situation", b.situation.map((p) => el("p", {}, p))),
    section("What the team wants", list(b.wants)),
    section("The rules", list(b.rules), el("p", { class: "small muted" }, "The host's budget level moves this table's cap lines: Tight is 15% lower, Generous 25% higher.")),
    section("Your three decisions", b.decisions.map((d, i) => el("div", { class: "brief-decision" },
      el("h4", {}, `${i + 1}. ${d.name}`),
      el("p", {}, d.what),
      list(d.settings),
      el("p", { class: "brief-balance" }, el("b", {}, "The balance: "), d.balance)))),
    section("How a provider helps", b.provider.map((p) => el("p", {}, p))),
    section("Words to know", el("dl", { class: "brief-words" }, b.words.flatMap((x) => [el("dt", {}, x.term), el("dd", {}, x.gloss)]))),
    withEnd ? el("div", { id: "briefEnd", class: "brief-end" }, el("p", { class: "small muted" }, "That is the whole brief. Decide as a team, then open the decisions below.")) : null)
}
