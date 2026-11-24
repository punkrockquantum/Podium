/** The simulator page: controls on the left, live outcomes on the right, comparison, model notes and sources below. */
import { GROUPS, CONTROLS, DEFAULTS, PRESETS, PRESET_ORDER, normalize, evaluate, evaluateBothSeasons, presetInputs } from "./model.js"
import { K, assumptionRows, PROVIDER } from "./assumptions.js"
import { CUSTOMER, annotatedFigures, costCapCHF } from "../customer.js"
import { el, clear, fmt, installErrorLogging } from "./dom.js"
import { controlRow, setControlValue, gauge, bar, badge, flagRow, stat, ladder } from "./widgets.js"
import { computeScene, facilityScene, tracksideScene, sceneCard } from "./scenes.js"
import * as store from "./store.js"

const SLOT_KEY = "podium.sim.compare.v1"

export function mountSim(root) {
  installErrorLogging()
  const state = {
    inputs: null,
    presetId: null,
    slots: loadSlots(),
    result: null,
    both: null,
    saveOpen: false,
  }
  let frame = 0

  // ------------------------------------------------------------------ initial inputs
  const fromHash = store.decodeHash()
  const last = store.recallLast()
  if (fromHash) { state.inputs = normalize(fromHash); state.presetId = null }
  else if (last && last.inputs) { state.inputs = normalize(last.inputs); state.presetId = last.presetId || null }
  else { state.inputs = presetInputs("dr2027"); state.presetId = "dr2027" }

  // ------------------------------------------------------------------ skeleton
  const header = el("header", { class: "sim-top" },
    el("div", { class: "brand" }, "Audi F1 Team × ", el("b", {}, "Digital Realty")),
    el("div", { class: "title" },
      el("h1", {}, "Infrastructure performance simulator"),
      el("span", { class: "subtitle" }, "2027 plan · 2028 path")),
    el("div", { class: "spacer" }),
    el("div", { class: "season-toggle", id: "season-toggle", role: "group", "aria-label": "Season" },
      ...[2027, 2028].map((s) => el("button", { type: "button", class: "seg", dataset: { value: String(s) }, "aria-pressed": "false", onclick: () => setInput("season", s) }, s === 2027 ? "2027 plan" : "2028 path"))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "btn", id: "save-open", onclick: () => { state.saveOpen = !state.saveOpen; renderDrawer() } }, "Save / Load"),
      el("button", { type: "button", class: "btn", id: "export-json", onclick: exportJson }, "Export JSON"),
      el("button", { type: "button", class: "btn", id: "print", onclick: () => window.print() }, "Print"),
      el("a", { class: "btn btn-link", href: "/case.html", id: "case-link" }, "Business case")),
  )
  const presetBar = el("nav", { class: "presets", id: "presets", "aria-label": "Presets" },
    el("span", { class: "presets-label" }, "Presets"),
    ...PRESET_ORDER.map((id) => el("button", { type: "button", class: "chip", id: `preset-${id}`, dataset: { preset: id }, "aria-pressed": "false", onclick: () => applyPreset(id) }, PRESETS[id].label)),
    el("span", { class: "chip chip-custom", id: "preset-custom", hidden: true }, "Custom scenario"),
    el("span", { class: "spacer" }),
    el("button", { type: "button", class: "btn btn-small", id: "compare-a", onclick: () => setSlot("A") }, "Set as A"),
    el("button", { type: "button", class: "btn btn-small", id: "compare-b", onclick: () => setSlot("B") }, "Set as B"),
    el("button", { type: "button", class: "btn btn-small", id: "share-link", onclick: shareLink }, "Copy link"),
  )
  const drawer = el("section", { class: "drawer", id: "drawer", hidden: true, "aria-label": "Saved scenarios" })
  const controls = el("section", { class: "controls", id: "controls", "aria-label": "Scenario controls" })
  const outcomes = el("aside", { class: "outcomes", id: "outcomes", "aria-label": "Live outcomes", "aria-live": "polite" })
  const layout = el("main", { class: "sim-layout" }, controls, outcomes)
  const compare = el("section", { class: "section compare", id: "compare" })
  const how = el("section", { class: "section how", id: "how" })
  const sources = el("section", { class: "section sources", id: "assumptions" })
  const footer = el("footer", { class: "sim-footer" },
    el("span", {}, `${PROVIDER.campus}. OEM dimension: ${PROVIDER.oem}.`),
    el("a", { href: "/case.html" }, "Business case"),
    el("span", {}, "Model notes: ", el("code", {}, "docs/audi-f1-model.md"), " · fact pack: ", el("code", {}, "docs/audi-f1-sources.md")),
  )
  clear(root).append(header, presetBar, drawer, layout, compare, how, sources, footer)

  // ------------------------------------------------------------------ controls
  const rows = {}
  for (const g of GROUPS) {
    const card = el("section", { class: "card control-card", id: `group-${g.id}`, "aria-labelledby": `group-${g.id}-title` },
      el("div", { class: "card-head" }, el("h2", { id: `group-${g.id}-title` }, g.title), el("p", { class: "card-sub" }, g.subtitle)))
    for (const c of g.controls) {
      const row = controlRow(c, state.inputs[c.id], setInput)
      rows[c.id] = row
      card.append(row)
    }
    controls.append(card)
  }

  renderHow()
  renderSources()
  render()

  // ------------------------------------------------------------------ state changes
  function setInput(id, value) {
    const next = normalize({ ...state.inputs, [id]: value })
    const preset = state.presetId ? presetInputs(state.presetId, next.season, { position: next.position, confidence: next.confidence, venue: next.venue }) : null
    const stillPreset = preset && Object.keys(CONTROLS).every((k) => preset[k] === next[k])
    state.inputs = next
    if (!stillPreset) state.presetId = null
    render()
  }

  function applyPreset(id) {
    const season = PRESETS[id].inputs.season ?? state.inputs.season
    state.inputs = presetInputs(id, season, { position: state.inputs.position, confidence: state.inputs.confidence, venue: state.inputs.venue })
    state.presetId = id
    render()
  }

  function setSlot(slot) {
    state.slots[slot] = { inputs: { ...state.inputs }, label: state.presetId ? PRESETS[state.presetId].short : "Custom", savedAt: Date.now() }
    persistSlots(state.slots)
    renderCompare()
  }

  function loadSlot(slot) {
    const s = state.slots[slot]
    if (!s) return
    state.inputs = normalize(s.inputs)
    state.presetId = PRESET_ORDER.find((id) => { const p = presetInputs(id, state.inputs.season, { position: state.inputs.position, confidence: state.inputs.confidence, venue: state.inputs.venue }); return Object.keys(CONTROLS).every((k) => p[k] === state.inputs[k]) }) || null
    render()
  }

  function exportJson() {
    const r = state.result
    store.exportJson({
      exportedAt: new Date().toISOString(),
      product: "Audi F1 Team × Digital Realty — infrastructure performance simulator",
      oemNote: PROVIDER.oemNote,
      inputs: state.inputs,
      headline: r.perf,
      scenario: { fia: r.scenario.fia, compute: r.scenario.comp, facility: r.scenario.fac, trackside: r.scenario.net, money: r.scenario.money, flags: r.scenario.flags },
      today: { compute: r.today.comp, money: r.today.money },
    }, `audi-f1-digital-realty-${state.inputs.season}-${state.presetId || "custom"}.json`)
  }

  async function shareLink() {
    const url = `${location.origin}${location.pathname}${store.encodeHash(state.inputs)}`
    history.replaceState(null, "", store.encodeHash(state.inputs))
    try { await navigator.clipboard.writeText(url); toast("Link copied") } catch { toast("Link is in the address bar") }
  }

  function toast(text) {
    const t = el("div", { class: "toast", role: "status" }, text)
    document.body.append(t)
    setTimeout(() => t.remove(), 1800)
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    state.result = evaluate(state.inputs)
    state.both = evaluateBothSeasons(state.inputs)
    store.rememberLast({ inputs: state.inputs, presetId: state.presetId })
    syncControls()
    syncHeader()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { renderOutcomes(); renderCompare(); renderDrawer() })
  }

  function syncControls() {
    for (const c of Object.values(CONTROLS)) {
      const row = rows[c.id]
      const visible = !c.showIf || c.showIf(state.inputs)
      row.hidden = !visible
      setControlValue(row, c, state.inputs[c.id])
    }
    for (const g of GROUPS) {
      const card = document.getElementById(`group-${g.id}`)
      const s = state.result.scenario
      const relevant = s.flags.filter((f) => groupOfFlag(f.id) === g.id)
      const worst = relevant.some((f) => f.level === "bad") ? "bad" : relevant.some((f) => f.level === "warn") ? "warn" : "ok"
      card.dataset.status = worst
    }
  }

  function groupOfFlag(id) {
    if (["mauh", "gpu", "clock", "delivery"].includes(id)) return "compute"
    if (["power", "hybridpower", "cooling", "declare", "loop"].includes(id)) return "facility"
    return "fia"
  }

  function syncHeader() {
    for (const b of header.querySelectorAll("#season-toggle .seg")) b.setAttribute("aria-pressed", Number(b.dataset.value) === state.inputs.season ? "true" : "false")
    for (const b of presetBar.querySelectorAll(".chip[data-preset]")) b.setAttribute("aria-pressed", b.dataset.preset === state.presetId ? "true" : "false")
    presetBar.querySelector("#preset-custom").hidden = Boolean(state.presetId)
    document.title = `Audi F1 Team × Digital Realty — simulator · ${state.inputs.season}`
  }

  function renderOutcomes() {
    const r = state.result
    const s = r.scenario
    const t = r.today
    const p = r.perf
    const x = s.inputs
    const isBaseline = state.presetId === "today"
    const tone = p.sec > 0.005 ? "good" : p.sec < -0.005 ? "bad" : "flat"
    const other = state.both[x.season === 2027 ? 2028 : 2027]

    const headline = el("section", { class: `card headline tone-${tone} status-${s.status}`, id: "headline" },
      el("div", { class: "headline-kicker" }, isBaseline ? `Today's setup carried into ${x.season}` : `${state.presetId ? PRESETS[state.presetId].label : "Your scenario"} · ${x.season} season`),
      el("div", { class: "headline-number", id: "headline-sec" }, fmt.sec(p.sec)),
      el("div", { class: "headline-sub", id: "headline-sub" }, isBaseline ? "This is the baseline every scenario is compared against." : `per lap found over the season vs Today's setup, at ${p.confidence} % model confidence`),
      el("div", { class: "headline-row" },
        stat("Aero programme", fmt.sec(p.aeroSec * p.confidence / 100), `${fmt.num(s.comp.effectiveMauh, 2)} vs ${fmt.num(t.comp.effectiveMauh, 2)} effective MAUh per period`, { id: "stat-aero" }),
        stat("Cost-cap reinvestment", fmt.sec(p.reinvestSec * p.confidence / 100), `${fmt.chfDelta(-p.capChargeDelta)} inside the cap a year`, { id: "stat-reinvest" }),
        stat("Position swing", `${fmt.position(x.position)} → ${fmt.position(p.scenarioPosition)}`, `${fmt.signed(p.points, 0)} points from pace, ${fmt.signed(p.strategyPoints, 1)} from the strategy loop`, { id: "stat-points" })),
      s.status === "bad" ? el("div", { class: "headline-alert", id: "headline-alert" }, badge("bad", s.flags.some((f) => f.level === "bad" && /F4|D\d/.test(f.rule)) ? "Not allowed" : "Not possible"), " ", s.flags.filter((f) => f.level === "bad").map((f) => f.title).join(" · ")) : null,
      el("div", { class: "season-strip", id: "season-strip" },
        el("span", { class: x.season === 2027 ? "current" : "" }, "2027 plan ", el("b", {}, fmt.sec(state.both[2027].perf.sec))),
        el("span", { class: x.season === 2028 ? "current" : "" }, "2028 path ", el("b", {}, fmt.sec(state.both[2028].perf.sec))),
        el("span", { class: "muted" }, `same configuration, other season: ${fmt.sec(other.perf.sec)}`)),
    )

    const ladderCard = el("section", { class: "card" },
      el("h3", {}, "Lap-time ladder"),
      el("p", { class: "card-sub" }, `≈ ${K.performance.secPerPosition.toFixed(2)} s per constructors' position across the midfield; Today at P${x.position}.`),
      ladder({ rungs: p.ladder, position: x.position, sec: p.sec, scenarioPosition: p.scenarioPosition }))

    const mauhTone = s.comp.usedMauh === 0 ? "bad" : s.comp.usage > 1 ? "warn" : s.comp.usage < 0.9 ? "warn" : "ok"
    const compliance = el("section", { class: "card compliance", id: "compliance" },
      el("h3", {}, "FIA compliance"),
      el("div", { class: "gauges" },
        gauge({ id: "gauge-mauh", label: `MAUh used · allowance ${s.fia.allowance.mauh}`, value: Math.min(s.comp.usedMauh, s.fia.allowance.mauh * 1.5), max: s.fia.allowance.mauh * 1.5, display: fmt.num(s.comp.usedMauh, 2), sub: `${Math.round(s.comp.usage * 100)} %`, tone: mauhTone, marks: [{ at: s.fia.allowance.mauh, label: "100 %" }] }),
        gauge({ id: "gauge-cap", label: "Cost-cap charge", value: s.money.capShare, max: 0.05, display: fmt.pct(s.money.capShare, 1), sub: `of ${fmt.chf(costCapCHF.fia, 0)}`, tone: "ok" }),
        gauge({ id: "gauge-eff", label: "Allowance turned into work", value: Math.min(s.comp.effectiveRatio, 1.5), max: 1.5, display: fmt.pct(s.comp.effectiveRatio), sub: `${fmt.num(s.comp.effectiveMauh, 2)} eff. MAUh`, tone: s.comp.effectiveRatio >= 0.95 ? "ok" : s.comp.effectiveRatio >= 0.7 ? "warn" : "bad", marks: [{ at: 1, label: "1:1" }] })),
      el("ul", { class: "flags", id: "flags" }, ...s.flags.map(flagRow)))

    const computeCard = el("section", { class: "card", id: "compute-card" },
      el("h3", {}, "Effective compute"),
      el("div", { class: "stats" },
        stat("Turnaround per run", fmt.hours(s.comp.turnaroundHours), `${fmt.hours(s.comp.solverHours)} solver + ${fmt.hours(s.comp.prePostHours)} pre/post`, { id: "stat-turnaround" }),
        stat("Design iterations", `${fmt.num(s.comp.runsPerWeek, 0)} / week`, `${fmt.num(s.comp.runsPerAtp, 0)} per period · ${fmt.num(s.comp.runsPerDay, 1)} a day`, { id: "stat-runs" }),
        stat("Availability", fmt.availability(s.comp.availabilityPct / 100), `${fmt.num(s.comp.lostHoursPerYear, 0)} h a year lost · ${x.redundancy.toUpperCase().replace("N1", "N+1")} · ${CONTROLS.support.options.find((o) => o.value === x.support).label.toLowerCase()}`, { id: "stat-availability" }),
        stat("Work per metered AUh", `${fmt.num(s.comp.workPerAuh, 2)}×`, `clock ${fmt.num(s.comp.clockWorkPerAuh, 2)} · silicon ${s.comp.eff.ipc.toFixed(2)} · fabric ${s.comp.eff.interconnect.toFixed(3)} · I/O ${s.comp.eff.io.toFixed(2)}`, { id: "stat-work" })),
      el("div", { class: "eff-bars" },
        ...[["Interconnect", s.comp.eff.interconnect], ["Storage I/O", s.comp.eff.io], ["Cooling", s.comp.eff.thermal], ["Availability", s.comp.eff.availability], ["Delivery", s.comp.eff.delivery], ["Power", s.comp.eff.power]].map(([label, v]) =>
          bar({ label, value: v, max: 1, display: fmt.pct(v, v < 0.999 ? 1 : 0), tone: v >= 0.98 ? "ok" : v >= 0.9 ? "warn" : "bad" }))),
      sceneCard("The CFD programme", computeScene(s)))

    const sitePower = s.fac.clusterSite === "hinwil" ? s.fac.hinwilIT : s.fac.drIT
    const siteCap = s.fac.clusterSite === "hinwil" ? s.fac.hinwilCapacity : s.fac.drCapacity
    const facilityCard = el("section", { class: "card", id: "facility-card" },
      el("h3", {}, "Facility, money & sustainability"),
      el("div", { class: "stats" },
        stat("PUE", s.fac.pue.toFixed(2), x.pueMode === "override" ? "override" : `derived · ${x.cooling === "dlc" ? "direct liquid" : x.cooling === "reardoor" ? "rear-door" : "air"} at ${s.fac.clusterSite === "dr" ? "Digital Realty" : "Hinwil"}`, { id: "stat-pue" }),
        stat("Yearly cost", fmt.chf(s.money.yearly), `${fmt.chfDelta(p.yearlyDelta)} vs Today · ${fmt.chf(s.money.oneOffTotal)} one-offs`, { id: "stat-yearly" }),
        stat("Inside the cost cap", fmt.chf(s.money.capCharge), `${fmt.chfDelta(p.capChargeDelta)} vs Today · ${fmt.chf(s.money.excludedYearly)} a year outside`, { id: "stat-cap" }),
        stat("3-year TCO", fmt.chf(s.money.tco3), s.money.costPerEffectiveMauh ? `${fmt.chf(s.money.costPerEffectiveMauh)} of cap per effective MAUh` : "no effective compute", { id: "stat-tco" }),
        stat("CO₂ (market-based)", `${fmt.num(s.money.co2MarketT, 0)} t`, `${fmt.num(s.money.co2LocationT, 0)} t location-based · ${fmt.signed(p.co2Delta, 0, " t")} vs Today`, { id: "stat-co2" }),
        stat("Heat reused", `${fmt.num(s.money.heatMWh, 0)} MWh`, s.money.heatMWh > 0 ? `≈ ${fmt.num(s.money.co2HeatAvoidedT, 0)} t CO₂ avoided elsewhere` : x.location === "hinwil" ? "no heat recovery in the Hinwil room" : "heat reuse off", { id: "stat-heat" })),
      bar({ id: "bar-power", label: `${s.fac.clusterSite === "hinwil" ? "Hinwil room" : "Digital Realty"} IT load vs capacity`, value: sitePower, max: Math.max(siteCap, sitePower) * 1.05, limit: siteCap, display: `${Math.round(sitePower)} / ${siteCap} kW`, tone: s.fac.powerShortKW > 0 ? "bad" : sitePower / siteCap > 0.9 ? "warn" : "ok" }),
      el("details", { class: "money-lines" },
        el("summary", {}, "Cost lines and one-offs"),
        el("table", { class: "table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Line"), el("th", { class: "num" }, "CHF / year"), el("th", { class: "num" }, "In the cap"))),
          el("tbody", {}, ...s.money.lines.map((l) => el("tr", {}, el("td", {}, l.label), el("td", { class: "num" }, fmt.chfFull(l.chf)), el("td", { class: "num" }, l.cap > 0 ? fmt.chfFull(l.cap) : "excluded"))),
            ...s.money.oneOffs.map((o) => el("tr", { class: "oneoff" }, el("td", {}, `${o.label} (one-off)`, el("span", { class: "muted small" }, ` ${o.why}`)), el("td", { class: "num" }, fmt.chfFull(o.chf)), el("td", { class: "num" }, o.cap === "included" ? "year of the move" : "excluded")))))),
      sceneCard("Where the cluster lives", facilityScene(s)))

    const tracksideCard = el("section", { class: "card", id: "trackside-card" },
      el("h3", {}, "Trackside"),
      el("div", { class: "venue-strip", id: "venue-strip" },
        ...s.net.venues.map((v) => el("button", { type: "button", class: `venue ${v.id === x.venue ? "current" : ""}`, dataset: { venue: v.id }, "aria-pressed": v.id === x.venue ? "true" : "false", onclick: () => setInput("venue", v.id) },
          el("span", { class: "venue-name" }, v.name), el("b", {}, fmt.ms(v.rttMs)), el("span", { class: "venue-sub" }, `${v.decisionSec.toFixed(1)} s`)))),
      el("div", { class: "stats" },
        stat("Data-to-decision", `${s.net.venue.decisionSec.toFixed(1)} s`, `${fmt.signed(s.net.venue.decisionSec - t.net.venue.decisionSec, 1, " s")} vs Today at ${s.net.venue.name}`, { id: "stat-decision" }),
        stat("Bandwidth headroom", `${s.net.headroom.toFixed(1)}×`, `${s.net.profile.mbps} Mbps vs a ${s.net.telemetryPeakMbps} Mbps telemetry peak`, { id: "stat-headroom" }),
        stat("Link availability", fmt.availability(s.net.linkAvailability), `≈ ${s.net.weekendsLost.toFixed(2)} race weekends a season at risk`, { id: "stat-link" }),
        stat("Strategy points", fmt.signed(p.strategyPoints, 1), "a season vs Today, from latency, headroom and resilience", { id: "stat-strategy" })),
      sceneCard("Paddock to factory", tracksideScene(s)))

    clear(outcomes).append(headline, ladderCard, compliance, computeCard, facilityCard, tracksideCard)
  }

  // ------------------------------------------------------------------ compare
  function renderCompare() {
    const season = state.inputs.season
    const columns = [
      { key: "today", label: `Today's setup · ${season}`, result: evaluate(presetInputs("today", season, { position: state.inputs.position, confidence: state.inputs.confidence, venue: state.inputs.venue })) },
      ...["A", "B"].map((slot) => state.slots[slot] ? { key: slot, label: `${slot}: ${state.slots[slot].label}`, result: evaluate({ ...state.slots[slot].inputs, season: state.slots[slot].inputs.season }), slot } : { key: slot, label: `${slot}: empty`, result: null, slot }),
      { key: "current", label: `Current · ${season}`, result: state.result },
    ]
    const metrics = [
      ["Season", (r) => String(r.scenario.inputs.season)],
      ["Seconds per lap vs Today", (r) => fmt.sec(r.perf.sec), "headline"],
      ["Position", (r) => `${fmt.position(r.scenario.inputs.position)} → ${fmt.position(r.perf.scenarioPosition)}`],
      ["Effective MAUh / period", (r) => fmt.num(r.scenario.comp.effectiveMauh, 2)],
      ["Allowance used", (r) => fmt.pct(r.scenario.comp.usage)],
      ["Runs per week", (r) => fmt.num(r.scenario.comp.runsPerWeek, 0)],
      ["Availability", (r) => fmt.availability(r.scenario.comp.availabilityPct / 100)],
      ["Location", (r) => CONTROLS.location.options.find((o) => o.value === r.scenario.inputs.location).label],
      ["PUE", (r) => r.scenario.fac.pue.toFixed(2)],
      ["Yearly cost", (r) => fmt.chf(r.scenario.money.yearly)],
      ["Inside the cost cap", (r) => fmt.chf(r.scenario.money.capCharge)],
      ["3-year TCO", (r) => fmt.chf(r.scenario.money.tco3)],
      ["CO₂ market-based", (r) => `${fmt.num(r.scenario.money.co2MarketT, 0)} t`],
      ["Data-to-decision", (r) => `${r.scenario.net.venue.decisionSec.toFixed(1)} s`],
      ["Compliance", (r) => r.scenario.status === "ok" ? "OK" : r.scenario.status === "warn" ? "Check" : r.scenario.flags.some((f) => f.level === "bad" && /F4|D\d/.test(f.rule)) ? "Not allowed" : "Not possible"],
    ]
    clear(compare).append(
      el("div", { class: "section-head" },
        el("h2", {}, "Compare A / B against Today"),
        el("p", { class: "card-sub" }, "Set the current scenario as A or B, change anything, and read the columns side by side. Slots persist in this browser.")),
      el("div", { class: "table-wrap" },
        el("table", { class: "table compare-table", id: "compare-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Metric"), ...columns.map((c) => el("th", { class: `col-${c.key}` }, c.label,
            c.slot && state.slots[c.slot] ? el("span", { class: "col-actions" }, el("button", { type: "button", class: "btn btn-tiny", onclick: () => loadSlot(c.slot) }, "Load"), el("button", { type: "button", class: "btn btn-tiny", onclick: () => { delete state.slots[c.slot]; persistSlots(state.slots); renderCompare() } }, "Clear")) : null)))),
          el("tbody", {}, ...metrics.map(([label, f, cls]) => el("tr", { class: cls || "" }, el("td", {}, label), ...columns.map((c) => el("td", { class: `col-${c.key}` }, c.result ? f(c.result) : "—"))))))))
  }

  // ------------------------------------------------------------------ save / load drawer
  function renderDrawer() {
    drawer.hidden = !state.saveOpen
    if (!state.saveOpen) return
    const list = store.listScenarios()
    const nameInput = el("input", { type: "text", class: "text", id: "save-name", placeholder: "Scenario name", "aria-label": "Scenario name", value: state.presetId ? `${PRESETS[state.presetId].label} (edited)` : `Custom ${state.inputs.season}` })
    clear(drawer).append(
      el("div", { class: "drawer-row" },
        nameInput,
        el("button", { type: "button", class: "btn", id: "save-scenario", onclick: () => { const name = nameInput.value.trim() || `Scenario ${new Date().toLocaleString()}`; store.saveScenario(name, state.inputs); toast(`Saved "${name}"`); renderDrawer() } }, "Save current"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: () => { state.saveOpen = false; renderDrawer() } }, "Close")),
      list.length ? el("ul", { class: "saved-list", id: "saved-list" }, ...list.map((s) => el("li", {},
        el("span", { class: "saved-name" }, s.name), el("span", { class: "muted small" }, new Date(s.savedAt).toLocaleString()),
        el("button", { type: "button", class: "btn btn-tiny", onclick: () => { state.inputs = normalize(s.inputs); state.presetId = null; render(); toast(`Loaded "${s.name}"`) } }, "Load"),
        el("button", { type: "button", class: "btn btn-tiny", onclick: () => { store.deleteScenario(s.name); renderDrawer() } }, "Delete"))))
        : el("p", { class: "muted" }, "No saved scenarios yet. Scenarios are stored in this browser only."))
  }

  // ------------------------------------------------------------------ how it works
  function renderHow() {
    const steps = [
      ["FIA envelope", `The sliding scale gives P${DEFAULTS.position} ${K.fia.scale[DEFAULTS.position - 1]} % of the 6 MAUh baseline per period. AUh = cores × solver seconds × declared clock ÷ 3600, so the FIA charges clock and time, not useful work. GPUs may run the solver from 2028; no conversion rule exists yet, so the simulator charges FP64 core-equivalents and lets you test a kinder factor.`],
      ["Effective compute", "Work per metered AUh rises with a lower declared clock (memory-bound CFD scales with clock^0.6), newer silicon, a faster fabric and storage that keeps up; it falls with throttling above the allowance, thermal limits, outages, late delivery and a room that cannot power the estate."],
      ["Season performance", `Lap time found over a season follows Δt = ${K.performance.aeroA} · ln(1 + W / ${K.performance.aeroW0}) in effective MAUh per period, calibrated to about 0.09 s per 12.5 ATR points. Cost-cap savings redeployed into the car add up to ${K.performance.reinvestMaxSec} s (≈ 0.085 s per CHF 1 M); spending more inside the cap counts against you. The confidence slider scales everything.`],
      ["Money & cap", "Depreciation or the GreenLake charge, support, software, power, the committed-kW fee, fibre, paddock links, edge and cloud on-ramps are Relevant Costs. Fit-out, plant and the Property share of the fee sit outside the cap (D5.1.1.j); heat recovery is a Sustainability Initiative Cost."],
      ["Trackside", "Round-trip latency by venue, telemetry headroom against a 105 Mbps peak, link availability over 24 weekends and a data-to-decision loop (6 s base, two round trips, −1.5 s with an edge node) feed a small, separate points swing."],
    ]
    clear(how).append(
      el("div", { class: "section-head" }, el("h2", {}, "How the model works"), el("p", { class: "card-sub" }, "Deterministic, pure functions; every number on this page is recomputed from the controls. Full formulae in ", el("code", {}, "docs/audi-f1-model.md"), ".")),
      el("ol", { class: "how-steps" }, ...steps.map(([t, d]) => el("li", {}, el("b", {}, t), el("p", {}, d)))),
      el("p", { class: "muted small" }, "What it does not do: no stochastic simulation, no trade between wind-tunnel hours and CFD, no indexation or FX movement on the cap, and the rest of the IT estate costs the same in every scenario."))
  }

  // ------------------------------------------------------------------ assumptions & sources
  function renderSources() {
    const rowsK = assumptionRows().map((r) => ({ ...r, origin: "simulator" }))
    const rowsC = annotatedFigures(CUSTOMER).map((r) => ({ path: r.path, value: r.value, status: r.status, source: r.status === "VERIFIED" ? r.ref : "—", note: r.status === "VERIFIED" ? r.note || "" : r.ref, origin: "customer" }))
    const all = [...rowsK, ...rowsC]
    const verified = all.filter((r) => r.status === "VERIFIED").length
    const show = (v) => typeof v === "object" ? JSON.stringify(v) : String(v)
    clear(sources).append(
      el("div", { class: "section-head" },
        el("h2", {}, "Assumptions & sources"),
        el("p", { class: "card-sub" }, `${all.length} constants: ${verified} VERIFIED against a primary source, ${all.length - verified} planning ASSUMPTIONS, each keyed to a row of the fact pack (`, el("code", {}, "docs/audi-f1-sources.md"), ").")),
      el("p", { class: "footnote", id: "oem-footnote" }, badge("info", "Working assumption"), " ", PROVIDER.oemNote),
      el("details", { class: "sources-details", open: false },
        el("summary", {}, "Show every constant"),
        el("div", { class: "table-wrap" }, el("table", { class: "table sources-table", id: "sources-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Constant"), el("th", {}, "Value"), el("th", {}, "Status"), el("th", {}, "Row"), el("th", {}, "Note"))),
          el("tbody", {}, ...all.map((r) => el("tr", { class: `status-${r.status.toLowerCase()}` },
            el("td", { class: "mono" }, `${r.origin === "customer" ? "customer." : "sim."}${r.path}`),
            el("td", { class: "mono" }, show(r.value)),
            el("td", {}, badge(r.status === "VERIFIED" ? "ok" : "info", r.status)),
            el("td", { class: "mono" }, r.source),
            el("td", { class: "small" }, r.note))))))))
  }
}

function loadSlots() {
  try { return JSON.parse(localStorage.getItem(SLOT_KEY) || "{}") || {} } catch { return {} }
}
function persistSlots(slots) {
  try { localStorage.setItem(SLOT_KEY, JSON.stringify(slots)) } catch { /* private mode */ }
}
