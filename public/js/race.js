/**
 * The Austin, Texas 2027 Grand Prix at the Circuit of the Americas (56 laps of 5.513 km, 20 turns),
 * simulated lap by lap from each team's APPROVED design (unapproved tables race on their defaults).
 * Seeded, so the server, the race screen and every iPad replay the same race.
 *
 * Pace = tier + aero (CFD) + the system score of the approved design. Incidents come from specific
 * choices at the four tables, and every ticker line says who, why and what it cost.
 */
import { PITCH_MAX, STATIONS, FINALE } from "./catalog.js"
import { simulateStation } from "./sim.js"

export const LAPS = FINALE.laps
/** The animation on the race screen lasts this long. */
export const RACE_SECONDS = 30
const BASE_LAP = 96
const PIT_LOSS = 20
const SC_PIT_LOSS = 11
const SC_LAPS = 4
const SC_LAP = 125
const SC_KEEP_GAP = 0.3
const SC_SPACING = 0.8
const DEG_PER_LAP = 0.065
const LAP_NOISE = 0.18
const NOISE_CAP = 0.45
/** Seconds a lap per unit of system score above or below 0.6 (an average design). */
const SYSTEM_PACE = 1.6
const DRS_WINDOW = 1.0
const DRS_GAIN = 0.25
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
export const RACE_POINT_MULT = 4

function hashSeed(text) {
  let h = 2166136261
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

export function rng(seed) {
  let a = hashSeed(seed)
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = () => {
    const u = Math.max(1e-9, next())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
  return { next, normal, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) }
}

/** Table points (approved tables only) for one team across the tables in play. */
export function pitchTotal(pitch = {}, stationIds = STATIONS.map((s) => s.id)) {
  return stationIds.reduce((total, id) => total + (Number.isFinite(pitch[id]) ? pitch[id] : 0), 0)
}

/** Mean simulation score (0–1) of the design the race sees, across the tables in play. */
export function systemScore(ev, stationIds = STATIONS.map((s) => s.id)) {
  if (!stationIds.length) return 0.5
  return stationIds.reduce((total, id) => total + simulateStation(null, id, ev).score, 0) / stationIds.length / 100
}

export const pitchMax = (stationIds = STATIONS.map((s) => s.id)) => stationIds.length * PITCH_MAX

const clampNoise = (value) => Math.max(-NOISE_CAP, Math.min(NOISE_CAP, value))
const placesText = (n) => `${n} place${n === 1 ? "" : "s"}`

/**
 * Incidents one car can suffer from its own design. Each: lap, seconds lost (negative = gained),
 * a plain-English cause, the lesson, and the table whose choice caused it.
 */
function carIncidents(ev, r) {
  const ch = ev.choices
  const out = []
  const add = (p, inc) => {
    if (r.next() < p) out.push({ lap: r.int(6, LAPS - 6), ...inc })
  }
  if (ch.link === "single") add(0.35, { id: "tunnel", loss: 4.0, station: "network", cause: "their single tunnel dropped for 40 s: no telemetry, no strategy calls", lesson: "FIA 5.3 asks for two tunnels on separate paths for a reason." })
  if (ch.path === "public" && r.next() < 0.55) out.push({ id: "jitter", lap: null, undercut: true, loss: 2.4, station: "network", cause: "public-internet jitter delayed the undercut call by a lap", lesson: "A private path keeps the pit wall's timing honest." })
  if (ch.garage === "edge") add(0.5, { id: "edge", loss: -1.0, station: "network", cause: "their garage edge cache kept telemetry flowing through a link blip", lesson: "Data close to the car keeps engineers working when the link wobbles." })
  if (ch.power === "boost" && ch.cooling !== "liquid") add(0.5, { id: "boost", loss: 2.5, station: "dc", cause: "max boost overheated a rack and the strategy jobs restarted", lesson: "Boost needs the cooling to match it." })
  if (ev.power.roomFit < 1) add(0.5, { id: "roomPower", loss: 2.0, station: "dc", cause: "their server room hit its power limit and throttled the cluster", lesson: "Check the site can supply what the cluster draws." })
  if (ch.location === "cheap") add(0.5, { id: "distance", loss: 1.5, station: "dc", cause: "their far-away data centre added 40 ms to every strategy call, so the stop came late", lesson: "Cheap power is not cheap if the answers arrive late." })
  if (ch.size === "small") add(0.6, { id: "smallModel", loss: 2.0, station: "compute", cause: "too few nodes to re-run the tyre model, so they stayed out too long", lesson: "Size the cluster to the allowance, not below it." })
  if (ch.storage === "basic") add(0.5, { id: "slowStorage", loss: 1.6, station: "compute", cause: "slow storage delivered the overnight CFD and strategy data late", lesson: "Fast storage keeps expensive nodes busy." })
  if (ch.storage === "cache") add(0.6, { id: "cache", loss: -1.2, station: "compute", cause: "their flash cache answered repeat what-ifs instantly, so they called the stop a lap earlier", lesson: "Caching repeat questions turns into faster decisions." })
  if (r.next() < 0.4) {
    const node = {
      "4h": { loss: 0, good: true, cause: "a node failed on Saturday, but 4-hour support had it back before the race", lesson: "The support contract decides how long a failure lasts." },
      nbd: { loss: 1.5, cause: "a node failed on Saturday and next-business-day support meant racing without it", lesson: "Next business day is Monday: after the race." },
      basic: { loss: 3.0, cause: "a node failed and basic support left it down all weekend", lesson: "Parts by post do not arrive on a Sunday." },
    }[ch.support]
    out.push({ id: "node", lap: r.int(3, 10), station: "oem", ...node })
  }
  return out
}

/** The race-wide fibre cut and heat spike, and how each design copes. */
function fibreIncident(ev) {
  if (ev.network.satellite) return { id: "fibreSafe", loss: 0, good: true, station: "network", cause: "their satellite backup kept them online through the fibre cut", lesson: "A path that shares no ground route turns a cut into a non-event." }
  if (ev.network.redundant) return { id: "fibreCut", loss: 0.8, station: "network", cause: "the fibre cut forced a fail-over to their second tunnel", lesson: "Redundant tunnels (FIA 5.3) cost seconds, not the race." }
  return { id: "fibreCut", loss: 4.0, station: "network", cause: "the fibre cut took out their only tunnel for 40 s", lesson: "One tunnel is one cut away from a blind pit wall." }
}

function heatIncident(ev) {
  const ch = ev.choices
  if (ch.power === "boost") {
    return ch.cooling === "liquid"
      ? { id: "heat", loss: 0.6, station: "dc", cause: "max boost ran hot in the heat even on liquid cooling", lesson: "A power cap buys stability on the hottest day." }
      : { id: "heat", loss: 2.8, station: "dc", cause: "max boost overheated in the heat spike and the chips throttled hard", lesson: "Boost plus weak cooling fails first on a hot day." }
  }
  if (ch.cooling === "air") {
    return ev.power.heat > 0.85
      ? { id: "heat", loss: 1.8, station: "dc", cause: "their air cooling throttled the hot chips in the heat", lesson: "Air cooling runs out of headroom first on a hot day." }
      : { id: "heat", loss: 0.8, station: "dc", cause: "their air-cooled room ran warm and slowed the strategy runs", lesson: "Even CPUs feel the heat on air." }
  }
  if (ch.power === "cap85") return { id: "heatSafe", loss: 0, good: true, station: "dc", cause: `${ch.cooling === "liquid" ? "liquid" : "rear-door"} cooling plus an 85% power cap kept them stable in the heat`, lesson: "Headroom is what you have left on the hottest day." }
  if (ev.power.thermal < 1) return { id: "heat", loss: 1.2, station: "dc", cause: "their cooling could not keep up with the chips in the heat", lesson: "Match the cooling to the hottest chips." }
  return null
}

/**
 * entries: [{ id, name, color, tier?, pitch, evaluation, system?, missed?, notApproved? }]
 * Returns the classification, per-car cumulative times for the animation, and a ticker of events.
 */
export function runRace(entries, seed = "podium", stationIds = STATIONS.map((s) => s.id)) {
  const r = rng(seed)
  const events = []
  const sc = r.next() < 0.75 ? { lap: r.int(12, 40), laps: SC_LAPS } : null
  const fibreCut = r.next() < 0.45 ? r.int(8, 48) : null
  const heat = r.next() < 0.5 ? r.int(10, 46) : null

  const cars = entries.map((entry) => {
    const ev = entry.evaluation
    const caught = {}
    let points = 0
    let seconds = 0
    for (const pen of ev.penalties) {
      if (r.next() >= pen.p) continue
      caught[pen.id] = pen
      points += pen.points || 0
      seconds += pen.seconds || 0
    }
    const aeroGain = ev.aero.gain
    const strategy = ev.strategy
    const incidents = carIncidents(ev, r)
    const system = Number.isFinite(entry.system) ? entry.system : systemScore(ev, stationIds)
    const pace = BASE_LAP + ev.tier.pace - aeroGain - SYSTEM_PACE * (system - 0.6)
    const planned = Math.max(16, Math.min(42, Math.round(28 + r.normal() * (1.1 - Math.min(1, strategy)) * 13)))
    for (const inc of incidents) if (inc.undercut) inc.lap = Math.max(2, planned - 1)
    return {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      tier: ev.tier.id,
      ev,
      pace,
      system,
      aeroGain,
      aeroIndex: ev.aero.index,
      strategy,
      planned,
      pitted: false,
      pitLap: null,
      pitLoss: 0,
      underSC: false,
      incidents,
      caught,
      penaltyPoints: points,
      timePenalty: seconds,
      total: 0,
      cum: [],
      lapTimes: [],
      quali: pace + clampNoise(r.normal() * 0.1),
      pitch: pitchTotal(entry.pitch, stationIds),
      missed: entry.missed || [],
      notApproved: entry.notApproved || [],
    }
  })

  const order = [...cars].sort((a, b) => a.quali - b.quali)
  order.forEach((car, i) => {
    car.grid = i + 1
    car.start = i * 0.3
    car.total = car.start
  })
  if (!sc) events.push({ lap: 0, team: null, kind: "info", text: "Green-flag race forecast: strategy is all about the planned stop." })

  const rankOf = (car, totals) => 1 + cars.filter((other) => other !== car && totals.get(other) < totals.get(car)).length
  const laps = []
  for (let lap = 1; lap <= LAPS; lap += 1) {
    const scLap = sc && lap >= sc.lap && lap < sc.lap + sc.laps
    const before = new Map(cars.map((car) => [car, car.total]))
    const ahead = [...cars].sort((a, b) => a.total - b.total)
    const deltas = new Map(cars.map((car) => [car, []]))
    if (sc && lap === sc.lap) events.push({ lap, team: null, kind: "sc", text: `Safety Car! Lap ${lap}: the field bunches up. Who has the data to call a cheap stop?` })
    if (fibreCut === lap) events.push({ lap, team: null, kind: "info", text: `Lap ${lap}: a contractor cut a fibre trunk near Austin. Every team's link is tested.` })
    if (heat === lap) events.push({ lap, team: null, kind: "info", text: `Lap ${lap}: track and data-centre temperatures spike. Who stays cool?` })

    for (const car of cars) {
      const stint = car.pitted ? lap - car.pitLap : lap
      let t
      if (scLap) {
        const leader = ahead[0]
        const idx = ahead.indexOf(car)
        const keep = SC_KEEP_GAP ** (1 / sc.laps)
        const gap = Math.max(idx * SC_SPACING, (before.get(car) - before.get(leader)) * keep)
        t = before.get(leader) + SC_LAP + gap - before.get(car)
      } else {
        t = car.pace + stint * DEG_PER_LAP + clampNoise(r.normal() * LAP_NOISE)
        const idx = ahead.indexOf(car)
        if (idx > 0 && before.get(car) - before.get(ahead[idx - 1]) < DRS_WINDOW) t -= DRS_GAIN
      }
      for (const inc of car.incidents) {
        if (inc.lap !== lap) continue
        t += inc.loss
        deltas.get(car).push(inc)
      }
      const shared = [fibreCut === lap ? fibreIncident(car.ev) : null, heat === lap ? heatIncident(car.ev) : null].filter(Boolean)
      for (const inc of shared) {
        t += inc.loss
        deltas.get(car).push(inc)
        car.incidents.push({ ...inc, lap })
      }
      if (!car.pitted && sc && lap === sc.lap) {
        const blind = car.incidents.some((inc) => ["tunnel", "fibreCut"].includes(inc.id) && inc.loss >= 4 && Math.abs(inc.lap - lap) <= 2)
        const react = blind ? 0.05 : Math.min(0.97, Math.max(0.05, car.strategy ** 2))
        if (r.next() < react) {
          car.pitted = true
          car.pitLap = lap
          car.underSC = true
          car.pitLoss = SC_PIT_LOSS + car.timePenalty
          t += car.pitLoss
          events.push({ lap, team: car.id, kind: "good", text: `${car.name} react to the Safety Car and pit for ${SC_PIT_LOSS} s instead of ${PIT_LOSS} s.`, lesson: "A strong strategy model plus a fast path to the pit wall wins the split-second call." })
        } else if (blind) {
          events.push({ lap, team: car.id, kind: "bad", text: `${car.name} miss the Safety Car window: their pit wall is blind.`, lesson: "An outage at the wrong moment costs more than its seconds." })
        }
      }
      if (!car.pitted && lap === car.planned && !scLap) {
        car.pitted = true
        car.pitLap = lap
        car.pitLoss = PIT_LOSS + car.timePenalty
        t += car.pitLoss
      }
      if (car.pitLap === lap && car.timePenalty) {
        const why = Object.values(car.caught).filter((p) => p.seconds).map((p) => p.text.replace(/\.$/, "")).join(" and ")
        events.push({ lap, team: car.id, kind: "penalty", incident: "timePenalty", station: "network", text: `${car.name} serve a ${car.timePenalty} s FIA time penalty at their stop: ${why}.`, lesson: "FIA 5.2: car data goes over the wired umbilical." })
      }
      car.lapTimes.push(t)
      car.total += t
      car.cum.push(car.total)
    }

    const after = new Map(cars.map((car) => [car, car.total]))
    for (const car of cars) {
      for (const inc of deltas.get(car)) {
        const without = new Map(after)
        without.set(car, car.total - inc.loss)
        const moved = rankOf(car, after) - rankOf(car, without)
        let effect
        if (inc.good && !inc.loss) effect = "Held position"
        else if (inc.loss > 0) effect = moved > 0 ? `Lost ${placesText(moved)}` : `Lost ${inc.loss.toFixed(1)} s`
        else effect = moved < 0 ? `Gained ${placesText(-moved)}` : `Gained ${(-inc.loss).toFixed(1)} s`
        inc.places = -moved
        inc.effect = effect
        events.push({ lap, team: car.id, kind: inc.loss > 0 ? "bad" : "good", incident: inc.id, station: inc.station, places: -moved, text: `${car.name}. ${effect}: ${inc.cause}.`, lesson: inc.lesson })
      }
    }
    if (!scLap) {
      const prev = [...cars].sort((a, b) => before.get(a) - before.get(b))
      const now = [...cars].sort((a, b) => a.total - b.total)
      const passer = now.find((car, i) => i < prev.indexOf(car) && !deltas.get(car).length && car.pitLap !== lap && i < 6)
      if (passer && lap > 1 && r.next() < 0.35) {
        const passed = prev[now.indexOf(passer)]
        if (passed && passed !== passer && passed.pitLap !== lap) events.push({ lap, team: passer.id, kind: "move", text: `${passer.name} pass ${passed.name} with DRS on the back straight for P${now.indexOf(passer) + 1}.` })
      }
    }
    if (sc && lap === sc.lap + sc.laps - 1) events.push({ lap, team: null, kind: "sc", text: "Safety Car in: the pack is bunched up for the restart." })
    const standing = [...cars].sort((a, b) => a.total - b.total)
    laps.push(standing.map((car) => ({ id: car.id, gap: car.total - standing[0].total })))
  }

  for (const car of cars) {
    for (const pen of Object.values(car.caught)) {
      if (pen.points) events.push({ lap: LAPS, team: car.id, kind: "penalty", incident: pen.id, station: pen.station, text: `${car.name}: FIA penalty, −${pen.points} points. ${pen.text}` })
    }
  }

  const classified = [...cars].sort((a, b) => a.total - b.total)
  const winner = classified[0]
  const results = classified.map((car, i) => {
    const pos = i + 1
    const racePoints = pos <= POINTS.length ? POINTS[pos - 1] : 0
    return {
      id: car.id,
      name: car.name,
      color: car.color,
      tier: car.tier,
      position: pos,
      grid: car.grid,
      start: car.start,
      total: car.total,
      gap: car.total - winner.total,
      bestLap: Math.min(...car.lapTimes),
      cum: car.cum,
      pitLap: car.pitLap,
      pitLoss: car.pitLoss,
      underSC: car.underSC,
      aeroGain: car.aeroGain,
      aeroIndex: car.aeroIndex,
      system: car.system,
      strategy: car.strategy,
      racePoints,
      pitch: car.pitch,
      penaltyPoints: car.penaltyPoints,
      timePenalty: car.timePenalty,
      score: car.pitch + racePoints * RACE_POINT_MULT - car.penaltyPoints,
      caught: Object.keys(car.caught),
      incidents: car.incidents.filter((inc) => inc.effect).map((inc) => ({ id: inc.id, lap: inc.lap, loss: inc.loss, places: inc.places, effect: inc.effect, cause: inc.cause, station: inc.station, good: Boolean(inc.good) || inc.loss < 0 })),
      missed: car.missed,
      notApproved: car.notApproved,
    }
  })
  const fastest = [...results].sort((a, b) => a.bestLap - b.bestLap)[0]
  const standings = [...results].sort((a, b) => b.score - a.score || a.position - b.position)
  return { seed, laps: LAPS, seconds: RACE_SECONDS, sc, fibreCut, heat, lapOrder: laps, results, standings, fastestLap: fastest?.id || null, events: events.sort((a, b) => a.lap - b.lap) }
}
