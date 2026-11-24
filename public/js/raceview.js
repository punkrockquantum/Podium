import * as C from "/js/catalog.js"
import { LAPS, RACE_SECONDS } from "/js/race.js"
import { readoutFor, finaleSummary } from "/js/report.js"
import { readoutCard } from "/js/readoutview.js"
import { miniFit } from "/js/board.js"
import { finaleGraphic } from "/js/podium.js"
import { designStatus, STATUS_LABEL } from "/js/approval.js"
import { raceSeconds, boardFor } from "/js/model.js"
import { CAR_PATH, CAR_VIEWBOX } from "/js/scene.js"
import { phaseOf, phaseInfo, phaseRemainingMs, playOpen } from "/js/session.js"
import { COTA_PATH_D, COTA_VIEWBOX, COTA_TURNS, COTA_FACTS } from "/js/cota.js"
import { el, clock, post, watchState, gameClock, installErrorLogging, instructionsButton, button, confirmDialog, WORDS } from "/js/ui.js"

installErrorLogging("race")

const app = document.getElementById("app")
const lapBox = document.getElementById("lap")
const sub = document.getElementById("sub")
const params = new URLSearchParams(location.search)
const FACT_EVERY_S = 6
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

watchState((next, off) => {
  state = next
  offset = off
  if (!gameClock(state)) {
    lapBox.textContent = "--:--"
    sub.textContent = "Reconnecting to the game server"
    return
  }
  /* A restarted game: stay on the projector and start again from the ladder at 0.00 s. */
  if (gameId && state.id !== gameId) viewKey = ""
  gameId = state.id
  render()
}, 1500)

/** The one participant: the customer's team, created by the server. */
const customer = () => state?.teams?.find((t) => t.id === C.CUSTOMER_TEAM.id) || state?.teams?.[0] || null

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
    return phase === "readout" ? renderReadout() : renderResults()
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
  /* A countdown only while a timer is running or paused; otherwise the phase's own word ("No timer" in an open session). */
  lapBox.textContent = Number.isFinite(ms) ? clock(ms) : phase === "race" || phase === "readout" ? "FLAG" : phaseInfo(phase).idle
  lapBox.classList.toggle("idle", phase === "open")
  return phaseInfo(phase)
}

setInterval(() => {
  try {
    if (!state || !gameClock(state) || anim) return
    const info = phaseHeader()
    const big = document.getElementById("phaseClock")
    if (big) big.textContent = lapBox.textContent
    if (info && sub.dataset.phase !== info.id) render()
  } catch (err) {
    console.error("[podium] race clock", err)
  }
}, 250)

/* ------------------------------------------------------------ before the race: phase, countdown, the ladder */

/**
 * The lap-time ladder before the race: the customer's 2027 plan (the approved tables added up),
 * then each of the four tables on its own, then today's Hinwil setup at 0.00 s. A table's car
 * only moves off the line once its SA has approved the design.
 */
function ladderRows() {
  const ids = state.settings.stations
  const team = customer()
  const budget = state.settings.budget
  const tables = ids.map((id) => {
    const station = C.byId(C.STATIONS, id)
    const d = designStatus(state, team, id)
    const approved = d.status === "approved"
    const plan = d.plan
    const seconds = approved && plan ? (Number.isFinite(plan.board?.seconds) ? plan.board.seconds : boardFor(id, plan.choices, plan.budget || budget).seconds) : 0
    const label = d.attempts ? `${STATUS_LABEL[d.status]} · ${WORDS.attempt(d.attempts).toLowerCase()}` : STATUS_LABEL[d.status]
    return { id, name: station.name, color: station.color, seconds, approved, label, fits: [{ id, approved, fit: plan?.fit, status: plan?.status }] }
  })
  const approved = tables.filter((t) => t.approved).length
  const plan = { id: "plan", name: `${team?.name || C.CUSTOMER_TEAM.name} · ${WORDS.plan2027}`, color: team?.color || C.CUSTOMER_TEAM.color, seconds: team ? raceSeconds(team, budget, ids) : 0, approved: approved > 0, label: `${approved} of ${ids.length} tables approved`, fits: tables.map((t) => t.fits[0]), total: true }
  const today = { id: C.FINALE_ENTRANTS.today.id, name: WORDS.todayHinwil, color: C.FINALE_ENTRANTS.today.color, seconds: 0, approved: false, label: "The ghost car: 0.00 s at every table", fits: [], total: true }
  return [plan, ...tables, today]
}

/* The lap-time ladder: one car per row, as far right as the seconds per lap it has found. */
const LADDER_MAX = 1.4
const LANE_PX = 46
let ladder = null

function carIcon(color) {
  const icon = svgNode("svg", { viewBox: CAR_VIEWBOX, class: "lane-car-svg", "aria-hidden": "true" })
  icon.append(svgNode("path", { d: CAR_PATH, fill: color, stroke: "#000", "stroke-width": 4 }))
  for (const [cx, cy, r] of [[300, 190, 18], [532, 188, 22]]) icon.append(svgNode("circle", { cx, cy, r, fill: "#111", stroke: "#ddd", "stroke-width": 4 }))
  return icon
}

function buildLadder(rows) {
  const lanes = new Map()
  const body = el("div", { class: "ladder-body", style: `height:${rows.length * LANE_PX}px` })
  for (const r of rows) {
    const sec = el("b", { class: "lane-sec" })
    const car = el("div", { class: "lane-car" }, carIcon(r.color))
    const name = el("span", { class: "lane-name" }, r.name)
    const gauges = el("span", { class: "fits lane-gauges", "data-lane": r.id })
    const status = el("span", { class: "lane-status small" })
    const lane = el("div", { class: `lane${r.total ? " total" : ""}`, "data-lane": r.id, style: `--c:${r.color}` }, name, el("div", { class: "lane-track" }, car), sec, gauges, status)
    body.append(lane)
    lanes.set(r.id, { lane, car, sec, name, gauges, status, gaugeKey: "" })
  }
  const axis = el("div", { class: "ladder-axis" }, el("span", {}),
    el("div", { class: "axis-track" }, [0, 0.35, 0.7, 1.05, 1.4].map((v) => el("span", { style: `--p:${v / LADDER_MAX}` }, `${v.toFixed(2)} s`))), el("span", {}, "Found"), el("span", {}, "FIT"), el("span", {}, "Status"))
  const node = el("div", { class: "ladder", id: "lapLadder" }, axis, body)
  ladder = { node, lanes }
  updateLadder(rows)
  return node
}

function updateLadder(rows) {
  rows.forEach((r, i) => {
    const l = ladder.lanes.get(r.id)
    if (!l) return
    l.lane.style.transform = `translateY(${i * LANE_PX}px)`
    l.lane.classList.toggle("approved", r.approved)
    l.car.style.setProperty("--p", Math.min(1, r.seconds / LADDER_MAX).toFixed(3))
    l.car.dataset.seconds = r.seconds.toFixed(2)
    l.sec.textContent = r.seconds > 0 ? `−${r.seconds.toFixed(2)} s` : "0.00 s"
    const gaugeKey = JSON.stringify(r.fits)
    if (gaugeKey !== l.gaugeKey) {
      l.gaugeKey = gaugeKey
      l.gauges.replaceChildren(...r.fits.map((f) => miniFit(f.fit, { status: f.status, grey: !f.approved, size: 30, title: `${C.byId(C.STATIONS, f.id).name}: ${Number.isFinite(f.fit) ? `FIT ${f.fit}` : "not all locked"}${f.approved ? "" : " · not approved"}` })))
    }
    l.status.textContent = r.label
  })
}

function runRacePanel() {
  const password = el("input", { type: "password", id: "racePassword", placeholder: WORDS.racePassword, autocomplete: "off", maxlength: 64 })
  const go = async () => {
    if (!password.value) return toast(`Enter the ${WORDS.racePassword.toLowerCase()}`)
    if (playOpen(state) && !(await confirmDialog("Run the race now? Play ends for every table, and tables not approved race on today's Hinwil setup.", WORDS.runRace))) return
    try {
      await post("/api/race/run", { password: password.value }, false)
    } catch (err) {
      password.value = ""
      toast(err.message)
    }
  }
  password.addEventListener("keydown", (e) => e.key === "Enter" && go())
  return el("div", { class: "panel", id: "runRacePanel" }, el("h3", {}, WORDS.runRace),
    el("div", { class: "row" }, password, el("button", { class: "btn primary", id: "runRaceBtn", onclick: go }, WORDS.runRace),
      el("span", { class: "small muted" }, `The race password is the host PIN. ${C.FINALE.laps} laps: the ${WORDS.plan2027} against ${WORDS.vsToday}, at any time, with or without a timer.`)))
}

function renderWaiting() {
  const info = phaseHeader()
  sub.dataset.phase = info.id
  sub.textContent = info.line
  const team = customer()
  const rows = ladderRows()
  const skeleton = JSON.stringify(["wait", info.id, team && [team.id, team.name, team.color], state.settings.stations])
  if (skeleton === viewKey && ladder && document.getElementById("lapLadder")) return updateLadder(rows)
  if (document.activeElement?.id === "racePassword") return
  viewKey = skeleton
  ladder = null
  app.replaceChildren(el("div", { class: "projector" },
    el("div", { class: "panel phase-panel" }, el("div", { class: "phase-name" }, info.name),
      info.id === "open" ? null : el("div", { class: "phase-clock", id: "phaseClock" }, lapBox.textContent), el("p", { class: "muted" }, info.line)),
    el("div", { class: "panel" }, el("h2", {}, `Lap-time ladder · ${team?.name || C.CUSTOMER_TEAM.name}`), el("p", { class: "small muted" }, `Each table's car sits at the seconds per lap its approved design found; the ${WORDS.plan2027} adds them up and races against ${WORDS.vsToday}, which finds 0.00 s. FIT gauges are grey until the SA approves. The race runs on these seconds plus incidents.`),
      buildLadder(rows)),
    runRacePanel()))
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
    label.textContent = r.short || r.name
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
    el("div", {}, el("div", { class: "panel" }, el("h3", { style: "margin-bottom:8px" }, "Timing"), tower), el("div", { class: "row", style: "margin-top:10px" }, button("Skip to the result", () => finish())))))
  sub.dataset.phase = "race"
  sub.textContent = `Lights out at the ${C.FINALE.race}: the ${WORDS.plan2027} against ${WORDS.vsToday}!`
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
        tower.replaceChildren(...order.map((x, i) => el("div", {}, el("span", {}, i + 1), el("i", { style: `background:${x.r.color}` }), el("span", { class: "tname" }, x.r.short || x.r.name), el("span", {}, x.at.pit ? "PIT" : i === 0 ? "Leader" : `+${Math.max(0, gapOf(x)).toFixed(1)}s`))))
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

/* ------------------------------------------------------------ the result: plan against today, then the readout */

/** The customer's readout card for the finished race (the team as it is now, the race as it ran). */
function customerReadout() {
  const team = customer()
  return team ? readoutCard(readoutFor(team, state.race.result, state.settings.stations, state.race.budget || state.settings.budget)) : null
}

function renderResults() {
  const result = state.race.result
  const team = customer()
  const key = `results-${state.race.seed}-${team?.id}`
  if (viewKey === key) return
  viewKey = key
  lapBox.textContent = "FLAG"
  sub.dataset.phase = "race"
  const finale = finaleSummary(result)
  sub.textContent = `Chequered flag at the ${C.FINALE.race}: the ${WORDS.plan2027} ${finale.ahead ? `beats ${WORDS.vsToday} by ${finale.gap.toFixed(1)} s` : `finishes ${Math.abs(finale.gap).toFixed(1)} s behind ${WORDS.vsToday}`}.`
  const ids = state.settings.stations
  const classification = el("table", { class: "grid", id: "classification" },
    el("thead", {}, el("tr", {}, ["Pos", "Car", "Gap", "Tables approved", "Found per lap", "Best lap", "Pit stop", "Penalties"].map((h) => el("th", {}, h)))),
    el("tbody", {}, result.results.map((r) => el("tr", { "data-car": r.id },
      el("td", {}, r.position), el("td", {}, el("b", { style: `color:${r.color}` }, r.name), r.id === result.fastestLap ? " ⏱" : ""),
      el("td", {}, r.position === 1 ? `Winner · ${result.laps} laps` : `+${r.gap.toFixed(1)} s`),
      el("td", {}, `${ids.length - r.missed.length - r.notApproved.length}/${ids.length}`),
      el("td", {}, `${r.found.toFixed(2)} s`), el("td", {}, `${r.bestLap.toFixed(3)} s`), el("td", {}, r.pitLap ? `lap ${r.pitLap}` : "—"), el("td", {}, r.timePenalty ? `+${r.timePenalty.toFixed(1)} s` : "—")))))
  app.replaceChildren(el("div", { class: "race-report" }, finaleGraphic(result),
    el("div", { class: "panel" }, el("h2", { style: "margin-bottom:8px" }, `${C.FINALE.race} classification`), el("div", { class: "table-scroll" }, classification)),
    customerReadout()))
}

/** The readout phase: the customer's single readout, full screen, ready for a screenshot. */
function renderReadout() {
  const team = customer()
  const key = `readout-${state.race.seed}-${team?.id}`
  if (!team || viewKey === key) return
  viewKey = key
  sub.dataset.phase = "readout"
  sub.textContent = `${team.name} readout: what went well and what to do differently`
  app.replaceChildren(el("div", { class: "readout-page single" }, customerReadout()))
}

/** race.html?team=t1: the customer's readout on one screen, for a screenshot (any other id says so). */
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
    return app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "state-banner info" }, `There is no team "${teamParam}" in this game: the readout is at /race.html?team=${C.CUSTOMER_TEAM.id}.`)))
  }
  if (!state.race) {
    sub.textContent = `${team.name} readout`
    return app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "state-banner info" }, `${team.name}: the readout appears here after the race. Now: ${info.name}.`)))
  }
  sub.textContent = `${team.name} readout · ${C.FINALE.race}`
  app.replaceChildren(el("div", { class: "readout-page single" }, readoutCard(readoutFor(team, state.race.result, state.settings.stations, state.race.budget || state.settings.budget))))
}
