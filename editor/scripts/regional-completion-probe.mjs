import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const clip = process.env.REGIONAL_CLIP ?? '/home/banou/dev/cadence/test/out/layers-market-pan/original/original.mp4'
const frames = (process.env.PROBE_FRAMES ?? '20,22,28,33,84,88,89,90,91,92,93,94,100').split(',').map(Number)
assert.ok(frames.length > 0 && frames.every(frame => Number.isSafeInteger(frame) && frame >= 0))
const imageFrames = process.env.PROBE_IMAGE_FRAMES === undefined ? frames : process.env.PROBE_IMAGE_FRAMES.split(',').filter(Boolean).map(Number)
assert.ok(imageFrames.every(frame => Number.isSafeInteger(frame) && frame >= 0))
const directory = resolve('build-smoke'), url = process.env.APP_URL ?? 'http://127.0.0.1:4560'
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms))
const freePort = () => new Promise(resolvePort => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) }) })
const reachable = async url => { for (let attempt = 0; attempt < 150; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await pause(100) } throw new Error(`Timed out: ${url}`) }
const hue = id => {
  const x = (id * .61803398875 % 1) * 6, f = x - Math.floor(x), a = Math.round(220 * (1 - f)) + 35, b = Math.round(220 * f) + 35
  return [[255, b, 35], [a, 255, 35], [35, 255, b], [35, a, 255], [b, 35, 255], [255, 35, a]][Math.floor(x) % 6]
}
const provenance = { measured: [150, 150, 165], motion: [180, 116, 244], holes: [240, 178, 72], border: [66, 220, 183], isolated: [240, 106, 170], temporal: [70, 172, 245] }
const decode = png => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 32 * 1024 ** 2 })
const children = [], errors = [], records = []
let browser, page, profile
try {
  await mkdir(directory, { recursive: true })
  await reachable(new URL('/editor/', url))
  const port = await freePort(), cdp = `http://127.0.0.1:${port}`
  profile = await mkdtemp(`${tmpdir()}/cadence-completion-probe-`)
  children.push(spawn(process.env.CHROME_BIN || 'google-chrome-stable', [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank'], { stdio: 'ignore' }))
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  page = await browser.contexts()[0].newPage()
  await page.setViewportSize({ width: 1600, height: 1100 })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(new URL('/editor/', url).href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 90000 })
  const change = async action => {
    const before = Number(await page.getByTestId('engine-status').getAttribute('data-request'))
    await action()
    await page.waitForFunction(before => { const footer = document.querySelector('[data-testid=engine-status]'); return document.querySelector('[role=alert]') || footer?.getAttribute('data-state') === 'idle' && Number(footer.getAttribute('data-request')) > before }, before, { timeout: 180000 })
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  }
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.probeFolder = await root.getDirectoryHandle('completion-probe', { create: true }); window.showDirectoryPicker = async () => window.probeFolder })
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(clip))
  await page.getByLabel('Prefab library').selectOption('regionalLayers')
  await change(() => page.getByRole('button', { name: 'Open', exact: true }).click())
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Support Completion' }).click())
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames', '-of', 'json', clip], { encoding: 'utf8' })).streams[0]
  const [rateN, rateD] = metadata.r_frame_rate.split('/').map(Number), sourceFps = rateN / rateD
  const analysisMaxSide = Number(await page.getByLabel('Scene Range Analysis max side', { exact: true }).inputValue())
  const scale = Math.min(1, analysisMaxSide / Math.max(metadata.width, metadata.height)), analysisWidth = Math.round(metadata.width * scale), analysisHeight = Math.round(metadata.height * scale)
  let exportIndex = 0
  for (const frame of frames) {
    await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)))
    assert.equal(await page.locator('.inspect-panel').getAttribute('data-computed-frame'), String(frame))
    await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
    const summary = await page.locator('.value-preview pre').innerText(), rasters = {}
    let width, height
    for (const key of ['source', 'measured', 'completed', 'provenance']) {
      await change(() => page.getByLabel('Output socket').selectOption(`out:frame:${key}`))
      ;[width, height] = (await page.locator('.view-options code').innerText()).split('×').map(Number)
      const name = `opencv-frame${exportIndex ? `-${exportIndex + 1}` : ''}.png`; exportIndex++
      await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
      await page.waitForFunction(name => document.querySelector('[data-testid=folder-state]')?.textContent.includes(`Saved exports/${name}`), name)
      const data = await page.evaluate(async name => {
        const file = await (await (await window.probeFolder.getDirectoryHandle('exports')).getFileHandle(name)).getFile()
        return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
      }, name)
      rasters[key] = decode(Buffer.from(data.split(',')[1], 'base64'))
      assert.equal(rasters[key].length, width * height * 3)
    }
    const path = imageFrames.includes(frame) ? resolve(directory, `regional-completion-probe-${String(frame).padStart(3, '0')}.png`) : null
    if (path) {
      const mosaic = Buffer.alloc(width * height * 12)
      for (const [panel, raster] of Object.values(rasters).entries()) for (let y = 0; y < height; y++) raster.copy(mosaic, ((y + Math.floor(panel / 2) * height) * width * 2 + panel % 2 * width) * 3, y * width * 3, (y + 1) * width * 3)
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width * 2}x${height * 2}`, '-i', 'pipe:0', '-frames:v', '1', path], { input: mosaic })
    }
    const columns = Math.ceil(analysisWidth / 8), rows = Math.ceil(analysisHeight / 8)
    const familyColors = Object.fromEntries([...summary.matchAll(/^Family (\d+):/gm)].map(match => [match[1], hue(Number(match[1]))]))
    const classify = (raster, pixel, colors) => {
      if ([0, 1, 2].every(c => raster[pixel + c] === rasters.source[pixel + c])) return 'unknown'
      return Object.entries(colors).find(([, color]) => [0, 1, 2].every(c => Math.abs(raster[pixel + c] - Math.round(rasters.source[pixel + c] * .4 + color[c] * .6)) <= 1))?.[0] ?? 'unclassified'
    }
    const cells = Array.from({ length: rows * columns }, (_, cell) => {
      const x = Math.min(analysisWidth - .5, cell % columns * 8 + 4), y = Math.min(analysisHeight - .5, Math.floor(cell / columns) * 8 + 4)
      const pixel = (Math.floor(y * height / analysisHeight) * width + Math.floor(x * width / analysisWidth)) * 3
      return { cell, x: cell % columns, y: Math.floor(cell / columns), measured: classify(rasters.measured, pixel, familyColors), completed: classify(rasters.completed, pixel, familyColors), provenance: classify(rasters.provenance, pixel, provenance) }
    })
    assert.ok(cells.every(cell => [cell.measured, cell.completed, cell.provenance].every(value => value !== 'unclassified')), `Unrecognized diagnostic color at source frame ${frame}`)
    const counts = Object.fromEntries(['measured', 'completed', 'provenance'].map(key => [key, cells.reduce((all, cell) => { all[cell[key]] = (all[cell[key]] ?? 0) + 1; return all }, {})]))
    const record = { sourceFrame: frame, seconds: frame / sourceFps, output60First: Math.ceil(frame * 60 / sourceFps), output60Last: Math.ceil((frame + 1) * 60 / sourceFps) - 1, width, height, columns, rows, summary, counts, cells, path }
    records.push(record)
    console.log(JSON.stringify({ sourceFrame: frame, output60: [record.output60First, record.output60Last], counts }))
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(directory, 'regional-completion-probe.json'), `${JSON.stringify({ clip, metadata, sourceFps, analysisWidth, analysisHeight, description: 'Native editor PNG exports. Sheets: source/measured above completed/provenance. Cells classified from center pixels of known diagnostic colors; unknown means unpainted (blocked or unknown support), not recovered ownership ground truth.', records, errors }, null, 2)}\n`)
} finally {
  await Promise.race([page?.close().catch(() => {}), pause(2000)])
  await Promise.race([browser?.close().catch(() => {}), pause(2000)])
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exited, pause(3000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
