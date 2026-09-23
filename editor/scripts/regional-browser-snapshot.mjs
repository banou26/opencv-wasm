import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

// Run from editor/ with Vite active. REGIONAL_CLIP and SNAPSHOT_OUTPUT override the saved-market defaults.
const clip = resolve(process.env.REGIONAL_CLIP ?? '../../cadence/test/media/5dcf6038-bf63-488a-9ded-3b50893bcd10-market-pan.mp4')
const output = resolve(process.env.SNAPSHOT_OUTPUT ?? '../../cadence/test/out/layers-market-pan/diagnostics/regional-market-editor.json')
const url = process.env.APP_URL ?? 'http://127.0.0.1:4560', errors = []
const pause = ms => new Promise(done => setTimeout(done, ms))
const freePort = () => new Promise(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) }) })
const reachable = async url => { for (let i = 0; i < 150; i++) { try { if ((await fetch(url)).ok) return } catch {} await pause(100) } throw new Error(`Timed out: ${url}`) }
let child, browser, page, profile
try {
  await reachable(new URL('/editor/', url))
  const port = await freePort(), cdp = `http://127.0.0.1:${port}`
  profile = await mkdtemp(`${tmpdir()}/cadence-regional-snapshot-`)
  child = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' })
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp); page = await browser.contexts()[0].newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(new URL('/editor/', url).href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'snapshot-source'; document.body.append(input) })
  await page.locator('#snapshot-source').setInputFiles(clip)
  const snapshot = await page.evaluate(async () => {
    const { captureRegionalSnapshot } = await import('/editor/scripts/regional-snapshot-entry.ts')
    return captureRegionalSnapshot(document.querySelector('#snapshot-source').files[0])
  })
  assert.deepEqual(errors, [])
  assert.equal(snapshot.source.sha256, createHash('sha256').update(await readFile(clip)).digest('hex'))
  assert.equal(snapshot.grids.length, snapshot.source.frameCount - 1)
  assert.equal(snapshot.analysis.frameHashes.length, snapshot.source.frameCount)
  const coreManifest = JSON.parse(await readFile(resolve('vendor/cadence-regional/source-manifest.json'), 'utf8'))
  await writeFile(output, `${JSON.stringify({ ...snapshot, source: { ...snapshot.source, path: clip }, coreManifest }, null, 2)}\n`)
  console.log(JSON.stringify({ output, source: snapshot.source, analysis: { ...snapshot.analysis, frameHashes: snapshot.analysis.frameHashes.length }, timings: snapshot.timings, groups: snapshot.tracks.groups.length, families: snapshot.families.families.length }))
} finally {
  await Promise.race([page?.close().catch(() => {}), pause(2000)])
  await Promise.race([browser?.close().catch(() => {}), pause(2000)])
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exited, pause(3000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
