import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { waitForBrowser } from './browser-poll.mjs'

const color = id => {
  const hue = (.61 + id * .61803398875) % 1, sector = hue * 6, fraction = sector - Math.floor(sector)
  const low = 45, high = 231, falling = Math.round(high - (high - low) * fraction), rising = Math.round(low + (high - low) * fraction)
  return [[high, rising, low], [falling, high, low], [low, high, rising], [low, falling, high], [rising, low, high], [high, low, falling]][Math.floor(sector)]
}
const decode = png => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 32 * 1024 ** 2 })

const capture = async (page, change, frame) => {
  if (Number(await page.getByLabel('Source frame', { exact: true }).inputValue()) !== frame) await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)))
  if (await page.getByLabel('Output socket').inputValue() !== 'out:string:summary') await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const summary = await page.locator('.value-preview pre').innerText()
  const geometry = summary.match(/(\d+) x (\d+) display \/ (\d+) x (\d+) analysis/)
  const counts = summary.match(/Candidate cells: (\d+); grouped cells: (\d+); temporal filtering: none/)
  const size = Number(summary.match(/cell size (\d+)/)?.[1])
  assert(geometry && counts && Number.isSafeInteger(size) && size > 0)
  assert.equal(counts[1], counts[2], `Source ${frame}: candidate support must be conserved`)
  const [, width, height, analysisWidth, analysisHeight] = geometry.map(Number)
  const groups = [...summary.matchAll(/^Group (\d+):/gm)].map(match => Number(match[1])), rasters = {}
  for (const port of ['source', 'candidates', 'groups', 'confidence']) {
    await change(() => page.getByLabel('Output socket').selectOption(`out:frame:${port}`))
    const previous = await page.evaluate(async () => {
      try { const dir = await window.vectorFolder.getDirectoryHandle('exports'); return Array.fromAsync(dir.keys()) } catch { return [] }
    })
    await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
    await waitForBrowser(page, async previous => {
      if (document.querySelector('[data-testid=folder-state]')?.getAttribute('data-pending') !== '0') return false
      try {
        const dir = await window.vectorFolder.getDirectoryHandle('exports')
        const name = (await Array.fromAsync(dir.keys())).find(name => name.endsWith('.png') && !previous.includes(name))
        return name !== undefined && (await (await dir.getFileHandle(name)).getFile()).size > 0
      } catch { return false }
    }, previous)
    const dataUrl = await page.evaluate(async previous => {
      const dir = await window.vectorFolder.getDirectoryHandle('exports'), names = await Array.fromAsync(dir.keys())
      const name = names.find(name => name.endsWith('.png') && !previous.includes(name))
      const file = await (await dir.getFileHandle(name)).getFile()
      return new Promise((done, reject) => { const reader = new FileReader(); reader.onload = () => done(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
    }, previous)
    rasters[port] = decode(Buffer.from(dataUrl.split(',')[1], 'base64'))
    assert.equal(rasters[port].length, width * height * 3)
  }
  const columns = Math.ceil(analysisWidth / size), cells = Math.ceil(analysisHeight / size) * columns
  const labelAt = cell => {
    assert(Number.isSafeInteger(cell) && cell >= 0 && cell < cells)
    const x = Math.min(analysisWidth - .5, cell % columns * size + size / 2)
    const y = Math.min(analysisHeight - .5, Math.floor(cell / columns) * size + size / 2)
    const pixel = (Math.floor(y * height / analysisHeight) * width + Math.floor(x * width / analysisWidth)) * 3
    const original = Array.from(rasters.source.subarray(pixel, pixel + 3)), grouped = Array.from(rasters.groups.subarray(pixel, pixel + 3))
    if (grouped.every((channel, index) => channel === original[index])) return { cell, label: -1 }
    const matches = groups.filter(id => [.38, .6].some(alpha => color(id).every((channel, index) => Math.abs(grouped[index] - Math.round(original[index] * (1 - alpha) + channel * alpha)) <= 1)))
    assert.equal(matches.length, 1, `Source ${frame} cell ${cell}: diagnostic group color must be uniquely decodable`)
    return { cell, label: matches[0] }
  }
  return { summary, width, height, analysisWidth, analysisHeight, size, columns, cells, rasters, labelAt }
}

const saveSheet = (result, output, name) => {
  const { width, height, rasters } = result, mosaic = Buffer.alloc(width * height * 12)
  for (const [panel, raster] of Object.values(rasters).entries()) for (let y = 0; y < height; y++) raster.copy(mosaic, ((y + Math.floor(panel / 2) * height) * width * 2 + panel % 2 * width) * 3, y * width * 3, (y + 1) * width * 3)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width * 2}x${height * 2}`, '-i', 'pipe:0', '-frames:v', '1', resolve(output, name)], { input: mosaic })
}

/** Inspect source-backed exports in the already-open Direct motion layers smoke session. */
export async function checkCharacterGroups({ page, change, output, prefix, cases }) {
  const records = []
  const save = status => writeFile(resolve(output, `${prefix}-character-browser.json`), `${JSON.stringify({ status, description: 'Native editor PNG pixels, not cached labels. Fixed audit cells are test controls only, never segmentation inputs. IDs are compared within each frame.', records }, null, 2)}\n`)
  for (const sample of cases) {
    const result = await capture(page, change, sample.frame), { summary, labelAt } = result
    const background = sample.backgroundCells.map(labelAt), character = sample.characterCells.map(labelAt)
    const measuredBackground = background.filter(item => item.label >= 0)
    const votes = new Map()
    for (const item of measuredBackground) votes.set(item.label, (votes.get(item.label) ?? 0) + 1)
    const backgroundId = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0]
    assert.notEqual(backgroundId, undefined, `Source ${sample.frame}: background control has no candidates`)
    const available = character.filter(item => item.label >= 0), separate = available.filter(item => item.label !== backgroundId)
    assert(available.length > 0, `Source ${sample.frame}: character control has no candidates`)
    const name = `${prefix}-character-${String(sample.frame).padStart(3, '0')}.png`
    saveSheet(result, output, name)
    const record = { frame: sample.frame, expected: sample.expect, summary, backgroundId, background, character, available: available.length, separate: separate.length, image: name }
    records.push(record)
    await save('incomplete')
    assert(measuredBackground.length >= 3, `Source ${sample.frame}: at least three background controls must have candidates`)
    assert(measuredBackground.every(item => item.label === backgroundId), `Source ${sample.frame}: wall controls must not fragment into multiple motion groups`)
    console.log(`Character source ${sample.frame} (${sample.expect}): ${separate.length}/${available.length} candidate cells differ from background`)
    if (sample.expect === 'moving') assert(separate.length >= (sample.minimumSeparate ?? 1), `Source ${sample.frame}: moving character must separate from background`)
    if (sample.expect === 'held') assert(separate.length <= (sample.maximumSeparate ?? 0), `Source ${sample.frame}: held character must not become a fake motion group`)
  }
  await save('passed')
  return records
}

/** Compare loose foreground separation without changing any dominant-background pixels. */
export async function checkDistantGroups({ page, change, output, prefix, cases }) {
  const control = page.getByLabel('Frame Velocity Groups Separate distant regions', { exact: true })
  const original = await control.isChecked(), records = []
  const save = status => writeFile(resolve(output, `${prefix}-proximity-browser.json`), `${JSON.stringify({ status, description: 'Native PNG comparison with foreground proximity disabled/enabled. Every pixel of the disabled dominant group is protected; sampled actor cells are test-only controls.', records }, null, 2)}\n`)
  const setEnabled = async enabled => { if (await control.isChecked() !== enabled) await change(() => control.setChecked(enabled)) }
  try {
    for (const sample of cases) {
      await setEnabled(false)
      const before = await capture(page, change, sample.frame)
      await setEnabled(true)
      const after = await capture(page, change, sample.frame)
      assert.match(before.summary, /Distant region separation: disabled/)
      assert.match(after.summary, /Distant region separation: enabled/)
      assert.deepEqual([before.width, before.height, before.analysisWidth, before.analysisHeight, before.size], [after.width, after.height, after.analysisWidth, after.analysisHeight, after.size])
      for (const port of ['source', 'candidates', 'confidence']) assert(before.rasters[port].equals(after.rasters[port]), `Source ${sample.frame}: proximity must not alter ${port}`)
      let backgroundCells = 0, backgroundPixels = 0, changedBackgroundPixels = 0
      for (let cell = 0; cell < before.cells; cell++) {
        if (before.labelAt(cell).label !== 0) continue
        backgroundCells++
        const x = cell % before.columns * before.size, y = Math.floor(cell / before.columns) * before.size
        const left = Math.ceil(x * before.width / before.analysisWidth), right = Math.min(before.width, Math.ceil((x + before.size) * before.width / before.analysisWidth))
        const top = Math.ceil(y * before.height / before.analysisHeight), bottom = Math.min(before.height, Math.ceil((y + before.size) * before.height / before.analysisHeight))
        for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
          const pixel = (py * before.width + px) * 3
          backgroundPixels++
          if ([0, 1, 2].some(channel => before.rasters.groups[pixel + channel] !== after.rasters.groups[pixel + channel])) changedBackgroundPixels++
        }
      }
      const actor = sample.actorCells.map(after.labelAt), character = sample.characterCells.map(after.labelAt)
      const foregroundIds = samples => [...new Set(samples.filter(item => item.label > 0).map(item => item.label))]
      const actorIds = foregroundIds(actor), characterIds = foregroundIds(character)
      const beforeActorIds = foregroundIds(sample.actorCells.map(before.labelAt)), beforeCharacterIds = foregroundIds(sample.characterCells.map(before.labelAt))
      const sharedBefore = beforeActorIds.filter(id => beforeCharacterIds.includes(id)), sharedAfter = actorIds.filter(id => characterIds.includes(id))
      const names = ['off', 'on'].map(mode => `${prefix}-proximity-${String(sample.frame).padStart(3, '0')}-${mode}.png`)
      saveSheet(before, output, names[0]); saveSheet(after, output, names[1])
      const record = { frame: sample.frame, backgroundCells, backgroundPixels, changedBackgroundPixels, actor, character, sharedBefore, sharedAfter, actorIds, characterIds, beforeSummary: before.summary, afterSummary: after.summary, images: names }
      records.push(record); await save('incomplete')
      assert(backgroundCells >= 3, `Source ${sample.frame}: dominant background comparison requires measured support`)
      assert.equal(changedBackgroundPixels, 0, `Source ${sample.frame}: dominant background pixels must be identical`)
      assert(sharedBefore.length > 0, `Source ${sample.frame}: control should expose previously shared foreground motion`)
      assert(actor.filter(item => item.label > 0).length >= (sample.minimumActorCells ?? 1), `Source ${sample.frame}: actor needs non-background samples`)
      assert(character.filter(item => item.label > 0).length >= (sample.minimumCharacterCells ?? 1), `Source ${sample.frame}: lone character needs non-background samples`)
      assert.equal(sharedAfter.length, 0, `Source ${sample.frame}: distant actor and lone character must have disjoint group IDs`)
      console.log(`Proximity source ${sample.frame}: foreground IDs ${actorIds.join(',')} / ${characterIds.join(',')}; ${backgroundPixels} background pixels unchanged`)
    }
    await save('passed')
    return records
  } finally { await setEnabled(original) }
}
