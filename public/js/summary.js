/**
 * Plain-English wording shared by the SA's review, the plan page, demo mode and the readout,
 * so every screen describes a board the same way. Pure.
 */
import * as C from "./catalog.js"
import { boardFor, pickedOption } from "./model.js"

export { millions } from "./model.js"

/** "Paths to the factory: Two diverse paths. Two encrypted tunnels on two separate fibre routes." */
export function choiceSentences(choices, stationId) {
  return C.decisionsFor(stationId).map((d) => {
    const o = pickedOption(d.id, choices)
    return `${d.name}: ${o.name}. ${o.text}`
  })
}

/** One line per target: value, target and whether it is in the zone. */
export function targetLines(board) {
  return board.targets.map((t) => `${t.ok ? "✓" : "✗"} ${t.name}: ${t.display} (target ${t.zone}; today ${t.todayDisplay}).`)
}

/** One line per cap bar, plus every breach and note. */
export function capLines(board) {
  return [
    ...board.caps.map((c) => `${c.over > 0 ? "✗" : "✓"} ${c.name}: ${c.display}.`),
    ...board.breaches.filter((b) => b.kind === "fia").map((b) => `✗ ${b.text}`),
    ...board.notes,
  ]
}

/** Everything the SA needs in one block: the dials, the gauges, the caps and the FIT. */
export function designSummary(choices, stationId, budgetId) {
  const board = boardFor(stationId, choices, budgetId)
  return {
    station: stationId,
    board,
    sentences: choiceSentences(board.choices, stationId),
    targets: targetLines(board),
    caps: capLines(board),
    fit: board.fit,
    status: board.status,
    sentence: board.sentence,
    hint: board.hint,
  }
}
