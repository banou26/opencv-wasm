import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url)),
  content = path.join(root, 'website/src/content/docs')
const temporary = await fs.mkdtemp(path.join(tmpdir(), 'opencv-docs-examples-'))
try {
  const examples = [],
    files = (await fs.readdir(content, { recursive: true })).filter((name) => /\.mdx?$/.test(name))
  const sources = await Promise.all(
    files.map(async (file) => ({ file, source: await fs.readFile(path.join(content, file), 'utf8') }))
  )
  const cookbook = ts.createSourceFile(
    'cookbook-code.ts',
    await fs.readFile(path.join(root, 'website/src/data/cookbook-code.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const snippets = (node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node))
      sources.push({ file: `cookbook-${sources.length}`, source: '```ts\n' + node.text + '\n```' })
    ts.forEachChild(node, snippets)
  }
  snippets(cookbook)
  for (const { file, source } of sources) {
    for (const [index, match] of [...source.matchAll(/```(?:ts|typescript)(?:[^\n]*)\n([\s\S]*?)```/g)].entries()) {
      const code = match[1],
        sf = ts.createSourceFile('example.ts', code, ts.ScriptTarget.Latest, true),
        declared = new Set()
      for (const node of sf.statements) {
        if (ts.isVariableStatement(node))
          for (const d of node.declarationList.declarations) declared.add(d.name.getText())
        if (ts.isImportDeclaration(node)) {
          if (node.importClause?.name) declared.add(node.importClause.name.text)
          for (const e of node.importClause?.namedBindings?.elements ?? []) declared.add(e.name.text)
        }
      }
      const context = {
        rect: "import('@banou/opencv-wasm').Rect",
        cv: "import('@banou/opencv-wasm').OpenCV",
        image: "import('@banou/opencv-wasm').Mat",
        nextImage: "import('@banou/opencv-wasm').Mat",
        graph: "import('@banou/opencv-wasm').GComputation",
        canvas: 'HTMLCanvasElement',
        context: 'CanvasRenderingContext2D',
        modelBytes: 'Uint8Array<ArrayBuffer>',
        readFile: "typeof import('node:fs/promises').readFile"
      }
      const prelude = Object.entries(context)
        .filter(([name]) => !declared.has(name))
        .map(([name, type]) => `declare const ${name}: ${type};`)
        .join('\n')
      const target = path.join(temporary, `${file.replaceAll('/', '_')}-${index}.ts`)
      await fs.writeFile(target, `${prelude}\n${code}\nexport {}\n`)
      examples.push(target)
    }
  }
  const assetTypes = path.join(temporary, 'assets.d.ts')
  await fs.writeFile(assetTypes, 'declare module "*?url" { const value: string; export default value }\n')
  const program = ts.createProgram([...examples, assetTypes], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    baseUrl: root,
    paths: { '@banou/opencv-wasm': ['lib/index.d.ts'] },
    typeRoots: [path.join(root, 'node_modules/@types')],
    types: ['node']
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => temporary,
        getCanonicalFileName: (f) => f,
        getNewLine: () => '\n'
      })
    )
    process.exitCode = 1
  } else console.log(`Strictly checked ${examples.length} TypeScript documentation examples against the built package`)
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
