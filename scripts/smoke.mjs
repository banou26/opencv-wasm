import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright-core'
import { makeFixture } from './fixture.mjs'
import { mediaSmoke } from './media-smoke.mjs'

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
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message) })
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error('CONSOLE', m.text()) } })
  await page.goto(url)
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 60000 })
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
    const name = `cadence-frame${exportIndex ? `-${exportIndex + 1}` : ''}.png`
    await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
    await page.waitForFunction(file => document.querySelector('[data-testid=folder-state]')?.textContent.includes(`Saved exports/${file}`), name)
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
    return page.evaluate(async () => JSON.parse(await (await (await window.testFolder.getFileHandle('cadence-graph.json')).getFile()).text()))
  }
  const node = (id, type, params = {}, x = 40) => ({ id, type, params, position: { x, y: 80 } })
  const edge = (source, target, targetHandle = 'in:frame:image', sourceHandle = 'out:frame:image') => ({ id: `e:${target}:${targetHandle}`, source, target, sourceHandle, targetHandle })
  const pipeline = (type, params) => ({ version: 1, nodes: [node('n1', 'source'), node('n2', type, params, 350), node('n5', 'output', {}, 680)], edges: [edge('n1', 'n2'), edge('n2', 'n5')] })
  const sourceGraph = { version: 1, nodes: [node('n1', 'source'), node('n5', 'output', {}, 350)], edges: [edge('n1', 'n5')] }
  await change(() => page.locator('input[type=file][accept*="video"]').first().setInputFiles(fixture.video))
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
  await change(() => page.getByRole('button', { name: 'Edit internal nodes' }).click())
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
  await page.waitForFunction(() => [...document.querySelectorAll('.node-thumbnail')].length === 5 && [...document.querySelectorAll('.node-thumbnail canvas')].every(c => c.width === 320))
  await page.getByRole('button', { name: 'Hide Grayscale preview' }).click(); assert.equal(await page.getByTestId('preview-n2').count(), 0)
  await page.getByRole('button', { name: 'Show Grayscale preview' }).click(); await page.getByTestId('preview-n2').locator('canvas').waitFor({ state: 'visible' })
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
  await page.getByLabel('Render last frame').fill('3')
  await page.getByRole('button', { name: 'Render video', exact: false }).click(); await page.getByRole('button', { name: 'Save MP4 to folder', exact: true }).waitFor({ timeout: 45000 })
  assert.match(await page.locator('.movie-caption').innerText(), /10 frames · 60 fps/)
  const movie = async name => {
    const url = await page.locator('.movie-preview video, .render-preview video, video').getAttribute('src')
    const bytes = await page.evaluate(async u => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), url), file = resolve(directory, name)
    await writeFile(file, Buffer.from(bytes))
    return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
  }
  const info = await movie('generated.mp4'); assert.equal(info.streams.length, 1); assert.equal(info.streams[0].nb_read_frames, '10'); assert.equal(info.streams[0].r_frame_rate, '60/1')
  const duration = await page.locator('video').evaluate(async v => { if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true })); await v.play(); return v.duration })
  assert.ok(Math.abs(duration - 10 / 60) < 0.01); await page.locator('video').evaluate(v => v.pause())
  await page.getByLabel('Render last frame').fill('30'); await page.getByLabel('Render fps').selectOption('120')
  const previous = await page.locator('video').getAttribute('src')
  await page.getByRole('button', { name: 'Render video', exact: false }).click()
  await page.waitForFunction(() => Number(document.querySelector('progress')?.value) >= 2)
  await page.getByRole('button', { name: 'Stop and keep completed frames' }).click()
  await page.waitForFunction(old => { const video = document.querySelector('video'); return video && video.getAttribute('src') !== old }, previous)
  const partial = await movie('partial.mp4'), count = Number(partial.streams[0].nb_read_frames)
  assert.ok(count >= 2 && count < 155); assert.match(await page.locator('.movie-caption').innerText(), /partial render/)
  console.log(`PASS: real 60 fps MP4 playback/export; cancelled render preserves ${count} valid frames`)
  // Enter a utility inside another utility and expose a new numeric input/output pair.
  await change(() => page.getByRole('button', { name: 'Edit internal nodes' }).click())
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
  const from = await page.locator(`.react-flow__node[data-id="ninput"] [data-handleid="${inputId}"]`).boundingBox(), to = await page.locator(`.react-flow__node[data-id="noutput"] [data-handleid="${outputId}"]`).boundingBox()
  assert.ok(from && to)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 }); await page.mouse.up()
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
  await mediaSmoke(page, { fixture, directory, upload, sourceGraph, change, png, project })
  assert.deepEqual(errors, [])
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ passed: true, nativePixelChecks: ['source seek', 'grayscale', 'GaussianBlur', 'threshold', 'offset', 'copyTo mask', 'absdiff', 'mean luma', 'phaseCorrelate', 'translateX', 'translateY'], output: { count: 10, fps: 60 }, cancelledFrames: count, errors }, null, 2))
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
