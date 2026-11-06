/**
 * Approval is the gate for scoring: a table's design counts (points and the race) only once the
 * table's Solutions Architect (SA) has approved it after a pitch. Pure: shared by the server, the
 * host, the tables, the race screen and demo mode.
 *
 * Per team × table: none → draft (some dials locked) → locked (all three locked, the plan exists)
 * → waiting (called the SA) → pitching → approved | rejected. A rejection reopens the dials of that
 * team at that table only; its first new lock makes the table "adjusting", and three locks make a
 * new plan: attempt 2, 3, …
 */

import { decisionsFor } from "./catalog.js"

export const PITCH_SECONDS = 30
export const PITCH_MS = PITCH_SECONDS * 1000
export const REJECT_REASON_MAX = 120

export const STATUS_LABEL = {
  none: "Not started",
  draft: "Locking choices",
  adjusting: "Adjusting",
  locked: "All three locked",
  waiting: "Waiting for the SA",
  pitching: "Pitching",
  approved: "Approved",
  rejected: "Rejected",
}

/** The order the host's approvals grid counts statuses in. */
export const STATUS_ORDER = ["approved", "pitching", "waiting", "locked", "rejected", "adjusting", "draft", "none"]

export function isApproved(team, stationId) {
  return team?.reviews?.[stationId]?.status === "approved"
}

/** Tables whose design an SA approved: the only ones that score and race. */
export function approvedStations(team, stationIds) {
  return stationIds.filter((id) => isApproved(team, id))
}

/** How many designs this team has completed at a table (0 before the first three locks). */
export function attemptsAt(team, stationId) {
  return Number(team?.attempts?.[stationId]) || 0
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]
/** "the second attempt", for banners and readouts. */
export function attemptWord(n) {
  return `${ORDINALS[n - 1] || `${n}th`} attempt`
}

/** Where one team's design for one table stands, with the review, the live pitch and the attempt count. */
export function designStatus(state, team, stationId) {
  const review = team?.reviews?.[stationId] || null
  const pitch = state?.pitches?.[stationId]
  const live = pitch && pitch.team === team?.id ? pitch : null
  const plan = team?.plans?.[stationId] || null
  const attempts = attemptsAt(team, stationId)
  const lockedSome = lockedDials(team, stationId).length > 0
  let status
  if (review?.status === "approved") status = "approved"
  else if (live) status = "pitching"
  else if (plan) status = (state?.queues?.[stationId] || []).some((entry) => entry.team === team.id) ? "waiting" : "locked"
  else if (review?.status === "rejected") status = lockedSome ? "adjusting" : "rejected"
  else if (lockedSome || team?.touched?.[stationId]) status = "draft"
  else status = "none"
  const label = status === "rejected" && review?.reason ? `${STATUS_LABEL.rejected}: ${review.reason}` : STATUS_LABEL[status]
  return { status, label, review, pitch: live, plan, attempts }
}

/** The dials a team has locked at a table since it was (re)opened: a choice, once made, is a lock. */
export function lockedDials(team, stationId) {
  const choices = team?.choices || {}
  return decisionsFor(stationId).map((d) => d.id).filter((id) => choices[id] !== undefined)
}

/** "Last time" picks from the design the SA rejected, by dial id. */
export function ghostsAt(team, stationId) {
  return team?.previous?.[stationId] || {}
}

/** Counts per status across every team and table in play, plus the per-team rows for the grid. */
export function approvalGrid(state) {
  const stations = state?.settings?.stations || []
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]))
  const rows = (state?.teams || []).map((team) => {
    const cells = Object.fromEntries(stations.map((id) => {
      const d = designStatus(state, team, id)
      counts[d.status] += 1
      return [id, d]
    }))
    return { team, cells, approved: stations.filter((id) => cells[id].status === "approved").length }
  })
  return { stations, counts, rows, total: stations.length * rows.length }
}

/** Seconds left in a pitch (may be negative once time is up). */
export function pitchRemainingMs(pitch, now) {
  return pitch ? pitch.endsAt - now : NaN
}
