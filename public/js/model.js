/**
 * Podium evaluation: one team's choices → ledger, power, cooling, aero work under the ATR,
 * strategy quality, risks and penalties, plus traffic-light checks for each station's leader.
 * Pure and deterministic; the race (race.js) samples the risks with a seed.
 */
import * as C from "./catalog.js"

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
const sum = (items) => items.reduce((total, item) => total + item.amount, 0)

/** Merge a team's picks over the defaults, dropping anything the catalog does not offer. */
export function resolveChoices(choices = {}) {
  const out = { ...C.DEFAULT_CHOICES }
  for (const [key, value] of Object.entries(choices || {})) {
    if (!C.validChoice(key, value)) continue
    out[key] = C.decision(key).values ? Number(value) : value
  }
  for (const d of C.DECISIONS) {
    if (d.hidden || !d.options) continue
    const picked = d.options.find((option) => option.id === out[d.id])
    if (picked?.sets) Object.assign(out, picked.sets)
  }
  return out
}

/** The option a team picked for a decision, as the table offers it (plain name, reason, tag). */
export function pickedOption(decisionId, choices) {
  const d = C.decision(decisionId)
  return d?.options?.find((option) => option.id === choices[decisionId]) || null
}

/** Peak GFLOPS the FIA bills per core, and the GFLOPS a memory-bound CFD solver actually gets. */
export function cpuRates(cpu, clock) {
  const billedGHz = clock.lock === null ? cpu.boostGHz : cpu.baseGHz * clock.lock
  const runningGHz = clock.lock === null ? Math.min(cpu.boostGHz, cpu.baseGHz * 1.25) : cpu.baseGHz * clock.lock
  const billedGF = billedGHz * cpu.fp64PerClk
  const bwPerCore = cpu.memBW / cpu.coresPerSocket
  const usefulGF = Math.min(runningGHz * cpu.fp64PerClk * C.COMPUTE_EFFICIENCY, bwPerCore * C.CFD_FLOP_PER_BYTE * cpu.cacheFactor)
  return { billedGHz, billedGF, usefulGF, bwPerCore, efficiency: usefulGF / billedGF }
}

/** Useful TFLOP-hours per ATP of the P7 baseline: EPYC 9575F locked at base, CPU-only, 6.00 MAUh. */
export const REF_AERO_WORK = (() => {
  const rates = cpuRates(C.byId(C.CPUS, "epyc9575f"), C.byId(C.CLOCKS, "base"))
  return ((6.0 * C.MAUH_DIVISOR) / rates.billedGF) * rates.usefulGF / 1000
})()

export function aeroGainFor(index) {
  return 0.9 * (1 - Math.exp(-0.7 * Math.max(0, index)))
}

/** Table points (0–28: system score plus the leader's verdict) → execution 0.94–1.04; none counts as average. */
export function execution(pitch, stationId) {
  const score = pitch?.[stationId]
  if (!Number.isFinite(score)) return 0.97
  return 0.94 + 0.1 * clamp(score / C.PITCH_MAX, 0, 1)
}

function check(list, station, state, text) {
  list.push({ station, state, text })
}

/**
 * Evaluate one team.
 * team: { rank, choices, pitch: { stationId: 0..25 } }
 * opts: { races, sprints }
 */
export function evaluate(team = {}, opts = {}) {
  const rank = clamp(Math.round(Number(team.rank) || 7), 1, 10)
  const ch = resolveChoices(team.choices)
  const pitch = team.pitch || {}
  const checks = []
  const notes = []
  const capex = []
  const opex = []
  const risks = []
  const penalties = []

  const tier = C.tierForRank(rank)
  const atr = C.atrForRank(rank)
  const capexRemaining = tier.envelope - tier.committed
  const cap = C.costCap(opts.races ?? 24, opts.sprints ?? 6)

  const opt = (id) => pickedOption(id, ch)
  const oem = opt("oem")
  const cpu = opt("cpu")
  const clock = opt("clock")
  let solver = opt("solver")
  const geometry = opt("geometry")
  const platform = opt("platform")
  const tgp = opt("tgp")
  const loc = opt("location")
  const hall = opt("hall")
  const pfs = opt("pfs")
  const archive = opt("archive")
  const dataTier = opt("dataTier")
  const hosts = opt("hosts")
  const fabric = opt("fabric")
  const telemetry = opt("telemetry")
  const venue = opt("venue")
  const segregation = opt("segregation")
  const dataflow = opt("dataflow")
  const workforce = opt("workforce")
  const curfew = opt("curfew")
  const logs = opt("logs")
  const coloTerms = opt("terms")
  const powerRedundancy = opt("redundancy")
  const architectGain = team.architect?.enabled ? clamp(Number(team.architect.gain) || 1, 0.5, 3) : 1
  const kvOn = ch.kv === "on"
  const orcaOn = ch.orca === "on"
  const heatOn = ch.heat === "on"

  /* ---------------------------------------------------------- commercial model and AI sourcing */
  let payId = ch.payment
  if (payId === "aas" && !oem.aas) {
    payId = "lease"
    notes.push(`${oem.name} has no as-a-service programme, so the hardware is on an operating lease instead.`)
  }
  let deployId = ch.deploy
  if (platform.buyOnly && deployId !== "own") {
    deployId = "own"
    notes.push(`${platform.name} is your own silicon: no cloud rents it, so you own the racks.`)
  }
  if (deployId === "burst" && !platform.burstRate) deployId = platform.cloudRate ? "cloud" : "own"
  if (deployId === "cloud" && !platform.cloudRate) {
    deployId = "own"
    notes.push(`${platform.name} is not rented in the cloud, so you own the racks.`)
  }
  const deploy = C.byId(C.SOURCING, deployId)
  const inCloud = deployId !== "own"
  const aiPayId = platform.buyOnly && !["buy", "finance"].includes(payId) ? "buy" : payId
  if (aiPayId !== payId && ch.racks > 0) notes.push(`${platform.name} cannot be leased or rented as a service: it is bought.`)
  const aiRacks = ch.racks
  const gpus = aiRacks * platform.gpusPerRack
  const aiInHall = !inCloud && aiRacks > 0

  /* ---------------------------------------------------------- model, precision, HBM */
  const model = C.byId(C.MODEL_SIZES, ch.modelSize)
  let precision = C.byId(C.PRECISIONS, ch.precision)
  if (!platform.precisions.includes(precision.id)) {
    const fallback = platform.precisions.includes("bf16") ? "bf16" : platform.precisions[platform.precisions.length - 1]
    notes.push(`${platform.name} does not run ${precision.name}; the models are converted to ${C.byId(C.PRECISIONS, fallback).name}.`)
    precision = C.byId(C.PRECISIONS, fallback)
  }
  const precSpeed = platform.id === "asic" ? { fp8: 0.95, int8: 1 }[precision.id] : precision.speed
  const wantedTier = C.byId(C.HBM_TIERS, ch.hbm)
  let hbmTier = null
  let hbmGB = platform.hbmGB
  let bwFactor = 1
  let hbmSteps = 0
  let hbmPerGpu = 0
  if (platform.hbmTiers.length) {
    const offered = platform.hbmTiers.map((id) => C.byId(C.HBM_TIERS, id))
    hbmTier = offered.includes(wantedTier) ? wantedTier : offered.reduce((a, b) => (Math.abs(b.step - wantedTier.step) < Math.abs(a.step - wantedTier.step) ? b : a))
    if (hbmTier !== wantedTier) notes.push(`${platform.name} is not sold with ${wantedTier.name}; it ships with ${hbmTier.name}.`)
    const baseTier = offered[0]
    hbmGB = hbmTier.gb
    bwFactor = (hbmTier.tbs / baseTier.tbs) ** 0.8
    hbmSteps = hbmTier.step - baseTier.step
    hbmPerGpu = hbmTier.perGpu - baseTier.perGpu
  } else if (wantedTier.step > 0) {
    notes.push(`${platform.name} has fixed ${platform.memKind} (${platform.hbmGB} GB); the HBM choice does not apply.`)
  }
  const hbmTBs = platform.hbmTBs * (hbmTier ? hbmTier.tbs / C.byId(C.HBM_TIERS, platform.hbmTiers[0]).tbs : 1)
  const weightsGB = model.params * precision.bytes
  const kvGB = (model.kvGB * precision.kvBytes) / 2
  const usableGB = hbmGB * 0.9
  const domain = platform.nvlink > 1 ? platform.nvlink : 8
  const shardCost = platform.nvlink > 1 ? 0.04 : 0.15
  const hasGraceMemory = hosts.id === "grace" || ["gb200", "gb300", "vr"].includes(platform.id)
  let shard = Math.ceil((weightsGB + kvGB) / usableGB)
  let memState = "fits"
  let memEff = 1
  if (shard > 1 && shard <= Math.min(domain, Math.max(1, gpus))) {
    memState = "sharded"
    memEff = 1 - shardCost * Math.log2(shard)
  } else if (shard > 1) {
    const weightShard = Math.ceil(weightsGB / usableGB)
    if ((kvOn || hasGraceMemory) && weightShard <= Math.min(domain, Math.max(1, gpus))) {
      memState = "spill"
      shard = weightShard
      memEff = (1 - shardCost * Math.log2(Math.max(1, weightShard))) * 0.8
    } else {
      memState = "offload"
      memEff = 0.2
    }
  }
  const accuracy = model.acc * precision.acc
  const memLatency = { fits: 1, sharded: 1.1, spill: 1.5, offload: 4 }[memState]
  const inferS = (model.inferMs / 1000 / Math.sqrt(precSpeed * bwFactor * architectGain)) * memLatency
  const aiMult = model.tok * precSpeed * bwFactor * memEff

  /* ---------------------------------------------------------- hall, rack density, thermal */
  const liquidHall = hall.cooling === "liquid"
  const immersion = hall.cooling === "immersion"
  const capKW = hall.maxRackKW * 1.05
  const oemPower = liquidHall || immersion ? oem.liquidPowerMult : oem.airPowerMult

  const cpuNodeKW = cpu.nodeKW * clock.powerMult * oemPower
  const cpuPerRack = Math.max(1, Math.min(20, Math.floor(capKW / cpuNodeKW)))
  const cpuRacks = Math.ceil(ch.nodes / cpuPerRack)

  const aiRackKW = platform.rackKW * tgp.power * (platform.custom ? 1 : oemPower) * (1 + 0.03 * hbmSteps)
  let aiPositions = 0
  let thermal = 1
  let thermalWhy = ""
  if (aiInHall) {
    if (platform.cooling === "liquid" && !liquidHall) {
      thermal = 0.15
      aiPositions = aiRacks
      thermalWhy = immersion
        ? `${platform.name} racks are not built for immersion tanks: they run crippled at 15%.`
        : `${platform.name} needs direct-to-chip liquid; in the ${hall.name.toLowerCase()} it overheats and crawls at 15%.`
    } else if (aiRackKW <= capKW) {
      aiPositions = aiRacks
    } else if (platform.gpusPerRack >= 16 && aiRackKW / 2 <= capKW) {
      aiPositions = aiRacks * 2
      notes.push(`${platform.name}: one node per rack position to stay under ${hall.maxRackKW} kW, so ${aiPositions} positions.`)
    } else {
      thermal = 0.35
      aiPositions = aiRacks
      thermalWhy = `${platform.name} at ${Math.round(aiRackKW)} kW a rack is hotter than the ${hall.maxRackKW} kW this hall cools: throttled to 35%.`
    }
  }
  const boostUncooled = tgp.needsLiquid && aiInHall && !liquidHall && !immersion
  if (boostUncooled) {
    thermal *= 0.9
    thermalWhy = thermalWhy || "Max boost on air: hot spots throttle the GPUs."
  }

  const storageRacks = (pfs.staas ? 0 : Math.ceil(ch.pfsPB / 2)) + (dataTier.id !== "local" ? 1 : 0) + (kvOn ? 1 : 0)
  const orcaRacks = orcaOn ? C.ORCA.space : 0
  const positions = cpuRacks + aiPositions + storageRacks + orcaRacks + 1
  const spaceOver = positions > hall.rackSpace
  const spaceThrottle = spaceOver ? 0.85 : 1

  /* ---------------------------------------------------------- IT power, PUE, contract */
  const computeRacks = cpuRacks + (aiInHall ? aiPositions : 0)
  const itParts = {
    cpu: ch.nodes * cpuNodeKW,
    ai: aiInHall ? aiRacks * aiRackKW : 0,
    fabric: computeRacks * fabric.kwPerRack,
    storage: ch.pfsPB * pfs.kwPerPB + dataTier.kw + (kvOn ? C.KV_TIER.kw : 0) + hosts.kw,
    orca: orcaOn ? C.ORCA.kw : 0,
    network: 2,
  }
  const itKW = Object.values(itParts).reduce((a, b) => a + b, 0)
  const pue = Math.round((hall.pue + (loc.onprem ? loc.puePenalty : 0)) * 100) / 100
  const facilityKW = itKW * pue
  const ladder = loc.blocksMW
  const blockMW = ladder.includes(ch.block) ? ch.block : ladder.find((mw) => mw >= ch.block) ?? ladder[ladder.length - 1]
  if (blockMW !== ch.block) notes.push(`${loc.name} does not sell a ${ch.block} MW block; you hold ${blockMW} MW.`)
  const blockKW = blockMW * 1000
  const headroom = 1 - facilityKW / blockKW
  const powerThrottle = headroom < 0 ? blockKW / facilityKW : 1
  const powerState = headroom < 0 ? "red" : headroom < C.POWER_HEADROOM.tripBelow ? "amber" : headroom > C.POWER_HEADROOM.wasteAbove ? "amber" : "green"

  /* ---------------------------------------------------------- lead times */
  const hasRackScale = aiInHall && platform.gpusPerRack === 72
  let hallWeeks = hall.fitOutWeeks
  if (liquidHall || immersion) {
    hallWeeks = loc.onprem ? Math.max(hall.fitOutWeeks, loc.liquidWeeks) : hall.fitOutWeeks + loc.liquidWeeks + (hasRackScale ? oem.liquidFitDelta : 0)
  }
  hallWeeks = Math.max(0, hallWeeks)
  const fabricWeeks = fabric.leadWeeks
  const cpuWeeks = Math.max(2, 6 + oem.leadDelta)
  const cfdLead = Math.max(cpuWeeks, hallWeeks, fabricWeeks, 6)
  let platformWeeks
  if (inCloud) platformWeeks = deployId === "burst" ? 1 : ["gb300", "vr"].includes(platform.id) ? 12 : 2
  else platformWeeks = Math.max(1, platform.leadWeeks + (platform.custom ? 0 : oem.leadDelta))
  const aiLead = aiRacks > 0
    ? Math.max(platformWeeks, aiInHall ? hallWeeks : 0, aiInHall ? fabricWeeks : 0, kvOn ? C.KV_TIER.leadWeeks : 0, dataTier.leadWeeks)
    : 0
  const wanNet = C.byId(C.NETWORKS, ch.wan)
  const hqNet = C.byId(C.NETWORKS, ch.hqLink)
  const netLead = Math.max(wanNet.leadDays, loc.onprem ? 0 : hqNet.leadDays) / 7
  const cfdLive = clamp((C.SEASON.finaleWeek - cfdLead) / C.SEASON.finaleWeek, 0, 1)
  const raceSpan = C.SEASON.finaleWeek - C.SEASON.firstRaceWeek
  const aiLive = aiRacks > 0 ? clamp((C.SEASON.finaleWeek - Math.max(aiLead, netLead, C.SEASON.firstRaceWeek)) / raceSpan, 0, 1) : 0
  const maturity = (0.7 + 0.3 * aiLive) * (deployId === "burst" ? 0.92 : 1)

  /* ---------------------------------------------------------- CFD under the ATR */
  const mauh = atr.mauh
  const atrCuts = []
  if (segregation.illegal) atrCuts.push("Article F6 breach")
  const rates = cpuRates(cpu, clock)
  const cores = ch.nodes * cpu.coresPerSocket * cpu.sockets
  const gpuFp64 = platform.fp64TF
  const nvidiaGpus = aiRacks > 0 && Number.isFinite(gpuFp64)
  if (solver.id !== "cpu" && !nvidiaGpus) {
    notes.push(`${solver.name} needs NVIDIA GPUs at the AI table; the CPU cluster runs everything.`)
    check(checks, "compute", "amber", `${solver.name} picked, but there are no NVIDIA GPUs with an FP64 rating to run it on.`)
    solver = C.byId(C.SOLVERS, "cpu")
  }
  const gpuThermal = aiInHall ? thermal * powerThrottle * spaceThrottle : 1
  const gpuHoursPerAtp = gpus * C.SEASON.atpHours * C.SEASON.availability * gpuThermal

  const cfdForMauh = (atpMauh) => {
    const cpuShare = solver.id === "surrogate" ? 1 - solver.share : solver.id === "gpu" ? 0.5 : 1
    const allowedCoreHours = (cpuShare * atpMauh * C.MAUH_DIVISOR) / rates.billedGF
    const capacity = cores * C.SEASON.atpHours * C.SEASON.availability * powerThrottle * spaceThrottle
    const usedCoreHours = Math.min(allowedCoreHours, capacity)
    const weeksToBurn = allowedCoreHours / Math.max(1, cores * 168 * C.SEASON.availability)
    const atpWeeks = C.SEASON.atpHours / 168
    const turnaround = weeksToBurn <= 1.5 ? 1 : 1 - 0.2 * clamp((weeksToBurn - 1.5) / (atpWeeks - 1.5), 0, 1)
    let work = (usedCoreHours * rates.usefulGF) / 1000 * turnaround
    let gpuBusy = 0
    let gpuWork = 0
    let surrogateBoost = 1
    if (solver.id === "gpu") {
      const allowedGpuHours = (atpMauh * C.MAUH_DIVISOR) / (gpuFp64 * 1000)
      const used = Math.min(allowedGpuHours, gpuHoursPerAtp)
      const usefulTF = Math.min(platform.fp32TF * C.COMPUTE_EFFICIENCY, platform.hbmTBs * C.CFD_FLOP_PER_BYTE)
      gpuWork = 0.5 * used * usefulTF
      gpuBusy = gpuHoursPerAtp > 0 ? (0.5 * used) / gpuHoursPerAtp : 0
    } else if (solver.id === "surrogate") {
      const allowedGpuHours = (solver.share * atpMauh * C.MAUH_DIVISOR) / (gpuFp64 * 1000)
      const used = Math.min(allowedGpuHours, gpuHoursPerAtp)
      surrogateBoost = 1 + 0.25 * model.surrogateAcc * (1 - Math.exp(-(used * platform.pflops * precSpeed * memEff) / model.surrogateCost / 150))
      gpuBusy = gpuHoursPerAtp > 0 ? used / gpuHoursPerAtp : 0
    }
    work = (work * fabric.cfd * oem.cfdMult + gpuWork) * pfsIO * geometry.factor * surrogateBoost
    return { allowedCoreHours, capacity, usedCoreHours, weeksToBurn, turnaround, work, gpuBusy, gpuWork, surrogateBoost }
  }
  const pfsIO = pfs.io * (ch.pfsPB < C.PFS_NEED_PB ? 0.95 : 1)

  const cfd = cfdForMauh(mauh)
  const execCompute = execution(pitch, "compute")
  const boostOf = (workforceOk, bidirOk) =>
    (1 + (workforceOk ? workforce.aeroBoost * (workforce.liveShare ?? 1) : 0)) * (1 + (bidirOk ? dataflow.aeroBoost || 0 : 0))

  /* ---------------------------------------------------------- money */
  const commercial = { payment: payId, aiPayment: aiPayId, term: ch.term, aas: null, commitment: 0, hardware: 0, capexHardware: 0, opexHardware: 0 }
  const bookHardware = (label, price, station, how) => {
    const terms = how === "aas" ? (station === "ai" && oem.aasAi) || oem.aas : null
    commercial.hardware += price
    if (how === "buy" || how === "finance") {
      capex.push({ label: `${label} (${how === "buy" ? "bought" : "$1-buyout finance"})`, amount: price, station })
      commercial.capexHardware += price
    }
    let yearly = 0
    if (how === "finance") yearly += price * C.FINANCE_INTEREST
    if (how === "lease") yearly += price * (C.LEASE_RATES[ch.term] ?? C.LEASE_RATES[36])
    if (how === "aas") {
      yearly += price * terms.monthlyPct * 12
      const months = Math.max(C.AAS_MIN_MONTHS, ch.term)
      commercial.aas = terms.name
      commercial.commitment += price * terms.monthlyPct * terms.committed * months
      commercial.months = months
    }
    if (yearly) {
      const what = { finance: "finance interest 4.5%", lease: `${ch.term}-month lease ${Math.round((C.LEASE_RATES[ch.term] ?? 0.28) * 100)}%/yr`, aas: `${terms?.name} ${((terms?.monthlyPct || 0) * 100).toFixed(1)}%/month` }[how]
      opex.push({ label: `${label}: ${what}`, amount: yearly, station })
      commercial.opexHardware += yearly
    }
    if (how !== "aas") {
      opex.push({ label: `${label}: ${oem.short} support ${Math.round(oem.supportPct * 100)}%`, amount: price * oem.supportPct, station })
      commercial.opexHardware += price * oem.supportPct
    }
  }
  bookHardware(`${ch.nodes}× ${cpu.name} CFD nodes (${oem.short})`, ch.nodes * cpu.nodePrice * oem.priceMult, "compute", payId)
  const aiUnit = (platform.capex + hbmPerGpu * platform.gpusPerRack) * (platform.custom ? 1 : oem.priceMult)
  if (aiRacks > 0) {
    if (!inCloud) {
      bookHardware(`${aiRacks}× ${platform.name}`, aiUnit * aiRacks, "ai", aiPayId)
      if (platform.nre) capex.push({ label: `${platform.name}: engineering (NRE)`, amount: platform.nre, station: "ai" })
      const nvaieFree = oem.nvaieIncluded || (aiPayId === "aas" && oem.aasAi?.nvaieIncluded)
      if (!platform.custom && !nvaieFree) opex.push({ label: `NVIDIA AI Enterprise ${gpus} GPUs × $${C.NVAIE_PER_GPU.toLocaleString("en-GB")}`, amount: gpus * C.NVAIE_PER_GPU, station: "ai" })
    } else if (deployId === "burst") {
      const rate = platform.burstRate * (1 + 0.08 * hbmSteps)
      opex.push({ label: `Race-weekend Capacity Blocks ${gpus} GPUs × $${rate.toFixed(2)}/h × ${C.BURST_HOURS.toLocaleString("en-GB")} h`, amount: gpus * rate * C.BURST_HOURS, station: "ai" })
      opex.push({ label: "Hyperscaler egress for telemetry", amount: C.CLOUD_EGRESS.hyperscaler, station: "ai" })
    } else {
      const rate = platform.cloudRate * (1 + 0.08 * hbmSteps)
      opex.push({ label: `Reserved cloud ${gpus} GPUs × $${rate.toFixed(2)}/h × 8,760 h`, amount: gpus * rate * 8760, station: "ai" })
      if (C.CLOUD_EGRESS.neocloud) opex.push({ label: "Cloud egress", amount: C.CLOUD_EGRESS.neocloud, station: "ai" })
    }
  }
  if (geometry.opex) opex.push({ label: "PLM geometry governance", amount: geometry.opex, station: "compute" })
  if (orcaOn) capex.push({ label: "ORCA PT-3", amount: C.ORCA.capex, station: "ai" })

  if (hall.rackNrc) capex.push({ label: `${hall.name} kit × ${positions} positions`, amount: hall.rackNrc * positions, station: "dc" })
  if (loc.onprem && (liquidHall || immersion)) capex.push({ label: "Factory liquid retrofit", amount: loc.liquidRetrofit, station: "dc" })
  const liquidLoop = liquidHall || immersion
  if (heatOn && liquidLoop) capex.push({ label: "Heat-reuse exchangers", amount: C.HEAT_REUSE.capex, station: "dc" })
  if (heatOn && !liquidLoop) check(checks, "dc", "amber", "Heat reuse needs a liquid or immersion loop: air exhaust is too cool to sell.")
  const energy = Math.min(facilityKW, blockKW) * 8760 * (loc.mwh / 1000)
  opex.push({ label: `Energy ${Math.round(Math.min(facilityKW, blockKW))} kW × $${loc.mwh}/MWh`, amount: energy, station: "dc" })
  const rentRate = loc.kwMonth * coloTerms.mult * powerRedundancy.mult * (liquidLoop ? 1 + C.LIQUID_RENT_PREMIUM : 1)
  const rentKW = coloTerms.metered ? Math.min(facilityKW, blockKW) : blockKW
  if (loc.kwMonth) opex.push({ label: `Colocation ${Math.round(rentKW)} kW × $${Math.round(rentRate)}/kW-month (${coloTerms.name}, ${powerRedundancy.name.split(" ")[0]}${liquidLoop ? ", liquid-ready" : ""})`, amount: rentKW * rentRate * 12, station: "dc" })
  if (heatOn && liquidLoop) opex.push({ label: "Heat-reuse credit", amount: -itKW * C.HEAT_REUSE.creditPerKWYear * (oem.heatReuseReady ? 1.25 : 1), station: "dc" })

  if (!pfs.staas) capex.push({ label: `${pfs.name} ${ch.pfsPB} PB`, amount: pfs.capexPerPB * ch.pfsPB + pfs.auditNrc, station: "storage" })
  opex.push({ label: `${pfs.name} ${pfs.staas ? "service" : "support and licences"}`, amount: pfs.opexPerPB * ch.pfsPB, station: "storage" })
  if (archive.capex) capex.push({ label: archive.name, amount: archive.capex, station: "storage" })
  if (archive.opex) opex.push({ label: archive.name, amount: archive.opex, station: "storage" })
  if (dataTier.capex) capex.push({ label: dataTier.name, amount: dataTier.capex, station: "storage" })
  if (kvOn) capex.push({ label: C.KV_TIER.name, amount: C.KV_TIER.capex, station: "storage" })
  if (hosts.capex) capex.push({ label: hosts.name, amount: hosts.capex, station: "storage" })

  /* ---------------------------------------------------------- networks */
  const siteKmFactory = loc.onprem ? 0 : C.greatCircleKm(loc, C.FACTORY)
  const siteKmFinale = C.greatCircleKm(loc, C.FINALE)
  const seasonKm = C.CIRCUITS.reduce((total, circuit) => total + C.greatCircleKm(loc, circuit), 0) / C.CIRCUITS.length
  let wanRoute = wanNet.id
  if (!wanNet.reachTrack) {
    wanRoute = "public"
    check(checks, "network", "red", `${wanNet.name} cannot reach a circuit ${Math.round(siteKmFinale).toLocaleString("en-GB")} km away; race traffic falls back to the public internet.`)
  }
  let hqRoute = hqNet.id
  if (!loc.onprem) {
    if (hqNet.id === "cross") {
      hqRoute = "public"
      check(checks, "network", "red", "A cross connect stays inside one building; the factory is not in the data centre, so the link falls back to public internet.")
    } else if (hqNet.maxKm && siteKmFactory > hqNet.maxKm) {
      hqRoute = "public"
      check(checks, "network", "red", `${hqNet.name} reaches ${hqNet.maxKm} km at most; the factory is ${Math.round(siteKmFactory)} km away, so it falls back to public internet.`)
    }
  }
  const jittered = (km, route) => C.roundTripS(km, route) * (1 + (C.ROUTE[route]?.jitterFrac || 0))
  const rttTrack = jittered(siteKmFinale, wanRoute)
  const rttSeason = jittered(seasonKm, wanRoute)
  const rttHq = loc.onprem ? 0 : jittered(siteKmFactory, hqRoute)
  const cloudHop = inCloud ? 0.002 : 0
  const loopS = venue.illegal ? 0.002 : rttTrack + rttHq + cloudHop
  const loss = Math.max(C.ROUTE[wanRoute]?.loss || 0, loc.onprem ? 0 : C.ROUTE[hqRoute]?.loss || 0)
  const wanGbps = C.byId(C.NETWORKS, wanRoute)?.gbps ?? 1
  const bwScore = clamp(wanGbps / C.TRACK_NEED_GBPS, 0, 1)
  const decisionS = aiRacks > 0 ? Math.max(0, loopS + inferS - 0.045) : loopS
  const latScore = clamp(1 - (decisionS - 0.04) / 0.3, 0.3, 1) * (1 - 5 * loss) * (0.75 + 0.25 * bwScore)

  const tunnels = C.byId(C.TUNNELS, ch.tunnels)
  const garage = C.byId(C.GARAGE_NETS, ch.garage)
  const cellular = C.byId(C.CELLULAR, ch.cellular)
  const netItems = [[wanNet, "WAN to circuits"]]
  if (!loc.onprem) netItems.push([hqNet, "Data centre ↔ factory"])
  const backup = ch.wanBackup === "none" ? null : C.byId(C.NETWORKS, ch.wanBackup)
  if (backup) netItems.push([backup, "Backup WAN"])
  for (const item of [tunnels, garage, cellular]) {
    if (item.capex) capex.push({ label: item.name, amount: item.capex, station: "network" })
    if (item.opex) opex.push({ label: item.name, amount: item.opex, station: "network" })
  }
  for (const [net, label] of netItems) {
    const mrcMult = net.agentic ? 0.85 : 1
    opex.push({ label: `${label}: ${net.name}`, amount: net.nrc + net.mrc * 12 * mrcMult, station: "network" })
  }
  capex.push({ label: `${fabric.name} × ${computeRacks} compute racks`, amount: fabric.capexPerRack * computeRacks, station: "network" })
  capex.push({ label: `${ch.edge}× trackside edge racks`, amount: C.EDGE.capex * ch.edge, station: "network" })
  opex.push({ label: `Air freight for ${ch.edge} edge racks (24 races)`, amount: C.EDGE.freightPerYear * ch.edge, station: "network" })
  if (telemetry.capex) capex.push({ label: telemetry.name, amount: telemetry.capex, station: "network" })
  if (venue.capex) capex.push({ label: venue.name, amount: venue.capex, station: "network" })

  const edgeScore = ({ 1: 0.8, 2: 1, 3: 1.02 }[ch.edge] || 1) * telemetry.edge * (garage.edge || 1) * (cellular.edge || 1)
  const diverse = backup && backup.id !== wanNet.id && (backup.medium || "ground") !== (wanNet.medium || "ground")
  const twoTunnels = tunnels.id === "redundant" && Boolean(backup)
  const redundancy = clamp((!backup ? 0.4 : backup.id === wanNet.id ? 0.85 : 1) * (twoTunnels || !backup ? 1 : 0.8) + (cellular.resilience || 0), 0, 1.05)
  const blackoutP = !backup ? 0.15 : backup.id === wanNet.id ? 0.04 : diverse ? 0.012 : 0.02
  const backupThin = backup && (backup.gbps ?? 1) < C.TRACK_NEED_GBPS

  /* ---------------------------------------------------------- governance */
  let segAudit = segregation.auditRisk || 0
  if (segregation.needsDpu && hosts.id !== "dpu") {
    segAudit = C.byId(C.SEGREGATION, "logical").auditRisk
    check(checks, "governance", "amber", "Zero-trust without BlueField DPUs is only as strong as the logical option.")
  }
  if (hosts.isolation && segregation.id === "logical") segAudit *= 0.5
  for (const item of [segregation, dataflow, curfew, logs]) {
    if (item.capex) capex.push({ label: item.name, amount: item.capex, station: "governance" })
    if (item.opex) opex.push({ label: item.name, amount: item.opex, station: "governance" })
  }
  opex.push({ label: "CFD / CAD / PLM / OS licences (fixed)", amount: C.BASE_LICENCES, station: "governance" })

  const capexTotal = sum(capex)
  const opexTotal = sum(opex)
  const opexOver = opexTotal - C.INFRA_OPEX.allowance
  const capState = opexOver <= 0 ? "ok" : opexOver <= C.INFRA_OPEX.headroom ? "over" : opexOver <= 2 * C.INFRA_OPEX.headroom ? "minor" : "major"
  const capexOver = capexTotal - capexRemaining
  if (capState === "minor" || capState === "major") atrCuts.push("cost cap breach")
  const atrMult = atrCuts.length ? 0.9 : 1

  /* ---------------------------------------------------------- aero index */
  const aeroIndexFor = ({ workforceOk = true, bidirOk = true } = {}) => {
    const base = (cfd.work / REF_AERO_WORK) * cfdLive * execCompute * atrMult
    return base * boostOf(workforceOk, bidirOk)
  }
  const capCut = capState === "over" ? 0.1 * clamp(opexOver / C.INFRA_OPEX.headroom, 0, 1) : 0
  const aeroIndex = aeroIndexFor()
  const aeroGain = Math.max(0, aeroGainFor(aeroIndex) - capCut)

  /* ---------------------------------------------------------- strategy */
  const fabricAi = aiRacks > 1 || platform.gpusPerRack === 72 ? fabric.ai : (1 + fabric.ai) / 2
  const aiThrottle = aiInHall ? thermal * powerThrottle * spaceThrottle : 1
  const tokens = gpus * platform.tokPerGpu * aiMult * architectGain * tgp.perf * (kvOn ? C.KV_TIER.tokMult : 1) * hosts.tokMult * fabricAi * aiThrottle * (1 - cfd.gpuBusy)
  const coverage = tokens / C.AI_DEMAND_TOKS
  const compScore = clamp(coverage, 0, 1)
  const orcaBoost = orcaOn && aiRacks > 0 ? C.ORCA.boost * (loc.id === "lon" ? 1 : hqNet.orcaRetain) : 0
  const execStrategy = (execution(pitch, "ai") + execution(pitch, "network")) / 2
  const strategyFor = (comp) =>
    clamp((0.4 * comp * maturity * accuracy + 0.15 * dataTier.grounding + 0.25 * latScore + 0.1 * Math.min(1, edgeScore) + 0.1 * redundancy) * (1 + orcaBoost) * execStrategy * (edgeScore > 1 ? 1 + (edgeScore - 1) * 0.3 : 1), 0, 1.15)
  const strategy = strategyFor(compScore)
  const strategyNoAsic = strategyFor(0)

  /* ---------------------------------------------------------- risks (sampled in the race) */
  const relExec = 1.15 - 0.3 * clamp((pitch.dc ?? C.PITCH_MAX * 0.5) / C.PITCH_MAX, 0, 1)
  if (thermal < 1) risks.push({ id: "thermal", p: (boostUncooled && thermal >= 0.9 ? 0.25 : 0.35) * relExec, loss: 2.5, text: "HQ GPUs thermal-throttled mid-race; strategy sims fell behind.", lesson: thermalWhy })
  else if (tgp.needsLiquid && aiInHall) risks.push({ id: "thermal", p: 0.06 * relExec, loss: 2.0, text: "Max-boost GPUs hit a hot spot and throttled.", lesson: "Pushing power limits buys a few percent and costs headroom." })
  if (aiInHall || ch.nodes > 0) {
    const p = (headroom < 0 ? 0.4 : headroom < C.POWER_HEADROOM.tripBelow ? 0.15 : 0.02) * powerRedundancy.trip
    risks.push({ id: "power", p: Math.min(0.6, p * relExec), loss: 3.5, text: "A breaker tripped at the data centre; the strategy cluster rebooted.", lesson: headroom < 0.1 ? `Only ${Math.round(headroom * 100)}% power headroom: a hot day trips the contract.` : "Even well-run halls have bad days." })
  }
  const mcpHelp = (wanNet.agentic || backup?.agentic ? 0.5 : 1) * (cellular.resilience ? 0.85 : 1) * (backup && !twoTunnels ? 1.5 : 1) * (backupThin ? 1.4 : 1)
  risks.push({ id: "wan", p: blackoutP, loss: (backup ? 0.6 : 4.0) * mcpHelp, text: backup ? `Primary WAN dropped; ${backup.name} took over in seconds.` : "The only WAN link dropped: no live telemetry and no strategy calls for six laps.", lesson: backup ? "Redundant, diverse paths turn an outage into a blip (FIA 5.3)." : "FIA 5.3 asks for redundant tunnels for a reason." })
  if (immersion) risks.push({ id: "immersion", p: 0.04 * relExec, loss: 2.0, text: "A tank pump fault took immersion-cooled nodes offline.", lesson: "New cooling technology needs OEM warranty sign-off and spares." })
  if (fabric.risk) risks.push({ id: "cpo", p: fabric.risk, loss: 1.5, text: "An early-life co-packaged optics switch faulted; jobs re-routed.", lesson: "Photonics cuts watts and latency; first-generation kit carries operational risk." })
  if (platform.slipRisk && aiRacks > 0 && !inCloud) risks.push({ id: "asicSlip", p: platform.slipRisk, slipWeeks: platform.slipWeeks, text: `The ${platform.name.toLowerCase()} slipped ${platform.slipWeeks} weeks: it missed the race.`, lesson: "Custom silicon is a multi-year bet; schedule risk is the price of perf per watt." })

  /* ---------------------------------------------------------- penalties */
  if (segregation.illegal) penalties.push({ id: "f6", p: 1, points: 15, text: "Article F6 breach: shared IT with sister companies. −15 points and a 10% ATR cut.", clause: "F6 3.3" })
  else if (segAudit > 0) penalties.push({ id: "segaudit", p: segAudit, points: 4, text: "FIA audit found gaps in the IT segregation document. −4 points.", clause: "F6 3.3" })
  if (dataflow.illegal) penalties.push({ id: "bidir", p: dataflow.detect, points: 20, aero: true, text: "Non-F1 → F1 data transfer detected: −20 points, the borrowed aero gain is struck out and the ATR cut 10%.", clause: "F6 3.3" })
  else if (dataflow.auditRisk) penalties.push({ id: "manualflow", p: dataflow.auditRisk, points: 4, text: "A manual transfer lacked a video record. −4 points.", clause: "F6 3.3" })
  if (workforce.illegal) penalties.push({ id: "workforce", p: workforce.detect, points: 8, workforce: true, text: "Engineers joined F1 without the 3-month lockout. −8 points and their work is struck out.", clause: "F6 3.4" })
  if (logs.auditRisk) penalties.push({ id: "logs", p: logs.auditRisk, points: 3, text: "Access logs did not cover three years. −3 points.", clause: "F6 3.2" })
  if (curfew.breachRisk) penalties.push({ id: "curfew", p: curfew.breachRisk, grid: 3, text: "A server rack booted during a curfew: 3-place grid penalty.", clause: "5.4" })
  if (!pfs.tamper) penalties.push({ id: "pfs", p: 0.5, points: 5, text: "CFD run metadata was not tamper-evident. −5 points.", clause: "2.3" })
  if (!archive.compliant) penalties.push({ id: "archive", p: 0.5, points: 5, text: "Run folders were purged before the FIA audit. −5 points.", clause: "2.3" })
  if (telemetry.illegal === "5.1") penalties.push({ id: "fpga", p: 1, dsq: true, text: "An FPGA sat between sensors and the SECU: disqualified.", clause: "5.1" })
  if (cellular.illegal) penalties.push({ id: "5g", p: 1, seconds: cellular.seconds, points: cellular.points, text: `A private 5G cell on track and in the pit lane: ${cellular.seconds}-second time penalty and −${cellular.points} points.`, clause: "5.2" })
  if (garage.illegal) penalties.push({ id: "umbilical", p: 0.8, points: garage.points, text: `Car dumps went over Wi-Fi instead of the wired umbilical: −${garage.points} points.`, clause: "5.2" })
  if (tunnels.illegal) penalties.push({ id: "tunnels", p: 1, points: tunnels.points, text: `${tunnels.id === "clear" ? "Unencrypted" : "Non-redundant"} circuit ↔ factory WAN: −${tunnels.points} points.`, clause: "5.3" })
  else if (!backup) penalties.push({ id: "tunnels", p: 0.6, points: 5, text: "Two tunnels on a single WAN path are not redundant: −5 points at the FIA audit.", clause: "5.3" })
  if (venue.illegal) penalties.push({ id: "trackside", p: 1, grid: 5, seconds: 5, text: "Strategy ran on hidden garage hardware: 5-place grid drop and 5 seconds.", clause: "5.3" })
  if (capState === "minor") penalties.push({ id: "cap", p: 1, points: 10, text: "Minor cost-cap overspend: −10 points and a 10% ATR cut.", clause: "1.1" })
  if (capState === "major") penalties.push({ id: "cap", p: 1, points: 25, text: "Major cost-cap overspend: −25 points and a 10% ATR cut.", clause: "1.1" })
  if (capexOver > 0) penalties.push({ id: "capex", p: 1, points: 10, text: `CapEx envelope exceeded by $${(capexOver / 1e6).toFixed(1)}M: −10 points.`, clause: "1.2" })

  /* ---------------------------------------------------------- leader checks */
  const pct = (value) => `${Math.round(value * 100)}%`
  check(checks, "compute", rates.efficiency >= 0.05 ? "green" : rates.efficiency >= 0.03 ? "amber" : "red", `${cpu.name} ${clock.name.toLowerCase()}: billed ${rates.billedGF.toFixed(1)} GFLOPS/core, useful ${rates.usefulGF.toFixed(2)}: ${pct(rates.efficiency)} of every MAUh does CFD.`)
  check(checks, "compute", cfd.weeksToBurn <= 1.5 ? (cfd.weeksToBurn < 0.4 ? "amber" : "green") : cfd.usedCoreHours < cfd.allowedCoreHours ? "red" : "amber", cfd.usedCoreHours < cfd.allowedCoreHours ? `The cluster cannot spend its ${mauh.toFixed(2)} MAUh in one ATP: ${pct(cfd.usedCoreHours / cfd.allowedCoreHours)} used.` : `${ch.nodes} nodes spend the ATP allocation in ${cfd.weeksToBurn.toFixed(1)} weeks${cfd.weeksToBurn < 0.4 ? ": oversized, idle most of the ATP" : ""}.`)
  if (clock.id === "turbo") check(checks, "compute", "red", "Turbo unlocked: the FIA bills every core-hour at max boost (2.1).")
  if (solver.id === "gpu") check(checks, "compute", "amber", `GPU-native FP32 CFD on ${platform.name} (FP64 ${gpuFp64} TFLOPS): a loophole until the ATP 4 Technical Directive.`)
  if (solver.id === "surrogate") check(checks, "compute", cfd.surrogateBoost > 1.15 ? "green" : "amber", `AI surrogate on ${platform.name}: billed at ${gpuFp64} TFLOPS FP64 per GPU, design-exploration ×${cfd.surrogateBoost.toFixed(2)}.`)
  check(checks, "compute", geometry.id === "disciplined" ? "green" : "amber", geometry.id === "disciplined" ? "Sub-model reuse governed: RATGs last the whole ATP." : "Free sub-model edits burn RATGs: about 18% of the MAUh will sit unused.")
  check(checks, "compute", "green", `Aero index ${aeroIndex.toFixed(2)} (P7 baseline = 1.00) with ${mauh.toFixed(2)} MAUh per ATP (rank P${rank}).`)

  check(checks, "ai", aiRacks === 0 ? "red" : coverage < 0.7 ? "red" : coverage < 1 ? "amber" : coverage > 1.8 ? "amber" : "green", aiRacks === 0 ? "No accelerators: strategy runs on laptops." : `${Math.round(tokens).toLocaleString("en-GB")} of ${C.AI_DEMAND_TOKS.toLocaleString("en-GB")} tok/s (${pct(coverage)})${coverage > 1.8 ? ": idle silicon still costs money and power" : ""}.`)
  if (thermalWhy) check(checks, "ai", "red", thermalWhy)
  if (aiRacks > 0) {
    const memText = {
      fits: `${model.name} in ${precision.name}: ${Math.round(weightsGB)} GB weights + ${Math.round(kvGB)} GB KV fit in one ${hbmGB} GB accelerator.`,
      sharded: `${model.name} in ${precision.name}: ${Math.round(weightsGB + kvGB)} GB is sharded across ${shard} accelerators over ${platform.nvlink > 1 ? "NVLink" : "PCIe"} (${pct(memEff)} efficiency).`,
      spill: `${model.name} in ${precision.name}: weights sharded ×${shard}, KV cache spills to ${kvOn ? "the KV cache tier" : "Grace memory"} (${pct(memEff)} efficiency).`,
      offload: `${model.name} in ${precision.name} needs ${Math.round(weightsGB + kvGB)} GB: it does not fit the ${platform.nvlink > 1 ? `${platform.nvlink}-GPU NVLink domain` : "PCIe server"} and crawls from host memory.`,
    }[memState]
    check(checks, "ai", { fits: "green", sharded: memEff >= 0.9 ? "green" : "amber", spill: "amber", offload: "red" }[memState], memText)
    check(checks, "ai", precSpeed >= 0.9 ? "green" : precSpeed >= 0.5 ? "amber" : "red", `${precision.name}: ${pct(precSpeed)} of FP8 speed, accuracy ×${precision.acc}. The FIA bills the same FP64 peak either way.`)
    check(checks, "ai", inferS <= 0.06 ? "green" : inferS <= 0.15 ? "amber" : "red", `~${Math.round(inferS * 1000)} ms per strategy answer on top of the network loop.`)
  }
  if (aiLead > C.SEASON.firstRaceWeek) check(checks, "ai", aiLead > 30 ? "red" : "amber", `AI platform live in week ${Math.ceil(aiLead)}: ${pct(1 - aiLive)} of the races run without it.`)
  if (inCloud && aiRacks > 0) check(checks, "ai", "green", `${deploy.name}: no CapEx and no hall space; every dollar counts against the cost cap (FIA 1.1).`)
  if (architectGain > 1) check(checks, "ai", "green", `Architect tuning: ×${architectGain.toFixed(2)} tokens from the same hardware.`)
  if (tgp.id === "eco85" || tgp.id === "eco70") check(checks, "ai", "green", `${tgp.name}: ${pct(tgp.perf)} of the tokens for ${pct(tgp.power)} of the watts.`)
  if (orcaOn) check(checks, "ai", loc.id === "lon" ? "green" : "amber", loc.id === "lon" ? "ORCA PT-3 sits beside the GPUs in London: full boost." : `ORCA PT-3 is in London; from ${loc.name} it is a remote link (${pct(hqNet.orcaRetain)} of the boost).`)
  if (platform.slipRisk && aiRacks > 0) check(checks, "ai", platform.nre > 50e6 ? "red" : "amber", `${platform.name}: ${Math.round(platform.slipRisk * 100)}% chance it slips ${platform.slipWeeks} weeks, $${(platform.nre / 1e6).toFixed(0)}M of engineering.`)

  check(checks, "dc", powerState, headroom < 0 ? `Facility draw ${Math.round(facilityKW)} kW exceeds the ${blockMW} MW contract: racks throttle to ${pct(powerThrottle)}.` : `Facility ${Math.round(facilityKW)} kW of ${blockMW} MW contracted: ${pct(headroom)} headroom${headroom < 0.1 ? " (trip risk)" : headroom > 0.35 ? " (stranded reservation)" : ""}.`)
  check(checks, "dc", thermal < 1 ? "red" : "green", thermal < 1 ? thermalWhy : `${hall.name} cools every rack (cap ${hall.maxRackKW} kW, PUE ${pue}).`)
  if (aiInHall && platform.cooling === "air" && liquidHall) check(checks, "dc", "amber", "Air-cooled servers in a liquid hall: you pay the liquid fit-out and still run fans.")
  check(checks, "dc", spaceOver ? "red" : "green", `${positions} of ${hall.rackSpace} rack positions${spaceOver ? ": overflow racks throttle" : ""}.`)
  if (hallWeeks > C.SEASON.firstRaceWeek) check(checks, "dc", "amber", `Hall ready in week ${hallWeeks}: after the first race.`)
  if (loc.onprem) check(checks, "dc", "amber", `On-prem PUE ${pue}: no colocation fee, but a legacy plant and ${Math.max(...loc.blocksMW)} MW ceiling.`)

  check(checks, "storage", pfs.tamper ? "green" : "red", pfs.tamper ? `${pfs.name}: tamper-evident metadata for FIA 2.3.` : `${pfs.name} has no tamper-evident run metadata (FIA 2.3).`)
  check(checks, "storage", ch.pfsPB < C.PFS_NEED_PB ? "amber" : ch.pfsPB > C.PFS_NEED_PB ? "amber" : "green", ch.pfsPB < C.PFS_NEED_PB ? `${ch.pfsPB} PB is tight: run folders get squeezed and I/O slows.` : ch.pfsPB > C.PFS_NEED_PB ? `${ch.pfsPB} PB is more than the ${C.PFS_NEED_PB} PB the programme needs.` : `${ch.pfsPB} PB fits a season of scratch and retention.`)
  check(checks, "storage", archive.compliant ? "green" : "red", archive.compliant ? `${archive.name} retains run folders for audit.` : "Purging run folders breaks FIA 2.3 retention.")
  check(checks, "storage", dataTier.id === "vector" ? "green" : "amber", `${dataTier.name}: strategy grounding ${pct(dataTier.grounding)}.`)
  check(checks, "storage", kvOn ? "green" : "amber", kvOn ? "KV cache tier: repeat what-ifs skip prefill." : "No KV cache tier: GPUs redo prefill on every repeat what-if.")
  if (hosts.id === "dpu") check(checks, "storage", "green", "BlueField DPUs: hardware tenant isolation that also hardens Article F6.")

  check(checks, "network", loopS < 0.09 ? "green" : loopS < 0.16 ? "amber" : "red", venue.illegal ? "Strategy on garage hardware: no WAN delay, and illegal (5.3)." : `Track → DC → factory loop ${Math.round(loopS * 1000)} ms to Austin (season average ${Math.round((rttSeason + rttHq) * 1000)} ms).`)
  check(checks, "network", backup ? (backup.id === wanNet.id ? "amber" : "green") : "red", backup ? (backup.id === wanNet.id ? "Backup on the same product: a second port, not a second path." : `Diverse backup on ${backup.name}.`) : "No backup WAN: one outage blinds the pit wall (FIA 5.3).")
  if (telemetry.illegal) check(checks, "network", "red", `${telemetry.name}: breaks FIA ${telemetry.illegal}.`)
  check(checks, "network", tunnels.illegal || !backup ? "red" : "green", tunnels.illegal ? `${tunnels.name}: breaks FIA 5.3 (redundant, encrypted tunnels).` : !backup ? "Redundant tunnels need a second WAN path (FIA 5.3)." : "Two encrypted tunnels on diverse paths (FIA 5.3).")
  check(checks, "network", garage.illegal ? "red" : "green", garage.illegal ? "Car dumps must use the wired Gigabit umbilical (FIA 5.2)." : garage.name)
  if (cellular.illegal) check(checks, "network", "red", "Team wireless on track or in the pit lane breaks FIA 5.2.")
  else if (cellular.id === "hotel") check(checks, "network", "green", "Private 5G garage ↔ hotel/office: an independent path for engineers, off track (allowed).")
  check(checks, "network", bwScore < 1 ? "red" : "green", bwScore < 1 ? `${C.byId(C.NETWORKS, wanRoute).name} carries ${wanGbps * 1000} Mb/s of the ${C.TRACK_NEED_GBPS} Gb/s race traffic: telemetry is thinned.` : `Primary WAN carries the ${C.TRACK_NEED_GBPS} Gb/s of race traffic.`)
  if (backup && diverse && backup.medium === "space") check(checks, "network", backupThin ? "amber" : "green", `${backup.name} backup shares no ground path with the primary${backupThin ? ", but carries a quarter of the traffic" : ""}.`)
  if (venue.illegal) check(checks, "network", "red", "Live strategy on track hardware breaks FIA 5.3.")
  check(checks, "network", fabric.id === "eth100" ? "amber" : "green", `${fabric.name}: CFD scaling ×${fabric.cfd}, AI ×${fabric.ai}.`)
  check(checks, "network", ch.edge === 1 ? "amber" : ch.edge === 3 ? "amber" : "green", ch.edge === 1 ? "One edge rack: telemetry ingest backs up." : ch.edge === 3 ? "Three edge racks: freight for little gain." : "Two edge racks: ingest, caching and safety decoding covered.")

  check(checks, "governance", segregation.illegal ? "red" : "green", segregation.illegal ? "Shared IT with sister companies breaks Article F6 3.3." : `${segregation.name}.`)
  check(checks, "governance", dataflow.illegal ? "red" : dataflow.id === "manual" ? "amber" : "green", dataflow.illegal ? "Non-F1 → F1 transfers are strictly forbidden (F6 3.3)." : dataflow.name)
  check(checks, "governance", workforce.illegal ? "red" : "green", workforce.illegal ? "No 3-month lockout for incoming staff (F6 3.4)." : workforce.name)
  check(checks, "governance", curfew.id === "auto" ? "green" : "amber", curfew.name)
  check(checks, "governance", logs.auditRisk ? "red" : "green", logs.auditRisk ? "Logs must be kept immutably for three years (F6 3.2)." : logs.name)
  check(checks, "governance", capState === "ok" ? "green" : capState === "over" ? "amber" : "red", `Infrastructure OpEx $${(opexTotal / 1e6).toFixed(2)}M of a $${(C.INFRA_OPEX.allowance / 1e6).toFixed(1)}M allowance${capState === "over" ? ": car development loses the difference" : capState === "ok" ? "" : ": cost cap breach"}.`)
  const payName = C.byId(C.PAYMENTS, payId).name
  check(checks, "compute", commercial.capexHardware > 0.6 * capexRemaining ? "amber" : "green", commercial.capexHardware > 0 ? `${payName}: $${(commercial.capexHardware / 1e6).toFixed(2)}M of hardware on the CapEx envelope ($${(capexRemaining / 1e6).toFixed(1)}M left in ${tier.name}).` : `${commercial.aas || payName}: no CapEx; $${(commercial.opexHardware / 1e6).toFixed(2)}M a year on the cost cap${commercial.commitment ? `, $${(commercial.commitment / 1e6).toFixed(2)}M committed over ${commercial.months} months (early exit pays the rest)` : ""}.`)
  check(checks, "governance", capexOver > 0 ? "red" : "green", `CapEx $${(capexTotal / 1e6).toFixed(2)}M of $${(capexRemaining / 1e6).toFixed(1)}M left in the ${tier.name} envelope.`)

  return {
    rank,
    choices: ch,
    deployId,
    commercial,
    tier,
    atr: { ...atr, mauhEffective: mauh * atrMult },
    ledger: {
      capex: capexTotal,
      capexRemaining,
      capexOver,
      opex: opexTotal,
      opexAllowance: C.INFRA_OPEX.allowance,
      opexHeadroom: C.INFRA_OPEX.headroom,
      capState,
      costCap: cap,
      capexItems: capex,
      opexItems: opex,
    },
    power: { itKW, itParts, pue, facilityKW, blockMW, headroom, state: powerState, throttle: powerThrottle },
    space: { positions, rackSpace: hall.rackSpace, over: spaceOver },
    cooling: { thermal, why: thermalWhy, aiRackKW, aiPositionKW: aiPositions > aiRacks ? aiRackKW / 2 : aiRackKW, cpuPerRack, capKW: hall.maxRackKW },
    lead: { cfd: cfdLead, ai: aiLead, hall: hallWeeks, net: netLead, cfdLive, aiLive },
    cfd: { ...cfd, rates, cores, mauh, solver: solver.id },
    aero: { index: aeroIndex, gain: aeroGain, capCut, indexIfCaught: { workforce: aeroIndexFor({ workforceOk: false }), bidir: aeroIndexFor({ bidirOk: false }) * 0.9, both: aeroIndexFor({ workforceOk: false, bidirOk: false }) * 0.9 } },
    ai: { gpus, tokens, coverage, architectGain, deploy: deployId, platform: platform.id, inHall: aiInHall, accuracy, inferS, precision: precision.id, precSpeed, model: model.id, memory: { weightsGB, kvGB, hbmGB, hbmTBs, tier: hbmTier?.id || null, shard, state: memState, eff: memEff } },
    network: { loopS, decisionS, rttTrack, rttHq, rttSeason, latScore, bwScore, wanGbps, redundancy, diverse: Boolean(diverse), blackoutP, edgeScore, wanRoute, hqRoute, siteKmFactory, siteKmFinale },
    strategy,
    strategyNoAsic,
    risks,
    penalties,
    checks,
    notes,
  }
}

/** A table counts only once a table leader approved its pitched design. */
export function completedStations(team, stationIds = C.STATIONS.map((s) => s.id)) {
  return stationIds.filter((id) => team?.reviews?.[id]?.status === "approved")
}

/**
 * The team as the race sees it: choices only from approved tables; every other table keeps its
 * (deliberately poor) defaults. `missed` tables were never locked in; `notApproved` tables were
 * locked in (or sent back) but not approved.
 */
export function effectiveTeam(team, stationIds = C.STATIONS.map((s) => s.id)) {
  const done = new Set(completedStations(team, stationIds))
  const choices = {}
  for (const [key, value] of Object.entries(team?.choices || {})) {
    const d = C.decision(key)
    if (d && done.has(d.station)) choices[key] = value
  }
  const pending = stationIds.filter((id) => !done.has(id))
  const triedPitch = (id) => Boolean(team?.plans?.[id] || team?.submitted?.[id] || team?.reviews?.[id])
  return { ...team, choices, approved: [...done], missed: pending.filter((id) => !triedPitch(id)), notApproved: pending.filter(triedPitch) }
}

/** What changes in the ledger if one decision took another value. */
export function whatIf(team, opts, decisionId, value) {
  const base = evaluate(team, opts)
  const alt = evaluate({ ...team, choices: { ...base.choices, [decisionId]: value } }, opts)
  return {
    capex: alt.ledger.capex - base.ledger.capex,
    opex: alt.ledger.opex - base.ledger.opex,
    kw: alt.power.facilityKW - base.power.facilityKW,
    alt,
  }
}
