/**
 * Podium game server: serves the iPad app and keeps one shared game state.
 * No dependencies. `node server.mjs` (localhost) or `node server.mjs --lan` (every iPad on the Wi-Fi).
 *
 * Env: PORT (8080), HOST_PIN, LEADER_PIN, RACE_PIN, DATA_DIR (./data).
 */
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs"
import { join, normalize, extname, dirname, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { networkInterfaces } from "node:os"
import { randomUUID, randomInt, timingSafeEqual, createHash } from "node:crypto"
import { STATIONS, TEAM_COLORS, GAME_CLOCK, validChoice, decision, tablePoints } from "./public/js/catalog.js"
import { evaluate, effectiveTeam } from "./public/js/model.js"
import { simulateStation } from "./public/js/sim.js"
import { runRace, systemScore } from "./public/js/race.js"
import { architectReport, sanitiseTuning } from "./public/js/architect.js"
import { buildPlan } from "./public/js/plandata.js"
import { PITCH_MS, SEND_BACK_REASON_MAX } from "./public/js/approval.js"

const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(ROOT, "public")
const MAX_BODY = 64 * 1024
const STATION_IDS = STATIONS.map((s) => s.id)

export const DEFAULT_PINS = { host: "2027", leader: "1950", race: "SKO27" }
const PIN_FAILURE_LIMIT = 10
const PIN_FAILURE_WINDOW_MS = 5 * 60_000

/** Constant-time comparison of two short secrets (hashed first so lengths never leak). */
function sameSecret(given, expected) {
  const a = createHash("sha256").update(String(given ?? "")).digest()
  const b = createHash("sha256").update(String(expected)).digest()
  return timingSafeEqual(a, b)
}

/** A short single line of free text from a request: no control characters, trimmed, capped. */
const oneLine = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max)

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
}

export function blankState() {
  return {
    id: randomUUID(),
    version: 1,
    settings: { gameMinutes: GAME_CLOCK.minutes, visitMinutes: GAME_CLOCK.visitMinutes, races: 24, sprints: 6, stations: [...STATION_IDS] },
    clock: { status: "lobby", totalMs: GAME_CLOCK.minutes * 60_000, endsAt: null, remainingMs: null, endedAt: null, endedBy: null },
    tables: {},
    queues: {},
    leaders: {},
    pitches: {},
    teams: [],
    race: null,
  }
}

const PLAN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const planId = () => Array.from({ length: 5 }, () => PLAN_ALPHABET[randomInt(PLAN_ALPHABET.length)]).join("")
const STEPS = ["brief", "decide", "sim", "pitch", "architect"]

/** What a table costs and draws, from the evaluation's ledger. */
const clampMinutes = (value, fallback) => Math.min(GAME_CLOCK.maxMinutes, Math.max(1, Math.round(Number(value) || fallback)))

function makeTeams(list) {
  return list.slice(0, 10).map((item, i) => ({
    id: `t${i + 1}`,
    name: String(item?.name || `Team ${i + 1}`).trim().slice(0, 32) || `Team ${i + 1}`,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
    rank: Math.min(10, Math.max(1, Math.round(Number(item?.rank) || i + 1))),
    choices: {},
    touched: {},
    submitted: {},
    scores: {},
    pitch: {},
    visits: {},
    sims: {},
    plans: {},
    reviews: {},
    architect: { enabled: false, tuning: {}, gain: 1 },
  }))
}

/** Load the saved game; a damaged file is kept aside rather than silently replaced. */
function loadState(file) {
  if (!existsSync(file)) return blankState()
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.teams)) throw new Error("not a Podium state file")
    const base = blankState()
    const loaded = { ...base, ...saved, settings: { ...base.settings, ...saved.settings }, clock: { ...base.clock, ...saved.clock }, tables: saved.tables || {}, queues: saved.queues || {}, leaders: saved.leaders || {}, pitches: saved.pitches || {} }
    delete loaded.round
    for (const team of loaded.teams) {
      for (const key of ["choices", "touched", "submitted", "scores", "pitch", "visits", "sims", "plans", "reviews"]) team[key] = team[key] || {}
      delete team.verdicts
      team.architect = team.architect || { enabled: false, tuning: {}, gain: 1 }
    }
    return loaded
  } catch (err) {
    const aside = `${file}.damaged-${Date.now()}`
    try {
      renameSync(file, aside)
    } catch {}
    console.error(`[podium] could not read ${file} (${err.message}); kept it as ${aside} and started a blank game`)
    return blankState()
  }
}

export function createApp({ dataDir = join(ROOT, "data"), pins = {} } = {}) {
  const hostPin = String(pins.host || process.env.HOST_PIN || DEFAULT_PINS.host)
  const leaderPin = String(pins.leader || process.env.LEADER_PIN || DEFAULT_PINS.leader)
  const racePin = String(pins.race || process.env.RACE_PIN || DEFAULT_PINS.race)
  const file = join(dataDir, "state.json")
  let state = loadState(file)
  const save = () => {
    try {
      mkdirSync(dataDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(state))
      renameSync(tmp, file)
    } catch (err) {
      console.error("[podium] could not save state:", err.message)
    }
  }
  const bump = () => {
    state.version += 1
    save()
  }

  const isHost = (req) => sameSecret(req.headers["x-pin"], hostPin)
  const isLeader = (req) => sameSecret(req.headers["x-pin"], leaderPin) || isHost(req)
  const racePasswordOk = (value) => sameSecret(value, racePin)
  const pinFailures = new Map()
  const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "unknown").slice(0, 128)
  const clearPinFailures = (req) => pinFailures.delete(clientIp(req))
  const pinRateLimited = (req) => {
    const now = Date.now()
    const entry = pinFailures.get(clientIp(req))
    if (!entry || entry.resetAt <= now) {
      if (entry) pinFailures.delete(clientIp(req))
      return false
    }
    return entry.count >= PIN_FAILURE_LIMIT
  }
  const failedPin = (req) => {
    const now = Date.now()
    const ip = clientIp(req)
    const entry = pinFailures.get(ip)
    if (!entry || entry.resetAt <= now) pinFailures.set(ip, { count: 1, resetAt: now + PIN_FAILURE_WINDOW_MS })
    else entry.count += 1
  }
  const protectedRoute = (key) => key === "POST /api/login" || key === "POST /api/race/run" || key.startsWith("POST /api/host/") || key.startsWith("POST /api/leader/")
  const requireHost = (req, res) => {
    if (isHost(req)) {
      clearPinFailures(req)
      return false
    }
    failedPin(req)
    send(res, 403, { error: "Host PIN required" })
    return true
  }
  /**
   * Why this request may not act as the leader of `station`, or null. The host may act for any
   * table; a table leader only for the table chosen at login (sent as the x-station header).
   */
  const leaderBlocked = (req, station) => {
    if (!STATION_IDS.includes(station)) return [400, "Unknown table"]
    if (isHost(req)) {
      clearPinFailures(req)
      return null
    }
    if (!isLeader(req)) {
      failedPin(req)
      return [403, "Leader PIN required"]
    }
    if (req.headers["x-station"] !== station) return [403, "You are signed in as the leader of another table"]
    clearPinFailures(req)
    return null
  }
  const leaderTitle = (station) => STATIONS.find((s) => s.id === station)?.leader || "Table leader"
  const team = (id) => state.teams.find((t) => t.id === id)
  const opts = () => ({ races: state.settings.races, sprints: state.settings.sprints })

  /** Heartbeats live in memory only: they change every few seconds and must not rewrite the save file. */
  const presence = {}

  function publicState() {
    return { ...state, now: Date.now() }
  }

  const queueOf = (station) => (state.queues[station] = state.queues[station] || [])
  const dropFromQueues = (teamId, station) => {
    for (const [id, list] of Object.entries(state.queues)) if (!station || id === station) state.queues[id] = list.filter((entry) => entry.team !== teamId)
  }

  /** Freeze a table's plan: the choices, the simulation and the money, with a short id for the screenshot. */
  function snapshotPlan(t, station) {
    return buildPlan(t, station, opts(), { id: planId(), at: Date.now() })
  }

  const routes = {
    "GET /api/state": (req, res, { query }) => {
      if (query.get("since") && Number(query.get("since")) === state.version && query.get("game") === state.id) return send(res, 200, { unchanged: true, id: state.id, version: state.version, now: Date.now() })
      return send(res, 200, publicState())
    },
    "POST /api/login": (req, res, { body }) => {
      const pin = String(body?.pin || "")
      if (sameSecret(pin, hostPin)) {
        clearPinFailures(req)
        return send(res, 200, { role: "host" })
      }
      if (sameSecret(pin, leaderPin)) {
        if (!STATION_IDS.includes(body?.station)) return send(res, 400, { error: "Pick the table you lead" })
        clearPinFailures(req)
        return send(res, 200, { role: "leader", station: body.station })
      }
      failedPin(req)
      return send(res, 403, { error: "Wrong PIN" })
    },
    "POST /api/host/setup": (req, res, { body }) => {
      if (requireHost(req, res)) return
      const list = Array.isArray(body?.teams) ? body.teams : []
      if (list.length < 2) return send(res, 400, { error: "At least two teams" })
      const stations = Array.isArray(body?.stations) ? body.stations.filter((id) => STATION_IDS.includes(id)) : STATION_IDS
      if (stations.length < 5) return send(res, 400, { error: "Use at least five tables" })
      const gameMinutes = clampMinutes(body?.gameMinutes, GAME_CLOCK.minutes)
      const base = blankState()
      state = {
        ...base,
        settings: {
          gameMinutes,
          visitMinutes: Math.min(30, clampMinutes(body?.visitMinutes, GAME_CLOCK.visitMinutes)),
          races: Math.min(30, Math.max(15, Math.round(Number(body?.races) || 24))),
          sprints: Math.min(12, Math.max(0, Math.round(Number(body?.sprints) || 6))),
          stations: STATION_IDS.filter((id) => stations.includes(id)),
        },
        clock: { ...base.clock, totalMs: gameMinutes * 60_000 },
        teams: makeTeams(list),
      }
      for (const key of Object.keys(presence)) delete presence[key]
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/host/clock": (req, res, { body }) => {
      if (requireHost(req, res)) return
      if (state.race) return send(res, 409, { error: "The race has run. Take it back before changing the clock." })
      const clock = state.clock
      const action = body?.action
      const now = Date.now()
      if (action === "start" && clock.status === "lobby") {
        clock.status = "running"
        clock.endsAt = now + clock.totalMs
      } else if (action === "pause" && clock.status === "running") {
        clock.status = "paused"
        clock.remainingMs = Math.max(0, clock.endsAt - now)
        clock.endsAt = null
        clock.pausedAt = now
      } else if (action === "resume" && clock.status === "paused") {
        clock.status = "running"
        clock.endsAt = now + (clock.remainingMs || 0)
        clock.remainingMs = null
        for (const seat of Object.values(state.tables)) seat.since += now - (clock.pausedAt || now)
        clock.pausedAt = null
      } else if (action === "set" && clock.status === "lobby") {
        const minutes = clampMinutes(body?.minutes, state.settings.gameMinutes)
        state.settings.gameMinutes = minutes
        clock.totalMs = minutes * 60_000
      } else if (action === "add") {
        const minutes = Math.round(Number(body?.minutes))
        if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > GAME_CLOCK.maxMinutes) return send(res, 400, { error: "Add or remove whole minutes" })
        const ms = minutes * 60_000
        if (clock.status === "lobby") {
          clock.totalMs = Math.min(GAME_CLOCK.maxMinutes, Math.max(1, clock.totalMs / 60_000 + minutes)) * 60_000
          state.settings.gameMinutes = clock.totalMs / 60_000
        } else if (clock.status === "running") {
          clock.endsAt += ms
          clock.totalMs += ms
          if (clock.endsAt <= now) endClock("host")
        } else if (clock.status === "paused") {
          clock.remainingMs += ms
          clock.totalMs += ms
          if (clock.remainingMs <= 0) endClock("host")
        } else if (clock.status === "ended" && minutes > 0) {
          clock.status = "running"
          clock.endsAt = now + ms
          clock.totalMs += ms
          clock.endedAt = null
          clock.endedBy = null
        } else {
          return send(res, 409, { error: "The clock has ended" })
        }
      } else if (action === "end" && clock.status !== "ended") {
        endClock("host")
      } else {
        return send(res, 400, { error: `Cannot ${String(action || "do that")} while the clock is ${clock.status}` })
      }
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/host/race": (req, res, { body }) => {
      if (requireHost(req, res)) return
      if (!racePasswordOk(body?.racePassword)) {
        failedPin(req)
        return send(res, 403, { error: "Wrong race password" })
      }
      clearPinFailures(req)
      return startRace(res, body, "host")
    },
    "POST /api/race/run": (req, res, { body }) => {
      if (!racePasswordOk(body?.password)) {
        failedPin(req)
        return send(res, 403, { error: "Wrong race password" })
      }
      clearPinFailures(req)
      if (state.race) return send(res, 409, { error: "The race has run. The host can take it back to run it again." })
      return startRace(res, body, "race screen")
    },
    "POST /api/host/unrace": (req, res) => {
      if (requireHost(req, res)) return
      state.race = null
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/host/queue": (req, res, { body }) => {
      if (requireHost(req, res)) return
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      const list = queueOf(station)
      const at = list.findIndex((entry) => entry.team === body?.team)
      const action = body?.action
      if (action === "clear") state.queues[station] = []
      else if (at < 0) return send(res, 404, { error: "That team is not in this queue" })
      else if (action === "confirm") list[at].confirmed = !list[at].confirmed
      else if (action === "up" && at > 0) list.splice(at - 1, 0, ...list.splice(at, 1))
      else if (action === "down" && at < list.length - 1) list.splice(at + 1, 0, ...list.splice(at, 1))
      else if (action === "remove") list.splice(at, 1)
      else if (action === "slot") {
        const slot = String(body?.slot || "").trim()
        if (slot && !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) return send(res, 400, { error: "Slot time as HH:MM" })
        list[at].slot = slot || null
      } else if (!["up", "down"].includes(action)) return send(res, 400, { error: "Unknown queue action" })
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/host/architect": (req, res, { body }) => {
      if (requireHost(req, res)) return
      const t = team(body?.team)
      if (!t) return send(res, 404, { error: "No such team" })
      setArchitect(t, Boolean(body?.enabled), "Host")
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/leader/availability": (req, res, { body }) => {
      const station = body?.station
      const blocked = leaderBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const available = Boolean(body?.available)
      if (available && state.pitches[station]) return send(res, 409, { error: "A pitch is running: approve it or send it back first" })
      state.leaders[station] = { available, since: Date.now() }
      bump()
      return send(res, 200, { ok: true, leader: state.leaders[station] })
    },
    "POST /api/leader/architect": (req, res, { body }) => {
      const station = body?.station
      const blocked = leaderBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const t = team(body?.team)
      if (!t) return send(res, 404, { error: "No such team" })
      if (state.race) return send(res, 409, { error: "The race has run: decisions are locked" })
      setArchitect(t, Boolean(body?.enabled), oneLine(body?.by, 40) || leaderTitle(station), station)
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/leader/pitch": (req, res, { body }) => {
      const station = body?.station
      const blocked = leaderBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const now = Date.now()
      const live = state.pitches[station]
      if (body?.action === "cancel") {
        if (!live) return send(res, 409, { error: "No pitch is running at this table" })
        delete state.pitches[station]
        state.leaders[station] = { available: true, since: now }
        bump()
        return send(res, 200, publicState())
      }
      if (body?.action !== "start") return send(res, 400, { error: "Start or cancel a pitch" })
      const t = team(body?.team)
      if (!t) return send(res, 404, { error: "No such team" })
      if (!state.leaders[station]?.available) return send(res, 409, { error: "Set yourself Available before starting a pitch" })
      if (live) return send(res, 409, { error: "A pitch is already running at this table" })
      if (!t.plans[station]) return send(res, 409, { error: "This team has not locked in a plan here" })
      if (t.reviews[station]?.status === "approved") return send(res, 409, { error: "This design is already approved" })
      const lockout = reviewBlocked(t, station)
      if (lockout) return send(res, 409, { error: lockout })
      state.pitches[station] = { team: t.id, startedAt: now, endsAt: now + PITCH_MS, by: oneLine(body?.by, 40) || leaderTitle(station) }
      state.leaders[station] = { available: false, since: now, busyWith: t.id }
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/leader/decide": (req, res, { body }) => {
      const station = body?.station
      const blocked = leaderBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const t = team(body?.team)
      if (!t) return send(res, 404, { error: "No such team" })
      const live = state.pitches[station]
      if (!live || live.team !== t.id) return send(res, 409, { error: "Start this team's pitch before deciding" })
      const decisionId = body?.decision
      if (!["approve", "sendBack"].includes(decisionId)) return send(res, 400, { error: "Approve or send back" })
      const plan = t.plans[station]
      if (!plan) return send(res, 409, { error: "This team has not locked in a plan here" })
      const lockout = reviewBlocked(t, station)
      if (lockout) return send(res, 409, { error: lockout })
      const now = Date.now()
      const record = { by: oneLine(body?.by, 40) || live.by || leaderTitle(station), at: now, startedAt: live.startedAt, durationMs: now - live.startedAt, planId: plan.id, score: plan.score }
      if (decisionId === "approve") {
        const points = tablePoints(plan.score, true)
        t.reviews[station] = { status: "approved", ...record, points }
        t.scores[station] = { total: points, at: now }
        t.pitch[station] = points
      } else {
        t.reviews[station] = { status: "sentBack", ...record, reason: oneLine(body?.reason, SEND_BACK_REASON_MAX) }
        delete t.plans[station]
        delete t.submitted[station]
        delete t.scores[station]
        delete t.pitch[station]
      }
      delete state.pitches[station]
      dropFromQueues(t.id, station)
      state.leaders[station] = { available: true, since: now }
      bump()
      return send(res, 200, publicState())
    },
    "GET /api/presence": (req, res) => {
      const now = Date.now()
      return send(res, 200, { now, presence: Object.fromEntries(Object.entries(presence).filter(([, p]) => now - p.at < 10 * 60_000)) })
    },
    "POST /api/host/reset": (req, res) => {
      if (requireHost(req, res)) return
      state = blankState()
      for (const key of Object.keys(presence)) delete presence[key]
      bump()
      return send(res, 200, publicState())
    },
  }

  function endClock(by) {
    const clock = state.clock
    clock.status = "ended"
    clock.endsAt = null
    clock.remainingMs = 0
    clock.endedAt = Date.now()
    clock.endedBy = by
    state.tables = {}
  }

  function setArchitect(t, enabled, by, station = null) {
    const now = Date.now()
    t.architect = enabled
      ? { ...t.architect, enabled, grantedAt: now, grantedBy: by, grantedStation: station, revokedBy: null }
      : { ...t.architect, enabled, revokedAt: now, revokedBy: by }
  }

  /** The race uses approved tables only: everything else races on its defaults and scores 0. */
  function startRace(res, body, by) {
    if (state.teams.length < 2) return send(res, 400, { error: "Set up teams first" })
    if (["running", "paused"].includes(state.clock.status)) {
      if (!body?.endClock) return send(res, 409, { error: "The game clock is still running. End it first, then run the race." })
      endClock(by)
    }
    const seed = oneLine(body?.seed, 64) || `${state.id}-${Date.now()}`
    const stations = state.settings.stations
    state.pitches = {}
    const entries = state.teams.map((t) => {
      const raced = effectiveTeam(t, stations)
      const evaluation = evaluate(raced, opts())
      const pitch = Object.fromEntries(raced.approved.map((id) => [id, t.pitch[id] || 0]))
      return { id: t.id, name: t.name, color: t.color, pitch, missed: raced.missed, notApproved: raced.notApproved, architect: Boolean(t.architect?.enabled), visited: visitedCount(t), system: systemScore(evaluation, stations), evaluation }
    })
    const result = runRace(entries, seed, stations)
    for (const row of result.results) row.visited = entries.find((e) => e.id === row.id).visited
    state.race = { seed, ranAt: Date.now(), ranBy: by, result }
    bump()
    return send(res, 200, publicState())
  }

  /** Pitching and approval are allowed after time if the plan was locked in before the clock ran out. */
  function reviewBlocked(t, station) {
    const lockedInBeforeTime = state.clock.status === "ended" && !state.race && t.plans[station] && t.plans[station].at <= state.clock.endedAt
    const reason = lockReason(t, station)
    if (reason && !lockedInBeforeTime) return state.clock.status === "ended" ? "Time is up: this table was not locked in before the clock ran out" : reason
    return null
  }

  /** Expire the clock lazily so a restart or a sleeping Mac still ends the game on time. */
  function tick() {
    if (state.clock.status === "running" && Date.now() >= state.clock.endsAt) {
      endClock("time")
      bump()
    }
  }
  const timer = setInterval(tick, 1000)
  timer.unref?.()

  const visitedCount = (t) => state.settings.stations.filter((id) => t.visits?.[id] || t.touched?.[id] || t.submitted?.[id] || t.plans?.[id]).length

  /** Why a team cannot change this table right now, or null. */
  function lockReason(t, station) {
    if (state.race) return "The race has run: decisions are locked"
    if (state.clock.status === "lobby") return "Wait for the host to start the game clock"
    if (state.clock.status === "ended") return "Time is up: this table is locked"
    if (station && !state.settings.stations.includes(station)) return "That table is not in play"
    return null
  }

  const teamRoutes = {
    checkin: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      const reason = lockReason(t, station)
      if (reason) return send(res, 409, { error: reason })
      const now = Date.now()
      const here = state.tables[station]
      if (!here || here.team !== t.id) {
        for (const [id, seat] of Object.entries(state.tables)) if (seat.team === t.id) delete state.tables[id]
        state.tables[station] = { team: t.id, since: now }
        const visit = t.visits[station] || { first: now, count: 0 }
        t.visits[station] = { ...visit, last: now, count: visit.count + 1 }
        bump()
      }
      return send(res, 200, { ok: true, table: state.tables[station], team: t, version: state.version })
    },
    sim: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      const visit = t.visits[station]?.count || 0
      const runs = t.sims[station] || { total: 0, visit: 0, visitNo: visit }
      t.sims[station] = runs.visitNo === visit ? { ...runs, total: runs.total + 1, visit: runs.visit + 1 } : { total: runs.total + 1, visit: 1, visitNo: visit }
      try {
        t.sims[station].lastScore = simulateStation(t, opts(), station).score
        t.sims[station].lastAt = Date.now()
      } catch (err) {
        console.error(`[podium] sim score for ${t.id} at ${station} failed`, err)
      }
      bump()
      return send(res, 200, { ok: true, runs: t.sims[station] })
    },
    choices: (req, res, t, body) => {
      const station = body?.station
      const reason = lockReason(t, station)
      if (reason) return send(res, 409, { error: reason })
      if (station && t.plans[station]) return send(res, 409, { error: "This plan is locked in: ask the leader to unlock it to change it" })
      const changes = body?.choices && typeof body.choices === "object" ? body.choices : {}
      const rejected = []
      for (const [key, value] of Object.entries(changes)) {
        const d = decision(key)
        if (!d || (station && d.station !== station) || !validChoice(key, value) || lockReason(t, d.station) || t.plans[d.station]) {
          rejected.push(key)
          continue
        }
        t.choices[key] = d.values ? Number(value) : value
        t.touched[d.station] = Date.now()
      }
      bump()
      return send(res, rejected.length ? 207 : 200, { ok: true, rejected, team: t })
    },
    submit: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      const reason = lockReason(t, station)
      if (reason) return send(res, 409, { error: reason })
      if (t.plans[station]) return send(res, 200, { ok: true, team: t, plan: t.plans[station] })
      const plan = snapshotPlan(t, station)
      t.plans[station] = plan
      t.submitted[station] = plan.at
      bump()
      return send(res, 200, { ok: true, team: t, plan })
    },
    unlock: (req, res, t, body) => {
      const station = body?.station
      const blocked = leaderBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const reason = lockReason(t, station)
      if (reason) return send(res, 409, { error: reason })
      delete t.plans[station]
      delete t.submitted[station]
      delete t.reviews[station]
      delete t.scores[station]
      delete t.pitch[station]
      if (state.pitches[station]?.team === t.id) {
        delete state.pitches[station]
        state.leaders[station] = { available: true, since: Date.now() }
      }
      dropFromQueues(t.id, station)
      bump()
      return send(res, 200, { ok: true, team: t })
    },
    call: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      if (!t.plans[station]) return send(res, 409, { error: "Lock in your plan before calling the leader" })
      if (t.reviews[station]?.status === "approved") return send(res, 409, { error: "The leader has already approved this design" })
      const blocked = reviewBlocked(t, station)
      if (blocked) return send(res, 409, { error: blocked })
      const list = queueOf(station)
      if (!list.some((entry) => entry.team === t.id)) list.push({ team: t.id, at: Date.now(), confirmed: false, slot: null })
      bump()
      return send(res, 200, { ok: true, position: list.findIndex((entry) => entry.team === t.id) + 1, leader: state.leaders[station] || { available: false } })
    },
    architect: (req, res, t, body) => {
      if (!t.architect?.enabled) return send(res, 403, { error: "The host has not granted Architect mode to this team" })
      const reason = lockReason(t, null)
      if (reason) return send(res, 409, { error: reason })
      const tuning = sanitiseTuning(body?.tuning)
      const report = architectReport(t, tuning)
      t.architect = { ...t.architect, tuning, gain: report.gain, at: Date.now() }
      bump()
      return send(res, 200, { ok: true, report, team: t })
    },
    presence: (req, res, t, body) => {
      const station = STATION_IDS.includes(body?.station) ? body.station : null
      const step = STEPS.includes(body?.step) ? body.step : null
      presence[t.id] = { station, step, at: Date.now() }
      return send(res, 200, { ok: true })
    },
    checkout: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      if (state.tables[station]?.team === t.id) {
        delete state.tables[station]
        bump()
      }
      delete presence[t.id]
      return send(res, 200, { ok: true })
    },
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://local")
    const query = url.searchParams
    try {
      if (url.pathname.startsWith("/api/")) {
        tick()
        let body = null
        if (req.method === "POST") body = await readJson(req)
        const key = `${req.method} ${url.pathname}`
        if (protectedRoute(key) && pinRateLimited(req)) {
          res.setHeader("retry-after", String(Math.ceil(PIN_FAILURE_WINDOW_MS / 1000)))
          return send(res, 429, { error: "Too many failed PIN attempts. Try again in five minutes." })
        }
        if (routes[key]) return routes[key](req, res, { body, query })
        const match = url.pathname.match(/^\/api\/teams\/([a-z0-9]{1,8})\/(checkin|sim|choices|submit|unlock|call|architect|presence|checkout)$/)
        if (match && req.method === "POST") {
          const t = team(match[1])
          if (!t) return send(res, 404, { error: "No such team" })
          return teamRoutes[match[2]](req, res, t, body)
        }
        if (key === "GET /api/health") return send(res, 200, { ok: true, app: "podium", version: state.version, teams: state.teams.length, pid: process.pid })
        return send(res, 404, { error: "Not found" })
      }
      return serveStatic(url.pathname, res)
    } catch (err) {
      if (err.status) return send(res, err.status, { error: err.message })
      console.error("[podium]", err)
      return send(res, 500, { error: "Server error" })
    }
  }

  return { handle, save, getState: () => state, close: () => clearInterval(timer) }
}

function send(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, { "content-type": TYPES[".json"], "cache-control": "no-store", "x-content-type-options": "nosniff" })
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }))
      }
    })
    req.on("error", reject)
  })
}

async function serveStatic(pathname, res) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return send(res, 400, { error: "Bad path" })
  }
  if (decoded.includes("\0")) return send(res, 400, { error: "Bad path" })
  const clean = normalize(decoded).replace(/^([/\\])+/, "")
  let path = join(PUBLIC, clean || "index.html")
  if (path !== PUBLIC && !path.startsWith(PUBLIC + sep)) return send(res, 403, { error: "Forbidden" })
  try {
    if ((await stat(path)).isDirectory()) path = join(path, "index.html")
    const data = await readFile(path)
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" })
    res.end(data)
  } catch {
    send(res, 404, { error: "Not found" })
  }
}

function lanAddresses() {
  let ifaces
  try {
    ifaces = networkInterfaces()
  } catch (err) {
    console.error(`[podium] Could not list network interfaces (${err.code || err.message}).`)
    return []
  }
  return Object.values(ifaces)
    .flat()
    .filter((i) => i && (i.family === "IPv4" || i.family === 4) && !i.internal)
    .map((i) => i.address)
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  const lan = process.argv.includes("--lan")
  const port = Number(process.env.PORT) || 8080
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[podium] PORT must be a whole number from 1 to 65535 (got "${process.env.PORT}"). Example: PORT=8080 npm start`)
    process.exit(1)
  }
  const bind = lan ? "0.0.0.0" : "127.0.0.1"
  const app = createApp({ dataDir: process.env.DATA_DIR || join(ROOT, "data") })
  const server = createServer(app.handle)
  server.on("error", async (err) => {
    if (err.code === "EADDRINUSE") {
      const url = `http://localhost:${port}/`
      const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
        .then((res) => res.json())
        .then((body) => body?.app === "podium")
        .catch(() => false)
      if (running) {
        console.log(`[podium] Podium is already running at ${url} (the background service or another window). Opening it.`)
        if (process.platform === "darwin" && !process.env.PODIUM_NO_OPEN) spawn("open", [url], { stdio: "ignore", detached: true }).unref()
        process.exit(0)
      }
      console.error(`[podium] Port ${port} is used by another program. See it with: lsof -nP -iTCP:${port} -sTCP:LISTEN`)
      console.error(`[podium] Stop that program, or pick another port: PORT=8090 npm start`)
    } else if (err.code === "EACCES") {
      console.error(`[podium] This Mac will not allow port ${port}. Use a port above 1024: PORT=8080 npm start`)
    } else if (lan) {
      console.error(`[podium] Could not open a LAN address (${err.code || err.message}). Stay on this Mac instead: npm start`)
    } else {
      console.error(`[podium] Could not start: ${err.message}`)
    }
    process.exit(1)
  })
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log(`[podium] ${new Date().toISOString()} ${signal} received (pid ${process.pid}): state saved, stopping`)
      app.save()
      server.close()
      process.exit(0)
    })
  }
  server.listen(port, bind, () => {
    const base = `http://localhost:${port}`
    console.log(`[podium] ${new Date().toISOString()} Podium 2027 is running on this Mac (pid ${process.pid}).`)
    console.log(`[podium] Landing     ${base}/`)
    console.log(`[podium] Host console ${base}/host.html`)
    console.log(`[podium] Projector   ${base}/race.html`)
    for (const station of STATIONS) console.log(`[podium] ${station.name.padEnd(28)} ${base}/station.html?station=${station.id}`)
    if (lan) {
      const ips = lanAddresses()
      if (!ips.length) {
        console.error(`[podium] No LAN address found (Wi-Fi off, VPN, or this Mac blocked the interface list). iPads cannot join.`)
        console.error(`[podium] On this Mac, use the localhost links above. For the room, join Wi-Fi and run npm run start:lan again.`)
      } else {
        for (const ip of ips) console.log(`[podium] iPads        http://${ip}:${port}/`)
      }
    } else {
      console.log(`[podium] Localhost only. For iPads on the same Wi-Fi, stop this and run: npm run start:lan`)
    }
    const defaults = ["HOST_PIN", "LEADER_PIN", "RACE_PIN"].filter((name) => !process.env[name])
    if (defaults.length) {
      console.log(`[podium] Rehearsal defaults in use for ${defaults.join(", ")} (host ${DEFAULT_PINS.host}, leader ${DEFAULT_PINS.leader}, race ${DEFAULT_PINS.race}). Set them before a real event.`)
    }
  })
}
