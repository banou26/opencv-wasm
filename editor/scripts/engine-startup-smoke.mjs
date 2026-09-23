import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { makeFixture } from './fixture.mjs'

const directory = resolve('build-smoke'), url = new URL('/editor/', process.env.APP_URL ?? 'http://127.0.0.1:4560').href
const chunkPattern = /\/runtime\/opencv-[a-f0-9]+-0\.bin(?:\?|$)/
const pause = ms => new Promise(done => setTimeout(done, ms))
const freePort = () => new Promise(done => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) })
})
const reachable = async target => {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(target)).ok) return } catch {}
    await pause(100)
  }
  throw new Error(`Timed out: ${target}`)
}
let browser, context, child, profile, page, releaseChunk
const results = [], pageErrors = []
try {
  await mkdir(directory, { recursive: true })
  const fixture = await makeFixture(directory)
  await reachable(url)
  let cdp = process.env.CDP_URL
  if (!cdp) {
    const port = await freePort()
    cdp = `http://127.0.0.1:${port}`
    profile = await mkdtemp(`${tmpdir()}/opencv-startup-smoke-`)
    child = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [
      `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run',
      '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank',
    ], { stdio: 'ignore' })
  }
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  context = browser.contexts()[0]
  page = await context.newPage()
  await page.setViewportSize({ width: 1600, height: 1100 })
  page.on('pageerror', error => pageErrors.push(error.message))

  // Context routing covers the dedicated processing worker, not just the page.
  for (const failure of ['short', 'html']) {
    let attempts = 0
    await context.route(chunkPattern, async route => {
      if (++attempts === 1) await route.fulfill({ status: 200,
        contentType: failure === 'html' ? 'text/html' : 'application/octet-stream',
        body: failure === 'html' ? '<!doctype html><title>Wrong asset</title>' : Buffer.alloc(16),
      })
      else await route.continue()
    })
    await page.goto(url)
    await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
    assert.equal(attempts, 2, `${failure} asset response must be retried exactly once`)
    const engineAlerts = await page.getByRole('alert').filter({ hasText: 'Engine error' }).allTextContents()
    assert.deepEqual(engineAlerts, [])
    results.push({ scenario: `transient-${failure}`, attempts, ready: true })
    await context.unroute(chunkPattern)
    console.log(`PASS: transient ${failure} WASM chunk retries and engine becomes ready`)
  }

  let attempts = 0
  const chunkGate = new Promise(done => { releaseChunk = done })
  await context.route(chunkPattern, async route => {
    attempts++
    if (attempts === 1) await chunkGate
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(16) })
  })
  await page.goto(url)
  const input = page.locator('input[type=file][accept*="video"]').first()
  await input.setInputFiles(fixture.video)
  await page.getByText('Indexing clip', { exact: false }).waitFor()
  assert.equal(await page.getByTestId('engine-status').getAttribute('data-state'), 'load')
  releaseChunk()
  await page.getByRole('alert').filter({ hasText: 'Incomplete OpenCV download' }).waitFor({ timeout: 90000 })
  const error = await page.getByRole('alert').innerText()
  assert.match(error, /expected \d+ bytes, received 16/)
  assert.equal(attempts, 2, 'Persistent corruption must stop after one retry')
  const stopped = async () => {
    await page.getByText('Engine unavailable', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('engine-status').getAttribute('data-state'), 'idle')
    assert.equal(await page.getByText('Indexing clip', { exact: false }).count(), 0)
    assert.equal(await page.locator('.empty-preview .eyebrow').innerText(), 'ENGINE UNAVAILABLE')
    assert.equal(await page.getByLabel('Source frame', { exact: true }).isDisabled(), true)
  }
  await stopped()
  await input.setInputFiles(fixture.video)
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await stopped()
  assert.equal(attempts, 2, 'Selecting another clip cannot restart the failed worker')
  await page.screenshot({ path: resolve(directory, 'engine-startup-failure.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: resolve(directory, 'engine-startup-failure-mobile.png') })
  await page.setViewportSize({ width: 1600, height: 1100 })
  results.push({ scenario: 'persistent-short', attempts, queuedClipCleared: true, laterImportBlocked: true, error })
  console.log('PASS: failed engine clears a queued clip; another import does not restart indexing')

  await context.unroute(chunkPattern)
  await page.getByRole('button', { name: 'Reload engine', exact: true }).click()
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  await page.locator('input[type=file][accept*="video"]').first().setInputFiles(fixture.video)
  await page.waitForFunction(() => {
    const footer = document.querySelector('[data-testid=engine-status]')
    return footer?.getAttribute('data-state') === 'idle' && Number(footer.getAttribute('data-request')) > 0
      && document.querySelector('.clip-info strong')?.textContent === 'fixture.mp4'
  }, null, { timeout: 30000 })
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  assert.match(await page.locator('.clip-info').innerText(), /192.*128.*32 frames/s)
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-computed-frame'), '0')
  assert.equal(await page.getByText('Indexing clip', { exact: false }).count(), 0)
  assert.deepEqual(pageErrors, [])
  await page.screenshot({ path: resolve(directory, 'engine-startup-recovered.png') })
  results.push({ scenario: 'reload-recovery', ready: true, importedFrames: fixture.count, computedFrame: 0 })
  await writeFile(resolve(directory, 'engine-startup-smoke.json'), JSON.stringify({ passed: true, url, results, pageErrors }, null, 2) + '\n')
  console.log('PASS: Reload engine recovers and the actual fixture imports and renders successfully')
} finally {
  releaseChunk?.()
  if (context) await context.unroute(chunkPattern).catch(() => {})
  if (page && !page.isClosed()) await page.close().catch(() => {})
  if (browser) {
    if (profile) {
      const session = await browser.newBrowserCDPSession().catch(() => undefined)
      await session?.send('Browser.close').catch(() => {})
    }
    await browser.close().catch(() => {})
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000)
    await exited
    clearTimeout(kill)
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
