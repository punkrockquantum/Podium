/**
 * Podium game server: serves the iPad app and keeps one shared game state.
 * No dependencies. `node server.mjs` (localhost) or `node server.mjs --lan` (every iPad on the Wi-Fi).
 *
 * Env: PORT (8080), HOST_PIN, LEADER_PIN (the Architect PIN), RACE_PIN, DATA_DIR (./data).
 */
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs"
import { join, normalize, extname, dirname, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { networkInterfaces } from "node:os"
import { randomUUID, randomInt, timingSafeEqual, createHash } from "node:crypto"
import { STATIONS, TEAM_COLORS, SESSION, TIERS, MAX_TEAMS, MIN_TEAMS, validChoice, decision, tablePoints } from "./public/js/catalog.js"
import { evaluate, effectiveTeam } from "./public/js/model.js"
import { simulateStation } from "./public/js/sim.js"
import { runRace, systemScore } from "./public/js/race.js"
import { buildPlan } from "./public/js/plandata.js"
import { PITCH_MS, SEND_BACK_REASON_MAX } from "./public/js/approval.js"
import { phaseOf } from "./public/js/session.js"

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

const PHASE_KEYS = ["briefMinutes", "playMinutes", "raceMinutes", "readoutMinutes"]
/** Whole or half minutes from 0.5 to the session maximum. */
const clampMinutes = (value, fallback) => {
  const n = Number(value)
  return Math.min(SESSION.maxMinutes, Math.max(0.5, Math.round((Number.isFinite(n) && n > 0 ? n : fallback) * 2) / 2))
}

function sessionSettings(source = {}) {
  return Object.fromEntries(PHASE_KEYS.map((key) => [key, clampMinutes(source[key], SESSION[key])]))
}

export function blankState() {
  const settings = { ...sessionSettings(), stations: [...STATION_IDS] }
  return {
    id: randomUUID(),
    version: 1,
    settings,
    brief: { status: "idle", endsAt: null },
    clock: { status: "lobby", totalMs: settings.playMinutes * 60_000, endsAt: null, remainingMs: null, endedAt: null, endedBy: null },
    readout: null,
    tables: {},
    queues: {},
    architects: {},
    pitches: {},
    teams: [],
    race: null,
  }
}

const PLAN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const planId = () => Array.from({ length: 5 }, () => PLAN_ALPHABET[randomInt(PLAN_ALPHABET.length)]).join("")
const STEPS = ["brief", "decide", "sim", "pitch"]
const TEAM_KEYS = ["choices", "touched", "submitted", "scores", "pitch", "visits", "sims", "plans", "reviews"]

const tierOf = (value) => (TIERS.some((t) => t.id === Number(value)) ? Number(value) : 2)

function makeTeams(list) {
  return list.slice(0, MAX_TEAMS).map((item, i) => ({
    id: `t${i + 1}`,
    name: oneLine(item?.name, 32) || `Team ${i + 1}`,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
    tier: tierOf(item?.tier),
    ...Object.fromEntries(TEAM_KEYS.map((key) => [key, {}])),
  }))
}

/** Load the saved game; a damaged file is kept aside rather than silently replaced. */
function loadState(file) {
  if (!existsSync(file)) return blankState()
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.teams)) throw new Error("not a Podium state file")
    const base = blankState()
    const stations = (saved.settings?.stations || []).filter((id) => STATION_IDS.includes(id))
    const loaded = {
      ...base,
      ...saved,
      settings: { ...sessionSettings(saved.settings), stations: stations.length ? stations : [...STATION_IDS] },
      brief: saved.brief || base.brief,
      clock: { ...base.clock, ...saved.clock },
      readout: saved.readout || null,
      tables: saved.tables || {},
      queues: saved.queues || {},
      architects: saved.architects || {},
      pitches: saved.pitches || {},
    }
    delete loaded.leaders
    for (const team of loaded.teams) {
      for (const key of TEAM_KEYS) team[key] = team[key] || {}
      team.tier = tierOf(team.tier)
      for (const key of Object.keys(team.choices)) if (!decision(key)) delete team.choices[key]
      delete team.architect
      delete team.rank
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
  const architectPin = String(pins.leader || process.env.LEADER_PIN || DEFAULT_PINS.leader)
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
  const isArchitect = (req) => sameSecret(req.headers["x-pin"], architectPin) || isHost(req)
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
  const protectedRoute = (key) => key === "POST /api/login" || key === "POST /api/race/run" || key.startsWith("POST /api/host/") || key.startsWith("POST /api/architect/")
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
   * Why this request may not act as the Architect of `station`, or null. The host may act for any
   * table; an Architect only for the table chosen at login (sent as the x-station header).
   */
  const architectBlocked = (req, station) => {
    if (!STATION_IDS.includes(station)) return [400, "Unknown table"]
    if (isHost(req)) {
      clearPinFailures(req)
      return null
    }
    if (!isArchitect(req)) {
      failedPin(req)
      return [403, "Architect PIN required"]
    }
    if (req.headers["x-station"] !== station) return [403, "You are signed in as the Architect of another table"]
    clearPinFailures(req)
    return null
  }
  const architectTitle = (station) => STATIONS.find((s) => s.id === station)?.architect || "Architect"
  const team = (id) => state.teams.find((t) => t.id === id)

  /** Heartbeats live in memory only: they change every few seconds and must not rewrite the save file. */
  const presence = {}

  const publicState = () => ({ ...state, now: Date.now() })
  const queueOf = (station) => (state.queues[station] = state.queues[station] || [])
  const dropFromQueues = (teamId, station) => {
    for (const [id, list] of Object.entries(state.queues)) if (!station || id === station) state.queues[id] = list.filter((entry) => entry.team !== teamId)
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
      if (sameSecret(pin, architectPin)) {
        if (!STATION_IDS.includes(body?.station)) return send(res, 400, { error: "Pick the table you are the Architect for" })
        clearPinFailures(req)
        return send(res, 200, { role: "architect", station: body.station })
      }
      failedPin(req)
      return send(res, 403, { error: "Wrong PIN" })
    },
    "POST /api/host/setup": (req, res, { body }) => {
      if (requireHost(req, res)) return
      const list = Array.isArray(body?.teams) ? body.teams : []
      if (list.length < MIN_TEAMS || list.length > MAX_TEAMS) return send(res, 400, { error: `Use ${MIN_TEAMS} to ${MAX_TEAMS} teams` })
      const stations = Array.isArray(body?.stations) ? STATION_IDS.filter((id) => body.stations.includes(id)) : [...STATION_IDS]
      if (!stations.length) return send(res, 400, { error: "Use at least one table" })
      const base = blankState()
      const settings = { ...sessionSettings(body), stations }
      state = { ...base, settings, clock: { ...base.clock, totalMs: settings.playMinutes * 60_000 }, teams: makeTeams(list) }
      for (const key of Object.keys(presence)) delete presence[key]
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/host/phase": (req, res, { body }) => {
      if (requireHost(req, res)) return
      const action = body?.action
      const now = Date.now()
      const phase = phaseOf(state)
      const clock = state.clock
      if (action === "set") {
        if (phase !== "lobby") return send(res, 409, { error: "Set the session plan before the brief starts" })
        Object.assign(state.settings, sessionSettings({ ...state.settings, ...body }))
        clock.totalMs = state.settings.playMinutes * 60_000
      } else if (action === "brief") {
        if (phase !== "lobby") return send(res, 409, { error: "The brief has already started" })
        state.brief = { status: "running", startedAt: now, endsAt: now + state.settings.briefMinutes * 60_000 }
      } else if (action === "play") {
        if (!["lobby", "brief", "briefDone"].includes(phase)) return send(res, 409, { error: "Play has already started" })
        state.brief = { ...state.brief, status: "done", endsAt: state.brief.endsAt || now }
        clock.status = "running"
        clock.totalMs = state.settings.playMinutes * 60_000
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
      } else if (action === "add") {
        const minutes = Math.round(Number(body?.minutes))
        if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > SESSION.maxMinutes) return send(res, 400, { error: "Add or remove whole minutes" })
        const ms = minutes * 60_000
        if (phase === "lobby") {
          state.settings.playMinutes = clampMinutes(state.settings.playMinutes + minutes, SESSION.playMinutes)
          clock.totalMs = state.settings.playMinutes * 60_000
        } else if (phase === "brief") {
          state.brief.endsAt = Math.max(now, state.brief.endsAt + ms)
        } else if (phase === "play" && clock.status === "running") {
          clock.endsAt += ms
          clock.totalMs += ms
          if (clock.endsAt <= now) endPlay("host")
        } else if (phase === "play") {
          clock.remainingMs += ms
          clock.totalMs += ms
          if (clock.remainingMs <= 0) endPlay("host")
        } else if (phase === "ended" && minutes > 0) {
          Object.assign(clock, { status: "running", endsAt: now + ms, totalMs: clock.totalMs + ms, endedAt: null, endedBy: null })
        } else if (phase === "readout") {
          state.readout.endsAt = Math.max(now, state.readout.endsAt + ms)
        } else {
          return send(res, 409, { error: "Nothing to add time to right now" })
        }
      } else if (action === "end") {
        if (phase !== "play") return send(res, 409, { error: "Play is not running" })
        endPlay("host")
      } else if (action === "readout") {
        if (!state.race) return send(res, 409, { error: "Run the race before the readouts" })
        state.readout = { startedAt: now, endsAt: now + state.settings.readoutMinutes * 60_000 }
      } else {
        return send(res, 400, { error: `Cannot ${String(action || "do that")} in the ${phase} phase` })
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
      state.readout = null
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
      else if (action === "up" && at > 0) list.splice(at - 1, 0, ...list.splice(at, 1))
      else if (action === "down" && at < list.length - 1) list.splice(at + 1, 0, ...list.splice(at, 1))
      else if (action === "remove") list.splice(at, 1)
      else if (!["up", "down"].includes(action)) return send(res, 400, { error: "Unknown queue action" })
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/architect/availability": (req, res, { body }) => {
      const station = body?.station
      const blocked = architectBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const available = Boolean(body?.available)
      if (available && state.pitches[station]) return send(res, 409, { error: "A pitch is running: approve it or send it back first" })
      state.architects[station] = { available, since: Date.now() }
      bump()
      return send(res, 200, { ok: true, architect: state.architects[station] })
    },
    "POST /api/architect/pitch": (req, res, { body }) => {
      const station = body?.station
      const blocked = architectBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const now = Date.now()
      const live = state.pitches[station]
      if (body?.action === "cancel") {
        if (!live) return send(res, 409, { error: "No pitch is running at this table" })
        delete state.pitches[station]
        state.architects[station] = { available: true, since: now }
        bump()
        return send(res, 200, publicState())
      }
      if (body?.action !== "start") return send(res, 400, { error: "Start or cancel a pitch" })
      const t = team(body?.team)
      if (!t) return send(res, 404, { error: "No such team" })
      if (!state.architects[station]?.available) return send(res, 409, { error: "Set yourself Available before starting a pitch" })
      if (live) return send(res, 409, { error: "A pitch is already running at this table" })
      if (!t.plans[station]) return send(res, 409, { error: "This team has not locked in a plan here" })
      if (t.reviews[station]?.status === "approved") return send(res, 409, { error: "This design is already approved" })
      const lockout = reviewBlocked(t, station)
      if (lockout) return send(res, 409, { error: lockout })
      state.pitches[station] = { team: t.id, startedAt: now, endsAt: now + PITCH_MS, by: oneLine(body?.by, 40) || architectTitle(station) }
      state.architects[station] = { available: false, since: now, busyWith: t.id }
      bump()
      return send(res, 200, publicState())
    },
    "POST /api/architect/decide": (req, res, { body }) => {
      const station = body?.station
      const blocked = architectBlocked(req, station)
      if (blocked) return send(res, blocked[0], { error: blocked[1] })
      const t = team(body?.team)
      if (!t) return send(res, 404, { error: "No such team" })
      const live = state.pitches[station]
      if (!live || live.team !== t.id) return send(res, 409, { error: "Start this team's pitch before deciding" })
      const verdict = body?.decision
      if (!["approve", "sendBack"].includes(verdict)) return send(res, 400, { error: "Approve or send back" })
      const plan = t.plans[station]
      if (!plan) return send(res, 409, { error: "This team has not locked in a plan here" })
      const lockout = reviewBlocked(t, station)
      if (lockout) return send(res, 409, { error: lockout })
      const now = Date.now()
      const record = { by: oneLine(body?.by, 40) || live.by || architectTitle(station), at: now, startedAt: live.startedAt, durationMs: now - live.startedAt, planId: plan.id, score: plan.score }
      if (verdict === "approve") {
        const points = tablePoints(plan.score, true)
        t.reviews[station] = { status: "approved", ...record, points }
        t.scores[station] = { total: points, at: now }
        t.pitch[station] = points
      } else {
        t.reviews[station] = { status: "sentBack", ...record, reason: oneLine(body?.reason, SEND_BACK_REASON_MAX) }
        for (const key of ["plans", "submitted", "scores", "pitch"]) delete t[key][station]
      }
      delete state.pitches[station]
      dropFromQueues(t.id, station)
      state.architects[station] = { available: true, since: now }
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

  function endPlay(by) {
    Object.assign(state.clock, { status: "ended", endsAt: null, remainingMs: 0, endedAt: Date.now(), endedBy: by })
    state.tables = {}
  }

  /** The race uses approved tables only: everything else races on its defaults and scores 0. */
  function startRace(res, body, by) {
    if (!state.teams.length) return send(res, 400, { error: "Set up teams first" })
    const phase = phaseOf(state)
    if (phase === "play") {
      if (!body?.endClock) return send(res, 409, { error: "Play is still running. End it first, then run the race." })
      endPlay(by)
    } else if (phase !== "ended") {
      return send(res, 409, { error: "Run the race after play" })
    }
    const seed = oneLine(body?.seed, 64) || `${state.id}-${Date.now()}`
    const stations = state.settings.stations
    state.pitches = {}
    const entries = state.teams.map((t) => {
      const raced = effectiveTeam(t, stations)
      const evaluation = evaluate(raced)
      const pitch = Object.fromEntries(raced.approved.map((id) => [id, t.pitch[id] || 0]))
      return { id: t.id, name: t.name, color: t.color, pitch, missed: raced.missed, notApproved: raced.notApproved, system: systemScore(evaluation, stations), evaluation }
    })
    state.race = { seed, ranAt: Date.now(), ranBy: by, result: runRace(entries, seed, stations) }
    state.readout = null
    bump()
    return send(res, 200, publicState())
  }

  /** Pitching and approval are allowed after time if the plan was locked in before play ended. */
  function reviewBlocked(t, station) {
    const lockedInBeforeTime = state.clock.status === "ended" && !state.race && t.plans[station] && t.plans[station].at <= state.clock.endedAt
    const reason = lockReason(t, station)
    if (reason && !lockedInBeforeTime) return state.clock.status === "ended" ? "Time is up: this table was not locked in before play ended" : reason
    return null
  }

  /** Expire the brief and the play clock lazily so a restart or a sleeping Mac still keeps time. */
  function tick() {
    const now = Date.now()
    if (state.brief?.status === "running" && now >= state.brief.endsAt) {
      state.brief.status = "done"
      bump()
    }
    if (state.clock.status === "running" && now >= state.clock.endsAt) {
      endPlay("time")
      bump()
    }
  }
  const timer = setInterval(tick, 1000)
  timer.unref?.()

  /** Why a team cannot change this table right now, or null. */
  function lockReason(t, station) {
    const phase = phaseOf(state)
    if (state.race) return "The race has run: decisions are locked"
    if (phase === "brief" || phase === "briefDone") return "Listen to the brief: choices open when play starts"
    if (phase === "lobby") return "Wait for the host to start the session"
    if (phase === "ended") return "Time is up: this table is locked"
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
      const runs = t.sims[station] || { total: 0 }
      t.sims[station] = { total: runs.total + 1, lastScore: simulateStation(t, station).score, lastAt: Date.now() }
      bump()
      return send(res, 200, { ok: true, runs: t.sims[station] })
    },
    choices: (req, res, t, body) => {
      const station = body?.station
      const reason = lockReason(t, station)
      if (reason) return send(res, 409, { error: reason })
      if (station && t.plans[station]) return send(res, 409, { error: "This plan is locked in: wait for the Architect's decision" })
      const changes = body?.choices && typeof body.choices === "object" ? body.choices : {}
      const rejected = []
      for (const [key, value] of Object.entries(changes)) {
        const d = decision(key)
        if (!d || (station && d.station !== station) || !validChoice(key, value) || lockReason(t, d.station) || t.plans[d.station]) {
          rejected.push(key)
          continue
        }
        t.choices[key] = value
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
      const plan = buildPlan(t, station, { id: planId(), at: Date.now() })
      t.plans[station] = plan
      t.submitted[station] = plan.at
      bump()
      return send(res, 200, { ok: true, team: t, plan })
    },
    call: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      if (!t.plans[station]) return send(res, 409, { error: "Lock in your plan before calling the Architect" })
      if (t.reviews[station]?.status === "approved") return send(res, 409, { error: "The Architect has already approved this design" })
      const blocked = reviewBlocked(t, station)
      if (blocked) return send(res, 409, { error: blocked })
      const list = queueOf(station)
      if (!list.some((entry) => entry.team === t.id)) list.push({ team: t.id, at: Date.now() })
      bump()
      return send(res, 200, { ok: true, position: list.findIndex((entry) => entry.team === t.id) + 1, architect: state.architects[station] || { available: false } })
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
        const match = url.pathname.match(/^\/api\/teams\/([a-z0-9]{1,8})\/(checkin|sim|choices|submit|call|presence|checkout)$/)
        if (match && req.method === "POST") {
          const t = team(match[1])
          if (!t) return send(res, 404, { error: "No such team" })
          return teamRoutes[match[2]](req, res, t, body)
        }
        if (key === "GET /api/health") return send(res, 200, { ok: true, app: "podium", version: state.version, teams: state.teams.length, phase: phaseOf(state), pid: process.pid })
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
    console.log(`[podium] Projector    ${base}/race.html`)
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
      console.log(`[podium] Rehearsal defaults in use for ${defaults.join(", ")} (host ${DEFAULT_PINS.host}, Architect ${DEFAULT_PINS.leader}, race ${DEFAULT_PINS.race}). Set them before a real event.`)
    }
  })
}
