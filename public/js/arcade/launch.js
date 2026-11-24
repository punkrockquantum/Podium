/**
 * Hand-off between the planning tool (the simulator) and the arcade.
 *
 * Contract: sessionStorage["podium.arcade.car"] holds a JSON car spec
 *   { season: 2027|2028, label, secondsPerLapVsToday, effectiveMauh, allowanceUsedPct, availabilityPct,
 *     dataToDecisionS, location, drivers?: [{ name, seconds }] }
 * The simulator's "Race now" button calls `launchRace(car)`; the arcade calls `readCar()`, which also
 * accepts URL query fallbacks (?season=2028&adv=0.39&avail=99.98&loop=4.8&label=...&mauh=7.2&used=94)
 * and returns null when nothing was handed over, in which case the arcade shows its car picker with
 * three built-in cars computed live from public/js/sim/model.js (or from the static figures below
 * when the model cannot be loaded, e.g. over file://).
 */
export const CAR_KEY = "podium.arcade.car"
export const ARCADE_URL = "/arcade.html"
export const SEASONS = [2027, 2028]

/** The simulator's three presets as the arcade knew them on 24 Nov 2026 (P8, 60 % confidence, inside the 500 kW envelope). */
export const BUILT_IN_FALLBACK = Object.freeze([
  { id: "today", season: 2027, label: "Today: Hinwil on-prem", short: "Today", secondsPerLapVsToday: 0, effectiveMauh: 3.84, allowanceUsedPct: 98.8, availabilityPct: 99.39, dataToDecisionS: 6.34, location: "Hinwil" },
  { id: "dr2027", season: 2027, label: "Digital Realty Zurich 2027", short: "DR 2027", secondsPerLapVsToday: 0.14, effectiveMauh: 6.15, allowanceUsedPct: 98.8, availabilityPct: 99.89, dataToDecisionS: 4.84, location: "Digital Realty Zurich" },
  { id: "gl2028", season: 2028, label: "Digital Realty + HPE GreenLake 2028", short: "DR + GreenLake 2028", secondsPerLapVsToday: 0.43, effectiveMauh: 7.21, allowanceUsedPct: 93.6, availabilityPct: 99.98, dataToDecisionS: 4.84, location: "Digital Realty Zurich" },
])

const num = (v, fallback) => {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v)
  return Number.isFinite(n) ? n : fallback
}
const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

/** A clean car spec from anything shaped like one, or null when there is no usable car in it. */
export function normalizeCar(raw) {
  if (!raw || typeof raw !== "object") return null
  const season = SEASONS.includes(num(raw.season, NaN)) ? num(raw.season, 2027) : 2027
  const adv = num(raw.secondsPerLapVsToday ?? raw.adv, NaN)
  const avail = num(raw.availabilityPct ?? raw.avail, NaN)
  const loop = num(raw.dataToDecisionS ?? raw.loop, NaN)
  if (![adv, avail, loop].some(Number.isFinite) && !raw.label) return null
  const spec = {
    season,
    label: text(raw.label, 48) || (season === 2028 ? "2028 season car" : "2027 season car"),
    short: text(raw.short, 20) || undefined,
    secondsPerLapVsToday: round(Math.min(1, Math.max(-1, Number.isFinite(adv) ? adv : 0)), 3),
    effectiveMauh: Number.isFinite(num(raw.effectiveMauh ?? raw.mauh, NaN)) ? round(num(raw.effectiveMauh ?? raw.mauh, 0), 2) : undefined,
    allowanceUsedPct: Number.isFinite(num(raw.allowanceUsedPct ?? raw.used, NaN)) ? round(num(raw.allowanceUsedPct ?? raw.used, 0), 1) : undefined,
    availabilityPct: round(Math.min(100, Math.max(90, Number.isFinite(avail) ? avail : 99.4)), 3),
    dataToDecisionS: round(Math.min(12, Math.max(2, Number.isFinite(loop) ? loop : 6.3)), 2),
    location: text(raw.location, 40) || undefined,
  }
  if (Array.isArray(raw.drivers)) spec.drivers = raw.drivers.slice(0, 4).map((d) => ({ name: text(d?.name, 32), seconds: num(d?.seconds, 0) })).filter((d) => d.name)
  if (typeof raw.id === "string") spec.id = text(raw.id, 16)
  for (const key of Object.keys(spec)) if (spec[key] === undefined) delete spec[key]
  return spec
}

/** The simulator calls this: store the car and open the arcade. Returns the stored spec. */
export function launchRace(car, { navigate = true, storage = globalThis.sessionStorage, location = globalThis.location } = {}) {
  const spec = normalizeCar(car)
  if (!spec) throw new Error("launchRace needs a car spec")
  try {
    storage?.setItem(CAR_KEY, JSON.stringify(spec))
  } catch {}
  if (navigate && location) location.assign(ARCADE_URL)
  return spec
}

/** The car handed over to this page: sessionStorage first, then the URL query, else null. */
export function readCar({ storage = globalThis.sessionStorage, search = globalThis.location?.search || "" } = {}) {
  try {
    const stored = storage?.getItem(CAR_KEY)
    if (stored) {
      const spec = normalizeCar(JSON.parse(stored))
      if (spec) return spec
    }
  } catch {}
  const q = new URLSearchParams(search)
  if (!q.has("season") && !q.has("adv") && !q.has("label")) return null
  return normalizeCar({ season: q.get("season"), adv: q.get("adv"), avail: q.get("avail"), loop: q.get("loop"), label: q.get("label"), mauh: q.get("mauh"), used: q.get("used"), location: q.get("location") })
}

/** Forget the handed-over car (so the picker shows again). */
export function clearCar({ storage = globalThis.sessionStorage } = {}) {
  try {
    storage?.removeItem(CAR_KEY)
  } catch {}
}

/**
 * The three built-in cars, computed from the planning model when it loads (so they always match
 * what the simulator shows), else the static figures.
 */
export async function builtInCars(loadModel = () => import("../sim/model.js")) {
  try {
    const m = await loadModel()
    const cars = m.PRESET_ORDER.map((id) => {
      const inputs = m.presetInputs(id)
      const r = m.evaluate(inputs)
      return normalizeCar({
        id,
        season: inputs.season,
        label: m.PRESETS[id].label,
        short: m.PRESETS[id].short,
        secondsPerLapVsToday: r.perf.sec,
        effectiveMauh: r.scenario.comp.effectiveMauh,
        allowanceUsedPct: r.scenario.comp.usage * 100,
        availabilityPct: r.scenario.comp.availabilityPct,
        dataToDecisionS: r.scenario.net.venue.decisionSec,
        location: inputs.location === "hinwil" ? "Hinwil" : inputs.location === "hybrid" ? "Hybrid (Hinwil + Digital Realty Zurich)" : "Digital Realty Zurich",
      })
    })
    if (cars.length === 3 && cars.every((c) => c && Number.isFinite(c.secondsPerLapVsToday) && Number.isFinite(c.availabilityPct))) return cars
  } catch {}
  return BUILT_IN_FALLBACK.map((c) => normalizeCar(c))
}

/** One plain sentence on why the season matters for this car. */
export function seasonNote(spec) {
  if (!spec || spec.secondsPerLapVsToday === 0) return "Today's cluster runs flat out against the allowance in the Hinwil room on a single power feed: the baseline every car is measured against."
  if (spec.season >= 2028) return "From 1 January 2028 the FIA lets GPU cores run the Restricted CFD solver (F4.4.1), so the same allowance buys more aero work: the bigger step."
  return "In 2027 the solver is CPU-only: the gain comes from a faster fabric, better storage and a 2N site that loses no allowance to outages."
}

/** 99.886 → "99.9 %", 99.983 → "99.98 %". */
export const availabilityText = (pct) => `${Number(pct) >= 99.95 ? Number(pct).toFixed(2) : Number(pct).toFixed(1)} %`
export const advantageText = (sec) => `${sec > 0 ? "+" : ""}${Number(sec).toFixed(2)} s/lap`
