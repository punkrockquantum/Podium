/**
 * The tuning model: from a table's three dials to its gauges, cap bars, FIA chips and FIT score.
 * Pure and deterministic; the iPads, the host, the server, the race and the tests share it, so the
 * board a team sees is exactly the board the Architect approves and the race uses.
 *
 * FIT (0–100): every target in its zone and inside every cap scores 80–100 (more spare budget,
 * higher FIT). Otherwise FIT is 70 × the mean closeness to each target. Any cap or FIA breach caps
 * FIT at 40, so an over-cap board can never score high.
 */
import * as C from "./catalog.js"

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value))
export const millions = (value) => `$${(value / 1e6).toFixed(1)}M`
const money = (value) => (Math.abs(value) >= 1e6 ? millions(value) : `$${Math.round(value / 1e3)}k`)

export const FIT_ZONE = 80
export const FIT_BREACH_MAX = 40
const FIT_OFF_MAX = 70
/** Spare budget (share of a cap) that earns the full +20 inside the zone. */
const FULL_HEADROOM = 0.5

/** The team's choices with every missing or invalid value replaced by today's setup. */
export function choicesOf(team) {
  const out = {}
  for (const d of C.DECISIONS) {
    const value = team?.choices?.[d.id]
    out[d.id] = C.validChoice(d.id, value) ? value : d.today
  }
  return out
}

export const pickedOption = (decisionId, choices) => {
  const d = C.decision(decisionId)
  return d.options.find((o) => o.id === choices?.[decisionId]) || d.options.find((o) => o.id === d.today)
}

/** One table's raw physics: target values, money, power and FIA rules broken. */
const PHYSICS = {
  network(o) {
    const link = o("link")
    const path = o("path")
    const garage = o("garage")
    const fia = [link, garage].filter((x) => x.fia)
    return {
      values: { latency: path.ms + garage.ms, availability: link.avail, fia: fia.length === 0 },
      capex: link.capex + path.capex + garage.capex,
      opex: link.opex + path.opex + garage.opex,
      fia: fia.map((x) => ({ rule: x.fia, text: x.fiaText, dial: C.DECISIONS.find((d) => d.options.includes(x)).id })),
      notes: [],
    }
  },
  oem(o) {
    const vendor = o("vendor")
    const chosen = o("payment")
    const pay = chosen.id === "aas" && !vendor.aas ? C.decision("payment").options.find((x) => x.id === "lease") : chosen
    const support = o("support")
    const price = vendor.price
    const supportRate = pay.id === "aas" ? support.aasRate : support.rate
    return {
      values: { perf: vendor.perf, fix: support.hours, lead: pay.id === "aas" && vendor.aasLead ? vendor.aasLead : vendor.lead },
      capex: pay.id === "buy" ? price : 0,
      opex: price * (pay.rate + supportRate),
      fia: [],
      notes: pay.id !== chosen.id ? [`${vendor.name} has no as-a-service programme: this is priced as a lease.`] : [],
      payment: pay.id,
    }
  },
  dc(o) {
    const site = o("location")
    const cool = o("cooling")
    const plan = o("power")
    const station = C.byId(C.STATIONS, "dc")
    const need = station.need * plan.needMult
    const pue = Math.round((cool.pue + site.pueAdd) * 100) / 100
    const delivered = Math.min(cool.coolKW, site.siteKW / pue)
    const facilityKW = need * pue
    return {
      values: { capacity: (delivered / need) * 100, pue, nplus1: site.nplus1 },
      capex: site.capex + cool.capex,
      opex: facilityKW * site.kwPrice,
      power: { name: "Facility power vs site supply", used: facilityKW, cap: site.siteKW, unit: "kW" },
      fia: site.fia ? [{ rule: site.fia, text: site.fiaText, dial: "location" }] : [],
      notes: [],
      need,
      speed: plan.speed,
    }
  },
  compute(o) {
    const size = o("size")
    const chips = o("chips")
    const storage = o("storage")
    const station = C.byId(C.STATIONS, "compute")
    const nodes = size.nodes
    const usage = nodes * chips.capShare
    const feed = Math.min(1, storage.bandwidth / (nodes * chips.io)) * 100
    const itKW = nodes * chips.nodeKW + storage.kw
    return {
      values: { cycles: nodes * chips.cycles * (feed / 100), usage, feed },
      capex: nodes * chips.nodePrice + storage.price,
      opex: nodes * chips.nodeOpex + storage.opex,
      power: { name: "Cluster power vs the 400 kW hall", used: itKW, cap: station.hallKW, unit: "kW" },
      fia: usage > 100 ? [{ rule: "2.4", text: "FIA 2.4: aero CFD must stay inside the compute allowance.", dial: "size" }] : [],
      notes: [],
    }
  },
}

/** Closeness (0–1) of a value to its target; 1 means in the zone. */
function closeness(t, value) {
  if (t.kind === "pass") return value ? 1 : 0
  if (t.kind === "min") return value >= t.target ? 1 : clamp((value - t.lo) / (t.target - t.lo))
  return value <= t.target ? 1 : clamp((t.hi - value) / (t.hi - t.target))
}

const raw = (stationId, choices) => PHYSICS[stationId]((id) => pickedOption(id, choices))

/** Score one table's dials without hints (used by the search for hints and consequences). */
function scoreCore(stationId, choices, budgetId) {
  const station = C.byId(C.STATIONS, stationId)
  const mult = C.budgetFor(budgetId).mult
  const phys = raw(stationId, choices)
  const targets = station.targets.map((t) => {
    const value = phys.values[t.id]
    const close = closeness(t, value)
    return { id: t.id, name: t.name, kind: t.kind, target: t.target, lo: t.lo, hi: t.hi, zone: t.zone, value, display: t.fmt(value), ok: close >= 1, closeness: close }
  })
  const caps = [
    { id: "capex", name: "CapEx", used: phys.capex, cap: station.caps.capex * mult, unit: "$" },
    { id: "opex", name: "Yearly OpEx", used: phys.opex, cap: station.caps.opex * mult, unit: "$" },
  ]
  if (phys.power) caps.push({ id: "power", name: phys.power.name, used: phys.power.used, cap: phys.power.cap, unit: "kW" })
  for (const c of caps) c.over = Math.max(0, c.used - c.cap)
  const met = targets.every((t) => t.ok)
  const breached = caps.some((c) => c.over > 0) || phys.fia.length > 0
  const moneyCaps = caps.filter((c) => c.unit === "$")
  const headroom = moneyCaps.reduce((sum, c) => sum + clamp((c.cap - c.used) / c.cap / FULL_HEADROOM), 0) / moneyCaps.length
  let fit = met ? FIT_ZONE + (100 - FIT_ZONE) * headroom : FIT_OFF_MAX * (targets.reduce((sum, t) => sum + t.closeness, 0) / targets.length)
  if (breached) fit = Math.min(fit, FIT_BREACH_MAX)
  fit = Math.round(fit)
  return { phys, targets, caps, met, breached, fit, inZone: met && !breached }
}

const capText = (c) => (c.unit === "kW" ? `${Math.round(c.used)} kW of ${Math.round(c.cap)} kW` : `${money(c.used)} of ${money(c.cap)}`)

/** Every single-dial change on this table, scored. */
function alternatives(stationId, choices, budgetId) {
  const out = []
  for (const d of C.decisionsFor(stationId)) {
    for (const option of d.options) {
      if (option.id === pickedOption(d.id, choices).id) continue
      const next = { ...choices, [d.id]: option.id }
      out.push({ decision: d, option, core: scoreCore(stationId, next, budgetId) })
    }
  }
  return out.sort((a, b) => b.core.fit - a.core.fit)
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/** The best single-dial fix for one problem, phrased "a private cross-connect", or null. */
function fixFor(stationId, choices, budgetId, solved) {
  const best = alternatives(stationId, choices, budgetId).find((alt) => solved(alt.core))
  return best ? { decision: best.decision.id, option: best.option.id, as: best.option.as, fit: best.core.fit } : null
}

/** One table's full board: gauges, cap bars, FIA chips, FIT, one sentence and one hint. */
export function boardFor(stationId, choices, budgetId = C.DEFAULT_BUDGET) {
  const station = C.byId(C.STATIONS, stationId)
  const full = choicesOf({ choices })
  const core = scoreCore(stationId, full, budgetId)
  const today = scoreCore(stationId, C.BASELINE_CHOICES, budgetId)
  const targets = core.targets.map((t, i) => ({ ...t, today: today.targets[i].value, todayDisplay: today.targets[i].display }))
  const caps = core.caps.map((c, i) => {
    const out = { ...c, today: today.caps[i].used, display: capText(c) }
    if (c.over > 0) {
      const fix = fixFor(stationId, full, budgetId, (alt) => alt.caps[i].over <= 0)
      const what = c.id === "capex" ? `Over the CapEx envelope by ${money(c.over)}: the FIA would reject this budget.`
        : c.id === "opex" ? `Over the yearly OpEx allowance by ${money(c.over)}: a breach of the $215M cost cap.`
          : `Draws ${Math.round(c.used)} kW, more than the ${Math.round(c.cap)} kW available: it would trip and throttle.`
      out.consequence = `${what}${fix ? ` ${capitalise(fix.as)} would bring it back.` : ""}`
      out.fix = fix
    }
    return out
  })
  const breaches = [
    ...caps.filter((c) => c.over > 0).map((c) => ({ kind: "cap", id: c.id, title: c.id === "power" ? "Over the power limit" : `Over the ${c.id === "capex" ? "CapEx" : "OpEx"} cap`, text: c.consequence })),
    ...core.phys.fia.map((f) => ({ kind: "fia", id: `fia-${f.rule}`, rule: f.rule, dial: f.dial, title: `FIA ${f.rule}`, text: f.text })),
  ]
  const status = core.inZone ? "zone" : breaches.some((b) => b.kind === "cap") ? "over" : breaches.length ? "fia" : "off"
  const metCount = targets.filter((t) => t.ok).length
  const sentence = {
    zone: () => "In the zone and inside both caps.",
    over: () => {
      const b = breaches.find((x) => x.kind === "cap")
      return `${b.title}: ${b.id === "power" ? "the site would trip and throttle" : "the FIA would reject this budget"}.`
    },
    fia: () => `Breaks FIA ${breaches.find((b) => b.kind === "fia").rule}: a rule breach cannot win approval.`,
    off: () => `${metCount} of ${targets.length} targets in the zone, inside the caps.`,
  }[status]()

  /* One hint: the most urgent problem, and the single dial setting that fixes it. */
  let hint = null
  let hintFix = null
  const fia = breaches.find((b) => b.kind === "fia")
  const cap = caps.find((c) => c.over > 0)
  const worst = [...targets].filter((t) => !t.ok).sort((a, b) => a.closeness - b.closeness)[0]
  if (fia) {
    hintFix = fixFor(stationId, full, budgetId, (alt) => !alt.phys.fia.some((f) => f.rule === fia.rule))
    hint = `Breaks FIA ${fia.rule}${hintFix ? `: ${hintFix.as} would fix that.` : "."}`
  } else if (cap) {
    hintFix = cap.fix
    hint = cap.fix ? `${capitalise(cap.fix.as)} would bring it back under the cap line.` : cap.consequence
  } else if (worst) {
    const miss = station.targets.find((t) => t.id === worst.id).miss
    const closer = (alt) => alt.targets.find((t) => t.id === worst.id).closeness
    hintFix = fixFor(stationId, full, budgetId, (alt) => closer(alt) >= 1 && !alt.breached) || fixFor(stationId, full, budgetId, (alt) => closer(alt) >= 1)
    if (hintFix) hint = `${miss}: ${hintFix.as} would fix that.`
    else {
      const step = alternatives(stationId, full, budgetId).filter((alt) => closer(alt.core) > worst.closeness).sort((a, b) => closer(b.core) - closer(a.core))[0]
      hintFix = step ? { decision: step.decision.id, option: step.option.id, as: step.option.as, fit: step.core.fit } : null
      hint = `${miss}: ${step ? `start with ${step.option.as}, then check the other dials` : "try another dial"}.`
    }
  } else {
    const better = alternatives(stationId, full, budgetId).find((alt) => alt.core.inZone && alt.core.fit > core.fit)
    hint = better ? `In the zone. ${capitalise(better.option.as)} would leave more budget spare (FIT ${better.core.fit}).` : "In the zone with budget to spare: ready to pitch."
  }

  return {
    station: stationId,
    budget: C.budgetFor(budgetId).id,
    choices: Object.fromEntries(C.decisionsFor(stationId).map((d) => [d.id, full[d.id]])),
    targets,
    caps,
    breaches,
    notes: core.phys.notes,
    met: core.met,
    inZone: core.inZone,
    fit: core.fit,
    todayFit: today.fit,
    status,
    sentence,
    hint,
    hintFix,
    payment: core.phys.payment || null,
    speed: core.phys.speed || 1,
    values: { ...core.phys.values },
    ...outcomeOf(station, { status, inZone: core.inZone, fit: core.fit, todayFit: today.fit, targets, caps, breaches }),
  }
}

/* ------------------------------------------------------------ seconds found per lap */

/** The most one table can find: 4 tables × 0.35 s ≈ 1.4 s a lap for a perfect team. */
export const SECONDS_MAX = 0.35
const SECONDS_ZONE = 0.25
const SECONDS_OFF_MAX = 0.2

/** What a missed target costs the F1 team, in plain English. */
const IMPACT = {
  latency: "the strategy call arrives too late",
  availability: "the pit wall goes blind when a link drops",
  perf: "too few simulations per dollar",
  fix: "Saturday's failure could miss Sunday's race",
  lead: "the kit arrives after the season starts",
  capacity: "the GPUs throttle",
  pue: "the power bill eats the cost cap",
  cycles: "too few aero upgrades this season",
  feed: "nodes sit idle waiting for data",
  nplus1: "one failure stops the cluster",
}

/** A missed target in a few words, for the outcome line. */
const SHORT_MISS = {
  latency: "Latency too high",
  availability: "Link offline too often",
  perf: "Not enough performance",
  fix: "Fixes too slow",
  lead: "Kit arrives too late",
  capacity: "Not enough power and cooling",
  pue: "PUE too high",
  nplus1: "No N+1 backup",
  cycles: "Too few design cycles",
  usage: "Over the FIA compute cap",
  feed: "Storage too slow",
  fia: "Breaks an FIA rule",
}

const CAP_OUTCOME = {
  capex: "Over the CapEx cap: the FIA would reject this.",
  opex: "Over the OpEx cap: a breach of the cost cap.",
  power: "Over the power limit: the site would trip.",
}

/**
 * Seconds found per lap: 0.00 on today's setup, up to 0.20 s closing in on the targets, and
 * 0.25–0.35 s in the zone (more budget spare, more time). A cap or FIA breach is not allowed and
 * finds no time.
 */
function outcomeOf(station, b) {
  const fmt = (s) => `${s.toFixed(2)} s`
  if (b.status === "over" || b.status === "fia") {
    const cap = b.caps.find((c) => c.over > 0)
    const fia = b.breaches.find((x) => x.kind === "fia")
    return { seconds: 0, allowed: false, outcome: cap ? CAP_OUTCOME[cap.id] : `Breaks FIA ${fia.rule}: not allowed, so no time counts.` }
  }
  if (b.inZone) {
    const seconds = Math.round((SECONDS_ZONE + (SECONDS_MAX - SECONDS_ZONE) * clamp((b.fit - FIT_ZONE) / (100 - FIT_ZONE))) * 100) / 100
    return { seconds, allowed: true, outcome: `You've found ${fmt(seconds)} per lap and you're inside ${b.caps.length === 2 ? "both caps" : "every cap"}.` }
  }
  const span = Math.max(1, FIT_ZONE - Math.min(b.todayFit, FIT_ZONE - 1))
  const seconds = Math.round(SECONDS_OFF_MAX * clamp((b.fit - b.todayFit) / span) * 100) / 100
  const worst = [...b.targets].filter((t) => !t.ok).sort((x, y) => x.closeness - y.closeness)[0]
  const miss = SHORT_MISS[worst.id] || station.targets.find((t) => t.id === worst.id).miss
  return { seconds, allowed: true, outcome: `${miss}: ${IMPACT[worst.id] || "keep tuning"}. ${fmt(seconds)} found so far.` }
}

/** Seconds found per lap across the boards the race sees. */
export function secondsTotal(ev, stationIds = Object.keys(ev.boards || {})) {
  return Math.round(stationIds.reduce((sum, id) => sum + (ev.boards?.[id]?.seconds || 0), 0) * 100) / 100
}

/** Every table's board for a team (missing dials sit at today's setup). */
export function evaluate(team, budgetId = C.DEFAULT_BUDGET, stationIds = C.STATIONS.map((s) => s.id)) {
  const choices = choicesOf(team)
  const boards = Object.fromEntries(stationIds.map((id) => [id, boardFor(id, choices, budgetId)]))
  const fit = Object.fromEntries(stationIds.map((id) => [id, boards[id].fit]))
  const system = stationIds.length ? stationIds.reduce((sum, id) => sum + fit[id], 0) / stationIds.length / 100 : 0.5
  const seconds = Object.fromEntries(stationIds.map((id) => [id, boards[id].seconds]))
  return { choices, budget: C.budgetFor(budgetId).id, boards, fit, seconds, secondsTotal: secondsTotal({ boards }, stationIds), system, penalties: penaltiesFor(boards) }
}

/** FIA and cost-cap penalties the race stewards may hand out, with the chance of being caught. */
const FIA_PENALTY = {
  "5.3": { id: "tunnel", p: 0.6, points: 5, seconds: 0, text: "Only one encrypted tunnel to the factory (FIA 5.3 asks for two on separate paths)." },
  "5.2": { id: "wifi", p: 0.8, points: 6, seconds: 5, text: "Car data dumped over garage Wi-Fi instead of the wired umbilical (FIA 5.2)." },
  "4.1": { id: "nplus1", p: 0.5, points: 6, seconds: 0, text: "Race-critical infrastructure without N+1 power and cooling (FIA 4.1)." },
  "2.4": { id: "overrun", p: 0.5, points: 8, seconds: 0, text: "The cluster ran CFD beyond the FIA compute allowance (FIA 2.4)." },
}

function penaltiesFor(boards) {
  const out = []
  for (const board of Object.values(boards)) {
    for (const b of board.breaches) {
      if (b.kind === "fia" && FIA_PENALTY[b.rule]) out.push({ ...FIA_PENALTY[b.rule], station: board.station, dial: b.dial })
      if (b.kind === "cap" && b.id !== "power") out.push({ id: `${board.station}-${b.id}`, station: board.station, dial: board.caps.find((c) => c.id === b.id)?.fix?.decision || C.decisionsFor(board.station)[0].id, p: 1, points: 10, seconds: 0, text: b.text.split(":")[0] + ` at ${C.byId(C.STATIONS, board.station).name}.` })
    }
  }
  return out
}

/** A table counts only once its Architect approved the pitched board. */
export function completedStations(team, stationIds = C.STATIONS.map((s) => s.id)) {
  return stationIds.filter((id) => team?.reviews?.[id]?.status === "approved")
}

/**
 * The team as the race sees it: dials only from approved tables; every other table races on the
 * customer's existing setup. `missed` tables were never locked in; `notApproved` ones were.
 */
export function effectiveTeam(team, stationIds = C.STATIONS.map((s) => s.id)) {
  const done = new Set(completedStations(team, stationIds))
  const choices = {}
  for (const [key, value] of Object.entries(team?.choices || {})) {
    const d = C.decision(key)
    if (d && done.has(d.station)) choices[key] = value
  }
  const pending = stationIds.filter((id) => !done.has(id))
  const tried = (id) => Boolean(team?.plans?.[id] || team?.submitted?.[id] || team?.reviews?.[id])
  return { ...team, choices, approved: [...done], missed: pending.filter((id) => !tried(id)), notApproved: pending.filter(tried) }
}

/** The seconds per lap the race will use for a team: approved tables as tuned, the rest on today's setup. */
export function raceSeconds(team, budgetId = C.DEFAULT_BUDGET, stationIds = C.STATIONS.map((s) => s.id)) {
  return evaluate(effectiveTeam(team, stationIds), budgetId, stationIds).secondsTotal
}

/** Every combination of one table's three dials, scored (for the tests and the demo). */
export function allBoards(stationId, budgetId = C.DEFAULT_BUDGET) {
  const [a, b, c] = C.decisionsFor(stationId)
  const out = []
  for (const x of a.options) for (const y of b.options) for (const z of c.options) out.push(boardFor(stationId, { [a.id]: x.id, [b.id]: y.id, [c.id]: z.id }, budgetId))
  return out
}
