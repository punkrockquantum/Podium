/**
 * A tiny headless-Chrome driver over the DevTools protocol, with no dependencies: Node's built-in
 * WebSocket (Node 22+) talks to a Chrome started with --remote-debugging-port=0. Used by the
 * browser tests (scroll stability, the full table flow) and skipped when Chrome is not installed.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CANDIDATES = [
  process.env.PODIUM_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean)

/** The Chrome binary to use, or null when none is installed. */
export function findChrome() {
  return CANDIDATES.find((path) => existsSync(path)) || null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Start headless Chrome and connect to its browser target. */
export async function launchChrome({ width = 1024, height = 768 } = {}) {
  const binary = findChrome()
  if (!binary) throw new Error("Chrome not found")
  const profile = mkdtempSync(join(tmpdir(), "podium-chrome-"))
  const proc = spawn(binary, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio", `--window-size=${width},${height}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] })
  let stderr = ""
  proc.stderr.on("data", (chunk) => { stderr += chunk })
  const portFile = join(profile, "DevToolsActivePort")
  let port = 0
  for (let i = 0; i < 200 && !port; i++) {
    if (existsSync(portFile)) {
      const [line] = readFileSync(portFile, "utf8").split("\n")
      port = Number(line) || 0
    }
    if (!port) await sleep(50)
  }
  if (!port) {
    proc.kill("SIGKILL")
    throw new Error(`Chrome did not publish a DevTools port: ${stderr.slice(-400)}`)
  }
  const info = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
  const ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("could not connect to Chrome")) })
  let nextId = 1
  const waiting = new Map()
  const listeners = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ""}`))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const fn of listeners.get(`${msg.sessionId || ""}:${msg.method}`) || []) fn(msg.params)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const on = (sessionId, method, fn) => {
    const key = `${sessionId || ""}:${method}`
    listeners.set(key, [...(listeners.get(key) || []), fn])
  }

  /** Open a page (a new tab) and return a driver for it. */
  async function page() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true })
    const errors = []
    on(sessionId, "Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "exception"))
    on(sessionId, "Runtime.consoleAPICalled", (p) => { if (p.type === "error") errors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ")) })
    on(sessionId, "Log.entryAdded", (p) => { if (p.entry.level === "error" && p.entry.source !== "network") errors.push(`${p.entry.source}: ${p.entry.text}`) })
    await send("Runtime.enable", {}, sessionId)
    await send("Page.enable", {}, sessionId)
    await send("Log.enable", {}, sessionId)
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)
    const evaluate = async (expression) => {
      const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
      return res.result.value
    }
    const loaded = () => new Promise((resolve) => on(sessionId, "Page.loadEventFired", () => resolve()))
    return {
      sessionId,
      errors,
      evaluate,
      async goto(url) {
        const done = loaded()
        await send("Page.navigate", { url }, sessionId)
        await done
        await sleep(150)
      },
      /** Wait until `expression` is truthy (polling), or fail after `ms`. */
      async waitFor(expression, ms = 8000, label = expression) {
        const until = Date.now() + ms
        while (Date.now() < until) {
          if (await evaluate(`Boolean(${expression})`)) return true
          await sleep(100)
        }
        throw new Error(`timed out waiting for ${label}`)
      },
      async click(selector) {
        await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error("no element " + ${JSON.stringify(selector)}); n.click(); return true })()`)
      },
      async type(selector, text) {
        await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error("no element " + ${JSON.stringify(selector)}); n.focus(); n.value = ${JSON.stringify(text)}; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); return true })()`)
      },
      async screenshot(path) {
        const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId)
        mkdirSync(join(path, ".."), { recursive: true })
        writeFileSync(path, Buffer.from(data, "base64"))
        return path
      },
      async close() {
        await send("Target.closeTarget", { targetId }).catch(() => {})
      },
    }
  }

  return {
    page,
    async close() {
      try { ws.close() } catch {}
      proc.kill("SIGKILL")
      await sleep(100)
      rmSync(profile, { recursive: true, force: true })
    },
  }
}
