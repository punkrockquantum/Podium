/**
 * The one shared explainer dialog (`#explain-panel`): a side panel at ≥ 1200 px, a popover anchored to the `?`
 * button below that. Opening a second `?` swaps the content; Escape, the × button, a click outside and a view
 * change close it and give focus back to the button. `refresh()` re-fills the "In this plan" lines on every
 * render, so the text follows the sliders while the panel stays open. DOM only: the copy comes from explain.js,
 * the numbers from the context the app provides.
 *
 *   const panel = createExplainPanel({ getContext, onNavigate })
 *   panel.open("control.clockGHz", buttonEl)   panel.refresh()   panel.close()
 *
 *   getContext() → { plainEnglish, seasons: { 2027: ctx, 2028: ctx }, pruned: (id) => boolean }
 *   each season ctx is an explainContext() result (x, s, t, p, a, d, K, fmt, labelsFor)
 */
import { EXPLAIN, explainText } from "./explain.js"
import { el, clear, fill } from "./dom.js"

const SIDE_MIN_WIDTH = 1200
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

export function createExplainPanel({ getContext, onNavigate = null } = {}) {
  const title = el("h2", { id: "explain-title", class: "explain-title" })
  const closeBtn = el("button", { type: "button", class: "explain-close", "aria-label": "Close the explainer", onclick: () => close() }, "×")
  const body = el("div", { class: "explain-body" })
  const panel = el("aside", { id: "explain-panel", class: "explain-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "explain-title", hidden: true, tabindex: "-1" },
    el("div", { class: "explain-head" }, title, closeBtn), body)
  document.body.append(panel)

  let currentId = null
  let anchor = null
  let opener = null
  let history = []

  const isSide = () => window.innerWidth >= SIDE_MIN_WIDTH

  function entryOf(id) { return EXPLAIN[id] || null }

  function kindLabel(id) {
    const kind = id.split(".")[0]
    return { control: "Control", tile: "Figure", flag: "Flag", driver: "Where the seconds come from", strategy: "Strategy", term: "Glossary", milestone: "Milestone" }[kind] || ""
  }

  /** The "In this plan" lines: one per season when they differ, else one. */
  function inPlanLines(id) {
    const ctx = getContext ? getContext() : null
    const entry = entryOf(id)
    if (!ctx || !entry || !entry.inPlan) return []
    const seasons = Object.entries(ctx.seasons || {})
    const lines = seasons.map(([year, c]) => ({ year, text: explainText(id, c, { pruned: ctx.pruned ? ctx.pruned(id, Number(year)) : false }) })).filter((l) => l.text)
    if (lines.length === 2 && lines[0].text === lines[1].text) return [{ year: "both seasons", text: lines[0].text }]
    return lines
  }

  function render(id) {
    const entry = entryOf(id)
    const ctx = getContext ? getContext() : { plainEnglish: true }
    const plain = ctx.plainEnglish !== false
    title.textContent = entry ? entry.title : id
    clear(body)
    if (!entry) { body.append(el("p", { class: "muted" }, "No explainer for this item yet.")); return }
    const lines = inPlanLines(id)
    const more = el("details", { class: "explain-more", open: plain && isSide() ? "" : null }, el("summary", {}, "More"), ...(entry.more || []).map((p) => el("p", {}, p)))
    const sources = (entry.source || "").split("·").map((s) => s.trim()).filter(Boolean)
    const sourceChips = sources.length ? el("div", { class: "explain-chips explain-sources" }, el("span", { class: "muted small" }, "Sources "), ...sources.map((src) => el("a", { class: "chip chip-source", href: "#/model", dataset: { source: src }, title: /^F|^D\d|^C\d\./.test(src) ? `FIA Financial Regulations ${src}` : src === "model" ? "A modelling choice with no external source" : `Fact pack row ${src} (docs/audi-f1-sources.md)`, onclick: (e) => { if (onNavigate) { e.preventDefault(); onNavigate("model", src) } } }, src))) : null
    const terms = (entry.terms || []).filter((t) => EXPLAIN[t])
    const termChips = terms.length ? el("div", { class: "explain-chips explain-terms" }, el("span", { class: "muted small" }, "Glossary "), ...terms.map((t) => el("button", { type: "button", class: "chip chip-term", dataset: { explainTerm: t }, onclick: () => { history.push(currentId); show(t) } }, EXPLAIN[t].title))) : null
    const back = history.length ? el("button", { type: "button", class: "linkish explain-back", onclick: () => { const prev = history.pop(); show(prev) } }, "← back") : null
    fill(body,
      el("div", { class: "explain-kind muted small" }, kindLabel(id), entry.term && entry.term !== entry.title ? el("span", { class: "explain-term" }, ` · ${entry.term}`) : null),
      el("p", { class: "explain-one" }, entry.one),
      lines.length ? el("div", { class: "explain-inplan", id: "explain-inplan" }, el("div", { class: "inplan-label" }, "In this plan"), ...lines.map((l) => el("p", { dataset: { season: l.year } }, lines.length > 1 || l.year !== "both seasons" ? el("b", {}, `${l.year}: `) : null, l.text))) : null,
      plain ? more : null,
      entry.analogy ? el("p", { class: "explain-analogy" }, el("i", {}, `Think of it as ${entry.analogy.charAt(0).toLowerCase()}${entry.analogy.slice(1)}`)) : null,
      !plain ? sourceChips : null,
      !plain ? more : null,
      termChips,
      plain ? sourceChips : null,
      back)
  }

  /** Side panel on wide screens, else a popover anchored to the `?` (the panel is position: fixed, so viewport coordinates). */
  function place() {
    const side = isSide()
    panel.dataset.mode = side ? "side" : "popover"
    document.body.classList.toggle("explain-side", side)
    panel.style.top = ""
    panel.style.left = ""
    panel.style.width = ""
    panel.style.removeProperty("--arrow-x")
    delete panel.dataset.placement
    if (side || !anchor) return
    const r = anchor.getBoundingClientRect()
    const width = Math.min(360, window.innerWidth - 16)
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8))
    panel.style.width = `${width}px`
    panel.style.left = `${left}px`
    const height = panel.offsetHeight || 320
    const below = r.bottom + 10 + height <= window.innerHeight || r.top - 10 - height < 8
    const top = below ? Math.min(r.bottom + 10, window.innerHeight - height - 8) : Math.max(8, r.top - 10 - height)
    panel.style.top = `${Math.max(8, top)}px`
    panel.style.setProperty("--arrow-x", `${Math.round(r.left + r.width / 2 - left - 6)}px`)
    panel.dataset.placement = below ? "below" : "above"
  }

  function show(id) {
    currentId = id
    render(id)
    panel.hidden = false
    place()
    document.body.classList.add("explain-open")
  }

  function open(id, anchorEl) {
    if (opener && opener !== anchorEl) opener.setAttribute("aria-expanded", "false")
    if (currentId === id && !panel.hidden && opener === anchorEl) { close(); return }
    history = []
    anchor = anchorEl || null
    opener = anchorEl || null
    if (opener) opener.setAttribute("aria-expanded", "true")
    show(id)
    const first = panel.querySelector(FOCUSABLE)
    ;(first || panel).focus({ preventScroll: true })
  }

  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return
    panel.hidden = true
    document.body.classList.remove("explain-open", "explain-side")
    if (opener) opener.setAttribute("aria-expanded", "false")
    const toFocus = opener && !opener.isConnected && opener.dataset.explain ? document.querySelector(`[data-explain="${CSS.escape(opener.dataset.explain)}"]`) || opener : opener
    currentId = null
    anchor = null
    opener = null
    history = []
    if (restoreFocus && toFocus && toFocus.isConnected) toFocus.focus({ preventScroll: true })
  }

  /** After a re-render the opener may have been rebuilt: re-attach to the button with the same id so aria-expanded, focus return and the popover anchor stay right. */
  function reattach() {
    if (!opener || opener.isConnected) return
    const again = document.querySelector(`[data-explain="${CSS.escape(opener.dataset.explain || "")}"]`)
    if (!again) return
    again.setAttribute("aria-expanded", "true")
    opener = again
    anchor = again
    if (!isSide()) place()
  }

  function refresh() {
    if (panel.hidden || !currentId) return
    reattach()
    const box = panel.querySelector("#explain-inplan")
    const lines = inPlanLines(currentId)
    if (!box && !lines.length) return
    if (!box) { render(currentId); return }
    fill(box, el("div", { class: "inplan-label" }, "In this plan"), ...lines.map((l) => el("p", { dataset: { season: l.year } }, lines.length > 1 || l.year !== "both seasons" ? el("b", {}, `${l.year}: `) : null, l.text)))
  }

  document.addEventListener("keydown", (e) => {
    if (panel.hidden) return
    if (e.key === "Escape") { e.preventDefault(); close(); return }
    if (e.key === "Tab") {
      const items = [...panel.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); return }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  })
  document.addEventListener("pointerdown", (e) => {
    if (panel.hidden) return
    if (panel.contains(e.target)) return
    if (e.target.closest && e.target.closest("[data-explain]")) return
    close({ restoreFocus: false })
  })
  window.addEventListener("resize", () => { if (!panel.hidden) place() })

  return { open, close, refresh, get isOpen() { return !panel.hidden }, get currentId() { return currentId }, node: panel }
}
