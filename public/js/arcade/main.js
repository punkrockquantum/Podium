/**
 * The arcade's entry point: screens (pick → lights → race → results → name → league), keyboard and
 * touch input, the requestAnimationFrame loop with fixed-step physics, and the `?test=1` hooks.
 *
 * Everything that can be unit-tested lives in track/physics/ai/race/league/launch; this file is the
 * glue around the DOM.
 */
import { defaultTrack } from "./track.js"
import { DT, carParams, formatMs } from "./physics.js"
import { createRace, startRace, raceStep, classification, advantageRecap, LAP_OPTIONS, DEFAULT_LAPS } from "./race.js"
import { createRenderer, createMinimap } from "./render.js"
import { createHud, resultsRows } from "./hud.js"
import { createAudio } from "./audio.js"
import { fetchLeague, submitLap, renderLeague } from "./league.js"
import { readCar, builtInCars, clearCar, seasonNote, availabilityText, advantageText, normalizeCar } from "./launch.js"

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]
const query = new URLSearchParams(location.search)
const TEST = query.get("test") === "1"
const LIGHT_S = TEST ? 0.12 : 1.0
const RESULTS_DELAY_S = TEST ? 0.3 : 1.6

const track = defaultTrack()
const canvas = $("#game")
const renderer = createRenderer(canvas, track)
const minimap = createMinimap($("#minimap"), track)
const hud = createHud($("#hud"))
const audio = createAudio()

const app = {
  state: "pick",
  cars: [],
  handed: null,
  selected: null,
  laps: DEFAULT_LAPS,
  race: null,
  paused: false,
  assistOn: true,
  crt: false,
  lights: { t: 0, lit: 0, holdS: 0.9, out: false },
  keys: new Set(),
  touch: new Set(),
  results: null,
  lastRank: null,
  leagueHighlight: null,
}

/* ---------- screens ---------- */

const SCREENS = ["pick", "stage", "results", "league"]
function show(name) {
  for (const id of SCREENS) {
    const node = $(`#screen-${id}`)
    if (node) node.hidden = id !== name
  }
  document.body.dataset.screen = name
}

function setState(next) {
  app.state = next
  document.body.dataset.state = next
  if (next === "pick") show("pick")
  else if (next === "lights" || next === "race" || next === "finish") show("stage")
  else if (next === "results" || next === "name") show("results")
  else if (next === "league") show("league")
}

/* ---------- the pick screen ---------- */

function carCard(spec, kind) {
  const params = carParams(spec)
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = `car-card${kind === "handed" ? " handed" : ""}`
  btn.dataset.id = spec.id || "handed"
  btn.dataset.season = spec.season
  const facts = [
    ["Season", String(spec.season)],
    ["vs Today", advantageText(spec.secondsPerLapVsToday)],
    ["Aero", `${params.aeroPct >= 0 ? "+" : ""}${params.aeroPct} %`],
    ["Pit wall", `${spec.dataToDecisionS.toFixed(1)} s · boost ${params.boostRechargeS} s`],
    ["Availability", availabilityText(spec.availabilityPct)],
  ]
  if (spec.effectiveMauh) facts.push(["Compute", `${spec.effectiveMauh} MAUh`])
  const tag = kind === "handed" ? "FROM THE PLAN" : spec.secondsPerLapVsToday === 0 ? "BASELINE" : spec.season === 2028 ? "BIGGEST STEP" : "STEP ONE"
  btn.innerHTML = `
    <span class="tag">${tag}</span>
    <span class="name"></span>
    <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <span class="why"></span>`
  btn.querySelector(".name").textContent = spec.label
  btn.querySelector(".why").textContent = seasonNote(spec)
  btn.addEventListener("click", () => selectCar(spec, btn))
  return btn
}

function selectCar(spec, node) {
  app.selected = spec
  $$(".car-card").forEach((c) => c.classList.toggle("selected", c === node))
  $("#race-now").disabled = false
  $("#picked").textContent = `${spec.label} · ${advantageText(spec.secondsPerLapVsToday)} · ${availabilityText(spec.availabilityPct)}`
}

async function buildPick() {
  const grid = $("#car-grid")
  grid.replaceChildren()
  app.cars = await builtInCars()
  const handed = app.handed
  let first = null
  if (handed) {
    const sameAsBuiltIn = app.cars.find((c) => c.label === handed.label && Math.abs(c.secondsPerLapVsToday - handed.secondsPerLapVsToday) < 0.005)
    if (!sameAsBuiltIn) {
      first = carCard(handed, "handed")
      grid.append(first)
    }
  }
  for (const spec of app.cars) {
    const card = carCard(spec, "built-in")
    grid.append(card)
    if (handed && !first && spec.label === handed.label) first = card
  }
  const chosen = first || grid.children[grid.children.length - 1]
  const chosenSpec = handed && first ? (first.classList.contains("handed") ? handed : app.cars.find((c) => c.label === handed.label)) : app.cars[app.cars.length - 1]
  if (chosen && chosenSpec) selectCar(chosenSpec, chosen)
  $("#handed-note").hidden = !handed
  $$("#laps button").forEach((b) => b.classList.toggle("selected", Number(b.dataset.laps) === app.laps))
}

/* ---------- race flow ---------- */

function newRace() {
  const seed = TEST ? 7 : (Math.random() * 2 ** 31) | 0
  app.race = createRace({ track, car: app.selected, laps: app.laps, seed })
  renderer.setAssist(app.race.player.params)
  renderer.follow(app.race.player, 0, true)
  app.results = null
  app.lastRank = null
  app.paused = false
  $("#pause").hidden = true
  app.lights = { t: 0, lit: 0, holdS: TEST ? 0.1 : 0.4 + Math.random() * 1.0, out: false }
  $$("#lights .light").forEach((l) => l.classList.remove("on"))
  $("#lights").hidden = false
  $("#lights").classList.remove("out")
  $("#flag").hidden = true
  $("#car-name").textContent = app.selected.label
  setState("lights")
}

function goGreen() {
  $("#lights").classList.add("out")
  setTimeout(() => ($("#lights").hidden = true), 400)
  startRace(app.race)
  setState("race")
  hud.flash("GO!", 900)
  audio.go()
}

function stepLights(dtReal) {
  const L = app.lights
  L.t += dtReal
  if (!L.out) {
    const shouldBeLit = Math.min(5, Math.floor(L.t / LIGHT_S) + 1)
    while (L.lit < shouldBeLit) {
      $$("#lights .light")[L.lit].classList.add("on")
      L.lit += 1
      audio.light(L.lit)
    }
    if (L.lit >= 5 && L.t >= 5 * LIGHT_S + L.holdS) {
      L.out = true
      goGreen()
    }
  }
}

function playerInput() {
  const k = app.keys
  const t = app.touch
  const has = (...names) => names.some((n) => k.has(n) || t.has(n))
  return {
    throttle: has("ArrowUp", "KeyW") ? 1 : 0,
    brake: has("ArrowDown", "KeyS") ? 1 : 0,
    steer: (has("ArrowRight", "KeyD") ? 1 : 0) - (has("ArrowLeft", "KeyA") ? 1 : 0),
    boost: has("Space"),
  }
}

function handleEvents() {
  const race = app.race
  const player = race.player
  for (const e of race.events) {
    if (e.car !== player.id) continue
    if (e.type === "lap") {
      const best = player.bestLapMs === e.lapMs
      hud.flash(`LAP ${e.lap}  ${formatMs(e.lapMs)}${best && player.laps.length > 1 ? "  BEST!" : ""}`, 2200)
      audio.lap()
    } else if (e.type === "sector") audio.sector(player.bestSectorsMs[e.sector - 1] === e.ms)
    else if (e.type === "boost") audio.boost()
    else if (e.type === "glitch") {
      hud.flash("TELEMETRY GLITCH  power -65%", 1200)
      audio.glitch()
    } else if (e.type === "wall") audio.bump()
  }
  if (race.events.some((e) => e.type === "finish" && e.car === player.id)) {
    $("#flag").hidden = false
    hud.flash(`CHEQUERED FLAG  P${classification(race).findIndex((r) => r.car === player) + 1}`, 2400)
    audio.finish()
    setState("finish")
  }
  race.events.length = 0
}

function showResults() {
  const race = app.race
  const rows = resultsRows(race)
  const player = race.player
  const pos = rows.find((r) => r.isPlayer).pos
  app.results = { rows, pos }
  const body = $("#results-body")
  body.replaceChildren()
  for (const r of rows) {
    const tr = document.createElement("tr")
    if (r.isPlayer) tr.className = "mine"
    const cells = [`P${r.pos}`, r.isPlayer ? `${r.name} (YOU)` : r.name, r.bestLap, r.gap]
    cells.forEach((v, i) => {
      const td = document.createElement("td")
      td.textContent = v
      if (i === 1) td.style.setProperty("--swatch", r.color)
      if (i === 1) td.className = "swatch"
      tr.append(td)
    })
    body.append(tr)
  }
  const recap = advantageRecap(player.spec, player.params)
  $("#results-title").textContent = pos === 1 ? "YOU WIN!" : pos <= 3 ? `PODIUM · P${pos}` : `FINISHED P${pos}`
  $("#results-sub").textContent = `${player.spec.label} · best lap ${formatMs(player.bestLapMs)} · ${race.laps} lap${race.laps === 1 ? "" : "s"} · ${player.boostsUsed} boost${player.boostsUsed === 1 ? "" : "s"} · ${player.glitches} glitch${player.glitches === 1 ? "" : "es"}`
  $("#recap-headline").textContent = recap.headline
  const list = $("#recap-lines")
  list.replaceChildren()
  for (const line of recap.lines) {
    const li = document.createElement("li")
    const b = document.createElement("b")
    b.textContent = `${line.title}: `
    li.append(b, document.createTextNode(line.text))
    list.append(li)
  }
  const canSave = Number.isInteger(player.bestLapMs)
  $("#name-form").hidden = !canSave
  $("#no-lap").hidden = canSave
  $("#name-error").textContent = ""
  setState(canSave ? "name" : "results")
  if (canSave) setTimeout(() => $("#name").focus(), 50)
}

async function saveLap(event) {
  event?.preventDefault()
  const race = app.race
  const player = race.player
  const name = $("#name").value.trim()
  const err = $("#name-error")
  if (name.length < 1 || name.length > 24) {
    err.textContent = "Enter a name of 1 to 24 characters."
    return
  }
  const button = $("#save-lap")
  button.disabled = true
  try {
    const result = await submitLap({
      name,
      bestLapMs: player.bestLapMs,
      season: player.spec.season,
      carLabel: player.spec.label,
      advantageS: player.spec.secondsPerLapVsToday,
      laps: race.laps,
      finishPos: app.results.pos,
    })
    app.lastRank = result.rank
    app.leagueHighlight = result.row?.id || null
    await openLeague(`${name}: rank ${result.rank} of ${result.total} with ${formatMs(player.bestLapMs)}${result.source === "local" ? " (saved on this laptop: the server was unreachable)" : ""}`)
  } catch (e) {
    err.textContent = e.message || "Could not save the lap."
  } finally {
    button.disabled = false
  }
}

async function openLeague(status = "") {
  setState("league")
  const statusNode = $("#league-status")
  statusNode.textContent = status || "Loading…"
  try {
    const { rows, total, source } = await fetchLeague(50)
    renderLeague($("#league-body"), rows, app.leagueHighlight)
    if (!status) statusNode.textContent = total ? `${total} lap${total === 1 ? "" : "s"} on the board${source === "local" ? " (this laptop only)" : ""}` : "No laps yet. Race now and set the first time."
    const mine = $("#league-body tr.mine")
    if (mine) mine.scrollIntoView({ block: "center" })
  } catch (e) {
    statusNode.textContent = `Could not load the league: ${e.message}`
  }
}

function backToPick() {
  app.race = null
  $("#flag").hidden = true
  $("#pause").hidden = true
  setState("pick")
  if (location.hash) history.replaceState(null, "", location.pathname + location.search)
}

function togglePause() {
  if (app.state !== "race") return
  app.paused = !app.paused
  $("#pause").hidden = !app.paused
}

function toggleCrt(force) {
  app.crt = typeof force === "boolean" ? force : !app.crt
  $("#screen-stage").classList.toggle("crt", app.crt)
  $("#crt-toggle")?.setAttribute("aria-pressed", String(app.crt))
  try {
    localStorage.setItem("podium.arcade.crt", app.crt ? "1" : "0")
  } catch {}
}

function toggleMute() {
  const muted = audio.toggle()
  $("#mute-toggle")?.setAttribute("aria-pressed", String(!muted))
  $("#mute-toggle") && ($("#mute-toggle").textContent = muted ? "SOUND OFF · M" : "SOUND ON · M")
}

/* ---------- the loop ---------- */

let last = performance.now()
let acc = 0
let finishWait = 0
function frame(now) {
  const dtReal = Math.min(0.1, Math.max(0, (now - last) / 1000))
  last = now
  const race = app.race
  if (app.state === "lights") stepLights(dtReal)
  if ((app.state === "race" || app.state === "finish") && !app.paused && race) {
    acc += dtReal
    let steps = 0
    while (acc >= DT && steps < 24) {
      raceStep(race, app.state === "race" ? playerInput() : { throttle: 0, brake: 0.3, steer: 0, boost: false }, DT)
      acc -= DT
      steps += 1
    }
    handleEvents()
    if (race.player.sliding || (race.player.onGrass && race.player.speed > 15)) renderer.addSkid(race.player)
    for (const car of race.cars) if (car !== race.player && car.sliding && Math.random() < 0.5) renderer.addSkid(car)
    if (app.state === "finish") {
      finishWait += dtReal
      if (finishWait >= RESULTS_DELAY_S) {
        finishWait = 0
        showResults()
      }
    }
  }
  if (race && (app.state === "lights" || app.state === "race" || app.state === "finish")) {
    renderer.follow(race.player, dtReal)
    renderer.render({ race, player: race.player, assistOn: app.assistOn })
    hud.update(race, app.assistOn, now)
    minimap.draw(race, race.player)
    audio.engine(race.player, app.state === "race")
  }
  requestAnimationFrame(frame)
}

/* ---------- input ---------- */

const GAME_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyW", "KeyA", "KeyS", "KeyD"])
document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  if (typing) return
  const inStage = app.state === "lights" || app.state === "race" || app.state === "finish"
  if (GAME_KEYS.has(e.code)) {
    app.keys.add(e.code)
    if (inStage) e.preventDefault()
  }
  if (e.repeat) return
  switch (e.code) {
    case "KeyP":
      togglePause()
      break
    case "KeyR":
      if (app.race && app.state !== "pick") newRace()
      break
    case "Escape":
      if (app.state === "race" || app.state === "finish" || app.state === "lights" || app.state === "results" || app.state === "name" || app.state === "league") backToPick()
      break
    case "KeyM":
      toggleMute()
      break
    case "KeyC":
      toggleCrt()
      break
    case "KeyH":
      if (inStage) {
        app.assistOn = !app.assistOn
        hud.flash(app.assistOn ? "PIT WALL ON" : "PIT WALL OFF", 900)
      }
      break
    case "Enter":
      if (app.state === "pick" && app.selected) newRace()
      else if (app.state === "results") openLeague()
      break
    default:
  }
})
document.addEventListener("keyup", (e) => app.keys.delete(e.code))
window.addEventListener("blur", () => app.keys.clear())

for (const pad of $$("#touch [data-key]")) {
  const code = pad.dataset.key
  const down = (e) => {
    e.preventDefault()
    app.touch.add(code)
    pad.classList.add("down")
  }
  const up = (e) => {
    e?.preventDefault?.()
    app.touch.delete(code)
    pad.classList.remove("down")
  }
  pad.addEventListener("pointerdown", down)
  pad.addEventListener("pointerup", up)
  pad.addEventListener("pointercancel", up)
  pad.addEventListener("pointerleave", up)
}

/* ---------- wiring ---------- */

$("#race-now").addEventListener("click", () => app.selected && newRace())
$$("#laps button").forEach((b) =>
  b.addEventListener("click", () => {
    app.laps = LAP_OPTIONS.includes(Number(b.dataset.laps)) ? Number(b.dataset.laps) : DEFAULT_LAPS
    $$("#laps button").forEach((x) => x.classList.toggle("selected", x === b))
  }),
)
$("#name-form").addEventListener("submit", saveLap)
$("#skip-name").addEventListener("click", () => openLeague())
$$("[data-action=league]").forEach((b) => b.addEventListener("click", () => openLeague()))
$$("[data-action=again]").forEach((b) => b.addEventListener("click", () => (app.selected ? newRace() : backToPick())))
$$("[data-action=pick]").forEach((b) => b.addEventListener("click", backToPick))
$("#crt-toggle")?.addEventListener("click", () => toggleCrt())
$("#mute-toggle")?.addEventListener("click", toggleMute)
$("#forget-car")?.addEventListener("click", () => {
  clearCar()
  app.handed = null
  buildPick()
})
window.addEventListener("hashchange", () => {
  if (location.hash === "#league") openLeague()
})

/* ---------- test hooks ---------- */

if (TEST) {
  window.__arcade = {
    app,
    track,
    get state() {
      return app.state
    },
    get race() {
      return app.race
    },
    pick(id) {
      const card = $(`.car-card[data-id="${id}"]`)
      card?.click()
      return Boolean(card)
    },
    start() {
      if (app.selected) newRace()
    },
    /** Finish the player's race at once with a given best lap (the sim keeps the rivals honest). */
    debugFinish(bestLapMs = 58123) {
      const race = app.race
      if (!race || !race.started) return false
      const p = race.player
      if (!Number.isInteger(p.bestLapMs) || p.bestLapMs > bestLapMs) p.bestLapMs = bestLapMs
      p.lastLapMs = p.lastLapMs ?? bestLapMs
      if (!p.laps.length) p.laps.push(bestLapMs)
      p.lap = race.laps
      p.finished = true
      p.finishT = race.t
      p.progress = race.laps + 0.001
      p.events.push({ type: "finish", at: race.t })
      return true
    },
    hudText() {
      return Object.fromEntries($$("#hud [data-hud]").map((n) => [n.dataset.hud, n.textContent]))
    },
    /** Let the rivals' AI drive the player's car (screenshots, soak runs). */
    async autopilot(on = true) {
      const race = app.race
      if (!race) return false
      if (!on) return race.drivers.delete(race.player)
      const { createDriver, prepareDriver } = await import("./ai.js")
      const d = createDriver({ skill: 0.9, useBoost: true })
      prepareDriver(d, track, race.player)
      race.drivers.set(race.player, d)
      return true
    },
  }
}

/* ---------- boot ---------- */

async function boot() {
  app.handed = readCar()
  try {
    toggleCrt(localStorage.getItem("podium.arcade.crt") === "1")
  } catch {}
  if (query.get("laps") && LAP_OPTIONS.includes(Number(query.get("laps")))) app.laps = Number(query.get("laps"))
  await buildPick()
  if (location.hash === "#league") await openLeague()
  else setState("pick")
  document.body.classList.add("ready")
  requestAnimationFrame((t) => {
    last = t
    requestAnimationFrame(frame)
  })
}
boot()

export { app, normalizeCar }
