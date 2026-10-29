/** Small DOM, format and API helpers shared by every screen. */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === "class") node.className = value
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value)
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value)
    else if (key === "html") node.innerHTML = value
    else node.setAttribute(key, value === true ? "" : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function money(value, digits = 1) {
  const sign = value < 0 ? "−" : ""
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`
  return `${sign}$${Math.round(abs)}`
}

export function delta(value, fmt = money) {
  if (Math.abs(value) < 1) return "±0"
  return `${value > 0 ? "+" : ""}${fmt(value)}`
}

export function clock(ms) {
  if (!Number.isFinite(ms)) return "--:--"
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

export const pct = (value) => `${Math.round(value * 100)}%`

/* ---------------------------------------------------------------- API */

let pin = sessionStorage.getItem("podium-pin") || ""
let role = sessionStorage.getItem("podium-role") || ""
let station = sessionStorage.getItem("podium-station") || ""
let leaderName = sessionStorage.getItem("podium-leader-name") || ""

/** The signed-in role; a table leader also has the one table they lead (and an optional name). */
export function session() {
  return { pin, role, station, name: leaderName }
}

export async function login(value, table = "", name = "") {
  const res = await post("/api/login", { pin: value, station: table || undefined }, false)
  pin = value
  role = res.role
  station = res.role === "leader" ? res.station : ""
  leaderName = res.role === "leader" ? String(name || "").trim().slice(0, 40) : ""
  sessionStorage.setItem("podium-pin", pin)
  sessionStorage.setItem("podium-role", role)
  sessionStorage.setItem("podium-station", station)
  sessionStorage.setItem("podium-leader-name", leaderName)
  return role
}

export function logout() {
  pin = ""
  role = ""
  station = ""
  leaderName = ""
  for (const key of ["podium-pin", "podium-role", "podium-station", "podium-leader-name"]) sessionStorage.removeItem(key)
}

export async function post(url, body, withPin = true) {
  const auth = withPin && pin ? { "x-pin": pin, ...(station ? { "x-station": station } : {}) } : {}
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 207) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/**
 * Poll the shared state. `onState(state, offsetMs)` runs on every change; offset converts the
 * server clock to this iPad's clock for the countdown.
 */
export function watchState(onState, intervalMs = 1000) {
  let version = 0
  let game = ""
  let last = null
  let offset = 0
  let stopped = false
  let timer = null
  const tick = async () => {
    if (stopped) return
    clearTimeout(timer)
    let changed = false
    try {
      const res = await fetch(`/api/state${version ? `?since=${version}&game=${encodeURIComponent(game)}` : ""}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      offset = data.now - Date.now()
      if (!data.unchanged) {
        version = data.version
        game = data.id
        last = data
        changed = true
      }
      document.body.classList.remove("offline")
    } catch {
      document.body.classList.add("offline")
    }
    if (changed) {
      try {
        onState(last, offset)
      } catch (err) {
        console.error("[podium] could not render the game state", err)
      }
    }
    timer = setTimeout(tick, document.hidden ? intervalMs * 3 : intervalMs)
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick()
  })
  window.addEventListener("online", () => tick())
  tick()
  return {
    stop: () => {
      stopped = true
    },
    refresh: () => {
      version = 0
    },
    offset: () => offset,
    state: () => last,
  }
}

export function remainingMs(clockState, offset) {
  if (!clockState) return NaN
  if (clockState.status === "running" && clockState.endsAt) return clockState.endsAt - (Date.now() + offset)
  if (clockState.status === "paused") return clockState.remainingMs
  return NaN
}

/** The game clock, or null when the state is missing or from an older server: callers show "Reconnecting". */
export function gameClock(state) {
  const c = state?.clock
  return c && typeof c.status === "string" ? c : null
}

/** "FIA rule 5.3" or "est." on an option card; nothing for plain industry figures. */
export function tagFor(option) {
  if (!option) return null
  if (option.fia) return el("span", { class: "opt-tag tag-fia", title: "A 2027 FIA Infrastructure Specification rule drives this option" }, `FIA rule ${option.fia}`)
  if (option.est) return el("span", { class: "opt-tag tag-est", title: "Teaching estimate, not a quote" }, "est.")
  return null
}

/** Log any uncaught error with context and show a visible notice instead of a silent blank page. */
export function installErrorLogging(screen) {
  const notice = (err) => {
    console.error(`[podium] ${screen}: unexpected error`, err)
    if (document.getElementById("errorNotice")) return
    document.body.append(el("div", { id: "errorNotice", class: "error-notice" }, `Something went wrong on this ${screen} screen. It has been logged; reload the page if it does not recover.`))
    setTimeout(() => document.getElementById("errorNotice")?.remove(), 8000)
  }
  window.addEventListener("error", (e) => notice(e.error || e.message))
  window.addEventListener("unhandledrejection", (e) => notice(e.reason))
}

const INSTRUCTIONS = {
  team: {
    title: "How to play (teams)",
    steps: [
      "Choose your team: tap your team on this table's iPad. Every table works the same way; move between tables freely. Every table locks when the game clock hits zero.",
      "1 Brief: the mission, your constraints and what the leader is scoring. Tap Start designing.",
      "2 Decide: tap one card per decision. Each decision says why it matters to the customer; each card shows what it does to CapEx, OpEx and power. \"FIA rule\" marks a regulation; \"est.\" marks an estimate. The running ledger is on the right.",
      "3 Simulate: Run simulation for your table's score (80%+ is Optimised) and up to three hints. About three runs per visit is plenty.",
      "4 Pitch: Lock in freezes the plan and shows a one-page plan. Take a screenshot of it.",
      "Call the leader: you join this table's queue. The Pitch tab shows where you stand: Waiting for leader, Pitching (a 30-second countdown), Approved, or Sent back with the leader's reason.",
      "Only approved tables count: an approved design scores its simulation plus 10%; anything else scores 0 and races on the default build. If you are sent back, revise, lock in and call the leader again while the clock allows.",
      "Switch team hands the iPad to another team; Return to home when you leave the table. When time is up the Austin Grand Prix decides the championship; the race report shows what you could do differently.",
    ],
  },
  leader: {
    title: "Table leader",
    steps: [
      "Open the host screen and choose Table leader: enter the leader PIN, pick your table and (optionally) your name. You only see your table.",
      "Set yourself Available. The pitch queue lists teams in order with how long they have waited; tap a team to read its design in plain English with the consequences and the simulation score.",
      "Grant Architect (or revoke it) for a team before you meet it, for example while it is queued.",
      "Start pitch: a 30-second countdown on your screen and the team's iPad; you become Busy. At zero, decide.",
      "Approve (the table scores and races as designed) or Send back with a one-line reason the team will see. Either returns you to Available.",
    ],
  },
  host: {
    title: "Session host",
    steps: [
      "Set up: team names and 2026 finishing positions (they set CapEx tier and CFD allowance), tables in play and the game clock.",
      "Start the clock. Watch the live feed (where each team is, step, score, Architect) and the approvals grid: every team × table as draft, locked, waiting, pitching, approved or sent back.",
      "Table leaders approve designs from their own login; you can also act for any table. Queues: confirm, reorder, give slot times or clear.",
      "Architect: you or the table leader can grant it to unlock the Token Efficiency Calculator.",
      "Demo mode: a narrated walkthrough with a pretend team. It never touches the real game.",
      "End clock & run race needs the race password; the race can also be started on the race screen. Restart the experience wipes everything (PIN and confirmation).",
    ],
  },
  projector: {
    title: "Race screen",
    steps: [
      "Before the race: live standings (tables approved, system score, Architect) and the game clock.",
      "Run race: enter the race password. The Austin, Texas 2027 Grand Prix at the Circuit of the Americas plays in 30 seconds: 56 laps, pit stops, a Safety Car and incidents on the ticker.",
      "Then the race report: the podium, what each team could do differently, the classification and the debrief. Tables open their own report at race.html?team=<id>.",
    ],
  },
}

/** A button that opens the role's instructions in a drawer. */
export function instructionsButton(role) {
  return el("button", { class: "btn small-btn", onclick: () => openInstructions(role), "aria-label": "Instructions" }, "Instructions")
}

export function openInstructions(role) {
  document.getElementById("drawer")?.remove()
  const roles = role === "team" ? ["team", "leader"] : [role]
  const close = () => document.getElementById("drawer")?.remove()
  const drawer = el("div", { id: "drawer", class: "drawer-back", onclick: (e) => e.target.id === "drawer" && close() },
    el("div", { class: "drawer", role: "dialog", "aria-modal": "true" },
      ...roles.map((id) => el("section", {}, el("h2", {}, INSTRUCTIONS[id].title), el("ol", {}, INSTRUCTIONS[id].steps.map((s) => el("li", {}, s))))),
      el("button", { class: "btn primary", onclick: close }, "Close")))
  document.body.append(drawer)
}

/** A confirmation dialog that returns a promise (iPad Safari blocks window.confirm in some kiosk modes). */
export function confirmDialog(text, yes = "Yes", no = "Cancel") {
  return new Promise((resolve) => {
    const done = (value) => {
      back.remove()
      resolve(value)
    }
    const back = el("div", { class: "drawer-back" },
      el("div", { class: "drawer confirm" }, el("p", {}, text),
        el("div", { class: "row" }, el("button", { class: "btn danger", onclick: () => done(true) }, yes), el("button", { class: "btn", onclick: () => done(false) }, no))))
    document.body.append(back)
  })
}

/* ------------------------------------------------------------ shared station components (one look on every table) */

/** One vocabulary for the same action on every table, the host and the projector. */
export const WORDS = {
  chooseTeam: "Choose your team",
  switchTeam: "Switch team",
  startDesigning: "Start designing",
  runSimulation: "Run simulation",
  wholeTeam: "Whole-team view",
  lockIn: "Lock in",
  callLeader: "Call the leader",
  leaderFree: "Leader is free: go and pitch now",
  queuePosition: (n) => `Queue position ${n}: see the session host to book your slot`,
  returnHome: "Return to home",
  instructions: "Instructions",
  startPitch: "Start pitch",
  approve: "Approve",
  sendBack: "Send back",
  waitingForLeader: "Waiting for leader",
  pitching: "Pitching",
  approved: "Approved",
  grantArchitect: "Grant Architect",
  revokeArchitect: "Revoke Architect",
  runRace: "Run race",
  racePassword: "Race password",
}

/** Primary (one per screen), secondary (default), go (positive) or danger buttons, all the same size. */
export function button(label, onclick, { kind = "secondary", disabled = false, small = false, title } = {}) {
  const cls = ["btn", kind === "secondary" ? "" : kind, small ? "small-btn" : ""].filter(Boolean).join(" ")
  return el("button", { class: cls, onclick, disabled, title }, label)
}

/** The one banner for locked, ended, lobby, not-in-play and reconnecting states. */
export function stateBanner(text, tone = "warn") {
  return text ? el("div", { class: `state-banner ${tone}`, role: "status" }, text) : null
}

export function panel(title, ...children) {
  return el("div", { class: "panel" }, title ? el("h3", { class: "panel-title" }, title) : null, ...children)
}

export function stat(value, label) {
  return el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label))
}

export function meter(label, value, max, text, tone = "") {
  const fill = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  return el("div", { class: "meter" }, el("div", { class: "label" }, el("span", {}, label), el("b", {}, text)), el("div", { class: `bar ${tone}` }, el("i", { style: `width:${Math.round(fill * 100)}%` })))
}

export function architectBadge() {
  return el("span", { class: "badge-arch" }, "ARCHITECT")
}

export function teamChip(team) {
  return el("span", { class: "team-chip" }, el("i", { style: `background:${team.color}` }), team.name, team.architect?.enabled ? architectBadge() : null)
}

/** The fixed four-step tab bar used on every table. */
export const STATION_TABS = [["brief", "1 · Brief"], ["decide", "2 · Decide"], ["sim", "3 · Simulate"], ["pitch", "4 · Pitch"]]
export function tabBar(active, onSelect) {
  return el("nav", { class: "tabs", role: "tablist" }, STATION_TABS.map(([id, label]) =>
    el("button", { class: `tab${id === active ? " active" : ""}`, "data-tab": id, role: "tab", "aria-selected": String(id === active), onclick: () => onSelect(id) }, label)))
}

/** An option card: same size and anatomy for every decision on every table. */
export function optionCard({ name, why, lines = [], cost = null, tag = null, selected = false, disabled = false, onclick }) {
  return el("button", { class: `card${selected ? " selected" : ""}`, disabled, onclick, "aria-pressed": String(selected) },
    tag, el("div", { class: "name" }, name), why ? el("div", { class: "why" }, why) : null,
    lines.length ? el("div", { class: "money" }, lines.map((line) => el("div", {}, line))) : null, cost)
}

/** A decision: heading, one line on why it matters to the customer, then the cards, then an optional note. */
export function decisionSection({ id, title, why, cards, note }) {
  return el("section", { class: "decision", id: id ? `decision-${id}` : null },
    el("h3", {}, title), why ? el("p", { class: "decision-why" }, why) : null,
    el("div", { class: "cards" }, cards), note ? el("p", { class: "decision-note" }, note) : null)
}

/** Simulation score ring. */
export function scoreRing(score, band) {
  const r = 52
  const c = 2 * Math.PI * r
  const tone = band === "Optimised" ? "var(--green)" : band === "Competitive" ? "var(--amber)" : "var(--bad)"
  const svg = `<svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#2a2f3a" stroke-width="12"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="${tone}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * Math.max(0, Math.min(100, score))) / 100} ${c}" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle" font-size="28" font-weight="900" fill="#fff">${Math.round(score)}%</text></svg>`
  const ring = el("div", { class: "score-ring" })
  ring.innerHTML = svg
  return el("div", { class: "score-head" }, ring, el("div", {}, el("b", { class: "score-band" }, band), el("div", { class: "small muted" }, "Optimised is 80% or more")))
}
