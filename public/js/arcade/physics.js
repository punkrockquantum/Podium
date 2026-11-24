/**
 * Arcade car physics: pure functions, no DOM, deterministic for a given input sequence and seed.
 *
 * The car is a point with a heading and a velocity vector. Steering turns the heading; the tyres pull
 * the velocity back behind the heading at up to `grip` m/s² of lateral acceleration, so asking for
 * more yaw than the grip can follow (fast corner, full lock) leaves lateral velocity behind: a slide.
 * Off the asphalt the grass halves the grip and drags hard; the outer boundary is a soft wall.
 * Laps are detected by three gates (sector 1 line, sector 2 line, start/finish) passed in order, so a
 * shortcut never counts. Times are interpolated inside the step, so a lap time is good to about 1 ms.
 *
 * The plan's advantage enters through `carParams(spec)`:
 *   computation  secondsPerLapVsToday → aero efficiency: grip, top speed and acceleration
 *   connectivity dataToDecisionS      → boost recharge time and the pit-wall assist's horizon and precision
 *   reliability  availabilityPct      → the rate of "telemetry glitch" power dips
 */
import { crossed, crossFraction, LAP_M } from "./track.js"

export const DT = 1 / 120

/** Tuning for the "Today" car (aero 0 %). ASSUMPTION: arcade values chosen for a ~60 s lap at AI pace. */
export const BASE = Object.freeze({
  maxSpeed: 84, // m/s on the flat (≈ 302 km/h)
  accel: 23, // m/s² at rest; falls with (v / maxSpeed)² like an engine at the drag limit
  brake: 34, // m/s²
  grip: 27, // m/s² of lateral acceleration before the car slides
  coast: 1.6, // m/s² rolling resistance
  dragK: 0.0012, // m/s² per (m/s)² of aerodynamic drag when coasting
  steerLow: 2.3, // rad/s of yaw available at walking pace
  steerOver: 1.22, // full lock asks for this multiple of the grip: > 1 lets the car slide
  reverseMax: 10,
  grassGrip: 0.42,
  grassDrag: 2.5, // m/s² constant drag on grass (a car at rest can still pull away)
  grassDragK: 0.012, // caps the grass speed near 22 m/s with the throttle down
  grassPower: 0.45,
  wallBounce: 0.25,
  wallSpeedKeep: 0.72,
  slideThreshold: 3, // m/s of lateral velocity counts as a slide (tyre marks)
  slideScrub: 0.35, // forward speed lost per m/s of lateral velocity, per second
})
export const CAR_SIZE = Object.freeze({ length: 5, width: 2.3, radius: 2 })

/** Model seconds per lap → aero efficiency percent (ASSUMPTION: 0.39 s/lap of the plan ≈ +12 % aero in the game). */
export const AERO_PCT_PER_SECOND = 30
/** Expected glitches per second = share of unavailability × this (0.6 % → about 1.2 glitches a lap). */
export const GLITCH_GAIN = 3.3

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const finite = (x, fallback) => (Number.isFinite(x) ? x : fallback)
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d

/**
 * Game parameters from a car spec (the planning tool's hand-off: season, label, secondsPerLapVsToday,
 * effectiveMauh, allowanceUsedPct, availabilityPct, dataToDecisionS, location).
 */
export function carParams(spec = {}) {
  const adv = clamp(finite(Number(spec.secondsPerLapVsToday), 0), -1, 1)
  const loop = clamp(finite(Number(spec.dataToDecisionS), 6.3), 2, 12)
  const avail = clamp(finite(Number(spec.availabilityPct), 99.4), 90, 100)
  const aeroPct = round(adv * AERO_PCT_PER_SECOND, 1)
  const aero = 1 + aeroPct / 100
  return {
    aeroPct,
    grip: BASE.grip * aero,
    maxSpeed: BASE.maxSpeed * (1 + 0.35 * (aero - 1)),
    accel: BASE.accel * (1 + 0.5 * (aero - 1)),
    brake: BASE.brake * (1 + 0.3 * (aero - 1)),
    boostRechargeS: round(1.1 * loop, 1),
    boostDurationS: 3,
    boostAccel: 14, // m/s² on top of the engine while boosting, up to the raised cap
    boostSpeed: 1.15,
    assistHorizonS: round(clamp(14 / loop, 1.5, 3.5), 1),
    assistJitterM: round(Math.max(0, loop - 4.5) * 3, 1),
    glitchPerS: round(((100 - avail) / 100) * GLITCH_GAIN, 5),
    glitchS: 1.2,
    glitchPower: 0.35,
    secondsPerLapVsToday: adv,
    dataToDecisionS: loop,
    availabilityPct: avail,
  }
}

/** The fastest lap the physics allows (top speed, max aero and boost for the whole lap) and a generous ceiling. */
export const PLAUSIBLE_LAP_MS = Object.freeze({
  min: Math.floor((LAP_M / (BASE.maxSpeed * (1 + 0.35 * 0.25) * 1.15)) * 1000),
  max: 10 * 60_000,
})

/** A car at rest. `raceLaps` is how many laps complete the race for it. */
export function createCar({ id, name, short = "", color = "#e10600", params = carParams(), x = 0, y = 0, heading = 0, isPlayer = false, raceLaps = 3 }) {
  return {
    id, name, short, color, params, isPlayer, raceLaps,
    x, y, heading, vx: 0, vy: 0, speed: 0, lateral: 0,
    steer: 0, throttle: 0, brake: 0,
    onGrass: false, sliding: false, wallHit: false, bumped: false,
    boost: 1, boostT: 0, boosting: false, boostsUsed: 0,
    glitchT: 0, glitches: 0,
    s: 0, segHint: -1, dist: 0, progress: 0,
    lap: 1, crossings: 0, nextGate: 0, lapStartT: 0, sectorStartT: 0,
    sectorsMs: [null, null, null], lastSectorsMs: [null, null, null], bestSectorsMs: [null, null, null],
    lastLapMs: null, bestLapMs: null, bestLapSectorsMs: null, laps: [],
    finished: false, finishT: null,
    events: [],
  }
}

/** Put a car on the track at lap fraction `s`, `off` metres to the right of the centreline, facing forward. */
export function placeCar(car, track, s, off = 0) {
  const p = track.at(s, off)
  car.x = p.x
  car.y = p.y
  car.heading = p.heading
  car.vx = car.vy = car.speed = car.lateral = 0
  const loc = track.locate(car.x, car.y)
  car.s = loc.s
  car.segHint = loc.i
  car.dist = loc.dist
  return car
}

/** Re-derive forward and lateral speed from the velocity vector after an external change. */
export function syncFrame(car) {
  const fx = Math.cos(car.heading)
  const fy = Math.sin(car.heading)
  car.speed = car.vx * fx + car.vy * fy
  car.lateral = -car.vx * fy + car.vy * fx
}

/**
 * One fixed step. `input` is { throttle, brake, steer (−1 left … +1 right), boost }; `t` is the race
 * time at the end of the step; `rng` (0..1) decides telemetry glitches, or null for none.
 */
export function stepCar(car, input, track, dt = DT, t = 0, rng = null) {
  const P = car.params
  const throttle = clamp(finite(input.throttle, 0), 0, 1)
  const brake = clamp(finite(input.brake, 0), 0, 1)
  const steerIn = clamp(finite(input.steer, 0), -1, 1)
  car.throttle = throttle
  car.brake = brake
  car.steer += clamp(steerIn - car.steer, -9 * dt, 9 * dt)

  if (input.boost && car.boostT <= 0 && car.boost >= 1) {
    car.boostT = P.boostDurationS
    car.boost = 0
    car.boostsUsed += 1
    car.events.push({ type: "boost" })
  }
  car.boosting = car.boostT > 0
  if (car.boosting) car.boostT -= dt
  else car.boost = Math.min(1, car.boost + dt / P.boostRechargeS)

  if (car.glitchT > 0) car.glitchT -= dt
  else if (rng && P.glitchPerS > 0 && rng() < P.glitchPerS * dt) {
    car.glitchT = P.glitchS
    car.glitches += 1
    car.events.push({ type: "glitch" })
  }
  const glitching = car.glitchT > 0

  const here = track.locate(car.x, car.y, car.segHint)
  car.onGrass = Math.abs(here.dist) > (track.gripHalfWidth ?? track.halfWidth)
  const grip = P.grip * (car.onGrass ? BASE.grassGrip : 1)
  const maxSpeed = P.maxSpeed * (car.boosting ? P.boostSpeed : 1)

  const v = car.speed
  const yawMax = Math.min(BASE.steerLow, (BASE.steerOver * grip) / Math.max(Math.abs(v), 1))
  const yaw = car.steer * yawMax * (v < 0 ? -1 : 1) * Math.min(1, Math.abs(v) / 3)
  car.heading += yaw * dt
  if (car.heading > Math.PI) car.heading -= 2 * Math.PI
  else if (car.heading < -Math.PI) car.heading += 2 * Math.PI

  const fx = Math.cos(car.heading)
  const fy = Math.sin(car.heading)
  const rx = -fy
  const ry = fx
  let vf = car.vx * fx + car.vy * fy
  let vl = car.vx * rx + car.vy * ry

  const gripStep = grip * dt
  if (Math.abs(vl) <= gripStep) vl = 0
  else vl -= Math.sign(vl) * gripStep
  car.sliding = Math.abs(vl) > BASE.slideThreshold && !car.onGrass
  if (Math.abs(vl) > 0.5 && vf !== 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), BASE.slideScrub * Math.abs(vl) * dt)

  /* Drag is already inside the power envelope (top speed is where it balances the engine); lifting off adds engine braking and air. */
  const coasting = throttle === 0 ? BASE.coast + BASE.dragK * vf * vf : 0
  const resist = coasting + (car.onGrass ? BASE.grassDrag + BASE.grassDragK * vf * vf : 0)
  const reverseGear = vf < -0.01 || (vf < 0.05 && brake > 0 && throttle === 0)
  if (reverseGear) {
    const a = -brake * 8 + throttle * P.brake + (vf < 0 ? BASE.coast + resist : 0)
    vf = Math.max(-BASE.reverseMax, vf + a * dt)
    if (vf > 0) vf = 0
  } else {
    const power = throttle * P.accel * (glitching ? P.glitchPower : 1) * (car.onGrass ? BASE.grassPower : 1)
    /* Negative above the cap: drag wins and a car coming off the boost eases back to its top speed. */
    const envelope = 1 - (Math.max(vf, 0) / maxSpeed) ** 2
    const kick = car.boosting && !car.onGrass && vf < maxSpeed ? P.boostAccel * (glitching ? P.glitchPower : 1) : 0
    const a = power * envelope + kick - brake * P.brake - resist
    vf += a * dt
    if (vf < 0) vf = 0
  }

  car.vx = vf * fx + vl * rx
  car.vy = vf * fy + vl * ry
  car.x += car.vx * dt
  car.y += car.vy * dt
  car.speed = vf
  car.lateral = vl

  let loc = track.locate(car.x, car.y, here.i)
  car.wallHit = false
  if (Math.abs(loc.dist) > track.wallDist) {
    const side = Math.sign(loc.dist)
    const nx = -track.ty[loc.i] * side
    const ny = track.tx[loc.i] * side
    const over = Math.abs(loc.dist) - track.wallDist
    car.x -= nx * over
    car.y -= ny * over
    const vn = car.vx * nx + car.vy * ny
    if (vn > 0) {
      car.vx = (car.vx - (1 + BASE.wallBounce) * vn * nx) * BASE.wallSpeedKeep
      car.vy = (car.vy - (1 + BASE.wallBounce) * vn * ny) * BASE.wallSpeedKeep
      car.wallHit = true
      car.events.push({ type: "wall" })
    }
    syncFrame(car)
    loc = track.locate(car.x, car.y, loc.i)
  }

  const prevS = car.s
  car.s = loc.s
  car.segHint = loc.i
  car.dist = loc.dist
  if (!car.finished) checkGates(car, prevS, car.s, track, t, dt)
  car.progress = car.crossings + car.s - (car.s > 0.5 && car.nextGate === 0 ? 1 : 0)
  return car
}

/** Sector gates in order: S1 line, S2 line, start/finish. A gate out of order (a shortcut) is ignored. */
function checkGates(car, prevS, nowS, track, t, dt) {
  const k = car.nextGate
  const gate = track.gates[k]
  if (!crossed(prevS, nowS, gate)) return
  if (Math.abs(car.dist) > track.wallDist + 2) return
  const when = t - dt + crossFraction(prevS, nowS, gate) * dt
  const sectorMs = Math.round((when - car.sectorStartT) * 1000)
  car.sectorsMs[k] = sectorMs
  car.sectorStartT = when
  if (k === 2) {
    car.crossings += 1
    const lapMs = Math.round((when - car.lapStartT) * 1000)
    car.lastLapMs = lapMs
    car.laps.push(lapMs)
    car.lastSectorsMs = [...car.sectorsMs]
    if (car.bestLapMs === null || lapMs < car.bestLapMs) {
      car.bestLapMs = lapMs
      car.bestLapSectorsMs = [...car.sectorsMs]
    }
    for (let i = 0; i < 3; i++) if (car.sectorsMs[i] !== null && (car.bestSectorsMs[i] === null || car.sectorsMs[i] < car.bestSectorsMs[i])) car.bestSectorsMs[i] = car.sectorsMs[i]
    car.sectorsMs = [null, null, null]
    car.lapStartT = when
    car.events.push({ type: "lap", lap: car.lap, lapMs })
    if (car.lap >= car.raceLaps) {
      car.finished = true
      car.finishT = when
      car.events.push({ type: "finish", at: when })
    } else car.lap += 1
  } else car.events.push({ type: "sector", sector: k + 1, ms: sectorMs })
  car.nextGate = (k + 1) % 3
}

/** Push two overlapping cars apart and trade the closing speed (a little is lost). True when they touched. */
export function resolveCollision(a, b, restitution = 0.3, loss = 0.012) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  const minD = 2 * CAR_SIZE.radius
  if (d2 >= minD * minD) return false
  const d = Math.sqrt(d2) || 1e-6
  const nx = d2 === 0 ? 1 : dx / d
  const ny = d2 === 0 ? 0 : dy / d
  const over = minD - d
  a.x -= (nx * over) / 2
  a.y -= (ny * over) / 2
  b.x += (nx * over) / 2
  b.y += (ny * over) / 2
  const rel = a.vx * nx + a.vy * ny - (b.vx * nx + b.vy * ny)
  if (rel > 0) {
    const j = ((1 + restitution) * rel) / 2
    a.vx = (a.vx - j * nx) * (1 - loss)
    a.vy = (a.vy - j * ny) * (1 - loss)
    b.vx = (b.vx + j * nx) * (1 - loss)
    b.vy = (b.vy + j * ny) * (1 - loss)
  }
  syncFrame(a)
  syncFrame(b)
  a.bumped = b.bumped = true
  return true
}

/** m/s → the HUD's km/h. */
export const kmh = (ms) => Math.max(0, Math.round(ms * 3.6))

/** 83456 → "1:23.456"; null → "--:--.---". */
export function formatMs(ms) {
  if (!Number.isFinite(ms) || ms === null) return "--:--.---"
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const frac = Math.floor(ms % 1000)
  return `${m}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`
}

/** Seeded random (mulberry32): deterministic races in tests. */
export function seededRandom(seed) {
  let a = (Number(seed) || 1) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
