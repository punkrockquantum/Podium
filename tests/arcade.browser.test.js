/**
 * The arcade in a real (headless) Chrome: /arcade.html loads at projector sizes with zero JavaScript
 * errors, a car is picked, the lights go out, arrow keys drive the car (speed > 0, position and lap
 * text on the HUD, the pit-wall assist on), the race is finished through the test hook, the name is
 * entered and the league shows the entry. The hand-off from the planning tool (sessionStorage and
 * URL fallbacks) and the standalone league page are checked too.
 * Set ARCADE_SHOTS=/some/dir to save the walkthrough screenshots. Skipped when Chrome is missing.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../server.mjs"
import { findChrome, launchChrome } from "./helpers/chrome.js"

const chromeBinary = findChrome()
const skip = chromeBinary ? false : "Chrome is not installed (set PODIUM_CHROME)"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SHOTS = process.env.ARCADE_SHOTS || ""

let server
let base
let dir
let app
let chrome

before(async () => {
  if (skip) return
  dir = await mkdtemp(join(tmpdir(), "podium-arcade-browser-"))
  app = createApp({ dataDir: dir, env: {} })
  server = createServer(app.handle)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  chrome = await launchChrome({ width: 1440, height: 900 })
})

after(async () => {
  if (skip) return
  await chrome?.close()
  app?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (dir) await rm(dir, { recursive: true, force: true })
})

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent || ""`)
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot(join(SHOTS, `${name}.png`))
}
const visible = (page, selector) => page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight })()`)

async function openArcade(page, path = "/arcade.html?test=1") {
  await page.goto(`${base}${path}`)
  await page.waitFor(`document.body.classList.contains("ready")`, 10_000, "the arcade to boot")
}

test("the arcade loads at 1440×900 and 1024×768 with zero JavaScript errors, three cars and a visible Race now", { skip, timeout: 60_000 }, async () => {
  for (const [w, h] of [[1440, 900], [1024, 768]]) {
    /* The helper sizes every page at launch: the projector size gets its own Chrome. */
    const browser = w === 1440 ? chrome : await launchChrome({ width: w, height: h })
    const page = await browser.page()
    await openArcade(page)
    assert.deepEqual([await page.evaluate("innerWidth"), await page.evaluate("innerHeight")], [w, h])
    assert.deepEqual(page.errors, [], `no JS errors at ${w}×${h}`)
    assert.equal(await page.evaluate(`document.querySelectorAll(".car-card").length`), 3, "three built-in cars")
    assert.match(await text(page, "h1"), /RACE THE PLAN/)
    assert.ok(await visible(page, "#race-now"), `Race now is on screen at ${w}×${h}`)
    assert.equal(await page.evaluate(`document.querySelector("#race-now").disabled`), false, "a car is pre-selected")
    assert.equal(await page.evaluate(`document.querySelector("#handed-note").hidden`), true, "nothing handed over: no hand-off note")
    const labels = await page.evaluate(`[...document.querySelectorAll(".car-card .name")].map((n) => n.textContent)`)
    assert.deepEqual(labels, ["Today: Hinwil on-prem", "Digital Realty Zurich 2027", "Digital Realty + HPE GreenLake 2028"])
    assert.match(await text(page, ".controls"), /accelerate/)
    assert.match(await text(page, ".controls"), /overtake boost/)
    const html = await page.evaluate(`document.documentElement.outerHTML`)
    assert.ok(!/undefined|NaN/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), "no undefined/NaN on the pick screen")
    await page.close()
    if (browser !== chrome) await browser.close()
  }
})

test("pick the 2028 car, lights, arrow keys drive it, the HUD reads speed, position and lap, finish → name → league", { skip, timeout: 90_000 }, async () => {
  const page = await chrome.page()
  await openArcade(page)
  await shot(page, "arcade-start")
  assert.equal(await page.evaluate(`window.__arcade.pick("gl2028")`), true)
  assert.match(await text(page, "#picked"), /GreenLake 2028 · \+0\.4[23] s\/lap · 99\.98 %/)
  await page.click("#race-now")
  await page.waitFor(`window.__arcade.state === "lights"`, 5000, "the lights")
  await sleep(200)
  assert.ok((await page.evaluate(`document.querySelectorAll("#lights .light.on").length`)) >= 1, "lights coming on")
  assert.equal(await page.evaluate(`document.querySelector("#screen-stage").hidden`), false)
  await shot(page, "arcade-lights")
  await page.waitFor(`window.__arcade.state === "race"`, 10_000, "lights out")
  assert.equal(await page.evaluate(`document.querySelector("#lights").classList.contains("out")`), true, "lights out")
  await page.key("keyDown", "ArrowUp")
  await sleep(1500)
  await page.key("keyDown", "ArrowRight")
  await sleep(250)
  await page.key("keyUp", "ArrowRight")
  await sleep(600)
  await page.key("keyDown", "ArrowLeft")
  await sleep(250)
  await page.key("keyUp", "ArrowLeft")
  await page.key("keyDown", "Space")
  await sleep(80)
  await page.key("keyUp", "Space")
  await sleep(1200)
  const hud = await page.evaluate(`window.__arcade.hudText()`)
  const speed = Number(hud.speed)
  assert.ok(speed > 0, `the car moves (${hud.speed} km/h)`)
  assert.match(hud.pos, /^P([1-9]|10)$/)
  assert.match(hud.lap, /^LAP 1\/3$/)
  assert.match(hud.current, /^0:0[0-9]\.\d{3}$/, "the lap clock runs")
  assert.match(hud.assist, /^PIT WALL 4\.84s$/, "the assist shows the data loop")
  assert.match(hud.aero, /^AERO \+12\.[89]%$/)
  assert.ok(await page.evaluate(`window.__arcade.race.player.boostsUsed`) >= 1, "space fired the boost")
  assert.ok((await page.evaluate(`window.__arcade.race.player.s`)) > 0.005, "the car has moved down the road")
  const fps = await page.evaluate(`new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n += 1; if (performance.now() - t0 >= 1000) res(n); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })`)
  assert.ok(fps >= 30, `the loop keeps up (${fps} frames in a second)`)
  await page.key("keyUp", "ArrowUp")
  await shot(page, "arcade-race")
  assert.deepEqual(page.errors, [], "no JS errors while racing")

  assert.equal(await page.evaluate(`window.__arcade.debugFinish(58123)`), true)
  await page.waitFor(`window.__arcade.state === "name"`, 10_000, "the results screen")
  await sleep(150)
  assert.match(await text(page, "#results-title"), /YOU WIN!|PODIUM|FINISHED/)
  assert.equal(await page.evaluate(`document.querySelectorAll("#results-body tr").length`), 10, "ten classified cars")
  assert.match(await text(page, "#results-body tr.mine"), /GreenLake 2028 \(YOU\)/)
  assert.match(await text(page, "#recap-headline"), /\+0\.4[23] s\/lap from the plan: aero, pit wall, reliability/)
  assert.match(await text(page, "#recap-lines"), /Computation.*Connectivity.*Reliability/s)
  await shot(page, "arcade-results")
  await page.type("#name", "   ")
  await page.click("#save-lap")
  await sleep(100)
  assert.match(await text(page, "#name-error"), /1 to 24 characters/, "a blank name is refused on the client")
  await page.type("#name", "Ana")
  await page.click("#save-lap")
  await page.waitFor(`window.__arcade.state === "league" && document.querySelectorAll("#league-body tr").length > 0`, 10_000, "the league")
  await sleep(150)
  assert.match(await text(page, "#league-status"), /Ana: rank 1 of 1 with 0:58\.123/)
  const mine = await text(page, "#league-body tr.mine")
  assert.match(mine, /^1Ana0:58\.123Digital Realty \+ HPE GreenLake 2028 · 2028\+0\.4[23] s/)
  await shot(page, "arcade-league")
  const saved = await (await fetch(`${base}/api/league`)).json()
  assert.equal(saved.total, 1)
  assert.deepEqual([saved.rows[0].name, saved.rows[0].bestLapMs, saved.rows[0].season, saved.rows[0].finishPos], ["Ana", 58123, 2028, 1])
  assert.deepEqual(page.errors, [], "no JS errors through results and league")
  await page.close()
})

test("the hand-off: a car in sessionStorage is shown first and pre-selected; URL fallbacks work; #league opens the table", { skip, timeout: 60_000 }, async () => {
  const page = await chrome.page()
  await openArcade(page)
  await page.evaluate(`sessionStorage.setItem("podium.arcade.car", JSON.stringify({ season: 2028, label: "My plan: Zurich 2028", secondsPerLapVsToday: 0.31, effectiveMauh: 6.9, allowanceUsedPct: 95, availabilityPct: 99.97, dataToDecisionS: 4.9, location: "Digital Realty Zurich" }))`)
  await openArcade(page)
  assert.equal(await page.evaluate(`document.querySelectorAll(".car-card").length`), 4, "the handed-over car plus the three built-ins")
  assert.equal(await page.evaluate(`document.querySelector(".car-card.selected")?.dataset.id`), "handed")
  assert.match(await text(page, ".car-card.handed .name"), /My plan: Zurich 2028/)
  assert.match(await text(page, ".car-card.handed"), /\+0\.31 s\/lap/)
  assert.match(await text(page, ".car-card.handed"), /\+9\.3 %/, "aero from the plan's seconds")
  assert.equal(await page.evaluate(`document.querySelector("#handed-note").hidden`), false)
  await page.click("#forget-car")
  await sleep(100)
  assert.equal(await page.evaluate(`document.querySelectorAll(".car-card").length`), 3, "forgetting the car brings the plain picker back")
  assert.equal(await page.evaluate(`sessionStorage.getItem("podium.arcade.car")`), null)

  await page.goto("about:blank")
  await openArcade(page, "/arcade.html?test=1&season=2027&adv=0.14&avail=99.9&loop=4.8&label=Zurich%202027%20from%20the%20URL")
  assert.match(await text(page, ".car-card.selected .name"), /Zurich 2027 from the URL/)
  assert.match(await text(page, "#picked"), /\+0\.14 s\/lap · 99\.9 %/)

  await page.goto("about:blank")
  await page.goto(`${base}/arcade.html?test=1&x=1#league`)
  await page.waitFor(`window.__arcade && window.__arcade.state === "league"`, 10_000, "the standalone league")
  await sleep(150)
  assert.equal(await page.evaluate(`document.querySelector("#screen-league").hidden`), false)
  assert.ok((await page.evaluate(`document.querySelectorAll("#league-body tr").length`)) >= 1, "the table lists laps")
  assert.deepEqual(page.errors, [], "no JS errors on the hand-off paths")
  await page.close()
})
