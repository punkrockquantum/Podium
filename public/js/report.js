/**
 * The race report: the podium and, per team, 1–3 things they could have done differently. Pure:
 * the race screen renders it and the tests check it.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam, pickedOption } from "./model.js"
import { simulateStation, PENALTY_STATION } from "./sim.js"

const MAX_SUGGESTIONS = 3
const MIN_GAIN = 3

const stationName = (id) => C.STATIONS.find((s) => s.id === id)?.name || id

/** The top three of the championship, in podium order: 2nd (left), 1st (centre), 3rd (right). */
export function podium(race) {
  const top = (race?.standings || []).slice(0, 3).map((s, i) => ({ ...s, place: i + 1 }))
  return [top[1], top[0], top[2]].filter(Boolean)
}

/** The single change at the team's approved tables that would raise one table's simulation most. */
export function bestAlternative(team, stationIds, opts = {}) {
  const eff = effectiveTeam(team, stationIds)
  const ev = evaluate(eff, opts)
  let best = null
  for (const stationId of eff.approved) {
    const base = simulateStation(eff, opts, stationId, ev).score
    for (const d of C.visibleDecisions(stationId)) {
      const current = ev.choices[d.id]
      const candidates = d.options ? d.options.map((o) => o.id) : d.values
      for (const value of candidates) {
        if (value === current) continue
        const trial = { ...eff, choices: { ...eff.choices, [d.id]: value } }
        const gain = simulateStation(trial, opts, stationId).score - base
        if (gain >= MIN_GAIN && (!best || gain > best.gain)) best = { stationId, decision: d, value, current, gain }
      }
    }
  }
  if (!best) return null
  const pick = (value) => (best.decision.options ? best.decision.options.find((o) => o.id === value) : null)
  const better = pick(best.value)
  const now = pick(best.current) || pickedOption(best.decision.id, ev.choices)
  const unit = best.decision.unit ? ` ${best.decision.unit}` : ""
  const betterName = better ? better.name : `${best.value}${unit}`
  const nowName = now ? now.name : `${best.current}${unit}`
  return {
    ...best,
    text: `${stationName(best.stationId)}: ${betterName} instead of ${nowName} (${best.decision.name.toLowerCase()}) would have scored ${best.gain} more on the simulation.${better?.why ? ` ${better.why}` : ""}`,
  }
}

/**
 * 1–3 suggestions for one team: tables not approved or missed, FIA penalties, incidents that cost
 * places, then the best single choice to change. `team` is the team as stored in the game state.
 */
export function suggestionsFor(team, result, stationIds = C.STATIONS.map((s) => s.id), opts = {}) {
  const out = []
  const eff = effectiveTeam(team, stationIds)
  const notApproved = result?.notApproved?.length ? result.notApproved : eff.notApproved
  const missed = result?.missed?.length ? result.missed : eff.missed
  if (notApproved.length) {
    out.push({ kind: "approval", text: `Get ${notApproved.map(stationName).join(", ")} approved: ${notApproved.length === 1 ? "that table" : "those tables"} scored 0 and raced on the default build. Pitch earlier, so there is time to revise if you are sent back.` })
  }
  if (missed.length) {
    out.push({ kind: "missed", text: `You never locked in ${missed.map(stationName).join(", ")}: up to ${missed.length * C.PITCH_MAX} table points left on the table, and the race used the default build there.` })
  }
  const caught = (result?.caught || []).map((id) => evaluate(eff, opts).penalties.find((p) => p.id === id)).filter(Boolean)
  if (caught.length) {
    const pen = caught.sort((a, b) => (b.points || 0) + (b.seconds || 0) - ((a.points || 0) + (a.seconds || 0)))[0]
    out.push({ kind: "penalty", text: `Avoid the FIA penalty at ${stationName(PENALTY_STATION[pen.id] || "governance")}: ${pen.text}` })
  }
  const costly = (result?.incidents || []).filter((inc) => inc.loss > 0 && inc.places < 0).sort((a, b) => a.places - b.places)[0]
  if (costly) out.push({ kind: "incident", text: `${costly.effect} on lap ${costly.lap}: ${costly.cause}. Fix it at ${stationName(costly.station)}.` })
  if (out.length < MAX_SUGGESTIONS) {
    const alt = bestAlternative(team, stationIds, opts)
    if (alt) out.push({ kind: "choice", text: alt.text })
  }
  if (!out.length) out.push({ kind: "clean", text: "A clean weekend: every table approved, no penalties and no costly incidents. Keep this design and look for more pace per dollar." })
  return out.slice(0, MAX_SUGGESTIONS)
}
