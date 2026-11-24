import * as C from "/js/catalog.js"
import { boardFor, raceSeconds } from "/js/model.js"
import { miniFit, learningCard, createBoard } from "/js/board.js"
import { planSheet, summaryBlock, frozenBoard } from "/js/plan.js"
import { designSummary } from "/js/summary.js"
import { designStatus, approvalGrid, lockedDials, ghostsAt, STATUS_LABEL, STATUS_ORDER, PITCH_SECONDS, REJECT_REASON_MAX } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs, playOpen } from "/js/session.js"
import { DEMO_STEPS, buildDemo } from "/js/demo.js"
import { readoutFor, finaleSummary } from "/js/report.js"
import { readoutCard } from "/js/readoutview.js"
import { finaleGraphic } from "/js/podium.js"
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

/** The one participant: the customer's team, created by the server. */
const customer = (s) => s.teams.find((t) => t.id === C.CUSTOMER_TEAM.id) || s.teams[0] || null

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
    el("p", { class: "small muted" }, `The timer, the race and restart are behind the host PIN. The ${C.CUSTOMER_TEAM.name} needs no PIN: it plays from the four table iPads.`),
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

/**
 * The race: the customer's 2027 plan against today's Hinwil setup. Run it at any time, then show
 * the readout; clearing it reopens play. Once it has run, the result and the readout link sit here.
 */
function renderRace() {
  const s = state
  const team = customer(s)
  if (!s.race) {
    const seed = el("input", { type: "text", placeholder: "Seed (optional)", maxlength: 64, id: "raceSeed" })
    const go = async () => {
      const ask = playOpen(state) ? "Run the race now? Play ends for every table, and tables not approved race on today's Hinwil setup." : "Run the race? Tables not approved race on today's Hinwil setup."
      if (await confirmDialog(ask, WORDS.runRace)) act("/api/host/race", { seed: seed.value }, "Lights out!")
    }
    const found = team ? raceSeconds(team, s.settings.budget, s.settings.stations) : 0
    return panel("race-panel", el("h2", {}, "Race"),
      el("p", { class: "muted small" }, `Two cars over ${C.FINALE.laps} laps: the ${team?.name || C.CUSTOMER_TEAM.name}'s ${WORDS.plan2027} (${found.toFixed(2)} s per lap from the approved tables so far) against ${WORDS.todayHinwil.toLowerCase()} at 0.00 s. Run it whenever the room is ready, with or without a timer. Running the race ends play; the projector shows it in 30 seconds.`),
      el("div", { class: "row" }, el("button", { class: "btn primary", id: "hostRunRace", onclick: go }, WORDS.runRace), seed))
  }
  const r = s.race.result
  const readouts = phaseOf(s) === "readout"
  const finale = finaleSummary(r)
  return panel("wide race-panel", el("h2", {}, readouts ? "Race · readout on the projector" : "Race · finished"),
    el("p", { class: "finale-line", id: "finaleLine" }, finale.text),
    el("div", { class: "row" },
      readouts ? null : el("button", { class: "btn go", id: "showReadouts", onclick: () => act("/api/host/readout", {}, "Readout on the projector") }, "Show readout"),
      el("button", { class: "btn danger", id: "clearRace", onclick: async () => (await confirmDialog("Clear the race? Its result is discarded and play reopens with no timer.", "Clear the race")) && act("/api/host/unrace", {}, "Race cleared: play is open") }, "Clear the race")),
    el("p", { class: "small muted" }, "The customer's readout opens on one screen, ready for a screenshot. Show readout puts it on the projector."),
    el("div", { class: "readout-links", id: "readoutLinks" },
      el("a", { class: "readout-link", href: `/race.html?team=${encodeURIComponent(C.CUSTOMER_TEAM.id)}`, target: "_blank", style: `--c:${team?.color || C.CUSTOMER_TEAM.color}` }, el("b", {}, `${team?.name || C.CUSTOMER_TEAM.name} · readout`), el("span", { class: "small muted" }, `${finale.gap.toFixed(1)} s over ${r.laps} laps`))))
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

/** What the approvals grid shows, for its content key: per table the status, attempt, FIT and seconds. */
function approvalsKey(s) {
  const grid = approvalGrid(s)
  return grid.rows.map((row) => [row.team.id, row.team.name, ...grid.stations.map((id) => {
    const d = row.cells[id]
    const b = cellBoard(s, row.team, id, d)
    return [d.status, d.attempts, d.plan?.id, b?.fit, b?.seconds]
  })])
}

/**
 * The customer's four tables, one row each: where the design stands, which attempt, the seconds
 * the board finds, its FIT and whether the SA has approved it. The total is what the race uses.
 */
function renderApprovals(s) {
  const team = customer(s)
  if (!team) return panel("wide", el("h2", {}, "Approvals"), el("p", { class: "muted", id: "noApprovals" }, "Waiting for the game server to create the customer's team."))
  const grid = approvalGrid(s)
  const row = grid.rows.find((r) => r.team.id === team.id) || grid.rows[0]
  const head = el("tr", {}, ["Table", "Status", "Attempt", WORDS.secondsFound, "FIT", "Approved"].map((h) => el("th", {}, h)))
  const rows = grid.stations.map((id) => {
    const station = C.byId(C.STATIONS, id)
    const d = row.cells[id]
    const b = cellBoard(s, team, id, d)
    const approved = d.status === "approved"
    return el("tr", { "data-table": id, class: approved ? "approved" : "" },
      el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${station.color}` }), el("b", {}, station.name)),
      el("td", {}, el("span", { class: `status-pill st-${d.status}`, title: d.label }, STATUS_LABEL[d.status])),
      el("td", {}, d.attempts ? el("span", { class: "attempt-tag", "data-attempt": d.attempts }, WORDS.attempt(d.attempts)) : el("span", { class: "muted" }, "—")),
      el("td", { class: "table-seconds" }, el("b", { class: approved ? "on" : "muted" }, b ? `${b.seconds.toFixed(2)} s` : "—"), approved ? null : el("span", { class: "small muted" }, b ? " not yet counted" : "")),
      el("td", {}, miniFit(b ? b.fit : NaN, { status: b?.status, grey: !approved, title: b ? `FIT ${b.fit}` : "Not started" })),
      el("td", { class: "approved-cell" }, approved ? el("span", { class: "done" }, `✓ ${hhmm(d.review.at)}`) : el("span", { class: "muted" }, "—")))
  })
  const total = raceSeconds(team, s.settings.budget, grid.stations)
  const foot = el("tr", { id: "tablesTotal" },
    el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${team.color}` }), el("b", {}, `Total · ${team.name}`)),
    el("td", { colspan: 2 }, el("span", { class: "small muted" }, `${row.approved} of ${grid.stations.length} tables approved`)),
    el("td", { class: "table-seconds" }, el("b", { class: "on", id: "secondsTotal" }, `${total.toFixed(2)} s`)),
    el("td", { colspan: 2 }, el("span", { class: "small muted" }, "per lap in the race")))
  const counts = STATUS_ORDER.filter((st) => grid.counts[st]).map((st) => el("span", { class: `status-pill st-${st}` }, `${STATUS_LABEL[st]} ${grid.counts[st]}`))
  return panel("wide", el("h2", {}, `Approvals · ${team.name}`),
    el("p", { class: "small muted" }, `One row per table: the board's seconds found per lap, its FIT (grey until approved) and which attempt the table is on. The total adds up approved tables only: that is the ${WORDS.plan2027}'s pace in the race; the rest race on ${WORDS.todaySetup.toLowerCase()}. ${row.approved} of ${grid.stations.length} approved · ${C.budgetFor(s.settings.budget).name} budget.`),
    el("div", { class: "row", id: "approvalCounts" }, counts),
    el("div", { class: "table-scroll", id: "approvalsGrid" }, el("table", { class: "grid approvals tables-grid", id: "tablesGrid" }, el("thead", {}, head), el("tbody", {}, rows), el("tfoot", {}, foot))))
}

/** One table's row of the live feed, minus the ticking "seen" time. */
function feedRow(s, pres, team, id) {
  const p = pres.presence?.[id]
  const seat = s.tables?.[id]
  const where = p?.step ? `On ${p.step}` : seat ? "Seated" : "—"
  const queued = (s.queues?.[id] || []).some((e) => e.team === team.id)
  const sim = team.sims?.[id]
  const latest = sim && Number.isFinite(sim.lastFit) ? `${Number.isFinite(sim.lastSeconds) ? `${sim.lastSeconds.toFixed(2)} s · ` : ""}FIT ${sim.lastFit}${sim.inZone ? " ✓" : ""}` : "—"
  return { where, latest, queued: queued ? "Waiting for the SA" : "—", seenAt: p?.at || null }
}

const feedKey = (s, pres) => {
  const team = customer(s)
  return team ? s.settings.stations.map((id) => {
    const r = feedRow(s, pres, team, id)
    return [id, r.where, r.latest, r.queued, r.seenAt == null ? null : true]
  }) : null
}

function renderFeed(s, pres) {
  const team = customer(s)
  if (!team) return null
  const rows = s.settings.stations.map((id) => {
    const station = C.byId(C.STATIONS, id)
    const r = feedRow(s, pres, team, id)
    return el("tr", { "data-feed": id },
      el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${station.color}` }), el("b", {}, station.name)),
      el("td", { class: "small" }, r.where),
      el("td", { class: "small" }, r.latest),
      el("td", { class: "small" }, r.queued),
      el("td", { class: "small" }, r.seenAt == null ? el("span", { class: "muted" }, "—") : ticking(r.seenAt, "ago", "seen")))
  })
  return panel("", el("h2", {}, "Live feed"),
    el("p", { class: "small muted" }, `The ${team.name}'s four iPads: which step each table is on, its latest board and whether it is waiting for its SA.`),
    el("div", { class: "table-scroll" }, el("table", { class: "grid feed" }, el("thead", {}, el("tr", {}, ["Table", "Now", "Latest board", "Queue", "Seen"].map((h) => el("th", {}, h)))), el("tbody", {}, rows))))
}

function renderQueues(s) {
  const tables = s.settings.stations.map((id) => {
    const list = s.queues?.[id] || []
    const arch = s.architects?.[id]
    const q = (action, team) => act("/api/host/queue", { station: id, action, team })
    return el("div", { class: "queue-table" },
      el("h3", {}, `${C.byId(C.STATIONS, id).name} `, el("span", { class: arch?.available ? "done small" : "muted small" }, arch?.available ? "· Available" : arch ? "· Busy" : `· No ${WORDS.sa} signed in`),
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
  const team = customer(state)
  return panel("row wide", instructionsButton("host"),
    button("Demo mode", () => { demoIndex = 0; render(true) }, { small: true }),
    el("button", { class: "btn danger small-btn", id: "restartExperience", onclick: restartExperience }, "Restart the experience"),
    button("Log out", () => { logout(); render(true) }, { small: true }),
    team ? teamChip(team) : null,
    el("span", { class: "muted small" }, `${state.settings.stations.length} tables · ${DEMO_STEPS.length}-step demo`))
}

const CONTROL_SLOTS = ["toolbarSlot", "timerSlot", "raceSlot", "approvalsSlot", "queuesSlot", "feedSlot", "budgetSlot", "linksSlot"]

/** The host controls: one slot per panel, each rebuilt only when what it shows changes. Nothing here needs setting up first. */
function renderControl(force) {
  const s = state
  if (force || screen !== "control" || !document.getElementById("hostControls")) {
    screen = "control"
    replaceKeepingScroll(app, el("div", { class: "host-grid", id: "hostControls" }, CONTROL_SLOTS.map((id) => el("div", { id, class: "slot" }))))
  }
  const team = customer(s)
  const teamKey = team ? [team.id, team.name, team.color] : null
  slot("toolbarSlot", [teamKey, s.settings.stations], toolbar)
  slot("timerSlot", [phaseOf(s)], renderTimer)
  slot("raceSlot", [phaseOf(s), s.race?.seed, teamKey, s.race ? null : approvalsKey(s), s.settings.budget], renderRace)
  slot("approvalsSlot", [approvalsKey(s), s.settings.budget, s.settings.stations, teamKey], () => renderApprovals(s))
  slot("queuesSlot", [s.queues, s.architects, s.pitches, s.settings.stations, teamKey], () => renderQueues(s))
  slot("feedSlot", feedKey(s, presence), () => renderFeed(s, presence))
  slot("budgetSlot", [s.settings.budget, budgetFixed(s)], renderBudget)
  slot("linksSlot", [s.settings.stations], renderLinks)
}

/* ------------------------------------------------------------ Solutions Architect */

/** One table's SA view: the queue (of one), the design as the customer locked it, the brief and the 30-second pitch. Available is a courtesy to the table, not a step. */
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
  if (!selectedTeam || !byId(selectedTeam)) selectedTeam = pitch?.team || queue[0]?.team || customer(s)?.id || null
  const go = (url, body, done) => act(url, { station: stationId, by, ...body }, done)

  if (force || screen !== `architect:${stationId}` || !document.getElementById("architectView")) {
    screen = `architect:${stationId}`
    replaceKeepingScroll(app, el("div", { class: "host-grid architect-grid", id: "architectView" }, ["saHead", "saPitch", "saDetail", "saQueue", "saBrief"].map((id) => el("div", { id, class: "slot" }))))
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
    const reason = el("input", { type: "text", id: "rejectReason", maxlength: REJECT_REASON_MAX, placeholder: "Short reason the table will see" })
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
    })) : el("p", { class: "muted" }, `Nobody is queued. The table joins with ${WORDS.callArchitect} once its three choices are locked.`)))

  const sel = byId(selectedTeam)
  const selStatus = sel ? designStatus(s, sel, stationId) : null
  slot("saDetail", [selectedTeam, selStatus?.status, selStatus?.plan?.id, selStatus?.attempts, selStatus?.review?.at, sel?.choices, s.settings.budget, arch.available, Boolean(pitch)], () => {
    const t = sel
    if (!t) return panel("wide", el("p", { class: "muted" }, "Waiting for the game server to create the customer's team."))
    const d = selStatus
    const choices = d.plan ? d.plan.choices : t.choices
    const draft = (() => {
      if (d.plan) return null
      const view = createBoard({ stationId, budget: s.settings.budget, interactive: false, id: "architectBoard" })
      view.update(choices, { locked: true, chosen: lockedDials(t, stationId), ghosts: ghostsAt(t, stationId) })
      return view.el
    })()
    return panel("wide architect-summary",
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, teamChip(t), el("span", { class: "muted" }, ` at ${station.name}`)), el("span", { class: `status-pill st-${d.status}` }, d.label), d.attempts ? el("span", { class: "status-pill" }, WORDS.attempt(d.attempts)) : null,
        el("span", { style: "flex:1" }), d.plan ? el("span", { class: "small muted" }, `Plan ${d.plan.id}`) : null, startButton(t)),
      !d.plan ? el("p", { class: "small warn-text" }, d.status === "rejected" || d.status === "adjusting" ? `Rejected: the table is adjusting (${WORDS.lockedCount(lockedDials(t, stationId).length)}). Dashed settings are what they locked last time.` : `Not all three choices are locked yet (${WORDS.lockedCount(lockedDials(t, stationId).length)}): this is the board so far.`) : null,
      d.plan ? frozenBoard(d.plan, { id: "architectBoard", scene: "live" }) : draft,
      summaryBlock(designSummary(choices, stationId, d.plan?.budget || s.settings.budget)),
      d.review ? el("p", { class: "small muted" }, d.review.status === "approved" ? `Approved by ${d.review.by} at ${hhmm(d.review.at)} (${WORDS.attempt(d.review.attempt || 1).toLowerCase()}).` : `Rejected by ${d.review.by} at ${hhmm(d.review.at)}${d.review.reason ? `: "${d.review.reason}"` : ""} (${WORDS.attempt(d.review.attempt || 1).toLowerCase()}).`) : null)
  })

  slot("saBrief", [stationId], () => panel("wide sa-brief", el("details", {}, el("summary", {}, `The ${station.name} brief the table reads`), briefView(stationId, { compact: true }))))
}

/* ------------------------------------------------------------ restart and demo */

/** Restart: a fresh game with the customer and nothing played, open at once. The host is already behind the PIN, so one confirmation is enough. */
async function restartExperience() {
  if (!(await confirmDialog(`Restart the experience? Every choice, plan, queue, approval and the race are deleted, and a fresh game opens with the ${C.CUSTOMER_TEAM.name} and nothing played.`, "Restart"))) return
  hostLeads = null
  selectedTeam = null
  act("/api/host/reset", {}, `Restarted: a fresh game is open for the ${C.CUSTOMER_TEAM.name}`)
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
      el("div", { class: "row" }, el("span", { class: "btn go" }, WORDS.approve), el("input", { type: "text", placeholder: "Short reason the table will see", disabled: true }), el("span", { class: "btn danger" }, WORDS.reject))))
    screenNodes.push(renderApprovals(s))
  } else if (demo.step.screen === "race") {
    screenNodes.push(finaleGraphic(s.race.result), panel("", el("h2", {}, "Race ticker"), el("ul", { class: "small" }, s.race.result.events.filter((e) => e.team).slice(0, 6).map((e) => el("li", {}, `Lap ${e.lap}: ${e.text}`)))))
  } else if (demo.step.screen === "readout") {
    screenNodes.push(el("div", { class: "wide" }, readoutCard(readoutFor(team, s.race.result, s.settings.stations, budget))))
  }
  app.replaceChildren(el("div", { class: "host-grid" },
    panel("demo-narration wide", el("h2", {}, `Demo mode · ${demo.step.title}`), el("p", {}, demo.step.narration),
      el("p", { class: "small muted" }, "A pretend game: nothing here touches the real one."),
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
