/**
 * Architect mode: an invited team tunes how its AI racks serve tokens with the Token Efficiency
 * Calculator. The base is the team's own plan; the gain (good tokens per second, tuned vs base)
 * feeds the evaluation, the simulation and the race.
 */
import * as C from "./catalog.js"
import { resolveChoices, pickedOption } from "./model.js"
import { computeTokenomics, TOKENOMICS_PRESETS } from "./tokenomics.js"

export const ARCHITECT_SUMMARY = "Architect mode lets an invited team tune how its GPUs serve tokens; every gain in good tokens per second carries into the simulation and the race."

const MODELS = {
  "7b": { paramsB: 7, activeB: 7, moe: false, kvMBPerTok: 0.03 },
  "70b": TOKENOMICS_PRESETS.models["70b"],
  "400b": { paramsB: 400, activeB: 400, moe: false, kvMBPerTok: 0.4 },
}
const FP4_NATIVE = new Set(["b200", "b300", "b300n", "gb200", "gb300", "vr", "rtx6000"])
export const GAIN_RANGE = [0.5, 3]

/** The eight dials. Each has a fixed list of values, so the server can validate a tuning exactly. */
export const ARCHITECT_LEVERS = [
  { key: "precision", label: "Precision / quantisation", help: "Fewer bytes per weight: more fits and every token re-reads less. FP4 needs Blackwell-class GPUs.", options: [["bf16", "BF16"], ["fp8", "FP8"], ["int8", "INT8"], ["fp4", "FP4"]] },
  { key: "batchCap", label: "Batch size (streams per model copy)", help: "How many answers one model copy generates at once; a low cap leaves memory idle.", options: [[8, "8"], [32, "32"], [128, "128"], [0, "No cap"]] },
  { key: "continuousBatching", label: "Continuous batching", help: "Slot new requests in as others finish instead of waiting for a whole batch.", options: [[false, "Off"], [true, "On"]] },
  { key: "kvTier", label: "KV cache tier", help: "Park the GPUs' notes between turns so follow-ups skip re-reading the prompt.", options: [[false, "Off"], [true, "On"]] },
  { key: "kvCapture", label: "KV cache hit rate", help: "Share of the reusable context the cache really serves (prefix caching, routing).", options: [[null, "Automatic"], [0.5, "50%"], [0.8, "80%"], [0.95, "95%"]] },
  { key: "hbm", label: "HBM per GPU", help: "Memory size and bandwidth: decode speed is set by how fast weights are re-read.", options: [["plan", "As planned"], ["hbm141", "141 GB"], ["hbm192", "192 GB"], ["hbm288", "288 GB"]] },
  { key: "powerCap", label: "GPU power cap", help: "Inference is memory-bound: 85% power keeps ~93% of the tokens.", options: [[0.7, "70%"], [0.85, "85%"], [1, "100%"], [1.15, "115% boost"]] },
  { key: "interconnect", label: "Interconnect", help: "GPUs per NVLink island: a model that needs more GPUs than one island spills onto slow links.", options: [["plan", "As built"], ["double", "NVLink Switch across racks (2× island, est.)"]] },
  { key: "specDecodeMult", label: "Speculative decoding", help: "A draft model guesses tokens the big model checks in one pass.", options: [[1, "Off"], [1.5, "1.5×"], [2, "2×"], [2.5, "2.5×"]] },
]

/** Keep only known dials with one of their listed values. */
export function sanitiseTuning(tuning = {}) {
  const out = {}
  for (const lever of ARCHITECT_LEVERS) {
    if (!tuning || !(lever.key in tuning)) continue
    const hit = lever.options.find(([value]) => value === tuning[lever.key])
    if (hit) out[lever.key] = hit[0]
  }
  return out
}

/** Token Efficiency Calculator inputs for the team's plan as it stands. */
export function baseInputs(team) {
  const ch = resolveChoices(team?.choices)
  const platform = pickedOption("platform", ch)
  const hall = pickedOption("hall", ch)
  const loc = pickedOption("location", ch)
  const tgp = pickedOption("tgp", ch)
  const tier = platform.hbmTiers.includes(ch.hbm) ? C.byId(C.HBM_TIERS, ch.hbm) : C.byId(C.HBM_TIERS, platform.hbmTiers[0]) || null
  const cloud = ch.deploy !== "own" && platform.cloudRate
  const precision = ["bf16", "fp8", "int8"].includes(ch.precision) ? ch.precision : "bf16"
  return {
    ...TOKENOMICS_PRESETS.workloads.strategy,
    ...MODELS[ch.modelSize],
    racks: Math.max(1, ch.racks),
    gpusPerRack: platform.gpusPerRack,
    hbmGB: tier ? tier.gb : platform.hbmGB,
    hbmTBs: tier ? tier.tbs : platform.hbmTBs,
    pflopsDense: platform.pflops,
    nvlinkDomain: Math.max(1, platform.nvlink),
    rackKW: platform.rackKW || 1,
    rackCapex: cloud ? 10_000 : platform.capex,
    otherHourly: cloud ? ch.racks * platform.gpusPerRack * platform.cloudRate : 0,
    tokPerGpu: platform.tokPerGpu,
    nativePrecision: FP4_NATIVE.has(platform.id) ? "fp4" : "fp8",
    precision,
    powerCap: tgp.power,
    kvTier: ch.kv === "on",
    continuousBatching: false,
    batchCap: 32,
    specDecodeMult: 1,
    pue: hall.pue,
    powerMWh: loc.mwh,
    demandTps: C.AI_DEMAND_TOKS,
  }
}

function applyTuning(base, tuning) {
  const t = sanitiseTuning(tuning)
  const out = { ...base }
  for (const key of ["precision", "batchCap", "continuousBatching", "kvTier", "kvCapture", "powerCap", "specDecodeMult"]) if (key in t) out[key] = t[key]
  if (t.hbm && t.hbm !== "plan") {
    const tier = C.byId(C.HBM_TIERS, t.hbm)
    if (tier && tier.gb >= base.hbmGB) Object.assign(out, { hbmGB: tier.gb, hbmTBs: Math.max(base.hbmTBs, tier.tbs) })
  }
  if (t.interconnect === "double") out.nvlinkDomain = base.nvlinkDomain * 2
  return out
}

const goodOf = (r) => (Number.isFinite(r.goodput) ? r.goodput : 0)

/** Base vs tuned calculator runs and the gain the race uses. */
export function architectReport(team, tuning = {}) {
  const baseIn = baseInputs(team)
  const base = computeTokenomics(baseIn)
  const tuned = computeTokenomics(applyTuning(baseIn, tuning))
  const b = goodOf(base)
  const t = goodOf(tuned)
  const raw = b > 0 ? t / b : t > 0 ? GAIN_RANGE[1] : 1
  const gain = Math.round(Math.min(GAIN_RANGE[1], Math.max(GAIN_RANGE[0], raw)) * 100) / 100
  const view = (r) => ({ tokPerS: r.tokPerS, goodput: r.goodput, costPerM: r.costPerM, joulesPerToken: r.joulesPerToken, whPerMTokens: r.whPerMTokens, bottleneck: r.bottleneck, coverage: r.coverage })
  return { base: view(base), tuned: view(tuned), gain, lessons: tuned.lessons.slice(0, 3) }
}
