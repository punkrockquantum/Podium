import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { boardFor, evaluate, effectiveTeam, choicesOf, allBoards, FIT_ZONE, FIT_BREACH_MAX, secondsTotal, raceSeconds, SECONDS_MAX } from "../public/js/model.js"
import { designSummary } from "../public/js/summary.js"
import { buildPlan } from "../public/js/plandata.js"
import { GOOD, IDS, approvedAt, pick } from "./routes.js"

const words = (text) => text.trim().split(/\s+/).length
const LEVELS = C.BUDGET_LEVELS.map((b) => b.id)

test("four tables: a problem card, 2–3 targets, cap lines and three dials of three settings", () => {
  assert.deepEqual(C.STATIONS.map((s) => s.id), ["network", "oem", "dc", "compute"])
  assert.deepEqual(C.STATIONS.map((s) => s.name), ["Connectivity", "OEMs", "Datacenter & Power", "CFD Supercomputer"])
  for (const s of C.STATIONS) {
    assert.ok(words(s.problem) <= 20, `${s.id} problem is at most 20 words: "${s.problem}"`)
    assert.ok(s.targets.length >= 2 && s.targets.length <= 3, `${s.id} has 2–3 targets`)
    assert.ok(s.caps.capex > 0 && s.caps.opex > 0, `${s.id} has CapEx and OpEx caps`)
    assert.ok(s.today.length > 10 && s.looking.length > 10 && s.architect.endsWith("Architect"))
    assert.ok(s.lesson.why.length > 10 && s.lesson.provider.length > 10, `${s.id} has a lesson`)
    const ds = C.decisionsFor(s.id)
    assert.equal(ds.length, 3, `${s.id} has three dials`)
    for (const d of ds) {
      assert.equal(d.options.length, 3, `${d.id} has three settings`)
      assert.ok(d.options.some((o) => o.id === d.today), `${d.id}: today's setting is one of the three`)
      assert.ok(words(d.why) <= 18 && d.why.length > 10, `${d.id} "why it matters" is at most 18 words: "${d.why}"`)
      assert.ok(words(d.how) <= 18 && d.how.length > 10, `${d.id} "how a provider helps" is at most 18 words: "${d.how}"`)
      for (const o of d.options) assert.ok(words(o.text) <= 12, `${d.id}/${o.id} setting is at most 12 words: "${o.text}"`)
    }
  }
  assert.equal(C.DECISIONS.length, 12)
  for (const old of ["ai", "storage", "governance"]) assert.ok(C.RETIRED_STATIONS[old], `${old} is listed as retired`)
  assert.equal(C.TIERS, undefined, "per-team tiers are gone")
})

test("ten distinct team colours and a 50-minute session by default", () => {
  assert.equal(new Set(C.TEAM_COLORS).size, 10)
  assert.equal(C.MAX_TEAMS, 10)
  assert.equal(C.MIN_TEAMS, 1)
  assert.equal(C.sessionTotal(), 50)
})

test("today's setup is coherent, and out of the zone at every table on every budget", () => {
  for (const level of LEVELS) {
    for (const s of C.STATIONS) {
      const b = boardFor(s.id, C.BASELINE_CHOICES, level)
      assert.equal(b.inZone, false, `${s.id} baseline at ${level}: FIT ${b.fit}`)
      assert.ok(b.fit < FIT_ZONE)
      assert.equal(b.todayFit, b.fit)
    }
  }
  assert.deepEqual(choicesOf({}), C.BASELINE_CHOICES, "a team that never touches a dial is on today's setup")
  const ch = choicesOf({ choices: { link: "bogus", cooling: "liquid", ai: "old" } })
  assert.equal(ch.link, "single", "an invalid setting falls back to today")
  assert.equal(ch.cooling, "liquid")
  assert.equal(Object.keys(ch).length, 12)
})

test("at least two in-zone answers per table inside the caps at Standard, and the reference build is one", () => {
  for (const s of C.STATIONS) {
    const zone = allBoards(s.id, "standard").filter((b) => b.inZone)
    assert.ok(zone.length >= 2, `${s.id}: ${zone.length} in-zone answers`)
    for (const b of zone) {
      assert.ok(b.fit >= FIT_ZONE && b.fit <= 100)
      assert.ok(b.caps.every((c) => c.over === 0) && b.breaches.length === 0)
    }
    const ref = boardFor(s.id, GOOD, "standard")
    assert.ok(ref.inZone, `reference build at ${s.id}: FIT ${ref.fit}`)
    console.log(`[zone] ${s.id}: ${LEVELS.map((l) => `${l} ${allBoards(s.id, l).filter((b) => b.inZone).length}`).join(", ")} · baseline FIT ${boardFor(s.id, {}, "standard").fit} · reference FIT ${ref.fit}`)
  }
})

test("FIT: in the zone scores 80–100; crossing a cap or an FIA rule caps it at 40", () => {
  const inZone = boardFor("oem", pick("oem"))
  assert.equal(inZone.status, "zone")
  assert.ok(inZone.fit >= 80)
  const overCap = boardFor("oem", { vendor: "dgx", payment: "buy", support: "4h" })
  assert.equal(overCap.status, "over")
  assert.ok(overCap.fit <= FIT_BREACH_MAX, `over the CapEx cap: FIT ${overCap.fit}`)
  const capex = overCap.caps.find((c) => c.id === "capex")
  assert.ok(capex.over > 0)
  assert.match(capex.consequence, /Over the CapEx envelope by \$[\d.]+[kM]: the FIA would reject this budget\./)
  assert.ok(capex.fix, "a cap breach names a one-dial fix")
  assert.match(capex.consequence, /would bring it back/)
  const fia = boardFor("network", { ...pick("network"), garage: "wifi" })
  assert.equal(fia.status, "fia")
  assert.ok(fia.fit <= FIT_BREACH_MAX)
  assert.ok(fia.breaches.some((b) => b.kind === "fia" && b.rule === "5.2" && b.dial === "garage"))
  assert.match(fia.hint, /^Breaks FIA 5\.2: .+ would fix that\.$/)
  const power = boardFor("compute", { size: "large", chips: "gpu", storage: "cache" })
  assert.ok(power.caps.find((c) => c.id === "power").over > 0, "28 GPU nodes trip the 400 kW hall")
  assert.ok(power.fit <= FIT_BREACH_MAX)
  const off = boardFor("network", { link: "redundant", path: "public", garage: "umbilical" })
  assert.equal(off.status, "off")
  assert.ok(off.fit > FIT_BREACH_MAX && off.fit < FIT_ZONE, `out of the zone, inside the caps: FIT ${off.fit}`)
  assert.match(off.sentence, /^2 of 3 targets in the zone/)
  assert.match(off.hint, /Latency is still too high: .+ would fix that\./)
  for (const s of C.STATIONS) for (const b of allBoards(s.id)) {
    assert.ok(b.fit >= 0 && b.fit <= 100)
    if (b.breaches.length) assert.ok(b.fit <= FIT_BREACH_MAX, `${s.id} ${JSON.stringify(b.choices)} breached but FIT ${b.fit}`)
    assert.ok(b.sentence.length > 5 && b.hint.length > 5)
  }
})

test("the budget level moves every money cap line, never the power limits", () => {
  for (const s of C.STATIONS) {
    const [tight, standard, generous] = LEVELS.map((l) => boardFor(s.id, GOOD, l))
    for (const id of ["capex", "opex"]) {
      const cap = (b) => b.caps.find((c) => c.id === id).cap
      assert.ok(cap(tight) < cap(standard) && cap(standard) < cap(generous), `${s.id} ${id}`)
      assert.equal(Math.round(cap(tight)), Math.round(s.caps[id] * 0.85))
    }
    const power = (b) => b.caps.find((c) => c.id === "power")?.cap
    assert.equal(power(tight), power(generous))
    const counts = LEVELS.map((l) => allBoards(s.id, l).filter((b) => b.inZone).length)
    assert.ok(counts[0] >= 1, `${s.id}: at least one answer even on a Tight budget`)
    assert.ok(counts[0] <= counts[1] && counts[1] <= counts[2], `${s.id}: ${counts}`)
  }
  assert.equal(boardFor("oem", { vendor: "tier1", payment: "buy", support: "4h" }, "standard").status, "over")
  assert.equal(boardFor("oem", { vendor: "tier1", payment: "buy", support: "4h" }, "generous").status, "zone", "Generous puts buying Dell, HPE or Lenovo within reach")
  assert.equal(C.budgetFor("nonsense").id, C.DEFAULT_BUDGET)
})

test("as-a-service needs a vendor that offers it; DGX falls back to a lease with a note", () => {
  const dgx = boardFor("oem", { vendor: "dgx", payment: "aas", support: "4h" })
  assert.equal(dgx.payment, "lease")
  assert.ok(dgx.notes.some((n) => /as-a-service/.test(n)))
  assert.equal(boardFor("oem", pick("oem")).payment, "aas")
})

test("the plan snapshot, the Architect's summary and the race all read the same board", () => {
  const team = { choices: GOOD }
  for (const s of C.STATIONS) {
    const plan = buildPlan(team, s.id, { id: "P1", at: 1, budget: "tight" })
    const board = boardFor(s.id, GOOD, "tight")
    assert.deepEqual(plan.board, board)
    assert.equal(plan.fit, board.fit)
    assert.equal(plan.decisions.length, 3)
    const summary = designSummary(plan.choices, s.id, "tight")
    assert.equal(summary.fit, board.fit)
    assert.equal(summary.sentences.length, 3)
    assert.equal(summary.targets.length, s.targets.length)
    assert.equal(evaluate(team, "tight").fit[s.id], board.fit)
  }
})

test("only approved tables keep their dials in the race; the rest race on today's setup", () => {
  const team = { choices: GOOD, reviews: approvedAt(["network", "dc"]), plans: { oem: { id: "X" } } }
  const raced = effectiveTeam(team, IDS)
  assert.deepEqual(raced.approved.sort(), ["dc", "network"])
  assert.deepEqual(raced.notApproved, ["oem"])
  assert.deepEqual(raced.missed, ["compute"])
  const ev = evaluate(raced, "standard", IDS)
  assert.ok(ev.boards.network.inZone)
  assert.equal(ev.fit.oem, boardFor("oem", C.BASELINE_CHOICES).fit, "an unapproved table scores today's FIT")
})

test("seconds found per lap: 0.00 on today's setup, 0.25–0.35 in the zone, breaches not allowed", () => {
  for (const budget of C.BUDGET_LEVELS.map((b) => b.id)) {
    for (const s of C.STATIONS) {
      const today = boardFor(s.id, C.BASELINE_CHOICES, budget)
      assert.equal(today.seconds, 0, `${s.id}/${budget}: today's setup finds nothing`)
      for (const b of allBoards(s.id, budget)) {
        assert.equal(typeof b.outcome, "string")
        assert.ok(b.outcome.length > 10 && b.outcome.length < 90, `${s.id}: one plain-English outcome line (${b.outcome})`)
        if (b.status === "over" || b.status === "fia") {
          assert.equal(b.allowed, false)
          assert.equal(b.seconds, 0, "a breach finds no time")
          assert.match(b.outcome, /cap|limit|FIA/)
        } else if (b.inZone) {
          assert.ok(b.allowed && b.seconds >= 0.25 && b.seconds <= 0.35, `${s.id}: in-zone ${b.seconds}`)
          assert.match(b.outcome, /^You've found 0\.\d\d s per lap and you're inside (both|every) caps?\.$/)
        } else {
          assert.ok(b.allowed && b.seconds >= 0 && b.seconds < 0.25, `${s.id}: off-zone ${b.seconds}`)
        }
      }
    }
  }
  const ref = Object.fromEntries(IDS.map((id) => [id, boardFor(id, GOOD).seconds]))
  assert.ok(Object.values(ref).every((v) => v >= 0.25), "the reference build finds time at every table")
  assert.match(boardFor("network", { ...GOOD, path: "public" }).outcome, /strategy call arrives too late/)
  assert.match(boardFor("compute", { ...GOOD, size: "large" }).outcome, /FIA 2\.4|cap/)
})

test("the team total adds up the boards the race sees", () => {
  const ev = evaluate({ choices: GOOD }, "standard", IDS)
  const sum = Math.round(IDS.reduce((a, id) => a + ev.boards[id].seconds, 0) * 100) / 100
  assert.equal(ev.secondsTotal, sum)
  assert.equal(secondsTotal(ev, ["network"]), ev.seconds.network)
  assert.ok(ev.secondsTotal > 1 && ev.secondsTotal <= 4 * SECONDS_MAX)
  const team = { choices: GOOD, reviews: approvedAt(["network", "dc"]) }
  assert.equal(raceSeconds(team, "standard", IDS), Math.round((ev.seconds.network + ev.seconds.dc) * 100) / 100, "only approved tables count")
  assert.equal(raceSeconds({ choices: GOOD }, "standard", IDS), 0)
})
