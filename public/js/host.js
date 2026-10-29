import * as C from "/js/catalog.js"
import { simulateStation } from "/js/sim.js"
import { architectReport } from "/js/architect.js"
import { planSheet, queueStatus, summaryBlock } from "/js/plan.js"
import { designSummary } from "/js/summary.js"
import { designStatus, approvalGrid, STATUS_LABEL, STATUS_ORDER, PITCH_SECONDS, SEND_BACK_REASON_MAX } from "/js/approval.js"
import { DEMO_STEPS, buildDemo } from "/js/demo.js"
import { suggestionsFor } from "/js/report.js"
import { podiumGraphic } from "/js/podium.js"
import { el, clock, money, post, login, logout, session, watchState, remainingMs, gameClock, installErrorLogging, instructionsButton, confirmDialog, button, teamChip, WORDS } from "/js/ui.js"

installErrorLogging("host")

const app = document.getElementById("app")
const FEED_POLL_MS = 1500
let state = null
let offset = 0
let setupDraft = null
let lastKey = ""
let presence = { now: Date.now(), presence: {} }
let demoIndex = null
let loginMode = "host"
/** The host can act as the leader of one table; a table leader always leads the table chosen at login. */
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
    if (/Host PIN|Leader PIN/.test(err.message)) {
      logout()
      render(true)
    }
  }
}

const shortName = (id) => C.byId(C.STATIONS, id)?.name.split(/[ &,]/)[0] || id
const ago = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min`)
const hhmm = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

function renderLogin() {
  const leader = loginMode === "leader"
  const input = el("input", { type: "password", inputmode: "numeric", placeholder: leader ? "Leader PIN" : "Host PIN", autocomplete: "off", id: "pinInput" })
  const stations = (state?.settings?.stations || C.STATIONS.map((s) => s.id)).map((id) => C.byId(C.STATIONS, id))
  const table = el("select", { class: "field", id: "leaderTable" }, el("option", { value: "" }, "Pick your table"), stations.map((s) => el("option", { value: s.id }, `${s.name} (${s.leader})`)))
  const name = el("input", { type: "text", placeholder: "Your name (optional)", maxlength: 40, id: "leaderName" })
  const go = async () => {
    if (leader && !table.value) return toast("Pick the table you lead")
    try {
      const role = await login(input.value, leader ? table.value : "", leader ? name.value : "")
      if (!leader && role !== "host") {
        logout()
        return toast("That is the leader PIN: choose Table leader")
      }
      selectedTeam = null
      render(true)
    } catch (err) {
      toast(/table/.test(err.message) ? err.message : "Wrong PIN")
    }
  }
  input.addEventListener("keydown", (e) => e.key === "Enter" && go())
  const tab = (mode, label) => el("button", { class: `btn small-btn${loginMode === mode ? " primary" : ""}`, onclick: () => { loginMode = mode; render(true) } }, label)
  app.replaceChildren(el("div", { class: "pin-box panel" },
    el("div", { class: "row" }, tab("host", "Session host"), tab("leader", "Table leader")),
    el("h2", {}, leader ? "Table leader" : "Host PIN"),
    leader ? el("p", { class: "small muted" }, "Review, pitch and approve designs for your table. You only see your table.") : null,
    input, leader ? table : null, leader ? name : null,
    el("button", { class: "btn primary", onclick: go, id: "loginGo" }, leader ? "Open my table" : "Enter race control"), instructionsButton(leader ? "leader" : "host")))
}

/* ------------------------------------------------------------ setup */

function defaultSetup() {
  const ranks = [2, 5, 8, 3, 9, 6, 1, 10, 4, 7]
  const names = ["Scuderia Silicon", "Photon Racing", "Team Liquid Cool", "Petaflop GP", "Latency Zero", "KV Cache Motorsport", "Rack & Roll", "Throttle Up", "Edge Dynamics", "Quantum Pit"]
  return { count: 6, teams: names.map((name, i) => ({ name, rank: ranks[i] })), stations: C.STATIONS.map((s) => s.id), gameMinutes: C.GAME_CLOCK.minutes, visitMinutes: C.GAME_CLOCK.visitMinutes, races: 24, sprints: 6 }
}

function renderSetup() {
  const d = setupDraft || (setupDraft = state?.teams?.length
    ? { ...defaultSetup(), count: state.teams.length, teams: [...state.teams.map((t) => ({ name: t.name, rank: t.rank })), ...defaultSetup().teams.slice(state.teams.length)], stations: [...state.settings.stations], gameMinutes: state.settings.gameMinutes, visitMinutes: state.settings.visitMinutes, races: state.settings.races, sprints: state.settings.sprints }
    : defaultSetup())
  const rows = d.teams.slice(0, d.count).map((t, i) => {
    const name = el("input", { type: "text", value: t.name, maxlength: 32 })
    name.addEventListener("input", () => { t.name = name.value })
    const rank = el("select", { class: "field" }, Array.from({ length: 10 }, (_, k) => el("option", { value: k + 1, selected: t.rank === k + 1 }, `P${k + 1} · ${C.tierForRank(k + 1).name.split(" (")[0]} · ATR ${Math.round(C.atrForRank(k + 1).mult * 100)}%`)))
    rank.addEventListener("change", () => { t.rank = Number(rank.value) })
    return el("tr", {}, el("td", {}, el("i", { style: `display:inline-block;width:12px;height:12px;border-radius:50%;background:${C.TEAM_COLORS[i]}` })), el("td", {}, name), el("td", {}, rank))
  })
  const count = el("select", { class: "field" }, Array.from({ length: 9 }, (_, k) => el("option", { value: k + 2, selected: d.count === k + 2 }, `${k + 2} teams`)))
  count.addEventListener("change", () => { d.count = Number(count.value); render(true) })
  const stations = C.STATIONS.map((s) => {
    const box = el("input", { type: "checkbox", checked: d.stations.includes(s.id) })
    box.addEventListener("change", () => { d.stations = box.checked ? [...d.stations, s.id] : d.stations.filter((id) => id !== s.id) })
    return el("label", { class: "row", style: "min-height:40px" }, box, el("span", { style: `color:${s.color};font-weight:800` }, s.name), el("span", { class: "muted small" }, s.leader))
  })
  const num = (key, min, max) => {
    const input = el("input", { type: "number", min, max, value: d[key], style: "width:90px" })
    input.addEventListener("input", () => { d[key] = Number(input.value) })
    return input
  }
  return el("div", { class: "panel" }, el("h2", {}, state?.teams?.length ? "Re-create the game" : "Set up the game"),
    el("p", { class: "small muted" }, "Each team's 2026 finish sets its CapEx tier and CFD allowance (FIA rules 1.2 and 2.4). Front-runners get less; backmarkers get more."),
    el("div", { class: "row" }, count),
    el("table", { class: "grid" }, el("tbody", {}, rows)),
    el("h3", { style: "margin-top:12px" }, "Tables in play (at least five)"), ...stations,
    el("div", { class: "row", style: "margin-top:10px" }, el("label", {}, "Game clock (min) ", num("gameMinutes", 1, C.GAME_CLOCK.maxMinutes)), el("label", {}, "Visit guide (min) ", num("visitMinutes", 1, 30)), el("label", {}, "Races ", num("races", 15, 30)), el("label", {}, "Sprints ", num("sprints", 0, 12))),
    el("div", { class: "row", style: "margin-top:12px" }, el("button", { class: "btn primary", onclick: async () => {
      if (state?.teams?.length && !(await confirmDialog("This wipes every team's choices, plans and scores. Continue?", "Re-create"))) return
      act("/api/host/setup", { teams: d.teams.slice(0, d.count), stations: d.stations, gameMinutes: d.gameMinutes, visitMinutes: d.visitMinutes, races: d.races, sprints: d.sprints }, "Game created")
    } }, state?.teams?.length ? "Re-create game" : "Create game")))
}

/* ------------------------------------------------------------ clock */

function clockText(s, c) {
  if (!c) return "--:--"
  if (c.status === "lobby") return clock(c.totalMs)
  if (c.status === "ended") return s.race ? "RACE" : "TIME"
  return clock(remainingMs(c, s.demo ? 0 : offset))
}

function renderControl() {
  const c = gameClock(state)
  const timer = el("div", { class: `big-timer${c.status === "ended" ? " over" : ""}`, id: "bigTimer" }, clockText(state, c))
  const clockAct = (body, done) => act("/api/host/clock", body, done)
  const buttons = []
  if (c.status === "lobby") buttons.push(el("button", { class: "btn go", onclick: () => clockAct({ action: "start" }, "Game clock started") }, "Start the clock"))
  if (c.status === "running") buttons.push(el("button", { class: "btn", onclick: () => clockAct({ action: "pause" }) }, "Pause"))
  if (c.status === "paused") buttons.push(el("button", { class: "btn go", onclick: () => clockAct({ action: "resume" }) }, "Resume"))
  if (!state.race) {
    for (const m of [-5, -1, 1, 5]) {
      if (c.status === "ended" && m < 0) continue
      buttons.push(el("button", { class: "btn", onclick: () => clockAct({ action: "add", minutes: m }, c.status === "ended" ? `Clock re-opened for ${m} min` : null) }, `${m > 0 ? "+" : "−"}${Math.abs(m)} min`))
    }
  }
  if (["running", "paused"].includes(c.status)) buttons.push(el("button", { class: "btn danger", onclick: async () => (await confirmDialog("End the game clock now? Every table locks; unfinished tables keep their defaults.", "End now")) && clockAct({ action: "end" }, "Time is up: tables locked") }, "End now"))
  const status = c.status === "lobby" ? `not started · ${Math.round(c.totalMs / 60000)} min set` : c.status === "ended" ? `ended${c.endedBy === "time" ? " (time ran out)" : " by the host"}` : c.status
  const minutes = el("input", { type: "number", min: 1, max: C.GAME_CLOCK.maxMinutes, value: Math.round(c.totalMs / 60000), style: "width:90px" })
  return el("div", { class: "panel" }, el("h2", {}, `Game clock · ${status}`), timer,
    el("div", { class: "row", style: "justify-content:center" }, buttons),
    c.status === "lobby" ? el("div", { class: "row", style: "justify-content:center;margin-top:8px" }, el("label", {}, "Set minutes ", minutes), el("button", { class: "btn", onclick: () => clockAct({ action: "set", minutes: Number(minutes.value) }, "Clock set") }, "Set")) : null,
    el("p", { class: "small muted", style: "text-align:center" }, `Visit guide ~${state.settings.visitMinutes} min. At zero every table locks; tables not locked in race on their defaults.`))
}

/* ------------------------------------------------------------ live feed */

function choicesSummary(t, s) {
  const parts = s.settings.stations.filter((id) => t.touched?.[id] || t.plans?.[id]).map((id) => {
    const changed = C.visibleDecisions(id).filter((d) => t.choices?.[d.id] !== undefined && t.choices[d.id] !== d.def).length
    return `${shortName(id)} ${changed}/${C.visibleDecisions(id).length}`
  })
  return parts.length ? parts.join(" · ") : "—"
}

function latestSim(t) {
  const runs = Object.entries(t.sims || {}).filter(([, r]) => Number.isFinite(r.lastScore)).sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
  return runs.length ? `${runs[0][1].lastScore}% ${shortName(runs[0][0])}` : "—"
}

/** Per-team live feed: shared by the real console and demo mode (readonly). */
function renderFeed(s, pres, { readonly = false } = {}) {
  const now = pres.now || Date.now()
  const head = el("tr", {}, ...["Team", "Checked in", "Now", "Choices changed", "Latest sim", "Time on table", "Lock-in / queue", "Architect", "Last seen"].map((h) => el("th", {}, h)))
  const rows = s.teams.map((t) => {
    const seatAt = Object.entries(s.tables || {}).find(([, seat]) => seat.team === t.id)
    const firstVisit = Math.min(...Object.values(t.visits || {}).map((v) => v.first || Infinity))
    const p = pres.presence?.[t.id]
    const locked = s.settings.stations.filter((id) => t.plans?.[id] || t.reviews?.[id]?.status === "approved").length
    const heard = s.settings.stations.filter((id) => t.reviews?.[id]?.status === "approved").length
    const queued = Object.entries(s.queues || {}).flatMap(([id, list]) => list.findIndex((e) => e.team === t.id) >= 0 ? [`${shortName(id)} #${list.findIndex((e) => e.team === t.id) + 1}`] : [])
    const seen = p ? now - p.at : null
    const where = p ? `${shortName(p.station)} · ${p.step}` : seatAt ? shortName(seatAt[0]) : "—"
    return el("tr", {},
      el("td", {}, el("b", { style: `color:${t.color}` }, t.name), t.architect?.enabled ? el("span", { class: "badge-arch" }, "ARCHITECT") : null, el("div", { class: "small muted" }, `P${t.rank}`)),
      el("td", { class: "small" }, Number.isFinite(firstVisit) ? hhmm(firstVisit) : "—"),
      el("td", { class: "small" }, where),
      el("td", { class: "small" }, choicesSummary(t, s)),
      el("td", {}, latestSim(t)),
      el("td", { class: "small" }, seatAt ? ago(now - seatAt[1].since) : "—"),
      el("td", { class: "small" }, `${locked}/${s.settings.stations.length} locked · ${heard} approved`, queued.length ? el("div", {}, `Queue: ${queued.join(", ")}`) : null,
        locked ? el("div", {}, el("button", { class: "btn small-btn", onclick: () => showPlans(t, s) }, "Plans")) : null),
      el("td", {}, readonly ? (t.architect?.enabled ? `×${(t.architect.gain || 1).toFixed(2)}` : "off")
        : el("button", { class: `btn small-btn${t.architect?.enabled ? " go" : ""}`, onclick: () => act("/api/host/architect", { team: t.id, enabled: !t.architect?.enabled }, t.architect?.enabled ? `Architect off for ${t.name}` : `Architect granted to ${t.name}`) }, t.architect?.enabled ? `On ×${(t.architect.gain || 1).toFixed(2)}` : "Grant"),
        t.architect?.enabled && t.architect.grantedBy ? el("div", { class: "small muted" }, `by ${t.architect.grantedBy}`) : null),
      el("td", { class: `small ${seen == null ? "muted" : seen > 30_000 ? "dead" : seen > 12_000 ? "stale" : ""}` }, seen == null ? "—" : `${ago(seen)} ago`))
  })
  return el("div", { class: "panel wide" }, el("h2", {}, "Live feed"), el("p", { class: "small muted" }, `Refreshes every ${FEED_POLL_MS / 1000} s. Last seen turns amber after 12 s and red after 30 s without a heartbeat from the team's iPad.`),
    el("div", { style: "overflow-x:auto" }, el("table", { class: "grid feed" }, el("thead", {}, head), el("tbody", {}, rows))))
}

function renderQueues(s, { readonly = false } = {}) {
  const tables = s.settings.stations.map((id) => {
    const list = s.queues?.[id] || []
    const leader = s.leaders?.[id]
    const q = (action, team, extra = {}) => act("/api/host/queue", { station: id, action, team, ...extra })
    const items = list.map((entry, i) => {
      const t = s.teams.find((x) => x.id === entry.team)
      const slot = el("input", { type: "text", value: entry.slot || "", placeholder: "HH:MM", maxlength: 5, style: "width:80px;min-height:36px", disabled: readonly })
      return el("div", { class: "q" }, el("b", {}, `${i + 1}.`), el("span", { style: `color:${t?.color};font-weight:800` }, t?.name || entry.team), el("span", { class: "muted small" }, `since ${hhmm(entry.at)}`),
        entry.confirmed ? el("span", { class: "small" }, "✓ confirmed") : null,
        readonly ? (entry.slot ? el("span", { class: "small" }, `slot ${entry.slot}`) : null) : [
          el("button", { class: "btn small-btn", onclick: () => q("confirm", entry.team) }, entry.confirmed ? "Unconfirm" : "Confirm"),
          el("button", { class: "btn small-btn", disabled: i === 0, onclick: () => q("up", entry.team) }, "↑"),
          el("button", { class: "btn small-btn", disabled: i === list.length - 1, onclick: () => q("down", entry.team) }, "↓"),
          slot, el("button", { class: "btn small-btn", onclick: () => q("slot", entry.team, { slot: slot.value }) }, "Set slot"),
          el("button", { class: "btn small-btn danger", onclick: () => q("remove", entry.team) }, "Remove")])
    })
    return el("div", {}, el("h3", { style: "margin-top:10px" }, `${C.byId(C.STATIONS, id).name} `, el("span", { class: leader?.available ? "done small" : "muted small" }, leader?.available ? "· leader available" : "· leader busy"),
      s.pitches?.[id] ? el("span", { class: "small warn-text" }, ` · pitching: ${s.teams.find((x) => x.id === s.pitches[id].team)?.name || ""}`) : null,
      readonly ? null : el("button", { class: "btn small-btn", style: "margin-left:8px", onclick: () => { hostLeads = id; selectedTeam = null; render(true) } }, "Lead this table")),
      items.length ? el("div", { class: "queue-list" }, items) : el("div", { class: "muted small" }, "No queue"),
      !readonly && items.length ? el("button", { class: "btn small-btn", style: "margin-top:6px", onclick: async () => (await confirmDialog(`Clear the whole ${C.byId(C.STATIONS, id).name} queue?`, "Clear")) && q("clear") }, "Clear queue") : null)
  })
  return el("div", { class: "panel" }, el("h2", {}, "Pitch queues"), ...tables)
}

function showPlans(t, s) {
  document.getElementById("drawer")?.remove()
  const close = () => document.getElementById("drawer")?.remove()
  const sheets = s.settings.stations.filter((id) => t.plans?.[id]).map((id) => planSheet(t, t.plans[id], { review: t.reviews?.[id], screenshotPrompt: false }))
  document.body.append(el("div", { id: "drawer", class: "drawer-back", onclick: (e) => e.target.id === "drawer" && close() },
    el("div", { class: "drawer" }, el("h2", {}, `${t.name}: locked-in plans`), ...sheets, el("button", { class: "btn primary", onclick: close }, "Close"))))
}

/* ------------------------------------------------------------ scores and race */

function renderScores() {
  const ids = state.settings.stations
  const head = el("tr", {}, el("th", {}, "Team"), el("th", {}, "P"), ...ids.map((id) => el("th", {}, shortName(id))), el("th", {}, "Table points"))
  const rows = state.teams.map((t) => {
    const total = ids.reduce((sum, id) => sum + (t.pitch?.[id] || 0), 0)
    return el("tr", {}, el("td", {}, el("b", { style: `color:${t.color}` }, t.name), t.architect?.enabled ? el("span", { class: "badge-arch" }, "ARCHITECT") : null), el("td", {}, `P${t.rank}`),
      ...ids.map((id) => el("td", {}, t.reviews?.[id]?.status === "approved" ? `${t.pitch?.[id] ?? 0} ✓` : t.plans?.[id] ? `${t.plans[id].score}% 🔒` : t.reviews?.[id]?.status === "sentBack" ? "↩" : t.touched?.[id] ? "…" : "—")),
      el("td", {}, el("b", {}, `${total} / ${ids.length * C.PITCH_MAX}`)))
  })
  return el("div", { class: "panel" }, el("h2", {}, "Scores"), el("p", { class: "small muted" }, "✓ approved (table points: system score + 10%) · 🔒 locked in, not approved yet (scores 0) · ↩ sent back · … choosing"), el("table", { class: "grid" }, el("thead", {}, head), el("tbody", {}, rows)))
}

/** Teams × tables: where every design stands, with counts. Shared by the console and demo mode. */
function renderApprovals(s) {
  const grid = approvalGrid(s)
  const head = el("tr", {}, el("th", {}, "Team"), ...grid.stations.map((id) => el("th", {}, shortName(id))), el("th", {}, "Approved"))
  const rows = grid.rows.map((row) => el("tr", {},
    el("td", {}, el("b", { style: `color:${row.team.color}` }, row.team.name), row.team.architect?.enabled ? el("span", { class: "badge-arch" }, "ARCHITECT") : null),
    ...grid.stations.map((id) => {
      const d = row.cells[id]
      return el("td", {}, el("span", { class: `status-pill st-${d.status}`, title: d.label }, STATUS_LABEL[d.status]))
    }),
    el("td", {}, el("b", {}, `${row.approved}/${grid.stations.length}`))))
  const counts = STATUS_ORDER.filter((st) => grid.counts[st]).map((st) => el("span", { class: `status-pill st-${st}` }, `${STATUS_LABEL[st]} ${grid.counts[st]}`))
  return el("div", { class: "panel wide", id: "approvalsGrid" }, el("h2", {}, "Approvals"),
    el("p", { class: "small muted" }, `Only approved tables score and race as designed; everything else scores 0 and races on the default build. ${grid.counts.approved} of ${grid.total} approved.`),
    el("div", { class: "row", id: "approvalCounts" }, counts),
    el("div", { style: "overflow-x:auto" }, el("table", { class: "grid approvals" }, el("thead", {}, head), el("tbody", {}, rows))))
}

function renderRace() {
  const seed = el("input", { type: "text", placeholder: "Seed (optional, for a repeatable race)", maxlength: 64 })
  const password = el("input", { type: "password", placeholder: WORDS.racePassword, autocomplete: "off", maxlength: 64, id: "hostRacePassword" })
  const c = gameClock(state)
  const nodes = [el("h2", {}, `The finale: ${C.FINALE.race}`), el("p", { class: "small muted" }, `Running the race locks every decision, samples risks and FIA audits with the seed, and plays ${C.FINALE.laps} laps of the Circuit of the Americas in 30 seconds on the race screen. It needs the race password.`)]
  const run = (endClock) => async () => {
    if (!password.value) return toast(`Enter the ${WORDS.racePassword.toLowerCase()}`)
    const text = endClock ? "End the game clock now and run the race? Tables not approved score 0 and race on their defaults." : "Lock all decisions and run the race?"
    if (await confirmDialog(text, WORDS.runRace)) act("/api/host/race", { seed: seed.value, endClock, racePassword: password.value }, "Lights out!")
  }
  if (state.race) {
    const top = state.race.result.standings.slice(0, 3).map((s, i) => `${i + 1}. ${s.name} (${s.score})`).join("   ")
    nodes.push(el("p", {}, `Race run (seed ${state.race.seed}). Championship: ${top}`),
      el("div", { class: "row" }, el("a", { class: "btn go", href: "/race.html", target: "_blank", style: "display:inline-flex;align-items:center;text-decoration:none" }, "Show on race screen ↗"),
        el("button", { class: "btn", onclick: async () => (await confirmDialog("Re-open decisions and discard this race?", "Re-open")) && act("/api/host/unrace", {}, "Decisions re-opened") }, "Re-open decisions")))
  } else if (["running", "paused"].includes(c.status)) {
    nodes.push(el("p", { class: "warn-text" }, "The race cannot start while the game clock is running. Wait for zero, or end the clock now."),
      el("div", { class: "row" }, seed, password, el("button", { class: "btn danger", onclick: run(true) }, "End clock & run race")))
  } else {
    const notApproved = state.teams.reduce((n, t) => n + state.settings.stations.filter((id) => t.reviews?.[id]?.status !== "approved").length, 0)
    if (notApproved) nodes.push(el("p", { class: "small" }, `${notApproved} team-table${notApproved === 1 ? " is" : "s are"} not approved: they score 0 and race on the default build.`))
    nodes.push(el("div", { class: "row" }, seed, password, el("button", { class: "btn primary", onclick: run(false) }, WORDS.runRace)))
  }
  nodes.push(el("p", { class: "small muted" }, "The race can also be started from the race screen with the same password."))
  return el("div", { class: "panel" }, ...nodes)
}

/* ------------------------------------------------------------ table leader */

const pitchLeft = (pitch) => (pitch ? Math.ceil((pitch.endsAt - (Date.now() + offset)) / 1000) : 0)
const pitchClock = (secs) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.max(0, secs) % 60).padStart(2, "0")}`

/** One table's leader panel: availability, queue, Architect, the plain-English design and the 30-second pitch. */
function renderLeader(stationId) {
  const s = state
  const station = C.byId(C.STATIONS, stationId)
  const me = session()
  const by = me.role === "leader" ? me.name || station.leader : "Host"
  const leader = s.leaders?.[stationId] || { available: false }
  const pitch = s.pitches?.[stationId] || null
  const now = Date.now() + offset
  const queue = s.queues?.[stationId] || []
  const byId = (id) => s.teams.find((t) => t.id === id)
  if (!selectedTeam || !byId(selectedTeam)) selectedTeam = pitch?.team || queue[0]?.team || null
  const lead = (url, body, done) => act(url, { station: stationId, by, ...body }, done)
  const architectButton = (t) => button(t.architect?.enabled ? WORDS.revokeArchitect : WORDS.grantArchitect, () => lead("/api/leader/architect", { team: t.id, enabled: !t.architect?.enabled }, t.architect?.enabled ? `Architect revoked for ${t.name}` : `Architect granted to ${t.name}`), { small: true, kind: t.architect?.enabled ? "secondary" : "go" })

  const header = el("div", { class: "panel wide leader-head" },
    el("div", { class: "row" },
      el("h2", { style: `color:${station.color};margin:0` }, `${station.name} · ${station.leader}`),
      el("span", { class: "muted" }, me.role === "leader" ? `Signed in as ${by}` : "Host acting as leader"),
      el("span", { style: "flex:1" }),
      el("button", { class: `btn ${leader.available ? "go" : ""}`, id: "availabilityToggle", disabled: Boolean(pitch), onclick: () => lead("/api/leader/availability", { available: !leader.available }, leader.available ? "You are Busy" : "You are Available") }, leader.available ? "Available" : "Busy"),
      instructionsButton("leader"),
      me.role === "host" ? button("Back to race control", () => { hostLeads = null; render(true) }, { small: true }) : button("Log out", () => { logout(); render(true) }, { small: true })),
    el("p", { class: "small muted" }, leader.available ? "Teams at the front of your queue see \"Leader is free: go and pitch now\"." : pitch ? "Busy: a pitch is running." : "Busy: teams see their queue position. Set yourself Available to start a pitch."))

  const pitchPanel = (() => {
    if (!pitch) return null
    const t = byId(pitch.team)
    const secs = pitchLeft(pitch)
    const reason = el("input", { type: "text", id: "sendBackReason", maxlength: SEND_BACK_REASON_MAX, placeholder: "Optional one-line reason the team will see" })
    return el("div", { class: "panel wide pitch-live" },
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, `${WORDS.pitching}: `, teamChip(t)), el("span", { style: "flex:1" }),
        el("div", { class: `pitch-timer${secs <= 0 ? " over" : ""}`, id: "pitchTimer", "data-ends": pitch.endsAt }, pitchClock(secs))),
      el("div", { class: `decide-prompt${secs <= 0 ? " show" : ""}`, id: "decidePrompt" }, "Time is up: approve the design or send it back."),
      el("div", { class: "row" },
        el("button", { class: "btn go", id: "approveBtn", onclick: () => lead("/api/leader/decide", { team: t.id, decision: "approve" }, `${t.name}: ${WORDS.approved}`) }, WORDS.approve),
        reason,
        el("button", { class: "btn danger", id: "sendBackBtn", onclick: () => lead("/api/leader/decide", { team: t.id, decision: "sendBack", reason: reason.value }, `${t.name}: sent back`) }, WORDS.sendBack),
        button("Cancel pitch", () => lead("/api/leader/pitch", { action: "cancel" }, "Pitch cancelled"), { small: true })))
  })()

  const startButton = (t) => {
    const d = designStatus(s, t, stationId)
    const can = leader.available && !pitch && Boolean(t.plans?.[stationId]) && d.status !== "approved"
    const why = !t.plans?.[stationId] ? "Not locked in" : d.status === "approved" ? "Already approved" : pitch ? "A pitch is running" : !leader.available ? "Set yourself Available first" : `${PITCH_SECONDS}-second pitch`
    return el("button", { class: "btn primary small-btn", disabled: !can, title: why, "data-start": t.id, onclick: () => lead("/api/leader/pitch", { action: "start", team: t.id }, `${t.name}: pitch started`) }, WORDS.startPitch)
  }
  const queueRows = queue.map((entry, i) => {
    const t = byId(entry.team)
    if (!t) return null
    return el("div", { class: `q${selectedTeam === t.id ? " selected" : ""}` },
      el("b", {}, `${i + 1}.`), teamChip(t), el("span", { class: "muted small", "data-since": entry.at }, `waiting ${ago(now - entry.at)}`),
      entry.slot ? el("span", { class: "small" }, `slot ${entry.slot}`) : null,
      button("Review", () => { selectedTeam = t.id; render(true) }, { small: true }), architectButton(t), startButton(t))
  }).filter(Boolean)
  const queuePanel = el("div", { class: "panel", id: "leaderQueue" }, el("h2", {}, "Pitch queue"),
    queueRows.length ? el("div", { class: "queue-list" }, queueRows) : el("p", { class: "muted" }, "Nobody is queued. Teams join with Call the leader after they lock in."))

  const teamsPanel = el("div", { class: "panel" }, el("h2", {}, "Every team at this table"),
    el("table", { class: "grid" }, el("tbody", {}, s.teams.map((t) => {
      const d = designStatus(s, t, stationId)
      return el("tr", { class: selectedTeam === t.id ? "selected" : "" },
        el("td", {}, teamChip(t)),
        el("td", {}, el("span", { class: `status-pill st-${d.status}` }, d.label)),
        el("td", {}, button("Review", () => { selectedTeam = t.id; render(true) }, { small: true })),
        el("td", {}, architectButton(t)))
    }))))

  const detail = (() => {
    const t = byId(selectedTeam)
    if (!t) return el("div", { class: "panel wide" }, el("p", { class: "muted" }, "Pick a team to read its design."))
    const d = designStatus(s, t, stationId)
    const summary = designSummary(t, stationId, { races: s.settings.races, sprints: s.settings.sprints })
    return el("div", { class: "panel wide", id: "leaderSummary" },
      el("div", { class: "row" }, el("h2", { style: "margin:0" }, teamChip(t)), el("span", { class: `status-pill st-${d.status}` }, d.label),
        t.architect?.enabled ? el("span", { class: "small" }, `Architect ×${(t.architect.gain || 1).toFixed(2)}${t.architect.grantedBy ? `, granted by ${t.architect.grantedBy}` : ""}`) : el("span", { class: "small muted" }, "No Architect"),
        el("span", { style: "flex:1" }), d.plan ? el("span", { class: "small muted" }, `Plan ${d.plan.id}`) : null, startButton(t)),
      !d.plan ? el("p", { class: "small warn-text" }, d.status === "sentBack" ? "Sent back: the team is revising. This is their current draft." : "Not locked in yet: this is their current draft.") : null,
      summaryBlock(summary),
      d.review ? el("p", { class: "small muted" }, d.review.status === "approved" ? `Approved by ${d.review.by} at ${hhmm(d.review.at)} after a ${Math.round(d.review.durationMs / 1000)} s pitch.` : `Sent back by ${d.review.by} at ${hhmm(d.review.at)}${d.review.reason ? `: "${d.review.reason}"` : ""}.`) : null)
  })()

  app.replaceChildren(el("div", { class: "host-grid leader-grid" }, header, pitchPanel, detail, queuePanel, teamsPanel))
}

function renderLinks() {
  const base = location.origin
  return el("div", { class: "panel" }, el("h2", {}, "Table iPads"), el("p", { class: "small muted" }, "Open these on each table's iPad (use the server's LAN address shown in the terminal)."),
    el("div", { style: "display:grid;gap:6px" }, C.STATIONS.filter((s) => state.settings.stations.includes(s.id)).map((s) => el("a", { href: `/station.html?station=${s.id}`, target: "_blank" }, `${s.name}: ${base}/station.html?station=${s.id}`))))
}

/** Wipe everything and send the host back to the landing page; needs the PIN again plus a confirmation. */
function restartExperience() {
  document.getElementById("drawer")?.remove()
  const input = el("input", { type: "password", inputmode: "numeric", placeholder: "Host PIN", autocomplete: "off" })
  const close = () => document.getElementById("drawer")?.remove()
  const go = async () => {
    try {
      const role = await login(input.value)
      if (role !== "host") return toast("The host PIN is needed")
    } catch {
      return toast("Wrong PIN")
    }
    close()
    if (!(await confirmDialog("Restart the experience? Every team, choice, plan, queue and score is deleted and every screen returns to the start.", "Restart"))) return
    try {
      await post("/api/host/reset", {})
      location.href = "/"
    } catch (err) {
      toast(err.message)
    }
  }
  document.body.append(el("div", { id: "drawer", class: "drawer-back" }, el("div", { class: "drawer confirm" }, el("h2", {}, "Restart the experience"), el("p", {}, "Enter the host PIN to continue."), input,
    el("div", { class: "row" }, el("button", { class: "btn danger", onclick: go }, "Continue"), el("button", { class: "btn", onclick: close }, "Cancel")))))
  input.focus()
}

/* ------------------------------------------------------------ demo mode */

function renderDemo() {
  const demo = buildDemo(demoIndex)
  const s = demo.state
  const team = s.teams.find((t) => t.id === demo.focus.team)
  const st = demo.focus.station
  const screen = []
  const c = gameClock(s)
  screen.push(el("div", { class: "panel" }, el("h3", {}, `Pretend game clock · ${c.status}`), el("div", { class: `big-timer${c.status === "ended" ? " over" : ""}` }, clockText(s, c))))
  if (demo.step.screen === "station") {
    const sim = simulateStation(team, s.settings, st)
    const station = C.byId(C.STATIONS, st)
    screen.push(el("div", { class: "panel" }, el("h2", {}, `${team.name} at ${station.name}`),
      demo.step.id === "brief" ? el("ul", {}, station.brief.map((line) => el("li", {}, line))) : null,
      demo.step.id !== "brief" ? el("table", { class: "grid" }, el("tbody", {}, C.visibleDecisions(st).map((d) => {
        const v = team.choices[d.id] ?? d.def
        const option = d.options?.find((o) => o.id === v)
        return el("tr", {}, el("td", { class: "muted" }, d.name), el("td", {}, el("b", {}, option ? option.name : `${v} ${d.unit || ""}`)), el("td", { class: "small" }, option?.why || ""))
      }))) : null,
      demo.step.id === "sim" ? el("p", {}, el("b", {}, `Simulation: ${sim.score}% · ${sim.band}`), " ", sim.hints[0] || "") : null))
  } else if (demo.step.screen === "plan") {
    screen.push(planSheet(team, team.plans[st], { review: team.reviews[st] }))
  } else if (demo.step.screen === "leader") {
    const d = designStatus(s, team, st)
    const status = queueStatus(s, team.id, st)
    const pitch = s.pitches[st]
    const station = C.byId(C.STATIONS, st)
    screen.push(el("div", { class: "panel wide" },
      el("h2", {}, `Table leader view · ${station.name} · ${s.leaders[st]?.available ? "Available" : "Busy"}`),
      el("div", { class: "row" }, teamChip(team), el("span", { class: `status-pill st-${d.status}` }, d.label),
        pitch ? el("div", { class: "pitch-timer" }, `0:${String(PITCH_SECONDS).padStart(2, "0")}`) : null,
        status ? el("span", { class: "small muted" }, `Queue position ${status.position}`) : null),
      summaryBlock(designSummary(team, st, s.settings)),
      el("p", { class: "small muted" }, `On the team's iPad: ${d.label}.`)))
  } else if (demo.step.screen === "approvals") {
    screen.push(renderApprovals(s))
  } else if (demo.step.screen === "architect") {
    const report = architectReport(team, team.architect.tuning)
    screen.push(el("div", { class: "panel" }, el("h2", {}, "Architect: Token Efficiency Calculator"),
      el("div", { class: "arch-metrics" },
        el("div", { class: "stat" }, el("b", {}, `${Math.round(report.tuned.tokPerS).toLocaleString("en-GB")} tok/s`), el("span", {}, `base ${Math.round(report.base.tokPerS).toLocaleString("en-GB")}`)),
        el("div", { class: "stat" }, el("b", {}, `$${report.tuned.costPerM.toFixed(3)}`), el("span", {}, `per million tokens (base $${report.base.costPerM.toFixed(3)})`)),
        el("div", { class: "stat" }, el("b", {}, `${report.tuned.joulesPerToken.toFixed(2)} J`), el("span", {}, `per token (base ${report.base.joulesPerToken.toFixed(2)} J)`)),
        el("div", { class: "stat" }, el("b", {}, `×${report.gain.toFixed(2)}`), el("span", {}, "gain vs base plan")))))
  } else if (demo.step.screen === "race") {
    const r = s.race.result
    const tips = suggestionsFor(team, r.results.find((x) => x.id === team.id), s.settings.stations, s.settings)
    screen.push(podiumGraphic(r),
      el("div", { class: "panel" }, el("h2", {}, `${team.name}: what you could do differently`), el("ul", {}, tips.map((tip) => el("li", {}, tip.text)))),
      el("div", { class: "panel" }, el("h2", {}, "Race ticker (first incidents)"), el("ul", { class: "small" }, r.events.filter((e) => e.team).slice(0, 6).map((e) => el("li", {}, `Lap ${e.lap}: ${e.text}`)))))
  }
  if (["feed"].includes(demo.step.screen) || demo.step.id === "tables") screen.push(renderFeed(s, demo.presence, { readonly: true }))
  if (demo.step.screen === "leader") screen.push(renderQueues(s, { readonly: true }))
  app.replaceChildren(el("div", { class: "host-grid" },
    el("div", { class: "panel demo-narration wide" }, el("h2", {}, `Demo mode · ${demo.step.title}`), el("p", {}, demo.step.narration),
      el("p", { class: "small muted" }, "Pretend team, pretend game: nothing here touches the real game."),
      el("div", { class: "row" },
        el("button", { class: "btn", disabled: demo.index === 0, onclick: () => { demoIndex -= 1; render(true) } }, "← Back"),
        el("span", { class: "muted" }, `${demo.index + 1} / ${demo.total}`),
        el("button", { class: "btn primary", disabled: demo.index === demo.total - 1, onclick: () => { demoIndex += 1; render(true) } }, "Next →"),
        el("button", { class: "btn danger", onclick: () => { demoIndex = null; render(true) } }, "Exit demo"))),
    ...screen))
}

/* ------------------------------------------------------------ render */

function toolbar() {
  return el("div", { class: "panel row wide" },
    instructionsButton("host"),
    el("button", { class: "btn small-btn", onclick: () => { demoIndex = 0; render(true) } }, "Demo mode"),
    el("button", { class: "btn small-btn danger", onclick: restartExperience }, "Restart the experience"),
    el("button", { class: "btn small-btn", onclick: () => { logout(); render(true) } }, "Log out"))
}

function render(force) {
  if (!state) return
  const me = session()
  if (me.role !== "host" && me.role !== "leader") {
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
    app.replaceChildren(el("div", { class: "panel" }, el("h2", {}, "Reconnecting to the game server"), el("p", { class: "muted" }, "Retrying every second.")))
    lastKey = ""
    return
  }
  const leads = me.role === "leader" ? me.station : hostLeads
  const key = JSON.stringify([state.version, setupDraft?.count, leads ? selectedTeam : presence, leads, Math.floor(Date.now() / 15_000)])
  if (!force && key === lastKey) return
  const typing = document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
  if (!force && typing && (document.getElementById("bigTimer") || document.getElementById("pitchTimer") || document.getElementById("leaderSummary"))) return
  lastKey = key
  if (leads) return renderLeader(leads)
  const cols = state.teams.length
    ? [toolbar(), renderControl(), renderFeed(state, presence), renderApprovals(state), renderQueues(state), renderScores(), renderRace(), renderSetup(), renderLinks()]
    : [toolbar(), renderSetup()]
  app.replaceChildren(el("div", { class: "host-grid" }, cols))
}

setInterval(() => {
  try {
    const node = document.getElementById("bigTimer")
    if (node && state && demoIndex === null) node.textContent = clockText(state, gameClock(state))
    const timer = document.getElementById("pitchTimer")
    if (timer) {
      const secs = Math.ceil((Number(timer.dataset.ends) - (Date.now() + offset)) / 1000)
      timer.textContent = pitchClock(secs)
      timer.classList.toggle("over", secs <= 0)
      document.getElementById("decidePrompt")?.classList.toggle("show", secs <= 0)
    }
  } catch (err) {
    console.error("[podium] host timer", err)
  }
}, 250)
