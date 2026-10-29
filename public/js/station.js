import * as C from "/js/catalog.js"
import { evaluate, cpuRates, effectiveTeam, pickedOption } from "/js/model.js"
import { simulateStation, simulateTeam, SUGGESTED_RUNS, expectedPenalty } from "/js/sim.js"
import { ARCHITECT_LEVERS, ARCHITECT_SUMMARY, architectReport, sanitiseTuning } from "/js/architect.js"
import { planSheet, queueStatus } from "/js/plan.js"
import { tableFigures } from "/js/plandata.js"
import { DECISION_WHY } from "/js/decisioncopy.js"
import { designStatus, approvedStations, PITCH_SECONDS } from "/js/approval.js"
import {
  el, money, delta, clock, pct, post, watchState, remainingMs, gameClock, tagFor, installErrorLogging,
  instructionsButton, confirmDialog, WORDS, button, stateBanner, panel, stat, meter, teamChip, tabBar, optionCard, decisionSection, scoreRing,
} from "/js/ui.js"

installErrorLogging("table")

const params = new URLSearchParams(location.search)
const station = C.byId(C.STATIONS, params.get("station")) || C.STATIONS[0]
const decisions = C.visibleDecisions(station.id)
const KEY_TEAM = `podium-team-${station.id}`
const KEY_SEAT = `podium-seat-${station.id}`
const KEY_PENDING = `podium-pending-${station.id}`
document.title = `Podium · ${station.name}`
document.getElementById("stationName").textContent = station.name
document.getElementById("leaderName").textContent = `Pitch to: ${station.leader}`

let state = null
let offset = 0
let tab = "brief"
let teamId = sessionStorage.getItem(KEY_TEAM) || ""
let pending = loadPending()
let lastKey = ""
let simView = null
let wholeTeam = false
let flushing = false
let needsFlush = Object.keys(pending).length > 0
let tuningDraft = null
let gameId = null

const app = document.getElementById("app")
const strip = document.getElementById("teamStrip")
const timerBox = document.getElementById("timer")
const roundTag = document.getElementById("roundTag")

document.getElementById("tools").replaceChildren(instructionsButton("team"), button(WORDS.returnHome, () => returnHome(), { small: true }))

function loadPending() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY_PENDING) || "{}")
    return saved && typeof saved === "object" ? saved : {}
  } catch {
    return {}
  }
}
function savePending() {
  if (Object.keys(pending).length) sessionStorage.setItem(KEY_PENDING, JSON.stringify(pending))
  else sessionStorage.removeItem(KEY_PENDING)
}

function toast(text) {
  const node = el("div", { class: "toast" }, text)
  document.body.append(node)
  setTimeout(() => node.remove(), 2200)
}

function forgetTeam() {
  teamId = ""
  pending = {}
  needsFlush = false
  savePending()
  sessionStorage.removeItem(KEY_TEAM)
  sessionStorage.removeItem(KEY_SEAT)
}

const watcher = watchState((next, off) => {
  state = next
  offset = off
  if (!gameClock(state)) {
    document.body.classList.add("offline")
    strip.classList.add("hidden")
    app.replaceChildren(el("div", { class: "workspace-single" }, stateBanner("Reconnecting to the game server. This page retries every second.", "info")))
    lastKey = ""
    return
  }
  if (gameId && state.id !== gameId && !state.teams.length) {
    forgetTeam()
    location.href = "/"
    return
  }
  gameId = state.id
  resync()
  render(false)
})

/** After a reconnect, a reload or the clock starting: re-send unsaved choices and seat the chosen team here. */
function resync() {
  const team = state?.teams?.find((t) => t.id === teamId)
  if (!team) return
  if (needsFlush && Object.keys(pending).length) flushPending(team)
  const open = ["running", "paused"].includes(gameClock(state)?.status) && !state.race
  const seated = Object.values(state.tables || {}).some((seat) => seat.team === team.id)
  if (open && !seated && sessionStorage.getItem(KEY_SEAT) === team.id) checkIn(team.id, true)
}

setInterval(() => {
  const team = state?.teams?.find((t) => t.id === teamId)
  if (team && needsFlush && Object.keys(pending).length && !document.body.classList.contains("offline")) flushPending(team)
}, 2000)

/** Heartbeat for the host's live feed: which table and which step this iPad is on. */
setInterval(() => {
  const team = state?.teams?.find((t) => t.id === teamId)
  if (!team || document.hidden || document.body.classList.contains("offline")) return
  post(`/api/teams/${team.id}/presence`, { station: station.id, step: tab }).catch(() => {})
}, 5000)

const LOCKED = /locked|Wait for|Time is up|race has run/

function flushPending(team) {
  if (flushing) return
  flushing = true
  needsFlush = false
  post(`/api/teams/${team.id}/choices`, { station: station.id, choices: { ...pending } })
    .then(() => watcher.refresh())
    .catch((err) => {
      needsFlush = !LOCKED.test(err.message)
      if (!needsFlush) {
        pending = {}
        savePending()
      }
    })
    .finally(() => { flushing = false })
}

let checkingIn = false
function checkIn(id, quiet) {
  if (checkingIn) return
  checkingIn = true
  post(`/api/teams/${id}/checkin`, { station: station.id })
    .then(() => {
      if (!quiet) toast("Checked in at this table")
      watcher.refresh()
    })
    .catch((err) => { if (!quiet) toast(err.message) })
    .finally(() => { checkingIn = false })
}

async function checkOut() {
  const team = state?.teams?.find((t) => t.id === teamId)
  if (team) await post(`/api/teams/${team.id}/checkout`, { station: station.id }).catch((err) => console.error("[podium] check-out failed", err))
}

/** Clear this iPad's check-in and go back to the landing page. */
async function returnHome() {
  await checkOut()
  forgetTeam()
  location.href = "/"
}

/** Back to Step 0 for this iPad. */
async function switchTeam() {
  if (Object.keys(pending).length && !(await confirmDialog("Some choices on this iPad have not reached the server yet. Switch team anyway and lose them?", WORDS.switchTeam))) return
  await checkOut()
  forgetTeam()
  tab = "brief"
  simView = null
  tuningDraft = null
  render(true)
  watcher.refresh()
}

let shownTeam = ""
let pickedAt = 0

/** The team this iPad has chosen, or null for Step 0. */
function currentTeam() {
  if (!teamId || !state?.teams?.length) return null
  const elsewhere = Object.entries(state.tables || {}).some(([id, seat]) => id !== station.id && seat.team === teamId)
  if (elsewhere && Date.now() - pickedAt > 4000) {
    forgetTeam()
    return null
  }
  const team = state.teams.find((t) => t.id === teamId)
  if (!team) {
    forgetTeam()
    return null
  }
  if (team.id !== shownTeam) {
    shownTeam = team.id
    simView = null
    tuningDraft = null
  }
  return team
}

function chooseTeam(id) {
  pickedAt = Date.now()
  teamId = id
  pending = {}
  savePending()
  sessionStorage.setItem(KEY_TEAM, id)
  sessionStorage.setItem(KEY_SEAT, id)
  tab = "brief"
  if (["running", "paused"].includes(gameClock(state)?.status) && !state.race) checkIn(id)
  render(true)
  window.scrollTo({ top: 0 })
}

function goTab(name) {
  tab = name
  render(true)
  window.scrollTo({ top: 0 })
}

function teamWithPending(team) {
  return { ...team, choices: { ...team.choices, ...pending } }
}

function opts() {
  return { races: state?.settings?.races ?? 24, sprints: state?.settings?.sprints ?? 6 }
}

/* ------------------------------------------------------------ states and the banner */

function clockReason() {
  const c = gameClock(state)
  if (!c) return "Reconnecting to the game server."
  if (state.race) return "The race has run: decisions are locked."
  if (c.status === "lobby") return "The game clock has not started yet. Read the brief; decisions open when the host starts the clock."
  if (c.status === "ended") return "Time is up: every table is locked. Tables not approved score 0 and race on their default options."
  return null
}

function notInPlay() {
  return !state.settings.stations.includes(station.id)
}

/** The one banner, shown in the same place on every tab and every table. */
function banner(team) {
  if (notInPlay()) return stateBanner("This table is not in play in this game. Use Return to home to choose another table.", "bad")
  const reason = clockReason()
  if (reason) return stateBanner(reason, state.race || gameClock(state)?.status === "ended" ? "bad" : "warn")
  if (!team) return null
  const d = designStatus(state, team, station.id)
  if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}: this table scores and races as designed (plan ${d.plan?.id || d.review.planId}).`, "good")
  if (d.plan) return stateBanner(`Locked in as plan ${d.plan.id}. Decisions are frozen until the leader approves it or sends it back.`, "info")
  if (d.status === "sentBack") return stateBanner(`${d.label}. Revise your choices, lock in again and call the leader.`, "warn")
  return null
}

function decisionsLocked(team) {
  return Boolean(clockReason()) || notInPlay() || Boolean(team.plans?.[station.id])
}

/* ------------------------------------------------------------ header */

function renderClock() {
  const c = gameClock(state)
  if (!c) {
    timerBox.textContent = "--:--"
    roundTag.textContent = "Reconnecting…"
    return
  }
  const ms = remainingMs(c, offset)
  timerBox.textContent = c.status === "lobby" ? clock(c.totalMs) : c.status === "ended" ? (state.race ? "RACE" : "TIME") : clock(ms)
  timerBox.classList.toggle("warn", Number.isFinite(ms) && ms < 300_000 && ms > 0)
  timerBox.classList.toggle("over", c.status === "ended" && !state.race)
  roundTag.textContent = c.status === "lobby" ? "Game clock · not started" : c.status === "paused" ? "Game clock · paused" : c.status === "ended" ? "Game clock · time is up" : "Game clock"
  const visit = document.getElementById("visitTimer")
  if (visit) visit.textContent = visitText()
}

function visitText() {
  const c = gameClock(state)
  const seat = state.tables?.[station.id]
  if (!seat || seat.team !== teamId || !c || c.status === "ended" || state.race) return "Visit timer: —"
  const end = seat.since + (state.settings?.visitMinutes ?? C.GAME_CLOCK.visitMinutes) * 60_000
  const left = c.status === "paused" ? end - (c.pausedAt || Date.now() + offset) : end - (Date.now() + offset)
  return left > 0 ? `Visit timer ${clock(left)}` : "Visit guide passed: move on when ready"
}

setInterval(() => {
  try {
    if (state) renderClock()
    const pitch = document.getElementById("stationPitch")
    if (pitch) pitch.textContent = pitchClock(Math.ceil((Number(pitch.dataset.ends) - (Date.now() + offset)) / 1000))
  } catch (err) {
    console.error("[podium] timer", err)
  }
}, 250)

function renderStrip(team) {
  if (!team) {
    strip.classList.add("hidden")
    strip.replaceChildren()
    return
  }
  strip.classList.remove("hidden")
  strip.replaceChildren(
    teamChip(team),
    el("span", { class: "muted small" }, `P${team.rank} in 2026 · ${station.name}`),
    button(WORDS.switchTeam, () => switchTeam(), { small: true }),
    el("span", { class: "spacer" }),
    el("span", { class: "visit-timer", id: "visitTimer" }, visitText()))
}

/* ------------------------------------------------------------ step 0: choose your team */

function renderStepZero() {
  const reason = notInPlay() ? null : clockReason()
  const nodes = [el("h2", {}, WORDS.chooseTeam), el("p", { class: "muted" }, `${station.name} · pitch to ${station.leader}. Tap your team to begin.`)]
  if (notInPlay()) nodes.push(stateBanner("This table is not in play in this game. Use Return to home to choose another table.", "bad"))
  else {
    if (reason) nodes.push(stateBanner(gameClock(state).status === "lobby" ? "The game clock has not started yet. You can still choose your team and read the brief." : reason, gameClock(state).status === "lobby" ? "warn" : "bad"))
    if (!state.teams.length) nodes.push(stateBanner("The host has not created the teams yet.", "info"))
    nodes.push(el("div", { class: "team-grid" }, state.teams.map((t) => {
      const at = Object.entries(state.tables || {}).find(([, seat]) => seat.team === t.id)?.[0]
      const where = at && at !== station.id ? `at ${C.byId(C.STATIONS, at)?.name || at}` : at === station.id ? "checked in here" : `P${t.rank} in 2026`
      return el("button", { class: "team-button", onclick: () => chooseTeam(t.id) }, el("i", { style: `background:${t.color}` }), el("b", {}, t.name), el("span", {}, where))
    })))
  }
  app.replaceChildren(el("div", { class: "workspace-single" }, el("div", { class: "panel step-zero" }, ...nodes)))
}

/* ------------------------------------------------------------ brief */

function renderBrief(team, ev) {
  const L = ev.ledger
  const headroom = L.capexRemaining - L.capex
  return [
    el("div", { class: "brief-grid" },
      panel("Mission",
        ...station.brief.map((line) => el("p", {}, line)),
        el("div", { class: "clauses" }, station.clauses.map((c) => el("span", { class: "opt-tag tag-fia inline" }, c))),
        el("p", { class: "small muted" }, `Partners at this table: ${station.partners.join(", ")}.`)),
      panel(`${team.name}: your constraints`,
        el("div", { class: "stat-col" },
          stat(headroom >= 0 ? money(headroom) : `−${money(-headroom)}`, `CapEx headroom of ${money(L.capexRemaining)} (${ev.tier.name.split(" (")[0]})`),
          stat(money(L.opexAllowance), `Infrastructure OpEx allowance a year (using ${money(L.opex)})`),
          stat(`${ev.atr.mauh.toFixed(2)} MAUh`, `Compute cap per test period as P${ev.rank}`)),
        el("p", { class: "small muted" }, "Buying uses CapEx; leases, as-a-service and cloud use OpEx. Going over either costs points.")),
      panel("What the leader is scoring",
        el("ul", { class: "score-list" },
          el("li", {}, el("b", {}, "Performance"), " · does it deliver what the team needs?"),
          el("li", {}, el("b", {}, "Cost efficiency"), " · within CapEx and OpEx limits"),
          el("li", {}, el("b", {}, "FIA compliance"), " · no rule broken, nothing to audit"),
          el("li", {}, el("b", {}, "Resilience"), " · what happens when something fails")),
        el("p", { class: "small" }, `These make the system score (Optimised is 80% or more). Only an approved design counts: after a ${PITCH_SECONDS}-second pitch the leader approves it (the score plus 10%) or sends it back. Anything not approved scores 0 and races on the defaults.`),
        el("p", { class: "small muted" }, "\"FIA rule\" on a card marks a regulation; \"est.\" marks an estimate."))),
    el("div", { class: "actions" }, button(WORDS.startDesigning, () => goTab("decide"), { kind: "primary" })),
  ]
}

/* ------------------------------------------------------------ decide */

function facts(d, option, ev, team) {
  const ch = ev.choices
  switch (d.id) {
    case "oem": return [`Price ×${option.priceMult.toFixed(2)} · lead ${option.leadDelta === 0 ? "±0" : `${option.leadDelta > 0 ? "+" : "−"}${Math.abs(option.leadDelta)} wk`} · support ${Math.round(option.supportPct * 100)}%/yr`, option.aas ? `As a service: ${option.aas.name}` : option.nvaieIncluded ? "AI Enterprise included" : "No as-a-service programme"]
    case "payment": {
      const alt = evaluate({ ...team, choices: { ...ev.choices, payment: option.id } }, opts()).commercial
      return [`Hardware ${money(alt.hardware)} → CapEx ${money(alt.capexHardware)} · OpEx ${money(alt.opexHardware)}/yr`, alt.commitment ? `${alt.aas}: ${money(alt.commitment)} committed over ${alt.months} months` : option.id === "aas" && alt.payment !== "aas" ? "Not offered by this OEM: falls back to a lease" : null].filter(Boolean)
    }
    case "cpu": {
      const r = cpuRates(option, C.byId(C.CLOCKS, ch.clock))
      return [`${option.coresPerSocket * option.sockets} cores · ${option.nodeKW} kW a node · ${money(option.nodePrice)}`, `Billed ${r.billedGF.toFixed(0)} GFLOPS a core; ${pct(r.efficiency)} does useful CFD`]
    }
    case "clock": {
      const r = cpuRates(pickedOption("cpu", ch), option)
      return [`Billed ${r.billedGHz.toFixed(2)} GHz · ${pct(r.efficiency)} useful`]
    }
    case "platform": return [`${option.gpusPerRack} ${option.custom ? "chips" : "GPUs"} a rack · ${option.hbmGB} GB each · ${option.rackKW} kW a rack`, `${money(option.capex)} a rack${option.nre ? ` + ${money(option.nre, 0)} engineering` : ""} · ${option.leadWeeks} wk`]
    case "deploy": {
      const platform = pickedOption("platform", ch)
      if (option.id === "own") return [`${pickedOption("payment", ch).name} (set at the CFD table)`]
      const rate = option.id === "burst" ? platform.burstRate : platform.cloudRate
      return rate ? [`$${rate}/GPU-hour · ${option.id === "burst" ? `${C.BURST_HOURS.toLocaleString("en-GB")} h a year` : "8,760 h a year"}`] : ["Not available for this accelerator"]
    }
    case "tgp": return [`${pct(option.perf)} tokens · ${pct(option.power)} power`]
    case "modelSize": return [`${option.params}B parameters · ~${option.inferMs} ms an answer`]
    case "precision": return [`${option.bytes} byte${option.bytes > 1 ? "s" : ""} a parameter · ${pct(option.speed)} of FP8 speed`]
    case "hbm": return [`${option.gb} GB @ ${option.tbs} TB/s${option.perGpu ? ` · +${money(option.perGpu)} a GPU` : ""}`]
    case "location": return [`$${option.kwMonth}/kW-month · $${option.mwh}/MWh`, `${Math.round(C.greatCircleKm(option, C.FACTORY)).toLocaleString("en-GB")} km to the factory`]
    case "hall": return [`≤${option.maxRackKW} kW a rack · PUE ${option.pue} · ${option.fitOutWeeks} wk fit-out`]
    case "terms": return [`Rent ×${option.mult.toFixed(2)}${option.metered ? " on drawn kW" : " on the contracted block"}`]
    case "redundancy": return [`Rent ×${option.mult.toFixed(2)} · outage risk ×${option.trip}`]
    case "pfs": return [option.staas ? `${money(option.opexPerPB)}/PB a year, no CapEx` : `${money(option.capexPerPB)}/PB + ${money(option.opexPerPB)}/PB a year`]
    case "archive": return [`${option.capex ? money(option.capex) + " CapEx" : "No CapEx"} · ${option.opex ? money(option.opex) + "/yr" : "no OpEx"}`]
    case "dataTier": return [`${option.capex ? money(option.capex) : "Free"} · ${option.kw} kW`]
    case "kv": return option.id === "on" ? [`${money(C.KV_TIER.capex)} · ${C.KV_TIER.kw} kW`] : ["No extra hardware"]
    case "wan":
    case "wanBackup":
    case "hqLink": return option.id === "none" ? ["No second path"] : [`${option.nrc ? money(option.nrc) + " setup + " : ""}${money(option.mrc)}/month · ${option.leadDays} days`]
    case "fabric": return [`${money(option.capexPerRack)} a compute rack · CFD ×${option.cfd} · AI ×${option.ai}`]
    case "segregation":
    case "dataflow": return [`${option.capex ? money(option.capex) : "$0"} CapEx · ${option.opex ? money(option.opex) + "/yr" : "$0/yr"}`]
    default: return []
  }
}

/** Numeric decisions use the same card as option decisions; this is their one-line context. */
function valueNote(d, ev) {
  switch (d.id) {
    case "block": return `The racks draw ${Math.round(ev.power.facilityKW)} kW at the meter. Contract 10–20% more than that; rent is paid on the whole block.`
    case "nodes": return `${ev.cfd.cores.toLocaleString("en-GB")} cores spend the CFD allowance in ${ev.cfd.weeksToBurn.toFixed(1)} weeks of a ${(C.SEASON.atpHours / 168).toFixed(1)}-week test period.`
    case "racks": return `${ev.ai.gpus} ${pickedOption("platform", ev.choices).custom ? "chips" : "GPUs"} · ${Math.round(ev.ai.tokens / 1000)}k of ${C.AI_DEMAND_TOKS / 1000}k tokens a second.`
    case "term": return "Leases cost 46% / 28% / 20% of the price a year; as-a-service commits at least 36 months."
    case "pfsPB": return `The aero programme needs about ${C.PFS_NEED_PB} PB a season.`
    case "edge": return `${money(C.EDGE.capex)} each + ${money(C.EDGE.freightPerYear)} a year to fly them to 24 races.`
    default: return null
  }
}

function unitLabel(d, value) {
  const unit = { MW: "MW", PB: "PB", months: "months", racks: value === 1 ? "rack" : "racks", nodes: "nodes" }[d.unit] ?? d.unit ?? ""
  return `${value} ${unit}`.trim()
}

function costLine(team, base, d, value) {
  const alt = evaluate({ ...team, choices: { ...base.choices, [d.id]: value } }, opts())
  const dc = alt.ledger.capex - base.ledger.capex
  const dop = alt.ledger.opex - base.ledger.opex
  const dkw = alt.power.facilityKW - base.power.facilityKW
  const span = (v, text) => el("span", { class: v > 1 ? "up" : v < -1 ? "down" : "" }, text)
  return el("div", { class: "cost" }, span(dc, `CapEx ${delta(dc)}`), " · ", span(dop, `OpEx ${delta(dop)}/yr`), " · ", span(dkw, delta(dkw, (v) => `${Math.round(v)} kW`)))
}

function choose(team, d, value) {
  if (decisionsLocked(team)) return toast(banner(team)?.textContent || "Decisions are locked")
  pending[d.id] = value
  savePending()
  simView = null
  render(true)
  post(`/api/teams/${team.id}/choices`, { station: station.id, choices: { [d.id]: value } })
    .then(() => watcher.refresh())
    .catch((err) => {
      if (LOCKED.test(err.message)) {
        delete pending[d.id]
        savePending()
        render(true)
        return toast(err.message)
      }
      needsFlush = true
      toast("Saved on this iPad; it will sync when the connection is back")
    })
}

function renderDecide(team, ev) {
  const full = teamWithPending(team)
  const locked = decisionsLocked(team)
  const sections = decisions.map((d) => {
    const current = ev.choices[d.id]
    let cards
    if (d.values) {
      const values = d.id === "block" ? pickedOption("location", ev.choices).blocksMW.filter((mw) => d.values.includes(mw)) : d.values
      cards = values.map((value) => optionCard({ name: unitLabel(d, value), selected: Number(current) === value, disabled: locked, cost: costLine(full, ev, d, value), onclick: () => choose(team, d, value) }))
    } else {
      cards = d.options.map((option) => optionCard({ name: option.name, why: option.why, tag: tagFor(option), lines: facts(d, option, ev, full), cost: costLine(full, ev, d, option.id), selected: option.id === current, disabled: locked, onclick: () => choose(team, d, option.id) }))
    }
    return decisionSection({ id: d.id, title: d.name, why: DECISION_WHY[d.id], cards, note: d.values ? valueNote(d, ev) : null })
  })
  return [
    ...sections,
    team.architect?.enabled ? renderArchitect(team) : null,
    el("div", { class: "actions" }, button(WORDS.runSimulation, () => { goTab("sim"); runSim(team) }, { kind: "primary" })),
  ]
}

/* ------------------------------------------------------------ architect (end of Decide, when granted) */

function renderArchitect(team) {
  const tuning = tuningDraft || (tuningDraft = { ...team.architect.tuning })
  const report = architectReport(teamWithPending(team), tuning)
  const locked = Boolean(clockReason()) || notInPlay()
  const saved = JSON.stringify(sanitiseTuning(team.architect.tuning)) === JSON.stringify(sanitiseTuning(tuning))
  const fmt = (v, digits = 0) => (Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: digits }) : "—")
  return el("section", { class: "architect-block", id: "architect" },
    el("h2", {}, "Architect: Token Efficiency Calculator"),
    el("p", { class: "decision-why" }, ARCHITECT_SUMMARY, " A dial with nothing selected keeps your base plan's setting."),
    el("div", { class: "arch-metrics" },
      stat(`${fmt(report.tuned.tokPerS)} tok/s`, `Tokens a second (base ${fmt(report.base.tokPerS)})`),
      stat(`$${fmt(report.tuned.costPerM, 3)}`, `Per million good tokens (base $${fmt(report.base.costPerM, 3)})`),
      stat(`${fmt(report.tuned.joulesPerToken, 2)} J`, `Power per token (base ${fmt(report.base.joulesPerToken, 2)} J)`),
      stat(`×${report.gain.toFixed(2)}`, "Gain vs your base plan")),
    ...ARCHITECT_LEVERS.map((l) => decisionSection({
      id: `arch-${l.key}`, title: l.label, why: l.help,
      cards: l.options.map(([value, label]) => optionCard({ name: label, selected: (tuning[l.key] ?? null) === value, disabled: locked, onclick: () => { tuningDraft = { ...tuning, [l.key]: value }; render(true) } })),
    })),
    report.lessons.length ? el("div", { class: "panel small" }, report.lessons.map((line) => el("div", {}, "• ", line))) : null,
    el("div", { class: "actions" },
      button(saved ? `Saved: ×${(team.architect.gain || 1).toFixed(2)}` : "Apply tuning", () => act(`/api/teams/${team.id}/architect`, { tuning }, `Architect gain ×${report.gain.toFixed(2)} saved`).then(() => { tuningDraft = null }), { kind: "go", disabled: locked || saved }),
      el("span", { class: "muted small" }, "The saved gain multiplies your AI racks' good tokens in the simulation and the race.")))
}

/* ------------------------------------------------------------ simulate */

function runSim(team) {
  const full = teamWithPending(team)
  const stations = state.settings.stations
  simView = { at: Date.now(), table: simulateStation(full, opts(), station.id), team: simulateTeam(full, opts(), stations), raceNow: simulateTeam(effectiveTeam(full, stations), opts(), stations) }
  render(true)
  post(`/api/teams/${team.id}/sim`, { station: station.id }).then(() => watcher.refresh()).catch(() => {})
}

function breakdown(parts) {
  const names = { performance: "Performance", cost: "Cost efficiency", compliance: "FIA compliance", resilience: "Resilience" }
  return el("div", { class: "sim-parts" }, Object.entries(names).map(([id, name]) => meter(name, parts[id], 1, pct(parts[id]), parts[id] < 0.6 ? "red" : parts[id] < 0.8 ? "amber" : "")))
}

function renderSim(team) {
  const runs = team.sims?.[station.id]
  const visitNo = team.visits?.[station.id]?.count || 0
  const thisVisit = runs && runs.visitNo === visitNo ? runs.visit : 0
  const controls = panel("Run the simulation",
    el("p", { class: "small" }, "The same model the race uses, on your current choices. Hints point at the problem without giving the answer."),
    el("div", { class: "actions" },
      button(WORDS.runSimulation, () => runSim(team), { kind: "primary" }),
      button(`${WORDS.wholeTeam}: ${wholeTeam ? "on" : "off"}`, () => { wholeTeam = !wholeTeam; render(true) }),
      el("span", { class: `muted small${thisVisit > SUGGESTED_RUNS ? " warn-text" : ""}` }, `Runs used this visit: ${thisVisit} (about ${SUGGESTED_RUNS} suggested) · ${runs?.total || 0} in total`)))
  if (!simView) return [controls, panel("Result", el("p", { class: "muted" }, `Tap ${WORDS.runSimulation} to score ${station.name}.`))]
  const r = simView.table
  const nodes = [controls, panel(`${station.name} result`, scoreRing(r.score, r.band), breakdown(r.parts),
    el("h3", { class: "panel-title" }, "Hints"),
    r.hints.length ? el("ul", {}, r.hints.map((h) => el("li", {}, h))) : el("p", { class: "small" }, "No obvious weak spot. Can you defend every number in your pitch?"))]
  if (wholeTeam) {
    const t = simView.team
    const now = simView.raceNow
    nodes.push(panel(`Whole team: ${t.score}% · ${t.band}`,
      el("table", { class: "grid" }, el("tbody", {}, state.settings.stations.map((id) => {
        const s = t.stations[id]
        const d = designStatus(state, team, id)
        return el("tr", {}, el("td", {}, C.byId(C.STATIONS, id).name), el("td", {}, el("b", {}, `${s.score}%`)), el("td", { class: "muted small" }, d.status === "approved" ? "approved" : `${d.label.toLowerCase()}: races on defaults`), el("td", { class: "small" }, s.hints[0] || ""))
      }))),
      el("p", { class: "small" }, `If the clock ran out now (only approved tables count): ${now.score}% · expected penalties ${now.race.expectedPenaltyPoints.toFixed(1)} pts${now.race.dsq ? " · disqualification risk" : ""}.`)))
  }
  return nodes
}

/* ------------------------------------------------------------ pitch */

function act(url, body, done) {
  return post(url, body).then((res) => { if (done) toast(done); watcher.refresh(); return res }).catch((err) => { toast(err.message); throw err })
}

const pitchClock = (secs) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.max(0, secs) % 60).padStart(2, "0")}`

/** Where this team's pitch stands, in the leader's words: status only, the leader decides on the host screen. */
function pitchStatus(team) {
  const d = designStatus(state, team, station.id)
  if (d.status === "approved") return stateBanner(`${WORDS.approved} by ${d.review.by}. Table points ${team.pitch?.[station.id] ?? d.review.points ?? 0} / ${C.PITCH_MAX}.`, "good")
  if (d.status === "pitching") {
    const secs = Math.ceil((d.pitch.endsAt - (Date.now() + offset)) / 1000)
    return el("div", { class: "state-banner good pitch-now", role: "status" }, `${WORDS.pitching}: `, el("b", { id: "stationPitch", "data-ends": d.pitch.endsAt }, pitchClock(secs)), ` · pitch to ${d.pitch.by}`)
  }
  if (d.status === "waiting") {
    const status = queueStatus(state, team.id, station.id)
    const slot = status?.entry.slot ? ` Your slot: ${status.entry.slot}${status.entry.confirmed ? " (confirmed)" : ""}.` : ""
    return stateBanner(`${WORDS.waitingForLeader}. ${status?.free ? WORDS.leaderFree : `${WORDS.queuePosition(status?.position || 1)}.`}${slot}`, status?.free ? "good" : "warn")
  }
  return null
}

function renderPitch(team, ev) {
  const d = designStatus(state, team, station.id)
  const plan = d.plan
  const nodes = []
  if (state.race) nodes.push(el("div", { class: "actions" }, el("a", { class: "btn primary", href: `/race.html?team=${encodeURIComponent(team.id)}`, id: "raceReportLink" }, "View race report")))
  if (!plan) {
    if (d.status === "sentBack") nodes.push(stateBanner(`${d.label}. Change what the leader asked for, then lock in again.`, "warn"))
    nodes.push(panel("Plan summary",
      el("table", { class: "grid" }, el("tbody", {}, decisions.map((dd) => el("tr", {}, el("td", { class: "muted" }, dd.name), el("td", {}, el("b", {}, dd.options ? pickedOption(dd.id, ev.choices).name : unitLabel(dd, ev.choices[dd.id]))))))),
      el("p", { class: "small muted" }, `Lock in freezes this table's plan, scores it and gives you a one-page plan to screenshot. Then call the leader and pitch it in ${PITCH_SECONDS} seconds. Only an approved design counts.`),
      el("div", { class: "actions" }, button(WORDS.lockIn, () => act(`/api/teams/${team.id}/submit`, { station: station.id }, "Locked in: take your screenshot").catch(() => {}), { kind: "primary", disabled: Boolean(clockReason()) || notInPlay() }))))
  } else {
    nodes.push(pitchStatus(team))
    if (d.status === "locked") nodes.push(el("div", { class: "actions" }, button(WORDS.callLeader, () => act(`/api/teams/${team.id}/call`, { station: station.id }, "You are in the queue").catch(() => {}), { kind: "primary", disabled: Boolean(state.race) })))
    nodes.push(planSheet(team, plan, { review: d.review }))
  }
  return nodes
}

/* ------------------------------------------------------------ ledger (same place on every tab) */

function renderLedger(team, ev) {
  const L = ev.ledger
  const P = ev.power
  const fig = tableFigures(ev, station.id)
  const flags = expectedPenalty(ev, station.id)
  const reds = ev.checks.filter((c) => c.station === station.id && c.state === "red").length
  const com = ev.commercial
  const opexMax = L.opexAllowance + L.opexHeadroom
  const tables = state.settings.stations.map((id) => {
    const d = designStatus(state, team, id)
    const status = d.status === "approved" ? `${WORDS.approved} · ${team.pitch?.[id] ?? 0} pts` : d.plan ? `${d.plan.score}% · ${d.label.toLowerCase()}` : d.status === "sentBack" ? "Sent back" : d.status === "draft" ? "in progress" : team.visits?.[id] ? "visited" : "—"
    return el("div", {}, el("span", {}, C.byId(C.STATIONS, id).name), el("span", { class: d.status === "approved" ? "done" : d.status === "sentBack" ? "warn-text" : "muted" }, status))
  })
  return el("aside", { class: "ledger" },
    panel("Running ledger",
      meter("CapEx (2027)", L.capex, L.capexRemaining, `${money(L.capex)} / ${money(L.capexRemaining)}`, L.capexOver > 0 ? "red" : L.capex > 0.85 * L.capexRemaining ? "amber" : ""),
      meter("Infra OpEx a year", L.opex, opexMax, `${money(L.opex)} / ${money(L.opexAllowance)}`, L.capState === "ok" ? "" : L.capState === "over" ? "amber" : "red"),
      meter("Power", P.facilityKW, P.blockMW * 1000, `${Math.round(P.facilityKW)} kW / ${P.blockMW} MW`, P.state === "red" ? "red" : P.state === "amber" ? "amber" : ""),
      el("div", { class: "ledger-rows" },
        el("div", {}, el("span", {}, "This table"), el("b", {}, `${money(fig.capex)} CapEx · ${money(fig.opex)}/yr`)),
        el("div", {}, el("span", {}, "Lead time"), el("b", {}, fig.leadWeeks ? `${fig.leadWeeks} weeks` : "—")),
        el("div", {}, el("span", {}, "FIA flags"), el("b", { class: flags.points > 0.05 || reds ? "warn-text" : "done" }, flags.points > 0.05 ? `−${flags.points.toFixed(1)} pts expected${flags.dsq ? " · DSQ risk" : ""}` : reds ? `${reds} red check${reds === 1 ? "" : "s"}` : "None")),
        el("div", {}, el("span", {}, "Hardware"), el("b", {}, com.aas || C.byId(C.PAYMENTS, com.payment).name)))),
    panel(`Tables · ${approvedStations(team, state.settings.stations).length}/${state.settings.stations.length} approved`, el("div", { class: "visited" }, tables)))
}

/* ------------------------------------------------------------ render */

function render(force) {
  if (!state) return
  const c = gameClock(state)
  if (!c) return
  renderClock()
  const team = currentTeam()
  const key = JSON.stringify([team, c.status, state.tables?.[station.id], state.queues?.[station.id], state.leaders?.[station.id], state.teams.map((t) => [t.id, t.name, Object.values(state.tables || {}).find((x) => x.team === t.id)]), Boolean(state.race), state.settings.stations, tab, state.pitches?.[station.id], simView?.at, wholeTeam, tuningDraft, pending])
  if (!force && key === lastKey) return
  const active = document.activeElement
  if (!force && active && ["TEXTAREA", "INPUT"].includes(active.tagName)) return
  lastKey = key
  if (team) {
    let changed = false
    for (const [k, v] of Object.entries(pending)) if (team.choices[k] === v) { delete pending[k]; changed = true }
    if (changed) savePending()
  }
  renderStrip(team)
  if (!team) return renderStepZero()
  const ev = evaluate(teamWithPending(team), opts())
  const view = tab === "decide" ? renderDecide(team, ev) : tab === "sim" ? renderSim(team) : tab === "pitch" ? renderPitch(team, ev) : renderBrief(team, ev)
  app.replaceChildren(el("div", { class: "workspace" },
    el("main", {}, tabBar(tab, goTab), banner(team), el("section", { id: "view", class: `view view-${tab}` }, view)),
    renderLedger(team, ev)))
}
