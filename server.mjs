/**
 * Podium game server: serves the iPad app and keeps one shared game state.
 * No dependencies. `node server.mjs` (localhost) or `node server.mjs --lan` (every iPad on the Wi-Fi).
 *
 * Env: PORT (8080), HOST_PIN, LEADER_PIN (the Solutions Architect PIN), RACE_PIN, DATA_DIR (./data).
 * Every PIN defaults to SKO27; PIN values are never logged.
 */
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs"
import { join, normalize, extname, dirname, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { networkInterfaces } from "node:os"
import { randomUUID, randomInt, timingSafeEqual, createHash } from "node:crypto"
import { STATIONS, TEAM_COLORS, SESSION, BUDGET_LEVELS, DEFAULT_BUDGET, MAX_TEAMS, MIN_TEAMS, validChoice, decision, decisionsFor, tablePoints } from "./public/js/catalog.js"
import { evaluate, effectiveTeam, boardFor, choicesOf } from "./public/js/model.js"
import { runRace, systemScore } from "./public/js/race.js"
import { buildPlan } from "./public/js/plandata.js"
import { PITCH_MS, REJECT_REASON_MAX, lockedDials } from "./public/js/approval.js"
import { phaseOf } from "./public/js/session.js"

const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(ROOT, "public")
const MAX_BODY = 64 * 1024
const STATION_IDS = STATIONS.map((s) => s.id)

/** One PIN for the host, the Solutions Architects and the race password. Override with HOST_PIN, LEADER_PIN, RACE_PIN. */
export const DEFAULT_PINS = { host: "SKO27", leader: "SKO27", race: "SKO27" }
export const PIN_NAMES = { host: "HOST_PIN", leader: "LEADER_PIN", race: "RACE_PIN" }
/**
 * The PINs in force: the environment, then the defaults. Nothing else (in particular nothing in the
 * saved game) can set a PIN. Values are never logged: only which names came from the environment.
 */
export const resolvePins = (env = process.env) => Object.fromEntries(Object.entries(PIN_NAMES).map(([key, name]) => [key, String(env[name] || DEFAULT_PINS[key])]))
export const pinSummary = (env = process.env) => Object.entries(PIN_NAMES).map(([key, name]) => `${name} (${env[name] ? "from the environment" : "default"})`).join(", ")
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

const budgetOf = (value) => (BUDGET_LEVELS.some((b) => b.id === value) ? value : DEFAULT_BUDGET)

/** Phase lengths and the session's budget level (one budget for every team). */
function sessionSettings(source = {}) {
  return { ...Object.fromEntries(PHASE_KEYS.map((key) => [key, clampMinutes(source[key], SESSION[key])])), budget: budgetOf(source.budget) }
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
const STEPS = ["brief", "tune", "pitch"]
const TEAM_KEYS = ["choices", "touched", "submitted", "scores", "pitch", "visits", "sims", "plans", "reviews", "briefRead", "attempts", "previous"]
const dialIds = (station) => decisionsFor(station).map((d) => d.id)

function makeTeams(list) {
  return list.slice(0, MAX_TEAMS).map((item, i) => ({
    id: `t${i + 1}`,
    name: oneLine(item?.name, 32) || `Team ${i + 1}`,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
    ...Object.fromEntries(TEAM_KEYS.map((key) => [key, {}])),
  }))
}

/**
 * Bring a saved team up to the one-shot model: every choice is a lock, three locks make a plan
 * (attempt 1), old send-back reviews become "rejected", and a table the team has already played
 * counts as a read brief so play can carry on after an upgrade.
 */
function migrateTeam(team, budget) {
  for (const key of TEAM_KEYS) team[key] = team[key] && typeof team[key] === "object" ? team[key] : {}
  for (const [key, value] of Object.entries(team.choices)) if (!validChoice(key, value)) delete team.choices[key]
  for (const [id, plan] of Object.entries(team.plans)) if (!plan?.board || !STATION_IDS.includes(id)) delete team.plans[id]
  for (const station of STATION_IDS) {
    const review = team.reviews[station]
    if (review?.status === "sentBack") review.status = "rejected"
    const plan = team.plans[station]
    /* An old lock-in filled unchosen dials with today's setup: in the one-shot game those count as locked too. */
    if (plan) for (const [key, value] of Object.entries(plan.choices || {})) if (team.choices[key] === undefined && validChoice(key, value)) team.choices[key] = value
    const locked = lockedDials(team, station)
    if (!plan && review?.status !== "approved" && locked.length === dialIds(station).length) {
      const at = team.submitted[station] || team.touched[station] || Date.now()
      team.plans[station] = buildPlan(team, station, { id: planId(), at, budget })
      team.submitted[station] = at
    }
    if ((team.plans[station] || review) && !team.attempts[station]) team.attempts[station] = review?.status === "rejected" && team.plans[station] ? 2 : 1
    if (review && !review.attempt) review.attempt = review.status === "rejected" ? 1 : team.attempts[station]
    if (!team.briefRead[station] && (team.touched[station] || team.plans[station] || review || locked.length)) team.briefRead[station] = team.touched[station] || Date.now()
  }
  delete team.architect
  delete team.rank
  delete team.tier
}

/** Load the saved game; a damaged file is kept aside rather than silently replaced. */
function loadState(file) {
  if (!existsSync(file)) return blankState()
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.teams)) throw new Error("not a Podium state file")
    const base = blankState()
    const stations = (saved.settings?.stations || []).filter((id) => STATION_IDS.includes(id))
    /* Only the game's own keys are loaded: a stray key in the file (say `pins`) never reaches the state or the clients. */
    const loaded = {
      id: typeof saved.id === "string" && saved.id ? saved.id : base.id,
      version: Number.isInteger(saved.version) && saved.version > 0 ? saved.version : base.version,
      settings: { ...sessionSettings(saved.settings), stations: stations.length ? stations : [...STATION_IDS] },
      brief: saved.brief || base.brief,
      clock: { ...base.clock, ...saved.clock },
      readout: saved.readout || null,
      tables: saved.tables || {},
      queues: saved.queues || {},
      architects: saved.architects || {},
      pitches: saved.pitches || {},
      teams: saved.teams.filter((team) => team && typeof team === "object"),
      race: saved.race || null,
    }
    for (const team of loaded.teams) migrateTeam(team, loaded.settings.budget)
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

/** `env` is the process environment (tests pass their own); PINs come from it or the defaults, never from the saved game. */
export function createApp({ dataDir = join(ROOT, "data"), env = process.env } = {}) {
  const { host: hostPin, leader: architectPin, race: racePin } = resolvePins(env)
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
   * Why this request may not act as the Solutions Architect (SA) of `station`, or null. The host may
   * act for any table; an SA only for the table chosen at login (sent as the x-station header).
   */
  const architectBlocked = (req, station) => {
    if (!STATION_IDS.includes(station)) return [400, "Unknown table"]
    if (isHost(req)) {
      clearPinFailures(req)
      return null
    }
    if (!isArchitect(req)) {
      failedPin(req)
      return [403, "SA PIN required"]
    }
    if (req.headers["x-station"] !== station) return [403, "You are signed in as the Solutions Architect of another table"]
    clearPinFailures(req)
    return null
  }
  const architectTitle = (station) => STATIONS.find((s) => s.id === station)?.architect || "Solutions Architect"
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
      const station = typeof body?.station === "string" ? body.station : ""
      /* A login that names a table is a Solutions Architect signing in: with one event PIN for every role, the table decides the view. */
      if (station && sameSecret(pin, architectPin)) {
        if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Pick the table you are the Solutions Architect for" })
        clearPinFailures(req)
        return send(res, 200, { role: "architect", station })
      }
      if (sameSecret(pin, hostPin)) {
        clearPinFailures(req)
        return send(res, 200, { role: "host" })
      }
      if (sameSecret(pin, architectPin)) return send(res, 400, { error: "Pick the table you are the Solutions Architect for" })
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
      if (available && state.pitches[station]) return send(res, 409, { error: "A pitch is running: approve or reject it first" })
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
      if (!t.plans[station]) return send(res, 409, { error: "This team has not locked all three choices here" })
      if (t.reviews[station]?.status === "approved") return send(res, 409, { error: "This design is already approved" })
      const lockout = reviewBlocked(t, station)
      if (lockout) return send(res, 409, { error: lockout })
      state.pitches[station] = { team: t.id, startedAt: now, endsAt: now + PITCH_MS, by: oneLine(body?.by, 40) || architectTitle(station), attempt: t.attempts[station] || 1 }
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
      if (!["approve", "reject"].includes(verdict)) return send(res, 400, { error: "Approve or reject" })
      const plan = t.plans[station]
      if (!plan) return send(res, 409, { error: "This team has not locked all three choices here" })
      const lockout = reviewBlocked(t, station)
      if (lockout) return send(res, 409, { error: lockout })
      const now = Date.now()
      const attempt = t.attempts[station] || 1
      const record = { by: oneLine(body?.by, 40) || live.by || architectTitle(station), at: now, startedAt: live.startedAt, durationMs: now - live.startedAt, planId: plan.id, fit: plan.fit, inZone: plan.inZone, attempt }
      if (verdict === "approve") {
        const points = tablePoints(plan.fit, true)
        t.reviews[station] = { status: "approved", ...record, points }
        t.scores[station] = { total: points, at: now }
        t.pitch[station] = points
      } else {
        // Reject reopens this team's dials at this table only: the picks become "last time" ghosts.
        t.reviews[station] = { status: "rejected", ...record, reason: oneLine(body?.reason, REJECT_REASON_MAX) }
        t.previous[station] = Object.fromEntries(lockedDials(t, station).map((id) => [id, t.choices[id]]))
        for (const id of dialIds(station)) delete t.choices[id]
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

  /** The race uses approved tables only: everything else races on the customer's existing setup and scores 0. */
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
      const evaluation = evaluate(raced, state.settings.budget, stations)
      const pitch = Object.fromEntries(raced.approved.map((id) => [id, t.pitch[id] || 0]))
      return { id: t.id, name: t.name, color: t.color, pitch, missed: raced.missed, notApproved: raced.notApproved, system: systemScore(evaluation, stations), seconds: evaluation.secondsTotal, evaluation }
    })
    state.race = { seed, ranAt: Date.now(), ranBy: by, budget: state.settings.budget, result: runRace(entries, seed, stations) }
    state.readout = null
    bump()
    return send(res, 200, publicState())
  }

  /** Pitching and approval are allowed after time if all three choices were locked before play ended. */
  function reviewBlocked(t, station) {
    const lockedInBeforeTime = state.clock.status === "ended" && !state.race && t.plans[station] && t.plans[station].at <= state.clock.endedAt
    const reason = lockReason(t, station)
    if (reason && !lockedInBeforeTime) return state.clock.status === "ended" ? "Time is up: this table's three choices were not locked before play ended" : reason
    return null
  }

  /** Three locked dials make the table's plan: the design the team pitches. Each plan is one attempt. */
  function lockTable(t, station) {
    const plan = buildPlan(t, station, { id: planId(), at: Date.now(), budget: state.settings.budget })
    t.plans[station] = plan
    t.submitted[station] = plan.at
    t.attempts[station] = (t.attempts[station] || 0) + 1
    return plan
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
    if (phase === "brief" || phase === "briefDone") return "Read the brief: choices open when the host starts play"
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
      const board = boardFor(station, choicesOf(t), state.settings.budget)
      t.sims[station] = { total: runs.total + 1, lastFit: board.fit, lastSeconds: board.seconds, inZone: board.inZone, firstZoneAt: runs.firstZoneAt || (board.inZone ? Date.now() : null), lastAt: Date.now() }
      bump()
      return send(res, 200, { ok: true, runs: t.sims[station] })
    },
    brief: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      if (!t.briefRead[station]) {
        t.briefRead[station] = Date.now()
        bump()
      }
      return send(res, 200, { ok: true, team: t, version: state.version })
    },
    /**
     * One-shot choices: the first tap on a dial locks it. The server accepts each dial once and
     * refuses anything else with a clear 409: a dial already locked, a table whose three dials are
     * locked (or approved), or a brief that has not been read. The third lock builds the plan at
     * once, so the only thing left is to call the SA. A mixed batch (some accepted, some refused)
     * answers 207 with the reason per key.
     */
    choices: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      const reason = lockReason(t, station)
      if (reason) return send(res, 409, { error: reason })
      const changes = body?.choices && typeof body.choices === "object" ? body.choices : {}
      const rejected = []
      const reasons = {}
      const refuse = (key, why) => {
        rejected.push(key)
        reasons[key] = why
      }
      let changed = false
      for (const [key, value] of Object.entries(changes)) {
        const d = decision(key)
        if (!d || d.station !== station || !validChoice(key, value)) refuse(key, "That is not a setting on this table")
        else if (!t.briefRead[station]) refuse(key, "Read the brief first, then tap \u201cI\u2019ve read the brief\u201d to open the decisions")
        else if (t.reviews[station]?.status === "approved") refuse(key, "The Solutions Architect has approved this design: it cannot change")
        else if (t.plans[station]) refuse(key, "All three choices are locked: call the Solutions Architect")
        else if (t.choices[key] !== undefined) refuse(key, "That choice is locked: one tap decides it, and only a rejection by the Solutions Architect reopens it")
        else {
          t.choices[key] = value
          t.touched[station] = Date.now()
          changed = true
        }
      }
      if (changed && !t.plans[station] && lockedDials(t, station).length === dialIds(station).length) lockTable(t, station)
      if (changed) bump()
      const payload = { ok: changed, rejected, reasons, locked: lockedDials(t, station), plan: t.plans[station] || null, attempts: t.attempts[station] || 0, team: t, version: state.version }
      if (rejected.length && !changed) return send(res, 409, { ...payload, error: reasons[rejected[0]] })
      return send(res, rejected.length ? 207 : 200, payload)
    },
    call: (req, res, t, body) => {
      const station = body?.station
      if (!STATION_IDS.includes(station)) return send(res, 400, { error: "Unknown table" })
      if (!t.plans[station]) return send(res, 409, { error: "Lock all three choices before calling the Solutions Architect" })
      if (t.reviews[station]?.status === "approved") return send(res, 409, { error: "The Solutions Architect has already approved this design" })
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
        const match = url.pathname.match(/^\/api\/teams\/([a-z0-9]{1,8})\/(checkin|brief|sim|choices|call|presence|checkout)$/)
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
    console.log(`[podium] PINs in use: ${pinSummary()}. Values are never printed (the default is the event PIN in the README).`)
  })
}
