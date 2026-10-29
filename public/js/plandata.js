/** Plan snapshot taken at lock-in: pure, shared by the server and host demo mode. */
import { visibleDecisions } from "./catalog.js"
import { evaluate, pickedOption } from "./model.js"
import { simulateStation } from "./sim.js"
import { tableFigures, designSummary } from "./summary.js"

export { tableFigures }

export function buildPlan(team, station, opts, { id, at }) {
  const ev = evaluate(team, opts)
  const sim = simulateStation(team, opts, station, ev)
  const summary = designSummary(team, station, opts, ev)
  const decisions = visibleDecisions(station).map((d) => {
    const value = ev.choices[d.id]
    const option = d.options ? pickedOption(d.id, ev.choices) : null
    return { id: d.id, name: d.name, value, label: option ? option.name : `${value}${d.unit ? ` ${value === 1 ? d.unit.replace(/s$/, "") : d.unit}` : ""}` }
  })
  return {
    id,
    at,
    station,
    score: sim.score,
    band: sim.band,
    parts: sim.parts,
    hints: sim.hints,
    decisions,
    summary: { sentences: summary.sentences, consequences: summary.consequences },
    table: tableFigures(ev, station),
    team: { capex: ev.ledger.capex, capexRemaining: ev.ledger.capexRemaining, opex: ev.ledger.opex, opexAllowance: ev.ledger.opexAllowance, facilityKW: ev.power.facilityKW, payment: ev.commercial.aas || ev.commercial.payment },
    architectGain: team.architect?.enabled ? team.architect.gain : 1,
  }
}
