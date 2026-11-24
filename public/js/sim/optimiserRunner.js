/**
 * Runs the optimiser without blocking the page: in a module Web Worker when the browser allows it, otherwise on the
 * main thread in chunks of 200 evaluations with a yield between chunks (file://, very old browsers, tests).
 *
 *   const runner = createOptimiserRunner()
 *   const result = await runner.run({ start, objective, locked, thorough }, { onProgress })
 *   runner.stop()         // the best plan so far comes back with stopped: true
 *   runner.busy           // true while a search runs
 *   runner.mode           // "worker" | "main"
 *
 * The result carries only plans and the diff; evaluate the plans yourself for the figures.
 */
import { optimiseAsync, DEFAULTS } from "./optimiser.js"

export function createOptimiserRunner({ workerUrl = new URL("./optimiser.worker.js", import.meta.url), allowWorker = true } = {}) {
  let worker = null
  let mode = "main"
  let seq = 0
  let current = null

  function getWorker() {
    if (worker || !allowWorker || typeof Worker === "undefined") return worker
    try {
      worker = new Worker(workerUrl, { type: "module" })
      mode = "worker"
    } catch { worker = null }
    return worker
  }

  function budget(options) {
    const thorough = Boolean(options.thorough)
    return {
      restarts: options.restarts ?? (thorough ? DEFAULTS.thoroughRestarts : DEFAULTS.restarts),
      maxPlans: options.maxPlans ?? (thorough ? DEFAULTS.thoroughMaxPlans : DEFAULTS.maxPlans),
    }
  }

  function runInWorker(w, options, onProgress) {
    const id = ++seq
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const m = event.data || {}
        if (m.id !== id) return
        if (m.type === "progress") onProgress?.({ done: m.done, total: m.total, bestScore: m.bestScore })
        else if (m.type === "result") { cleanup(); resolve(m.result) }
        else if (m.type === "error") { cleanup(); reject(new Error(m.message)) }
      }
      const onError = (err) => { cleanup(); reject(err instanceof Error ? err : new Error(err?.message || "optimiser worker failed")) }
      const cleanup = () => { w.removeEventListener("message", onMessage); w.removeEventListener("error", onError); if (current && current.id === id) current = null }
      w.addEventListener("message", onMessage)
      w.addEventListener("error", onError)
      current = { id, stop: () => w.postMessage({ type: "stop", id }) }
      w.postMessage({ type: "run", id, options })
    })
  }

  async function runOnMain(options, onProgress) {
    const id = ++seq
    const controller = new AbortController()
    current = { id, stop: () => controller.abort() }
    try {
      const r = await optimiseAsync({ ...options, signal: controller.signal, yieldEvery: 200, onProgress: (p) => onProgress?.({ done: p.done, total: p.total, bestScore: p.bestScore }) })
      return r
    } finally {
      if (current && current.id === id) current = null
    }
  }

  return {
    get busy() { return current !== null },
    get mode() { return mode },
    async run(options, { onProgress } = {}) {
      if (current) throw new Error("the optimiser is already running")
      const { thorough, ...rest } = options
      const opts = { ...rest, ...budget(options) }
      const w = getWorker()
      if (w) {
        try { return await runInWorker(w, opts, onProgress) } catch (err) {
          // a worker that cannot start (blocked script, file://) falls back to the main thread once
          worker?.terminate?.()
          worker = null
          mode = "main"
          allowWorker = false
          if (current) current = null
          if (!/already running/.test(err.message)) return runOnMain(opts, onProgress)
          throw err
        }
      }
      return runOnMain(opts, onProgress)
    },
    stop() { current?.stop() },
    dispose() { worker?.terminate?.(); worker = null; current = null },
  }
}
