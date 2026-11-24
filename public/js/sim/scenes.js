/** Small animated SVG scenes for the outcome panel: the CFD programme, the facility and the trackside loop. */
import { svg, el, fmt } from "./dom.js"

// A side-on single-seater: front wing, nose, cockpit, engine cover, rear wing.
const CAR = "M 0 38 L 26 38 L 28 34 L 56 34 L 78 30 L 96 22 L 112 20 L 128 24 L 150 30 L 168 34 L 172 20 L 180 20 L 180 44 L 0 44 Z"

/** Streamlines over a car: more effective runs → more, faster streams; throttling closes a shutter. */
export function computeScene(result) {
  const c = result.comp
  const streams = Math.max(2, Math.min(9, Math.round(c.runsPerWeek / 5)))
  const speed = Math.max(1.2, 4 - c.effectiveRatio * 2)
  const node = svg("svg", { viewBox: "0 0 320 110", class: "scene compute-scene", role: "img", "aria-label": `${fmt.num(c.runsPerWeek, 0)} CFD runs a week, ${fmt.pct(c.effectiveRatio)} of the allowance turned into work` })
  node.append(svg("rect", { class: "tunnel", x: 4, y: 6, width: 312, height: 98, rx: 10 }))
  for (let i = 0; i < streams; i++) {
    const y = 20 + (i * 70) / (streams - 1 || 1)
    const bend = y > 30 && y < 70 ? -10 : 0
    node.append(svg("path", {
      class: "stream", d: `M 12 ${y} C 80 ${y}, 110 ${y + bend}, 160 ${y + bend} S 240 ${y}, 308 ${y}`,
      style: { animationDuration: `${speed}s`, animationDelay: `${(i * 0.17).toFixed(2)}s` },
    }))
  }
  node.append(svg("path", { class: "car", d: CAR, transform: "translate(70 28)" }))
  node.append(svg("circle", { class: "wheel", cx: 112, cy: 72, r: 9 }), svg("circle", { class: "wheel", cx: 226, cy: 72, r: 9 }))
  if (c.throttle < 1) {
    node.append(svg("rect", { class: "shutter", x: 4, y: 6, width: 312 * (1 - c.throttle), height: 98, rx: 10 }))
    node.append(svg("text", { x: 12, y: 98, class: "scene-text" }, `${Math.round(c.idleShare * 100)} % idles under the ATR`))
  } else {
    node.append(svg("text", { x: 12, y: 98, class: "scene-text" }, `${fmt.num(c.runsPerWeek, 0)} runs a week · ${fmt.hours(c.turnaroundHours)} turnaround`))
  }
  return node
}

/** Racks in a hall with a power meter and a cooling loop; heat reuse adds a pipe to the district. */
export function facilityScene(result) {
  const x = result.inputs
  const fac = result.fac
  const hw = result.hw
  const atDr = fac.clusterSite === "dr"
  const node = svg("svg", { viewBox: "0 0 320 110", class: "scene facility-scene", role: "img", "aria-label": `${atDr ? "Digital Realty Zurich" : "Hinwil room"}: ${Math.round(atDr ? fac.drIT : fac.hinwilIT)} kW of IT load, PUE ${fac.pue.toFixed(2)}` })
  node.append(svg("rect", { class: "hall", x: 4, y: 18, width: 206, height: 86, rx: 8 }))
  node.append(svg("text", { x: 12, y: 12, class: "scene-title" }, atDr ? "Digital Realty Zurich · ZUR campus" : x.hinwilRetrofit ? "Hinwil room (retrofitted)" : "Hinwil room"))
  // One rack per real rack (capped for the drawing); each server is a slot with a blinking LED.
  const racks = Math.max(1, Math.min(6, hw.racks || 1))
  const servers = x.nodes + Math.ceil(x.gpus / 8)
  const perRack = Math.max(1, Math.ceil(servers / racks))
  let drawn = 0
  for (let i = 0; i < racks; i++) {
    const rx = 14 + i * 29
    node.append(svg("rect", { class: `rack cool-${x.cooling}`, x: rx, y: 30, width: 22, height: 58, rx: 2 }))
    const slots = Math.min(perRack, 10, Math.max(0, servers - drawn))
    for (let j = 0; j < slots; j++) {
      const sy = 34 + j * 5.2
      node.append(svg("rect", { class: "server", x: rx + 3, y: sy, width: 16, height: 3.6, rx: 0.8 }))
      node.append(svg("circle", { class: "led", cx: rx + 17, cy: sy + 1.8, r: 1.1, style: { animationDelay: `${((i * 7 + j) % 9) * 0.19}s` } }))
    }
    drawn += slots
  }
  if (x.cooling !== "air") node.append(svg("path", { class: "coolant", d: `M 14 95 H ${14 + racks * 29 - 7}` }))
  if (fac.heatMWh > 0) node.append(svg("path", { class: "heat-pipe", d: `M ${14 + racks * 29 - 7} 95 H 210` }))
  const load = atDr ? fac.drIT : fac.hinwilIT
  const cap = atDr ? fac.drCapacity : fac.hinwilCapacity
  const frac = Math.min(1, cap > 0 ? load / cap : 1)
  node.append(svg("rect", { class: "meter-track", x: 220, y: 22, width: 92, height: 10, rx: 5 }))
  node.append(svg("rect", { class: `meter-fill ${fac.powerShortKW > 0 ? "over" : ""}`, x: 220, y: 22, width: Math.max(2, 92 * frac), height: 10, rx: 5 }))
  node.append(svg("text", { x: 220, y: 45, class: "scene-text sm" }, `${Math.round(load)} / ${cap} kW IT`))
  node.append(svg("text", { x: 220, y: 59, class: "scene-text sm" }, `PUE ${fac.pue.toFixed(2)} · ${x.redundancy.toUpperCase().replace("N1", "N+1")}`))
  node.append(svg("text", { x: 220, y: 73, class: "scene-text sm" }, x.cooling === "dlc" ? "Direct liquid cooling" : x.cooling === "reardoor" ? "Rear-door cooling" : "Air cooling"))
  node.append(svg("text", { x: 220, y: 87, class: "scene-text sm" }, `${servers} server${servers === 1 ? "" : "s"} · ${hw.racks} rack${hw.racks === 1 ? "" : "s"}`))
  if (fac.heatMWh > 0) node.append(svg("text", { x: 220, y: 101, class: "scene-text sm warm" }, `${fmt.num(fac.heatMWh, 0)} MWh heat reused`))
  else if (fac.powerShortKW > 0) node.append(svg("text", { x: 220, y: 101, class: "scene-text sm bad" }, `${Math.round(fac.powerShortKW)} kW short of capacity`))
  else node.append(svg("text", { x: 220, y: 101, class: "scene-text sm" }, atDr ? "100 % renewable energy" : x.renewable ? "Renewable tariff" : "Swiss grid mix"))
  return node
}

/** Track → garage → carrier → campus → Hinwil with packets whose travel time follows the venue's RTT. */
export function tracksideScene(result) {
  const x = result.inputs
  const net = result.net
  const stops = x.location === "hinwil"
    ? [{ x: 40, label: net.venue.name }, { x: 160, label: x.edge ? "Garage · edge" : "Garage" }, { x: 280, label: "Hinwil" }]
    : [{ x: 36, label: net.venue.name }, { x: 118, label: x.edge ? "Garage · edge" : "Garage" }, { x: 204, label: "Zurich campus" }, { x: 286, label: "Hinwil" }]
  const SHORT = { internet: "Public internet", carrier: "One carrier circuit", dual: "Two diverse carriers", dualsat: "Two carriers + satellite" }
  const node = svg("svg", { viewBox: "0 0 320 110", class: "scene trackside-scene", role: "img", "aria-label": `Paddock to factory: ${fmt.ms(net.venue.rttMs)} round trip, ${net.venue.decisionSec.toFixed(1)} s from car to decision` })
  const y = 50
  for (let i = 0; i < stops.length - 1; i++) {
    node.append(svg("line", { class: `route ${i === 0 ? `link-${x.trackside}` : "link-fibre"}`, x1: stops[i].x, y1: y, x2: stops[i + 1].x, y2: y }))
    if (i === 0 && (x.trackside === "dual" || x.trackside === "dualsat")) node.append(svg("path", { class: "route route-alt", d: `M ${stops[i].x} ${y} Q ${(stops[i].x + stops[i + 1].x) / 2} ${y - 26} ${stops[i + 1].x} ${y}` }))
    if (i === 0 && x.trackside === "dualsat") node.append(svg("path", { class: "route route-sat", d: `M ${stops[i].x} ${y} Q ${(stops[i].x + stops[i + 1].x) / 2} ${y + 30} ${stops[i + 1].x} ${y}` }))
    if (i > 0 && x.fibrePairs === 2 && x.location !== "hinwil") node.append(svg("path", { class: "route route-alt", d: `M ${stops[i].x} ${y} Q ${(stops[i].x + stops[i + 1].x) / 2} ${y - 22} ${stops[i + 1].x} ${y}` }))
  }
  for (const s of stops) {
    node.append(svg("circle", { class: "stop", cx: s.x, cy: y, r: 7 }))
    node.append(svg("text", { x: s.x, y: y + 24, class: "scene-text", "text-anchor": "middle" }, s.label))
  }
  const last = stops[stops.length - 1].x
  const dur = Math.max(1.2, Math.min(5, net.venue.rttMs / 60))
  for (let i = 0; i < 3; i++) {
    const dot = svg("circle", { class: "packet", r: 3.5 })
    dot.append(svg("animateMotion", { dur: `${dur}s`, repeatCount: "indefinite", begin: `${(i * dur) / 3}s`, path: `M ${stops[0].x} ${y} H ${last}` }))
    node.append(dot)
  }
  node.append(svg("text", { x: 12, y: 14, class: "scene-title" }, `${fmt.ms(net.venue.rttMs)} round trip · ${net.venue.decisionSec.toFixed(1)} s car-to-decision`))
  node.append(svg("text", { x: 12, y: 100, class: "scene-text" }, `${SHORT[x.trackside]} · ${fmt.availability(net.linkAvailability)} available · ${net.headroom.toFixed(1)}× headroom`))
  return node
}

export function sceneCard(title, scene, caption) {
  return el("div", { class: "scene-card" }, el("h4", {}, title), scene, caption ? el("p", { class: "scene-caption" }, caption) : null)
}
