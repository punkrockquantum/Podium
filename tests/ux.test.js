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

test("one vocabulary: Solutions Architect (SA) everywhere, no bare Architect, no table leader, no retired product name", () => {
  for (const file of publicFiles()) {
    const text = read(file)
    assert.ok(!RETIRED_BRAND.test(text), `${file} mentions the retired product name`)
    assert.ok(!/table leader|Call the leader|Leader PIN/i.test(text), `${file} still says leader`)
    assert.ok(!/Token Efficiency|Grant Architect|ARCHITECT<|badge-arch/.test(text), `${file} still has Architect mode`)
    /* The role is the Solutions Architect (short: SA): a capitalised "Architect" on its own is the old name. */
    const bare = text.match(/(?<!Solutions )(?<!Solutions\n)\bArchitect\b(?! PIN variable)/g)
    assert.ok(!bare, `${file} says "Architect" without "Solutions" ${bare ? `(${bare.length}×)` : ""}`)
    assert.ok(!/Send back|sent back|sendBack|Lock in\b|lockIn|\/submit/.test(text) || file === "README.md", `${file} still has the old lock-in or send-back flow`)
  }
  const ui = read("public/js/ui.js")
  for (const w of ["Choose your team", "Switch team", "Problem", "Scenario", "Tune", "Seconds found per lap", "FIT", "In the zone", "Over the cap", "Today's setup", "How a provider helps", "What you just learned",
    "Brief", "I've read the brief. Take me to the decisions.", "Each choice locks the moment you tap it. Decide as a team first.", "Tap once to lock", "All three locked", "last time",
    "Solutions Architect", "SA", "Call the Solutions Architect", "Approve", "Reject", "Waiting for the SA", "Read the brief", "Return to home"]) assert.ok(ui.includes(`"${w}"`), `ui.js lacks "${w}"`)
  assert.match(ui, /lockedCount: \(n, of = 3\) => `Locked \${n} of \${of}`/, "the Locked 1 of 3 counter")
  assert.match(ui, /rejected: \(reason\) => `Rejected: \${reason \|\| "no reason given"}\. Adjust your choices and call the SA again\. This takes time and the SA may be busy\.`/, "the rejection text")
  assert.match(ui, /STATION_TABS = \[\["brief", "1 · Brief"\], \["tune", "2 · Tune"\], \["pitch", "3 · Pitch"\]\]/, "three steps: Brief, Tune, Pitch")
  for (const file of publicFiles()) {
    const text = read(file)
    assert.ok(!/Optimised|Run simulation|Simulate\b|tierFor|Front-runner|Midfield|Challenger/.test(text), `${file} still has the old score, Simulate step or tiers`)
  }
  const readme = read("README.md")
  assert.ok(!/1950|`2027`|default-PIN warning|rotate the PINs|rotation/.test(readme), "the README no longer rotates PINs")
  assert.ok(readme.includes("SKO27"), "the README names the one event PIN")
  const install = read("scripts/install-service.sh")
  assert.ok(!/read -r -s|1950|rehearsal default/.test(install), "the install script no longer prompts for PINs")
  assert.match(install, /EVENT_PIN="SKO27"/)
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

test("demo steps: brief → tune (one tap locks; out of the zone, then in it) → call the SA → rejected → approved → race → readout", () => {
  assert.deepEqual(DEMO_STEPS.map((s) => s.id), ["brief", "tune", "zone", "pitch", "reject", "approve", "race", "readout"])
  const raceAt = DEMO_STEPS.findIndex((s) => s.id === "race")
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const d = buildDemo(i)
    assert.equal(d.step.id, DEMO_STEPS[i].id)
    const team = d.state.teams.find((t) => t.id === d.focus.team)
    const board = boardFor(d.focus.station, team.choices)
    for (const key of ["briefRead", "attempts", "previous"]) assert.equal(typeof team[key], "object", `pretend teams carry ${key}`)
    if (d.step.id === "tune") assert.equal(board.inZone, false, "the tune step starts out of the zone")
    if (d.step.id === "zone") assert.equal(board.inZone, true, "and the next step is in it")
    if (d.step.id === "pitch") assert.ok(team.plans[d.focus.station] && team.attempts[d.focus.station] === 1, "all three locked: attempt 1")
    if (d.step.id === "reject") {
      assert.equal(team.reviews[d.focus.station].status, "rejected")
      assert.ok(team.reviews[d.focus.station].reason.length > 0, "a reason the team sees")
      assert.ok(Object.keys(team.previous[d.focus.station]).length === 3, "last time's picks are ghosts")
      assert.equal(team.plans[d.focus.station], undefined, "the dials are open again")
    }
    if (d.step.id === "approve") assert.equal(d.state.pitches[d.focus.station].attempt, 2, "the second attempt is being pitched")
    if (i >= raceAt) {
      assert.equal(d.state.race.result.results.length, 3)
      assert.equal(team.attempts[d.focus.station], 2)
    }
  }
  for (const step of DEMO_STEPS) assert.ok(!/\bArchitect\b(?<!Solutions Architect)/.test(step.narration.replace(/Solutions Architect/g, "SA")), `${step.id}: narration says Architect without Solutions`)
  assert.ok(DEMO_STEPS.some((s) => /Rejected|rejected/.test(s.narration)) && DEMO_STEPS.some((s) => /locks the moment|one tap|Locked 1 of 3/i.test(s.narration)), "the demo shows one-shot locking and a rejection")
})

test("the landing page and README explain the brief, one-shot Tune, the SA, seconds found, FIT, today's setup and the budget level", () => {
  const home = read("public/index.html")
  for (const w of ["Brief", "Tune", "locks the moment you tap it", "Locked 1 of 3", "Call the Solutions Architect", "Rejected", "seconds found per lap", "FIT", "today's setup", "budget level", "existing setup", "wind tunnel", "SKO27"]) assert.ok(home.includes(w), `index.html lacks "${w}"`)
  const readme = read("README.md")
  for (const w of ["FIT", "Tight", "Generous", "Today's setup", "How a provider helps", "Seconds found per lap", "wind tunnel", "lap-time ladder", "Solutions Architect", "SKO27", "I've read the brief", "Attempt", "Reject", "Words to know"]) assert.ok(readme.includes(w), `README lacks "${w}"`)
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
