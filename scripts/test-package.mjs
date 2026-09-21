import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { checkEditorDocumentation } from '../tests/editor-docs.mjs'

const repo = resolve('.')
const { name, version } = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
const archive = `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`
const consumer = await mkdtemp(join(tmpdir(), 'opencv-consumer-'))
let browser, server
const version5Check = `
if (cv.getVersionString() !== '5.0.0' || cv.CV_8UC3 !== 64) throw new Error('Installed package has the wrong OpenCV version or matrix type encoding')
using version5Wide = matFromArray(cv, 1, 1, cv.CV_64S, [9_007_199_254_740_993n])
if (version5Wide.data64S[0] !== 9_007_199_254_740_993n) throw new Error('Installed 64-bit pixel lost precision')
using version5Shape = cv.MatShape.scalar()
if (version5Shape.total() !== 1) throw new Error('Installed scalar shape is invalid')
`
const namedCheck = `
await initOpenCV()
using namedInput = new Mat(3, 3, CV_8UC1, [42, 0, 0, 0]), namedOutput = new Mat()
GaussianBlur(namedInput, namedOutput, { width: 3, height: 3 }, 1)
if (!(namedOutput instanceof Mat) || [...namedOutput.data].some(value => value !== 42)) throw new Error('Installed named imports returned wrong pixels')
using namedDecoded = decodeImage(encodeImage('.png', namedOutput))
if (namedDecoded.data[0] !== 42) throw new Error('Installed shared codec helpers returned wrong pixels')
`
const typedKernelCheck = `
using typedOperation = cv.gapi.op('consumer.typed', { inputs: ['array:int'], outputs: ['opaque:string'] })
using typedKernel = cv.gapi.kernel(typedOperation, (inputs, outputs) => { outputs[0] = inputs[0].join(':') })
using typedInput = cv.GArray.Int()
using typedOutput = typedOperation.on([typedInput])[0]
using typedInputs = cv.GIn([typedInput])
using typedOutputs = cv.GOut([typedOutput])
using typedGraph = new cv.GComputation(typedInputs, typedOutputs)
using typedOptions = cv.gapi.compile_args(typedKernel)
if (typedGraph.apply([[2, 3, 5]], typedOptions)[0] !== '2:3:5') throw new Error('Installed typed kernel returned an incorrect result')
`
try {
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  execFileSync('npm', ['install', join(repo, archive), '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'pipe' })
  await writeFile(join(consumer, 'check.ts'), `
import { createOpenCV, matFromArray, initOpenCV, Mat, GaussianBlur, CV_8UC1, decodeImage, encodeImage } from '@banou/opencv-wasm'
const cv = await createOpenCV()
${version5Check}
${namedCheck}
using source = matFromArray(cv, 1, 2, cv.CV_8UC1, [0, 255])
using target: Mat = new cv.Mat()
cv.Canny(source, target, 10, 20)
using placeholder = new cv.GMat()
// @ts-expect-error Distinct native handles must remain distinct in the installed types.
cv.Canny(placeholder, target, 10, 20)
cv.dnn_registerLayer('installed', () => ({
  getMemoryShapes: inputs => inputs,
  forward: (inputs, outputs) => { void [inputs, outputs] },
}))
const data: Uint8Array = source.data
// @ts-expect-error Native pixel types must remain concrete after installation.
const bad: Float64Array = source.data
void [data, bad]
using kernel = cv.gapi.kernel(cv.gapi.op('consumer', { inputs: 1, outputs: 1, outMeta: inputs => inputs }), (inputs, outputs) => { void [inputs, outputs] })
using graphInputs = cv.GIn([placeholder])
using graphOutputs = cv.GOut([cv.gapi.bitwise_not(placeholder)])
using graph = new cv.GComputation(graphInputs, graphOutputs)
await using stream = graph.compileStreaming()
stream.setSource([[source]])
// @ts-expect-error Frame sources cannot yield graph placeholders.
stream.setSource([[placeholder]])
using model = cv.dnn.readNetFromONNX('/model.onnx')
using parameters = new cv.gapi.dnn.Params('installed', model)
parameters.cfgInput('input', { size: { width: 2, height: 2 }, scale: 1 })
using networks = cv.gapi.networks(parameters)
using networkOptions = cv.gapi.compile_args(networks)
using namedInputs = new cv.GInferInputs()
namedInputs.setInput('input', placeholder)
using inference = cv.gapi.infer('installed', namedInputs)
using prediction = inference.at('output')
// @ts-expect-error Named graph inputs require graph nodes.
namedInputs.setInput('input', source)
// @ts-expect-error The public adapter accepts separate parameter objects.
cv.gapi.networks([parameters])
using sequence = cv.gapi.streaming.seq_id(placeholder)
stream.setSource([{ values: [source], metadata: { timestamp: 123n } }])
${typedKernelCheck}
// @ts-expect-error The installed operation preserves its opaque string output type.
cv.gapi.kernel(typedOperation, (inputs, outputs) => { outputs[0] = 42 })
// @ts-expect-error The installed operation rejects an input node of the wrong kind.
typedOperation.on([placeholder])
`)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, noEmit: true, types: [], lib: ['ESNext', 'DOM'] }, files: ['check.ts'] }))
  execFileSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], { stdio: 'pipe' })
  checkEditorDocumentation(join(consumer, 'hover.ts'), '@banou/opencv-wasm')
  execFileSync(process.execPath, ['--input-type=module', '-e', `import {createOpenCV, matFromArray, initOpenCV, Mat, GaussianBlur, CV_8UC1, decodeImage, encodeImage} from '@banou/opencv-wasm'; const cv=await createOpenCV(); if (typeof cv.SIFT.create !== 'function') throw new Error('Missing installed native API'); ${version5Check}
${namedCheck} ${typedKernelCheck}`], { cwd: consumer, stdio: 'pipe' })
  await writeFile(join(consumer, 'index.html'), '<!doctype html><html><head><title>Installed OpenCV</title></head><body><output id="result"></output><script type="module" src="/app.ts"></script></body></html>')
  const modelBytes = [...await readFile(join(repo, 'tests/fixtures/relu.onnx'))]
  await writeFile(join(consumer, 'app.ts'), `
import { createOpenCV, matFromArray, initOpenCV, Mat, GaussianBlur, CV_8UC1, decodeImage, encodeImage } from '@banou/opencv-wasm'
import wasmUrl from '@banou/opencv-wasm/opencv_js.wasm?url'
const cv = await createOpenCV({ wasmUrl })
await initOpenCV({ wasmUrl })
${version5Check}
${namedCheck}
${typedKernelCheck}
const mat = matFromArray(cv, 1, 1, cv.CV_8UC1, [127])
const input = new cv.GMat()
const output = cv.gapi.bitwise_not(input)
const inputs = cv.GIn([input]), outputs = cv.GOut([output])
const graph = new cv.GComputation(inputs, outputs)
const stream = graph.compileStreaming()
graph.delete()
stream.setSource([[mat]])
stream.start()
const result = (await stream.pull())?.[0]
if (!(result instanceof cv.Mat)) throw new Error('Installed graph returned an unexpected value')
const inverted = result.data[0]
await stream.delete()
for (const handle of [result, outputs, inputs, output, input]) handle.delete()
mat.delete()
cv.FS.writeFile('/model.onnx', new Uint8Array(${JSON.stringify(modelBytes)}))
using model = cv.dnn.readNetFromONNX('/model.onnx')
using parameters = new cv.gapi.dnn.Params('installed', model)
using networks = cv.gapi.networks(parameters)
using networkOptions = cv.gapi.compile_args(networks)
using image = matFromArray(cv, 2, 2, cv.CV_32FC1, [-1, 0, 2, 3])
using blob = cv.dnn.blobFromImage(image)
using placeholder = new cv.GMat()
using namedInputs = new cv.GInferInputs()
namedInputs.setInput('input', placeholder)
using inference = cv.gapi.infer('installed', namedInputs)
using prediction = inference.at('output')
using sequence = cv.gapi.streaming.seq_id(placeholder)
using graphInputs = cv.GIn([placeholder])
using graphOutputs = cv.GOut([prediction, sequence])
using inferenceGraph = new cv.GComputation(graphInputs, graphOutputs)
await using inferenceStream = inferenceGraph.compileStreaming(networkOptions)
inferenceStream.setSource([[blob]])
inferenceStream.start()
const predictions = await inferenceStream.pull()
if (!(predictions?.[0] instanceof cv.Mat) || predictions[1] !== 0n) throw new Error('Installed inference stream returned invalid outputs')
using tensor = predictions[0]
if (String([...tensor.data32F]) !== '0,0,2,3') throw new Error('Installed model returned wrong values')
document.querySelector('#result')!.textContent = String(inverted)
`)
  execFileSync(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), 'build', consumer], { cwd: consumer, stdio: 'pipe' })
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    try {
      const file = join(consumer, 'dist', path === '/' ? 'index.html' : path)
      response.setHeader('Content-Type', { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' }[extname(file)] || 'application/octet-stream')
      response.end(await readFile(file))
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const systemChrome = '/etc/profiles/per-user/banou/bin/google-chrome-stable'
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(systemChrome) ? systemChrome : undefined)
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--mute-audio', '--ozone-platform=headless'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => document.querySelector('#result')?.textContent === '128', undefined, { timeout: 15_000 })
  assert.deepEqual(errors, [])
  console.log('Packed consumer passed: NodeNext types and JSDoc hovers, typed kernels in Node and Chromium, Vite assets, graph inference and stream metadata')
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  throw error
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(consumer, { recursive: true, force: true })
}
