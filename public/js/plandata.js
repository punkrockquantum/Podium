/** The frozen plan a team gets when it locks in a table. Pure, so the server can build it. */
import * as C from "./catalog.js"
import { evaluate, pickedOption } from "./model.js"
import { designSummary } from "./summary.js"

export function buildPlan(team, station, { id, at }) {
  const ev = evaluate(team)
  const summary = designSummary(team, station, ev)
  const decisions = C.decisionsFor(station).map((d) => {
    const o = pickedOption(d.id, ev.choices)
    return { id: d.id, name: d.name, value: o.id, label: o.name, text: o.text }
  })
  return {
    id,
    at,
    station,
    choices: Object.fromEntries(decisions.map((d) => [d.id, d.value])),
    decisions,
    score: summary.score,
    band: summary.band,
    sentence: summary.sentence,
    parts: Object.fromEntries(summary.parts.map((p) => [p.id, p.value])),
    summary,
    ledger: { capex: ev.ledger.capex, capexLimit: ev.ledger.capexLimit, opex: ev.ledger.opex, opexLimit: ev.ledger.opexLimit, facilityKW: ev.ledger.facilityKW, fia: ev.ledger.fia },
  }
}
