/**
 * Optional WebAudio synth: an engine note that follows the speed, a boost whoosh, start lights,
 * gate beeps, a bump thud. Muted by default (projector rooms); M toggles. Everything is created
 * lazily on the first unmute (browsers need a gesture) and nothing here throws if WebAudio is missing.
 */
export function createAudio() {
  let ctx = null
  let engine = null
  let muted = true

  function ensure() {
    if (ctx) return true
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return false
    try {
      ctx = new AC()
      const master = ctx.createGain()
      master.gain.value = 0.25
      master.connect(ctx.destination)
      const osc = ctx.createOscillator()
      osc.type = "sawtooth"
      osc.frequency.value = 60
      const sub = ctx.createOscillator()
      sub.type = "square"
      sub.frequency.value = 30
      const filter = ctx.createBiquadFilter()
      filter.type = "lowpass"
      filter.frequency.value = 600
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.connect(filter)
      sub.connect(filter)
      filter.connect(gain)
      gain.connect(master)
      osc.start()
      sub.start()
      engine = { osc, sub, filter, gain, master }
      return true
    } catch {
      ctx = null
      return false
    }
  }

  function blip(freq, ms, type = "square", vol = 0.5) {
    if (muted || !ensure()) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000)
    o.connect(g)
    g.connect(engine.master)
    o.start()
    o.stop(ctx.currentTime + ms / 1000)
  }

  return {
    get muted() {
      return muted
    },
    toggle() {
      muted = !muted
      if (!muted) {
        ensure()
        ctx?.resume?.()
      } else if (engine) engine.gain.gain.value = 0
      return muted
    },
    /** Call every frame with the player's car. */
    engine(car, racing) {
      if (muted || !engine) return
      const v = Math.max(0, car.speed)
      const rpm = 55 + v * 2.2 + (car.throttle > 0 ? 18 : 0) + (car.boosting ? 40 : 0)
      engine.osc.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.05)
      engine.sub.frequency.setTargetAtTime(rpm / 2, ctx.currentTime, 0.05)
      engine.filter.frequency.setTargetAtTime(300 + v * 12 + car.throttle * 400, ctx.currentTime, 0.08)
      const target = racing ? 0.22 + car.throttle * 0.18 + (car.onGrass ? 0.1 : 0) : 0.12
      engine.gain.gain.setTargetAtTime(car.glitchT > 0 ? target * 0.4 : target, ctx.currentTime, 0.05)
    },
    light(index) {
      blip(440, 120, "square", 0.35)
    },
    go() {
      blip(880, 500, "square", 0.45)
    },
    boost() {
      blip(220, 350, "sawtooth", 0.4)
      setTimeout(() => blip(660, 250, "sawtooth", 0.3), 80)
    },
    sector(good) {
      blip(good ? 1320 : 660, 90, "square", 0.25)
    },
    lap() {
      blip(990, 80, "square", 0.3)
      setTimeout(() => blip(1320, 160, "square", 0.3), 90)
    },
    bump() {
      blip(90, 120, "triangle", 0.6)
    },
    glitch() {
      blip(200, 60, "square", 0.3)
      setTimeout(() => blip(150, 60, "square", 0.3), 70)
    },
    finish() {
      ;[0, 120, 240, 360].forEach((d, k) => setTimeout(() => blip([660, 880, 1100, 1320][k], 200, "square", 0.35), d))
    },
  }
}
