/**
 * Token Efficiency Calculator: a portable, dependency-free tokenomics model for Podium's Architect
 * mode. One function, `computeTokenomics(inputs)`, turns a hardware + model + workload + efficiency
 * description into tokens per second (per GPU, per rack, per MW), cost per million good tokens,
 * utilisation, time to first token, SLA risk and plain-English lessons.
 *
 * The "model.js:NNN" notes below cite the reference serving model the formulas were ported from.
 * Values marked "game" are teaching estimates, not measurements. Pure: no imports, no I/O.
 */

/* ------------------------------------------------------------------ constants (cited in the spec) */

/** Weights may fill this share of a GPU group's HBM when sizing the group. model.js:269 */
export const HBM_HEADROOM = 0.7
/** Share of HBM usable for weights + KV cache (the rest is activations and fragmentation). model.js:270 */
export const KV_USABLE = 0.9
/** Share of CPU host memory that parks idle KV blocks when there is no KV cache tier. model.js:271 */
export const HOST_KV_SHARE = 0.5
/** Prefill reaches this share of dense peak FLOPS. model.js:272 */
export const PREFILL_EFFICIENCY = 0.35
/** Without a KV cache tier, HBM alone keeps only this share of the reusable prefix. model.js:273 */
export const HBM_ONLY_REUSE = 0.3
/** With the tier on, CPU host memory recovers this share of the prefill the cache still misses. model.js:279 */
export const HOST_PARK_REUSE = 0.6
/** Host parking ramps from nothing at 32k tokens of context to the full share at 64k. model.js:280 */
export const HOST_LONG_CTX = [32000, 64000]
/** A model spilling off its NVLink island keeps this share of its throughput. model.js:281 */
export const SPILL_PENALTY = 0.4
/** A late (SLA-missing) token still counts this much. model.js:282 */
export const LATE_GOODPUT = 0.25
/** Mixture-of-experts: a batch touches about 4 GB per billion active parameters at 1 byte/param. model.js:593 */
export const MOE_READ_FACTOR = 4
/** One request's own upload path tops out near a gigabit (bytes/s). model.js:300 */
export const ACCESS_BPS = 1e9 / 8
/** A single public-internet round trip stalls the serving loop against this reference (s). model.js:1091 */
export const STALL_REF_S = 0.008
/** Mathis bound MSS in bytes (TCP on a lossy path). latency.js:105-112 */
export const MSS_BYTES = 1460
export const HOURS_PER_MONTH = 730
export const HOURS_PER_YEAR = 8760

/**
 * Number formats. `bytes` per parameter (and per KV element) relative to FP8 = 1; `speed` is the
 * compute-side multiplier relative to FP8; `acc` the answer-quality factor. FP8/FP4 byte halving is
 * the reference model's rule (model.js:577-583); bf16/int8 speed and accuracy follow Podium's catalog.js
 * PRECISIONS; the FP4 speed and accuracy are Podium game estimates (Blackwell FP4 dense peak is
 * 2x FP8 on the datasheet; dequantisation and calibration loss take a slice).
 */
export const PRECISIONS = {
  bf16: { label: "BF16 (2 bytes)", bytes: 2, speed: 0.6, acc: 1.0 },
  fp8: { label: "FP8 (1 byte)", bytes: 1, speed: 1.0, acc: 0.985 },
  int8: { label: "INT8 (1 byte)", bytes: 1, speed: 0.95, acc: 0.97 },
  fp4: { label: "FP4 / NVFP4 (0.5 byte)", bytes: 0.5, speed: 1.6, acc: 0.95 },
}

/**
 * GPU power cap: tokens kept against watts drawn (Podium catalog.js TGP_MODES, game values).
 * Linear interpolation between the anchors; inference is memory-bound, so a cap loses little speed.
 */
export const POWER_CAP_CURVE = [
  { power: 0.7, perf: 0.8 },
  { power: 0.85, perf: 0.93 },
  { power: 1.0, perf: 1.0 },
  { power: 1.15, perf: 1.06 },
]

/** Static (non-continuous) batching wastes padded slots: this share of decode survives. Game estimate. */
export const STATIC_BATCH_EFFICIENCY = 0.7
/** Speculative decoding adds draft-model compute: this share of the speed-up is paid back in compute. Game estimate. */
export const SPEC_DECODE_OVERHEAD = 0.15

/* ------------------------------------------------------------------ defaults and field catalogue */

/**
 * Defaults describe two HGX H200 racks (32 GPUs) serving a 70B dense model to a customer-chat
 * crowd at FP8 with no KV cache tier: a sound, unoptimised starting point an Architect can improve.
 */
export const TOKENOMICS_DEFAULTS = Object.freeze({
  // hardware
  racks: 2,
  gpusPerRack: 16,
  hbmGB: 141,
  hbmTBs: 4.8,
  pflopsDense: 2,
  nvlinkDomain: 8,
  rackKW: 22,
  rackCapex: 700_000,
  hostMemTB: 4,
  tokPerGpu: 4200,
  nativePrecision: "fp8",
  // model
  paramsB: 70,
  activeB: 70,
  moe: false,
  kvMBPerTok: 0.16,
  precision: "fp8",
  // workload
  ctxTokens: 4000,
  outTokens: 300,
  targetTps: 30,
  ttftTargetS: 0.6,
  reuse: 0.5,
  activeShare: 0.3,
  demandTps: 20_000,
  bytesPerToken: 40,
  quality: 1,
  // memory and cache
  kvTier: false,
  kvCapture: null,
  hostPark: "none",
  // efficiency levers
  continuousBatching: true,
  batchCap: 0,
  specDecodeMult: 1,
  powerCap: 1,
  throttle: 1,
  // facility and money
  pue: 1.29,
  powerMWh: 100,
  kwMonth: 0,
  amortYears: 3,
  otherHourly: 0,
  // network
  netRttMs: 20,
  jitterMs: 2,
  loss: 0,
  publicInternet: false,
  tripsPerRequest: 0,
  handoffRttMs: 0,
  retrievalS: 0,
  pipeGbps: 10,
})

/**
 * One entry per input so a form can be generated: key, label, unit, min, max, step, help, plus
 * `group` (section), `type` ("number" | "boolean" | "select") and `options` for selects.
 * `architect: true` marks the levers an invited Architect may unlock (spec section 6).
 */
export const TOKENOMICS_FIELDS = [
  // hardware
  { key: "racks", group: "Hardware", label: "Racks", unit: "racks", min: 1, max: 40, step: 1, type: "number", help: "How many GPU racks are built. Every rack costs capital and power whether or not the crowd needs it." },
  { key: "gpusPerRack", group: "Hardware", label: "GPUs per rack", unit: "GPUs", min: 1, max: 72, step: 1, type: "number", help: "16 for two 8-GPU air-cooled nodes, 72 for a liquid-cooled NVL72 rack." },
  { key: "hbmGB", group: "Hardware", label: "Memory per GPU", unit: "GB", min: 24, max: 512, step: 1, type: "number", architect: true, help: "The GPU's own fast memory (HBM). Weights load into it once; every active conversation's notes (KV cache) live there too. Too small and the model must be split across more GPUs or fewer people can be served at once." },
  { key: "hbmTBs", group: "Hardware", label: "Memory bandwidth per GPU", unit: "TB/s", min: 0.2, max: 30, step: 0.1, type: "number", architect: true, help: "How fast the GPU can re-read its memory. Generating each token re-reads the weights, so this, not raw maths, usually sets tokens per second." },
  { key: "pflopsDense", group: "Hardware", label: "Dense compute per GPU", unit: "PFLOPS", min: 0.1, max: 100, step: 0.1, type: "number", help: "Peak maths at the GPU's native format, no sparsity. Used for prefill (reading the prompt), which is compute-bound." },
  { key: "nvlinkDomain", group: "Hardware", label: "GPUs per NVLink island", unit: "GPUs", min: 1, max: 576, step: 1, type: "number", architect: true, help: "How many GPUs share one fast interconnect. A model that needs more GPUs than this spills onto slower links and loses most of its speed." },
  { key: "rackKW", group: "Hardware", label: "IT power per rack", unit: "kW", min: 1, max: 300, step: 0.5, type: "number", help: "Datasheet power of the nodes plus the top-of-rack switch. The hall's PUE turns it into power at the meter." },
  { key: "rackCapex", group: "Hardware", label: "Price per rack", unit: "$", min: 10_000, max: 20_000_000, step: 10_000, type: "number", help: "What one rack costs to buy (estimate, not a quote). Amortised over the horizon into every token's cost." },
  { key: "hostMemTB", group: "Hardware", label: "CPU host memory per rack", unit: "TB", min: 0, max: 64, step: 0.5, type: "number", help: "Ordinary server memory beside the GPUs. Half of it can park idle conversations when there is no KV cache tier." },
  { key: "tokPerGpu", group: "Hardware", label: "Compute-side tokens per GPU (70B anchor)", unit: "tok/s", min: 10, max: 200_000, step: 10, type: "number", help: "Calibrated tokens per second one GPU of this type produces for a 70B model when memory is not the limit (game estimate at the native format). Bigger models scale this down." },
  { key: "nativePrecision", group: "Hardware", label: "Native number format", unit: "", min: 0, max: 0, step: 0, type: "select", options: ["bf16", "fp8", "int8", "fp4"], help: "The format the compute figures above are quoted at. Hopper is FP8; Blackwell and Rubin are FP4." },
  // model
  { key: "paramsB", group: "Model", label: "Model size", unit: "B params", min: 1, max: 2000, step: 1, type: "number", help: "Total parameters in billions. At one byte each (FP8) a 70B model is 70 GB of weights that must sit in GPU memory." },
  { key: "activeB", group: "Model", label: "Active parameters per token", unit: "B params", min: 1, max: 2000, step: 1, type: "number", help: "The parameters used for each token. Equal to the model size for a dense model; a fraction for a mixture-of-experts model." },
  { key: "moe", group: "Model", label: "Mixture of experts", unit: "", min: 0, max: 1, step: 1, type: "boolean", help: "Only some experts fire per token, so the maths is cheaper, but every expert is read somewhere in a batch: it wants a 72-GPU island." },
  { key: "kvMBPerTok", group: "Model", label: "KV cache per token", unit: "MB", min: 0.01, max: 2, step: 0.01, type: "number", help: "Memory the model's notes take per token of context at one byte per element. 0.16 MB for a 70B grouped-query model; 0.07 MB for a latent-attention MoE." },
  { key: "precision", group: "Model", label: "Number format", unit: "", min: 0, max: 0, step: 0, type: "select", options: ["bf16", "fp8", "int8", "fp4"], architect: true, help: "Smaller numbers mean fewer bytes per weight and per note, so more fits and every token re-reads less. FP4 halves FP8 again on Blackwell-class GPUs at a small accuracy cost." },
  // workload
  { key: "ctxTokens", group: "Workload", label: "Context per request", unit: "tokens", min: 128, max: 1_000_000, step: 128, type: "number", help: "Prompt plus history the model reads before it answers. Long contexts fill memory and take longer to read." },
  { key: "outTokens", group: "Workload", label: "Answer length", unit: "tokens", min: 1, max: 100_000, step: 1, type: "number", help: "Tokens generated per answer. Long answers amortise the prompt read; short ones make prefill dominate." },
  { key: "targetTps", group: "Workload", label: "Stream speed people expect", unit: "tok/s per user", min: 1, max: 500, step: 1, type: "number", help: "How fast one answer should appear. A faster target means fewer people share each GPU." },
  { key: "ttftTargetS", group: "Workload", label: "First-word target", unit: "s", min: 0.01, max: 60, step: 0.01, type: "number", help: "Time to first token people will tolerate. Prefill, lookups and network round trips all sit inside it." },
  { key: "reuse", group: "Workload", label: "Context reuse between turns", unit: "share", min: 0, max: 1, step: 0.01, type: "number", help: "Share of each prompt the model has already seen (the earlier chat, a system prompt, a repo). Reusable context is what a KV cache can skip." },
  { key: "activeShare", group: "Workload", label: "Sessions active at once", unit: "share", min: 0.01, max: 1, step: 0.01, type: "number", help: "Share of open sessions generating at any moment; the rest are idle and can be parked in host memory." },
  { key: "demandTps", group: "Workload", label: "Crowd demand", unit: "tok/s", min: 0, max: 50_000_000, step: 100, type: "number", help: "Tokens per second the whole crowd needs at peak. Capacity above this is idle silicon; below it, people wait." },
  { key: "bytesPerToken", group: "Workload", label: "Bytes on the wire per token", unit: "bytes", min: 1, max: 4096, step: 1, type: "number", help: "Network bytes each token carries (text and protocol). Sets how many tokens a pipe can move." },
  { key: "quality", group: "Workload", label: "Answer grounding", unit: "factor", min: 0.1, max: 1.5, step: 0.01, type: "number", help: "How well-grounded the answers are (1 = fully fed by the right data). Scales good tokens, not raw tokens." },
  // memory and cache
  { key: "kvTier", group: "Memory & cache", label: "KV cache tier", unit: "", min: 0, max: 1, step: 1, type: "boolean", architect: true, help: "A fast memory tier that parks the GPU's notes between turns and reloads them, so a follow-up skips re-reading the prompt." },
  { key: "kvCapture", group: "Memory & cache", label: "Cache hit on reusable context", unit: "share", min: 0, max: 1, step: 0.01, type: "number", architect: true, help: "Share of the reusable context the cache really serves. Blank = automatic (30% from GPU memory alone, 100% with the tier). An Architect can tune prefix caching, eviction and routing to raise it." },
  { key: "hostPark", group: "Memory & cache", label: "CPU host memory for long contexts", unit: "", min: 0, max: 0, step: 0, type: "select", options: ["none", "grace"], architect: true, help: "Grace-class hosts keep a big CPU memory pool beside the GPUs. With the KV tier on, contexts past 32k tokens skip even more prefill (full effect at 64k)." },
  // efficiency levers
  { key: "continuousBatching", group: "Efficiency levers", label: "Continuous batching", unit: "", min: 0, max: 1, step: 1, type: "boolean", architect: true, help: "The scheduler slots new requests in as others finish instead of waiting for a whole batch. Off, padded slots waste about 30% of decode." },
  { key: "batchCap", group: "Efficiency levers", label: "Max concurrent streams per model copy", unit: "streams", min: 0, max: 4096, step: 1, type: "number", architect: true, help: "A hard cap on how many answers one model copy generates at once. 0 = no cap (memory and speed decide). A low cap leaves GPU memory idle." },
  { key: "specDecodeMult", group: "Efficiency levers", label: "Speculative decoding speed-up", unit: "x", min: 1, max: 3, step: 0.05, type: "number", architect: true, help: "A small draft model guesses several tokens that the big model checks in one pass: more tokens per weight read. Realistic 1.5x to 2.5x on memory-bound decode; it costs some compute." },
  { key: "powerCap", group: "Efficiency levers", label: "GPU power cap", unit: "x datasheet", min: 0.7, max: 1.15, step: 0.05, type: "number", architect: true, help: "Board power as a share of the datasheet. 0.85 keeps about 93% of the tokens for 85% of the watts; 1.15 is max boost (+6% tokens, needs liquid cooling)." },
  { key: "throttle", group: "Efficiency levers", label: "Cooling / power throttle", unit: "share", min: 0, max: 1, step: 0.01, type: "number", help: "Share of full speed the hall allows (1 = none). Feed the value your cooling or power-contract model produces." },
  // facility and money
  { key: "pue", group: "Facility & money", label: "PUE", unit: "ratio", min: 1.0, max: 2.0, step: 0.01, type: "number", architect: true, help: "Total facility power over IT power. 1.38 open air, 1.29 cold-aisle containment, 1.28 rear-door, 1.20 direct liquid (game values; 1.38 is a published portfolio figure)." },
  { key: "powerMWh", group: "Facility & money", label: "Energy price", unit: "$/MWh", min: 0, max: 500, step: 1, type: "number", help: "What a megawatt-hour costs at this metro (estimate)." },
  { key: "kwMonth", group: "Facility & money", label: "Power reservation", unit: "$/kW-month", min: 0, max: 100, step: 1, type: "number", help: "The charge for holding contracted power whether or not it is drawn. 0 to ignore." },
  { key: "amortYears", group: "Facility & money", label: "Amortisation horizon", unit: "years", min: 1, max: 7, step: 0.5, type: "number", help: "Years the capital is spread over. Three years is the default." },
  { key: "otherHourly", group: "Facility & money", label: "Other running cost", unit: "$/h", min: 0, max: 100_000, step: 1, type: "number", help: "Network, storage, support and anything else billed per hour." },
  // network
  { key: "netRttMs", group: "Network", label: "User round trip", unit: "ms", min: 0, max: 1000, step: 1, type: "number", help: "Network round trip between the user and the GPUs. Fibre is about 4.9 µs per km of route, each way." },
  { key: "jitterMs", group: "Network", label: "Jitter", unit: "ms", min: 0, max: 500, step: 1, type: "number", help: "How much the round trip wobbles. Jitter is what makes a first-word target miss some of the time." },
  { key: "loss", group: "Network", label: "Packet loss", unit: "share", min: 0, max: 0.05, step: 0.0005, type: "number", help: "Share of packets lost. Even 0.5% stalls TCP streams and caps the pipe on an interactive path." },
  { key: "publicInternet", group: "Network", label: "Users arrive over the public internet", unit: "", min: 0, max: 1, step: 1, type: "boolean", help: "Public transit inflates the route, hops through several networks and drops packets, so the serving loop stalls while it waits." },
  { key: "tripsPerRequest", group: "Network", label: "Lookups / tool calls per request", unit: "trips", min: 0, max: 50, step: 1, type: "number", help: "Round trips to data or tools before and during an answer. Each one holds a GPU slot idle for a round trip." },
  { key: "handoffRttMs", group: "Network", label: "Round trip per lookup", unit: "ms", min: 0, max: 1000, step: 1, type: "number", help: "Round trip of the data or tool path. 0 = same as the user round trip." },
  { key: "retrievalS", group: "Network", label: "Retrieval time", unit: "s", min: 0, max: 10, step: 0.01, type: "number", help: "Time the app spends finding passages before the GPU starts (an index: ~0.08 s; scanning files: ~0.6 s; no shared data for a RAG job: 2.5 s)." },
  { key: "pipeGbps", group: "Network", label: "Pipe to the users", unit: "Gbps", min: 0.05, max: 1000, step: 0.05, type: "number", help: "Bandwidth of the users' path. Tokens are small, but a thin or lossy pipe still caps a big crowd." },
]

/** Hardware presets (public datasheet memory/bandwidth/PFLOPS; rack price, power and tokens per GPU are game estimates). */
export const TOKENOMICS_PRESETS = {
  hardware: {
    l40s: { name: "L40S server x2 (16 GPUs)", gpusPerRack: 16, hbmGB: 48, hbmTBs: 0.864, pflopsDense: 0.73, nvlinkDomain: 8, rackKW: 9, rackCapex: 160_000, hostMemTB: 4, tokPerGpu: 750, nativePrecision: "fp8" },
    rtx6000: { name: "RTX PRO 6000 server x2 (16 GPUs)", gpusPerRack: 16, hbmGB: 96, hbmTBs: 1.6, pflopsDense: 2, nvlinkDomain: 8, rackKW: 14, rackCapex: 240_000, hostMemTB: 4, tokPerGpu: 2200, nativePrecision: "fp4" },
    h100: { name: "HGX H100 x2 (16 GPUs)", gpusPerRack: 16, hbmGB: 80, hbmTBs: 3.35, pflopsDense: 2, nvlinkDomain: 8, rackKW: 22, rackCapex: 600_000, hostMemTB: 4, tokPerGpu: 3000, nativePrecision: "fp8" },
    h200: { name: "HGX H200 x2 (16 GPUs)", gpusPerRack: 16, hbmGB: 141, hbmTBs: 4.8, pflopsDense: 2, nvlinkDomain: 8, rackKW: 22, rackCapex: 700_000, hostMemTB: 4, tokPerGpu: 4200, nativePrecision: "fp8" },
    b200: { name: "HGX B200 x2 (16 GPUs)", gpusPerRack: 16, hbmGB: 180, hbmTBs: 8, pflopsDense: 9, nvlinkDomain: 8, rackKW: 30, rackCapex: 950_000, hostMemTB: 4, tokPerGpu: 11000, nativePrecision: "fp4" },
    b300: { name: "HGX B300 x2 (16 GPUs)", gpusPerRack: 16, hbmGB: 288, hbmTBs: 8, pflopsDense: 14, nvlinkDomain: 8, rackKW: 30, rackCapex: 1_150_000, hostMemTB: 4, tokPerGpu: 15000, nativePrecision: "fp4" },
    gb200: { name: "GB200 NVL72", gpusPerRack: 72, hbmGB: 186, hbmTBs: 8, pflopsDense: 10, nvlinkDomain: 72, rackKW: 132, rackCapex: 3_200_000, hostMemTB: 17, tokPerGpu: 12500, nativePrecision: "fp4" },
    gb300: { name: "GB300 NVL72", gpusPerRack: 72, hbmGB: 288, hbmTBs: 8, pflopsDense: 15, nvlinkDomain: 72, rackKW: 142, rackCapex: 4_200_000, hostMemTB: 17, tokPerGpu: 17500, nativePrecision: "fp4" },
    vr: { name: "Vera Rubin NVL72", gpusPerRack: 72, hbmGB: 288, hbmTBs: 20, pflopsDense: 35, nvlinkDomain: 72, rackKW: 210, rackCapex: 6_500_000, hostMemTB: 54, tokPerGpu: 42000, nativePrecision: "fp4" },
  },
  models: {
    "70b": { name: "70B dense", paramsB: 70, activeB: 70, moe: false, kvMBPerTok: 0.16 },
    "100b": { name: "100B dense", paramsB: 100, activeB: 100, moe: false, kvMBPerTok: 0.2 },
    "650b": { name: "650B mixture-of-experts (37B active)", paramsB: 671, activeB: 37, moe: true, kvMBPerTok: 0.07 },
  },
  workloads: {
    chat: { name: "Customer chat", ctxTokens: 4000, outTokens: 300, targetTps: 30, ttftTargetS: 0.6, reuse: 0.5, activeShare: 0.3, bytesPerToken: 40, tripsPerRequest: 0, retrievalS: 0 },
    rag: { name: "Knowledge assistant (RAG)", ctxTokens: 16000, outTokens: 400, targetTps: 25, ttftTargetS: 1.5, reuse: 0.3, activeShare: 0.6, bytesPerToken: 500, tripsPerRequest: 2, retrievalS: 0.08 },
    code: { name: "Coding agent", ctxTokens: 64000, outTokens: 800, targetTps: 60, ttftTargetS: 3, reuse: 0.8, activeShare: 0.35, bytesPerToken: 180, tripsPerRequest: 8, retrievalS: 0.3 },
    research: { name: "Deep research", ctxTokens: 32000, outTokens: 4000, targetTps: 40, ttftTargetS: 5, reuse: 0.4, activeShare: 0.6, bytesPerToken: 160, tripsPerRequest: 10, retrievalS: 0.08 },
    strategy: { name: "Race-strategy what-ifs", ctxTokens: 12000, outTokens: 200, targetTps: 40, ttftTargetS: 0.5, reuse: 0.7, activeShare: 0.5, bytesPerToken: 60, tripsPerRequest: 1, retrievalS: 0.05 },
    robot: { name: "Real-time control", ctxTokens: 512, outTokens: 64, targetTps: 80, ttftTargetS: 0.05, reuse: 0.55, activeShare: 0.4, bytesPerToken: 48, tripsPerRequest: 0, retrievalS: 0 },
  },
}

/* ------------------------------------------------------------------ helpers */

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/** Tokens kept at a power cap, interpolated along POWER_CAP_CURVE (flat beyond the ends). */
export function powerCapPerf(power) {
  const curve = POWER_CAP_CURVE
  const p = clamp(num(power, 1), curve[0].power, curve[curve.length - 1].power)
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]
    const b = curve[i]
    if (p <= b.power) return a.perf + ((b.perf - a.perf) * (p - a.power)) / (b.power - a.power)
  }
  return curve[curve.length - 1].perf
}

/** GPUs one copy of the model needs: 8-GPU nodes double until the weights fit; a MoE wants the whole 72-GPU island. model.js:626-632 */
export function groupSize({ weightsGB, hbmGB, nvlinkDomain, moe }) {
  const need = Math.ceil(weightsGB / (hbmGB * HBM_HEADROOM))
  let size = nvlinkDomain < 8 ? 1 : 8
  while (size < need) size *= 2
  if (moe && nvlinkDomain >= 72) return Math.max(size, nvlinkDomain)
  return size
}

/** Share of the missed prefill that CPU host memory recovers at this context length. model.js:316-321 */
export function hostParkShare(ctxTokens, hostPark, kvTier) {
  if (!kvTier || hostPark !== "grace") return 0
  const [from, to] = HOST_LONG_CTX
  return HOST_PARK_REUSE * clamp((ctxTokens - from) / (to - from), 0, 1)
}

/** Resolve an inputs object over the defaults, coercing types and dropping unknown keys. */
export function resolveInputs(inputs = {}) {
  const out = { ...TOKENOMICS_DEFAULTS }
  for (const field of TOKENOMICS_FIELDS) {
    if (!(field.key in inputs) || inputs[field.key] === undefined) continue
    const raw = inputs[field.key]
    if (field.type === "boolean") out[field.key] = raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "on"
    else if (field.type === "select") out[field.key] = field.options.includes(raw) ? raw : TOKENOMICS_DEFAULTS[field.key]
    else if (field.key === "kvCapture") out[field.key] = raw === null || raw === "" ? null : clamp(num(raw, 0), 0, 1)
    else out[field.key] = clamp(num(raw, TOKENOMICS_DEFAULTS[field.key]), field.min, field.max)
  }
  return out
}

/* ------------------------------------------------------------------ the calculator */

/**
 * Evaluate one configuration. Returns an object of numbers plus `lessons` (strings) and
 * `bottleneck` (one word). Never throws on odd input: impossible builds come back with
 * `fits`/`runs` false and zero throughput, and say why in `lessons`.
 */
export function computeTokenomics(inputs = {}) {
  const i = resolveInputs(inputs)
  const prec = PRECISIONS[i.precision]
  const native = PRECISIONS[i.nativePrecision]
  const precSpeed = prec.speed / native.speed
  const tgpPerf = powerCapPerf(i.powerCap)
  const lessons = []

  /* -------- memory: weights, KV per stream, GPUs per model copy. model.js:577-583, 590-600, 626-632 */
  const weightsGB = i.paramsB * prec.bytes
  const kvPerStreamGB = (i.ctxTokens * i.kvMBPerTok * prec.bytes) / 1000
  const group = groupSize({ weightsGB, hbmGB: i.hbmGB, nvlinkDomain: i.nvlinkDomain, moe: i.moe })
  const gpus = i.racks * i.gpusPerRack
  const fits = group <= i.nvlinkDomain
  const fitMult = fits ? 1 : SPILL_PENALTY
  const instances = Math.floor(gpus / group)
  const extraKW = (i.kvTier ? 10 : 0) + (i.hostPark === "grace" ? 12 : 0)
  const extraCapex = (i.kvTier ? 250_000 : 0) + (i.hostPark === "grace" ? 450_000 : 0)
  const itKW = i.racks * i.rackKW * i.powerCap + extraKW
  const facilityKW = itKW * i.pue
  const capex = i.racks * i.rackCapex + extraCapex
  const amortHour = capex / (i.amortYears * HOURS_PER_YEAR)
  const powerHour = facilityKW * (i.powerMWh / 1000) + facilityKW * (i.kwMonth / HOURS_PER_MONTH)
  const hourlyCost = amortHour + powerHour + i.otherHourly

  const base = {
    inputs: i,
    gpus,
    group,
    instances,
    fits,
    runs: false,
    weightsGB,
    kvPerStreamGB,
    precision: i.precision,
    precisionAccuracy: prec.acc,
    itKW,
    facilityKW,
    capex,
    hourlyCost,
    amortHour,
    powerHour,
    tokPerS: 0,
    goodput: 0,
    costPerM: Infinity,
    lessons,
  }
  if (instances < 1) {
    lessons.push(`The ${i.paramsB}B model needs ${group} GPUs just to load at ${prec.label}; ${gpus} GPUs cannot hold a copy, so nothing comes out. Add racks, pick GPUs with more memory, or use a smaller number format.`)
    return { ...base, bottleneck: "fit", streamsPerInstance: 0, batchSize: 0, streamTps: 0 }
  }
  if (!fits) lessons.push(`One copy needs ${group} GPUs but only ${i.nvlinkDomain} share an NVLink island: the model spills onto slower links and keeps ${Math.round(SPILL_PENALTY * 100)}% of its speed. A 72-GPU rack, more memory per GPU or a smaller format would hold it whole.`)

  /* -------- decode roofline: every step re-reads the weights plus every active stream's KV. model.js:590-619 */
  const bandwidthGBs = group * i.hbmTBs * 1000
  const readGB = i.moe ? Math.min(weightsGB, i.activeB * MOE_READ_FACTOR * prec.bytes) : weightsGB
  const hbmStreamCapacity = Math.max(0, group * i.hbmGB * KV_USABLE - weightsGB) / kvPerStreamGB
  const parkedStreams = i.kvTier ? Infinity : (i.racks * i.hostMemTB * 1000 * HOST_KV_SHARE) / instances / kvPerStreamGB
  const byMemory = Math.min(hbmStreamCapacity, i.activeShare * (hbmStreamCapacity + parkedStreams))
  const bySpeed = Math.max(0, (bandwidthGBs / i.targetTps - readGB) / kvPerStreamGB)
  let streams = Math.min(byMemory, bySpeed)
  const batchCap = i.continuousBatching ? i.batchCap : i.batchCap || 8
  const batchLimited = batchCap > 0 && streams > batchCap
  if (batchLimited) streams = batchCap
  let slow = false
  let streamTps
  let decodeTps
  if (streams < 1) {
    if (byMemory >= 1 && readGB > 0) {
      slow = true
      streams = 1
      const stepS = (readGB + kvPerStreamGB) / bandwidthGBs
      streamTps = i.specDecodeMult / stepS
      decodeTps = instances * streamTps
      lessons.push(`This memory streams one answer at about ${streamTps.toFixed(1)} tokens a second, below the ${i.targetTps} people expect: a developer's box, not a crowd server. Faster memory (HBM) is the fix, not more maths.`)
    } else {
      streams = 0
      streamTps = 0
      decodeTps = 0
      lessons.push("The weights fit but no conversation's notes do: context is too long for this memory. Shorten the context, use a smaller format, or pick GPUs with more memory.")
    }
  } else {
    const stepS = (readGB + streams * kvPerStreamGB) / bandwidthGBs
    streamTps = i.specDecodeMult / stepS
    decodeTps = instances * streams * streamTps
  }
  if (!i.continuousBatching) decodeTps *= STATIC_BATCH_EFFICIENCY
  decodeTps *= fitMult
  const batchSize = streams
  const parkedOnHost = !i.kvTier && byMemory > hbmStreamCapacity * i.activeShare * 1.01

  /* -------- compute side: calibrated tokens per GPU scaled by model size, island and format. model.js:1046-1049 */
  const domainMult = i.moe ? (i.nvlinkDomain >= 72 ? 1.5 : 0.75) : 1
  const sizeMult = Math.pow(70 / i.activeB, 0.6)
  const specOverhead = 1 / (1 + SPEC_DECODE_OVERHEAD * (i.specDecodeMult - 1))
  const computeTps = instances * group * i.tokPerGpu * sizeMult * domainMult * fitMult * precSpeed * specOverhead

  /* -------- prefill: compute-bound at 35% of dense peak, 2 FLOPs per active parameter per token. model.js:1059 */
  const prefillRate = (group * i.pflopsDense * 1e15 * PREFILL_EFFICIENCY * precSpeed) / (2 * i.activeB * 1e9)
  const hostPark = hostParkShare(i.ctxTokens, i.hostPark, i.kvTier)
  const capture = i.kvCapture === null ? (i.kvTier ? 1 : HBM_ONLY_REUSE) : i.kvCapture
  const hit = i.kvTier ? i.reuse * capture + (1 - i.reuse) * hostPark : i.reuse * capture
  const prefillPerOutput = (i.ctxTokens * (1 - hit)) / i.outTokens
  const decodeRate = Math.min(computeTps, decodeTps)
  const prefillTotal = instances * prefillRate * fitMult
  const blended = decodeRate > 0 ? 1 / (1 / decodeRate + prefillPerOutput / prefillTotal) : 0
  const prefillShare = decodeRate > 0 ? (prefillPerOutput / prefillTotal) / (1 / decodeRate + prefillPerOutput / prefillTotal) : 0
  /* The power cap and any hall throttle scale the racks' blended rate once (Podium catalog.js TGP_MODES). */
  const rackCapacity = blended * tgpPerf * i.throttle
  const memoryBound = decodeTps < computeTps

  /* -------- the wire: public stalls and drops, a thin pipe, and hand-offs that hold a slot idle. model.js:1086-1119, 714-751 */
  const rttS = i.netRttMs / 1000
  const jitterS = i.jitterMs / 1000
  const trips = Math.max(0, Math.round(i.tripsPerRequest))
  const handoffRttS = (i.handoffRttMs > 0 ? i.handoffRttMs : i.netRttMs) / 1000
  const interactive = i.ttftTargetS <= 2 || trips > 0
  let throughput = rackCapacity
  if (i.publicInternet && interactive) {
    const stall = 1 / (1 + rttS / STALL_REF_S)
    const drop = Math.max(0.05, Math.pow(1 - i.loss, 1 + trips))
    throughput *= stall * drop
  } else if (i.publicInternet) {
    throughput *= 1 - i.loss
  }
  const nominalBps = (i.pipeGbps * 1e9 * (1 - i.loss)) / 8
  const mathis = i.loss > 0 ? MSS_BYTES / (Math.max(rttS, 0.001) * Math.sqrt(i.loss)) : Infinity
  const bytesPerSec = interactive && i.loss > 0 ? Math.min(nominalBps, Math.max(mathis, nominalBps * 0.05)) : nominalBps
  const capTok = bytesPerSec / i.bytesPerToken
  const bandwidthCapped = throughput > capTok
  if (bandwidthCapped) throughput = capTok
  const genS = streamTps > 0 ? i.outTokens / streamTps : 0
  const waitS = trips * handoffRttS
  const handoffIdle = waitS > 0 && genS + waitS > 0 ? Math.min(1, waitS / (genS + waitS)) : 0
  throughput *= 1 - handoffIdle
  const tokPerS = throughput

  /* -------- demand, utilisation, first token and the SLA. model.js:1121-1189 */
  const served = Math.min(tokPerS, i.demandTps)
  const coverage = i.demandTps > 0 ? Math.min(1, served / i.demandTps) : 1
  const utilisation = rackCapacity > 0 ? Math.min(1, i.demandTps / rackCapacity) : 1
  const queue = 1 + 3 * Math.pow(utilisation, 3)
  const prefillS = prefillRate > 0 ? (i.ctxTokens * (1 - hit)) / (prefillRate * fitMult) : Infinity
  const ingestS = (i.ctxTokens * i.bytesPerToken) / Math.min(ACCESS_BPS, bytesPerSec > 0 ? bytesPerSec : ACCESS_BPS)
  /* Every leg's round trip sits inside the first token: the user's, then each lookup or tool trip on its own path. model.js:714-728, 1137 */
  const netWaitS = rttS + trips * handoffRttS
  let ttftS = prefillS * queue + i.retrievalS + netWaitS + ingestS
  if (i.hostPark === "grace" && i.kvTier) ttftS *= 0.9
  const ttftHi = ttftS + jitterS
  const ttftLo = Math.max(0, ttftS - jitterS)
  let pMiss = 0
  if (ttftHi > i.ttftTargetS) pMiss = ttftLo >= i.ttftTargetS ? 1 : (ttftHi - i.ttftTargetS) / Math.max(1e-9, ttftHi - ttftLo)
  const slaMet = pMiss < 0.5 && !slow
  const slaFactor = 1 - pMiss * (1 - LATE_GOODPUT)
  const goodput = served * i.quality * prec.acc * slaFactor

  /* -------- power and money per token. model.js:1232-1294 */
  const tokPerMW = facilityKW > 0 ? goodput / (facilityKW / 1000) : 0
  const joulesPerToken = tokPerS > 0 ? (facilityKW * 1000) / tokPerS : Infinity
  const whPerMTokens = Number.isFinite(joulesPerToken) ? (joulesPerToken * 1e6) / 3600 : Infinity
  const costPerM = goodput > 0 ? (hourlyCost * 1e6) / (goodput * 3600) : Infinity
  const costPerMRaw = tokPerS > 0 ? (hourlyCost * 1e6) / (tokPerS * 3600) : Infinity
  const costPerMCapacity = rackCapacity > 0 ? (hourlyCost * 1e6) / (rackCapacity * 3600) : Infinity

  /* -------- lessons (plain English, brand-neutral) */
  if (slow) {
    /* already explained above */
  } else if (memoryBound) {
    lessons.push(`Decode is memory-bound: each token re-reads ${readGB.toFixed(0)} GB of weights plus ${(batchSize * kvPerStreamGB).toFixed(0)} GB of notes at ${(bandwidthGBs / 1000).toFixed(1)} TB/s per model copy. Faster memory, a smaller number format or a KV cache add tokens; more FLOPS do not.`)
  } else {
    lessons.push("Decode is compute-bound here: memory bandwidth has headroom, so a faster chip (or FP4) adds tokens.")
  }
  if (batchLimited) lessons.push(`A cap of ${batchCap} streams per model copy leaves memory for ${Math.floor(Math.min(byMemory, bySpeed))} unused. ${i.continuousBatching ? "Raise the cap" : "Continuous batching"} would serve more people from the same GPUs.`)
  if (!i.continuousBatching) lessons.push(`Static batching pads every batch to its slowest request: about ${Math.round((1 - STATIC_BATCH_EFFICIENCY) * 100)}% of decode is wasted.`)
  if (!i.kvTier && i.reuse >= 0.4 && prefillShare >= 0.3) lessons.push(`GPUs spend ${Math.round(prefillShare * 100)}% of their time re-reading context they have already seen. A KV cache tier would let them skip that re-read.`)
  if (i.kvTier && i.reuse < 0.1) lessons.push("A KV cache tier for prompts that are never repeated: parked notes nobody reloads, cost and power for nothing.")
  if (i.hostPark === "grace" && i.ctxTokens < HOST_LONG_CTX[0]) lessons.push(`CPU host memory parks contexts past ${HOST_LONG_CTX[0].toLocaleString("en-GB")} tokens; these prompts are ${i.ctxTokens.toLocaleString("en-GB")} tokens, so it adds cost and power, not tokens.`)
  if (parkedOnHost) lessons.push("Idle sessions are parked in CPU host memory and re-read when they wake: fine for short chats, slow for long ones.")
  if (i.publicInternet && interactive) lessons.push(`Every public-internet round trip (${i.netRttMs} ms) stalls the serving loop while it waits; a private path keeps the GPUs busy.`)
  if (bandwidthCapped) lessons.push(`The pipe is too thin: ${i.pipeGbps} Gbps at ${i.bytesPerToken} bytes a token carries ${Math.round(capTok).toLocaleString("en-GB")} tokens a second, less than the racks make.`)
  if (handoffIdle >= 0.05) lessons.push(`${trips} lookup or tool trips of ${Math.round(handoffRttS * 1000)} ms hold each answer's GPU slot idle ${Math.round(handoffIdle * 100)}% of the time. Put the data beside the GPUs or shorten the path.`)
  if (!slaMet && !slow) lessons.push(`Time to first token is ${ttftS.toFixed(2)} s against a ${i.ttftTargetS} s target: prefill ${(prefillS * queue).toFixed(2)} s (queue x${queue.toFixed(2)}), retrieval ${i.retrievalS.toFixed(2)} s, network ${netWaitS.toFixed(3)} s, upload ${ingestS.toFixed(3)} s. ${Math.round(pMiss * 100)}% of answers miss.`)
  if (coverage < 0.6 && !slow) lessons.push(`These racks serve ${Math.round(coverage * 100)}% of the crowd at full speed: the rest wait or leave. More racks, a stronger rack, or a cache that frees GPU time would serve them.`)
  if (i.demandTps > 0 && rackCapacity > i.demandTps * 1.6) lessons.push(`You built ${(rackCapacity / i.demandTps).toFixed(1)}x the demand. Idle GPUs still burn power and capital, so every good token costs more.`)
  if (i.powerCap < 1) lessons.push(`A ${Math.round(i.powerCap * 100)}% power cap keeps ${Math.round(tgpPerf * 100)}% of the tokens for ${Math.round(i.powerCap * 100)}% of the watts: inference is memory-bound, so clocks matter less than you think.`)
  if (i.powerCap > 1) lessons.push(`Max boost buys +${Math.round((tgpPerf - 1) * 100)}% tokens for +${Math.round((i.powerCap - 1) * 100)}% watts and hot spots: only worth it with liquid cooling and spare power.`)
  if (i.specDecodeMult > 1) lessons.push(`Speculative decoding checks several guessed tokens per weight read: ${i.specDecodeMult.toFixed(2)}x more tokens per stream for ${Math.round((1 - specOverhead) * 100)}% of the compute.`)
  if (prec.bytes < 1 && i.nativePrecision !== "fp4") lessons.push("This GPU has no native FP4 path: the bytes shrink but the maths does not speed up as much as on Blackwell-class parts.")
  if (i.precision === "bf16") lessons.push("BF16 keeps every bit of accuracy but doubles the bytes of FP8: half the people per GPU and slower tokens. FP8 after calibration loses about 1.5%.")

  const bottleneck = bottleneckFor({ fits, slow, slaMet, bandwidthCapped, served, demand: i.demandTps, throughput: rackCapacity, memoryBound, retrievalS: i.retrievalS, netSlaS: netWaitS + jitterS })

  return {
    ...base,
    runs: decodeRate > 0,
    slow,
    bottleneck,
    memoryBound,
    // memory and batching
    readGB,
    bandwidthGBs,
    hbmStreamCapacity,
    speedStreams: bySpeed,
    parkedStreams: Number.isFinite(parkedStreams) ? parkedStreams : null,
    streamsPerInstance: streams,
    batchSize,
    totalStreams: streams * instances,
    batchLimited,
    parkedOnHost,
    // throughput
    streamTps,
    decodeTps,
    computeTps,
    prefillRatePerInstance: prefillRate,
    prefillTotalTps: prefillTotal,
    hit,
    hostPark,
    prefillShare,
    blendedTps: blended,
    rackCapacityTps: rackCapacity,
    tokPerS,
    tokPerGpu: tokPerS / gpus,
    tokPerRack: tokPerS / i.racks,
    tokPerGpuCapacity: rackCapacity / gpus,
    tokPerRackCapacity: rackCapacity / i.racks,
    // wire
    capTok,
    bandwidthCapped,
    handoffIdle,
    wireLoss: rackCapacity > 0 ? 1 - tokPerS / rackCapacity : 0,
    // demand and SLA
    served,
    coverage,
    utilisation,
    queue,
    prefillS,
    ingestS,
    netWaitS,
    ttftS,
    pMiss,
    slaMet,
    slaFactor,
    goodput,
    // power and money
    tokPerMW,
    joulesPerToken,
    whPerMTokens,
    costPerM,
    costPerMRaw,
    costPerMCapacity,
    powerShareOfCost: hourlyCost > 0 ? powerHour / hourlyCost : 0,
    precSpeed,
    tgpPerf,
  }
}

/** The single word the UI headlines. model.js:1215-1230 */
function bottleneckFor({ fits, slow, slaMet, bandwidthCapped, served, demand, throughput, memoryBound, retrievalS, netSlaS }) {
  if (!fits) return "fit"
  if (slow) return "memory"
  if (!slaMet) {
    if (retrievalS >= 0.8) return "retrieval"
    if (netSlaS >= 0.15) return "network"
    return "ttft"
  }
  if (bandwidthCapped && served < demand * 0.98) return "bandwidth"
  if (demand > 0 && served >= demand) return throughput > demand * 1.6 ? "oversized" : "met"
  return memoryBound ? "memory" : "compute"
}

/* ------------------------------------------------------------------ formatting helpers for a UI */

export function formatTokens(value) {
  if (!Number.isFinite(value)) return "—"
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`
  return String(Math.round(value))
}

export function formatMoney(value, cents = 2) {
  if (!Number.isFinite(value)) return "—"
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`
  if (abs < 10) return `${sign}$${abs.toFixed(cents)}`
  return `${sign}$${Math.round(abs)}`
}

/* ------------------------------------------------------------------ self-check (node tokenomics.js) */

if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const H = TOKENOMICS_PRESETS.hardware
  const M = TOKENOMICS_PRESETS.models
  const W = TOKENOMICS_PRESETS.workloads
  const scenarios = [
    { name: "A. 2x HGX H200, 70B FP8, customer chat, no cache (defaults)", inputs: {} },
    { name: "B. Same racks, Architect levers: KV tier + continuous batching + spec-decode 1.8x + 85% power cap", inputs: { kvTier: true, specDecodeMult: 1.8, powerCap: 0.85 } },
    { name: "C. 2x HGX B200 at FP4 (same crowd)", inputs: { ...H.b200, precision: "fp4", kvTier: true } },
    { name: "D. 1x GB200 NVL72, 650B MoE FP4, coding agents (64k ctx) with KV tier + Grace host memory", inputs: { ...H.gb200, ...M["650b"], ...W.code, racks: 1, precision: "fp4", kvTier: true, hostPark: "grace", demandTps: 150_000, pue: 1.2, netRttMs: 12, handoffRttMs: 6 } },
    { name: "E. 2x HGX H100, 70B FP8, chat over the public internet (60 ms, 0.5% loss)", inputs: { ...H.h100, publicInternet: true, netRttMs: 60, jitterMs: 20, loss: 0.005 } },
    { name: "F. 2x HGX H100, 650B MoE at FP8: does not fit an 8-GPU island", inputs: { ...H.h100, ...M["650b"] } },
  ]
  const line = (label, value) => `  ${label.padEnd(34)} ${value}`
  for (const scenario of scenarios) {
    const r = computeTokenomics(scenario.inputs)
    console.log(`\n${scenario.name}`)
    console.log(line("fits / runs / bottleneck", `${r.fits} / ${r.runs} / ${r.bottleneck}`))
    console.log(line("GPUs per copy x copies", `${r.group} x ${r.instances} (${r.gpus} GPUs)`))
    console.log(line("weights / KV per stream", `${r.weightsGB.toFixed(0)} GB / ${r.kvPerStreamGB.toFixed(2)} GB`))
    console.log(line("batch (streams per copy)", `${r.batchSize.toFixed(1)}  [HBM cap ${r.hbmStreamCapacity.toFixed(0)}, speed cap ${r.speedStreams.toFixed(0)}]`))
    console.log(line("stream tok/s", `${r.streamTps.toFixed(1)} (target ${r.inputs.targetTps})`))
    console.log(line("decode / compute cap tok/s", `${formatTokens(r.decodeTps)} / ${formatTokens(r.computeTps)}  ${r.memoryBound ? "memory-bound" : "compute-bound"}`))
    console.log(line("KV hit / prefill share", `${Math.round(r.hit * 100)}% / ${Math.round(r.prefillShare * 100)}%`))
    console.log(line("tokens/s total, per GPU, per rack", `${formatTokens(r.tokPerS)}, ${formatTokens(r.tokPerGpu)}, ${formatTokens(r.tokPerRack)}`))
    console.log(line("coverage / utilisation", `${Math.round(r.coverage * 100)}% / ${Math.round(r.utilisation * 100)}%`))
    console.log(line("TTFT / miss / SLA met", `${r.ttftS.toFixed(3)} s / ${Math.round(r.pMiss * 100)}% / ${r.slaMet}`))
    console.log(line("facility kW / tokens per MW", `${r.facilityKW.toFixed(0)} kW / ${formatTokens(r.tokPerMW)} tok/s/MW`))
    console.log(line("Wh per M tokens / J per token", `${Number.isFinite(r.whPerMTokens) ? r.whPerMTokens.toFixed(0) : "—"} Wh / ${Number.isFinite(r.joulesPerToken) ? r.joulesPerToken.toFixed(2) : "—"} J`))
    console.log(line("$/h, $/M good tokens, $/M raw", `${formatMoney(r.hourlyCost)}/h, ${formatMoney(r.costPerM, 3)}, ${formatMoney(r.costPerMRaw, 3)}`))
    for (const lesson of r.lessons) console.log(`    - ${lesson}`)
  }

  /* Sanity assertions: the levers move the right way. */
  const a = computeTokenomics({})
  const kv = computeTokenomics({ kvTier: true })
  const fp4 = computeTokenomics({ ...H.b200, precision: "fp4" })
  const fp8onB200 = computeTokenomics({ ...H.b200, precision: "fp8" })
  const more = computeTokenomics({ racks: 4 })
  const capped = computeTokenomics({ batchCap: 4 })
  const eco = computeTokenomics({ powerCap: 0.85 })
  const spill = computeTokenomics({ ...H.h100, ...M["650b"], racks: 2 })
  const tight = computeTokenomics({ ...M["650b"], racks: 2 })
  const checks = [
    ["KV tier cuts prefill share", kv.prefillShare < a.prefillShare],
    ["KV tier raises tokens/s", kv.rackCapacityTps > a.rackCapacityTps],
    ["FP4 beats FP8 on the same Blackwell rack", fp4.rackCapacityTps > fp8onB200.rackCapacityTps],
    ["FP4 halves the bytes", Math.abs(fp4.weightsGB - fp8onB200.weightsGB / 2) < 1e-9],
    ["More racks, more tokens", more.rackCapacityTps > a.rackCapacityTps * 1.9],
    ["A small batch cap costs throughput", capped.rackCapacityTps < a.rackCapacityTps],
    ["85% power cap: fewer watts, better tokens per MW", eco.facilityKW < a.facilityKW && eco.tokPerMW > a.tokPerMW],
    ["650B FP8 on 8-GPU H100 islands spills (640 GB < 671 GB)", spill.fits === false && spill.group === 16],
    ["650B FP8 is a tight fit on eight H200s", tight.fits === true && tight.group === 8],
    ["Cost per M good tokens is finite when it runs", Number.isFinite(a.costPerM) && a.costPerM > 0],
  ]
  console.log("\nSelf-check")
  let failed = 0
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`)
    if (!ok) failed += 1
  }
  if (failed) {
    console.error(`${failed} check(s) failed`)
    process.exit(1)
  }
}
