import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { PHASES, phaseInfo, phaseOf, phaseRemainingMs, playOpen } from "../public/js/session.js"
import { DEMO_STEPS, buildDemo } from "../public/js/demo.js"
import { boardFor, allBoards } from "../public/js/model.js"
import { sceneLabels } from "../public/js/scene.js"
import * as C from "../public/js/catalog.js"
import { DEFAULT_PINS } from "../server.mjs"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const publicFiles = () => [
  ...readdirSync(new URL("public/js/", root)).filter((f) => f.endsWith(".js")).map((f) => `public/js/${f}`),
  ...readdirSync(new URL("public/js/sim/", root)).filter((f) => f.endsWith(".js")).map((f) => `public/js/sim/${f}`),
  ...readdirSync(new URL("public/js/sim/views/", root)).filter((f) => f.endsWith(".js")).map((f) => `public/js/sim/views/${f}`),
  ...readdirSync(new URL("public/", root)).filter((f) => f.endsWith(".html")).map((f) => `public/${f}`),
  "public/css/app.css", "public/css/sim.css", "server.mjs", "README.md",
]

/** Every file below a folder, as paths from the repo root. */
const filesUnder = (folder) => readdirSync(new URL(folder, root), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? filesUnder(`${folder}${entry.name}/`) : [`${folder}${entry.name}`])

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
  for (const w of ["Problem", "Scenario", "Tune", "Seconds found per lap", "FIT", "In the zone", "Over the cap", "Today's setup", "How a provider helps", "What you just learned",
    "Brief", "I've read the brief. Take me to the decisions.", "Each choice locks the moment you tap it. Decide as a team first.", "Tap once to lock", "All three locked", "last time",
    "Solutions Architect", "SA", "Call the Solutions Architect", "Approve", "Reject", "Waiting for the SA", "Read the brief", "Return to home", "2027 plan", "Today's Hinwil setup"]) assert.ok(ui.includes(`"${w}"`), `ui.js lacks "${w}"`)
  /* One participant: nothing to choose, add, switch or rename. */
  for (const file of publicFiles()) {
    const text = read(file)
    for (const gone of ["Choose your team", "Switch team", "Add your team", "Add team", "Team name", "Remove team", "Rename team", "team places", "No teams yet", "chooseTeam", "switchTeam", "addTeam", "TEAM_COLORS", "TEAM_NAME_MAX", "step-zero", "team-grid"]) {
      assert.ok(!text.includes(gone), `${file} still has "${gone}": there is one customer and no team setup`)
    }
  }
  assert.match(ui, /INSTRUCTIONS = \{\s*table:/, "the table's instructions are for the customer's table, not a team")
  assert.ok(!/\btitle: "Teams"/.test(ui), "no Teams instructions")
  assert.match(ui, /lockedCount: \(n, of = 3\) => `Locked \${n} of \${of}`/, "the Locked 1 of 3 counter")
  assert.match(ui, /rejected: \(reason\) => `Rejected: \${reason \|\| "no reason given"}\. Adjust your choices and call the SA again\. This takes time and the SA may be busy\.`/, "the rejection text")
  assert.match(ui, /STATION_TABS = \[\["brief", "1 · Brief"\], \["tune", "2 · Tune"\], \["pitch", "3 · Pitch"\]\]/, "three steps: Brief, Tune, Pitch")
  for (const file of publicFiles()) {
    const text = read(file)
    assert.ok(!/Optimised|Run simulation|Simulate\b|tierFor|Front-runner|Midfield|Challenger/.test(text), `${file} still has the old score, Simulate step or tiers`)
  }
  const readme = read("README.md")
  assert.ok(!/1950|`2027`|default-PIN warning|rotate the PINs|rotation/.test(readme), "the README no longer rotates PINs")
  const install = read("scripts/install-service.sh")
  assert.ok(!/read -r -s|1950|rehearsal default/.test(install), "the install script no longer prompts for PINs")
  assert.ok(install.includes(`EVENT_PIN="${DEFAULT_PINS.host}"`), "the install script sets the one event PIN")
})

test("the host PIN is hidden from every view: in no file under public/, once in the README, and typed into masked fields", () => {
  const pin = DEFAULT_PINS.host
  assert.ok(pin && DEFAULT_PINS.leader === pin && DEFAULT_PINS.race === pin, "one event PIN for the host, the SAs and the race")
  const files = filesUnder("public/")
  assert.ok(files.length > 15, "every file under public/ is checked")
  for (const file of files) assert.ok(!read(file).toLowerCase().includes(pin.toLowerCase()), `${file} shows the PIN`)
  assert.equal(read("README.md").split(pin).length - 1, 1, "the README gives the PIN value exactly once")
  const holders = read("server.mjs").split("\n").filter((line) => line.includes(pin))
  assert.ok(holders.length === 1 && holders[0].startsWith("export const DEFAULT_PINS ="), "server.mjs holds the PIN in DEFAULT_PINS only")
  const installer = read("scripts/install-service.sh").split("\n").filter((line) => line.includes(pin))
  assert.ok(installer.length === 1 && installer[0].startsWith("EVENT_PIN="), "the installer holds the PIN in EVENT_PIN only")
  for (const file of ["public/js/host.js", "public/js/raceview.js"]) {
    const text = read(file)
    const fields = text.match(/type: "password"[^}]*/g) || []
    assert.ok(fields.length > 0, `${file} has a PIN field`)
    for (const field of fields) assert.match(field, /autocomplete: "off"/, `${file}: a PIN field without autocomplete off`)
    assert.ok(!/type = "text"|reveal|Show PIN|showPin/i.test(text), `${file} can reveal the PIN`)
    assert.ok(!/[?&]pin=|searchParams\.(get|set)\("pin"/i.test(text), `${file} puts the PIN in a URL`)
  }
  const server = read("server.mjs")
  assert.ok(!/console\.\w+\([^)]*\b(pin|PINS|password)\b/.test(server), "the server never logs a PIN")
})

test("dead modules are gone", () => {
  const js = readdirSync(new URL("public/js/", root))
  for (const gone of ["architect.js", "tokenomics.js", "decisioncopy.js", "sim.js"]) assert.ok(!js.includes(gone), `${gone} should be removed`)
})

test("phases come from the shared state", () => {
  const now = 1_000_000
  const s = { settings: { budget: "standard" }, clock: { status: "open" }, race: null }
  assert.deepEqual(PHASES.map((p) => p.id), ["open", "play", "paused", "ended", "race", "readout"])
  assert.equal(phaseOf(s), "open")
  assert.ok(Number.isNaN(phaseRemainingMs(s, 0, now)), "an open session has no countdown")
  assert.equal(phaseInfo("open").idle, "No timer")
  assert.equal(phaseOf({ ...s, clock: { status: "lobby" } }), "open", "an unknown clock is an open session")
  assert.equal(phaseOf({ ...s, clock: { status: "running", endsAt: now + 1000 } }), "play")
  assert.equal(phaseRemainingMs({ ...s, clock: { status: "running", endsAt: now + 1000 } }, 0, now), 1000)
  assert.equal(phaseOf({ ...s, clock: { status: "paused", remainingMs: 5000 } }), "paused")
  assert.equal(phaseRemainingMs({ ...s, clock: { status: "paused", remainingMs: 5000 } }, 0, now), 5000)
  assert.equal(phaseOf({ ...s, clock: { status: "ended" } }), "ended")
  assert.equal(phaseOf({ ...s, clock: { status: "ended" }, race: {} }), "race")
  assert.equal(phaseOf({ ...s, clock: { status: "ended" }, race: {}, readout: { startedAt: now } }), "readout")
  for (const [clock, open] of [["open", true], ["running", true], ["paused", true], ["ended", false]]) assert.equal(playOpen({ ...s, clock: { status: clock, endsAt: now + 1000 } }), open, `${clock}: tables ${open ? "open" : "locked"}`)
  assert.equal(playOpen({ ...s, race: {} }), false, "the race locks every table")
})

test("demo steps: brief → tune (one tap locks; out of the zone, then in it) → call the SA → rejected → approved → race → readout, for the one customer", () => {
  assert.deepEqual(DEMO_STEPS.map((s) => s.id), ["brief", "tune", "zone", "pitch", "reject", "approve", "race", "readout"])
  const raceAt = DEMO_STEPS.findIndex((s) => s.id === "race")
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const d = buildDemo(i)
    assert.equal(d.step.id, DEMO_STEPS[i].id)
    assert.deepEqual(d.state.teams.map((t) => t.id), [C.CUSTOMER_TEAM.id], "the demo plays the one customer")
    assert.equal(d.focus.team, C.CUSTOMER_TEAM.id)
    const team = d.state.teams.find((t) => t.id === d.focus.team)
    assert.equal(team.name, C.CUSTOMER_TEAM.name)
    const board = boardFor(d.focus.station, team.choices)
    for (const key of ["briefRead", "attempts", "previous"]) assert.equal(typeof team[key], "object", `the pretend customer carries ${key}`)
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
      const ids = d.state.race.result.results.map((r) => r.id).sort()
      assert.deepEqual(ids, [C.CUSTOMER_TEAM.id, C.FINALE_ENTRANTS.today.id].sort(), "two cars: the 2027 plan and today's Hinwil setup")
      assert.equal(team.attempts[d.focus.station], 2)
    }
  }
  for (const step of DEMO_STEPS) assert.ok(!/\bArchitect\b(?<!Solutions Architect)/.test(step.narration.replace(/Solutions Architect/g, "SA")), `${step.id}: narration says Architect without Solutions`)
  assert.ok(DEMO_STEPS.some((s) => /Rejected|rejected/.test(s.narration)) && DEMO_STEPS.some((s) => /locks the moment|one tap|Locked 1 of 3/i.test(s.narration)), "the demo shows one-shot locking and a rejection")
  assert.ok(DEMO_STEPS.some((s) => /2027 plan/.test(s.narration) && /today/.test(s.narration)), "the demo race is the plan against today")
})

test("the simulator is the front door; the legacy table picker lives at /home.html and is linked from no page", () => {
  const index = read("public/index.html")
  assert.ok(index.includes('url=/sim.html') && index.includes('href="/sim.html"'), "index.html opens the simulator")
  assert.ok(index.includes('href="/case.html"'), "the business case stays one tap away")
  assert.ok(!/station\.html|host\.html|race\.html|home\.html/.test(index), "no legacy game links on the front door")
  const sim = read("public/sim.html")
  assert.ok(sim.includes("/js/sim/app.js") && sim.includes("/css/sim.css"), "sim.html mounts the simulator")
  for (const file of ["public/sim.html", ...filesUnder("public/js/sim/")]) {
    assert.ok(!/station\.html|host\.html|race\.html|home\.html/.test(read(file)), `${file} links to a legacy game page`)
  }
  const start = read("start.command")
  assert.ok(start.includes('PORT="${PORT:-8090}"'), "start.command defaults to port 8090")
  assert.match(read("server.mjs"), /process\.env\.PORT\) \|\| 8090/, "the server defaults to port 8090")
})

test("the legacy landing page (home.html) puts the four tables first with a short how-to; it and the README describe the single-customer flow", () => {
  const home = read("public/home.html")
  for (const w of ["Pick your table", "Nothing to set up", "The customer's table", "Solutions Architects", "Session host", "Projector", "Brief", "Tune", "locks the moment you tap it", "Call the Solutions Architect", "seconds per lap", "2027 plan", "today's Hinwil setup", "Host controls"]) assert.ok(home.includes(w), `home.html lacks "${w}"`)
  assert.ok(home.indexOf('id="stations"') < home.indexOf('id="howToPlay"') && home.indexOf('id="howToPlay"') < home.indexOf('id="hostLink"'), "tables first, then how to play, then the small links")
  const steps = home.slice(home.indexOf('id="howToPlay"'), home.indexOf("</ol>")).match(/<li>/g) || []
  assert.ok(steps.length >= 3 && steps.length <= 4, `three or four how-to lines (${steps.length})`)
  assert.ok(!/setup wizard|lobby|Start the brief|session plan/i.test(home), "the landing page has no host-run steps")
  assert.ok(home.includes('href="/case.html"'), "the case page stays one tap away")
  const readme = read("README.md")
  for (const w of ["FIT", "Tight", "Generous", "Today's setup", "How a provider helps", "Seconds found per lap", "wind tunnel", "lap-time ladder", "Solutions Architect", "I've read the brief", "Attempt", "Reject", "Words to know",
    "one participant", "2027 plan", "today's Hinwil setup", "No timer", "Start timer", "Reset timer", "the host PIN", "Restart the experience", "/api/teams/t1/", "/api/host/timer", "/api/host/team", "/api/host/budget", "410"]) assert.ok(readme.includes(w), `README lacks "${w}"`)
  assert.ok(!/\/api\/host\/setup|\/api\/host\/phase|setup wizard|Start the brief|briefDone/i.test(readme), "the README no longer describes host setup or host-run phases")
  for (const file of filesUnder("public/")) assert.ok(!/\/api\/host\/(setup|phase)\b/.test(read(file)), `${file} still calls a removed host route`)
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
  assert.match(sceneLabels(ref).find((l) => l.dial === "cooling").text, /^Liquid cooling: cluster at 100% \(\+0\.\d\d s\)$/)
})

test("the demo tune step lets a dial change the wind-tunnel scene", () => {
  const d = buildDemo(DEMO_STEPS.findIndex((s) => s.id === "tune"))
  assert.equal(d.focus.station, "compute")
  const before = boardFor("compute", d.state.teams[0].choices)
  const after = boardFor("compute", { ...d.state.teams[0].choices, storage: C.REFERENCE_BUILD.storage })
  assert.ok(!before.inZone && after.inZone && after.seconds > before.seconds, "one dial takes the demo board into the zone")
})
