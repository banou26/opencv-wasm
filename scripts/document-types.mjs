import { readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { apiDocs, manualParameters, familyDoc } from './api-docs.mjs'

const flatten = name => name.replace(/^cv\./, '').replaceAll('.', '_')
const words = value => value.replace(/([a-z\d])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()
const clean = value => value
  .replace(/^\s*\* ?/gm, '')
  .replaceAll('\r', '')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\\(brief|details|param|returns?|note|warning|attention|remark|ref|p|c|b|code|endcode|copybrief|copydetails|copydoc|sa|see|f|ingroup|anchor|cite|overload)\b/g, '@$1')
  .replace(/@(brief|details)\s*/g, '')
  .replace(/@(ingroup|defgroup|addtogroup|anchor|name|snippet|include|image)\b[^\n]*/g, '')
  .replace(/@code(?:\{\.(\w+)\})?/g, (_, language) => '\n```' + (language || 'cpp'))
  .replace(/@endcode/g, '\n```\n')
  .replace(/@f\$/g, '`').replace(/@f\[/g, '\n```math\n').replace(/@f\]/g, '\n```\n')
  .replace(/@(note|warning|attention|remark)\s*/g, (_, tag) => '\n**' + tag[0].toUpperCase() + tag.slice(1) + ':** ')
  .replace(/@(?:ref|p|c|b)\s+([\w:.]+)/g, '`$1`')
  .replace(/@cite\s+(\w+)/g, '[$1]')
  .replace(/@(?:sa|see)\s+/g, 'See: ')
  .replace(/@(?:overload|copybrief|copydetails|copydoc)\b[^\n]*/g, '')
  .replace(/@\{|@\}/g, '')
  .replace(/@(\w+)/g, '$1:')
  .replace(/\*\//g, '* /')
  .replace(/\n(?:\s*\n){2,}/g, '\n\n')
  .trim()

const parse = doc => {
  doc = doc.replace(/^\s*\* ?/gm, '').replace(/\\(param|returns?)\b/g, '@$1')
  const params = new Map()
  let returns = ''
  doc = doc.replace(/@param(?:\s*\[[^\]]+\])?\s+([\w,]+)\s+([\s\S]*?)(?=\n\s*@(?!ref\b|p\b|c\b|b\b|f\b|cite\b)\w|$)/g, (_, names, text) => {
    for (const name of names.split(',')) params.set(name, clean(text))
    return ''
  })
  doc = doc.replace(/@returns?\s+([\s\S]*?)(?=\n\s*@(?!ref\b|p\b|c\b|b\b|f\b|cite\b)\w|$)/g, (_, text) => { returns = clean(text); return '' })
  return { summary: clean(doc), params, returns }
}

const manual = {
  ...apiDocs,
  'ClassHandle': 'An owned handle to an object in this OpenCV instance. Use `using` or `delete()` to release native resources.',
  'ClassHandle.delete': 'Release this handle and its native reference. Accessing it afterwards is invalid. Use `isDeleted()` to avoid deleting it twice.',
  'ClassHandle.deleteLater': 'Schedule this handle for deferred native disposal through Emscripten.',
  'ClassHandle.isDeleted': 'Return whether this native handle has already been released.',
  'ClassHandle.isAliasOf': 'Return whether another handle refers to the same underlying native object.',
  'ClassHandle.clone': 'Create another handle to the same native object. This retains the object without copying its pixels or algorithm state; dispose both handles separately.',
  'Mat.mat_clone': 'Copy the matrix and its pixels into independent, continuous storage. Dispose the returned matrix separately. Use `clone()` only to retain another handle to the same matrix.',
  'Mat.matSize': 'Matrix extents in dimension order. For an image these are rows and columns.',
  'Mat.step': 'Byte strides for each matrix dimension. A region of interest can have a row stride larger than its visible pixel width.',
  'Mat.roi': 'Create an owned matrix header for a rectangular region. Pixel storage is shared with the parent matrix; the result may be non-contiguous.',
  'GOperation': 'A native custom operation with matrix inputs and outputs. Its metadata callback determines the preallocated output layouts.',
  'GOperation.on': 'Connect matrix graph nodes to this operation and return its output nodes. Dispose each returned node handle.',
  'GOperation.kernel': 'Create a CPU kernel package from a synchronous callback. Input and output matrices are borrowed until the callback returns; fill the allocated outputs without resizing.',
  'GTypedOperation': 'A native custom operation supporting matrix, scalar, typed array and opaque ports. Prefer `cv.gapi.op` for exact tuple inference.',
  'GTypedOperation.on': 'Connect input graph nodes in signature order and return the declared output nodes. Incorrect node kinds or counts throw.',
  'GTypedOperation.kernel': 'Create a synchronous CPU kernel. Assign scalar, array and opaque output slots and fill matrix outputs. Matrix and drawing-primitive handles passed to the callback are borrowed until return.',
  'GComputation.apply': 'Execute this native graph using input values in GIn order and return owned outputs in GOut order. The first compilation retains its configuration; create a new computation to change kernels or models. Dispose returned native handles, including handles nested in arrays.',
  'GComputation.applyWithMetadata': 'Execute the graph with signed 64-bit sequence and timestamp metadata attached to every input. Outputs are owned by the caller. Timestamps use microseconds; metadata graph operations should refer to input nodes.',
  'GComputation.compileStreaming': 'Create a serial asynchronous frame executor that retains this graph and its compile arguments. It uses no native worker threads. Dispose it with `await using` or `await delete()`.',
  'GIn': 'Declare the graph input protocol from native graph nodes in execution order. Dispose the returned protocol handle.',
  'GOut': 'Declare the graph output protocol from native graph nodes in result order. Dispose the returned protocol handle.',
  'GCompileArg': 'An owned native graph compilation option. Wrap a kernel package or use a static factory for network and queue options.',
  'GCompileArg.fromNetworks': 'Wrap a native network package for graph compilation. The option retains the configured networks.',
  'GCompileArg.fromQueueCapacity': 'Wrap an upstream native streaming queue capacity. The serial JavaScript GraphStream does not prefetch frames.',
  'gapi_dnn_Params': 'Configuration for a named OpenCV DNN graph network. Retains the supplied Net and selects its CPU backend. Configure image preprocessing before packaging with `cv.gapi.networks`.',
  'gapi_dnn_Params.cfgInput': 'Configure image preprocessing for a named network input using native blobFromImage. Size is required; scale defaults to 1, mean to zero, and swapRB/crop to false. Omit this call for prepared float tensors.',
  'GInferInputs': 'Named matrix graph inputs for native graph inference. Construct it, set model input names, then pass it to `cv.gapi.infer`.',
  'GInferListInputs': 'Named region or prepared-tensor graph lists for `cv.gapi.infer2`. Every list in one execution must have the same length.',
  'GInferInputs.setInput': 'Bind or replace a named model input with a GMat graph node before constructing the inference operation. This setter returns void.',
  'GInferListInputs.setInput': 'Bind or replace a named model input with a rectangle list or matrix list node. Rectangle lists use configured image preprocessing; matrix lists contain prepared float tensors.',
  'GInferOutputs': 'Named matrix output nodes of an inference operation. Obtain this object through `cv.gapi.infer`, then request all output names before constructing the computation.',
  'GInferListOutputs': 'Named lists of tensor output nodes from region/list inference. Request output names before constructing the computation.',
  'GInferOutputs.at': 'Get an owned GMat node for a named model output. Repeated requests for a name refer to the same graph output.',
  'GInferListOutputs.at': 'Get an owned GArray_Mat node for a named model output. Executing it produces an array of owned matrices, one per input item.',
  'gapi_infer': 'Construct native graph inference for named tensor/image inputs, one region, or a list of regions. Compile with a matching OpenCV DNN network tag. Region inference requires a single image input with explicit preprocessing.',
  'gapi_infer2': 'Construct inference over equally sized named lists of rectangles and/or prepared tensors. Rectangles are cropped from the shared image; tensor lists bypass preprocessing. Empty inputs produce empty lists.',
  'gapi_networks': 'Create a native network package from an array of OpenCV DNN parameter objects. Tags must be unique. The namespaced `cv.gapi.networks` adapter instead takes separate arguments.',
  'gapi_matDesc': 'Describe matrix depth, channels, size, planar layout and tensor dimensions for custom graph metadata callbacks.',
  'gapi_emptyKernels': 'Create an empty native kernel package that can be combined with CPU implementations.',
  'dnn_registerLayer': 'Register a synchronous TypeScript DNN layer factory. It receives borrowed model blobs and returns shape and forward callbacks. Forward callbacks write preallocated outputs; borrowed handles expire when the callback returns.',
  'dnn_unregisterLayer': 'Unregister a TypeScript layer factory for future DNN layer creation. Existing networks retain their constructed layers.',
  'matWithShape': 'Allocate an owned matrix with arbitrary tensor dimensions supplied in an IntVector and an OpenCV element type. Fill it through the typed pixel views.',
  'reshapeWithShape': 'Create an owned matrix header with new channel count and tensor dimensions without copying pixels. The total element count must stay unchanged and native continuity rules apply.',
  'exceptionFromPtr': 'Read an OpenCV cv::Exception from a numeric native exception pointer. Its message includes the failing native assertion or operation.',
  '_malloc': 'Allocate bytes in this instance\'s WASM heap and return a numeric pointer. Free it with `_free` when finished; normal matrix APIs manage their own allocations.',
  '_free': 'Release a pointer allocated by this instance\'s `_malloc`. Do not free matrix pixel pointers or pointers owned by another instance.',
}

/** Add source-backed JSDoc and publish an audit of remaining upstream documentation gaps. */
export const documentTypes = async (types, coverage) => {
  const upstream = JSON.parse(await readFile('build/api-docs.json', 'utf8'))
  const byName = new Map(), byFlat = new Map()
  const namespaces = coverage.namespaces.toSorted((a, b) => b.length - a.length)
  for (const entry of upstream.entries) {
    if (entry.kind === 'constant' || entry.kind === 'property') entry.doc ||= upstream.comments[entry.source]?.[entry.name.split('.').at(-1)] || ''
    for (const [map, name] of [[byName, entry.name], [byFlat, flatten(entry.name)]]) map.set(name, [...(map.get(name) || []), entry])
    if (entry.kind === 'constant') {
      const flat = flatten(entry.name), upper = flat.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
      byFlat.set(upper, [...(byFlat.get(upper) || []), entry])
      const prefix = namespaces.find(ns => entry.name.startsWith('cv.' + ns + '.'))
      if (prefix) {
        const alias = prefix.replaceAll('.', '_') + '_' + entry.name.slice(prefix.length + 4).replaceAll('.', '_').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
        byFlat.set(alias, [...(byFlat.get(alias) || []), entry])
      }
      if (entry.enum) byFlat.set(flatten(entry.enum) + '_' + entry.name.split('.').at(-1), [entry])
    }
  }
  const functions = new Map(coverage.functions.map(fn => [fn.name, fn]))
  const source = ts.createSourceFile('opencv.d.ts', types, ts.ScriptTarget.Latest, true)
  const raw = await readFile('build/wasm5/bin/opencv.d.ts', 'utf8')
  const rawSource = ts.createSourceFile('raw.d.ts', raw, ts.ScriptTarget.Latest, true)
  const nativeClones = new Set(rawSource.statements.filter(ts.isInterfaceDeclaration).filter(node => node.members.some(m => m.name?.getText(rawSource) === 'clone')).map(node => node.name.text))
  const interfaces = new Map(source.statements.filter(ts.isInterfaceDeclaration).map(node => [node.name.text, node]))
  const resolvedDocs = new Map()
  const resolveDoc = (entry, visited = new Set()) => {
    if (!entry || visited.has(entry.name)) return ''
    if (resolvedDocs.has(entry)) return resolvedDocs.get(entry)
    visited = new Set([...visited, entry.name])
    const doc = entry.doc.replace(/[@\\](copybrief|copydetails|copydoc)\s+([\w:.]+)/g, (_, tag, reference) => {
      const qualified = reference.replaceAll('::', '.')
      const target = byName.get(qualified)?.[0] || byName.get(entry.name.split('.').slice(0, -1).join('.') + '.' + qualified)?.[0] || byName.get('cv.' + qualified)?.[0]
      return resolveDoc(target, visited)
    })
    resolvedDocs.set(entry, doc)
    return doc
  }
  const report = { declarations: 0, upstream: 0, manual: 0, structural: 0, fallback: [], missing: [] }
  const edits = []
  const getEntries = (owner, name) => {
    const key = owner ? owner + '.' + name : name
    const fn = functions.get(key)
    if (fn) {
      const nativeOwner = byFlat.get(owner)?.find(e => ['class', 'struct'].includes(e.kind))?.name
      const native = fn.cpp.startsWith('cv::') ? fn.cpp.replaceAll('::', '.') : (nativeOwner || 'cv.' + owner.replaceAll('_', '.')) + '.' + fn.cpp
      return [...(byName.get(native) || []), ...(coverage.classBases[owner] ? getEntries(coverage.classBases[owner], /^[\w]+$/.test(fn.cpp) ? fn.cpp : name) : [])]
    }
    if (owner && name === 'new') {
      const cls = byFlat.get(owner)?.find(e => ['class', 'struct'].includes(e.kind))
      return cls ? byName.get(cls.name + '.' + cls.name.split('.').at(-1)) || [cls] : []
    }
    if (owner && name === 'mat_clone') return byName.get('cv.Mat.clone') || []
    let entries = byFlat.get((owner ? owner + '_' : '') + name) || []
    if (owner && coverage.classBases[owner]) entries = [...entries, ...getEntries(coverage.classBases[owner], name)]
    // Flat Python factory aliases refer to the exact same static class function.
    if (!entries.length && !owner) {
      const match = name.match(/^(.+)_(create\d*|load\d*)$/)
      if (match) entries = getEntries(match[1], match[2])
    }
    return entries
  }
  const add = (node, owner = '') => {
    if (node.name?.getText(source).startsWith('[')) return
    const name = ts.isConstructSignatureDeclaration(node) ? 'new' : node.name?.getText(source).replace(/^['"]|['"]$/g, '')
    if (!name) return
    const key = owner ? owner + '.' + name : name
    report.declarations++
    if (node.jsDoc?.length) { report.manual++; return }
    const callable = ts.isMethodSignature(node) || ts.isConstructSignatureDeclaration(node) || ts.isCallSignatureDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isGetAccessorDeclaration(node)
    const params = callable ? node.parameters : []
    let candidates = getEntries(owner, name)
    const fn = functions.get(key)
    const wanted = fn?.parameters || params.map(p => p.name.getText(source))
    const score = e => wanted.filter(n => e.parameters.some(p => p[1] === n)).length * 10 - Math.abs(e.parameters.length - params.length)
    candidates = candidates.toSorted((a, b) => score(b) - score(a))
    const selected = candidates[0]
    const inheritedDoc = resolveDoc(candidates.find(e => parse(resolveDoc(e)).summary.length > 0))
    let parsed = parse(resolveDoc(selected))
    if (!parsed.summary) parsed = { ...parse(inheritedDoc), params: new Map([...parse(inheritedDoc).params, ...parsed.params]), returns: parsed.returns || parse(inheritedDoc).returns }
    if (!parsed.summary && owner && /^(get|set)[A-Z]/.test(name)) {
      const counterpart = getEntries(owner, (name.startsWith('get') ? 'set' : 'get') + name.slice(3)).find(e => parse(resolveDoc(e)).summary)
      const description = parse(resolveDoc(counterpart)).summary
      if (description) parsed.summary = `${name.startsWith('get') ? 'Read' : 'Configure'} the ${words(name.slice(3))}.\n\n${description}`
    }
    const originalSummary = parsed.summary
    let summary = manual[key] || (owner === 'WasmModule' ? manual[name] : '') || ''
    let category = summary ? 'manual' : ''
    const vector = interfaces.get(owner || name)?.members.some(m => m.name?.getText(source) === 'push_back')
    const lifetimeClone = name === 'clone' && !nativeClones.has(owner) && !functions.has(key)
    if (!summary && (name in { delete: 1, deleteLater: 1, isDeleted: 1, isAliasOf: 1 } || lifetimeClone)) {
      summary = manual['ClassHandle.' + name]; category = 'structural'
    }
    if (!summary && vector && callable) {
      summary = ({ get: 'Read an element by index. Object elements are returned as owned native handles that require disposal.', set: 'Replace an element by index and return whether the assignment succeeded.', push_back: 'Append one element, copying its native value into this vector.', resize: 'Change the vector length, filling new entries with the supplied value.', size: 'Return the number of elements in this native vector.', new: 'Create an empty owned native vector. Dispose it with using or delete().' })[name] || ''
      category = summary ? 'structural' : ''
    }
    if (!summary && owner === 'Mat' && /^(data|ptr|ucharPtr|charPtr|shortPtr|ushortPtr|intPtr|floatPtr|doublePtr)/.test(name)) {
      summary = `View matrix pixels as ${node.type?.getText(source) || 'typed data'} backed by this instance's WASM memory. Copy before retaining data across memory growth. For non-contiguous regions, use row pointers and strides.`
      category = 'manual'
    }
    if (!summary && owner === 'Mat' && /^(char|uchar|short|ushort|int|float|double)At$/.test(name)) {
      const depth = { char: 'signed 8-bit', uchar: 'unsigned 8-bit', short: 'signed 16-bit', ushort: 'unsigned 16-bit', int: 'signed 32-bit', float: '32-bit floating-point', double: '64-bit floating-point' }[name.slice(0, -2)]
      summary = `Read a ${depth} scalar at the supplied zero-based matrix indices. The accessor must match the stored element depth. The three-index overload addresses a three-dimensional tensor; it does not select an image channel.`
      category = 'manual'
    }
    if (!summary && parsed.summary) { summary = parsed.summary; category = 'upstream' }
    if (!summary && callable) { summary = familyDoc(owner, name); if (summary) category = 'manual' }
    if (!summary && vector) { summary = 'An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.'; category = 'structural' }
    if (!summary && (owner.startsWith('map_') || name.startsWith('map_'))) {
      summary = ({ get: 'Look up a native value by key; an absent entry returns undefined. Dispose returned native object handles separately.', set: 'Insert or replace a native value by key.', keys: 'Return an owned native vector containing the map keys.', size: 'Return the number of entries in this native map.' })[name] || 'An owned native map with typed keys and values. Use get, set, keys and size to access its entries, and delete to release it.'
      category = 'structural'
    }
    if (!summary && callable && /(?:^|_)(?:create\w*|from\d*)$/.test(name)) {
      const className = owner || (node.type?.getText(source) || '').replace(' | null', '')
      const cls = byFlat.get(className)?.find(e => ['class', 'struct'].includes(e.kind))
      const purpose = parse(resolveDoc(cls)).summary.split(/\n\s*\n/)[0]
      summary = `Create an owned ${className} instance with the supplied configuration.${purpose ? '\n\n' + purpose : ''}`
      category = purpose ? 'upstream' : 'structural'
    }
    if (!summary && name.startsWith('GArray_')) { summary = `A typed array graph node for ${words(name.slice(7))} values. It describes graph data; execution receives and returns ordinary arrays.`; category = 'structural' }
    if (!summary && name.startsWith('GOpaque_')) { summary = `A graph node carrying one ${words(name.slice(8))} value. It holds a graph relationship rather than a runtime value.`; category = 'structural' }
    if (!summary && name === 'new') { summary = `Create an owned ${owner} object. Release native handles with using or delete().`; category = 'structural' }
    if (!summary && name.startsWith('HEAP')) { summary = `Typed view of this instance's WASM memory. Growth can invalidate a previously retained view; read this property again after native allocations.`; category = 'structural' }
    if (!summary && /^(?:flann_IndexParams|dnn_LayerParams)$/.test(owner) && name.startsWith('set')) {
      summary = name === 'setAlgorithm' ? 'Select the native FLANN index algorithm.' : `Store a named ${words(name.slice(3))} configuration value for this ${owner === 'dnn_LayerParams' ? 'DNN layer' : 'FLANN index'}.`
      category = 'manual'
    }
    if (!summary && /^(Point|Size|Rect)(?:2[ifd]|3[ifd])?$/.test(name)) {
      summary = name.startsWith('Point') ? `A ${name.startsWith('Point3') ? 'three' : 'two'}-dimensional coordinate value with numeric components. No native disposal is required.` : name.startsWith('Size') ? 'An extent described by width and height. No native disposal is required.' : 'An upright rectangle described by its top-left x/y and width/height. No native disposal is required.'
      category = 'structural'
    }
    if (!summary && /^(Vec\d+[ifd]|Matx\d+[ifd])$/.test(name)) { summary = 'Fixed-size numeric components passed by value as a JavaScript tuple. No native disposal is required.'; category = 'structural' }
    if (!summary && name.startsWith('tuple_')) { summary = 'Ordered graph output nodes returned together by one native graph operation. Dispose each native node handle separately.'; category = 'structural' }
    if (!summary && /^CV_(8U|8S|16U|16S|32S|32F|64F|16F)(C\d+)?$/.test(name)) {
      const [, depth, channels] = name.match(/^CV_(8U|8S|16U|16S|32S|32F|64F|16F)(C\d+)?$/)
      summary = `Matrix ${channels ? 'type' : 'depth'} code for ${depth.slice(0, -1)}-bit ${depth.endsWith('F') ? 'floating-point' : depth.endsWith('U') ? 'unsigned integer' : 'signed integer'} elements${channels ? ' with ' + channels.slice(1) + ' channels' : ''}.`
      category = 'structural'
    }
    if (!summary && (name.endsWith('Value') && ts.isInterfaceDeclaration(node) || name === 'value' && owner.endsWith('Value'))) {
      summary = name === 'value' ? 'Numeric value of this native enum entry. Use .value when an API accepts a number.' : 'A native enum entry wrapping its numeric .value. Flat OpenCV constants expose the corresponding numbers directly.'
      category = 'structural'
    }
    if (!summary && selected?.kind === 'enum') { summary = `Native enum entries for ${words(name)}. Pass an entry to enum-typed arguments or its .value to numeric arguments.`; category = 'structural' }
    if (!summary && (owner === 'GraphPortMap' || owner.includes(':') || ['mat', 'scalar'].includes(owner))) {
      summary = name === 'node' ? 'Graph placeholder type used when connecting this port.' : name === 'value' ? 'JavaScript value type passed to and from this port during execution.' : `Graph node and runtime value types for a ${name} port.`
      category = 'structural'
    }
    if (!summary && (owner.endsWith('Result') || name.endsWith('Result'))) {
      const operation = (owner || name).replace(/Result$/, '')
      const target = functions.get(operation) || functions.get(operation.replace(/_(?=[^_]+$)/, '.'))
      const entry = target ? getEntries(target.name.includes('.') ? target.name.split('.')[0] : '', target.name.split('.').at(-1))[0] : undefined
      const detail = parse(resolveDoc(entry))
      summary = owner ? name === 'value' ? `Native return value from ${operation}. ${detail.returns}` : `Output ${name} from ${operation}. ${detail.params.get(name) || ''}` : `Named return value and scalar output parameters from ${operation}. Matrix and vector output arguments are filled in place.`
      category = 'structural'
    }
    if (!summary && owner && ['x', 'y', 'z', 'width', 'height'].includes(name)) {
      summary = ({ x: 'Horizontal coordinate', y: 'Vertical coordinate', z: 'Third coordinate', width: 'Horizontal extent', height: 'Vertical extent' })[name] + ` of this ${owner} value.`
      category = 'structural'
    }
    if (!summary && selected?.kind === 'constant') { summary = `${words(name)} constant (${selected.return}), defined by OpenCV for ${selected.name.split('.').slice(0, -1).join('::')}.`; category = 'fallback' }
    if (!summary) {
      if (/^get[A-Z]/.test(name)) summary = `Return the ${words(name.slice(3))} configured on this ${owner} object.`
      else if (/^set[A-Z]/.test(name)) summary = `Set the ${words(name.slice(3))} used by this ${owner} object.`
      else if (/^(create|from\d*)$/.test(name)) summary = `Construct a ${owner || name} instance with the supplied configuration.`
      else if (callable) summary = `${owner ? owner + '.' : ''}${name} native operation${selected ? ' from ' + selected.name.replaceAll('.', '::') : ''}.`
      else summary = `${words(name)} ${ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ? 'type' : 'value'}${owner ? ' for ' + owner : ' in the OpenCV API'}.`
      category = 'fallback'
    }
    if (summary.length < 15) summary = `${owner ? owner + '.' : ''}${name}: ${summary}`
    const lines = [summary]
    if (callable) {
      for (let i = 0; i < params.length; i++) {
        const p = params[i]
        const current = p.name.getText(source)
        const original = selected?.parameters.find(a => a[1] === current) || selected?.parameters[i]
        const suggested = manualParameters[key]?.[i] || (owner === 'WasmModule' ? manualParameters[name]?.[i] : undefined) || original?.[1]
        const label = /^_\d+$/.test(current) && suggested && /^[a-zA-Z_]\w*$/.test(suggested) && !ts.stringToToken(suggested) ? suggested : current
        if (label !== current) edits.push({ start: p.name.getStart(source), end: p.name.end, text: label })
        let detail = parsed.params.get(label) || parsed.params.get(original?.[1]) || `${words(label)} argument (${p.type?.getText(source) || 'value'}).`
        if (original?.[3]?.includes('/O')) detail = 'Output destination, filled by the native operation. ' + detail
        if (original?.[3]?.includes('/IO')) detail = 'Input/output value, modified by the native operation. ' + detail
        if (original?.[2] && p.questionToken) detail += ` Native default when omitted: \`${original[2]}\`.`
        lines.push(`@param ${label} ${detail}`)
      }
      const resultType = node.type?.getText(source)
      if (resultType && resultType !== 'void' && resultType !== 'undefined') {
        let detail = parsed.returns || `The ${resultType} result.`
        if (/Result\b/.test(resultType)) detail += ' Scalar output parameters are returned as named fields in this object.'
        if (/\b(Mat|\w*Vector|\w*Package|G\w*|\w*Result)\b/.test(resultType)) detail += ' Release returned native handles with using or delete(), including handles nested in results.'
        lines.push('@returns ' + detail)
      }
    }
    if (selected) {
      const match = selected.source.match(/^vendor\/(opencv(?:_contrib)?)-5\.0\.0\/(.*)$/)
      if (match) lines.push(`@see https://github.com/opencv/${match[1]}/blob/5.0.0/${match[2]}#L${selected.line}`)
    }
    const lineStart = types.lastIndexOf('\n', node.getStart(source) - 1) + 1
    const indent = types.slice(lineStart, node.getStart(source)).match(/^\s*/)[0]
    const prefix = types.slice(lineStart, node.getStart(source)).trim() ? '\n' + indent : ''
    const doc = prefix + '/**\n' + lines.join('\n\n').split('\n').map(line => indent + ' *' + (line ? ' ' + line : '')).join('\n') + '\n' + indent + ' */\n' + indent
    edits.push({ start: node.getStart(source), end: node.getStart(source), text: doc })
    if (category === 'fallback') report.fallback.push({ name: key, source: selected?.source, hasParameterDescriptions: parsed.params.size > 0, hasUpstreamSummary: !!originalSummary })
    else report[category]++
  }
  const children = (node, owner) => {
    if (ts.isTypeLiteralNode(node)) for (const member of node.members) { add(member, owner); if (member.type) children(member.type, owner + '.' + member.name?.getText(source)) }
    else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) for (const type of node.types) children(type, owner)
  }
  for (const node of source.statements) {
    if (ts.isInterfaceDeclaration(node)) {
      add(node)
      for (const member of node.members) {
        add(member, node.name.text === 'EmbindModule' ? '' : node.name.text)
        if (member.type && ts.isTypeLiteralNode(member.type) && !member.name.getText(source).startsWith('[')) for (const child of member.type.members) add(child, member.name.getText(source).replace(/^['"]|['"]$/g, ''))
      }
    } else if (ts.isTypeAliasDeclaration(node)) { add(node); children(node.type, node.name.text) }
    else if (ts.isVariableStatement(node)) for (const decl of node.declarationList.declarations) if (decl.name.getText(source) === 'RuntimeExports') children(decl.type, 'RuntimeExports')
  }
  const pieces = []
  let cursor = 0
  for (const edit of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    pieces.push(types.slice(cursor, edit.start), edit.text)
    cursor = edit.end
  }
  pieces.push(types.slice(cursor))
  types = pieces.join('')
  const documented = ts.createSourceFile('documented.d.ts', types, ts.ScriptTarget.Latest, true)
  const audit = node => {
    if (node.name?.getText(documented) === '[nativeType]') return
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isPropertySignature(node) || ts.isMethodSignature(node) || ts.isConstructSignatureDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && !node.jsDoc?.some(doc => ts.getTextOfJSDocComment(doc.comment)?.trim())) {
      report.missing.push({ name: node.name?.getText(documented) || 'constructor', line: documented.getLineAndCharacterOfPosition(node.getStart(documented)).line + 1 })
    }
    ts.forEachChild(node, audit)
  }
  audit(documented)
  await writeFile('lib/documentation.json', JSON.stringify(report, null, 2) + '\n')
  if (report.missing.length) throw new Error(`JSDoc missing from ${report.missing.length} declarations; see lib/documentation.json`)
  console.log(`JSDoc: ${report.declarations} declarations; ${report.upstream} upstream, ${report.manual} manual, ${report.structural} structural, ${report.fallback.length} limited upstream descriptions`)
  return types
}
