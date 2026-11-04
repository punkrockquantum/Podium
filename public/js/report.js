/**
 * The per-team readout after the race: the result, the lessons the team achieved, what to do
 * differently (naming the dial, the better setting, why, and the provider's role), the race
 * incidents and a thumbnail of every board the race used. Pure: the race screen, the host and the
 * tests share it.
 */
import * as C from "./catalog.js"
import { boardFor, choicesOf, pickedOption } from "./model.js"

const stationOf = (id) => C.byId(C.STATIONS, id)

/** The top three of the championship, in podium order: 2nd (left), 1st (centre), 3rd (right). */
export function podium(race) {
  const top = (race?.standings || []).slice(0, 3).map((s, i) => ({ ...s, place: i + 1 }))
  return [top[1], top[0], top[2]].filter(Boolean)
}

const isApproved = (team, id) => team?.reviews?.[id]?.status === "approved"

/** The best single-dial change on one board: in the zone first, then the highest FIT. */
function bestChange(stationId, choices, budget) {
  const now = boardFor(stationId, choices, budget)
  let best = null
  for (const d of C.decisionsFor(stationId)) {
    const current = pickedOption(d.id, choices)
    for (const option of d.options) {
      if (option.id === current.id) continue
      const alt = boardFor(stationId, { ...choices, [d.id]: option.id }, budget)
      const rank = (alt.inZone ? 1000 : 0) + alt.fit
      if (alt.fit > now.fit && (!best || rank > best.rank)) best = { decision: d, current, option, board: alt, rank }
    }
  }
  return best ? { ...best, gain: best.board.fit - now.fit } : null
}

/** 2–3 suggestions: each names the dial, the better setting and why, and quotes the provider's role. */
export function suggestionsFor(team, stationIds = C.STATIONS.map((s) => s.id), budget = C.DEFAULT_BUDGET) {
  const choices = choicesOf(team)
  const tips = []
  for (const id of stationIds) {
    const station = stationOf(id)
    const own = boardFor(id, choices, budget)
    const approved = isApproved(team, id)
    if (!approved && own.inZone) {
      tips.push({ station: id, decision: null, better: null, gain: 100, text: `${station.name}: your board was in the zone (${own.seconds.toFixed(2)} s per lap, FIT ${own.fit}) but not approved, so it raced on the customer's existing setup and found 0.00 s. Lock in and pitch earlier.` })
      continue
    }
    const change = bestChange(id, choices, budget)
    if (!change) continue
    if (own.inZone && change.gain < 3) continue
    const prefix = approved ? "" : "Not approved, so it raced on the customer's existing setup. "
    tips.push({
      station: id,
      decision: change.decision.id,
      better: change.option.id,
      gain: change.gain + (approved ? 0 : 20) + (own.inZone ? 0 : 30),
      text: `${station.name} · ${change.decision.name}: ${change.option.name} instead of ${change.current.name} (${own.seconds.toFixed(2)} → ${change.board.seconds.toFixed(2)} s per lap, FIT ${own.fit} → ${change.board.fit}). ${prefix}${change.decision.why} How a provider helps: ${change.decision.how}`,
    })
  }
  tips.sort((a, b) => b.gain - a.gain)
  const out = tips.slice(0, 3)
  if (out.length < 2) out.push({ station: null, decision: null, better: null, gain: 0, text: "Pitch earlier: an approved board with time to spare leaves room to tune further if you are sent back." })
  if (out.length < 2) out.push({ station: null, decision: null, better: null, gain: 0, text: "Every board was in the zone: next time, look for the setting that leaves the most budget spare." })
  return out
}

const GOOD_INCIDENT = {
  fibreSafe: "The satellite backup kept you online through the fibre cut.",
  heatSafe: "Your cooling and 85% power cap kept you stable in the heat spike.",
  cache: "Your flash cache answered what-ifs instantly and brought the stop forward.",
  edge: "Your garage edge cache kept telemetry flowing through a link blip.",
  node: "4-hour support had a failed node back before the race.",
}

/** The lessons achieved: every approved board in the zone, then good moments from the race. */
export function positivesFor(team, row, race, stationIds = C.STATIONS.map((s) => s.id), budget = C.DEFAULT_BUDGET) {
  const choices = choicesOf(team)
  const out = []
  const lessons = stationIds.map((id) => ({ id, board: boardFor(id, choices, budget) })).filter((x) => isApproved(team, x.id) && x.board.inZone).sort((a, b) => b.board.fit - a.board.fit)
  for (const { id, board } of lessons.slice(0, 3)) out.push(`${stationOf(id).name} in the zone (${board.seconds.toFixed(2)} s per lap, FIT ${board.fit}): ${stationOf(id).lesson.why}`)
  for (const inc of row?.incidents || []) {
    if (out.length >= 3) break
    const text = inc.good ? GOOD_INCIDENT[inc.id] : null
    if (text && !out.includes(text)) out.push(text)
  }
  const approved = stationIds.filter((id) => isApproved(team, id))
  if (out.length < 2 && approved.length) out.push(`${approved.length} of ${stationIds.length} boards approved by their Architects.`)
  if (out.length < 3 && row?.underSC) out.push("Your pit wall reacted to the Safety Car and pitted cheaply.")
  if (out.length < 3 && row && !row.caught.length) out.push("A clean FIA audit: no penalty points.")
  if (out.length < 2 && row?.position && row.position < row.grid) out.push(`Gained ${row.grid - row.position} place${row.grid - row.position === 1 ? "" : "s"} from the grid.`)
  if (out.length < 2 && row) out.push(`Finished the race in P${row.position} of ${race.results.length}.`)
  if (out.length < 2) out.push("You took part in every phase of the session.")
  return out.slice(0, 3)
}

/** The race incidents and FIA penalties that touched this team, in lap order. */
export function incidentsFor(teamId, race) {
  return (race?.events || []).filter((e) => e.team === teamId && ["bad", "good", "penalty"].includes(e.kind)).map((e) => ({ lap: e.lap, kind: e.kind, text: e.text, lesson: e.lesson || null, station: e.station || null }))
}

/** The board the race used for each table: the approved one, or the customer's existing setup. */
export function racedBoards(team, stationIds = C.STATIONS.map((s) => s.id), budget = C.DEFAULT_BUDGET) {
  const choices = choicesOf(team)
  return stationIds.map((id) => {
    const approved = isApproved(team, id)
    const board = boardFor(id, approved ? choices : C.BASELINE_CHOICES, budget)
    return { station: id, name: stationOf(id).name, color: stationOf(id).color, approved, choices: board.choices, board, seconds: board.seconds, allowed: board.allowed, fit: board.fit, status: board.status, inZone: board.inZone, raced: approved ? "approved" : "today", targets: board.targets.map((t) => ({ name: t.name, display: t.display, ok: t.ok })) }
  })
}

/** The full readout for one team. */
export function readoutFor(team, race, stationIds = C.STATIONS.map((s) => s.id), budget = C.DEFAULT_BUDGET) {
  const row = race.results.find((r) => r.id === team.id)
  const champ = race.standings.findIndex((s) => s.id === team.id) + 1
  const boards = racedBoards(team, stationIds, budget)
  const seconds = Number.isFinite(row?.found) ? row.found : Math.round(boards.reduce((sum, b) => sum + b.seconds, 0) * 100) / 100
  const said = row ? `P${row.position} of ${race.results.length}${row.position === 1 ? ", a win" : ""} and ${row.score} points` : "no result"
  return {
    team: { id: team.id, name: team.name, color: team.color },
    summary: `You found ${seconds.toFixed(2)} s per lap; the race said ${said}.`,
    result: { seconds, position: row?.position ?? null, of: race.results.length, championship: champ || null, points: row?.score ?? 0, racePoints: row?.racePoints ?? 0, tablePoints: row?.pitch ?? 0, penaltyPoints: row?.penaltyPoints ?? 0 },
    boards,
    wentWell: positivesFor(team, row, race, stationIds, budget),
    couldDo: suggestionsFor(team, stationIds, budget),
    incidents: incidentsFor(team.id, race),
  }
}
