/**
 * The live scenario at the top of every table: one SVG scene per table that defines the customer's
 * situation and reacts to every dial. CFD is an F1 car in a wind tunnel, Datacenter & Power is a
 * hall cross-section, Connectivity is data travelling from Austin to the factory, and OEMs is a rack
 * row with its budget purse. The headline is always the same: seconds found per lap.
 *
 * Pure SVG + CSS (plus SMIL motion for the data packets, which Safari supports natively). Animations
 * pause while the page is hidden. `still` scenes (thumbnails) carry no animation at all.
 */
import * as C from "./catalog.js"
import { boardFor, pickedOption } from "./model.js"

const NS = "http://www.w3.org/2000/svg"
/** A tiny HTML builder, so the labels below stay importable (and testable) outside the browser. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v)
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return node
}
let uid = 0

function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v)
  for (const c of children.flat()) if (c) node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return node
}
const text = (x, y, value, attrs = {}) => s("text", { x, y, ...attrs }, value)
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const show = (node, on) => node.classList.toggle("off", !on)
const money = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`)
const opt = (board, dial) => pickedOption(dial, board.choices)

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("anim-paused", document.hidden)
    for (const svgNode of document.querySelectorAll("svg.scene-svg.live")) {
      try { document.hidden ? svgNode.pauseAnimations() : svgNode.unpauseAnimations() } catch { /* SMIL unsupported */ }
    }
  })
}

/** A clean side-profile F1 car, nose to the left, sitting on y = 200. Shared with the projector ladder. */
export const CAR_PATH = "M238 192 L262 186 L330 180 L380 174 L410 160 L440 150 L462 136 L478 132 L492 136 L500 148 L530 152 L552 150 L556 124 L590 118 L592 126 L580 130 L578 192 Z M226 198 L282 198 L284 189 L232 191 Z"
export const CAR_VIEWBOX = "220 112 380 104"

function car() {
  return s("g", { class: "car-body" },
    s("path", { d: CAR_PATH, class: "car-shell" }),
    s("path", { d: "M455 142 Q470 118 494 136", class: "car-halo" }),
    s("circle", { cx: 300, cy: 190, r: 18, class: "wheel" }),
    s("circle", { cx: 532, cy: 188, r: 22, class: "wheel" }))
}

function fiaFlag(x, y, rule) {
  return s("g", { class: "fia-flag off", transform: `translate(${x} ${y})` },
    s("line", { x1: 0, y1: 0, x2: 0, y2: 46, class: "flag-pole" }),
    s("path", { d: "M0 0 L44 8 L0 18 Z", class: "flag-cloth" }),
    text(0, 62, `FIA ${rule}`, { class: "flag-text" }))
}

/* ------------------------------------------------------------ CFD: the wind tunnel */

const LINE_YS = [40, 51, 62, 73, 84, 95, 106, 117, 128, 139, 150, 161, 172, 186]
const LINE_ORDER = [8, 3, 11, 0, 6, 13, 9, 2, 5, 12, 1, 7, 10, 4]

function streamPaths(y) {
  const lift = Math.max(0, 44 - Math.abs(y - 150) * 0.55)
  const head = `M14 ${y} C 200 ${y}, 260 ${y - lift}, 400 ${y - lift}`
  return {
    smooth: `${head} S 640 ${y}, 786 ${y}`,
    rough: `${head} S 560 ${y + 7}, 600 ${y - 9} S 670 ${y + 12}, 712 ${y - 7} S 770 ${y + 5}, 786 ${y}`,
  }
}

function computeScene(root) {
  root.append(s("rect", { x: 6, y: 6, width: 788, height: 228, rx: 16, class: "tunnel" }))
  root.append(s("line", { x1: 14, y1: 212, x2: 786, y2: 212, class: "tunnel-floor" }))
  const lines = LINE_YS.map((y) => {
    const d = streamPaths(y)
    const node = s("path", { d: d.smooth, class: "stream" })
    root.append(node)
    return { node, d }
  })
  const arrows = s("g", { class: "downforce" }, [340, 440, 540].map((x) => s("g", { class: "df-arrow", transform: `translate(${x} 62)` },
    s("g", { class: "df-inner" }, s("line", { x1: 0, y1: 0, x2: 0, y2: 52 }), s("path", { d: "M-8 44 L0 60 L8 44 Z" })))))
  root.append(arrows, car())
  const display = s("g", { class: "tunnel-display" },
    s("rect", { x: 586, y: 18, width: 196, height: 78, rx: 8 }))
  const cyclesText = text(598, 42, "", { class: "disp-line" })
  const targetText = text(598, 62, "", { class: "disp-sub" })
  const lapText = text(598, 86, "", { class: "disp-big" })
  display.append(cyclesText, targetText, lapText)
  const counter = text(26, 34, "", { class: "scene-counter" })
  const flag = fiaFlag(40, 120, "2.4")
  root.append(display, counter, flag)
  return (board) => {
    const v = board.values
    const cycles = Math.round(v.cycles * 10) / 10
    const visible = Math.round(clamp(3 + cycles * 0.75, 3, 14))
    const smooth = v.feed >= 90 && v.cycles >= 10
    LINE_ORDER.forEach((index, rank) => {
      const line = lines[index]
      show(line.node, rank < visible)
      line.node.setAttribute("d", smooth ? line.d.smooth : line.d.rough)
      line.node.classList.toggle("rough", !smooth)
    })
    root.dataset.streams = String(visible)
    root.dataset.flow = smooth ? "smooth" : "turbulent"
    const grow = 0.35 + 0.65 * clamp(v.cycles / 16)
    arrows.style.setProperty("--df", grow.toFixed(2))
    const over = v.usage > 100
    show(flag, over)
    cyclesText.textContent = over ? `${cycles} cycles a week: not allowed` : `${cycles} cycles a week`
    cyclesText.classList.toggle("bad", over || v.cycles < 10)
    targetText.textContent = `Target 10+ · ${Math.round(v.usage)}% of FIA cap`
    lapText.textContent = !board.allowed ? "Not allowed" : board.seconds > 0 ? `Lap time −${board.seconds.toFixed(2)} s` : "Lap time: no gain yet"
    counter.textContent = `Aero efficiencies found this week: ${over ? 0 : Math.round(v.cycles * 2)}`
  }
}

/* ------------------------------------------------------------ Datacenter & Power: the hall */

const SITE_NAME = { factory: "Factory server room", colo: "Colo near the factory", cheap: "Cheap-power region" }

function dcScene(root) {
  root.append(s("rect", { x: 6, y: 6, width: 788, height: 228, rx: 16, class: "sky" }))
  root.append(s("path", { d: "M150 214 L150 58 L400 34 L650 58 L650 214 Z", class: "hall" }))
  const sign = text(400, 80, "", { class: "hall-sign", "text-anchor": "middle" })
  const racks = s("g", { class: "racks" })
  for (let i = 0; i < 6; i++) {
    const x = 186 + i * 72
    racks.append(s("g", { class: "rack", transform: `translate(${x} 96)` },
      s("rect", { x: 0, y: 0, width: 44, height: 112, rx: 3, class: "rack-box" }),
      [12, 34, 56, 78].map((y) => s("rect", { x: 6, y, width: 32, height: 10, rx: 2, class: "rack-led" })),
      s("rect", { x: 44, y: 4, width: 6, height: 104, class: "reardoor" })))
  }
  const shimmer = s("g", { class: "shimmer off" }, [232, 304, 518, 590].map((x) => s("path", { d: `M${x} 92 q 8 -10 0 -20 q -8 -10 0 -20`, class: "heat" })))
  const air = s("g", { class: "cool-air off" },
    s("rect", { x: 160, y: 120, width: 18, height: 70, rx: 3, class: "crac" }),
    [128, 150, 172].map((y) => s("path", { d: `M180 ${y} L 610 ${y}`, class: "air-flow" })))
  const liquid = s("g", { class: "cool-liquid off" },
    s("path", { d: "M170 206 L 630 206 L 630 98 L 616 98", class: "pipe" }),
    s("path", { d: "M170 206 L 630 206 L 630 98 L 616 98", class: "pipe-flow" }))
  const throttle = text(400, 230, "", { class: "throttle-text", "text-anchor": "middle" })
  const gens = s("g", { class: "gens off" }, [150, 186].map((y) => s("g", { transform: `translate(40 ${y})` },
    s("rect", { x: 0, y: -16, width: 70, height: 28, rx: 4, class: "gen" }), text(35, 3, "N+1", { class: "gen-text", "text-anchor": "middle" }))))
  const feed = text(75, 140, "", { class: "feed-text", "text-anchor": "middle" })
  const pue = s("g", { class: "meter-v", transform: "translate(690 30)" },
    s("rect", { x: 0, y: 0, width: 26, height: 160, rx: 6, class: "meter-track" }))
  const pueFill = s("rect", { x: 3, width: 20, rx: 4, class: "meter-fill" })
  const pueTarget = s("line", { x1: -8, x2: 34, class: "meter-target" })
  const pueText = text(13, 180, "", { class: "meter-text", "text-anchor": "middle" })
  pue.append(pueFill, pueTarget, pueText, text(13, 196, "target 1.30", { class: "meter-sub", "text-anchor": "middle" }))
  const powerTrack = s("rect", { x: 150, y: 20, width: 260, height: 10, rx: 5, class: "meter-track" })
  const powerFill = s("rect", { x: 150, y: 20, height: 10, rx: 5, class: "meter-fill" })
  const powerText = text(420, 29, "", { class: "meter-text" })
  root.append(sign, gens, feed, racks, air, liquid, shimmer, throttle, pue, powerTrack, powerFill, s("line", { x1: 150 + 260 / 1.3, y1: 14, x2: 150 + 260 / 1.3, y2: 36, class: "meter-target" }), powerText)
  return (board) => {
    const v = board.values
    const ch = board.choices
    sign.textContent = SITE_NAME[ch.location]
    const gpu = Math.round(clamp(v.capacity / 100) * 100)
    racks.classList.toggle("throttled", gpu < 100)
    racks.classList.toggle("boost", ch.power === "boost" && gpu >= 100)
    root.dataset.glow = gpu < 100 ? "throttled" : ch.power === "boost" ? "boost" : "full"
    racks.style.setProperty("--glow", (0.25 + 0.75 * gpu / 100).toFixed(2))
    throttle.textContent = gpu < 100 ? `GPUs running at ${gpu}%` : `GPUs at 100%${ch.power === "cap85" ? " (85% power cap)" : ""}`
    throttle.classList.toggle("bad", gpu < 100)
    show(shimmer, ch.cooling === "air" && (ch.power === "boost" || gpu < 100))
    show(air, ch.cooling === "air")
    racks.classList.toggle("has-reardoor", ch.cooling === "reardoor")
    show(liquid, ch.cooling === "liquid")
    root.dataset.cooling = ch.cooling
    show(gens, Boolean(v.nplus1))
    feed.textContent = v.nplus1 ? "" : "Single feed, no N+1"
    const frac = clamp((v.pue - 1) / 0.8)
    pueFill.setAttribute("y", String(157 - frac * 154))
    pueFill.setAttribute("height", String(frac * 154))
    pueFill.classList.toggle("bad", v.pue > 1.3)
    const ty = 157 - ((1.3 - 1) / 0.8) * 154
    pueTarget.setAttribute("y1", String(ty))
    pueTarget.setAttribute("y2", String(ty))
    pueText.textContent = `PUE ${v.pue.toFixed(2)}`
    const p = board.caps.find((c) => c.id === "power")
    powerFill.setAttribute("width", String(260 * clamp(p.used / p.cap / 1.3)))
    powerFill.classList.toggle("bad", p.over > 0)
    powerText.textContent = `${Math.round(p.used)} kW of ${Math.round(p.cap)} kW available`
  }
}

/* ------------------------------------------------------------ Connectivity: Austin to the factory */

function networkScene(root, still) {
  const id = `net${++uid}`
  root.append(s("rect", { x: 6, y: 6, width: 788, height: 228, rx: 16, class: "sky" }))
  root.append(s("g", { class: "cota", transform: "translate(34 96)" },
    s("path", { d: "M10 50 C 0 20, 30 0, 50 14 C 66 24, 80 4, 100 10 C 118 16, 112 46, 92 50 C 70 54, 60 70, 40 66 C 24 62, 18 58, 10 50 Z", class: "cota-track" }),
    text(56, 92, "Austin · COTA", { class: "place-text", "text-anchor": "middle" })))
  root.append(s("g", { transform: "translate(660 92)" },
    s("path", { d: "M0 60 L0 20 L30 4 L60 20 L60 0 L74 0 L74 60 Z", class: "factory" }),
    text(37, 82, "Factory strategists", { class: "place-text", "text-anchor": "middle" })))
  const paths = {
    main: s("path", { id: `${id}-a`, d: "M150 122 C 300 112, 500 112, 656 122", class: "route" }),
    second: s("path", { id: `${id}-b`, d: "M150 140 C 300 206, 500 206, 656 140", class: "route" }),
    sat: s("path", { id: `${id}-c`, d: "M150 108 Q 400 -10 656 108", class: "route sat-route" }),
  }
  root.append(paths.main, paths.second, paths.sat)
  const satellite = s("g", { class: "satellite off", transform: "translate(400 50)" },
    s("rect", { x: -10, y: -8, width: 20, height: 16, rx: 3 }), s("rect", { x: -34, y: -4, width: 20, height: 8 }), s("rect", { x: 14, y: -4, width: 20, height: 8 }))
  const cloud = s("g", { class: "cloud off", transform: "translate(400 116)" },
    s("path", { d: "M-34 8 C -44 8, -44 -10, -30 -10 C -28 -24, -6 -26, 0 -14 C 8 -26, 30 -22, 28 -8 C 42 -8, 42 8, 30 8 Z" }),
    text(0, 4, "internet", { "text-anchor": "middle", class: "cloud-text" }))
  const drops = s("g", { class: "drops off" }, [330, 470].map((x) => text(x, 116, "×", { class: "drop", "text-anchor": "middle" })))
  const packets = s("g", { class: "packets" })
  const lanes = { main: [], second: [], sat: [] }
  if (!still) {
    for (const [key, path] of Object.entries(paths)) {
      for (let i = 0; i < 3; i++) {
        const motion = s("animateMotion", { dur: "2s", begin: `${-i * 0.66}s`, repeatCount: "indefinite" }, s("mpath", { href: `#${path.id}` }))
        const dot = s("circle", { r: 5, class: `packet packet-${key}` }, motion)
        packets.append(dot)
        lanes[key].push({ dot, motion })
      }
    }
  }
  const garage = s("g", { transform: "translate(130 150)" })
  const wifi = s("g", { class: "wifi off" }, [8, 14, 20].map((r) => s("path", { d: `M${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`, class: "wifi-arc" })))
  const edge = s("g", { class: "edge off" }, s("rect", { x: -18, y: -6, width: 36, height: 22, rx: 4 }), text(0, 10, "edge", { "text-anchor": "middle", class: "edge-text" }))
  garage.append(wifi, edge)
  const flag = fiaFlag(60, 160, "5.2")
  const latency = text(400, 228, "", { class: "latency-text", "text-anchor": "middle" })
  const latTrack = s("rect", { x: 270, y: 196, width: 260, height: 10, rx: 5, class: "meter-track" })
  const latFill = s("rect", { x: 270, y: 196, height: 10, rx: 5, class: "meter-fill" })
  const latTarget = s("line", { x1: 270 + 260 * (120 / 250), x2: 270 + 260 * (120 / 250), y1: 190, y2: 212, class: "meter-target" })
  const online = text(400, 22, "", { class: "meter-text", "text-anchor": "middle" })
  root.append(satellite, cloud, packets, drops, garage, flag, latTrack, latFill, latTarget, latency, online)
  return (board) => {
    const v = board.values
    const ch = board.choices
    const routeClass = { public: "route-public", crossconnect: "route-private", darkfibre: "route-dark" }[ch.path]
    for (const p of [paths.main, paths.second]) p.setAttribute("class", `route ${routeClass}`)
    show(paths.second, ch.link !== "single")
    show(paths.sat, ch.link === "satellite")
    show(satellite, ch.link === "satellite")
    show(cloud, ch.path === "public")
    show(drops, ch.path === "public" || ch.link === "single")
    root.dataset.paths = String(1 + (ch.link !== "single" ? 1 : 0) + (ch.link === "satellite" ? 1 : 0))
    root.dataset.drops = String(ch.path === "public" || ch.link === "single")
    const dur = `${(Math.max(60, v.latency) * 0.012).toFixed(2)}s`
    for (const [key, list] of Object.entries(lanes)) {
      const on = key === "main" || (key === "second" && ch.link !== "single") || (key === "sat" && ch.link === "satellite")
      for (const p of list) {
        show(p.dot, on)
        if (p.motion.getAttribute("dur") !== dur) p.motion.setAttribute("dur", key === "sat" ? `${(parseFloat(dur) * 1.4).toFixed(2)}s` : dur)
      }
    }
    show(wifi, ch.garage === "wifi")
    show(edge, ch.garage === "edge")
    show(flag, ch.garage === "wifi")
    latFill.setAttribute("width", String(260 * clamp(v.latency / 250)))
    latFill.classList.toggle("bad", v.latency > 120)
    latency.textContent = `Strategy call lands in ${Math.round(v.latency)} ms · target 120 ms`
    latency.classList.toggle("bad", v.latency > 120)
    online.textContent = `Online ${v.availability >= 99.95 ? v.availability.toFixed(2) : v.availability.toFixed(1)}% of the race weekend · target 99.9%`
  }
}

/* ------------------------------------------------------------ OEMs: the rack row and the purse */

const HW_LABEL = { incumbent: "2019 kit", tier1: "Dell · HPE · Lenovo", dgx: "NVIDIA DGX" }

function oemScene(root) {
  root.append(s("rect", { x: 6, y: 6, width: 788, height: 228, rx: 16, class: "sky" }))
  const rack = s("g", { class: "oem-rack", transform: "translate(40 24)" }, s("rect", { x: 0, y: 0, width: 230, height: 196, rx: 6, class: "rack-box" }))
  const slots = Array.from({ length: 8 }, (_, i) => {
    const g = s("g", { class: "slot", transform: `translate(10 ${10 + i * 22})`, style: `--i:${i}` },
      s("rect", { x: 0, y: 0, width: 210, height: 18, rx: 3, class: "srv-old" }),
      s("rect", { x: 0, y: 0, width: 210, height: 18, rx: 3, class: "srv-new" }))
    rack.append(g)
    return g
  })
  const hwText = text(155, 236, "", { class: "place-text", "text-anchor": "middle" })
  const perfTrack = s("rect", { x: 300, y: 34, width: 280, height: 16, rx: 8, class: "meter-track" })
  const perfFill = s("rect", { x: 300, y: 34, height: 16, rx: 8, class: "meter-fill" })
  const perfTarget = s("line", { x1: 300 + 280 * (2 / 3.5), x2: 300 + 280 * (2 / 3.5), y1: 26, y2: 58, class: "meter-target" })
  const perfText = text(300, 22, "", { class: "meter-text" })
  const jar = (x, label) => {
    const g = s("g", { transform: `translate(${x} 96)` }, s("rect", { x: 0, y: 0, width: 70, height: 106, rx: 12, class: "jar" }))
    const fill = s("rect", { x: 4, width: 62, rx: 9, class: "jar-fill" })
    const cap = s("line", { x1: -6, x2: 76, y1: 26, y2: 26, class: "meter-target" })
    const value = text(35, 124, "", { class: "meter-text", "text-anchor": "middle" })
    g.append(fill, cap, value, text(35, -8, label, { class: "meter-sub", "text-anchor": "middle" }))
    return { g, fill, value }
  }
  const capex = jar(310, "CapEx")
  const opex = jar(430, "OpEx a year")
  const payText = text(405, 72, "", { class: "place-text", "text-anchor": "middle" })
  const clock = s("g", { class: "support-clock", transform: "translate(610 140)" },
    s("circle", { r: 30, class: "clock-face" }), s("line", { x1: 0, y1: 0, x2: 0, y2: -20, class: "clock-hand" }), s("line", { x1: 0, y1: 0, x2: 14, y2: 0, class: "clock-hand" }))
  const clockText = text(640, 196, "", { class: "meter-text", "text-anchor": "middle" })
  const cal = s("g", { transform: "translate(620 62)" }, s("rect", { x: 0, y: 0, width: 160, height: 12, rx: 6, class: "meter-track" }))
  const raceFlag = s("g", { transform: `translate(${160 * (12 / 24)} 0)` }, s("line", { x1: 0, y1: -14, x2: 0, y2: 26, class: "meter-target" }), text(0, 40, "First race", { class: "meter-sub", "text-anchor": "middle" }))
  const delivery = s("circle", { cy: 6, r: 9, class: "delivery" })
  const leadText = text(80, -22, "", { class: "meter-text", "text-anchor": "middle" })
  cal.append(raceFlag, delivery, leadText)
  root.append(rack, hwText, perfTrack, perfFill, perfTarget, perfText, capex.g, opex.g, payText, clock, clockText, cal)
  return (board) => {
    const v = board.values
    const ch = board.choices
    rack.setAttribute("class", `oem-rack hw-${ch.vendor}`)
    root.dataset.hardware = ch.vendor
    hwText.textContent = HW_LABEL[ch.vendor]
    perfFill.setAttribute("width", String(280 * clamp(v.perf / 3.5)))
    perfFill.classList.toggle("bad", v.perf < 2)
    perfText.textContent = `${v.perf.toFixed(1)}× today's performance · target 2×`
    for (const [jarNode, cap] of [[capex, board.caps.find((c) => c.id === "capex")], [opex, board.caps.find((c) => c.id === "opex")]]) {
      const frac = clamp(cap.used / cap.cap / 1.4)
      jarNode.fill.setAttribute("y", String(106 - frac * 102))
      jarNode.fill.setAttribute("height", String(frac * 102))
      jarNode.fill.classList.toggle("bad", cap.over > 0)
      jarNode.value.textContent = `${money(cap.used)} of ${money(cap.cap)}`
    }
    payText.textContent = opt(board, "payment").name
    clock.setAttribute("class", `support-clock sup-${ch.support}`)
    clockText.textContent = { basic: "Fix in 72 h: parts by post", nbd: "Fix next day", "4h": "Fix in 4 h, 24/7" }[ch.support]
    delivery.setAttribute("cx", String(160 * clamp(v.lead / 24)))
    delivery.classList.toggle("bad", v.lead > 12)
    leadText.textContent = `Delivered in ${Math.round(v.lead)} weeks`
  }
}

const SCENES = { compute: computeScene, dc: dcScene, network: networkScene, oem: oemScene }

/* ------------------------------------------------------------ labels: what the provider did, and its effect */

const LABELS = {
  compute: {
    size: (b) => `${opt(b, "size").nodes} nodes: ${Math.round(b.values.cycles)} cycles a week`,
    chips: (b) => `${{ cpu: "CPU only", mixed: "Mixed chips", gpu: "GPU heavy" }[b.choices.chips]}: ${Math.round(b.values.usage)}% of FIA cap`,
    storage: (b) => `${{ basic: "Office NAS", parallel: "Parallel files", cache: "Flash cache" }[b.choices.storage]}: nodes ${Math.round(b.values.feed)}% fed`,
  },
  dc: {
    location: (b) => ({ factory: "Factory room: no N+1 backup", colo: "Colo: N+1 power and cooling", cheap: "Cheap region: single grid feed" })[b.choices.location],
    cooling: (b) => `${{ air: "Air", reardoor: "Rear-door", liquid: "Liquid" }[b.choices.cooling]} cooling: GPUs at ${Math.round(clamp(b.values.capacity / 100) * 100)}%`,
    power: (b) => `${{ cap85: "85% cap", standard: "Standard power", boost: "Max boost" }[b.choices.power]}: PUE ${b.values.pue.toFixed(2)}`,
  },
  network: {
    link: (b) => `${{ single: "Single tunnel", redundant: "Two paths", satellite: "Satellite backup" }[b.choices.link]}: online ${b.values.availability}%`,
    path: (b) => `${{ public: "Public internet", crossconnect: "Cross-connect", darkfibre: "Dark fibre" }[b.choices.path]}: ${Math.round(b.values.latency)} ms round trip`,
    garage: (b) => ({ wifi: "Garage Wi-Fi: breaks FIA 5.2", umbilical: "Wired umbilical: legal and steady", edge: "Edge cache: −20 ms in garage" })[b.choices.garage],
  },
  oem: {
    vendor: (b) => `${{ incumbent: "Incumbent kit", tier1: "Dell/HPE/Lenovo", dgx: "NVIDIA DGX" }[b.choices.vendor]}: ${b.values.perf.toFixed(1)}× today's performance`,
    payment: (b) => (b.payment === "buy" ? `Buy outright: ${money(b.caps.find((c) => c.id === "capex").used)} CapEx now` : `${b.payment === "aas" ? "As-a-service" : "Lease"}: ${money(b.caps.find((c) => c.id === "opex").used)} a year`),
    support: (b) => ({ basic: "Basic support: 72 h fixes", nbd: "Next-day support: 24 h fixes", "4h": "4-hour support: 4 h fixes" })[b.choices.support],
  },
}

/** Up to three labels, one per dial, each with the seconds that dial found against today's setting. */
export function sceneLabels(board) {
  return C.decisionsFor(board.station).map((d) => {
    const base = LABELS[board.station][d.id](board)
    let delta = 0
    if (board.choices[d.id] !== d.today) delta = board.seconds - boardFor(board.station, { ...board.choices, [d.id]: d.today }, board.budget).seconds
    const tag = Math.abs(delta) >= 0.01 ? ` (${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} s)` : ""
    return { dial: d.id, text: `${base}${tag}`, gain: delta }
  })
}

/* ------------------------------------------------------------ the scene component */

/**
 * The scenario visual for one table. `still` scenes are thumbnails (no animation);
 * update(board) redraws the scene, the labels, the headline seconds and the outcome line.
 */
export function createScene(stationId, { still = false, thumb = false } = {}) {
  const station = C.byId(C.STATIONS, stationId)
  const svgNode = s("svg", { viewBox: "0 0 800 240", class: `scene-svg${still ? "" : " live"}`, role: "img", "aria-label": `${station.name} scenario`, preserveAspectRatio: "xMidYMid meet" })
  const draw = SCENES[stationId](svgNode, still)
  const secNum = el("b", { class: "sec-num" })
  const secCap = el("span", { class: "sec-cap" })
  const labels = el("div", { class: "scene-labels" })
  const line = el("p", { class: "scene-line" })
  const node = el("div", { class: `scene${still ? " still" : ""}${thumb ? " thumb-scene" : ""}`, "data-scene": stationId, style: `--table:${station.color}` },
    el("div", { class: "scene-head" },
      el("div", { class: "scene-problem" }, el("span", { class: "problem-tag" }, `Scenario · ${station.name}`), el("p", {}, station.problem),
        el("span", { class: "scene-wants" }, `The ${station.architect} wants: ${station.looking}`)),
      el("div", { class: "scene-outcome", "aria-live": "polite" }, secNum, secCap)),
    el("div", { class: "scene-stage" }, svgNode),
    labels, line)
  const update = (board) => {
    draw(board)
    node.classList.toggle("not-allowed", !board.allowed)
    node.classList.toggle("in-zone", board.inZone)
    node.dataset.seconds = board.seconds.toFixed(2)
    secNum.textContent = board.allowed ? `${board.seconds.toFixed(2)} s` : "Not allowed"
    secCap.textContent = board.allowed ? "found per lap" : "0.00 s counts"
    if (!thumb) labels.replaceChildren(...sceneLabels(board).map((l) => el("span", { class: `scene-label${l.gain > 0 ? " up" : l.gain < 0 ? " down" : ""}`, "data-dial": l.dial }, l.text)))
    line.textContent = board.outcome
  }
  return { el: node, update }
}

/** A still thumbnail of a frozen board: the scene and the seconds found. */
export function sceneThumb(board) {
  const view = createScene(board.station, { still: true, thumb: true })
  view.update(board)
  return view.el
}
