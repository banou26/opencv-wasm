import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const editor = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.env.CADENCE_ROOT ?? resolve(editor, '../../cadence'))
const destination = resolve(editor, 'vendor/cadence-regional')
const build = spawnSync('npm', ['run', 'build:regional'], { cwd: source, stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)
await mkdir(destination, { recursive: true })
const modules = ['regional', 'regions', 'flow', 'timing', 'regional-types', 'types']
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const files = {}
for (const name of modules) {
  const sourceBytes = await readFile(resolve(source, `src/${name}.ts`))
  files[`src/${name}.ts`] = sha256(sourceBytes)
  for (const extension of ['js', 'd.ts']) {
    const file = `${name}.${extension}`, built = resolve(source, 'dist/regional-runtime', file)
    await copyFile(built, resolve(destination, file))
    files[file] = sha256(await readFile(built))
  }
}
const pkg = { name: 'cadence', version: '0.0.0', private: true, type: 'module', exports: { './regional': { types: './regional.d.ts', default: './regional.js' } }, peerDependencies: { '@banou/opencv-wasm': '0.0.6' } }
await writeFile(resolve(destination, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
await writeFile(resolve(destination, 'source-manifest.json'), `${JSON.stringify({ generator: 'npm run sync:cadence', sourceProject: 'cadence', files }, null, 2)}\n`)
await writeFile(resolve(destination, 'README.md'), '# Generated Cadence regional core\n\nDo not edit these files. The implementation lives in Cadence `src/`.\nRun `npm run sync:cadence` from the editor with an adjacent Cadence checkout\n(or set `CADENCE_ROOT`). This builds and copies only the browser-safe regional\nentry point and its dependencies. `source-manifest.json` records SHA-256 hashes\nof every input TypeScript source and generated JS/declaration file.\n\nNormal editor install, tests and builds use this committed snapshot and do not\nrequire a Cadence checkout, Node filesystem APIs at runtime, or native OpenCV.\n')
console.log(`Synced ${modules.length} Cadence browser modules to ${destination}`)
