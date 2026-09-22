import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const movieFile = async (page, file) => {
  const bytes = await page.locator('.frame-player').evaluate(async p => [...new Uint8Array(await (await fetch(p.dataset.src)).arrayBuffer())])
  await writeFile(file, Buffer.from(bytes))
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })).streams[0]
}
const render = async (page, count = 8) => {
  await page.getByLabel('Render last frame').fill(String(count - 1)); await page.getByLabel('Render fps').selectOption('24')
  const previous = await page.locator('.frame-player').evaluateAll(players => players[0]?.getAttribute('data-src') ?? null)
  await page.getByRole('button', { name: 'Render video', exact: false }).click()
  await page.waitForFunction(old => {
    const p = document.querySelector('.frame-player')
    return p && p.dataset.src !== old && p.dataset.ready === 'true' && p.dataset.frame === '0'
  }, previous, { timeout: 60000 })
}

/** A completely source-free graph generates the fixture pixels, advances Time and exports a movie. */
export const generatedSmoke = async (page, { directory, fixture, choose, change, png, project }) => {
  await choose('texture')
  assert.equal(await page.getByLabel('Render quality', { exact: true }).inputValue(), 'high')
  assert.equal(await page.locator('.react-flow__node').filter({ hasText: 'Video Source' }).count(), 0)
  assert.match(await page.locator('.time-heading').innerText(), /GENERATED TIME/)
  const raw = await readFile(resolve(directory, 'fixture.rgb')), { width, height } = fixture, stride = width * height * 3
  for (const frame of [0, 1]) {
    if (frame) await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)))
    const actual = await png(), expected = raw.subarray(frame * stride, (frame + 1) * stride)
    assert.equal(actual.length, expected.length)
    assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 1), 'Generated pixels must recreate the raw fixture, without opening it as media')
  }
  await page.getByLabel('Image preview', { exact: true }).focus(); await page.keyboard.press('>')
  assert.equal(await page.getByLabel('Source frame', { exact: true }).inputValue(), '2')
  const saved = await project()
  assert.equal(saved.nodes.some(n => ['clip', 'source', 'readFrame'].includes(n.type)), false)
  assert.ok(saved.definitions.some(d => d.graph.nodes.some(n => n.type === 'pixelMath')), 'Color groups must remain editable arithmetic')
  await render(page)
  const file = resolve(directory, 'generated-without-video.mp4'), info = await movieFile(page, file)
  assert.equal(info.nb_read_frames, '8'); assert.equal(info.r_frame_rate, '24/1')
  assert.equal(await page.getByLabel('Output resolution', { exact: true }).innerText(), `${width} × ${height}`)
  assert.deepEqual([info.width, info.height], [width, height], 'Compression preserves the graph output dimensions')
  const actual = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-sws_flags', 'bicubic+accurate_rnd+full_chroma_int', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 8 * 1024 ** 2 })
  for (let frame = 0; frame < 8; frame++) {
    const pixels = actual.subarray(frame * stride, (frame + 1) * stride)
    const candidates = Array.from({ length: 8 }, (_, candidate) => ({ frame: candidate, error: pixels.reduce((total, value, i) => total + Math.abs(value - raw[candidate * stride + i]), 0) / stride })).sort((a, b) => a.error - b.error)
    assert.equal(candidates[0].frame, frame, 'The encoded frames must advance the generated animation')
  }
  await page.screenshot({ path: resolve(directory, 'procedural-video.png') })
  await page.getByRole('button', { name: 'Node preview', exact: true }).click()
  await page.getByLabel('Render fps').selectOption('60')
  console.log('PASS: source-free editable texture, fixture-identical PNGs, generated-time shortcuts and 8-frame animated MP4')
}

/** Check the cookbook through the actual editor, including dense-flow previews and video output. */
export const motionVectorsSmoke = async (page, { directory, choose, change, png, project }) => {
  await choose('motionVectors')
  const saved = await project()
  assert.equal(saved.definitions.find(d => d.id === 'gcompensatedflow').graph.nodes.filter(n => n.type === 'farneback').length, 1)
  if (await page.getByLabel('Source frame', { exact: true }).inputValue() !== '0') await change(() => page.getByLabel('Source frame', { exact: true }).fill('0'))
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Regional Median Flow' }).click())
  for (const [axis, expected] of [['dx', 2], ['dy', 1]]) {
    await change(() => page.getByLabel('Output socket').selectOption(`out:scalar:${axis}`))
    const actual = Number(await page.locator('.scalar-preview strong').innerText())
    assert.ok(Math.abs(actual - expected) < 0.4, `Cookbook ${axis}: ${actual}`)
  }
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Output' }).click())
  const first = await png()
  assert.ok(first.some((v, i) => i % 3 === 1 && v > 200 && first[i - 1] < 120), 'The overlay must contain visible green vectors')
  await render(page)
  const info = await movieFile(page, resolve(directory, 'motion-vectors.mp4'))
  assert.equal(info.nb_read_frames, '8'); assert.equal(info.r_frame_rate, '24/1')
  await page.getByLabel('Output frame', { exact: true }).fill('7')
  await page.waitForFunction(() => document.querySelector('.frame-player').dataset.frame === '7')
  await page.screenshot({ path: resolve(directory, 'motion-vectors-video.png') })
  await page.getByRole('button', { name: 'Node preview', exact: true }).click()
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  console.log('PASS: cookbook graph estimates the fixture motion, draws regional arrows and renders a frame-steppable video')
}
