import * as C from "/js/catalog.js"
import { boardFor, raceSeconds } from "/js/model.js"
import { miniFit, learningCard, createBoard } from "/js/board.js"
import { planSheet, summaryBlock, frozenBoard } from "/js/plan.js"
import { designSummary } from "/js/summary.js"
import { designStatus, approvalGrid, lockedDials, ghostsAt, STATUS_LABEL, STATUS_ORDER, PITCH_SECONDS, REJECT_REASON_MAX } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs } from "/js/session.js"
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
let setupDraft = null
/** Which screen the page currently shows: login, demo, control, architect or reconnecting. */
let screen = ""
let presence = { now: Date.now(), presence: {} }
let demoIndex = null
let loginMode = "host"
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
    if (/Host PIN|SA PIN/.test(err.message)) {
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

/* ------------------------------------------------------------ login */

function renderLogin() {
  const architect = loginMode === "architect"
  const input = el("input", { type: "password", inputmode: "numeric", placeholder: architect ? "SA PIN" : "Host PIN", autocomplete: "off", id: "pinInput" })
  const stations = (state?.settings?.stations || C.STATIONS.map((s) => s.id)).map((id) => C.byId(C.STATIONS, id))
  const table = el("select", { class: "field", id: "architectTable" }, el("option", { value: "" }, "Pick your table"), stations.map((s) => el("option", { value: s.id }, s.name)))
  const name = el("input", { type: "text", placeholder: "Your name (optional)", maxlength: 40, id: "architectName" })
  const go = async () => {
    if (architect && !table.value) return toast("Pick the table you are the Solutions Architect for")
    try {
      const role = await login(input.value, architect ? table.value : "", architect ? name.value : "")
      if (!architect && role !== "host") {
        logout()
        return toast(`That is the SA PIN: choose ${WORDS.solutionsArchitect}`)
      }
      selectedTeam = null
      render(true)
    } catch (err) {
      toast(/table/.test(err.message) ? err.message : "Wrong PIN")
    }
  }
  input.addEventListener("keydown", (e) => e.key === "Enter" && go())
  const tab = (mode, label) => el("button", { class: `btn small-btn${loginMode === mode ? " primary" : ""}`, "data-login": mode, onclick: () => { loginMode = mode; render(true) } }, label)
  app.replaceChildren(el("div", { class: "pin-box panel" },
    el("div", { class: "row" }, tab("host", "Session host"), tab("architect", WORDS.solutionsArchitect)),
    el("h2", {}, architect ? WORDS.solutionsArchitect : "Host PIN"),
    architect ? el("p", { class: "small muted" }, "Review, hear the pitch and approve or reject designs for your table. You only see your table.") : null,
    input, architect ? table : null, architect ? name : null,
    el("button", { class: "btn primary", onclick: go, id: "loginGo" }, architect ? "Open my table" : "Enter race control"), instructionsButton(architect ? "architect" : "host")))
}

/* ------------------------------------------------------------ setup */

const DEFAULT_NAMES = ["Scuderia Silicon", "Photon Racing", "Team Liquid Cool", "Petaflop GP", "Latency Zero", "Rack & Roll", "Throttle Up", "Edge Dynamics", "Quantum Pit", "Fibre Optic F1"]
function defaultSetup() {
  return { count: 6, teams: DEFAULT_NAMES.map((name) => ({ name })), budget: C.DEFAULT_BUDGET, stations: C.STATIONS.map((s) => s.id), ...Object.fromEntries(["briefMinutes", "playMinutes", "raceMinutes", "readoutMinutes"].map((k) => [k, C.SESSION[k]])) }
}

/** One budget level for the whole session: it moves every table's cap lines. */
function budgetSelect(value, onChange, id) {
  const select = el("select", { class: "field", id }, C.BUDGET_LEVELS.map((b) => el("option", { value: b.id, selected: b.id === value }, `${b.name} budget`)))
  select.addEventListener("change", () => onChange(select.value))
  return select
}

const budgetLines = () => el("ul", { class: "tier-lines small" }, C.BUDGET_LEVELS.map((b) => el("li", {}, el("b", {}, b.name), `: ${b.line}`)))

/** The setup form's draft: the current game's teams and budget, or the defaults. */
function ensureDraft() {
  if (!setupDraft) {
    setupDraft = state?.teams?.length
      ? { ...defaultSetup(), count: state.teams.length, budget: state.settings.budget || C.DEFAULT_BUDGET, teams: [...state.teams.map((t) => ({ name: t.name })), ...defaultSetup().teams.slice(state.teams.length)], stations: [...state.settings.stations] }
      : defaultSetup()
  }
  return setupDraft
}

function renderSetup() {
  const d = ensureDraft()
  const rows = d.teams.slice(0, d.count).map((t, i) => {
    const name = el("input", { type: "text", value: t.name, maxlength: 32, "data-team-name": i })
    name.addEventListener("input", () => { t.name = name.value })
    return el("tr", {}, el("td", {}, el("i", { class: "swatch", style: `background:${C.TEAM_COLORS[i]}` })), el("td", {}, name))
  })
  const count = el("select", { class: "field", id: "teamCount" }, Array.from({ length: C.MAX_TEAMS }, (_, k) => el("option", { value: k + 1, selected: d.count === k + 1 }, `${k + 1} team${k ? "s" : ""}`)))
  count.addEventListener("change", () => { d.count = Number(count.value); render(true) })
  const stations = C.STATIONS.map((s) => {
    const box = el("input", { type: "checkbox", checked: d.stations.includes(s.id) })
    box.addEventListener("change", () => { d.stations = box.checked ? [...d.stations, s.id] : d.stations.filter((id) => id !== s.id) })
    return el("label", { class: "row", style: "min-height:40px" }, box, el("span", { style: `color:${s.color};font-weight:800` }, s.name))
  })
  return panel("wide", el("h2", {}, state?.teams?.length ? "Re-create the game" : "Set up the game"),
    el("p", { class: "small muted" }, "Every team plays the same four problems. The budget level moves every table's CapEx and OpEx cap lines for everyone."),
    budgetLines(),
    el("div", { class: "row" }, count, budgetSelect(d.budget, (v) => { d.budget = v }, "setupBudget")),
    el("table", { class: "grid setup-grid" }, el("tbody", {}, rows)),
    el("h3", { style: "margin-top:12px" }, "Tables in play"), el("div", { class: "row" }, stations),
    el("div", { class: "row", style: "margin-top:12px" }, el("button", { class: "btn primary", id: "createGame", onclick: async () => {
      if (state?.teams?.length && !(await confirmDialog("This wipes every team's choices, plans and scores. Continue?", "Re-create"))) return
      act("/api/host/setup", { teams: d.teams.slice(0, d.count), stations: d.stations, budget: d.budget, briefMinutes: d.briefMinutes, playMinutes: d.playMinutes, raceMinutes: d.raceMinutes, readoutMinutes: d.readoutMinutes }, "Game created")
      setupDraft = null
    } }, state?.teams?.length ? "Re-create game" : "Create game")))
}

/* ------------------------------------------------------------ session plan */

function phaseClock(s) {
  const ms = phaseRemainingMs(s, s.demo ? 0 : offset)
  const phase = phaseOf(s)
  return Number.isFinite(ms) ? clock(ms) : phase === "ended" ? "TIME" : "RACE"
}

function minutesInputs() {
  const s = state.settings
  const inputs = {}
  const field = (key, label) => {
    inputs[key] = el("input", { type: "number", min: 0.5, max: C.SESSION.maxMinutes, step: 0.5, value: s[key], style: "width:84px", "data-minutes": key })
    return el("label", {}, `${label} `, inputs[key])
  }
  const total = ["briefMinutes", "playMinutes", "raceMinutes", "readoutMinutes"].reduce((sum, k) => sum + s[k], 0)
  let level = s.budget || C.DEFAULT_BUDGET
  return el("div", { class: "session-plan" },
    el("div", { class: "row" }, field("briefMinutes", "Brief"), field("playMinutes", "Play"), field("raceMinutes", "Race"), field("readoutMinutes", "Readout"),
      budgetSelect(level, (v) => { level = v }, "lobbyBudget"),
      button("Save plan", () => act("/api/host/phase", { action: "set", budget: level, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, Number(i.value)])) }, "Session plan saved"), { small: true })),
    el("p", { class: "small muted" }, `Total ${total} minutes (default ${C.sessionTotal()}). The race itself lasts 30 seconds; its minute includes the podium. Budget: ${C.budgetFor(level).line}`))
}

function renderSession() {
  const s = state
  const phase = phaseOf(s)
  const info = phaseInfo(phase)
  const phaseAct = (body, done) => act("/api/host/phase", body, done)
  const add = (list) => list.map((m) => button(`${m > 0 ? "+" : "−"}${Math.abs(m)} min`, () => phaseAct({ action: "add", minutes: m }), { small: true }))
  const buttons = []
  if (phase === "lobby") buttons.push(button("Start brief", () => phaseAct({ action: "brief" }, "Brief started"), { kind: "go" }), button("Skip to play", () => phaseAct({ action: "play" }, "Play started")))
  if (phase === "brief") buttons.push(...add([-1, 1]), button("Start play", () => phaseAct({ action: "play" }, "Play started")))
  if (phase === "briefDone") buttons.push(button("Start play", () => phaseAct({ action: "play" }, "Play started"), { kind: "go" }))
  if (phase === "play") {
    buttons.push(s.clock.status === "paused" ? button("Resume", () => phaseAct({ action: "resume" }), { kind: "go" }) : button("Pause", () => phaseAct({ action: "pause" })))
    buttons.push(...add([-5, -1, 1, 5]))
    buttons.push(button("End play", async () => (await confirmDialog("End play now? Every table locks; unapproved tables race on the customer's existing setup.", "End play")) && phaseAct({ action: "end" }, "Play ended"), { kind: "danger" }))
  }
  if (phase === "ended") buttons.push(...add([1, 5]))
  if (phase === "race") buttons.push(button("Show readouts", () => phaseAct({ action: "readout" }, "Readouts on the projector"), { kind: "go" }))
  if (phase === "readout") buttons.push(...add([-1, 1]))
  const steps = ["brief", "play", "race", "readout"].map((id) => {
    const on = phase === id || (id === "brief" && phase === "briefDone") || (id === "race" && phase === "ended")
    const minutes = state.settings[`${id}Minutes`]
    return el("div", { class: `phase-step${on ? " on" : ""}` }, el("b", {}, phaseInfo(id).name), el("span", {}, id === "race" ? "30 s" : `${minutes} min`))
  })
  return panel("wide session-panel", el("h2", {}, `Session plan · ${info.name}${s.clock.status === "paused" ? " (paused)" : ""}`),
    el("div", { class: "phase-steps" }, steps),
    el("div", { class: `big-timer${phase === "ended" ? " over" : ""}`, id: "bigTimer" }, phaseClock(s)),
    el("p", { class: "muted", style: "text-align:center;margin:0 0 8px" }, phase === "briefDone" ? "The brief is over: start play." : info.line),
    el("div", { class: "row", style: "justify-content:center" }, buttons),
    phase === "lobby" ? minutesInputs() : null,
    phase === "ended" ? renderRunRace() : null)
}

function renderRunRace() {
  const seed = el("input", { type: "text", placeholder: "Seed (optional)", maxlength: 64 })
  const password = el("input", { type: "password", placeholder: WORDS.racePassword, autocomplete: "off", maxlength: 64, id: "hostRacePassword" })
  const go = async () => {
    if (!password.value) return toast(`Enter the ${WORDS.racePassword.toLowerCase()}`)
    if (await confirmDialog("Run the race? Unapproved tables score 0 and race on the customer's existing setup.", WORDS.runRace)) act("/api/host/race", { seed: seed.value, racePassword: password.value }, "Lights out!")
  }
  return el("div", { class: "row run-race", style: "justify-content:center;margin-top:12px" }, password, seed, el("button", { class: "btn primary", id: "hostRunRace", onclick: go }, WORDS.runRace))
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

function renderReadouts() {
  if (!state.race) return null
  const r = state.race.result
  return panel("wide", el("h2", {}, "Readouts"),
    el("p", { class: "small muted" }, "Each team's readout opens on one screen, ready for a screenshot. The projector cycles through them in the Readouts phase."),
    el("div", { class: "readout-links", id: "readoutLinks" }, r.standings.map((row, i) => {
      const t = state.teams.find((x) => x.id === row.id)
      return el("a", { class: "readout-link", href: `/race.html?team=${encodeURIComponent(row.id)}`, target: "_blank", style: `--c:${row.color}` }, el("b", {}, `${i + 1}. ${t?.name || row.name}`), el("span", { class: "small muted" }, `P${r.results.find((x) => x.id === row.id)?.position} in the race · ${row.score} pts`))
    })),
    el("div", { class: "row", style: "margin-top:10px" }, button("Re-open decisions (discard the race)", async () => (await confirmDialog("Discard this race and re-open decisions?", "Re-open")) && act("/api/host/unrace", {}, "Decisions re-opened"), { small: true, kind: "danger" })))
}

function renderLinks() {
  return panel("", el("h2", {}, "Table iPads"),
    el("div", { style: "display:grid;gap:6px" }, C.STATIONS.filter((s) => state.settings.stations.includes(s.id)).map((s) => el("a", { href: `/station.html?station=${s.id}`, target: "_blank" }, `${s.name}: ${location.origin}/station.html?station=${s.id}`))))
}

function toolbar() {
  return panel("row wide", instructionsButton("host"),
    button("Demo mode", () => { demoIndex = 0; render(true) }, { small: true }),
    button("Restart the experience", restartExperience, { small: true, kind: "danger" }),
    button("Log out", () => { logout(); render(true) }, { small: true }),
    el("span", { class: "muted small" }, `${DEMO_STEPS.length}-step demo · ${state.teams.length} team${state.teams.length === 1 ? "" : "s"}`))
}

/** Race control: one slot per panel, each rebuilt only when what it shows changes. */
function renderControl(force) {
  const s = state
  if (force || screen !== "control" || !document.getElementById("raceControl")) {
    screen = "control"
    replaceKeepingScroll(app, el("div", { class: "host-grid", id: "raceControl" }, ["toolbarSlot", "sessionSlot", "approvalsSlot", "readoutsSlot", "feedSlot", "queuesSlot", "setupSlot", "linksSlot"].map((id) => el("div", { id, class: "slot" }))))
  }
  const has = s.teams.length > 0
  ensureDraft()
  slot("toolbarSlot", [s.teams.length], toolbar)
  slot("sessionSlot", has ? [phaseOf(s), s.clock.status, s.settings, s.race?.seed, s.readout?.endsAt] : null, () => (has ? renderSession() : null))
  slot("approvalsSlot", has ? [approvalsKey(s), s.settings.budget, s.settings.stations] : null, () => (has ? renderApprovals(s) : null))
  slot("readoutsSlot", has ? [s.race?.seed, s.teams.length] : null, () => (has ? renderReadouts() : null))
  slot("feedSlot", has ? feedKey(s, presence) : null, () => (has ? renderFeed(s, presence) : null))
  slot("queuesSlot", has ? [s.queues, s.architects, s.pitches, s.settings.stations, s.teams.map((t) => t.name)] : null, () => (has ? renderQueues(s) : null))
  slot("setupSlot", [s.teams.map((t) => t.name), s.settings.budget, s.settings.stations, setupDraft?.count], renderSetup)
  slot("linksSlot", has ? [s.settings.stations] : null, () => (has ? renderLinks() : null))
}

/* ------------------------------------------------------------ Solutions Architect */

/** One table's SA view: availability, the queue, the design as the team locked it, the brief and the 30-second pitch. */
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
      me.role === "host" ? button("Back to race control", () => { hostLeads = null; render(true) }, { small: true }) : button("Log out", () => { logout(); render(true) }, { small: true }))))

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
    const can = arch.available && !pitch && Boolean(d.plan) && d.status !== "approved"
    const why = !d.plan ? "Not all three choices are locked" : d.status === "approved" ? "Already approved" : pitch ? "A pitch is running" : !arch.available ? "Set yourself Available first" : `${PITCH_SECONDS}-second pitch`
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

function restartExperience() {
  const input = el("input", { type: "password", inputmode: "numeric", placeholder: "Host PIN", autocomplete: "off" })
  const close = () => document.getElementById("drawer")?.remove()
  const go = async () => {
    try {
      if ((await login(input.value)) !== "host") return toast("The host PIN is needed")
    } catch {
      return toast("Wrong PIN")
    }
    close()
    if (!(await confirmDialog("Restart the experience? Every team, choice, plan, queue and score is deleted.", "Restart"))) return
    try {
      await post("/api/host/reset", {})
      location.href = "/"
    } catch (err) {
      toast(err.message)
    }
  }
  close()
  document.body.append(el("div", { id: "drawer", class: "drawer-back" }, el("div", { class: "drawer confirm" }, el("h2", {}, "Restart the experience"), el("p", {}, "Enter the host PIN to continue."), input,
    el("div", { class: "row" }, el("button", { class: "btn danger", onclick: go }, "Continue"), el("button", { class: "btn", onclick: close }, "Cancel")))))
  input.focus()
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
