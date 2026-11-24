/**
 * The customer's readout after the race: the result of the 2027 plan against today's Hinwil setup,
 * the lessons achieved, what to do differently (naming the dial, the better setting, why, and the
 * provider's role), the race incidents and a thumbnail of every board the race used. Pure: the
 * race screen, the host and the tests share it.
 */
import * as C from "./catalog.js"
import { boardFor, choicesOf, pickedOption } from "./model.js"
import { attemptWord } from "./approval.js"
import { FIGURES as F } from "./customer.js"

const stationOf = (id) => C.byId(C.STATIONS, id)

/**
 * One line on the 2028 path: does the board the race used still work in 2028, when GPUs may run the
 * solver (FIA F4.4.1, from 1 January 2028)? A Hinwil or remote site must carry what the estate would
 * draw there (F.load.it2028KW); the campus hosts the GPU step-up inside its 500 kW offer
 * (F.load.it2028CampusKW) — there is no expansion right, ZUR4 is a separate conversation.
 */
export function path2028For(team, stationIds = C.STATIONS.map((s) => s.id)) {
  const choices = choicesOf(team)
  const pick = (id) => (isApproved(team, id) ? choices : C.BASELINE_CHOICES)
  const parts = []
  if (stationIds.includes("dc")) {
    const site = pickedOption("location", pick("dc"))
    const cooling = pickedOption("cooling", pick("dc"))
    const roomKW = site.siteKW
    const liquid = cooling.id === "liquid"
    const coolingNote = liquid ? " and direct-to-chip cooling is already in" : ", but 2028 GPUs want direct-to-chip cooling"
    if (site.id === "colo") parts.push(`${site.name}: the 2028 GPU step-up stays inside the ${roomKW} kW commitment (≈ ${F.load.it2028CampusKW} kW; more kW is a separate ZUR4 conversation, not a right)${coolingNote}`)
    else if (roomKW >= F.load.it2028KW) parts.push(`${site.name} carries the ${F.load.it2028KW} kW the estate would draw in 2028${coolingNote}`)
    else parts.push(`${site.name} tops out at ${roomKW} kW, short of the ${F.load.it2028KW} kW the estate would draw in 2028: a second site or a new hall`)
  }
  if (stationIds.includes("compute")) {
    const chips = pickedOption("chips", pick("compute"))
    parts.push(chips.id === "cpu" ? "the CPU-only solver is legal now; plan the GPU partition for the first 2028 period" : chips.id === "mixed" ? "the GPU partition is ready for the 2028 solver rule" : "the GPU solver only becomes legal on 1 January 2028")
  }
  if (stationIds.includes("network") && pickedOption("link", pick("network")).id === "single") parts.push("a single route will not carry a doubled cluster's remote users")
  if (!parts.length) return null
  const text = parts.join("; ")
  return `2028 path: ${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

const isApproved = (team, id) => team?.reviews?.[id]?.status === "approved"

/** The two cars of the finale: the customer's 2027 plan and today's Hinwil setup (the ghost of the current site). */
export function finaleCars(race) {
  const results = race?.results || []
  const today = results.find((r) => r.id === C.FINALE_ENTRANTS.today.id) || null
  const plan = results.find((r) => r !== today) || null
  return { plan, today }
}

/** "12.3 s" with one decimal, never "-0.0 s". */
const gapText = (s) => `${Math.abs(s) < 0.05 ? "0.0" : Math.abs(s).toFixed(1)} s`

/**
 * The finale in one line: after 56 laps, how far the 2027 plan finished ahead of (or behind)
 * today's Hinwil setup, in seconds and in places, and where the gap came from: the seconds per lap
 * found at the approved tables, the pit stop and the incidents.
 */
export function finaleSummary(race) {
  const { plan, today } = finaleCars(race)
  if (!plan || !today) return { plan, today, gap: 0, ahead: false, perLap: 0, laps: race?.laps || C.FINALE.laps, text: "The race has not run." }
  const gap = Math.round((today.total - plan.total) * 10) / 10
  const ahead = gap > 0
  const perLap = Number.isFinite(plan.found) ? plan.found : 0
  const laps = race.laps || C.FINALE.laps
  const places = `P${plan.position} to P${today.position}`
  const tables = Object.keys(plan.fit || {}).length || C.STATIONS.length
  const approvedCount = Math.max(0, tables - (plan.missed?.length || 0) - (plan.notApproved?.length || 0))
  const incidents = (plan.incidents || []).filter((i) => i.loss > 0).length
  let text
  if (perLap <= 0) {
    text = `After ${laps} laps ${ahead ? `the ${C.FINALE_ENTRANTS.plan.short} finished ${gapText(gap)} ahead of today's Hinwil setup` : `today's Hinwil setup finished ${gapText(gap)} ahead of the ${C.FINALE_ENTRANTS.plan.short}`} (${places}). Nothing was approved, so both cars ran today's setup at 0.00 s per lap: the gap is the pit stop and the incidents, not the design.`
  } else if (ahead) {
    text = `After ${laps} laps the ${C.FINALE_ENTRANTS.plan.short} finished ${gapText(gap)} ahead of today's Hinwil setup (${places}): ${perLap.toFixed(2)} s per lap found at ${approvedCount} approved table${approvedCount === 1 ? "" : "s"}, over ${laps} laps, less the pit stop${incidents ? ` and ${incidents} incident${incidents === 1 ? "" : "s"}` : ""}.`
  } else {
    text = `After ${laps} laps today's Hinwil setup finished ${gapText(gap)} ahead of the ${C.FINALE_ENTRANTS.plan.short} (${places}), despite ${perLap.toFixed(2)} s per lap found at ${approvedCount} approved table${approvedCount === 1 ? "" : "s"}: the pit stop and ${incidents ? `${incidents} incident${incidents === 1 ? "" : "s"}` : "the incidents"} cost more than the design gained.`
  }
  return { plan, today, gap, ahead, perLap, laps, places, text }
}

/**
 * What happened at one table, for the readout: how many designs the team completed (attempts) and
 * why the race used the approved board or today's setup.
 */
export function tableStory(team, id) {
  const review = team?.reviews?.[id]
  const attempts = Number(team?.attempts?.[id]) || 0
  const plan = team?.plans?.[id]
  const locked = C.decisionsFor(id).filter((d) => team?.choices?.[d.id] !== undefined).length
  const nth = attemptWord(Math.max(1, attempts))
  if (review?.status === "approved") return { attempts, status: "approved", text: attempts > 1 ? `Approved on the ${nth}: the SA rejected the earlier design and you adjusted it.` : "Approved on the first attempt." }
  if (plan) return { attempts, status: "locked", text: `All three choices were locked (${nth}) but the SA had not approved them when time ran out, so this table raced on today's setup.` }
  if (review?.status === "rejected") return { attempts, status: "rejected", text: `Rejected on the ${nth} ("${review.reason || "no reason given"}") and still adjusting when time ran out, so this table raced on today's setup.` }
  if (locked) return { attempts, status: "draft", text: `Only ${locked} of 3 choices were locked when time ran out, so this table raced on today's setup.` }
  return { attempts, status: "none", text: "Not played: this table raced on today's setup." }
}

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
      const story = tableStory(team, id)
      const why = story.status === "rejected" ? "rejected by the SA and not re-pitched in time" : "not approved"
      tips.push({ station: id, decision: null, better: null, gain: 100, text: `${station.name}: your board was in the zone (${own.seconds.toFixed(2)} s per lap, FIT ${own.fit}) but ${why}, so it raced on the customer's existing setup and found 0.00 s. Lock your three choices and call the SA earlier.` })
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
  if (out.length < 2) out.push({ station: null, decision: null, better: null, gain: 0, text: "Call the SA earlier: a rejection costs time, and the SA may be busy at another table." })
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
  const recovered = approved.filter((id) => (Number(team?.attempts?.[id]) || 0) > 1)
  if (out.length < 3 && recovered.length) out.push(`${stationOf(recovered[0]).name}: rejected, adjusted and approved on the ${attemptWord(team.attempts[recovered[0]])}.`)
  if (out.length < 2 && approved.length) out.push(`${approved.length} of ${stationIds.length} boards approved by the Solutions Architects.`)
  if (out.length < 3 && row?.underSC) out.push("Your pit wall reacted to the Safety Car and pitted cheaply.")
  if (out.length < 3 && row && !row.caught.length) out.push("A clean audit: no FIA, finance or operations penalty points.")
  const finale = finaleSummary(race)
  if (out.length < 2 && finale.plan && finale.ahead) out.push(`The ${C.FINALE_ENTRANTS.plan.short} beat today's Hinwil setup by ${finale.gap.toFixed(1)} s over ${finale.laps} laps.`)
  if (out.length < 2) out.push("You took part in every phase of the session.")
  return out.slice(0, 3)
}

/** The race incidents and penalties (FIA, finance, operations) that touched this team, in lap order. */
export function incidentsFor(teamId, race) {
  return (race?.events || []).filter((e) => e.team === teamId && ["bad", "good", "penalty"].includes(e.kind)).map((e) => ({ lap: e.lap, kind: e.kind, text: e.text, lesson: e.lesson || null, station: e.station || null }))
}

/** The board the race used for each table: the approved one, or the customer's existing setup. */
export function racedBoards(team, stationIds = C.STATIONS.map((s) => s.id), budget = C.DEFAULT_BUDGET) {
  const choices = choicesOf(team)
  return stationIds.map((id) => {
    const approved = isApproved(team, id)
    const board = boardFor(id, approved ? choices : C.BASELINE_CHOICES, budget)
    const story = tableStory(team, id)
    return { station: id, name: stationOf(id).name, color: stationOf(id).color, approved, choices: board.choices, board, seconds: board.seconds, allowed: board.allowed, fit: board.fit, status: board.status, inZone: board.inZone, raced: approved ? "approved" : "today", attempts: story.attempts, story: story.text, targets: board.targets.map((t) => ({ name: t.name, display: t.display, ok: t.ok })) }
  })
}

/**
 * The customer's readout: what each table approved and found, how the 2027 plan fared against
 * today's Hinwil setup over 56 laps, the lessons, and what to do differently.
 */
export function readoutFor(team, race, stationIds = C.STATIONS.map((s) => s.id), budget = C.DEFAULT_BUDGET) {
  const row = race.results.find((r) => r.id === team.id)
  const finale = finaleSummary(race)
  const boards = racedBoards(team, stationIds, budget)
  const seconds = Number.isFinite(row?.found) ? row.found : Math.round(boards.reduce((sum, b) => sum + b.seconds, 0) * 100) / 100
  const approved = boards.filter((b) => b.raced === "approved").length
  const said = row && finale.today
    ? `after ${finale.laps} laps the ${C.FINALE_ENTRANTS.plan.short} finished ${finale.ahead ? `${Math.abs(finale.gap).toFixed(1)} s ahead of` : finale.gap === 0 ? "level with" : `${Math.abs(finale.gap).toFixed(1)} s behind`} today's Hinwil setup (P${row.position} of ${race.results.length})`
    : row ? `the race said P${row.position} of ${race.results.length}` : "there was no result"
  return {
    team: { id: team.id, name: team.name, color: team.color },
    summary: `You found ${seconds.toFixed(2)} s per lap at ${approved} approved table${approved === 1 ? "" : "s"}; ${said}.`,
    finale: finale.text,
    result: { seconds, position: row?.position ?? null, of: race.results.length, gap: finale.gap, ahead: finale.ahead, laps: finale.laps, approved, tables: boards.length, points: row?.score ?? 0, racePoints: row?.racePoints ?? 0, tablePoints: row?.pitch ?? 0, penaltyPoints: row?.penaltyPoints ?? 0 },
    boards,
    wentWell: positivesFor(team, row, race, stationIds, budget),
    couldDo: suggestionsFor(team, stationIds, budget),
    path2028: path2028For(team, stationIds),
    incidents: incidentsFor(team.id, race),
  }
}
