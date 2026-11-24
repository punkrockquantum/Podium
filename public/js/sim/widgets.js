/** Controls, gauges, badges and bars for the simulator. All functions return DOM nodes. */
import { el, svg, fmt } from "./dom.js"

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
    input.addEventListener("input", () => { const v = Number(input.value); input.setAttribute("aria-valuetext", readout(control, v)); onChange(v) })
    node = el("div", { class: "input-range" }, input, el("div", { class: "slider-ticks", "aria-hidden": "true" }, el("span", {}, readout(control, control.min)), el("span", {}, readout(control, control.max))))
    node.sync = (v) => { input.value = String(v); input.setAttribute("aria-valuetext", readout(control, v)) }
  } else if (control.type === "select") {
    const select = el("select", { id, class: "select", "aria-describedby": describedBy, "aria-label": control.label },
      ...control.options.map((o) => el("option", { value: String(o.value), selected: o.value === value }, o.label)))
    select.addEventListener("change", () => { const opt = control.options.find((o) => String(o.value) === select.value); onChange(opt ? opt.value : select.value) })
    node = select
    node.sync = (v) => { select.value = String(v) }
  } else if (control.type === "segmented") {
    const group = el("div", { class: "segmented", role: "group", "aria-label": control.label, id })
    for (const o of control.options) {
      const btn = el("button", { type: "button", class: "seg", "aria-pressed": o.value === value ? "true" : "false", dataset: { value: String(o.value) } }, o.label)
      btn.addEventListener("click", () => { for (const b of group.children) b.setAttribute("aria-pressed", b === btn ? "true" : "false"); onChange(o.value) })
      group.append(btn)
    }
    node = group
    node.sync = (v) => { for (const b of group.children) b.setAttribute("aria-pressed", b.dataset.value === String(v) ? "true" : "false") }
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
  const head = el("div", { class: "control-head" },
    el("span", { class: "control-label", id: `${base}-label` }, control.label),
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
  row.append(head, row27, view.shared ? null : row28, el("p", { class: "why", id: `${base}-why` }, control.why))
  const apply = (v) => {
    out27.textContent = readout(control, v.v27)
    out28.textContent = readout(control, v.v28)
    in27.sync(v.v27)
    in28.sync(v.v28)
    row.dataset.detached = v.detached ? "true" : "false"
    inherit.hidden = Boolean(v.detached)
    in28.hidden = !v.detached
    reattach.hidden = !v.detached
    row.hidden = v.hidden === true
    row27.classList.toggle("na", v.na27 === true)
    row28.classList.toggle("na", v.na28 === true)
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
export function gauge({ label, value, max = 1, display, sub, tone = "ok", marks = [], size = 128, id }) {
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
    svg("text", { x: cx, y: cy + 4, class: "gauge-display", "text-anchor": "middle" }, display),
    sub ? svg("text", { x: cx, y: cy + 20, class: "gauge-sub", "text-anchor": "middle" }, sub) : null,
  )
  return el("div", { class: "gauge", id }, svgNode, el("div", { class: "gauge-label" }, label))
}

/** A horizontal capacity bar: `value` against `max`, with an optional `limit` marker. */
export function bar({ label, value, max, display, limit, tone = "ok", id }) {
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  return el("div", { class: `bar tone-${tone}`, id, role: "img", "aria-label": `${label}: ${display}` },
    el("div", { class: "bar-head" }, el("span", {}, label), el("b", {}, display)),
    el("div", { class: "bar-track" },
      el("div", { class: "bar-fill", style: { width: `${(frac * 100).toFixed(1)}%` } }),
      limit !== undefined && max > 0 ? el("div", { class: "bar-limit", style: { left: `${(Math.min(1, limit / max) * 100).toFixed(1)}%` } }) : null),
  )
}

export const badge = (level, text) => el("span", { class: `badge level-${level}` }, text)

/** A compliance flag row. */
export function flagRow(f) {
  return el("li", { class: `flag level-${f.level}`, dataset: { flag: f.id, level: f.level } },
    el("span", { class: "flag-dot", "aria-hidden": "true" }),
    el("div", { class: "flag-body" },
      el("div", { class: "flag-title" }, f.title, f.rule ? el("span", { class: "fia-badge" }, f.rule) : null),
      f.detail ? el("div", { class: "flag-detail" }, f.detail) : null),
  )
}

/** Key/value stat tile. */
export const stat = (label, value, sub, extra = {}) => el("div", { class: `stat ${extra.class || ""}`, id: extra.id },
  el("div", { class: "stat-label" }, label), el("div", { class: "stat-value" }, value), sub ? el("div", { class: "stat-sub" }, sub) : null)

/** The lap-time ladder: rungs for the midfield positions, Today at the team's position, the scenario marker. */
export function ladder({ rungs, position, sec, scenarioPosition }) {
  const w = 480
  const rowH = 26
  const h = rungs.length * rowH + 30
  const minSec = Math.min(...rungs.map((r) => r.sec), -sec) - 0.05
  const maxSec = Math.max(...rungs.map((r) => r.sec), -sec) + 0.05
  const xOf = (s) => 120 + ((s - minSec) / (maxSec - minSec || 1)) * (w - 150)
  const yOf = (p) => 22 + (p - rungs[0].position) * rowH + rowH / 2
  const node = svg("svg", { viewBox: `0 0 ${w} ${h}`, class: "ladder-svg", role: "img", "aria-label": `Lap-time ladder: scenario at ${fmt.sec(-sec)} against today's position P${position}` })
  for (const r of rungs) {
    const y = yOf(r.position)
    const isToday = r.position === position
    node.append(svg("g", { class: `rung ${isToday ? "today" : ""}` },
      svg("line", { x1: 100, y1: y, x2: w - 10, y2: y }),
      svg("text", { x: 8, y: y + 4, class: "rung-pos" }, `P${r.position}`),
      svg("text", { x: 40, y: y + 4, class: "rung-sec" }, isToday ? "today" : fmt.sec(r.sec)),
    ))
  }
  const yScenario = yOf(Math.max(rungs[0].position, Math.min(rungs[rungs.length - 1].position, scenarioPosition)))
  node.append(svg("line", { class: "ladder-path", x1: xOf(0), y1: yOf(position), x2: xOf(-sec), y2: yScenario }))
  node.append(svg("circle", { class: "marker today", cx: xOf(0), cy: yOf(position), r: 6 }))
  node.append(svg("circle", { class: "marker scenario", cx: xOf(-sec), cy: yScenario, r: 7 }))
  node.append(svg("text", { class: "marker-text", x: xOf(-sec), y: yScenario - 12, "text-anchor": "middle" }, fmt.sec(sec)))
  return node
}
