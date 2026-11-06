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
let architectName = sessionStorage.getItem("podium-architect-name") || ""

/** The signed-in role; a Solutions Architect also has the one table they review (and an optional name). */
export function session() {
  return { pin, role, station, name: architectName }
}

export async function login(value, table = "", name = "") {
  const res = await post("/api/login", { pin: value, station: table || undefined }, false)
  pin = value
  role = res.role
  station = res.role === "architect" ? res.station : ""
  architectName = res.role === "architect" ? String(name || "").trim().slice(0, 40) : ""
  sessionStorage.setItem("podium-pin", pin)
  sessionStorage.setItem("podium-role", role)
  sessionStorage.setItem("podium-station", station)
  sessionStorage.setItem("podium-architect-name", architectName)
  return role
}

export function logout() {
  pin = ""
  role = ""
  station = ""
  architectName = ""
  for (const key of ["podium-pin", "podium-role", "podium-station", "podium-architect-name"]) sessionStorage.removeItem(key)
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

export const INSTRUCTIONS = {
  team: {
    title: "Teams",
    steps: [
      "Tap your team on the table's iPad. Move between the four tables freely.",
      "1 · Brief: read the whole brief together. It holds the targets, the rules, both cost caps and what every setting does. Then tap “I've read the brief. Take me to the decisions.” (it unlocks once you reach the end, or after 30 seconds).",
      "2 · Tune: each choice locks the moment you tap it. There is no undo and no confirmation, so decide as a team first. The scene, the gauges, the cap bars and the seconds found per lap update at once, so you see the consequence.",
      "The counter shows Locked 1 of 3. When all three are locked the table locks itself and the only step left is Call the Solutions Architect.",
      "3 · Pitch: wait for the SA (they may be busy with another team), then pitch for 30 seconds: why each choice helps the customer and how a provider helps.",
      "Approved: this table counts in the race. Rejected: the SA's reason is shown, all three dials reopen with your last picks shown as “last time” ghosts, and you choose again and call the SA again. That takes time.",
      "Over a cap or breaking an FIA rule is not allowed: 0.00 s counts. FIT 80+ means in the zone.",
      "When time is up, any table not approved (including one still adjusting after a rejection) races on today's setup. After the race, open your readout: seconds found, attempts, lessons and what to do differently.",
    ],
  },
  architect: {
    title: "Solutions Architects (SA)",
    steps: [
      "On the host screen choose Solutions Architect, enter the SA PIN (SKO27) and pick your table.",
      "Set yourself Available. Tap a team in the queue: you see its board exactly as the team locked it, which attempt this is, and the table's brief.",
      "Start pitch: 30 seconds. Ask why each choice helps the customer and how a provider helps.",
      "Approve, or Reject with a short reason the team will see. Rejecting reopens that team's three dials at your table only; they choose again and call you again.",
    ],
  },
  host: {
    title: "Session host",
    steps: [
      "Sign in with the host PIN (SKO27). Set up 1–10 teams and one budget level for everyone: Tight, Standard or Generous.",
      "Start brief (5 min): the iPads show the briefs; choices stay closed. Start play when it ends (35 min). Use +/− to adjust the clock.",
      "Watch the approvals grid: locks, attempts, pitches, seconds found and FIT. End play, then Run race with the race password (SKO27).",
      "Show readouts: the projector cycles through every team's readout (about 9 min).",
    ],
  },
  projector: {
    title: "Projector",
    steps: [
      "Shows the phase, its countdown and the lap-time ladder: each team's car moves right as its approved seconds land.",
      "The race plays in 30 seconds, then the podium.",
      "Readouts cycle through every team; tap a team to hold it on screen.",
    ],
  },
}

/** A button that opens the role's instructions in a drawer. */
export function instructionsButton(role) {
  return el("button", { class: "btn small-btn", onclick: () => openInstructions(role), "aria-label": "Instructions" }, "Instructions")
}

export function openInstructions(role) {
  document.getElementById("drawer")?.remove()
  const roles = role === "team" ? ["team", "architect"] : [role]
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
  startTuning: "Start tuning",
  problem: "Problem",
  scenario: "Scenario",
  tune: "Tune",
  secondsFound: "Seconds found per lap",
  fit: "FIT",
  inZone: "In the zone",
  overCap: "Over the cap",
  today: "Today's setup",
  todaySetup: "Today's setup",
  howProviderHelps: "How a provider helps",
  learned: "What you just learned",
  brief: "Brief",
  readBrief: "I've read the brief. Take me to the decisions.",
  briefGateHint: "Unlocks when you reach the end of the brief, or after 30 seconds.",
  goToDecisions: "Go to the decisions",
  oneShot: "Each choice locks the moment you tap it. Decide as a team first.",
  tapToLock: "Tap once to lock",
  hintWaits: "The brief has every figure you need. The board's own advice appears once all three are locked.",
  locked: "Locked",
  lockedCount: (n, of = 3) => `Locked ${n} of ${of}`,
  allLocked: "All three locked",
  lastTime: "last time",
  goToPitch: "Go to Pitch",
  goToTune: "Go to Tune",
  solutionsArchitect: "Solutions Architect",
  sa: "SA",
  callArchitect: "Call the Solutions Architect",
  architectFree: "Your Solutions Architect is free: go and pitch now",
  queuePosition: (n) => `Queue position ${n}: your Solutions Architect will call you`,
  rejected: (reason) => `Rejected: ${reason || "no reason given"}. Adjust your choices and call the SA again. This takes time and the SA may be busy.`,
  attempt: (n) => `Attempt ${n}`,
  returnHome: "Return to home",
  instructions: "Instructions",
  startPitch: "Start pitch",
  approve: "Approve",
  reject: "Reject",
  waitingForArchitect: "Waiting for the SA",
  pitching: "Pitching",
  approved: "Approved",
  runRace: "Run race",
  racePassword: "Race password",
  readTheBrief: "Read the brief",
  screenshot: "Take a screenshot now",
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

export function teamChip(team) {
  return el("span", { class: "team-chip" }, el("i", { style: `background:${team.color}` }), team.name)
}

/** The fixed three-step tab bar used on every table. Tune and Pitch stay disabled until the brief is read. */
export const STATION_TABS = [["brief", "1 · Brief"], ["tune", "2 · Tune"], ["pitch", "3 · Pitch"]]
export function tabBar(active, onSelect, { disabled = [] } = {}) {
  return el("nav", { class: "tabs", role: "tablist" }, STATION_TABS.map(([id, label]) =>
    el("button", { class: `tab${id === active ? " active" : ""}`, "data-tab": id, role: "tab", "aria-selected": String(id === active), disabled: disabled.includes(id), title: disabled.includes(id) ? "Read the brief first" : undefined, onclick: () => onSelect(id) }, label)))
}

/**
 * Replace a container's children without moving the page: the scroll position is captured before
 * and restored after, in the same frame, so an unavoidable rebuild never snaps the reader back to
 * the top. If the new content is shorter the browser clamps, which is the best any rebuild can do.
 */
export function replaceKeepingScroll(container, ...children) {
  const x = window.scrollX
  const y = window.scrollY
  const active = document.activeElement
  const focusId = active && active !== document.body ? active.id : ""
  container.replaceChildren(...children.flat().filter(Boolean))
  if (focusId) document.getElementById(focusId)?.focus?.({ preventScroll: true })
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y)
}

/** Set a node's text only when it changed, so live updates never disturb layout or selection. */
export function setText(node, text) {
  if (node && node.textContent !== String(text)) node.textContent = String(text)
}

/**
 * Rebuild one region of a page only when its content key changes. `build()` returns the new
 * children; the region keeps its node (and the page its scroll position) when the key matches.
 * Returns true when the region was rebuilt.
 */
export function patchSlot(slot, key, build) {
  if (!slot) return false
  const next = String(key)
  if (slot.dataset.key === next) return false
  slot.dataset.key = next
  replaceKeepingScroll(slot, build())
  return true
}

