import assert from 'node:assert/strict'
import { resolve } from 'node:path'

/** Exercise typed values, real frame operations and editable utility groups in Chrome. */
export const primitivesSmoke = async (page, { directory, upload, choose, change, png, project, sourcePixels, width, height }) => {
  const select = title => change(() => page.locator('.step-strip button').filter({ hasText: title }).click())
  await choose('crop')
  const cropped = await png(), original = sourcePixels.get(0)
  let changed = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    const at = (y * width + x) * 3 + c
    if (x < 16 || x >= 80 || y < 16 || y >= 80) assert.equal(cropped[at], original[at])
    else if (cropped[at] !== original[at]) changed++
  }
  assert.ok(changed > 100, 'Only the cropped region should be blurred and pasted back')
  await select('Crop Frame')
  assert.match(await page.locator('.view-options code').innerText(), /64 × 64/)
  await page.screenshot({ path: resolve(directory, 'crop-frame.png') })
  await choose('pyramid')
  assert.deepEqual(await png(), original, 'Editable Laplacian group must reconstruct the decoded frame')
  await select('Laplacian Pyramid')
  await page.getByText('Pyramid overview', { exact: false }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Save PNG', exact: true }).isDisabled())
  await page.screenshot({ path: resolve(directory, 'pyramid-levels.png') })
  await select('Pyramid Level')
  assert.match(await page.locator('.view-options').innerText(), /Signed difference/)
  const level = page.getByLabel('Pyramid Level Level index', { exact: true })
  await change(() => level.fill('2'))
  assert.match(await page.locator('.view-options code').innerText(), /48 × 32/)

  const n = (id, type, params = {}, x = 40, y = 80) => ({ id, type, params, position: { x, y } })
  const e = (source, sourceHandle, target, targetHandle) => ({ id: `e${source}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle })
  const doc = { version: 1, nodes: [n('nclip', 'clip'), n('nvalue', 'constant', { value: 2 }, 40, 500), n('nindex', 'math', { operation: 'add', a: 0, b: 5 }, 400, 500), n('nframe', 'readFrame', { frame: 0 }, 760), n('n5', 'output', {}, 1120)], edges: [e('nclip', 'out:video:clip', 'nframe', 'in:video:clip'), e('nvalue', 'out:scalar:value', 'nindex', 'param:a'), e('nindex', 'out:scalar:value', 'nframe', 'param:frame'), e('nframe', 'out:frame:image', 'n5', 'in:frame:image')] }
  await upload(doc)
  assert.deepEqual(await png(), sourcePixels.get(7))
  assert.match(await page.locator('.react-flow__node[data-id="nframe"]').innerText(), /Connected/)
  const number = page.getByLabel('Number Value', { exact: true })
  await number.focus()
  await change(() => number.fill('-3'))
  assert.ok(await number.evaluate(input => document.activeElement === input))
  assert.deepEqual(await png(), sourcePixels.get(2))
  await page.locator('.node-details summary').click()
  assert.match(await page.locator('.input-demands').innerText(), /#2/)
  assert.doesNotMatch(await page.locator('.input-demands').innerText(), /#7/)
  await page.locator('.node-details summary').click()

  const schema = { id: 'tpatch', name: 'Tracked Patch', fields: [{ id: 'image', label: 'Frame', type: 'frame' }, { id: 'label', label: 'Label', type: 'string', default: 'foreground' }, { id: 'enabled', label: 'Enabled', type: 'boolean', default: true }, { id: 'weight', label: 'Weight', type: 'scalar', default: 0.75 }] }
  const records = await project()
  records.dataTypes = [schema]
  records.nodes.push({ ...n('nrecord', 'makeRecord', { label: 'foreground', enabled: true, weight: 0.75 }, 1100, 100), dataType: schema.id }, { ...n('nfields', 'breakRecord', {}, 1460, 100), dataType: schema.id })
  records.nodes.find(n => n.id === 'n5').position.x = 1810
  records.edges = records.edges.filter(e => e.target !== 'n5')
  records.edges.push(e('nframe', 'out:frame:image', 'nrecord', 'image'), e('nrecord', 'record', 'nfields', 'record'), e('nfields', 'image', 'n5', 'in:frame:image'))
  await upload(records)
  assert.deepEqual(await png(), sourcePixels.get(2))
  await select('Make Tracked Patch')
  assert.match(await page.locator('.value-preview').innerText(), /foreground/)
  await select('Separate Tracked Patch')
  await change(() => page.getByLabel('Output socket').selectOption('weight'))
  assert.equal(Number(await page.locator('.scalar-preview strong').innerText()), 0.75)
  await change(() => page.getByLabel('Make Tracked Patch Weight', { exact: true }).fill('0.4'))
  assert.equal(Number(await page.locator('.scalar-preview strong').innerText()), 0.4)
  await change(() => page.getByLabel('Output socket').selectOption('enabled'))
  assert.match(await page.locator('.value-preview').innerText(), /true/)
  await change(() => page.getByLabel('Make Tracked Patch Enabled', { exact: true }).uncheck())
  assert.match(await page.locator('.value-preview').innerText(), /false/)
  await change(() => page.getByLabel('Output socket').selectOption('label'))
  await change(() => page.getByLabel('Make Tracked Patch Label', { exact: true }).fill('camera background'))
  assert.match(await page.locator('.value-preview').innerText(), /camera background/)
  await page.getByRole('button', { name: 'Data types (1)', exact: true }).click()
  await page.getByRole('button', { name: '＋ New type', exact: true }).click()
  await page.getByLabel('Data type name').fill('Layer Info'); await page.getByLabel('Data type name').press('Enter')
  await page.getByRole('button', { name: 'Close data types' }).click()
  assert.ok((await project()).dataTypes.some(t => t.name === 'Layer Info'))
  await page.screenshot({ path: resolve(directory, 'typed-records.png') })
  console.log('PASS: explicit video/frame flow, computed frame indices, source provenance, crop/process/paste pixels, editable pyramid reconstruction and custom typed records')
}
