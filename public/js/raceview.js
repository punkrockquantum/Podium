import * as C from "/js/catalog.js"
import { evaluate, effectiveTeam, pickedOption } from "/js/model.js"
import { LAPS, RACE_POINT_MULT, RACE_SECONDS, pitchMax } from "/js/race.js"
import { REFERENCE_BUILD, expectedPenalty } from "/js/sim.js"
import { suggestionsFor } from "/js/report.js"
import { podiumGraphic } from "/js/podium.js"
import { approvedStations, STATUS_LABEL } from "/js/approval.js"
import { COTA_PATH_D, COTA_VIEWBOX, COTA_TURNS, COTA_FACTS } from "/js/cota.js"
import { el, money, pct, clock, post, watchState, remainingMs, gameClock, installErrorLogging, instructionsButton, button, confirmDialog, WORDS } from "/js/ui.js"

installErrorLogging("race")

const app = document.getElementById("app")
const lapBox = document.getElementById("lap")
const sub = document.getElementById("sub")
const params = new URLSearchParams(location.search)
const FACT_EVERY_S = 6
/** Where the pit lane leaves the track (fraction of the lap); it rejoins at the start/finish line. */
const PIT_IN = 0.955

document.getElementById("tools").replaceChildren(instructionsButton("projector"), button(WORDS.returnHome, () => { location.href = "/" }, { small: true }))

let state = null
let shownSeed = null
let focusTeam = params.get("team")
let anim = null
let offset = 0
let waitingKey = ""
let gameId = null

const watcher = watchState((next, off) => {
  state = next
  offset = off
  if (!gameClock(state)) {
    lapBox.textContent = "--:--"
    sub.textContent = "Reconnecting to the game server"
    return
  }
  if (gameId && state.id !== gameId && !state.teams.length) {
    location.href = "/"
    return
  }
  gameId = state.id
  if (!state.race) {
    shownSeed = null
    if (anim) cancelAnimationFrame(anim.frame)
    anim = null
    renderWaiting()
    return
  }
  if (state.race.seed !== shownSeed) {
    shownSeed = state.race.seed
    const animatable = state.race.result.results.every((r) => Array.isArray(r.cum) && r.cum.length === LAPS)
    if (focusTeam || !animatable) renderResults()
    else startRace()
  }
}, 1500)

const opts = () => ({ races: state.settings.races, sprints: state.settings.sprints })
const teamById = (id) => state.teams.find((t) => t.id === id)
const raced = (t) => effectiveTeam(t, state.settings.stations)
const visitedCount = (t) => state.settings.stations.filter((id) => t.visits?.[id] || t.touched?.[id] || t.submitted?.[id] || t.plans?.[id]).length
const archBadge = (id) => (teamById(id)?.architect?.enabled ? el("span", { class: "badge-arch" }, "ARCHITECT") : null)
const stationName = (id) => C.byId(C.STATIONS, id)?.name || id

function clockLabel() {
  const c = gameClock(state)
  if (!c) return "--:--"
  if (c.status === "lobby") return `GAME ${clock(c.totalMs)}`
  if (c.status === "ended") return "TIME"
  return `${c.status === "paused" ? "PAUSED " : ""}${clock(remainingMs(c, offset))}`
}

setInterval(() => {
  try {
    if (state && !state.race) lapBox.textContent = clockLabel()
  } catch (err) {
    console.error("[podium] race clock", err)
  }
}, 250)

function toast(text) {
  const node = el("div", { class: "toast" }, text)
  document.body.append(node)
  setTimeout(() => node.remove(), 2600)
}

/* ------------------------------------------------------------ live standings and Run race */

/** Tables approved, the summed system score of approved tables, and table points. */
function liveRows() {
  const ids = state.settings.stations
  return state.teams.map((t) => {
    const approved = approvedStations(t, ids)
    const system = approved.reduce((sum, id) => sum + (t.reviews[id].score ?? t.plans?.[id]?.score ?? 0), 0)
    const waiting = ids.filter((id) => t.plans?.[id] && !approved.includes(id)).length
    const points = approved.reduce((sum, id) => sum + (t.pitch?.[id] || 0), 0)
    return { t, done: approved.length, waiting, system, points }
  }).sort((a, b) => b.points - a.points || b.system - a.system)
}

function runRacePanel() {
  const c = gameClock(state)
  const password = el("input", { type: "password", id: "racePassword", placeholder: WORDS.racePassword, autocomplete: "off", maxlength: 64 })
  const seed = el("input", { type: "text", id: "raceSeed", placeholder: "Seed (optional)", maxlength: 64 })
  const running = ["running", "paused"].includes(c.status)
  const go = async () => {
    if (!password.value) return toast(`Enter the ${WORDS.racePassword.toLowerCase()}`)
    if (running && !(await confirmDialog("The game clock is still running. End it now and run the race? Tables not approved score 0 and race on their defaults.", WORDS.runRace))) return
    try {
      await post("/api/race/run", { password: password.value, seed: seed.value, endClock: running }, false)
      watcher.refresh()
    } catch (err) {
      toast(err.message)
    }
  }
  password.addEventListener("keydown", (e) => e.key === "Enter" && go())
  return el("div", { class: "panel", id: "runRacePanel" }, el("h2", {}, WORDS.runRace),
    el("p", { class: "small muted" }, `${C.FINALE.laps} laps in ${RACE_SECONDS} seconds. Only approved designs race as designed; every other table races on its defaults.`),
    el("div", { class: "row" }, password, seed, el("button", { class: "btn primary", id: "runRaceBtn", disabled: state.teams.length < 2, onclick: go }, WORDS.runRace)))
}

function renderWaiting() {
  lapBox.textContent = clockLabel()
  const c = gameClock(state)
  const ids = state.settings.stations
  sub.textContent = !state.teams.length ? "Waiting for the host" : c.status === "lobby" ? "The game clock has not started" : c.status === "ended" ? "Time is up: every table is locked. The race is next." : `Live standings · ${c.status === "paused" ? "clock paused" : "clock running"} · tables not approved race on their defaults`
  const rows = liveRows()
  const key = JSON.stringify([rows.map((r) => [r.t.id, r.t.name, r.done, r.waiting, r.system, r.points, r.t.architect?.enabled]), c.status, state.teams.length])
  if (key === waitingKey) return
  if (document.activeElement && ["INPUT"].includes(document.activeElement.tagName) && document.getElementById("runRacePanel")) return
  waitingKey = key
  const table = el("table", { class: "grid standings" },
    el("thead", {}, el("tr", {}, ["Pos", "Team", "Tables approved", "System score", "Points"].map((h) => el("th", {}, h)))),
    el("tbody", {}, rows.map((r, i) => el("tr", {},
      el("td", {}, i + 1),
      el("td", {}, el("b", { style: `color:${r.t.color}` }, r.t.name), archBadge(r.t.id), el("div", { class: "small muted" }, `P${r.t.rank} in 2026`)),
      el("td", {}, `${r.done}/${ids.length}`, r.waiting ? el("div", { class: "small muted" }, `${r.waiting} awaiting approval`) : null),
      el("td", {}, r.done ? `${r.system}` : "—"),
      el("td", {}, el("b", {}, `${r.points}`))))))
  app.replaceChildren(el("div", { class: "race-wrap" },
    el("div", {}, el("div", { class: "panel" }, el("h2", { style: "margin-bottom:8px" }, "Live standings"), state.teams.length ? table : el("p", { class: "muted" }, "No teams yet."),
      el("p", { class: "small muted" }, `System score adds up each approved table's simulation score. Points are the table points (score + 10% for approval, up to ${C.PITCH_MAX} a table); the race adds ${RACE_POINT_MULT} × F1 points, minus penalties.`)),
      state.teams.length >= 2 ? runRacePanel() : null),
    el("div", {}, el("div", { class: "panel" }, el("h2", {}, C.FINALE.race), el("p", {}, `Circuit of the Americas · ${C.FINALE.laps} laps · ${C.FINALE.lapKm} km · ${C.FINALE.turns} turns · anticlockwise.`), trackSvg().svg),
      el("div", { class: "panel", style: "margin-top:12px" }, el("h3", {}, "The infrastructure behind the lap time"),
        el("p", { class: "small" }, "Approved designs set the pace: CFD becomes downforce, the strategy AI and the network to the pit wall decide the Safety Car call, cooling and power decide what breaks, and the FIA audits what you shared.")))))
}

/* ------------------------------------------------------------ COTA */

const SVG_NS = "http://www.w3.org/2000/svg"

function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

/** The track, its pit lane (a spur beside the start/finish straight) and the turn numbers. */
function trackSvg() {
  const svg = svgNode("svg", { viewBox: COTA_VIEWBOX, class: "cota", role: "img", "aria-label": "Circuit of the Americas track map" })
  svg.append(svgNode("path", { d: COTA_PATH_D, fill: "none", stroke: "#3a404b", "stroke-width": 26, "stroke-linejoin": "round" }))
  const line = svgNode("path", { d: COTA_PATH_D, fill: "none", stroke: "#e6e9ef", "stroke-width": 2, "stroke-linejoin": "round", id: "cotaLine" })
  svg.append(line)
  document.body.append(svg)
  const total = line.getTotalLength()
  const pin = line.getPointAtLength(PIT_IN * total)
  const sf = line.getPointAtLength(0)
  const pitD = `M ${pin.x} ${pin.y} C ${pin.x + 18} ${pin.y - 8} 896 ${pin.y - 22} 896 ${pin.y - 44} L 896 ${sf.y + 30} C 896 ${sf.y + 12} ${sf.x + 16} ${sf.y + 4} ${sf.x} ${sf.y}`
  svg.append(svgNode("path", { d: pitD, fill: "none", stroke: "#2b3039", "stroke-width": 12, "stroke-linecap": "round" }))
  const pit = svgNode("path", { d: pitD, fill: "none", stroke: "#f4d35e", "stroke-width": 1.5, "stroke-dasharray": "6 5", id: "pitLane" })
  svg.append(pit)
  const pitLabel = svgNode("text", { x: 908, y: (pin.y + sf.y) / 2, fill: "#f4d35e", "font-size": 14, "font-weight": 800 })
  pitLabel.textContent = "PIT"
  svg.append(pitLabel)
  const pitTotal = pit.getTotalLength()
  for (const turn of COTA_TURNS) {
    const p = line.getPointAtLength(turn.s * total)
    const label = svgNode("text", { x: p.x + 18, y: p.y - 14, fill: "#9aa3b2", "font-size": 18, "font-weight": 700 })
    label.textContent = turn.n
    svg.append(label)
  }
  svg.append(svgNode("rect", { x: sf.x - 16, y: sf.y - 3, width: 32, height: 6, fill: "#fff" }))
  svg.remove()
  return { svg, line, total, pit, pitTotal }
}

/* ------------------------------------------------------------ the 30-second race */

/** Where a car is at race time `t` (seconds): lap index, fraction of the lap, and whether it is in the pit lane. */
function carAt(r, t) {
  const cum = r.cum
  if (t <= r.start) return { lap: 0, s: 0, pit: false, done: false }
  let k = 0
  while (k < cum.length && cum[k] <= t) k += 1
  if (k >= cum.length) return { lap: LAPS, s: 0, pit: false, done: true }
  const prev = k === 0 ? r.start : cum[k - 1]
  const lapTime = cum[k] - prev
  const into = t - prev
  if (r.pitLap === k + 1 && r.pitLoss > 0) {
    const drive = lapTime - r.pitLoss
    const toPit = drive * PIT_IN
    if (into < toPit) return { lap: k, s: (into / toPit) * PIT_IN, pit: false, done: false }
    return { lap: k, s: PIT_IN, pit: true, pitFrac: Math.min(1, (into - toPit) / (lapTime - toPit)), done: false }
  }
  return { lap: k, s: into / lapTime, pit: false, done: false }
}

function startRace() {
  const result = state.race.result
  const { svg, line, total, pit, pitTotal } = trackSvg()
  const lapLabel = svgNode("text", { x: 40, y: 60, fill: "#fff", "font-size": 34, "font-weight": 900 })
  svg.append(lapLabel)
  const scDot = svgNode("g", { visibility: "hidden" })
  scDot.append(svgNode("rect", { x: -16, y: -9, width: 32, height: 18, rx: 4, fill: "#f4d35e", stroke: "#000", "stroke-width": 2 }))
  const scText = svgNode("text", { x: 0, y: 5, "text-anchor": "middle", "font-size": 12, "font-weight": 900, fill: "#000" })
  scText.textContent = "SC"
  scDot.append(scText)
  const rows = result.results
  const cars = Object.fromEntries(rows.map((r) => {
    const g = svgNode("g", { class: "car", "data-team": r.id })
    g.append(svgNode("circle", { r: 10, fill: r.color, stroke: "#000", "stroke-width": 3 }))
    const label = svgNode("text", { x: 14, y: -12, fill: "#fff", "font-size": 15, "font-weight": 800, stroke: "#000", "stroke-width": 3, "paint-order": "stroke" })
    label.textContent = r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name
    g.append(label)
    svg.append(g)
    return [r.id, g]
  }))
  svg.append(scDot)
  const tower = el("div", { class: "tower", id: "timingTower" })
  const ticker = el("div", { class: "ticker", id: "raceTicker" })
  const progressBar = el("i", {})
  const skip = el("button", { class: "btn", onclick: () => finish() }, "Skip to the report")
  app.replaceChildren(el("div", { class: "race-wrap" },
    el("div", {}, el("div", { class: "panel track-panel", id: "trackPanel" }, svg, el("div", { class: "race-progress" }, progressBar)), el("div", { class: "panel", style: "margin-top:12px" }, el("h3", { style: "margin-bottom:6px" }, "Race control"), ticker)),
    el("div", {}, el("div", { class: "panel" }, el("h3", { style: "margin-bottom:8px" }, "Timing"), tower), el("div", { class: "row", style: "margin-top:10px" }, skip))))
  sub.textContent = `Lights out at the ${C.FINALE.race}!${result.sc ? " A Safety Car is in the forecast…" : ""}`
  const finishers = rows.filter((r) => !r.dsq)
  const raceEnd = Math.max(...(finishers.length ? finishers : rows).map((r) => r.total))
  const leaderEnd = (finishers[0] || rows[0]).total
  const shown = new Set()
  const start = performance.now()
  let nextFact = 2
  let factIndex = 0
  let towerKey = ""

  const push = (node) => {
    ticker.prepend(node)
    while (ticker.children.length > 6) ticker.lastChild.remove()
  }

  const frame = (now) => {
    try {
      const elapsed = Math.max(0, (now - start) / 1000)
      const t = Math.min(raceEnd, (elapsed / RACE_SECONDS) * leaderEnd)
      const pos = rows.map((r) => ({ r, at: carAt(r, t) }))
      const placed = []
      for (const { r, at } of pos) {
        const p = at.pit ? pit.getPointAtLength(at.pitFrac * pitTotal) : line.getPointAtLength((at.done ? 0 : at.s) * total)
        cars[r.id].setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
        const stack = placed.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < 40).length
        cars[r.id].lastChild.setAttribute("y", String(-12 - stack * 18))
        placed.push(p)
      }
      const order = [...pos].sort((a, b) => (b.at.done - a.at.done) || (b.at.lap + b.at.s) - (a.at.lap + a.at.s) || a.r.total - b.r.total)
      const leader = order[0]
      const lap = Math.min(LAPS, leader.at.done ? LAPS : leader.at.lap + 1)
      const sc = result.sc && lap >= result.sc.lap && lap < result.sc.lap + result.sc.laps
      if (sc) {
        const p = line.getPointAtLength((((leader.at.s + 0.03) % 1)) * total)
        scDot.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
        scDot.setAttribute("visibility", "visible")
      } else scDot.setAttribute("visibility", "hidden")
      lapLabel.textContent = `LAP ${lap} / ${LAPS}${sc ? " · SAFETY CAR" : ""}`
      lapBox.textContent = `LAP ${lap}/${LAPS}`
      progressBar.style.width = `${Math.min(100, (elapsed / RACE_SECONDS) * 100).toFixed(1)}%`
      const gapOf = (x) => {
        const k = Math.min(x.at.done ? LAPS : x.at.lap, leader.at.done ? LAPS : leader.at.lap)
        if (k <= 0) return x.r.start - leader.r.start
        return x.r.cum[k - 1] - leader.r.cum[k - 1]
      }
      const key = order.map((x) => `${x.r.id}:${gapOf(x).toFixed(1)}:${x.at.pit}`).join("|")
      if (key !== towerKey) {
        towerKey = key
        tower.replaceChildren(...order.map((x, i) => el("div", {}, el("span", {}, i + 1), el("i", { style: `background:${x.r.color}` }), el("span", {}, x.r.name, archBadge(x.r.id)),
          el("span", {}, x.at.pit ? "PIT" : i === 0 ? "Leader" : `+${Math.max(0, gapOf(x)).toFixed(1)}s`))))
      }
      for (const [n, ev] of result.events.entries()) {
        if (shown.has(n) || ev.lap > lap || ev.lap === LAPS) continue
        shown.add(n)
        push(el("div", { class: `ev ${ev.kind}` }, `${ev.lap ? `L${ev.lap} · ` : ""}${ev.text}`, ev.lesson ? el("span", { class: "lesson" }, ev.lesson) : null))
        if (ev.kind === "sc") sub.textContent = ev.text
      }
      if (elapsed >= nextFact) {
        nextFact = elapsed + FACT_EVERY_S
        push(el("div", { class: "ev fact" }, `COTA · ${COTA_FACTS[factIndex++ % COTA_FACTS.length]}`))
      }
      if (elapsed >= RACE_SECONDS) return finish()
      anim.frame = requestAnimationFrame(frame)
    } catch (err) {
      console.error("[podium] race animation failed; showing the report", err)
      finish()
    }
  }
  anim = { frame: requestAnimationFrame(frame) }
}

function finish() {
  if (anim) cancelAnimationFrame(anim.frame)
  anim = null
  renderResults()
}

/* ------------------------------------------------------------ race report */

function awards(result, evals) {
  const list = []
  const best = (label, key, fmt, higher = true) => {
    const rows = result.results.filter((r) => !r.dsq)
    if (!rows.length) return
    const pick = rows.reduce((a, b) => ((higher ? key(b) > key(a) : key(b) < key(a)) ? b : a))
    list.push(el("div", { class: "stat" }, el("b", { style: `color:${pick.color}` }, pick.name), el("span", {}, `${label}: ${fmt(key(pick))}`)))
  }
  best("Best CFD per MAUh", (r) => evals[r.id].cfd.rates.efficiency, pct)
  best("Sharpest strategy", (r) => r.strategy, (v) => v.toFixed(2))
  best("Lowest PUE", (r) => evals[r.id].power.pue, (v) => v.toFixed(2), false)
  best("Best value (aero per $M)", (r) => evals[r.id].aero.gain / ((evals[r.id].ledger.capex + evals[r.id].ledger.opex) / 1e6), (v) => `${(v * 1000).toFixed(0)} ms/lap per $M`)
  const clean = result.results.filter((r) => !r.penaltyPoints && !r.dsq && !r.caught.length)
  if (clean.length) list.push(el("div", { class: "stat" }, el("b", {}, clean.map((r) => r.name).join(", ")), el("span", {}, "Clean FIA audit")))
  return list
}

/** "What you could do differently": 1–3 suggestions per team, the focused team first. */
function renderSuggestions(result) {
  const ordered = [...result.standings].sort((a, b) => (b.id === focusTeam) - (a.id === focusTeam))
  const cards = ordered.map((s) => {
    const team = teamById(s.id)
    const r = result.results.find((x) => x.id === s.id)
    const tips = team ? suggestionsFor(team, r, state.settings.stations, opts()) : []
    return el("div", { class: `panel suggest-card${s.id === focusTeam ? " focus" : ""}`, "data-team": s.id, style: `border-top:4px solid ${s.color}` },
      el("h3", {}, el("span", { style: `color:${s.color}` }, s.name), archBadge(s.id), el("span", { class: "muted small" }, ` · ${r?.dsq ? "DSQ" : `P${r?.position}`} · ${s.score} pts`)),
      el("ol", { class: "suggestions" }, tips.map((tip) => el("li", { class: `tip-${tip.kind}` }, tip.text))),
      el("button", { class: "btn small-btn", onclick: () => { focusTeam = s.id; renderResults() } }, "Debrief"))
  })
  return el("div", { class: "wide", id: "suggestions" }, el("h2", { style: "margin:0 0 8px" }, "What you could do differently"), el("div", { class: "suggest-grid" }, cards))
}

function tablesCell(r) {
  const n = state.settings.stations.length
  const notApproved = r.notApproved?.length || 0
  const missed = r.missed?.length || 0
  const approved = n - notApproved - missed
  const notes = [notApproved ? `${notApproved} not approved` : null, missed ? `${missed} missed` : null].filter(Boolean).join(" · ")
  return el("td", { class: notes ? "warn-text" : "" }, `${approved}/${n} approved`, notes ? el("div", { class: "small" }, notes) : null)
}

function renderResults() {
  const result = state.race.result
  lapBox.textContent = "FLAG"
  sub.textContent = `Chequered flag at the ${C.FINALE.race} · seed ${state.race.seed}`
  const evals = Object.fromEntries(state.teams.map((t) => [t.id, evaluate(raced(t), opts())]))
  const max = pitchMax(state.settings.stations)
  const classification = el("table", { class: "grid", id: "classification" },
    el("thead", {}, el("tr", {}, ["Pos", "Team", "Grid", "Gap", "Stop", "Tables", "Race pts", "Pitch", "Penalties", "Score"].map((h) => el("th", {}, h)))),
    el("tbody", {}, result.results.map((r) => el("tr", { style: "cursor:pointer", onclick: () => { focusTeam = r.id; renderResults() } },
      el("td", {}, r.dsq ? "DSQ" : r.position), el("td", {}, el("b", { style: `color:${r.color}` }, r.name), archBadge(r.id), r.id === result.fastestLap ? " ⏱" : ""),
      el("td", {}, r.grid), el("td", {}, r.dsq ? "—" : r.position === 1 ? "Winner" : `+${r.gap.toFixed(1)}s`),
      el("td", {}, r.pitLap ? `L${r.pitLap}${r.underSC ? " (SC)" : ""}${r.timePenalty ? ` +${r.timePenalty}s` : ""}` : "—"),
      tablesCell(r),
      el("td", {}, `${r.racePoints} × ${RACE_POINT_MULT}`),
      el("td", {}, `${r.pitch}/${max}`), el("td", {}, r.penaltyPoints ? `−${r.penaltyPoints}` : "—"), el("td", {}, el("b", {}, r.score))))))
  const standings = result.standings.map((s, i) => el("div", {}, el("span", {}, i + 1), el("i", { style: `background:${s.color}` }), el("span", {}, s.name, archBadge(s.id)), el("span", {}, `${s.score}`)))
  const focus = focusTeam && result.results.find((r) => r.id === focusTeam)
  app.replaceChildren(
    el("div", { class: "race-report" }, podiumGraphic(result), renderSuggestions(result)),
    el("div", { class: "race-wrap" },
      el("div", { class: "panel" }, el("h2", { style: "margin-bottom:8px" }, `${C.FINALE.race} classification`), classification, el("p", { class: "small muted" }, `Tap a team for its debrief. Score = approved table points + ${RACE_POINT_MULT} × race points − FIA penalty points. Tables not approved scored 0 and raced on their default options.`)),
      el("div", {}, el("div", { class: "panel" }, el("h2", { style: "margin-bottom:8px" }, "Final standings"), el("div", { class: "tower" }, standings)),
        el("div", { class: "panel", style: "margin-top:12px" }, el("h3", { style: "margin-bottom:8px" }, "Awards"), el("div", { class: "stat-row" }, awards(result, evals))))),
    focus ? debrief(focus, evals[focus.id], result) : el("div"))
  if (focus) document.getElementById("debrief")?.scrollIntoView({ behavior: "smooth" })
}

function partnersUsed(ev, teamId) {
  const ch = ev.choices
  const o = (id) => pickedOption(id, ch)
  const platform = o("platform")
  const list = [
    `${o("oem").name}: builds and supports the CFD nodes (${ev.commercial.aas || o("payment").name}).`,
    `${o("cpu").vendor}: ${o("cpu").name} CPUs for CFD.`,
    `${platform.custom ? "Custom-silicon partner" : "NVIDIA"}: ${platform.name} for the strategy AI (${o("deploy").name}).`,
    `${o("location").name}: ${o("hall").name.toLowerCase()}, PUE ${ev.power.pue}.`,
    `${o("wan").name} to the circuits; ${o("hqLink").name} to the factory.`,
    `${o("pfs").name} for CFD scratch; ${o("dataTier").name}${ch.kv === "on" ? " + KV cache tier" : ""} for the strategy AI.`,
  ]
  if (ch.fabric === "cpo") list.push("Photonics: co-packaged optics switches in the cluster fabric.")
  if (ch.hqLink === "hollow") list.push("Photonics: hollow-core fibre between data centre and factory.")
  const arch = teamById(teamId)?.architect
  if (arch?.enabled) list.push(`Architect tuning: ×${(arch.gain || 1).toFixed(2)} good tokens per second.`)
  return list
}

/** What each table that did not count cost, against an optimised reference build for that table. */
function missedCosts(r, ev) {
  const team = teamById(r.id)
  const eff = raced(team)
  const rows = [...(r.notApproved || eff.notApproved).map((id) => ({ id, why: "notApproved" })), ...(r.missed || eff.missed).map((id) => ({ id, why: "missed" }))]
  return rows.map(({ id, why }) => {
    const keys = C.DECISIONS.filter((d) => d.station === id && !d.hidden).map((d) => d.id)
    const better = evaluate({ ...eff, choices: { ...ev.choices, ...Object.fromEntries(keys.map((k) => [k, REFERENCE_BUILD[k]])) } }, opts())
    return {
      id,
      why,
      sentBack: team.reviews?.[id]?.status === "sentBack" ? team.reviews[id].reason : null,
      own: Boolean(team.touched?.[id]),
      lap: better.aero.gain - ev.aero.gain,
      strategy: better.strategy - ev.strategy,
      penalties: expectedPenalty(ev).points - expectedPenalty(better).points,
    }
  })
}

function renderMissed(r, ev) {
  const rows = missedCosts(r, ev)
  if (!rows.length) return el("div", { class: "panel missed ok", style: "margin-bottom:12px" }, el("h3", {}, "Tables"), el("p", { class: "small" }, "Every table was approved before the race."))
  const note = (m) => (m.why === "notApproved" ? `Not approved${m.sentBack ? ` (sent back: ${m.sentBack})` : ""}: scored 0 and raced on defaults.` : m.own ? "Missed: choices were started but never locked in." : "Missed: never locked in.")
  return el("div", { class: "panel missed", style: "margin-bottom:12px" }, el("h3", {}, `Tables that did not count (${rows.length}): raced on default options`),
    el("table", { class: "grid" }, el("thead", {}, el("tr", {}, ["Table", "Status", "Lap time lost", "Strategy lost", "Expected FIA points", "Note"].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map((m) => el("tr", {},
        el("td", {}, el("b", {}, stationName(m.id))),
        el("td", {}, el("span", { class: `status-pill st-${m.why === "notApproved" ? "sentBack" : "none"}` }, m.why === "notApproved" ? "Not approved" : "Missed")),
        el("td", {}, m.lap > 0.005 ? `${m.lap.toFixed(2)} s/lap` : "—"),
        el("td", {}, m.strategy > 0.005 ? `−${pct(m.strategy)}` : "—"),
        el("td", {}, m.penalties > 0.05 ? `+${m.penalties.toFixed(1)} pts` : "—"),
        el("td", { class: "small muted" }, note(m)))))),
    el("p", { class: "small muted" }, "Compared with an optimised build for that table, holding the rest of your choices fixed."))
}

function debrief(r, ev, result) {
  const order = { red: 0, amber: 1, green: 2 }
  const checks = [...ev.checks].sort((a, b) => order[a.state] - order[b.state])
  const hurt = checks.filter((c) => c.state !== "green").slice(0, 8)
  const worked = checks.filter((c) => c.state === "green").slice(0, 6)
  const mine = result.events.filter((e) => e.team === r.id)
  const k = (value, label) => el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label))
  const line = (c) => el("div", { class: "check" }, el("span", { class: `dot ${c.state}` }), el("span", {}, `${stationName(c.station)}: ${c.text}`))
  const approved = state.settings.stations.length - (r.missed?.length || 0) - (r.notApproved?.length || 0)
  return el("div", { class: "panel debrief", id: "debrief", style: "margin:0 16px 40px" },
    el("h2", { style: `color:${r.color}` }, `${r.name} debrief · ${r.dsq ? "DSQ" : `P${r.position}`} · score ${r.score}`),
    el("div", { class: "kv" },
      k(r.aeroIndex.toFixed(2), "Aero index (P7 baseline 1.00)"),
      k(`−${r.aeroGain.toFixed(2)} s`, "Lap time from aero"),
      k(Number.isFinite(r.system) ? pct(r.system) : "—", "System score of the raced design"),
      k(pct(ev.cfd.rates.efficiency), "Compute allowance doing useful CFD"),
      k(r.strategy.toFixed(2), "Strategy quality"),
      k(`${Math.round(ev.network.loopS * 1000)} ms`, "Track → DC → factory"),
      k(pct(Math.min(9.99, ev.ai.coverage)), "Strategy AI demand met"),
      k(ev.power.pue.toFixed(2), `PUE · ${Math.round(ev.power.facilityKW)} kW`),
      k(money(ev.ledger.capex), `CapEx of ${money(ev.ledger.capexRemaining)}`),
      k(money(ev.ledger.opex), `OpEx of ${money(ev.ledger.opexAllowance)}`),
      k(`${approved}/${state.settings.stations.length}`, `Tables ${STATUS_LABEL.approved.toLowerCase()} · ${r.visited ?? visitedCount(teamById(r.id))} visited`)),
    renderMissed(r, ev),
    el("div", { class: "brief-grid" },
      el("div", {}, el("h3", {}, "What cost you"), hurt.length ? hurt.map(line) : el("p", { class: "muted" }, "Nothing flagged."), mine.length ? el("h3", { style: "margin-top:10px" }, "Race events") : null, mine.map((e) => el("div", { class: `ev ${e.kind}`, style: "margin-bottom:6px" }, `${e.lap ? `L${e.lap} · ` : ""}${e.text}`, e.lesson ? el("span", { class: "lesson" }, e.lesson) : null))),
      el("div", {}, el("h3", {}, "What worked"), worked.map(line), el("h3", { style: "margin-top:10px" }, "Your ecosystem"), el("ul", { class: "small" }, partnersUsed(ev, r.id).map((p) => el("li", {}, p))))),
  )
}
