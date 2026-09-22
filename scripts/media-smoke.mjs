import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Real file drops and real browser filesystem IO; only the OS folder picker is substituted. */
export const mediaSmoke = async (page, { fixture, directory, upload, sourceGraph, change, png, project }) => {
  await upload(sourceGraph)
  const smaller = resolve(directory, 'second-clip.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fixture.video, '-vf', 'hflip,scale=96:64', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', smaller])
  const first = await readFile(fixture.video), second = await readFile(smaller)
  const drop = async (selector, files) => {
    const transfer = await page.evaluateHandle(items => {
      const data = new DataTransfer()
      for (const item of items) data.items.add(new File([new Uint8Array(item.bytes)], item.name, { type: 'video/mp4' }))
      return data
    }, files.map(([name, bytes]) => ({ name, bytes: [...bytes] })))
    const box = await page.locator(selector).boundingBox()
    await page.locator(selector).dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })
    await transfer.dispose()
  }
  await change(() => drop('.graph-surface', [['first-copy.mp4', first], ['second-clip.mp4', second]]))
  let saved = await project()
  const sources = saved.nodes.filter(n => n.type === 'source')
  assert.equal(sources.length, 3)
  const secondNode = sources.find(n => n.assetName === 'second-clip.mp4'), copyNode = sources.find(n => n.assetName === 'first-copy.mp4')
  assert.ok(secondNode?.asset && copyNode?.asset)
  assert.notEqual(secondNode.asset, copyNode.asset)
  assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), 'n5', 'Dropping media must not retarget the inspector')
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Video Source' }).nth(2).click())
  assert.match(await page.locator('.view-options code').innerText(), /96 × 64/)
  const originalFrame = async () => change(() => page.locator('.step-strip button').filter({ hasText: 'Video Source' }).nth(0).click())
  await originalFrame()
  assert.match(await page.locator('.view-options code').innerText(), /192 × 128/)
  const untouched = await png()
  await change(() => drop(`.react-flow__node[data-id="${secondNode.id}"] .operation`, [['replacement.mp4', first]]))
  saved = await project()
  assert.equal(saved.nodes.filter(n => n.type === 'source').length, 3, 'Dropping on a source must not create another node')
  assert.equal(saved.nodes.find(n => n.id === secondNode.id).assetName, 'replacement.mp4')
  assert.deepEqual(await png(), untouched)
  await change(() => page.locator('.step-strip button').filter({ hasText: 'Video Source' }).nth(2).click())
  assert.match(await page.locator('.view-options code').innerText(), /192 × 128/)
  console.log('PASS: multi-file canvas drop, independent clip bindings, node-local replacement and source cache isolation')

  // OPFS supplies genuine FileSystemDirectoryHandle/FileSystemWritableFileStream objects.
  // The native OS chooser still requires a human click; the rest is production IO code.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    window.testFolderName = `cadence-smoke-${crypto.randomUUID()}`
    window.testFolder = await root.getDirectoryHandle(window.testFolderName, { create: true })
    window.showDirectoryPicker = async () => window.testFolder
  })
  await page.getByRole('button', { name: 'Project folder…', exact: true }).click()
  await page.waitForFunction(() => { const state = document.querySelector('[data-testid=folder-state]'); return state?.textContent.includes(window.testFolderName) && state?.textContent.includes('Saved') && state?.getAttribute('data-pending') === '0' })
  const disk = () => page.evaluate(async () => JSON.parse(await (await (await window.testFolder.getFileHandle('cadence-graph.json')).getFile()).text()))
  const diskGraph = await disk()
  assert.equal(diskGraph.nodes.length, saved.nodes.length)
  assert.equal(diskGraph.media.length, 3)
  assert.equal(new Set(diskGraph.media.map(m => m.id)).size, 3)
  for (const entry of diskGraph.media) {
    const size = await page.evaluate(async file => (await (await (await window.testFolder.getDirectoryHandle('media')).getFileHandle(file)).getFile()).size, entry.file)
    assert.equal(size, first.length)
  }
  // A layout edit autosaves without making a download.
  let downloads = 0
  const onDownload = () => downloads++
  page.on('download', onDownload)
  const initialX = diskGraph.nodes.find(n => n.id === secondNode.id).position.x
  const node = page.locator(`.react-flow__node[data-id="${secondNode.id}"] .operation-head`)
  await page.getByRole('button', { name: 'Fit View', exact: true }).click()
  await page.waitForTimeout(300)
  const box = await node.boundingBox()
  await page.mouse.move(box.x + 45, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 75, box.y + 35, { steps: 8 }); await page.mouse.up()
  await page.waitForFunction(async ({ id, x }) => {
    const doc = JSON.parse(await (await (await window.testFolder.getFileHandle('cadence-graph.json')).getFile()).text())
    return doc.nodes.find(n => n.id === id).position.x !== x
  }, { id: secondNode.id, x: initialX })
  await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
  await page.waitForFunction(async () => { try { return (await (await (await window.testFolder.getDirectoryHandle('exports')).getFileHandle('cadence-frame.png')).getFile()).size > 100 } catch { return false } })
  await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
  await page.waitForFunction(async () => { try { return (await (await (await window.testFolder.getDirectoryHandle('exports')).getFileHandle('cadence-frame-2.png')).getFile()).size > 100 } catch { return false } })
  await page.getByRole('button', { name: 'Save MP4 to folder', exact: true }).click()
  await page.waitForFunction(async () => { try { return (await (await (await window.testFolder.getDirectoryHandle('exports')).getFileHandle('cadence-output.mp4')).getFile()).size > 100 } catch { return false } })
  await page.waitForFunction(() => document.querySelector('.project-folder-strip')?.textContent.includes('Saved exports/cadence-output.mp4'))
  const movie = await page.evaluate(async () => {
    const dir = await window.testFolder.getDirectoryHandle('exports')
    const handle = await dir.getFileHandle('cadence-output.mp4')
    const file = await handle.getFile()
    return [...new Uint8Array(await file.arrayBuffer())]
  })
  assert.equal(Buffer.from(movie.slice(4, 8)).toString(), 'ftyp')
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', 'pipe:0'], { input: Buffer.from(movie) }).toString())
  assert.ok(Number(info.streams[0].nb_read_frames) >= 2)
  const lastGraph = await disk()
  // A browser reload clears in-memory Files, graph state and native caches.
  const folderName = await page.evaluate(() => window.testFolderName)
  await page.reload()
  await page.getByText('Engine ready', { exact: true }).waitFor({ timeout: 60000 })
  await page.evaluate(async name => {
    const root = await navigator.storage.getDirectory()
    window.testFolderName = name
    window.testFolder = await root.getDirectoryHandle(name)
    window.showDirectoryPicker = async () => window.testFolder
  }, folderName)
  // Reopening must load saved media and graph before starting autosave.
  await page.getByRole('button', { name: 'Project folder…', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.source-file strong')?.textContent.includes('.mp4') && document.querySelector('[data-testid=engine-status]')?.getAttribute('data-state') === 'idle')
  assert.equal((await disk()).nodes.length, lastGraph.nodes.length)
  await originalFrame()
  assert.deepEqual(await pngInFolder(page), untouched)
  assert.equal(downloads, 0)
  page.off('download', onDownload)
  // Verify an outside edit is preserved and surfaced to the user.
  await page.evaluate(async () => {
    const handle = await window.testFolder.getFileHandle('cadence-graph.json'), stream = await handle.createWritable()
    await stream.write('{"external":true}'); await stream.close()
  })
  await page.getByRole('button', { name: 'Save now', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'changed outside' }).waitFor()
  assert.deepEqual(await disk(), { external: true })
  console.log('PASS: folder media copies, graph autosave, project reopen, PNG export retention and external edit conflict protection (real browser filesystem; picker stubbed)')
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); await root.removeEntry(window.testFolderName, { recursive: true }) })
}

const pngInFolder = async page => {
  await page.getByRole('button', { name: 'Save PNG', exact: true }).click()
  await page.waitForFunction(async () => { try { return (await (await (await window.testFolder.getDirectoryHandle('exports')).getFileHandle('cadence-frame-3.png')).getFile()).size > 100 } catch { return false } })
  await page.waitForFunction(() => document.querySelector('.project-folder-strip')?.textContent.includes('Saved exports/cadence-frame-3.png'))
  const bytes = await page.evaluate(async () => {
    const dir = await window.testFolder.getDirectoryHandle('exports')
    const handle = await dir.getFileHandle('cadence-frame-3.png')
    const file = await handle.getFile()
    return [...new Uint8Array(await file.arrayBuffer())]
  })
  assert.deepEqual(bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10], 'Saved PNG has a valid signature')
  return execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { input: Buffer.from(bytes), maxBuffer: 8 * 1024 ** 2 })
}
