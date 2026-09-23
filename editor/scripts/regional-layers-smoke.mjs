import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { assertViewport } from './layout-smoke.mjs'

const directory = resolve('build-smoke')
const url = process.env.APP_URL ?? 'http://127.0.0.1:4560'
const clip = process.env.REGIONAL_CLIP ?? '/home/banou/dev/cadence/test/out/layers-market-pan/original/original.mp4'
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms))
const freePort = () => new Promise(resolvePort => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolvePort(port))
  })
})
const reachable = async target => {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(target)).ok) return } catch {}
    await pause(100)
  }
  throw new Error(`Timed out: ${target}`)
}
let browser, child, profile, page
const errors = []
try {
  await mkdir(directory, { recursive: true })
  await reachable(new URL('/editor/', url))
  let cdp = process.env.CDP_URL
  if (!cdp) {
    const port = await freePort()
    cdp = `http://127.0.0.1:${port}`
    profile = await mkdtemp(`${tmpdir()}/cadence-regional-smoke-`)
    child = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [
      `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run',
      '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank',
    ], { stdio: 'ignore' })
  }
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  page = await browser.contexts()[0].newPage()
  await page.setViewportSize({ width: 1600, height: 1100 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('/editor/', url).href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  const footer = page.getByTestId('engine-status')
  const change = async action => {
    const before = Number(await footer.getAttribute('data-request'))
    await action()
    await page.waitForFunction(previous => {
      const status = document.querySelector('[data-testid=engine-status]')
      return document.querySelector('[role=alert]') || status?.getAttribute('data-state') === 'idle'
        && Number(status.getAttribute('data-request')) > previous
    }, before, { timeout: 180000 })
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  }
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    window.regionalSmokeFolderName = `regional-smoke-${crypto.randomUUID()}`
    window.regionalSmokeFolder = await root.getDirectoryHandle(window.regionalSmokeFolderName, { create: true })
    window.showDirectoryPicker = async () => window.regionalSmokeFolder
  })
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(clip))
  await page.getByLabel('Prefab library').selectOption('regionalLayers')
  const started = performance.now()
  await change(() => page.getByRole('button', { name: 'Open', exact: true }).click())
  const processingSeconds = (performance.now() - started) / 1000
  await page.getByRole('button', { name: 'Save graph', exact: true }).click()
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid=folder-state]')
    return state?.getAttribute('data-pending') === '0' && state.textContent.includes('Saved')
  })
  const project = await page.evaluate(async () => JSON.parse(await (
    await (await window.regionalSmokeFolder.getFileHandle('opencv-graph.json')).getFile()).text()))
  const stages = project.nodes.map(node => node.type)
  for (const stage of ['sceneRange', 'regionalMotion', 'regionalPool', 'regionalTracks', 'regionalHistory', 'regionalTiming', 'regionalComplete', 'regionalInspect']) {
    assert.ok(stages.includes(stage), `Regional prefab is missing its editable ${stage} stage`)
  }
  assert.deepEqual(await page.getByLabel('Render target').locator('option').evaluateAll(options => options.map(option => option.value)), ['n5', 'ncompletionout'])
  assert.equal(await page.getByLabel('Render target').inputValue(), 'n5', 'The ordinary review must remain the default render output')
  await change(() => page.getByLabel('Source frame', { exact: true }).fill('6'))
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-computed-frame'), '6')
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Regional Review' }).click())
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), 'nreview')
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const summary = await page.locator('.value-preview pre').innerText()
  assert.match(summary, /Source 6 -> 7/)
  assert.match(summary, /\d+\/\d+ supported flow pixels/)
  assert.match(summary, /Group \d+: (?:held|changed|unknown);/)
  assert.match(summary, /\d+ original regions -> \d+ motion families/)
  const last = Number(await page.getByLabel('Render last frame').inputValue())
  await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(last)))
  assert.match(await page.locator('.value-preview pre').innerText(), /final frame, no outgoing pair/)
  await change(() => page.getByLabel('Source frame', { exact: true }).fill('6'))
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  await page.locator('.react-flow__controls-fitview').click()
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Timing Timeline' }).click())
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const timingSummary = await page.locator('.value-preview pre').innerText()
  assert.match(timingSummary, /H held \/ C changed \/ \? unknown/)
  const patterns = [...timingSummary.matchAll(/^G\d+: ([HC?]+)$/gm)].map(match => match[1])
  assert.ok(patterns.length > 0 && patterns.every(pattern => pattern.length === last), 'Every timeline row must cover all source pairs')
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  await page.screenshot({ path: resolve(directory, 'regional-layers-timing.png') })
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Motion Families' }).click())
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const familySummary = await page.locator('.value-preview pre').innerText()
  assert.match(familySummary, /Family \d+: regions \d+/)
  assert.match(familySummary, /analysis px\/pair/)
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: resolve(directory, 'regional-layers-families.png') })
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Velocity Histories' }).click())
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const velocitySummary = await page.locator('.value-preview pre').innerText()
  assert.match(velocitySummary, /dx,dy are analysis pixels per source pair/)
  assert.match(velocitySummary, /F\d+: regions \d+/)
  assert.match(velocitySummary, /6:-?\d+\.\d+,-?\d+\.\d+/)
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: resolve(directory, 'regional-layers-velocities.png') })
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Motion Conflicts' }).click())
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const conflictSummary = await page.locator('.value-preview pre').innerText()
  assert.match(conflictSummary, /Conflict page 0: \d+\/\d+ raw-veto pairs/)
  assert.match(conflictSummary, /Source 6 -> 7/)
  assert.match(conflictSummary, /G\d+\/\d+: families F\d+\/F\d+/)
  assert.match(conflictSummary, /vetoes \d+\/\d+ shared pairs/)
  await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(last)))
  assert.match(await page.locator('.value-preview pre').innerText(), /final frame, no outgoing pair/)
  await change(() => page.getByLabel('Source frame', { exact: true }).fill('6'))
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: resolve(directory, 'regional-layers-conflicts.png') })
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Support Completion' }).click())
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), 'ncompletionview')
  assert.equal(await page.getByLabel('Render target').inputValue(), 'n5', 'Inspector selection must not silently change the explicit render target')
  await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const completionSummary = await page.locator('.value-preview pre').innerText()
  assert.match(completionSummary, /Top: source \/ measured family support\. Bottom: completed support \/ inference distinction\./)
  assert.match(completionSummary, /Source 6 -> 7/)
  assert.match(completionSummary, /Cells: measured \d+; inferred holes \d+; inferred border \d+; blocked \d+; unknown \d+/)
  assert.match(completionSummary, /not measured motion, recovered pixels or a pixel-accurate silhouette/)
  assert.match(completionSummary, /Limits \(fine-grid cells\): holes 6; border 6; competitor clearance 2/)
  await change(async () => {
    const input = page.getByLabel('Support Completion Max hole distance (cells)', { exact: true })
    await input.fill('0'); await input.press('Enter')
  })
  await change(async () => {
    const input = page.getByLabel('Support Completion Max border distance (cells)', { exact: true })
    await input.fill('0'); await input.press('Enter')
  })
  assert.match(await page.locator('.value-preview pre').innerText(), /inferred holes 0; inferred border 0/)
  for (const label of ['Max hole distance (cells)', 'Max border distance (cells)']) {
    await change(async () => {
      const input = page.getByLabel(`Support Completion ${label}`, { exact: true })
      await input.fill('6'); await input.press('Enter')
    })
  }
  assert.equal(await page.locator('.value-preview pre').innerText(), completionSummary)
  await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(last)))
  assert.match(await page.locator('.value-preview pre').innerText(), /final frame, no outgoing pair/)
  assert.match(await page.locator('.value-preview pre').innerText(), /No completion evidence for this frame/)
  await change(() => page.getByLabel('Source frame', { exact: true }).fill('6'))
  await change(() => page.getByLabel('Output socket').selectOption('out:frame:image'))
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: resolve(directory, 'regional-layers-completion.png') })
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Regional Review' }).click())
  const canvas = page.locator('.image-viewport canvas').filter({ visible: true }).first()
  await canvas.waitFor({ state: 'visible' })
  const image = await canvas.screenshot()
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], {
    input: image, maxBuffer: 32 * 1024 ** 2,
  })
  let minimum = 255, maximum = 0, colorful = 0
  for (let i = 0; i < pixels.length; i += 3) {
    minimum = Math.min(minimum, pixels[i], pixels[i + 1], pixels[i + 2])
    maximum = Math.max(maximum, pixels[i], pixels[i + 1], pixels[i + 2])
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 15) colorful++
  }
  assert.ok(maximum - minimum > 60, `Blank or near-blank regional preview: ${minimum}..${maximum}`)
  assert.ok(colorful > 100, `Regional preview lacks visible footage/overlay colors: ${colorful}`)
  await writeFile(resolve(directory, 'regional-layers-frame.png'), image)
  await assertViewport(page, ['.app-header', '.workspace', '.image-viewport', 'footer'])
  await page.screenshot({ path: resolve(directory, 'regional-layers-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Node preview', exact: true }).click()
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await assertViewport(page, ['.app-header', '.source-strip', '.workspace', '.image-viewport', '.render-controls', '.render-action', 'footer'])
  const mobile = await page.evaluate(() => {
    const preview = document.querySelector('.image-viewport').getBoundingClientRect()
    const canvas = document.querySelector('.image-viewport canvas').getBoundingClientRect()
    return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, previewHeight: preview.height, canvasHeight: canvas.height }
  })
  assert.ok(mobile.documentWidth <= mobile.viewportWidth + 1 && mobile.bodyWidth <= mobile.viewportWidth + 1, JSON.stringify(mobile))
  assert.ok(mobile.previewHeight >= 180 && mobile.canvasHeight >= 150, `Mobile preview is too small: ${JSON.stringify(mobile)}`)
  await page.getByRole('button', { name: 'Render video', exact: false }).scrollIntoViewIfNeeded()
  const action = await page.getByRole('button', { name: 'Render video', exact: false }).boundingBox()
  assert.ok(action && action.y >= 0 && action.y + action.height <= 844, 'Mobile render controls must remain reachable by scrolling')
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: resolve(directory, 'regional-layers-mobile.png') })
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  assert.deepEqual(errors, [])
  await writeFile(resolve(directory, 'regional-layers-smoke.json'), JSON.stringify({
    status: 'passed', clip, processingSeconds, stages, summary, timingSummary, familySummary, velocitySummary, conflictSummary, completionSummary, mobile, canvas: { minimum, maximum, colorfulPixels: colorful },
    screenshots: ['regional-layers-desktop.png', 'regional-layers-mobile.png', 'regional-layers-timing.png', 'regional-layers-families.png', 'regional-layers-velocities.png', 'regional-layers-conflicts.png', 'regional-layers-completion.png'],
  }, null, 2) + '\n')
  console.log(`PASS: regional layers prefab processed real footage in ${processingSeconds.toFixed(2)} s; nonblank desktop/mobile previews`)
} finally {
  if (page && !page.isClosed()) {
    await page.evaluate(async () => {
      if (window.regionalSmokeFolderName) await (await navigator.storage.getDirectory()).removeEntry(window.regionalSmokeFolderName, { recursive: true })
    }).catch(() => {})
    await page.close().catch(() => {})
  }
  if (browser) await browser.close().catch(() => {})
  if (child && child.exitCode === null) child.kill('SIGTERM')
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
