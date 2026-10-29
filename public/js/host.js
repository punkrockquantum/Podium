import * as C from "/js/catalog.js"
import { simulateStation } from "/js/sim.js"
import { planSheet, summaryBlock } from "/js/plan.js"
import { designSummary } from "/js/summary.js"
import { designStatus, approvalGrid, STATUS_LABEL, STATUS_ORDER, PITCH_SECONDS, SEND_BACK_REASON_MAX } from "/js/approval.js"
import { phaseOf, phaseInfo, phaseRemainingMs } from "/js/session.js"
import { DEMO_STEPS, buildDemo } from "/js/demo.js"
import { readoutFor } from "/js/report.js"
import { readoutCard } from "/js/readoutview.js"
import { podiumGraphic } from "/js/podium.js"
import { el, clock, post, login, logout, session, watchState, gameClock, installErrorLogging, instructionsButton, confirmDialog, button, teamChip, stateBanner, WORDS } from "/js/ui.js"

installErrorLogging("host")

const app = document.getElementById("app")
const FEED_POLL_MS = 2000
let state = null
let offset = 0
let setupDraft = null
let lastKey = ""
let presence = { now: Date.now(), presence: {} }
let demoIndex = null
let loginMode = "host"
/** The host can act as the Architect of one table; an Architect always reviews the table chosen at login. */
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
    lastKey = ""
    watcher.refresh()
    render(true)
    if (done) toast(done)
  } catch (err) {
    toast(err.message)
    if (/Host PIN|Architect PIN/.test(err.message)) {
      logout()
      render(true)
    }
  }
}

const shortName = (id) => C.byId(C.STATIONS, id)?.name.split(/[ &]/)[0] || id
const ago = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min`)
const hhmm = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
const panel = (cls, ...children) => el("div", { class: `panel ${cls || ""}` }, ...children)

/* ------------------------------------------------------------ login */

function renderLogin() {
  const architect = loginMode === "architect"
  const input = el("input", { type: "password", inputmode: "numeric", placeholder: architect ? "Architect PIN" : "Host PIN", autocomplete: "off", id: "pinInput" })
  const stations = (state?.settings?.stations || C.STATIONS.map((s) => s.id)).map((id) => C.byId(C.STATIONS, id))
  const table = el("select", { class: "field", id: "architectTable" }, el("option", { value: "" }, "Pick your table"), stations.map((s) => el("option", { value: s.id }, s.name)))
  const name = el("input", { type: "text", placeholder: "Your name (optional)", maxlength: 40, id: "architectName" })
  const go = async () => {
    if (architect && !table.value) return toast("Pick the table you are the Architect for")
    try {
      const role = await login(input.value, architect ? table.value : "", architect ? name.value : "")
      if (!architect && role !== "host") {
        logout()
        return toast("That is the Architect PIN: choose Architect")
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
    el("div", { class: "row" }, tab("host", "Session host"), tab("architect", "Architect")),
    el("h2", {}, architect ? "Architect" : "Host PIN"),
    architect ? el("p", { class: "small muted" }, "Review, pitch and approve designs for your table. You only see your table.") : null,
    input, architect ? table : null, architect ? name : null,
    el("button", { class: "btn primary", onclick: go, id: "loginGo" }, architect ? "Open my table" : "Enter race control"), instructionsButton(architect ? "architect" : "host")))
}

/* ------------------------------------------------------------ setup */

const DEFAULT_NAMES = ["Scuderia Silicon", "Photon Racing", "Team Liquid Cool", "Petaflop GP", "Latency Zero", "Rack & Roll", "Throttle Up", "Edge Dynamics", "Quantum Pit", "Fibre Optic F1"]
const DEFAULT_TIERS = [1, 2, 3, 2, 1, 3, 2, 1, 3, 2]

function defaultSetup() {
  return { count: 6, teams: DEFAULT_NAMES.map((name, i) => ({ name, tier: DEFAULT_TIERS[i] })), stations: C.STATIONS.map((s) => s.id), ...Object.fromEntries(["briefMinutes", "playMinutes", "raceMinutes", "readoutMinutes"].map((k) => [k, C.SESSION[k]])) }
}

function renderSetup() {
  const d = setupDraft || (setupDraft = state?.teams?.length
    ? { ...defaultSetup(), count: state.teams.length, teams: [...state.teams.map((t) => ({ name: t.name, tier: t.tier })), ...defaultSetup().teams.slice(state.teams.length)], stations: [...state.settings.stations] }
    : defaultSetup())
  const rows = d.teams.slice(0, d.count).map((t, i) => {
    const name = el("input", { type: "text", value: t.name, maxlength: 32, "data-team-name": i })
    name.addEventListener("input", () => { t.name = name.value })
    const tier = el("select", { class: "field", "data-team-tier": i }, C.TIERS.map((x) => el("option", { value: x.id, selected: t.tier === x.id }, x.label)))
    tier.addEventListener("change", () => { t.tier = Number(tier.value) })
    return el("tr", {}, el("td", {}, el("i", { class: "swatch", style: `background:${C.TEAM_COLORS[i]}` })), el("td", {}, name), el("td", {}, tier))
  })
  const count = el("select", { class: "field", id: "teamCount" }, Array.from({ length: C.MAX_TEAMS }, (_, k) => el("option", { value: k + 1, selected: d.count === k + 1 }, `${k + 1} team${k ? "s" : ""}`)))
  count.addEventListener("change", () => { d.count = Number(count.value); render(true) })
  const stations = C.STATIONS.map((s) => {
    const box = el("input", { type: "checkbox", checked: d.stations.includes(s.id) })
    box.addEventListener("change", () => { d.stations = box.checked ? [...d.stations, s.id] : d.stations.filter((id) => id !== s.id) })
    return el("label", { class: "row", style: "min-height:40px" }, box, el("span", { style: `color:${s.color};font-weight:800` }, s.name))
  })
  return panel("wide", el("h2", {}, state?.teams?.length ? "Re-create the game" : "Set up the game"),
    el("ul", { class: "tier-lines small" }, C.TIERS.map((x) => el("li", {}, el("b", {}, x.label), `: ${x.line}`))),
    el("div", { class: "row" }, count),
    el("table", { class: "grid setup-grid" }, el("tbody", {}, rows)),
    el("h3", { style: "margin-top:12px" }, "Tables in play"), el("div", { class: "row" }, stations),
    el("div", { class: "row", style: "margin-top:12px" }, el("button", { class: "btn primary", id: "createGame", onclick: async () => {
      if (state?.teams?.length && !(await confirmDialog("This wipes every team's choices, plans and scores. Continue?", "Re-create"))) return
      act("/api/host/setup", { teams: d.teams.slice(0, d.count), stations: d.stations, briefMinutes: d.briefMinutes, playMinutes: d.playMinutes, raceMinutes: d.raceMinutes, readoutMinutes: d.readoutMinutes }, "Game created")
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
  return el("div", { class: "session-plan" },
    el("div", { class: "row" }, field("briefMinutes", "Brief"), field("playMinutes", "Play"), field("raceMinutes", "Race"), field("readoutMinutes", "Readout"),
      button("Save plan", () => act("/api/host/phase", { action: "set", ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, Number(i.value)])) }, "Session plan saved"), { small: true })),
    el("p", { class: "small muted" }, `Total ${total} minutes (default ${C.sessionTotal()}). The race itself lasts 30 seconds; its minute includes the podium.`))
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
    buttons.push(button("End play", async () => (await confirmDialog("End play now? Every table locks; unapproved tables race on their defaults.", "End play")) && phaseAct({ action: "end" }, "Play ended"), { kind: "danger" }))
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
    if (await confirmDialog("Run the race? Unapproved tables score 0 and race on their defaults.", WORDS.runRace)) act("/api/host/race", { seed: seed.value, racePassword: password.value }, "Lights out!")
  }
  return el("div", { class: "row run-race", style: "justify-content:center;margin-top:12px" }, password, seed, el("button", { class: "btn primary", id: "hostRunRace", onclick: go }, WORDS.runRace))
}

/* ------------------------------------------------------------ approvals, feed and queues */

function renderApprovals(s) {
  const grid = approvalGrid(s)
  const head = el("tr", {}, el("th", {}, "Team"), ...grid.stations.map((id) => el("th", {}, shortName(id))), el("th", {}, "Approved"))
  const rows = grid.rows.map((row) => el("tr", {},
    el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${row.team.color}` }), el("b", {}, row.team.name)),
    ...grid.stations.map((id) => el("td", {}, el("span", { class: `status-pill st-${row.cells[id].status}`, title: row.cells[id].label }, STATUS_LABEL[row.cells[id].status]))),
    el("td", {}, el("b", {}, `${row.approved}/${grid.stations.length}`))))
  const counts = STATUS_ORDER.filter((st) => grid.counts[st]).map((st) => el("span", { class: `status-pill st-${st}` }, `${STATUS_LABEL[st]} ${grid.counts[st]}`))
  return panel("wide", el("h2", {}, "Approvals"),
    el("p", { class: "small muted" }, `Only approved tables score and race as designed. ${grid.counts.approved} of ${grid.total} approved.`),
    el("div", { class: "row", id: "approvalCounts" }, counts),
    el("div", { class: "table-scroll", id: "approvalsGrid" }, el("table", { class: "grid approvals" }, el("thead", {}, head), el("tbody", {}, rows))))
}

function renderFeed(s, pres) {
  const now = pres.now || Date.now()
  const rows = s.teams.map((t) => {
    const p = pres.presence?.[t.id]
    const seat = Object.entries(s.tables || {}).find(([, x]) => x.team === t.id)
    const where = p ? `${shortName(p.station)} · ${p.step}` : seat ? shortName(seat[0]) : "—"
    const seen = p ? now - p.at : null
    const queued = Object.entries(s.queues || {}).filter(([, list]) => list.some((e) => e.team === t.id)).map(([id]) => shortName(id))
    const sims = Object.entries(t.sims || {}).filter(([, r]) => Number.isFinite(r.lastScore)).sort((a, b) => b[1].lastAt - a[1].lastAt)[0]
    return el("tr", {},
      el("td", { class: "team-cell" }, el("i", { class: "swatch", style: `background:${t.color}` }), el("b", {}, t.name), el("span", { class: "small muted" }, ` ${C.tierFor(t).name}`)),
      el("td", { class: "small" }, where),
      el("td", { class: "small" }, sims ? `${sims[1].lastScore}% ${shortName(sims[0])}` : "—"),
      el("td", { class: "small" }, queued.length ? queued.join(", ") : "—"),
      el("td", { class: `small ${seen == null ? "muted" : seen > 30_000 ? "dead" : seen > 12_000 ? "stale" : ""}` }, seen == null ? "—" : `${ago(seen)} ago`))
  })
  return panel("", el("h2", {}, "Live feed"),
    el("div", { class: "table-scroll" }, el("table", { class: "grid feed" }, el("thead", {}, el("tr", {}, ["Team", "Now", "Latest sim", "Queued", "Seen"].map((h) => el("th", {}, h)))), el("tbody", {}, rows))))
}

function renderQueues(s) {
  const tables = s.settings.stations.map((id) => {
    const list = s.queues?.[id] || []
    const arch = s.architects?.[id]
    const q = (action, team) => act("/api/host/queue", { station: id, action, team })
    return el("div", { class: "queue-table" },
      el("h3", {}, `${C.byId(C.STATIONS, id).name} `, el("span", { class: arch?.available ? "done small" : "muted small" }, arch?.available ? "· Available" : "· Busy"),
        s.pitches?.[id] ? el("span", { class: "small warn-text" }, ` · pitching: ${s.teams.find((x) => x.id === s.pitches[id].team)?.name || ""}`) : null,
        button("Act as Architect", () => { hostLeads = id; selectedTeam = null; render(true) }, { small: true })),
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

/* ------------------------------------------------------------ Architect */

/** One table's Architect view: availability, queue, the plain-English design and the 30-second pitch. */
function renderArchitect(stationId) {
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

  const header = panel("wide architect-head",
    el("div", { class: "row" },
      el("h2", { style: `color:${station.color};margin:0` }, `${station.name} · ${station.architect}`),
      el("span", { class: "muted" }, me.role === "architect" ? `Signed in as ${by}` : "Host acting as Architect"),
      el("span", { style: "flex:1" }),
      el("button", { class: `btn ${arch.available ? "go" : ""}`, id: "availabilityToggle", disabled: Boolean(pitch), onclick: () => go("/api/architect/availability", { available: !arch.available }, arch.available ? "You are Busy" : "You are Available") }, arch.available ? "Available" : "Busy"),
      instructionsButton("architect"),
      me.role === "host" ? button("Back to race control", () => { hostLeads = null; render(true) }, { small: true }) : button("Log out", () => { logout(); render(true) }, { small: true })))

  const pitchPanel = (() => {
    if (!pitch) return null
    const t = byId(pitch.team)
    const secs = Math.ceil((pitch.endsAt - now) / 1000)
    const reason = el("input", { type: "text", id: "sendBackReason", maxlength: SEND_BACK_REASON_MAX, placeholder: "Short reason the team will see" })
    return panel("wide pitch-live",
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, `${WORDS.pitching}: `, teamChip(t)), el("span", { style: "flex:1" }),
        el("div", { class: `pitch-timer${secs <= 0 ? " over" : ""}`, id: "pitchTimer", "data-ends": pitch.endsAt }, clock(pitch.endsAt - now))),
      el("div", { class: `decide-prompt${secs <= 0 ? " show" : ""}`, id: "decidePrompt" }, "Time is up: approve the design or send it back."),
      el("div", { class: "row" },
        el("button", { class: "btn go", id: "approveBtn", onclick: () => go("/api/architect/decide", { team: t.id, decision: "approve" }, `${t.name}: ${WORDS.approved}`) }, WORDS.approve),
        reason,
        el("button", { class: "btn danger", id: "sendBackBtn", onclick: () => go("/api/architect/decide", { team: t.id, decision: "sendBack", reason: reason.value }, `${t.name}: sent back`) }, WORDS.sendBack),
        button("Cancel pitch", () => go("/api/architect/pitch", { action: "cancel" }, "Pitch cancelled"), { small: true })))
  })()

  const startButton = (t) => {
    const d = designStatus(s, t, stationId)
    const can = arch.available && !pitch && Boolean(t.plans?.[stationId]) && d.status !== "approved"
    const why = !t.plans?.[stationId] ? "Not locked in" : d.status === "approved" ? "Already approved" : pitch ? "A pitch is running" : !arch.available ? "Set yourself Available first" : `${PITCH_SECONDS}-second pitch`
    return el("button", { class: "btn primary small-btn", disabled: !can, title: why, "data-start": t.id, onclick: () => go("/api/architect/pitch", { action: "start", team: t.id }, `${t.name}: pitch started`) }, WORDS.startPitch)
  }

  const queuePanel = panel("", el("h2", {}, "Pitch queue"),
    queue.length ? el("div", { class: "queue-list", id: "architectQueue" }, queue.map((entry, i) => {
      const t = byId(entry.team)
      if (!t) return null
      return el("div", { class: `q${selectedTeam === t.id ? " selected" : ""}` }, el("b", {}, `${i + 1}.`), teamChip(t), el("span", { class: "muted small" }, `waiting ${ago(now - entry.at)}`),
        button("Review", () => { selectedTeam = t.id; render(true) }, { small: true }), startButton(t))
    })) : el("p", { class: "muted" }, `Nobody is queued. Teams join with ${WORDS.callArchitect} after they lock in.`))

  const teamsPanel = panel("", el("h2", {}, "Every team at this table"),
    el("table", { class: "grid" }, el("tbody", {}, s.teams.map((t) => {
      const d = designStatus(s, t, stationId)
      return el("tr", { class: selectedTeam === t.id ? "selected" : "" }, el("td", {}, teamChip(t)), el("td", {}, el("span", { class: `status-pill st-${d.status}` }, d.label)), el("td", {}, button("Review", () => { selectedTeam = t.id; render(true) }, { small: true })))
    }))))

  const detail = (() => {
    const t = byId(selectedTeam)
    if (!t) return panel("wide", el("p", { class: "muted" }, "Pick a team to read its design."))
    const d = designStatus(s, t, stationId)
    const draft = d.plan ? { ...t, choices: { ...t.choices, ...d.plan.choices } } : t
    return panel("wide architect-summary",
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, teamChip(t)), el("span", { class: `status-pill st-${d.status}` }, d.label), el("span", { class: "small muted" }, C.tierFor(t).label),
        el("span", { style: "flex:1" }), d.plan ? el("span", { class: "small muted" }, `Plan ${d.plan.id}`) : null, startButton(t)),
      !d.plan ? el("p", { class: "small warn-text" }, d.status === "sentBack" ? "Sent back: the team is revising. This is their current draft." : "Not locked in yet: this is their current draft.") : null,
      summaryBlock(designSummary(draft, stationId)),
      d.review ? el("p", { class: "small muted" }, d.review.status === "approved" ? `Approved by ${d.review.by} at ${hhmm(d.review.at)}.` : `Sent back by ${d.review.by} at ${hhmm(d.review.at)}${d.review.reason ? `: "${d.review.reason}"` : ""}.`) : null)
  })()

  app.replaceChildren(el("div", { class: "host-grid architect-grid", id: "architectView" }, header, pitchPanel, detail, queuePanel, teamsPanel))
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
  const screen = []
  if (demo.step.screen === "brief") {
    screen.push(panel("", el("h2", {}, `${station.name}: ${WORDS.listen}`), el("ul", {}, station.brief.map((line) => el("li", {}, line))), el("p", {}, el("b", {}, `The ${station.architect} is looking for: `), station.looking)))
  } else if (demo.step.screen === "decide") {
    const sim = simulateStation(team, st)
    screen.push(panel("", el("h2", {}, `${team.name} at ${station.name}`),
      el("table", { class: "grid" }, el("tbody", {}, C.decisionsFor(st).map((d) => {
        const o = d.options.find((x) => x.id === (team.choices[d.id] || d.def))
        return el("tr", {}, el("td", { class: "muted" }, d.name), el("td", {}, el("b", {}, o.name)), el("td", { class: "small" }, o.why))
      }))),
      el("p", {}, el("b", {}, `Simulation ${sim.score}% · ${sim.band}. `), sim.sentence, " ", el("i", {}, `Hint: ${sim.hint}`))))
  } else if (demo.step.screen === "plan") {
    screen.push(planSheet(team, team.plans[st]), panel("", stateBanner(`${WORDS.waitingForArchitect}. ${WORDS.architectFree}.`, "good")))
  } else if (demo.step.screen === "architect") {
    screen.push(panel("wide", el("h2", {}, `${station.architect} · ${WORDS.pitching}: ${team.name}`), el("div", { class: "pitch-timer" }, `0:${PITCH_SECONDS}`), summaryBlock(designSummary(team, st)),
      el("div", { class: "row" }, el("span", { class: "btn go" }, WORDS.approve), el("span", { class: "btn danger" }, WORDS.sendBack))))
    screen.push(renderApprovals(s))
  } else if (demo.step.screen === "race") {
    screen.push(podiumGraphic(s.race.result), panel("", el("h2", {}, "Race ticker"), el("ul", { class: "small" }, s.race.result.events.filter((e) => e.team).slice(0, 6).map((e) => el("li", {}, `Lap ${e.lap}: ${e.text}`)))))
  } else if (demo.step.screen === "readout") {
    screen.push(el("div", { class: "wide" }, readoutCard(readoutFor(team, s.race.result, s.settings.stations))))
  }
  app.replaceChildren(el("div", { class: "host-grid" },
    panel("demo-narration wide", el("h2", {}, `Demo mode · ${demo.step.title}`), el("p", {}, demo.step.narration),
      el("p", { class: "small muted" }, "Pretend teams, pretend game: nothing here touches the real game."),
      el("div", { class: "row" },
        button("← Back", () => { demoIndex -= 1; render(true) }, { disabled: demo.index === 0 }),
        el("span", { class: "muted" }, `${demo.index + 1} / ${demo.total}`),
        button("Next →", () => { demoIndex += 1; render(true) }, { kind: "primary", disabled: demo.index === demo.total - 1 }),
        button("Exit demo", () => { demoIndex = null; render(true) }, { kind: "danger" }))),
    ...screen))
}

/* ------------------------------------------------------------ render */

function toolbar() {
  return panel("row wide", instructionsButton("host"),
    button("Demo mode", () => { demoIndex = 0; render(true) }, { small: true }),
    button("Restart the experience", restartExperience, { small: true, kind: "danger" }),
    button("Log out", () => { logout(); render(true) }, { small: true }),
    el("span", { class: "muted small" }, `${DEMO_STEPS.length}-step demo · ${state.teams.length} team${state.teams.length === 1 ? "" : "s"}`))
}

function render(force) {
  if (!state) return
  const me = session()
  if (me.role !== "host" && me.role !== "architect") {
    if (force || lastKey !== "login") {
      lastKey = "login"
      renderLogin()
    }
    return
  }
  if (me.role === "host" && demoIndex !== null) {
    if (force) renderDemo()
    return
  }
  if (!gameClock(state)) {
    app.replaceChildren(panel("", el("h2", {}, "Reconnecting to the game server"), el("p", { class: "muted" }, "Retrying every second.")))
    lastKey = ""
    return
  }
  const leads = me.role === "architect" ? me.station : hostLeads
  const key = JSON.stringify([state.version, setupDraft?.count, leads ? selectedTeam : presence, leads, Math.floor(Date.now() / 15_000)])
  if (!force && key === lastKey) return
  const typing = document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
  if (!force && typing) return
  lastKey = key
  if (leads) return renderArchitect(leads)
  app.replaceChildren(el("div", { class: "host-grid" }, state.teams.length
    ? [toolbar(), renderSession(), renderApprovals(state), renderReadouts(), renderFeed(state, presence), renderQueues(state), renderSetup(), renderLinks()]
    : [toolbar(), renderSetup()]))
}

setInterval(() => {
  try {
    const node = document.getElementById("bigTimer")
    if (node && state && demoIndex === null) node.textContent = phaseClock(state)
    const timer = document.getElementById("pitchTimer")
    if (timer) {
      const ms = Number(timer.dataset.ends) - (Date.now() + offset)
      timer.textContent = clock(ms)
      timer.classList.toggle("over", ms <= 0)
      document.getElementById("decidePrompt")?.classList.toggle("show", ms <= 0)
    }
  } catch (err) {
    console.error("[podium] host timer", err)
  }
}, 250)
