/**
 * Approval is the gate for scoring: a table's design counts (points and the race) only once a table
 * Architect has approved it after a pitch. Pure: shared by the server, the host, the tables, the race
 * screen and demo mode.
 *
 * Per team × table: draft → locked (team locks in) → waiting (called the Architect) → pitching →
 * approved | sent back (the plan unlocks so the team can revise and lock in again).
 */

export const PITCH_SECONDS = 30
export const PITCH_MS = PITCH_SECONDS * 1000
export const SEND_BACK_REASON_MAX = 120

export const STATUS_LABEL = {
  none: "Not started",
  draft: "Draft",
  locked: "Locked in",
  waiting: "Waiting for Architect",
  pitching: "Pitching",
  approved: "Approved",
  sentBack: "Sent back",
}

/** The order the host's approvals grid counts statuses in. */
export const STATUS_ORDER = ["approved", "pitching", "waiting", "locked", "sentBack", "draft", "none"]

export function isApproved(team, stationId) {
  return team?.reviews?.[stationId]?.status === "approved"
}

/** Tables whose design an Architect approved: the only ones that score and race. */
export function approvedStations(team, stationIds) {
  return stationIds.filter((id) => isApproved(team, id))
}

/** Where one team's design for one table stands, with the review and the live pitch if any. */
export function designStatus(state, team, stationId) {
  const review = team?.reviews?.[stationId] || null
  const pitch = state?.pitches?.[stationId]
  const live = pitch && pitch.team === team?.id ? pitch : null
  const plan = team?.plans?.[stationId] || null
  let status
  if (review?.status === "approved") status = "approved"
  else if (live) status = "pitching"
  else if (plan) status = (state?.queues?.[stationId] || []).some((entry) => entry.team === team.id) ? "waiting" : "locked"
  else if (review?.status === "sentBack") status = "sentBack"
  else if (team?.touched?.[stationId]) status = "draft"
  else status = "none"
  const label = status === "sentBack" && review?.reason ? `${STATUS_LABEL.sentBack}: ${review.reason}` : STATUS_LABEL[status]
  return { status, label, review, pitch: live, plan }
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
