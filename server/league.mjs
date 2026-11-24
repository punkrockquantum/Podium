/**
 * The arcade league table: best laps on the arcade's Circuit of the Americas, kept in
 * `data/league.json` with the same atomic write as the game state. Mounted by server.mjs as three
 * routes in its own routes table:
 *
 *   GET  /api/league?limit=50     the table sorted by best lap (limit 1–500, default 50)
 *   POST /api/league              { name, bestLapMs, season, carLabel, advantageS, laps, finishPos } → { ok, rank, row, total, kept }
 *   POST /api/league/reset        host PIN (x-pin header), empties the table
 *
 * Validation is strict: the name is trimmed, stripped of control characters and < >, 1–24 characters;
 * the best lap is an integer inside the physics' plausible window for this track; season, laps and
 * finishing position are small integers; the advantage is a finite number within ±5 s. Bodies with a
 * sanitised row over 600 bytes are refused, at most 500 rows are kept, and one address may post ten
 * laps a minute (a soft limit: 429 with retry-after).
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { PLAUSIBLE_LAP_MS } from "../public/js/arcade/physics.js"

export const LEAGUE_LIMITS = Object.freeze({
  nameMax: 24,
  labelMax: 48,
  rows: 500,
  defaultLimit: 50,
  rowBytes: 600,
  postsPerMinute: 10,
  seasons: [2027, 2028],
  lapsMax: 10,
  gridSize: 10,
  advantageAbsMax: 5,
  lapMs: PLAUSIBLE_LAP_MS,
})

/** A single line of text: no control characters, no angle brackets, trimmed, capped. */
export const cleanText = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)

const intOf = (value) => (typeof value === "number" && Number.isInteger(value) ? value : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN)
const numOf = (value) => (typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN)

/** The sanitised row for a submission, or { error } with the first problem found. */
export function validateEntry(body, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the lap as a JSON object" }
  const name = cleanText(body.name, LEAGUE_LIMITS.nameMax + 1)
  if (!name) return { error: "Enter a name (1–24 characters)" }
  if (name.length > LEAGUE_LIMITS.nameMax) return { error: "The name is too long (24 characters at most)" }
  const bestLapMs = intOf(body.bestLapMs)
  if (!Number.isInteger(bestLapMs)) return { error: "bestLapMs must be a whole number of milliseconds" }
  if (bestLapMs < LEAGUE_LIMITS.lapMs.min || bestLapMs > LEAGUE_LIMITS.lapMs.max) return { error: `That lap is not plausible on this track (${LEAGUE_LIMITS.lapMs.min}–${LEAGUE_LIMITS.lapMs.max} ms)` }
  const season = intOf(body.season)
  if (!LEAGUE_LIMITS.seasons.includes(season)) return { error: "season must be 2027 or 2028" }
  const carLabel = cleanText(body.carLabel, LEAGUE_LIMITS.labelMax) || "Unknown car"
  const advantageS = numOf(body.advantageS)
  if (!Number.isFinite(advantageS) || Math.abs(advantageS) > LEAGUE_LIMITS.advantageAbsMax) return { error: "advantageS must be a number within ±5 s per lap" }
  const laps = intOf(body.laps)
  if (!Number.isInteger(laps) || laps < 1 || laps > LEAGUE_LIMITS.lapsMax) return { error: `laps must be a whole number from 1 to ${LEAGUE_LIMITS.lapsMax}` }
  const finishPos = intOf(body.finishPos)
  if (!Number.isInteger(finishPos) || finishPos < 1 || finishPos > LEAGUE_LIMITS.gridSize) return { error: `finishPos must be a whole number from 1 to ${LEAGUE_LIMITS.gridSize}` }
  const row = { id: randomUUID(), name, bestLapMs, season, carLabel, advantageS: Math.round(advantageS * 100) / 100, laps, finishPos, at: now }
  if (JSON.stringify(row).length > LEAGUE_LIMITS.rowBytes) return { error: "The entry is too large" }
  return { row }
}

/** Load the table from disk; a damaged file is kept aside, like the game state. */
function loadRows(file) {
  if (!existsSync(file)) return []
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))
    const rows = Array.isArray(saved?.rows) ? saved.rows : []
    return rows
      .filter((r) => r && typeof r === "object" && Number.isInteger(r.bestLapMs) && typeof r.name === "string")
      .map((r) => ({
        id: typeof r.id === "string" ? r.id : randomUUID(),
        name: cleanText(r.name, LEAGUE_LIMITS.nameMax) || "—",
        bestLapMs: r.bestLapMs,
        season: LEAGUE_LIMITS.seasons.includes(r.season) ? r.season : LEAGUE_LIMITS.seasons[0],
        carLabel: cleanText(r.carLabel, LEAGUE_LIMITS.labelMax) || "Unknown car",
        advantageS: Number.isFinite(r.advantageS) ? r.advantageS : 0,
        laps: Number.isInteger(r.laps) ? r.laps : 0,
        finishPos: Number.isInteger(r.finishPos) ? r.finishPos : 0,
        at: Number.isFinite(r.at) ? r.at : 0,
      }))
      .sort((a, b) => a.bestLapMs - b.bestLapMs || a.at - b.at)
      .slice(0, LEAGUE_LIMITS.rows)
  } catch (err) {
    const aside = `${file}.damaged-${Date.now()}`
    try {
      renameSync(file, aside)
    } catch {}
    console.error(`[podium] could not read ${file} (${err.message}); kept it as ${aside} and started an empty league`)
    return []
  }
}

/**
 * The league's routes, in the shape of server.mjs's routes table. `send(res, status, payload)`,
 * `requireHost(req, res)` (true when it already answered 403) and `clientIp(req)` come from the server.
 */
export function leagueRoutes({ dataDir, send, requireHost, clientIp, now = Date.now }) {
  const file = join(dataDir, "league.json")
  let rows = loadRows(file)
  const save = () => {
    try {
      mkdirSync(dataDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, rows }))
      renameSync(tmp, file)
    } catch (err) {
      console.error("[podium] could not save the league:", err.message)
    }
  }
  const posts = new Map()
  const rateLimited = (req) => {
    const ip = clientIp(req)
    const t = now()
    const recent = (posts.get(ip) || []).filter((at) => t - at < 60_000)
    posts.set(ip, recent)
    if (recent.length >= LEAGUE_LIMITS.postsPerMinute) return true
    recent.push(t)
    return false
  }
  const table = (limit) => ({ rows: rows.slice(0, limit), total: rows.length, limits: { nameMax: LEAGUE_LIMITS.nameMax, lapMs: LEAGUE_LIMITS.lapMs, rows: LEAGUE_LIMITS.rows } })

  return {
    "GET /api/league": (req, res, { query }) => {
      const asked = Number(query.get("limit"))
      const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, LEAGUE_LIMITS.rows) : LEAGUE_LIMITS.defaultLimit
      return send(res, 200, table(limit))
    },
    "POST /api/league": (req, res, { body }) => {
      if (rateLimited(req)) {
        res.setHeader("retry-after", "60")
        return send(res, 429, { error: "Ten laps a minute is plenty. Try again shortly." })
      }
      const { row, error } = validateEntry(body, now())
      if (error) return send(res, 400, { error })
      rows.push(row)
      rows.sort((a, b) => a.bestLapMs - b.bestLapMs || a.at - b.at)
      const rank = rows.indexOf(row) + 1
      const kept = rank <= LEAGUE_LIMITS.rows
      rows = rows.slice(0, LEAGUE_LIMITS.rows)
      save()
      return send(res, 200, { ok: true, rank, kept, row, total: rows.length })
    },
    "POST /api/league/reset": (req, res) => {
      if (requireHost(req, res)) return
      rows = []
      save()
      return send(res, 200, { ok: true, rows: [], total: 0 })
    },
  }
}
