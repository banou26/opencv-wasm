import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { captureSupportFlashes } from './vector-character-check.mjs'

const clip = process.env.REGIONAL_CLIP ?? '/home/banou/dev/cadence/test/media/5dcf6038-bf63-488a-9ded-3b50893bcd10-market-pan.mp4'
const output = resolve(process.env.VECTOR_OUTPUT ?? '../../cadence/test/out/layers-market-pan/diagnostics')
const prefix = process.env.VECTOR_PREFIX ?? 'vector-edge'
const frames = (process.env.VECTOR_FRAMES ?? '15,16,17,18,19,20,71,72,73').split(',').map(Number)
assert.match(prefix, /^[a-z0-9-]+$/)
assert((await stat(output)).isDirectory(), 'Reuse an existing results directory')
const url = process.env.APP_URL ?? 'http://127.0.0.1:4560', errors = []
const pause = ms => new Promise(done => setTimeout(done, ms))
const reachable = async target => { for (let i = 0; i < 200; i++) { try { if ((await fetch(target)).ok) return } catch {} await pause(100) } throw new Error(`Timed out: ${target}`) }
const freePort = () => new Promise(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) }) })
let browser, page, child, profile
try {
  await reachable(new URL('/editor/', url))
  const port = await freePort(), cdp = `http://127.0.0.1:${port}`
  profile = await mkdtemp(`${tmpdir()}/cadence-vector-edge-`)
  child = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank'], { stdio: 'ignore' })
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  page = await browser.contexts()[0].newPage()
  await page.setViewportSize({ width: 1600, height: 1100 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('/editor/', url).href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  const change = async action => {
    const before = Number(await page.getByTestId('engine-status').getAttribute('data-request'))
    await action()
    await page.waitForFunction(before => {
      const status = document.querySelector('[data-testid=engine-status]')
      return document.querySelector('[role=alert]') || status?.getAttribute('data-state') === 'idle' && Number(status.getAttribute('data-request')) > before
    }, before, { timeout: 180000 })
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  }
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    window.vectorFolder = await root.getDirectoryHandle('vector-edge-probe', { create: true })
    window.showDirectoryPicker = async () => window.vectorFolder
  })
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(clip))
  await page.getByLabel('Prefab library').selectOption('vectorLayers')
  const started = performance.now()
  await change(() => page.getByRole('button', { name: 'Open', exact: true }).click())
  console.log(`Direct scene analysis: ${(performance.now() - started).toFixed(0)} ms`)
  if (process.env.VECTOR_VERIFY_BORDERS !== undefined) {
    assert(['true', 'false'].includes(process.env.VECTOR_VERIFY_BORDERS), 'VECTOR_VERIFY_BORDERS must be true or false')
    const control = page.getByLabel('Scene Vector Candidates Verify border vectors', { exact: true }), enabled = process.env.VECTOR_VERIFY_BORDERS === 'true'
    if (await control.isChecked() !== enabled) await change(() => control.setChecked(enabled))
  }
  await captureSupportFlashes({ page, change, output, prefix, frames })
  assert.deepEqual(errors, [])
  console.log(`PASS edge probe: ${frames.length} source frames, raw/completed native PNGs; no movie render`)
} finally {
  await Promise.race([page?.close().catch(() => {}), pause(2000)])
  await Promise.race([browser?.close().catch(() => {}), pause(2000)])
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([stopped, pause(3000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
