import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as helpers from '../lib/index.js'
import { runChecks } from './runtime-checks.mjs'
import { runParityChecks } from './parity-checks.mjs'
import { runDependencyChecks } from './dependency-checks.mjs'
import { runModuleChecks } from './module-checks.mjs'
import { runGraphChecks } from './graph-checks.mjs'
import { runInferenceChecks } from './inference-checks.mjs'
import { runTypedGraphChecks } from './typed-graph-checks.mjs'
import { runOpenCV5Checks } from './opencv5-checks.mjs'

const cv = await helpers.createOpenCV({ wasmBinary: await readFile(new URL('../lib/opencv_js.wasm', import.meta.url)) })
const model = await readFile(new URL('./fixtures/relu.onnx', import.meta.url))

test('OpenCV 5 types, tensor shapes and CPU additions execute', () => {
  assert.equal(runOpenCV5Checks(cv, helpers).length, 8)
})

test('native algorithms, codecs and model inference', () => {
  try { assert.equal(runChecks(cv, helpers, model).length, 12) }
  catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
})

test('invalid inputs fail without leaving unusable matrices', () => {
  assert.throws(() => helpers.matFromArray(cv, 2, 2, cv.CV_8UC1, [1]), RangeError)
  assert.throws(() => helpers.decodeImage(cv, new Uint8Array([1, 2, 3])), /could not decode/)
  const mat = helpers.matFromArray(cv, 1, 1, cv.CV_8UC1, [42])
  assert.equal(mat.data[0], 42)
  mat.delete()
})

test('Python CPU parity additions execute', () => {
  try { assert.equal(runParityChecks(cv, helpers).length, 5) }
  catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
})

test('font rendering, OCR, HDF5 and SFM execute', async () => {
  const font = await readFile(new URL('../vendor/dependencies/harfbuzz-10.2.0/perf/fonts/Roboto-Regular.ttf', import.meta.url))
  const language = await readFile(new URL('../.cache/eng.traineddata', import.meta.url))
  try { assert.equal(runDependencyChecks(cv, helpers, font, language).length, 5) }
  catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
})

test('default loading resolves the colocated WASM in Node', async () => {
  const other = await helpers.createOpenCV()
  assert.match(other.getBuildInformation(), /5\.0\.0/)
  assert.notEqual(other.HEAPU8.buffer, cv.HEAPU8.buffer)
})

test('contrib modules execute and agree with native Python numeric fixtures', async () => {
  const reference = JSON.parse(await readFile(new URL('./fixtures/python-behavior.json', import.meta.url), 'utf8'))
  assert.equal(runModuleChecks(cv, helpers, reference).length, 16)
})

test('custom graph kernels and asynchronous frame sources execute', async () => {
  try { assert.equal((await runGraphChecks(cv, helpers)).length, 6) }
  catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
})

test('native DNN graph inference handles tensors, regions and lists', async () => {
  const arithmetic = await readFile(new URL('./fixtures/arithmetic.onnx', import.meta.url))
  const reference = JSON.parse(await readFile(new URL('./fixtures/python-behavior.json', import.meta.url), 'utf8'))
  try {
    for (const engine of [cv.dnn.ENGINE_NEW, cv.dnn.ENGINE_CLASSIC]) {
      assert.equal((await runInferenceChecks(cv, helpers, model, arithmetic, reference, engine)).length, 6)
    }
  }
  catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
})

test('typed custom graph kernels handle scalars, arrays and opaque values', () => {
  try { assert.equal(runTypedGraphChecks(cv, helpers).length, 5) }
  catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
})
