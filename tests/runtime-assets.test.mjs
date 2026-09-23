import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeRuntimeAssets, writeRuntimeFile } from '../shared/runtime-assets.mjs'

const chunkSize = 16 * 1024 * 1024

async function fixture(t, binary = Buffer.from('a small WASM fixture')) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'opencv-runtime-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const library = path.join(root, 'library'), destination = path.join(root, 'runtime')
  await fs.mkdir(library)
  await fs.writeFile(path.join(library, 'opencv_js.wasm'), binary)
  await fs.writeFile(path.join(library, 'opencv.mjs'), 'export default "runtime"\n')
  await fs.writeFile(path.join(library, 'index.js'), 'export const name = "opencv"\n')
  await fs.writeFile(path.join(library, 'index.d.ts'), 'export declare const name: string\n')
  return { root, library, destination, binary }
}

async function reconstruct(destination, manifest) {
  const pieces = []
  for (const chunk of manifest.chunks) {
    const bytes = await fs.readFile(path.join(destination, path.basename(chunk.url)))
    assert.equal(bytes.byteLength, chunk.byteLength)
    pieces.push(bytes)
  }
  const binary = Buffer.concat(pieces)
  assert.equal(binary.byteLength, manifest.byteLength)
  assert.equal(createHash('sha256').update(binary).digest('hex'), manifest.sha256)
  return binary
}

test('unchanged generation preserves exact filenames, inode and modification time', async t => {
  const { library, destination, binary } = await fixture(t)
  const first = await writeRuntimeAssets(library, destination)
  const names = (await fs.readdir(destination)).sort(), stats = await Promise.all(names.map(name => fs.stat(path.join(destination, name), { bigint: true })))
  const second = await writeRuntimeAssets(library, destination)
  assert.deepEqual(second, first)
  assert.deepEqual((await fs.readdir(destination)).sort(), names)
  for (const [index, name] of names.entries()) {
    const after = await fs.stat(path.join(destination, name), { bigint: true })
    assert.equal(after.ino, stats[index].ino)
    assert.equal(after.mtimeNs, stats[index].mtimeNs)
  }
  assert.deepEqual(names, ['index.js', `opencv-${first.sha256}-0.bin`, 'opencv.mjs'])
  assert.equal(first.chunks[0].url, `/runtime/opencv-${first.sha256}-0.bin`)
  assert.deepEqual(await reconstruct(destination, first), binary)
})

test('changed runtime preserves previous hash generations and unrelated files', async t => {
  const { library, destination, binary } = await fixture(t)
  const first = await writeRuntimeAssets(library, destination)
  await fs.mkdir(path.join(destination, 'local-assets'))
  await fs.writeFile(path.join(destination, 'local-assets', 'sentinel'), 'keep this')
  await fs.writeFile(path.join(destination, 'notes.txt'), 'keep this too')
  const replacement = Buffer.from('a different WASM fixture')
  await fs.writeFile(path.join(library, 'opencv_js.wasm'), replacement)
  const second = await writeRuntimeAssets(library, destination)
  assert.notEqual(second.sha256, first.sha256)
  assert.deepEqual(await reconstruct(destination, first), binary)
  assert.deepEqual(await reconstruct(destination, second), replacement)
  assert.equal(await fs.readFile(path.join(destination, 'local-assets', 'sentinel'), 'utf8'), 'keep this')
  assert.equal(await fs.readFile(path.join(destination, 'notes.txt'), 'utf8'), 'keep this too')
})

test('multi-chunk runtime reconstructs exactly with a custom base and no JS copying', async t => {
  const { library, destination, binary } = await fixture(t, Buffer.alloc(chunkSize + 37, 0x5a))
  const manifest = await writeRuntimeAssets(library, destination, { base: '/editor/runtime/', copyJavaScript: false })
  assert.deepEqual(manifest.chunks.map(chunk => chunk.byteLength), [chunkSize, 37])
  assert.equal(manifest.chunks.every(chunk => chunk.url.startsWith('/editor/runtime/')), true)
  assert.equal((await fs.readdir(destination)).every(name => name.endsWith('.bin')), true)
  assert.deepEqual(await reconstruct(destination, manifest), binary)
})

test('truncated same-hash assets are repaired by replacement, not by changing open files', async t => {
  const { library, destination, binary } = await fixture(t, Buffer.alloc(chunkSize + 7, 0x31))
  const manifest = await writeRuntimeAssets(library, destination)
  const filename = path.join(destination, path.basename(manifest.chunks[0].url))
  const truncated = binary.subarray(0, 127)
  await fs.writeFile(filename, truncated)
  const before = await fs.stat(filename, { bigint: true }), reader = await fs.open(filename)
  try {
    assert.deepEqual(await writeRuntimeAssets(library, destination), manifest)
    assert.notEqual((await fs.stat(filename, { bigint: true })).ino, before.ino)
    assert.deepEqual(await reader.readFile(), truncated)
    assert.deepEqual(await reconstruct(destination, manifest), binary)
  } finally {
    await reader.close()
  }
  assert.equal((await fs.readdir(destination)).some(name => name.endsWith('.tmp')), false)
})

test('atomic publication never exposes partial bytes to concurrent readers', async t => {
  const { destination } = await fixture(t)
  const filename = path.join(destination, 'asset.bin')
  const original = Buffer.alloc(chunkSize, 0x41), replacement = Buffer.alloc(chunkSize, 0x42)
  await writeRuntimeFile(filename, original)
  const reader = await fs.open(filename)
  let complete = false, reads = 0
  const publishing = writeRuntimeFile(filename, replacement).finally(() => { complete = true })
  try {
    do {
      const bytes = await fs.readFile(filename)
      assert.equal(bytes.equals(original) || bytes.equals(replacement), true, 'a reader must see only a complete old or new file')
      reads++
    } while (!complete)
    await publishing
    assert.ok(reads > 0)
    assert.deepEqual(await reader.readFile(), original)
    assert.deepEqual(await fs.readFile(filename), replacement)
  } finally {
    await publishing
    await reader.close()
  }
  assert.deepEqual(await fs.readdir(destination), ['asset.bin'])
})

test('metadata publication skips unchanged content and refuses existing directories', async t => {
  const { destination } = await fixture(t)
  for (const name of ['manifest.json', 'samples.json', 'opencv.mjs']) {
    const filename = path.join(destination, name), contents = `fixture for ${name}\n`
    await writeRuntimeFile(filename, contents)
    const before = await fs.stat(filename, { bigint: true })
    await writeRuntimeFile(filename, contents)
    const after = await fs.stat(filename, { bigint: true })
    assert.equal(after.ino, before.ino)
    assert.equal(after.mtimeNs, before.mtimeNs)
    assert.equal(await fs.readFile(filename, 'utf8'), contents)
  }
  const blocker = path.join(destination, 'blocked')
  await fs.mkdir(blocker)
  await assert.rejects(writeRuntimeFile(blocker, 'no overwrite'), { code: 'EISDIR' })
  assert.equal((await fs.readdir(destination)).some(name => name.endsWith('.tmp')), false)
})
