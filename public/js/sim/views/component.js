/** The component drill-downs: FIA envelope, Compute, Facility, Connectivity. Per-season controls on the left, outputs for both seasons on the right. */
import { CONTROLS } from "../model.js"
import { K } from "../assumptions.js"
import { costCapCHF } from "../../customer.js"
import { el, clear, fmt } from "../dom.js"
import { gauge, bar, badge, flagRow, stat } from "../widgets.js"
import { computeScene, facilityScene, tracksideScene, sceneCard } from "../scenes.js"
import { controlsSection, seasonCols, roleStrip, SEASONS } from "./common.js"
import { atpCalendar, shutdowns, fmtDate } from "../timeline.js"
import { architecture, rackLayout } from "../diagrams.js"

const COOLING_LABEL = { air: "air", reardoor: "rear-door", dlc: "direct liquid" }

export const COMPONENTS = {
  fia: {
    title: "FIA envelope",
    subtitle: "The Aerodynamic Testing Restrictions and the cost cap set the box for both seasons; the sliding-scale position and the model confidence are held once for the plan.",
    groups: ["fia"],
    strip: {
      team: "The constructors' position to plan against, how much of the model to believe, and when to re-plan after ATP 3.",
      dr: "A facility that can be declared (F4.4.3) and inspected; maintenance windows aligned to the ATP calendar.",
      hpe: "Cores, declared clock and (from 2028) GPUs that fit the allowance; benchmarks for the declaration.",
    },
    outputs: fiaOutputs,
  },
  compute: {
    title: "Compute",
    subtitle: "The Restricted CFD cluster for each season: what runs, how it is paid for and how much of the allowance it turns into work.",
    groups: ["compute"],
    strip: {
      team: "Node count, cores, declared clock, memory, fabric, storage and the GPU partition for 2028; buy or HPE GreenLake; support and refresh.",
      dr: "Power and cooling for the density chosen, cross-connects to the fabric, Remote Hands for swaps inside a period.",
      hpe: "The cluster itself: delivery (4–8 weeks GreenLake, 10–18 weeks purchase), buffer nodes, Tech Care support, refresh cadence.",
    },
    diagram: { id: "architecture", title: "Architecture", subtitle: "What runs where in the chosen season: nodes, GPU partition, fabric, storage, the fibre to Hinwil and the campus services around the cage.", render: (sim, year) => architecture(sim, { year }) },
    outputs: computeOutputs,
  },
  facility: {
    title: "Facility",
    subtitle: "Where the estate lives decides power, cooling, availability, PUE and what the finance team can keep outside the cap.",
    groups: ["facility"],
    strip: {
      team: "Hinwil, Digital Realty Zurich or hybrid inside the 500 kW envelope; the ML partition and where it lives; redundancy; how the fee is treated in the cap.",
      dr: "Suite or cage, power whips, rear-door or liquid rows, 2N UPS / N+2 cooling, PUE, renewable supply and heat reuse.",
      hpe: "Rack density and cooling requirements of the configuration; CDUs for a liquid partition.",
    },
    diagram: { id: "racks", title: "Rack layout", subtitle: "The room in the chosen season: cluster racks filled to their load, cooling per rack, A/B feeds, the rest of the estate and the ML partition rows, inside the 60 cage positions.", render: (sim, year) => rackLayout(sim, { year }) },
    outputs: facilityOutputs,
  },
  connectivity: {
    title: "Connectivity & trackside",
    subtitle: "Hinwil ↔ campus fibre, the paddock link and where the first pass over telemetry happens.",
    groups: ["connectivity"],
    strip: {
      team: "Fibre routes and bandwidth, the paddock link, edge compute in the garage, cloud on-ramps for unrestricted work.",
      dr: "Cross-connects, carrier meet-me rooms, ServiceFabric on-ramps (AWS, Azure), SwissIX and IP bandwidth.",
      hpe: "Fabric and storage endpoints in the cage; nothing on the paddock side.",
    },
    outputs: connectivityOutputs,
  },
}

/** Build a component view. Returns { node, update(state) }. */
export function componentView(id, ctx) {
  const cfg = COMPONENTS[id]
  const controls = controlsSection(cfg.groups, ctx, { title: `${cfg.title} · controls`, subtitle: "2027 on the left of each row; 2028 follows 2027 until you change it for 2028." })
  const outputs = el("div", { class: "outputs", id: `outputs-${id}`, "aria-live": "polite" })
  const diagram = cfg.diagram ? diagramCard(cfg.diagram) : null
  const node = el("div", { class: `view view-${id}` },
    el("div", { class: "view-head" }, el("h2", {}, cfg.title), el("p", { class: "card-sub" }, cfg.subtitle)),
    roleStrip(cfg.strip),
    diagram ? diagram.node : null,
    el("div", { class: "view-layout" }, controls.node, outputs))
  return {
    node,
    update(state) {
      controls.sync(state)
      diagram?.update(state)
      clear(outputs).append(...[cfg.outputs(state.result, ctx)].flat())
    },
  }
}

/** A full-width card with one SVG diagram and a 2027 | 2028 switch; the chosen season sticks while the page is open. */
function diagramCard({ id, title, subtitle, render }) {
  let season = 2027
  let last = null
  const host = el("div", { class: "diagram-host", id: `diagram-${id}` })
  const note = el("span", { class: "muted small", id: `diagram-${id}-note` })
  const toggle = el("div", { class: "segmented diagram-seasons", role: "group", "aria-label": `${title}: season shown` },
    ...SEASONS.map((y) => el("button", { type: "button", class: "seg", dataset: { season: String(y) }, "aria-pressed": y === season ? "true" : "false", onclick: () => { season = y; if (last) draw(last) } }, String(y))))
  const node = el("section", { class: "card diagram-card", id: `card-${id}` },
    el("div", { class: "card-head row" }, el("div", {}, el("h3", {}, title), el("p", { class: "card-sub" }, subtitle)), el("div", { class: "diagram-controls" }, note, toggle)))
  node.append(host)
  function draw(state) {
    last = state
    for (const b of toggle.children) b.setAttribute("aria-pressed", Number(b.dataset.season) === season ? "true" : "false")
    const sim = state.result.seasons[season].sim
    clear(host).append(render(sim, season))
    const changed = state.result.deltas.changed.length
    note.textContent = changed ? `${changed} control${changed === 1 ? "" : "s"} differ in 2028` : "2028 inherits 2027"
  }
  return { node, update: draw }
}

// ---------------------------------------------------------------------------------------------
// Outputs per component
// ---------------------------------------------------------------------------------------------

function fiaOutputs(result) {
  const cols = seasonCols(result, (year, s) => {
    const sim = s.sim
    const mauhTone = sim.comp.usedMauh === 0 ? "bad" : sim.comp.usage > 1 ? "warn" : sim.comp.usage < 0.9 ? "warn" : "ok"
    return [
      el("div", { class: "stats" },
        stat("Allowance per period", `${fmt.num(sim.fia.allowance.mauh, 2)} MAUh`, `P${sim.inputs.position} · ${sim.fia.pct} % of the 6 MAUh baseline`),
        stat("Wind tunnel", `${sim.fia.allowance.runs} runs`, `${sim.fia.allowance.windOn} wind-on hours · ${sim.fia.allowance.occupancy} h occupancy`),
        stat("GPU solver", sim.fia.gpuSolverAllowed ? "Allowed" : "Not allowed", sim.fia.gpuSolverAllowed ? `${sim.comp.gpuSolverN} solver GPUs declared` : "CPU-only until 1 January 2028 (F4.4.1)"),
        stat("Cost cap", fmt.chf(costCapCHF.fia, 1), `${fmt.pct(sim.money.capShare, 1)} of it is this estate`)),
      el("div", { class: "gauges two" },
        gauge({ label: `MAUh used · allowance ${sim.fia.allowance.mauh}`, value: Math.min(sim.comp.usedMauh, sim.fia.allowance.mauh * 1.5), max: sim.fia.allowance.mauh * 1.5, display: fmt.num(sim.comp.usedMauh, 2), sub: `${Math.round(sim.comp.usage * 100)} %`, tone: mauhTone, marks: [{ at: sim.fia.allowance.mauh, label: "100 %" }] }),
        gauge({ label: "Allowance turned into work", value: Math.min(sim.comp.effectiveRatio, 1.5), max: 1.5, display: fmt.pct(sim.comp.effectiveRatio), sub: `${fmt.num(s.effectiveMauh, 2)} eff. MAUh (season)`, tone: sim.comp.effectiveRatio >= 0.95 ? "ok" : sim.comp.effectiveRatio >= 0.7 ? "warn" : "bad", marks: [{ at: 1, label: "1:1" }] })),
      el("ul", { class: "flags" }, ...sim.flags.filter((f) => ["mauh", "gpu", "clock"].includes(f.id)).map(flagRow)),
    ]
  }, { id: "fia-seasons" })
  const calendar = el("section", { class: "card" },
    el("h3", {}, "Aerodynamic Testing Periods"),
    el("p", { class: "card-sub" }, `${K.timeline.atpRule}. Use-it-or-lose-it per period; the allowance for ATPs 1–3 follows last season's final position, ATPs 4–6 the position after ATP 3.`),
    el("div", { class: "table-wrap" }, el("table", { class: "table atp-table" },
      el("thead", {}, el("tr", {}, el("th", {}, "Period"), el("th", {}, "2027"), el("th", {}, "2028"), el("th", { class: "num" }, "Days"))),
      el("tbody", {}, ...[0, 1, 2, 3, 4, 5].map((i) => {
        const a = atpCalendar(2027)[i]
        const b = atpCalendar(2028)[i]
        return el("tr", {}, el("td", {}, `ATP ${i + 1}`), el("td", {}, `${fmtDate(a.start, { year: false })} – ${fmtDate(a.end - 86_400_000, { year: false })}`), el("td", {}, `${fmtDate(b.start, { year: false })} – ${fmtDate(b.end - 86_400_000, { year: false })}`), el("td", { class: "num" }, `${a.days} / ${b.days}`))
      }),
      el("tr", { class: "muted" }, el("td", {}, "Summer shutdown"), el("td", {}, `${fmtDate(shutdowns(2027)[0].start, { year: false })} + ${K.timeline.summerShutdown.days} days`), el("td", {}, `${fmtDate(shutdowns(2028)[0].start, { year: false })} + ${K.timeline.summerShutdown.days} days`), el("td", { class: "num" }, badge("info", "ASSUMPTION"))),
      el("tr", { class: "muted" }, el("td", {}, "Winter shutdown"), el("td", {}, `24 Dec + ${K.timeline.winterShutdown.days} days`), el("td", {}, `24 Dec + ${K.timeline.winterShutdown.days} days`), el("td", { class: "num" }, badge("ok", "VERIFIED")))))))
  return [cols, calendar]
}

function computeOutputs(result) {
  return seasonCols(result, (year, s) => {
    const sim = s.sim
    const x = sim.inputs
    return [
      el("div", { class: "stats" },
        stat("Turnaround per run", fmt.hours(sim.comp.turnaroundHours), `${fmt.hours(sim.comp.solverHours)} solver + ${fmt.hours(sim.comp.prePostHours)} pre/post`),
        stat("Design iterations", `${fmt.num(sim.comp.runsPerWeek, 0)} / week`, `${fmt.num(sim.comp.runsPerAtp, 0)} per period · ${fmt.num(sim.comp.runsPerDay, 1)} a day`),
        stat("Availability", fmt.availability(sim.comp.availabilityPct / 100), `${fmt.num(sim.comp.lostHoursPerYear, 0)} h a year lost · ${x.redundancy.toUpperCase().replace("N1", "N+1")} · ${CONTROLS.support.options.find((o) => o.value === x.support).label.toLowerCase()}`),
        stat("Work per metered AUh", `${fmt.num(sim.comp.workPerAuh, 2)}×`, `clock ${fmt.num(sim.comp.clockWorkPerAuh, 2)} · silicon ${sim.comp.eff.ipc.toFixed(2)} · fabric ${sim.comp.eff.interconnect.toFixed(3)} · I/O ${sim.comp.eff.io.toFixed(2)}`),
        stat("Cluster", `${x.nodes} nodes · ${sim.hw.cores} cores`, `${x.clockGHz.toFixed(1)} GHz CCF${x.gpus ? ` · ${x.gpus} GPUs (${sim.comp.gpuSolverN} in the solver)` : ""} · ${sim.hw.racks} rack${sim.hw.racks === 1 ? "" : "s"}`),
        stat(x.consumption === "greenlake" ? "HPE GreenLake charge" : "Cluster depreciation", fmt.chf(sim.money.lines.find((l) => l.id === "it")?.chf || 0), x.consumption === "greenlake" ? `${x.committedPct} % reserved · ${x.termYears} yr term · ${sim.hw.bufferNodes} buffer nodes` : `${fmt.chf(sim.hw.hardwareCHF)} over ${x.refreshYears} years`)),
      el("div", { class: "eff-bars" },
        ...[["Interconnect", sim.comp.eff.interconnect], ["Storage I/O", sim.comp.eff.io], ["Cooling", sim.comp.eff.thermal], ["Availability", sim.comp.eff.availability], ["Schedule", sim.comp.eff.schedule], ["Power", sim.comp.eff.power]].map(([label, v]) =>
          bar({ label, value: v, max: 1, display: fmt.pct(v, v < 0.999 ? 1 : 0), tone: v >= 0.98 ? "ok" : v >= 0.9 ? "warn" : "bad" }))),
      el("ul", { class: "flags" }, ...sim.flags.filter((f) => ["mauh", "gpu", "clock"].includes(f.id)).map(flagRow)),
      sceneCard("The CFD programme", computeScene(sim)),
    ]
  }, { id: "compute-seasons" })
}

function facilityOutputs(result) {
  return seasonCols(result, (year, s) => {
    const sim = s.sim
    const x = sim.inputs
    const sitePower = sim.fac.clusterSite === "hinwil" ? sim.fac.hinwilIT : sim.fac.drIT
    const siteCap = sim.fac.clusterSite === "hinwil" ? sim.fac.hinwilCapacity : sim.fac.drCapacity
    return [
      el("div", { class: "stats" },
        stat("Where", sim.fac.clusterSite === "dr" ? "Digital Realty Zurich" : "Hinwil room", x.location === "hybrid" ? "hybrid: Mission Control stays in Hinwil" : x.location === "dr" ? "whole estate on the campus" : "everything in the existing room"),
        stat("PUE", sim.fac.pue.toFixed(2), x.pueMode === "override" ? "override" : `derived · ${COOLING_LABEL[x.cooling]} at ${sim.fac.clusterSite === "dr" ? "Digital Realty" : "Hinwil"}`),
        stat("Racks", `${sim.hw.racks} × ${x.rackKW} kW`, `${COOLING_LABEL[x.cooling]} cooling · limit ≈ ${sim.fac.coolingMax} kW per rack`),
        stat("Redundancy", x.redundancy.toUpperCase().replace("N1", "N+1"), `${(sim.fac.availability * 100).toFixed(2)} % facility availability`),
        stat("Electricity", `${fmt.num(sim.fac.totalMWh, 0)} MWh`, `${fmt.chf(sim.money.lines.find((l) => l.id === "power")?.chf || 0)} a year at ${x.tariffRp} Rp/kWh${x.renewable ? " · renewable" : ""}`),
        stat("Heat reused", `${fmt.num(sim.money.heatMWh, 0)} MWh`, sim.money.heatMWh > 0 ? `≈ ${fmt.num(sim.money.co2HeatAvoidedT, 0)} t CO₂ avoided elsewhere` : x.location === "hinwil" ? "no heat recovery in the Hinwil room" : "heat reuse off")),
      bar({ label: `${sim.fac.clusterSite === "hinwil" ? "Hinwil room" : "Digital Realty"} IT load vs ${sim.fac.clusterSite === "hinwil" ? "capacity" : "the 500 kW envelope"}`, value: sitePower, max: Math.max(siteCap, sitePower) * 1.05, limit: siteCap, display: `${Math.round(sitePower)} / ${siteCap} kW`, tone: sim.fac.powerShortKW > 0 || !sim.envelope.fits ? "bad" : sitePower / siteCap > 0.9 ? "warn" : "ok" }),
      sim.fac.clusterSite === "dr" ? bar({ label: "Cage positions", value: sim.fac.racks.total, max: K.facility.cageRackPositions, limit: K.facility.cageRackPositions, display: `${sim.fac.racks.total} / ${K.facility.cageRackPositions} racks`, tone: sim.fac.racks.total > K.facility.cageRackPositions ? "bad" : sim.fac.racks.total > K.facility.cageRackPositions * 0.9 ? "warn" : "ok" }) : null,
      el("ul", { class: "flags" }, ...sim.flags.filter((f) => ["power", "racks", "hybridpower", "cooling", "loop", "expansion"].includes(f.id)).map(flagRow)),
      sceneCard("Where the cluster lives", facilityScene(sim)),
    ]
  }, { id: "facility-seasons" })
}

function connectivityOutputs(result, ctx) {
  const x = result.inputs[2027]
  const net = result.seasons[2027].sim.net
  const venues = el("section", { class: "card" },
    el("h3", {}, "Venue for the latency readout"),
    el("div", { class: "venue-strip", id: "venue-strip" },
      ...net.venues.map((v) => el("button", { type: "button", class: `venue ${v.id === x.venue ? "current" : ""}`, dataset: { venue: v.id }, "aria-pressed": v.id === x.venue ? "true" : "false", onclick: () => ctx.actions.setControl(null, "venue", v.id) },
        el("span", { class: "venue-name" }, v.name), el("b", {}, fmt.ms(v.rttMs)), el("span", { class: "venue-sub" }, `${v.decisionSec.toFixed(1)} s`)))))
  const cols = seasonCols(result, (year, s) => {
    const sim = s.sim
    const today = s.today
    return [
      el("div", { class: "stats" },
        stat("Data-to-decision", `${sim.net.venue.decisionSec.toFixed(1)} s`, `${fmt.signed(sim.net.venue.decisionSec - today.net.venue.decisionSec, 1, " s")} vs Today at ${sim.net.venue.name}`),
        stat("Bandwidth headroom", `${sim.net.headroom.toFixed(1)}×`, `${sim.net.profile.mbps} Mbps vs a ${sim.net.telemetryPeakMbps} Mbps telemetry peak`),
        stat("Link availability", fmt.availability(sim.net.linkAvailability), `≈ ${sim.net.weekendsLost.toFixed(2)} race weekends a season at risk`),
        stat("Race weekends at risk", fmt.num(sim.net.weekendsLost, 2), `of ${sim.net.raceWeekends} · ${fmt.signed(today.net.weekendsLost - sim.net.weekendsLost, 2)} fewer than Today`),
        stat("Hinwil ↔ campus", sim.inputs.location === "hinwil" ? "not needed" : `${sim.inputs.fibrePairs === 2 ? "2 routes" : "1 route"} · ${sim.inputs.fibreGbps}G`, sim.inputs.location === "hinwil" ? "the estate stays in the room" : `${(K.trackside.fibreAvailability[sim.inputs.fibrePairs] * 100).toFixed(3)} % · ${fmt.chf(sim.money.lines.find((l) => l.id === "fibre")?.chf || 0)} a year`),
        stat("Cloud on-ramps", sim.inputs.cloudOnRamp ? "AWS · Azure" : "Off", sim.inputs.cloudOnRamp ? "ServiceFabric private on-ramps for unrestricted bursts" : "no private cloud connectivity")),
      sceneCard("Paddock to factory", tracksideScene(sim)),
    ]
  }, { id: "connectivity-seasons" })
  return [venues, cols]
}
