import assert from 'node:assert/strict'
import ts from 'typescript'

/** Verify actual editor hovers against a local or freshly installed package. */
export const checkEditorDocumentation = (path, specifier) => {
  const consumer = `
import { createOpenCV, decodeImage, initOpenCV, Mat, GaussianBlur, threshold, ml_SVM } from '${specifier}'
await initOpenCV()
const named: Mat = new Mat()
GaussianBlur
threshold
ml_SVM.create
named.data
const cv = await createOpenCV()
const mat = new cv.Mat()
cv.threshold
cv.GaussianBlur
cv.ml.SVM.create
cv.fisheye.projectPoints
cv.merge
mat.rows
mat.data
mat.data64S
cv.MatShape.scalar
cv.finiteMask
mat.clone
mat.mat_clone
cv.gapi.op
cv.gapi.kernel
cv.GArray.Int64
cv.FS.readFile
cv.gapi.streaming.seq_id
cv.gapi.dnn.Params
const graph = new cv.GComputation(cv.GIn([]), cv.GOut([]))
graph.compileStreaming().pull
decodeImage
`
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext, strict: true }
  const host = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [path],
    getScriptVersion: () => '0',
    getScriptSnapshot: file => { const data = file === path ? consumer : ts.sys.readFile(file); return data === undefined ? undefined : ts.ScriptSnapshot.fromString(data) },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: file => file === path || ts.sys.fileExists(file),
    readFile: file => file === path ? consumer : ts.sys.readFile(file),
    readDirectory: ts.sys.readDirectory,
  }
  const service = ts.createLanguageService(host)
  try {
    const diagnostics = service.getSemanticDiagnostics(path)
    assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
    const cases = [
      ['GaussianBlur\n', /Gaussian/i], ['threshold\n', /threshold/i],
      ['ml_SVM.create', /support vector|SVM/i], ['named.data', /WASM memory/i],
      ['cv.threshold', /threshold/i], ['cv.GaussianBlur', /Gaussian/i],
      ['cv.ml.SVM.create', /support vector|SVM/i], ['cv.fisheye.projectPoints', /fisheye/i],
      ['cv.merge', /multi-channel/i], ['mat.rows', /rows/i],
      ['mat.data', /WASM memory/i], ['mat.clone', /same native object|same matrix|same.*object/i],
      ['mat.data64S', /bigint/i], ['cv.MatShape.scalar', /zero-dimensional/i], ['cv.finiteMask', /finite/i],
      ['mat.mat_clone', /independent/i], ['cv.gapi.op', /custom native operation/i],
      ['cv.gapi.kernel', /synchronous CPU callback/i], ['cv.GArray.Int64', /64-bit bigint/i],
      ['cv.FS.readFile', /virtual file/i], ['cv.gapi.streaming.seq_id', /sequence identifier/i],
      ['cv.gapi.dnn.Params', /DNN graph network/i], ['graph.compileStreaming().pull', /owned outputs/i],
      ['decodeImage\n', /Decode encoded bytes/i],
    ]
    for (const [expression, pattern] of cases) {
      const position = consumer.lastIndexOf(expression) + expression.trimEnd().length - 1
      const hover = service.getQuickInfoAtPosition(path, position)
      assert(hover, 'No editor hover for ' + expression)
      assert.match(ts.displayPartsToString(hover.documentation), pattern, expression + ' must retain its explanation')
    }
    const threshold = service.getQuickInfoAtPosition(path, consumer.indexOf('cv.threshold') + 5)
    assert(threshold.tags.some(tag => tag.name === 'param' && ts.displayPartsToString(tag.text).includes('dst')))
    assert(threshold.tags.some(tag => tag.name === 'see' && ts.displayPartsToString(tag.text).includes('/blob/5.0.0/')))
  } finally { service.dispose() }
}
