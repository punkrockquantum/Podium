/**
 * The Austin, Texas 2027 Grand Prix at the Circuit of the Americas (56 laps of 5.513 km, 20 turns),
 * simulated lap by lap from each team's APPROVED boards (unapproved tables race on the customer's
 * existing setup). Seeded, so the server, the race screen and every iPad replay the same race.
 *
 * Pace comes from the mean FIT of the boards the race sees. Incidents come from dial settings the
 * team could see on its boards, and every ticker line says who, why and what it cost.
 */
import { PITCH_MAX, STATIONS, FINALE } from "./catalog.js"

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
/** Seconds a lap per unit of mean FIT (0–1) above or below 0.6. */
const SYSTEM_PACE = 1.4
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

/** Mean FIT (0–1) of the boards the race sees, across the tables in play. */
export function systemScore(ev, stationIds = STATIONS.map((s) => s.id)) {
  if (!stationIds.length) return 0.5
  return stationIds.reduce((total, id) => total + (ev.fit[id] ?? ev.boards?.[id]?.fit ?? 50), 0) / stationIds.length / 100
}

/** How well the pit wall reads the race: fast, reliable data plus a strong simulation programme. */
const strategyOf = (ev) => 0.45 + 0.55 * (((ev.fit.network ?? 50) + (ev.fit.compute ?? 50)) / 200)

const PLACE = { factory: "factory server room", cheap: "remote cheap-power hall" }
const COOLING = { air: "air cooling", reardoor: "rear-door cooling", liquid: "liquid cooling" }

export const pitchMax = (stationIds = STATIONS.map((s) => s.id)) => stationIds.length * PITCH_MAX

const clampNoise = (value) => Math.max(-NOISE_CAP, Math.min(NOISE_CAP, value))
const placesText = (n) => `${n} place${n === 1 ? "" : "s"}`

/**
 * Incidents one car can suffer from its own design. Each: lap, seconds lost (negative = gained),
 * a plain-English cause, the lesson, and the table whose choice caused it.
 */
function carIncidents(ev, r) {
  const ch = ev.choices
  const board = (id) => ev.boards[id]
  const target = (station, id) => board(station)?.targets.find((t) => t.id === id)
  const out = []
  const add = (p, inc) => {
    if (r.next() < p) out.push({ lap: r.int(6, LAPS - 6), ...inc })
  }
  if (board("network")) {
    if (ch.link === "single") add(0.35, { id: "tunnel", loss: 4.0, station: "network", dial: "link", cause: "their single factory tunnel dropped for 40 s: no telemetry, no strategy calls", lesson: "FIA 5.3 asks for two tunnels on separate paths for a reason." })
    if (ch.path === "public" && r.next() < 0.55) out.push({ id: "jitter", lap: null, undercut: true, loss: 2.4, station: "network", dial: "path", cause: "public-internet jitter delayed their undercut call by a lap", lesson: "A private path keeps the pit wall's timing honest." })
    if (ch.garage === "edge") add(0.5, { id: "edge", loss: -1.0, station: "network", dial: "garage", cause: "their garage edge cache kept telemetry flowing through a link blip", lesson: "Data close to the car keeps engineers working when the link wobbles." })
  }
  if (board("oem")) {
    if (!target("oem", "perf").ok) add(0.5, { id: "oldKit", loss: 1.5, station: "oem", dial: "vendor", cause: "their last-generation servers ran too few what-ifs before the stop", lesson: "Performance per dollar is why customers refresh." })
    if (!target("oem", "lead").ok) add(0.6, { id: "lateKit", loss: 2.0, station: "oem", dial: "vendor", cause: "their new systems arrived after the season started, so the aero upgrade came late", lesson: "Lead time matters as much as speed." })
    if (r.next() < 0.4) {
      const node = {
        "4h": { loss: 0, good: true, cause: "a node failed on Saturday, but 4-hour support had it back before the race", lesson: "The support contract decides how long a failure lasts." },
        nbd: { loss: 1.5, cause: "a node failed on Saturday and next-business-day support meant racing without it", lesson: "Next business day is Monday: after the race." },
        basic: { loss: 3.0, cause: "a node failed and basic support left it down all weekend", lesson: "Parts by post do not arrive on a Sunday." },
      }[ch.support]
      out.push({ id: "node", lap: r.int(3, 10), station: "oem", dial: "support", ...node })
    }
  }
  if (board("dc")) {
    if (!target("dc", "nplus1").ok) add(0.35, { id: "powerBlip", loss: 3.0, station: "dc", dial: "location", cause: `a power blip at their ${PLACE[ch.location] || "site"} with no N+1 backup restarted the strategy jobs`, lesson: "N+1 turns a blip into a non-event." })
    if (!target("dc", "capacity").ok) add(0.5, { id: "throttle", loss: 2.0, station: "dc", dial: "cooling", cause: `their ${COOLING[ch.cooling]} could not keep up, so the cluster throttled`, lesson: "Match power and cooling to what the cluster needs." })
  }
  if (board("compute")) {
    if (!target("compute", "cycles").ok) add(0.6, { id: "fewCycles", loss: 2.0, station: "compute", dial: "size", cause: "too few design cycles a week, so their aero upgrade was a race late", lesson: "Design cycles per week are the aero programme." })
    if (!target("compute", "feed").ok) add(0.5, { id: "slowStorage", loss: 1.6, station: "compute", dial: "storage", cause: "slow storage left nodes waiting, so the overnight runs came late", lesson: "Fast storage keeps expensive nodes busy." })
    if (ch.storage === "cache") add(0.6, { id: "cache", loss: -1.2, station: "compute", dial: "storage", cause: "their flash cache answered repeat what-ifs instantly, so they called the stop a lap earlier", lesson: "Caching repeat questions turns into faster decisions." })
    if (board("compute").caps.find((c) => c.id === "power")?.over > 0) add(0.5, { id: "hallTrip", loss: 2.0, station: "compute", dial: "size", cause: "the cluster tripped the hall's 400 kW limit mid-session", lesson: "Size the cluster to the power the hall has." })
  }
  return out
}

/** The race-wide fibre cut and heat spike, and how each board copes. */
function fibreIncident(ev) {
  if (!ev.boards.network) return null
  if (ev.choices.link === "satellite") return { id: "fibreSafe", loss: 0, good: true, station: "network", dial: "link", cause: "their satellite backup kept them online through the fibre cut", lesson: "A path that shares no ground route turns a cut into a non-event." }
  if (ev.choices.link === "redundant") return { id: "fibreCut", loss: 0.8, station: "network", dial: "link", cause: "the fibre cut forced a fail-over to their second diverse path", lesson: "Diverse paths (FIA 5.3) cost seconds, not the race." }
  return { id: "fibreCut", loss: 4.0, station: "network", dial: "link", cause: "the fibre cut took out their single factory tunnel for 40 s", lesson: "One tunnel is one cut away from a blind pit wall." }
}

function heatIncident(ev) {
  if (!ev.boards.dc) return null
  const ch = ev.choices
  if (ch.power === "boost") {
    return ch.cooling === "liquid"
      ? { id: "heat", loss: 0.6, station: "dc", dial: "power", cause: "max boost ran hot in the heat even on liquid cooling", lesson: "A power cap buys stability on the hottest day." }
      : { id: "heat", loss: 2.8, station: "dc", dial: "power", cause: "max boost overheated in the heat spike and the chips throttled hard", lesson: "Boost plus weak cooling fails first on a hot day." }
  }
  if (ch.cooling === "air") return { id: "heat", loss: 1.8, station: "dc", dial: "cooling", cause: "their air cooling throttled the chips in the heat spike", lesson: "Air cooling runs out of headroom first on a hot day." }
  if (ch.power === "cap85") return { id: "heatSafe", loss: 0, good: true, station: "dc", dial: "power", cause: `${COOLING[ch.cooling]} plus an 85% power cap kept them stable in the heat`, lesson: "Headroom is what you have left on the hottest day." }
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
    const strategy = strategyOf(ev)
    const incidents = carIncidents(ev, r)
    const system = Number.isFinite(entry.system) ? entry.system : systemScore(ev, stationIds)
    const pace = BASE_LAP - SYSTEM_PACE * (system - 0.6)
    const planned = Math.max(16, Math.min(42, Math.round(28 + r.normal() * (1.1 - Math.min(1, strategy)) * 13)))
    for (const inc of incidents) if (inc.undercut) inc.lap = Math.max(2, planned - 1)
    return {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      ev,
      pace,
      system,
      fit: { ...ev.fit },
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
        events.push({ lap, team: car.id, kind: "penalty", incident: "timePenalty", station: "network", dial: "garage", text: `${car.name} serve a ${car.timePenalty} s FIA time penalty at their stop: ${why}.`, lesson: "FIA 5.2: car data goes over the wired umbilical." })
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
        events.push({ lap, team: car.id, kind: inc.loss > 0 ? "bad" : "good", incident: inc.id, station: inc.station, dial: inc.dial, places: -moved, text: `${car.name}. ${effect}: ${inc.cause}.`, lesson: inc.lesson })
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
      if (pen.points) events.push({ lap: LAPS, team: car.id, kind: "penalty", incident: pen.id, station: pen.station, dial: pen.dial, text: `${car.name}: FIA penalty, −${pen.points} points. ${pen.text}` })
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
      system: car.system,
      fit: car.fit,
      strategy: car.strategy,
      racePoints,
      pitch: car.pitch,
      penaltyPoints: car.penaltyPoints,
      timePenalty: car.timePenalty,
      score: car.pitch + racePoints * RACE_POINT_MULT - car.penaltyPoints,
      caught: Object.keys(car.caught),
      incidents: car.incidents.filter((inc) => inc.effect).map((inc) => ({ id: inc.id, lap: inc.lap, loss: inc.loss, places: inc.places, effect: inc.effect, cause: inc.cause, station: inc.station, dial: inc.dial, good: Boolean(inc.good) || inc.loss < 0 })),
      missed: car.missed,
      notApproved: car.notApproved,
    }
  })
  const fastest = [...results].sort((a, b) => a.bestLap - b.bestLap)[0]
  const standings = [...results].sort((a, b) => b.score - a.score || a.position - b.position)
  return { seed, laps: LAPS, seconds: RACE_SECONDS, sc, fibreCut, heat, lapOrder: laps, results, standings, fastestLap: fastest?.id || null, events: events.sort((a, b) => a.lap - b.lap) }
}
