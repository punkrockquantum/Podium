/**
 * Hash router: `#/overview`, `#/compute?p=<plan>&view=sa` … Back/forward work because every navigation is
 * a real hash change; the plan and the view travel in the query part of the hash when a link is copied.
 */

export const ROUTES = [
  { id: "overview", label: "Overview", short: "Overview" },
  { id: "strategies", label: "Strategies", short: "Strategies" },
  { id: "fia", label: "FIA envelope", short: "FIA" },
  { id: "compute", label: "Compute", short: "Compute" },
  { id: "facility", label: "Facility", short: "Facility" },
  { id: "connectivity", label: "Connectivity", short: "Connectivity" },
  { id: "deployment", label: "Deployment", short: "Deployment" },
  { id: "commercials", label: "Commercials", short: "Commercials" },
  { id: "compare", label: "Compare plans", short: "Compare", hidden: true },
  { id: "sa", label: "Solutions Architect", short: "Solutions Architect", view: "sa" },
  { id: "model", label: "Model & sources", short: "Model & sources" },
]
export const ROUTE_IDS = ROUTES.map((r) => r.id)
export const routeMeta = (id) => ROUTES.find((r) => r.id === id) || ROUTES[0]

/**
 * Parse a location hash into { route, params }. Unknown routes fall back to the overview; a hash that is not
 * a route at all (an in-page anchor such as `#main`, or the legacy `#s=` share link) returns null.
 */
export function parseHash(hash = "") {
  const h = String(hash || "").replace(/^#/, "")
  if (h && !h.startsWith("/")) return null
  const m = /^\/([a-z-]*)(?:\?(.*))?$/.exec(h || "/")
  const params = new URLSearchParams(m && m[2] ? m[2] : "")
  const route = m && ROUTE_IDS.includes(m[1]) ? m[1] : "overview"
  return { route, params, raw: h }
}

export const buildHash = (route, params = {}) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v))
  const s = q.toString()
  return `#/${route}${s ? `?${s}` : ""}`
}

/** Create a router bound to `window`. `onChange({ route, params })` fires on load and on every hash change. */
export function createRouter(onChange) {
  let current = parseHash(location.hash) || parseHash("")
  const emit = () => {
    const next = parseHash(location.hash)
    if (!next) return // in-page anchor or legacy hash: not a navigation
    current = next
    onChange(current)
  }
  window.addEventListener("hashchange", emit)
  return {
    get route() { return current.route },
    get params() { return current.params },
    /** Navigate (pushes history) to a route, optionally with params. */
    go(route, params = {}) {
      const next = buildHash(route, params)
      if (location.hash === next) { emit(); return }
      location.hash = next
    },
    /** Rewrite the hash without a history entry (used to drop a consumed `p=` parameter). */
    replace(route, params = {}) {
      history.replaceState(null, "", `${location.pathname}${location.search}${buildHash(route, params)}`)
      current = parseHash(location.hash) || current
    },
    /** Fire the initial navigation; a legacy or anchor hash starts on the overview. */
    start() {
      const next = parseHash(location.hash)
      if (!next || !next.raw) history.replaceState(null, "", `${location.pathname}${location.search}#/overview`)
      current = parseHash(location.hash) || parseHash("")
      onChange(current)
    },
    stop() { window.removeEventListener("hashchange", emit) },
  }
}
