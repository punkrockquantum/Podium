/**
 * The planning tool shell: a two-season plan in state, hash routes for the Overview and the component views,
 * the Team | Solutions Architect view switch, presets as plans, Save/Load, Compare, Export, Print and share links.
 */
import { normalize } from "./model.js"
import { PROVIDER } from "./assumptions.js"
import { evaluatePlan, normalizePlan, presetPlan, PLAN_PRESETS, PLAN_PRESET_ORDER, SEASON_IDS, SHARED_IDS, matchingPreset, setControlClamped, fitPlanToEnvelope, controlDisplay, detach as planDetach, reattach as planReattach, setTimeline as planSetTimeline, renamePlan, NAME_MAX } from "./plan.js"
import { CONTROLS } from "./model.js"
import { el, clear, installErrorLogging } from "./dom.js"
import { badge } from "./widgets.js"
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
import { solutionBrief } from "./sa.js"

export function mountSim(root) {
  installErrorLogging()
  const state = { plan: null, result: null, view: "team", route: "overview", slots: store.loadSlots(), drawerOpen: false }
  const views = {}
  let active = null
  let frame = 0

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
  const nameInput = el("input", { type: "text", class: "text plan-name", id: "plan-name", maxlength: NAME_MAX, "aria-label": "Plan name" })
  nameInput.addEventListener("change", () => { state.plan = renamePlan(state.plan, nameInput.value); render() })
  const presetBar = el("div", { class: "plan-bar", id: "plan-bar" },
    el("div", { class: "plan-id" }, el("span", { class: "presets-label" }, "Plan"), nameInput, el("span", { class: "chip chip-custom", id: "preset-custom", hidden: true }, "Custom plan")),
    el("nav", { class: "presets", id: "presets", "aria-label": "Presets" },
      el("span", { class: "presets-label" }, "Presets"),
      ...PLAN_PRESET_ORDER.map((id) => el("button", { type: "button", class: "chip", id: `preset-${id}`, dataset: { preset: id }, "aria-pressed": "false", title: PLAN_PRESETS[id].summary, onclick: () => applyPreset(id) }, PLAN_PRESETS[id].label))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "btn", id: "save-open", onclick: () => { state.drawerOpen = !state.drawerOpen; renderDrawer() } }, "Save / Load"),
      el("a", { class: "btn", id: "compare-link", href: "#/compare" }, "Compare"),
      el("button", { type: "button", class: "btn", id: "export-json", onclick: exportJson }, "Export"),
      el("button", { type: "button", class: "btn", id: "print", onclick: () => window.print() }, "Print"),
      el("button", { type: "button", class: "btn", id: "share-link", onclick: shareLink }, "Copy link"),
      el("a", { class: "btn btn-link", href: "/case.html", id: "case-link" }, "Business case")))
  const drawer = el("section", { class: "drawer", id: "drawer", hidden: true, "aria-label": "Saved plans" })
  const main = el("main", { class: "plan-main", id: "main" })
  const footer = el("footer", { class: "sim-footer" },
    el("span", {}, `${PROVIDER.campus}. OEM dimension: ${PROVIDER.oem}.`),
    el("a", { href: "/case.html" }, "Business case"),
    el("span", {}, "Model notes: ", el("code", {}, "docs/audi-f1-model.md"), " · fact pack: ", el("code", {}, "docs/audi-f1-sources.md")))
  clear(root).append(header, presetBar, drawer, main, footer)

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
      loadPlan(plan, note) { state.plan = normalizePlan(plan); render(); if (note) toast(note) },
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
      else if (route === "sa") views[route] = saView(ctx)
      else views[route] = modelView(ctx)
    }
    return views[route]
  }

  // The Solutions Architect view is the `sa` route; the view switch is a shortcut to and from it.
  const router = createRouter(({ route, params }) => {
    state.route = params.get("view") === "sa" ? "sa" : route
    state.view = state.route === "sa" ? "sa" : "team"
    store.rememberView(state.view)
    if (params.has("p") || params.has("view") || state.route !== route) router.replace(state.route)
    showRoute()
  })

  function showRoute() {
    const view = viewFor(state.route)
    if (active !== view) {
      clear(main).append(view.node)
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
    store.rememberPlan(state.plan)
    syncBar()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { active?.update(state); renderDrawer() })
  }

  function syncBar() {
    const match = matchingPreset(state.plan)
    for (const b of presetBar.querySelectorAll(".chip[data-preset]")) b.setAttribute("aria-pressed", b.dataset.preset === match ? "true" : "false")
    presetBar.querySelector("#preset-custom").hidden = Boolean(match)
    if (document.activeElement !== nameInput) nameInput.value = state.plan.meta.name
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
    clear(drawer).append(
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
