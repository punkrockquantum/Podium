/** Controls, gauges, badges and bars for the simulator. All functions return DOM nodes. */
import { el, svg, fmt } from "./dom.js"
import { EXPLAIN, labels as explainLabels, TILE_BY_LABEL, tileIdFor } from "./explain.js"
import { DRIVER_ORDER, waterfallSteps } from "./attribution.js"

// ---------------------------------------------------------------------------------------------
// The `?` affordance: one shared handler (the app wires the explainer panel), one button per explainable thing
// ---------------------------------------------------------------------------------------------

let explainHandler = null
let plainMode = true
/** The app registers `(id, buttonEl) => panel.open(id, buttonEl)` once. */
export function setExplainHandler(fn) { explainHandler = fn }
/** Open the shared explainer from a widget that draws its own `?` (the Gantt task rows); no-op before the app wires the panel. */
export function openExplainer(id, anchorEl) { if (explainHandler && EXPLAIN[id]) explainHandler(id, anchorEl) }
/** Plain English on: labels show the explainer titles (plain words) with the model term as a tooltip; off: the model's own labels. */
export function setPlainEnglish(on) { plainMode = Boolean(on) }
export const isPlainEnglish = () => plainMode

/** Labels that are already plain, or that the team asked to keep verbatim (the 500 kW rule, the FIA position input). */
const KEEP_LABEL = new Set(["kW at Digital Realty of 500", "Constructors' position used for the sliding scale", "Seconds per lap vs Today", "Availability", "Season", "Cooling", "Heat reuse", "Model confidence", "Electricity price", "2027 IT load at the campus", "2028 IT load at the campus", "Suite ready by", "Open risks", "Interconnect", "Storage I/O", "Schedule", "Power"])

/** The label to show for a tile or control: the plain title when Plain English is on and an entry exists. */
function shownLabel(label, explainId) {
  if (!plainMode || typeof label !== "string" || !explainId || KEEP_LABEL.has(label.replace(/ · .*$/, ""))) return label
  const e = EXPLAIN[explainId]
  if (!e || !e.title) return label
  const suffix = / · (.+)$/.exec(label)
  // keep a dynamic suffix such as "· allowance 6.3" that the view appended to the model term
  return suffix && !e.title.includes(" · ") && !TILE_BY_LABEL[label] ? `${e.title} · ${suffix[1]}` : e.title
}

/** A `?` button for an EXPLAIN entry; null when the entry does not exist (the coverage test guards the ids that must). */
export function explainButton(id, titleText) {
  const entry = EXPLAIN[id]
  if (!entry) return null
  return el("button", {
    type: "button", class: "explain-btn", "aria-label": `Explain: ${titleText || entry.title}`, "aria-haspopup": "dialog", "aria-expanded": "false",
    dataset: { explain: id }, title: entry.one,
    onclick: (e) => { e.stopPropagation(); if (explainHandler) explainHandler(id, e.currentTarget) },
  }, "?")
}

export { tileIdFor }
const tileExplainId = (label, explicit) => {
  const id = explicit === false ? null : explicit || tileIdFor(label)
  return id ? (id.includes(".") ? id : `tile.${id}`) : null
}
/** Label node for a tile: plain title (when on) with the model term as a tooltip, plus the `?`. */
const tileLabel = (label, explicit) => {
  const id = tileExplainId(label, explicit)
  const shown = shownLabel(label, id)
  return [shown !== label ? el("span", { class: "label-text", title: label }, shown) : label, id ? explainButton(id, typeof label === "string" ? label : undefined) : null]
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

export function readout(control, value) {
  if (control.type === "toggle") return value ? "On" : "Off"
  if (control.format) return control.format(value)
  if (control.type === "range") return `${fmt.num(value, Number.isInteger(control.step) ? 0 : 1)}${control.unit ? ` ${control.unit}` : ""}`
  const opt = (control.options || []).find((o) => o.value === value)
  return opt ? opt.label : String(value)
}

/**
 * Just the input for a control (slider, select, segmented buttons or toggle) with a `sync(value)` method
 * on the returned node. `onChange(value)` fires on every change. Used by the plan's per-season rows.
 */
export function inputWidget(control, value, onChange, { id = `in-${control.id}`, describedBy } = {}) {
  let node
  if (control.type === "range") {
    const input = el("input", { type: "range", id, min: control.min, max: control.max, step: control.step, value, class: "slider", "aria-valuetext": readout(control, value), "aria-describedby": describedBy, "aria-label": control.label })
    const tick = el("span", { class: "slider-ceiling", hidden: true, "aria-hidden": "true" })
    const hint = el("span", { class: "clamp-hint", role: "status", hidden: true })
    let ceiling = null
    let hintTimer = 0
    const showHint = (text) => { hint.textContent = text; hint.hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(() => { hint.hidden = true }, 2400) }
    // Clamp on input: a value past the live ceiling (or under the floor) snaps back with a one-line hint
    const clampValue = (v) => {
      if (!ceiling) return v
      if (ceiling.max !== undefined && v > ceiling.max + 1e-9) { showHint(`Clamped to ${readout(control, ceiling.max)} (${ceiling.reason || "ceiling"})`); return ceiling.max }
      if (ceiling.min !== undefined && v < ceiling.min - 1e-9) { showHint(`Raised to ${readout(control, ceiling.min)} (${ceiling.reason || "floor"})`); return ceiling.min }
      return v
    }
    input.addEventListener("input", () => { const v = clampValue(Number(input.value)); input.value = String(v); input.setAttribute("aria-valuetext", readout(control, v)); onChange(v) })
    node = el("div", { class: "input-range" }, el("div", { class: "slider-wrap" }, input, tick), el("div", { class: "slider-ticks", "aria-hidden": "true" }, el("span", {}, readout(control, control.min)), el("span", {}, readout(control, control.max))), hint)
    node.sync = (v) => { input.value = String(v); input.setAttribute("aria-valuetext", readout(control, v)) }
    /** Live ceiling `{ max?, min?, reason }`: the tick marks it and the track beyond it is dimmed. */
    node.setCeiling = (c) => {
      ceiling = c && (c.max !== undefined || c.min !== undefined) ? c : null
      const span = control.max - control.min || 1
      const maxPct = ceiling && ceiling.max !== undefined && ceiling.max < control.max ? ((ceiling.max - control.min) / span) * 100 : null
      const minPct = ceiling && ceiling.min !== undefined && ceiling.min > control.min ? ((ceiling.min - control.min) / span) * 100 : null
      tick.hidden = maxPct === null && minPct === null
      if (maxPct !== null) { tick.style.left = `${maxPct.toFixed(2)}%`; tick.dataset.kind = "max"; tick.title = `Ceiling: ${readout(control, ceiling.max)}` }
      else if (minPct !== null) { tick.style.left = `${minPct.toFixed(2)}%`; tick.dataset.kind = "min"; tick.title = `Floor: ${readout(control, ceiling.min)}` }
      input.style.setProperty("--ceiling", maxPct !== null ? `${maxPct.toFixed(2)}%` : "100%")
      input.style.setProperty("--floor", minPct !== null ? `${minPct.toFixed(2)}%` : "0%")
      input.classList.toggle("has-ceiling", maxPct !== null || minPct !== null)
      input.dataset.ceiling = ceiling && ceiling.max !== undefined ? String(ceiling.max) : ""
      input.dataset.floor = ceiling && ceiling.min !== undefined ? String(ceiling.min) : ""
    }
  } else if (control.type === "select") {
    const select = el("select", { id, class: "select", "aria-describedby": describedBy, "aria-label": control.label },
      ...control.options.map((o) => el("option", { value: String(o.value), selected: o.value === value }, o.label)))
    select.addEventListener("change", () => { const opt = control.options.find((o) => String(o.value) === select.value); onChange(opt ? opt.value : select.value) })
    node = select
    node.sync = (v) => { select.value = String(v) }
    /** Options that would not fit: disabled, with the reason appended ("won't fit"). */
    node.setDisabledOptions = (map = {}) => {
      for (const opt of select.options) {
        const o = control.options.find((c) => String(c.value) === opt.value)
        const reason = o ? map[o.value] : undefined
        opt.disabled = Boolean(reason)
        opt.textContent = reason ? `${o.label} · won't fit` : o ? o.label : opt.textContent
        if (reason) opt.title = reason
        else opt.removeAttribute("title")
      }
    }
  } else if (control.type === "segmented") {
    const group = el("div", { class: "segmented", role: "group", "aria-label": control.label, id })
    for (const o of control.options) {
      const btn = el("button", { type: "button", class: "seg", "aria-pressed": o.value === value ? "true" : "false", dataset: { value: String(o.value) } }, o.label)
      btn.addEventListener("click", () => { if (btn.disabled) return; for (const b of group.children) b.setAttribute("aria-pressed", b === btn ? "true" : "false"); onChange(o.value) })
      group.append(btn)
    }
    node = group
    node.sync = (v) => { for (const b of group.children) b.setAttribute("aria-pressed", b.dataset.value === String(v) ? "true" : "false") }
    node.setDisabledOptions = (map = {}) => {
      for (const b of group.children) {
        const o = control.options.find((c) => String(c.value) === b.dataset.value)
        const reason = o ? map[o.value] : undefined
        b.disabled = Boolean(reason)
        b.classList.toggle("wont-fit", Boolean(reason))
        b.title = reason ? `Won't fit: ${reason}` : ""
        b.setAttribute("aria-label", reason ? `${o.label} (won't fit: ${reason})` : o ? o.label : b.textContent)
      }
    }
  } else {
    const btn = el("button", { type: "button", class: "toggle", id, role: "switch", "aria-checked": value ? "true" : "false", "aria-describedby": describedBy, "aria-label": control.label },
      el("span", { class: "toggle-knob", "aria-hidden": "true" }), el("span", { class: "toggle-text" }, value ? "On" : "Off"))
    btn.addEventListener("click", () => { const next = btn.getAttribute("aria-checked") !== "true"; btn.setAttribute("aria-checked", next ? "true" : "false"); btn.querySelector(".toggle-text").textContent = next ? "On" : "Off"; onChange(next) })
    node = btn
    node.sync = (v) => { btn.setAttribute("aria-checked", v ? "true" : "false"); btn.querySelector(".toggle-text").textContent = v ? "On" : "Off" }
  }
  return node
}

/**
 * A plan control: one row holding the 2027 value and the 2028 value. 2028 shows "Same as 2027" until it is
 * detached; shared controls (position, confidence, …) show a single input for both seasons.
 * `handlers`: onChange(year, id, value), onDetach(id), onReattach(id). The node carries `sync(view)`.
 */
export function planControl(control, view, handlers) {
  const base = `pc-${control.id}`
  const row = el("div", { class: `control plan-control control-${control.type} ${view.shared ? "is-shared" : ""}`, dataset: { control: control.id, detached: view.detached ? "true" : "false" } })
  const out27 = el("output", { class: "control-readout", id: `${base}-out-2027`, dataset: { season: "2027" } }, readout(control, view.v27))
  const out28 = el("output", { class: "control-readout", id: `${base}-out-2028`, dataset: { season: "2028" } }, readout(control, view.v28))
  const labelEl = el("span", { class: "control-label", id: `${base}-label` })
  const syncLabel = () => {
    const shown = shownLabel(control.label, `control.${control.id}`)
    labelEl.textContent = shown
    if (shown !== control.label) labelEl.title = control.label; else labelEl.removeAttribute("title")
  }
  syncLabel()
  const head = el("div", { class: "control-head" },
    labelEl,
    explainButton(`control.${control.id}`, control.label),
    control.fia ? el("span", { class: "fia-badge", title: "FIA rule this control touches" }, control.fia) : null,
    view.shared ? el("span", { class: "season-tag both" }, "Both seasons") : null,
    el("span", { class: "readouts" }, view.shared ? out27 : [el("span", { class: "readout-pair" }, el("span", { class: "season-tag" }, "27"), out27), el("span", { class: "readout-pair" }, el("span", { class: "season-tag" }, "28"), out28)]),
  )
  const in27 = inputWidget(control, view.v27, (v) => handlers.onChange(view.shared ? null : 2027, control.id, v), { id: `${base}-2027`, describedBy: `${base}-why` })
  const in28 = inputWidget(control, view.v28, (v) => handlers.onChange(2028, control.id, v), { id: `${base}-2028`, describedBy: `${base}-why` })
  const row27 = el("div", { class: "season-row s2027" }, view.shared ? null : el("span", { class: "season-label" }, "2027"), in27)
  const inherit = el("button", { type: "button", class: "inherit-pill", "aria-pressed": "true", title: "2028 follows 2027. Click to set a different value for 2028.", onclick: () => handlers.onDetach(control.id) }, el("span", { class: "inherit-check", "aria-hidden": "true" }, "✓"), "Same as 2027 · ", el("u", {}, "change for 2028"))
  const reattach = el("button", { type: "button", class: "btn btn-tiny reattach", title: "Back to the 2027 value", onclick: () => handlers.onReattach(control.id) }, "Same as 2027")
  const row28 = el("div", { class: "season-row s2028" }, el("span", { class: "season-label" }, "2028"), inherit, in28, reattach)
  row.append(head, row27, ...(view.shared ? [] : [row28]), el("p", { class: "why", id: `${base}-why` }, control.why))
  const apply = (v) => {
    out27.textContent = readout(control, v.v27)
    out28.textContent = readout(control, v.v28)
    in27.sync(v.v27)
    in28.sync(v.v28)
    if (in27.setCeiling) { in27.setCeiling(v.ceiling27 || null); in28.setCeiling(v.ceiling28 || null) }
    if (in27.setDisabledOptions) { in27.setDisabledOptions(v.disabled27 || {}); in28.setDisabledOptions(v.disabled28 || {}) }
    row.dataset.detached = v.detached ? "true" : "false"
    inherit.hidden = Boolean(v.detached)
    in28.hidden = !v.detached
    reattach.hidden = !v.detached
    row.hidden = v.hidden === true
    row27.classList.toggle("na", v.na27 === true)
    row28.classList.toggle("na", v.na28 === true)
    row.classList.toggle("at-ceiling", Boolean(v.atCeiling))
    syncLabel()
  }
  apply(view)
  row.sync = apply
  return row
}

/**
 * One control row: label + readout, the input (slider, select, segmented buttons or toggle), the FIA badge and
 * the "why it matters" line. `onChange(id, value)` is called on every change.
 */
export function controlRow(control, value, onChange) {
  const id = `ctl-${control.id}`
  const row = el("div", { class: `control control-${control.type}`, dataset: { control: control.id } })
  const head = el("div", { class: "control-head" },
    el("label", { for: id, class: "control-label" }, control.label),
    explainButton(`control.${control.id}`, control.label),
    control.fia ? el("span", { class: "fia-badge", title: "FIA rule this control touches" }, control.fia) : null,
    el("output", { class: "control-readout", id: `${id}-out`, for: id }, readout(control, value)),
  )
  row.append(head)

  if (control.type === "range") {
    const input = el("input", {
      type: "range", id, min: control.min, max: control.max, step: control.step, value,
      class: "slider", "aria-valuetext": readout(control, value), "aria-describedby": `${id}-why`,
    })
    input.addEventListener("input", () => {
      const v = Number(input.value)
      head.querySelector("output").textContent = readout(control, v)
      input.setAttribute("aria-valuetext", readout(control, v))
      onChange(control.id, v)
    })
    const ticks = el("div", { class: "slider-ticks", "aria-hidden": "true" }, el("span", {}, readout(control, control.min)), el("span", {}, readout(control, control.max)))
    row.append(input, ticks)
  } else if (control.type === "select") {
    const select = el("select", { id, class: "select", "aria-describedby": `${id}-why` },
      ...control.options.map((o) => el("option", { value: String(o.value), selected: o.value === value }, o.label)))
    select.addEventListener("change", () => {
      const raw = select.value
      const opt = control.options.find((o) => String(o.value) === raw)
      const v = opt ? opt.value : raw
      head.querySelector("output").textContent = readout(control, v)
      onChange(control.id, v)
    })
    row.append(select)
  } else if (control.type === "segmented") {
    const group = el("div", { class: "segmented", role: "group", "aria-labelledby": `${id}-label`, id })
    head.querySelector("label").id = `${id}-label`
    head.querySelector("label").removeAttribute("for")
    for (const o of control.options) {
      const btn = el("button", { type: "button", class: "seg", "aria-pressed": o.value === value ? "true" : "false", dataset: { value: String(o.value) } }, o.label)
      btn.addEventListener("click", () => {
        for (const b of group.children) b.setAttribute("aria-pressed", b === btn ? "true" : "false")
        head.querySelector("output").textContent = readout(control, o.value)
        onChange(control.id, o.value)
      })
      group.append(btn)
    }
    row.append(group)
  } else if (control.type === "toggle") {
    const btn = el("button", { type: "button", class: "toggle", id, role: "switch", "aria-checked": value ? "true" : "false", "aria-describedby": `${id}-why` },
      el("span", { class: "toggle-knob", "aria-hidden": "true" }), el("span", { class: "toggle-text" }, value ? "On" : "Off"))
    head.querySelector("output").textContent = ""
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("aria-checked") !== "true"
      btn.setAttribute("aria-checked", next ? "true" : "false")
      btn.querySelector(".toggle-text").textContent = next ? "On" : "Off"
      onChange(control.id, next)
    })
    row.append(btn)
  }
  row.append(el("p", { class: "why", id: `${id}-why` }, control.why))
  return row
}

/** Update a rendered control row to show `value` without re-creating it (used by presets, load, undo). */
export function setControlValue(row, control, value) {
  const out = row.querySelector("output")
  if (control.type === "range") {
    const input = row.querySelector("input")
    input.value = String(value)
    input.setAttribute("aria-valuetext", readout(control, value))
    out.textContent = readout(control, value)
  } else if (control.type === "select") {
    row.querySelector("select").value = String(value)
    out.textContent = readout(control, value)
  } else if (control.type === "segmented") {
    for (const b of row.querySelectorAll(".seg")) b.setAttribute("aria-pressed", b.dataset.value === String(value) ? "true" : "false")
    out.textContent = readout(control, value)
  } else if (control.type === "toggle") {
    const btn = row.querySelector(".toggle")
    btn.setAttribute("aria-checked", value ? "true" : "false")
    btn.querySelector(".toggle-text").textContent = value ? "On" : "Off"
  }
}

// ---------------------------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------------------------

const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
const arc = (cx, cy, r, from, to) => {
  const [x1, y1] = polar(cx, cy, r, from)
  const [x2, y2] = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

/**
 * A 240° arc gauge. `value` in [0, max]; `marks` are optional {at, label} ticks; `tone` colours the arc.
 */
export function gauge({ label, value, max = 1, display, sub, tone = "ok", marks = [], size = 128, id, explain }) {
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  const start = -120
  const sweep = 240
  const r = 46
  const cx = 60
  const cy = 62
  const svgNode = svg("svg", { viewBox: "0 0 120 110", class: `gauge-svg tone-${tone}`, width: size, height: size * 0.92, role: "img", "aria-label": `${label}: ${display}` },
    svg("path", { class: "gauge-track", d: arc(cx, cy, r, start, start + sweep) }),
    frac > 0 ? svg("path", { class: "gauge-value", d: arc(cx, cy, r, start, start + Math.max(0.5, sweep * frac)) }) : null,
    ...marks.map((m) => {
      const deg = start + sweep * Math.max(0, Math.min(1, m.at / max))
      const [x1, y1] = polar(cx, cy, r - 7, deg)
      const [x2, y2] = polar(cx, cy, r + 7, deg)
      return svg("g", { class: "gauge-mark" },
        svg("line", { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) }),
        m.label ? svg("text", { x: polar(cx, cy, r + 15, deg)[0].toFixed(1), y: (polar(cx, cy, r + 15, deg)[1] + 3).toFixed(1), "text-anchor": "middle" }, m.label) : null)
    }),
    svg("text", { x: cx, y: cy + 4, class: `gauge-display ${String(display).length > 8 ? "long" : ""}`, "text-anchor": "middle" }, display),
    sub ? svg("text", { x: cx, y: cy + 20, class: "gauge-sub", "text-anchor": "middle" }, sub) : null,
  )
  return el("div", { class: "gauge", id }, svgNode, el("div", { class: "gauge-label" }, ...tileLabel(label, explain)))
}

/** A horizontal capacity bar: `value` against `max`, with an optional `limit` marker. */
export function bar({ label, value, max, display, limit, tone = "ok", id, explain }) {
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  return el("div", { class: `bar tone-${tone}`, id },
    el("div", { class: "bar-head" }, el("span", {}, ...tileLabel(label, explain)), el("b", {}, display)),
    el("div", { class: "bar-track" },
      el("div", { class: "bar-fill", style: { width: `${(frac * 100).toFixed(1)}%` } }),
      limit !== undefined && max > 0 ? el("div", { class: "bar-limit", style: { left: `${(Math.min(1, limit / max) * 100).toFixed(1)}%` } }) : null),
  )
}

export const badge = (level, text) => el("span", { class: `badge level-${level}` }, text)

/** A compliance flag row. */
export function flagRow(f, opts) {
  const plainEnglish = opts && typeof opts === "object" && "plainEnglish" in opts ? opts.plainEnglish : plainMode
  const explainId = EXPLAIN[`flag.${f.id}`] ? `flag.${f.id}` : null
  return el("li", { class: `flag level-${f.level}`, dataset: { flag: f.id, level: f.level } },
    el("span", { class: "flag-dot", "aria-hidden": "true" }),
    el("div", { class: "flag-body" },
      el("div", { class: "flag-title" }, f.title, f.rule ? el("span", { class: "fia-badge" }, f.rule) : null, explainId ? explainButton(explainId, f.title) : null),
      f.detail ? el("div", { class: "flag-detail" }, f.detail) : null,
      plainEnglish && explainId ? el("div", { class: "flag-plain muted small" }, EXPLAIN[explainId].one) : null),
  )
}

/** Key/value stat tile. */
export const stat = (label, value, sub, extra = {}) => el("div", { class: `stat ${extra.class || ""}`, id: extra.id },
  el("div", { class: "stat-label" }, ...tileLabel(label, extra.explain ?? (extra.id && EXPLAIN[`tile.${extra.id}`] ? extra.id : undefined))), el("div", { class: "stat-value" }, value), sub ? el("div", { class: "stat-sub" }, sub) : null)

// ---------------------------------------------------------------------------------------------
// Plain English switch and the "Where the seconds come from" waterfall
// ---------------------------------------------------------------------------------------------

export function plainToggle(value, onChange) {
  const btn = el("button", { type: "button", class: "plain-toggle", id: "plain-english", role: "switch", "aria-checked": String(Boolean(value)), title: "Plain words on every label, the model's own terms when off", onclick: () => onChange(btn.getAttribute("aria-checked") !== "true") },
    el("span", { class: "plain-track", "aria-hidden": "true" }, el("span", { class: "plain-knob" })), el("span", { class: "plain-text" }, "Plain English"))
  btn.sync = (v) => btn.setAttribute("aria-checked", String(Boolean(v)))
  return btn
}

const MODES = { sec: { label: "seconds per lap", fmt: (v) => fmt.sec(v), unit: "s" }, savedCHF: { label: "CHF saved inside the cap a year", fmt: (v) => fmt.chfDelta(v), unit: "CHF" }, effMauhDelta: { label: "effective million unit-hours per period", fmt: (v) => fmt.signed(v, 2, " MAUh"), unit: "MAUh" } }

/**
 * Floating horizontal waterfall of the attribution for one season: one bar per active driver in the fixed order,
 * a baseline step when the season carries months on another estate, then the total in the headline colour.
 * `attribution` is attribute()'s result; `onBar(driverId, buttonEl)` opens the driver's explainer. A visually hidden
 * table repeats the numbers for screen readers. `compact` draws bars only (strategy cards).
 */
export function waterfall({ attribution, season, plainEnglish = true, cpuArch = "today", mode = "sec", compact = false, id, onBar, status = "ok" }) {
  const L = explainLabels(plainEnglish)
  const M = MODES[mode] || MODES.sec
  const steps = attribution ? waterfallSteps(attribution, DRIVER_ORDER, { outcome: mode }) : []
  const rows = steps.filter((st) => st.kind === "driver" || (st.kind === "baseline" && Math.abs(st.value) > 1e-6))
  const last = steps.find((st) => st.kind === "total") || { value: 0 }
  // The total is the bars' running sum; shave the float noise so it rounds exactly as the headline does (0.425 → +0.42 s).
  const total = { ...last, value: Math.round(last.value * 1e6) / 1e6 }
  const labelOf = (st) => (st.kind === "baseline" ? (season === 2028 ? "2027 estate until the step-up" : "Carried over") : L.barLabel(st.id, cpuArch))
  const W = compact ? 320 : 640
  const labelW = compact ? 118 : 236
  const rowH = compact ? 16 : 26
  const gap = compact ? 4 : 8
  const top = compact ? 4 : 10
  const H = top + (rows.length + 1) * (rowH + gap) + (compact ? 6 : 24)
  const values = [0, ...steps.map((st) => st.from), ...steps.map((st) => st.to)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1e-6, max - min)
  const x = (v) => labelW + 8 + ((v - min) / span) * (W - labelW - (compact ? 56 : 96))
  const y = (i) => top + i * (rowH + gap)
  const title = `${L.title("tile.waterfall")}, ${season}`
  const aria = rows.length ? `${title}: ${rows.map((st) => `${labelOf(st)} ${M.fmt(st.value)}`).join("; ")}; total ${M.fmt(total.value)}` : `${title}: nothing changed yet`
  const node = el("div", { class: `waterfall ${compact ? "compact" : ""} status-${status} ${total.value < -1e-9 ? "tone-neg" : "tone-pos"}`, id, dataset: { season: String(season), mode } })
  if (!attribution) { node.append(el("p", { class: "muted small waterfall-empty" }, "Working out where the seconds come from…")); return node }
  if (!rows.length) { node.append(el("p", { class: "muted small waterfall-empty" }, "Nothing changed yet — move a slider to see where the seconds come from.")); return node }
  const chart = svg("svg", { class: "waterfall-svg", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": aria },
    svg("line", { x1: x(0), x2: x(0), y1: top - 4, y2: y(rows.length) + rowH + 4, class: "wf-zero" }),
    ...rows.map((st, i) => {
      const x0 = x(Math.min(st.from, st.to))
      const x1 = x(Math.max(st.from, st.to))
      const label = labelOf(st)
      const shown = !compact && label.length > 36 ? `${label.slice(0, 35).trimEnd()}…` : compact && label.length > 20 ? `${label.slice(0, 19).trimEnd()}…` : label
      const positive = st.value >= 0
      const next = rows[i + 1] || total
      const g = svg("g", { class: `wf-row kind-${st.kind} ${positive ? "pos" : "neg"} ${st.id === "cpuArch" ? "arch" : ""}`, dataset: { driver: st.id } },
        svg("title", {}, `${label}: ${M.fmt(st.value)}${st.share !== undefined ? ` (${fmt.pct(st.share)})` : ""}`),
        svg("text", { x: labelW, y: y(i) + rowH * 0.68, "text-anchor": "end", class: "wf-label" }, shown),
        svg("rect", { x: x0, y: y(i), width: Math.max(2, x1 - x0), height: rowH, rx: 3, class: "wf-bar" }),
        Math.abs(st.value) < 1e-9 ? svg("circle", { cx: x(st.to), cy: y(i) + rowH / 2, r: 3, class: "wf-dot" }) : null,
        svg("line", { x1: x(st.to), x2: x(st.to), y1: y(i) + rowH, y2: y(i + 1), class: "wf-connector" }),
        compact ? null : svg("text", { x: (positive ? x1 : x0) + (positive ? 6 : -6), y: y(i) + rowH * 0.68, "text-anchor": positive ? "start" : "end", class: "wf-value" }, `${M.fmt(st.value)}${st.share !== undefined && mode === "sec" ? ` · ${fmt.pct(st.share)}` : ""}`),
        next ? null : null)
      if (st.kind === "driver") {
        g.setAttribute("role", "button")
        g.setAttribute("tabindex", "0")
        g.setAttribute("aria-label", `Explain: ${label}, ${M.fmt(st.value)}`)
        g.dataset.explain = `driver.${st.id}`
        const act = (e) => { e.stopPropagation(); if (onBar) onBar(st.id, g); else if (explainHandler) explainHandler(`driver.${st.id}`, g) }
        g.addEventListener("click", act)
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(e) } })
      }
      return g
    }),
    svg("g", { class: "wf-row kind-total" },
      svg("text", { x: labelW, y: y(rows.length) + rowH * 0.68, "text-anchor": "end", class: "wf-label total" }, compact ? "Total" : "This plan"),
      svg("rect", { x: x(Math.min(0, total.value)), y: y(rows.length), width: Math.max(2, Math.abs(x(total.value) - x(0))), height: rowH, rx: 3, class: "wf-bar total" }),
      compact ? null : svg("text", { x: x(Math.max(0, total.value)) + 6, y: y(rows.length) + rowH * 0.68, class: "wf-value total" }, M.fmt(total.value))))
  const table = el("table", { class: "waterfall-table" },
    el("caption", {}, aria),
    el("thead", {}, el("tr", {}, el("th", {}, "Part of the plan"), el("th", {}, M.label))),
    el("tbody", {}, ...rows.map((st) => el("tr", {}, el("td", {}, labelOf(st)), el("td", {}, M.fmt(st.value)))), el("tr", { class: "total" }, el("td", {}, "Total"), el("td", {}, M.fmt(total.value)))))
  node.append(chart, el("div", { class: "visually-hidden" }, table))
  if (!compact) {
    const pruned = attribution.drivers.filter((d) => d.pruned)
    if (pruned.length) node.append(el("p", { class: "muted small wf-pruned" }, `Unchanged from Today: ${pruned.map((d) => L.barLabel(d.id, cpuArch)).join(", ")}.`))
  }
  return node
}

/**
 * The envelope gauge: kW at Digital Realty against the 500 kW offer for one season. `env` is a model envelope;
 * tone follows the plan-health rule (green ≤ 90 %, amber to 100 %, red over). In hybrid plans a second gauge
 * shows what Hinwil keeps against the room.
 */
export function envelopeGauge(env, season, { id, size = 120 } = {}) {
  const kw = Math.round(env.drIT)
  const tone = env.drIT > env.offerKW ? "bad" : env.tone === "warn" ? "warn" : "ok"
  const over = env.drIT > env.offerKW
  return gauge({
    id, size, tone,
    label: `kW at Digital Realty of ${env.offerKW} · ${season}`,
    value: Math.min(env.drIT, env.offerKW), max: env.offerKW,
    display: over ? "Not possible" : `${kw} kW`,
    sub: over ? `${kw} of ${env.offerKW} kW` : `${Math.round(env.headroomKW)} kW to spare`,
    marks: [{ at: env.offerKW * 0.9 }],
  })
}

/** The Hinwil-side gauge for hybrid plans: what the room keeps against its capacity. */
export function hinwilGauge(env, season, { id, size = 120 } = {}) {
  const kw = Math.round(env.hinwilIT)
  const over = env.hinwilIT > env.hinwilCapacity
  return gauge({
    id, size, tone: over ? "bad" : env.hinwilIT > env.hinwilCapacity * 0.9 ? "warn" : "ok",
    label: `kW kept at Hinwil of ${env.hinwilCapacity} · ${season}`,
    value: Math.min(env.hinwilIT, env.hinwilCapacity), max: env.hinwilCapacity,
    display: over ? "Not possible" : `${kw} kW`,
    sub: over ? `${kw} of ${env.hinwilCapacity} kW` : `${Math.round(env.hinwilCapacity - env.hinwilIT)} kW to spare`,
    marks: [{ at: env.hinwilCapacity * 0.9 }],
  })
}
