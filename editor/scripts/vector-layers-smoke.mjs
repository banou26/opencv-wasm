import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { movieFile } from './generation-smoke.mjs'
import { assertViewport } from './layout-smoke.mjs'
import { checkCharacterGroups, checkDistantGroups, checkSupportCompletion, checkBorderRefinement } from './vector-character-check.mjs'

const defaultClip = '/home/banou/dev/cadence/test/media/5dcf6038-bf63-488a-9ded-3b50893bcd10-market-pan.mp4'
const clip = process.env.REGIONAL_CLIP ?? defaultClip
const output = resolve(process.env.VECTOR_OUTPUT ?? '../../cadence/test/out/layers-market-pan/diagnostics')
const prefix = process.env.VECTOR_PREFIX ?? 'vector-market'
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
  profile = await mkdtemp(`${tmpdir()}/cadence-vector-smoke-`)
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
    window.vectorFolder = await root.getDirectoryHandle('vector-smoke', { create: true })
    window.showDirectoryPicker = async () => window.vectorFolder
  })
  assert.equal(await page.getByLabel('Render workers').inputValue(), '4')
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(clip))
  for (const value of ['motionVectors', 'regionalLayers', 'vectorLayers']) assert.equal(await page.getByLabel('Prefab library').locator(`option[value="${value}"]`).count(), 1)
  await page.getByLabel('Prefab library').selectOption('vectorLayers')
  const opened = performance.now()
  await change(() => page.getByRole('button', { name: 'Open', exact: true }).click())
  const analysisMs = performance.now() - opened
  console.log(`Direct scene analysis: ${analysisMs.toFixed(0)} ms`)
  await page.getByRole('button', { name: 'Save graph', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid=folder-state]')?.textContent.includes('Saved'))
  const graph = await page.evaluate(async () => JSON.parse(await (await (await window.vectorFolder.getFileHandle('opencv-graph.json')).getFile()).text()))
  assert.equal(graph.nodes.find(node => node.type === 'vectorCandidates')?.params.verifyBorders, true)
  const grouping = graph.nodes.find(node => node.type === 'vectorGroups')
  assert(grouping)
  assert.deepEqual(grouping.params, { tolerance: 0.75, splitSubtleMotion: true, splitDistantRegions: true, proximityGap: 4 })
  const completion = graph.nodes.find(node => node.type === 'vectorComplete')
  assert(completion)
  assert.deepEqual(completion.params, { fillHoles: true, fillEdges: true, edgeReach: 8 })
  assert(graph.nodes.some(node => node.type === 'vectorCompletionInspect'))
  assert(graph.edges.some(edge => edge.source === 'ncompletionview' && edge.sourceHandle === 'out:frame:completed' && edge.target === 'nbottom'))
  assert(!graph.nodes.some(node => ['regionalMotion', 'regionalTracks', 'regionalHistory', 'regionalComplete'].includes(node.type)))
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Direct Motion' }).last().click())
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), 'nview')
  assert.deepEqual(await page.getByLabel('Output socket').locator('option').evaluateAll(options => options.map(option => option.value)), ['out:frame:source', 'out:frame:candidates', 'out:frame:groups', 'out:frame:confidence', 'out:string:summary'])
  const last = Number(await page.getByLabel('Render last frame').inputValue()), records = []
  for (const frame of new Set([0, Math.min(20, last), Math.min(84, last), Math.max(0, last - 2), last])) {
    if (Number(await page.getByLabel('Source frame', { exact: true }).inputValue()) !== frame) await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)))
    if (await page.getByLabel('Output socket').inputValue() !== 'out:string:summary') await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
    const summary = await page.locator('.value-preview pre').innerText()
    assert.match(summary, /No hole filling/)
    assert.match(summary, frame === last ? /final frame, no outgoing pair/ : /Confidence cells: unknown \d+; mixed assigned \d+; coherent assigned \d+/)
    if (frame !== last) {
      const counts = summary.match(/Candidate cells: (\d+); grouped cells: (\d+); temporal filtering: none/)
      assert(counts, 'First-pass candidate conservation is visible in the inspector')
      assert.equal(counts[1], counts[2])
      assert.match(summary, /Velocities are recomputed per pair, allowing easing and direction changes/)
      assert.match(summary, /Group IDs and colors are frame-local, not tracked identities/)
      assert.match(summary, /Subtle motion separation: enabled/)
      if (clip === defaultClip && [0, 20].includes(frame)) {
        assert.match(summary, /^1 frame-local motion groups;/m, 'Held pan controls must not split off reflected-border or marginal noise patches')
      }
    }
    records.push({ frame, summary }); console.log(summary.split('\n').filter(line => /Candidate cells|Confidence cells|frame-local motion/.test(line)).join('; '))
  }
  const characterChecks = clip === defaultClip ? await checkCharacterGroups({ page, change, output, prefix,
    cases: [100, 101, 106, 107].map(frame => ({ frame, expect: frame === 100 || frame === 106 ? 'moving' : 'held',
      minimumSeparate: 10, maximumSeparate: 0,
      backgroundCells: [90, 95, 100, 170, 175, 180, 250, 255, 260],
      characterCells: [427, 428, 429, 430, 467, 468, 469, 470, 507, 508, 509, 510, 547, 548, 549, 550, 587, 588, 589, 590],
    })),
  }) : []
  const proximityChecks = clip === defaultClip ? await checkDistantGroups({ page, change, output, prefix,
    cases: [
      { frame: 94, actorCells: [486, 487, 488, 526, 527, 528, 529, 565, 566, 567, 568, 569, 571, 605, 606, 607, 608, 609, 610, 611, 645, 646, 647, 648, 649, 650, 651, 685, 686, 687, 688, 689, 690, 691, 725, 726, 727, 728, 729, 730, 731, 765, 766, 767, 768, 769, 770, 771, 805, 806, 807, 808, 809, 810, 811] },
      { frame: 103, actorCells: [525, 526, 527, 565, 566, 567, 568, 569, 605, 606, 607, 608, 609, 645, 646, 647, 648, 649, 685, 686, 687, 688, 689, 725, 726, 727, 728, 729, 765, 766, 767, 768, 769, 805, 806, 807, 808, 809] },
    ].map(sample => ({ ...sample, minimumActorCells: 20, minimumCharacterCells: 15,
      characterCells: [427, 428, 429, 430, 467, 468, 469, 470, 507, 508, 509, 510, 547, 548, 549, 550, 587, 588, 589, 590],
    })),
  }) : []
  const borderChecks = clip === defaultClip ? await checkBorderRefinement({ page, change, output, prefix,
    cases: [
      { frame: 16, correctedCells: [400, 440, 480], foregroundCells: [516, 517, 518, 519, 556, 557, 558, 559, 596, 597, 598, 599, 636, 637, 638, 639, 676, 677, 678, 679, 716, 717, 718, 756, 757, 796, 797, 798, 836, 837, 838, 877, 719, 758, 759, 799, 839] },
      { frame: 17, correctedCells: [560] },
      { frame: 19, correctedCells: [800, 801], foregroundCells: [475, 476, 514, 515, 516, 517, 518, 519, 554, 555, 556, 557, 558, 559, 594, 595, 596, 597, 598, 599, 634, 635, 636, 637, 638, 639, 674, 675, 676, 677, 678, 679, 714, 715, 716, 717, 718, 719, 754, 755, 756, 757, 758, 759, 794, 795, 796, 797, 798, 799, 834, 835, 836, 837, 838, 839, 875, 877, 878, 879, 918] },
      { frame: 40, correctedCells: [280] },
      { frame: 46, correctedCells: [760, 800] },
      { frame: 52, correctedCells: [760] },
      { frame: 72, correctedCells: [] },
      ...[100, 106].map(frame => ({ frame, correctedCells: [], foregroundCells: [427, 428, 429, 430, 467, 468, 469, 470, 507, 508, 509, 510, 547, 548, 549, 550, 587, 588, 589, 590] })),
    ],
  }) : []
  await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(Math.min(20, last))))
  for (const port of ['source', 'candidates', 'groups', 'confidence']) {
    await change(() => page.getByLabel('Output socket').selectOption(`out:frame:${port}`))
    assert.equal(await page.locator('.view-options code').innerText(), '960 × 540')
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await page.getByRole('button', { name: 'Fullscreen preview', exact: true }).click()
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('frame-preview'))
    const png = await page.locator('.image-viewport canvas').screenshot()
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 32 * 1024 ** 2 })
    let min = 255, max = 0
    for (const byte of pixels) { min = Math.min(min, byte); max = Math.max(max, byte) }
    assert(max - min > 50, `${port}: blank preview`)
    await writeFile(resolve(output, `${prefix}-${port}.png`), png)
    await page.getByRole('button', { name: 'Exit fullscreen preview', exact: true }).click()
    await page.waitForFunction(() => !document.fullscreenElement)
  }
  const supportChecks = clip === defaultClip ? await checkSupportCompletion({ page, change, output, prefix,
    cases: [...[0, 20, 94, 103].map(frame => ({ frame, minimumHoles: 3, minimumBorder: 20 })), ...[25, 26, 65].map(frame => ({ frame, requireBottomRight: true }))],
  }) : []
  for (const check of supportChecks.filter(record => [0, 20].includes(record.frame))) {
    assert.equal(check.counts.unknown, 0, 'Early single-owner background must close winding edge pockets too')
  }
  const cornerControl = supportChecks.find(record => record.frame === 25)
  if (cornerControl) {
    assert(cornerControl.edges.find(edge => edge.edge === 'right').owners.length >= 3, 'Source 25 must exercise competing measured right-edge groups')
    assert.equal(cornerControl.counts.unknown, 0, 'Source 25 must close the reported bottom-right gap')
  }
  if (await page.locator('.inspect-panel').getAttribute('data-selected') !== 'ncompletionview') {
    await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Direct Completion' }).click())
  }
  if (Number(await page.getByLabel('Source frame', { exact: true }).inputValue()) !== Math.min(20, last)) {
    await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(Math.min(20, last))))
  }
  assert.deepEqual(await page.getByLabel('Output socket').locator('option').evaluateAll(options => options.map(option => option.value)),
    ['out:frame:source', 'out:frame:measured', 'out:frame:completed', 'out:frame:provenance', 'out:string:summary'])
  for (const port of ['source', 'measured', 'completed', 'provenance']) {
    await change(() => page.getByLabel('Output socket').selectOption(`out:frame:${port}`))
    assert.equal(await page.locator('.view-options code').innerText(), '960 × 540')
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await page.getByRole('button', { name: 'Fullscreen preview', exact: true }).click()
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('frame-preview'))
    const png = await page.locator('.image-viewport canvas').screenshot()
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 32 * 1024 ** 2 })
    let min = 255, max = 0
    for (const byte of pixels) { min = Math.min(min, byte); max = Math.max(max, byte) }
    assert(max - min > 50, `${port}: blank completion preview`)
    await writeFile(resolve(output, `${prefix}-support-${port}.png`), png)
    await page.getByRole('button', { name: 'Exit fullscreen preview', exact: true }).click()
    await page.waitForFunction(() => !document.fullscreenElement)
  }
  await assertViewport(page, ['.app-header', '.workspace', '.image-viewport', 'footer'])
  await page.screenshot({ path: resolve(output, `${prefix}-desktop.png`) })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Node preview', exact: true }).click()
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await assertViewport(page, ['.app-header', '.source-strip', '.workspace', '.image-viewport', '.render-controls', '.render-action', 'footer'])
  await page.screenshot({ path: resolve(output, `${prefix}-mobile.png`) })
  await page.setViewportSize({ width: 1600, height: 1100 })
  await change(() => page.locator('.step-strip button').filter({ hasText: /Output$/ }).click())
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), 'n5')
  assert.equal(await page.locator('.view-options code').innerText(), '1920 × 1080')
  await page.getByLabel('Render first frame').fill('0')
  await page.getByLabel('Render last frame').fill(String(last))
  await page.getByLabel('Render fps').selectOption('60')
  const count = Number((await page.locator('.render-note').innerText()).match(/^(\d+) output frames/)?.[1])
  const started = performance.now()
  await page.getByRole('button', { name: 'Render video', exact: false }).click()
  await page.waitForFunction(() => document.querySelector('[role=alert]') || document.querySelector('.frame-player')?.getAttribute('data-ready') === 'true', undefined, { timeout: 240000 })
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  const renderMs = performance.now() - started, video = await movieFile(page, resolve(output, `${prefix}-review.mp4`))
  assert.deepEqual([video.width, video.height, video.r_frame_rate, Number(video.nb_read_frames)], [1920, 1080, '60/1', count])
  const hash = execFileSync('ffmpeg', ['-v', 'error', '-i', resolve(output, `${prefix}-review.mp4`), '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim()
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, `${prefix}-browser.json`), JSON.stringify({ status: 'passed', clip, analysisMs, renderMs, defaultWorkers: 4, video, hash, records, characterChecks, proximityChecks, borderChecks, supportChecks, errors }, null, 2) + '\n')
  console.log(`PASS direct prefab: desktop/mobile, 4 full-size ports, ${count} video frames; ${hash}`)
} finally {
  await Promise.race([page?.close().catch(() => {}), pause(2000)])
  await Promise.race([browser?.close().catch(() => {}), pause(2000)])
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([stopped, pause(3000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
