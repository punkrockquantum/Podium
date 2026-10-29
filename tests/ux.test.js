import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { phaseOf, phaseRemainingMs } from "../public/js/session.js"
import { DEMO_STEPS, buildDemo } from "../public/js/demo.js"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const publicFiles = () => [
  ...readdirSync(new URL("public/js/", root)).map((f) => `public/js/${f}`),
  ...readdirSync(new URL("public/", root)).filter((f) => f.endsWith(".html")).map((f) => `public/${f}`),
  "public/css/app.css", "server.mjs", "README.md",
]

test("one vocabulary: Architect everywhere, no table leader, no FLUX", () => {
  for (const file of publicFiles()) {
    const text = read(file)
    assert.ok(!/FLUX/i.test(text), `${file} mentions FLUX`)
    assert.ok(!/table leader|Call the leader|Leader PIN/i.test(text), `${file} still says leader`)
    assert.ok(!/Token Efficiency|Grant Architect|ARCHITECT<|badge-arch/.test(text), `${file} still has Architect mode`)
  }
  const ui = read("public/js/ui.js")
  for (const w of ["Choose your team", "Switch team", "Run simulation", "Lock in", "Call the Architect", "Waiting for Architect", "Listen to the brief", "Take a screenshot now", "Return to home"]) assert.ok(ui.includes(w), `ui.js lacks "${w}"`)
  assert.match(ui, /\["brief", "1 · Brief"\], \["decide", "2 · Decide"\], \["sim", "3 · Simulate"\], \["pitch", "4 · Pitch"\]/)
})

test("dead modules are gone", () => {
  const js = readdirSync(new URL("public/js/", root))
  for (const gone of ["architect.js", "tokenomics.js", "decisioncopy.js"]) assert.ok(!js.includes(gone), `${gone} should be removed`)
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

test("demo steps: brief → play → pitch → approve → race → readout", () => {
  assert.deepEqual(DEMO_STEPS.map((s) => s.id), ["brief", "play", "pitch", "approve", "race", "readout"])
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const d = buildDemo(i)
    assert.equal(d.step.id, DEMO_STEPS[i].id)
    if (i >= 4) assert.ok(d.state.race.result.results.length === 3)
  }
})
