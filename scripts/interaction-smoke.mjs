import assert from 'node:assert/strict'

/** Exercise the exact surfaces users grab, including an actual rendered preview canvas. */
export const dragSmoke = async (page, project) => {
  await project()
  await page.getByRole('button', { name: 'Fit View', exact: true }).click()
  const node = page.locator('.react-flow__node[data-id="n1"]')
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-n1] canvas')?.width === 320)
  for (const surface of ['.operation-head strong', '.node-preview-toolbar > span', '.node-thumbnail canvas']) {
    const before = (await project()).nodes.find(n => n.id === 'n1').position
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
  console.log('PASS: graph click, context menu, insert and delete preserve the inspector; Select for preview explicitly retargets it')
}
