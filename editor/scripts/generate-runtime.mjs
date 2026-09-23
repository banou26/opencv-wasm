import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { writeRuntimeAssets, writeRuntimeFile } from '../../shared/runtime-assets.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url)
const library = join(dirname(require.resolve('@banou/opencv-wasm/package.json')), 'lib')
const site = process.argv.includes('--site')
const manifest = await writeRuntimeAssets(library, join(root, 'public/runtime'), { base: site ? '/runtime/' : '/editor/runtime/', copyJavaScript: false })
await writeRuntimeFile(join(root, 'public/runtime', `opencv-${manifest.sha256}.mjs`), await readFile(join(library, 'opencv.mjs')))
await writeRuntimeFile(join(root, 'src/wasm.generated.json'), JSON.stringify(manifest, null, 2) + '\n')
const samples = site ? [] : (await readdir(join(root, 'public/samples')).catch(error => { if (error.code === 'ENOENT') return []; throw error })).filter(name => name.endsWith('.mp4')).map(name => name.slice(0, -4)).sort()
await writeRuntimeFile(join(root, 'public/samples.json'), JSON.stringify(samples) + '\n')
console.log(`Editor runtime: ${manifest.chunks.length} verified chunks; ${samples.length} local samples`)
