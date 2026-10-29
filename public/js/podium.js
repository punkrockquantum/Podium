/** The podium graphic: 2nd left, 1st centre and highest, 3rd right, in team colours with points. */
import { el } from "./ui.js"
import { podium } from "./report.js"

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd" }

export function podiumGraphic(race) {
  const steps = podium(race).map((s) => {
    const res = race.results.find((r) => r.id === s.id)
    return el("div", { class: `podium-step p${s.place}`, "data-team": s.id },
      el("div", { class: "podium-name" }, el("i", { style: `background:${s.color}` }), s.name),
      el("div", { class: "podium-points" }, `${s.score} pts`),
      el("div", { class: "podium-block", style: `background:${s.color}` },
        el("b", {}, ORDINAL[s.place]),
        el("span", {}, `Finished P${res?.position ?? "–"}`)))
  })
  return el("div", { class: "panel wide podium-panel", id: "podium" }, el("h2", {}, "Podium 2027 champions"), el("div", { class: "podium" }, steps),
    el("p", { class: "small muted", style: "text-align:center" }, "Championship points: approved table points + race points × 4 − FIA penalties."))
}
