/**
 * The arcade's pure modules: track geometry, car physics, lap timing through the sector gates,
 * collisions, the plan-to-game parameter mapping and the race calibration (the AI driving every car:
 * the 2028 car wins, 2027 reaches the podium, Today finishes mid-pack).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultTrack, LAP_M, WIDTH_M, crossed, crossFraction, forwardDelta, wrap01 } from "../public/js/arcade/track.js"
import { BASE, CAR_SIZE, DT, AERO_PCT_PER_SECOND, PLAUSIBLE_LAP_MS, carParams, createCar, placeCar, stepCar, resolveCollision, formatMs, kmh, seededRandom } from "../public/js/arcade/physics.js"
import { speedProfile, lapEstimate, createDriver, prepareDriver, driveAI } from "../public/js/arcade/ai.js"
import { createRace, startRace, raceStep, runFor, classification, positionOf, gapTo, advantageRecap, rivalSpecs, RIVAL_OFFSETS, TODAY_SPEC, LAP_OPTIONS } from "../public/js/arcade/race.js"
import { normalizeCar, readCar, launchRace, builtInCars, BUILT_IN_FALLBACK, CAR_KEY } from "../public/js/arcade/launch.js"

const track = defaultTrack()
const finite = (car) => ["x", "y", "heading", "vx", "vy", "speed", "lateral", "s", "dist", "progress", "boost"].every((k) => Number.isFinite(car[k]))
const SPEC_2027 = BUILT_IN_FALLBACK[1]
const SPEC_2028 = BUILT_IN_FALLBACK[2]

/** Full throttle, steering towards the racing line: a crude but deterministic "clean driver". */
function straightInput(car) {
  return { throttle: 1, brake: 0, steer: -Math.sign(car.dist) * Math.min(1, Math.abs(car.dist) / 4), boost: false }
}

test("track: a closed, uniformly spaced half-scale COTA with 20 turns, 3 sector gates in order and two DRS zones", () => {
  assert.ok(track.n > 500 && track.n < 1000, `${track.n} points`)
  assert.ok(Math.abs(track.length - LAP_M) < 6, `lap ${track.length.toFixed(1)} m vs ${LAP_M}`)
  assert.equal(track.width, WIDTH_M)
  for (let i = 0; i < track.n; i++) {
    const j = (i + 1) % track.n
    const d = Math.hypot(track.xs[j] - track.xs[i], track.ys[j] - track.ys[i])
    assert.ok(Math.abs(d - track.spacing) < 0.6, `point ${i}: spacing ${d.toFixed(2)}`)
    assert.ok(Math.abs(Math.hypot(track.tx[i], track.ty[i]) - 1) < 1e-6, "unit tangents")
    assert.ok(Math.abs(track.lineOff[i]) <= track.halfWidth - 3, "the racing line stays on the asphalt")
  }
  assert.equal(track.turns.length, 20)
  assert.deepEqual(track.turns.map((t) => t.n), Array.from({ length: 20 }, (_, k) => k + 1))
  assert.deepEqual(track.gates, [track.sectors[0], track.sectors[1], 0])
  assert.ok(track.sectors[0] > 0.3 && track.sectors[0] < track.sectors[1] && track.sectors[1] < 1)
  assert.equal(track.drs.length, 2)
  assert.ok(track.inDrs(0.01) && track.inDrs(0.6) && !track.inDrs(0.3), "DRS on the back straight and the start straight")
  for (const s of [0, 0.1, 0.42, 0.77, 0.999]) {
    const p = track.at(s, 2.5)
    const loc = track.locate(p.x, p.y)
    assert.ok(Math.abs(forwardDelta(loc.s, s)) < 0.004, `locate(at(${s})) → ${loc.s.toFixed(4)}`)
    assert.ok(Math.abs(loc.dist - 2.5) < 0.5, `offset 2.5 m located as ${loc.dist.toFixed(2)}`)
  }
  assert.equal(track.sectorOf(0.1), 1)
  assert.equal(track.sectorOf(0.5), 2)
  assert.equal(track.sectorOf(0.9), 3)
})

test("gate helpers: wrap-around crossings, no backwards crossings, sub-step fraction", () => {
  assert.equal(wrap01(-0.25), 0.75)
  assert.ok(crossed(0.99, 0.01, 0), "crossing the line through the wrap")
  assert.ok(!crossed(0.01, 0.99, 0), "reversing over the line is not a crossing")
  assert.ok(crossed(0.41, 0.42, 0.4186) && !crossed(0.42, 0.43, 0.4186))
  assert.ok(!crossed(0.1, 0.5, 0.3), "a 40 % jump is a teleport, not a crossing")
  assert.ok(Math.abs(crossFraction(0.99, 0.01, 0) - 0.5) < 1e-9)
})

test("carParams: the plan's figures map to aero, boost recharge, assist horizon and glitch rate", () => {
  const today = carParams(TODAY_SPEC)
  assert.equal(today.aeroPct, 0)
  assert.equal(today.grip, BASE.grip)
  assert.equal(today.maxSpeed, BASE.maxSpeed)
  assert.equal(today.boostRechargeS, 6.9)
  assert.equal(today.assistHorizonS, 2.2)
  assert.equal(today.assistJitterM, 5.4)
  assert.ok(Math.abs(today.glitchPerS - ((100 - 99.4) / 100) * 3.3) < 1e-6)
  const p28 = carParams(SPEC_2028)
  assert.equal(p28.aeroPct, Math.round(0.39 * AERO_PCT_PER_SECOND * 10) / 10)
  assert.ok(p28.grip > today.grip && p28.maxSpeed > today.maxSpeed && p28.accel > today.accel)
  assert.equal(p28.boostRechargeS, 5.3)
  assert.equal(p28.assistHorizonS, 2.9)
  assert.equal(p28.assistJitterM, 1.0)
  assert.ok(p28.glitchPerS < today.glitchPerS / 20, "99.98 % availability glitches far less than 99.4 %")
  const p27 = carParams(SPEC_2027)
  assert.ok(p27.aeroPct > 0 && p27.aeroPct < p28.aeroPct, "2028 is the bigger step")
  const garbage = carParams({ secondsPerLapVsToday: "x", dataToDecisionS: -4, availabilityPct: 1000 })
  assert.equal(garbage.aeroPct, 0)
  assert.equal(garbage.dataToDecisionS, 2)
  assert.equal(garbage.availabilityPct, 100)
  assert.ok(PLAUSIBLE_LAP_MS.min > 20_000 && PLAUSIBLE_LAP_MS.min < 30_000 && PLAUSIBLE_LAP_MS.max === 600_000)
})

/** An endless straight along +x: `dist` is the car's y, so y beyond the asphalt is grass. No gates ever cross. */
const STRAIGHT = { locate: (x, y) => ({ i: 0, s: 0.5, dist: y, x, y }), tx: [1], ty: [0], halfWidth: 9, gripHalfWidth: 10, wallDist: 1e6, gates: [0.1, 0.2, 0.3] }
const onStraight = (spec, y = 0) => Object.assign(createCar({ id: "s", params: carParams(spec) }), { x: 0, y, heading: 0, segHint: 0 })

test("speed limits: full throttle never exceeds the car's top speed; boost raises it, grass caps it low", () => {
  const car = onStraight(TODAY_SPEC)
  for (let k = 0; k < 20 * 120; k++) stepCar(car, { throttle: 1, brake: 0, steer: 0, boost: false }, STRAIGHT, DT, k * DT)
  assert.ok(car.speed > 0.95 * BASE.maxSpeed && car.speed <= BASE.maxSpeed + 1e-6, `flat out ${car.speed.toFixed(1)} m/s`)
  assert.ok(Math.abs(car.y) < 0.01 && Math.abs(car.heading) < 1e-9, "no steering, no drift")
  const boosted = onStraight(TODAY_SPEC)
  for (let k = 0; k < 8 * 120; k++) stepCar(boosted, { throttle: 1, brake: 0, steer: 0, boost: k > 5 * 120 }, STRAIGHT, DT, k * DT)
  assert.ok(boosted.boosting && boosted.boostsUsed === 1, "boosting")
  assert.ok(boosted.speed > car.speed * 1.02, `boost adds speed (${boosted.speed.toFixed(1)} vs ${car.speed.toFixed(1)} m/s)`)
  assert.ok(boosted.speed <= BASE.maxSpeed * boosted.params.boostSpeed + 0.2, `boost cap (${boosted.speed.toFixed(2)} m/s)`)
  const grass = onStraight(TODAY_SPEC, 20)
  for (let k = 0; k < 8 * 120; k++) stepCar(grass, { throttle: 1, brake: 0, steer: 0, boost: false }, STRAIGHT, DT, k * DT)
  assert.ok(grass.onGrass, "still on the grass")
  assert.ok(grass.speed > 5 && grass.speed < 30, `grass caps the speed (${grass.speed.toFixed(1)} m/s)`)
  const faster = onStraight(SPEC_2028)
  for (let k = 0; k < 20 * 120; k++) stepCar(faster, { throttle: 1, brake: 0, steer: 0, boost: false }, STRAIGHT, DT, k * DT)
  assert.ok(faster.speed > car.speed, "the 2028 car's aero buys top speed")
})

test("steering: the yaw rate falls with speed, full lock at speed slides, braking stops the car", () => {
  const turn = (v0, steps = 60) => {
    const car = onStraight(TODAY_SPEC)
    car.vx = v0
    car.speed = v0
    for (let k = 0; k < steps; k++) stepCar(car, { throttle: 0, brake: 0, steer: 1, boost: false }, { ...STRAIGHT, gripHalfWidth: 50 }, DT, k * DT)
    return { yaw: car.heading / (steps * DT), car }
  }
  const slow = turn(12)
  const fast = turn(70)
  assert.ok(slow.yaw > 0.9 && slow.yaw <= BASE.steerLow + 1e-6, `walking pace yaw ${slow.yaw.toFixed(2)} rad/s`)
  assert.ok(fast.yaw > 0 && fast.yaw < slow.yaw * 0.5, `fast yaw ${fast.yaw.toFixed(2)} rad/s falls with speed`)
  assert.ok(Math.abs(slow.car.lateral) < 0.5, "walking pace: the tyres keep up")
  assert.ok(Math.abs(fast.car.lateral) > 1, `full lock at 250 km/h slides (${fast.car.lateral.toFixed(2)} m/s sideways)`)
  const stopper = onStraight(TODAY_SPEC)
  stopper.vx = 50
  stopper.speed = 50
  let steps = 0
  while (stopper.speed > 0.01 && steps < 600) {
    stepCar(stopper, { throttle: 0, brake: 1, steer: 0, boost: false }, STRAIGHT, DT, steps * DT)
    steps += 1
  }
  assert.ok(steps * DT < 50 / BASE.brake + 0.2, `stops in ${(steps * DT).toFixed(2)} s`)
  for (let k = 0; k < 120; k++) stepCar(stopper, { throttle: 0, brake: 1, steer: 0, boost: false }, STRAIGHT, DT, k * DT)
  assert.ok(stopper.speed < 0 && stopper.speed >= -BASE.reverseMax, "holding the brake at rest reverses, slowly")
})

test("lap timing: gates must be passed in order (a shortcut never counts) and times are interpolated inside the step", () => {
  const car = placeCar(createCar({ id: "l", params: carParams(SPEC_2028), raceLaps: 3 }), track, 0.995, 0)
  let t = 0
  for (let k = 0; k < 600; k++) {
    t += DT
    stepCar(car, straightInput(car), track, DT, t)
  }
  assert.equal(car.laps.length, 0, "crossing the start line from the grid is not a lap")
  assert.equal(car.lap, 1)
  assert.equal(car.nextGate, 0, "the next gate is sector 1")
  /* Teleport past S1 and S2 to just before the line: the start/finish gate alone must not count. */
  const cheat = placeCar(createCar({ id: "c", params: carParams(SPEC_2028), raceLaps: 3 }), track, 0.98, 0)
  cheat.nextGate = 0
  cheat.lapStartT = 0
  let tc = 0
  for (let k = 0; k < 600; k++) {
    tc += DT
    stepCar(cheat, straightInput(cheat), track, DT, tc)
  }
  assert.ok(cheat.s > 0.02 && cheat.s < 0.3, "it is past the line")
  assert.equal(cheat.laps.length, 0, "no lap without the two sector gates")
  assert.equal(cheat.crossings, 0)

  /* A sector crossing at known speed: the interpolated time matches the position-based estimate to 1 ms. */
  const gate = track.gates[0]
  const probe = placeCar(createCar({ id: "p", params: carParams(SPEC_2028) }), track, gate - 0.03, 0)
  probe.nextGate = 0
  probe.sectorStartT = 0
  let tp = 0
  let before = null
  let crossedAt = null
  for (let k = 0; k < 2000 && crossedAt === null; k++) {
    const prevS = probe.s
    tp += DT
    stepCar(probe, straightInput(probe), track, DT, tp)
    if (crossed(prevS, probe.s, gate)) {
      before = { prevS, tp }
      crossedAt = probe.sectorStartT
    }
  }
  assert.ok(crossedAt !== null, "the probe crossed the gate")
  const expected = before.tp - DT + crossFraction(before.prevS, probe.s, gate) * DT
  assert.ok(Math.abs(crossedAt - expected) < 0.001, `gate time ${crossedAt.toFixed(4)} vs ${expected.toFixed(4)}`)
  assert.equal(probe.sectorsMs[0], Math.round(crossedAt * 1000))
})

test("a full lap by the AI: three sectors add up to the lap, best lap is set, the finish after raceLaps laps", () => {
  const car = placeCar(createCar({ id: "a", params: carParams(SPEC_2028), raceLaps: 1 }), track, -0.004, 0)
  const driver = createDriver({ skill: 0.9 })
  prepareDriver(driver, track, car)
  let t = 0
  for (let k = 0; k < 120 * 120 && !car.finished; k++) {
    t += DT
    stepCar(car, driveAI(driver, car, track, [car], DT), track, DT, t)
  }
  assert.ok(car.finished, "finished one lap in under two minutes")
  assert.equal(car.laps.length, 1)
  assert.equal(car.lastLapMs, car.bestLapMs)
  assert.ok(Math.abs(car.lastSectorsMs.reduce((a, b) => a + b, 0) - car.lastLapMs) <= 2, "sectors add up to the lap (each rounded to the ms)")
  assert.ok(car.bestLapMs > PLAUSIBLE_LAP_MS.min && car.bestLapMs < 90_000, `lap ${formatMs(car.bestLapMs)}`)
  assert.ok(Math.abs(car.finishT * 1000 - car.lastLapMs) < 2, "the finish time is the lap time")
  const est = lapEstimate(track, speedProfile(track, car.params, 0.9))
  assert.ok(Math.abs(est * 1000 - car.bestLapMs) < 8000, `profile estimate ${est.toFixed(1)} s vs driven ${formatMs(car.bestLapMs)}`)
})

test("collisions: overlapping cars separate, the closing speed is traded and a little is lost", () => {
  const a = createCar({ id: "a", x: 0, y: 0, heading: 0 })
  const b = createCar({ id: "b", x: 3, y: 0.2, heading: 0 })
  a.vx = 40
  b.vx = 30
  a.speed = 40
  b.speed = 30
  const before = a.vx + b.vx
  assert.ok(resolveCollision(a, b), "they touched")
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 2 * CAR_SIZE.radius - 1e-9, "pushed apart")
  assert.ok(a.vx < 40 && b.vx > 30, "momentum passed forward")
  assert.ok(a.vx + b.vx < before && a.vx + b.vx > before * 0.95, "a little energy lost")
  assert.ok(a.bumped && b.bumped)
  const far = createCar({ id: "c", x: 10, y: 0 })
  assert.equal(resolveCollision(a, far), false)
})

test("no NaN: thirty seconds of random key mashing with nine rivals keeps every car finite", () => {
  const race = createRace({ track, car: SPEC_2027, laps: 3, seed: 3 })
  startRace(race)
  const rng = seededRandom(99)
  runFor(race, 30, () => ({ throttle: rng() < 0.7 ? 1 : 0, brake: rng() < 0.2 ? 1 : 0, steer: rng() < 0.5 ? (rng() < 0.5 ? -1 : 1) : 0, boost: rng() < 0.05 }))
  for (const car of race.cars) assert.ok(finite(car), `${car.id} went non-finite`)
  assert.ok(race.player.speed >= -BASE.reverseMax && race.player.speed <= race.player.params.maxSpeed * race.player.params.boostSpeed + 1e-6)
  assert.ok(Math.abs(race.player.dist) <= track.wallDist + 1e-6, "the soft wall holds the player inside the runoff")
  assert.ok(race.cars.filter((c) => c !== race.player).every((c) => c.progress > 0.1), "the rivals got away")
  for (const car of race.cars) assert.ok(Number.isFinite(positionOf(race, car)) && positionOf(race, car) >= 1 && positionOf(race, car) <= 10)
})

test("rivals: nine generic on-prem cars around Today's pace, no real team or driver names, no boost", () => {
  const specs = rivalSpecs()
  assert.equal(specs.length, 9)
  assert.deepEqual(specs.map((s) => s.secondsPerLapVsToday), [...RIVAL_OFFSETS])
  assert.ok(specs.every((s) => /^On-prem rival [A-I]$/.test(s.label)))
  assert.ok(specs.every((s) => s.availabilityPct === TODAY_SPEC.availabilityPct && s.dataToDecisionS === TODAY_SPEC.dataToDecisionS))
  const banned = /ferrari|mercedes|red bull|mclaren|aston|alpine|williams|haas|sauber|verstappen|hamilton|leclerc|norris|russell|alonso|sainz|bottas|hulkenberg|gasly|ocon|piastri|perez/i
  for (const s of specs) assert.ok(!banned.test(s.label), s.label)
  const race = createRace({ track, car: SPEC_2028, laps: 3 })
  assert.equal(race.cars.length, 10)
  assert.equal(race.cars[4], race.player, "the player starts fifth on the grid")
  assert.ok(race.cars.every((c) => c === race.player || !race.drivers.get(c).useBoost), "rivals never boost")
  assert.deepEqual(LAP_OPTIONS, [1, 3, 5])
})

test("calibration: the AI in every seat — the 2028 car wins, 2027 makes the podium, Today is mid-pack", () => {
  const seeds = [1, 2, 3]
  const results = {}
  for (const [name, spec] of [["2028", SPEC_2028], ["2027", SPEC_2027], ["today", TODAY_SPEC]]) {
    results[name] = seeds.map((seed) => {
      const race = createRace({ track, car: spec, laps: 3, seed, aiPlayer: 0.9, rubberBand: false })
      startRace(race)
      runFor(race, 240)
      assert.ok(race.player.finished, `${name} seed ${seed} finished three laps`)
      const rows = classification(race)
      return { pos: rows.findIndex((r) => r.car === race.player) + 1, best: race.player.bestLapMs, rivalBest: Math.min(...race.cars.filter((c) => c !== race.player).map((c) => c.bestLapMs ?? 1e9)) }
    })
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  assert.ok(results["2028"].filter((r) => r.pos === 1).length >= 2, `2028 wins most races: ${results["2028"].map((r) => "P" + r.pos).join(" ")}`)
  assert.ok(median(results["2027"].map((r) => r.pos)) <= 3, `2027 on the podium: ${results["2027"].map((r) => "P" + r.pos).join(" ")}`)
  const todayPos = median(results.today.map((r) => r.pos))
  assert.ok(todayPos >= 4 && todayPos <= 8, `Today mid-pack: ${results.today.map((r) => "P" + r.pos).join(" ")}`)
  assert.ok(median(results["2028"].map((r) => r.best)) < median(results["2027"].map((r) => r.best)) && median(results["2027"].map((r) => r.best)) < median(results.today.map((r) => r.best)), "best laps follow the plan's order")
  for (const r of results["2028"]) assert.ok(r.best > PLAUSIBLE_LAP_MS.min, "every lap is inside the league's plausibility window")
})

test("race helpers: gaps, the rubber band only slows rivals, the recap names the three mechanics", () => {
  const race = createRace({ track, car: SPEC_2028, laps: 1, seed: 5 })
  startRace(race)
  runFor(race, 12, () => ({ throttle: 1, brake: 0, steer: 0, boost: false }))
  const leader = classification(race)[0].car
  if (leader !== race.player) {
    const gap = gapTo(race, race.player, leader)
    assert.ok(gap === null || gap >= 0, "the leader is ahead")
  }
  assert.equal(gapTo(race, race.player, race.player), 0)
  for (const [car, drv] of race.drivers) assert.ok(drv.rubber <= 1 && drv.rubber >= 0.94, `${car.id} rubber ${drv.rubber}`)
  const recap = advantageRecap(SPEC_2028, carParams(SPEC_2028))
  assert.match(recap.headline, /^\+0\.39 s\/lap from the plan: aero, pit wall, reliability$/)
  assert.deepEqual(recap.lines.map((l) => l.title), ["Computation", "Connectivity", "Reliability"])
  assert.match(recap.lines[0].text, /Aero \+11\.7 %/)
  assert.match(recap.lines[1].text, /4\.84 s/)
  assert.match(recap.lines[2].text, /99\.98 %/)
  assert.match(advantageRecap(TODAY_SPEC, carParams(TODAY_SPEC)).headline, /baseline/)
  assert.equal(kmh(27.78), 100)
  assert.equal(formatMs(83456), "1:23.456")
  assert.equal(formatMs(null), "--:--.---")
})

test("launch contract: normalise, write and read the car, URL fallbacks, built-in cars from the model", async () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
  const nav = []
  const spec = launchRace({ season: 2028, label: "Plan <b>X</b>", secondsPerLapVsToday: "0.31", effectiveMauh: 6.9, allowanceUsedPct: 95, availabilityPct: 99.97, dataToDecisionS: 4.9, location: "Digital Realty Zurich" }, { storage, location: { assign: (u) => nav.push(u) } })
  assert.deepEqual(nav, ["/arcade.html"])
  assert.equal(spec.label, "Plan b X /b", "angle brackets stripped")
  assert.equal(spec.secondsPerLapVsToday, 0.31)
  const back = readCar({ storage, search: "" })
  assert.deepEqual(back, JSON.parse(store.get(CAR_KEY)))
  assert.equal(readCar({ storage: { getItem: () => null }, search: "?season=2028&adv=0.39&avail=99.98&loop=4.8&label=Zurich%202028" }).availabilityPct, 99.98)
  assert.equal(readCar({ storage: { getItem: () => null }, search: "" }), null, "nothing handed over: the picker")
  assert.equal(normalizeCar({ season: 1999, adv: 9, avail: 1, loop: 100, label: "x" }).season, 2027, "unknown seasons fall back to 2027")
  assert.equal(normalizeCar({ season: 2028, adv: 9 }).secondsPerLapVsToday, 1, "advantage clamped")
  assert.throws(() => launchRace(null, { storage, navigate: false }))
  const live = await builtInCars()
  assert.equal(live.length, 3)
  assert.deepEqual(live.map((c) => c.season), [2027, 2027, 2028])
  assert.ok(live[0].secondsPerLapVsToday === 0 && live[1].secondsPerLapVsToday > 0.1 && live[2].secondsPerLapVsToday > live[1].secondsPerLapVsToday, "Today 0, 2027 a step, 2028 the bigger step")
  assert.ok(live[2].availabilityPct > live[1].availabilityPct && live[1].availabilityPct > live[0].availabilityPct)
  const fallback = await builtInCars(() => Promise.reject(new Error("offline")))
  assert.deepEqual(fallback.map((c) => c.label), BUILT_IN_FALLBACK.map((c) => c.label))
})
