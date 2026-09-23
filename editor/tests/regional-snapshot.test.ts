import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

test('the checked-in Cadence snapshot matches its generated content manifest', () => {
  const directory = new URL('../vendor/cadence-regional/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('source-manifest.json', directory), 'utf8')) as { files: Record<string, string> }
  const artifacts = Object.entries(manifest.files).filter(([name]) => !name.startsWith('src/'))
  expect(artifacts).toHaveLength(12)
  for (const [name, hash] of artifacts) expect(createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex')).toBe(hash)
  const pkg = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8')) as { peerDependencies: Record<string, string> }
  expect(pkg.peerDependencies['@banou/opencv-wasm']).toBe('0.0.6')
})
