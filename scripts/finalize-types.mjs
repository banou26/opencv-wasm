import { readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { documentTypes } from './document-types.mjs'

const raw = await readFile('build/wasm5/bin/opencv.d.ts', 'utf8')
const coverage = JSON.parse(await readFile('build/coverage.json', 'utf8'))
const runtime = (await readFile('src/runtime-types.d.ts', 'utf8')).replace(/^import type[^\n]*\n/gm, '')
let types = runtime + '\n' + raw.slice(raw.indexOf('interface WasmModule'))
types = types.replace(/(export interface MatShape[^]*?\n\})/, block => block.replace('erase(_0: number)', 'erase(index: number)'))
types = 'declare const nativeType: unique symbol\n' + types
const views = {
  data: 'Uint8Array<ArrayBuffer>', data8S: 'Int8Array<ArrayBuffer>',
  data16U: 'Uint16Array<ArrayBuffer>', data16S: 'Int16Array<ArrayBuffer>',
  data32S: 'Int32Array<ArrayBuffer>', data32F: 'Float32Array<ArrayBuffer>',
  data64F: 'Float64Array<ArrayBuffer>', matSize: 'number[]', step: 'number[]',
  data32U: 'Uint32Array<ArrayBuffer>', data64S: 'BigInt64Array<ArrayBuffer>', data64U: 'BigUint64Array<ArrayBuffer>',
}
for (const [name, type] of Object.entries(views)) {
  types = types.replace(`readonly ${name}: any;`, `readonly ${name}: ${type};`)
}
const pointers = {
  ptr: 'Uint8Array<ArrayBuffer>', ucharPtr: 'Uint8Array<ArrayBuffer>',
  charPtr: 'Int8Array<ArrayBuffer>', shortPtr: 'Int16Array<ArrayBuffer>',
  ushortPtr: 'Uint16Array<ArrayBuffer>', intPtr: 'Int32Array<ArrayBuffer>',
  floatPtr: 'Float32Array<ArrayBuffer>', doublePtr: 'Float64Array<ArrayBuffer>',
}
for (const [name, type] of Object.entries(pointers)) {
  types = types.replaceAll(new RegExp(`(\\b${name}\\([^\\n]*\\)): any;`, 'g'), `$1: ${type};`)
}
for (const [name, type] of Object.entries({
  boxPoints: '[Point2f, Point2f, Point2f, Point2f]',
  rotatedRectPoints: '[Point2f, Point2f, Point2f, Point2f]',
  CamShift: '[RotatedRect, Rect]', meanShift: '[number, Rect]',
  update: '[boolean, Rect]',
})) {
  types = types.replaceAll(new RegExp(`(\\b${name}\\([^\\n]*\\)): any;`, 'g'), `$1: ${type};`)
}
types = types.replaceAll(/(floodFill\([^\n]*)_4: any/g, '$1_4: Rect')
const graphNodes = [...types.matchAll(/export interface (GMat|GScalar|GFrame|GArray_\w+|GOpaque_\w+) extends/g)].map(match => match[1])
types += `\n/** Graph inputs and outputs supported by the native graph executor. */\nexport type GraphValue = Mat | Scalar | number | bigint | boolean | string | Point | Point2f | Point3f | Size | Rect | readonly (Mat | Scalar | number | bigint | boolean | string | Point | Point2f | Point3f | Size | Rect | GDrawPrim)[]\nexport type GraphNode = ${graphNodes.join(' | ')}\n`
types = types.replace(/(GIn|GOut)\(_0: any\)/g, '$1(nodes: readonly GraphNode[])')
types = types.replace(/(export interface GComputation[^]*?\n\})/, block => block.replaceAll('_0: any', 'inputs: readonly GraphValue[]').replaceAll('_1: any', 'metadata: GraphFrameMetadata').replaceAll('): any;', '): GraphValue[];'))
types += '\n/** CPU drawing primitives accepted by the G-API renderer. */\nexport type DrawPrimitive = gapi_wip_draw_Text | gapi_wip_draw_Rect | gapi_wip_draw_Circle | gapi_wip_draw_Line | gapi_wip_draw_Mosaic | gapi_wip_draw_Image | gapi_wip_draw_Poly\n'
types = types.replaceAll(/(gapi_wip_draw_render\d?\([^\n]*?)_\d: any/g, '$1primitives: readonly DrawPrimitive[]')
types = types.replace('dnn_registerLayer(_0: EmbindString, _1: any)', 'dnn_registerLayer(type: EmbindString, factory: DNNLayerFactory)')
types = types.replace('new(_0: EmbindString, _1: number, _2: number, _3: any): GOperation;', 'new(id: EmbindString, inputs: number, outputs: number, outMeta: GraphMetadataFunction): GOperation;')
types = types.replace(/(export interface GOperation[^]*?\n\})/, block => block.replace('on(_0: any): any;', 'on(inputs: readonly GMat[]): GMat[];').replace('kernel(_0: any)', 'kernel(run: GraphKernelFunction)'))
types = types.replace('new(_0: EmbindString, _1: any, _2: any, _3: any): GTypedOperation;', 'new(id: EmbindString, inputs: readonly GraphPortType[], outputs: readonly GraphPortType[], outMeta: GraphTypedMetadataFunction | undefined): GTypedOperation;')
types = types.replace(/(export interface GTypedOperation[^]*?\n\})/, block => block.replace('on(_0: any): any;', 'on(inputs: readonly GraphNode[]): GraphNode[];').replace('kernel(_0: any)', 'kernel(run: GraphTypedKernelFunction)'))
const graphValues = { bool: 'boolean', int: 'number', int64: 'bigint', uint64: 'bigint', double: 'number', float: 'number', string: 'string', point: 'Point', point2f: 'Point2f', point3f: 'Point3f', size: 'Size', rect: 'Rect', mat: 'Mat', scalar: 'Scalar', prim: 'GDrawPrim' }
const graphPortMembers = Object.entries(coverage.graphPorts).map(([token, { node }]) => {
  const [shape, element] = token.split(':')
  return `  '${token}': { node: ${node}, value: ${graphValues[element]}${shape === 'array' ? '[]' : ''} }`
})
types += `\n/** Native node and callback value types for each supported custom graph port. */\nexport interface GraphPortMap {\n  mat: { node: GMat, value: Mat }\n  scalar: { node: GScalar, value: Scalar }\n${graphPortMembers.join('\n')}\n}\nexport type GraphPortType = keyof GraphPortMap\n/** Null marks metadata for a scalar, array or opaque value. */\nexport type GraphTypedMetadataFunction = (inputs: readonly (GraphMatDescriptor | null)[]) => readonly (GraphMatDescriptor | null)[]\n/** Synchronous callback; assign values into outputs and borrow native handles until return. */\nexport type GraphTypedKernelFunction = (inputs: readonly GraphValue[], outputs: GraphValue[]) => undefined\n`
types = types.replace(/gapi_matDesc\(_0: Mat\): any;/, 'gapi_matDesc(image: Mat): GraphMatDescriptor;')
types = types.replace('gapi_networks(_0: any)', 'gapi_networks(parameters: readonly gapi_dnn_Params[])')
types = types.replace(/(export interface gapi_dnn_Params[^]*?\n\})/, block => block.replace('cfgInput(_0: EmbindString, _1: any)', 'cfgInput(name: EmbindString, options: GraphDNNInputOptions)'))
types = types.replace(/(export interface GInferListInputs[^]*?\n\})/, block => block.replace('setInput(_0: EmbindString, _1: any)', 'setInput(name: EmbindString, value: GArray_Rect | GArray_Mat)'))
types = types.replace('gapi_infer(_0: EmbindString, _1: any, _2: GInferInputs): any;', 'gapi_infer(tag: EmbindString, region: GOpaque_Rect, inputs: GInferInputs): GInferOutputs;\n  gapi_infer(tag: EmbindString, regions: GArray_Rect, inputs: GInferInputs): GInferListOutputs;')
types = types.replace('export interface GComputation extends ClassHandle {', 'export interface GComputation extends ClassHandle {\n  /** Serial asynchronous frame processing without native worker threads. */\n  compileStreaming(options?: GCompileArgs): GraphStreamHandle;')
types += `
/** Matrix layout passed by value to custom graph metadata callbacks. */
export type GraphMatDescriptor = {
  /** Scalar element depth, such as CV_8U or CV_32F. */
  depth: number,
  /** Number of channels in each element. */
  channels: number,
  /** Two-dimensional width and height; use dims for tensor shapes. */
  size: Size,
  /** Whether the graph descriptor describes planar channel storage. Defaults to false. */
  planar?: boolean,
  /** Extents in dimension order for an n-dimensional tensor. */
  dims?: readonly number[],
}
/** Derive output layouts from input layouts before allocating graph buffers. */
export type GraphMetadataFunction = (inputs: readonly GraphMatDescriptor[]) => readonly GraphMatDescriptor[]
/** Synchronous CPU kernel. Matrices are borrowed; write into preallocated outputs without resizing them. */
export type GraphKernelFunction = (inputs: readonly Mat[], outputs: readonly Mat[]) => undefined
/** Explicit image preprocessing for a named DNN graph input. Omit cfgInput for raw float tensors. */
export type GraphDNNInputOptions = {
  /** Required width and height of the preprocessed network input. */
  size: Size,
  /** Multiplier applied after mean subtraction. Defaults to 1. */
  scale?: number,
  /** Per-channel mean to subtract; defaults to four zeros. */
  mean?: Scalar,
  /** Swap the first and third input channels before inference. Defaults to false. */
  swapRB?: boolean,
  /** Resize and center-crop to size instead of directly resizing. Defaults to false. */
  crop?: boolean,
}
`
types += `
/** Custom DNN layer initialization. Blob handles are borrowed until the factory returns. */
export type DNNLayerParameters = {
  /** Instance name of the layer in the imported network. */
  name: string,
  /** Registered implementation type requested by the network. */
  type: string,
  /** Named scalar and array configuration parameters parsed from the model. */
  params: Readonly<Record<string, number | bigint | string | readonly (number | bigint | string)[]>>,
  /** Learned tensors borrowed until the factory returns. Retain separate handles if needed later. */
  blobs: readonly Mat[],
}
/** Synchronous CPU callbacks. Write into the preallocated outputs; do not resize or retain borrowed handles. */
export type DNNLayerImplementation = {
  /** Derive output tensor shapes synchronously from the input shapes before buffers are allocated. */
  getMemoryShapes(inputs: readonly (readonly number[])[]): readonly (readonly number[])[],
  /** Fill preallocated output tensors. All matrix handles are borrowed until this synchronous callback returns. */
  forward(inputs: readonly Mat[], outputs: readonly Mat[]): undefined,
}
/** Creates a layer implementation. Clone borrowed matrices when keeping them beyond a callback. */
export type DNNLayerFactory = (parameters: DNNLayerParameters) => DNNLayerImplementation
`
types = types.replace('export interface ClassHandle {', 'export interface ClassHandle {\n  /** Release this native handle at the end of a using scope. */\n  [Symbol.dispose](): void;')
types = types.replace('export interface ClassHandle {', 'export interface ClassHandle {\n  readonly [nativeType]: { ClassHandle: true };')
// C++ permits a derived method to hide a base overload with an incompatible signature.
const classes = new Map([...types.matchAll(/export interface (\w+) extends (\w+) \{([\s\S]*?)\n\}/g)].map(match => [match[1], { base: match[2], clones: /^  clone\(/m.test(match[3]) }]))
const hasNativeClone = name => {
  const cls = classes.get(name)
  return !!cls && (cls.clones || hasNativeClone(cls.base))
}
types = types.replace(/export interface (\w+) extends (\w+) \{([\s\S]*?)\n\}/g, (_, name, base, body) => {
  const names = [...new Set([...body.matchAll(/^  (?:readonly )?(\w+)[(:]/gm)].map(match => match[1]))]
  const nativeClone = hasNativeClone(name)
  const hidden = [...new Set([...names, ...(!nativeClone ? ['clone'] : [])])]
  const parent = hidden.length ? `Omit<${base}, ${hidden.map(name => `'${name}'`).join(' | ')}>` : base
  const clone = nativeClone ? '' : '\n  clone(): this;'
  return `export interface ${name} extends ${parent} {\n  readonly [nativeType]: ${base}[typeof nativeType] & { ${name}: true };${clone}${body}\n}`
})
const parameters = new Map(coverage.functions.map(fn => [fn.name, fn.parameters]))
const source = ts.createSourceFile('opencv.d.ts', types, ts.ScriptTarget.Latest, true)
const edits = []
const visit = node => {
  if (node.kind === ts.SyntaxKind.AnyKeyword) throw new Error('Unspecified native type remains: ' + node.parent.getText(source))
  if (ts.isMethodSignature(node) && ts.isIdentifier(node.name)) {
    let owner = ''
    if (ts.isInterfaceDeclaration(node.parent) && node.parent.name.text !== 'EmbindModule') owner = node.parent.name.text
    else if (ts.isTypeLiteralNode(node.parent) && ts.isPropertySignature(node.parent.parent)) owner = node.parent.parent.name.getText(source)
    const names = parameters.get((owner ? owner + '.' : '') + node.name.text)
    if (names) node.parameters.forEach((param, index) => {
      const name = names[index]
      const token = ts.stringToToken(name)
      const keyword = token !== undefined && token >= ts.SyntaxKind.FirstKeyword && token <= ts.SyntaxKind.LastKeyword
      if (name) edits.push({ start: param.name.getStart(source), end: param.name.end, text: keyword ? name + '_' : name })
    })
  }
  ts.forEachChild(node, visit)
}
visit(source)
for (const edit of edits.sort((a, b) => b.start - a.start)) types = types.slice(0, edit.start) + edit.text + types.slice(edit.end)
await writeFile('lib/opencv.d.ts', await documentTypes(types, coverage))
