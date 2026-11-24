/**
 * SVG diagrams for the component views: the compute architecture of one season and the rack layout
 * of the room it lives in. Both read a simulate() result and draw only what the plan says.
 */
import { svg } from "./dom.js"
import { CONTROLS } from "./model.js"
import { K } from "./assumptions.js"
import { FIGURES as F } from "../customer.js"

const optionLabel = (id, value) => CONTROLS[id].options?.find((o) => o.value === value)?.label || String(value)
const text = (x, y, cls, content, attrs = {}) => svg("text", { x, y, class: cls, ...attrs }, content)
const box = (x, y, w, h, cls, rx = 8) => svg("rect", { x, y, width: w, height: h, rx, class: cls })
const consumptionLabel = (x) => (x.consumption === "greenlake" ? `HPE GreenLake · ${x.committedPct} % reserved · ${x.termYears}-year term` : `Purchased · refresh every ${x.refreshYears} years`)

/** Little squares in a grid, at most `max` drawn; returns the nodes and the height used. */
function chipGrid(x, y, count, { cols, size = 10, gap = 3, cls = "chip", max = 48, highlight = 0, hlClass = "chip solver" }) {
  const out = []
  const shown = Math.min(count, max)
  for (let i = 0; i < shown; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    out.push(svg("rect", { x: x + c * (size + gap), y: y + r * (size + gap), width: size, height: size, rx: 2, class: i < highlight ? hlClass : cls }))
  }
  const rows = Math.max(1, Math.ceil(shown / cols))
  return { nodes: out, height: rows * (size + gap) - gap, truncated: count > max }
}

// ---------------------------------------------------------------------------------------------
// Compute architecture
// ---------------------------------------------------------------------------------------------

/**
 * One season's estate: engineers at Hinwil, the fibre, the campus cage with CPU nodes, the GPU
 * partition, fabric, storage and the GreenLake buffer, plus cross-connects and cloud on-ramps.
 */
export function architecture(sim, { year } = {}) {
  const x = sim.inputs
  const hw = sim.hw
  const atDr = x.location !== "hinwil"
  const W = 640
  const H = 288
  const node = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "arch", role: "img", "aria-label": `${year || x.season} architecture: ${x.nodes} CPU nodes${x.gpus ? `, ${x.gpus} GPUs` : ""} at ${atDr ? "Digital Realty Zurich" : "Hinwil"}` })
  const redundancy = x.redundancy.toUpperCase().replace("N1", "N+1")

  // Title line
  node.append(text(12, 20, "arch-title", `${year || x.season} · ${atDr ? (x.location === "hybrid" ? "Hybrid: solver estate on the campus, Mission Control in Hinwil" : "Whole estate on the campus") : "Everything in the Hinwil room"}`))
  node.append(text(W - 12, 20, "arch-note", `${Math.round(hw.clusterKW)} kW cluster · ${Math.round((atDr ? sim.fac.drIT : sim.fac.hinwilIT) - hw.clusterKW)} kW rest of estate`, { "text-anchor": "end" }))

  // Sites: a small Hinwil box and the campus cage, or one wide Hinwil room
  const sy = 40
  const sh = 168
  const cx = atDr ? 262 : 12
  const cw = atDr ? W - 12 - cx : W - 24
  if (atDr) {
    node.append(box(12, sy, 140, sh, "arch-site hinwil"))
    node.append(text(24, sy + 20, "arch-site-title", "Hinwil"))
    node.append(text(24, sy + 36, "arch-note", "Aero engineers"))
    node.append(text(24, sy + 50, "arch-note", "Wind tunnel · office IT"))
    node.append(text(24, sy + 64, "arch-note", x.location === "hybrid" ? "Mission Control · simulator" : "Everything else moves"))
    if (x.location === "hybrid") node.append(text(24, sy + 78, "arch-note", `${K.facility.hybridHinwilKW} kW stays in the room`))
    node.append(box(cx, sy, cw, sh, "arch-site dr"))
    node.append(text(cx + 12, sy + 20, "arch-site-title dr", "Digital Realty Zurich · cage"))
    node.append(text(cx + 12, sy + 36, "arch-note", `${hw.racks} rack${hw.racks === 1 ? "" : "s"} × ${x.rackKW} kW · ${optionLabel("cooling", x.cooling).toLowerCase()} · ${redundancy} · ${Math.round(sim.fac.drIT)} kW IT`))
    // Fibre in the gap between the sites
    const y1 = sy + 96
    const y2 = sy + 112
    const mid = (152 + cx) / 2
    node.append(svg("line", { class: "arch-fibre", x1: 152, y1, x2: cx, y2: y1 }))
    if (x.fibrePairs === 2) node.append(svg("line", { class: "arch-fibre alt", x1: 152, y1: y2, x2: cx, y2 }))
    node.append(text(mid, y1 - 8, "arch-link-text", x.fibrePairs === 2 ? "2 diverse routes" : "1 route", { "text-anchor": "middle" }))
    node.append(text(mid, y2 + 16, "arch-link-text", `${x.fibreGbps}G · ${F.sites.campus.fibreKm} km · ${F.sites.campus.rttMs} ms`, { "text-anchor": "middle" }))
  } else {
    node.append(box(cx, sy, cw, sh, "arch-site hinwil"))
    node.append(text(cx + 12, sy + 20, "arch-site-title", `Hinwil · room${x.hinwilRetrofit ? " (retrofit)" : ""}`))
    node.append(text(cx + 12, sy + 36, "arch-note", `Aero engineers, wind tunnel, Mission Control and simulator in the building · ${hw.racks} rack${hw.racks === 1 ? "" : "s"} × ${x.rackKW} kW · ${optionLabel("cooling", x.cooling).toLowerCase()} · ${redundancy} · ${Math.round(sim.fac.hinwilIT)} of ${sim.fac.hinwilCapacity} kW`))
  }

  // Partitions inside the cage: CPU nodes (+ GreenLake buffer), GPU partition; fabric and storage along the bottom
  const px = cx + 12
  const py = sy + 48
  const cpuCols = atDr ? 14 : 26
  const cpuW = cpuCols * 13
  node.append(text(px, py + 10, "arch-part-title", `CPU · ${x.nodes} nodes · ${hw.cores} cores`))
  node.append(text(px, py + 23, "arch-note", `${optionLabel("coresPerNode", x.coresPerNode)} cores · ${optionLabel("memoryGB", x.memoryGB)} · ${x.clockGHz.toFixed(1)} GHz declared`))
  const cpu = chipGrid(px, py + 30, x.nodes, { cols: cpuCols, max: cpuCols * 2 })
  node.append(...cpu.nodes)
  if (cpu.truncated) node.append(text(px + cpuW + 4, py + 30 + 22, "arch-note", `+${x.nodes - cpuCols * 2}`))
  if (x.nodes === 0) node.append(text(px, py + 40, "arch-note warn", "No CPU nodes in this season"))
  if (x.consumption === "greenlake" && hw.bufferNodes > 0) {
    const used = cpu.nodes.length
    const col = used % cpuCols
    const row = Math.floor(used / cpuCols)
    const fits = col + hw.bufferNodes <= cpuCols
    const buf = chipGrid(px + (fits ? col : 0) * 13, py + 30 + (fits ? row : row + 1) * 13, hw.bufferNodes, { cols: cpuCols, max: 8, cls: "chip buffer" })
    node.append(...buf.nodes)
    node.append(text(px, py + 30 + (fits ? row + 1 : row + 2) * 13 + 9, "arch-note", `+ ${hw.bufferNodes} GreenLake buffer node${hw.bufferNodes === 1 ? "" : "s"} on site`))
  }
  const gx = px + cpuW + 16
  if (x.gpus > 0) {
    const solver = sim.comp.gpuSolverN
    const blocked = sim.comp.gpuBlocked
    node.append(text(gx, py + 10, `arch-part-title ${blocked ? "warn" : ""}`, `GPU · ${x.gpus} × ${optionLabel("gpuModel", x.gpuModel).split(" ·")[0].replace("NVIDIA ", "").replace("AMD ", "")}`))
    node.append(text(gx, py + 23, "arch-note", blocked ? `${x.solverGpus} in the solver: not before 2028` : solver > 0 ? `${solver} in the solver · ${x.gpus - solver} pre/post & ML` : "pre/post & ML only (no AUh)"))
    node.append(...chipGrid(gx, py + 30, x.gpus, { cols: 11, max: 33, cls: "chip gpu", highlight: blocked ? 0 : solver, hlClass: "chip gpu solver" }).nodes)
  } else {
    node.append(text(gx, py + 10, "arch-part-title muted", "GPU · none"))
    node.append(text(gx, py + 23, "arch-note", x.season >= K.fia.gpuAllowedFrom ? "allowed in the solver (F4.4.1)" : "solver GPUs from 1 Jan 2028"))
  }
  const fy = sy + sh - 46
  node.append(box(px, fy, cw - 24, 12, "arch-fabric", 4))
  node.append(text(px + 6, fy + 9.5, "arch-fabric-text", `Fabric · ${optionLabel("interconnect", x.interconnect)}`))
  node.append(text(px, fy + 24, "arch-note", `Storage · ${optionLabel("storage", x.storage)}`))
  node.append(text(px, fy + 36, "arch-note", consumptionLabel(x)))

  // Five columns under the sites: the paddock (team) and the campus services (Digital Realty)
  const colW = (W - 24) / 5
  const ry = sy + sh + 24
  node.append(svg("line", { class: "arch-divider", x1: 12, y1: ry - 16, x2: W - 12, y2: ry - 16 }))
  const support = x.support === "mission" ? "HPE mission-critical" : x.support === "4h" ? "HPE 4-hour response" : "HPE next business day"
  const cols = [
    [`Paddock${x.edge ? " · edge box" : ""}`, optionLabel("trackside", x.trackside).replace(" (encrypted tunnels)", "").replace("Two diverse carrier circuits", "Two diverse carriers").replace("One carrier circuit (100 Mbps)", "One carrier circuit").replace("Two carriers + satellite backup", "2 carriers + satellite"), "team"],
    ...(atDr ? [
      ["Cross-connects ×2", "carrier meet-me room", "dr"],
      [x.cloudOnRamp ? "Cloud on-ramps" : "No cloud on-ramps", x.cloudOnRamp ? "ServiceFabric · AWS · Azure" : "bursts stay on-prem", "dr"],
      ["Remote Hands", support, "dr"],
      ["Power & cooling", `PUE ${sim.fac.pue.toFixed(2)}${x.heatReuse ? " · heat reuse" : x.renewable ? " · renewable" : ""}`, "dr"],
    ] : [
      ["Room power", `${sim.fac.hinwilIT > sim.fac.hinwilCapacity ? "short by " + Math.round(sim.fac.hinwilShortKW) + " kW" : Math.round(sim.fac.hinwilCapacity - sim.fac.hinwilIT) + " kW headroom"}`, "team"],
      ["Cooling", `${optionLabel("cooling", x.cooling)} · PUE ${sim.fac.pue.toFixed(2)}`, "team"],
      ["Support", support, "team"],
      ["No campus services", "nothing to interconnect", "muted"],
    ]),
  ]
  cols.forEach(([title, sub, who], i) => {
    const ix = 12 + i * colW
    node.append(text(ix, ry, `arch-svc-title ${who}`, title))
    node.append(text(ix, ry + 14, "arch-note", sub))
  })

  // Legend
  node.append(svg("text", { x: 12, y: H - 10, class: "arch-legend" },
    svg("tspan", { class: "lg-team" }, "■"), " the team's site · ",
    svg("tspan", { class: "lg-dr" }, "■"), " Digital Realty provides · ",
    svg("tspan", { class: "lg-hpe" }, "■"), " CPU nodes · ",
    svg("tspan", { class: "lg-gpu" }, "■"), " GPUs (", svg("tspan", { class: "lg-solver" }, "■"), " in the solver) · ",
    svg("tspan", { class: "lg-buffer" }, "■"), " GreenLake buffer"))
  return node
}

// ---------------------------------------------------------------------------------------------
// Rack layout
// ---------------------------------------------------------------------------------------------

/**
 * Front elevation of the room the cluster lives in: cluster racks filled to their load, the rest
 * of the estate as a block, the ML partition rows, feeds per redundancy and cooling per rack, inside the 500 kW envelope.
 */
export function rackLayout(sim, { year } = {}) {
  const x = sim.inputs
  const hw = sim.hw
  const atDr = sim.fac.clusterSite === "dr"
  const W = 640
  const H = 256
  const node = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "racks", role: "img", "aria-label": `${year || x.season} rack layout: ${hw.racks} cluster racks at ${x.rackKW} kW, ${optionLabel("cooling", x.cooling)} cooling, ${x.redundancy.toUpperCase().replace("N1", "N+1")}` })
  const site = atDr ? `Digital Realty Zurich · suite` : "Hinwil room"
  const capacity = atDr ? sim.fac.drCapacity : sim.fac.hinwilCapacity
  const load = atDr ? sim.fac.drIT : sim.fac.hinwilIT
  node.append(text(12, 20, "arch-title", `${year || x.season} · ${site}`))
  node.append(text(W - 12, 20, `arch-note ${sim.fac.powerShortKW > 0 ? "warn" : ""}`, `${Math.round(load)} kW of ${capacity} kW${atDr ? ` envelope · ${sim.fac.racks.total} of ${K.facility.cageRackPositions} rack positions` : ""}`, { "text-anchor": "end" }))

  // Floor
  const floorY = 186
  node.append(svg("line", { class: "rack-floor", x1: 12, y1: floorY, x2: W - 12, y2: floorY }))

  // Cluster racks
  const rackW = 34
  const rackH = 120
  const gap = 10
  const maxRacks = 10
  const shown = Math.min(hw.racks, maxRacks)
  const perRackKW = hw.racks ? hw.clusterKW / hw.racks : 0
  const fill = x.rackKW ? Math.min(1, perRackKW / x.rackKW) : 0
  const over = x.rackKW > sim.fac.coolingMax
  let rx = 24
  for (let i = 0; i < shown; i++) {
    const y = floorY - rackH
    node.append(box(rx, y, rackW, rackH, `rack ${over ? "hot" : ""}`, 3))
    // load fill from the bottom
    node.append(svg("rect", { x: rx + 3, y: y + 3 + (rackH - 6) * (1 - fill), width: rackW - 6, height: (rackH - 6) * fill, rx: 2, class: `rack-load ${over ? "hot" : ""}` }))
    // cooling: rear-door panel on the right edge, liquid manifold on the left
    if (x.cooling === "reardoor") node.append(svg("rect", { x: rx + rackW - 4, y: y + 6, width: 4, height: rackH - 12, class: "rack-door" }))
    if (x.cooling === "dlc") node.append(svg("rect", { x: rx - 4, y: y + 6, width: 4, height: rackH - 12, class: "rack-manifold" }))
    // feeds
    node.append(svg("line", { class: "rack-feed a", x1: rx + 8, y1: floorY, x2: rx + 8, y2: floorY + 12 }))
    if (x.redundancy !== "n") node.append(svg("line", { class: `rack-feed b ${x.redundancy === "2n" ? "full" : ""}`, x1: rx + rackW - 8, y1: floorY, x2: rx + rackW - 8, y2: floorY + 12 }))
    if (i === 0) {
      node.append(text(rx + 8, floorY + 22, "rack-feed-text", "A", { "text-anchor": "middle" }))
      if (x.redundancy !== "n") node.append(text(rx + rackW - 8, floorY + 22, "rack-feed-text", "B", { "text-anchor": "middle" }))
    }
    rx += rackW + gap
  }
  if (hw.racks > maxRacks) node.append(text(rx, floorY - rackH / 2, "arch-note", `+${hw.racks - maxRacks} more`))
  if (hw.racks === 0) node.append(text(24, floorY - 40, "arch-note warn", "No cluster racks in this season"))
  const clusterRight = Math.max(rx, 24 + rackW)
  node.append(text(24, floorY - rackH - 10, "arch-part-title", `Restricted CFD cluster · ${hw.racks} rack${hw.racks === 1 ? "" : "s"} × ${x.rackKW} kW`))
  node.append(text(24, floorY + 38, "arch-note", `${Math.round(perRackKW)} kW per rack · ${optionLabel("cooling", x.cooling).toLowerCase()} to ${sim.fac.coolingMax} kW${over ? " · over the cooling limit" : ""}`))

  // CDU for liquid, chilled-water branch for rear-door
  if (x.cooling === "dlc") {
    node.append(box(clusterRight + 6, floorY - 46, 28, 46, "rack-cdu", 3))
    node.append(text(clusterRight + 20, floorY - 20, "rack-cdu-text", "CDU", { "text-anchor": "middle" }))
  }

  // Rest of the estate as one block
  const mlKW = atDr ? sim.fac.mlAtDr : sim.fac.mlAtHinwil
  const restKW = Math.max(0, load - hw.clusterKW - mlKW)
  const restX = Math.max(clusterRight + (x.cooling === "dlc" ? 46 : 16), 300)
  const restW = Math.min(W - 12 - restX - (mlKW > 0 ? 120 : 0), 220)
  if (restKW > 0 && restW > 60) {
    node.append(box(restX, floorY - rackH, restW, rackH, "rack-rest", 3))
    node.append(text(restX + restW / 2, floorY - rackH / 2 - 8, "arch-part-title", `Rest of the estate · ${Math.round(restKW)} kW`, { "text-anchor": "middle" }))
    node.append(text(restX + restW / 2, floorY - rackH / 2 + 8, "arch-note", x.location === "hybrid" ? "FEA, enterprise IT; Mission Control stays in Hinwil" : x.season >= 2028 ? "enterprise IT · FEA · unrestricted ML partition" : "enterprise IT · FEA · simulator · trackside", { "text-anchor": "middle" }))
    node.append(text(restX + restW / 2, floorY - rackH / 2 + 22, "arch-note", "drawn as a block: no rack plan in the model", { "text-anchor": "middle" }))
  }

  // ML partition rows (dashed) when a partition is placed in this room
  if (mlKW > 0) {
    const ex = W - 12 - 104
    const mlRacks = Math.min(3, Math.max(1, Math.ceil(mlKW / Math.max(1, x.rackKW))))
    for (let i = 0; i < mlRacks; i++) node.append(box(ex + i * 36, floorY - 80, 28, 80, "rack-expansion", 3))
    node.append(text(ex + 50, floorY - 90, "arch-note", `ML partition · ${mlKW} kW`, { "text-anchor": "middle" }))
  }

  // Power feeds legend and facility figures
  node.append(text(12, floorY + 56, "arch-legend", `Feeds: ${x.redundancy === "2n" ? "A + B, 2N UPS" : x.redundancy === "n1" ? "A + B, N+1" : "single feed (N)"} · ${(sim.fac.availability * 100).toFixed(2)} % facility availability · PUE ${sim.fac.pue.toFixed(2)}${atDr ? ` · ${x.renewable ? "100 % renewable" : "standard tariff"}` : ""}`))
  return node
}
