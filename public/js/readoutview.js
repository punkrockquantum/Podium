/** One team's readout as a single, screenshot-friendly card (race page, projector, demo mode). */
import { el, WORDS } from "./ui.js"
import { boardThumb } from "./board.js"

const ordinal = (n) => (n ? `P${n}` : "—")

export function readoutCard(readout, { compact = false } = {}) {
  const { team, result } = readout
  const incidents = compact ? readout.incidents.slice(0, 4) : readout.incidents.slice(0, 8)
  return el("div", { class: `readout${compact ? " compact" : ""}`, id: `readout-${team.id}`, "data-team": team.id, style: `--team:${team.color}` },
    el("header", { class: "readout-head" },
      el("i", { style: `background:${team.color}` }),
      el("div", {}, el("h2", {}, team.name), el("span", { class: "muted small" }, `${readout.boards.filter((b) => b.raced === "approved").length} of ${readout.boards.length} boards approved`)),
      el("div", { class: "readout-result" },
        el("div", { class: "readout-seconds" }, el("b", {}, `${result.seconds.toFixed(2)} s`), el("span", {}, "found per lap")),
        el("div", {}, el("b", {}, ordinal(result.position)), el("span", {}, `race of ${result.of}`)),
        el("div", {}, el("b", {}, ordinal(result.championship)), el("span", {}, "championship")),
        el("div", {}, el("b", {}, result.points), el("span", {}, "points")))),
    el("p", { class: "readout-summary", id: `summary-${team.id}` }, readout.summary),
    el("p", { class: "small muted readout-points" }, `${result.tablePoints} table points + ${result.racePoints} race points × 4${result.penaltyPoints ? ` − ${result.penaltyPoints} FIA penalty points` : ""}.`),
    el("div", { class: "thumbs", id: `thumbs-${team.id}` }, readout.boards.map(boardThumb)),
    readout.boards.some((b) => b.raced === "today") ? el("p", { class: "small muted" }, `Grey boards were not approved, so they raced on ${WORDS.todaySetup.toLowerCase()}.`) : null,
    el("div", { class: "readout-cols" },
      el("section", { class: "went-well" }, el("h3", {}, "What went well"), el("ul", {}, readout.wentWell.map((line) => el("li", {}, line)))),
      el("section", { class: "could-do" }, el("h3", {}, "What you could have done differently"), el("ul", {}, readout.couldDo.map((tip) => el("li", {}, tip.text))))),
    el("section", { class: "readout-incidents" }, el("h3", {}, "Race incidents"),
      incidents.length ? el("ul", {}, incidents.map((e) => el("li", { class: `ev ${e.kind}` }, `${e.lap ? `L${e.lap} · ` : ""}${e.text}`))) : el("p", { class: "muted small" }, "A quiet race: nothing went wrong.")))
}
