import assert from 'node:assert/strict'
import { readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { createOpenCV } from '../lib/index.js'

const declarations = await readFile('lib/opencv.d.ts', 'utf8')
const source = ts.createSourceFile('opencv.d.ts', declarations, ts.ScriptTarget.Latest, true)
const checkTypes = node => {
  assert(node.kind !== ts.SyntaxKind.AnyKeyword, 'Native declarations must not contain unresolved any types')
  ts.forEachChild(node, checkTypes)
}
checkTypes(source)
const cv = await createOpenCV()
assert.equal(cv.getVersionString(), '5.0.0', 'The packaged binary must be OpenCV 5')
const api = source.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'EmbindModule')
assert(api, 'The native module declaration must be present')
const names = [...new Set(api.members.map(member => member.name.getText(source)))]
assert(names.length > 2_000, 'The expected broad native API must be present')
for (const name of names) assert(name in cv, `Declared export is missing at runtime: ${name}`)
let checkedMethods = 0
for (const node of source.statements) {
  if (!ts.isInterfaceDeclaration(node)) continue
  const nativeClass = cv[node.name.text]
  if (typeof nativeClass !== 'function' || !nativeClass.prototype) continue
  for (const member of node.members) {
    if (!member.name || !ts.isIdentifier(member.name)) continue
    assert(member.name.text in nativeClass.prototype, `Missing member: ${node.name.text}.${member.name.text}`)
    checkedMethods++
  }
}
const artifacts = {}
const parity = JSON.parse(await readFile('lib/python-parity.json', 'utf8'))
assert.equal(parity.different.length, 0, 'Reference constants must keep their Python values')
const coverage = JSON.parse(await readFile('lib/coverage.json', 'utf8'))
assert.equal(coverage.opencvVersion, cv.getVersionString())
assert.equal(parity.reference.opencvVersion, cv.getVersionString())
for (const name of ['geometry', 'calib', 'stereo', 'ptcloud', 'features', 'xstereo', 'gapi', 'videoio', 'freetype', 'hdf', 'text', 'sfm']) assert(coverage.modules.includes(name), `Missing CPU module: ${name}`)
await writeFile('lib/build-info.txt', cv.getBuildInformation())
for (const entry of await readdir('lib', { withFileTypes: true })) {
  if (!entry.isFile() || entry.name === 'artifacts.json') continue
  const path = 'lib/' + entry.name
  const data = await readFile(path)
  artifacts[path.replace('lib/', '')] = { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }
}
for (const path of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/coverage.md', 'lib/licenses/emscripten.txt', 'lib/licenses/eigen.txt', 'lib/licenses/ade.txt', 'lib/licenses/freetype-2.13.3/docs/FTL.TXT']) assert((await stat(path)).size > 0)
const { version: packageVersion } = JSON.parse(await readFile('package.json', 'utf8'))
await writeFile('lib/artifacts.json', JSON.stringify({ packageVersion, opencvVersion: '5.0.0', exports: names.length, checkedMethods, pythonInventory: parity.counts, artifacts }, null, 2) + '\n')
console.log(`Verified ${names.length} native exports and ${checkedMethods} declared class members`)
