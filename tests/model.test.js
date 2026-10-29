import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate, cpuRates, resolveChoices, aeroGainFor, execution } from "../public/js/model.js"
import { REFERENCE_BUILD } from "../public/js/sim.js"

const SMART = { ...REFERENCE_BUILD }

test("FIA billing: turbo is billed at max boost, a clock lock at its locked frequency", () => {
  const cpu = C.byId(C.CPUS, "epyc9575f")
  const turbo = cpuRates(cpu, C.byId(C.CLOCKS, "turbo"))
  const lock = cpuRates(cpu, C.byId(C.CLOCKS, "lock70"))
  assert.equal(turbo.billedGHz, cpu.boostGHz)
  assert.ok(Math.abs(lock.billedGHz - cpu.baseGHz * 0.7) < 1e-9)
  assert.ok(lock.efficiency > turbo.efficiency, "memory-bound CFD wastes billed FLOPs at high clocks")
})

test("defaults are valid, hidden decisions are fixed, and bad input resolves to the defaults", () => {
  for (const d of C.DECISIONS) {
    if (d.hidden) assert.equal(C.validChoice(d.id, d.def), false, `${d.id} is hidden and cannot be chosen`)
    else assert.ok(C.validChoice(d.id, C.DEFAULT_CHOICES[d.id]), d.id)
  }
  assert.deepEqual(resolveChoices({ cpu: "not-a-cpu", nodes: 999 }), C.DEFAULT_CHOICES)
})

test("each table shows 4–6 decisions with 2–4 options (5 for OEM and accelerator), each with a one-line why", () => {
  for (const s of C.STATIONS) {
    const visible = C.visibleDecisions(s.id)
    assert.ok(visible.length >= 4 && visible.length <= 6, `${s.id} has ${visible.length} decisions`)
    for (const d of visible) {
      const count = d.options ? d.options.length : d.values.length
      assert.ok(count >= 2 && count <= 5, `${d.id} has ${count} options`)
      if (d.options) {
        assert.ok(count >= 2 && count <= (["oem", "platform"].includes(d.id) ? 5 : 4), `${d.id} has ${count} cards`)
        for (const o of d.options) assert.ok(typeof o.why === "string" && o.why.length > 10 && o.why.length < 160, `${d.id}.${o.id} why`)
      }
    }
  }
})

test("every option is labelled: an FIA rule tag where a regulation drives it, est. for estimates", () => {
  for (const d of C.DECISIONS) {
    for (const o of d.options || []) {
      assert.ok(["IND", "FIA", "PODIUM"].includes(o.src), `${d.id}.${o.id} src ${o.src}`)
      const tag = C.optionTag(o)
      if (o.fia) assert.deepEqual(tag, { kind: "fia", text: `FIA rule ${o.fia}` })
      else if (o.est) assert.deepEqual(tag, { kind: "est", text: "est." })
      else assert.equal(tag, null)
    }
  }
})

test("bundled options set their hidden decisions", () => {
  assert.equal(resolveChoices({ trackside: "fia" }).tunnels, "redundant")
  assert.equal(resolveChoices({ trackside: "wireless" }).garage, "wifidump")
  assert.equal(resolveChoices({ audit: "full" }).curfew, "auto")
  assert.equal(resolveChoices({ audit: "full", logs: "standard" }).logs, "worm", "a hidden decision cannot be set directly")
})

test("a disciplined build beats the defaults on aero and strategy", () => {
  const base = evaluate({ rank: 7, choices: {} })
  const smart = evaluate({ rank: 7, choices: SMART })
  assert.ok(smart.aero.index > base.aero.index * 3, `${smart.aero.index} vs ${base.aero.index}`)
  assert.ok(smart.strategy > base.strategy)
  assert.ok(smart.network.loopS < base.network.loopS)
  assert.ok(smart.penalties.length < base.penalties.length)
})

test("NVL72 racks in an air hall throttle; a liquid hall does not", () => {
  const air = evaluate({ rank: 5, choices: { ...SMART, platform: "gb300", racks: 1, hall: "A", tgp: "std" } })
  const liquid = evaluate({ rank: 5, choices: { ...SMART, platform: "gb300", racks: 1, hall: "L", tgp: "std", block: 0.5 } })
  assert.ok(air.cooling.thermal < 1, "air hall should throttle a 142 kW rack")
  assert.equal(liquid.cooling.thermal, 1)
})

test("illegal choices raise FIA penalties", () => {
  const ev = evaluate({ rank: 5, choices: { ...SMART, trackside: "wireless", dataflow: "bidir", workforce: "immediate" } })
  const ids = ev.penalties.map((p) => p.id)
  for (const id of ["bidir", "workforce", "5g"]) assert.ok(ids.includes(id), `${id} in ${ids}`)
})

test("OEM choice changes CapEx in the direction of its price multiplier", () => {
  const sm = evaluate({ rank: 5, choices: { ...SMART, oem: "supermicro" } })
  const nv = evaluate({ rank: 5, choices: { ...SMART, oem: "nvidia" } })
  assert.ok(sm.ledger.capex < nv.ledger.capex)
  for (const oem of C.OEMS) assert.ok(evaluate({ rank: 5, choices: { ...SMART, oem: oem.id } }).ledger.capex > 0)
})

test("overspending the CapEx envelope is flagged", () => {
  const ev = evaluate({ rank: 2, choices: { ...SMART, platform: "gb300", racks: 4, nodes: 16 } })
  assert.ok(ev.ledger.capexOver > 0)
  assert.ok(ev.checks.some((c) => c.state === "red"))
})

test("aero gain saturates and pitch execution stays in range", () => {
  assert.equal(aeroGainFor(0), 0)
  assert.ok(aeroGainFor(100) <= 0.9)
  assert.equal(execution({}, "compute"), 0.97)
  assert.ok(Math.abs(execution({ compute: C.PITCH_MAX }, "compute") - 1.04) < 1e-9)
  assert.equal(execution({ compute: 0 }, "compute"), 0.94)
})

const AI = { ...SMART, platform: "b300", racks: 1, deploy: "own", tgp: "eco85", hall: "L", block: 0.5 }

test("AI memory: weights + KV fit, or spill and offload", () => {
  const fits = evaluate({ rank: 5, choices: { ...AI, modelSize: "70b", precision: "fp8", hbm: "hbm288" } })
  assert.equal(fits.ai.memory.state, "fits")
  const big = evaluate({ rank: 5, choices: { ...AI, modelSize: "400b", precision: "fp32", hbm: "hbm80", platform: "h100", kv: "off" } })
  assert.equal(big.ai.memory.state, "offload")
  assert.ok(big.ai.memory.eff < fits.ai.memory.eff)
  assert.ok(big.ai.tokens < fits.ai.tokens / 10)
})

test("precision changes speed and accuracy but never the FIA compute bill", () => {
  const runs = ["fp32", "bf16", "fp8", "int8"].map((precision) => evaluate({ rank: 5, choices: { ...AI, modelSize: "70b", hbm: "hbm288", precision } }))
  for (const ev of runs) {
    assert.equal(ev.atr.mauh, runs[0].atr.mauh)
    assert.equal(ev.cfd.allowedCoreHours, runs[0].cfd.allowedCoreHours)
  }
  const [fp32, bf16, fp8, int8] = runs
  assert.ok(fp8.ai.tokens > bf16.ai.tokens && bf16.ai.tokens > fp32.ai.tokens)
  assert.ok(int8.ai.accuracy < fp8.ai.accuracy && fp8.ai.accuracy < bf16.ai.accuracy)
})

test("HBM tiers trade cost for bandwidth; unsupported tiers fall back", () => {
  const h141 = evaluate({ rank: 5, choices: { ...AI, modelSize: "70b", precision: "fp8", hbm: "hbm141" } })
  const h288 = evaluate({ rank: 5, choices: { ...AI, modelSize: "70b", precision: "fp8", hbm: "hbm288" } })
  assert.ok(h288.ai.tokens >= h141.ai.tokens)
  const clamped = evaluate({ rank: 5, choices: { ...AI, platform: "h100", hbm: "hbm288" } })
  assert.ok(["hbm80", "hbm141"].includes(clamped.ai.memory.tier))
  assert.ok(clamped.notes.some((n) => /HBM|memory/i.test(n)))
})

test("connectivity: the FIA trackside bundle is clean; basic and wireless are not", () => {
  const ids = (trackside) => evaluate({ rank: 5, choices: { ...SMART, trackside } }).penalties.map((p) => p.id)
  for (const id of ["tunnels", "umbilical", "5g"]) assert.ok(!ids("fia").includes(id), `${id} should be clean`)
  assert.ok(ids("basic").includes("tunnels"))
  assert.ok(ids("wireless").includes("umbilical"))
  assert.ok(ids("wireless").includes("5g"))
})

test("a LEO backup is path-diverse and cuts blackout risk", () => {
  const leo = evaluate({ rank: 5, choices: { ...SMART, wan: "fabric", wanBackup: "leo" } })
  const none = evaluate({ rank: 5, choices: { ...SMART, wan: "fabric", wanBackup: "none" } })
  assert.equal(leo.network.diverse, true)
  assert.ok(leo.network.blackoutP < none.network.blackoutP)
})
