import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate, effectiveTeam, choicesOf } from "../public/js/model.js"
import { GOOD, IDS, approvedAt } from "./routes.js"

const words = (text) => text.trim().split(/\s+/).length

test("four tables, exactly three decisions each, exactly three options each", () => {
  assert.deepEqual(C.STATIONS.map((s) => s.id), ["network", "oem", "dc", "compute"])
  assert.deepEqual(C.STATIONS.map((s) => s.name), ["Connectivity", "OEMs", "Datacenter & Power", "CFD Supercomputer"])
  for (const s of C.STATIONS) {
    const ds = C.decisionsFor(s.id)
    assert.equal(ds.length, 3, `${s.id} has three decisions`)
    assert.ok(s.brief.length >= 1 && s.brief.length <= 3, `${s.id} brief has at most three bullets`)
    assert.ok(s.looking.length > 10 && s.architect.endsWith("Architect"))
    for (const d of ds) {
      assert.equal(d.options.length, 3, `${d.id} has three options`)
      assert.ok(d.why.length > 10, `${d.id} says why it matters`)
      assert.ok(d.options.some((o) => o.id === d.def), `${d.id} default is an option`)
      for (const o of d.options) {
        assert.ok(words(o.text) <= 12, `${d.id}/${o.id} sentence is at most 12 words: "${o.text}"`)
        assert.ok(o.why.length > 10 && words(o.why) <= 14, `${d.id}/${o.id} has a one-line why`)
      }
    }
  }
  assert.equal(C.DECISIONS.length, 12)
  for (const old of ["ai", "storage", "governance"]) assert.ok(C.RETIRED_STATIONS[old], `${old} is listed as retired`)
})

test("tiers: Front-runner, Midfield, Challenger, each with a one-line explanation", () => {
  assert.deepEqual(C.TIERS.map((t) => t.label), ["Front-runner (Tier 1)", "Midfield (Tier 2)", "Challenger (Tier 3)"])
  for (const t of C.TIERS) assert.match(t.line, /CapEx headroom/)
  assert.ok(C.TIERS[0].capex < C.TIERS[1].capex && C.TIERS[1].capex < C.TIERS[2].capex, "front-runners get the least headroom")
  assert.ok(C.TIERS[0].compute < C.TIERS[1].compute && C.TIERS[1].compute < C.TIERS[2].compute, "and the least compute")
  assert.equal(C.tierFor({ tier: 9 }).id, 2, "an unknown tier falls back to Midfield")
})

test("ten distinct team colours and a 50-minute session by default", () => {
  assert.equal(C.TEAM_COLORS.length, 10)
  assert.equal(new Set(C.TEAM_COLORS).size, 10)
  assert.equal(C.MAX_TEAMS, 10)
  assert.equal(C.MIN_TEAMS, 1)
  assert.equal(C.sessionTotal(), 50)
  assert.equal(C.SESSION.briefMinutes, 5)
  assert.equal(C.SESSION.playMinutes, 35)
})

test("the ledger is four numbers: CapEx, yearly OpEx, power and FIA risk", () => {
  const ev = evaluate({ tier: 2, choices: GOOD })
  for (const key of ["capex", "opex", "facilityKW"]) assert.ok(Number.isFinite(ev.ledger[key]) && ev.ledger[key] > 0, key)
  assert.ok(["Low", "Med", "High"].includes(ev.ledger.fia))
  assert.equal(ev.ledger.fia, "Low", "the reference build is FIA-clean")
  assert.equal(evaluate({ tier: 2, choices: {} }).ledger.fia, "High", "the defaults carry FIA risk")
})

test("invalid or missing choices fall back to the defaults", () => {
  const ch = choicesOf({ choices: { link: "bogus", cooling: "liquid", ai: "old" } })
  assert.equal(ch.link, "single")
  assert.equal(ch.cooling, "liquid")
  assert.equal(Object.keys(ch).length, 12)
})

test("buying stretches a Front-runner's CapEx; leasing moves it to OpEx; as-a-service needs Dell, HPE or Lenovo", () => {
  const buy = { ...GOOD, payment: "buy", support: "4h" }
  assert.ok(evaluate({ tier: 1, choices: buy }).ledger.capexOver > 0, "Front-runners cannot buy this cluster")
  assert.equal(evaluate({ tier: 3, choices: buy }).ledger.capexOver, 0, "Challengers can")
  assert.ok(evaluate({ tier: 1, choices: buy }).penalties.some((p) => p.id === "capex"))
  const lease = evaluate({ tier: 1, choices: { ...GOOD, payment: "lease" } })
  assert.ok(lease.ledger.capex < evaluate({ tier: 1, choices: buy }).ledger.capex)
  assert.equal(evaluate({ choices: { ...GOOD, vendor: "dgx", payment: "aas" } }).payment, "lease", "DGX has no as-a-service: it falls back to a lease")
  assert.equal(evaluate({ choices: GOOD }).payment, "aas")
})

test("hot chips on air cooling throttle; liquid does not", () => {
  assert.ok(evaluate({ choices: { ...GOOD, chips: "gpu", cooling: "air" } }).power.thermal < 1)
  assert.equal(evaluate({ choices: { ...GOOD, chips: "gpu", cooling: "liquid", power: "boost" } }).power.thermal, 1)
  assert.ok(evaluate({ choices: { ...GOOD, cooling: "liquid" } }).power.pue < evaluate({ choices: { ...GOOD, cooling: "air" } }).power.pue)
})

test("illegal and risky choices carry FIA penalties at the right table", () => {
  const ev = evaluate({ choices: { ...GOOD, garage: "wifi", link: "single", location: "factory", size: "large" } })
  const at = Object.fromEntries(ev.penalties.map((p) => [p.id, p.station]))
  assert.equal(at.wifi, "network")
  assert.equal(at.tunnel, "network")
  assert.equal(at.nplus1, "dc")
  assert.equal(at.overrun, "compute")
  assert.equal(ev.penalties.find((p) => p.id === "wifi").seconds, 5)
})

test("only approved tables keep their choices in the race", () => {
  const team = { tier: 2, choices: GOOD, reviews: approvedAt(["network", "dc"]), plans: { oem: { id: "X" } } }
  const raced = effectiveTeam(team, IDS)
  assert.deepEqual(raced.approved.sort(), ["dc", "network"])
  assert.deepEqual(raced.notApproved, ["oem"])
  assert.deepEqual(raced.missed, ["compute"])
  assert.equal(raced.choices.link, "redundant")
  assert.equal(raced.choices.size, undefined, "an unapproved table races on its default")
})
