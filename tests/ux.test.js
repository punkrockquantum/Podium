import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { phaseOf, phaseRemainingMs } from "../public/js/session.js"
import { DEMO_STEPS, buildDemo } from "../public/js/demo.js"
import { boardFor } from "../public/js/model.js"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const publicFiles = () => [
  ...readdirSync(new URL("public/js/", root)).map((f) => `public/js/${f}`),
  ...readdirSync(new URL("public/", root)).filter((f) => f.endsWith(".html")).map((f) => `public/${f}`),
  "public/css/app.css", "server.mjs", "README.md",
]

const RETIRED_BRAND = new RegExp(["F", "L", "U", "X"].join(""), "i")

test("one vocabulary: Architect everywhere, no table leader, no retired product name", () => {
  for (const file of publicFiles()) {
    const text = read(file)
    assert.ok(!RETIRED_BRAND.test(text), `${file} mentions the retired product name`)
    assert.ok(!/table leader|Call the leader|Leader PIN/i.test(text), `${file} still says leader`)
    assert.ok(!/Token Efficiency|Grant Architect|ARCHITECT<|badge-arch/.test(text), `${file} still has Architect mode`)
  }
  const ui = read("public/js/ui.js")
  for (const w of ["Choose your team", "Switch team", "Problem", "Tune", "FIT", "In the zone", "Over the cap", "Today's setup", "How a provider helps", "What you just learned", "Lock in", "Call the Architect", "Waiting for Architect", "Listen to the brief", "Take a screenshot now", "Return to home"]) assert.ok(ui.includes(`"${w}"`), `ui.js lacks "${w}"`)
  assert.match(ui, /\["problem", "1 · Problem"\], \["tune", "2 · Tune"\], \["pitch", "3 · Pitch"\]/)
  for (const file of publicFiles()) {
    const text = read(file)
    assert.ok(!/Optimised|Run simulation|Simulate\b|tierFor|Front-runner|Midfield|Challenger/.test(text), `${file} still has the old score, Simulate step or tiers`)
  }
})

test("dead modules are gone", () => {
  const js = readdirSync(new URL("public/js/", root))
  for (const gone of ["architect.js", "tokenomics.js", "decisioncopy.js", "sim.js"]) assert.ok(!js.includes(gone), `${gone} should be removed`)
})

test("phases come from the shared state", () => {
  const now = 1_000_000
  const s = { settings: { playMinutes: 35 }, brief: { status: "idle" }, clock: { status: "lobby" }, race: null }
  assert.equal(phaseOf(s), "lobby")
  assert.equal(phaseRemainingMs(s, 0, now), 35 * 60_000)
  assert.equal(phaseOf({ ...s, brief: { status: "running", endsAt: now + 1000 } }), "brief")
  assert.equal(phaseRemainingMs({ ...s, brief: { status: "running", endsAt: now + 1000 } }, 0, now), 1000)
  assert.equal(phaseOf({ ...s, brief: { status: "done" } }), "briefDone")
  assert.equal(phaseOf({ ...s, clock: { status: "running", endsAt: now + 5 } }), "play")
  assert.equal(phaseOf({ ...s, clock: { status: "ended" } }), "ended")
  assert.equal(phaseOf({ ...s, clock: { status: "ended" }, race: {} }), "race")
  assert.equal(phaseOf({ ...s, clock: { status: "ended" }, race: {}, readout: { endsAt: now } }), "readout")
})

test("demo steps: problem → tune (out of the zone, then in it) → pitch → approve → race → readout", () => {
  assert.deepEqual(DEMO_STEPS.map((s) => s.id), ["brief", "tune", "zone", "pitch", "approve", "race", "readout"])
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const d = buildDemo(i)
    assert.equal(d.step.id, DEMO_STEPS[i].id)
    const team = d.state.teams.find((t) => t.id === d.focus.team)
    const board = boardFor(d.focus.station, team.choices)
    if (d.step.id === "tune") assert.equal(board.inZone, false, "the tune step starts out of the zone")
    if (d.step.id === "zone") assert.equal(board.inZone, true, "and the next step is in it")
    if (i >= 5) assert.equal(d.state.race.result.results.length, 3)
  }
})

test("the landing page explains Problem, Tune, FIT, today's setup and the budget level", () => {
  const home = read("public/index.html")
  for (const w of ["Problem", "Tune", "FIT", "today's setup", "budget level", "existing setup"]) assert.ok(home.includes(w), `index.html lacks "${w}"`)
  const readme = read("README.md")
  for (const w of ["FIT", "Tight", "Generous", "Today's setup", "How a provider helps"]) assert.ok(readme.includes(w), `README lacks "${w}"`)
})
