/**
 * The Audi F1 Team edition: every customer figure is annotated and traceable to the fact pack, the
 * briefs cite it, the business case adds up, and the retired product name is absent from docs too.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { CUSTOMER, FIGURES, annotatedFigures, nodesAtAllowance, capSharePerNode, kwYearCHF, costCapCHF, chf, chfFull } from "../public/js/customer.js"
import { BRIEFS, briefWordCount } from "../public/js/briefs.js"
import { caseModel, DEFAULT_INPUTS, SLIDERS } from "../public/js/case.js"
import { path2028For } from "../public/js/report.js"
import * as C from "../public/js/catalog.js"
import { boardFor } from "../public/js/model.js"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const RETIRED_BRAND = new RegExp(["F", "L", "U", "X"].join(""), "i")
const sources = read("docs/audi-f1-sources.md")
/** Row ids in the fact pack: A1, C3-open, D-a, B-c … */
const ROW_IDS = new Set([...sources.matchAll(/^\| \*{0,2}([A-K](?:\d+(?:-open)?|-[a-z]))\*{0,2} \|/gm)].map((m) => m[1]))

test("the fact pack exists, has rows in every section, and nothing in docs/ mentions the retired product name", () => {
  for (const section of ["## A.", "## B.", "## C.", "## D.", "## E.", "## F.", "## G.", "## H.", "## I.", "## J.", "## K."]) assert.ok(sources.includes(section), `fact pack section ${section}`)
  for (const id of ["A15", "A-f", "C13", "C16", "C-a", "D10", "D11", "D-e", "G8", "G11", "G-e", "G-g", "G-h", "H3", "H-f", "J3", "J4", "J-g", "J-l", "K1", "K13", "K-a", "K-e"]) assert.ok(ROW_IDS.has(id), `fact-pack row ${id} (integration pass)`)
  const ids = [...sources.matchAll(/^\| \*{0,2}([A-K](?:\d+(?:-open)?|-[a-z]))\*{0,2} \|/gm)].map((m) => m[1])
  assert.equal(new Set(ids).size, ids.length, `duplicate fact-pack row ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`)
  assert.ok(ROW_IDS.size >= 40, `fact-pack rows (${ROW_IDS.size})`)
  for (const id of ["A1", "A3", "A12", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "D1", "D2", "D3", "D4", "D5", "E1", "E2", "B-a", "B-b", "D-a", "D-d"]) assert.ok(ROW_IDS.has(id), `row ${id}`)
  assert.ok(/VERIFIED/.test(sources) && /ASSUMPTION/.test(sources), "rows are marked VERIFIED or ASSUMPTION")
  assert.ok((sources.match(/https?:\/\//g) || []).length >= 25, "sources carry URLs")
  assert.ok(/2026-11-24|24 Nov 2026/.test(sources), "sources carry the access date")
  for (const file of readdirSync(new URL("docs/", root))) assert.ok(!RETIRED_BRAND.test(read(`docs/${file}`)), `docs/${file} mentions the retired product name`)
})

test("every customer figure is VERIFIED against a fact-pack row or an ASSUMPTION with a rationale", () => {
  const figures = annotatedFigures(CUSTOMER)
  assert.ok(figures.length >= 60, `annotated figures (${figures.length})`)
  for (const f of figures) {
    if (f.status === "VERIFIED") assert.ok(ROW_IDS.has(f.ref), `${f.path} cites row ${f.ref}, which is not in the fact pack`)
    else assert.ok(f.status === "ASSUMPTION" && (f.ref.length >= 8 || ROW_IDS.has(f.ref)), `${f.path} needs a rationale or an assumption row`)
  }
  assert.equal(FIGURES.load.it2027KW, 400)
  assert.equal(FIGURES.fia.mauhAllowance, 6.3)
  assert.equal(FIGURES.fia.atrPercent, 105)
  assert.equal(Math.floor(nodesAtAllowance), 12, "the allowance keeps about twelve declared nodes busy")
  assert.ok(capSharePerNode * 12 <= 100 && capSharePerNode * 13 > 100, "twelve nodes fit the allowance, thirteen do not")
  assert.equal(kwYearCHF(0.16), 1191)
  assert.equal(costCapCHF.fia, Math.round(215_000_000 / 1.1316))
  assert.equal(chf(1_200_000), "CHF 1.2M")
  assert.equal(chf(450_000), "CHF 450k")
  assert.equal(chfFull(1191), "CHF 1,191")
})

test("the briefs are 350–550 words, cite the fact pack, use CHF and name no fictional FIA article", () => {
  for (const [id, b] of Object.entries(BRIEFS)) {
    const words = briefWordCount(id)
    assert.ok(words >= 350 && words <= 550, `${id} brief: ${words} words`)
    const text = JSON.stringify(b)
    const tags = [...text.matchAll(/\[([A-F][^\]]*)\]/g)].flatMap((m) => m[1].split(/,\s*/))
    assert.ok(tags.length >= 3, `${id} brief cites sources (${tags.length})`)
    for (const tag of tags) assert.ok(ROW_IDS.has(tag), `${id} brief cites [${tag}], which is not in the fact pack`)
    assert.ok(text.includes("CHF") && !/\$\d/.test(text), `${id} brief prices in CHF`)
    assert.ok(!/FIA [245]\.\d\b/.test(text), `${id} brief names a fictional FIA article`)
    assert.ok(/FIA (F4|D4|D6)|Audi F1 requirement/.test(text), `${id} brief names a real rule or an Audi F1 requirement`)
  }
})

test("the catalog carries real rule references only, keeps Austin as the finale, and fits the allowance", () => {
  for (const d of C.DECISIONS) for (const o of d.options) {
    if (!o.rule) continue
    assert.ok(/^(req-[a-z]+|F4\.\d+(\.\d+)?)$/.test(o.rule), `${d.id}/${o.id}: rule ${o.rule}`)
    assert.ok(o.ruleLabel === "Audi F1 requirement" || o.ruleLabel === `FIA ${o.rule}`, `${d.id}/${o.id}: label ${o.ruleLabel}`)
    assert.ok(o.ruleText && o.ruleText.startsWith(o.ruleLabel), `${d.id}/${o.id}: the text names its rule`)
  }
  assert.equal(C.decision("size").options.find((o) => o.id === "medium").nodes, 12)
  assert.equal(C.byId(C.STATIONS, "dc").need, FIGURES.load.it2027KW)
  assert.match(C.FINALE.race, /Austin/)
  const over = boardFor("compute", { size: "large", chips: "cpu", storage: "cache" })
  assert.ok(over.breaches.some((b) => b.rule === "F4.6.1" && b.label === "FIA F4.6.1"), "twenty nodes break the MAUh allowance")
  const gpu = boardFor("compute", { size: "small", chips: "gpu", storage: "cache" })
  assert.ok(gpu.breaches.some((b) => b.rule === "F4.4.1"), "a GPU solver breaks F4.4.1 in 2027")
  const colo = boardFor("dc", C.REFERENCE_BUILD)
  assert.equal(colo.headroom2028, FIGURES.offer.expansionRightKW - FIGURES.load.it2028KW, "the campus board knows its 2028 headroom")
})

test("the business case adds up at the planning values and follows its sliders", () => {
  const m = caseModel(DEFAULT_INPUTS)
  const [asis, upgrade, campus] = m.rows
  assert.equal(campus.y2027.kwh, 400 * 0.85 * 8760 * 1.2, "facility kWh = IT × load factor × hours × PUE")
  assert.equal(Math.round(campus.y2027.electricity), 536_112)
  assert.equal(campus.y2027.fee, 180 * 500 * 12)
  assert.equal(Math.round(campus.costCap2027), 536_112 + 1_080_000 + 120_000, "cost-cap charge = electricity + fee + plant ÷ 10")
  assert.equal(Math.round(campus.tco), 9_016_560)
  assert.ok(Math.abs(upgrade.tco - 10_459_562) < 2, "the upgrade path carries a CHF 4.2M new hall for 2028")
  assert.equal(upgrade.capex2028, 350 * 12_000)
  assert.ok(!asis.viable2027 && asis.y2027.shortfall === 100, "the room as it is cannot carry the 2027 load")
  assert.ok(campus.viable2027 && campus.viable2028 && campus.headroom2028 === 200)
  assert.ok(m.delta.tco > 0 && m.delta.costCap2027 < 0, "honest in both directions: cheaper over three years, a higher in-cap charge in 2027")
  const cheaper = caseModel({ ...DEFAULT_INPUTS, feePerKWMonth: 150 })
  assert.equal(Math.round(cheaper.rows[2].tco), 9_016_560 - 30 * 500 * 12 - 2 * 30 * 800 * 12)
  const hot = caseModel({ ...DEFAULT_INPUTS, hinwilRp: 20 })
  assert.equal(Math.round(hot.rows[1].y2027.electricity), Math.round(400 * 0.85 * 8760 * 1.4 * 0.2))
  for (const s of SLIDERS) assert.ok(DEFAULT_INPUTS[s.id] >= s.min && DEFAULT_INPUTS[s.id] <= s.max, `${s.id} default inside its range`)
})

test("every readout carries a 2028 path line that names the site and the GPU rule", () => {
  const team = { choices: { ...C.REFERENCE_BUILD }, reviews: Object.fromEntries(C.STATIONS.map((s) => [s.id, { status: "approved" }])) }
  const line = path2028For(team)
  assert.match(line, /^2028 path: /)
  assert.match(line, /Zurich campus/)
  assert.match(line, /800 kW/)
  assert.match(line, /GPU/)
  const today = path2028For({ choices: {}, reviews: {} })
  assert.match(today, /Hinwil data room .* short of the 800 kW/)
})

test("one participant: the customer's team is the Audi F1 Team, and the finale is its 2027 plan against today's Hinwil setup", () => {
  assert.deepEqual(CUSTOMER.team, { id: "t1", name: "Audi F1 Team", color: "#e10600" })
  assert.deepEqual(C.CUSTOMER_TEAM, CUSTOMER.team, "the catalog's customer is customer.js's")
  assert.equal(C.MAX_TEAMS, 1)
  assert.equal(C.FINALE_ENTRANTS.plan.id, CUSTOMER.team.id, "the plan car keeps the customer's id, so /race.html?team=t1 is its readout")
  assert.equal(C.FINALE_ENTRANTS.plan.name, `${CUSTOMER.team.name} · 2027 plan`)
  assert.equal(C.FINALE_ENTRANTS.today.name, `${CUSTOMER.team.name} · today's Hinwil setup`)
  assert.notEqual(C.FINALE_ENTRANTS.today.id, CUSTOMER.team.id)
  assert.equal(C.FINALE.laps, 56, "the Austin 2027 race keeps its 56 laps")
  const readme = read("README.md")
  for (const w of ["One customer, no teams", "How to run tomorrow's demo", "/station.html?station=dc", "Open my table", "Show readout", "2028 path"]) assert.ok(readme.includes(w), `README lacks "${w}"`)
  assert.ok(!/(Audi F1 Team|customer)['’]s (team|crew) members/.test(readme), "the README does not invent the customer's people")
})
