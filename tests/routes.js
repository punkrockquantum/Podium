/** Builds shared by the tests: the reference build plus at least two optimised routes per table. */
import { REFERENCE_BUILD } from "../public/js/sim.js"

export const GOOD = { ...REFERENCE_BUILD }

export const ROUTES = {
  network: {
    "Redundant tunnels, cross-connect, edge cache": { link: "redundant", path: "crossconnect", garage: "edge" },
    "Satellite backup, cross-connect, edge cache": { link: "satellite", path: "crossconnect", garage: "edge" },
    "Redundant tunnels, dark fibre, wired umbilical": { link: "redundant", path: "darkfibre", garage: "umbilical" },
  },
  oem: {
    "Dell/HPE/Lenovo as-a-service, next business day": { vendor: "tier1", payment: "aas", support: "nbd" },
    "Dell/HPE/Lenovo lease, 4-hour": { vendor: "tier1", payment: "lease", support: "4h" },
    "Supermicro lease, 4-hour": { vendor: "supermicro", payment: "lease", support: "4h" },
  },
  dc: {
    "Colo, liquid, capped 85%": { location: "colo", cooling: "liquid", power: "cap85" },
    "Colo, rear-door, capped 85%": { location: "colo", cooling: "reardoor", power: "cap85" },
    "Cheap-power region, liquid, standard": { location: "cheap", cooling: "liquid", power: "standard" },
  },
  compute: {
    "Medium, mixed, fast parallel": { size: "medium", chips: "mixed", storage: "parallel" },
    "Medium, CPU only, fast parallel": { size: "medium", chips: "cpu", storage: "parallel" },
    "Medium, mixed, fast + cache": { size: "medium", chips: "mixed", storage: "cache" },
  },
}

export const IDS = ["network", "oem", "dc", "compute"]
export const approvedAt = (ids) => Object.fromEntries(ids.map((id) => [id, { status: "approved", by: "Test Architect" }]))
