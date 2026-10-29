/**
 * Plain-English wording shared by the Architect's review, the plan sheet, demo mode and the readout,
 * so every screen describes a design the same way. Pure.
 */
import * as C from "./catalog.js"
import { evaluate, pickedOption } from "./model.js"
import { simulateStation, PART_NAMES } from "./sim.js"

export const millions = (value) => `$${(value / 1e6).toFixed(1)}M`

/** "Factory link: Redundant tunnels. Two encrypted tunnels on two separate fibre paths." */
export function choiceSentences(ev, stationId) {
  return C.decisionsFor(stationId).map((d) => {
    const o = pickedOption(d.id, ev.choices)
    return `${d.name}: ${o.name}. ${o.text}`
  })
}

/** What the design means for the customer: money, power, FIA and the race. */
export function consequences(ev, stationId) {
  const L = ev.ledger
  const out = []
  if (stationId === "network") {
    out.push(`${ev.network.latencyMs} ms from the data centre to the factory${ev.network.latencyMs > 100 ? ": slow strategy calls" : ""}.`)
    out.push(ev.network.satellite ? "Survives a cut fibre with no loss." : ev.network.redundant ? "A cut fibre fails over to the second tunnel." : "A cut fibre blinds the pit wall.")
  } else if (stationId === "oem") {
    out.push(`Hardware ${millions(ev.hardware)}, paid by ${ev.payment === "buy" ? "buying (CapEx)" : ev.payment === "lease" ? "leasing (OpEx)" : "as-a-service (OpEx)"}.`)
    if (ev.choices.payment === "aas" && ev.payment !== "aas") out.push("This vendor has no as-a-service programme, so it is a lease.")
    out.push(`A failed node: ${{ basic: "down all weekend", nbd: "back on Monday, after the race", "4h": "back within four hours" }[ev.choices.support]}.`)
  } else if (stationId === "dc") {
    out.push(`${Math.round(L.facilityKW)} kW at PUE ${ev.power.pue.toFixed(2)}${ev.power.thermal < 1 ? ": the cooling throttles these chips" : ""}${ev.power.roomFit < 1 ? "; the site cannot supply it all" : ""}.`)
    out.push(`Adds ${{ factory: 0, colo: 2, cheap: 40 }[ev.choices.location]} ms to every strategy call.`)
  } else if (stationId === "compute") {
    out.push(`Uses ${Math.round(ev.aero.utilisation * 100)}% of the ${ev.tier.name} compute allowance (${Math.round(ev.tier.compute * 100)}%).`)
    out.push(`Strategy model ${ev.strategy >= 0.9 ? "strong" : ev.strategy >= 0.7 ? "good" : "weak"} (${Math.round(Math.min(1, ev.strategy) * 100)}%).`)
  }
  out.push(`Team ledger: CapEx ${millions(L.capex)} of ${millions(L.capexLimit)}, OpEx ${millions(L.opex)} of ${millions(L.opexLimit)} a year, FIA risk ${L.fia}.`)
  const fia = ev.penalties.filter((p) => p.station === stationId)
  for (const p of fia) out.push(`FIA: ${p.text}`)
  return out
}

/** Everything the Architect needs in one block: the choices, the consequences and the score. */
export function designSummary(team, stationId, ev = evaluate(team)) {
  const sim = simulateStation(team, stationId, ev)
  return {
    station: stationId,
    sentences: choiceSentences(ev, stationId),
    consequences: consequences(ev, stationId),
    score: sim.score,
    band: sim.band,
    sentence: sim.sentence,
    hint: sim.hint,
    parts: Object.entries(PART_NAMES).map(([id, name]) => ({ id, name, value: sim.parts[id] })),
  }
}
