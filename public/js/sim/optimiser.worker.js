/**
 * Module Web Worker for the optimiser: runs `optimiseAsync()` off the main thread, posts a progress message every
 * 100 evaluations and the (plan-only) result at the end. The main thread re-evaluates the returned plans itself,
 * so nothing heavier than the plans, the diff and the trace crosses the thread boundary.
 *
 *   postMessage({ type: "run", id, options })   options: start, objective, locked, restarts, maxPlans, seed, fill
 *   postMessage({ type: "stop", id })            the best plan so far comes back with `stopped: true`
 *   ← { type: "progress", id, done, total, fraction, bestScore }
 *   ← { type: "result", id, result }  |  { type: "error", id, message }
 */
import { optimiseAsync } from "./optimiser.js"

const controllers = new Map()

self.onmessage = async (event) => {
  const { type, id, options } = event.data || {}
  if (type === "stop") { controllers.get(id)?.abort(); return }
  if (type !== "run") return
  const controller = new AbortController()
  controllers.set(id, controller)
  try {
    const r = await optimiseAsync({
      ...options,
      signal: controller.signal,
      onProgress: (p) => self.postMessage({ type: "progress", id, done: p.done, total: p.total, fraction: p.fraction, bestScore: p.bestScore }),
    })
    self.postMessage({ type: "result", id, result: {
      objective: r.objective, best: r.best, score: r.score, fits: r.fits, start: r.start, startScore: r.startScore,
      diff: r.diff, evaluations: r.evaluations, candidates: r.candidates, ms: r.ms, trace: r.trace, stopped: r.stopped,
      locked: r.locked, fill: r.fill, seed: r.seed, restarts: r.restarts, maxSweeps: r.maxSweeps, maxPlans: r.maxPlans,
    } })
  } catch (err) {
    self.postMessage({ type: "error", id, message: err && err.message ? err.message : String(err) })
  } finally {
    controllers.delete(id)
  }
}
