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

/** Inspect source-backed exports in the already-open Direct motion layers smoke session. */
export async function checkCharacterGroups({ page, change, output, prefix, cases }) {
  const records = []
  const save = status => writeFile(resolve(output, `${prefix}-character-browser.json`), `${JSON.stringify({ status, description: 'Native editor PNG pixels, not cached labels. Fixed audit cells are test controls only, never segmentation inputs. IDs are compared within each frame.', records }, null, 2)}\n`)
  for (const sample of cases) {
    if (Number(await page.getByLabel('Source frame', { exact: true }).inputValue()) !== sample.frame) await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(sample.frame)))
    if (await page.getByLabel('Output socket').inputValue() !== 'out:string:summary') await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
    const summary = await page.locator('.value-preview pre').innerText()
    const geometry = summary.match(/(\d+) x (\d+) display \/ (\d+) x (\d+) analysis/)
    const counts = summary.match(/Candidate cells: (\d+); grouped cells: (\d+); temporal filtering: none/)
    const size = Number(summary.match(/cell size (\d+)/)?.[1])
    assert(geometry && counts && Number.isSafeInteger(size) && size > 0)
    assert.equal(counts[1], counts[2], `Source ${sample.frame}: candidate support must be conserved`)
    const [, width, height, analysisWidth, analysisHeight] = geometry.map(Number)
    const groups = [...summary.matchAll(/^Group (\d+):/gm)].map(match => Number(match[1]))
    const rasters = {}
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
      const png = Buffer.from(dataUrl.split(',')[1], 'base64')
      rasters[port] = decode(png)
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
      assert.equal(matches.length, 1, `Source ${sample.frame} cell ${cell}: diagnostic group color must be uniquely decodable`)
      return { cell, label: matches[0] }
    }
    const background = sample.backgroundCells.map(labelAt), character = sample.characterCells.map(labelAt)
    const measuredBackground = background.filter(item => item.label >= 0)
    const votes = new Map()
    for (const item of measuredBackground) votes.set(item.label, (votes.get(item.label) ?? 0) + 1)
    const backgroundId = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0]
    assert.notEqual(backgroundId, undefined, `Source ${sample.frame}: background control has no candidates`)
    const available = character.filter(item => item.label >= 0), separate = available.filter(item => item.label !== backgroundId)
    assert(available.length > 0, `Source ${sample.frame}: character control has no candidates`)
    const name = `${prefix}-character-${String(sample.frame).padStart(3, '0')}.png`, mosaic = Buffer.alloc(width * height * 12)
    for (const [panel, raster] of Object.values(rasters).entries()) for (let y = 0; y < height; y++) raster.copy(mosaic, ((y + Math.floor(panel / 2) * height) * width * 2 + panel % 2 * width) * 3, y * width * 3, (y + 1) * width * 3)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width * 2}x${height * 2}`, '-i', 'pipe:0', '-frames:v', '1', resolve(output, name)], { input: mosaic })
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
