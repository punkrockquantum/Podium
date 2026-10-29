/**
 * The Austin, Texas 2027 Grand Prix at the Circuit of the Americas (56 laps of 5.513 km, 20 turns),
 * simulated lap by lap from each team's APPROVED design (unapproved tables race on their defaults).
 * Seeded, so the server, the race screen and every iPad replay the same race.
 *
 * Pace = resources (rank) + aero (CFD) + the system score of the approved design. Incidents come
 * from specific choices (a single WAN link, an air-cooled hall, public internet, banned wireless,
 * cloud burst, KV cache, Architect, missing retention) and every ticker line says who, why and what
 * it cost. Randomness is bounded: lap noise, incident odds and the Safety Car lap.
 */
import { PITCH_MAX, STATIONS, FINALE } from "./catalog.js"
import { aeroGainFor } from "./model.js"
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
const SYSTEM_PACE = 1.2
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

/** Table points (approved tables only) for one team across the active stations. */
export function pitchTotal(pitch = {}, stationIds = STATIONS.map((s) => s.id)) {
  return stationIds.reduce((total, id) => total + (Number.isFinite(pitch[id]) ? pitch[id] : 0), 0)
}

/** Mean simulation score (0–1) of the design the race sees, across the tables in play. */
export function systemScore(ev, stationIds = STATIONS.map((s) => s.id)) {
  if (!stationIds.length) return 0.5
  return stationIds.reduce((total, id) => total + simulateStation(null, {}, id, ev).score, 0) / stationIds.length / 100
}

const clampNoise = (value) => Math.max(-NOISE_CAP, Math.min(NOISE_CAP, value))
const placesText = (n) => `${n} place${n === 1 ? "" : "s"}`

/**
 * Incidents one car can suffer, from its design. Each: lap, seconds lost (negative = gained),
 * a plain-English cause, the lesson, and the table whose choice caused it.
 */
function carIncidents(ev, entry, r) {
  const ch = ev.choices
  const out = []
  const add = (inc) => out.push({ lap: r.int(6, LAPS - 6), ...inc })
  for (const risk of ev.risks) {
    if (risk.id === "asicSlip") continue
    if (r.next() >= risk.p) continue
    const cause = {
      wan: ev.network.redundancy > 0 && ch.wanBackup !== "none"
        ? `their primary WAN dropped and the ${ch.wanBackup === "leo" ? "LEO satellite" : "backup"} link took over`
        : "their only WAN link dropped for 40 s: no telemetry, no strategy calls",
      thermal: ev.cooling.thermal < 1 ? "their air-cooled hall overheated and throttled the strategy GPUs" : "max-boost GPUs hit a hot spot and throttled",
      power: "a breaker tripped at their data centre and the strategy cluster rebooted",
      immersion: "a tank pump fault took their immersion-cooled nodes offline",
      cpo: "an early-life co-packaged optics switch faulted and jobs re-routed",
    }[risk.id] || risk.text
    const station = { wan: "network", thermal: "dc", power: "dc", immersion: "dc", cpo: "network" }[risk.id] || "dc"
    add({ id: risk.id, loss: Math.min(5, risk.loss), cause, lesson: risk.lesson, station })
  }
  const jittery = ch.wan === "public" || ch.hqLink === "public"
  if (jittery && r.next() < 0.55) {
    out.push({ id: "jitter", lap: null, undercut: true, loss: 2.4, cause: "public-internet jitter delayed the undercut call by a lap", lesson: "Private interconnection (no jitter) keeps the pit wall's timing honest.", station: "network" })
  }
  if (ch.deploy === "burst" && ev.ai.gpus > 0 && r.next() < 0.4) {
    add({ id: "burst", loss: 3.0, cause: "cloud burst capacity was unavailable when rain threatened, so they guessed the wrong wing level", lesson: "Race-weekend burst is cheap until everyone wants the same GPUs at once.", station: "ai" })
  }
  if (ch.kv === "on" && ev.ai.gpus > 0) {
    add({ id: "kv", loss: -1.2, cause: "their KV cache answered repeat what-ifs instantly, so they called the stop a lap earlier", lesson: "Skipping prefill on repeat questions turns into faster decisions.", station: "storage" })
  }
  if (ev.ai.architectGain > 1) {
    add({ id: "architect", loss: -1.4, cause: "their Architect-tuned AI stack modelled the tyre drop-off a lap sooner", lesson: "Tuning the same hardware is the cheapest pace there is.", station: "ai" })
  }
  return out
}

/**
 * entries: [{ id, name, color, pitch, evaluation, system?, missed?, notApproved?, architect? }]
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
    let grid = 0
    let seconds = 0
    let dsq = false
    for (const pen of ev.penalties) {
      if (r.next() >= pen.p) continue
      caught[pen.id] = pen
      points += pen.points || 0
      grid += pen.grid || 0
      seconds += pen.seconds || 0
      if (pen.id === "umbilical") seconds += 5
      if (pen.dsq) dsq = true
    }
    let index = ev.aero.index
    if (caught.bidir && caught.workforce) index = ev.aero.indexIfCaught.both
    else if (caught.bidir) index = ev.aero.indexIfCaught.bidir
    else if (caught.workforce) index = ev.aero.indexIfCaught.workforce
    const aeroGain = Math.max(0, aeroGainFor(index) - ev.aero.capCut)

    let strategy = ev.strategy
    const slip = ev.risks.find((risk) => risk.id === "asicSlip")
    const slipped = slip && r.next() < slip.p
    if (slipped) strategy = ev.strategyNoAsic
    const incidents = carIncidents(ev, entry, r)
    const system = Number.isFinite(entry.system) ? entry.system : systemScore(ev, stationIds)
    const pace = BASE_LAP + (ev.rank - 5.5) * 0.07 - aeroGain - SYSTEM_PACE * (system - 0.6)
    const planned = Math.max(16, Math.min(42, Math.round(28 + r.normal() * (1.1 - Math.min(1, strategy)) * 13)))
    for (const inc of incidents) if (inc.undercut) inc.lap = Math.max(2, planned - 1)
    return {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      rank: ev.rank,
      ev,
      pace,
      system,
      aeroGain,
      aeroIndex: index,
      strategy,
      slipped,
      planned,
      pitted: false,
      pitLap: null,
      pitLoss: 0,
      underSC: false,
      incidents,
      caught,
      penaltyPoints: points,
      gridDrop: grid,
      timePenalty: seconds,
      dsq,
      total: 0,
      cum: [],
      lapTimes: [],
      quali: pace + clampNoise(r.normal() * 0.1),
      pitch: pitchTotal(entry.pitch, stationIds),
      missed: entry.missed || [],
      notApproved: entry.notApproved || [],
      architect: Boolean(entry.architect),
    }
  })

  /* Qualifying, then grid penalties. */
  const order = [...cars].sort((a, b) => a.quali - b.quali)
  for (const car of cars) {
    if (!car.gridDrop) continue
    const from = order.indexOf(car)
    order.splice(from, 1)
    order.splice(Math.min(order.length, from + car.gridDrop), 0, car)
    events.push({ lap: 0, team: car.id, kind: "penalty", text: `${car.name} drop ${car.gridDrop} grid places: ${Object.values(car.caught).filter((p) => p.grid).map((p) => p.text).join(" ")}` })
  }
  order.forEach((car, i) => {
    car.grid = i + 1
    car.start = i * 0.3
    car.total = car.start
  })
  for (const car of cars.filter((c) => c.slipped)) {
    events.push({ lap: 0, team: car.id, kind: "bad", text: `${car.name}: their custom AI chip slipped and missed the race, so strategy runs without it.`, lesson: "Custom silicon is a multi-year bet; schedule risk is the price of perf per watt." })
  }
  if (!sc) events.push({ lap: 0, team: null, kind: "info", text: "Green-flag race forecast: strategy is all about the planned stop." })

  const rankOf = (car, totals) => 1 + cars.filter((other) => other !== car && totals.get(other) < totals.get(car)).length
  const laps = []
  for (let lap = 1; lap <= LAPS; lap += 1) {
    const scLap = sc && lap >= sc.lap && lap < sc.lap + sc.laps
    const before = new Map(cars.map((car) => [car, car.total]))
    const ahead = [...cars].sort((a, b) => a.total - b.total)
    const deltas = new Map(cars.map((car) => [car, []]))
    if (sc && lap === sc.lap) events.push({ lap, team: null, kind: "sc", text: `Safety Car! Lap ${lap}: the field bunches up. Who has the data to call a cheap stop?` })
    if (fibreCut === lap) events.push({ lap, team: null, kind: "info", text: `Lap ${lap}: a contractor cut a fibre trunk near Austin. Every team's circuit link is tested.` })
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
      if (fibreCut === lap) {
        const diverse = car.ev.network.diverse
        const backup = car.ev.choices.wanBackup !== "none"
        const inc = diverse
          ? { id: "fibreSafe", loss: 0, cause: "redundant tunnels plus a diverse backup kept them online through the fibre cut", lesson: "Diverse paths (FIA 5.3) turn a cut into a non-event.", station: "network", good: true }
          : backup
            ? { id: "fibreCut", loss: 1.5, cause: "the fibre cut hit both of their WAN paths, which share the same ground route", lesson: "Two links in the same trench are one link.", station: "network" }
            : { id: "fibreCut", loss: 4.0, cause: "the fibre cut took out their only WAN link for 40 s", lesson: "FIA 5.3 asks for redundant tunnels for a reason.", station: "network" }
        t += inc.loss
        deltas.get(car).push(inc)
        car.incidents.push({ ...inc, lap })
      }
      if (heat === lap && car.ev.ai.inHall) {
        const ch = car.ev.choices
        const liquid = ["L", "X"].includes(ch.hall)
        const capped = ["eco85", "eco70"].includes(ch.tgp)
        const inc = liquid && capped
          ? { id: "heatSafe", loss: 0, cause: `liquid cooling plus a ${ch.tgp === "eco85" ? "85%" : "70%"} power cap kept their strategy GPUs stable in the heat`, lesson: "Headroom is what you have left on the hottest day.", station: "dc", good: true }
          : liquid
            ? { id: "heat", loss: 0.6, cause: "liquid cooling held, but uncapped GPUs ran hot and slowed a little", lesson: "A power cap buys stability for a few percent of tokens.", station: "ai" }
            : { id: "heat", loss: ch.tgp === "boost" ? 2.8 : 1.8, cause: "their air-cooled hall throttled in the heat and the strategy sims fell behind", lesson: "Air cooling runs out of headroom first on a hot day.", station: "dc" }
        t += inc.loss
        deltas.get(car).push(inc)
        car.incidents.push({ ...inc, lap })
      }
      if (!car.pitted && sc && lap === sc.lap) {
        const blind = car.incidents.some((inc) => ["wan", "power", "fibreCut"].includes(inc.id) && Math.abs(inc.lap - lap) <= 2)
        const react = blind ? 0.05 : Math.min(0.97, Math.max(0.05, car.strategy ** 2))
        if (r.next() < react) {
          car.pitted = true
          car.pitLap = lap
          car.underSC = true
          car.pitLoss = SC_PIT_LOSS + car.timePenalty
          t += car.pitLoss
          events.push({ lap, team: car.id, kind: "good", text: `${car.name} react to the Safety Car and pit for ${SC_PIT_LOSS} s instead of ${PIT_LOSS} s.`, lesson: "Fast, well-fed strategy models plus a low-latency path to the pit wall win the split-second call." })
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
        const why = Object.values(car.caught).filter((p) => p.seconds || p.id === "umbilical").map((p) => (p.id === "5g" ? "a private 5G cell on track (FIA 5.2)" : p.id === "umbilical" ? "car data dumped over Wi-Fi instead of the umbilical (FIA 5.2)" : p.text)).join(" and ")
        events.push({ lap, team: car.id, kind: "penalty", text: `${car.name} serve a ${car.timePenalty} s FIA time penalty at their stop: ${why}.`, lesson: "FIA 5.2 bans team wireless on track; car dumps go over the wired umbilical." })
      }
      car.lapTimes.push(t)
      car.total += t
      car.cum.push(car.total)
    }

    /* Ticker: every incident on this lap, with the places it cost or gained. */
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
      const passer = now.find((car, i) => i < prev.indexOf(car) && !deltas.get(car).length && !(car.pitLap === lap) && i < 6)
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
      if (!pen.points) continue
      const audit = ["archive", "f6", "segaudit", "logs", "pfs", "manualflow"].includes(pen.id)
      events.push({ lap: LAPS, team: car.id, kind: "penalty", incident: pen.id, text: `${car.name}: ${audit ? "FIA audit penalty. " : ""}${pen.text}` })
    }
    if (car.dsq) events.push({ lap: LAPS, team: car.id, kind: "penalty", text: `${car.name}: ${car.caught.fpga?.text || "disqualified."}` })
  }

  const classified = [...cars].sort((a, b) => (a.dsq - b.dsq) || a.total - b.total)
  const winner = classified[0]
  const results = classified.map((car, i) => {
    const pos = car.dsq ? null : i + 1
    const racePoints = pos && pos <= POINTS.length ? POINTS[pos - 1] : 0
    const best = Math.min(...car.lapTimes)
    return {
      id: car.id,
      name: car.name,
      color: car.color,
      position: pos,
      grid: car.grid,
      dsq: car.dsq,
      start: car.start,
      total: car.total,
      gap: car.dsq ? null : car.total - winner.total,
      bestLap: best,
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
      incidents: car.incidents.filter((inc) => inc.effect).map((inc) => ({ id: inc.id, lap: inc.lap, loss: inc.loss, places: inc.places, effect: inc.effect, cause: inc.cause, station: inc.station })),
      missed: car.missed,
      notApproved: car.notApproved,
      architect: car.architect,
    }
  })
  const fastest = results.filter((res) => !res.dsq).sort((a, b) => a.bestLap - b.bestLap)[0]
  const standings = [...results].sort((a, b) => b.score - a.score)
  return { seed, laps: LAPS, seconds: RACE_SECONDS, sc, fibreCut, heat, lapOrder: laps, results, standings, fastestLap: fastest?.id || null, events: events.sort((a, b) => a.lap - b.lap) }
}

export function pitchMax(stationIds = STATIONS.map((s) => s.id)) {
  return stationIds.length * PITCH_MAX
}
