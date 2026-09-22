import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { movieFile, render } from './generation-smoke.mjs'

/** Compare every decoded output frame, including order, for identical render settings. */
export const compareWorkerMovies = async (page, directory, label, counts = [1, 2, 4]) => {
  let reference
  for (const workers of counts) {
    await page.getByLabel('Render workers', { exact: true }).selectOption(String(workers))
    await render(page)
    const file = resolve(directory, `${label}-${workers}-workers.mp4`), info = await movieFile(page, file)
    assert.equal(info.nb_read_frames, '8')
    assert.match(await page.locator('.movie-caption').innerText(), new RegExp(`${workers} compute worker`))
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'framemd5', '-'], { encoding: 'utf8' })
    reference ??= pixels
    assert.equal(pixels, reference, `Every ${label} frame must match across worker counts`)
  }
  await page.getByLabel('Render workers', { exact: true }).selectOption('0')
  await page.getByRole('button', { name: 'Node preview', exact: true }).click()
}

/** Exercise real worker creation, cancellation, error cleanup and a fresh successful render. */
export const parallelSmoke = async (page, { directory, project, upload }) => {
  const saved = await project(), session = await page.context().newCDPSession(page), seen = new Set()
  const record = ({ targetInfo }) => { if (targetInfo.type === 'worker' && /render\.worker/.test(targetInfo.url)) seen.add(targetInfo.targetId) }
  session.on('Target.targetCreated', record); session.on('Target.targetInfoChanged', record)
  await session.send('Target.setDiscoverTargets', { discover: true })
  const cleaned = async () => {
    for (let i = 0; i < 100; i++) {
      const { targetInfos } = await session.send('Target.getTargets')
      if (!targetInfos.some(target => target.type === 'worker' && /render\.worker/.test(target.url))) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Render workers survived completion/cancellation/error')
  }
  try {
    assert.equal(await page.getByLabel('Render workers', { exact: true }).inputValue(), '0')
    await compareWorkerMovies(page, directory, 'procedural-parallel')
    assert.ok(seen.size >= 6, 'Two-worker and four-worker renders must create actual workers')
    await cleaned()
    const previous = await page.locator('.frame-player').getAttribute('data-src')
    await page.getByLabel('Render workers', { exact: true }).selectOption('4')
    await page.getByRole('button', { name: 'Render video', exact: false }).click()
    await page.waitForFunction(() => {
      const progress = document.querySelector('progress'), button = document.querySelector('.render-action button.danger')
      if (!progress || progress.value !== 0 || !button || button.disabled) return false
      button.click(); return true
    })
    await page.waitForFunction(() => document.querySelector('[data-testid=engine-status]').dataset.state === 'idle')
    assert.equal(await page.locator('.frame-player').getAttribute('data-src'), previous, 'Cancelling worker initialization must retain the prior movie')
    await cleaned()
    // PNG inspection accepts odd dimensions, but the MP4 encoder must report a
    // useful error and stop all producers. Restore the graph and render again.
    const odd = structuredClone(saved); odd.nodes.find(n => n.id === 'nwidth').params.value = 193
    await upload(odd)
    await page.getByRole('button', { name: 'Render video', exact: false }).click()
    await page.getByRole('alert').filter({ hasText: 'even image width and height' }).waitFor()
    await cleaned()
    await upload(saved)
    await compareWorkerMovies(page, directory, 'after-render-error', [2])
    await cleaned()
    await page.getByLabel('Render fps').selectOption('60')
    console.log('PASS: 1/2/4 actual workers produce identical generated frames; startup cancellation, failure cleanup and recovery')
  } finally { await session.detach() }
}
