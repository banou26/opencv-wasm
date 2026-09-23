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
assert.ok([0, 1, 2, 4, 8, 16].includes(workers), 'BENCH_WORKERS must be 0 (Auto), 1, 2, 4, 8 or 16')
if (expectedHash) assert.match(expectedHash, /^[a-f\d]{64}$/i, 'EXPECTED_HASH must be a decoded-video SHA256')
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
  const analysisMs = performance.now() - opened, cache = await page.getByTestId('engine-status').innerText()
  const sourceInfo = await page.locator('.clip-info').innerText()
  const dimensions = (await page.locator('.view-options code').innerText()).match(/^(\d+)\s*\u00d7\s*(\d+)$/)
  assert.ok(dimensions, 'Regional output must have known image dimensions')
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
  console.log(JSON.stringify({ analysisMs, cache, sourceInfo, workers, total }))
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
  assert.equal(video.r_frame_rate, '60/1', 'Encoded output must be 60 fps')
  const hash = execFileSync('ffmpeg', ['-v', 'error', '-i', `${output}.mp4`, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim().replace(/^SHA256=/, '')
  assert.match(hash, /^[a-f\d]{64}$/)
  if (expectedHash) assert.equal(hash, expectedHash.toLowerCase(), 'Decoded pixels must match the reference render')
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  assert.deepEqual(errors, [], 'Browser must not report errors')
  const report = {
    status: 'passed', source: resolve(source), sourceInfo, analysisMs, cache, last, fps: 60, quality: 'high',
    requestedWorkers: workers, actualWorkers: Number(details[2]), renderMs: Number(details[1]) * 1000, renderWallMs,
    total, width: video.width, height: video.height, hash, ...(expectedHash ? { expectedHash } : {}), milestones, errors,
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
