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

const capture = async (page, change, frame, completion = false) => {
  if (Number(await page.getByLabel('Source frame', { exact: true }).inputValue()) !== frame) await change(() => page.getByLabel('Source frame', { exact: true }).fill(String(frame)))
  if (await page.getByLabel('Output socket').inputValue() !== 'out:string:summary') await change(() => page.getByLabel('Output socket').selectOption('out:string:summary'))
  const summary = await page.locator('.value-preview pre').innerText()
  const geometry = summary.match(/(\d+) x (\d+) display \/ (\d+) x (\d+) analysis/)
  const counts = summary.match(completion ? /Cells: measured (\d+); inferred holes (\d+); inferred edge (\d+); unknown (\d+)/ : /Candidate cells: (\d+); grouped cells: (\d+); temporal filtering: none/)
  const size = Number(summary.match(/cell size (\d+)/i)?.[1])
  assert(geometry && counts && Number.isSafeInteger(size) && size > 0)
  if (!completion) assert.equal(counts[1], counts[2], `Source ${frame}: candidate support must be conserved`)
  const [, width, height, analysisWidth, analysisHeight] = geometry.map(Number)
  const groups = [...summary.matchAll(/^Group (\d+):/gm)].map(match => Number(match[1])), rasters = {}
  for (const port of completion ? ['source', 'measured', 'completed', 'provenance'] : ['source', 'candidates', 'groups', 'confidence']) {
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
    const original = Array.from(rasters.source.subarray(pixel, pixel + 3)), grouped = Array.from(rasters[completion ? 'completed' : 'groups'].subarray(pixel, pixel + 3))
    if (grouped.every((channel, index) => channel === original[index])) return { cell, label: -1 }
    const matches = groups.filter(id => [.38, .6].some(alpha => color(id).every((channel, index) => Math.abs(grouped[index] - Math.round(original[index] * (1 - alpha) + channel * alpha)) <= 1)))
    assert.equal(matches.length, 1, `Source ${frame} cell ${cell}: diagnostic group color must be uniquely decodable`)
    return { cell, label: matches[0] }
  }
  return { summary, width, height, analysisWidth, analysisHeight, size, columns, cells, rasters, labelAt,
    counts: completion ? { measured: Number(counts[1]), holes: Number(counts[2]), border: Number(counts[3]), unknown: Number(counts[4]) } : undefined }
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

/** Compare measured versus inferred support using the completion inspector's native exports. */
export async function checkSupportCompletion({ page, change, output, prefix, cases }) {
  const select = async () => {
    if (await page.locator('.inspect-panel').getAttribute('data-selected') !== 'ncompletionview') await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Direct Completion' }).click())
  }
  await select()
  const controls = ['Fill enclosed holes', 'Extend to edges'].map(label => page.getByLabel(`Complete Direct Support ${label}`, { exact: true }))
  const setEnabled = async enabled => { for (const control of controls) if (await control.isChecked() !== enabled) await change(() => control.setChecked(enabled)) }
  const records = [], provenanceColors = [[150, 150, 165], [240, 178, 72], [66, 220, 183]]
  const save = status => writeFile(resolve(output, `${prefix}-support-browser.json`), `${JSON.stringify({ status, description: 'Native completion PNG exports with both fill controls disabled/enabled. Measured pixels and IDs stay fixed; each newly assigned cell must have explicit hole or edge provenance.', records }, null, 2)}\n`)
  try {
    for (const sample of cases) {
      await setEnabled(false)
      const before = await capture(page, change, sample.frame, true)
      assert(before.rasters.measured.equals(before.rasters.completed), `Source ${sample.frame}: disabled completion must equal measured support`)
      assert.equal(before.counts.holes, 0); assert.equal(before.counts.border, 0)
      await setEnabled(true)
      const after = await capture(page, change, sample.frame, true)
      assert.deepEqual([before.width, before.height, before.analysisWidth, before.analysisHeight, before.size], [after.width, after.height, after.analysisWidth, after.analysisHeight, after.size])
      for (const port of ['source', 'measured']) assert(before.rasters[port].equals(after.rasters[port]), `Source ${sample.frame}: filling must not alter ${port}`)
      const known = new Set([...before.summary.matchAll(/^Group (\d+):/gm)].map(match => Number(match[1])))
      const counts = { measured: 0, holes: 0, border: 0, unknown: 0 }, additions = []
      let measuredPixels = 0, changedMeasuredPixels = 0
      for (let cell = 0; cell < after.cells; cell++) {
        const raw = before.labelAt(cell).label, completed = after.labelAt(cell).label
        const x = cell % after.columns * after.size, y = Math.floor(cell / after.columns) * after.size
        const px = Math.floor(Math.min(after.analysisWidth - .5, x + after.size / 2) * after.width / after.analysisWidth)
        const py = Math.floor(Math.min(after.analysisHeight - .5, y + after.size / 2) * after.height / after.analysisHeight), pixel = (py * after.width + px) * 3
        const source = Array.from(after.rasters.source.subarray(pixel, pixel + 3)), marked = Array.from(after.rasters.provenance.subarray(pixel, pixel + 3))
        let provenance = 0
        if (!marked.every((channel, index) => channel === source[index])) {
          const matches = provenanceColors.flatMap((rgb, index) => rgb.every((channel, c) => Math.abs(marked[c] - Math.round(source[c] * .4 + channel * .6)) <= 1) ? [index + 1] : [])
          assert.equal(matches.length, 1, `Source ${sample.frame} cell ${cell}: provenance must be uniquely decodable`)
          provenance = matches[0]
        }
        if (raw >= 0) {
          assert.equal(completed, raw, `Source ${sample.frame} cell ${cell}: measured ID changed`)
          assert.equal(provenance, 1, `Source ${sample.frame} cell ${cell}: measured provenance changed`)
          counts.measured++
          const left = Math.ceil(x * after.width / after.analysisWidth), right = Math.min(after.width, Math.ceil((x + after.size) * after.width / after.analysisWidth))
          const top = Math.ceil(y * after.height / after.analysisHeight), bottom = Math.min(after.height, Math.ceil((y + after.size) * after.height / after.analysisHeight))
          for (let iy = top; iy < bottom; iy++) for (let ix = left; ix < right; ix++) {
            const p = (iy * after.width + ix) * 3
            measuredPixels++
            if ([0, 1, 2].some(c => after.rasters.completed[p + c] !== before.rasters.measured[p + c])) changedMeasuredPixels++
          }
        } else if (completed >= 0) {
          assert(known.has(completed), `Source ${sample.frame} cell ${cell}: completion invented a group ID`)
          assert(provenance === 2 || provenance === 3, `Source ${sample.frame} cell ${cell}: inference needs explicit provenance`)
          counts[provenance === 2 ? 'holes' : 'border']++
          additions.push({ cell, label: completed, provenance })
        } else { assert.equal(provenance, 0); counts.unknown++ }
      }
      const name = `${prefix}-support-${String(sample.frame).padStart(3, '0')}.png`
      saveSheet(after, output, name)
      const record = { frame: sample.frame, counts, measuredPixels, changedMeasuredPixels, additions, beforeSummary: before.summary, afterSummary: after.summary, image: name }
      records.push(record); await save('incomplete')
      assert.deepEqual(counts, after.counts, `Source ${sample.frame}: pixel-derived completion counts differ from summary`)
      assert.equal(changedMeasuredPixels, 0, `Source ${sample.frame}: measured pixels must remain identical`)
      if (sample.minimumHoles !== undefined) assert(counts.holes >= sample.minimumHoles)
      if (sample.minimumBorder !== undefined) assert(counts.border >= sample.minimumBorder)
      console.log(`Support source ${sample.frame}: measured ${counts.measured}, holes ${counts.holes}, edge ${counts.border}, unknown ${counts.unknown}; ${measuredPixels} measured pixels unchanged`)
    }
    await save('passed')
    return records
  } finally { await setEnabled(true); await select() }
}

/** Read-only neighboring-frame evidence for transient edge holes; do not alter analysis controls. */
export async function captureSupportFlashes({ page, change, output, prefix, frames }) {
  assert(frames.length > 0 && frames.every(frame => Number.isSafeInteger(frame) && frame >= 0))
  const records = [], settings = {
    analysisMaxSide: Number(await page.getByLabel('Scene Range Analysis max side', { exact: true }).inputValue()),
    verifyBorders: await page.getByLabel('Scene Vector Candidates Verify border vectors', { exact: true }).isChecked(),
    tolerance: Number(await page.getByLabel('Frame Velocity Groups Maximum velocity radius', { exact: true }).inputValue()),
    splitSubtleMotion: await page.getByLabel('Frame Velocity Groups Separate subtle motion', { exact: true }).isChecked(),
    splitDistantRegions: await page.getByLabel('Frame Velocity Groups Separate distant regions', { exact: true }).isChecked(),
    proximityGap: Number(await page.getByLabel('Frame Velocity Groups Foreground gap (cells)', { exact: true }).inputValue()),
    fillHoles: await page.getByLabel('Complete Direct Support Fill enclosed holes', { exact: true }).isChecked(),
    fillEdges: await page.getByLabel('Complete Direct Support Extend to edges', { exact: true }).isChecked(),
    edgeReach: Number(await page.getByLabel('Complete Direct Support Edge reach (cells)', { exact: true }).inputValue()),
  }
  const save = status => writeFile(resolve(output, `${prefix}-flash-browser.json`), `${JSON.stringify({ status, description: 'Read-only native PNG evidence across neighboring source frames. Same-cell changes are raster diagnostics, not tracked layer identities. No analysis or completion settings are changed.', settings, records }, null, 2)}\n`)
  for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
    if (await page.locator('.inspect-panel').getAttribute('data-selected') !== 'nview') await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Direct Motion' }).last().click())
    const raw = await capture(page, change, frame)
    await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Direct Completion' }).click())
    const completed = await capture(page, change, frame, true)
    assert(raw.rasters.source.equals(completed.rasters.source), `Source ${frame}: raw/completed source pixels differ`)
    assert(raw.rasters.groups.equals(completed.rasters.measured), `Source ${frame}: completion changed the raw group display`)
    const cells = Array.from({ length: raw.cells }, (_, cell) => ({ cell, raw: raw.labelAt(cell).label, completed: completed.labelAt(cell).label }))
    for (const cell of cells) if (cell.raw >= 0) assert.equal(cell.completed, cell.raw, `Source ${frame} cell ${cell.cell}: completion changed measured ownership`)
    const rows = Math.ceil(raw.analysisHeight / raw.size), columns = raw.columns
    const edgeCells = {
      left: cells.filter(cell => cell.cell % columns === 0), right: cells.filter(cell => cell.cell % columns === columns - 1),
      top: cells.slice(0, columns), bottom: cells.slice((rows - 1) * columns),
    }
    const edges = Object.fromEntries(Object.entries(edgeCells).map(([edge, selected]) => [edge, {
      cells: selected.length, rawUnknown: selected.filter(cell => cell.raw < 0).length, completedUnknown: selected.filter(cell => cell.completed < 0).length,
      completedGroups: Object.fromEntries([...new Set(selected.map(cell => cell.completed).filter(label => label >= 0))].map(label => [label, selected.filter(cell => cell.completed === label).length])),
      unknownCells: selected.filter(cell => cell.completed < 0).map(cell => cell.cell),
    }]))
    const names = [`${prefix}-flash-${String(frame).padStart(3, '0')}-raw.png`, `${prefix}-flash-${String(frame).padStart(3, '0')}-completed.png`]
    saveSheet(raw, output, names[0]); saveSheet(completed, output, names[1])
    const previous = records.at(-1)
    const unknownChange = previous ? { fromFrame: previous.frame,
      appeared: cells.filter(cell => cell.completed < 0 && previous.cells[cell.cell]?.completed >= 0).map(cell => cell.cell),
      disappeared: cells.filter(cell => cell.completed >= 0 && previous.cells[cell.cell]?.completed < 0).map(cell => cell.cell) } : undefined
    records.push({ frame, width: raw.width, height: raw.height, columns, rows, counts: completed.counts, edges, cells, unknownChange, rawSummary: raw.summary, completionSummary: completed.summary, images: names })
    await save('incomplete')
    console.log(`Edge probe source ${frame}: ${Object.entries(edges).map(([edge, counts]) => `${edge} ${counts.completedUnknown}/${counts.cells} unknown`).join('; ')}`)
  }
  await save('passed')
  return records
}

/** Border verification may refine velocities, not delete candidates or absorb observed foreground. */
export async function checkBorderRefinement({ page, change, output, prefix, cases }) {
  const control = page.getByLabel('Scene Vector Candidates Verify border vectors', { exact: true }), records = []
  const setEnabled = async enabled => { if (await control.isChecked() !== enabled) await change(() => control.setChecked(enabled)) }
  const select = async () => { if (await page.locator('.inspect-panel').getAttribute('data-selected') !== 'nview') await change(() => page.locator('.step-strip button').filter({ hasText: 'Inspect Direct Motion' }).last().click()) }
  const save = status => writeFile(resolve(output, `${prefix}-border-browser.json`), `${JSON.stringify({ status, description: 'Native browser PNGs compare observed-pixel border verification disabled/enabled. Candidate coverage, confidence, dominant-background membership and every uncorrected-cell partition must remain intact, allowing foreground IDs to renumber. Fixed cells are test controls, not segmentation inputs.', records }, null, 2)}\n`)
  try {
    await select()
    for (const sample of cases) {
      await setEnabled(false)
      const before = await capture(page, change, sample.frame)
      await setEnabled(true)
      const after = await capture(page, change, sample.frame)
      assert.match(before.summary, /Border vector verification: disabled/)
      assert.match(after.summary, /Border vector verification: enabled/)
      assert.deepEqual([before.width, before.height, before.analysisWidth, before.analysisHeight, before.size], [after.width, after.height, after.analysisWidth, after.analysisHeight, after.size])
      for (const port of ['source', 'confidence']) assert(before.rasters[port].equals(after.rasters[port]), `Source ${sample.frame}: border verification changed ${port}`)
      const cells = Array.from({ length: before.cells }, (_, cell) => ({ cell, before: before.labelAt(cell).label, after: after.labelAt(cell).label }))
      for (const item of cells) {
        assert.equal(item.before >= 0, item.after >= 0, `Source ${sample.frame} cell ${item.cell}: verification changed candidate coverage`)
        if (item.before === 0) assert.equal(item.after, 0, `Source ${sample.frame} cell ${item.cell}: verification changed dominant background`)
      }
      const actualCorrections = [...after.summary.matchAll(/^Border cell (\d+):/gm)].map(match => Number(match[1]))
      const correctedSet = new Set(actualCorrections), beforeToAfter = new Map(), afterToBefore = new Map()
      assert.equal(actualCorrections.length, correctedSet.size, 'Correction evidence must list each cell once')
      for (const cell of actualCorrections) assert(cells[cell]?.before >= 0, `Source ${sample.frame}: a corrected cell must have an original candidate`)
      for (const item of cells) {
        if (item.before < 0 || correctedSet.has(item.cell)) continue
        if (beforeToAfter.has(item.before)) assert.equal(item.after, beforeToAfter.get(item.before), `Source ${sample.frame} cell ${item.cell}: verification split an uncorrected group`)
        if (afterToBefore.has(item.after)) assert.equal(item.before, afterToBefore.get(item.after), `Source ${sample.frame} cell ${item.cell}: verification merged uncorrected groups`)
        beforeToAfter.set(item.before, item.after); afterToBefore.set(item.after, item.before)
      }
      const corrected = sample.correctedCells.map(cell => cells[cell])
      for (const item of corrected) {
        assert(item && item.before > 0, `Source ${sample.frame}: correction control must begin outside background`)
        assert.equal(item.after, 0, `Source ${sample.frame} cell ${item.cell}: border artifact was not corrected`)
      }
      const foreground = (sample.foregroundCells ?? []).map(cell => cells[cell])
      assert(foreground.every(item => item && item.before > 0 && item.after > 0), `Source ${sample.frame}: foreground control was missing or absorbed`)
      for (const a of foreground) for (const b of foreground) assert.equal(a.before === b.before, a.after === b.after, `Source ${sample.frame}: foreground partition changed`)
      const names = ['off', 'on'].map(mode => `${prefix}-border-${String(sample.frame).padStart(3, '0')}-${mode}.png`)
      saveSheet(before, output, names[0]); saveSheet(after, output, names[1])
      const backgroundCells = cells.filter(cell => cell.before === 0).length
      records.push({ frame: sample.frame, corrected, actualCorrections, preservedPartitions: Object.fromEntries(beforeToAfter), foreground, candidateCells: cells.filter(cell => cell.before >= 0).length, backgroundCells, beforeSummary: before.summary, afterSummary: after.summary, images: names })
      await save('incomplete')
      console.log(`Border source ${sample.frame}: ${corrected.length} artifact controls corrected; ${foreground.length} foreground controls and ${backgroundCells} background cells preserved`)
    }
    await save('passed')
    return records
  } finally { await setEnabled(true); await select() }
}
