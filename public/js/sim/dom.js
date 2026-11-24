/** Tiny DOM helpers and number formatting for the simulator (no dependency on the legacy game's ui.js). */

const SVG_NS = "http://www.w3.org/2000/svg"

function apply(node, attrs, isSvg) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === "class") node.setAttribute("class", v)
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v)
    else if (k === "html") node.innerHTML = v
    else if (k === "text") node.textContent = v
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === "dataset") Object.assign(node.dataset, v)
    else if (!isSvg && k in node && typeof node[k] !== "function" && typeof v !== "string") node[k] = v
    else node.setAttribute(k, v === true ? "" : String(v))
  }
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue
    node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

/** Replace a node's children; null / undefined / false children are skipped (unlike the native append). */
export const fill = (node, ...children) => { clear(node); append(node, children); return node }

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag)
  apply(node, attrs, false)
  append(node, children)
  return node
}

export function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag)
  apply(node, attrs, true)
  append(node, children)
  return node
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node }

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const MINUS = "−"
const safe = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null)

export const fmt = {
  /** CHF 1.2 M / CHF 345k / CHF 0 */
  chf(value, digits = 1) {
    const v = safe(value)
    if (v === null) return "—"
    const sign = v < 0 ? MINUS : ""
    const a = Math.abs(v)
    if (a >= 1e6) return `${sign}CHF ${(a / 1e6).toFixed(digits)} M`
    if (a >= 1e3) return `${sign}CHF ${Math.round(a / 1e3)}k`
    return `${sign}CHF ${Math.round(a)}`
  },
  /** +CHF 1.2 M / −CHF 345k / ±0 */
  chfDelta(value, digits = 1) {
    const v = safe(value)
    if (v === null) return "—"
    if (Math.abs(v) < 500) return "±0"
    return (v > 0 ? "+" : "") + fmt.chf(v, digits)
  },
  chfFull(value) {
    const v = safe(value)
    if (v === null) return "—"
    return `${v < 0 ? MINUS : ""}CHF ${Math.round(Math.abs(v)).toLocaleString("en-US")}`
  },
  /** +0.13 s / −0.05 s / 0.00 s */
  sec(value, digits = 2, signed = true) {
    const v = safe(value)
    if (v === null) return "—"
    const s = Math.abs(v).toFixed(digits)
    if (Math.abs(v) < 0.5 / 10 ** digits) return `${(0).toFixed(digits)} s`
    return `${v < 0 ? MINUS : signed ? "+" : ""}${s} s`
  },
  num(value, digits = 0) {
    const v = safe(value)
    if (v === null) return "—"
    return (v < 0 ? MINUS : "") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  },
  pct(value, digits = 0) {
    const v = safe(value)
    if (v === null) return "—"
    const text = (v * 100).toFixed(digits)
    return `${/^-0(\.0*)?$/.test(text) ? text.slice(1) : text} %`
  },
  signed(value, digits = 1, unit = "") {
    const v = safe(value)
    if (v === null) return "—"
    if (Math.abs(v) < 0.5 / 10 ** digits) return `±0${unit}`
    return `${v > 0 ? "+" : MINUS}${Math.abs(v).toFixed(digits)}${unit}`
  },
  hours(value) {
    const v = safe(value)
    if (v === null || !Number.isFinite(v)) return "—"
    if (v < 1) return `${Math.round(v * 60)} min`
    return `${v.toFixed(1)} h`
  },
  ms(value) {
    const v = safe(value)
    return v === null ? "—" : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`
  },
  availability(value) {
    const v = safe(value)
    if (v === null) return "—"
    const pct = v * 100
    return `${pct >= 99.99 ? pct.toFixed(3) : pct >= 99.9 ? pct.toFixed(2) : pct.toFixed(1)} %`
  },
  position(value) {
    const v = safe(value)
    return v === null ? "—" : `P${Math.round(v)}`
  },
  /**
   * Expected race weekends lost a season (link downtime × 24 weekends) said in words. Under 0.05 a weekend
   * the loss is spread over seasons ("about 1 weekend in 42 seasons at risk"); up to 0.5 it is a chance in
   * the season ("1 in 4 chance of losing a weekend"); from 0.5 it is a count ("about 1.2 weekends a season
   * at risk"); zero is "no weekends at risk". The number itself stays in the JSON exports.
   */
  weekends(value) {
    const v = safe(value)
    if (v === null) return "—"
    if (v < 0.0005) return "no weekends at risk"
    if (v < 0.05) return `about 1 weekend in ${Math.round(1 / v)} seasons at risk`
    if (v < 0.5) return `1 in ${Math.round(1 / v)} chance of losing a weekend`
    const x = v.toFixed(1)
    return `about ${x === "1.0" ? "1 weekend" : `${x} weekends`} a season at risk`
  },
  /** The same figure as `weekends` without the sentence, for tile values and compare cells: "1 in 42 seasons", "1 in 4 chance", "about 1.2 a season", "none". */
  weekendsShort(value) {
    const v = safe(value)
    if (v === null) return "—"
    if (v < 0.0005) return "none"
    if (v < 0.05) return `1 in ${Math.round(1 / v)} seasons`
    if (v < 0.5) return `1 in ${Math.round(1 / v)} chance`
    return `about ${v.toFixed(1)} a season`
  },
}

/** Log every uncaught error to the console and to an on-page strip so the browser test can see it. */
export function installErrorLogging() {
  const strip = el("div", { class: "sim-errors", id: "sim-errors", role: "alert", "aria-live": "assertive", hidden: true })
  document.body.append(strip)
  const show = (message) => {
    strip.hidden = false
    strip.append(el("div", {}, message))
  }
  window.addEventListener("error", (e) => show(`${e.message} (${e.filename || "inline"}:${e.lineno || 0})`))
  window.addEventListener("unhandledrejection", (e) => show(`Unhandled rejection: ${e.reason && e.reason.message ? e.reason.message : e.reason}`))
}
