import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const exportedProgram = ts.createProgram([path.join(root, 'lib/index.d.ts')], { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, skipLibCheck: true })
const exportedChecker = exportedProgram.getTypeChecker()
const exportedSymbols = new Set(exportedChecker.getExportsOfModule(exportedChecker.getSymbolAtLocation(exportedProgram.getSourceFile(path.join(root, 'lib/index.d.ts')))).map(symbol => symbol.name))
const destination = path.join(root, 'website/src/data')
await fs.mkdir(destination, { recursive: true })
const read = name => fs.readFile(path.join(root, 'lib', name), 'utf8')
const coverage = JSON.parse(await read('coverage.json'))
const parity = JSON.parse(await read('python-parity.json'))
const docs = JSON.parse(await read('documentation.json'))
const source = ts.createSourceFile('opencv.d.ts', await read('opencv.d.ts'), ts.ScriptTarget.Latest, true)
const module = source.statements.find(node => node.name?.text === 'EmbindModule')
if (!module) throw new Error('Build the OpenCV package before generating the website')
const declarations = new Map(source.statements.filter(n => n.name).map(n => [n.name.text, n]))
const clean = text => String(text ?? '').replace(/[\u2013\u2014]/g, '-').replace(/\n{3,}/g, '\n\n').trim()
const comment = value => clean(typeof value === 'string' ? value : value?.map(v => v.text ?? '').join(''))
const documentation = node => {
  const comments = node.jsDoc ?? []
  const tags = comments.flatMap(c => c.tags ? [...c.tags] : [])
  return {
    description: comments.map(c => comment(c.comment)).filter(Boolean).join('\n\n'),
    parameters: tags.filter(t => t.tagName.text === 'param').map(t => ({ name: t.name?.getText() ?? '', description: comment(t.comment) })),
    returns: tags.filter(t => ['returns', 'return'].includes(t.tagName.text)).map(t => comment(t.comment)).join('\n'),
    sources: [...new Set(tags.filter(t => t.tagName.text === 'see').map(t => clean(t.getText().replace(/^@see\s+/, ''))).filter(s => /^https:\/\//.test(s)))],
  }
}
const signature = node => clean(node.getText().replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n'))
const group = members => {
  const groups = new Map()
  for (const member of members ?? []) {
    const name = member.name?.getText().replace(/^['"]|['"]$/g, '') ?? (ts.isConstructSignatureDeclaration(member) ? 'new' : 'call')
    if (name === '[nativeType]') continue
    const entry = groups.get(name) ?? { name, signatures: [], description: '', parameters: [], returns: '', sources: [] }
    const d = documentation(member)
    if (d.description.length > entry.description.length) entry.description = d.description
    for (const p of d.parameters) if (!entry.parameters.some(v => v.name === p.name)) entry.parameters.push(p)
    if (d.returns.length > entry.returns.length) entry.returns = d.returns
    entry.sources = [...new Set([...entry.sources, ...d.sources])]
    entry.signatures.push(signature(member))
    groups.set(name, entry)
  }
  return [...groups.values()]
}
const displayName = name => name
const inferModule = (entry, fallback = 'core') => {
  const link = [...entry.sources, ...(entry.members ?? []).flatMap(m => m.sources)].find(s => /\/modules\/[^/]+\//.test(s))
  return link?.match(/\/modules\/([^/]+)\//)?.[1] ?? fallback
}
const all = group(module.members), constants = [], entries = []
const memberByName = new Map(module.members.map(m => [m.name?.getText(), m]))
for (const info of all) {
  const member = memberByName.get(info.name)
  const node = declarations.get(info.name)
  const callable = ts.isMethodSignature(member)
  const members = ts.isTypeLiteralNode(member.type) ? group(member.type.members) : []
  const instance = node && ts.isInterfaceDeclaration(node) ? group(node.members) : []
  const kind = callable ? 'function' : members.length || instance.length ? 'class' : 'constant'
  const base = coverage.classBases[info.name]
  const entry = { ...info, kind, display: displayName(info.name), slug: info.name, members: [...members.map(m => ({ ...m, static: true })), ...instance.map(m => ({ ...m, static: false }))], bases: base ? [base] : node?.heritageClauses?.flatMap(c => c.types.map(t => t.getText().match(/^Omit<([^,]+)/)?.[1] ?? t.getText())) ?? [] }
  if (kind === 'class') { entry.signatures = []; entry.description ||= documentation(node ?? member).description }
  entry.module = inferModule(entry)
  if (kind === 'constant') constants.push(entry)
  else entries.push(entry)
}
for (const [name, node] of declarations) {
  if (['EmbindModule', 'MainModule', 'WasmModule'].includes(name) || entries.some(e => e.name === name) || constants.some(e => e.name === name)) continue
  if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) continue
  const entry = { name, slug: `type-${name}`, display: name, kind: 'type', ...documentation(node), signatures: [signature(node)], members: ts.isInterfaceDeclaration(node) ? group(node.members).map(m => ({ ...m, static: false })) : [], bases: [] }
  entry.module = inferModule(entry)
  entries.push(entry)
}
for (const file of ['index.d.ts', 'default.d.ts', 'images.d.ts', 'values.d.ts', 'graph-types.d.ts', 'graph.d.ts', 'streaming.d.ts']) {
  const sf = ts.createSourceFile(file, await read(file), ts.ScriptTarget.Latest, true)
  for (const node of sf.statements) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) continue
    if (!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    const name = node.name?.text ?? node.declarationList?.declarations[0]?.name?.getText()
    if (!name || ['_default', 'registerDefaultBindings', 'uninitializedExport', 'getDefaultOpenCV'].includes(name) || entries.some(e => e.name === name)) continue
    const entry = { name, slug: `ts-${name}`, display: name, kind: ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) ? 'helper' : 'type', ...documentation(node), signatures: [signature(node)], members: [], bases: [], module: 'typescript' }
    entries.push(entry)
  }
}
for (const entry of entries) entry.importable = exportedSymbols.has(entry.name)
entries.sort((a, b) => a.display.localeCompare(b.display))
const slugs = new Set()
for (const e of entries) { if (slugs.has(e.slug)) throw new Error(`Duplicate API path ${e.slug}`); slugs.add(e.slug) }
const modules = [...new Set([...coverage.modules, ...entries.map(e => e.module), ...constants.map(e => e.module)])].sort()
await fs.writeFile(path.join(destination, 'api.generated.json'), JSON.stringify({ entries, constants, modules, coverage: { version: coverage.opencvVersion, modules: coverage.modules, unavailable: coverage.unavailableFeatures }, parity: { reference: parity.reference, counts: parity.counts, missing: parity.missing, missingMembers: parity.missingMembers }, documentation: { declarations: docs.declarations, upstream: docs.upstream, fallback: docs.fallback.length } }))
await fs.mkdir(path.join(root, 'website/public/runtime'), { recursive: true })
for (const name of (await fs.readdir(path.join(root, 'lib'))).filter(n => /\.(?:js|mjs|wasm)$/.test(n))) await fs.copyFile(path.join(root, 'lib', name), path.join(root, 'website/public/runtime', name))
await fs.copyFile(path.join(root, 'LICENSE'), path.join(root, 'website/public/LICENSE.txt'))
await fs.copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(root, 'website/public/THIRD_PARTY_NOTICES.txt'))
await fs.cp(path.join(root, 'lib/licenses'), path.join(root, 'website/public/licenses'), { recursive: true })
for (const [dependency, license, target] of [
  ['astro', 'LICENSE', 'website-astro.txt'],
  ['@astrojs/starlight', 'LICENSE', 'website-starlight.txt'],
  ['marked', 'LICENSE.md', 'website-marked.txt'],
  ['@fontsource-variable/dm-sans', 'LICENSE', 'website-dm-sans.txt'],
  ['@fontsource/jetbrains-mono', 'LICENSE', 'website-jetbrains-mono.txt'],
]) await fs.copyFile(path.join(root, 'website/node_modules', dependency, license), path.join(root, 'website/public/licenses', target))
console.log(`Reference: ${entries.length} pages, ${constants.length} constants, ${modules.length} module groups`)
