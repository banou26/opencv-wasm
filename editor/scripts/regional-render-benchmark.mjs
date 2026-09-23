import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { movieFile } from './generation-smoke.mjs'

const source = process.argv[2]
if (!source || process.argv.length !== 3) throw new Error('Usage: node scripts/regional-render-benchmark.mjs <source.mp4>')
await access(source)
const output = resolve(process.env.BENCH_OUTPUT ?? 'build-smoke/regional-render')
const workers = Number(process.env.BENCH_WORKERS ?? 0), expectedHash = process.env.EXPECTED_HASH
const displayMaxSide = process.env.BENCH_DISPLAY_MAX_SIDE === undefined ? undefined : Number(process.env.BENCH_DISPLAY_MAX_SIDE)
const proximityWeight = process.env.BENCH_PROXIMITY_WEIGHT === undefined ? undefined : Number(process.env.BENCH_PROXIMITY_WEIGHT)
const view = process.env.BENCH_VIEW ?? 'review'
const expectedWidth = process.env.EXPECTED_WIDTH === undefined ? undefined : Number(process.env.EXPECTED_WIDTH)
const expectedHeight = process.env.EXPECTED_HEIGHT === undefined ? undefined : Number(process.env.EXPECTED_HEIGHT)
assert.ok([0, 1, 2, 4, 8, 16].includes(workers), 'BENCH_WORKERS must be 0 (Auto), 1, 2, 4, 8 or 16')
if (expectedHash) assert.match(expectedHash, /^[a-f\d]{64}$/i, 'EXPECTED_HASH must be a decoded-video SHA256')
if (displayMaxSide !== undefined) assert.ok(Number.isSafeInteger(displayMaxSide) && displayMaxSide >= 0, 'BENCH_DISPLAY_MAX_SIDE must be a non-negative whole number')
if (proximityWeight !== undefined) assert.ok(Number.isFinite(proximityWeight) && proximityWeight >= 0 && proximityWeight <= 4, 'BENCH_PROXIMITY_WEIGHT must be between 0 and 4')
assert.ok(['review', 'conflicts'].includes(view), 'BENCH_VIEW must be review or conflicts')
for (const size of [expectedWidth, expectedHeight]) if (size !== undefined) assert.ok(Number.isSafeInteger(size) && size > 0, 'Expected image dimensions must be positive whole numbers')
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms))
const freePort = () => new Promise(resolvePort => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) })
})
const reachable = async target => {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(target)).ok) return } catch {} await pause(100) }
  throw new Error(`Timed out: ${target}`)
}
const children = [], errors = []
let browser, page, profile
try {
  await mkdir(dirname(output), { recursive: true })
  let url = process.env.APP_URL
  if (!url) {
    const port = await freePort(); url = `http://127.0.0.1:${port}`
    children.push(spawn('node_modules/.bin/vp', ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' }))
  }
  await reachable(new URL('/editor/', url))
  const port = await freePort(), cdp = `http://127.0.0.1:${port}`
  profile = await mkdtemp(`${tmpdir()}/cadence-regional-benchmark-`)
  children.push(spawn(process.env.CHROME_BIN || 'google-chrome-stable', [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run',
    '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank',
  ], { stdio: 'ignore' }))
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  page = await browser.contexts()[0].newPage()
  await page.setViewportSize({ width: 1600, height: 1100 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('/editor/', url).href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  const change = async action => {
    const previous = Number(await page.getByTestId('engine-status').getAttribute('data-request'))
    await action()
    await page.waitForFunction(before => {
      const status = document.querySelector('[data-testid=engine-status]')
      return document.querySelector('[role=alert]') || status?.getAttribute('data-state') === 'idle'
        && Number(status.getAttribute('data-request')) > before
    }, previous, { timeout: 180000 })
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  }
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(source))
  await page.getByLabel('Prefab library').selectOption('regionalLayers')
  const opened = performance.now()
  await change(() => page.getByRole('button', { name: 'Open', exact: true }).click())
  const analysisMs = performance.now() - opened
  const proximityControl = page.getByLabel('Motion-History Grouping Proximity weight', { exact: true })
  if (proximityWeight !== undefined && Number(await proximityControl.inputValue()) !== proximityWeight) {
    await change(() => proximityControl.fill(String(proximityWeight)))
  }
  const proximity = Number(await proximityControl.inputValue())
  const displayControl = page.getByLabel('Inspect Regional Review Display max side', { exact: true })
  if (displayMaxSide !== undefined && Number(await displayControl.inputValue()) !== displayMaxSide) {
    assert.ok(displayMaxSide <= Number(await displayControl.getAttribute('max')), 'BENCH_DISPLAY_MAX_SIDE exceeds the editor limit')
    await change(() => displayControl.fill(String(displayMaxSide)))
  }
  const display = Number(await displayControl.inputValue())
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Regional Review' }).click())
  if (view !== 'review') await change(() => page.getByLabel('Inspect Regional Review View', { exact: true }).selectOption(view))
  const analysis = Number(await page.getByLabel('Scene Range Analysis max side', { exact: true }).inputValue())
  const cache = await page.getByTestId('engine-status').innerText()
  const sourceInfo = await page.locator('.clip-info').innerText()
  const dimensions = (await page.locator('.view-options code').innerText()).match(/^(\d+)\s*\u00d7\s*(\d+)$/)
  assert.ok(dimensions, 'Regional output must have known image dimensions')
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const summary = await page.locator('.value-preview pre').innerText()
  assert.match(summary, view === 'review' ? /\d+ original regions -> \d+ motion families/ : /Conflict page 0: \d+\/\d+ raw-veto pairs/)
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  const availableLast = Number(await page.getByLabel('Render last frame').inputValue())
  const last = Number(process.env.BENCH_LAST ?? availableLast)
  assert.ok(Number.isSafeInteger(last) && last >= 0 && last <= availableLast, 'BENCH_LAST must be a whole frame index within the clip')
  await page.getByLabel('Render first frame').fill('0')
  await page.getByLabel('Render last frame').fill(String(last))
  await page.getByLabel('Render fps').selectOption('60')
  await page.getByLabel('Render quality').selectOption('high')
  await page.getByLabel('Render workers').selectOption(String(workers))
  const total = Number((await page.locator('.render-note').innerText()).match(/^(\d+) output frames/)?.[1])
  assert.ok(total > 0, 'Render controls must resolve a positive frame count')
  console.log(JSON.stringify({ analysisMs, analysisMaxSide: analysis, displayMaxSide: display, proximityWeight: proximity, view, cache, sourceInfo, workers, total }))
  const started = performance.now(), milestones = []
  await page.getByRole('button', { name: 'Render video', exact: false }).click()
  let previous = '', finished = false
  while (performance.now() - started < 180000) {
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
    const progress = await page.locator('.render-action').innerText()
    if (progress !== previous) {
      const milestone = { ms: performance.now() - started, progress }
      milestones.push(milestone); console.log(JSON.stringify(milestone)); previous = progress
    }
    if (await page.locator('.movie-caption').count() && !progress.includes('Stop and keep')) { finished = true; break }
    await pause(250)
  }
  assert.ok(finished, 'Regional render exceeded 180 seconds')
  const renderWallMs = performance.now() - started, caption = await page.locator('.movie-caption').innerText()
  const details = caption.match(/([\d.]+) s to render\s*\u00b7\s*(\d+) compute worker/)
  assert.ok(details, 'Render must report elapsed time and actual worker count')
  if (workers === 0) assert.equal(Number(details[2]), 1, 'Auto must reuse the regional scene cache instead of opening extra workers')
  const video = await movieFile(page, `${output}.mp4`)
  assert.equal(Number(video.nb_read_frames), total, 'All requested output frames must be encoded')
  assert.deepEqual([video.width, video.height], dimensions.slice(1).map(Number), 'Encoded dimensions must match the inspected output')
  if (expectedWidth !== undefined) assert.equal(video.width, expectedWidth, 'Encoded width must match the requested benchmark expectation')
  if (expectedHeight !== undefined) assert.equal(video.height, expectedHeight, 'Encoded height must match the requested benchmark expectation')
  assert.equal(video.r_frame_rate, '60/1', 'Encoded output must be 60 fps')
  const hash = execFileSync('ffmpeg', ['-v', 'error', '-i', `${output}.mp4`, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim().replace(/^SHA256=/, '')
  assert.match(hash, /^[a-f\d]{64}$/)
  if (expectedHash) assert.equal(hash, expectedHash.toLowerCase(), 'Decoded pixels must match the reference render')
  await page.waitForFunction(() => document.querySelector('.frame-player')?.getAttribute('data-ready') === 'true')
  await page.locator('.frame-player').screenshot({ path: `${output}.png` })
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  assert.deepEqual(errors, [], 'Browser must not report errors')
  const report = {
    status: 'passed', source: resolve(source), sourceInfo, analysisMs, analysisMaxSide: analysis, displayMaxSide: display, proximityWeight: proximity, view, cache, last, fps: 60, quality: 'high',
    requestedWorkers: workers, actualWorkers: Number(details[2]), renderMs: Number(details[1]) * 1000, renderWallMs,
    total, width: video.width, height: video.height, summary, hash, ...(expectedHash ? { expectedHash } : {}), milestones, errors,
  }
  await writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`PASS: ${total} frames in ${details[1]} s after ${(analysisMs / 1000).toFixed(2)} s scene analysis; SHA256 ${hash}`)
} finally {
  await Promise.race([page?.close().catch(() => {}), pause(2000)])
  await Promise.race([browser?.close().catch(() => {}), pause(2000)])
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGTERM'); await Promise.race([exited, pause(3000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
