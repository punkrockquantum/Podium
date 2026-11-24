/**
 * The in-race HUD: plain DOM elements (big, legible on a projector) updated a few times a frame.
 * Nothing here knows about physics beyond the car fields it reads.
 */
import { formatMs, kmh } from "./physics.js"
import { classification, gapTo } from "./race.js"

const $ = (root, sel) => root.querySelector(sel)

export function createHud(root) {
  const el = {
    lap: $(root, "[data-hud=lap]"),
    pos: $(root, "[data-hud=pos]"),
    speed: $(root, "[data-hud=speed]"),
    current: $(root, "[data-hud=current]"),
    last: $(root, "[data-hud=last]"),
    best: $(root, "[data-hud=best]"),
    delta: $(root, "[data-hud=delta]"),
    boost: $(root, "[data-hud=boost]"),
    boostLabel: $(root, "[data-hud=boost-label]"),
    assist: $(root, "[data-hud=assist]"),
    aero: $(root, "[data-hud=aero]"),
    sectors: [...root.querySelectorAll("[data-hud=sector]")],
    flash: $(root, "[data-hud=flash]"),
    drs: $(root, "[data-hud=drs]"),
  }
  let flashUntil = 0
  const cache = new Map()
  const set = (node, text) => {
    if (!node || cache.get(node) === text) return
    cache.set(node, text)
    node.textContent = text
  }

  function flash(text, ms = 1600, now = performance.now()) {
    if (!el.flash) return
    el.flash.textContent = text
    el.flash.classList.add("on")
    flashUntil = now + ms
  }

  function update(race, assistOn, now = performance.now()) {
    const car = race.player
    const t = race.t
    set(el.lap, `LAP ${Math.min(car.lap, race.laps)}/${race.laps}`)
    const rows = classification(race)
    const pos = rows.findIndex((r) => r.car === car) + 1
    set(el.pos, `P${pos}`)
    set(el.speed, `${String(kmh(car.speed)).padStart(3, " ")}`)
    const currentMs = car.finished ? car.lastLapMs : Math.max(0, Math.round((t - car.lapStartT) * 1000))
    set(el.current, formatMs(currentMs))
    set(el.last, formatMs(car.lastLapMs))
    set(el.best, formatMs(car.bestLapMs))
    const leader = rows[0].car
    if (leader === car) {
      const second = rows[1]?.car
      const gap = second ? gapTo(race, second, car) : null
      set(el.delta, gap === null || gap === undefined ? "LEADER" : `LEADER +${Math.max(0, gap).toFixed(1)}`)
    } else {
      const gap = gapTo(race, car, leader)
      set(el.delta, gap === null ? "TO P1 --.-" : `TO P1 ${gap >= 0 ? "+" : "-"}${Math.abs(gap).toFixed(1)}`)
    }
    if (el.boost) {
      const pct = car.boosting ? Math.max(0, car.boostT / car.params.boostDurationS) : car.boost
      el.boost.style.width = `${Math.round(pct * 100)}%`
      el.boost.classList.toggle("ready", !car.boosting && car.boost >= 1)
      el.boost.classList.toggle("active", car.boosting)
      set(el.boostLabel, car.boosting ? "BOOST!" : car.boost >= 1 ? "BOOST READY · SPACE" : `BOOST ${Math.round(car.boost * 100)}%`)
    }
    if (el.assist) {
      const text = car.glitchT > 0 ? "TELEMETRY GLITCH" : assistOn ? `PIT WALL ${car.params.dataToDecisionS}s` : "PIT WALL OFF"
      set(el.assist, text)
      el.assist.classList.toggle("glitch", car.glitchT > 0)
      el.assist.classList.toggle("off", !assistOn && car.glitchT <= 0)
    }
    set(el.aero, `AERO ${car.params.aeroPct >= 0 ? "+" : ""}${car.params.aeroPct}%`)
    for (let k = 0; k < 3; k++) {
      const node = el.sectors[k]
      if (!node) continue
      const ms = car.sectorsMs[k]
      const best = car.bestSectorsMs[k]
      const live = car.nextGate === k && !car.finished
      node.classList.toggle("live", live)
      if (ms !== null) {
        const colour = best !== null && ms <= best ? "purple" : car.lastSectorsMs[k] !== null && ms <= car.lastSectorsMs[k] ? "green" : "yellow"
        node.dataset.colour = colour
        set(node, `S${k + 1} ${(ms / 1000).toFixed(2)}`)
      } else {
        node.dataset.colour = live ? "live" : "none"
        set(node, `S${k + 1} ${live ? "···" : "--.--"}`)
      }
    }
    if (el.drs) el.drs.classList.toggle("on", race.track.inDrs(car.s) && car.speed > 30)
    if (el.flash && flashUntil && now > flashUntil) {
      el.flash.classList.remove("on")
      flashUntil = 0
    }
  }

  return { update, flash }
}

/** Results rows for the finish screen: position, name, best lap, gap. */
export function resultsRows(race) {
  const rows = classification(race)
  const winner = rows[0].car
  return rows.map(({ pos, car }) => {
    let gap = ""
    if (car === winner) gap = "WINNER"
    else if (car.finished && winner.finished) gap = `+${(car.finishT - winner.finishT).toFixed(3)} s`
    else if (!car.finished) gap = `+${Math.max(0, Math.floor(winner.progress - car.progress))} lap${Math.floor(winner.progress - car.progress) === 1 ? "" : "s"}`.replace("+0 laps", "running")
    return { pos, name: car.name, short: car.short, isPlayer: car.isPlayer, color: car.color, bestLapMs: car.bestLapMs, bestLap: formatMs(car.bestLapMs), gap, boosts: car.boostsUsed, glitches: car.glitches, finished: car.finished }
  })
}
