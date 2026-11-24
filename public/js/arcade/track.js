/**
 * The arcade's Circuit of the Americas: pure geometry, no DOM.
 *
 * The centreline is the legacy finale's analytic COTA layout (public/js/cota.js: straights, arcs and
 * eased esses as one closed cubic Bézier path), sampled into a closed polyline of uniformly spaced
 * points in game metres. ASSUMPTION: the game lap is half the real 5,513 m so a lap takes about a
 * minute, and the track is 18 m wide (real: 15–20 m) so arrow keys on a projector stay forgiving.
 * Corner markers, sector lines and the drag-reduction zones come from the same file as fractions of
 * the lap; T16 and T18 (the long triple-apex right-hander around T17) are added here.
 *
 * Coordinates: x to the right, y down (the SVG's), heading as atan2(dy, dx). "Right" of the direction
 * of travel is the normal (−ty, tx); signed distances and curvatures are positive on the right.
 */
import { COTA_PATH_D, COTA_TURNS, COTA_DRS_ZONES, COTA_SECTORS, COTA_LENGTH_M } from "../cota.js"

export const REAL_LAP_M = COTA_LENGTH_M
export const LAP_M = 2756
export const WIDTH_M = 18
export const RUNOFF_M = 16
export const SPACING_M = 4

const TAU = Math.PI * 2
export const wrap01 = (s) => ((s % 1) + 1) % 1
/** Forward distance from `a` to `b` around the lap, in (−0.5, 0.5]: positive when b is ahead of a. */
export const forwardDelta = (a, b) => {
  const d = wrap01(b - a)
  return d > 0.5 ? d - 1 : d
}
/** True when a car moving forward from `prev` to `now` (fractions of the lap) passed the gate at `gate`. */
export function crossed(prev, now, gate) {
  const delta = forwardDelta(prev, now)
  if (delta <= 0 || delta > 0.25) return false
  const toGate = wrap01(gate - prev)
  return toGate > 0 && toGate <= delta
}
/** Where between `prev` and `now` the gate was crossed (0..1), for sub-step timing. */
export function crossFraction(prev, now, gate) {
  const delta = forwardDelta(prev, now)
  return delta > 0 ? Math.min(1, Math.max(0, wrap01(gate - prev) / delta)) : 1
}

/** The cubic segments of an SVG path made of one M, C commands and Z (the only grammar cota.js uses). */
export function parseCubicPath(d) {
  const nums = d.replace(/[MCZ]/g, " ").trim().split(/[\s,]+/).map(Number)
  if (nums.length < 8 || nums.some((n) => !Number.isFinite(n))) throw new Error("not a cubic path")
  const segments = []
  let cur = { x: nums[0], y: nums[1] }
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const seg = { a: cur, b: { x: nums[i], y: nums[i + 1] }, c: { x: nums[i + 2], y: nums[i + 3] }, d: { x: nums[i + 4], y: nums[i + 5] } }
    segments.push(seg)
    cur = seg.d
  }
  return segments
}

/** Points along the segments (`perSegment` per cubic, the last point of the loop dropped). */
export function flattenPath(segments, perSegment = 48) {
  const out = []
  for (const s of segments) {
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment
      const u = 1 - t
      out.push({
        x: u * u * u * s.a.x + 3 * u * u * t * s.b.x + 3 * u * t * t * s.c.x + t * t * t * s.d.x,
        y: u * u * u * s.a.y + 3 * u * u * t * s.b.y + 3 * u * t * t * s.c.y + t * t * t * s.d.y,
      })
    }
  }
  return out
}

/** Length of a closed polyline. */
export function polylineLength(points) {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

/** The same closed loop as `count` points equally spaced along it (the first point is kept). */
export function resampleClosed(points, count) {
  const total = polylineLength(points)
  const step = total / count
  const out = [{ x: points[0].x, y: points[0].y }]
  let i = 0
  let carried = 0
  let a = points[0]
  let b = points[1 % points.length]
  let segLen = Math.hypot(b.x - a.x, b.y - a.y)
  let need = step
  while (out.length < count) {
    if (carried + need <= segLen) {
      carried += need
      const t = segLen > 0 ? carried / segLen : 0
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      need = step
    } else {
      need -= segLen - carried
      carried = 0
      i += 1
      a = points[i % points.length]
      b = points[(i + 1) % points.length]
      segLen = Math.hypot(b.x - a.x, b.y - a.y)
    }
  }
  return out
}

/** Box blur of a cyclic series over ±half samples. */
function smoothCyclic(values, half) {
  const n = values.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let k = -half; k <= half; k++) sum += values[(((i + k) % n) + n) % n]
    out[i] = sum / (2 * half + 1)
  }
  return out
}

/** Signed heading change per metre of a uniformly spaced closed polyline (positive = turning right on screen). */
function curvatureOf(xs, ys, spacing) {
  const n = xs.length
  const curv = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const q = (i + 1) % n
    const h0 = Math.atan2(ys[i] - ys[p], xs[i] - xs[p])
    const h1 = Math.atan2(ys[q] - ys[i], xs[q] - xs[i])
    let d = h1 - h0
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    curv[i] = d / spacing
  }
  return curv
}

/**
 * The track. `scaleM` is the lap length in game metres; `spacing` the metres between polyline points.
 * Everything heavy (tangents, curvature, racing line, speed-profile inputs) is precomputed once.
 */
export function buildTrack({ lapM = LAP_M, spacing = SPACING_M, width = WIDTH_M, runoff = RUNOFF_M } = {}) {
  const raw = flattenPath(parseCubicPath(COTA_PATH_D))
  const unitLength = polylineLength(raw)
  const scale = lapM / unitLength
  const scaled = raw.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  const n = Math.round(lapM / spacing)
  const pts = resampleClosed(scaled, n)
  const length = polylineLength(pts)
  const ds = length / n
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i].x
    ys[i] = pts[i].y
  }
  const tx = new Float64Array(n)
  const ty = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const q = (i + 1) % n
    const dx = xs[q] - xs[p]
    const dy = ys[q] - ys[p]
    const len = Math.hypot(dx, dy) || 1
    tx[i] = dx / len
    ty[i] = dy / len
  }
  const curv = smoothCyclic(curvatureOf(xs, ys, ds), 2)
  const halfWidth = width / 2

  /*
   * Racing line: inside at the apex, outside on entry and exit. A narrow-minus-wide smoothing of the
   * curvature gives that "Mexican hat" shape; the offset is clamped so the line stays 3.5 m inside
   * the edge. ASSUMPTION: a heuristic line, good enough for the AI and the pit-wall overlay.
   */
  const narrow = smoothCyclic(curv, Math.round(24 / ds))
  const wide = smoothCyclic(curv, Math.round(90 / ds))
  const maxOff = halfWidth - 3.5
  const kRef = 1 / 55
  const lineOff = new Float64Array(n)
  const lx = new Float64Array(n)
  const ly = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const off = Math.max(-maxOff, Math.min(maxOff, ((1.7 * narrow[i] - 1.0 * wide[i]) / kRef) * maxOff))
    lineOff[i] = off
    lx[i] = xs[i] + -ty[i] * off
    ly[i] = ys[i] + tx[i] * off
  }
  const lineCurv = smoothCyclic(curvatureOf(lx, ly, ds), 3)

  const turns = [...COTA_TURNS, { n: 16, label: "T16", s: 0.797, hand: "R" }, { n: 18, label: "T18", s: 0.842, hand: "R" }]
    .sort((a, b) => a.s - b.s)
    .map((t) => {
      const i = Math.round(t.s * n) % n
      return { ...t, i, x: xs[i], y: ys[i], curv: curv[i] }
    })

  /* Kerb ranges: where the track bends tighter than a 110 m radius, stretched 12 m into entry and exit. */
  const bend = new Uint8Array(n)
  const reach = Math.round(12 / ds)
  for (let i = 0; i < n; i++) if (Math.abs(curv[i]) > 1 / 110) for (let k = -reach; k <= reach; k++) bend[(((i + k) % n) + n) % n] = 1
  const kerbs = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    const on = i < n && bend[i]
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      kerbs.push([start, i - 1])
      start = -1
    }
  }

  const gates = [COTA_SECTORS[0], COTA_SECTORS[1], 0]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i])
    maxY = Math.max(maxY, ys[i])
  }

  const track = {
    name: "Circuit of the Americas, Austin",
    n, length, spacing: ds, width, halfWidth, runoff, wallDist: halfWidth + runoff, scale,
    /* The kerb band: still grippy a metre beyond the white line; grass starts after it. */
    kerbWidth: 1, gripHalfWidth: halfWidth + 1,
    xs, ys, tx, ty, curv, lineOff, lx, ly, lineCurv, turns, kerbs, gates, sectors: [...COTA_SECTORS], drs: COTA_DRS_ZONES.map((z) => [...z]),
    bounds: { minX: minX - runoff - 10, minY: minY - runoff - 10, maxX: maxX + runoff + 10, maxY: maxY + runoff + 10 },
    index: (s) => (((Math.round(wrap01(s) * n) % n) + n) % n),
    sectorOf: (s) => {
      const f = wrap01(s)
      return f < COTA_SECTORS[0] ? 1 : f < COTA_SECTORS[1] ? 2 : 3
    },
    inDrs: (s) => {
      const f = wrap01(s)
      return COTA_DRS_ZONES.some(([a, b]) => (b <= 1 ? f >= a && f <= b : f >= a || f <= b - 1))
    },
    /** Point and heading on the centreline at fraction `s`, offset `off` metres to the right. */
    at(s, off = 0) {
      const f = wrap01(s) * n
      const i = Math.floor(f) % n
      const j = (i + 1) % n
      const t = f - Math.floor(f)
      const x = xs[i] + (xs[j] - xs[i]) * t
      const y = ys[i] + (ys[j] - ys[i]) * t
      const ux = tx[i] + (tx[j] - tx[i]) * t
      const uy = ty[i] + (ty[j] - ty[i]) * t
      const len = Math.hypot(ux, uy) || 1
      return { x: x + (-uy / len) * off, y: y + (ux / len) * off, heading: Math.atan2(uy, ux), i }
    },
    /**
     * Nearest point of the centreline to (x, y): the segment index, the lap fraction, the signed distance
     * (positive on the right of travel) and the projection. A `hint` index narrows the search to the
     * neighbourhood a moving car can reach in one step; the whole loop is searched when the hint fails.
     */
    locate(x, y, hint = -1) {
      const search = (from, to) => {
        let best = null
        for (let k = from; k <= to; k++) {
          const i = ((k % n) + n) % n
          const j = (i + 1) % n
          const dx = xs[j] - xs[i]
          const dy = ys[j] - ys[i]
          const len2 = dx * dx + dy * dy || 1
          let t = ((x - xs[i]) * dx + (y - ys[i]) * dy) / len2
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const qx = xs[i] + dx * t
          const qy = ys[i] + dy * t
          const ex = x - qx
          const ey = y - qy
          const d2 = ex * ex + ey * ey
          if (!best || d2 < best.d2) best = { i, t, d2, qx, qy, dx, dy }
        }
        return best
      }
      let best = hint >= 0 ? search(hint - 12, hint + 12) : null
      if (!best || best.d2 > (halfWidth + runoff + 6) ** 2) {
        const whole = search(0, n - 1)
        if (!best || whole.d2 < best.d2) best = whole
      }
      const side = best.dx * (y - ys[best.i]) - best.dy * (x - xs[best.i]) >= 0 ? 1 : -1
      return { i: best.i, s: wrap01((best.i + best.t) / n), dist: Math.sqrt(best.d2) * side, x: best.qx, y: best.qy }
    },
  }
  return track
}

let shared = null
/** One track for the whole page (the geometry never changes). */
export const defaultTrack = () => (shared = shared || buildTrack())
