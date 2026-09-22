import assert from 'node:assert/strict'
import { resolve } from 'node:path'

/** Check reachability as well as document overflow: hiding a clipped toolbar is not a fix. */
export const assertViewport = async (page, selectors = []) => {
  const measured = await page.evaluate(selectors => {
    const rect = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    return {
      width: innerWidth, height: innerHeight,
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      body: [document.body.scrollWidth, document.body.scrollHeight],
      shell: [document.querySelector('.app-shell').scrollWidth, document.querySelector('.app-shell').scrollHeight],
      elements: selectors.map(selector => ({ selector, ...rect(document.querySelector(selector)) })),
    }
  }, selectors)
  for (const name of ['document', 'body', 'shell']) {
    assert.ok(measured[name][0] <= measured.width + 1 && measured[name][1] <= measured.height + 1, `${name} overflows at ${measured.width}×${measured.height}: ${measured[name]}`)
  }
  for (const box of measured.elements) {
    assert.ok(box.width > 0 && box.height > 0 && box.x >= -1 && box.y >= -1 && box.right <= measured.width + 1 && box.bottom <= measured.height + 1, `${box.selector} is clipped: ${JSON.stringify(box)}`)
  }
}

export const layoutSmoke = async (page, directory) => {
  const original = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const canvas = await page.locator('.image-viewport canvas').elementHandle()
  const selected = await page.locator('.inspect-panel').getAttribute('data-selected')
  const fixed = ['.app-header', '.source-strip', '.workspace', '.timeline', '.render-controls', '[aria-label="Render quality"]', '[aria-label="Render workers"]', '.render-action', 'footer']
  for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [1280, 600], [800, 700], [390, 844]]) {
    await page.setViewportSize({ width, height })
    if (width <= 900) await page.getByRole('button', { name: 'Node graph', exact: true }).click()
    await assertViewport(page, [...fixed, '.graph-surface', '.graph-bottom'])
    const graph = await page.locator('.graph-surface').boundingBox()
    assert.ok(graph.height > 100, `Graph must retain usable space at ${width}×${height}`)
    if (width <= 900) await page.getByRole('button', { name: 'Inspector', exact: true }).click()
    await page.getByRole('button', { name: 'Node preview', exact: true }).click()
    await assertViewport(page, [...fixed, '.image-viewport', '.preview-tools', '.pixel-bar', '.view-options', '.node-details summary'])
    const preview = await page.locator('.image-viewport').boundingBox()
    assert.ok(preview.height > 32, `Preview must retain space at ${width}×${height}`)
    await page.locator('.node-details summary').click()
    await assertViewport(page, ['.node-explanation'])
    assert.equal((await page.locator('.image-viewport').boundingBox()).height, preview.height, 'Expanding explanations must not squeeze out the image')
    await page.locator('.node-details summary').click()
    if (width === 1366) await page.screenshot({ path: resolve(directory, 'layout-laptop.png') })
    await page.getByRole('button', { name: 'View video', exact: true }).click()
    await assertViewport(page, [...fixed, '.output-surface', '.output-transport', '.output-transport .timeline-slider', '.movie-caption', '.movie-caption button'])
    if (width === 1366) await page.screenshot({ path: resolve(directory, 'layout-video.png') })
    if (width === 390) await page.screenshot({ path: resolve(directory, 'layout-narrow.png') })
    assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), selected, 'Switching view panels preserves the preview target')
    await page.getByRole('button', { name: 'Node preview', exact: true }).click()
    assert.ok(await canvas.evaluate(element => element === document.querySelector('.image-viewport canvas')), 'The transferred WebGPU canvas must not be replaced when switching views')
  }
  // An expanded custom interface scrolls on its own while its graph remains usable.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.locator('.react-flow__node[data-id="n3"]').getByRole('button', { name: 'Edit internal nodes' }).click()
  await page.getByLabel('Custom node name').waitFor()
  await assertViewport(page, [...fixed, '.interface-editor', '.graph-surface'])
  const interfaceBox = await page.locator('.interface-editor').boundingBox()
  const graphBox = await page.locator('.graph-surface').boundingBox()
  assert.ok(graphBox.height > 100 && interfaceBox.height < graphBox.height, 'Custom interface must leave space for editing its graph')
  await page.getByRole('button', { name: 'Media details ⓘ', exact: true }).click()
  await assertViewport(page, [...fixed, '.workspace-notices'])
  await page.getByRole('button', { name: 'Hide details ⓘ', exact: true }).click()
  await page.getByRole('tab', { name: 'Main graph', exact: true }).click()
  await page.setViewportSize(original)
  await canvas.dispose()
  console.log('PASS: viewport fit, accessible docked controls, scoped panel scrolling and persistent preview canvas at six window sizes')
}
