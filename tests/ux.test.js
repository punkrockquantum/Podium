import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { phaseOf, phaseRemainingMs } from "../public/js/session.js"
import { DEMO_STEPS, buildDemo } from "../public/js/demo.js"
import { boardFor, allBoards } from "../public/js/model.js"
import { sceneLabels } from "../public/js/scene.js"
import * as C from "../public/js/catalog.js"

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
  for (const w of ["Choose your team", "Switch team", "Problem", "Scenario", "Tune", "Seconds found per lap", "FIT", "In the zone", "Over the cap", "Today's setup", "How a provider helps", "What you just learned", "Lock in", "Call the Architect", "Waiting for Architect", "Listen to the brief", "Take a screenshot now", "Return to home"]) assert.ok(ui.includes(`"${w}"`), `ui.js lacks "${w}"`)
  assert.match(ui, /STATION_TABS = \[\["tune", "1 · Scenario & Tune"\], \["pitch", "2 · Pitch"\]\]/, "two tabs: the scenario is merged into Tune")
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

test("the landing page explains the scenario, Tune, seconds found, FIT, today's setup and the budget level", () => {
  const home = read("public/index.html")
  for (const w of ["Scenario", "Tune", "seconds found per lap", "FIT", "today's setup", "budget level", "existing setup", "wind tunnel"]) assert.ok(home.includes(w), `index.html lacks "${w}"`)
  const readme = read("README.md")
  for (const w of ["FIT", "Tight", "Generous", "Today's setup", "How a provider helps", "Seconds found per lap", "wind tunnel", "lap-time ladder"]) assert.ok(readme.includes(w), `README lacks "${w}"`)
})

test("every scene label is 8 words or fewer, names its dial and quotes the seconds that dial found", () => {
  for (const station of C.STATIONS) {
    for (const b of allBoards(station.id)) {
      const labels = sceneLabels(b)
      assert.equal(labels.length, 3, `${station.id}: one label per dial`)
      for (const l of labels) {
        assert.ok(l.text.split(/\s+/).length <= 8, `${station.id} label too long: "${l.text}"`)
        if (b.choices[l.dial] === C.decision(l.dial).today) assert.ok(!/\(\S+ s\)$/.test(l.text), `a dial at today's setting claims no seconds: "${l.text}"`)
      }
    }
  }
  const ref = boardFor("dc", C.REFERENCE_BUILD)
  assert.match(sceneLabels(ref).find((l) => l.dial === "cooling").text, /^Liquid cooling: GPUs at 100% \(\+0\.\d\d s\)$/)
})

test("the demo tune step lets a dial change the wind-tunnel scene", () => {
  const d = buildDemo(DEMO_STEPS.findIndex((s) => s.id === "tune"))
  assert.equal(d.focus.station, "compute")
  const before = boardFor("compute", d.state.teams[0].choices)
  const after = boardFor("compute", { ...d.state.teams[0].choices, storage: C.REFERENCE_BUILD.storage })
  assert.ok(!before.inZone && after.inZone && after.seconds > before.seconds, "one dial takes the demo board into the zone")
})
