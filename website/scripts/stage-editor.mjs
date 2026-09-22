import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = join(root, 'website/dist'), editor = join(root, 'editor')
await rm(join(output, 'editor'), { recursive: true, force: true })
await cp(join(editor, 'dist'), join(output, 'editor'), { recursive: true })
await writeFile(join(output, 'editor/samples.json'), '[]\n')
await mkdir(join(output, 'runtime'), { recursive: true })
await mkdir(join(output, 'editor/runtime'), { recursive: true })
// Content-addressed chunks are shared with the docs when both use the same native build.
for (const name of await readdir(join(editor, 'public/runtime'))) {
  if (!/\.(bin|mjs)$/.test(name)) throw new Error(`Unexpected editor runtime asset: ${name}`)
  await cp(join(editor, 'public/runtime', name), join(output, name.endsWith('.bin') ? 'runtime' : 'editor/runtime', name))
}
const html = await readFile(join(output, 'editor/index.html'), 'utf8')
if (!html.includes('/editor/assets/')) throw new Error('The editor must be built for /editor/')
console.log('Editor staged at /editor/ with shared /runtime/ assets; local media excluded')
