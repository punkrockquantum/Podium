import * as C from "/js/catalog.js"
import { boardFor } from "/js/model.js"
import { createBoard, staticBoard, learningCard } from "/js/board.js"
import { planSheet, queueStatus } from "/js/plan.js"
import { designStatus, PITCH_SECONDS } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs } from "/js/session.js"
import { el, clock, post, watchState, gameClock, installErrorLogging, instructionsButton, WORDS, button, stateBanner, panel, teamChip, tabBar } from "/js/ui.js"

installErrorLogging("table")

const params = new URLSearchParams(location.search)
const requested = params.get("station") || ""
const station = C.byId(C.STATIONS, requested)
const app = document.getElementById("app")
const strip = document.getElementById("teamStrip")
const timerBox = document.getElementById("timer")
const roundTag = document.getElementById("roundTag")
document.getElementById("tools").replaceChildren(instructionsButton("team"), button(WORDS.returnHome, () => returnHome(), { small: true }))

if (!station) {
  const old = C.RETIRED_STATIONS[requested]
  document.title = "Podium · Table not in play"
  document.getElementById("stationName").textContent = old ? `${old} table` : "Unknown table"
  app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "panel step-zero" },
    el("h2", {}, "This table is not in play"),
    el("p", {}, old ? `The ${old} table is not part of this game. Podium 2027 now has four tables.` : "This link does not match a table in this game."),
    el("div", { class: "tiles" }, C.STATIONS.map((s) => el("a", { class: "tile", href: `/station.html?station=${s.id}`, style: `--c:${s.color}` }, el("b", {}, s.name), el("span", { class: "muted" }, s.architect)))),
    el("div", { class: "actions" }, el("a", { class: "btn primary", href: "/", style: "display:inline-flex;align-items:center;text-decoration:none" }, WORDS.returnHome)))))
  timerBox.textContent = "--:--"
  roundTag.textContent = ""
} else {
  startTable()
}

function returnHome() {
  location.href = "/"
}

function startTable() {
  const KEY_TEAM = `podium-team-${station.id}`
  document.title = `Podium · ${station.name}`
  document.getElementById("stationName").textContent = station.name
  document.getElementById("pitchTo").textContent = `Pitch to: ${station.architect}`

  let state = null
  let offset = 0
  let tab = "tune"
  let teamId = sessionStorage.getItem(KEY_TEAM) || ""
  let pending = {}
  let lastKey = ""
  let gameId = null
  /** The live Tune board, kept across polls so needles animate instead of jumping. */
  let tune = null

  const toast = (text) => {
    const node = el("div", { class: "toast" }, text)
    document.body.append(node)
    setTimeout(() => node.remove(), 2200)
  }

  const watcher = watchState((next, off) => {
    state = next
    offset = off
    if (!gameClock(state)) {
      strip.classList.add("hidden")
      app.replaceChildren(el("div", { class: "workspace-single" }, stateBanner("Reconnecting to the game server. This page retries every second.", "info")))
      lastKey = ""
      tune = null
      return
    }
    if (gameId && state.id !== gameId) forgetTeam()
    gameId = state.id
    seatHere()
    render(false)
  })

  function forgetTeam() {
    teamId = ""
    pending = {}
    tune = null
    sessionStorage.removeItem(KEY_TEAM)
  }

  /** Check the chosen team in at this table once play is open (the host's live feed shows it). */
  let checkingIn = false
  function seatHere() {
    const team = state?.teams?.find((t) => t.id === teamId)
    if (!team || checkingIn || phaseOf(state) !== "play") return
    if (state.tables?.[station.id]?.team === team.id) return
    checkingIn = true
    post(`/api/teams/${team.id}/checkin`, { station: station.id }).then(() => watcher.refresh()).catch(() => {}).finally(() => { checkingIn = false })
  }

  setInterval(() => {
    const team = state?.teams?.find((t) => t.id === teamId)
    if (!team || document.hidden || document.body.classList.contains("offline")) return
    post(`/api/teams/${team.id}/presence`, { station: station.id, step: tab }).catch(() => {})
  }, 5000)

  async function switchTeam() {
    const team = currentTeam()
    if (team) await post(`/api/teams/${team.id}/checkout`, { station: station.id }).catch(() => {})
    forgetTeam()
    tab = "tune"
    render(true)
  }

  function currentTeam() {
    if (!teamId || !state?.teams?.length) return null
    const team = state.teams.find((t) => t.id === teamId)
    if (!team) forgetTeam()
    return team || null
  }

  function chooseTeam(id) {
    teamId = id
    pending = {}
    tune = null
    sessionStorage.setItem(KEY_TEAM, id)
    tab = "tune"
    seatHere()
    render(true)
    window.scrollTo({ top: 0 })
  }

  function goTab(name) {
    tab = name
    render(true)
    window.scrollTo({ top: 0 })
  }

  const budget = () => state.settings.budget || C.DEFAULT_BUDGET
  const choicesNow = (team) => ({ ...team.choices, ...pending })
  const notInPlay = () => !state.settings.stations.includes(station.id)

  /* ------------------------------------------------------------ learning moments */

  const learnedKey = () => `podium-learned-${state.id}-${teamId}`
  const learned = () => { try { return new Set(JSON.parse(sessionStorage.getItem(learnedKey()) || "[]")) } catch { return new Set() } }
  const markLearned = () => sessionStorage.setItem(learnedKey(), JSON.stringify([...learned(), station.id]))

  /** Why dials are closed for everyone right now, or null. */
  function phaseReason() {
    const phase = phaseOf(state)
    if (phase === "lobby") return ["Choose your team and read the problem. Dials open when the host starts play.", "info"]
    if (phase === "brief" || phase === "briefDone") return [`${WORDS.listen}. Dials open when play starts.`, "warn"]
    if (phase === "ended") return [`Time is up: every table is locked. Tables not approved race on ${WORDS.todaySetup.toLowerCase()}.`, "bad"]
    if (phase === "race" || phase === "readout") return ["The race has run: the dials are locked.", "bad"]
    return null
  }

  function banner(team) {
    if (notInPlay()) return stateBanner("This table is not in play in this game. Use Return to home to choose another table.", "bad")
    const reason = phaseReason()
    if (reason) return stateBanner(...reason)
    if (!team) return null
    const d = designStatus(state, team, station.id)
    if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}: this board races as tuned.`, "good")
    if (d.plan) return stateBanner(`Locked in as plan ${d.plan.id}: the dials are frozen until the Architect decides.`, "info")
    if (d.status === "sentBack") return stateBanner(`${d.label}. Retune, lock in again and call the Architect.`, "warn")
    return null
  }

  const dialsLocked = (team) => Boolean(phaseReason()) || notInPlay() || Boolean(team.plans?.[station.id])

  /* ------------------------------------------------------------ header */

  function renderClock() {
    const phase = phaseOf(state)
    const ms = phaseRemainingMs(state, offset)
    timerBox.textContent = Number.isFinite(ms) ? clock(ms) : phase === "ended" ? "TIME" : "RACE"
    timerBox.classList.toggle("warn", phase === "play" && ms < 300_000 && ms > 0)
    timerBox.classList.toggle("over", phase === "ended")
    roundTag.textContent = `${phaseInfo(phase).name}${state.clock.status === "paused" ? " · paused" : ""}`
  }

  setInterval(() => {
    try {
      if (state && gameClock(state)) renderClock()
      const pitch = document.getElementById("stationPitch")
      if (pitch) pitch.textContent = clock(Number(pitch.dataset.ends) - (Date.now() + offset))
    } catch (err) {
      console.error("[podium] timer", err)
    }
  }, 250)

  function renderStrip(team) {
    strip.classList.toggle("hidden", !team)
    if (!team) return strip.replaceChildren()
    strip.replaceChildren(teamChip(team), el("span", { class: "muted small" }, `${station.name} · ${C.budgetFor(budget()).name} budget`), button(WORDS.switchTeam, () => switchTeam(), { small: true }))
  }

  /* ------------------------------------------------------------ step 0: choose your team */

  function renderStepZero() {
    const nodes = [el("h2", {}, WORDS.chooseTeam), el("p", { class: "muted" }, `${station.name} · pitch to the ${station.architect}.`)]
    const b = banner(null)
    if (b) nodes.push(b)
    if (!state.teams.length) nodes.push(stateBanner("The host has not created the teams yet.", "info"))
    nodes.push(el("div", { class: "team-grid", id: "teamGrid" }, state.teams.map((t) => {
      const at = Object.entries(state.tables || {}).find(([, seat]) => seat.team === t.id)?.[0]
      const where = at === station.id ? "Checked in here" : at ? `At ${C.byId(C.STATIONS, at)?.name || at}` : "Free to start here"
      return el("button", { class: "team-button", "data-team": t.id, onclick: () => chooseTeam(t.id) }, el("i", { style: `background:${t.color}` }), el("b", {}, t.name), el("span", {}, where))
    })))
    app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "panel step-zero" }, ...nodes)))
  }

  /* ------------------------------------------------------------ 1 · Scenario & Tune */

  /** On scroll the scene shrinks to a sticky strip that keeps animating and keeps the seconds. */
  let compact = false
  window.addEventListener("scroll", () => {
    const scene = document.querySelector("#tuneBoard .scene")
    if (!scene) return
    const next = compact ? window.scrollY > 40 : window.scrollY > 220
    if (next !== compact) {
      compact = next
      scene.classList.toggle("compact", compact)
    }
  }, { passive: true })

  function turn(team, decisionId, value) {
    if (dialsLocked(team)) return toast(banner(team)?.textContent || "The dials are locked")
    const before = tune?.view.board()
    pending[decisionId] = value
    const after = tune.view.update(choicesNow(team), { locked: false })
    if (after.inZone && !before?.inZone && !learned().has(station.id)) {
      markLearned()
      showLesson()
    }
    post(`/api/teams/${team.id}/choices`, { station: station.id, choices: { [decisionId]: value } })
      .then(() => post(`/api/teams/${team.id}/sim`, { station: station.id }).catch(() => {}))
      .then(() => watcher.refresh())
      .catch((err) => {
        delete pending[decisionId]
        tune?.view.update(choicesNow(team), { locked: dialsLocked(team) })
        toast(err.message)
      })
  }

  function showLesson() {
    if (!tune) return
    tune.lesson.replaceChildren(learningCard(station.id, { onClose: () => tune?.lesson.replaceChildren() }))
  }

  function renderTune(team) {
    const view = createBoard({ stationId: station.id, budget: budget(), interactive: true, onDial: (d, o) => turn(currentTeam(), d, o), id: "tuneBoard", sticky: true })
    view.update(choicesNow(team), { locked: dialsLocked(team) })
    compact = false
    const lesson = el("div", { class: "lesson-slot" })
    tune = { key: tuneKey(team), view, lesson }
    return [lesson, view.el,
      el("div", { class: "actions" }, button("Go to Pitch", () => goTab("pitch"), { kind: view.board().inZone ? "primary" : "secondary" }))]
  }

  const tuneKey = (team) => JSON.stringify([state.id, team.id, budget(), station.id])

  /* ------------------------------------------------------------ 2 · Pitch */

  const act = (url, body, done) => post(url, body).then((res) => { if (done) toast(done); watcher.refresh(); return res }).catch((err) => { toast(err.message); throw err })

  function pitchStatus(team) {
    const d = designStatus(state, team, station.id)
    if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}: ${team.pitch?.[station.id] ?? d.review.points ?? 0} table points.`, "good")
    if (d.status === "pitching") return el("div", { class: "state-banner good pitch-now", role: "status" }, `${WORDS.pitching}: `, el("b", { id: "stationPitch", "data-ends": d.pitch.endsAt }, clock(d.pitch.endsAt - (Date.now() + offset))), ` · pitch to ${d.pitch.by}`)
    if (d.status === "waiting") {
      const q = queueStatus(state, team.id, station.id)
      return stateBanner(`${WORDS.waitingForArchitect}. ${q?.text || ""}`, q?.free ? "good" : "warn")
    }
    return null
  }

  function renderPitch(team) {
    const d = designStatus(state, team, station.id)
    const nodes = []
    if (state.race) nodes.push(el("div", { class: "actions" }, el("a", { class: "btn primary", href: `/race.html?team=${encodeURIComponent(team.id)}`, id: "readoutLink", style: "display:inline-flex;align-items:center;text-decoration:none" }, "Open your readout")))
    if (!d.plan) {
      const b = boardFor(station.id, choicesNow(team), budget())
      nodes.push(panel("Your board",
        stateBanner(b.inZone ? `${WORDS.inZone}: ${b.seconds.toFixed(2)} s per lap found (FIT ${b.fit}). Lock in and pitch it.` : `${b.outcome} You can still pitch it, but only an in-zone board scores well.`, b.inZone ? "good" : "warn"),
        staticBoard(station.id, choicesNow(team), budget(), { id: "pitchPreview", scene: "still" }),
        el("p", { class: "small muted" }, `Lock in freezes the dials and shows your board snapshot. Take a screenshot, then call the Architect and pitch in ${PITCH_SECONDS} seconds.`),
        el("div", { class: "actions" }, button(WORDS.lockIn, () => act(`/api/teams/${team.id}/submit`, { station: station.id }, `📸 ${WORDS.screenshot}`).catch(() => {}), { kind: "primary", disabled: dialsLocked(team) }))))
    } else {
      nodes.push(pitchStatus(team))
      if (d.status === "approved") nodes.push(learningCard(station.id, { id: "approvedLesson" }))
      if (d.status === "locked") nodes.push(el("div", { class: "actions" }, button(WORDS.callArchitect, () => act(`/api/teams/${team.id}/call`, { station: station.id }, "You are in the queue").catch(() => {}), { kind: "primary", disabled: Boolean(state.race) })))
      nodes.push(planSheet(team, d.plan, { review: d.review }))
    }
    return nodes
  }

  /* ------------------------------------------------------------ render */

  function render(force) {
    if (!state || !gameClock(state)) return
    renderClock()
    const team = currentTeam()
    if (team) for (const [k, v] of Object.entries(pending)) if (team.choices[k] === v) delete pending[k]
    const key = JSON.stringify([team, phaseOf(state), state.clock.status, state.queues?.[station.id], state.architects?.[station.id], state.pitches?.[station.id], state.teams.map((t) => [t.id, t.name]), state.tables, Boolean(state.race), state.settings, tab])
    if (!force && key === lastKey) return
    lastKey = key
    renderStrip(team)
    if (!team) {
      tune = null
      return renderStepZero()
    }
    const slot = document.getElementById("bannerSlot")
    if (tab === "tune" && tune && tune.key === tuneKey(team) && slot && document.getElementById("tuneBoard")) {
      slot.replaceChildren(...[banner(team)].filter(Boolean))
      tune.view.update(choicesNow(team), { locked: dialsLocked(team) })
      return
    }
    tune = null
    const view = tab === "pitch" ? renderPitch(team) : renderTune(team)
    app.replaceChildren(el("div", { class: "workspace-single wide" },
      el("main", {}, tabBar(tab, goTab), el("div", { id: "bannerSlot" }, banner(team)), el("section", { id: "view", class: `view view-${tab}` }, view))))
  }
}
