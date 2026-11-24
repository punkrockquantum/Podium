/**
 * Deployment timeline: the FIA calendar (Aerodynamic Testing Periods, shutdowns, pre-season, GPU legality)
 * and the plan's milestones (contract, fit-out, fibre, hardware, burn-in, parallel running, cutover,
 * re-declaration, 2028 step-up) with their consequences for each season's allowance. Pure functions, no DOM.
 *
 * Dates are UTC midnight timestamps inside this module and "YYYY-MM-DD" strings in the plan.
 * Every constant comes from assumptions.js (`K.timeline`) and is keyed to docs/audi-f1-sources.md.
 */
import { K } from "./assumptions.js"

const DAY = 86_400_000
const T = K.timeline
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

export function parseDate(s, fallback = null) {
  if (typeof s === "number" && Number.isFinite(s)) return s
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""))
  if (!m) return fallback
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms : fallback
}
export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (ms, d) => ms + d * DAY
export const addWeeks = (ms, w) => ms + w * 7 * DAY
export const daysBetween = (a, b) => Math.round((b - a) / DAY)
export const weeksBetween = (a, b) => (b - a) / (7 * DAY)
export const yearOf = (ms) => new Date(ms).getUTCFullYear()
export const daysInYear = (year) => daysBetween(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1))
export function fmtDate(ms, { year = true, short = false } = {}) {
  if (!Number.isFinite(ms)) return "—"
  const d = new Date(ms)
  const y = year ? ` ${short ? String(d.getUTCFullYear()).slice(2) : d.getUTCFullYear()}` : ""
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${y}`
}
export const PLANNING_DATE = parseDate(T.planningDate)

// ---------------------------------------------------------------------------------------------
// FIA calendar
// ---------------------------------------------------------------------------------------------

/** Monday of week 1: the week containing 4 January (the first week with four or more days, F4.1.4 / ISO 8601). */
export function week1Monday(year) {
  const jan4 = Date.UTC(year, 0, 4)
  const dow = (new Date(jan4).getUTCDay() + 6) % 7
  return jan4 - dow * DAY
}

/** The six ATPs of a year per F4.1.4: P1 1 Jan → end of week 9; P2, P3, P5 8 weeks; P4 10 weeks; P6 → 31 Dec. */
export function atpCalendar(year) {
  const jan1 = Date.UTC(year, 0, 1)
  const next = Date.UTC(year + 1, 0, 1)
  const p2 = addWeeks(week1Monday(year), 9)
  const starts = [jan1, p2, addWeeks(p2, 8), addWeeks(p2, 16), addWeeks(p2, 26), addWeeks(p2, 34)]
  return starts.map((start, i) => {
    const end = i < 5 ? starts[i + 1] : next
    return { id: `${year}-P${i + 1}`, year, index: i + 1, label: `ATP ${i + 1}`, start, end, days: daysBetween(start, end), weeks: round(daysBetween(start, end) / 7, 1) }
  })
}

/** The two shutdowns of a year (F3.1.1): CFD compute may not run, so a move inside them wastes no allowance. */
export function shutdowns(year) {
  const summerStart = parseDate(T.summerShutdown[year]) ?? Date.UTC(year, 7, 1)
  const winterStart = Date.UTC(year, Number(T.winterShutdown.monthDay.slice(0, 2)) - 1, Number(T.winterShutdown.monthDay.slice(3)))
  return [
    { id: `summer-${year}`, kind: "summer", label: "Summer shutdown", start: summerStart, end: addDays(summerStart, T.summerShutdown.days), rule: "F3.1.1.a", status: "ASSUMPTION" },
    { id: `winter-${year}`, kind: "winter", label: "Winter shutdown", start: winterStart, end: addDays(winterStart, T.winterShutdown.days), rule: "F3.1.1.b", status: "VERIFIED" },
  ]
}

export function preSeason(year) {
  const p = T.preSeason[year]
  if (!p) return null
  return { year, testStart: parseDate(p.testStart), testEnd: addDays(parseDate(p.testEnd), 1), round1: parseDate(p.round1) }
}

export const GPU_LEGAL_FROM = parseDate(T.gpuLegalFrom)

/** The ATP a date falls in, with its position inside the period. */
export function atpAt(ms) {
  const year = yearOf(ms)
  const atp = atpCalendar(year).find((p) => ms >= p.start && ms < p.end) || atpCalendar(year)[5]
  const dayIndex = daysBetween(atp.start, ms)
  return { atp, dayIndex, atBoundary: dayIndex === 0, daysLeft: atp.days - dayIndex }
}

export function shutdownAt(ms) {
  const year = yearOf(ms)
  return [...shutdowns(year - 1), ...shutdowns(year)].find((s) => ms >= s.start && ms < s.end) || null
}

/** The first ATP boundary at or after `ms`. */
export function nextBoundary(ms) {
  const year = yearOf(ms)
  const starts = [...atpCalendar(year), ...atpCalendar(year + 1)].map((p) => p.start)
  return starts.find((s) => s >= ms)
}

/** ATP report deadline (F4.6.4) for the period containing `ms`: 14 days after the period ends. */
export const atpReportDue = (ms) => addDays(atpAt(ms).atp.end - DAY, T.atpReportDays)

/** Re-declaration deadline (F4.4.3): one month after the change or the next ATP report, whichever is earlier. */
export const declarationDue = (changeMs) => Math.min(addDays(changeMs, T.declarationDays), atpReportDue(changeMs))

/** Cutover choices for the "When do we move?" card: every ATP boundary of 2027, the summer shutdown and 1 Jan 2028. */
export function cutoverOptions() {
  const out = []
  for (const p of atpCalendar(2027)) out.push({ value: isoDate(p.start), label: `${p.label} · ${fmtDate(p.start, { year: false })}`, kind: "boundary", atp: p })
  const summer = shutdowns(2027)[0]
  out.splice(4, 0, { value: isoDate(summer.start), label: `Shutdown · ${fmtDate(summer.start, { year: false })}`, kind: "shutdown" })
  out.push({ value: isoDate(Date.UTC(2028, 0, 1)), label: "ATP 1 · 1 Jan 28", kind: "boundary", atp: atpCalendar(2028)[0] })
  return out
}

// ---------------------------------------------------------------------------------------------
// The plan's schedule
// ---------------------------------------------------------------------------------------------

export const TIMELINE_DEFAULTS = Object.freeze({ contractDate: "2026-12-15", cutoverDate: "2027-05-03", parallelWeeks: 2, stepUpDate: "2028-01-01" })
export const TIMELINE_RANGE = Object.freeze({
  contractDate: ["2026-11-24", "2027-12-31"],
  cutoverDate: ["2027-01-01", "2028-12-31"],
  stepUpDate: ["2027-07-01", "2028-12-31"],
  parallelWeeks: [0, 8],
})

export function normalizeTimeline(raw = {}) {
  const r = raw || {}
  const date = (key) => {
    const [lo, hi] = TIMELINE_RANGE[key].map((d) => parseDate(d))
    return isoDate(clamp(parseDate(r[key], parseDate(TIMELINE_DEFAULTS[key])), lo, hi))
  }
  const pw = Number(r.parallelWeeks)
  return {
    contractDate: date("contractDate"),
    cutoverDate: date("cutoverDate"),
    stepUpDate: date("stepUpDate"),
    parallelWeeks: Number.isFinite(pw) ? clamp(Math.round(pw), ...TIMELINE_RANGE.parallelWeeks) : TIMELINE_DEFAULTS.parallelWeeks,
  }
}

const task = (id, label, owner, start, end, extra = {}) => ({ id, label, owner, start, end, weeks: round(weeksBetween(start, end), 1), status: "ok", ...extra })
const milestone = (id, label, date, extra = {}) => ({ id, label, date, status: "ok", ...extra })

/**
 * The lead times that apply to a season's estate: what has to be delivered before the cluster can be declared.
 * Returns the parallel tasks from `from` and the date everything is ready for burn-in.
 */
function leadTasks(prefix, from, { x, atDr, fitOutNeeded, fibreNeeded, hardwareNeeded, worksNeeded, expansion }) {
  const L = T.leadWeeks
  const tasks = []
  if (atDr && fitOutNeeded) tasks.push(task(`${prefix}-fitout`, expansion ? "Step-up fit-out: liquid rows, CDUs and power whips" : x.cooling === "dlc" ? "Digital Realty fit-out: suite, power whips, liquid loop and CDUs" : "Digital Realty fit-out: suite or cage, racks, power whips", "dr", from, addWeeks(from, expansion ? L.expansion : x.cooling === "dlc" ? L.fitOutLiquid : L.fitOut), { path: "fitout" }))
  if (atDr && fibreNeeded) tasks.push(task(`${prefix}-fibre`, `Dark fibre Hinwil ↔ Zurich campus (${x.fibrePairs === 2 ? "two diverse routes" : "one route"})`, "carrier", from, addWeeks(from, L.fibre + (x.fibrePairs === 2 ? L.fibreSecondRoute : 0)), { path: "fibre" }))
  if (hardwareNeeded) tasks.push(task(`${prefix}-hardware`, x.consumption === "greenlake" ? "HPE GreenLake capacity delivered (pre-staged, buffer)" : "HPE hardware delivered (built to order)", "hpe", from, addWeeks(from, L[x.consumption] || L.buy), { path: "hardware" }))
  if (!atDr && worksNeeded) tasks.push(task(`${prefix}-works`, x.cooling === "dlc" ? "Hinwil liquid loop" : "Hinwil rear-door branch and chilled-water", "team", from, addWeeks(from, L.hinwilWorks), { path: "works" }))
  const fitOut = tasks.find((t) => t.path === "fitout")
  if (fitOut && !expansion) tasks.push(task(`${prefix}-xc`, "Cross-connects and campus connectivity", "dr", fitOut.end, addWeeks(fitOut.end, L.crossConnects), { path: "fitout" }))
  // Burn-in needs the room and the hardware; the cutover also needs the fibre.
  const roomAndKit = tasks.filter((t) => t.path !== "fibre")
  const readyForBurnIn = roomAndKit.length ? Math.max(...roomAndKit.map((t) => t.end)) : from
  const ready = tasks.length ? Math.max(...tasks.map((t) => t.end)) : from
  const critical = tasks.length ? tasks.reduce((a, b) => (b.end > a.end ? b : a)).path : null
  return { tasks, ready, readyForBurnIn, critical }
}

const slipText = (days) => (days >= 14 ? `${Math.round(days / 7)} wk` : `${days} day${days === 1 ? "" : "s"}`)

const PATH_LABEL = { fitout: "the Digital Realty fit-out", fibre: "the dark fibre", hardware: "the HPE delivery", works: "the Hinwil works" }

/**
 * Build the timeline for a plan. `ctx` carries the two seasons' normalised inputs and what changes between
 * today, 2027 and 2028 (plan.js works that out); `sims` carry the yearly IT charges for the early-step-up cost.
 */
export function buildTimeline(tlRaw, ctx) {
  const tl = normalizeTimeline(tlRaw)
  const { x27, x28, changes27, stepUp, cpuChange28, stepUpFitOutNeeded, itYearly27 = 0, itYearly28 = 0 } = ctx
  const contract = Math.max(parseDate(tl.contractDate), PLANNING_DATE)
  const plannedCutover = parseDate(tl.cutoverDate)
  const plannedStepUp = parseDate(tl.stepUpDate)
  const parallelWeeks = tl.parallelWeeks
  const jan2027 = Date.UTC(2027, 0, 1)
  const jan2028 = Date.UTC(2028, 0, 1)
  const end2028 = Date.UTC(2029, 0, 1)
  const flags = []
  const flag = (id, level, season, title, detail = "", rule = "") => flags.push({ id, level, season, title, detail, rule, route: "deployment" })
  const tasks = []
  const milestones = []
  const oneOffs = []

  // ------------------------------------------------------------ 2027: the move (or the new estate at Hinwil)
  const atDr27 = x27.location !== "hinwil"
  let s27 = { changes: changes27, goLive: null, planned: plannedCutover, feasible: null, slipDays: 0, shareOld: 0, shareNew: 1, downtimeDays: 0, periodLoss: 0, seasonLoss: 0, atp: null, atBoundary: false, shutdown: null, critical: null, late: false, declarationDue: null, signBy: {} }
  if (changes27) {
    milestones.push(milestone("contract", "Contract signature", contract, { owner: "team" }))
    const lead = leadTasks("y27", contract, { x: x27, atDr: atDr27, fitOutNeeded: true, fibreNeeded: true, hardwareNeeded: true, worksNeeded: x27.cooling !== "air" || x27.hinwilRetrofit, expansion: false })
    tasks.push(...lead.tasks)
    const burnIn = task("y27-burnin", "Acceptance, benchmarks and burn-in", "hpe", lead.readyForBurnIn, addWeeks(lead.readyForBurnIn, T.leadWeeks.burnIn), { path: "burnin" })
    tasks.push(burnIn)
    const feasible = addWeeks(Math.max(burnIn.end, lead.ready), parallelWeeks)
    const goLive = Math.max(plannedCutover, feasible)
    const slipDays = Math.max(0, daysBetween(plannedCutover, goLive))
    const criticalPath = lead.ready > burnIn.end ? lead.critical : lead.critical === "fibre" ? (lead.tasks.filter((t) => t.path !== "fibre").reduce((a, b) => (b.end > a.end ? b : a), { end: -Infinity }).path || lead.critical) : lead.critical
    if (parallelWeeks > 0) tasks.push(task("y27-parallel", `Parallel running (${parallelWeeks} wk)`, "team", addWeeks(goLive, -parallelWeeks), goLive, { path: "parallel" }))
    const pos = atpAt(goLive)
    const shutdown = shutdownAt(goLive)
    const downtimeDays = pos.atBoundary || shutdown ? 0 : parallelWeeks > 0 ? T.switchDays : T.cutoverDowntimeDays
    const periodLoss = downtimeDays / pos.atp.days
    const seasonLoss = goLive < jan2028 && goLive >= jan2027 ? periodLoss / 6 : 0
    const shareOld = clamp(daysBetween(jan2027, goLive) / daysInYear(2027), 0, 1)
    const totalWeeks = weeksBetween(contract, feasible)
    const signBy = {}
    for (const opt of cutoverOptions()) signBy[opt.value] = addWeeks(parseDate(opt.value), -totalWeeks)
    milestones.push(milestone("cutover", atDr27 ? "Cutover: Restricted CFD runs at Digital Realty Zurich" : "New estate live in the Hinwil room", goLive, { owner: "team", status: slipDays > 0 ? "warn" : "ok" }))
    const declDue = declarationDue(goLive)
    milestones.push(milestone("declaration", "New F4.4.3 declaration due", declDue, { owner: "fia", rule: "F4.4.3" }))
    s27 = { ...s27, goLive, feasible, slipDays, shareOld, shareNew: 1 - shareOld, downtimeDays, periodLoss, seasonLoss, atp: pos.atp, atBoundary: pos.atBoundary, shutdown, critical: criticalPath, declarationDue: declDue, signBy, totalWeeks: round(totalWeeks, 1), slackDays: Math.max(0, daysBetween(feasible, plannedCutover)) }
    if (parallelWeeks > 0) oneOffs.push({ id: "parallel", label: `Parallel running (${parallelWeeks} wk)`, chf: parallelWeeks * T.parallelRunningCHFPerWeek, year: yearOf(goLive), cap: "included", why: "Operating cost in the year of the move" })

    const pre = preSeason(2027)
    if (slipDays > 0) flag("slip", "warn", 2027, `${atDr27 ? "Cutover" : "Go-live"} slips ${slipText(slipDays)} to ${fmtDate(goLive)}`, `${PATH_LABEL[criticalPath] || "The lead time"} is the critical path from a ${fmtDate(contract)} contract; the ${fmtDate(plannedCutover)} target cannot be met. Sign by ${fmtDate(addDays(contract, -slipDays))} to hold it.`, "")
    if (goLive >= jan2028) flag("late27", "bad", 2027, "The 2027 estate is not live in 2027", `Go-live ${fmtDate(goLive)}: every 2027 period runs on today's setup.`, "F4.1.4")
    else if (goLive > pre.round1) flag("late27", "warn", 2027, `Live ${fmtDate(goLive)}, after Round 1 (${fmtDate(pre.round1, { year: false })})`, `${Math.round(shareOld * 100)} % of the 2027 season (${pos.atp.index > 1 ? `ATPs 1–${pos.atp.index - (pos.atBoundary ? 1 : 0)}` : "part of ATP 1"}) runs on today's setup. Sign by ${fmtDate(signBy["2027-03-08"])} to make ATP 2.`, "F4.1.4")
    else if (goLive > pre.testStart) flag("late27", "warn", 2027, `Live ${fmtDate(goLive)}, after the pre-season test`, `ATP 1 runs on today's setup (${Math.round(shareOld * 100)} % of the season).`, "F4.1.4")
    if (seasonLoss > 0) flag("midatp", parallelWeeks > 0 ? "info" : "warn", 2027, `Cutover inside ${pos.atp.label} (${fmtDate(goLive)}): ≈ ${round(periodLoss * 100, 1)} % of the period's allowance lost`, `${downtimeDays} solver day${downtimeDays === 1 ? "" : "s"} of a use-it-or-lose-it allowance${parallelWeeks > 0 ? " (parallel running keeps it to a one-day switch)" : "; parallel running or a move at the period boundary avoids it"}. Next boundary: ${fmtDate(nextBoundary(goLive))}.`, "F4.6.1")
    else if (shutdown) flag("shutdown", "info", 2027, `Cutover in the ${shutdown.label.toLowerCase()} (${fmtDate(goLive)}): no allowance lost`, "CFD compute may not run during the shutdown except for system upgrades and maintenance (F3.1.2.b, F3.1.4.d).", "F3.1.1")
    else if (pos.atBoundary) flag("boundary", "ok", 2027, `Cutover at the ${pos.atp.label} boundary (${fmtDate(goLive)}): no allowance lost`, "The previous period's allowance is used up before the switch; the new declaration follows within a month.", "F4.4.3")
    flag("declare", "info", 2027, `F4.4.3 declaration due by ${fmtDate(declDue)}`, "Within one month of the change or at the ATP report (14 days after the period ends), whichever is earlier.", "F4.4.3")
  }

  // ------------------------------------------------------------ 2028: the step-up (GPU partition, power, refresh)
  let s28 = { changes: stepUp, goLive: null, planned: plannedStepUp, feasible: null, orderBy: null, slipDays: 0, shareOld: 0, shareNew: 1, downtimeDays: 0, periodLoss: 0, seasonLoss: 0, atp: null, atBoundary: false, shutdown: null, critical: null, earlyDays: 0, earlyCostCHF: 0, declarationDue: null }
  if (stepUp) {
    const hardwareNeeded = ["nodes", "coresPerNode", "clockGHz", "memoryGB", "interconnect", "storage", "gpus", "gpuModel", "consumption"].some((k) => x28[k] !== x27[k])
    const fitOutNeeded = Boolean(stepUpFitOutNeeded)
    const L = T.leadWeeks
    const total = Math.max(fitOutNeeded ? L.expansion : 0, hardwareNeeded ? L[x28.consumption] || L.buy : 0) + (hardwareNeeded || fitOutNeeded ? L.burnIn : 0)
    const orderBy = addWeeks(plannedStepUp, -total)
    // Order no earlier than the planning date, and not before the 2027 estate itself is on its way in
    const orderAt = Math.max(orderBy, PLANNING_DATE, changes27 ? contract : PLANNING_DATE)
    const lead = leadTasks("y28", orderAt, { x: x28, atDr: x28.location !== "hinwil", fitOutNeeded, fibreNeeded: false, hardwareNeeded, worksNeeded: false, expansion: true })
    tasks.push(...lead.tasks)
    let ready = lead.ready
    if (lead.tasks.length) {
      const burnIn = task("y28-burnin", "Step-up burn-in", "hpe", lead.ready, addWeeks(lead.ready, L.burnIn), { path: "burnin" })
      tasks.push(burnIn)
      ready = burnIn.end
    }
    const goLive = Math.max(plannedStepUp, ready, s27.goLive || PLANNING_DATE)
    const slipDays = Math.max(0, daysBetween(plannedStepUp, goLive))
    milestones.push(milestone("stepup-order", "Order the 2028 step-up", orderAt, { owner: "team", status: orderBy < PLANNING_DATE ? "warn" : "ok" }))
    milestones.push(milestone("stepup", x28.solverGpus > 0 || x28.gpus > x27.gpus ? "2028 step-up live: GPU partition in service" : "2028 step-up live", goLive, { owner: "team", status: slipDays > 0 ? "warn" : "ok" }))
    const pos = atpAt(goLive)
    const shutdown = shutdownAt(goLive)
    const downtimeDays = cpuChange28 && !pos.atBoundary && !shutdown ? (parallelWeeks > 0 ? T.switchDays : T.cutoverDowntimeDays) : 0
    const periodLoss = downtimeDays / pos.atp.days
    const inSeason = goLive >= jan2028 && goLive < end2028
    const seasonLoss = inSeason ? periodLoss / 6 : 0
    const shareOld = clamp(daysBetween(jan2028, goLive) / daysInYear(2028), 0, 1)
    const earlyDays = Math.max(0, daysBetween(goLive, GPU_LEGAL_FROM))
    const chargeableWeeks = Math.max(0, earlyDays / 7 - T.earlyStepUpBurnInWeeks)
    const earlyCostCHF = Math.round(Math.max(0, itYearly28 - itYearly27) * (chargeableWeeks / 52))
    const declDue = declarationDue(goLive)
    milestones.push(milestone("declaration28", "F4.4.3 declaration for the step-up", declDue, { owner: "fia", rule: "F4.4.3" }))
    s28 = { ...s28, goLive, feasible: ready, orderBy, orderAt, slipDays, shareOld, shareNew: 1 - shareOld, downtimeDays, periodLoss, seasonLoss, atp: pos.atp, atBoundary: pos.atBoundary, shutdown, critical: lead.critical, earlyDays, earlyCostCHF, declarationDue: declDue, totalWeeks: round(total, 1), hardwareNeeded, fitOutNeeded }
    if (earlyCostCHF > 0) oneOffs.push({ id: "early", label: `Early step-up carrying cost (${Math.round(earlyDays / 7)} wk before 1 Jan 2028)`, chf: earlyCostCHF, year: 2027, cap: "included", why: "GreenLake charge or depreciation without ATR value before GPUs are allowed (F4.4.1)" })

    const pre = preSeason(2028)
    if (slipDays > 0) flag("slip28", "warn", 2028, `Step-up slips ${slipText(slipDays)} to ${fmtDate(goLive)}`, `${total} weeks of lead time (${fitOutNeeded ? "step-up fit-out, " : ""}${hardwareNeeded ? "delivery, " : ""}burn-in) from ${fmtDate(orderAt)}; the ${fmtDate(plannedStepUp)} target needed an order by ${fmtDate(orderBy)}.`, "")
    else if (daysBetween(PLANNING_DATE, orderBy) <= 120) flag("order28", "info", 2028, `Order the 2028 step-up by ${fmtDate(orderBy)}`, `${total} weeks of lead time before the ${fmtDate(plannedStepUp)} target.`, "")
    if (goLive > pre.round1) flag("late28", "bad", 2028, `GPU partition live ${fmtDate(goLive)}, after Round 1 2028`, `${Math.round(shareOld * 100)} % of 2028 runs on the 2027 estate.`, "F4.4.1")
    else if (goLive > jan2028) flag("late28", "warn", 2028, `2028 step-up live ${fmtDate(goLive)}: ${Math.round(shareOld * 100)} % of the season on the 2027 estate`, `GPU cores may run the solver from 1 January 2028; every week after it is allowance the step-up cannot help with.`, "F4.4.1")
    if (earlyDays > T.earlyStepUpBurnInWeeks * 7) flag("early28", "warn", 2028, `Step-up live ${Math.round(earlyDays / 7)} wk before GPUs are allowed`, `${fmtDate(goLive)}: ≈ CHF ${Math.round(earlyCostCHF / 1000)}k of charge without ATR value (the first ${T.earlyStepUpBurnInWeeks} weeks count as burn-in).`, "F4.4.1")
    else if (earlyDays > 0) flag("early28", "info", 2028, `${Math.round(earlyDays / 7)} wk of burn-in before 1 January 2028`, "Delivered early enough to benchmark and declare before the first 2028 period.", "F4.4.1")
    if (seasonLoss > 0) flag("midatp28", "warn", 2028, `CPU estate swapped inside ${pos.atp.label} (${fmtDate(goLive)}): ≈ ${round(periodLoss * 100, 1)} % of the period's allowance lost`, "Place the swap at a period boundary or in a shutdown.", "F4.6.1")
  }

  // ------------------------------------------------------------ calendar bands and markers
  const atps = [...atpCalendar(2027), ...atpCalendar(2028)]
  const windows = [...shutdowns(2026).slice(1), ...shutdowns(2027), ...shutdowns(2028)]
  const markers = []
  for (const y of [2027, 2028]) {
    const pre = preSeason(y)
    markers.push({ id: `test-${y}`, label: `Pre-season test ${y}`, date: pre.testStart, end: pre.testEnd, kind: "test", status: y === 2027 ? "VERIFIED" : "ASSUMPTION" })
    markers.push({ id: `round1-${y}`, label: `Round 1 · ${y}`, date: pre.round1, kind: "race", status: y === 2027 ? "VERIFIED" : "ASSUMPTION" })
  }
  markers.push({ id: "gpu", label: "GPU solver allowed (F4.4.1)", date: GPU_LEGAL_FROM, kind: "rule", status: "VERIFIED" })
  markers.push({ id: "today", label: "Today", date: PLANNING_DATE, kind: "today", status: "VERIFIED" })
  if (changes27 && s27.goLive) {
    const refreshYears = x28.refreshYears || x27.refreshYears
    const refresh = addDays(s27.goLive, Math.round(refreshYears * 365.25))
    milestones.push(milestone("refresh", `Next refresh (${refreshYears} yr cadence)`, refresh, { owner: "hpe", offChart: refresh >= end2028 }))
  }

  for (const t of tasks) t.status = t.path === "fibre" && s27.critical === "fibre" && s27.slipDays > 0 ? "warn" : t.status
  const worst = flags.some((f) => f.level === "bad") ? "bad" : flags.some((f) => f.level === "warn") ? "warn" : "ok"

  return {
    inputs: tl,
    range: { start: PLANNING_DATE, end: end2028 },
    atps, windows, markers, tasks, milestones, oneOffs, flags, status: worst,
    seasons: { 2027: s27, 2028: s28 },
    cutoverOptions: cutoverOptions(),
  }
}
