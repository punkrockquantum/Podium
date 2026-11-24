import test from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULTS, PRESETS, PRESET_ORDER, GROUPS, CONTROLS, normalize, simulate, evaluate, evaluateBothSeasons,
  presetInputs, todayInputs, fiaEnvelope, nodeKW, aeroSeconds, reinvestSeconds, envelope, ceilings, fitToEnvelope, ccfFloor, hardware,
} from "../public/js/sim/model.js"
import { K, A, assumptionRows, PROVIDER } from "../public/js/sim/assumptions.js"
import { FIGURES } from "../public/js/customer.js"

const dr = (extra = {}) => normalize({ ...DEFAULTS, ...PRESETS.dr2027.inputs, ...extra })
const walk = (node, path, visit) => {
  if (node === null || node === undefined) return visit(path, node)
  if (typeof node === "number") return visit(path, node)
  if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`, visit))
  if (typeof node === "object") return Object.entries(node).forEach(([k, x]) => walk(x, `${path}.${k}`, visit))
  return visit(path, node)
}
const assertNoNaN = (result, label) => walk(result, label, (path, value) => {
  if (typeof value === "number") assert.ok(!Number.isNaN(value), `${path} is NaN`)
  if (typeof value === "string") assert.ok(!/NaN|undefined/.test(value), `${path} contains NaN/undefined: ${value}`)
})

test("constants: every entry is tagged VERIFIED or ASSUMPTION with a source row", () => {
  const rows = assumptionRows()
  assert.ok(rows.length >= 80, `expected at least 80 annotated constants, got ${rows.length}`)
  for (const r of rows) {
    assert.ok(["VERIFIED", "ASSUMPTION"].includes(r.status), `${r.path} status ${r.status}`)
    assert.match(r.source, /^[A-K](?:\d+(?:-open)?|-[a-z])$/, `${r.path} source ${r.source}`)
  }
  assert.equal(K.fia.baseline.mauh, 6)
  assert.deepEqual(K.fia.scale, [70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 115])
  assert.equal(K.fia.gpuAllowedFrom, 2028)
  assert.equal(A.fia.baseline.status, "VERIFIED")
  assert.equal(PROVIDER.name, "Digital Realty")
  assert.match(PROVIDER.oemNote, /publicly announced 2023 CFD platform/)
  assert.match(PROVIDER.oemNote, /our proposal \(A-f\)/)
  assert.match(PROVIDER.oemNote, /A15/)
})

test("schema: every control has defaults, every default is valid, presets normalise to themselves", () => {
  for (const g of GROUPS) for (const c of g.controls) {
    assert.ok(c.id in DEFAULTS, `${c.id} has no default`)
    assert.ok(typeof c.why === "string" && c.why.length > 20, `${c.id} needs a why line`)
  }
  const n = normalize(DEFAULTS)
  assert.deepEqual(n, normalize(n))
  for (const id of PRESET_ORDER) {
    const x = presetInputs(id, 2027)
    assert.deepEqual(x, normalize(x), `${id} is stable under normalize`)
    for (const [k, v] of Object.entries(PRESETS[id].inputs)) {
      if (k === "season" || k === "rackKW") continue
      assert.equal(x[k], v, `${id}.${k} survives normalisation`)
    }
  }
})

test("normalize clamps to the FIA envelope and the catalogue", () => {
  const x = normalize({ position: 40, nodes: -5, clockGHz: 9, gpus: 3, solverGpus: 10, season: "2028", interconnect: "warp", committedKW: 5000, confidence: "abc" })
  assert.equal(x.position, 11)
  assert.equal(x.nodes, 0)
  assert.equal(x.clockGHz, CONTROLS.clockGHz.max)
  assert.equal(x.solverGpus, 3)
  assert.equal(x.season, 2028)
  assert.equal(x.interconnect, DEFAULTS.interconnect)
  assert.equal(x.committedKW, 500, "the commitment cannot exceed the 500 kW envelope")
  assert.equal(x.confidence, DEFAULTS.confidence)
  const h = normalize({ location: "hinwil", heatReuse: true, expansionRight: true, hinwilRetrofit: true })
  assert.equal(h.heatReuse, false)
  assert.equal(h.expansionRight, undefined, "the expansion-right control is gone")
  assert.equal(h.legacyExpansionRight, true, "a legacy input is remembered only to raise an info flag")
  assert.equal(h.hinwilRetrofit, true)
  assert.equal(normalize({ location: "dr", hinwilRetrofit: true }).hinwilRetrofit, false)
  const ml = normalize({ mlPartitionKW: 999, mlPlacement: "moon", cpuArch: "quantum" })
  assert.equal(ml.mlPartitionKW, CONTROLS.mlPartitionKW.max)
  assert.equal(ml.mlPlacement, DEFAULTS.mlPlacement)
  assert.equal(ml.cpuArch, "today")
  assert.ok(!("baseline" in normalize({})), "no hidden baseline flag: the estate rule follows the location")
})

test("FIA allowance follows the sliding scale and GPU legality follows the season", () => {
  assert.equal(fiaEnvelope(normalize({ position: 1 })).allowance.mauh, 4.2)
  assert.equal(fiaEnvelope(normalize({ position: 7 })).allowance.mauh, 6)
  assert.equal(fiaEnvelope(normalize({ position: 8 })).allowance.mauh, 6.3)
  assert.equal(fiaEnvelope(normalize({ position: 10 })).allowance.mauh, 6.9)
  assert.equal(fiaEnvelope(normalize({ position: 11 })).allowance.mauh, 6.9)
  assert.equal(fiaEnvelope(normalize({ position: 8 })).allowance.runs, 336)
  assert.equal(fiaEnvelope(normalize({ season: 2027 })).gpuSolverAllowed, false)
  assert.equal(fiaEnvelope(normalize({ season: 2028 })).gpuSolverAllowed, true)
})

test("AUh arithmetic matches F4.4.4: 12 nodes × 128 cores at 3.7 GHz use ≈ 6.22 MAUh per ATP", () => {
  const s = simulate(dr({ nodes: 12, coresPerNode: 128, clockGHz: 3.7, gpus: 0 }))
  const expected = (12 * 128 * 3.7 * FIGURES.fia.atpHoursAvg * FIGURES.cluster.solverShare) / 1e6
  assert.ok(Math.abs(s.comp.usedMauh - expected) < 0.01, `${s.comp.usedMauh} vs ${expected}`)
  assert.ok(s.comp.usage > 0.98 && s.comp.usage < 1, "just inside the P8 allowance")
  assert.equal(s.comp.throttle, 1)
  assert.equal(s.flags.find((f) => f.id === "mauh").level, "ok")
  assert.ok(Math.abs(nodeKW(128, 3.7) - 1.2) < 0.01)
})

test("compliance boundaries: over capacity throttles, under-use warns, usage never exceeds the allowance in work terms", () => {
  const over = simulate(dr({ nodes: 20 }))
  assert.ok(over.comp.usage > 1)
  assert.ok(over.comp.throttle < 1 && over.comp.hoursRun < over.comp.hours)
  assert.equal(over.flags.find((f) => f.id === "mauh").level, "warn")
  assert.match(over.flags.find((f) => f.id === "mauh").title, /Over capacity/)
  const under = simulate(dr({ nodes: 6 }))
  assert.ok(under.comp.usage < 0.9)
  assert.match(under.flags.find((f) => f.id === "mauh").title, /Under-using/)
  const none = simulate(dr({ nodes: 0, gpus: 0 }))
  assert.equal(none.comp.usedMauh, 0)
  assert.equal(none.flags.find((f) => f.id === "mauh").level, "bad")
  assert.equal(none.comp.effectiveMauh, 0)
  assert.equal(none.comp.turnaroundHours, Infinity)
  assert.equal(none.money.costPerEffectiveMauh, null)
})

test("GPU solver before 2028 is flagged not allowed and does not accrue AUh", () => {
  const s27 = simulate(dr({ season: 2027, gpus: 4, solverGpus: 4 }))
  assert.equal(s27.comp.gpuSolverN, 0)
  assert.equal(s27.comp.gpuMauh, 0)
  const gpuFlag = s27.flags.find((f) => f.id === "gpu")
  assert.equal(gpuFlag.level, "bad")
  assert.match(gpuFlag.title, /not allowed in 2027/)
  assert.equal(s27.status, "bad")
  const s28 = simulate(dr({ season: 2028, gpus: 4, solverGpus: 4 }))
  assert.equal(s28.comp.gpuSolverN, 4)
  assert.ok(s28.comp.gpuMauh > 0)
  assert.equal(s28.flags.find((f) => f.id === "gpu").level, "ok")
  const half = simulate(dr({ season: 2028, gpus: 4, solverGpus: 4, gpuChargePct: 50 }))
  assert.ok(Math.abs(half.comp.gpuMauh - s28.comp.gpuMauh / 2) < 0.01, "charge factor halves the GPU AUh")
  assert.equal(s28.hw.gpu.coreEquivalents, Math.round((37 * 1000) / (32 * 3.7)))
})

test("monotonicity: more or better infrastructure never produces less effective compute (Digital Realty, headroom)", () => {
  const base = dr({ nodes: 8 })
  const W = (extra) => simulate({ ...base, ...extra }).comp.effectiveMauh
  let prev = 0
  for (let n = 0; n <= 40; n += 2) {
    const w = W({ nodes: n })
    assert.ok(w >= prev - 1e-9, `nodes ${n}: ${w} < ${prev}`)
    prev = w
  }
  assert.ok(W({ interconnect: "eth100" }) <= W({ interconnect: "eth200" }))
  assert.ok(W({ interconnect: "eth200" }) <= W({ interconnect: "ibndr" }))
  assert.ok(W({ interconnect: "ibndr" }) <= W({ interconnect: "slingshot" }))
  assert.ok(W({ storage: "nas", nodes: 12 }) <= W({ storage: "pfs", nodes: 12 }))
  assert.ok(W({ storage: "pfs", nodes: 12 }) <= W({ storage: "flash", nodes: 12 }))
  assert.ok(W({ redundancy: "n" }) < W({ redundancy: "n1" }))
  assert.ok(W({ redundancy: "n1" }) < W({ redundancy: "2n" }))
  assert.ok(W({ support: "nbd" }) <= W({ support: "4h" }))
  assert.ok(W({ support: "4h" }) <= W({ support: "mission" }))
  assert.ok(W({ refreshYears: 5 }) < W({ refreshYears: 4 }))
  assert.ok(W({ refreshYears: 4 }) < W({ refreshYears: 3 }))
  assert.ok(W({ fibrePairs: 1 }) <= W({ fibrePairs: 2 }))
  assert.ok(W({ leadWeeks: 8 }) < W({ leadWeeks: 0 }))
  assert.equal(W({ leadWeeks: -8 }), W({ leadWeeks: 0 }))
  assert.ok(W({ migrationTiming: "midperiod" }) < W({ migrationTiming: "boundary" }))
  assert.ok(W({ cooling: "air", rackKW: 60 }) < W({ cooling: "reardoor", rackKW: 60 }))
  assert.ok(W({ cooling: "reardoor", rackKW: 120 }) < W({ cooling: "dlc", rackKW: 120 }))
  assert.ok(W({ memoryGB: 384 }) < W({ memoryGB: 768 }))
})

test("a worse constructors' position buys more allowance, and a lower declared clock buys more work per MAUh", () => {
  const big = dr({ nodes: 20 })
  let prev = 0
  for (let p = 1; p <= 11; p++) {
    const s = simulate({ ...big, position: p })
    assert.ok(s.comp.effectiveMauh >= prev - 1e-9, `P${p}`)
    prev = s.comp.effectiveMauh
  }
  const fast = simulate(dr({ nodes: 20, clockGHz: 3.7 }))
  const slow = simulate(dr({ nodes: 20, clockGHz: 2.5 }))
  assert.ok(slow.comp.usedMauh < fast.comp.usedMauh)
  assert.ok(slow.comp.workPerAuh > fast.comp.workPerAuh)
  assert.ok(slow.comp.effectiveMauh > fast.comp.effectiveMauh, "both throttled: the slower clock does more work per allowance")
  assert.ok(slow.hw.clusterKW < fast.hw.clusterKW)
})

test("power capacity: the Hinwil room cannot host the 2027 or 2028 estate; Digital Realty is a hard 500 kW envelope with no expansion right", () => {
  const hin27 = simulate(presetInputs("today", 2027))
  assert.ok(hin27.fac.powerShortKW > 50)
  assert.equal(hin27.flags.find((f) => f.id === "power").level, "bad")
  assert.ok(hin27.comp.eff.power < 1)
  const hin28 = simulate(presetInputs("today", 2028))
  assert.ok(hin28.fac.powerShortKW > hin27.fac.powerShortKW, "Today's estate grows to 760 kW in 2028 (J-f)")
  const retro28 = simulate(normalize({ ...PRESETS.today.inputs, season: 2028, hinwilRetrofit: true }))
  assert.ok(retro28.fac.powerShortKW > 0 && retro28.fac.powerShortKW < hin28.fac.powerShortKW)
  assert.ok(retro28.fac.pue < hin28.fac.pue)
  const dr28 = simulate(presetInputs("gl2028"))
  assert.equal(dr28.fac.powerShortKW, 0)
  assert.equal(dr28.comp.eff.power, 1)
  assert.equal(dr28.fac.drCapacity, K.facility.envelopeKW)
  assert.equal(dr28.envelope.fits, true)
  assert.match(dr28.flags.find((f) => f.id === "power").title, /^\d{3} kW of 500 kW at Digital Realty$/)
  assert.ok(dr28.fac.drIT > 380 && dr28.fac.drIT <= 450, `the re-based 2028 preset sits in the green band: ${dr28.fac.drIT}`)
  // The estate that moves is 375 kW in both seasons; Today's room runs 375 / 760
  assert.equal(simulate(presetInputs("dr2027", 2027)).fac.estateAtDr, K.facility.estateBaseKW)
  assert.equal(simulate(presetInputs("dr2027", 2028)).fac.estateAtDr, K.facility.estateBaseKW)
  assert.equal(hin28.fac.hinwilIT - hin28.hw.clusterKW, K.facility.estateDemandKW[2028])
  // Over the envelope: not possible, whatever the legacy expansion flag says
  const over = simulate(presetInputs("gl2028", 2028, { mlPartitionKW: 300, expansionRight: true }))
  assert.equal(over.status, "bad")
  assert.equal(over.envelope.fits, false)
  assert.match(over.envelope.reasons[0], /705 kW > 500 kW offer/)
  assert.equal(over.flags.find((f) => f.id === "power").level, "bad")
  assert.match(over.flags.find((f) => f.id === "power").detail, /ZUR4/)
  const legacy = over.flags.find((f) => f.id === "expansion")
  assert.equal(legacy.level, "info")
  assert.match(legacy.detail, /ZUR4|no expansion right|separate commercial/i)
  assert.ok(!over.money.oneOffs.some((o) => /expansion/i.test(o.label)), "no expansion-right one-off remains")
  // The ML partition in the cloud or in Hinwil leaves the campus envelope alone
  const cloud = simulate(presetInputs("gl2028", 2028, { mlPartitionKW: 300, mlPlacement: "cloud" }))
  assert.equal(cloud.envelope.fits, true)
  assert.equal(cloud.fac.mlAtDr, 0)
  assert.equal(cloud.fac.mlInCloud, 300)
})

test("envelope: the fit test, closed-form ceilings and the fit-to-envelope order (ML → GPUs → nodes → rack density)", () => {
  const x = presetInputs("gl2028")
  const env = envelope(x)
  assert.equal(env.offerKW, 500)
  assert.equal(env.fits, true)
  assert.deepEqual(env.reasons, [])
  assert.ok(env.headroomKW > 0 && Math.abs(env.drIT + env.headroomKW - 500) < 1e-6)
  assert.ok(env.racks.total <= env.cageRackPositions)
  const c = ceilings(x)
  assert.equal(c.committedKW.max, 500)
  assert.equal(c.rackKW.max, K.compute.coolingMaxKWPerRack.dlc)
  assert.equal(c.solverGpus.max, x.gpus)
  assert.equal(c.clockGHz.min, ccfFloor(x))
  assert.ok(c.nodes.max >= x.nodes && c.gpus.max >= x.gpus && c.mlPartitionKW.max >= 0)
  assert.equal(c.fits, true)
  // Every ceiling is tight: one step beyond it no longer fits (an ML partition at the campus squeezes the cluster)
  const squeezed = normalize({ ...x, mlPartitionKW: c.mlPartitionKW.max })
  const cs = ceilings(squeezed)
  assert.ok(cs.nodes.max < CONTROLS.nodes.max && cs.nodes.max >= x.nodes, `nodes ceiling ${cs.nodes.max}`)
  assert.equal(envelope(normalize({ ...squeezed, nodes: cs.nodes.max + 1 })).fits, false)
  assert.equal(envelope(normalize({ ...squeezed, nodes: cs.nodes.max })).fits, true)
  assert.equal(envelope(normalize({ ...squeezed, gpus: cs.gpus.max + 1 })).fits, false)
  assert.equal(envelope(normalize({ ...x, mlPartitionKW: c.mlPartitionKW.max + 25 })).fits, false)
  assert.equal(envelope(squeezed).fits, true)
  // Rack density above the cooling ceiling, too many racks, and a clock under the base clock all fail the fit test
  assert.match(envelope(normalize({ ...x, cooling: "air", rackKW: 60 })).reasons[0], /air ceiling|20 kW/)
  assert.match(envelope(normalize({ ...x, clockGHz: 2.0 })).reasons.join(" "), /base clock/)
  const crowded = envelope(normalize({ ...x, cooling: "air", rackKW: 10, nodes: 20, gpus: 0, mlPartitionKW: 100 }))
  assert.ok(crowded.racks.total > K.facility.cageRackPositions, `${crowded.racks.total} racks`)
  assert.match(crowded.reasons.join(" "), /cage positions/)
  assert.equal(K.facility.estateRackKW, 8, "the estate is counted at 8 kW per rack position")
  // In 2027 no GPU may be in the solver
  assert.equal(ceilings(normalize({ ...x, season: 2027 })).solverGpus.max, 0)
  // fitToEnvelope clamps in order and stops as soon as the estate fits
  const fit = fitToEnvelope(normalize({ ...x, mlPartitionKW: 300 }))
  assert.equal(fit.fits, true)
  assert.deepEqual(fit.changes.map((ch) => ch.id), ["mlPartitionKW"])
  assert.equal(fit.inputs.mlPartitionKW, c.mlPartitionKW.max)
  const big = fitToEnvelope(normalize({ ...x, mlPartitionKW: 400, gpus: 32, solverGpus: 8, nodes: 40, rackKW: 150 }))
  assert.equal(big.fits, true)
  const order = ["mlPartitionKW", "gpus", "nodes", "rackKW"]
  const seen = big.changes.map((ch) => ch.id)
  assert.deepEqual(seen, order.filter((id) => seen.includes(id)), `clamped in the brief's order: ${seen}`)
  assert.equal(fitToEnvelope(x).changes.length, 0, "a plan that fits is left alone")
  // Hinwil has its own ceiling: the room, not the offer
  const hin = envelope(presetInputs("today", 2028))
  assert.equal(hin.drIT, 0)
  assert.ok(hin.hinwilIT > hin.hinwilCapacity)
})

test("cpuArch: a separate multiplier from the refresh cadence, with its own kW, price, base-clock floor and flags", () => {
  const base = presetInputs("gl2028")
  const std = evaluate(base)
  const big = evaluate({ ...base, cpuArch: "bigcache" })
  const xeon = evaluate({ ...base, cpuArch: "xeon" })
  const arm = evaluate({ ...base, cpuArch: "arm" })
  assert.equal(std.scenario.hw.arch.id, "today")
  assert.equal(std.scenario.comp.eff.arch, 1)
  assert.ok(big.scenario.comp.eff.arch > 1.2 && big.scenario.comp.eff.arch <= 1.35, `big cache ${big.scenario.comp.eff.arch}`)
  assert.ok(big.perf.sec > std.perf.sec, "more work per metered AUh finds lap time")
  assert.ok(big.scenario.hw.clusterKW >= std.scenario.hw.clusterKW, "big-cache parts draw at least as much")
  assert.ok(xeon.scenario.comp.eff.arch > 1 && xeon.scenario.comp.eff.arch < big.scenario.comp.eff.arch)
  assert.ok(arm.scenario.flags.some((f) => f.id === "armport" && f.level === "warn"), "Arm needs the solver re-validated")
  assert.ok(arm.scenario.comp.effectiveLeadWeeks > std.scenario.comp.effectiveLeadWeeks)
  assert.ok(big.scenario.flags.some((f) => f.id === "arch" && f.level === "info"), "a 2028 part that launches in 2027 is flagged")
  assert.ok(!std.scenario.flags.some((f) => f.id === "arch"), "today's parts need no launch flag")
  // The refresh cadence and the architecture multiply; neither replaces the other
  const old = evaluate({ ...base, refreshYears: 5 })
  const oldBig = evaluate({ ...base, refreshYears: 5, cpuArch: "bigcache" })
  assert.ok(Math.abs(oldBig.scenario.comp.eff.arch - big.scenario.comp.eff.arch) < 1e-9)
  assert.ok(oldBig.scenario.comp.eff.ipc < big.scenario.comp.eff.ipc)
  assert.ok(old.perf.sec < std.perf.sec)
  // Base-clock floors come from the part; the 2028 Arm part has the highest
  for (const cores of [64, 96, 128, 192]) assert.ok(ccfFloor(normalize({ ...base, coresPerNode: cores })) >= K.compute.ccfFloorGHz[cores])
  assert.deepEqual(K.compute.ccfFloorGHz, { 64: 2.4, 96: 2.3, 128: 2.4, 192: 2.25 })
  assert.ok(ccfFloor(normalize({ ...base, cpuArch: "arm" })) >= ccfFloor(base))
  assert.equal(hardware(normalize({ ...base, clockGHz: 2.0 })).ccfFloorGHz, ccfFloor(base))
  // The Today preset is pinned to today's processors in both seasons
  assert.equal(todayInputs(2027).cpuArch, "today")
  assert.equal(todayInputs(2028).cpuArch, "today")
})

test("GPU table: FP64 core-equivalents per part, and parts that exceed the allowance at a 100 % charge are flagged, never silently allowed", () => {
  const parts = CONTROLS.gpuModel.options.map((o) => o.value)
  for (const id of ["gb200", "mi300x", "mi325x", "mi430x", "h200", "mi355x"]) assert.ok(parts.includes(id), `${id} in the GPU table`)
  assert.ok(!parts.includes("b300"), "B300-class parts (1.2 TFLOPS FP64) are never offered for the solver")
  assert.match(CONTROLS.gpuModel.why, /B300/)
  const at = (gpuModel, extra = {}) => simulate(presetInputs("gl2028", 2028, { gpuModel, gpus: 8, solverGpus: 8, gpuChargePct: 100, ...extra }))
  const exceeding = parts.filter((id) => at(id).hw.gpu.exceedsAllowanceAt100)
  assert.deepEqual(exceeding, ["mi430x"], "only the MI430X-class part (288 TFLOPS FP64 ≈ 9.9 MAUh a period) exceeds the whole P8 allowance")
  const flagged = at("mi430x")
  assert.ok(flagged.flags.some((f) => f.id === "gpu" && f.level === "warn"), "the GPU flag warns at a 100 % charge")
  assert.ok(flagged.hw.gpu.mauhPerAtpAt100 > flagged.fia.allowance.mauh)
  assert.ok(!at("mi430x", { gpuChargePct: 50 }).flags.some((f) => f.id === "gpu" && f.level === "warn"), "a kinder charge clears the warning")
  assert.match(CONTROLS.gpuModel.options.find((o) => o.value === "mi430x").label, /exceeds the allowance/)
  assert.ok(Math.abs(at("gb200").hw.gpu.coreEquivalents - 338) <= 1 && Math.abs(at("mi300x").hw.gpu.coreEquivalents - 690) <= 1, "core-equivalents as in the brief")
  assert.equal(normalize({ gpuModel: "b300" }).gpuModel, DEFAULTS.gpuModel, "a B300 input falls back to the catalogue")
  for (const id of parts) assert.ok(at(id).hw.gpu.coreEquivalents > 0 && Number.isFinite(at(id).hw.gpu.mauhPerAtpAt100))
})

test("PUE: derived from site and cooling, override wins, and it drives electricity and CO2", () => {
  const air = simulate(dr({ cooling: "air", rackKW: 15 }))
  const rear = simulate(dr({ cooling: "reardoor" }))
  const dlc = simulate(dr({ cooling: "dlc" }))
  assert.ok(air.fac.pue > rear.fac.pue && rear.fac.pue > dlc.fac.pue)
  assert.equal(simulate(dr({ pueMode: "override", pueValue: 1.5 })).fac.pue, 1.5)
  const power = (s) => s.money.lines.find((l) => l.id === "power").chf
  assert.ok(power(air) > power(dlc))
  assert.ok(air.money.co2LocationT > dlc.money.co2LocationT)
  assert.equal(dlc.money.co2MarketT, 0, "Digital Realty runs on renewable energy")
  const hin = simulate(presetInputs("today"))
  assert.ok(hin.money.co2MarketT > 0)
  assert.equal(simulate(normalize({ ...PRESETS.today.inputs, renewable: true })).money.co2MarketT, 0)
})

test("money: GreenLake meters usage, buying depreciates, Property share moves the cap charge, one-offs are listed", () => {
  const buy = simulate(dr({ consumption: "buy", refreshYears: 4 }))
  const it = (s) => s.money.lines.find((l) => l.id === "it")
  assert.equal(it(buy).chf, Math.round(buy.hw.hardwareCHF / 4))
  const gl = simulate(dr({ consumption: "greenlake", termYears: 5, committedPct: 100 }))
  assert.ok(Math.abs(it(gl).chf - (gl.hw.hardwareCHF / 5) * K.prices.greenlakeUplift) < 2)
  const glThrottled = simulate(dr({ consumption: "greenlake", termYears: 5, committedPct: 60, nodes: 24 }))
  assert.ok(glThrottled.money.utilisation < 1 && glThrottled.money.utilisation >= 0.6, "metered usage follows the FIA throttle, floored by the reserve")
  const gl3 = simulate(dr({ consumption: "greenlake", termYears: 3, committedPct: 100 }))
  assert.ok(it(gl3).chf > it(gl).chf, "a shorter term costs more per year")
  const p0 = simulate(dr({ propertySharePct: 0 }))
  const p100 = simulate(dr({ propertySharePct: 100 }))
  assert.ok(p0.money.capCharge > p100.money.capCharge)
  assert.equal(p0.money.yearly, p100.money.yearly)
  assert.ok(buy.money.oneOffs.some((o) => o.id === "fitout" && o.cap === "excluded"))
  assert.ok(buy.money.oneOffs.some((o) => o.id === "migration" && o.cap === "included"))
  assert.ok(buy.money.tco3 > buy.money.yearly * 2)
  assert.ok(buy.money.capShare > 0 && buy.money.capShare < 0.05)
  const hin = simulate(presetInputs("today"))
  assert.ok(hin.money.oneOffs.some((o) => o.id === "patch"))
  assert.equal(hin.money.lines.find((l) => l.id === "fee"), undefined)
})

test("trackside: venues, headroom, availability and data-to-decision respond to the link and the edge node", () => {
  const base = simulate(dr({ trackside: "carrier", edge: false, venue: "singapore" }))
  assert.equal(base.net.venues.length, K.trackside.venues.length)
  assert.ok(base.net.headroom < 1, "one 100 Mbps circuit is below the telemetry peak")
  const dual = simulate(dr({ trackside: "dual", edge: false, venue: "singapore" }))
  assert.ok(dual.net.headroom > 1 && dual.net.linkAvailability > base.net.linkAvailability)
  const edge = simulate(dr({ trackside: "dual", edge: true, venue: "singapore" }))
  assert.ok(Math.abs(dual.net.venue.decisionSec - edge.net.venue.decisionSec - K.trackside.edgeSavingSec) < 1e-6)
  const monza = simulate(dr({ venue: "monza" }))
  const melbourne = simulate(dr({ venue: "melbourne" }))
  assert.ok(monza.net.venue.rttMs < melbourne.net.venue.rttMs)
  assert.ok(monza.net.venue.decisionSec < melbourne.net.venue.decisionSec)
  const internet = simulate(dr({ trackside: "internet" }))
  assert.ok(internet.net.venue.rttMs > dual.net.venue.rttMs, "the public internet carries a jitter allowance")
  assert.ok(edge.net.quality > base.net.quality)
})

test("presets: the headline ordering holds (Today < Digital Realty 2027 < Digital Realty + GreenLake 2028), all inside the envelope, no points anywhere", () => {
  const today27 = evaluate(presetInputs("today", 2027))
  assert.equal(today27.perf.sec, 0)
  assert.equal(today27.perf.decisionDeltaSec, 0)
  assert.equal(today27.perf.weekendsAtRiskDelta, 0)
  const dr27 = evaluate(presetInputs("dr2027"))
  assert.ok(dr27.perf.aeroSec > 0.2, `aero ${dr27.perf.aeroSec}`)
  assert.ok(dr27.perf.sec > 0.05 && dr27.perf.sec < 0.4, `headline ${dr27.perf.sec}`)
  assert.ok(dr27.scenario.comp.effectiveMauh > today27.scenario.comp.effectiveMauh)
  assert.ok(dr27.scenario.status !== "bad")
  assert.ok(dr27.perf.decisionDeltaSec > 1, "the pit wall decides faster from the campus")
  assert.ok(dr27.perf.weekendsAtRiskDelta > 0, "fewer race weekends at risk")
  assert.ok(dr27.perf.linkAvailability > dr27.perf.linkAvailabilityToday)
  const gl28 = evaluate(presetInputs("gl2028"))
  assert.equal(gl28.scenario.inputs.season, 2028)
  assert.ok(gl28.perf.sec > dr27.perf.sec, "the 2028 path beats the 2027 plan against a Hinwil room that cannot power 2028")
  assert.ok(gl28.perf.sec > 0.40 && gl28.perf.sec < 0.46, `≈ +0.43 s steady-state at 405 kW: ${gl28.perf.sec}`)
  assert.ok(gl28.scenario.comp.gpuSolverN === 2)
  assert.ok(gl28.scenario.comp.effectiveRatio > 1, "GPUs, a lower clock and new silicon do more than one MAUh of work per MAUh")
  assert.equal(gl28.scenario.status, "ok")
  assert.equal(gl28.scenario.inputs.mlPartitionKW, 0)
  assert.equal(gl28.scenario.inputs.cpuArch, "today")
  for (const id of PRESET_ORDER) for (const season of [2027, 2028]) {
    const r = evaluate(presetInputs(id, season))
    if (id !== "today") assert.equal(r.envelope.fits, true, `${id} ${season} fits the 500 kW envelope`)
    for (const key of Object.keys(r.perf)) assert.ok(!/point|position|ladder/i.test(key), `no points outcome in perf: ${key}`)
    assert.ok(!Object.keys(r.scenario.comp).some((k) => /point/i.test(k)))
    assert.ok(!r.scenario.flags.some((f) => /\bpoints?\b|position swing/i.test(f.title + f.detail)), "no flag talks about points")
  }
  const full = evaluate(presetInputs("gl2028", 2028, { confidence: 100 }))
  assert.ok(Math.abs(full.perf.sec - gl28.perf.rawSec) < 1e-6, "confidence scales the headline")
  const zero = evaluate(presetInputs("gl2028", 2028, { confidence: 0 }))
  assert.equal(zero.perf.sec, 0)
})

test("performance curve: diminishing returns, calibrated marginal value, reinvestment ceiling", () => {
  assert.ok(aeroSeconds(0) === 0)
  const m = (aeroSeconds(6.3 + 0.75) - aeroSeconds(6.3)) / 1
  assert.ok(m > 0.07 && m < 0.11, `marginal value of 12.5 ATR points ≈ ${m}`)
  assert.ok(aeroSeconds(12) - aeroSeconds(6) < aeroSeconds(6) - aeroSeconds(0))
  assert.ok(Math.abs(reinvestSeconds(1e6) - 0.085) < 0.005)
  assert.ok(reinvestSeconds(1e9) <= K.performance.reinvestMaxSec)
  assert.equal(reinvestSeconds(-1e6), -reinvestSeconds(1e6))
  assert.equal(reinvestSeconds(0), 0)
})

test("both seasons evaluate for the same inputs and the 2028 'Today' is worse than the 2027 one", () => {
  const both = evaluateBothSeasons(presetInputs("dr2027"))
  assert.equal(both[2027].scenario.inputs.season, 2027)
  assert.equal(both[2028].scenario.inputs.season, 2028)
  assert.ok(both[2028].today.comp.effectiveMauh < both[2027].today.comp.effectiveMauh)
  assert.deepEqual(todayInputs(2028).location, "hinwil")
})

test("no NaN, undefined or Infinity leaks at the extremes of every control", () => {
  const extremes = [
    {}, DEFAULTS,
    { nodes: 0, gpus: 0 },
    { nodes: 40, gpus: 32, solverGpus: 32, season: 2028, clockGHz: 4.0, rackKW: 150, cooling: "air", location: "hinwil", redundancy: "n", support: "nbd", refreshYears: 5, leadWeeks: 12 },
    { nodes: 40, gpus: 32, solverGpus: 32, season: 2028, clockGHz: 2.0, rackKW: 10, cooling: "dlc", location: "dr", committedKW: 250, expansionRight: false, consumption: "greenlake", committedPct: 60, termYears: 3 },
    { location: "hybrid", position: 1, confidence: 0, pueMode: "override", pueValue: 1.8, tariffRp: 25, trackside: "internet", fibrePairs: 1, fibreGbps: 10 },
    { location: "hybrid", position: 11, confidence: 100, pueMode: "override", pueValue: 1.1, tariffRp: 8, trackside: "dualsat", edge: true, cloudOnRamp: true, heatReuse: true, migrationTiming: "midperiod" },
    { season: 2027, gpus: 32, solverGpus: 32, gpuModel: "mi355x", gpuChargePct: 25, memoryGB: 1536, storage: "flash", interconnect: "slingshot", coresPerNode: 192 },
    { season: 2028, gpus: 1, solverGpus: 1, gpuModel: "h200", coresPerNode: 64, memoryGB: 384, storage: "nas", interconnect: "eth100", fitOutCHF: 0, migrationCHF: 0, propertySharePct: 0 },
  ]
  for (const e of extremes) {
    const r = evaluate(e)
    assertNoNaN({ perf: r.perf, scenario: { ...r.scenario, comp: { ...r.scenario.comp, solverHours: 0, turnaroundHours: 0 } } }, JSON.stringify(e).slice(0, 60))
    assert.ok(Number.isFinite(r.perf.sec))
    assert.ok(Number.isFinite(r.scenario.money.yearly) && r.scenario.money.yearly >= 0)
    assert.ok(Number.isFinite(r.scenario.comp.effectiveMauh) && r.scenario.comp.effectiveMauh >= 0)
    assert.ok(r.scenario.flags.every((f) => f.title && !/NaN|undefined/.test(f.title + f.detail)))
    for (const line of r.scenario.money.lines) assert.ok(Number.isFinite(line.chf) && !/undefined|NaN/.test(line.label))
  }
})
