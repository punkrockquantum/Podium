/**
 * Canvas 2D renderer at a low internal resolution (480×270), upscaled by CSS with pixelated
 * image rendering. The camera follows the player's car and rotates so the car points up. Everything
 * is drawn in world metres under one transform: grass pattern, runoff, asphalt, kerbs, edge lines,
 * the start/finish chequer, sector lines, DRS boards, turn boards, tyre marks, the pit-wall assist
 * (racing line and braking markers whose reach and precision come from the car's data-to-decision
 * time) and the cars. The minimap is a second small canvas, fixed north.
 */
import { CAR_SIZE } from "./physics.js"
import { speedProfile } from "./ai.js"

export const VIEW = Object.freeze({ width: 480, height: 270 })
/** Cars are drawn a third bigger than their collision size: legible on a projector, same physics. */
export const CAR_DRAW_SCALE = 1.35
const TAU = Math.PI * 2
const lerp = (a, b, t) => a + (b - a) * t
const lerpAngle = (a, b, t) => {
  let d = b - a
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return a + d * t
}

function grassPattern(ctx) {
  const tile = document.createElement("canvas")
  tile.width = tile.height = 32
  const g = tile.getContext("2d")
  g.fillStyle = "#2f6a2b"
  g.fillRect(0, 0, 32, 32)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let k = 0; k < 90; k++) {
    g.fillStyle = rnd() < 0.5 ? "#2a5f27" : "#377a32"
    g.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 1 + Math.floor(rnd() * 2), 1)
  }
  return ctx.createPattern(tile, "repeat")
}

/** A closed Path2D through the centreline offset `off` metres to the right (or a sub-range, open). */
function offsetPath(track, off, from = 0, to = track.n - 1, closed = true) {
  const p = new Path2D()
  let first = true
  for (let k = from; k <= to; k++) {
    const i = ((k % track.n) + track.n) % track.n
    const x = track.xs[i] + -track.ty[i] * off
    const y = track.ys[i] + track.tx[i] * off
    if (first) p.moveTo(x, y)
    else p.lineTo(x, y)
    first = false
  }
  if (closed) p.closePath()
  return p
}

/** Where a car should start braking: the first point of every real drop in its own speed profile. */
export function brakePoints(track, profile, minDrop = 8) {
  const n = track.n
  const out = []
  let i = 0
  while (i < n) {
    if (profile[(i + 1) % n] < profile[i] - 0.02) {
      let j = i
      let lowest = profile[i]
      while (profile[(j + 1) % n] < profile[j] - 0.02 && j < i + n) {
        j += 1
        lowest = Math.min(lowest, profile[j % n])
      }
      if (profile[i] - lowest >= minDrop) out.push({ i: i % n, from: profile[i], to: lowest, length: (j - i) * track.spacing })
      i = j + 1
    } else i += 1
  }
  return out
}

export function createRenderer(canvas, track) {
  canvas.width = VIEW.width
  canvas.height = VIEW.height
  const ctx = canvas.getContext("2d", { alpha: false })
  ctx.imageSmoothingEnabled = false
  const W = VIEW.width
  const H = VIEW.height
  const grass = grassPattern(ctx)
  const centre = offsetPath(track, 0)
  const leftEdge = offsetPath(track, -track.halfWidth)
  const rightEdge = offsetPath(track, track.halfWidth)
  const kerbPaths = track.kerbs.flatMap(([a, b]) => [offsetPath(track, -(track.halfWidth + 0.6), a, b, false), offsetPath(track, track.halfWidth + 0.6, a, b, false)])
  const drsPaths = track.drs.map(([a, b]) => {
    /* The second zone wraps past the line (0.958 → 1.051); offsetPath takes indices beyond n modulo n. */
    const from = Math.round(a * track.n)
    const to = Math.round(b * track.n)
    return { path: offsetPath(track, -(track.halfWidth - 0.9), from, to, false), board: track.at(a, -(track.halfWidth + 3.2)) }
  })
  const sectorLines = track.gates.slice(0, 2).map((s) => track.at(s))
  const start = track.at(0)
  const noise = new Float32Array(track.n)
  let seed = 12345
  for (let i = 0; i < track.n; i++) {
    seed = (seed * 16807) % 2147483647
    noise[i] = (seed / 2147483647) * 2 - 1
  }
  const skids = []
  const MAX_SKIDS = 900
  const cam = { x: start.x, y: start.y, heading: start.heading, zoom: 2.6 }
  let assist = null

  /** Precompute the assist for the player's car: its own profile at full skill and the braking points. */
  function setAssist(params) {
    const profile = speedProfile(track, params, 1)
    assist = { params, profile, brakes: brakePoints(track, profile) }
  }

  function follow(player, dt, snap = false) {
    const v = Math.max(player.speed, 0)
    const ahead = 8 + v * 0.3
    const tx = player.x + Math.cos(player.heading) * ahead
    const ty = player.y + Math.sin(player.heading) * ahead
    const zoomTarget = lerp(3.4, 2.2, Math.min(1, v / 85))
    if (snap) {
      cam.x = tx
      cam.y = ty
      cam.heading = player.heading
      cam.zoom = zoomTarget
      return
    }
    const k = 1 - Math.exp(-dt * 6)
    cam.x = lerp(cam.x, tx, k)
    cam.y = lerp(cam.y, ty, k)
    cam.heading = lerpAngle(cam.heading, player.heading, 1 - Math.exp(-dt * 4.5))
    cam.zoom = lerp(cam.zoom, zoomTarget, 1 - Math.exp(-dt * 2))
  }

  function addSkid(car) {
    const bx = car.x - Math.cos(car.heading) * 1.6
    const by = car.y - Math.sin(car.heading) * 1.6
    const nx = -Math.sin(car.heading) * 0.9
    const ny = Math.cos(car.heading) * 0.9
    const dx = car.vx / 120
    const dy = car.vy / 120
    skids.push({ x1: bx + nx, y1: by + ny, x2: bx + nx - dx * 1.5, y2: by + ny - dy * 1.5 }, { x1: bx - nx, y1: by - ny, x2: bx - nx - dx * 1.5, y2: by - ny - dy * 1.5 })
    while (skids.length > MAX_SKIDS) skids.shift()
  }

  function toScreen(x, y) {
    const dx = x - cam.x
    const dy = y - cam.y
    const a = -(cam.heading + Math.PI / 2)
    const rx = dx * Math.cos(a) - dy * Math.sin(a)
    const ry = dx * Math.sin(a) + dy * Math.cos(a)
    return { x: W / 2 + rx * cam.zoom, y: H * 0.62 + ry * cam.zoom }
  }

  function drawCar(car, isPlayer) {
    ctx.save()
    ctx.translate(car.x, car.y)
    ctx.rotate(car.heading)
    ctx.scale(CAR_DRAW_SCALE, CAR_DRAW_SCALE)
    const L = CAR_SIZE.length
    const Wd = CAR_SIZE.width
    if (car.boosting) {
      ctx.fillStyle = "#ffb347"
      ctx.beginPath()
      ctx.moveTo(-L / 2, -0.6)
      ctx.lineTo(-L / 2 - 2.2 - Math.random() * 1.2, 0)
      ctx.lineTo(-L / 2, 0.6)
      ctx.fill()
      ctx.fillStyle = "#7dd3fc"
      ctx.fillRect(-L / 2 - 1, -0.25, 1, 0.5)
    }
    ctx.fillStyle = "#111"
    for (const [x, y] of [[1.45, -1.25], [1.45, 0.65], [-1.75, -1.3], [-1.75, 0.7]]) ctx.fillRect(x, y, 0.9, 0.6)
    ctx.fillStyle = isPlayer ? "#e10600" : car.color
    ctx.fillRect(-L / 2 + 0.3, -Wd / 2 + 0.35, L - 0.6, Wd - 0.7)
    ctx.fillRect(-L / 2 - 0.1, -Wd / 2, 0.7, Wd)
    ctx.fillRect(L / 2 - 0.7, -Wd / 2 + 0.1, 0.8, Wd - 0.2)
    ctx.fillStyle = "#0b0d12"
    ctx.fillRect(-0.9, -0.45, 1.3, 0.9)
    if (isPlayer) {
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 0.35
      ctx.strokeRect(-L / 2 - 0.3, -Wd / 2 - 0.3, L + 0.6, Wd + 0.6)
    }
    ctx.restore()
  }

  function drawAssist(player, lap) {
    if (!assist) return
    const P = assist.params
    const v = Math.max(player.speed, 20)
    const reachM = v * P.assistHorizonS
    const pts = Math.max(8, Math.min(track.n - 1, Math.round(reachM / track.spacing)))
    const i0 = player.segHint >= 0 ? player.segHint : 0
    const jitter = P.assistJitterM
    ctx.save()
    ctx.lineWidth = 0.7
    ctx.setLineDash(jitter > 2 ? [2, 2.5] : [4, 1.5])
    ctx.strokeStyle = jitter > 2 ? "rgba(125, 211, 252, 0.55)" : "rgba(125, 211, 252, 0.9)"
    ctx.beginPath()
    for (let k = 0; k <= pts; k++) {
      const i = (i0 + k) % track.n
      const wob = jitter * 0.35 * noise[(i + lap * 37) % track.n]
      const x = track.lx[i] + -track.ty[i] * wob
      const y = track.ly[i] + track.tx[i] * wob
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    for (const b of assist.brakes) {
      let ahead = b.i - i0
      if (ahead < 0) ahead += track.n
      if (ahead > pts) continue
      const shift = Math.round((jitter * noise[(b.i + lap * 11) % track.n]) / track.spacing)
      const i = (((b.i + shift) % track.n) + track.n) % track.n
      for (const side of [-1, 1]) {
        const x = track.xs[i] + -track.ty[i] * side * (track.halfWidth + 1.2)
        const y = track.ys[i] + track.tx[i] * side * (track.halfWidth + 1.2)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.atan2(track.ty[i], track.tx[i]))
        ctx.fillStyle = jitter > 2 ? "rgba(255, 90, 90, 0.7)" : "#ff3b3b"
        ctx.beginPath()
        ctx.moveTo(1.6, 0)
        ctx.lineTo(-1.2, -1.4)
        ctx.lineTo(-1.2, 1.4)
        ctx.fill()
        ctx.fillStyle = "#fff"
        ctx.fillRect(-1.4, -0.35, 1.4, 0.7)
        ctx.restore()
      }
    }
    ctx.restore()
  }

  /** Draw one frame. `state`: { race, player, assistOn, lap }. */
  function render({ race, player, assistOn = true }) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = "#2f6a2b"
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.translate(W / 2, H * 0.62)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.rotate(-(cam.heading + Math.PI / 2))
    ctx.translate(-cam.x, -cam.y)
    const R = Math.hypot(W, H) / cam.zoom / 2 + 10
    ctx.fillStyle = grass
    ctx.fillRect(cam.x - R, cam.y - R, 2 * R, 2 * R)

    ctx.lineJoin = "round"
    ctx.lineCap = "butt"
    ctx.strokeStyle = "#4b7f44"
    ctx.lineWidth = track.wallDist * 2
    ctx.stroke(centre)
    ctx.strokeStyle = "#d9d9d9"
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])
    ctx.stroke(offsetPath(track, -track.wallDist))
    ctx.stroke(offsetPath(track, track.wallDist))
    ctx.setLineDash([])
    ctx.strokeStyle = "#3b3d44"
    ctx.lineWidth = (track.halfWidth + track.kerbWidth) * 2
    ctx.stroke(centre)
    ctx.strokeStyle = "#55575f"
    ctx.lineWidth = track.width
    ctx.stroke(centre)
    ctx.strokeStyle = "#5c5e66"
    ctx.lineWidth = track.width * 0.45
    ctx.stroke(centre)

    ctx.lineWidth = 1.2
    ctx.strokeStyle = "#f3f3f3"
    for (const p of kerbPaths) ctx.stroke(p)
    ctx.strokeStyle = "#d61f1f"
    ctx.setLineDash([3, 3])
    for (const p of kerbPaths) ctx.stroke(p)
    ctx.setLineDash([])

    ctx.lineWidth = 0.35
    ctx.strokeStyle = "#f8fafc"
    ctx.stroke(leftEdge)
    ctx.stroke(rightEdge)

    ctx.strokeStyle = "rgba(74, 222, 128, 0.85)"
    ctx.lineWidth = 0.6
    ctx.setLineDash([3, 2])
    for (const z of drsPaths) ctx.stroke(z.path)
    ctx.setLineDash([])
    for (const z of drsPaths) {
      ctx.save()
      ctx.translate(z.board.x, z.board.y)
      ctx.rotate(z.board.heading)
      ctx.fillStyle = "#16a34a"
      ctx.fillRect(-2.2, -1.4, 4.4, 2.8)
      ctx.fillStyle = "#fff"
      ctx.fillRect(-1.6, -0.35, 3.2, 0.7)
      ctx.restore()
    }

    for (const g of sectorLines) {
      ctx.save()
      ctx.translate(g.x, g.y)
      ctx.rotate(g.heading)
      ctx.fillStyle = "rgba(250, 204, 21, 0.75)"
      ctx.fillRect(-0.3, -track.halfWidth, 0.6, track.width)
      ctx.restore()
    }
    ctx.save()
    ctx.translate(start.x, start.y)
    ctx.rotate(start.heading)
    for (let r = 0; r < 2; r++) for (let c = 0; c < 12; c++) {
      ctx.fillStyle = (r + c) % 2 ? "#111" : "#fafafa"
      ctx.fillRect(-1.5 + r * 1.5, -track.halfWidth + c * 1.5, 1.5, 1.5)
    }
    ctx.restore()

    for (const t of track.turns) {
      const side = t.curv > 0 ? -1 : 1
      const x = t.x + -track.ty[t.i] * side * (track.halfWidth + 4)
      const y = t.y + track.tx[t.i] * side * (track.halfWidth + 4)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(cam.heading + Math.PI / 2)
      ctx.fillStyle = "#facc15"
      ctx.fillRect(-2.6, -1.7, 5.2, 3.4)
      ctx.fillStyle = "#111"
      ctx.font = "bold 2.6px monospace"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(String(t.n), 0, 0.2)
      ctx.restore()
    }

    ctx.strokeStyle = "rgba(20, 20, 24, 0.55)"
    ctx.lineWidth = 0.45
    ctx.beginPath()
    for (const s of skids) {
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
    }
    ctx.stroke()

    if (assistOn && player) drawAssist(player, player.lap)

    for (const car of race.cars) if (car !== player) drawCar(car, false)
    if (player) drawCar(player, true)

    for (const car of race.cars) {
      if (car.glitchT > 0) {
        ctx.save()
        ctx.translate(car.x, car.y)
        ctx.rotate(cam.heading + Math.PI / 2)
        ctx.fillStyle = "#facc15"
        ctx.beginPath()
        ctx.moveTo(-2.2, -5)
        ctx.lineTo(0.4, -5)
        ctx.lineTo(-1.2, -7.2)
        ctx.lineTo(1.8, -7.2)
        ctx.lineTo(-0.8, -9.6)
        ctx.lineTo(0.2, -7.8)
        ctx.lineTo(-1.6, -7.8)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    }
    ctx.restore()

    ctx.font = "bold 8px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "bottom"
    for (const car of race.cars) {
      if (car === player) continue
      const p = toScreen(car.x, car.y)
      if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue
      ctx.fillStyle = "rgba(0,0,0,0.6)"
      ctx.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 20, 11, 9)
      ctx.fillStyle = car.color
      ctx.fillText(car.short || "?", Math.round(p.x) + 1, Math.round(p.y) - 12)
    }
  }

  return { ctx, cam, follow, render, addSkid, setAssist, toScreen, get assist() { return assist } }
}

/** The fixed-north minimap: the layout, the sector lines and every car as a dot. */
export function createMinimap(canvas, track) {
  const W = canvas.width
  const H = canvas.height
  const ctx = canvas.getContext("2d")
  const b = track.bounds
  const pad = 6
  const scale = Math.min((W - 2 * pad) / (b.maxX - b.minX), (H - 2 * pad) / (b.maxY - b.minY))
  const ox = (W - (b.maxX - b.minX) * scale) / 2 - b.minX * scale
  const oy = (H - (b.maxY - b.minY) * scale) / 2 - b.minY * scale
  const sx = (x) => ox + x * scale
  const sy = (y) => oy + y * scale
  const outline = new Path2D()
  for (let i = 0; i < track.n; i++) {
    if (i === 0) outline.moveTo(sx(track.xs[i]), sy(track.ys[i]))
    else outline.lineTo(sx(track.xs[i]), sy(track.ys[i]))
  }
  outline.closePath()
  const sectorColours = ["#facc15", "#38bdf8", "#f472b6"]
  const sectorPaths = [0, 1, 2].map((k) => {
    const from = Math.round((k === 0 ? 0 : track.gates[k - 1]) * track.n)
    const to = k === 2 ? track.n : Math.round(track.gates[k] * track.n)
    const p = new Path2D()
    for (let i = from; i <= to; i++) {
      const j = i % track.n
      if (i === from) p.moveTo(sx(track.xs[j]), sy(track.ys[j]))
      else p.lineTo(sx(track.xs[j]), sy(track.ys[j]))
    }
    return p
  })
  function draw(race, player) {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = "rgba(11, 13, 18, 0.72)"
    ctx.fillRect(0, 0, W, H)
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.lineWidth = 4
    ctx.strokeStyle = "#1f2430"
    ctx.stroke(outline)
    ctx.lineWidth = 2
    sectorPaths.forEach((p, k) => {
      ctx.strokeStyle = sectorColours[k]
      ctx.globalAlpha = 0.8
      ctx.stroke(p)
    })
    ctx.globalAlpha = 1
    const s = track.at(0)
    ctx.fillStyle = "#fff"
    ctx.fillRect(sx(s.x) - 1.5, sy(s.y) - 1.5, 3, 3)
    for (const car of race.cars) {
      if (car === player) continue
      ctx.fillStyle = car.color
      ctx.beginPath()
      ctx.arc(sx(car.x), sy(car.y), 2.2, 0, TAU)
      ctx.fill()
    }
    if (player) {
      ctx.fillStyle = "#e10600"
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(sx(player.x), sy(player.y), 3.4, 0, TAU)
      ctx.fill()
      ctx.stroke()
    }
  }
  return { draw }
}
