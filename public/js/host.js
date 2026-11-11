import * as C from "/js/catalog.js"
import { boardFor, raceSeconds } from "/js/model.js"
import { miniFit, learningCard, createBoard } from "/js/board.js"
import { planSheet, summaryBlock, frozenBoard } from "/js/plan.js"
import { designSummary } from "/js/summary.js"
import { designStatus, approvalGrid, lockedDials, ghostsAt, STATUS_LABEL, STATUS_ORDER, PITCH_SECONDS, REJECT_REASON_MAX } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs, playOpen } from "/js/session.js"
import { DEMO_STEPS, buildDemo } from "/js/demo.js"
import { readoutFor } from "/js/report.js"
import { readoutCard } from "/js/readoutview.js"
import { podiumGraphic } from "/js/podium.js"
import { briefView } from "/js/briefview.js"
import { el, clock, post, login, logout, session, watchState, gameClock, installErrorLogging, instructionsButton, confirmDialog, button, teamChip, stateBanner, WORDS, patchSlot, replaceKeepingScroll, setText } from "/js/ui.js"

installErrorLogging("host")

const app = document.getElementById("app")
const FEED_POLL_MS = 2000
let state = null
let offset = 0
/** Which screen the page currently shows: login, demo, control, architect or reconnecting. */
let screen = ""
let presence = { now: Date.now(), presence: {} }
let demoIndex = null
/** The host can act as the Solutions Architect (SA) of one table; an SA always reviews the table chosen at login. */
let hostLeads = null
let selectedTeam = null

const watcher = watchState((next, off) => {
  state = next
  offset = off
  render()
})

async function pollPresence() {
  try {
    const res = await fetch("/api/presence", { cache: "no-store" })
    if (res.ok) presence = await res.json()
  } catch (err) {
    console.warn("[podium] presence poll failed", err)
  }
  render()
}
setInterval(pollPresence, FEED_POLL_MS)
pollPresence()

function toast(text) {
  const node = el("div", { class: "toast" }, text)
  document.body.append(node)
  setTimeout(() => node.remove(), 2400)
}

async function act(url, body, done) {
  try {
    const next = await post(url, body)
    if (next?.clock) state = next
    watcher.refresh()
    render(true)
    if (done) toast(done)
  } catch (err) {
    toast(err.message)
    if (/Host PIN/.test(err.message)) {
      logout()
      render(true)
    }
  }
}

const shortName = (id) => C.byId(C.STATIONS, id)?.name.split(/[ &]/)[0] || id
const ago = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min`)
const hhmm = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
const panel = (cls, ...children) => el("div", { class: `panel ${cls || ""}` }, ...children)
/** A time that keeps ticking in place ("12 s ago", "waiting 40 s") without rebuilding its panel. */
const ticking = (since, fmt, cls = "") => el("span", { class: `tick ${cls}`, "data-since": since, "data-fmt": fmt }, tickText(since, fmt, Date.now()))
const tickText = (since, fmt, now) => (fmt === "waiting" ? `waiting ${ago(now - since)}` : `${ago(now - since)} ago`)

/**
 * Rebuild one panel only when its content key changes, and never while the user is typing in it:
 * polls, presence and the clock then leave the page (and its scroll position) exactly where it is.
 */
function slot(id, key, build) {
  const node = document.getElementById(id)
  if (!node) return
  if (node.dataset.key && node.contains(document.activeElement) && document.activeElement !== document.body) return
  patchSlot(node, JSON.stringify(key), build)
}

/* ------------------------------------------------------------ sign-in: one masked PIN field */

/**
 * The host PIN opens the host controls; the same field plus a table signs a Solutions Architect in
 * for that table. The PIN is typed, never shown: the field is masked and nothing on any screen says
 * what it is.
 */
function renderLogin() {
  const input = el("input", { type: "password", placeholder: WORDS.hostPin, "aria-label": WORDS.hostPin, autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", maxlength: 64, id: "pinInput" })
  const stations = (state?.settings?.stations || C.STATIONS.map((s) => s.id)).map((id) => C.byId(C.STATIONS, id))
  const table = el("select", { class: "field", id: "architectTable", "aria-label": "Your table" }, el("option", { value: "" }, "Pick your table"), stations.map((s) => el("option", { value: s.id }, s.name)))
  const name = el("input", { type: "text", placeholder: "Your name (optional)", maxlength: 40, autocomplete: "off", id: "architectName" })
  const signIn = async (asSa) => {
    if (!input.value) {
      input.focus()
      return toast("Enter the host PIN")
    }
    if (asSa && !table.value) return toast("Pick the table you are the Solutions Architect for")
    try {
      await login(input.value, asSa ? table.value : "", asSa ? name.value : "")
      selectedTeam = null
      hostLeads = null
      render(true)
    } catch (err) {
      input.value = ""
      toast(/table|Too many/.test(err.message) ? err.message : "Wrong PIN")
    }
  }
  input.addEventListener("keydown", (e) => e.key === "Enter" && signIn(Boolean(table.value)))
  app.replaceChildren(el("div", { class: "pin-box panel" },
    el("h2", {}, WORDS.hostPin),
    el("p", { class: "small muted" }, "The timer, the race, the teams and restart are behind the host PIN. Teams need no PIN: they play from the table iPads."),
    input,
    el("button", { class: "btn primary", onclick: () => signIn(false), id: "loginGo" }, "Open host controls"),
    el("div", { class: "sa-login" },
      el("h3", {}, "Solutions Architects"),
      el("p", { class: "small muted" }, "Enter the host PIN above, pick your table and open its pitch queue. You only see your table."),
      table, name,
      el("button", { class: "btn", onclick: () => signIn(true), id: "saLoginGo" }, "Open my table")),
    instructionsButton("host")))
}

/* ------------------------------------------------------------ timer, race, teams and budget */

function phaseClock(s) {
  const ms = phaseRemainingMs(s, s.demo ? 0 : offset)
  return Number.isFinite(ms) ? clock(ms) : phaseInfo(phaseOf(s)).idle
}

const TIMER_LINES = {
  open: "No timer is running: play is open and nothing expires. Start one only if you want a countdown.",
  play: "Tables lock when the timer reaches zero. A board locked before then can still be pitched and approved.",
  paused: "The timer is paused. Tables stay open.",
  ended: "Time is up: every table is locked. Start the timer, add minutes or reset it to reopen play.",
  race: "The race has run. Clear the race to reopen play and use the timer again.",
  readout: "The race has run. Clear the race to reopen play and use the timer again.",
}

/** The optional timer: start it (35 minutes unless changed), pause or resume, add or remove minutes, or reset to no timer. */
function renderTimer() {
  const phase = phaseOf(state)
  const timerAct = (body, done) => act("/api/host/timer", body, done)
  const idButton = (id, label, onclick, kind = "") => el("button", { class: `btn ${kind}`.trim(), id, onclick }, label)
  const add = (list) => list.map((m) => button(`${m > 0 ? "+" : "−"}${Math.abs(m)} min`, () => timerAct({ action: "add", minutes: m }), { small: true }))
  const minutes = el("input", { type: "number", id: "timerMinutes", min: 1, max: C.SESSION.maxMinutes, step: 1, value: C.SESSION.timerMinutes, inputmode: "numeric", "aria-label": "Timer minutes" })
  const start = () => timerAct({ action: "start", minutes: minutes.value === "" ? undefined : Number(minutes.value) }, "Timer started")
  minutes.addEventListener("keydown", (e) => e.key === "Enter" && start())
  const startRow = () => [minutes, el("span", { class: "muted" }, "minutes"), idButton("startTimer", "Start timer", start, "go")]
  const reset = (confirmFirst) => idButton("resetTimer", "Reset timer", async () => {
    if (confirmFirst && !(await confirmDialog("Reset the timer? The countdown stops and play stays open with no timer.", "Reset timer"))) return
    timerAct({ action: "reset" }, "No timer: play is open")
  })
  const controls = []
  if (phase === "open") controls.push(...startRow())
  if (phase === "play") controls.push(idButton("pauseTimer", "Pause", () => timerAct({ action: "pause" })), ...add([-5, -1, 1, 5]), reset(true))
  if (phase === "paused") controls.push(idButton("resumeTimer", "Resume", () => timerAct({ action: "resume" }), "go"), ...add([-5, -1, 1, 5]), reset(true))
  if (phase === "ended") controls.push(...startRow(), ...add([1, 5]), reset(false))
  return panel("timer-panel", el("h2", {}, `Timer · ${phaseInfo(phase).name}`),
    el("div", { class: `big-timer${phase === "ended" ? " over" : ""}${phase === "open" ? " idle" : ""}`, id: "bigTimer" }, phaseClock(state)),
    el("p", { class: "muted small", id: "timerLine" }, TIMER_LINES[phase]),
    controls.length ? el("div", { class: "row timer-controls" }, controls) : null)
}

/** The race: run it at any time, then show the readouts; clearing it reopens play. Once it has run, the readout links sit here. */
function renderRace() {
  const s = state
  if (!s.race) {
    const none = !s.teams.length
    const seed = el("input", { type: "text", placeholder: "Seed (optional)", maxlength: 64, id: "raceSeed" })
    const go = async () => {
      const ask = playOpen(state) ? "Run the race now? Play ends for every table, and tables not approved race on the customer's existing setup." : "Run the race? Tables not approved race on the customer's existing setup."
      if (await confirmDialog(ask, WORDS.runRace)) act("/api/host/race", { seed: seed.value }, "Lights out!")
    }
    return panel("race-panel", el("h2", {}, "Race"),
      el("p", { class: "muted small" }, none ? "The race needs at least one team. Teams add themselves on the table iPads." : "Run it whenever the room is ready, with or without a timer. Running the race ends play; the projector shows it in 30 seconds."),
      el("div", { class: "row" }, el("button", { class: "btn primary", id: "hostRunRace", disabled: none, onclick: go }, WORDS.runRace), seed))
  }
  const r = s.race.result
  const readouts = phaseOf(s) === "readout"
  return panel("wide race-panel", el("h2", {}, readouts ? "Race · readouts on the projector" : "Race · finished"),
    el("div", { class: "row" },
      readouts ? null : el("button", { class: "btn go", id: "showReadouts", onclick: () => act("/api/host/readout", {}, "Readouts on the projector") }, "Show readouts"),
      el("button", { class: "btn danger", id: "clearRace", onclick: async () => (await confirmDialog("Clear the race? Its result is discarded and play reopens with no timer.", "Clear the race")) && act("/api/host/unrace", {}, "Race cleared: play is open") }, "Clear the race")),
    el("p", { class: "small muted" }, "Each team's readout opens on one screen, ready for a screenshot. Show readouts makes the projector cycle through them."),
    el("div", { class: "readout-links", id: "readoutLinks" }, r.standings.map((row, i) => {
      const t = s.teams.find((x) => x.id === row.id)
      return el("a", { class: "readout-link", href: `/race.html?team=${encodeURIComponent(row.id)}`, target: "_blank", style: `--c:${row.color}` }, el("b", {}, `${i + 1}. ${t?.name || row.name}`), el("span", { class: "small muted" }, `P${r.results.find((x) => x.id === row.id)?.position} in the race · ${row.score} pts`))
    })))
}

/** The compact team list: teams add themselves at the tables; the host renames or removes one to fix a typo. */
function renderTeams() {
  const s = state
  const raced = Boolean(s.race)
  const rows = s.teams.map((t) => {
    const name = el("input", { type: "text", value: t.name, maxlength: C.TEAM_NAME_MAX, autocomplete: "off", "data-team-name": t.id, "aria-label": `Name of ${t.name}`, disabled: raced })
    const rename = () => {
      if (!name.value.trim() || name.value.trim() === t.name) return toast("Type the new name first")
      act("/api/host/team", { team: t.id, action: "rename", name: name.value }, "Team renamed")
    }
    name.addEventListener("keydown", (e) => e.key === "Enter" && rename())
    const remove = async () => (await confirmDialog(`Remove ${t.name}? Its choices, plans and approvals are deleted.`, "Remove")) && act("/api/host/team", { team: t.id, action: "remove" }, `${t.name} removed`)
    return el("tr", { "data-team-row": t.id }, el("td", {}, el("i", { class: "swatch", style: `background:${t.color}` })), el("td", {}, name),
      el("td", { class: "team-admin-actions" }, button("Rename", rename, { small: true, disabled: raced }), button("Remove", remove, { small: true, kind: "danger", disabled: raced })))
  })
  return panel("", el("h2", {}, `Teams · ${s.teams.length} of ${C.MAX_TEAMS}`),
    el("p", { class: "small muted" }, raced ? "The race has run: clear it to rename or remove a team." : "Teams add themselves on the table iPads. Rename or remove one here to fix a typo."),
    rows.length ? el("table", { class: "grid setup-grid team-admin", id: "teamAdmin" }, el("tbody", {}, rows)) : el("p", { class: "muted", id: "noTeamsYet" }, "No teams yet."))
}

/** One budget level for the whole session: it moves every table's cap lines. */
function budgetSelect(value, onChange, id) {
  const select = el("select", { class: "field", id, "aria-label": "Budget level" }, C.BUDGET_LEVELS.map((b) => el("option", { value: b.id, selected: b.id === value }, `${b.name} budget`)))
  select.addEventListener("change", () => onChange(select.value))
  return select
}

/** True once any dial is locked (or the race has run): the budget level is then fixed, so every board is scored on the same caps. */
const budgetFixed = (s) => Boolean(s.race) || s.teams.some((t) => [t.choices, t.plans, t.reviews].some((x) => x && Object.keys(x).length))

function renderBudget() {
  const level = state.settings.budget || C.DEFAULT_BUDGET
  const fixed = budgetFixed(state)
  const select = budgetSelect(level, (v) => act("/api/host/budget", { budget: v }, `${C.budgetFor(v).name} budget`), "budgetLevel")
  select.disabled = fixed
  return panel("", el("h2", {}, "Budget level"),
    el("div", { class: "row" }, select),
    el("p", { class: "small muted", id: "budgetNote" }, fixed ? `Fixed at ${C.budgetFor(level).name}: a dial has been locked, so every board is scored on the same caps. Restart the experience to change it.` : `${C.budgetFor(level).line} Standard needs no action; change it before the first dial is locked.`))
}

/* ------------------------------------------------------------ approvals, feed and queues */

/** The board a cell shows: the locked plan if there is one, otherwise the live draft. */
function cellBoard(s, team, id, d) {
  if (d.plan) {
    const seconds = Number.isFinite(d.plan.board?.seconds) ? d.plan.board.seconds : boardFor(id, d.plan.choices, d.plan.budget).seconds
    return { fit: d.plan.fit, status: d.plan.status, seconds }
  }
  if (d.status === "none" || d.status === "rejected") return null
  const b = boardFor(id, team.choices, s.settings.budget)
  return { fit: b.fit, status: b.status, seconds: b.seconds }
}

function fitCell(s, team, id, d) {
  const b = cellBoard(s, team, id, d)
  return el("div", { class: "fit-cell", "data-cell": `${team.id}-${id}` },
    miniFit(b ? b.fit : NaN, { status: b?.status, grey: d.status !== "approved", title: b ? `FIT ${b.fit}` : "Not started" }),
    el("span", { class: `cell-sec${d.status === "approved" ? " on" : ""}` }, b ? `${b.seconds.toFixed(2)} s` : "—"),
    el("span", { class: `status-pill st-${d.status}`, title: d.label }, STATUS_LABEL[d.status]),
    d.attempts ? el("span", { class: "attempt-tag", "data-attempt": d.attempts }, WORDS.attempt(d.attempts)) : null)
}

/** What the approvals grid shows, for its content key: statuses, attempts, FIT and seconds. */
function approvalsKey(s) {
  const grid = approvalGrid(s)
  return grid.rows.map((row) => [row.team.id, row.team.name, ...grid.stations.map((id) => {
    const d = row.cells[id]
    const b = cellBoard(s, row.team, id, d)
    return [d.status, d.attempts, d.plan?.id, b?.fit, b?.seconds]
  })])
}

function renderApprovals(s) {
  if (!s.teams.length) return panel("wide", el("h2", {}, "Approvals"), el("p", { class: "muted", id: "noApprovals" }, "No teams yet. Teams add themselves on the table iPads and appear here as they join."))
  const grid = approvalGrid(s)
  const head = el("tr", {}, el("th", {}, "Team"), ...grid.stations.map((id) => el("th", {}, shortName(id))), el("th", {}, "Approved"), el("th", {}, WORDS.secondsFound))
  const rows = grid.rows.map((row) => el("tr", {},
    el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${row.team.color}` }), el("b", {}, row.team.name)),
    ...grid.stations.map((id) => el("td", {}, fitCell(s, row.team, id, row.cells[id]))),
    el("td", {}, el("b", {}, `${row.approved}/${grid.stations.length}`)),
    el("td", { class: "team-seconds", "data-team": row.team.id }, el("b", {}, `${raceSeconds(row.team, s.settings.budget, grid.stations).toFixed(2)} s`))))
  const counts = STATUS_ORDER.filter((st) => grid.counts[st]).map((st) => el("span", { class: `status-pill st-${st}` }, `${STATUS_LABEL[st]} ${grid.counts[st]}`))
  return panel("wide", el("h2", {}, "Approvals"),
    el("p", { class: "small muted" }, `Each cell shows the board's seconds found per lap, FIT (grey until approved) and which attempt the team is on. ${WORDS.secondsFound} adds up approved tables only: that is what the race uses; the rest race on ${WORDS.todaySetup.toLowerCase()}. ${grid.counts.approved} of ${grid.total} approved · ${C.budgetFor(s.settings.budget).name} budget.`),
    el("div", { class: "row", id: "approvalCounts" }, counts),
    el("div", { class: "table-scroll", id: "approvalsGrid" }, el("table", { class: "grid approvals" }, el("thead", {}, head), el("tbody", {}, rows))))
}

/** One team's row of the live feed, minus the ticking "seen" time. */
function feedRow(s, pres, t) {
  const p = pres.presence?.[t.id]
  const seat = Object.entries(s.tables || {}).find(([, x]) => x.team === t.id)
  const where = p ? `${shortName(p.station)} · ${p.step}` : seat ? shortName(seat[0]) : "—"
  const queued = Object.entries(s.queues || {}).filter(([, list]) => list.some((e) => e.team === t.id)).map(([id]) => shortName(id))
  const sims = Object.entries(t.sims || {}).filter(([, r]) => Number.isFinite(r.lastFit)).sort((a, b) => b[1].lastAt - a[1].lastAt)[0]
  const latest = sims ? `${Number.isFinite(sims[1].lastSeconds) ? `${sims[1].lastSeconds.toFixed(2)} s · ` : ""}FIT ${sims[1].lastFit}${sims[1].inZone ? " ✓" : ""} ${shortName(sims[0])}` : "—"
  return { where, latest, queued: queued.length ? queued.join(", ") : "—", seenAt: p?.at || null }
}

const feedKey = (s, pres) => s.teams.map((t) => {
  const r = feedRow(s, pres, t)
  return [t.id, t.name, r.where, r.latest, r.queued, r.seenAt == null ? null : true]
})

function renderFeed(s, pres) {
  const rows = s.teams.map((t) => {
    const r = feedRow(s, pres, t)
    return el("tr", {},
      el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${t.color}` }), el("b", {}, t.name)),
      el("td", { class: "small" }, r.where),
      el("td", { class: "small" }, r.latest),
      el("td", { class: "small" }, r.queued),
      el("td", { class: "small" }, r.seenAt == null ? el("span", { class: "muted" }, "—") : ticking(r.seenAt, "ago", "seen")))
  })
  return panel("", el("h2", {}, "Live feed"),
    el("div", { class: "table-scroll" }, el("table", { class: "grid feed" }, el("thead", {}, el("tr", {}, ["Team", "Now", "Latest board", "Queued", "Seen"].map((h) => el("th", {}, h)))), el("tbody", {}, rows))))
}

function renderQueues(s) {
  const tables = s.settings.stations.map((id) => {
    const list = s.queues?.[id] || []
    const arch = s.architects?.[id]
    const q = (action, team) => act("/api/host/queue", { station: id, action, team })
    return el("div", { class: "queue-table" },
      el("h3", {}, `${C.byId(C.STATIONS, id).name} `, el("span", { class: arch?.available ? "done small" : "muted small" }, arch?.available ? "· Available" : "· Busy"),
        s.pitches?.[id] ? el("span", { class: "small warn-text" }, ` · pitching: ${s.teams.find((x) => x.id === s.pitches[id].team)?.name || ""}`) : null,
        button(`Act as ${WORDS.sa}`, () => { hostLeads = id; selectedTeam = null; render(true) }, { small: true })),
      list.length ? el("div", { class: "queue-list" }, list.map((entry, i) => {
        const t = s.teams.find((x) => x.id === entry.team)
        return el("div", { class: "q" }, el("b", {}, `${i + 1}.`), el("span", { style: `color:${t?.color};font-weight:800` }, t?.name || entry.team), el("span", { class: "muted small" }, `since ${hhmm(entry.at)}`),
          button("↑", () => q("up", entry.team), { small: true, disabled: i === 0 }), button("↓", () => q("down", entry.team), { small: true, disabled: i === list.length - 1 }), button("Remove", () => q("remove", entry.team), { small: true, kind: "danger" }))
      })) : el("div", { class: "muted small" }, "No queue"))
  })
  return panel("", el("h2", {}, "Pitch queues"), ...tables)
}

function renderLinks() {
  return panel("", el("h2", {}, "Table iPads"),
    el("div", { style: "display:grid;gap:6px" }, C.STATIONS.filter((s) => state.settings.stations.includes(s.id)).map((s) => el("a", { href: `/station.html?station=${s.id}`, target: "_blank" }, `${s.name}: ${location.origin}/station.html?station=${s.id}`))))
}

function toolbar() {
  return panel("row wide", instructionsButton("host"),
    button("Demo mode", () => { demoIndex = 0; render(true) }, { small: true }),
    el("button", { class: "btn danger small-btn", id: "restartExperience", onclick: restartExperience }, "Restart the experience"),
    button("Log out", () => { logout(); render(true) }, { small: true }),
    el("span", { class: "muted small" }, `${state.teams.length} team${state.teams.length === 1 ? "" : "s"} · ${DEMO_STEPS.length}-step demo`))
}

const CONTROL_SLOTS = ["toolbarSlot", "timerSlot", "raceSlot", "approvalsSlot", "queuesSlot", "feedSlot", "teamsSlot", "budgetSlot", "linksSlot"]

/** The host controls: one slot per panel, each rebuilt only when what it shows changes. Nothing here needs setting up first. */
function renderControl(force) {
  const s = state
  if (force || screen !== "control" || !document.getElementById("hostControls")) {
    screen = "control"
    replaceKeepingScroll(app, el("div", { class: "host-grid", id: "hostControls" }, CONTROL_SLOTS.map((id) => el("div", { id, class: "slot" }))))
  }
  const has = s.teams.length > 0
  const teamNames = s.teams.map((t) => [t.id, t.name, t.color])
  slot("toolbarSlot", [s.teams.length], toolbar)
  slot("timerSlot", [phaseOf(s)], renderTimer)
  slot("raceSlot", [phaseOf(s), s.race?.seed, has, s.race ? teamNames : null], renderRace)
  slot("approvalsSlot", [approvalsKey(s), s.settings.budget, s.settings.stations], () => renderApprovals(s))
  slot("queuesSlot", [s.queues, s.architects, s.pitches, s.settings.stations, teamNames], () => renderQueues(s))
  slot("feedSlot", has ? feedKey(s, presence) : null, () => (has ? renderFeed(s, presence) : null))
  slot("teamsSlot", [teamNames, Boolean(s.race)], renderTeams)
  slot("budgetSlot", [s.settings.budget, budgetFixed(s)], renderBudget)
  slot("linksSlot", [s.settings.stations], renderLinks)
}

/* ------------------------------------------------------------ Solutions Architect */

/** One table's SA view: the queue, the design as the team locked it, the brief and the 30-second pitch. Available is a courtesy to the teams, not a step. */
function renderArchitect(stationId, force) {
  const s = state
  const station = C.byId(C.STATIONS, stationId)
  const me = session()
  const by = me.role === "architect" ? me.name || station.architect : "Host"
  const arch = s.architects?.[stationId] || { available: false }
  const pitch = s.pitches?.[stationId] || null
  const now = Date.now() + offset
  const queue = s.queues?.[stationId] || []
  const byId = (id) => s.teams.find((t) => t.id === id)
  if (!selectedTeam || !byId(selectedTeam)) selectedTeam = pitch?.team || queue[0]?.team || null
  const go = (url, body, done) => act(url, { station: stationId, by, ...body }, done)

  if (force || screen !== `architect:${stationId}` || !document.getElementById("architectView")) {
    screen = `architect:${stationId}`
    replaceKeepingScroll(app, el("div", { class: "host-grid architect-grid", id: "architectView" }, ["saHead", "saPitch", "saDetail", "saQueue", "saTeams", "saBrief"].map((id) => el("div", { id, class: "slot" }))))
  }

  slot("saHead", [stationId, arch.available, Boolean(pitch), by], () => panel("wide architect-head",
    el("div", { class: "row" },
      el("h2", { style: `color:${station.color};margin:0` }, `${station.name} · ${station.architect}`),
      el("span", { class: "muted" }, me.role === "architect" ? `Signed in as ${by}` : `Host acting as ${WORDS.solutionsArchitect}`),
      el("span", { style: "flex:1" }),
      el("button", { class: `btn ${arch.available ? "go" : ""}`, id: "availabilityToggle", disabled: Boolean(pitch), onclick: () => go("/api/architect/availability", { available: !arch.available }, arch.available ? "You are Busy" : "You are Available") }, arch.available ? "Available" : "Busy"),
      instructionsButton("architect"),
      me.role === "host" ? button("Back to host controls", () => { hostLeads = null; render(true) }, { small: true }) : button("Log out", () => { logout(); render(true) }, { small: true }))))

  slot("saPitch", [pitch?.team, pitch?.startedAt, pitch?.attempt], () => {
    if (!pitch) return null
    const t = byId(pitch.team)
    const secs = Math.ceil((pitch.endsAt - now) / 1000)
    const reason = el("input", { type: "text", id: "rejectReason", maxlength: REJECT_REASON_MAX, placeholder: "Short reason the team will see" })
    return panel("wide pitch-live",
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, `${WORDS.pitching}: `, teamChip(t)), el("span", { class: "status-pill st-pitching" }, WORDS.attempt(pitch.attempt || 1)), el("span", { style: "flex:1" }),
        el("div", { class: `pitch-timer${secs <= 0 ? " over" : ""}`, id: "pitchTimer", "data-ends": pitch.endsAt }, clock(pitch.endsAt - now))),
      el("div", { class: `decide-prompt${secs <= 0 ? " show" : ""}`, id: "decidePrompt" }, "Time is up: approve the design or reject it with a reason."),
      el("div", { class: "row" },
        el("button", { class: "btn go", id: "approveBtn", onclick: () => go("/api/architect/decide", { team: t.id, decision: "approve" }, `${t.name}: ${WORDS.approved}`) }, WORDS.approve),
        reason,
        el("button", { class: "btn danger", id: "rejectBtn", onclick: () => go("/api/architect/decide", { team: t.id, decision: "reject", reason: reason.value }, `${t.name}: rejected`) }, WORDS.reject),
        button("Cancel pitch", () => go("/api/architect/pitch", { action: "cancel" }, "Pitch cancelled"), { small: true })))
  })

  const startButton = (t) => {
    const d = designStatus(s, t, stationId)
    const can = !pitch && Boolean(d.plan) && d.status !== "approved"
    const why = !d.plan ? "Not all three choices are locked" : d.status === "approved" ? "Already approved" : pitch ? "A pitch is running" : `${PITCH_SECONDS}-second pitch`
    return el("button", { class: "btn primary small-btn", disabled: !can, title: why, "data-start": t.id, onclick: () => go("/api/architect/pitch", { action: "start", team: t.id }, `${t.name}: pitch started`) }, WORDS.startPitch)
  }

  slot("saQueue", [queue.map((e) => [e.team, e.at]), selectedTeam, arch.available, Boolean(pitch), queue.map((e) => designStatus(s, byId(e.team), stationId).status)], () => panel("", el("h2", {}, "Pitch queue"),
    queue.length ? el("div", { class: "queue-list", id: "architectQueue" }, queue.map((entry, i) => {
      const t = byId(entry.team)
      if (!t) return null
      const d = designStatus(s, t, stationId)
      return el("div", { class: `q${selectedTeam === t.id ? " selected" : ""}` }, el("b", {}, `${i + 1}.`), teamChip(t), el("span", { class: "muted small" }, WORDS.attempt(d.attempts)), ticking(entry.at, "waiting", "muted small"),
        button("Review", () => { selectedTeam = t.id; render(true) }, { small: true }), startButton(t))
    })) : el("p", { class: "muted" }, `Nobody is queued. Teams join with ${WORDS.callArchitect} once their three choices are locked.`)))

  slot("saTeams", [selectedTeam, s.teams.map((t) => { const d = designStatus(s, t, stationId); return [t.id, t.name, d.status, d.attempts, d.label] })], () => panel("", el("h2", {}, "Every team at this table"),
    el("table", { class: "grid" }, el("tbody", {}, s.teams.map((t) => {
      const d = designStatus(s, t, stationId)
      return el("tr", { class: selectedTeam === t.id ? "selected" : "" }, el("td", {}, teamChip(t)), el("td", {}, el("span", { class: `status-pill st-${d.status}` }, d.label), d.attempts ? el("span", { class: "attempt-tag" }, WORDS.attempt(d.attempts)) : null), el("td", {}, button("Review", () => { selectedTeam = t.id; render(true) }, { small: true })))
    })))))

  const sel = byId(selectedTeam)
  const selStatus = sel ? designStatus(s, sel, stationId) : null
  slot("saDetail", [selectedTeam, selStatus?.status, selStatus?.plan?.id, selStatus?.attempts, selStatus?.review?.at, sel?.choices, s.settings.budget, arch.available, Boolean(pitch)], () => {
    const t = sel
    if (!t) return panel("wide", el("p", { class: "muted" }, "Pick a team to read its design."))
    const d = selStatus
    const choices = d.plan ? d.plan.choices : t.choices
    const draft = (() => {
      if (d.plan) return null
      const view = createBoard({ stationId, budget: s.settings.budget, interactive: false, id: "architectBoard" })
      view.update(choices, { locked: true, chosen: lockedDials(t, stationId), ghosts: ghostsAt(t, stationId) })
      return view.el
    })()
    return panel("wide architect-summary",
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, teamChip(t)), el("span", { class: `status-pill st-${d.status}` }, d.label), d.attempts ? el("span", { class: "status-pill" }, WORDS.attempt(d.attempts)) : null,
        el("span", { style: "flex:1" }), d.plan ? el("span", { class: "small muted" }, `Plan ${d.plan.id}`) : null, startButton(t)),
      !d.plan ? el("p", { class: "small warn-text" }, d.status === "rejected" || d.status === "adjusting" ? `Rejected: the team is adjusting (${WORDS.lockedCount(lockedDials(t, stationId).length)}). Dashed settings are what they locked last time.` : `Not all three choices are locked yet (${WORDS.lockedCount(lockedDials(t, stationId).length)}): this is their board so far.`) : null,
      d.plan ? frozenBoard(d.plan, { id: "architectBoard", scene: "live" }) : draft,
      summaryBlock(designSummary(choices, stationId, d.plan?.budget || s.settings.budget)),
      d.review ? el("p", { class: "small muted" }, d.review.status === "approved" ? `Approved by ${d.review.by} at ${hhmm(d.review.at)} (${WORDS.attempt(d.review.attempt || 1).toLowerCase()}).` : `Rejected by ${d.review.by} at ${hhmm(d.review.at)}${d.review.reason ? `: "${d.review.reason}"` : ""} (${WORDS.attempt(d.review.attempt || 1).toLowerCase()}).`) : null)
  })

  slot("saBrief", [stationId], () => panel("wide sa-brief", el("details", {}, el("summary", {}, `The ${station.name} brief the teams read`), briefView(stationId, { compact: true }))))
}

/* ------------------------------------------------------------ restart and demo */

/** Restart: an empty game, open for the next group at once. The host is already behind the PIN, so one confirmation is enough. */
async function restartExperience() {
  if (!(await confirmDialog("Restart the experience? Every team, choice, plan, queue and score is deleted, and an empty game opens for the next group.", "Restart"))) return
  hostLeads = null
  selectedTeam = null
  act("/api/host/reset", {}, "Restarted: an empty game is open")
}

function renderDemo() {
  const demo = buildDemo(demoIndex)
  const s = { ...demo.state, demo: true }
  const team = s.teams.find((t) => t.id === demo.focus.team)
  const st = demo.focus.station
  const station = C.byId(C.STATIONS, st)
  const screenNodes = []
  const budget = s.settings.budget
  const oneShotBoard = (ghosts) => {
    const choices = { ...team.choices }
    const chosen = Object.keys(choices).filter((k) => C.decisionsFor(st).some((d) => d.id === k))
    const view = createBoard({ stationId: st, budget, interactive: true, id: "demoBoard", onDial: (d, o) => { if (choices[d] !== undefined) return; choices[d] = o; chosen.push(d); view.update(choices, { chosen, ghosts }) } })
    view.update(choices, { chosen, ghosts })
    const lockNext = () => {
      const d = C.decisionsFor(st).find((x) => choices[x.id] === undefined)
      if (!d) return toast(WORDS.allLocked)
      choices[d.id] = C.REFERENCE_BUILD[d.id]
      chosen.push(d.id)
      view.update(choices, { chosen, ghosts })
    }
    return { view, lockNext }
  }
  if (demo.step.screen === "brief") {
    screenNodes.push(panel("wide", el("h2", {}, `${station.name}: the brief`),
      el("div", { class: "brief-gate" }, el("button", { class: "btn primary", disabled: true }, WORDS.readBrief), el("p", { class: "small muted" }, WORDS.briefGateHint), el("p", { class: "one-shot-warning" }, el("b", {}, WORDS.oneShot))),
      briefView(st, { compact: true })))
  } else if (demo.step.screen === "tuneOff" || demo.step.screen === "tuneOn") {
    const { view, lockNext } = oneShotBoard(null)
    screenNodes.push(panel("wide", el("div", { class: "row" }, el("h2", { style: "margin:0" }, `${team.name} at ${station.name}`), el("span", { style: "flex:1" }),
      el("button", { class: "btn primary small-btn", id: "demoTurn", onclick: lockNext }, "Lock a dial for me")),
      demo.step.screen === "tuneOff" ? el("div", { class: "state-banner warn one-shot-banner" }, el("b", {}, WORDS.oneShot)) : learningCard(st, { id: "demoLesson" }),
      view.el))
  } else if (demo.step.screen === "plan") {
    screenNodes.push(panel("wide", stateBanner(`${WORDS.allLocked} (attempt 1): the team taps ${WORDS.callArchitect}.`, "info"), el("div", { class: "actions" }, el("span", { class: "btn primary" }, WORDS.callArchitect)), planSheet(team, team.plans[st], { screenshotPrompt: false })))
  } else if (demo.step.screen === "rejected") {
    const { view, lockNext } = oneShotBoard(team.previous[st])
    screenNodes.push(panel("wide", el("div", { class: "row" }, el("h2", { style: "margin:0" }, `${team.name} at ${station.name}`), el("span", { style: "flex:1" }),
      el("button", { class: "btn primary small-btn", id: "demoTurn", onclick: lockNext }, "Lock a dial for me")),
      el("div", { class: "state-banner bad rejected-banner" }, el("b", {}, WORDS.rejected(team.reviews[st].reason))),
      view.el))
  } else if (demo.step.screen === "architect") {
    screenNodes.push(panel("wide", el("h2", {}, `${station.architect} · ${WORDS.pitching}: ${team.name} · ${WORDS.attempt(2)}`), el("div", { class: "pitch-timer" }, `0:${PITCH_SECONDS}`),
      frozenBoard(team.plans[st], { id: "demoBoard", scene: "live" }), summaryBlock(designSummary(team.plans[st].choices, st, budget)),
      el("div", { class: "row" }, el("span", { class: "btn go" }, WORDS.approve), el("input", { type: "text", placeholder: "Short reason the team will see", disabled: true }), el("span", { class: "btn danger" }, WORDS.reject))))
    screenNodes.push(renderApprovals(s))
  } else if (demo.step.screen === "race") {
    screenNodes.push(podiumGraphic(s.race.result), panel("", el("h2", {}, "Race ticker"), el("ul", { class: "small" }, s.race.result.events.filter((e) => e.team).slice(0, 6).map((e) => el("li", {}, `Lap ${e.lap}: ${e.text}`)))))
  } else if (demo.step.screen === "readout") {
    screenNodes.push(el("div", { class: "wide" }, readoutCard(readoutFor(team, s.race.result, s.settings.stations, budget))))
  }
  app.replaceChildren(el("div", { class: "host-grid" },
    panel("demo-narration wide", el("h2", {}, `Demo mode · ${demo.step.title}`), el("p", {}, demo.step.narration),
      el("p", { class: "small muted" }, "Pretend teams, pretend game: nothing here touches the real game."),
      el("div", { class: "row" },
        button("← Back", () => { demoIndex -= 1; render(true) }, { disabled: demo.index === 0 }),
        el("span", { class: "muted" }, `${demo.index + 1} / ${demo.total}`),
        button("Next →", () => { demoIndex += 1; render(true) }, { kind: "primary", disabled: demo.index === demo.total - 1 }),
        button("Exit demo", () => { demoIndex = null; render(true) }, { kind: "danger" }))),
    ...screenNodes))
  window.scrollTo({ top: 0 })
}

/* ------------------------------------------------------------ render */

function render(force) {
  if (!state) return
  const me = session()
  if (me.role !== "host" && me.role !== "architect") {
    if (force || screen !== "login") {
      screen = "login"
      renderLogin()
    }
    return
  }
  if (me.role === "host" && demoIndex !== null) {
    if (force || screen !== "demo") {
      screen = "demo"
      renderDemo()
    }
    return
  }
  if (!gameClock(state)) {
    if (screen !== "reconnecting") app.replaceChildren(panel("", el("h2", {}, "Reconnecting to the game server"), el("p", { class: "muted" }, "Retrying every second.")))
    screen = "reconnecting"
    return
  }
  const leads = me.role === "architect" ? me.station : hostLeads
  if (leads) return renderArchitect(leads, force)
  renderControl(force)
}

setInterval(() => {
  try {
    const now = Date.now()
    const node = document.getElementById("bigTimer")
    if (node && state && demoIndex === null) setText(node, phaseClock(state))
    const timer = document.getElementById("pitchTimer")
    if (timer) {
      const ms = Number(timer.dataset.ends) - (now + offset)
      setText(timer, clock(ms))
      timer.classList.toggle("over", ms <= 0)
      document.getElementById("decidePrompt")?.classList.toggle("show", ms <= 0)
    }
    for (const tick of document.querySelectorAll(".tick[data-since]")) {
      const since = Number(tick.dataset.since)
      setText(tick, tickText(since, tick.dataset.fmt, now))
      if (tick.classList.contains("seen")) {
        const seen = now - since
        tick.classList.toggle("dead", seen > 30_000)
        tick.classList.toggle("stale", seen > 12_000 && seen <= 30_000)
      }
    }
  } catch (err) {
    console.error("[podium] host timer", err)
  }
}, 250)
