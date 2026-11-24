/**
 * The planning tool shell: a two-season plan in state, hash routes for the Overview and the component views,
 * the Team | Solutions Architect view switch, presets as plans, Save/Load, Compare, Export, Print and share links.
 */
import { normalize } from "./model.js"
import { PROVIDER } from "./assumptions.js"
import { evaluatePlan, normalizePlan, presetPlan, PLAN_PRESETS, PLAN_PRESET_ORDER, SEASON_IDS, SHARED_IDS, matchingPreset, setControlClamped, fitPlanToEnvelope, controlDisplay, detach as planDetach, reattach as planReattach, setTimeline as planSetTimeline, renamePlan, NAME_MAX } from "./plan.js"
import { CONTROLS } from "./model.js"
import { el, clear, installErrorLogging, fill } from "./dom.js"
import { badge, plainToggle, setExplainHandler, setPlainEnglish } from "./widgets.js"
import { createExplainPanel } from "./explainPanel.js"
import { explainContext, EXPLAIN, explainText, labels as explainLabels } from "./explain.js"
import { attribute } from "./attribution.js"
import { seasonInputs, seasonAttributionFn } from "./plan.js"
import { fmt } from "./dom.js"
import { createRouter, ROUTES, routeMeta } from "./router.js"
import * as store from "./planstore.js"
import { decodeHash as decodeLegacyHash } from "./store.js"
import { overviewView } from "./views/overview.js"
import { componentView, COMPONENTS } from "./views/component.js"
import { deploymentView } from "./views/deployment.js"
import { commercialsView } from "./views/commercials.js"
import { compareView } from "./views/compare.js"
import { modelView } from "./views/model.js"
import { saView } from "./views/sa.js"
import { strategiesView } from "./views/strategies.js"
import { STRATEGIES, matchingStrategy } from "./strategies.js"
import { solutionBrief } from "./sa.js"

export function mountSim(root) {
  installErrorLogging()
  const state = { plan: null, result: null, view: "team", route: "overview", slots: store.loadSlots(), drawerOpen: false, plainEnglish: true, plainSet: store.recallPlain() !== null, attribution: null }
  const views = {}
  let active = null
  let frame = 0
  const planKey = (p) => JSON.stringify({ s: p.shared, y: p.seasons, t: p.timeline })

  // ------------------------------------------------------------------ initial plan and view
  const search = new URLSearchParams(location.search)
  const initial = parseInitial()
  state.plan = initial.plan
  state.result = evaluatePlan(state.plan)

  /**
   * The plan comes from the link (`p=` in the hash, or a legacy `#s=` scenario), else the last plan in this
   * browser, else the Digital Realty 2027 preset. `?view=sa` (search or hash) opens the Solutions Architect
   * view; so does reopening the tool after last using that view, unless the link names a route.
   */
  function parseInitial() {
    const h = location.hash || ""
    const q = /\?(.*)$/.exec(h)
    const params = new URLSearchParams(q ? q[1] : "")
    const hasRoute = /^#\/[a-z-]+/.test(h)
    const startRoute = params.get("view") === "sa" || search.get("view") === "sa" || (!hasRoute && store.recallView() === "sa") ? "sa" : null
    const shared = params.get("p") ? store.decodeParam(params.get("p")) : null
    if (shared) return { plan: normalizePlan(shared), startRoute, fromLink: true }
    const legacy = decodeLegacyHash(h)
    if (legacy) {
      // A single-season link from the earlier simulator: 2027 takes the inputs, 2028 inherits
      const x = normalize(legacy)
      const plan = normalizePlan({ meta: { name: "Imported scenario" }, shared: Object.fromEntries(SHARED_IDS.map((id) => [id, x[id]])), seasons: { 2027: Object.fromEntries(SEASON_IDS.map((id) => [id, x[id]])), 2028: {} } })
      return { plan, startRoute, fromLink: true }
    }
    const last = store.recallPlan()
    if (last) return { plan: normalizePlan(last), startRoute }
    return { plan: presetPlan("dr2027"), startRoute }
  }

  // ------------------------------------------------------------------ skeleton
  const nav = el("nav", { class: "routes", id: "routes", "aria-label": "Sections" },
    ...ROUTES.filter((r) => !r.hidden).map((r) => el("a", { class: `route ${r.view === "sa" ? "route-sa" : ""}`, href: `#/${r.id}`, dataset: { route: r.id }, "aria-current": "false" }, r.short)))
  const viewSwitch = el("div", { class: "view-switch", id: "view-switch", role: "group", "aria-label": "View" },
    el("button", { type: "button", class: "seg", dataset: { view: "team" }, "aria-pressed": "false", onclick: () => setView("team") }, "Team"),
    el("button", { type: "button", class: "seg", dataset: { view: "sa" }, "aria-pressed": "false", onclick: () => setView("sa") }, "Solutions Architect"))
  const header = el("header", { class: "sim-top" },
    el("div", { class: "brand" }, "Audi F1 Team × ", el("b", {}, "Digital Realty")),
    el("div", { class: "title" }, el("h1", {}, "Swiss infrastructure planning tool"), el("span", { class: "subtitle" }, "2027 & 2028 seasons · Hinwil · Digital Realty Zurich")),
    el("div", { class: "spacer" }),
    viewSwitch,
    nav)
  // a one-row textarea rather than an input so a long preset name wraps onto a second line instead of clipping
  const nameInput = el("textarea", { class: "text plan-name", id: "plan-name", rows: "1", maxlength: NAME_MAX, spellcheck: "false", "aria-label": "Plan name" })
  const fitNameField = () => { nameInput.style.height = "0"; nameInput.style.height = `${nameInput.scrollHeight + 2}px` }
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur() } })
  nameInput.addEventListener("input", fitNameField)
  nameInput.addEventListener("change", () => { state.plan = renamePlan(state.plan, nameInput.value.replace(/\s+/g, " ").trim()); render() })
  window.addEventListener("resize", fitNameField)
  const presetBar = el("div", { class: "plan-bar", id: "plan-bar" },
    el("div", { class: "plan-id" }, el("span", { class: "presets-label" }, "Plan"), nameInput, el("span", { class: "chip chip-custom", id: "preset-custom", hidden: true }, "Custom plan")),
    el("nav", { class: "presets", id: "presets", "aria-label": "Presets" },
      el("span", { class: "presets-label" }, "Presets"),
      ...PLAN_PRESET_ORDER.map((id) => el("button", { type: "button", class: "chip", id: `preset-${id}`, dataset: { preset: id }, "aria-pressed": "false", title: PLAN_PRESETS[id].summary, onclick: () => applyPreset(id) }, PLAN_PRESETS[id].label))),
    el("div", { class: "actions" },
      plainToggle(true, (on) => setPlain(on, { remember: true })),
      el("button", { type: "button", class: "btn", id: "save-open", onclick: () => { state.drawerOpen = !state.drawerOpen; renderDrawer() } }, "Save / Load"),
      el("a", { class: "btn", id: "compare-link", href: "#/compare" }, "Compare"),
      el("button", { type: "button", class: "btn", id: "export-json", onclick: exportJson }, "Export"),
      el("button", { type: "button", class: "btn", id: "print", onclick: () => window.print() }, "Print"),
      el("button", { type: "button", class: "btn", id: "share-link", onclick: shareLink }, "Copy link"),
      el("a", { class: "btn btn-link", href: "/case.html", id: "case-link" }, "Business case")))
  const drawer = el("section", { class: "drawer", id: "drawer", hidden: true, "aria-label": "Saved plans" })
  const main = el("main", { class: "plan-main", id: "main" })
  const appendix = el("section", { class: "print-only explained-appendix", id: "explained-appendix", "aria-label": "Explained" })
  const footer = el("footer", { class: "sim-footer" },
    el("span", {}, `${PROVIDER.campus}. OEM dimension: ${PROVIDER.oem}.`),
    el("a", { href: "/case.html" }, "Business case"),
    el("span", {}, "Model notes: ", el("code", {}, "docs/audi-f1-model.md"), " · fact pack: ", el("code", {}, "docs/audi-f1-sources.md")))
  fill(root, header, presetBar, drawer, main, appendix, footer)

  // ------------------------------------------------------------------ explainers: the shared panel, Plain English, attribution
  const panel = createExplainPanel({ getContext: explainCtx, onNavigate: (route, src) => { panel.close(); router.go(route); if (src) setTimeout(() => document.querySelector(`#sources-table [data-source="${CSS.escape(src)}"]`)?.scrollIntoView({ block: "center" }), 200) } })
  setExplainHandler((id, btn) => panel.open(id, btn))
  const attributionCache = new Map()
  let attributionTimer = 0

  function setPlain(on, { remember = false } = {}) {
    state.plainEnglish = Boolean(on)
    if (remember) { state.plainSet = true; store.rememberPlain(state.plainEnglish) }
    setPlainEnglish(state.plainEnglish)
    document.body.dataset.plain = state.plainEnglish ? "on" : "off"
    presetBar.querySelector("#plain-english")?.sync(state.plainEnglish)
    for (const v of Object.values(views)) v.invalidate?.()
    render()
  }

  /** Default on for the Team view, off for the Solutions Architect view, unless the user has chosen (persisted) or the link says (`pe=`). */
  function defaultPlain() {
    const stored = store.recallPlain()
    if (stored !== null) return stored
    return state.view !== "sa"
  }

  /** Per-season explainer contexts for the panel: the season's own result, Today, the plan-level attribution and plan facts. */
  function explainCtx() {
    const r = state.result
    const seasons = {}
    for (const y of [2027, 2028]) {
      const s = r.seasons[y]
      seasons[y] = explainContext({ result: { scenario: s.sim, today: s.today, perf: s.perf }, attribution: state.attribution?.[y] || null, both: { 2027: { perf: r.seasons[2027].perf }, 2028: { perf: r.seasons[2028].perf } }, plan: r, fmt, plainEnglish: state.plainEnglish })
    }
    return { plainEnglish: state.plainEnglish, seasons, pruned: (id, year) => { const a = state.attribution?.[year]; if (!a || !id.startsWith("driver.")) return false; const d = a.drivers.find((row) => row.id === id.slice(7)); return Boolean(d && d.pruned) } }
  }

  /** The attribution ("where the seconds come from") runs after the main render so the sliders stay responsive. */
  function scheduleAttribution() {
    clearTimeout(attributionTimer)
    attributionTimer = setTimeout(() => {
      const key = planKey(state.plan)
      let a = attributionCache.get(key)
      if (!a) {
        a = {}
        for (const y of [2027, 2028]) a[y] = attribute(seasonInputs(state.plan, y), { evaluateFn: seasonAttributionFn(state.result, y), cache: false })
        if (attributionCache.size > 48) attributionCache.clear()
        attributionCache.set(key, a)
      }
      state.attribution = a
      active?.updateAttribution?.(state)
      panel.refresh()
      renderAppendix()
    }, 0)
  }

  /** The printable "Explained" appendix: every active driver bar and every flag shown, title + one-liner + the plan's own line. */
  function renderAppendix() {
    const r = state.result
    const ctx = explainCtx()
    const blocks = []
    for (const y of [2027, 2028]) {
      const a = state.attribution?.[y]
      const c = ctx.seasons[y]
      const items = []
      for (const d of a ? a.drivers.filter((row) => !row.pruned) : []) {
        const e = EXPLAIN[`driver.${d.id}`]
        if (e) items.push(el("li", {}, el("b", {}, e.title), ` — ${e.one} `, el("span", { class: "muted" }, explainText(`driver.${d.id}`, c))))
      }
      for (const f of r.seasons[y].sim.flags || []) {
        const e = EXPLAIN[`flag.${f.id}`]
        if (e) items.push(el("li", {}, el("b", {}, e.title), ` — ${e.one} `, el("span", { class: "muted" }, explainText(`flag.${f.id}`, c))))
      }
      blocks.push(el("div", { class: "explained-season" }, el("h3", {}, `${y}`), items.length ? el("ul", {}, ...items) : el("p", { class: "muted" }, "Nothing changed from Today.")))
    }
    fill(appendix, el("h2", {}, "Explained"), el("p", { class: "muted small" }, "Where the seconds come from and every flag in this plan, in plain words. Shares are fair shares averaged over every order the changes could be made in."), ...blocks)
  }

  // ------------------------------------------------------------------ actions shared with the views
  const ctx = {
    getState: () => state,
    navigate: (route) => router.go(route),
    actions: {
      setControl(year, id, value) {
        const { plan, changes } = setControlClamped(state.plan, year === null ? 2027 : year, id, value)
        state.plan = plan
        render()
        for (const c of changes) toast(`Also changed: ${CONTROLS[c.id].label.toLowerCase()} ${controlDisplay(c.id, c.from)} → ${controlDisplay(c.id, c.to)} (${c.reason})`)
      },
      fitEnvelope(year) {
        const { plan, changes, fits } = fitPlanToEnvelope(state.plan, year)
        state.plan = plan
        render()
        toast(changes.length ? `Fitted ${year} to the envelope: ${changes.map((c) => `${CONTROLS[c.id].label.toLowerCase()} ${controlDisplay(c.id, c.from)} → ${controlDisplay(c.id, c.to)}`).join(", ")}${fits ? "" : " (still over: see plan health)"}` : fits ? `${year} already fits the envelope` : `${year} cannot be fitted by clamping alone: see plan health`)
      },
      loadPlan(plan, note, { route } = {}) { state.plan = normalizePlan(plan); state.loadedKey = planKey(state.plan); if (route && state.route !== route) router.go(route); render(); if (note) toast(note) },
      savePlan(plan, name) { const p = renamePlan(plan, name || plan.meta.name); store.savePlan(p.meta.name, p); toast(`Saved "${p.meta.name}"`); renderDrawer() },
      async copyLink(plan) {
        const url = `${location.origin}${location.pathname}#/overview?${new URLSearchParams({ p: store.encodeParam(normalizePlan(plan)) })}`
        try { await navigator.clipboard.writeText(url); toast("Link copied") } catch { toast("Could not copy: open Save / Load to keep the plan") }
      },
      compareStrategy(plan, label) {
        const slot = !state.slots.A ? "A" : !state.slots.B ? "B" : "B"
        state.slots[slot] = { plan: normalizePlan(plan), label, savedAt: Date.now() }
        store.saveSlots(state.slots)
        router.go("compare")
        render()
        toast(`${label} set as ${slot}`)
      },
      clearLineage() { const p = JSON.parse(JSON.stringify(state.plan)); delete p.meta.strategy; delete p.meta.origin; state.plan = normalizePlan(p); render() },
      toast,
      detach(id) { state.plan = planDetach(state.plan, id); render() },
      reattach(id) { state.plan = planReattach(state.plan, id); render() },
      setTimeline(patch) { state.plan = planSetTimeline(state.plan, patch); render() },
      setSlot(slot) { state.slots[slot] = { plan: state.plan, label: state.plan.meta.name, savedAt: Date.now() }; store.saveSlots(state.slots); render(); toast(`Current plan set as ${slot}`) },
      loadSlot(slot) { if (state.slots[slot]) { state.plan = normalizePlan(state.slots[slot].plan); render() } },
      clearSlot(slot) { delete state.slots[slot]; store.saveSlots(state.slots); render() },
    },
  }

  function viewFor(route) {
    if (!views[route]) {
      if (route === "overview") views[route] = overviewView(ctx)
      else if (COMPONENTS[route]) views[route] = componentView(route, ctx)
      else if (route === "deployment") views[route] = deploymentView(ctx)
      else if (route === "commercials") views[route] = commercialsView(ctx)
      else if (route === "compare") views[route] = compareView(ctx)
      else if (route === "strategies") views[route] = strategiesView(ctx)
      else if (route === "sa") views[route] = saView(ctx)
      else views[route] = modelView(ctx)
    }
    return views[route]
  }

  // The Solutions Architect view is the `sa` route; the view switch is a shortcut to and from it.
  const router = createRouter(({ route, params }) => {
    state.route = params.get("view") === "sa" ? "sa" : route
    const viewBefore = state.view
    state.view = state.route === "sa" ? "sa" : "team"
    store.rememberView(state.view)
    if (params.has("pe")) setPlain(params.get("pe") !== "0")
    else if (!pePrimed || (!state.plainSet && viewBefore !== state.view)) setPlain(defaultPlain())
    pePrimed = true
    if (params.has("p") || params.has("view") || params.has("pe") || state.route !== route) router.replace(state.route)
    if (panel.isOpen && viewBefore !== state.view) panel.close()
    showRoute()
  })
  let pePrimed = false

  function showRoute() {
    const view = viewFor(state.route)
    if (active !== view) {
      fill(main, view.node)
      active = view
      window.scrollTo(0, 0)
    }
    document.body.dataset.route = state.route
    document.body.dataset.view = state.view
    for (const a of nav.querySelectorAll(".route")) a.setAttribute("aria-current", a.dataset.route === state.route ? "page" : "false")
    document.title = `Audi F1 Team × Digital Realty — ${routeMeta(state.route).label} · ${state.plan.meta.name}`
    render()
  }

  function setView(view) {
    if (view === "sa") router.go("sa")
    else if (state.route === "sa") router.go("overview")
  }

  function applyPreset(id) {
    state.plan = presetPlan(id)
    render()
  }

  function exportJson() {
    const r = state.result
    store.downloadJson({
      exportedAt: new Date().toISOString(),
      product: "Audi F1 Team × Digital Realty — Swiss infrastructure planning tool",
      oemNote: PROVIDER.oemNote,
      plan: state.plan,
      seasons: Object.fromEntries([2027, 2028].map((y) => [y, { inputs: r.inputs[y], perf: r.seasons[y].perf, money: r.seasons[y].money, blend: r.seasons[y].blend, flags: r.seasons[y].sim.flags, compute: r.seasons[y].sim.comp, facility: r.seasons[y].sim.fac, trackside: r.seasons[y].sim.net }])),
      deltas: r.deltas, totals: r.totals, health: r.health,
      timeline: { inputs: r.timeline.inputs, milestones: r.timeline.milestones, tasks: r.timeline.tasks, flags: r.timeline.flags },
      solutionsArchitect: state.view === "sa" ? solutionBrief(r, { notes: store.loadNotes(), generatedAt: new Date().toISOString() }) : undefined,
    }, `audi-f1-digital-realty-plan-${state.plan.meta.preset || "custom"}.json`)
  }

  function shareUrl() {
    const params = new URLSearchParams({ p: store.encodeParam(state.plan) })
    if (state.view === "sa") params.set("view", "sa")
    params.set("pe", state.plainEnglish ? "1" : "0")
    return `${location.origin}${location.pathname}#/${state.route}?${params.toString()}`
  }
  async function shareLink() {
    const url = shareUrl()
    try { await navigator.clipboard.writeText(url); toast("Link copied") } catch { toast("Link is in the address bar") }
    history.replaceState(null, "", url.slice(location.origin.length))
  }

  function toast(text) {
    const t = el("div", { class: "toast", role: "status" }, text)
    document.body.append(t)
    setTimeout(() => t.remove(), 1800)
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    state.result = evaluatePlan(state.plan)
    state.attribution = attributionCache.get(planKey(state.plan)) || null
    store.rememberPlan(state.plan)
    syncBar()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { active?.update(state); renderDrawer(); panel.refresh() })
    scheduleAttribution()
  }

  function syncBar() {
    const match = matchingPreset(state.plan)
    for (const b of presetBar.querySelectorAll(".chip[data-preset]")) b.setAttribute("aria-pressed", b.dataset.preset === match ? "true" : "false")
    const custom = presetBar.querySelector("#preset-custom")
    custom.hidden = Boolean(match)
    const strategy = match ? null : matchingStrategy(state.plan)
    const lineage = state.plan.meta.strategy
    custom.textContent = strategy ? `Strategy ${strategy} · ${STRATEGIES[strategy].name.replace(/^[A-C]\s*·\s*/, "")}`
      : lineage ? `Custom (from ${lineage})` : state.plan.meta.origin === "optimiser" ? (state.loadedKey === planKey(state.plan) ? "Optimiser proposal" : "Custom (from the optimiser)") : "Custom plan"
    custom.classList.toggle("chip-strategy", Boolean(strategy))
    custom.dataset.strategy = strategy || ""
    if (document.activeElement !== nameInput) nameInput.value = state.plan.meta.name
    fitNameField()
    for (const b of viewSwitch.querySelectorAll(".seg")) b.setAttribute("aria-pressed", b.dataset.view === state.view ? "true" : "false")
    header.querySelector(".subtitle").textContent = state.view === "sa" ? "Solutions Architect view · 2027 & 2028 seasons" : "2027 & 2028 seasons · Hinwil · Digital Realty Zurich"
    presetBar.querySelector("#plan-health-badge")?.remove()
    presetBar.querySelector(".plan-id").append(el("span", { id: "plan-health-badge", class: "plan-health" }, badge(state.result.health.status, state.result.health.status === "ok" ? "Consistent" : state.result.health.status === "warn" ? `${state.result.health.counts.warn} to tune` : `${state.result.health.counts.bad} to fix`)))
  }

  function renderDrawer() {
    drawer.hidden = !state.drawerOpen
    if (!state.drawerOpen) return
    const list = store.listPlans()
    const saveName = el("input", { type: "text", class: "text", id: "save-name", placeholder: "Plan name", "aria-label": "Plan name", value: state.plan.meta.name })
    fill(drawer, 
      el("div", { class: "drawer-row" },
        saveName,
        el("button", { type: "button", class: "btn", id: "save-plan", onclick: () => { const name = saveName.value.trim() || `Plan ${new Date().toLocaleString()}`; store.savePlan(name, renamePlan(state.plan, name)); state.plan = renamePlan(state.plan, name); toast(`Saved "${name}"`); render() } }, "Save current plan"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: () => { state.drawerOpen = false; renderDrawer() } }, "Close")),
      list.length ? el("ul", { class: "saved-list", id: "saved-list" }, ...list.map((s) => el("li", {},
        el("span", { class: "saved-name" }, s.name), el("span", { class: "muted small" }, new Date(s.savedAt).toLocaleString()),
        el("button", { type: "button", class: "btn btn-tiny", onclick: () => { state.plan = normalizePlan(s.plan); render(); toast(`Loaded "${s.name}"`) } }, "Load"),
        el("button", { type: "button", class: "btn btn-tiny", onclick: () => { store.deletePlan(s.name); renderDrawer() } }, "Delete"))))
        : el("p", { class: "muted" }, "No saved plans yet. Plans are stored in this browser only."))
  }

  if (initial.startRoute || search.has("view")) {
    search.delete("view")
    const qs = search.toString()
    history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${initial.startRoute ? `#/${initial.startRoute}` : location.hash}`)
  }
  router.start()
}
