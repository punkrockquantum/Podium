/**
 * The tuning board: one component on every table, the SA's screen, the plan page, demo mode
 * and the readout. Problem, gauges with a green target zone and a grey "today" needle, cap-line
 * bars, FIA chips, the FIT ring and three dials. SVG and CSS only.
 *
 * createBoard() builds the DOM once and update() moves needles and bars in place, so every dial
 * turn animates instead of re-rendering.
 */
import * as C from "./catalog.js"
import { boardFor } from "./model.js"
import { createScene, sceneThumb } from "./scene.js"
import { el, WORDS } from "./ui.js"

const SVG_NS = "http://www.w3.org/2000/svg"
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const money = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`)

/* ------------------------------------------------------------ FIT ring */

export const fitTone = (fit, status) => (status === "zone" ? "zone" : status === "over" || status === "fia" ? "bad" : fit >= 60 ? "close" : "far")
export const STATUS_WORD = { zone: WORDS.inZone, off: "Not in the zone yet", over: WORDS.overCap, fia: "FIA breach" }

function ringSvg(size, stroke) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const root = svg("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "fit-svg", "aria-hidden": "true" })
  root.append(svg("circle", { cx: size / 2, cy: size / 2, r, fill: "none", class: "fit-track", "stroke-width": stroke }))
  const arc = svg("circle", { cx: size / 2, cy: size / 2, r, fill: "none", class: "fit-arc", "stroke-width": stroke, "stroke-linecap": "round", "stroke-dasharray": `0 ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` })
  const label = svg("text", { x: size / 2, y: size / 2 + size * 0.11, "text-anchor": "middle", class: "fit-num", "font-size": size * 0.3 })
  root.append(arc, label)
  return { root, set: (fit) => { arc.setAttribute("stroke-dasharray", `${(c * clamp(fit / 100))} ${c}`); label.textContent = String(Math.round(fit)) } }
}

/** A small FIT ring: grey when the board is not approved (or not started). */
export function miniFit(fit, { status = "off", grey = false, size = 34, title = "" } = {}) {
  const ring = ringSvg(size, size > 30 ? 5 : 4)
  ring.set(Number.isFinite(fit) ? fit : 0)
  if (!Number.isFinite(fit)) ring.root.querySelector("text").textContent = "–"
  return el("span", { class: `mini-fit tone-${grey ? "grey" : fitTone(fit, status)}`, title }, ring.root)
}

/* ------------------------------------------------------------ gauges */

const point = (f, cx = 60, cy = 62, r = 48) => [cx - r * Math.cos(Math.PI * f), cy - r * Math.sin(Math.PI * f)]
const arcPath = (f1, f2) => {
  const [x1, y1] = point(f1)
  const [x2, y2] = point(f2)
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A 48 48 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}
const fracOf = (t, v) => clamp((v - t.lo) / (t.hi - t.lo))

function gauge(t) {
  if (t.kind === "pass") {
    const mark = el("b", { class: "pass-mark" })
    const value = el("span", { class: "gauge-value" })
    const node = el("div", { class: "gauge pass", "data-target": t.id }, el("div", { class: "pass-box" }, mark), value, el("span", { class: "gauge-name" }, t.name), el("span", { class: "gauge-sub" }, `Target: ${t.zone} · today: ${t.todayDisplay}`))
    return { node, set: (x) => { node.classList.toggle("ok", x.ok); mark.textContent = x.ok ? "✓" : "✗"; value.textContent = x.display } }
  }
  const zone = t.kind === "max" ? [0, fracOf(t, t.target)] : [fracOf(t, t.target), 1]
  const root = svg("svg", { viewBox: "0 0 120 72", class: "gauge-svg", "aria-hidden": "true" })
  root.append(svg("path", { d: arcPath(0, 1), class: "gauge-track", fill: "none", "stroke-width": 12 }))
  root.append(svg("path", { d: arcPath(zone[0], zone[1]), class: "gauge-zone", fill: "none", "stroke-width": 12 }))
  const deg = (v) => -90 + fracOf(t, v) * 180
  const ghost = svg("line", { x1: 60, y1: 62, x2: 60, y2: 20, class: "gauge-ghost", style: `transform: rotate(${deg(t.today)}deg)` })
  const needle = svg("g", { class: "gauge-needle" })
  needle.append(svg("line", { x1: 60, y1: 62, x2: 60, y2: 18 }), svg("circle", { cx: 60, cy: 62, r: 5 }))
  root.append(ghost, needle)
  const value = el("span", { class: "gauge-value" })
  const node = el("div", { class: "gauge", "data-target": t.id }, root, value, el("span", { class: "gauge-name" }, t.name), el("span", { class: "gauge-sub" }, `Target: ${t.zone} · today: ${t.todayDisplay}`))
  return { node, set: (x) => { node.classList.toggle("ok", x.ok); needle.style.transform = `rotate(${deg(x.value)}deg)`; value.textContent = x.display } }
}

/* ------------------------------------------------------------ cap bars */

function capBar(c) {
  const scale = c.cap * 1.6
  const fill = el("i", { class: "capbar-fill" })
  const text = el("b", {})
  const consequence = el("p", { class: "capbar-consequence" })
  const name = c.id === "capex" ? "CapEx vs this table's envelope" : c.id === "opex" ? "Yearly OpEx vs the cost-cap allowance" : c.name
  const node = el("div", { class: "capbar", "data-cap": c.id },
    el("div", { class: "capbar-label" }, el("span", {}, name), text),
    el("div", { class: "capbar-track" }, fill, el("b", { class: "capbar-line", style: `left:${(100 / 1.6).toFixed(1)}%`, title: "Cap" }), el("s", { class: "capbar-ghost", style: `left:${(clamp(c.today / scale) * 100).toFixed(1)}%`, title: "Today" })),
    consequence)
  return {
    node,
    /** `deciding`: choices are still open, so the consequence shows without the setting that fixes it. */
    set: (x, { deciding = false } = {}) => {
      node.classList.toggle("over", x.over > 0)
      fill.style.width = `${(clamp(x.used / scale) * 100).toFixed(1)}%`
      text.textContent = x.unit === "kW" ? `${Math.round(x.used)} of ${Math.round(x.cap)} kW` : `${money(x.used)} of ${money(x.cap)}`
      consequence.textContent = x.over > 0 ? (deciding && x.fix ? x.consequence.replace(/\s[^.]*would bring it back\.$/, "") : x.consequence) : ""
    },
  }
}

/* ------------------------------------------------------------ dials */

/**
 * One dial. On a table the first tap locks it (one-shot): the chosen setting shows a padlock, the
 * others go quiet, and an open dial reads "Tap once to lock". After a rejection the previous pick
 * shows as a "last time" ghost.
 */
function dial(d, { interactive, onDial }) {
  const setting = el("span", { class: "dial-setting" })
  const buttons = d.options.map((o) => el("button", { class: "seg-btn", "data-option": o.id, role: "radio", type: "button", onclick: (e) => interactive && !e.currentTarget.disabled && onDial?.(d.id, o.id) },
    el("span", {}, o.name), o.id === d.today ? el("small", { class: "seg-today" }, "today") : null, o.fia ? el("small", { class: "seg-fia" }, o.illegal ? `Breaks FIA ${o.fia}` : `FIA ${o.fia}`) : null,
    el("small", { class: "seg-ghost" }, WORDS.lastTime), el("small", { class: "seg-lock", "aria-label": WORDS.locked }, "🔒")))
  const node = el("div", { class: "dial", "data-dial": d.id },
    el("div", { class: "dial-head" }, el("b", {}, d.name), setting),
    el("div", { class: "seg", role: "radiogroup", "aria-label": d.name }, buttons),
    el("p", { class: "dial-why" }, el("b", {}, "Why it matters to the F1 team: "), d.why),
    el("p", { class: "dial-how" }, el("b", {}, `${WORDS.howProviderHelps}: `), d.how))
  return {
    node,
    /** `chosen`: the team has locked this dial (false shows no selection); `ghost`: last time's option id. */
    set: (value, locked, { chosen = true, ghost = null } = {}) => {
      const o = d.options.find((x) => x.id === value)
      const open = interactive && !locked && !chosen
      node.classList.toggle("chosen", chosen)
      node.classList.toggle("open", open)
      setting.textContent = chosen ? `🔒 ${o?.text || ""}` : open ? WORDS.tapToLock : ""
      for (const b of buttons) {
        const on = chosen && b.dataset.option === value
        b.classList.toggle("on", on)
        b.classList.toggle("muted", chosen && !on)
        b.classList.toggle("ghost", !chosen && ghost === b.dataset.option)
        b.setAttribute("aria-checked", String(on))
        b.disabled = !interactive || locked || chosen
      }
    },
  }
}

/* ------------------------------------------------------------ the sticky scene */

const COMPACT_AT = 220
const EXPAND_AT = 40

/**
 * The scene on a table shrinks to a strip on scroll. It sits in a sticky dock whose height is fixed
 * at the expanded scene's height once measured (the scene then floats inside it), so compacting
 * changes what the strip looks like but never the height of the document: the page cannot jump or
 * clamp under the reader's finger. The dock sticks for the whole board; its empty part lets taps through.
 */
function dockScene(sceneNode) {
  const dock = el("div", { class: "scene-dock" }, sceneNode)
  let measured = 0
  const measure = () => {
    if (!dock.isConnected) return
    const wasCompact = sceneNode.classList.contains("compact")
    sceneNode.classList.remove("compact")
    dock.classList.remove("docked")
    dock.style.height = ""
    measured = dock.offsetHeight
    if (measured) {
      dock.style.height = `${measured}px`
      dock.classList.add("docked")
    }
    if (wasCompact) sceneNode.classList.add("compact")
  }
  const sync = () => {
    if (!dock.isConnected) return
    if (!measured) measure()
    const compact = sceneNode.classList.contains("compact")
    const next = compact ? window.scrollY > EXPAND_AT : window.scrollY > COMPACT_AT
    if (next !== compact) sceneNode.classList.toggle("compact", next)
  }
  const onResize = () => {
    measured = 0
    sync()
  }
  window.addEventListener("scroll", sync, { passive: true })
  window.addEventListener("resize", onResize)
  /* Measure once the dock is in the document; a board built while scrolled down compacts at once. */
  requestAnimationFrame(sync)
  /* Stop listening once the board leaves the page (a rebuilt view or a new team). */
  const gone = setInterval(() => {
    if (dock.isConnected) return
    clearInterval(gone)
    window.removeEventListener("scroll", sync)
    window.removeEventListener("resize", onResize)
  }, 2000)
  return dock
}

/* ------------------------------------------------------------ the board */

/**
 * Build a board for one table. `interactive` boards call onDial(decisionId, optionId); read-only
 * boards (SA, plan page, demo) show the same gauges with the dials disabled.
 */
export function createBoard({ stationId, budget = C.DEFAULT_BUDGET, interactive = false, onDial = null, showProblem = true, showDials = true, id = null, scene = "live", sticky = false }) {
  const station = C.byId(C.STATIONS, stationId)
  const first = boardFor(stationId, {}, budget)
  const sceneView = scene ? createScene(stationId, { still: scene === "still" }) : null
  const sceneNode = sceneView ? (sticky ? dockScene(sceneView.el) : sceneView.el) : null
  const ring = ringSvg(112, 12)
  const fitBox = el("div", { class: "fit-box" })
  const status = el("b", { class: "fit-status" })
  const sentence = el("p", { class: "fit-sentence" })
  const hint = el("p", { class: "fit-hint" })
  fitBox.append(el("div", { class: "fit-ring" }, ring.root, el("span", { class: "fit-label" }, WORDS.fit)), el("div", { class: "fit-words" }, status, sentence, hint))
  const gauges = first.targets.map(gauge)
  const bars = first.caps.map(capBar)
  const chips = el("div", { class: "chips" })
  const notes = el("p", { class: "board-notes small" })
  const dials = C.decisionsFor(stationId).map((d) => dial(d, { interactive, onDial }))
  const lockCount = el("div", { class: "lock-count", role: "status", "aria-live": "polite" })
  const node = el("div", { class: "board", id, "data-station": stationId, style: `--table:${station.color}` },
    sceneNode,
    showProblem && !sceneView ? el("div", { class: "board-problem" }, el("span", { class: "problem-tag" }, `${WORDS.problem} · ${station.name}`), el("p", {}, station.problem)) : null,
    el("div", { class: "board-grid" },
      el("div", { class: "board-readings" },
        fitBox,
        el("div", { class: "gauges" }, gauges.map((g) => g.node)),
        el("div", { class: "caps" }, bars.map((b) => b.node)),
        chips, notes,
        el("p", { class: "legend small" }, el("i", { class: "lg-zone" }), " target zone ", el("i", { class: "lg-ghost" }), ` ${WORDS.today} `, el("i", { class: "lg-cap" }), " cap line")),
      showDials ? el("div", { class: "board-dials" }, interactive ? lockCount : null, dials.map((d) => d.node)) : null))
  let current = first
  /**
   * `chosen`: the dial ids the team has locked (omit on read-only boards, where every dial shows
   * its setting); `ghosts`: dial id → last time's option, shown after a rejection.
   */
  const update = (choices, { locked = false, board = null, chosen = null, ghosts = null } = {}) => {
    current = board || boardFor(stationId, choices, budget)
    sceneView?.update(current)
    ring.set(current.fit)
    fitBox.className = `fit-box tone-${fitTone(current.fit, current.status)}`
    status.textContent = STATUS_WORD[current.status]
    sentence.textContent = current.sentence
    /* The fix-it hint names a dial setting, so it waits until every dial is locked: the brief is the guide while choices are open. */
    const deciding = Boolean(chosen) && chosen.length < dials.length
    hint.textContent = deciding ? WORDS.hintWaits : current.status === "zone" && !current.hint.startsWith("In the zone.") ? "" : current.hint
    current.targets.forEach((t, i) => gauges[i].set(t))
    current.caps.forEach((c, i) => bars[i].set(c, { deciding }))
    chips.replaceChildren(...current.breaches.filter((b) => b.kind === "fia").map((b) => el("span", { class: "chip fia" }, el("b", {}, `FIA ${b.rule}`), ` ${b.text.replace(/^FIA [\d.]+:?\s*/, "")}`)))
    notes.textContent = current.notes.join(" ")
    node.classList.toggle("in-zone", current.inZone)
    for (const d of dials) {
      const id = d.node.dataset.dial
      d.set(current.choices[id], locked, { chosen: chosen ? chosen.includes(id) : true, ghost: ghosts?.[id] ?? null })
    }
    if (chosen) {
      const n = chosen.length
      lockCount.textContent = n >= dials.length ? `🔒 ${WORDS.allLocked}` : WORDS.lockedCount(n, dials.length)
      lockCount.classList.toggle("all", n >= dials.length)
    }
    return current
  }
  return { el: node, update, board: () => current }
}

/** A read-only board for a frozen plan (the plan page, the SA, demo mode). */
export function staticBoard(stationId, choices, budget, opts = {}) {
  const view = createBoard({ stationId, budget, interactive: false, ...opts })
  view.update(choices, { locked: true })
  return view.el
}

/** "What you just learned": why it matters to the customer, and the provider's role. */
export function learningCard(stationId, { onClose = null, id = "learnCard" } = {}) {
  const station = C.byId(C.STATIONS, stationId)
  return el("div", { class: "learn-card", id, role: "status" },
    el("h3", {}, `💡 ${WORDS.learned}`),
    el("p", {}, el("b", {}, "For the customer: "), station.lesson.why),
    el("p", {}, el("b", {}, "The provider's role: "), station.lesson.provider),
    onClose ? el("button", { class: "btn small-btn", onclick: onClose }, "Got it") : null)
}

/** A readout thumbnail: the final scene with its seconds, the table's FIT and three target ticks. */
export function boardThumb(rb) {
  return el("div", { class: `thumb${rb.raced === "today" ? " today" : ""}`, style: `--table:${rb.color}`, "data-station": rb.station },
    rb.board ? sceneThumb(rb.board) : null,
    el("div", { class: "thumb-head" }, miniFit(rb.fit, { status: rb.status, grey: rb.raced === "today", size: 44 }), el("div", {}, el("b", {}, rb.name), el("span", { class: "small muted" }, rb.story || (rb.raced === "today" ? `Not approved: raced on ${WORDS.todaySetup.toLowerCase()}` : rb.inZone ? `Approved · ${WORDS.inZone}` : "Approved, outside the zone")))),
    el("ul", {}, rb.targets.map((t) => el("li", { class: t.ok ? "ok" : "bad" }, `${t.ok ? "✓" : "✗"} ${t.name}: ${t.display}`))))
}
