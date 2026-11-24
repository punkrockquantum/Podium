/** SVG visuals for the plan: the Swiss schematic map, the deployment Gantt and the compact timeline strip. */
import { svg, el, fmt } from "./dom.js"
import { FIGURES as F } from "../customer.js"
import { fmtDate, isoDate, PLANNING_DATE } from "./timeline.js"

// ---------------------------------------------------------------------------------------------
// Swiss schematic map: Hinwil · Digital Realty Zurich · Neuburg, with the fibre and the paddock link
// ---------------------------------------------------------------------------------------------

// Simplified outline of Switzerland (lon, lat) — schematic, not survey grade
const CH = [[6.0, 46.4], [6.8, 47.0], [7.0, 47.35], [7.5, 47.6], [8.6, 47.78], [9.6, 47.5], [9.9, 47.1], [10.45, 46.85], [10.4, 46.5], [10.1, 46.25], [9.3, 46.3], [9.0, 45.85], [8.4, 46.1], [7.9, 45.95], [7.0, 45.9], [6.8, 46.1], [6.1, 46.2]]
const proj = ([lon, lat]) => [20 + (lon - 5.8) * 100, 12 + (48.9 - lat) * 100]

/** `result` is an evaluatePlan() result. Shows where the Restricted CFD estate runs in each season. */
export function swissMap(result) {
  const x27 = result.inputs[2027]
  const x28 = result.inputs[2028]
  const atDr = (x) => x.location !== "hinwil"
  const node = svg("svg", { viewBox: "0 0 640 300", class: "map", role: "img", "aria-label": `Map: Hinwil factory, Digital Realty Zurich campus (${F.sites.campus.fibreKm} km of fibre) and Neuburg power-unit site` })
  node.append(svg("path", { class: "map-country", d: `M ${CH.map((p) => proj(p).map((v) => v.toFixed(1)).join(" ")).join(" L ")} Z` }))
  const [hx, hy] = proj([8.84, 47.3])
  const [zx, zy] = proj([8.56, 47.43])
  const [nx, ny] = proj([11.18, 48.73])
  // Neuburg sits outside the outline, to the north-east
  node.append(svg("path", { class: "map-link remote", d: `M ${hx} ${hy} Q ${(hx + nx) / 2} ${hy - 40} ${nx - 8} ${ny + 8}` }))
  node.append(svg("text", { class: "map-link-text", x: (hx + nx) / 2 + 10, y: hy - 30 }, `≈ ${F.sites.neuburg.rttMsToZurich} ms carrier Ethernet`))
  node.append(svg("circle", { class: "map-pin neuburg", cx: nx, cy: ny, r: 6 }))
  node.append(svg("text", { class: "map-label", x: nx - 90, y: ny + 24 }, "Neuburg an der Donau · power unit"))
  // Zurich region
  const fibreClass = atDr(x27) || atDr(x28) ? "map-link fibre" : "map-link fibre off"
  node.append(svg("line", { class: fibreClass, x1: hx, y1: hy, x2: zx, y2: zy }))
  node.append(svg("circle", { class: "map-pin hinwil", cx: hx, cy: hy, r: 7 }))
  node.append(svg("circle", { class: `map-pin dr ${atDr(x27) || atDr(x28) ? "" : "dim"}`, cx: zx, cy: zy, r: 7 }))
  node.append(svg("text", { class: "map-label", x: hx + 12, y: hy + 16 }, "Hinwil · factory, wind tunnel, Mission Control"))
  node.append(svg("text", { class: "map-label dr", x: zx - 6, y: zy - 12, "text-anchor": "end" }, "Digital Realty Zurich · ZUR1–ZUR3 Glattbrugg"))
  // UK Technology Centre off-map
  node.append(svg("text", { class: "map-label muted", x: 24, y: 40 }, `← Bicester Technology Centre · ≈ ${F.sites.bicester.rttMsToZurich} ms`))
  // Inset: Hinwil ↔ campus with the fibre routes
  const ix = 400
  const iy = 150
  node.append(svg("rect", { class: "map-inset", x: ix, y: iy, width: 228, height: 136, rx: 10 }))
  node.append(svg("text", { class: "map-inset-title", x: ix + 12, y: iy + 20 }, "Restricted CFD estate"))
  const px = ix + 40
  const py = iy + 84
  const qx = ix + 188
  const qy = iy + 60
  const routes = Math.max(atDr(x27) ? x27.fibrePairs : 0, atDr(x28) ? x28.fibrePairs : 0)
  if (routes >= 1) node.append(svg("path", { class: "map-link fibre", d: `M ${px} ${py} C ${px + 50} ${py - 10} ${qx - 50} ${qy + 10} ${qx} ${qy}` }))
  if (routes >= 2) node.append(svg("path", { class: "map-link fibre alt", d: `M ${px} ${py} C ${px + 40} ${py + 40} ${qx - 40} ${qy + 40} ${qx} ${qy}` }))
  node.append(svg("circle", { class: "map-pin hinwil", cx: px, cy: py, r: 9 }))
  node.append(svg("circle", { class: `map-pin dr ${routes ? "" : "dim"}`, cx: qx, cy: qy, r: 9 }))
  node.append(svg("text", { class: "map-label", x: px - 22, y: py + 26 }, "Hinwil"))
  node.append(svg("text", { class: "map-label dr", x: qx - 26, y: qy - 16 }, "DR Zurich"))
  node.append(svg("text", { class: "map-link-text", x: ix + 70, y: iy + 122 }, routes ? `${routes === 2 ? "2 diverse routes" : "1 route"} · ≈ ${F.sites.campus.fibreKm} km · ${F.sites.campus.rttMs} ms` : "No campus link in this plan"))
  const where = (x) => (x.location === "hinwil" ? "Hinwil" : x.location === "hybrid" ? "DR Zurich (hybrid)" : "DR Zurich")
  node.append(svg("text", { class: "map-seasons", x: ix + 12, y: iy + 38 }, `2027 · ${where(x27)}   2028 · ${where(x28)}`))
  return node
}

// ---------------------------------------------------------------------------------------------
// Deployment timeline: ATP bands, shutdowns, markers, tasks and milestones
// ---------------------------------------------------------------------------------------------

const OWNER_LABEL = { team: "Team", dr: "Digital Realty", hpe: "HPE GreenLake", carrier: "Carrier", fia: "FIA" }

/**
 * `timeline` from evaluatePlan().timeline. `compact` draws bands, markers and milestones only (for the
 * Overview); the full chart adds a row per task with owner colours and the critical path.
 */
export function gantt(timeline, { compact = false, width = 960 } = {}) {
  const labelW = compact ? 0 : 230
  const left = labelW + 8
  const right = width - 12
  const { start, end } = timeline.range
  const xOf = (ms) => left + ((Math.min(Math.max(ms, start), end) - start) / (end - start)) * (right - left)
  const charW = compact ? 5.6 : 6.2 // approximate glyph width at the label font size, for collision checks
  const laneH = compact ? 13 : 14
  const bandTop = 18
  const bandH = 22
  const markerTop = bandTop + bandH + 4
  // Marker labels (tests, Round 1, GPU legality, today) go into lanes so they never overlap
  const markerLabels = timeline.markers
    .filter((m) => !compact || m.kind !== "test")
    .map((m) => ({ ...m, x: xOf(m.date), text: compact ? (m.kind === "race" ? "R1" : m.kind === "rule" ? "GPU" : m.kind === "today" ? "Today" : m.label) : m.label }))
    .sort((a, b) => a.x - b.x)
  const markerLanes = placeInLanes(markerLabels.map((m) => ({ x: m.x + 3, w: m.text.length * charW })), compact ? 2 : 3)
  const markerLaneCount = Math.max(1, ...markerLanes.map((l) => l + 1))
  const rows = compact ? [] : timeline.tasks
  const rowH = 24
  const rowsTop = markerTop + 6 + markerLaneCount * laneH
  const msTop = rowsTop + rows.length * rowH + (rows.length ? 10 : 0)
  // Milestone labels likewise; a label near the right edge flips to the left of its diamond
  const onChart = timeline.milestones.filter((m) => !m.offChart && m.date >= start && m.date <= end)
  const msLabels = onChart.map((m) => {
    const x = xOf(m.date)
    const text = compact ? shortMilestone(m) : `${m.label} · ${fmtDate(m.date)}`
    const w = text.length * charW
    const flip = x + 4 + w > right
    return { m, x, text, w, flip, x0: flip ? x - 4 - w : x + 4 }
  }).sort((a, b) => a.x0 - b.x0)
  const msLanes = placeInLanes(msLabels.map((l) => ({ x: l.x0, w: l.w })), compact ? 3 : 4)
  const msLaneCount = Math.max(1, ...msLanes.map((l) => l + 1))
  const height = msTop + 22 + msLaneCount * laneH + 8
  const node = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: `gantt ${compact ? "compact" : ""}`, role: "img", "aria-label": compact ? "Deployment timeline: FIA periods and the plan's milestones" : "Deployment Gantt chart: FIA periods, lead-time tasks and milestones" })

  // ATP bands and year lines
  for (const atp of timeline.atps) {
    const x1 = xOf(atp.start)
    const x2 = xOf(atp.end)
    node.append(svg("rect", { class: `atp-band ${atp.index % 2 ? "odd" : "even"}`, x: x1.toFixed(1), y: bandTop, width: Math.max(0, x2 - x1).toFixed(1), height: bandH }))
    if (x2 - x1 > 34) node.append(svg("text", { class: "atp-text", x: ((x1 + x2) / 2).toFixed(1), y: bandTop + 15, "text-anchor": "middle" }, compact ? `P${atp.index}` : `ATP ${atp.index}`))
  }
  const yearX = {}
  for (const y of [2027, 2028]) {
    const x = xOf(Date.UTC(y, 0, 1))
    yearX[y] = x
    node.append(svg("line", { class: "year-line", x1: x, y1: 4, x2: x, y2: height - 4 }))
    node.append(svg("text", { class: "year-text", x: x + 4, y: 12 }, String(y)))
  }
  if (yearX[2027] - left > 60) node.append(svg("text", { class: "year-text", x: left, y: 12 }, "Nov 2026"))
  // Shutdowns
  for (const w of timeline.windows) {
    const x1 = xOf(w.start)
    const x2 = xOf(w.end)
    if (x2 <= x1) continue
    node.append(svg("rect", { class: `shutdown ${w.kind}`, x: x1.toFixed(1), y: bandTop, width: Math.max(2, x2 - x1).toFixed(1), height: compact ? bandH : msTop - bandTop }))
  }
  // Markers
  for (const m of timeline.markers) {
    const x = xOf(m.date)
    node.append(svg("line", { class: `marker-line ${m.kind}`, x1: x, y1: markerTop, x2: x, y2: msTop + 2 }))
  }
  markerLabels.forEach((m, i) => {
    node.append(svg("text", { class: `marker-text ${m.kind}`, x: m.x + 3, y: markerTop + 10 + markerLanes[i] * laneH }, m.text))
  })
  // Tasks
  rows.forEach((t, i) => {
    const y = rowsTop + i * rowH
    const x1 = xOf(t.start)
    const x2 = xOf(t.end)
    node.append(svg("text", { class: "task-label", x: labelW, y: y + 15, "text-anchor": "end" }, t.label.length > 46 ? `${t.label.slice(0, 44)}…` : t.label))
    node.append(svg("rect", { class: `task owner-${t.owner} path-${t.path} status-${t.status}`, x: x1.toFixed(1), y: y + 4, width: Math.max(3, x2 - x1).toFixed(1), height: rowH - 8, rx: 4 }))
    node.append(svg("text", { class: "task-weeks", x: (x2 + 4).toFixed(1), y: y + 15 }, `${t.weeks} wk · ${OWNER_LABEL[t.owner] || t.owner}`))
  })
  // Milestones
  // Diamonds sit on one row; every label hangs below it in its lane, joined by a short leader
  msLabels.forEach((l, i) => {
    const y = msTop + 8
    const labelY = y + 20 + msLanes[i] * laneH
    node.append(svg("path", { class: `milestone status-${l.m.status} ms-${l.m.id}`, d: `M ${l.x} ${y - 7} L ${l.x + 7} ${y} L ${l.x} ${y + 7} L ${l.x - 7} ${y} Z` }))
    node.append(svg("line", { class: "milestone-leader", x1: l.x, y1: y + 7, x2: l.x, y2: labelY - 8 }))
    node.append(svg("text", { class: "milestone-text", x: l.flip ? l.x - 4 : l.x + 4, y: labelY, "text-anchor": l.flip ? "end" : "start" }, l.text))
  })
  return node
}

/**
 * Greedy lane assignment for horizontal labels: each label takes the first lane where it does not overlap the
 * label already there; beyond `maxLanes` the lanes wrap (rare, and still readable). Returns a lane per label.
 */
function placeInLanes(boxes, maxLanes) {
  const laneRight = []
  return boxes.map(({ x, w }) => {
    let lane = laneRight.findIndex((r) => x >= r + 6)
    if (lane === -1) lane = laneRight.length < maxLanes ? laneRight.length : laneRight.indexOf(Math.min(...laneRight))
    laneRight[lane] = x + w
    return lane
  })
}

const shortMilestone = (m) => ({ contract: "Contract", cutover: "Cutover", declaration: "Declare", "stepup-order": "Order step-up", stepup: "Step-up", declaration28: "Declare", refresh: "Refresh" }[m.id] || m.label) + ` ${fmtDate(m.date, { year: false })}`

/** A legend for the Gantt. */
export function ganttLegend() {
  return el("div", { class: "gantt-legend" },
    el("span", { class: "lg atp" }, "ATP"), el("span", { class: "lg shutdown" }, "Shutdown"), el("span", { class: "lg owner-dr" }, "Digital Realty"), el("span", { class: "lg owner-hpe" }, "HPE GreenLake"), el("span", { class: "lg owner-carrier" }, "Carrier"), el("span", { class: "lg owner-team" }, "Team"), el("span", { class: "lg milestone" }, "Milestone"))
}

export { isoDate, PLANNING_DATE, fmt }
