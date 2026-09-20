import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { checkEditorDocumentation } from './editor-docs.mjs'

const text = await readFile('lib/opencv.d.ts', 'utf8')
const source = ts.createSourceFile('opencv.d.ts', text, ts.ScriptTarget.Latest, true)

test('public native declarations retain JSDoc and valid parameter tags', () => {
  const missing = [], invalid = []
  let documented = 0
  const visit = node => {
    if (node.name?.getText(source) === '[nativeType]') return
    const publicMember = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isPropertySignature(node) || ts.isMethodSignature(node) || ts.isConstructSignatureDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    if (publicMember) {
      const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
      const name = node.name?.getText(source) || 'constructor'
      if (!docs.some(doc => ts.getTextOfJSDocComment(doc.comment)?.trim().length > 10)) missing.push(name)
      else documented++
      if (node.parameters) {
        const params = new Set(node.parameters.map(p => p.name.getText(source)))
        for (const tag of docs.flatMap(doc => [...(doc.tags || [])]).filter(ts.isJSDocParameterTag)) {
          if (!params.has(tag.name.getText(source))) invalid.push(name + ':' + tag.name.getText(source))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual(missing, [], 'Every public type, overload and field needs an explanatory comment')
  assert.deepEqual(invalid, [], 'JSDoc parameter names must match the emitted TypeScript signature')
  assert(documented > 10_000)
})

test('TypeScript editor hovers preserve native, namespace and adapter documentation', () => {
  checkEditorDocumentation(resolve('.cache/documentation-hover.ts'), '../lib/index.js')
})
