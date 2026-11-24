import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate, effectiveTeam, raceSeconds } from "../public/js/model.js"
import { runRace, systemScore, finaleEntries, LAPS, RACE_SECONDS } from "../public/js/race.js"
import { readoutFor, finaleSummary, finaleCars } from "../public/js/report.js"
import { GOOD, IDS, approvedAt } from "./routes.js"

const entry = (team, budget = C.DEFAULT_BUDGET) => {
  const raced = effectiveTeam(team, IDS)
  const evaluation = evaluate(raced, budget, IDS)
  return { id: team.id, name: team.name || team.id, color: team.color || "#fff", pitch: team.pitch || {}, missed: raced.missed, notApproved: raced.notApproved, evaluation, system: systemScore(evaluation, IDS) }
}

test("a 30-second, 56-lap race with cumulative times for every car", () => {
  assert.equal(RACE_SECONDS, 30)
  const r = runRace([entry({ id: "a", choices: GOOD, reviews: approvedAt(IDS) }), entry({ id: "b", choices: {} })], "laps", IDS)
  for (const row of r.results) {
    assert.equal(row.cum.length, LAPS)
    assert.ok(row.cum.every((t, i) => i === 0 || t > row.cum[i - 1]))
    assert.ok(row.pitLap >= 1)
    assert.ok(Number.isFinite(row.fit.network), "each result carries the FIT it raced on")
  }
})

/** Many seeds with a fragile and a robust design. */
function incidentRaces(n = 40) {
  const fragile = { link: "single", path: "public", garage: "wifi", vendor: "incumbent", payment: "buy", support: "basic", location: "cheap", cooling: "air", power: "boost", size: "small", chips: "gpu", storage: "basic" }
  const robust = { ...GOOD, link: "satellite", storage: "cache" }
  const teams = [
    { id: "fragile", name: "Fragile GP", choices: fragile, reviews: approvedAt(IDS) },
    { id: "robust", name: "Robust GP", choices: robust, reviews: approvedAt(IDS) },
  ]
  return Array.from({ length: n }, (_, i) => runRace(teams.map((t) => entry(t)), `inc-${i}`, IDS))
}

test("incidents follow visible dial settings and name the dial that caused them", () => {
  const races = incidentRaces()
  const events = races.flatMap((r) => r.events.filter((e) => e.team))
  const of = (team, id) => events.filter((e) => e.team === team && e.incident === id)
  assert.ok(of("fragile", "tunnel").length || of("fragile", "fibreCut").some((e) => /single route to Mission Control/.test(e.text)), "a single route drops")
  assert.ok(of("fragile", "jitter").some((e) => /public-internet jitter/.test(e.text)), "public internet jitter")
  assert.ok(events.some((e) => e.team === "fragile" && e.incident === "wifiStall" && /Wi-Fi/.test(e.text)), "Wi-Fi dumps stall the stop")
  assert.ok(of("fragile", "heat").some((e) => /max boost|air cooling/.test(e.text)), "air cooling or max boost suffers in the heat")
  assert.ok(of("fragile", "oldKit").length, "last-generation kit runs too few what-ifs")
  assert.ok(of("fragile", "node").some((e) => /basic support/.test(e.text)), "basic support leaves a node down")
  assert.ok(of("fragile", "powerBlip").length, "no N+1 at the cheap-power region")
  assert.ok(of("fragile", "fewCycles").length && of("fragile", "slowStorage").length, "a small GPU cluster on basic storage")
  assert.ok(of("robust", "node").some((e) => /4-hour support/.test(e.text)), "4-hour support saves a failed node")
  assert.ok(of("robust", "fibreSafe").some((e) => /satellite backup/.test(e.text)), "satellite backup survives a fibre cut")
  assert.ok(of("robust", "heatSafe").some((e) => /85% power cap/.test(e.text)), "liquid plus an 85% cap stays stable")
  assert.ok(of("robust", "cache").length, "the flash cache helps")
  assert.equal(of("robust", "jitter").length, 0)
  for (const e of events.filter((x) => x.incident && x.station)) {
    assert.ok(e.dial && C.decision(e.dial)?.station === e.station, `${e.incident} names a dial at ${e.station}: ${e.dial}`)
  }
  for (const e of events.filter((x) => x.incident && x.station && x.kind !== "penalty")) assert.match(e.text, /^(Fragile|Robust) GP\. (Lost|Gained|Held) /)
  assert.deepEqual(incidentRaces(3), incidentRaces(3), "deterministic for the seed")
})

test("balance over 200 seeds per budget: four approved in-zone boards beat two unapproved ≥85% and today's setup ≥95%", () => {
  const pairs = []
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) pairs.push([IDS[i], IDS[j]])
  const N = 200
  for (const budget of C.BUDGET_LEVELS.map((b) => b.id)) {
    let beatsPartial = 0
    let beatsBaseline = 0
    for (let s = 0; s < N; s++) {
      const pair = pairs[s % pairs.length]
      const full = entry({ id: "full", choices: GOOD, reviews: approvedAt(IDS) }, budget)
      const partial = entry({ id: "partial", choices: GOOD, reviews: approvedAt(IDS.filter((id) => !pair.includes(id))) }, budget)
      const baseline = entry({ id: "baseline", choices: {} }, budget)
      const pos = Object.fromEntries(runRace([full, partial, baseline], `balance-${budget}-${s}`, IDS).results.map((r) => [r.id, r.position]))
      if (pos.full < pos.partial) beatsPartial += 1
      if (pos.full < pos.baseline) beatsBaseline += 1
    }
    console.log(`[balance] ${budget}: beats two-unapproved ${beatsPartial}/${N} (${(beatsPartial / N * 100).toFixed(1)}%), beats today's setup ${beatsBaseline}/${N} (${(beatsBaseline / N * 100).toFixed(1)}%)`)
    assert.ok(beatsPartial / N >= 0.85, `${budget}: beats two-unapproved ${beatsPartial}/${N}`)
    assert.ok(beatsBaseline / N >= 0.95, `${budget}: beats today's setup ${beatsBaseline}/${N}`)
  }
})

/** The customer as the server holds it: every table with all three dials set has a plan (locked); the given ones are approved. */
const customer = (choices, approvedIds, extra = {}) => {
  const locked = IDS.filter((id) => C.decisionsFor(id).every((d) => choices[d.id] !== undefined))
  return { id: C.CUSTOMER_TEAM.id, name: C.CUSTOMER_TEAM.name, color: C.CUSTOMER_TEAM.color, choices, reviews: approvedAt(approvedIds), plans: Object.fromEntries(locked.map((id) => [id, { id: `P-${id}`, station: id, choices, fit: 90, status: "zone", inZone: true, board: { seconds: 0.3 } }])), attempts: Object.fromEntries(locked.map((id) => [id, 1])), pitch: Object.fromEntries(approvedIds.map((id) => [id, 22])), ...extra }
}

test("the finale: two entrants, the customer's 2027 plan (approved tables only) against today's Hinwil setup at 0.00 s", () => {
  const team = customer(GOOD, ["network", "dc"])
  const entries = finaleEntries(team, C.DEFAULT_BUDGET, IDS)
  assert.equal(entries.length, 2)
  const [plan, today] = entries
  assert.equal(plan.id, C.CUSTOMER_TEAM.id, "the plan car carries the customer's id, so /race.html?team=t1 finds it")
  assert.equal(plan.name, `${C.CUSTOMER_TEAM.name} · 2027 plan`)
  assert.equal(plan.short, "2027 plan")
  assert.equal(plan.color, C.CUSTOMER_TEAM.color)
  assert.equal(plan.seconds, raceSeconds(team, C.DEFAULT_BUDGET, IDS), "the plan's pace is the seconds found at the approved tables")
  assert.ok(plan.seconds > 0)
  assert.deepEqual(plan.notApproved.sort(), ["compute", "oem"], "locked but unapproved tables race on today's setup")
  assert.deepEqual(plan.pitch, { network: 22, dc: 22 })
  assert.equal(today.id, "today")
  assert.equal(today.name, `${C.CUSTOMER_TEAM.name} · today's Hinwil setup`)
  assert.equal(today.seconds, 0)
  assert.deepEqual(today.missed, IDS, "today's setup has no approved table")
  assert.deepEqual(today.pitch, {})
  const race = runRace(entries, "finale", IDS)
  assert.equal(race.results.length, 2)
  assert.deepEqual(race.results.map((r) => r.id).sort(), [C.CUSTOMER_TEAM.id, "today"].sort())
  const rows = Object.fromEntries(race.results.map((r) => [r.id, r]))
  assert.equal(rows.t1.found, plan.seconds)
  assert.equal(rows.today.found, 0)
  assert.equal(rows.t1.short, "2027 plan", "the track and the tower use the short label")
  assert.equal(rows.today.short, "Hinwil today")
  const { plan: p, today: t } = finaleCars(race)
  assert.equal(p.id, "t1")
  assert.equal(t.id, "today")
  const summary = finaleSummary(race)
  assert.equal(summary.laps, LAPS)
  assert.equal(Math.round((t.total - p.total) * 10) / 10, summary.gap, "the gap is today's time minus the plan's, after 56 laps")
  assert.equal(summary.ahead, summary.gap > 0)
  assert.match(summary.text, /^After 56 laps (the 2027 plan finished \d+\.\d s ahead of today's Hinwil setup|today's Hinwil setup finished \d+\.\d s ahead of the 2027 plan) \(P[12] to P[12]\)/, "the result explains the gap in seconds and places")
  assert.match(summary.text, /\d\.\d\d s per lap found at 2 approved tables/)
  assert.equal(finaleSummary({ results: [] }).text, "The race has not run.")
})

test("over 200 seeds the 2027 plan with four approved in-zone tables beats today's Hinwil setup almost every time, and never when nothing is approved by design", () => {
  const N = 200
  let wins = 0
  let gaps = 0
  for (let s = 0; s < N; s++) {
    const race = runRace(finaleEntries(customer(GOOD, IDS), C.DEFAULT_BUDGET, IDS), `finale-${s}`, IDS)
    const f = finaleSummary(race)
    if (f.ahead) wins += 1
    gaps += f.gap
  }
  console.log(`[finale] plan beats today ${wins}/${N} (${(wins / N * 100).toFixed(1)}%), mean gap ${(gaps / N).toFixed(1)} s over ${LAPS} laps`)
  assert.ok(wins / N >= 0.95, `the plan beats today's setup ${wins}/${N}`)
  assert.ok(gaps / N > 5, `the gap after ${LAPS} laps is worth showing (${(gaps / N).toFixed(1)} s)`)
  const nothing = runRace(finaleEntries(customer({}, []), C.DEFAULT_BUDGET, IDS), "nothing", IDS)
  const f = finaleSummary(nothing)
  assert.equal(f.perLap, 0)
  assert.match(f.text, /Nothing was approved, so both cars ran today's setup at 0\.00 s per lap/)
})

test("the customer's readout: boards, lessons and suggestions for a full, a partial and an empty plan", () => {
  const cases = [
    ["full", customer(GOOD, IDS)],
    ["partial", customer({ ...GOOD, link: "single" }, ["dc", "oem"])],
    ["rejected", customer({ ...GOOD, cooling: "air" }, ["network"], { reviews: { ...approvedAt(["network"]), dc: { status: "rejected", by: "SA", reason: "No N+1" } }, attempts: { network: 1, dc: 1 } })],
    ["none", customer({}, [])],
  ]
  /* A rejected table has no plan any more (the dials reopened) and is still adjusting. */
  delete cases[2][1].plans.dc
  for (const d of C.decisionsFor("dc")) delete cases[2][1].choices[d.id]
  for (const [label, t] of cases) {
    const race = runRace(finaleEntries(t, C.DEFAULT_BUDGET, IDS), `readout-${label}`, IDS)
    const r = readoutFor(t, race, IDS, C.DEFAULT_BUDGET)
    assert.equal(r.team.name, C.CUSTOMER_TEAM.name)
    assert.ok(r.result.position >= 1 && r.result.position <= 2, `${label}: finishing position`)
    assert.equal(r.result.of, 2)
    assert.equal(r.result.championship, undefined, "no championship: one customer")
    assert.equal(r.result.laps, LAPS)
    assert.equal(typeof r.result.gap, "number")
    assert.equal(r.result.ahead, r.result.gap > 0)
    assert.equal(r.result.approved, Object.values(t.reviews).filter((x) => x.status === "approved").length)
    assert.equal(r.result.tables, 4)
    assert.equal(r.boards.length, 4, "a board thumbnail per table")
    for (const b of r.boards) {
      assert.ok(["approved", "today"].includes(b.raced))
      assert.equal(b.raced === "approved", t.reviews[b.station]?.status === "approved")
      assert.ok(b.fit >= 0 && b.fit <= 100 && b.targets.length >= 2)
      assert.ok(b.story.length > 10, "each table tells what happened")
    }
    assert.ok(r.wentWell.length >= 2 && r.wentWell.length <= 3, `${label}: 2–3 positives (${r.wentWell.length})`)
    assert.ok(r.couldDo.length >= 2 && r.couldDo.length <= 3, `${label}: 2–3 suggestions (${r.couldDo.length})`)
    for (const tip of r.couldDo.filter((x) => x.better)) {
      assert.match(tip.text, / instead of .+\(\d\.\d\d → \d\.\d\d s per lap, FIT \d+ → \d+\)/, "each suggestion names the dial, the better setting and the seconds and FIT gain")
      assert.match(tip.text, /How a provider helps: /)
    }
    assert.match(r.summary, /^You found \d\.\d\d s per lap at \d approved tables?; after 56 laps the 2027 plan finished (\d+\.\d s (ahead of|behind)|level with) today's Hinwil setup \(P[12] of 2\)\.$/)
    assert.equal(r.finale, finaleSummary(race).text)
    assert.match(r.path2028, /^2028 path: /)
    assert.equal(r.result.seconds, race.results.find((x) => x.id === "t1").found, "the readout quotes the seconds the race used")
  }
  const full = readoutFor(cases[0][1], runRace(finaleEntries(cases[0][1], C.DEFAULT_BUDGET, IDS), "readout-full", IDS), IDS)
  assert.ok(full.wentWell.some((line) => /in the zone \(\d\.\d\d s per lap, FIT \d+\)/.test(line)), "approved in-zone tables are lessons achieved")
  const none = readoutFor(cases[3][1], runRace(finaleEntries(cases[3][1], C.DEFAULT_BUDGET, IDS), "readout-none", IDS), IDS)
  assert.ok(none.boards.every((b) => b.raced === "today"))
  assert.ok(none.couldDo.some((tip) => /customer's existing setup/.test(tip.text)), "an unapproved table is told it raced on the existing setup")
  assert.equal(none.result.seconds, 0, "nothing approved: 0.00 s found")
  assert.match(none.summary, /^You found 0\.00 s per lap at 0 approved tables;/)
  const rejected = readoutFor(cases[2][1], runRace(finaleEntries(cases[2][1], C.DEFAULT_BUDGET, IDS), "readout-rejected", IDS), IDS)
  assert.match(rejected.boards.find((b) => b.station === "dc").story, /Rejected on the first attempt \("No N\+1"\)/)
})

test("the race runs on seconds found: pace is the base lap minus the team total", () => {
  const full = entry({ id: "full", choices: GOOD, reviews: approvedAt(IDS) })
  const half = entry({ id: "half", choices: GOOD, reviews: approvedAt(IDS.slice(0, 2)) })
  const none = entry({ id: "none", choices: GOOD })
  assert.ok(full.evaluation.secondsTotal > half.evaluation.secondsTotal && half.evaluation.secondsTotal > 0)
  assert.equal(none.evaluation.secondsTotal, 0, "nothing approved races on today's setup: 0.00 s")
  const r = runRace([full, half, none], "seconds", IDS)
  const found = Object.fromEntries(r.results.map((x) => [x.id, x.found]))
  assert.deepEqual(found, { full: full.evaluation.secondsTotal, half: half.evaluation.secondsTotal, none: 0 })
  const forced = runRace([{ ...none, seconds: 1.3 }, full], "seconds", IDS)
  assert.equal(forced.results.find((x) => x.id === "none").found, 1.3, "an explicit entry total wins")
})
