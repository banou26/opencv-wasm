import { readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'

const coverage = JSON.parse(await readFile('lib/coverage.json', 'utf8'))
const declarations = ts.createSourceFile('opencv.d.ts', await readFile('lib/opencv.d.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const api = declarations.statements.find(n => ts.isInterfaceDeclaration(n) && n.name.text === 'EmbindModule')
const exports = new Set(api.members.map(n => n.name.getText(declarations)))
const members = new Map(api.members.map(node => [node.name.getText(declarations), node]))
const comment = name => members.get(name)?.jsDoc?.map(doc => doc.getText(declarations)).join('\n') || `/** Native OpenCV export ${name}. */`
const paths = new Set()
for (const path of coverage.namespaces) {
  if (![...exports].some(key => key.startsWith(path.replaceAll('.', '_') + '_'))) continue
  const parts = path.split('.')
  for (let length = 1; length <= parts.length; length++) paths.add(parts.slice(0, length).join('.'))
}
const ordered = [...paths].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b))
const classBases = Object.fromEntries(Object.entries(coverage.classBases).filter(([name, base]) => exports.has(name) && exports.has(base)))
const nestedClasses = Object.entries(coverage.nestedClasses).map(([native, path]) => {
  const parent = path.split('.').slice(0, -1).join('_')
  return { native, parent, name: path.split('.').at(-1) }
}).filter(({ native, parent }) => exports.has(native) && exports.has(parent))
const extras = new Map()
for (const name of Object.keys(classBases)) {
  const ancestors = []
  for (let base = classBases[name]; base && !ancestors.includes(base); base = classBases[base]) ancestors.push(base)
  extras.set(name, ancestors.map(base => `StaticMembers<MainModule['${base}']>`))
}
for (const { native, parent, name } of nestedClasses) extras.set(parent, [...(extras.get(parent) || []), `{\n${comment(native)}\n ${name}: MainModule['${native}']\n }`])
const augmented = [...extras].map(([name, types]) => `${comment(name)}\n  ${name}: MainModule['${name}'] & ${types.join(' & ')}`).join('\n')
const shape = (parent = '') => {
  const children = ordered.filter(p => p.split('.').slice(0, -1).join('.') === parent)
  const prefix = parent.replaceAll('.', '_') + '_'
  // Key-remapped TypeScript properties lose their declaration comments. Give
  // namespace properties explicit aliases so editor hovers keep their docs.
  const properties = parent ? [...members].filter(([name, node]) => name.startsWith(prefix) && ts.isPropertySignature(node)).map(([name]) => `${comment(name)}\n  ${name.slice(prefix.length)}: AugmentedModule['${name}']`) : []
  return '{\n' + [...properties, ...children.map(path => `  /** Native ${path} namespace. */\n  ${path.split('.').at(-1)}: CVNamespace<'${path.replaceAll('.', '_')}'> & ${shape(path)}`)].join('\n') + '\n}'
}
await writeFile('lib/namespaces.js', `export const namespacePaths = ${JSON.stringify(ordered)}\nexport const classBases = ${JSON.stringify(classBases)}\nexport const nestedClasses = ${JSON.stringify(nestedClasses)}\n`)
await writeFile('lib/namespaces.d.ts', `import type { MainModule } from './opencv.js'\ntype StaticMembers<T> = { [Key in keyof T]: T[Key] }\n/** Native classes including nested types and inherited static factories. */\nexport type AugmentedModule = MainModule & {\n${augmented}\n}\n\n/** Native exports under a C++ namespace, with their exact signatures. */\nexport type CVNamespace<Prefix extends string> = {\n  [Key in keyof AugmentedModule as Key extends \`\${Prefix}_\${infer Name}\` ? Name : never]: AugmentedModule[Key]\n}\n\n/** Nested namespace views generated from this build's declarations. */\nexport type NativeNamespaces = ${shape()}\nexport declare const namespacePaths: readonly string[]\nexport declare const classBases: Readonly<Record<string, string>>\nexport declare const nestedClasses: readonly { native: string, parent: string, name: string }[]\n`)
