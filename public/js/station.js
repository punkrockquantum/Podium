import * as C from "/js/catalog.js"
import { evaluate } from "/js/model.js"
import { simulateStation } from "/js/sim.js"
import { planSheet, queueStatus } from "/js/plan.js"
import { millions } from "/js/summary.js"
import { designStatus, PITCH_SECONDS } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs } from "/js/session.js"
import {
  el, clock, post, watchState, gameClock, tagFor, installErrorLogging, instructionsButton,
  WORDS, button, stateBanner, panel, stat, teamChip, tabBar, optionCard, decisionSection, scoreRing,
} from "/js/ui.js"

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
  const decisions = C.decisionsFor(station.id)
  const KEY_TEAM = `podium-team-${station.id}`
  document.title = `Podium · ${station.name}`
  document.getElementById("stationName").textContent = station.name
  document.getElementById("pitchTo").textContent = `Pitch to: ${station.architect}`

  let state = null
  let offset = 0
  let tab = "brief"
  let teamId = sessionStorage.getItem(KEY_TEAM) || ""
  let pending = {}
  let lastKey = ""
  let simView = null
  let gameId = null

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
    simView = null
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
    simView = null
    sessionStorage.setItem(KEY_TEAM, id)
    tab = "brief"
    seatHere()
    render(true)
    window.scrollTo({ top: 0 })
  }

  function goTab(name) {
    tab = name
    render(true)
    window.scrollTo({ top: 0 })
  }

  const withPending = (team) => ({ ...team, choices: { ...team.choices, ...pending } })
  const notInPlay = () => !state.settings.stations.includes(station.id)

  /** Why choices are closed for everyone right now, or null. */
  function phaseReason() {
    const phase = phaseOf(state)
    if (phase === "lobby") return ["Choose your team and read the brief. Choices open when the host starts play.", "info"]
    if (phase === "brief" || phase === "briefDone") return [`${WORDS.listen}. Choices open when play starts.`, "warn"]
    if (phase === "ended") return ["Time is up: every table is locked. Tables not approved score 0 and race on their defaults.", "bad"]
    if (phase === "race" || phase === "readout") return ["The race has run: decisions are locked.", "bad"]
    return null
  }

  function banner(team) {
    if (notInPlay()) return stateBanner("This table is not in play in this game. Use Return to home to choose another table.", "bad")
    const reason = phaseReason()
    if (reason) return stateBanner(...reason)
    if (!team) return null
    const d = designStatus(state, team, station.id)
    if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}: this table scores and races as designed.`, "good")
    if (d.plan) return stateBanner(`Locked in as plan ${d.plan.id}: choices are frozen until the Architect decides.`, "info")
    if (d.status === "sentBack") return stateBanner(`${d.label}. Revise, lock in again and call the Architect.`, "warn")
    return null
  }

  const decisionsLocked = (team) => Boolean(phaseReason()) || notInPlay() || Boolean(team.plans?.[station.id])

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
    strip.replaceChildren(teamChip(team), el("span", { class: "muted small" }, `${C.tierFor(team).label} · ${station.name}`), button(WORDS.switchTeam, () => switchTeam(), { small: true }))
  }

  /* ------------------------------------------------------------ step 0: choose your team */

  function renderStepZero() {
    const nodes = [el("h2", {}, WORDS.chooseTeam), el("p", { class: "muted" }, `${station.name} · pitch to the ${station.architect}.`)]
    const b = banner(null)
    if (b) nodes.push(b)
    if (!state.teams.length) nodes.push(stateBanner("The host has not created the teams yet.", "info"))
    nodes.push(el("div", { class: "team-grid", id: "teamGrid" }, state.teams.map((t) => {
      const at = Object.entries(state.tables || {}).find(([, seat]) => seat.team === t.id)?.[0]
      const where = at === station.id ? "Checked in here" : at ? `At ${C.byId(C.STATIONS, at)?.name || at}` : C.tierFor(t).name
      return el("button", { class: "team-button", "data-team": t.id, onclick: () => chooseTeam(t.id) }, el("i", { style: `background:${t.color}` }), el("b", {}, t.name), el("span", {}, where))
    })))
    app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "panel step-zero" }, ...nodes)))
  }

  /* ------------------------------------------------------------ the four steps */

  function renderBrief(team) {
    const tier = C.tierFor(team)
    const listening = ["lobby", "brief", "briefDone"].includes(phaseOf(state))
    return [
      el("div", { class: "brief-grid" },
        panel(station.name, el("ul", { class: "brief-list" }, station.brief.map((line) => el("li", {}, line)))),
        panel(`What the ${station.architect} is looking for`, el("p", { class: "looking" }, station.looking),
          el("p", { class: "small muted" }, `${team.name}: ${tier.label}. ${tier.line}`))),
      el("div", { class: "actions" }, listening ? el("span", { class: "muted" }, `${WORDS.listen}: choices open when play starts.`) : button(WORDS.startDesigning, () => goTab("decide"), { kind: "primary" })),
    ]
  }

  function choose(team, d, value) {
    if (decisionsLocked(team)) return toast(banner(team)?.textContent || "Choices are locked")
    pending[d.id] = value
    simView = null
    render(true)
    post(`/api/teams/${team.id}/choices`, { station: station.id, choices: { [d.id]: value } })
      .then(() => watcher.refresh())
      .catch((err) => {
        delete pending[d.id]
        render(true)
        toast(err.message)
      })
  }

  function renderDecide(team, ev) {
    const locked = decisionsLocked(team)
    return [
      ...decisions.map((d) => decisionSection({
        id: d.id, title: d.name, why: d.why,
        cards: d.options.map((o) => optionCard({ name: o.name, why: o.text, lines: [o.why], tag: tagFor(o), selected: ev.choices[d.id] === o.id, disabled: locked, onclick: () => choose(team, d, o.id) })),
      })),
      el("div", { class: "actions" }, button(WORDS.runSimulation, () => { goTab("sim"); runSim(team) }, { kind: "primary" })),
    ]
  }

  function runSim(team) {
    simView = { at: Date.now(), result: simulateStation(withPending(team), station.id) }
    render(true)
    post(`/api/teams/${team.id}/sim`, { station: station.id }).catch(() => {})
  }

  function renderSim(team) {
    const r = simView?.result
    return [panel("Simulation",
      r ? el("div", { class: "sim-one", id: "simResult" }, scoreRing(r.score, r.band), el("p", { class: "sim-sentence" }, r.sentence), el("p", { class: "sim-hint" }, el("b", {}, "Hint: "), r.hint))
        : el("p", { class: "muted" }, `Tap ${WORDS.runSimulation} to score your ${station.name} choices.`),
      el("div", { class: "actions" }, button(WORDS.runSimulation, () => runSim(team), { kind: r ? "secondary" : "primary" }), r ? button("Go to Pitch", () => goTab("pitch"), { kind: "primary" }) : null))]
  }

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

  function renderPitch(team, ev) {
    const d = designStatus(state, team, station.id)
    const nodes = []
    if (state.race) nodes.push(el("div", { class: "actions" }, el("a", { class: "btn primary", href: `/race.html?team=${encodeURIComponent(team.id)}`, id: "readoutLink", style: "display:inline-flex;align-items:center;text-decoration:none" }, "Open your readout")))
    if (!d.plan) {
      nodes.push(panel("Your plan",
        el("table", { class: "grid" }, el("tbody", {}, decisions.map((dd) => el("tr", {}, el("td", { class: "muted" }, dd.name), el("td", {}, el("b", {}, dd.options.find((o) => o.id === ev.choices[dd.id]).name)))))),
        el("p", { class: "small muted" }, `Lock in freezes this table and shows your plan page. Take a screenshot, then call the Architect and pitch in ${PITCH_SECONDS} seconds.`),
        el("div", { class: "actions" }, button(WORDS.lockIn, () => act(`/api/teams/${team.id}/submit`, { station: station.id }, WORDS.screenshot).catch(() => {}), { kind: "primary", disabled: decisionsLocked(team) }))))
    } else {
      nodes.push(pitchStatus(team))
      if (d.status === "locked") nodes.push(el("div", { class: "actions" }, button(WORDS.callArchitect, () => act(`/api/teams/${team.id}/call`, { station: station.id }, "You are in the queue").catch(() => {}), { kind: "primary", disabled: Boolean(state.race) })))
      nodes.push(planSheet(team, d.plan, { review: d.review }))
    }
    return nodes
  }

  /** Four numbers for the whole team: CapEx, yearly OpEx, power and FIA risk. */
  function renderLedger(ev) {
    const L = ev.ledger
    const tone = (bad) => (bad ? "warn-text" : "")
    return el("aside", { class: "ledger" }, panel("Your ledger",
      el("div", { class: "ledger-four" },
        stat(el("span", { class: tone(L.capexOver > 0) }, millions(L.capex)), `CapEx of ${millions(L.capexLimit)}`),
        stat(el("span", { class: tone(L.opexState !== "ok") }, millions(L.opex)), `OpEx a year of ${millions(L.opexLimit)}`),
        stat(`${Math.round(L.facilityKW)} kW`, "Power"),
        stat(el("span", { class: `fia-${L.fia.toLowerCase()}` }, L.fia), "FIA risk")),
      el("p", { class: "small muted" }, "The whole team, across all four tables.")))
  }

  function render(force) {
    if (!state || !gameClock(state)) return
    renderClock()
    const team = currentTeam()
    const key = JSON.stringify([team, phaseOf(state), state.clock.status, state.queues?.[station.id], state.architects?.[station.id], state.pitches?.[station.id], state.teams.map((t) => [t.id, t.name]), state.tables, Boolean(state.race), state.settings.stations, tab, simView?.at, pending])
    if (!force && key === lastKey) return
    lastKey = key
    if (team) for (const [k, v] of Object.entries(pending)) if (team.choices[k] === v) delete pending[k]
    renderStrip(team)
    if (!team) return renderStepZero()
    const full = withPending(team)
    const ev = evaluate(full)
    const view = tab === "decide" ? renderDecide(team, ev) : tab === "sim" ? renderSim(team) : tab === "pitch" ? renderPitch(team, ev) : renderBrief(team)
    app.replaceChildren(el("div", { class: "workspace" },
      el("main", {}, tabBar(tab, goTab), banner(team), el("section", { id: "view", class: `view view-${tab}` }, view)),
      renderLedger(ev)))
  }
}
