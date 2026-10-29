/**
 * Plain-English design summaries a non-engineer can read in 20 seconds: what the team chose, as full
 * sentences, then what it costs and risks, then the simulation score. Pure (no DOM): shared by the
 * host's leader panel, the table's plan output and the race report so the wording is identical.
 */
import * as C from "./catalog.js"
import { evaluate, pickedOption } from "./model.js"
import { simulateStation, PENALTY_STATION } from "./sim.js"
import { DECISION_WHY } from "./decisioncopy.js"

/** What one table costs and how long it takes, from the evaluation's ledger. */
export function tableFigures(ev, station) {
  const mine = (items) => items.filter((item) => item.station === station).reduce((total, item) => total + item.amount, 0)
  const lead = { compute: ev.lead.cfd, ai: ev.lead.ai, dc: ev.lead.hall, network: ev.lead.net }[station] ?? 0
  return { capex: mine(ev.ledger.capexItems), opex: mine(ev.ledger.opexItems), leadWeeks: Math.ceil(lead) }
}

const PARTS = { performance: "Performance", cost: "Cost efficiency", compliance: "FIA compliance", resilience: "Resilience" }

function usd(value) {
  const abs = Math.abs(value)
  const sign = value < 0 ? "minus " : ""
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`
  return `${sign}$${Math.round(abs)}`
}

const count = (n, one, many = `${one}s`) => `${n === 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : n === 4 ? "four" : n} ${n === 1 ? one : many}`
/** Lower-case the first letter unless it starts a name or acronym ("Digital Realty", "FIA", "Lustre"). */
const lower = (text) => {
  if (!text) return ""
  const [first, second = ""] = text.split(/\s+/)
  const properNoun = /^[A-Z]{2}/.test(first) || /^[A-Z]/.test(second) || /^(Lustre|Dell|HPE|Intel|AMD|NVIDIA|Lenovo|Supermicro)/.test(first)
  return properNoun ? text : text.charAt(0).toLowerCase() + text.slice(1)
}
const sentence = (text) => {
  const t = text.trim()
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : ""
}

function computeSentences(ev, o) {
  const ch = ev.choices
  const oem = o("oem").name
  const com = ev.commercial
  const pay = {
    buy: "bought outright, so the full price comes out of the CapEx envelope",
    finance: "on a $1-buyout finance lease, which the FIA still counts as CapEx, plus about 4.5% interest",
    lease: `on a ${ch.term}-month operating lease, so there is no CapEx but a yearly rental against the cost cap`,
    aas: com.aas ? `paid monthly through ${com.aas}, so there is no CapEx but a ${Math.max(ch.term, C.AAS_MIN_MONTHS)}-month commitment` : `as a service, but ${oem} has no programme, so it becomes a ${ch.term}-month lease`,
  }[ch.payment] || lower(o("payment").name)
  const clock = { turbo: "with turbo unlocked, so the FIA bills every core-hour at maximum boost", base: "locked at the base clock", lock85: "locked 15% under base, so each core-hour is billed for less" }[ch.clock] || lower(o("clock").name)
  return [
    `They chose ${oem} servers ${pay}.`,
    `CFD runs on ${count(ch.nodes, "node")} of ${o("cpu").name} ${clock}.`,
  ]
}

function aiSentences(ev, o) {
  const ch = ev.choices
  const where = { own: "in their own data centre", cloud: "reserved in the cloud for a year (all OpEx, no hall space)", burst: "rented only on race weekends from the cloud" }[ch.deploy] || lower(o("deploy").name)
  const power = { eco70: "capped at 70% power", eco85: "capped at 85% power", std: "at full datasheet power", boost: "at maximum boost" }[ch.tgp] || lower(o("tgp").name)
  return [
    `${sentence(`${count(ch.racks, "rack")} of ${o("platform").name} ${where}, ${power}`)}`,
    `The strategy AI is a ${lower(o("modelSize").name)} model running in ${o("precision").name}.`,
  ]
}

function dcSentences(ev, o) {
  const ch = ev.choices
  return [
    `Their hall is in ${o("location").name}, cooled with ${lower(o("hall").name)}.`,
    `They contracted ${ch.block} MW on a ${lower(o("terms").name)} with ${o("redundancy").name} power.`,
  ]
}

function storageSentences(ev, o) {
  const ch = ev.choices
  const archive = { none: "run folders deleted after each test period", tape: "run folders kept on a tape library", cloud: "run folders kept in a cloud archive" }[ch.archive] || lower(o("archive").name)
  return [
    `CFD data sits on ${lower(o("pfs").name)} (${ch.pfsPB} PB), with ${archive}.`,
    `The strategy AI searches ${lower(o("dataTier").name)}${ch.kv === "on" ? " with a KV cache tier" : " with no KV cache"}, on ${o("hbm").name} of GPU memory per accelerator.`,
  ]
}

function networkSentences(ev, o) {
  const ch = ev.choices
  const backup = ch.wanBackup === "none" ? "no backup" : `${o("wanBackup").name} as the backup`
  return [
    `The circuit link is ${lower(o("wan").name)} with ${backup}; the data centre reaches the factory over ${lower(o("hqLink").name)}.`,
    `Inside the hall they use ${o("fabric").name}; at the track, ${lower(o("trackside").name)} and ${count(ch.edge, "edge rack")}.`,
  ]
}

function governanceSentences(ev, o) {
  return [
    `IT is kept apart from sister companies by ${lower(o("segregation").name)}, and data moves through ${lower(o("dataflow").name)}.`,
    `Hiring: ${lower(o("workforce").name)}. Curfew and logs: ${lower(o("audit").name)}.`,
  ]
}

const SENTENCES = { compute: computeSentences, ai: aiSentences, dc: dcSentences, storage: storageSentences, network: networkSentences, governance: governanceSentences }

/** FIA problems for one table in plain words: certain breaches and audit risks. */
export function fiaFlags(ev, stationId) {
  return ev.penalties.filter((p) => PENALTY_STATION[p.id] === stationId).map((p) => (p.p >= 1 ? p.text : `${Math.round(p.p * 100)}% audit risk: ${p.text}`))
}

/** What the team chose at one table, as full sentences. */
export function choiceSentences(ev, stationId) {
  const o = (id) => pickedOption(id, ev.choices) || { name: String(ev.choices[id]) }
  return (SENTENCES[stationId] || (() => []))(ev, o)
}

/**
 * The full summary for one team at one table: sentences, consequences in plain words, the score.
 * `team` is the team as it should be judged (its current or locked-in choices).
 */
export function designSummary(team, stationId, opts = {}, ev = evaluate(team, opts)) {
  const sim = simulateStation(team, opts, stationId, ev)
  const fig = tableFigures(ev, stationId)
  const L = ev.ledger
  const flags = fiaFlags(ev, stationId)
  const capexLeft = L.capexRemaining - L.capex
  const opexGap = L.opexAllowance - L.opex
  const consequences = [
    `CapEx: this table uses ${usd(fig.capex)}; the whole team has used ${usd(L.capex)} of its ${usd(L.capexRemaining)} headroom${capexLeft >= 0 ? ` (${usd(capexLeft)} left)` : ` (${usd(-capexLeft)} over: an FIA penalty)`}.`,
    `Yearly OpEx: this table costs ${usd(fig.opex)}; the team runs ${usd(L.opex)} against a ${usd(L.opexAllowance)} allowance${opexGap >= 0 ? "" : ` (${usd(-opexGap)} over)`}.`,
    `Power: the facility draws ${Math.round(ev.power.facilityKW)} kW of the ${ev.power.blockMW} MW contracted (${Math.round(ev.power.headroom * 100)}% headroom).`,
    fig.leadWeeks ? `Lead time: ${fig.leadWeeks} weeks before it is ready.` : "Lead time: ready from the start of the season.",
    flags.length ? `FIA flags: ${flags.join(" ")}` : "FIA flags: none.",
  ]
  const watch = ev.checks.filter((c) => c.station === stationId && c.state === "red").slice(0, 2).map((c) => c.text)
  return {
    station: stationId,
    sentences: choiceSentences(ev, stationId),
    consequences,
    watch,
    score: sim.score,
    band: sim.band,
    parts: Object.entries(PARTS).map(([id, name]) => ({ id, name, value: sim.parts[id] })),
    scoreLine: `Simulation: ${sim.score}% (${sim.band}). ${Object.entries(PARTS).map(([id, name]) => `${name} ${Math.round(sim.parts[id] * 100)}%`).join(", ")}.`,
  }
}

/** One line on why a decision matters to the customer (the Decide tab's copy). */
export function whyItMatters(decisionId) {
  return DECISION_WHY[decisionId] || ""
}
