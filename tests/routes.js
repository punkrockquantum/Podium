/** Builds shared by the tests: the reference build (in the zone at every table). */
import { REFERENCE_BUILD, STATIONS, decisionsFor } from "../public/js/catalog.js"

export const GOOD = { ...REFERENCE_BUILD }
export const IDS = STATIONS.map((s) => s.id)
export const approvedAt = (ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: "Test Architect" }]))
/** The reference build's three dials for one table. */
export const pick = (station) => Object.fromEntries(decisionsFor(station).map((d) => [d.id, GOOD[d.id]]))
