import * as C from "/js/catalog.js"
import { LAPS, RACE_POINT_MULT, RACE_SECONDS } from "/js/race.js"
import { readoutFor } from "/js/report.js"
import { readoutCard } from "/js/readoutview.js"
import { podiumGraphic } from "/js/podium.js"
import { approvedStations } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs } from "/js/session.js"
import { COTA_PATH_D, COTA_VIEWBOX, COTA_TURNS, COTA_FACTS } from "/js/cota.js"
import { el, clock, post, watchState, gameClock, installErrorLogging, instructionsButton, button, confirmDialog, WORDS } from "/js/ui.js"

installErrorLogging("race")

const app = document.getElementById("app")
const lapBox = document.getElementById("lap")
const sub = document.getElementById("sub")
const params = new URLSearchParams(location.search)
const FACT_EVERY_S = 6
const CYCLE_MS = 20_000
/** Where the pit lane leaves the track (fraction of the lap); it rejoins at the start/finish line. */
const PIT_IN = 0.955
const teamParam = params.get("team")

document.getElementById("tools").replaceChildren(instructionsButton("projector"), button(WORDS.returnHome, () => { location.href = "/" }, { small: true }))

let state = null
let offset = 0
let anim = null
let shownSeed = null
let viewKey = ""
let gameId = null
let held = null
let cycleIndex = 0
let cycleAt = Date.now()

watchState((next, off) => {
  state = next
  offset = off
  if (!gameClock(state)) {
    lapBox.textContent = "--:--"
    sub.textContent = "Reconnecting to the game server"
    return
  }
  if (gameId && state.id !== gameId && !state.teams.length && !teamParam) location.href = "/"
  gameId = state.id
  render()
}, 1500)

const shortLabel = (name) => (name.length > 12 ? `${name.slice(0, 11)}…` : name)

function toast(text) {
  const node = el("div", { class: "toast" }, text)
  document.body.append(node)
  setTimeout(() => node.remove(), 2600)
}

function render() {
  if (teamParam) return renderTeamReadout()
  const phase = phaseOf(state)
  if (phase === "race" || phase === "readout") {
    if (state.race.seed !== shownSeed) {
      shownSeed = state.race.seed
      const animatable = phase === "race" && state.race.result.results.every((r) => Array.isArray(r.cum) && r.cum.length === LAPS) && Date.now() + offset - state.race.ranAt < 5 * 60_000
      if (animatable) return startRace()
    }
    if (anim) return
    return phase === "readout" ? renderReadouts() : renderResults()
  }
  shownSeed = null
  if (anim) cancelAnimationFrame(anim.frame)
  anim = null
  renderWaiting()
}

/* ------------------------------------------------------------ phase header */

function phaseHeader() {
  const phase = phaseOf(state)
  const ms = phaseRemainingMs(state, offset)
  lapBox.textContent = Number.isFinite(ms) ? clock(ms) : phase === "ended" ? "TIME" : "FLAG"
  return phaseInfo(phase)
}

setInterval(() => {
  try {
    if (!state || !gameClock(state) || anim) return
    const info = phaseHeader()
    const big = document.getElementById("phaseClock")
    if (big) big.textContent = lapBox.textContent
    if (!teamParam && phaseOf(state) === "readout" && !held && Date.now() - cycleAt > CYCLE_MS) {
      cycleIndex += 1
      cycleAt = Date.now()
      viewKey = ""
      renderReadouts()
    }
    if (info && sub.dataset.phase !== info.id) render()
  } catch (err) {
    console.error("[podium] race clock", err)
  }
}, 250)

/* ------------------------------------------------------------ before the race: phase, countdown, standings */

function liveRows() {
  const ids = state.settings.stations
  return state.teams.map((t) => {
    const approved = approvedStations(t, ids)
    const points = approved.reduce((sum, id) => sum + (t.pitch?.[id] || 0), 0)
    const waiting = ids.filter((id) => t.plans?.[id] && !approved.includes(id)).length
    return { t, approved: approved.length, waiting, points }
  }).sort((a, b) => b.points - a.points || b.approved - a.approved || a.t.name.localeCompare(b.t.name))
}

function runRacePanel() {
  const password = el("input", { type: "password", id: "racePassword", placeholder: WORDS.racePassword, autocomplete: "off", maxlength: 64 })
  const go = async () => {
    if (!password.value) return toast(`Enter the ${WORDS.racePassword.toLowerCase()}`)
    const playing = phaseOf(state) === "play"
    if (playing && !(await confirmDialog("Play is still running. End it now and run the race?", WORDS.runRace))) return
    try {
      await post("/api/race/run", { password: password.value, endClock: playing }, false)
    } catch (err) {
      toast(err.message)
    }
  }
  password.addEventListener("keydown", (e) => e.key === "Enter" && go())
  return el("div", { class: "panel", id: "runRacePanel" }, el("h3", {}, WORDS.runRace),
    el("div", { class: "row" }, password, el("button", { class: "btn primary", id: "runRaceBtn", onclick: go }, WORDS.runRace)))
}

function renderWaiting() {
  const info = phaseHeader()
  sub.dataset.phase = info.id
  sub.textContent = state.teams.length ? info.line : "Waiting for the host"
  const rows = liveRows()
  const ids = state.settings.stations
  const key = JSON.stringify(["wait", info.id, rows.map((r) => [r.t.id, r.t.name, r.approved, r.waiting, r.points])])
  if (key === viewKey) return
  if (document.activeElement?.id === "racePassword") return
  viewKey = key
  const standings = el("div", { class: `standings-grid${rows.length > 5 ? " two" : ""}`, id: "liveStandings" }, rows.map((r, i) => el("div", { class: "standing" },
    el("span", { class: "pos" }, i + 1), el("i", { style: `background:${r.t.color}` }),
    el("span", { class: "name" }, r.t.name, el("small", {}, ` ${C.tierFor(r.t).name}`)),
    el("span", { class: "tables" }, `${r.approved}/${ids.length}`, r.waiting ? el("small", {}, ` +${r.waiting} waiting`) : null),
    el("b", {}, r.points))))
  app.replaceChildren(el("div", { class: "projector" },
    el("div", { class: "panel phase-panel" }, el("div", { class: "phase-name" }, info.name), el("div", { class: "phase-clock", id: "phaseClock" }, lapBox.textContent), el("p", { class: "muted" }, info.line),
      el("div", { class: "phase-steps" }, ["brief", "play", "race", "readout"].map((id) => el("div", { class: `phase-step${info.id === id || (id === "brief" && info.id === "briefDone") || (id === "race" && info.id === "ended") ? " on" : ""}` }, el("b", {}, phaseInfo(id).name))))),
    el("div", { class: "panel" }, el("h2", {}, "Live standings"), el("p", { class: "small muted" }, "Approved tables and table points. The race adds race points × 4, minus FIA penalties."),
      state.teams.length ? standings : el("p", { class: "muted" }, "No teams yet.")),
    info.id === "ended" || info.id === "play" ? runRacePanel() : null))
}

/* ------------------------------------------------------------ COTA */

const SVG_NS = "http://www.w3.org/2000/svg"
function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

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
    const toPit = (lapTime - r.pitLoss) * PIT_IN
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
    g.append(svgNode("circle", { r: 9, fill: r.color, stroke: "#000", "stroke-width": 3 }))
    const label = svgNode("text", { x: 13, y: -10, fill: "#fff", "font-size": 13, "font-weight": 800, stroke: "#000", "stroke-width": 3, "paint-order": "stroke" })
    label.textContent = shortLabel(r.name)
    g.append(label)
    svg.append(g)
    return [r.id, g]
  }))
  svg.append(scDot)
  const tower = el("div", { class: "tower", id: "timingTower" })
  const ticker = el("div", { class: "ticker", id: "raceTicker" })
  const progressBar = el("i", {})
  app.replaceChildren(el("div", { class: "race-wrap" },
    el("div", {}, el("div", { class: "panel track-panel", id: "trackPanel" }, svg, el("div", { class: "race-progress" }, progressBar)), el("div", { class: "panel", style: "margin-top:12px" }, el("h3", { style: "margin-bottom:6px" }, "Race control"), ticker)),
    el("div", {}, el("div", { class: "panel" }, el("h3", { style: "margin-bottom:8px" }, "Timing"), tower), el("div", { class: "row", style: "margin-top:10px" }, button("Skip to the podium", () => finish())))))
  sub.dataset.phase = "race"
  sub.textContent = `Lights out at the ${C.FINALE.race}!`
  const raceEnd = Math.max(...rows.map((r) => r.total))
  const leaderEnd = rows[0].total
  const shown = new Set()
  const start = performance.now()
  let nextFact = 2
  let factIndex = 0
  let towerKey = ""
  const push = (node) => {
    ticker.prepend(node)
    while (ticker.children.length > 5) ticker.lastChild.remove()
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
        cars[r.id].lastChild.setAttribute("y", String(-10 - stack * 15))
        placed.push(p)
      }
      const order = [...pos].sort((a, b) => (b.at.done - a.at.done) || (b.at.lap + b.at.s) - (a.at.lap + a.at.s) || a.r.total - b.r.total)
      const leader = order[0]
      const lap = Math.min(LAPS, leader.at.done ? LAPS : leader.at.lap + 1)
      const sc = result.sc && lap >= result.sc.lap && lap < result.sc.lap + result.sc.laps
      if (sc) {
        const p = line.getPointAtLength(((leader.at.s + 0.03) % 1) * total)
        scDot.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
        scDot.setAttribute("visibility", "visible")
      } else scDot.setAttribute("visibility", "hidden")
      lapLabel.textContent = `LAP ${lap} / ${LAPS}${sc ? " · SAFETY CAR" : ""}`
      lapBox.textContent = `LAP ${lap}/${LAPS}`
      progressBar.style.width = `${Math.min(100, (elapsed / RACE_SECONDS) * 100).toFixed(1)}%`
      const gapOf = (x) => {
        const k = Math.min(x.at.done ? LAPS : x.at.lap, leader.at.done ? LAPS : leader.at.lap)
        return k <= 0 ? x.r.start - leader.r.start : x.r.cum[k - 1] - leader.r.cum[k - 1]
      }
      const key = order.map((x) => `${x.r.id}:${gapOf(x).toFixed(1)}:${x.at.pit}`).join("|")
      if (key !== towerKey) {
        towerKey = key
        tower.replaceChildren(...order.map((x, i) => el("div", {}, el("span", {}, i + 1), el("i", { style: `background:${x.r.color}` }), el("span", { class: "tname" }, x.r.name), el("span", {}, x.at.pit ? "PIT" : i === 0 ? "Leader" : `+${Math.max(0, gapOf(x)).toFixed(1)}s`))))
      }
      for (const [n, ev] of result.events.entries()) {
        if (shown.has(n) || ev.lap > lap || ev.lap === LAPS) continue
        shown.add(n)
        push(el("div", { class: `ev ${ev.kind}` }, `${ev.lap ? `L${ev.lap} · ` : ""}${ev.text}`))
        if (ev.kind === "sc") sub.textContent = ev.text
      }
      if (elapsed >= nextFact) {
        nextFact = elapsed + FACT_EVERY_S
        push(el("div", { class: "ev fact" }, `COTA · ${COTA_FACTS[factIndex++ % COTA_FACTS.length]}`))
      }
      if (elapsed >= RACE_SECONDS) return finish()
      anim.frame = requestAnimationFrame(frame)
    } catch (err) {
      console.error("[podium] race animation failed; showing the results", err)
      finish()
    }
  }
  anim = { frame: requestAnimationFrame(frame) }
}

function finish() {
  if (anim) cancelAnimationFrame(anim.frame)
  anim = null
  viewKey = ""
  render()
}

/* ------------------------------------------------------------ podium and classification */

function renderResults() {
  const result = state.race.result
  const key = `results-${state.race.seed}-${state.teams.length}`
  if (viewKey === key) return
  viewKey = key
  lapBox.textContent = "FLAG"
  sub.dataset.phase = "race"
  sub.textContent = `Chequered flag at the ${C.FINALE.race}. Readouts are next.`
  const classification = el("table", { class: "grid", id: "classification" },
    el("thead", {}, el("tr", {}, ["Pos", "Team", "Gap", "Tables", "Race", "Table pts", "Penalties", "Points"].map((h) => el("th", {}, h)))),
    el("tbody", {}, result.results.map((r) => el("tr", {},
      el("td", {}, r.position), el("td", {}, el("b", { style: `color:${r.color}` }, r.name), r.id === result.fastestLap ? " ⏱" : ""),
      el("td", {}, r.position === 1 ? "Winner" : `+${r.gap.toFixed(1)}s`),
      el("td", {}, `${state.settings.stations.length - r.missed.length - r.notApproved.length}/${state.settings.stations.length}`),
      el("td", {}, `${r.racePoints} × ${RACE_POINT_MULT}`), el("td", {}, r.pitch), el("td", {}, r.penaltyPoints ? `−${r.penaltyPoints}` : "—"), el("td", {}, el("b", {}, r.score))))))
  app.replaceChildren(el("div", { class: "race-report" }, podiumGraphic(result),
    el("div", { class: "panel" }, el("h2", { style: "margin-bottom:8px" }, `${C.FINALE.race} classification`), el("div", { class: "table-scroll" }, classification))))
}

/* ------------------------------------------------------------ readouts */

function readoutChooser(active) {
  return el("div", { class: "readout-chooser", id: "readoutChooser" },
    state.race.result.standings.map((s) => el("button", { class: `chooser-chip${s.id === active ? " on" : ""}`, "data-team": s.id, style: `--c:${s.color}`, onclick: () => { held = s.id; viewKey = ""; renderReadouts() } }, s.name)),
    held ? button("Cycle", () => { held = null; cycleAt = Date.now(); viewKey = ""; renderReadouts() }, { small: true }) : el("span", { class: "muted small" }, `Cycling every ${CYCLE_MS / 1000} s · tap a team to hold`))
}

function renderReadouts() {
  const standings = state.race.result.standings
  const id = held || standings[cycleIndex % standings.length]?.id
  const team = state.teams.find((t) => t.id === id)
  const key = `readout-${state.race.seed}-${id}-${Boolean(held)}`
  if (!team || viewKey === key) return
  viewKey = key
  sub.dataset.phase = "readout"
  sub.textContent = "Readouts: what went well and what to do differently"
  app.replaceChildren(el("div", { class: "readout-page" }, readoutChooser(id), readoutCard(readoutFor(team, state.race.result, state.settings.stations))))
}

/** race.html?team=<id>: one team's readout on one screen, for a screenshot. */
function renderTeamReadout() {
  const team = state.teams.find((t) => t.id === teamParam)
  const phase = phaseOf(state)
  const info = phaseHeader()
  sub.dataset.phase = info.id
  const key = JSON.stringify(["team", teamParam, state.race?.seed, Boolean(team), phase])
  if (viewKey === key) return
  viewKey = key
  if (!team) {
    sub.textContent = "Readout"
    return app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "state-banner info" }, "That team is not in this game.")))
  }
  if (!state.race) {
    sub.textContent = `${team.name} readout`
    return app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "state-banner info" }, `${team.name}: your readout appears here after the race. Now: ${info.name}.`)))
  }
  sub.textContent = `${team.name} readout · ${C.FINALE.race}`
  app.replaceChildren(el("div", { class: "readout-page single" }, readoutCard(readoutFor(team, state.race.result, state.settings.stations))))
}
