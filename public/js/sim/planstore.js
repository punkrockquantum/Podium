/** Plan persistence: last plan, plan library, compare slots and Solutions Architect notes in localStorage; base64url sharing. */

export const KEYS = Object.freeze({
  last: "podium.plan.last.v1",
  library: "podium.plan.library.v1",
  compare: "podium.plan.compare.v1",
  notes: "podium.plan.sa.checklist.v1",
  view: "podium.plan.view.v1",
})

const storage = () => {
  try { return globalThis.localStorage || null } catch { return null }
}
const read = (key, fallback) => {
  const s = storage()
  if (!s) return fallback
  try {
    const v = JSON.parse(s.getItem(key) || "null")
    return v === null || v === undefined ? fallback : v
  } catch { return fallback }
}
const write = (key, value) => {
  const s = storage()
  if (!s) return
  try { s.setItem(key, JSON.stringify(value)) } catch { /* private mode or quota */ }
}

export const rememberPlan = (plan) => write(KEYS.last, plan)
export const recallPlan = () => read(KEYS.last, null)

export const listPlans = () => { const l = read(KEYS.library, []); return Array.isArray(l) ? l : [] }
export function savePlan(name, plan) {
  const list = listPlans().filter((x) => x.name !== name)
  list.unshift({ name, plan, savedAt: new Date().toISOString() })
  write(KEYS.library, list.slice(0, 40))
  return list
}
export function deletePlan(name) {
  const list = listPlans().filter((x) => x.name !== name)
  write(KEYS.library, list)
  return list
}

export const loadSlots = () => { const s = read(KEYS.compare, {}); return s && typeof s === "object" ? s : {} }
export const saveSlots = (slots) => write(KEYS.compare, slots)

export const loadNotes = () => { const n = read(KEYS.notes, {}); return n && typeof n === "object" ? n : {} }
export const saveNotes = (notes) => write(KEYS.notes, notes)

export const rememberView = (view) => write(KEYS.view, view)
export const recallView = () => read(KEYS.view, null)

// ---------------------------------------------------------------------------------------------
// Sharing: `#/route?p=<base64url json>` so a plan can be pasted into a chat or a slide
// ---------------------------------------------------------------------------------------------

const utf8 = new TextEncoder()
const utf8d = new TextDecoder()
export function encodeParam(obj) {
  const bytes = utf8.encode(JSON.stringify(obj))
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export function decodeParam(s) {
  if (!s || !/^[A-Za-z0-9_-]+$/.test(s)) return null
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const obj = JSON.parse(utf8d.decode(bytes))
    return obj && typeof obj === "object" ? obj : null
  } catch { return null }
}

/** Download a JSON file. */
export function downloadJson(payload, filename) {
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
