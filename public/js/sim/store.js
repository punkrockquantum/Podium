/** Scenario persistence: localStorage library, URL hash sharing, JSON export. No server round-trips. */

const KEY = "podium.sim.scenarios.v1"
const LAST = "podium.sim.last.v1"

const storage = () => {
  try { return window.localStorage } catch { return null }
}

export function listScenarios() {
  const s = storage()
  if (!s) return []
  try {
    const list = JSON.parse(s.getItem(KEY) || "[]")
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export function saveScenario(name, inputs) {
  const s = storage()
  if (!s) return listScenarios()
  const list = listScenarios().filter((x) => x.name !== name)
  list.unshift({ name, inputs, savedAt: new Date().toISOString() })
  s.setItem(KEY, JSON.stringify(list.slice(0, 40)))
  return list
}

export function deleteScenario(name) {
  const s = storage()
  if (!s) return []
  const list = listScenarios().filter((x) => x.name !== name)
  s.setItem(KEY, JSON.stringify(list))
  return list
}

export function rememberLast(inputs) {
  const s = storage()
  if (s) s.setItem(LAST, JSON.stringify(inputs))
}

export function recallLast() {
  const s = storage()
  if (!s) return null
  try { return JSON.parse(s.getItem(LAST) || "null") } catch { return null }
}

/** `#s=<base64url json>` so a scenario can be pasted into a chat or a slide. */
export function encodeHash(inputs) {
  const json = JSON.stringify(inputs)
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `#s=${b64}`
}

export function decodeHash(hash = window.location.hash) {
  const m = /^#s=([A-Za-z0-9_-]+)/.exec(hash || "")
  if (!m) return null
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/")
    const json = decodeURIComponent(escape(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))))
    const obj = JSON.parse(json)
    return obj && typeof obj === "object" ? obj : null
  } catch { return null }
}

/** Download a JSON file with inputs and the evaluated outputs. */
export function exportJson(payload, filename = "audi-f1-digital-realty-scenario.json") {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
