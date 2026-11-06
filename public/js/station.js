import * as C from "/js/catalog.js"
import { createBoard, learningCard } from "/js/board.js"
import { planSheet, queueStatus } from "/js/plan.js"
import { designStatus, lockedDials, ghostsAt, attemptWord, PITCH_SECONDS } from "/js/approval.js"
import { BRIEF_GATE_SECONDS } from "/js/briefs.js"
import { briefView } from "/js/briefview.js"
import { phaseOf, phaseInfo, phaseRemainingMs } from "/js/session.js"
import { el, clock, post, watchState, gameClock, installErrorLogging, instructionsButton, WORDS, button, stateBanner, panel, teamChip, tabBar, patchSlot, replaceKeepingScroll, setText } from "/js/ui.js"

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
  let tab = "brief"
  let teamId = sessionStorage.getItem(KEY_TEAM) || ""
  /** Dials tapped but not yet confirmed by the server (dial id → option id). */
  let pending = {}
  let gameId = null
  /** The structural key of what is on screen: the page is rebuilt only when it changes. */
  let shape = ""
  /** The live Tune board, kept across polls so needles animate instead of jumping. */
  let tune = null
  /** The brief gate: when this team opened the brief here, and whether they reached its end. */
  let gate = { key: "", openedAt: 0, reachedEnd: false, observer: null }

  const toast = (text) => {
    const node = el("div", { class: "toast" }, text)
    document.body.append(node)
    setTimeout(() => node.remove(), 2600)
  }

  const watcher = watchState((next, off) => {
    state = next
    offset = off
    if (!gameClock(state)) {
      strip.classList.add("hidden")
      app.replaceChildren(el("div", { class: "workspace-single" }, stateBanner("Reconnecting to the game server. This page retries every second.", "info")))
      shape = ""
      tune = null
      return
    }
    if (gameId && state.id !== gameId) forgetTeam()
    gameId = state.id
    seatHere()
    render()
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
    tab = "brief"
    render(true)
    window.scrollTo({ top: 0 })
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
    const team = currentTeam()
    tab = team && briefRead(team) ? "tune" : "brief"
    seatHere()
    render(true)
    window.scrollTo({ top: 0 })
  }

  /** Moving between steps is the one time the page scrolls on its own: a new step starts at the top. */
  function goTab(name) {
    const team = currentTeam()
    if (name !== "brief" && team && !briefRead(team)) return toast(`${WORDS.readTheBrief} first`)
    tab = name
    render(true)
    window.scrollTo({ top: 0 })
  }

  const budget = () => state.settings.budget || C.DEFAULT_BUDGET
  const choicesNow = (team) => ({ ...team.choices, ...pending })
  const notInPlay = () => !state.settings.stations.includes(station.id)
  const briefRead = (team) => Boolean(team.briefRead?.[station.id])
  const hasPlan = (team) => Boolean(team.plans?.[station.id])
  /** The dials this team has locked here, counting taps the server has not confirmed yet. */
  const chosenDials = (team) => [...new Set([...lockedDials(team, station.id), ...Object.keys(pending)])]
  const dialCount = C.decisionsFor(station.id).length

  /* ------------------------------------------------------------ learning moments */

  const learnedKey = () => `podium-learned-${state.id}-${teamId}`
  const learned = () => { try { return new Set(JSON.parse(sessionStorage.getItem(learnedKey()) || "[]")) } catch { return new Set() } }
  const markLearned = () => sessionStorage.setItem(learnedKey(), JSON.stringify([...learned(), station.id]))

  /** Why dials are closed for everyone right now, or null. */
  function phaseReason() {
    const phase = phaseOf(state)
    if (phase === "lobby") return ["Choose your team and read the brief. Choices open when the host starts play.", "info"]
    if (phase === "brief" || phase === "briefDone") return [`${WORDS.readTheBrief} now: choices open when the host starts play.`, "warn"]
    if (phase === "ended") return [`Time is up: every table is locked. Tables not approved race on ${WORDS.todaySetup.toLowerCase()}.`, "bad"]
    if (phase === "race" || phase === "readout") return ["The race has run: the dials are locked.", "bad"]
    return null
  }

  /** The one state banner for this team at this table: phase, not in play, approved, rejected, locked. */
  function banner(team) {
    if (notInPlay()) return stateBanner("This table is not in play in this game. Use Return to home to choose another table.", "bad")
    const reason = phaseReason()
    if (!team) return reason ? stateBanner(...reason) : null
    const d = designStatus(state, team, station.id)
    const nth = d.attempts > 1 ? ` on the ${attemptWord(d.attempts)}` : ""
    if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}${nth}: this board races as locked.`, "good")
    const phase = phaseOf(state)
    if (reason) {
      if (phase === "ended" && d.plan && !state.race) return stateBanner(`Time is up. Your three choices were locked in time: call the Solutions Architect and pitch. Until approved, this table races on ${WORDS.todaySetup.toLowerCase()}.`, "warn")
      if (phase === "ended" && (d.status === "rejected" || d.status === "adjusting")) return stateBanner(`Time is up: the design the SA rejected was not replaced, so this table races on ${WORDS.todaySetup.toLowerCase()}.`, "bad")
      return stateBanner(...reason)
    }
    if (d.status === "rejected" || d.status === "adjusting") {
      return el("div", { class: "state-banner bad rejected-banner", role: "status", id: "rejectedBanner" }, el("b", {}, WORDS.rejected(d.review?.reason)), d.status === "adjusting" ? ` ${WORDS.lockedCount(lockedDials(team, station.id).length, dialCount)}.` : "")
    }
    if (d.plan && tab !== "pitch") {
      if (d.status === "waiting") return stateBanner(`${WORDS.waitingForArchitect}. ${queueStatus(state, team.id, station.id)?.text || ""}`, "info")
      if (d.status === "pitching") return stateBanner(`${WORDS.pitching} to ${d.pitch.by}.`, "good")
      return stateBanner(`${WORDS.allLocked} (${WORDS.attempt(d.attempts).toLowerCase()}): go to Pitch and call the Solutions Architect.`, "info")
    }
    return null
  }

  const dialsLocked = (team) => Boolean(phaseReason()) || notInPlay() || hasPlan(team) || !briefRead(team)

  /* ------------------------------------------------------------ header */

  function renderClock() {
    const phase = phaseOf(state)
    const ms = phaseRemainingMs(state, offset)
    setText(timerBox, Number.isFinite(ms) ? clock(ms) : phase === "ended" ? "TIME" : "RACE")
    timerBox.classList.toggle("warn", phase === "play" && ms < 300_000 && ms > 0)
    timerBox.classList.toggle("over", phase === "ended")
    setText(roundTag, `${phaseInfo(phase).name}${state.clock.status === "paused" ? " · paused" : ""}`)
  }

  setInterval(() => {
    try {
      if (state && gameClock(state)) renderClock()
      const pitch = document.getElementById("stationPitch")
      if (pitch) setText(pitch, clock(Number(pitch.dataset.ends) - (Date.now() + offset)))
      tickGate()
    } catch (err) {
      console.error("[podium] timer", err)
    }
  }, 250)

  function renderStrip(team) {
    strip.classList.toggle("hidden", !team)
    if (!team) {
      strip.dataset.key = ""
      return strip.replaceChildren()
    }
    const key = JSON.stringify([team.id, team.name, team.color, budget()])
    if (strip.dataset.key === key) return
    strip.dataset.key = key
    strip.replaceChildren(teamChip(team), el("span", { class: "muted small" }, `${station.name} · ${C.budgetFor(budget()).name} budget`), button(WORDS.switchTeam, () => switchTeam(), { small: true }))
  }

  /* ------------------------------------------------------------ step 0: choose your team */

  function renderStepZero() {
    const key = JSON.stringify(["zero", phaseOf(state), state.teams.map((t) => [t.id, t.name, t.color]), state.tables, state.settings.stations])
    if (shape === key) return
    shape = key
    const nodes = [el("h2", {}, WORDS.chooseTeam), el("p", { class: "muted" }, `${station.name} · pitch to the ${station.architect}.`)]
    const b = banner(null)
    if (b) nodes.push(b)
    if (!state.teams.length) nodes.push(stateBanner("The host has not created the teams yet.", "info"))
    nodes.push(el("div", { class: "team-grid", id: "teamGrid" }, state.teams.map((t) => {
      const at = Object.entries(state.tables || {}).find(([, seat]) => seat.team === t.id)?.[0]
      const where = at === station.id ? "Checked in here" : at ? `At ${C.byId(C.STATIONS, at)?.name || at}` : "Free to start here"
      return el("button", { class: "team-button", "data-team": t.id, onclick: () => chooseTeam(t.id) }, el("i", { style: `background:${t.color}` }), el("b", {}, t.name), el("span", {}, where))
    })))
    replaceKeepingScroll(app, el("div", { class: "workspace-single" }, el("div", { class: "panel step-zero" }, ...nodes)))
  }

  /* ------------------------------------------------------------ 1 · Brief */

  /** The gate opens when the team reaches the end of the brief, or after BRIEF_GATE_SECONDS. */
  function gateOpen(team) {
    if (briefRead(team)) return true
    return gate.reachedEnd || (gate.openedAt > 0 && Date.now() - gate.openedAt >= BRIEF_GATE_SECONDS * 1000)
  }

  function tickGate() {
    const btn = document.getElementById("readBrief")
    const team = state && currentTeam()
    if (!btn || !team) return
    const open = gateOpen(team)
    if (btn.disabled === !open) return
    btn.disabled = !open
    document.getElementById("briefGateHint")?.classList.toggle("hidden", open)
  }

  function watchBriefEnd() {
    gate.observer?.disconnect()
    gate.observer = null
    const end = document.getElementById("briefEnd")
    if (!end || typeof IntersectionObserver !== "function") return
    gate.observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      gate.reachedEnd = true
      gate.observer?.disconnect()
      gate.observer = null
      tickGate()
    }, { threshold: 0 })
    gate.observer.observe(end)
  }

  function readBrief(team) {
    if (!gateOpen(team)) return
    if (briefRead(team)) return goTab("tune")
    const btn = document.getElementById("readBrief")
    if (btn) btn.disabled = true
    post(`/api/teams/${team.id}/brief`, { station: station.id })
      .then((res) => {
        if (res?.team) Object.assign(team, res.team)
        watcher.refresh()
        goTab("tune")
      })
      .catch((err) => {
        if (btn) btn.disabled = false
        toast(err.message)
      })
  }

  function renderBrief(team) {
    const key = `${state.id}:${team.id}:${station.id}`
    if (gate.key !== key) {
      gate.observer?.disconnect()
      gate = { key, openedAt: Date.now(), reachedEnd: false, observer: null }
    }
    const read = briefRead(team)
    const open = gateOpen(team)
    const beforeFirstLock = lockedDials(team, station.id).length === 0 && !hasPlan(team)
    requestAnimationFrame(watchBriefEnd)
    return [
      panel(null, briefView(station.id, { withEnd: true })),
      el("div", { class: "panel brief-gate", id: "briefGate" },
        el("div", { class: "actions" }, el("button", { class: "btn primary", id: "readBrief", disabled: !open, onclick: () => readBrief(team) }, read ? WORDS.goToDecisions : WORDS.readBrief)),
        read ? null : el("p", { class: `small muted${open ? " hidden" : ""}`, id: "briefGateHint" }, WORDS.briefGateHint),
        beforeFirstLock ? el("p", { class: "one-shot-warning", id: "oneShotWarning" }, el("b", {}, WORDS.oneShot)) : null),
    ]
  }

  /* ------------------------------------------------------------ 2 · Tune: one tap locks a dial */

  function turn(team, decisionId, value) {
    if (dialsLocked(team)) return toast(banner(team)?.textContent || "The dials are locked")
    if (team.choices[decisionId] !== undefined || pending[decisionId] !== undefined) return
    const before = tune?.view.board()
    pending[decisionId] = value
    const after = refreshTune(team)
    if (after?.inZone && !before?.inZone && !learned().has(station.id)) {
      markLearned()
      showLesson()
    }
    post(`/api/teams/${team.id}/choices`, { station: station.id, choices: { [decisionId]: value } })
      .then((res) => {
        if (res?.team) Object.assign(team, res.team)
        if (res?.plan) toast(`${WORDS.allLocked}: go to Pitch and ${WORDS.callArchitect.toLowerCase()}`)
        render()
        return post(`/api/teams/${team.id}/sim`, { station: station.id }).catch(() => {})
      })
      .then(() => watcher.refresh())
      .catch((err) => {
        delete pending[decisionId]
        refreshTune(team)
        toast(err.message)
      })
  }

  function showLesson() {
    if (!tune) return
    tune.lesson.replaceChildren(learningCard(station.id, { onClose: () => tune?.lesson.replaceChildren() }))
  }

  /** Move the live board to the team's current picks without rebuilding it. */
  function refreshTune(team) {
    if (!tune) return null
    return tune.view.update(choicesNow(team), { locked: dialsLocked(team), chosen: chosenDials(team), ghosts: ghostsAt(team, station.id) })
  }

  function renderTune(team) {
    const view = createBoard({ stationId: station.id, budget: budget(), interactive: true, onDial: (d, o) => turn(currentTeam(), d, o), id: "tuneBoard", sticky: true })
    const lesson = el("div", { class: "lesson-slot" })
    tune = { view, lesson }
    refreshTune(team)
    return [lesson, el("div", { id: "oneShotSlot" }), view.el, el("div", { id: "tuneActions", class: "actions" })]
  }

  /**
   * The parts of Tune that change with the team's progress: the one-shot banner and the step button.
   * The banner stays for the whole step (its words change, its height does not), so a lock never
   * shifts the dials under the team's finger.
   */
  function patchTune(team) {
    const locked = lockedDials(team, station.id).length
    const plan = hasPlan(team)
    const mode = plan ? "done" : briefRead(team) ? "warn" : "none"
    patchSlot(document.getElementById("oneShotSlot"), [mode], () => {
      if (mode === "none") return null
      if (mode === "done") return el("div", { class: "state-banner good one-shot-banner", role: "status", id: "oneShotBanner" }, el("b", {}, `🔒 ${WORDS.allLocked}. Go to Pitch and ${WORDS.callArchitect.toLowerCase()}.`))
      return el("div", { class: "state-banner warn one-shot-banner", role: "status", id: "oneShotBanner" }, el("b", {}, WORDS.oneShot))
    })
    patchSlot(document.getElementById("tuneActions"), [plan, locked], () => button(WORDS.goToPitch, () => goTab("pitch"), { kind: plan ? "primary" : "secondary", title: plan ? WORDS.allLocked : WORDS.lockedCount(locked, dialCount) }))
    refreshTune(team)
  }

  /* ------------------------------------------------------------ 3 · Pitch */

  const act = (url, body, done) => post(url, body).then((res) => { if (done) toast(done); watcher.refresh(); return res }).catch((err) => { toast(err.message); throw err })

  function pitchStatus(team) {
    const d = designStatus(state, team, station.id)
    const nth = d.attempts > 1 ? ` on the ${attemptWord(d.attempts)}` : ""
    if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}${nth}: ${team.pitch?.[station.id] ?? d.review.points ?? 0} table points.`, "good")
    if (d.status === "pitching") return el("div", { class: "state-banner good pitch-now", role: "status" }, `${WORDS.pitching}: `, el("b", { id: "stationPitch", "data-ends": d.pitch.endsAt }, clock(d.pitch.endsAt - (Date.now() + offset))), ` · pitch to ${d.pitch.by}`)
    if (d.status === "waiting") {
      const q = queueStatus(state, team.id, station.id)
      return stateBanner(`${WORDS.waitingForArchitect}. ${q?.text || ""}`, q?.free ? "good" : "warn")
    }
    return null
  }

  function renderPitch() {
    return [el("div", { id: "pitchStatus" }), el("div", { id: "pitchBody" })]
  }

  function patchPitch(team) {
    const d = designStatus(state, team, station.id)
    const q = queueStatus(state, team.id, station.id)
    patchSlot(document.getElementById("pitchStatus"), JSON.stringify([d.status, d.attempts, d.pitch?.endsAt, q?.position, q?.free, team.pitch?.[station.id]]), () => pitchStatus(team))
    patchSlot(document.getElementById("pitchBody"), JSON.stringify([d.plan?.id, d.status, d.attempts, Boolean(state.race), d.review?.at, chosenDials(team)]), () => {
      const nodes = []
      if (state.race) nodes.push(el("div", { class: "actions" }, el("a", { class: "btn primary", href: `/race.html?team=${encodeURIComponent(team.id)}`, id: "readoutLink", style: "display:inline-flex;align-items:center;text-decoration:none" }, "Open your readout")))
      if (!d.plan) {
        const preview = createBoard({ stationId: station.id, budget: budget(), interactive: false, id: "pitchPreview", scene: "still" })
        preview.update(choicesNow(team), { locked: true, chosen: chosenDials(team), ghosts: ghostsAt(team, station.id) })
        nodes.push(panel("Your board",
          stateBanner(`${WORDS.lockedCount(chosenDials(team).length, dialCount)}. Lock all three choices on Tune, then call the Solutions Architect from here.`, "info"),
          preview.el,
          el("div", { class: "actions" }, button(WORDS.goToTune, () => goTab("tune"), { kind: "primary" }))))
        return nodes
      }
      if (d.status === "approved") nodes.push(learningCard(station.id, { id: "approvedLesson" }))
      if (d.status === "locked") nodes.push(el("div", { class: "actions call-sa", id: "callSa" },
        button(WORDS.callArchitect, () => act(`/api/teams/${team.id}/call`, { station: station.id }, "You are in the queue").catch(() => {}), { kind: "primary", disabled: Boolean(state.race) }),
        el("p", { class: "small muted" }, `${WORDS.attempt(d.attempts)}. The SA may be busy with another team; you pitch for ${PITCH_SECONDS} seconds.`)))
      nodes.push(planSheet(team, d.plan, { review: d.review }))
      return nodes
    })
  }

  /* ------------------------------------------------------------ render */

  /** What decides the page's structure; everything else is patched in place, so polling never moves the page. */
  const shapeOf = (team) => JSON.stringify([state.id, team.id, tab, briefRead(team), phaseOf(state), notInPlay(), budget()])

  function render(force) {
    if (!state || !gameClock(state)) return
    renderClock()
    const team = currentTeam()
    if (team) for (const [k, v] of Object.entries(pending)) if (team.choices[k] === v) delete pending[k]
    renderStrip(team)
    if (!team) {
      tune = null
      if (force) shape = ""
      return renderStepZero()
    }
    const next = shapeOf(team)
    if (force || next !== shape || !document.getElementById("view")) {
      shape = next
      tune = null
      const view = tab === "brief" ? renderBrief(team) : tab === "pitch" ? renderPitch() : renderTune(team)
      replaceKeepingScroll(app, el("div", { class: "workspace-single wide" },
        el("main", {}, el("div", { id: "tabSlot" }), el("div", { id: "bannerSlot" }), el("section", { id: "view", class: `view view-${tab}` }, view))))
    }
    const disabled = briefRead(team) ? [] : ["tune", "pitch"]
    patchSlot(document.getElementById("tabSlot"), [tab, ...disabled], () => tabBar(tab, goTab, { disabled }))
    const b = banner(team)
    patchSlot(document.getElementById("bannerSlot"), b ? `${b.className}|${b.textContent}` : "", () => b)
    if (tab === "tune") patchTune(team)
    else if (tab === "pitch") patchPitch(team)
    else tickGate()
  }
}
