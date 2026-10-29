/**
 * The per-team readout after the race: the result, what went well, what to do differently (each
 * naming the better option and why) and the race incidents that touched the team. Pure: the race
 * screen, the host and the tests share it.
 */
import * as C from "./catalog.js"
import { evaluate, effectiveTeam, pickedOption } from "./model.js"
import { simulateStation } from "./sim.js"

const stationName = (id) => C.byId(C.STATIONS, id)?.name || id

/** The top three of the championship, in podium order: 2nd (left), 1st (centre), 3rd (right). */
export function podium(race) {
  const top = (race?.standings || []).slice(0, 3).map((s, i) => ({ ...s, place: i + 1 }))
  return [top[1], top[0], top[2]].filter(Boolean)
}

/** Every single-option change on the raced design, best first, scored by the table it improves. */
function betterOptions(raced, stationIds) {
  const ev = evaluate(raced)
  const base = Object.fromEntries(stationIds.map((id) => [id, simulateStation(raced, id, ev).score]))
  const out = []
  for (const id of stationIds) {
    for (const d of C.decisionsFor(id)) {
      const current = pickedOption(d.id, ev.choices)
      for (const option of d.options) {
        if (option.id === current.id) continue
        const alt = { ...raced, choices: { ...ev.choices, [d.id]: option.id } }
        const altEv = evaluate(alt)
        const gain = stationIds.reduce((sum, s) => sum + simulateStation(alt, s, altEv).score - base[s], 0)
        if (gain >= 2) out.push({ station: id, decision: d, current, option, gain })
      }
    }
  }
  return out.sort((a, b) => b.gain - a.gain)
}

/** 2–3 suggestions, at most one per decision and preferring different tables. */
export function suggestionsFor(team, stationIds = C.STATIONS.map((s) => s.id)) {
  const raced = effectiveTeam(team, stationIds)
  const candidates = betterOptions(raced, stationIds)
  const picked = []
  const used = new Set()
  for (const pass of [true, false]) {
    for (const c of candidates) {
      if (picked.length >= 3) break
      if (picked.some((p) => p.decision.id === c.decision.id)) continue
      if (pass && used.has(c.station)) continue
      picked.push(c)
      used.add(c.station)
    }
  }
  const unapproved = new Set([...raced.missed, ...raced.notApproved])
  const tips = picked.map((c) => ({
    station: c.station,
    decision: c.decision.id,
    better: c.option.id,
    gain: c.gain,
    text: `${stationName(c.station)}, ${c.decision.name}: ${c.option.name} instead of ${c.current.name}. ${c.option.why}${unapproved.has(c.station) ? " This table was not approved, so it raced on its defaults." : ""}`,
  }))
  for (const id of unapproved) {
    if (tips.length >= 2) break
    if (tips.some((t) => t.station === id)) continue
    tips.push({ station: id, decision: null, better: null, gain: 0, text: `${stationName(id)}: get the design approved. Unapproved tables score 0 and race on their defaults.` })
  }
  if (tips.length < 2) tips.push({ station: null, decision: null, better: null, gain: 0, text: "Pitch earlier: an approved design with time to spare leaves room to revise if you are sent back." })
  return tips.slice(0, 3)
}

const GOOD_INCIDENT = {
  fibreSafe: "The satellite backup kept you online through the fibre cut.",
  heatSafe: "Your cooling and 85% power cap kept you stable in the heat spike.",
  cache: "Your flash cache answered what-ifs instantly and brought the stop forward.",
  edge: "Your garage edge cache kept telemetry flowing through a link blip.",
  node: "4-hour support had a failed node back before the race.",
}

/** 2–3 specific positives. */
export function positivesFor(team, row, race, stationIds) {
  const out = []
  const raced = effectiveTeam(team, stationIds)
  const ev = evaluate(raced)
  const scores = stationIds.map((id) => ({ id, score: simulateStation(raced, id, ev).score })).sort((a, b) => b.score - a.score)
  const approved = scores.filter((s) => raced.approved.includes(s.id))
  const best = approved[0]
  if (best && best.score >= 80) out.push(`${stationName(best.id)} was approved at ${best.score}%: Optimised.`)
  else if (approved.length) out.push(`${approved.length} of ${stationIds.length} tables approved by their Architects.`)
  for (const inc of row?.incidents || []) {
    if (out.length >= 3) break
    const text = inc.good ? GOOD_INCIDENT[inc.id] : null
    if (text && !out.includes(text)) out.push(text)
  }
  if (out.length < 3 && row?.underSC) out.push("Your strategy model reacted to the Safety Car and pitted cheaply.")
  if (out.length < 3 && row && !row.caught.length) out.push("A clean FIA audit: no penalty points.")
  if (out.length < 3 && row?.position && row.position < row.grid) out.push(`Gained ${row.grid - row.position} place${row.grid - row.position === 1 ? "" : "s"} from the grid.`)
  if (out.length < 2 && approved[1]) out.push(`${stationName(approved[1].id)} was approved at ${approved[1].score}%.`)
  if (out.length < 2 && row) out.push(`Finished the race in P${row.position} of ${race.results.length}.`)
  if (out.length < 2) out.push(`Strongest table: ${stationName(scores[0].id)} at ${scores[0].score}%.`)
  return out.slice(0, 3)
}

/** The race incidents and FIA penalties that touched this team, in lap order. */
export function incidentsFor(teamId, race) {
  return (race?.events || []).filter((e) => e.team === teamId && ["bad", "good", "penalty"].includes(e.kind)).map((e) => ({ lap: e.lap, kind: e.kind, text: e.text, lesson: e.lesson || null }))
}

/** The full readout for one team. */
export function readoutFor(team, race, stationIds = C.STATIONS.map((s) => s.id)) {
  const row = race.results.find((r) => r.id === team.id)
  const champ = race.standings.findIndex((s) => s.id === team.id) + 1
  return {
    team: { id: team.id, name: team.name, color: team.color, tier: C.tierFor(team).label },
    result: { position: row?.position ?? null, of: race.results.length, championship: champ || null, points: row?.score ?? 0, racePoints: row?.racePoints ?? 0, tablePoints: row?.pitch ?? 0, penaltyPoints: row?.penaltyPoints ?? 0 },
    wentWell: positivesFor(team, row, race, stationIds),
    couldDo: suggestionsFor(team, stationIds),
    incidents: incidentsFor(team.id, race),
  }
}
