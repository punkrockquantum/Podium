/**
 * The session: play is open the moment the server runs, with or without a timer. Pure; the server,
 * the host, the tables and the projector all derive the phase and its countdown from the shared
 * state the same way.
 *
 * open (no timer) → play (timer running) ⇄ paused → ended (time is up) → race → readout.
 * The host can start or reset the timer at any point before the race, and the race can run from
 * any of the first four.
 */

export const PHASES = [
  { id: "open", name: "Open session", idle: "No timer", line: "Add your team at any table, read the brief, lock your three choices (one tap each) and pitch to your Solutions Architect." },
  { id: "play", name: "Play", idle: "--:--", line: "Read the brief, lock your three choices (one tap each) and pitch to your Solutions Architect." },
  { id: "paused", name: "Paused", idle: "--:--", line: "The timer is paused. Tables stay open." },
  { id: "ended", name: "Time is up", idle: "TIME", line: "Time is up: every table is locked. The race is next." },
  { id: "race", name: "Race", idle: "RACE", line: "The Austin Grand Prix: 56 laps in 30 seconds." },
  { id: "readout", name: "Readouts", idle: "RACE", line: "Each team's result, what went well and what to do differently." },
]
export const phaseInfo = (id) => PHASES.find((p) => p.id === id) || PHASES[0]

/** The current phase id from the shared state. */
export function phaseOf(state) {
  if (!state?.clock) return "open"
  if (state.race) return state.readout ? "readout" : "race"
  const c = state.clock.status
  if (c === "ended") return "ended"
  if (c === "running") return "play"
  if (c === "paused") return "paused"
  return "open"
}

/** Milliseconds left on the timer (NaN when no timer is running or paused). `offset` = server − local clock. */
export function phaseRemainingMs(state, offset = 0, now = Date.now()) {
  const phase = phaseOf(state)
  if (phase === "play") return Math.max(0, state.clock.endsAt - (now + offset))
  if (phase === "paused") return Math.max(0, Number(state.clock.remainingMs) || 0)
  return NaN
}

/** True when teams may join and change choices at all (tables add their own brief and lock rules). */
export const playOpen = (state) => ["open", "play", "paused"].includes(phaseOf(state))
