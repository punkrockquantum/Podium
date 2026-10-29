import { test } from "node:test"
import assert from "node:assert/strict"
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as C from "../public/js/catalog.js"
import { evaluate } from "../public/js/model.js"
import { simulateStation, REFERENCE_BUILD } from "../public/js/sim.js"
import { architectReport, sanitiseTuning, GAIN_RANGE } from "../public/js/architect.js"
import { DEMO_STEPS, buildDemo } from "../public/js/demo.js"
import { createApp } from "../server.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

test("table points: an approved table scores its system score plus 10%; anything else scores 0", () => {
  assert.equal(C.tablePoints(100, true), C.PITCH_MAX)
  assert.equal(C.tablePoints(80, true), Math.round((80 * 1.1) / 4))
  assert.equal(C.tablePoints(80, false), 0)
  assert.equal(C.APPROVAL_BONUS, 0.1)
  assert.equal(C.VERDICTS, undefined, "the three-level verdict is retired")
})

test("Architect: a good tune gains, a bad tune loses, and the gain is clamped", () => {
  const team = { rank: 5, choices: REFERENCE_BUILD }
  const good = architectReport(team, { precision: "fp8", batchCap: 128, continuousBatching: true, kvTier: true })
  const bad = architectReport(team, { precision: "bf16", batchCap: 8, continuousBatching: false, kvTier: false })
  assert.ok(good.gain > 1.2, `good tune ${good.gain}`)
  assert.ok(bad.gain < 1, `bad tune ${bad.gain}`)
  for (const r of [good, bad]) assert.ok(r.gain >= GAIN_RANGE[0] && r.gain <= GAIN_RANGE[1])
  assert.ok(good.tuned.tokPerS > good.base.tokPerS && good.tuned.costPerM < good.base.costPerM)
  assert.deepEqual(sanitiseTuning({ precision: "fp2", batchCap: 32, evil: "x" }), { batchCap: 32 })
})

test("Architect gain feeds the model only when the host has granted it", () => {
  const base = evaluate({ rank: 5, choices: REFERENCE_BUILD })
  const granted = evaluate({ rank: 5, choices: REFERENCE_BUILD, architect: { enabled: true, gain: 1.8 } })
  const notGranted = evaluate({ rank: 5, choices: REFERENCE_BUILD, architect: { enabled: false, gain: 1.8 } })
  assert.ok(granted.ai.tokens > base.ai.tokens * 1.5)
  assert.equal(notGranted.ai.tokens, base.ai.tokens)
  assert.equal(granted.ai.architectGain, 1.8)
  const weak = { rank: 5, choices: { ...REFERENCE_BUILD, racks: 1, platform: "h100", deploy: "cloud", modelSize: "400b", precision: "fp32" } }
  assert.ok(simulateStation({ ...weak, architect: { enabled: true, gain: 3 } }, {}, "ai").parts.performance >= simulateStation(weak, {}, "ai").parts.performance)
})

test("demo mode is pure: deterministic, self-contained, and never touches the real game", async () => {
  const dir = await mkdtemp(join(tmpdir(), "podium-demo-"))
  const app = createApp({ dataDir: dir, pins: { host: "h", leader: "l" } })
  try {
    const real = JSON.stringify(app.getState())
    const catalog = JSON.stringify([C.DECISIONS, C.DEFAULT_CHOICES, C.STATIONS])
    const runs = DEMO_STEPS.map((_, i) => buildDemo(i))
    assert.equal(runs.at(-1).step.id, "race")
    assert.ok(runs.at(-1).state.race.result.standings.length === 3)
    assert.equal(runs[6].state.teams[0].plans.ai.id, "DEMOA")
    runs[6].state.teams[0].name = "mutated"
    assert.equal(buildDemo(6).state.teams[0].name, "Demo Racing", "each step is a fresh object")
    assert.deepEqual(JSON.parse(JSON.stringify(buildDemo(13).state)), JSON.parse(JSON.stringify(runs[13].state)))
    assert.equal(JSON.stringify(app.getState()), real, "the real game is untouched")
    assert.equal(JSON.stringify([C.DECISIONS, C.DEFAULT_CHOICES, C.STATIONS]), catalog, "the catalog is untouched")
    const source = await readFile(join(ROOT, "public/js/demo.js"), "utf8")
    for (const banned of ["fetch(", "post(", "XMLHttpRequest", "localStorage", "sessionStorage", "/api/"]) assert.ok(!source.includes(banned), `demo.js uses ${banned}`)
  } finally {
    app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test("no file in the project mentions the retired brand", async () => {
  const banned = new RegExp(["fl", "ux"].join(""), "i")
  const hits = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (banned.test(entry.name) || banned.test(await readFile(path, "latin1"))) hits.push(path.slice(ROOT.length + 1))
    }
  }
  await walk(ROOT)
  assert.deepEqual(hits, [])
})
