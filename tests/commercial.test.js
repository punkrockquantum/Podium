import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/js/catalog.js"
import { evaluate } from "../public/js/model.js"
import { simulateStation, REFERENCE_BUILD } from "../public/js/sim.js"

const ev = (rank, choices) => evaluate({ rank, choices: { ...REFERENCE_BUILD, ...choices } })
const compute = (rank, choices) => simulateStation({ rank, choices: { ...REFERENCE_BUILD, ...choices } }, {}, "compute").score

test("buying and financing put hardware in CapEx; leases and as-a-service move it to OpEx", () => {
  const buy = ev(5, { oem: "hpe", payment: "buy" })
  const finance = ev(5, { oem: "hpe", payment: "finance" })
  const lease = ev(5, { oem: "hpe", payment: "lease", term: 36 })
  const aas = ev(5, { oem: "hpe", payment: "aas", term: 36 })
  assert.equal(buy.commercial.capexHardware, buy.commercial.hardware)
  assert.equal(finance.commercial.capexHardware, finance.commercial.hardware)
  assert.ok(finance.commercial.opexHardware > buy.commercial.opexHardware, "finance adds interest on top of support")
  for (const run of [lease, aas]) {
    assert.equal(run.commercial.capexHardware, 0)
    assert.ok(run.ledger.capex < buy.ledger.capex)
    assert.ok(run.ledger.opex > buy.ledger.opex)
  }
  assert.ok(aas.commercial.aas && aas.commercial.commitment > 0 && aas.commercial.months >= C.AAS_MIN_MONTHS, "as-a-service is a committed contract")
})

test("lease rates fall with a longer term", () => {
  const terms = C.CONTRACT_TERMS.map((term) => ev(5, { oem: "dell", payment: "lease", term }).commercial.opexHardware)
  assert.ok(terms[0] > terms[1] && terms[1] > terms[2], terms.join(" > "))
})

test("as-a-service falls back to a lease where the OEM has no programme", () => {
  const run = ev(5, { oem: "supermicro", payment: "aas" })
  assert.equal(run.commercial.payment, "lease")
  assert.equal(run.commercial.aas, null)
  for (const oem of C.OEMS.filter((o) => o.aas)) assert.ok(ev(5, { oem: oem.id, payment: "aas" }).commercial.aas, oem.id)
})

test("cloud and burst AI need no AI CapEx; burst is cheaper to run than a reserved cloud", () => {
  const own = ev(5, { deploy: "own" })
  const cloud = ev(5, { deploy: "cloud" })
  const burst = ev(5, { deploy: "burst" })
  assert.ok(cloud.ledger.capex < own.ledger.capex && burst.ledger.capex < own.ledger.capex)
  assert.ok(burst.ledger.opex < cloud.ledger.opex)
  assert.ok(burst.lead.ai < own.lead.ai, "cloud capacity arrives faster than racks")
})

test("storage as a service has no CapEx; NVIDIA AI Enterprise is charged unless the OEM bundles it", () => {
  const lustre = ev(5, { pfs: "lustre" })
  const staas = ev(5, { pfs: "staas" })
  assert.ok(staas.ledger.capex < lustre.ledger.capex && staas.ledger.opex > lustre.ledger.opex)
  const licences = (run) => run.ledger.opexItems.filter((i) => /AI Enterprise/i.test(i.label)).reduce((sum, i) => sum + i.amount, 0)
  assert.ok(licences(ev(5, { oem: "supermicro" })) > 0)
  assert.equal(licences(ev(5, { oem: "nvidia" })), 0)
})

test("colocation terms and redundancy change the rent", () => {
  assert.ok(ev(5, { terms: "top10" }).ledger.opex < ev(5, { terms: "top5" }).ledger.opex, "a longer commitment is cheaper per kW")
  const n = ev(5, { redundancy: "n" })
  const twoN = ev(5, { redundancy: "2n" })
  assert.ok(twoN.ledger.opex > n.ledger.opex)
})

test("Tier 1 teams are pulled toward as-a-service; Tier 3 teams toward buying", () => {
  const buy = { oem: "supermicro", payment: "buy" }
  const greenlake = { oem: "hpe", payment: "aas", term: 36 }
  assert.ok(compute(1, greenlake) > compute(1, buy) + 10, `P1: aas ${compute(1, greenlake)} vs buy ${compute(1, buy)}`)
  assert.ok(compute(9, buy) > compute(9, greenlake), `P9: buy ${compute(9, buy)} vs aas ${compute(9, greenlake)}`)
  assert.ok(ev(1, buy).ledger.capexOver > 0, "the reference build overshoots a Tier 1 envelope when bought outright")
})
