/**
 * The cloud-hosted environment (HOSTING.md): where the server listens, whose word it takes for a
 * visitor's address when counting failed PINs, the response headers, a clean stop on SIGTERM, and
 * the container and provider files.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createApp, DEFAULT_PINS, bindAddress, hostFromEnv, proxyTrust, clientAddress, proxySummary } from "../server.mjs"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const PINS = { HOST_PIN: "host-cloud", LEADER_PIN: "sa-cloud", RACE_PIN: "race-cloud" }
const HOSTING_FILES = ["Dockerfile", ".dockerignore", "render.yaml", "fly.toml", "deploy/docker-entrypoint.sh", "HOSTING.md"]
const RETIRED_BRAND = new RegExp(["F", "L", "U", "X"].join(""), "i")

/** A request as the server sees it: the socket's address and the headers. */
const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers })

/** Run `fn(login)` against a fresh game started with `env`; `login(pin, headers)` answers the status of a host login. */
async function withApp(env, fn) {
  const dir = await mkdtemp(join(tmpdir(), "podium-cloud-"))
  const app = createApp({ dataDir: dir, env: { ...PINS, ...env } })
  const server = createServer(app.handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const login = async (pin, headers = {}) => (await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ pin }) })).status
  try {
    await fn(login, base)
  } finally {
    app.close()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
}

/** Ten wrong PINs, each sent with the headers `headersFor(i)` returns. */
async function tenWrongPins(login, headersFor) {
  for (let i = 0; i < 10; i++) assert.equal(await login(`wrong-${i}`, headersFor(i)), 403)
}

/** A port nothing is listening on. */
async function freePort() {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test("where the server listens: this machine by default, every interface with --lan, HOST when a cloud host sets it", () => {
  assert.equal(bindAddress({ env: {}, argv: ["node", "server.mjs"] }), "127.0.0.1")
  assert.equal(bindAddress({ env: {}, argv: ["node", "server.mjs", "--lan"] }), "0.0.0.0")
  assert.equal(bindAddress({ env: { HOST: "0.0.0.0" }, argv: ["node", "server.mjs"] }), "0.0.0.0", "HOST=0.0.0.0 opens every interface without --lan")
  assert.equal(bindAddress({ env: { HOST: "127.0.0.1" }, argv: ["node", "server.mjs", "--lan"] }), "127.0.0.1", "HOST takes precedence over --lan")
  assert.equal(bindAddress({ env: { HOST: " :: " }, argv: [] }), "::", "an IPv6 address is accepted")
  for (const name of ["simons-macbook.local", "localhost", "example.com", "", "0.0.0.0:8080"]) {
    assert.equal(hostFromEnv({ HOST: name }), "", `HOST="${name}" is not an IP address and is ignored`)
    assert.equal(bindAddress({ env: { HOST: name }, argv: [] }), "127.0.0.1")
  }
})

test("TRUST_PROXY names the proxy to believe; unset is the laptop tunnel, and a typo trusts nothing", () => {
  assert.equal(proxyTrust({}), "tunnel")
  assert.equal(proxyTrust({ TRUST_PROXY: "" }), "tunnel")
  for (const name of ["cloudflare", "render", "fly", "xff"]) assert.equal(proxyTrust({ TRUST_PROXY: ` ${name.toUpperCase()} ` }), name)
  for (const name of ["none", "cloudfare", "true", "1", "*", "constructor", "__proto__"]) assert.equal(proxyTrust({ TRUST_PROXY: name }), "none", `TRUST_PROXY=${name}`)
  for (const env of [{}, { TRUST_PROXY: "none" }, { TRUST_PROXY: "render" }, { TRUST_PROXY: "fly" }, { TRUST_PROXY: "xff" }]) assert.ok(proxySummary(env).length > 20)
  assert.match(proxySummary({ TRUST_PROXY: "fly" }), /fly-client-ip/)
  assert.match(proxySummary({ TRUST_PROXY: "oops" }), /the connecting address/)
})

test("the visitor's address: a forwarded header counts only from the proxy TRUST_PROXY names", () => {
  const forged = { "cf-connecting-ip": "1.1.1.1", "fly-client-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3, 4.4.4.4" }
  assert.equal(clientAddress(request("203.0.113.9", forged), "none"), "203.0.113.9", "no proxy named: the socket's address")
  assert.equal(clientAddress(request("203.0.113.9", forged), "constructor"), "203.0.113.9", "an unknown mode trusts nothing")
  assert.equal(clientAddress(request("203.0.113.9", forged), "cloudflare"), "1.1.1.1")
  assert.equal(clientAddress(request("203.0.113.9", forged), "render"), "1.1.1.1")
  assert.equal(clientAddress(request("203.0.113.9", forged), "fly"), "2.2.2.2")
  assert.equal(clientAddress(request("203.0.113.9", forged), "xff"), "4.4.4.4", "of a list, the entry the nearest proxy wrote")
  assert.equal(clientAddress(request("203.0.113.9", {}), "fly"), "203.0.113.9", "no header: the socket's address")
  assert.equal(clientAddress(request(undefined, {}), "none"), "unknown")
  assert.equal(clientAddress(request("203.0.113.9", { "cf-connecting-ip": "9".repeat(500) }), "cloudflare").length, 128, "capped")

  /* The laptop (TRUST_PROXY not set): the tunnel connects from this machine, so only then is CF-Connecting-IP believed. */
  for (const local of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(clientAddress(request(local, forged), "tunnel"), "1.1.1.1", `the tunnel on ${local}`)
  assert.equal(clientAddress(request("127.0.0.1", {}), "tunnel"), "127.0.0.1", "a browser on the laptop itself")
  assert.equal(clientAddress(request("192.168.1.50", forged), "tunnel"), "192.168.1.50", "an iPad on the room Wi-Fi cannot forge the header")
  assert.equal(clientAddress(request("203.0.113.9", forged)), "203.0.113.9", "the default is the laptop rule")
  assert.equal(clientAddress(request("127.0.0.1", { "x-forwarded-for": "3.3.3.3", "fly-client-ip": "2.2.2.2" }), "tunnel"), "127.0.0.1", "only the tunnel's own header counts")
})

test("forged address headers do not dodge the failed-PIN limit when no proxy is trusted", async () => {
  await withApp({ TRUST_PROXY: "none" }, async (login) => {
    await tenWrongPins(login, (i) => ({ "cf-connecting-ip": `198.51.100.${i}`, "x-forwarded-for": `198.51.100.${i}`, "fly-client-ip": `198.51.100.${i}` }))
    assert.equal(await login(PINS.HOST_PIN, { "cf-connecting-ip": "198.51.100.200", "x-forwarded-for": "198.51.100.200", "fly-client-ip": "198.51.100.200" }), 429, "a new forged address is still the same visitor")
  })
})

test("behind a named proxy only that proxy's header separates visitors", async () => {
  await withApp({ TRUST_PROXY: "fly" }, async (login) => {
    await tenWrongPins(login, (i) => ({ "fly-client-ip": "198.51.100.7", "cf-connecting-ip": `203.0.113.${i}`, "x-forwarded-for": `203.0.113.${i}` }))
    assert.equal(await login(PINS.HOST_PIN, { "fly-client-ip": "198.51.100.7", "cf-connecting-ip": "203.0.113.99" }), 429, "the other headers are ignored")
    assert.equal(await login(PINS.HOST_PIN, { "fly-client-ip": "198.51.100.8" }), 200, "another visitor is unaffected")
  })
  await withApp({ TRUST_PROXY: "render" }, async (login) => {
    await tenWrongPins(login, (i) => ({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": `203.0.113.${i}` }))
    assert.equal(await login(PINS.HOST_PIN, { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.99" }), 429)
    assert.equal(await login(PINS.HOST_PIN, { "cf-connecting-ip": "198.51.100.8" }), 200)
  })
  await withApp({ TRUST_PROXY: "xff" }, async (login) => {
    await tenWrongPins(login, (i) => ({ "x-forwarded-for": `203.0.113.${i}, 198.51.100.7` }))
    assert.equal(await login(PINS.HOST_PIN, { "x-forwarded-for": "203.0.113.99, 198.51.100.7" }), 429, "the entries a visitor adds in front do not count")
    assert.equal(await login(PINS.HOST_PIN, { "x-forwarded-for": "203.0.113.99, 198.51.100.8" }), 200)
  })
})

test("on the laptop the tunnel's CF-Connecting-IP still separates visitors", async () => {
  await withApp({}, async (login) => {
    await tenWrongPins(login, () => ({ "cf-connecting-ip": "198.51.100.7" }))
    assert.equal(await login(PINS.HOST_PIN, { "cf-connecting-ip": "198.51.100.7" }), 429)
    assert.equal(await login(PINS.HOST_PIN, { "cf-connecting-ip": "198.51.100.8" }), 200)
    assert.equal(await login(PINS.HOST_PIN), 200, "a browser on the laptop itself")
  })
})

test("every response says nosniff and no-referrer, the API is never cached, and there is no CORS", async () => {
  await withApp({}, async (login, base) => {
    for (const path of ["/", "/host.html", "/css/app.css", "/js/ui.js", "/api/health", "/api/state", "/api/nope", "/nope.html"]) {
      const res = await fetch(base + path)
      await res.arrayBuffer()
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", path)
      assert.equal(res.headers.get("referrer-policy"), "no-referrer", path)
      assert.equal(res.headers.get("access-control-allow-origin"), null, `${path}: no CORS`)
      const cache = res.headers.get("cache-control")
      if (path.startsWith("/api/") || res.status !== 200) assert.equal(cache, "no-store", path)
      else assert.equal(cache, "no-cache", `${path}: pages are checked with the server on every load`)
    }
    const denied = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.com" }, body: JSON.stringify({ pin: "wrong" }) })
    assert.equal(denied.status, 403)
    assert.equal(denied.headers.get("cache-control"), "no-store")
    assert.equal(denied.headers.get("access-control-allow-origin"), null)
  })
})

test("started with HOST and PORT, the server listens there, and SIGTERM saves the game and exits cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "podium-term-"))
  const port = await freePort()
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.mjs", root)), "--lan"], {
    env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dir, TRUST_PROXY: "none", PODIUM_NO_OPEN: "1", ...PINS },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  child.stdout.on("data", (chunk) => (log += chunk))
  child.stderr.on("data", (chunk) => (log += chunk))
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })))
  try {
    const ready = new Promise((resolve) => child.stdout.on("data", () => log.includes("PINs in use") && resolve("ready")))
    assert.equal(await Promise.race([ready, exited.then(() => "exited"), new Promise((resolve) => setTimeout(resolve, 10_000, "timeout"))]), "ready", log)
    assert.ok(log.includes(`Listening on 127.0.0.1:${port} (HOST from the environment`), log)
    assert.match(log, /Failed PINs are counted per visitor address: the connecting address/)
    for (const pin of [DEFAULT_PINS.host, ...Object.values(PINS)]) assert.ok(!log.includes(pin), "the log never carries a PIN")
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
    assert.equal(health.app, "podium")
    assert.equal(existsSync(join(dir, "state.json")), false, "nothing has changed yet, so nothing is on disk")
    child.kill("SIGTERM")
    assert.deepEqual(await exited, { code: 0, signal: null }, log)
    assert.match(log, /SIGTERM received/)
    const saved = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))
    assert.ok(Array.isArray(saved.teams) && saved.pins === undefined, "the game is on disk, without PINs")
  } finally {
    child.kill("SIGKILL")
    await rm(dir, { recursive: true, force: true })
  }
})

test("the container and provider files exist, probe /api/health, run one instance and hold no PIN", () => {
  const pin = DEFAULT_PINS.host.toLowerCase()
  for (const file of HOSTING_FILES) {
    assert.ok(existsSync(new URL(file, root)), `${file} is missing`)
    const text = read(file)
    assert.ok(!text.toLowerCase().includes(pin), `${file} holds the PIN value`)
    assert.ok(!RETIRED_BRAND.test(text), `${file} mentions the retired product name`)
    assert.ok(!/(?<!Solutions )\bArchitect\b|table leader/.test(text), `${file} uses an old role name`)
    assert.ok(!/(HOST|LEADER|RACE)_PIN\s*[=:]\s*["']?[A-Za-z0-9_-]+["']?\s*$/m.test(text), `${file} gives a PIN variable a value`)
  }
  for (const file of ["Dockerfile", "render.yaml", "fly.toml", "HOSTING.md"]) assert.ok(read(file).includes("/api/health"), `${file} does not mention /api/health`)
  assert.ok(!existsSync(new URL("package-lock.json", root)), "no package-lock.json")
  assert.deepEqual(Object.keys(JSON.parse(read("package.json"))).filter((key) => /dependencies/i.test(key)), [], "no dependencies")

  const docker = read("Dockerfile")
  assert.match(docker, /^FROM node:\d+-alpine$/m, "an official Node image")
  assert.ok(!/^\s*RUN\s+.*\bnpm\b/m.test(docker), "no npm install: there are no dependencies")
  assert.match(docker, /^EXPOSE 8080$/m)
  assert.match(docker, /^HEALTHCHECK [\s\S]*\/api\/health/m)
  for (const setting of ["HOST=0.0.0.0", "DATA_DIR=/data", "TRUST_PROXY=none"]) assert.ok(docker.includes(setting), `the Dockerfile lacks ${setting}`)
  assert.match(docker, /^CMD \["node", "server\.mjs"/m)
  assert.match(read("deploy/docker-entrypoint.sh"), /exec su-exec node "\$@"/, "the server runs as the unprivileged node user")

  const ignored = read(".dockerignore").split("\n")
  for (const entry of ["data", ".git", ".worktrees", "tests", "node_modules", ".env"]) assert.ok(ignored.includes(entry), `.dockerignore lacks ${entry}`)

  const render = read("render.yaml")
  assert.match(render, /^\s+healthCheckPath: \/api\/health$/m)
  assert.match(render, /^\s+runtime: docker$/m)
  assert.ok(!/numInstances:\s*(?!1\s*$)|^\s+scaling:/m.test(render), "one instance: the game lives in one process")
  assert.match(render, /^\s+autoDeployTrigger: "off"$/m, "a push cannot restart a session")
  for (const name of ["HOST_PIN", "LEADER_PIN", "RACE_PIN"]) assert.match(render, new RegExp(`- key: ${name}\\n\\s+sync: false`), `${name} is asked for in the dashboard`)
  assert.match(render, /- key: TRUST_PROXY\n\s+value: render/)
  assert.match(render, /- key: DATA_DIR\n\s+value: \/data/)

  const fly = read("fly.toml")
  assert.match(fly, /^\s+path = "\/api\/health"$/m)
  assert.match(fly, /^\s+TRUST_PROXY = "fly"$/m)
  assert.match(fly, /^\s+DATA_DIR = "\/data"$/m)
  assert.match(fly, /^\s+destination = "\/data"$/m)
  assert.match(fly, /^\s+auto_stop_machines = "off"$/m, "the machine is not stopped mid-session")
  assert.match(fly, /^\s+min_machines_running = 1$/m)
  assert.ok(!/HOST_PIN\s*=\s*"/.test(fly), "PINs are Fly secrets, not in the file")
})

test("HOSTING.md covers the setup and the README links to it", () => {
  const hosting = read("HOSTING.md")
  for (const w of ["the host PIN", "HOST_PIN", "LEADER_PIN", "RACE_PIN", "TRUST_PROXY", "DATA_DIR", "render.yaml", "fly.toml", "Dockerfile", "Blueprint", "Manual Deploy", "onrender.com",
    "static", "one instance", "Restart the experience", "tunnel", "TokenQuest", "check the provider's current pricing"]) assert.ok(hosting.includes(w), `HOSTING.md lacks "${w}"`)
  const readme = read("README.md")
  assert.ok(readme.includes("(HOSTING.md)"), "the README links to HOSTING.md")
  for (const w of ["TRUST_PROXY", "Cloud hosting"]) assert.ok(readme.includes(w), `README lacks "${w}"`)
})
