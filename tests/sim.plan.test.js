import test from "node:test"
import assert from "node:assert/strict"
import {
  PLAN_PRESETS, PLAN_PRESET_ORDER, SEASON_IDS, SHARED_IDS, TIMELINE_IDS, presetPlan, normalizePlan, seasonInputs,
  controlValue, setControl, detach, reattach, isDetached, setTimeline, evaluatePlan, matchingPreset, planHealth,
  envelopeLine, seasonCeilings, setControlClamped, fitPlanToEnvelope, optionFit,
} from "../public/js/sim/plan.js"
import {
  atpCalendar, week1Monday, shutdowns, atpAt, nextBoundary, declarationDue, buildTimeline, normalizeTimeline, cutoverOptions,
  parseDate, isoDate, fmtDate, GPU_LEGAL_FROM, PLANNING_DATE,
} from "../public/js/sim/timeline.js"
import { requirements, requirementDelta, serviceMap, riskRegister, solutionBrief, CHECKLIST, ROLES, HPE_FOOTNOTE } from "../public/js/sim/sa.js"
import { CONTROLS, DEFAULTS, GROUPS, evaluate, simulate, perfBlock, normalize } from "../public/js/sim/model.js"
import { K } from "../public/js/sim/assumptions.js"

const walk = (node, path, visit) => {
  if (node === null || node === undefined) return visit(path, node)
  if (typeof node === "number") return visit(path, node)
  if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`, visit))
  if (typeof node === "object") return Object.entries(node).forEach(([k, x]) => walk(x, `${path}.${k}`, visit))
  return visit(path, node)
}
const assertClean = (result, label) => walk(result, label, (path, value) => {
  if (typeof value === "number") assert.ok(!Number.isNaN(value), `${path} is NaN`)
  if (typeof value === "string") assert.ok(!/NaN|undefined/.test(value), `${path} contains NaN/undefined: ${value}`)
})

// ---------------------------------------------------------------------------------------------
// Plan shape, inheritance, detach
// ---------------------------------------------------------------------------------------------

test("plan: every control is shared, per-season or owned by the timeline, exactly once", () => {
  const all = GROUPS.flatMap((g) => g.controls.map((c) => c.id)).filter((id) => id !== "season")
  const covered = [...SEASON_IDS, ...SHARED_IDS, ...TIMELINE_IDS]
  assert.deepEqual([...covered].sort(), [...all].sort())
  assert.equal(new Set(covered).size, covered.length)
  for (const id of TIMELINE_IDS) assert.equal(CONTROLS[id].plannedBy, "timeline", `${id} is marked as planned by the timeline`)
})

test("plan: presets are full two-season plans, stable under normalisation", () => {
  assert.deepEqual(PLAN_PRESET_ORDER, ["today", "dr2027", "gl2028"])
  for (const id of PLAN_PRESET_ORDER) {
    const p = presetPlan(id)
    assert.equal(p.meta.preset, id)
    assert.ok(p.meta.name.length > 3)
    assert.deepEqual(p, normalizePlan(p), `${id} is stable`)
    assert.deepEqual(p, normalizePlan(JSON.parse(JSON.stringify(p))), `${id} round-trips through JSON`)
    assert.equal(matchingPreset(p), id)
    for (const sid of SEASON_IDS) assert.ok(sid in p.seasons[2027], `${id}: 2027 holds ${sid}`)
    for (const sid of SHARED_IDS) assert.ok(sid in p.shared, `${id}: shared holds ${sid}`)
    const x27 = seasonInputs(p, 2027)
    const x28 = seasonInputs(p, 2028)
    assert.equal(x27.season, 2027)
    assert.equal(x28.season, 2028)
    assert.deepEqual(x27, normalize(x27))
    assert.equal(x27.leadWeeks, 0, "the timeline owns delivery")
    assert.equal(x27.migrationTiming, "boundary", "the timeline owns the cutover")
  }
  assert.equal(PLAN_PRESETS.today.label, "Today: stay at Hinwil")
  assert.equal(PLAN_PRESETS.dr2027.label, "Digital Realty Zurich from 2027")
  assert.match(PLAN_PRESETS.gl2028.label, /Digital Realty Zurich 2027 \+ HPE GreenLake GPU step-up 2028/)
})

test("plan: 2028 inherits 2027 by default; 'today' and 'dr2027' have nothing detached, 'gl2028' detaches the step-up", () => {
  for (const id of ["today", "dr2027"]) {
    const p = presetPlan(id)
    assert.deepEqual(p.seasons[2028], {}, `${id}: nothing detached`)
    const x27 = seasonInputs(p, 2027)
    const x28 = seasonInputs(p, 2028)
    for (const sid of SEASON_IDS) assert.equal(x28[sid], x27[sid], `${id}: 2028 inherits ${sid}`)
  }
  const g = presetPlan("gl2028")
  assert.ok(isDetached(g, "gpus") && isDetached(g, "solverGpus") && isDetached(g, "cooling"))
  assert.equal(controlValue(g, 2027, "gpus"), 0)
  assert.equal(controlValue(g, 2028, "gpus"), 8)
  assert.equal(controlValue(g, 2027, "consumption"), "greenlake")
  assert.equal(controlValue(g, 2028, "consumption"), "greenlake", "inherited")
})

test("plan: setting a 2027 control flows into 2028 unless detached; detaching freezes 2028; reattach restores inheritance", () => {
  const p = presetPlan("dr2027")
  const a = setControl(p, 2027, "nodes", 20)
  assert.equal(controlValue(a, 2027, "nodes"), 20)
  assert.equal(controlValue(a, 2028, "nodes"), 20, "2028 follows 2027")
  assert.equal(a.meta.preset, "custom")

  const d = detach(a, "nodes")
  assert.ok(isDetached(d, "nodes"))
  assert.equal(controlValue(d, 2028, "nodes"), 20, "detach keeps the inherited value")
  const b = setControl(d, 2027, "nodes", 16)
  assert.equal(controlValue(b, 2027, "nodes"), 16)
  assert.equal(controlValue(b, 2028, "nodes"), 20, "detached 2028 no longer follows")

  const c = setControl(b, 2028, "nodes", 24)
  assert.equal(controlValue(c, 2027, "nodes"), 16, "2028 edits never touch 2027")
  assert.equal(controlValue(c, 2028, "nodes"), 24)

  const e = setControl(p, 2028, "gpus", 8)
  assert.ok(isDetached(e, "gpus"), "editing an inherited 2028 control detaches it")
  assert.equal(controlValue(e, 2027, "gpus"), 0)

  const r = reattach(c, "nodes")
  assert.ok(!isDetached(r, "nodes"))
  assert.equal(controlValue(r, 2028, "nodes"), 16)
  assert.equal(detach(p, "position"), p, "shared controls cannot be detached")
})

test("plan: normalizePlan fills, clamps and drops junk", () => {
  const p = normalizePlan({ meta: { name: "  x".repeat(80) }, shared: { position: 99, confidence: -5 }, seasons: { 2027: { nodes: 999, interconnect: "warp" }, 2028: { gpus: 500, bogus: 1, solverGpus: 3 } }, timeline: { contractDate: "garbage", parallelWeeks: 50 } })
  assert.equal(p.meta.name.length, 60)
  assert.equal(p.meta.preset, "custom")
  assert.equal(p.shared.position, 11)
  assert.equal(p.shared.confidence, 0)
  assert.equal(p.seasons[2027].nodes, CONTROLS.nodes.max)
  assert.equal(p.seasons[2027].interconnect, DEFAULTS.interconnect)
  assert.equal(p.seasons[2028].gpus, CONTROLS.gpus.max)
  assert.equal(p.seasons[2028].solverGpus, 3)
  assert.ok(!("bogus" in p.seasons[2028]))
  assert.equal(p.timeline.contractDate, "2026-12-15")
  assert.equal(p.timeline.parallelWeeks, 8)
  assert.deepEqual(normalizePlan(null).seasons[2028], {})
  assert.deepEqual(normalizePlan(undefined), normalizePlan({}))
})

// ---------------------------------------------------------------------------------------------
// Timeline math
// ---------------------------------------------------------------------------------------------

test("timeline: six ATPs a year per F4.1.4 (week 9, 8/8/10/8 weeks, to 31 Dec), summing to the year", () => {
  assert.equal(isoDate(week1Monday(2027)), "2027-01-04")
  assert.equal(isoDate(week1Monday(2028)), "2028-01-03")
  const expect = {
    2027: [["2027-01-01", "2027-03-07"], ["2027-03-08", "2027-05-02"], ["2027-05-03", "2027-06-27"], ["2027-06-28", "2027-09-05"], ["2027-09-06", "2027-10-31"], ["2027-11-01", "2027-12-31"]],
    2028: [["2028-01-01", "2028-03-05"], ["2028-03-06", "2028-04-30"], ["2028-05-01", "2028-06-25"], ["2028-06-26", "2028-09-03"], ["2028-09-04", "2028-10-29"], ["2028-10-30", "2028-12-31"]],
  }
  for (const year of [2027, 2028]) {
    const atps = atpCalendar(year)
    assert.equal(atps.length, 6)
    assert.deepEqual(atps.map((p) => [isoDate(p.start), isoDate(p.end - 86_400_000)]), expect[year])
    assert.equal(atps.reduce((s, p) => s + p.days, 0), year === 2028 ? 366 : 365)
    assert.equal(atps[1].days, 56)
    assert.equal(atps[2].days, 56)
    assert.equal(atps[3].days, 70)
    assert.equal(atps[4].days, 56)
    const summer = shutdowns(year)[0]
    assert.ok(summer.start >= atps[3].start && summer.end <= atps[3].end, "the summer shutdown falls inside ATP 4")
  }
  assert.equal(atpAt(parseDate("2027-05-03")).atBoundary, true)
  assert.equal(atpAt(parseDate("2027-06-01")).atp.index, 3)
  assert.equal(isoDate(nextBoundary(parseDate("2027-06-01"))), "2027-06-28")
  assert.equal(isoDate(nextBoundary(parseDate("2027-12-01"))), "2028-01-01")
  assert.equal(isoDate(GPU_LEGAL_FROM), "2028-01-01")
  assert.equal(isoDate(PLANNING_DATE), "2026-11-24")
  assert.equal(isoDate(declarationDue(parseDate("2027-05-03"))), "2027-06-02", "one month after the change")
  assert.equal(isoDate(declarationDue(parseDate("2027-06-20"))), "2027-07-11", "capped at the ATP report, 14 days after the period")
  assert.equal(fmtDate(parseDate("2027-05-03")), "3 May 2027")
  assert.ok(cutoverOptions().length >= 7)
})

test("timeline: a boundary cutover with parallel running loses nothing; a mid-period move without it wastes 7 of the period's days", () => {
  const ctx = (tl) => evaluatePlan(setTimeline(presetPlan("dr2027"), tl))
  const boundary = ctx({ contractDate: "2026-12-15", cutoverDate: "2027-05-03", parallelWeeks: 2 })
  const t = boundary.timeline.seasons[2027]
  assert.equal(isoDate(t.goLive), "2027-05-03")
  assert.equal(t.atBoundary, true)
  assert.equal(t.downtimeDays, 0)
  assert.equal(t.seasonLoss, 0)
  assert.ok(boundary.timeline.flags.some((f) => f.id === "boundary" && f.level === "ok"))
  assert.ok(boundary.timeline.flags.some((f) => f.id === "declare" && /2 Jun 2027/.test(f.title)))

  const mid = ctx({ contractDate: "2026-12-15", cutoverDate: "2027-06-01", parallelWeeks: 0 })
  const m = mid.timeline.seasons[2027]
  assert.equal(m.atp.index, 3)
  assert.equal(m.downtimeDays, K.timeline.cutoverDowntimeDays)
  assert.equal(Math.round(m.periodLoss * 1000) / 1000, Math.round((7 / 56) * 1000) / 1000)
  assert.equal(Math.round(m.seasonLoss * 1e4) / 1e4, Math.round((7 / 56 / 6) * 1e4) / 1e4)
  assert.ok(mid.timeline.flags.some((f) => f.id === "midatp" && f.level === "warn"))
  assert.ok(mid.seasons[2027].effectiveMauh < boundary.seasons[2027].effectiveMauh, "the mid-period move delivers less of the season")

  const midParallel = ctx({ contractDate: "2026-12-15", cutoverDate: "2027-06-01", parallelWeeks: 2 })
  assert.equal(midParallel.timeline.seasons[2027].downtimeDays, K.timeline.switchDays)
  assert.ok(midParallel.timeline.flags.some((f) => f.id === "midatp" && f.level === "info"))
  assert.ok(midParallel.timeline.oneOffs.some((o) => o.id === "parallel" && o.chf === 2 * K.timeline.parallelRunningCHFPerWeek))

  const summer = ctx({ contractDate: "2026-12-15", cutoverDate: K.timeline.summerShutdown[2027], parallelWeeks: 0 })
  assert.equal(summer.timeline.seasons[2027].downtimeDays, 0, "a move inside the shutdown wastes no allowance")
  assert.ok(summer.timeline.flags.some((f) => f.id === "shutdown"))
})

test("timeline: late lead times slip the cutover, flag it and cost early-season allowance", () => {
  const late = evaluatePlan(setTimeline(presetPlan("dr2027"), { contractDate: "2027-03-01", cutoverDate: "2027-03-08", parallelWeeks: 2 }))
  const t = late.timeline.seasons[2027]
  assert.ok(t.slipDays > 60, `slips ${t.slipDays} days`)
  assert.ok(t.goLive > parseDate("2027-03-08"))
  assert.ok(late.timeline.flags.some((f) => f.id === "slip" && f.level === "warn"))
  assert.ok(late.timeline.flags.some((f) => f.id === "late27"))
  assert.ok(late.seasons[2027].blend.shareOld > 0.4, "more of the season runs on today's setup")
  const early = evaluatePlan(setTimeline(presetPlan("dr2027"), { contractDate: "2026-12-15", cutoverDate: "2027-03-08", parallelWeeks: 2 }))
  assert.ok(late.seasons[2027].perf.sec < early.seasons[2027].perf.sec, "the late plan is worth less in 2027")
  assert.ok(late.seasons[2028].perf.sec >= early.seasons[2028].perf.sec - 1e-9, "2028 is unaffected once the estate is in")
  for (const tk of late.timeline.tasks) assert.ok(tk.end > tk.start && Number.isFinite(tk.weeks))
  const tl = normalizeTimeline({ cutoverDate: "2030-01-01", stepUpDate: "2020-01-01" })
  assert.equal(tl.cutoverDate, "2028-12-31")
  assert.equal(tl.stepUpDate, "2027-07-01")
})

test("timeline: the 2028 step-up is legal from 1 January 2028; an early GPU partition costs money without ATR value", () => {
  const onTime = evaluatePlan(presetPlan("gl2028"))
  const t = onTime.timeline.seasons[2028]
  assert.equal(t.changes, true)
  assert.equal(isoDate(t.goLive), "2028-01-01")
  assert.equal(t.earlyCostCHF, 0)
  assert.equal(t.seasonLoss, 0, "a boundary swap loses nothing")
  assert.ok(onTime.timeline.milestones.some((m) => m.id === "stepup" && isoDate(m.date) === "2028-01-01"))
  assert.ok(onTime.timeline.milestones.some((m) => m.id === "stepup-order"))
  assert.ok(onTime.timeline.tasks.some((tk) => tk.id === "y28-fitout"), "liquid rows need an expansion fit-out")

  const early = evaluatePlan(setTimeline(presetPlan("gl2028"), { stepUpDate: "2027-09-06" }))
  const e = early.timeline.seasons[2028]
  assert.ok(e.earlyDays > 100)
  assert.ok(e.earlyCostCHF > 0, "charge without ATR value")
  assert.ok(early.timeline.flags.some((f) => f.id === "early28" && f.level === "warn"))
  assert.ok(early.timeline.oneOffs.some((o) => o.id === "early" && o.year === 2027))
  assert.ok(early.seasons[2027].money.cash > onTime.seasons[2027].money.cash, "the carrying cost lands in 2027")
  assert.equal(early.seasons[2028].perf.sec, onTime.seasons[2028].perf.sec, "no extra ATR value before 1 January 2028")

  const lateStep = evaluatePlan(setTimeline(presetPlan("gl2028"), { stepUpDate: "2028-05-01" }))
  const l = lateStep.timeline.seasons[2028]
  assert.equal(isoDate(l.goLive), "2028-05-01")
  assert.ok(l.shareOld > 0.3)
  assert.ok(lateStep.seasons[2028].perf.sec < onTime.seasons[2028].perf.sec, "a third of 2028 on the 2027 estate is worth less")
  assert.ok(lateStep.timeline.flags.some((f) => f.id === "late28"))

  const today = evaluatePlan(presetPlan("today"))
  assert.equal(today.timeline.tasks.length, 0)
  assert.equal(today.timeline.milestones.length, 0)
  assert.equal(today.timeline.seasons[2027].changes, false)
})

test("timeline: buildTimeline is pure and deterministic", () => {
  const p = presetPlan("gl2028")
  const r1 = evaluatePlan(p)
  const r2 = evaluatePlan(p)
  assert.deepEqual(r1.timeline, r2.timeline)
  const tl = buildTimeline(p.timeline, { x27: seasonInputs(p, 2027), x28: seasonInputs(p, 2028), changes27: true, stepUp: true, cpuChange28: true, expansionNeeded: true })
  assert.equal(tl.atps.length, 12)
  assert.ok(tl.markers.some((m) => m.id === "gpu"))
  assert.ok(tl.range.start < tl.range.end)
})

// ---------------------------------------------------------------------------------------------
// Evaluation: both seasons, deltas, health
// ---------------------------------------------------------------------------------------------

test("evaluatePlan: every preset returns both seasons with finite figures and consistent deltas", () => {
  for (const id of PLAN_PRESET_ORDER) {
    const r = evaluatePlan(presetPlan(id))
    assertClean(r, id)
    for (const year of [2027, 2028]) {
      const s = r.seasons[year]
      assert.equal(s.year, year)
      assert.equal(s.inputs.season, year)
      assert.ok(Number.isFinite(s.perf.sec) && Number.isFinite(s.money.capCharge))
      assert.ok(!("points" in s.perf) && !("scenarioPosition" in s.perf) && !("ladder" in s.perf), "no position or points outcome")
      assert.ok(s.envelope && typeof s.envelope.fits === "boolean" && s.envelope.offerKW === 500)
      assert.ok(Number.isFinite(s.trackside.decisionSec) && Number.isFinite(s.trackside.weekendsAtRisk) && s.trackside.linkAvailability > 0.9)
      assert.ok(s.availabilityPct > 90 && s.availabilityPct <= 100)
      assert.ok(s.money.cash > 0)
      assert.ok(Array.isArray(s.money.oneOffs))
      assert.ok(Math.abs(s.blend.shareOld + s.blend.shareNew - 1) < 1e-6)
    }
    assert.equal(r.deltas.capCharge, r.seasons[2028].money.capCharge - r.seasons[2027].money.capCharge)
    assert.equal(r.deltas.detached.length + r.deltas.inherited.length, SEASON_IDS.length)
    assert.ok(["ok", "warn", "bad"].includes(r.health.status))
    assert.ok(r.health.headline.length > 5)
    for (const h of r.health.items) assert.ok(h.route && h.title && ["ok", "info", "warn", "bad"].includes(h.level))
    assert.equal(r.totals.cash, r.seasons[2027].money.cash + r.seasons[2028].money.cash)
    assert.ok(!("points" in r.totals), "no points total")
    assert.deepEqual(Object.keys(r.envelope).sort(), ["2027", "2028", "fits"])
    if (id !== "today") assert.equal(r.envelope.fits, true, `${id} fits the 500 kW envelope in both seasons`)
  }
})

test("evaluatePlan: 'today' is the zero line; 'dr2027' gains in both seasons; 'gl2028' adds a 2028 step-up", () => {
  const today = evaluatePlan(presetPlan("today"))
  assert.equal(today.seasons[2027].perf.sec, 0)
  assert.equal(today.seasons[2028].perf.sec, 0)
  assert.equal(today.changes27, false)
  assert.equal(today.stepUp, false)
  assert.ok(today.health.items.some((h) => h.id === "status-quo"))

  const dr = evaluatePlan(presetPlan("dr2027"))
  assert.ok(dr.seasons[2027].perf.sec > 0)
  assert.ok(dr.seasons[2028].perf.sec > dr.seasons[2027].perf.sec, "a full season on the new estate beats a partial one")
  assert.ok(dr.seasons[2027].blend.shareOld > 0.3 && dr.seasons[2027].blend.shareOld < 0.4, "cutover at ATP 3: a third of 2027 on today's setup")
  assert.equal(dr.seasons[2028].blend.shareOld, 0)
  assert.equal(dr.stepUp, false)
  assert.ok(dr.seasons[2027].money.oneOffs.some((o) => o.id === "fitout"))
  assert.ok(dr.seasons[2027].money.oneOffs.some((o) => o.id === "parallel"))
  assert.equal(dr.seasons[2028].money.oneOffs.length, 0, "no one-offs when 2028 is the same as 2027")

  const gl = evaluatePlan(presetPlan("gl2028"))
  assert.equal(gl.stepUp, true)
  assert.ok(gl.seasons[2028].sim.comp.gpuSolverN === 2, "solver GPUs are legal in 2028")
  assert.ok(gl.seasons[2028].effectiveMauh > dr.seasons[2028].effectiveMauh, "the GPU step-up adds effective work")
  assert.ok(gl.seasons[2028].perf.sec >= dr.seasons[2028].perf.sec)
  assert.ok(gl.deltas.detached.includes("gpus"))
  assert.ok(gl.seasons[2028].money.oneOffs.some((o) => o.id === "liquidrows"), "direct-liquid rows are a one-off inside the 500 kW cage")
  assert.ok(!gl.seasons[2028].money.oneOffs.some((o) => /expansion/i.test(o.id + o.label)), "no expansion-right one-off")
  assert.ok(gl.seasons[2027].sim.comp.gpuSolverN === 0, "2027 stays CPU-only")
  // Plan-level headline figures (blended by go-live) sit below the steady-state figures in 2027 and match them in 2028
  assert.ok(gl.seasons[2027].perf.sec > 0.05 && gl.seasons[2027].perf.sec < 0.12, `gl2028 2027 ≈ +0.08 s: ${gl.seasons[2027].perf.sec}`)
  assert.ok(gl.seasons[2028].perf.sec > 0.40 && gl.seasons[2028].perf.sec < 0.46, `gl2028 2028 ≈ +0.43 s: ${gl.seasons[2028].perf.sec}`)
  assert.ok(gl.seasons[2028].envelope.drIT > 395 && gl.seasons[2028].envelope.drIT <= 450, `≈ 405 kW of 500: ${gl.seasons[2028].envelope.drIT}`)
  assert.ok(dr.seasons[2027].perf.sec < evaluate(seasonInputs(presetPlan("dr2027"), 2027)).perf.sec, "part of 2027 runs on today's estate")
})

test("envelopeLine: plan-health wording and tone bands (green ≤ 450, amber 450–500, red over)", () => {
  const gl = evaluatePlan(presetPlan("gl2028"))
  const l27 = envelopeLine(gl.seasons[2027].envelope, 2027)
  assert.match(l27.text, /^Fits the 500 kW envelope: \d{3} \/ 500 kW \(2027\)$/)
  assert.equal(l27.tone, "ok")
  const amber = envelopeLine({ ...gl.seasons[2028].envelope, drIT: 470, tone: "warn", fits: true }, 2028)
  assert.equal(amber.tone, "warn")
  const over = evaluatePlan(setControl(presetPlan("gl2028"), 2028, "mlPartitionKW", 300))
  const l28 = envelopeLine(over.seasons[2028].envelope, 2028)
  assert.equal(l28.tone, "bad")
  assert.match(l28.text, /^Not possible \(2028\): .*705 kW > 500 kW offer/)
  assert.equal(over.health.status, "bad")
  assert.ok(over.health.items.some((h) => h.id === "envelope-2028" && h.level === "bad" && h.route === "facility"))
  assert.ok(!over.health.items.some((h) => h.id === "power28" && h.level === "bad"), "the envelope item replaces the raw power flag")
  const hin = envelopeLine(evaluatePlan(presetPlan("today")).seasons[2027].envelope, 2027)
  assert.match(hin.text, /Nothing at Digital Realty \(2027\)/)
})

test("ceilings and clamps at plan level: dependent re-clamps, won't-fit options and Fit to the envelope", () => {
  const gl = presetPlan("gl2028")
  const c28 = seasonCeilings(gl, 2028)
  assert.equal(c28.committedKW.max, 500)
  assert.equal(c28.mlPartitionKW.max, 75)
  assert.equal(c28.rackKW.max, 150)
  assert.equal(seasonCeilings(gl, 2027).rackKW.max, 70, "rear-door in 2027")
  // Switching 2027 to air cooling pulls rack density down to the air ceiling and says so
  const air = setControlClamped(gl, 2027, "cooling", "air")
  assert.equal(seasonInputs(air.plan, 2027).rackKW, 20)
  assert.deepEqual(air.changes.map((ch) => [ch.year, ch.id, ch.from, ch.to, ch.reason]), [[2027, "rackKW", 30, 20, "air ceiling"]])
  assert.equal(seasonInputs(air.plan, 2028).rackKW, 60, "the detached 2028 density is untouched")
  // A clock under the base clock of a part is raised to the floor
  const slow = setControl(gl, 2027, "clockGHz", 2.5)
  const arm = setControlClamped(slow, 2027, "cpuArch", "arm")
  assert.ok(seasonInputs(arm.plan, 2027).clockGHz >= 3.1, `${seasonInputs(arm.plan, 2027).clockGHz}`)
  assert.ok(arm.changes.some((ch) => ch.id === "clockGHz" && ch.year === 2027 && /base clock/.test(ch.reason)))
  assert.equal(seasonInputs(arm.plan, 2028).clockGHz, 3, "2028's detached clock already meets the Vera floor")
  // Options that cannot fit are disabled with a reason, judged after the dependent re-clamps
  const squeezed = setControl(setControl(gl, 2028, "mlPartitionKW", 75), 2028, "mlPlacement", "dr")
  const fit = optionFit(squeezed, 2028, "coresPerNode")
  assert.ok(Object.values(fit).every((reason) => typeof reason === "string" && reason.length > 5))
  assert.deepEqual(optionFit(gl, 2027, "cooling"), {}, "every cooling option fits once density is re-clamped")
  // Fit to the envelope clamps in order and reports what it changed
  const over = setControl(gl, 2028, "mlPartitionKW", 300)
  const fitted = fitPlanToEnvelope(over, 2028)
  assert.equal(fitted.fits, true)
  assert.deepEqual(fitted.changes.map((ch) => [ch.year, ch.id, ch.to]), [[2028, "mlPartitionKW", 75]])
  assert.equal(evaluatePlan(fitted.plan).envelope.fits, true)
  assert.deepEqual(fitPlanToEnvelope(gl, 2027).changes, [])
})

test("evaluatePlan: the single-season model is the limit of a plan with no move to make", () => {
  const p = presetPlan("dr2027")
  const r = evaluatePlan(setTimeline(p, { contractDate: "2026-11-24", cutoverDate: "2027-01-01", parallelWeeks: 0 }))
  const t = r.timeline.seasons[2027]
  assert.ok(t.slipDays > 0, "a 1 January cutover cannot be met from a November contract")
  // 2028: same inputs as the plain model with the timeline's two controls neutral
  const single = evaluate({ ...seasonInputs(p, 2028) })
  assert.equal(r.seasons[2028].perf.sec, single.perf.sec)
  assert.equal(r.seasons[2028].money.capCharge, single.scenario.money.capCharge)
  // perfBlock with explicit weights reproduces evaluate()
  const sim = simulate(seasonInputs(p, 2027))
  const pb = perfBlock(sim, single.today, { wScenario: sim.comp.effectiveMauh, wToday: single.today.comp.effectiveMauh })
  assert.equal(typeof pb.sec, "number")
  assert.ok(!("ladder" in pb) && !("points" in pb), "no lap-time ladder, no points")
  assert.ok(Number.isFinite(pb.decisionDeltaSec) && Number.isFinite(pb.weekendsAtRiskDelta))
})

test("evaluatePlan: detaching a 2028 control changes 2028 only", () => {
  const base = evaluatePlan(presetPlan("dr2027"))
  const changed = evaluatePlan(setControl(presetPlan("dr2027"), 2028, "nodes", 24))
  assert.deepEqual(changed.seasons[2027].perf, base.seasons[2027].perf)
  assert.equal(changed.seasons[2027].money.capCharge, base.seasons[2027].money.capCharge)
  assert.notEqual(changed.seasons[2028].money.capCharge, base.seasons[2028].money.capCharge)
  assert.ok(changed.deltas.detached.includes("nodes"))
  assert.ok(changed.timeline.seasons[2028].changes, "a bigger 2028 estate is a step-up with its own lead time")
})

test("evaluatePlan: health reasons point at a route and flag illegal or inconsistent plans", () => {
  const gpu27 = evaluatePlan(setControl(setControl(presetPlan("dr2027"), 2027, "gpus", 4), 2027, "solverGpus", 2))
  assert.equal(gpu27.health.status, "bad")
  assert.ok(gpu27.health.items.some((h) => h.id === "gpu27" && h.route === "compute" && h.season === 2027))

  const over = evaluatePlan(setControl(presetPlan("gl2028"), 2028, "mlPartitionKW", 300))
  assert.ok(over.health.items.some((h) => h.route === "facility" && h.level === "bad" && /Not possible/.test(h.title)), "an estate over 500 kW is not possible")
  const legacy = evaluatePlan(normalizePlan({ ...presetPlan("gl2028"), seasons: { ...presetPlan("gl2028").seasons, 2028: { ...presetPlan("gl2028").seasons[2028], expansionRight: true } } }))
  assert.ok(legacy.health.items.some((h) => h.id === "expansion-2028" && h.level === "info"), "a legacy expansion-right input is ignored with an info note")
  assert.equal(legacy.health.status === "bad", false)

  const oneRoute = evaluatePlan(setControl(presetPlan("dr2027"), 2027, "fibrePairs", 1))
  assert.ok(oneRoute.health.items.some((h) => h.id === "fibre" && h.route === "connectivity"))

  const routes = new Set(evaluatePlan(presetPlan("gl2028")).health.items.map((h) => h.route))
  for (const r of routes) assert.ok(["overview", "fia", "compute", "facility", "connectivity", "deployment", "commercials"].includes(r), r)
  const h = planHealth({ plan: presetPlan("today"), seasons: evaluatePlan(presetPlan("today")).seasons, timeline: evaluatePlan(presetPlan("today")).timeline, changes27: false, estateStepUp: false, x27: seasonInputs(presetPlan("today"), 2027), x28: seasonInputs(presetPlan("today"), 2028) })
  assert.ok(h.counts.bad + h.counts.warn + h.counts.info === h.items.length)
})

test("evaluatePlan: a sweep over the control space never produces NaN", () => {
  let n = 0
  for (const id of PLAN_PRESET_ORDER) {
    for (const c of Object.values(CONTROLS)) {
      if (c.id === "season" || TIMELINE_IDS.includes(c.id)) continue
      const values = c.type === "toggle" ? [true, false] : c.options ? c.options.map((o) => o.value) : [c.min, c.max, (c.min + c.max) / 2]
      for (const v of values) for (const year of [2027, 2028]) {
        const r = evaluatePlan(setControl(presetPlan(id), year, c.id, v))
        assertClean({ s: r.seasons, d: r.deltas, h: r.health, t: r.totals }, `${id}.${year}.${c.id}=${v}`)
        n++
      }
    }
  }
  assert.ok(n > 300, `swept ${n} variants`)
})

// ---------------------------------------------------------------------------------------------
// Solutions Architect view
// ---------------------------------------------------------------------------------------------

test("sa: requirements are derived per season, name public Digital Realty services and carry a source status", () => {
  const r = evaluatePlan(presetPlan("gl2028"))
  const r27 = requirements(r, 2027)
  const r28 = requirements(r, 2028)
  assert.ok(r27.length >= 12 && r28.length >= 12)
  for (const q of [...r27, ...r28]) {
    assert.ok(q.id && q.area && q.label && q.value, JSON.stringify(q))
    assert.ok(["derived", "VERIFIED", "ASSUMPTION"].includes(q.status), q.status)
    assert.ok(q.owner, `${q.id} has an owner`)
    assert.ok(!/undefined|NaN/.test(`${q.value} ${q.detail}`), `${q.id}: ${q.value} ${q.detail}`)
  }
  assert.match(r27.find((q) => q.id === "cooling").value, /Rear-door/)
  assert.match(r28.find((q) => q.id === "cooling").value, /liquid/)
  assert.match(r28.find((q) => q.id === "redundancy").value, /2N/)
  assert.ok(r28.some((q) => q.id === "cloud"), "cloud on-ramps appear once the 2028 estate asks for them")
  assert.ok(!r27.some((q) => q.id === "cloud"))
  const delta = requirementDelta(r)
  assert.ok(delta.find((q) => q.id === "cooling").changed)
  assert.ok(!delta.find((q) => q.id === "site").changed)
  const services = serviceMap(r)
  assert.ok(services.some((s) => /PlatformDIGITAL/.test(s.service)))
  assert.ok(services.some((s) => /ServiceFabric/.test(s.service)))
  assert.ok(services.some((s) => /Remote Hands/.test(s.service)))
  assert.ok(services.some((s) => s.id === "hpe" && s.external))
  for (const s of services) assert.match(s.source, /^[A-J](?:\d+(?:-open)?|-[a-z])$/)

  const today = evaluatePlan(presetPlan("today"))
  assert.equal(requirements(today, 2027).length, 1, "staying at Hinwil asks nothing of the campus")
  assert.equal(serviceMap(today).length, 1, "only HPE remains")
})

test("sa: roles, checklist, risk register and the solution brief are complete and clean", () => {
  assert.ok(ROLES.length >= 8)
  assert.ok(ROLES.filter((r) => r.side === "dr").every((r) => r.status === "ASSUMPTION"), "Digital Realty roles are an assumption")
  assert.ok(CHECKLIST.length >= 12)
  assert.equal(new Set(CHECKLIST.map((c) => c.id)).size, CHECKLIST.length)
  for (const id of PLAN_PRESET_ORDER) {
    const r = evaluatePlan(presetPlan(id))
    const risks = riskRegister(r)
    assert.ok(risks.length >= 5)
    for (const k of risks) {
      assert.ok(["low", "medium", "high"].includes(k.likelihood) && ["low", "medium", "high"].includes(k.impact))
      assert.ok(ROLES.some((ro) => ro.id === k.owner), `${k.id} owner ${k.owner}`)
      assert.ok(["open", "triggered", "mitigated"].includes(k.status))
    }
    for (let i = 1; i < risks.length; i++) assert.ok(risks[i - 1].score >= risks[i].score, "sorted by score")
    const brief = solutionBrief(r, { notes: { position: "P8 confirmed" }, generatedAt: "2026-11-24T10:00:00Z" })
    assertClean(brief, `${id} brief`)
    assert.equal(brief.schema, "audi-f1-digital-realty-solution-brief/1")
    assert.equal(brief.footnote, HPE_FOOTNOTE)
    assert.match(brief.footnote, /HPE GreenLake/)
    assert.equal(brief.checklist.find((c) => c.id === "position").note, "P8 confirmed")
    assert.ok(brief.seasons[2027].requirements.length >= 1 && brief.seasons[2028].figures.capChargeCHF > 0)
    const json = JSON.stringify(brief)
    assert.ok(!/FLUX/.test(json))
    assert.ok(!/\bSolution Architect\b/.test(json))
  }
  const mid = evaluatePlan(setTimeline(presetPlan("dr2027"), { cutoverDate: "2027-06-01", parallelWeeks: 0 }))
  assert.equal(riskRegister(mid).find((k) => k.id === "midatp").status, "triggered", "the register is live")
})

test("periods are labelled 'ATP n', never 'P n' (which reads like a championship position); the position echo says what it is", async () => {
  const { readFileSync } = await import("node:fs")
  const { STRATEGIES } = await import("../public/js/sim/strategies.js")
  const PERIOD = /\bP[1-6]\b/
  for (const year of [2027, 2028]) for (const p of atpCalendar(year)) assert.equal(p.label, `ATP ${p.index}`)
  for (const [label] of K.fia.atp2027) assert.match(label, /^ATP [1-6]$/)
  assert.doesNotMatch(K.timeline.atpRule, PERIOD, K.timeline.atpRule)
  for (const o of cutoverOptions()) assert.doesNotMatch(o.label, PERIOD, o.label)
  for (const st of Object.values(STRATEGIES)) {
    for (const t of st.timeline) assert.doesNotMatch(`${t.when} ${t.what}`, PERIOD, `${st.key}: ${t.when} ${t.what}`)
    for (const text of Object.values(st.cutover || {})) assert.doesNotMatch(text, PERIOD, `${st.key}: ${text}`)
  }
  // the timeline strips and the Gantt render "ATP n" from the period index; nothing builds a "P" + number tick
  for (const file of ["public/js/sim/visuals.js", "public/js/sim/views/strategies.js", "public/js/sim/views/overview.js", "public/js/sim/views/deployment.js", "public/js/sim/views/component.js"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(src, /`P\$\{[^}]*index\}|[`"']P\$\{(?:atp|p)\./, `${file} builds a "P" + period tick`)
    for (const m of src.matchAll(/P\$\{([^}]+)\}/g)) assert.match(m[1], /position/, `${file}: P\${${m[1]}} is not a position echo`)
  }
  assert.equal(CONTROLS.position.label, "Constructors' position used for the sliding scale")
  assert.equal(CONTROLS.position.format(8), "P8 · 105 %")
})

test("race weekends at risk read as words everywhere on screen; the JSON exports keep the number", async () => {
  const { readFileSync, readdirSync } = await import("node:fs")
  const { fmt } = await import("../public/js/sim/dom.js")
  const { EXPLAIN, explainContext, fillTemplate } = await import("../public/js/sim/explain.js")
  // the three magnitudes and zero
  assert.equal(fmt.weekends(0), "no weekends at risk")
  assert.equal(fmt.weekends(0.024), "about 1 weekend in 42 seasons at risk")
  assert.equal(fmt.weekends(0.0036), "about 1 weekend in 278 seasons at risk")
  assert.equal(fmt.weekends(0.26), "1 in 4 chance of losing a weekend")
  assert.equal(fmt.weekends(0.14), "1 in 7 chance of losing a weekend")
  assert.equal(fmt.weekends(1.2), "about 1.2 weekends a season at risk")
  assert.equal(fmt.weekends(1), "about 1 weekend a season at risk")
  assert.equal(fmt.weekends(0.5), "about 0.5 weekends a season at risk")
  assert.equal(fmt.weekends(null), "—")
  assert.deepEqual([0, 0.024, 0.26, 1.2].map(fmt.weekendsShort), ["none", "1 in 42 seasons", "1 in 4 chance", "about 1.2 a season"])
  // every plan in the model falls in a band the words cover, and the number survives in the exports
  for (const preset of ["today", "dr2027", "gl2028"]) {
    const r = evaluatePlan(presetPlan(preset))
    const brief = solutionBrief(r)
    for (const y of [2027, 2028]) {
      const x = r.seasons[y].trackside.weekendsAtRisk
      assert.ok(Number.isFinite(x) && x >= 0 && x < 24)
      assert.equal(brief.seasons[y].figures.trackside.weekendsAtRisk, x, "the brief keeps the number")
      assert.match(fmt.weekends(x), /^(no weekends at risk|about 1 weekend in \d+ seasons at risk|1 in \d+ chance of losing a weekend|about [\d.]+ weekends? a season at risk)$/)
      const paddock = requirements(r, y).find((q) => q.id === "paddock")
      if (paddock) assert.ok(paddock.detail.endsWith(`${fmt.weekends(r.seasons[y].sim.net.weekendsLost)}.`), "the Solutions Architect paddock row ends with the words")
    }
    const ctx = explainContext({ result: { scenario: r.seasons[2027].sim, today: r.seasons[2027].today, perf: r.seasons[2027].perf }, plan: r, fmt })
    const inPlan = fillTemplate(EXPLAIN["tile.stat-weekends"].inPlan, ctx)
    assert.ok(inPlan.includes(fmt.weekends(r.seasons[2027].sim.net.weekendsLost)) && inPlan.includes("Today: " + fmt.weekends(r.seasons[2027].today.net.weekendsLost)), inPlan)
    assert.ok(fillTemplate(EXPLAIN["tile.stat-link"].inPlan, ctx).endsWith(`${fmt.weekends(r.seasons[2027].sim.net.weekendsLost)}.`))
  }
  // no view prints the metric as a bare number any more
  const viewsDir = new URL("../public/js/sim/views/", import.meta.url)
  for (const name of readdirSync(viewsDir)) {
    const src = readFileSync(new URL(name, viewsDir), "utf8")
    for (const m of src.matchAll(/weekends(?:AtRisk|Lost)[^\n]{0,40}/g)) {
      const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index))
      if (/\bv: \(s\) => s\.trackside\.weekendsAtRisk/.test(m[0])) continue // the compare table's ranking key stays numeric
      assert.ok(/fmt\.weekends(Short)?\(/.test(line) && !/fmt\.num\([^)]*weekends|weekends\w*\.toFixed/.test(line), `${name}: ${line.trim().slice(0, 120)}`)
    }
  }
})
