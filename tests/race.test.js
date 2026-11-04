import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate, effectiveTeam } from "../public/js/model.js"
import { runRace, systemScore, LAPS, RACE_SECONDS } from "../public/js/race.js"
import { readoutFor, podium } from "../public/js/report.js"
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
  assert.ok(of("fragile", "tunnel").length || of("fragile", "fibreCut").some((e) => /single factory tunnel/.test(e.text)), "a single tunnel drops")
  assert.ok(of("fragile", "jitter").some((e) => /public-internet jitter/.test(e.text)), "public internet jitter")
  assert.ok(events.some((e) => e.team === "fragile" && e.incident === "timePenalty" && /Wi-Fi/.test(e.text)), "Wi-Fi dumps earn a time penalty")
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

test("a 10-team race: every team gets a readout with boards, lessons and suggestions", () => {
  const designs = [GOOD, {}, { ...GOOD, link: "single" }, { ...GOOD, cooling: "air" }, { ...GOOD, payment: "buy" }]
  const teams = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i + 1}`, name: `Team ${i + 1}`, color: C.TEAM_COLORS[i],
    choices: designs[i % designs.length], reviews: approvedAt(IDS.slice(0, i % 5)), plans: {}, pitch: Object.fromEntries(IDS.slice(0, i % 5).map((id) => [id, 22])),
  }))
  const race = runRace(teams.map((t) => entry(t)), "ten", IDS)
  assert.equal(race.results.length, 10)
  assert.equal(podium(race).length, 3)
  for (const t of teams) {
    const r = readoutFor(t, race, IDS, C.DEFAULT_BUDGET)
    assert.ok(r.result.position >= 1 && r.result.position <= 10, "finishing position")
    assert.ok(r.result.championship >= 1 && r.result.championship <= 10, "championship position")
    assert.ok(Number.isFinite(r.result.points), "points")
    assert.equal(r.boards.length, 4, "a board thumbnail per table")
    for (const b of r.boards) {
      assert.ok(["approved", "today"].includes(b.raced))
      assert.equal(b.raced === "approved", t.reviews[b.station]?.status === "approved")
      assert.ok(b.fit >= 0 && b.fit <= 100 && b.targets.length >= 2)
    }
    assert.ok(r.wentWell.length >= 2 && r.wentWell.length <= 3, `${t.name}: 2–3 positives (${r.wentWell.length})`)
    assert.ok(r.couldDo.length >= 2 && r.couldDo.length <= 3, `${t.name}: 2–3 suggestions (${r.couldDo.length})`)
    for (const tip of r.couldDo.filter((x) => x.better)) {
      assert.match(tip.text, / instead of .+\(FIT \d+ → \d+\)/, "each suggestion names the dial, the better setting and the FIT gain")
      assert.match(tip.text, /How a provider helps: /)
    }
  }
  const all = readoutFor(teams[4], race, IDS)
  assert.ok(all.wentWell.some((line) => /in the zone \(FIT \d+\)/.test(line)), "approved in-zone tables are lessons achieved")
  const none = readoutFor(teams[0], race, IDS)
  assert.ok(none.boards.every((b) => b.raced === "today"))
  assert.ok(none.couldDo.some((tip) => /customer's existing setup/.test(tip.text)), "an unapproved team is told it raced on the existing setup")
})
