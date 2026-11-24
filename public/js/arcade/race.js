/**
 * The race itself: grid, rivals, fixed steps, timing marks and the classification. Pure, no DOM:
 * the browser's main.js and the Node calibration runs and tests drive the same code.
 *
 * The player's car is whatever the planning tool handed over (see launch.js). The nine rivals are
 * teams "not doing the colocated, optimised approach": Today's parameters with a pace spread of the
 * model's 0.10 s per constructors' position across the midfield (P5–P11 around P8), some faster and
 * some slower than Today, Today's 99.4 % availability (so they glitch too) and no overtake boost.
 * Generic names and colours only.
 */
import { createCar, placeCar, stepCar, resolveCollision, carParams, DT, seededRandom } from "./physics.js"
import { createDriver, prepareDriver, driveAI } from "./ai.js"

/**
 * Model seconds per lap vs Today, one rival per entry. ASSUMPTION: Today's midfield neighbours, P6 to
 * P11 at the model's 0.10 s a position, with the places nearest Today's pace doubled up.
 */
export const RIVAL_OFFSETS = Object.freeze([0.2, 0.1, 0.1, 0.05, 0, -0.05, -0.1, -0.2, -0.3])
export const RIVAL_COLORS = Object.freeze(["#3b82f6", "#f59e0b", "#a855f7", "#14b8a6", "#f8fafc", "#f97316", "#84cc16", "#ec4899", "#94a3b8"])
export const PLAYER_GRID_SLOT = 4
export const AI_SKILL = 0.9
export const LAP_OPTIONS = Object.freeze([1, 3, 5])
export const DEFAULT_LAPS = 3

/** Today's setup as a car spec (the figures the planning tool shows for its "Today: Hinwil on-prem" preset). */
export const TODAY_SPEC = Object.freeze({
  season: 2027, label: "Today: Hinwil on-prem", short: "Today", secondsPerLapVsToday: 0, effectiveMauh: 3.84, allowanceUsedPct: 98.8,
  availabilityPct: 99.4, dataToDecisionS: 6.3, location: "Hinwil",
})

export const rivalSpecs = () =>
  RIVAL_OFFSETS.map((offset, k) => ({
    ...TODAY_SPEC,
    label: `On-prem rival ${"ABCDEFGHI"[k]}`,
    short: "ABCDEFGHI"[k],
    secondsPerLapVsToday: offset,
    color: RIVAL_COLORS[k],
  }))

/** Grid slot k (0 = pole): two staggered columns, 9 m a row, the first row 12 m behind the line. */
export function gridSlot(track, k) {
  const row = Math.floor(k / 2)
  const col = k % 2
  const back = 12 + row * 9 + col * 4.5
  return { s: -back / track.length, off: col ? 3.6 : -3.6 }
}

const COAST = Object.freeze({ throttle: 0, brake: 0, steer: 0, boost: false })

/**
 * A race ready for the lights. `car` is the player's spec; `aiPlayer` (a skill) lets the AI drive the
 * player's car for calibration; `rubberBand` false for pure-pace runs; `seed` fixes the glitches.
 */
export function createRace({ track, car, laps = DEFAULT_LAPS, seed = 1, aiSkill = AI_SKILL, aiPlayer = null, rubberBand = true, rivalCount = RIVAL_OFFSETS.length } = {}) {
  const rivals = rivalSpecs()
    .slice(0, Math.max(0, Math.min(RIVAL_OFFSETS.length, rivalCount)))
    .map((spec, k) => ({ spec, order: k }))
    .sort((a, b) => b.spec.secondsPerLapVsToday - a.spec.secondsPerLapVsToday)
  const playerSpec = { ...TODAY_SPEC, ...(car || {}) }
  const player = createCar({ id: "you", name: playerSpec.label, short: "YOU", color: playerSpec.color || "#e10600", params: carParams(playerSpec), isPlayer: true, raceLaps: laps })
  player.spec = playerSpec
  const cars = []
  const drivers = new Map()
  let slot = 0
  for (let k = 0; k <= rivals.length; k++) {
    if (k === Math.min(PLAYER_GRID_SLOT, rivals.length)) {
      cars.push(player)
      continue
    }
    const { spec } = rivals[slot++]
    const rival = createCar({ id: `r${slot}`, name: spec.label, short: spec.short, color: spec.color, params: carParams(spec), raceLaps: laps })
    rival.spec = spec
    cars.push(rival)
  }
  cars.forEach((c, k) => {
    const g = gridSlot(track, k)
    placeCar(c, track, g.s, g.off)
    c.gridSlot = k + 1
    c.marks = []
    c.markTop = -1
    if (c !== player || aiPlayer) {
      const d = createDriver({ skill: c === player ? aiPlayer : aiSkill, useBoost: c === player, reaction: 0.2 + 0.07 * k })
      prepareDriver(d, track, c)
      drivers.set(c, d)
    }
  })
  return { track, laps, seed, rng: seededRandom(seed), t: 0, started: false, cars, player, drivers, rubberBand, finishedAt: null, events: [], touches: 0 }
}

export function startRace(race) {
  race.started = true
  race.t = 0
  for (const car of race.cars) {
    car.lapStartT = 0
    car.sectorStartT = 0
  }
}

/** One fixed physics step for every car (the player on `playerInput`), collisions, timing marks, events. */
export function raceStep(race, playerInput = COAST, dt = DT) {
  if (!race.started) return race
  race.t += dt
  const { track, cars, player } = race
  if (race.rubberBand) {
    for (const car of cars) {
      const drv = race.drivers.get(car)
      if (!drv || car === player) continue
      const gapS = ((car.progress - player.progress) * track.length) / Math.max(player.speed, 25)
      drv.rubber = gapS > 8 ? 1 - Math.min(0.06, (gapS - 8) * 0.004) : 1
    }
  }
  for (const car of cars) {
    const drv = race.drivers.get(car)
    const input = drv ? driveAI(drv, car, track, cars, dt) : car.finished ? COAST : playerInput
    stepCar(car, input, track, dt, race.t, race.rng)
  }
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) if (resolveCollision(cars[i], cars[j])) race.touches += 1
  for (const car of cars) {
    const bucket = Math.floor(car.progress * 50)
    if (bucket > car.markTop) {
      for (let q = car.markTop + 1; q <= bucket; q++) car.marks[q] = race.t
      car.markTop = bucket
    }
    if (car.events.length) {
      for (const e of car.events) race.events.push({ ...e, car: car.id, t: race.t })
      car.events.length = 0
    }
  }
  if (player.finished && race.finishedAt === null) race.finishedAt = race.t
  return race
}

/** Run `seconds` of race time with the AI (or `inputFn(race)`) at the wheel: calibration and tests. */
export function runFor(race, seconds, inputFn = null, dt = DT) {
  const steps = Math.round(seconds / dt)
  for (let k = 0; k < steps; k++) raceStep(race, inputFn ? inputFn(race) : COAST, dt)
  return race
}

/** Finished cars by finish time, then the rest by distance covered. */
export function classification(race) {
  return [...race.cars]
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishT - b.finishT
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return b.progress - a.progress
    })
    .map((car, k) => ({ pos: k + 1, car }))
}

export const positionOf = (race, car) => classification(race).findIndex((row) => row.car === car) + 1

/**
 * Timing gap in seconds from `car` to `other` at the car's current point on the road, using the marks
 * each car leaves every 1/50 of a lap: positive when `other` is ahead. Null before they share a mark.
 */
export function gapTo(race, car, other) {
  if (car === other) return 0
  const bucket = Math.floor(car.progress * 50)
  if (other.markTop >= bucket && bucket >= 0 && other.marks[bucket] !== undefined) return race.t - other.marks[bucket]
  const mine = Math.floor(other.progress * 50)
  if (car.markTop >= mine && mine >= 0 && car.marks[mine] !== undefined) return -(race.t - car.marks[mine])
  return null
}

/** The plan's advantage recap for the results screen: the three mechanics in words. */
export function advantageRecap(spec, params) {
  const adv = Number(spec?.secondsPerLapVsToday) || 0
  const sign = adv > 0 ? "+" : ""
  const avail = `${params.availabilityPct >= 99.95 ? params.availabilityPct.toFixed(2) : params.availabilityPct.toFixed(1)} %`
  const lines = [
    { id: "aero", title: "Computation", text: adv === 0 ? "Today's cluster: the baseline aero package." : `Aero ${sign}${params.aeroPct} %: more grip and a little more top speed from ${spec.effectiveMauh ? `${spec.effectiveMauh} effective MAUh a period` : "a more efficient cluster"}.` },
    { id: "loop", title: "Connectivity", text: `Pit wall reacts in ${params.dataToDecisionS} s: the assist draws the line ${params.assistHorizonS} s ahead and the overtake boost recharges in ${params.boostRechargeS} s.` },
    { id: "avail", title: "Reliability", text: params.glitchPerS < 0.001 ? `${avail} availability: no telemetry glitches.` : `${avail} availability: about ${(params.glitchPerS * 60).toFixed(1)} telemetry glitches a minute.` },
  ]
  const headline = adv === 0 ? "Today's setup: 0.00 s/lap, the baseline" : `${sign}${adv.toFixed(2)} s/lap from the plan: aero, pit wall, reliability`
  return { headline, lines }
}
