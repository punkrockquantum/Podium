/**
 * Rival drivers: pure functions, no DOM.
 *
 * Each driver follows the track's racing line with pure pursuit and a curvature-based speed profile
 * (corner speed from the car's grip, braking and acceleration passes around the lap). `skill` scales
 * the cornering limit it dares to use. Overtaking is a lane change to the freer side of a slower car
 * ahead; defending is implicit (a lead car holds its line; collisions push apart).
 *
 * Rubber band (documented in docs/audi-f1-arcade.md): a rival more than 8 s ahead of the player eases
 * off by up to 6 %, so a slow driver still has cars to fight. Nothing is ever sped up: a good lap is a
 * good lap. The race manager sets `driver.rubber`; the calibration runs leave it at 1.
 */
import { BASE } from "./physics.js"
import { forwardDelta } from "./track.js"

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

/** Target speed at every polyline point for a car with these params, driven at this skill (0..1). */
export function speedProfile(track, params, skill = 1) {
  const n = track.n
  const ds = track.spacing
  const gripEff = params.grip * skill * skill
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) v[i] = Math.min(params.maxSpeed * 0.995, Math.sqrt(gripEff / Math.max(Math.abs(track.lineCurv[i]), 1e-4)))
  const brake = params.brake * 0.85 * skill
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {
      const i = k % n
      const j = (i + 1) % n
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds))
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const i = k % n
      const j = (i + 1) % n
      const a = Math.max(0.5, params.accel * Math.max(0.05, 1 - (v[i] / params.maxSpeed) ** 2))
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * a * ds))
    }
  }
  return v
}

/** The lap a car would drive at exactly its profile, in seconds (a calibration aid). */
export function lapEstimate(track, profile) {
  let t = 0
  for (let i = 0; i < track.n; i++) t += track.spacing / Math.max(profile[i], 1)
  return t
}

/** True when the racing line stays straighter than `maxCurv` for the next `metres` from point i. */
export function straightAhead(track, i, metres, maxCurv) {
  const span = Math.round(metres / track.spacing)
  for (let q = 0; q < span; q += 2) if (Math.abs(track.lineCurv[(i + q) % track.n]) > maxCurv) return false
  return true
}

export function createDriver({ skill = 0.9, lane = 0, useBoost = false, reaction = 0 } = {}) {
  return { skill, lane, laneTarget: lane, overtakeT: 0, rubber: 1, useBoost, profile: null, slowT: 0, reverseT: 0, reaction }
}

export function prepareDriver(driver, track, car) {
  driver.profile = speedProfile(track, car.params, driver.skill)
  return driver
}

/**
 * The driver's input for this step. `cars` are every car in the race (the driver skips its own).
 * Pure pursuit: the lookahead point on the racing line (plus lane offset) gives the curvature we need;
 * the steering is the share of the yaw the car can deliver at this speed, capped at the grip so the
 * AI never slides on purpose.
 */
export function driveAI(driver, car, track, cars, dt) {
  if (!driver.profile) prepareDriver(driver, track, car)
  const n = track.n
  const ds = track.spacing
  const v = Math.max(car.speed, 0)
  const i = car.segHint >= 0 ? car.segHint : track.locate(car.x, car.y).i
  const P = car.params

  /* Reaction time at the lights: the grid pulls away staggered rather than as one block. */
  if (driver.reaction > 0) {
    driver.reaction -= dt
    return { throttle: 0, brake: 1, steer: 0, boost: false }
  }
  /* Stuck (boxed in, nosed into the wall): back out for a second, then go again. */
  if (!car.finished && v < 2 && car.throttle > 0.3) driver.slowT += dt
  else driver.slowT = 0
  if (driver.slowT > 2.5) {
    driver.reverseT = 1.1
    driver.slowT = 0
  }
  if (driver.reverseT > 0) {
    driver.reverseT -= dt
    return { throttle: 0, brake: 1, steer: -car.steer, boost: false }
  }

  /*
   * Traffic: the nearest car ahead in our lane is the blocker; a car beside us is a neighbour. Side
   * by side, both hold the edge away from each other (the defender makes room, the attacker holds
   * its line); a slower blocker within reach triggers a lane change to its freer side.
   */
  driver.overtakeT = Math.max(0, driver.overtakeT - dt)
  const room = track.halfWidth - 3.6
  let blocker = null
  let blockerSpeed = Infinity
  let blockerGap = Infinity
  let blockerLat = 0
  let neighbour = null
  for (const other of cars) {
    if (other === car) continue
    const gap = forwardDelta(car.s, other.s) * track.length
    const lateral = other.dist - car.dist
    const absLat = Math.abs(lateral)
    if (v > 10 && gap > -5.5 && gap < 5.5 && absLat > 2.6 && absLat < 6.5) neighbour = { other, lateral }
    /* Close up, cars converge on the same line, so a wider band counts as "in my lane". */
    if (gap <= 0 || gap > 32 || absLat > 4.2 + Math.max(0, 12 - gap) * 0.2) continue
    if (gap < blockerGap) {
      blockerGap = gap
      blockerSpeed = other.speed
      blockerLat = absLat
      blocker = other
    }
  }
  /* Passing is for the straights: in the twisty bits the car follows on the racing line. */
  const canPass = straightAhead(track, i, 90, 1 / 220)
  if (neighbour) {
    driver.laneTarget = neighbour.lateral > 0 ? -room : room
    driver.overtakeT = Math.max(driver.overtakeT, 0.8)
  } else if (blocker && canPass && driver.overtakeT <= 0 && blockerSpeed < v - 0.5 && blockerGap < 26) {
    driver.laneTarget = blocker.dist > 0 ? -room : room
    driver.overtakeT = 3
  }
  if (driver.overtakeT <= 0) driver.laneTarget = 0
  driver.lane += clamp(driver.laneTarget - driver.lane, -5 * dt, 5 * dt)
  const committed = driver.overtakeT > 0 && Math.abs(driver.lane) > 2.5

  const look = clamp(8 + v * 0.42, 10, 52)
  const k = Math.max(1, Math.round(look / ds))
  const j = (i + k) % n
  const limit = track.halfWidth - 1.8
  const off = driver.lane === 0 ? track.lineOff[j] : clamp(track.lineOff[j] * (1 - Math.abs(driver.lane) / limit) + driver.lane, -limit, limit)
  const txp = track.xs[j] + -track.ty[j] * off
  const typ = track.ys[j] + track.tx[j] * off
  const L = Math.hypot(txp - car.x, typ - car.y) || 1
  let alpha = Math.atan2(typ - car.y, txp - car.x) - car.heading
  while (alpha > Math.PI) alpha -= 2 * Math.PI
  while (alpha < -Math.PI) alpha += 2 * Math.PI
  const grip = P.grip * (car.onGrass ? BASE.grassGrip : 1)
  const yawMax = Math.min(BASE.steerLow, (BASE.steerOver * grip) / Math.max(v, 1))
  const wantYaw = v > 2 ? (v * 2 * Math.sin(alpha)) / L : alpha * 2
  const noSlide = v > 2 ? grip / v / yawMax : 1
  const steer = clamp(wantYaw / yawMax, -noSlide, noSlide)

  /*
   * Speed: the tightest of the profile's limits within braking reach of the current speed, so a car
   * arriving faster than its profile (boost, a tow, a bump) still brakes in time for the corner.
   */
  const brakeEff = P.brake * 0.85 * driver.skill
  const reach = Math.min(n - 1, Math.ceil((v * v) / (2 * brakeEff * ds)) + 2)
  const flatOut = P.maxSpeed * 0.99
  /* Off the racing line the corner radius differs: inside is tighter, outside wider. */
  const offLine = Math.abs(car.dist - track.lineOff[i]) > 0.6 ? Math.sqrt(Math.min(1, Math.max(0.5, 1 - track.lineCurv[i] * (car.dist - track.lineOff[i])))) : 1
  let target = car.boosting ? P.maxSpeed * P.boostSpeed : driver.profile[i] * driver.rubber * offLine
  for (let q = 1; q <= reach; q++) {
    const limit = driver.profile[(i + q) % n] * driver.rubber * offLine
    if (car.boosting && limit >= flatOut) continue
    const allowed = Math.sqrt(limit * limit + 2 * brakeEff * q * ds)
    if (allowed < target) target = allowed
  }
  /* Already offset beside the car ahead (committed to a pass, or boosting past): it no longer holds us up. */
  const clear = (committed || car.boosting) && blockerLat > 3.2
  if (blocker && blockerGap < 24 && !clear) {
    /* Keep the stopping distance to the car ahead; sit 4 % under its speed when boxed in. */
    const closing = blockerSpeed + Math.sqrt(2 * brakeEff * Math.max(0, blockerGap - 5.5))
    target = Math.min(target, closing)
    if (blockerGap < 9 && !car.boosting && !committed) target = Math.min(target, Math.max(blockerSpeed * 0.96, blockerSpeed - 2))
  }
  let throttle = 0
  let brake = 0
  if (v > target + 0.4) brake = clamp((v - target) / 5, 0.25, 1)
  else throttle = clamp((target - v) / 3 + 0.35, 0.35, 1)
  if (car.onGrass) throttle = Math.min(throttle, 0.6)
  if (car.finished) {
    throttle = 0
    brake = v > 25 ? 0.3 : 0
  }

  let boost = false
  if (driver.useBoost && car.boost >= 1 && v > 30 && !car.onGrass && !car.finished) {
    boost = straightAhead(track, i, 140, 1 / 350)
    if (boost && blocker) {
      /* Boosting behind someone: commit to the pass on the freer side. */
      driver.laneTarget = blocker.dist > 0 ? -room : room
      driver.overtakeT = 3.5
    }
  }
  return { throttle, brake, steer, boost }
}
