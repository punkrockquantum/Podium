/**
 * The session plan: Brief → Play → Race → Readout. Pure; the server, the host, the tables and the
 * projector all derive the phase and its countdown from the shared state the same way.
 */

export const PHASES = [
  { id: "lobby", name: "Getting ready", line: "Teams choose their table. The host starts the brief." },
  { id: "brief", name: "Brief", line: "Listen to the brief. Choices open when play starts." },
  { id: "briefDone", name: "Brief over", line: "The brief is over. Play starts in a moment." },
  { id: "play", name: "Play", line: "Decide, simulate, lock in and pitch to your Architect." },
  { id: "ended", name: "Play over", line: "Time is up: every table is locked. The race is next." },
  { id: "race", name: "Race", line: "The Austin Grand Prix: 56 laps in 30 seconds." },
  { id: "readout", name: "Readouts", line: "Each team's result, what went well and what to do differently." },
]
export const phaseInfo = (id) => PHASES.find((p) => p.id === id) || PHASES[0]

/** The current phase id from the shared state. */
export function phaseOf(state) {
  if (!state?.clock) return "lobby"
  if (state.race) return state.readout ? "readout" : "race"
  const c = state.clock.status
  if (c === "ended") return "ended"
  if (c === "running" || c === "paused") return "play"
  if (state.brief?.status === "running") return "brief"
  if (state.brief?.status === "done") return "briefDone"
  return "lobby"
}

/** Milliseconds left in the current phase (NaN when it has no countdown). `offset` = server − local clock. */
export function phaseRemainingMs(state, offset = 0, now = Date.now()) {
  const t = now + offset
  const phase = phaseOf(state)
  if (phase === "brief") return Math.max(0, state.brief.endsAt - t)
  if (phase === "play") return state.clock.status === "paused" ? state.clock.remainingMs : Math.max(0, state.clock.endsAt - t)
  if (phase === "readout" && state.readout?.endsAt) return Math.max(0, state.readout.endsAt - t)
  if (phase === "lobby") return (state.settings?.playMinutes || 0) * 60_000
  return NaN
}

/** True when teams may change choices at all (tables add their own lock-in rule). */
export const choicesOpen = (state) => phaseOf(state) === "play"
