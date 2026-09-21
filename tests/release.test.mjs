import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldPublish } from '../scripts/check-release.mjs'

const manifest = { name: '@banou/opencv-wasm', version: '0.0.6' }

test('release skips an existing version and requests the exact scoped package', async () => {
  const publish = await shouldPublish(manifest, async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/%40banou%2Fopencv-wasm/0.0.6')
    assert(options.signal instanceof AbortSignal)
    return Response.json(manifest)
  })
  assert.equal(publish, false)
})

test('release permits a version that the registry reports as missing', async () => {
  assert.equal(await shouldPublish(manifest, async () => new Response(null, { status: 404 })), true)
})

test('release stops on registry errors instead of treating them as unpublished', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(shouldPublish(manifest, async () => new Response(null, { status })), new RegExp(`HTTP ${status}`))
  }
})

test('release stops on network failure, invalid JSON or mismatched package metadata', async () => {
  await assert.rejects(shouldPublish(manifest, async () => { throw new Error('Connection failed') }), /Connection failed/)
  await assert.rejects(shouldPublish(manifest, async () => new Response('<html>unavailable</html>')), SyntaxError)
  for (const metadata of [{ ...manifest, name: 'another-package' }, { ...manifest, version: '0.0.5' }]) {
    await assert.rejects(shouldPublish(manifest, async () => Response.json(metadata)), /unexpected metadata/)
  }
})
