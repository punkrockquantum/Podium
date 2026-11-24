/**
 * The arcade league API: strict validation, plausibility window, size and row caps, ranking, the
 * host-PIN reset, persistence to DATA_DIR and the per-address soft limit. Runs the real server on a
 * random port with a throwaway data directory.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp, DEFAULT_PINS } from "../server.mjs"
import { leagueRoutes, validateEntry, cleanText, LEAGUE_LIMITS } from "../server/league.mjs"
import { PLAUSIBLE_LAP_MS } from "../public/js/arcade/physics.js"

let server
let base
let dir
let app

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "podium-arcade-league-"))
  app = createApp({ dataDir: dir, env: {} })
  server = createServer(app.handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  app?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (dir) await rm(dir, { recursive: true, force: true })
})

const get = async (path) => {
  const res = await fetch(`${base}${path}`)
  return { status: res.status, json: await res.json() }
}
const post = async (path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers }
}
const entry = (over = {}) => ({ name: "Ana", bestLapMs: 58123, season: 2028, carLabel: "Digital Realty + HPE GreenLake 2028", advantageS: 0.39, laps: 3, finishPos: 1, ...over })

test("validateEntry: trims and strips names, refuses bad numbers, implausible laps and oversized rows", () => {
  assert.equal(cleanText("  Ana\u0000 <b>x</b>\t\n ", 24), "Ana b x /b")
  const ok = validateEntry(entry({ name: "  Ana  " }), 1000)
  assert.equal(ok.row.name, "Ana")
  assert.equal(ok.row.at, 1000)
  assert.equal(typeof ok.row.id, "string")
  assert.match(validateEntry(entry({ name: "" })).error, /Enter a name/)
  assert.match(validateEntry(entry({ name: "   \u0001  " })).error, /Enter a name/)
  assert.match(validateEntry(entry({ name: "x".repeat(25) })).error, /too long/)
  assert.equal(validateEntry(entry({ name: "x".repeat(24) })).row.name.length, 24)
  assert.match(validateEntry(entry({ bestLapMs: 58123.4 })).error, /whole number/)
  assert.match(validateEntry(entry({ bestLapMs: "58123" })).row ? "ok" : "no", /ok/, "numeric strings are accepted")
  assert.match(validateEntry(entry({ bestLapMs: PLAUSIBLE_LAP_MS.min - 1 })).error, /not plausible/)
  assert.match(validateEntry(entry({ bestLapMs: PLAUSIBLE_LAP_MS.max + 1 })).error, /not plausible/)
  assert.match(validateEntry(entry({ bestLapMs: 1000 })).error, /not plausible/)
  assert.match(validateEntry(entry({ season: 2026 })).error, /season/)
  assert.match(validateEntry(entry({ advantageS: "fast" })).error, /advantageS/)
  assert.match(validateEntry(entry({ advantageS: 9 })).error, /advantageS/)
  assert.match(validateEntry(entry({ laps: 0 })).error, /laps/)
  assert.match(validateEntry(entry({ laps: 11 })).error, /laps/)
  assert.match(validateEntry(entry({ finishPos: 11 })).error, /finishPos/)
  assert.match(validateEntry(entry({ finishPos: "1st" })).error, /finishPos/)
  assert.match(validateEntry(null).error, /JSON object/)
  assert.match(validateEntry([1, 2]).error, /JSON object/)
  assert.equal(validateEntry(entry({ carLabel: "<script>alert(1)</script>" })).row.carLabel, "script alert(1) /script")
  assert.equal(validateEntry(entry({ carLabel: "L".repeat(200) })).row.carLabel.length, LEAGUE_LIMITS.labelMax, "labels are capped, not refused")
  assert.equal(validateEntry(entry({ carLabel: "" })).row.carLabel, "Unknown car")
  assert.equal(validateEntry(entry({ extra: "ignored", __proto__: { evil: true } })).row.extra, undefined, "unknown fields are dropped")
})

test("GET/POST /api/league: an empty table, then a lap, ranked and sorted by best lap", async () => {
  const empty = await get("/api/league")
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.rows, [])
  assert.equal(empty.json.total, 0)
  assert.deepEqual(empty.json.limits.lapMs, PLAUSIBLE_LAP_MS)
  const first = await post("/api/league", entry({ name: "  Ana <b>x</b> " }))
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(first.json.ok, true)
  assert.equal(first.json.rank, 1)
  assert.equal(first.json.kept, true)
  assert.equal(first.json.row.name, "Ana b x /b")
  const faster = await post("/api/league", entry({ name: "Ben", bestLapMs: 57000, season: 2027, carLabel: "Digital Realty Zurich 2027", advantageS: 0.14, finishPos: 2 }))
  assert.equal(faster.json.rank, 1, "a faster lap takes the top spot")
  const slower = await post("/api/league", entry({ name: "Cy", bestLapMs: 61000, finishPos: 7 }))
  assert.equal(slower.json.rank, 3)
  assert.equal(slower.json.total, 3)
  const table = await get("/api/league?limit=2")
  assert.equal(table.json.rows.length, 2)
  assert.equal(table.json.total, 3)
  assert.deepEqual(table.json.rows.map((r) => r.name), ["Ben", "Ana b x /b"])
  for (const row of table.json.rows) {
    assert.ok(Number.isInteger(row.bestLapMs) && typeof row.id === "string" && Number.isFinite(row.at))
    assert.deepEqual(Object.keys(row).sort(), ["advantageS", "at", "bestLapMs", "carLabel", "finishPos", "id", "laps", "name", "season"])
  }
  assert.equal((await get("/api/league?limit=0")).json.rows.length, 3, "a silly limit falls back to the default")
  assert.equal((await get("/api/league?limit=abc")).json.rows.length, 3)
  const tie = await post("/api/league", entry({ name: "Dee", bestLapMs: 57000 }))
  assert.equal(tie.json.rank, 2, "ties keep the earlier entry ahead")
})

test("POST /api/league: validation errors are 400 with a reason, bad JSON and huge bodies are refused", async () => {
  const bad = await post("/api/league", entry({ bestLapMs: 1000 }))
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /not plausible/)
  /* The rest of the reasons through the route itself (every POST counts towards the per-address limit, so not over HTTP). */
  const routes = leagueRoutes({ dataDir: await mkdtemp(join(tmpdir(), "podium-arcade-val-")), send: (res, status, payload) => Object.assign(res, { status, payload }), requireHost: () => false, clientIp: () => `ip-${Math.random()}` })
  for (const [body, pattern] of [
    [entry({ name: "" }), /Enter a name/],
    [entry({ name: "x".repeat(40) }), /too long/],
    [entry({ bestLapMs: 12.5 }), /whole number/],
    [entry({ season: 2030 }), /season/],
    [entry({ laps: 99 }), /laps/],
    [entry({ finishPos: 0 }), /finishPos/],
    [entry({ advantageS: null }), /advantageS/],
    ["a string", /JSON object/],
  ]) {
    const res = {}
    routes["POST /api/league"]({}, res, { body })
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.match(res.payload.error, pattern)
  }
  const broken = await post("/api/league", "{not json")
  assert.equal(broken.status, 400, `broken JSON → ${broken.status}`)
  /* Over the server's 64 KB body cap the connection is cut: either a 413 or a dropped socket, never a row. */
  const huge = await post("/api/league", JSON.stringify(entry({ carLabel: "x".repeat(70 * 1024) }))).catch((err) => ({ status: "dropped", err }))
  assert.ok(huge.status === 413 || huge.status === "dropped", `over the body cap → ${huge.status}`)
  assert.equal((await get("/api/league")).json.total, 4, "nothing slipped through")
})

test("POST /api/league/reset needs the host PIN; the table persists to DATA_DIR and reloads", async () => {
  const file = join(dir, "league.json")
  assert.ok(existsSync(file), "league.json written on the first post")
  const saved = JSON.parse(await readFile(file, "utf8"))
  assert.equal(saved.version, 1)
  assert.equal(saved.rows.length, 4)
  const reloaded = leagueRoutes({ dataDir: dir, send: (res, status, payload) => Object.assign(res, { status, payload }), requireHost: () => false, clientIp: () => "x" })
  const res = {}
  reloaded["GET /api/league"]({}, res, { query: new URLSearchParams("limit=50") })
  assert.equal(res.payload.total, 4, "a fresh instance loads the saved rows")
  assert.deepEqual(res.payload.rows.map((r) => r.name).slice(0, 2), ["Ben", "Dee"])

  const noPin = await post("/api/league/reset", {})
  assert.equal(noPin.status, 403)
  const wrongPin = await post("/api/league/reset", {}, { "x-pin": "nope" })
  assert.equal(wrongPin.status, 403)
  assert.equal((await get("/api/league")).json.total, 4, "still there")
  const reset = await post("/api/league/reset", {}, { "x-pin": DEFAULT_PINS.host })
  assert.equal(reset.status, 200)
  assert.deepEqual(reset.json, { ok: true, rows: [], total: 0 })
  assert.equal((await get("/api/league")).json.total, 0)
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).rows, [], "the empty table is saved too")
})

test("soft limit: more than ten laps from one address inside a minute is 429 with retry-after", async () => {
  const results = []
  for (let k = 0; k < LEAGUE_LIMITS.postsPerMinute + 2; k++) results.push(await post("/api/league", entry({ name: `Driver ${k}`, bestLapMs: 58000 + k })))
  const statuses = results.map((r) => r.status)
  const firstLimited = statuses.indexOf(429)
  assert.ok(firstLimited > 0, `a 429 arrives after some 200s: ${statuses.join(",")}`)
  assert.ok(statuses.slice(0, firstLimited).every((s) => s === 200) && statuses.slice(firstLimited).every((s) => s === 429), `200s then 429s: ${statuses.join(",")}`)
  assert.ok(statuses.filter((s) => s === 200).length <= LEAGUE_LIMITS.postsPerMinute)
  const limited = results[firstLimited]
  assert.equal(limited.headers.get("retry-after"), "60")
  assert.match(limited.json.error, /Ten laps a minute/)
  assert.equal((await get("/api/league")).json.total, firstLimited, "only the accepted laps are on the table")
  await post("/api/league/reset", {}, { "x-pin": DEFAULT_PINS.host })
})

test("row cap: the table keeps the best 500 laps and tells a slower lap it was not kept", async () => {
  let t = 1_000_000
  const routes = leagueRoutes({ dataDir: await mkdtemp(join(tmpdir(), "podium-arcade-cap-")), send: (res, status, payload) => Object.assign(res, { status, payload }), requireHost: () => false, clientIp: () => `ip-${Math.random()}`, now: () => (t += 1) })
  const postRow = (over) => {
    const res = {}
    routes["POST /api/league"]({}, res, { body: entry(over) })
    return res
  }
  for (let k = 0; k < LEAGUE_LIMITS.rows; k++) assert.equal(postRow({ name: `R${k}`, bestLapMs: 50_000 + k * 10 }).status, 200)
  const table = {}
  routes["GET /api/league"]({}, table, { query: new URLSearchParams("limit=500") })
  assert.equal(table.payload.total, LEAGUE_LIMITS.rows)
  const slow = postRow({ name: "Slow", bestLapMs: 90_000 })
  assert.equal(slow.status, 200)
  assert.equal(slow.payload.kept, false)
  assert.equal(slow.payload.rank, LEAGUE_LIMITS.rows + 1)
  assert.equal(slow.payload.total, LEAGUE_LIMITS.rows)
  const quick = postRow({ name: "Quick", bestLapMs: 49_000 })
  assert.equal(quick.payload.rank, 1)
  assert.equal(quick.payload.kept, true)
  assert.equal(quick.payload.total, LEAGUE_LIMITS.rows, "the slowest row fell off the end")
  const after = {}
  routes["GET /api/league"]({}, after, { query: new URLSearchParams("limit=1") })
  assert.equal(after.payload.rows[0].name, "Quick")
})

test("the league table is served as a page and its scripts carry no retired names or the PIN", async () => {
  const page = await fetch(`${base}/arcade.html`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes("/js/arcade/main.js") && html.includes("/css/arcade.css"), "arcade.html mounts the game")
  assert.ok(html.includes('href="/"') && /Back to the plan/.test(html), "a way back to the plan")
  for (const path of ["/js/arcade/main.js", "/js/arcade/track.js", "/js/arcade/physics.js", "/js/arcade/ai.js", "/js/arcade/race.js", "/js/arcade/render.js", "/js/arcade/hud.js", "/js/arcade/audio.js", "/js/arcade/league.js", "/js/arcade/launch.js", "/css/arcade.css"]) {
    const res = await fetch(`${base}${path}`)
    assert.equal(res.status, 200, path)
    const text = await res.text()
    assert.ok(!new RegExp(["F", "L", "U", "X"].join(""), "i").test(text), `${path} mentions the retired product name`)
    assert.ok(!text.toLowerCase().includes(DEFAULT_PINS.host.toLowerCase()), `${path} shows the PIN`)
  }
})
