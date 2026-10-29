import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DECISIONS } from "../public/js/catalog.js"
import { DECISION_WHY } from "../public/js/decisioncopy.js"

test("every visible decision has a one-line 'why this matters to the customer'", () => {
  for (const d of DECISIONS.filter((x) => !x.hidden)) {
    assert.ok(typeof DECISION_WHY[d.id] === "string" && DECISION_WHY[d.id].length > 10, `missing why for ${d.id}`)
  }
})

test("table iPads share one vocabulary and one tab order", () => {
  const ui = readFileSync(new URL("../public/js/ui.js", import.meta.url), "utf8")
  for (const w of ["Choose your team", "Switch team", "Start designing", "Run simulation", "Lock in", "Call the leader", "Leader is free", "Queue position", "Return to home"]) {
    assert.ok(ui.includes(w), `ui.js lacks "${w}"`)
  }
  assert.match(ui, /\["brief", "1 · Brief"\], \["decide", "2 · Decide"\], \["sim", "3 · Simulate"\], \["pitch", "4 · Pitch"\]/)
  const station = readFileSync(new URL("../public/js/station.js", import.meta.url), "utf8")
  assert.ok(!/--accent/.test(station), "tables must not set a per-table accent colour")
})
