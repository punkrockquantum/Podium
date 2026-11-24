/**
 * The league table, client side: talks to /api/league and falls back to localStorage when the API
 * is unreachable (file:// use, server down), so a lap is never lost in the room.
 */
import { formatMs } from "./physics.js"

export const LOCAL_KEY = "podium.arcade.league"
const MAX_LOCAL = 500

const sortRows = (rows) => rows.sort((a, b) => a.bestLapMs - b.bestLapMs || a.at - b.at)

function localRows() {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]")
    return Array.isArray(rows) ? rows.filter((r) => r && Number.isInteger(r.bestLapMs)) : []
  } catch {
    return []
  }
}
function saveLocal(rows) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(sortRows(rows).slice(0, MAX_LOCAL)))
  } catch {}
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(json?.error || `HTTP ${res.status}`), { status: res.status, json })
  return json
}

/** The table: { rows, total, source: "api" | "local" }. */
export async function fetchLeague(limit = 50) {
  try {
    const json = await api(`/api/league?limit=${limit}`)
    return { rows: json.rows, total: json.total, source: "api" }
  } catch (err) {
    if (err.status) throw err
    const rows = sortRows(localRows()).slice(0, limit)
    return { rows, total: rows.length, source: "local" }
  }
}

/** Save a lap: { ok, rank, row, total, source }. A 4xx from the API is thrown (bad name, implausible lap). */
export async function submitLap(entry) {
  try {
    const json = await api("/api/league", entry)
    return { ...json, source: "api" }
  } catch (err) {
    if (err.status) throw err
    const rows = localRows()
    const row = { id: `local-${Date.now().toString(36)}`, ...entry, name: String(entry.name).trim().slice(0, 24), at: Date.now() }
    rows.push(row)
    sortRows(rows)
    const rank = rows.indexOf(row) + 1
    saveLocal(rows)
    return { ok: true, rank, row, total: rows.length, source: "local" }
  }
}

/** "14:07" today, else "24 Nov". */
export function whenText(at) {
  if (!Number.isFinite(at) || at <= 0) return "—"
  const d = new Date(at)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : d.toLocaleDateString([], { day: "numeric", month: "short" })
}

/** Fill a <tbody> with the table; `highlightId` marks the new entry. */
export function renderLeague(tbody, rows, highlightId = null) {
  tbody.replaceChildren()
  if (!rows.length) {
    const tr = document.createElement("tr")
    tr.className = "empty"
    const td = document.createElement("td")
    td.colSpan = 6
    td.textContent = "No laps yet. Race now and set the first time."
    tr.append(td)
    tbody.append(tr)
    return
  }
  rows.forEach((row, k) => {
    const tr = document.createElement("tr")
    if (row.id && row.id === highlightId) tr.className = "mine"
    const cells = [
      `${k + 1}`,
      row.name,
      formatMs(row.bestLapMs),
      `${row.carLabel} · ${row.season}`,
      `${row.advantageS > 0 ? "+" : ""}${Number(row.advantageS).toFixed(2)} s`,
      `${whenText(row.at)}${row.finishPos ? ` · P${row.finishPos}` : ""}`,
    ]
    for (const [i, value] of cells.entries()) {
      const td = document.createElement("td")
      td.textContent = value
      if (i === 2) td.className = "lap"
      tr.append(td)
    }
    tbody.append(tr)
  })
}
