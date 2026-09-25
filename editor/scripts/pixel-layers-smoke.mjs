import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

// Runs the Pixel layers prefab in the owner's Chrome inside a nested headless weston: real GPU and
// decoder, no window on the owner's session. WESTON_BIN must point at a weston binary.
const clip = process.env.PIXEL_CLIP ?? '/home/banou/dev/cadence/test/media/5dcf6038-bf63-488a-9ded-3b50893bcd10-market-pan.mp4'
const output = resolve(process.env.PIXEL_OUTPUT ?? '../../cadence/test/out/layers-market-pan/diagnostics')
const prefix = process.env.PIXEL_PREFIX ?? 'pixel-market-browser'
const frames = (process.env.PIXEL_FRAMES ?? '40,98,104').split(',').map(Number)
const url = process.env.APP_URL ?? 'http://127.0.0.1:4560', errors = []
assert.match(prefix, /^[a-z0-9-]+$/)
assert((await stat(output)).isDirectory(), 'Reuse an existing results directory')
const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`, socket = `wayland-pixel-smoke-${process.pid}`
assert.notEqual(socket, process.env.WAYLAND_DISPLAY, 'Never attach to the owner\'s compositor')
const pause = ms => new Promise(done => setTimeout(done, ms))
const reachable = async target => { for (let i = 0; i < 300; i++) { try { if ((await fetch(target)).ok) return } catch {} await pause(100) } throw new Error(`Timed out: ${target}`) }
const freePort = () => new Promise(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) }) })
let browser, compositor, chrome, profile
try {
  await reachable(new URL('/editor/', url))
  compositor = spawn(process.env.WESTON_BIN ?? 'weston', ['--backend=headless', '--renderer=gl', `--socket=${socket}`, '--width=1600', '--height=1100', '--idle-time=0'], { stdio: 'ignore', env: { ...process.env, XDG_RUNTIME_DIR: runtime } })
  for (let i = 0; i < 100 && !existsSync(`${runtime}/${socket}`); i++) await pause(100)
  assert(existsSync(`${runtime}/${socket}`), 'Nested weston did not start')
  const port = await freePort(), cdp = `http://127.0.0.1:${port}`
  profile = await mkdtemp(`${tmpdir()}/cadence-pixel-smoke-`)
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, WAYLAND_DISPLAY: socket, NIXOS_OZONE_WL: '1', XDG_SESSION_TYPE: 'wayland', XDG_RUNTIME_DIR: runtime } })
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  const page = await browser.contexts()[0].newPage()
  await page.setViewportSize({ width: 1600, height: 1100 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  // Worker timings arrive on the context, not the page.
  const launched = performance.now()
  browser.contexts()[0].on('console', message => { if (message.text().startsWith('[pixel]')) console.log(`${((performance.now() - launched) / 1000).toFixed(1)} s ${message.text()}`) })
  await page.goto(new URL('/editor/', url).href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  const change = async (action, timeout = 180000) => {
    const before = Number(await page.getByTestId('engine-status').getAttribute('data-request'))
    await action()
    await page.waitForFunction(before => {
      const status = document.querySelector('[data-testid=engine-status]')
      return document.querySelector('[role=alert]') || status?.getAttribute('data-state') === 'idle' && Number(status.getAttribute('data-request')) > before
    }, before, { timeout })
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  }
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(clip))
  await page.getByLabel('Prefab library').selectOption('pixelLayers')
  const opened = performance.now()
  await change(() => page.getByRole('button', { name: 'Open', exact: true }).click(), 1800000)
  const analysisMs = performance.now() - opened
  console.log(`Pixel layers analysis in the browser: ${(analysisMs / 1000).toFixed(1)} s`)
  const records = []
  for (const frame of frames) {
    const started = performance.now()
    await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)), 900000)
    const frameMs = performance.now() - started
    await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Pixel Layers' }).last().click())
    await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
    const summary = await page.locator('.value-preview pre').innerText()
    assert.match(summary, /Silhouettes: \d+ components/)
    assert.match(summary, /Layer \d+: drawing \d+ of \d+/)
    assert.match(summary, /Rebuilt from \d+ held drawings?, each assembled over its hold/)
    for (const port of ['changes', 'ink', 'layer', 'plate', 'rebuilt', 'residual', 'drawings']) {
      await change(() => page.getByLabel('Output socket').selectOption(`out:frame:${port}`))
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      const png = await page.locator('.image-viewport canvas').screenshot()
      const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 64 * 1024 ** 2 })
      let min = 255, max = 0
      for (const byte of pixels) { min = Math.min(min, byte); max = Math.max(max, byte) }
      assert(max - min > 50, `${port} at ${frame}: blank preview`)
      await writeFile(resolve(output, `${prefix}-${String(frame).padStart(3, '0')}-${port}.png`), png)
    }
    records.push({ frame, frameMs, summary })
    console.log(`frame ${frame} (${(frameMs / 1000).toFixed(1)} s)\n${summary}`)
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, `${prefix}.json`), `${JSON.stringify({ clip, analysisMs, records }, null, 2)}\n`)
} finally {
  await browser?.close().catch(() => {})
  const exited = chrome && chrome.exitCode === null ? once(chrome, 'exit') : undefined
  chrome?.kill('SIGTERM')
  await Promise.race([exited, pause(10000)])
  compositor?.kill('SIGTERM')
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
