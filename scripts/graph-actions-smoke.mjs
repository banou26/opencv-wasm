import assert from 'node:assert/strict'
import { resolve } from 'node:path'

export const graphActionsSmoke = async (page, { upload, project, sourceGraph, directory }) => {
  const graph = {
    ...sourceGraph,
    nodes: [...sourceGraph.nodes, { id: 'na', type: 'constant', params: { value: 2 }, position: { x: 40, y: 540 } }, { id: 'nb', type: 'multiply', params: { factor: 3 }, position: { x: 350, y: 540 } }],
    edges: [...sourceGraph.edges, { id: 'e:nb:in:scalar:a', source: 'na', sourceHandle: 'out:scalar:value', target: 'nb', targetHandle: 'in:scalar:a' }],
  }
  await upload(graph)
  const a = page.locator('.react-flow__node[data-id="na"]'), b = page.locator('.react-flow__node[data-id="nb"]'), pane = page.locator('.react-flow__pane')
  const selectedIds = () => page.locator('.react-flow__node.selected').evaluateAll(nodes => nodes.map(n => n.dataset.id).sort())
  const selectPair = async () => {
    await pane.click({ position: { x: 10, y: 10 } })
    await a.locator('.operation-head').click()
    await b.locator('.operation-head').click({ modifiers: ['Shift'] })
    assert.deepEqual(await selectedIds(), ['na', 'nb'])
  }
  const undo = async () => {
    await page.getByLabel('Node editor', { exact: true }).focus()
    await page.keyboard.press('Control+z')
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4)
    const restored = await project()
    assert.deepEqual(restored.nodes, graph.nodes)
    assert.deepEqual(restored.edges, graph.edges, 'One undo must restore the selection and all its connections')
  }
  const checkDeleted = async () => {
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2)
    const saved = await project()
    assert.deepEqual(saved.nodes, sourceGraph.nodes, 'Unselected nodes stay in place')
    assert.deepEqual(saved.edges, sourceGraph.edges, 'Only connections involving the removed nodes disappear')
    assert.equal(await page.locator('.inspect-panel').getAttribute('data-selected'), 'n5')
  }
  for (const context of ['node', 'canvas']) {
    await selectPair()
    if (context === 'node') await a.locator('.operation-head').click({ button: 'right' })
    else await pane.click({ button: 'right', position: { x: 10, y: 10 } })
    assert.deepEqual(await selectedIds(), ['na', 'nb'], 'Right-click keeps the multi-selection')
    await page.getByRole('button', { name: 'Delete selected nodes (2)', exact: true }).click()
    await checkDeleted(); await undo()
  }
  // Shift-drag creates React Flow's separate selection overlay, which needs its own menu handler.
  await pane.click({ position: { x: 10, y: 10 } })
  const first = await a.boundingBox(), second = await b.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(Math.min(first.x, second.x) - 8, Math.min(first.y, second.y) - 8)
  await page.mouse.down()
  await page.mouse.move(Math.max(first.x + first.width, second.x + second.width) + 8, Math.max(first.y + first.height, second.y + second.height) + 8, { steps: 12 })
  await page.mouse.up(); await page.keyboard.up('Shift')
  assert.deepEqual(await selectedIds(), ['na', 'nb'])
  await page.locator('.react-flow__nodesselection-rect').click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete selected nodes (2)', exact: true }).waitFor()
  await page.screenshot({ path: resolve(directory, 'multi-selection-menu.png') })
  await page.getByRole('button', { name: 'Delete selected nodes (2)', exact: true }).click()
  await checkDeleted(); await undo()
  await selectPair()
  await page.getByLabel('Node editor', { exact: true }).focus(); await page.keyboard.press('Delete')
  await checkDeleted(); await undo()
  console.log('PASS: Shift-click and Shift-drag selection menus, canvas context actions, bulk keyboard deletion and one-step undo with connections')

  // Grab outside the visible dot but inside the enlarged hit area, then connect to B.
  await pane.click({ position: { x: 10, y: 10 } })
  const output = a.locator('[data-handleid="out:scalar:value"]'), input = b.locator('[data-handleid="in:scalar:b"]')
  const from = await output.boundingBox(), to = await input.boundingBox()
  await page.mouse.move(from.x + from.width / 2 + from.width * 2 / 3, from.y + from.height / 2)
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-nodeid="na"][data-handleid="out:scalar:value"]'), '::after').boxShadow !== 'none')
  await page.screenshot({ path: resolve(directory, 'socket-hover.png') })
  await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.waitForFunction(() => document.querySelector('[data-nodeid="nb"][data-handleid="in:scalar:b"]')?.classList.contains('valid'))
  await page.screenshot({ path: resolve(directory, 'socket-connection.png') })
  await page.mouse.up()
  assert.ok((await project()).edges.some(e => e.source === 'na' && e.target === 'nb' && e.targetHandle === 'in:scalar:b'))
  // An image cannot drive a numeric input; show the invalid target and retain the existing wire.
  const imageOutput = await page.locator('[data-nodeid="n1"][data-handleid="out:frame:image"]').boundingBox()
  const before = (await project()).edges
  await page.mouse.move(imageOutput.x + imageOutput.width / 2, imageOutput.y + imageOutput.height / 2)
  await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.waitForFunction(() => { const el = document.querySelector('[data-nodeid="nb"][data-handleid="in:scalar:b"]'); return el?.classList.contains('connectingto') && !el.classList.contains('valid') })
  await page.screenshot({ path: resolve(directory, 'socket-invalid.png') })
  await page.mouse.up()
  assert.deepEqual((await project()).edges, before)
  await upload(sourceGraph)
  console.log('PASS: enlarged socket hit area starts a real wire; valid and invalid destination feedback matches connection behavior')
}
