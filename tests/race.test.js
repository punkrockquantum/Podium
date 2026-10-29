import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate, effectiveTeam } from "../public/js/model.js"
import { runRace, systemScore, LAPS, RACE_SECONDS } from "../public/js/race.js"
import { REFERENCE_BUILD } from "../public/js/sim.js"
import { readoutFor, podium } from "../public/js/report.js"
import { IDS, approvedAt } from "./routes.js"

const entry = (team) => {
  const raced = effectiveTeam(team, IDS)
  const evaluation = evaluate(raced)
  return { id: team.id, name: team.name || team.id, color: team.color || "#fff", pitch: team.pitch || {}, missed: raced.missed, notApproved: raced.notApproved, evaluation, system: systemScore(evaluation, IDS) }
}

test("a 30-second, 56-lap race with cumulative times for every car", () => {
  assert.equal(RACE_SECONDS, 30)
  const r = runRace([entry({ id: "a", choices: REFERENCE_BUILD, reviews: approvedAt(IDS) }), entry({ id: "b", choices: {} })], "laps", IDS)
  for (const row of r.results) {
    assert.equal(row.cum.length, LAPS)
    assert.ok(row.cum.every((t, i) => i === 0 || t > row.cum[i - 1]))
    assert.ok(row.pitLap >= 1)
  }
})

/** Many seeds with a fragile and a robust design. */
function incidentRaces(n = 40) {
  const fragile = { link: "single", path: "public", garage: "wifi", vendor: "supermicro", payment: "lease", support: "basic", location: "cheap", cooling: "air", power: "boost", size: "small", chips: "gpu", storage: "basic" }
  const robust = { ...REFERENCE_BUILD, link: "satellite", support: "4h", storage: "cache" }
  const teams = [
    { id: "fragile", name: "Fragile GP", choices: fragile, reviews: approvedAt(IDS) },
    { id: "robust", name: "Robust GP", choices: robust, reviews: approvedAt(IDS) },
  ]
  return Array.from({ length: n }, (_, i) => runRace(teams.map(entry), `inc-${i}`, IDS))
}

test("incidents come from the four tables and say who, why and what it cost", () => {
  const races = incidentRaces()
  const events = races.flatMap((r) => r.events.filter((e) => e.team))
  const of = (team, id) => events.filter((e) => e.team === team && e.incident === id)
  assert.ok(of("fragile", "tunnel").length || of("fragile", "fibreCut").some((e) => /only tunnel/.test(e.text)), "a single tunnel drops")
  assert.ok(of("fragile", "jitter").some((e) => /public-internet jitter/.test(e.text)), "public internet jitter")
  assert.ok(events.some((e) => e.team === "fragile" && e.incident === "timePenalty" && /Wi-Fi/.test(e.text)), "Wi-Fi dumps earn a time penalty")
  assert.ok(of("fragile", "heat").some((e) => /max boost|air cooling/.test(e.text)), "air cooling or max boost suffers in the heat")
  assert.ok(of("fragile", "boost").some((e) => /max boost overheated/.test(e.text)), "max boost overheats")
  assert.ok(of("fragile", "distance").some((e) => /40 ms/.test(e.text)), "the cheap-power region adds latency")
  assert.ok(of("fragile", "smallModel").some((e) => /too few nodes/.test(e.text)), "a small cluster gives a poor strategy model")
  assert.ok(of("fragile", "slowStorage").some((e) => /slow storage/.test(e.text)), "slow storage")
  assert.ok(of("robust", "node").some((e) => /4-hour support/.test(e.text) && /Held position/.test(e.text)), "4-hour support saves a failed node")
  assert.ok(of("fragile", "node").some((e) => /basic support/.test(e.text)), "basic support leaves a node down")
  assert.ok(of("robust", "fibreSafe").some((e) => /satellite backup/.test(e.text)), "satellite backup survives a fibre cut")
  assert.ok(of("robust", "heatSafe").some((e) => /85% power cap/.test(e.text)), "liquid plus an 85% cap stays stable")
  assert.equal(of("robust", "jitter").length, 0)
  for (const e of events.filter((x) => x.incident && x.station && x.kind !== "penalty")) assert.match(e.text, /^(Fragile|Robust) GP\. (Lost|Gained|Held) /)
  assert.deepEqual(incidentRaces(3), incidentRaces(3), "deterministic for the seed")
})

test("balance over 200 seeds: all-approved optimised beats two-unapproved ≥85% and all-defaults ≥95%", () => {
  const pairs = []
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) pairs.push([IDS[i], IDS[j]])
  const N = 200
  for (const tier of [1, 2, 3]) {
    let beatsPartial = 0
    let beatsDefaults = 0
    for (let s = 0; s < N; s++) {
      const pair = pairs[s % pairs.length]
      const full = entry({ id: "full", tier, choices: REFERENCE_BUILD, reviews: approvedAt(IDS) })
      const partial = entry({ id: "partial", tier, choices: REFERENCE_BUILD, reviews: approvedAt(IDS.filter((id) => !pair.includes(id))) })
      const defaults = entry({ id: "defaults", tier, choices: {} })
      const pos = Object.fromEntries(runRace([full, partial, defaults], `balance-${s}`, IDS).results.map((r) => [r.id, r.position]))
      if (pos.full < pos.partial) beatsPartial += 1
      if (pos.full < pos.defaults) beatsDefaults += 1
    }
    console.log(`[balance] ${C.tierFor({ tier }).label}: beats two-unapproved ${beatsPartial}/${N} (${(beatsPartial / N * 100).toFixed(1)}%), beats all-defaults ${beatsDefaults}/${N} (${(beatsDefaults / N * 100).toFixed(1)}%)`)
    assert.ok(beatsPartial / N >= 0.85, `tier ${tier}: beats two-unapproved ${beatsPartial}/${N}`)
    assert.ok(beatsDefaults / N >= 0.95, `tier ${tier}: beats all-defaults ${beatsDefaults}/${N}`)
    assert.ok(beatsPartial < N || beatsDefaults < N, "randomness is bounded but real")
  }
})

test("a 10-team race: every team gets a full readout", () => {
  const designs = [REFERENCE_BUILD, {}, { ...REFERENCE_BUILD, link: "single" }, { ...REFERENCE_BUILD, cooling: "air", chips: "gpu" }, { ...REFERENCE_BUILD, payment: "buy" }]
  const teams = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i + 1}`, name: `Team ${i + 1}`, color: C.TEAM_COLORS[i], tier: (i % 3) + 1,
    choices: designs[i % designs.length], reviews: approvedAt(IDS.slice(0, i % 5)), plans: {}, pitch: Object.fromEntries(IDS.slice(0, i % 5).map((id) => [id, 22])),
  }))
  const race = runRace(teams.map(entry), "ten", IDS)
  assert.equal(race.results.length, 10)
  assert.equal(podium(race).length, 3)
  for (const t of teams) {
    const r = readoutFor(t, race, IDS)
    assert.ok(r.result.position >= 1 && r.result.position <= 10, "finishing position")
    assert.ok(r.result.championship >= 1 && r.result.championship <= 10, "championship position")
    assert.ok(Number.isFinite(r.result.points), "points")
    assert.ok(r.wentWell.length >= 2 && r.wentWell.length <= 3, `${t.name}: 2–3 positives (${r.wentWell.length})`)
    assert.ok(r.couldDo.length >= 2 && r.couldDo.length <= 3, `${t.name}: 2–3 suggestions (${r.couldDo.length})`)
    assert.ok(Array.isArray(r.incidents))
    const named = r.couldDo.filter((tip) => tip.better)
    for (const tip of named) assert.match(tip.text, / instead of /, "each suggestion names the better option")
  }
  const weak = readoutFor(teams[1], race, IDS)
  assert.ok(weak.couldDo.some((tip) => /not approved|get the design approved/.test(tip.text)), "an unapproved team is told to get approved")
})
