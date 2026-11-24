/**
 * The finale graphic: the two cars after 56 laps, the customer's 2027 plan against today's Hinwil
 * setup, with the gap in seconds and the one-line explanation of where it came from.
 */
import { el } from "./ui.js"
import { finaleSummary } from "./report.js"
import { FINALE } from "./catalog.js"

export function finaleGraphic(race) {
  const finale = finaleSummary(race)
  const { plan, today } = finale
  if (!plan || !today) return el("div", { class: "panel wide finale-panel", id: "finale" }, el("p", { class: "muted" }, finale.text))
  const cars = [plan, today].sort((a, b) => a.position - b.position)
  const steps = cars.map((car) => {
    const winner = car.position === 1
    return el("div", { class: `finale-car p${car.position}${car === plan ? " plan" : " today"}`, "data-car": car.id, style: `--c:${car.color}` },
      el("div", { class: "finale-name" }, el("i", { style: `background:${car.color}` }), car.name),
      el("div", { class: "finale-block", style: `background:${car.color}` },
        el("b", {}, `P${car.position}`),
        el("span", {}, winner ? `${finale.laps} laps` : `+${Math.abs(finale.gap).toFixed(1)} s`)),
      el("div", { class: "finale-pace" }, `${(car.found || 0).toFixed(2)} s per lap found`))
  })
  return el("div", { class: "panel wide finale-panel", id: "finale" },
    el("h2", {}, `${FINALE.race} · after ${finale.laps} laps`),
    el("div", { class: "finale-cars" }, steps),
    el("p", { class: "finale-line", id: "finaleLine" }, finale.text))
}
