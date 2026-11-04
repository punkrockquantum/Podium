/** The frozen board a team gets when it locks in a table. Pure, so the server can build it. */
import * as C from "./catalog.js"
import { boardFor, choicesOf, pickedOption } from "./model.js"

export function buildPlan(team, station, { id, at, budget = C.DEFAULT_BUDGET }) {
  const board = boardFor(station, choicesOf(team), budget)
  const decisions = C.decisionsFor(station).map((d) => {
    const o = pickedOption(d.id, board.choices)
    return { id: d.id, name: d.name, value: o.id, label: o.name, text: o.text }
  })
  return {
    id,
    at,
    station,
    budget: board.budget,
    choices: { ...board.choices },
    decisions,
    fit: board.fit,
    status: board.status,
    inZone: board.inZone,
    sentence: board.sentence,
    seconds: board.seconds,
    allowed: board.allowed,
    outcome: board.outcome,
    board,
  }
}
