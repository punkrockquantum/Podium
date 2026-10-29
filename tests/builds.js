/** Reference builds shared by the tests: one balanced team plus distinct routes for each table. */
import { DECISIONS } from "../public/js/catalog.js"
import { REFERENCE_BUILD } from "../public/js/sim.js"

export const GOOD = { ...REFERENCE_BUILD }

/** At least two genuinely different ways to optimise each table. */
export const ROUTES = {
  compute: {
    "Supermicro, HBM CPUs, clock-locked, bought": { oem: "supermicro", payment: "buy", term: 36, cpu: "xeonmax9480", nodes: 8, clock: "lock85" },
    "Lenovo, large-cache EPYC, bought": { oem: "lenovo", payment: "buy", term: 36, cpu: "epyc9684x", nodes: 8, clock: "lock85" },
    "Dell, Grace at base clock, 60-month lease": { oem: "dell", payment: "lease", term: 60, cpu: "grace", nodes: 8, clock: "base" },
  },
  ai: {
    "Own B300, power-capped, FP8 70B": { platform: "b300", deploy: "own", racks: 1, tgp: "eco85", modelSize: "70b", precision: "fp8" },
    "Race-weekend burst on B300, FP8 70B": { platform: "b300", deploy: "burst", racks: 1, tgp: "std", modelSize: "70b", precision: "fp8" },
    "Reserved cloud H100, small INT8 model": { platform: "h100", deploy: "cloud", racks: 1, tgp: "std", modelSize: "7b", precision: "int8" },
  },
  dc: {
    "London rear doors, 5-year take-or-pay, N+1": { location: "lon", hall: "R", block: 0.25, terms: "top5", redundancy: "n1" },
    "Dallas direct-to-chip, metered, 2N": { location: "dfw", hall: "L", block: 0.25, terms: "metered", redundancy: "2n" },
    "Ashburn rear doors, 10-year take-or-pay, N+1": { location: "iad", hall: "R", block: 0.25, terms: "top10", redundancy: "n1" },
  },
  storage: {
    "Lustre + tape + vector index + KV tier": { pfs: "lustre", pfsPB: 2, archive: "tape", dataTier: "vector", kv: "on", hbm: "hbm288" },
    "Storage as a service + cloud archive + vector index": { pfs: "staas", pfsPB: 2, archive: "cloud", dataTier: "vector", kv: "on", hbm: "hbm288" },
    "BeeGFS + tape + file store + KV tier": { pfs: "beegfs", pfsPB: 2, archive: "tape", dataTier: "file", kv: "on", hbm: "hbm288" },
  },
  network: {
    "ServiceFabric + LEO backup + dark fibre": { wan: "fabric", wanBackup: "leo", hqLink: "fiber", fabric: "ib", trackside: "fia", edge: 2 },
    "MPLS + SD-WAN backup + ServiceFabric to the factory": { wan: "mpls", wanBackup: "sdwan", hqLink: "fabric", fabric: "roce800", trackside: "plus", edge: 2 },
    "ServiceFabric + MPLS backup + hollow-core + photonic switches": { wan: "fabric", wanBackup: "mpls", hqLink: "hollow", fabric: "cpo", trackside: "fia", edge: 2 },
  },
  governance: {
    "Zero-trust on DPUs + diode + lockout hires": { segregation: "zerotrust", dataflow: "diode", workforce: "lockout", audit: "full" },
    "Private suite + diode, no transfers": { segregation: "physical", dataflow: "diode", workforce: "none", audit: "full" },
  },
}

export function stationDefaults(stationId) {
  return Object.fromEntries(DECISIONS.filter((d) => d.station === stationId && !d.hidden).map((d) => [d.id, d.def]))
}
