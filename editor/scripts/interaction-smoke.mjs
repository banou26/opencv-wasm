import assert from 'node:assert/strict'

/** A held gesture must keep seeking across re-renders, even outside the slider. */
export const timelineSmoke = async page => {
  const slider = page.getByRole('slider', { name: 'Timeline', exact: true }), inspector = page.locator('.inspect-panel')
  const box = await slider.boundingBox(), max = Number(await slider.getAttribute('max'))
  const x = fraction => box.x + 7 + (box.width - 14) * fraction, y = box.y + box.height / 2
  const rendered = new Set()
  await page.mouse.move(x(0.1), y); await page.mouse.down()
  try {
    for (const fraction of [0.25, 0.45, 0.7, 0.9, 0.6]) {
      await page.mouse.move(x(fraction), y, { steps: 12 })
      assert.equal(Number(await slider.inputValue()), Math.round(max * fraction), 'The frame follows the pointer before release')
      rendered.add(await inspector.getAttribute('data-computed-frame'))
    }
    assert.ok(rendered.size > 1, 'The inspector must update during continuous movement, without waiting for release')
    await page.mouse.move(x(0.35), y - 60, { steps: 12 })
    assert.equal(Number(await slider.inputValue()), Math.round(max * 0.35), 'Leaving the track vertically must keep scrubbing')
    await page.mouse.move(x(1) + 30, y - 60, { steps: 6 })
    assert.equal(Number(await slider.inputValue()), max, 'Clamp at the final frame')
    await page.mouse.move(x(0) - 30, y - 60, { steps: 12 })
    assert.equal(Number(await slider.inputValue()), 0, 'Clamp at the first frame')
  } finally { await page.mouse.up() }
  await page.mouse.move(x(0.8), y)
  assert.equal(Number(await slider.inputValue()), 0, 'Releasing the pointer must stop seeking')
  await slider.press('End'); assert.equal(Number(await slider.inputValue()), max)
  await slider.press('ArrowLeft'); assert.equal(Number(await slider.inputValue()), max - 1)
  await slider.press('Home'); assert.equal(Number(await slider.inputValue()), 0)
  await slider.press('ArrowRight'); assert.equal(Number(await slider.inputValue()), 1)
  const subframe = page.getByRole('slider', { name: 'Subframe fraction' }), subbox = await subframe.boundingBox()
  await page.mouse.move(subbox.x + 7, subbox.y + subbox.height / 2); await page.mouse.down()
  try {
    await page.mouse.move(subbox.x + subbox.width - 7, subbox.y - 30, { steps: 12 })
    assert.equal(Number(await subframe.inputValue()), 0.95)
    assert.equal(await page.getByTestId('frame-time').innerText(), '1.950')
    await page.mouse.move(subbox.x + 7, subbox.y - 30, { steps: 12 })
    assert.equal(Number(await subframe.inputValue()), 0)
  } finally { await page.mouse.up() }
  await slider.press('Home')
  await page.waitForFunction(() => document.querySelector('.inspect-panel')?.getAttribute('data-computed-frame') === '0' && document.querySelector('[data-testid=engine-status]')?.getAttribute('data-state') === 'idle')
  assert.deepEqual(await page.getByRole('alert').allTextContents(), [])
  console.log('PASS: continuous timeline and subframe scrubbing, live previews, outside-track capture, bounds, release and keyboard seeking')
}

/** Exercise the exact surfaces users grab, including an actual rendered preview canvas. */
export const dragSmoke = async (page, project) => {
  await project()
  await page.getByRole('button', { name: 'Fit View', exact: true }).click()
  const node = page.locator('.react-flow__node[data-id="n1"]')
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-n1] canvas')?.width === 320)
  for (const surface of ['.operation-head strong', '.node-preview-toolbar > span', '.node-thumbnail canvas']) {
    const before = (await project()).nodes.find(n => n.id === 'n1').position
    // Wait for Fit View and preview sizing to settle before taking drag coordinates.
    await node.locator(surface === '.node-thumbnail canvas' ? '.node-thumbnail' : surface).hover()
    const header = await node.locator(surface).boundingBox()
    const x = header.x + Math.min(15, header.width / 2), y = header.y + header.height / 2
    await page.mouse.move(x, y); await page.mouse.down()
    await page.mouse.move(x + 45, y + 25, { steps: 12 })
    const whileDragging = await node.boundingBox()
    await page.mouse.up()
    const after = (await project()).nodes.find(n => n.id === 'n1').position
    assert.ok(after.x > before.x + 10 && after.y > before.y + 10, `${surface} must move the saved node position`)
    const released = await node.boundingBox()
    assert.ok(Math.abs(released.x - whileDragging.x) < 2 && Math.abs(released.y - whileDragging.y) < 2, 'Releasing the header must not snap the node back')
  }
  const beforeToggle = (await project()).nodes.find(n => n.id === 'n1').position
  await node.getByRole('button', { name: 'Hide Video Source preview' }).click()
  await node.getByRole('button', { name: 'Show Video Source preview' }).click()
  assert.deepEqual((await project()).nodes.find(n => n.id === 'n1').position, beforeToggle)
  console.log('PASS: title, preview bar and rendered preview drag; saved positions persist and preview buttons remain clickable')
}

/** Graph selection, context menus and insertion must not retarget the inspector. */
export const previewSelectionSmoke = async (page, change) => {
  const inspector = page.locator('.inspect-panel'), source = page.locator('.react-flow__node[data-id="n1"]')
  assert.equal(await inspector.getAttribute('data-selected'), 'n5')
  await source.locator('.operation-head').click()
  assert.equal(await inspector.getAttribute('data-selected'), 'n5')
  assert.equal(await inspector.getAttribute('data-computed-node'), 'n5')
  await source.locator('.operation-head').click({ button: 'right' })
  assert.equal(await inspector.getAttribute('data-selected'), 'n5', 'Opening the context menu must not change the preview')
  await change(() => page.getByRole('button', { name: 'Select for preview', exact: true }).click())
  assert.equal(await inspector.getAttribute('data-selected'), 'n1')
  assert.match(await inspector.locator('h2').innerText(), /Video Source/)
  const output = page.locator('.react-flow__node[data-id="n5"]')
  await output.locator('.operation-head').click()
  assert.equal(await inspector.getAttribute('data-selected'), 'n1')
  const pane = page.locator('.react-flow__pane')
  await pane.click({ button: 'right', position: { x: 25, y: 25 } })
  await page.getByLabel('Search nodes').fill('Number')
  await change(() => page.getByRole('option').filter({ hasText: /^Number/ }).click())
  assert.equal(await inspector.getAttribute('data-selected'), 'n1', 'Adding a node must preserve the preview target')
  const selected = page.locator('.react-flow__node.selected')
  assert.equal(await selected.getAttribute('data-id') === 'n1', false, 'Graph focus should select the new node independently')
  await selected.locator('.operation-head').click({ button: 'right' })
  await change(() => page.getByRole('button', { name: 'Delete', exact: true }).click())
  assert.equal(await inspector.getAttribute('data-selected'), 'n1')
  await output.locator('.operation-head').click({ button: 'right' })
  await change(() => page.getByRole('button', { name: 'Select for preview', exact: true }).click())
  assert.equal(await inspector.getAttribute('data-selected'), 'n5')
  await page.getByRole('button', { name: 'Rendered video', exact: true }).click()
  await output.locator('.operation-head').click({ button: 'right' })
  await page.getByRole('button', { name: 'Select for preview', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Node preview', exact: true }).getAttribute('aria-pressed'), 'true', 'Selecting the same node for preview must return from the video panel')
  console.log('PASS: graph click, context menu, insert and delete preserve the inspector; Select for preview explicitly retargets it')
}
