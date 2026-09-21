import { createOpenCV, matFromArray, encodeImage, decodeImage } from '../lib/index.js'
import type { Mat, Scalar, OpenCV } from '../lib/index.js'

const cv = await createOpenCV()
using mat = matFromArray(cv, 1, 3, cv.CV_8UC1, [1, 2, 3])
using out = new cv.Mat()
cv.threshold(mat, out, 2, 255, cv.THRESH_BINARY)
const bytes: Uint8Array<ArrayBuffer> = mat.data
const floatData: Float32Array<ArrayBuffer> = mat.data32F
using unsigned = matFromArray(cv, 1, 2, cv.CV_32U, [0, 4_294_967_295])
using wide = matFromArray(cv, 1, 2, cv.CV_64S, [-1n, 9_007_199_254_740_993n])
using bools = matFromArray(cv, 1, 2, cv.CV_Bool, [true, false])
const uintData: Uint32Array<ArrayBuffer> = unsigned.data32U
const bigData: BigInt64Array<ArrayBuffer> = wide.data64S
const unsignedBigData: BigUint64Array<ArrayBuffer> = wide.data64U
// @ts-expect-error Exact 64-bit pixels are bigint, not number.
const wrongWidePixel: number = wide.data64S[0]!
using scalarShape = cv.MatShape.scalar()
const scalarElements: number = scalarShape.total()
void [bools, uintData, bigData, unsignedBigData, scalarElements]
const decoded: Mat = decodeImage(cv, encodeImage(cv, '.png', mat))
const scalar: Scalar = [0, 0, 0, 255]
const svm = cv.ml.SVM.create()
if (!svm) throw new Error('SVM allocation failed')
svm.setKernel(cv.ml.SVM_LINEAR)
const detector = cv.SIFT.create()
const file: Uint8Array = cv.FS.readFile('/image.png')
const text: string = cv.FS.readFile('/config.json', { encoding: 'utf8' })
const baseline: number = cv.getTextSize('text', cv.FONT_HERSHEY_SIMPLEX, 1, 1).baseLine
void [bytes, floatData, decoded, scalar, detector, file, text, baseline]

type IsAny<T> = 0 extends (1 & T) ? true : false
const typedModule: IsAny<OpenCV> = false
const typedMethod: IsAny<OpenCV['Canny']> = false
const typedView: IsAny<Mat['data']> = false
void [typedModule, typedMethod, typedView]

// @ts-expect-error A native operation requires a matrix.
cv.Canny('image', out, 10, 20)
// @ts-expect-error Matrix pixel views carry their actual element type.
const wrongView: Float64Array = mat.data
// @ts-expect-error Scalar contains exactly four components.
const wrongScalar: Scalar = [1, 2]
// @ts-expect-error No arbitrary untyped functions are available.
cv.thisFunctionDoesNotExist()
// @ts-expect-error Namespaces retain argument checks.
cv.ml.SVM.create('bad')
void [wrongView, wrongScalar]

// Native graph nodes and matrices have distinct types even when their handles share methods.
using graphInput = new cv.GMat()
// @ts-expect-error A graph placeholder is not an allocated image.
cv.Canny(graphInput, out, 10, 20)
using graphGray = cv.gapi.BGR2Gray(graphInput)
using graphInputs = cv.GIn([graphInput])
using graphOutputs = cv.GOut([graphGray])
using graph = new cv.GComputation(graphInputs, graphOutputs)
graph.apply([mat])
// @ts-expect-error Graph execution accepts data, not graph placeholders.
graph.apply([graphInput])
using trackerParameters = new cv.TrackerCSRT.Params()
using factorySift = cv.SIFT_create()
using bytecode = new cv.GArray_int()
// @ts-expect-error Typed graph arrays cannot replace a graph matrix.
cv.gapi.BGR2Gray(bytecode)
void [trackerParameters, factorySift]

using matrixSizes = new cv.IntVector()
matrixSizes.push_back(2)
matrixSizes.push_back(3)
using tensor = cv.matWithShape(matrixSizes, cv.CV_32FC1)
using typedFeatures = cv.GArray.Point2f()
using gapiSettings = cv.gapi.compile_args(cv.gapi.core.cpu.kernels())
// @ts-expect-error The font byte overload requires native bytes, not a JavaScript string.
cv.freetype.createFreeType2()!.loadFontData1('font', 0)
void [tensor, typedFeatures, gapiSettings]

cv.dnn_registerLayer('typed', ({ params }) => ({
  getMemoryShapes: inputs => inputs,
  forward: (inputs, outputs) => {
    const first: Mat | undefined = inputs[0]
    const target: Mat | undefined = outputs[0]
    void [first, target, params]
  },
}))
cv.dnn_registerLayer('async', () => ({
  getMemoryShapes: inputs => inputs,
  // @ts-expect-error Native execution requires a synchronous callback.
  forward: async () => {},
}))
using primitiveNode = cv.GArray.Prim()
using drawing = cv.gapi.wip.draw.render3ch(graphInput, primitiveNode)
using cameraOptions = new cv.sfm.libmv_CameraIntrinsicsOptions()
using reconstruction = cv.sfm.SFMLibmvEuclideanReconstruction.create(cameraOptions)
if (reconstruction) {
  using points = new cv.MatVector()
  reconstruction.getPoints(points)
  // @ts-expect-error Reconstruction returns a collection of point matrices.
  reconstruction.getPoints(mat)
}
void drawing

using customOperation = cv.gapi.op('typed', { inputs: 1, outputs: 1, outMeta: inputs => inputs })
using customKernel = cv.gapi.kernel(customOperation, (inputs, outputs) => {
  const source: Mat | undefined = inputs[0], destination: Mat | undefined = outputs[0]
  void [source, destination]
})
// @ts-expect-error Custom graph callbacks must complete synchronously.
cv.gapi.kernel(customOperation, async () => {})
// @ts-expect-error Custom matrix operations require GMat inputs.
customOperation.on([typedFeatures])
using customOptions = cv.gapi.compile_args(customKernel)
await using graphStream = graph.compileStreaming(customOptions)
graphStream.setSource([[mat]])
graphStream.setSource({ pull: () => ({ values: [mat], release: () => { mat.delete() } }) })
graphStream.setSource([{ values: [mat], metadata: { seqId: 3n, timestamp: 1234n } }])
// @ts-expect-error Frame metadata uses bigint to preserve all 64 bits.
graphStream.setSource([{ values: [mat], metadata: { seqId: 3 } }])
using timestamp = cv.gapi.streaming.timestamp(graphInput)
using sequenceId = cv.gapi.streaming.seq_id(graphInput)
graph.applyWithMetadata([mat], { seqId: 0n, timestamp: 1234n })
// @ts-expect-error Frame sources must produce actual graph values.
graphStream.setSource([[graphInput]])
// @ts-expect-error Source callbacks return a frame or null, not an untyped payload.
graphStream.setSource({ pull: () => ({ rows: 1 }) })
using retainedGraph = graph.clone()
retainedGraph.apply([mat])
using matcher = new cv.BFMatcher()
using copiedMatcher = matcher.clone(false)

using graphNet = cv.dnn.readNetFromONNX('/model.onnx')
using networkParams = new cv.gapi.dnn.Params('model', graphNet)
networkParams.cfgInput('input', { size: { width: 224, height: 224 }, scale: 1 / 255, swapRB: true })
// @ts-expect-error Image preprocessing requires a destination size.
networkParams.cfgInput('input', { scale: 1 })
// @ts-expect-error Means use a complete OpenCV scalar.
networkParams.cfgInput('input', { size: { width: 2, height: 2 }, mean: [1, 2] })
using netPackage = cv.gapi.networks(networkParams)
using netOptions = cv.gapi.compile_args(netPackage)
using inferInputs = new cv.GInferInputs()
inferInputs.setInput('input', graphInput)
// @ts-expect-error Inference graph inputs are placeholders, not pixel matrices.
inferInputs.setInput('input', mat)
using inferOutputs = cv.gapi.infer('model', inferInputs)
using inferOutput = inferOutputs.at('output')
const inferredMatrix: import('../lib/index.js').GMat = inferOutput
using regions = cv.GArray.Rect()
using inferList = cv.gapi.infer('model', regions, inferInputs)
using listOutput = inferList.at('output')
const inferredList: import('../lib/index.js').GArray_Mat = listOutput
// @ts-expect-error A list inference returns arrays of tensors.
const wrongInferredMatrix: import('../lib/index.js').GMat = listOutput
using listInputs = new cv.GInferListInputs()
listInputs.setInput('input', regions)
listInputs.setInput('input', listOutput)
// @ts-expect-error infer2 list inputs support rectangles and matrices, not points.
listInputs.setInput('input', typedFeatures)
using infer2Outputs = cv.gapi.infer2('model', graphInput, listInputs)
// @ts-expect-error Network compilation parameters must contain a model.
cv.gapi.networks(customKernel)
// @ts-expect-error The public network adapter is variadic, unlike its flat native entry point.
cv.gapi.networks([networkParams])
void [inferredMatrix, inferredList, wrongInferredMatrix, infer2Outputs, netOptions]

using mixedOperation = cv.gapi.op('typed.mixed', {
  inputs: ['mat', 'array:point2f', 'opaque:int64'],
  outputs: ['mat', 'array:rect', 'scalar', 'opaque:string'],
  outMeta: layouts => [layouts[0], null, null, null],
})
using mixedKernel = cv.gapi.kernel(mixedOperation, (inputs, outputs) => {
  const image: Mat = inputs[0]
  const points: import('../lib/index.js').Point2f[] = inputs[1]
  const sequence: bigint = inputs[2]
  outputs[0].data.set(image.data)
  outputs[1] = points.map(p => ({ x: p.x, y: p.y, width: 1, height: 1 }))
  outputs[2] = [1, 0, 0, 0]
  outputs[3] = String(sequence)
  // @ts-expect-error Output tuple members retain their exact types.
  outputs[3] = 12
  // @ts-expect-error Scalars always contain four values.
  outputs[2] = [1, 2]
})
const mixedOutputs = mixedOperation.on([graphInput, typedFeatures, sequenceId])
const mixedMatrix: import('../lib/index.js').GMat = mixedOutputs[0]
const mixedRects: import('../lib/index.js').GArray_Rect = mixedOutputs[1]
// @ts-expect-error Graph node order is checked against the declared input tuple.
mixedOperation.on([typedFeatures, graphInput, sequenceId])
// @ts-expect-error Every input node is required.
mixedOperation.on([graphInput, typedFeatures])
// @ts-expect-error Output node kinds do not collapse into a broad union.
const invalidMixedMatrix: import('../lib/index.js').GMat = mixedOutputs[1]
// @ts-expect-error Synchronous kernels reject Promise callbacks.
cv.gapi.kernel(mixedOperation, async () => {})
using scalarOperation = cv.gapi.op('typed.scalar', { inputs: ['opaque:int'], outputs: ['opaque:int'] })
using scalarKernel = scalarOperation.kernel((inputs, outputs) => { outputs[0] = inputs[0] + 1 })
// @ts-expect-error Matrix outputs require an outMeta callback.
cv.gapi.op('missing-meta', { inputs: ['mat'], outputs: ['mat'] })
// @ts-expect-error Port types must be supported native types.
cv.gapi.op('wrong-port', { inputs: ['opaque:object'], outputs: ['scalar'] })
// @ts-expect-error Scalar metadata is null, not a matrix layout.
cv.gapi.op('wrong-meta', { inputs: ['mat'], outputs: ['scalar'], outMeta: layouts => [layouts[0]] })
void [mixedKernel, mixedMatrix, mixedRects, invalidMixedMatrix, scalarKernel]
import { initOpenCV, Mat as NamedMat, GaussianBlur, CV_8UC3, dnn_readNetFromONNX, SIFT, ml_SVM } from '../lib/index.js'

await initOpenCV()
using namedSource: NamedMat = new NamedMat(3, 3, CV_8UC3)
using namedTarget = new NamedMat()
GaussianBlur(namedSource, namedTarget, { width: 3, height: 3 }, 1)
using namedDetector = SIFT.create()
using namedClassifier = ml_SVM.create()
// @ts-expect-error Named constructors preserve concrete constructor overloads.
new NamedMat('wrong shape')
// @ts-expect-error Named functions retain exact argument types.
GaussianBlur(namedSource, namedTarget, 3, 1)
// @ts-expect-error Named contrib exports retain their signatures.
dnn_readNetFromONNX(42)
