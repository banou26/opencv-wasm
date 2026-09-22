import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright-core'
import { makeFixture } from './fixture.mjs'
import { primitivesSmoke } from './primitives-smoke.mjs'
import { mediaSmoke } from './media-smoke.mjs'
import { dragSmoke, previewSelectionSmoke, timelineSmoke, frameShortcutsSmoke } from './interaction-smoke.mjs'
import { generatedSmoke, motionVectorsSmoke } from './generation-smoke.mjs'
import { parallelSmoke } from './parallel-smoke.mjs'
import { movieShortcutsSmoke } from './output-player-smoke.mjs'
import { assertViewport, layoutSmoke } from './layout-smoke.mjs'
import { waitForBrowser } from './browser-poll.mjs'
import { graphActionsSmoke } from './graph-actions-smoke.mjs'

const directory = resolve('build-smoke'), children = [], errors = []
const pause = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(resolvePort => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)) }) })
const reachable = async url => { for (let i = 0; i < 150; i++) { try { if ((await fetch(url)).ok) return } catch {} await pause(100) } throw new Error(`Timed out: ${url}`) }
let browser, profile
await mkdir(directory, { recursive: true })
try {
  const fixture = await makeFixture(directory), reference = await readFile(fixture.reference), { width, height } = fixture
  let url = process.env.APP_URL, cdp = process.env.CDP_URL
  if (!url) {
    const port = await freePort(); url = `http://127.0.0.1:${port}`
    const child = spawn('node_modules/.bin/vp', ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' }); children.push(child)
  }
  await reachable(url)
  if (!cdp) {
    const port = await freePort(); cdp = `http://127.0.0.1:${port}`; profile = await mkdtemp(`${tmpdir()}/cadence-smoke-`)
    // Keep the user's system Chrome wrapper and graphics session. Playwright's launch flags
    // would change GPU/video capabilities, so attach over CDP to a normal muted window.
    const child = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1600,1100', 'about:blank'], { stdio: 'ignore' }); children.push(child)
  }
  await reachable(`${cdp}/json/version`)
  browser = await chromium.connectOverCDP(cdp)
  const page = await browser.contexts()[0].newPage(); await page.bringToFront()
  const runtimeRequests = []
  browser.contexts()[0].on('request', request => { if (/\.(bin|wasm)(?:\?|$)/.test(request.url())) runtimeRequests.push(request.url()) })
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message) })
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error('CONSOLE', m.text()) } })
  await page.goto(new URL('editor/', url.endsWith('/') ? url : url + '/').href)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 60000 })
  assert.match(await page.title(), /opencv-wasm/)
  assert.equal(runtimeRequests.filter(url => url.endsWith('.bin')).length, 3, 'Native startup fetches all three verified WASM chunks')
  assert.equal(runtimeRequests.some(url => url.endsWith('.wasm')), false, 'Native startup must not request a single oversized WASM asset')
  console.log('PASS: branded editor starts its native engine from the chunked runtime')
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    window.testFolderName = `cadence-initial-${crypto.randomUUID()}`
    window.testFolder = await root.getDirectoryHandle(window.testFolderName, { create: true })
    window.pickerCalls = 0
    window.showDirectoryPicker = async () => { window.pickerCalls++; return window.testFolder }
  })
  page.on('download', () => errors.push('Unexpected browser download; exports must use the project folder'))
  const footer = page.getByTestId('engine-status')
  const idle = async after => {
    await page.waitForFunction(before => { const f = document.querySelector('[data-testid=engine-status]'); return f?.getAttribute('data-state') === 'idle' && Number(f.getAttribute('data-request')) > before }, after, { timeout: 30000 })
    assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  }
  const change = async action => { const before = Number(await footer.getAttribute('data-request')); await action(); await idle(before) }
  const upload = async doc => change(() => page.locator('input[type=file][accept=".json"]').first().setInputFiles({ name: 'test-graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) }))
  const choose = async name => { await page.getByLabel('Prefab library').selectOption(name); await change(() => page.getByRole('button', { name: 'Open', exact: true }).click()) }
  let exportIndex = 0
  const png = async () => {
    const name = `opencv-frame${exportIndex ? `-${exportIndex + 1}` : ''}.png`
    await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
    // Autosave may replace the export status immediately; wait for the actual completed file.
    await waitForBrowser(page, async file => {
      try {
        const folder = await window.testFolder.getDirectoryHandle('exports')
        return (await (await folder.getFileHandle(file)).getFile()).size > 0 && document.querySelector('[data-testid=folder-state]')?.getAttribute('data-pending') === '0'
      } catch { return false }
    }, name)
    const bytes = await page.evaluate(async name => {
      const folder = await window.testFolder.getDirectoryHandle('exports'), handle = await folder.getFileHandle(name), file = await handle.getFile()
      return [...new Uint8Array(await file.arrayBuffer())]
    }, name)
    const file = resolve(directory, `frame-${exportIndex++}.png`)
    await writeFile(file, Buffer.from(bytes))
    return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 8 * 1024 ** 2 })
  }
  const project = async () => {
    await page.getByRole('button', { name: 'Save graph', exact: true }).click()
    await page.waitForFunction(() => { const state = document.querySelector('[data-testid=folder-state]'); return state?.getAttribute('data-pending') === '0' && state?.textContent.includes('Saved') })
    return page.evaluate(async () => JSON.parse(await (await (await window.testFolder.getFileHandle('opencv-graph.json')).getFile()).text()))
  }
  const node = (id, type, params = {}, x = 40) => ({ id, type, params, position: { x, y: 80 } })
  const edge = (source, target, targetHandle = 'in:frame:image', sourceHandle = 'out:frame:image') => ({ id: `e:${target}:${targetHandle}`, source, target, sourceHandle, targetHandle })
  const pipeline = (type, params) => ({ version: 1, nodes: [node('n1', 'source'), node('n2', type, params, 350), node('n5', 'output', {}, 680)], edges: [edge('n1', 'n2'), edge('n2', 'n5')] })
  const sourceGraph = { version: 1, nodes: [node('n1', 'source'), node('n5', 'output', {}, 350)], edges: [edge('n1', 'n5')] }
  await generatedSmoke(page, { directory, fixture, choose, change, png, project })
  await parallelSmoke(page, { directory, project, upload })
  assert.equal(runtimeRequests.filter(url => url.endsWith('.bin')).length, 3, 'Render workers reuse the verified binary without extra downloads')
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(fixture.video))
  assert.equal(await page.getByLabel('Render first frame').inputValue(), '0')
  assert.equal(await page.getByLabel('Render last frame').inputValue(), '31', 'A newly loaded clip defaults to all frames')
  await upload(sourceGraph)
  const sourcePixels = new Map()
  for (const frame of [0, 7, 23, 2, 31, 9, 0]) {
    if (Number(await page.getByLabel('Source frame', { exact: true }).inputValue()) !== frame) await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)))
    const actual = await png(), expected = reference.subarray(frame * width * height * 3, (frame + 1) * width * height * 3)
    assert.equal(actual.length, expected.length)
    const meanError = actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length
    assert.ok(meanError < 3, `Frame-exact seek ${frame}: mean RGB error ${meanError}`)
    sourcePixels.set(frame, actual)
  }
  assert.equal(await page.evaluate(() => window.pickerCalls), 1, 'The first export opens the folder picker exactly once')
  console.log('PASS: first-save folder picker and frame-exact forward/backward/open-GOP seeks against FFmpeg')
  await timelineSmoke(page)
  await frameShortcutsSmoke(page)
  await dragSmoke(page, project)
  await previewSelectionSmoke(page, change)
  await graphActionsSmoke(page, { upload, project, sourceGraph, directory })
  const original = sourcePixels.get(0)
  await upload(pipeline('grayscale', { weights: 'rec709' }))
  const gray = await png()
  for (let at = 0; at < gray.length; at += 3) {
    const expected = original[at] * 0.2126 + original[at + 1] * 0.7152 + original[at + 2] * 0.0722
    assert.ok(Math.abs(gray[at] - expected) <= 0.51); assert.equal(gray[at], gray[at + 1]); assert.equal(gray[at], gray[at + 2])
  }
  await upload(pipeline('blur', { radius: 3, sigma: 1.5 }))
  const blurred = await png(), weights = Array.from({ length: 7 }, (_, i) => Math.exp(-((i - 3) ** 2) / 4.5)), sum = weights.reduce((a, b) => a + b)
  for (let y = 5; y < height - 5; y += 17) for (let x = 5; x < width - 5; x += 19) for (let c = 0; c < 3; c++) {
    let expected = 0
    for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) expected += original[((y + yy) * width + x + xx) * 3 + c] * weights[xx + 3] * weights[yy + 3] / sum ** 2
    assert.ok(Math.abs(blurred[(y * width + x) * 3 + c] - expected) <= 0.51)
  }
  await upload(pipeline('threshold', { cutoff: 0.5, invert: false }))
  const mask = await png()
  for (let at = 0; at < mask.length; at += 3) assert.equal(mask[at], original[at] * 0.2126 + original[at + 1] * 0.7152 + original[at + 2] * 0.0722 > 127.5 ? 255 : 0)
  await upload(pipeline('offset', { offset: 7 })); assert.deepEqual(await png(), sourcePixels.get(7))
  await upload(pipeline('extractFrame', { frame: 7 }))
  assert.deepEqual(await png(), sourcePixels.get(7))
  await change(() => page.getByLabel('Source frame', { exact: true }).fill('23'))
  assert.deepEqual(await png(), sourcePixels.get(7))
  const extractControl = page.getByLabel('Extract Frame Frame N (from 0)', { exact: true })
  await extractControl.click()
  await change(() => extractControl.fill('2'))
  assert.ok(await extractControl.evaluate(input => document.activeElement === input), 'Extract Frame must finish updating while its field still has focus')
  assert.deepEqual(await png(), sourcePixels.get(2))
  await upload(await project())
  assert.deepEqual(await png(), sourcePixels.get(2))
  const fixedPair = { version: 1, nodes: [node('n1', 'source'), node('n2', 'extractFrame', { frame: 2 }, 350), node('n3', 'extractFrame', { frame: 7 }, 350), node('n4', 'delta', { offset: 1, absolute: true }, 680), node('n5', 'output', {}, 990)], edges: [edge('n1', 'n2'), edge('n1', 'n3'), edge('n2', 'n4', 'in:frame:a'), edge('n3', 'n4', 'in:frame:b'), edge('n4', 'n5', 'in:frame:image', 'out:frame:delta')] }
  fixedPair.nodes[2].position.y = 400
  await upload(fixedPair)
  const fixedDelta = await png(), frameTwo = sourcePixels.get(2), frameSeven = sourcePixels.get(7)
  for (let at = 0; at < fixedDelta.length; at++) assert.ok(Math.abs(fixedDelta[at] - Math.abs(frameTwo[at] - frameSeven[at])) <= 1)
  await change(() => page.getByLabel('Source frame', { exact: true }).fill('0'))
  assert.deepEqual(await png(), fixedDelta)
  const paneForExtract = page.locator('.react-flow__pane')
  await paneForExtract.click({ button: 'right', position: { x: 30, y: 40 } })
  await page.getByLabel('Search nodes').fill('extract frame')
  assert.match(await page.getByRole('listbox').innerText(), /Extract Video Frame/)
  await page.keyboard.press('Escape')
  console.log('PASS: Extract Frame pixels, live parameter updates without blur, timeline independence, serialization and arbitrary-frame delta')

  const composite = { version: 1, nodes: [node('n1', 'source'), node('n2', 'offset', { offset: 7 }, 350), node('n3', 'threshold', { cutoff: 0.5, invert: false }, 350), node('n4', 'composite', {}, 680), node('n5', 'output', {}, 990)], edges: [edge('n1', 'n2'), edge('n1', 'n3'), edge('n1', 'n4', 'in:frame:background'), edge('n2', 'n4', 'in:frame:foreground'), edge('n3', 'n4', 'in:frame:mask'), edge('n4', 'n5')] }
  composite.nodes[2].position.y = 400
  await upload(composite); const composed = await png(), shifted = sourcePixels.get(7)
  for (let at = 0; at < composed.length; at++) assert.equal(composed[at], mask[at] ? shifted[at] : original[at])
  const deltaGraph = { version: 1, nodes: [node('n1', 'source'), node('n2', 'delta', { offset: 7, absolute: true }, 350), node('n5', 'output', {}, 680)], edges: [edge('n1', 'n2', 'in:frame:a'), edge('n1', 'n2', 'in:frame:b'), edge('n2', 'n5', 'in:frame:image', 'out:frame:delta')] }
  await upload(deltaGraph); const difference = await png()
  for (let at = 0; at < difference.length; at++) assert.ok(Math.abs(difference[at] - Math.abs(original[at] - shifted[at])) <= 1)
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Frame Delta' }).click())
  await change(() => page.getByLabel('Output socket').selectOption('out:scalar:mean'))
  let meanDelta = 0
  for (let at = 0; at < original.length; at += 3) meanDelta += Math.abs((original[at] - shifted[at]) * 0.2126 + (original[at + 1] - shifted[at + 1]) * 0.7152 + (original[at + 2] - shifted[at + 2]) * 0.0722) / 255
  meanDelta /= width * height
  assert.ok(Math.abs(Number(await page.locator('.scalar-preview strong').innerText()) - meanDelta) < 0.0000006)
  console.log('PASS: native grayscale, Gaussian blur, threshold, frame offset and binary composition pixels')
  await choose('motion'); const camera = await project(), translate = camera.definitions.find(d => d.id === 'gtranslate')
  const translatedGraph = { version: 1, definitions: [translate], nodes: [node('n1', 'source'), { ...node('n3', 'group', { x: 3, y: 2 }, 350), definition: 'gtranslate' }, node('n5', 'output', {}, 680)], edges: [edge('n1', 'n3', 'image'), edge('n3', 'n5', 'in:frame:image', 'image')] }
  await upload(translatedGraph); const translated = await png()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) assert.equal(translated[(y * width + x) * 3 + c], x < 3 || y < 2 ? 0 : original[((y - 2) * width + x - 3) * 3 + c])
  await change(() => page.locator('.react-flow__node[data-id="n3"]').getByRole('button', { name: 'Edit internal nodes' }).click())
  assert.equal(await page.getByRole('tab', { name: 'Translate', exact: true }).getAttribute('aria-selected'), 'true')
  assert.deepEqual(await png(), translated)
  await change(() => page.getByRole('button', { name: /Translate X/ }).filter({ has: page.locator('span') }).last().click())
  const onlyX = await png(); assert.notDeepEqual(onlyX, translated)
  await page.getByLabel('Custom node name').fill('My Translate'); await page.getByLabel('Custom node name').press('Enter')
  await page.getByRole('tab', { name: 'My Translate', exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Main graph' }).click(); await page.waitForTimeout(300)
  console.log('PASS: editable Translate = Translate X + Translate Y, with live in-context tabs')
  await choose('difference')
  await choose('difference') // Reopening the identical prefab must still restore its preview.
  await page.getByRole('button', { name: 'Show all previews', exact: true }).click()
  const previewCount = (await project()).nodes.length
  await page.waitForFunction(count => document.querySelectorAll('.node-thumbnail').length === count && [...document.querySelectorAll('.node-thumbnail')].every(t => [...t.querySelectorAll('canvas')].some(c => c.width === 320 && getComputedStyle(c).display !== 'none') || t.querySelector('.thumbnail-value, strong')), previewCount)
  await page.getByRole('button', { name: 'Hide Grayscale preview' }).first().click(); assert.equal(await page.getByTestId('preview-n2').count(), 0)
  await page.getByRole('button', { name: 'Show Grayscale preview' }).first().click(); await page.getByTestId('preview-n2').locator('canvas').waitFor({ state: 'visible' })
  const pane = page.locator('.react-flow__pane')
  await pane.click({ button: 'right', position: { x: 30, y: 40 } }); await page.getByLabel('Search nodes').fill('raduis')
  assert.match(await page.getByRole('listbox').innerText(), /Gaussian Blur/)
  await page.screenshot({ path: resolve(directory, 'node-menu.png'), timeout: 15000 })
  await page.keyboard.press('Escape')
  await page.locator('.react-flow__node[data-id="n2"] .operation-head').click()
  await page.locator('.react-flow__node[data-id="n3"] .operation-head').click({ modifiers: ['Shift'] })
  await page.getByLabel('Node editor', { exact: true }).focus(); await page.keyboard.press('Control+g')
  await page.getByRole('tab', { name: 'Custom Node', exact: true }).waitFor()
  await page.getByLabel('Custom node name').fill('Prepare Luma'); await page.getByLabel('Custom node name').press('Enter')
  await page.getByRole('tab', { name: 'Prepare Luma', exact: true }).waitFor()
  await page.waitForTimeout(500)
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  await page.screenshot({ path: resolve(directory, 'custom-node.png'), timeout: 15000 })
  await page.getByRole('tab', { name: 'Main graph' }).click()
  const saved = await project(), utility = saved.definitions.find(d => d.name === 'Prepare Luma'); assert.ok(utility); assert.deepEqual(utility.graph.nodes.filter(n => !n.type.startsWith('group')).map(n => n.type).sort(), ['blur', 'grayscale'])
  await upload(saved)
  console.log('PASS: node previews, typo/property search, multi-selection grouping, renamed interfaces and project round-trip')
  await choose('motion'); await change(() => page.locator('.step-strip button').filter({ hasText: 'Estimate Translation' }).click()); const motionText = await page.locator('.motion-key strong').innerText(); const displacement = motionText.match(/Δx ([\d.-]+) px.*Δy ([\d.-]+) px/); assert.ok(displacement); assert.ok(Math.abs(Number(displacement[1]) - 2) < 0.3 && Math.abs(Number(displacement[2]) - 1) < 0.3, motionText); await change(() => page.locator('.step-strip button').filter({ hasText: 'Output' }).click()); await change(() => page.getByLabel('Subframe fraction').fill('0.5'))
  const atHalf = await png(); await change(() => page.getByLabel('Subframe fraction').fill('0')); const atZero = await png(); assert.notDeepEqual(atHalf, atZero)
  assert.equal(await page.getByLabel('Render last frame').inputValue(), '31', 'Changing graphs preserves the full clip range')
  await page.getByRole('button', { name: 'Render video', exact: false }).click(); await page.getByRole('button', { name: 'Save MP4 to folder', exact: true }).waitFor({ timeout: 45000 })
  assert.match(await page.locator('.movie-caption').innerText(), /80 frames · 60 fps/)
  const movie = async name => {
    const url = await page.locator('.frame-player').getAttribute('data-src')
    const bytes = await page.evaluate(async u => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), url), file = resolve(directory, name)
    await writeFile(file, Buffer.from(bytes))
    return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
  }
  const info = await movie('generated.mp4'); assert.equal(info.streams.length, 1); assert.equal(info.streams[0].nb_read_frames, '80'); assert.equal(info.streams[0].r_frame_rate, '60/1')
  const generated = execFileSync('ffmpeg', ['-v', 'error', '-i', resolve(directory, 'generated.mp4'), '-sws_flags', 'bicubic+accurate_rnd+full_chroma_int', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 16 * 1024 ** 2 })
  await movieShortcutsSmoke(page, { count: 80, reference: generated, width, height })
  const pixelsPerFrame = width * height * 3, last = generated.subarray(generated.length - pixelsPerFrame)
  // Encoding is lossy (including chroma resampling), so check frame identity against
  // every independently decoded source drawing instead of demanding PNG precision.
  const matches = Array.from({ length: fixture.count }, (_, frame) => ({ frame, error: last.reduce((sum, v, i) => sum + Math.abs(v - reference[frame * pixelsPerFrame + i]), 0) / last.length })).sort((a, b) => a.error - b.error)
  assert.equal(matches[0].frame, 31, 'The full camera render must include the final source drawing')
  assert.ok(matches[0].error * 2 < matches[1].error, 'The final drawing must match clearly better than an earlier frame')
  await page.getByLabel('Render last frame').fill('30'); await page.getByLabel('Render fps').selectOption('120')
  const previous = await page.locator('.frame-player').getAttribute('data-src')
  await page.getByRole('button', { name: 'Render video', exact: false }).click()
  // This tiny cached fixture can finish while Playwright waits for button
  // stability. Click as soon as progress arrives, before the render completes.
  await page.waitForFunction(() => {
    const button = document.querySelector('.render-action button.danger')
    if (!(Number(document.querySelector('progress')?.value) >= 2) || !button || button.disabled) return false
    button.click(); return true
  })
  await page.waitForFunction(old => { const video = document.querySelector('.frame-player'); return video && video.getAttribute('data-src') !== old && video.dataset.frame === '0' }, previous)
  const partial = await movie('partial.mp4'), count = Number(partial.streams[0].nb_read_frames)
  assert.ok(count >= 2 && count < 155); assert.match(await page.locator('.movie-caption').innerText(), /partial render/)
  console.log(`PASS: complete 80-frame camera render including final drawing, 60 fps MP4 playback/export; cancelled render preserves ${count} valid frames`)
  // Enter a utility inside another utility and expose a new numeric input/output pair.
  await change(() => page.locator('.react-flow__node[data-id="n3"]').getByRole('button', { name: 'Edit internal nodes' }).click())
  await page.locator('.react-flow__node[data-id="nx"] .operation-head').click()
  await page.locator('.react-flow__node[data-id="ny"] .operation-head').click({ modifiers: ['Shift'] })
  await page.getByLabel('Node editor', { exact: true }).focus(); await page.keyboard.press('Control+g')
  await page.getByRole('tab', { name: 'Custom Node', exact: false }).waitFor()
  assert.equal(await page.getByRole('tab').count(), 3)
  await page.getByLabel('Custom node name').fill('Axis Pair'); await page.getByLabel('Custom node name').press('Enter')
  await page.getByRole('button', { name: '＋ Add input', exact: true }).click()
  await page.getByLabel('inputs port 4 type', { exact: true }).selectOption('scalar')
  await page.getByLabel('inputs port 4 name', { exact: true }).fill('Amount'); await page.getByLabel('inputs port 4 name', { exact: true }).press('Enter')
  await page.getByRole('button', { name: '＋ Add output', exact: true }).click()
  await page.getByLabel('outputs port 2 type', { exact: true }).selectOption('scalar')
  await page.getByLabel('outputs port 2 name', { exact: true }).fill('Distance'); await page.getByLabel('outputs port 2 name', { exact: true }).press('Enter')
  const nestedProject = await project(), nested = nestedProject.definitions.find(d => d.name === 'Axis Pair'), inputId = nested.inputs.at(-1).id, outputId = nested.outputs.at(-1).id
  await page.getByRole('button', { name: 'Fit View', exact: true }).click()
  await page.waitForTimeout(300)
  const from = page.locator(`.react-flow__node[data-id="ninput"] [data-handleid="${inputId}"]`), to = page.locator(`.react-flow__node[data-id="noutput"] [data-handleid="${outputId}"]`)
  // Follow the live elements rather than stale coordinates while the nested viewport settles.
  await from.hover(); await page.mouse.down(); await to.hover()
  await page.waitForFunction(id => document.querySelector(`[data-nodeid="noutput"][data-handleid="${id}"]`)?.classList.contains('valid'), outputId)
  await to.hover(); await page.mouse.up()
  await page.locator(`[data-testid="rf__edge-e:noutput:${outputId}"]`).waitFor()
  const wired = await project()
  assert.ok(wired.definitions.find(d => d.id === nested.id).graph.edges.some(e => e.targetHandle === outputId && e.sourceHandle === inputId), 'Custom scalar ports should be wired')
  await page.locator('.step-strip button').filter({ hasText: 'Group Outputs' }).click()
  await change(() => page.getByLabel('Output socket').selectOption(outputId))
  assert.equal(Number(await page.locator('.scalar-preview strong').innerText()), 0)
  await page.getByRole('tab', { name: 'Translate', exact: true }).click()
  const amount = page.getByLabel('Axis Pair Amount', { exact: true })
  await amount.focus(); await amount.press('Control+a'); await amount.pressSequentially('-12'); await amount.press('Enter')
  const rootAfter = await project(), insideTranslate = rootAfter.definitions.find(d => d.id === 'gtranslate').graph.nodes.find(n => n.type === 'group')
  assert.equal(insideTranslate.params[inputId], -12)
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Axis Pair' }).click())
  await change(() => page.getByLabel('Output socket').selectOption(outputId))
  assert.equal(Number(await page.locator('.scalar-preview strong').innerText()), -12)
  await change(() => page.getByRole('tab', { name: 'Main graph' }).click())
  console.log('PASS: nested tabs, new typed custom ports, live internal wiring, negative numeric editing and custom scalar outputs')
  await layoutSmoke(page, directory)
  await primitivesSmoke(page, { directory, upload, choose, change, png, project, sourcePixels, width, height })
  await motionVectorsSmoke(page, { directory, choose, change, png, project })
  await mediaSmoke(page, { fixture, directory, upload, sourceGraph, change, png, project })
  await assertViewport(page, ['.workspace-notices', '.timeline', '.render-controls', '.render-action', 'footer'])
  assert.deepEqual(errors, [])
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ passed: true, nativePixelChecks: ['seamless procedural RGB without video', 'regional motion vectors', 'exact output seek paints', 'source seek', 'grayscale', 'GaussianBlur', 'threshold', 'offset', 'copyTo mask', 'absdiff', 'mean luma', 'phaseCorrelate', 'translateX', 'translateY', 'computed frame index', 'crop/process/paste', 'editable Laplacian reconstruction', 'typed record frame roundtrip'], output: { count: 80, fps: 60 }, cancelledFrames: count, errors }, null, 2))
  await page.screenshot({ path: resolve(directory, 'editor.png'), fullPage: true, timeout: 15000 })
  await page.close()
  console.log(`Browser smoke passed. Artifacts: ${directory}`)
} finally {
  if (browser) {
    if (profile) { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close').catch(() => {}) }
    await browser.close()
  }
  for (const child of children) child.kill('SIGTERM')
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {})
}
