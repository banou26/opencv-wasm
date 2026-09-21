import { expect, test } from '@playwright/test'

test('named imports initialize once and execute native constructors and algorithms', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const api = await import('/lib/index.js')
    let before = ''
    try { new api.Mat() } catch (error) { before = String(error) }
    const first = api.initOpenCV(), second = api.initOpenCV()
    const cv = await first
    using input = new api.Mat(3, 3, api.CV_8UC1, [42, 0, 0, 0]), output = new api.Mat()
    api.GaussianBlur(input, output, { width: 3, height: 3 }, 1)
    using sift = api.SIFT.create()
    using rgba = api.matFromImageData(new ImageData(new Uint8ClampedArray([11, 22, 33, 255]), 1, 1))
    const pixels = [...api.toImageData(rgba).data]
    return { before, sameLoad: first === second, identity: api.Mat === cv.Mat,
      instance: output instanceof api.Mat, pixels: [...output.data], sift: !!sift,
      dnn: typeof api.dnn_readNetFromONNX, fs: api.FS === cv.FS, rgba: pixels }
  })
  expect(result.before).toContain('await initOpenCV')
  expect(result).toMatchObject({ sameLoad: true, identity: true, instance: true,
    pixels: Array(9).fill(42), sift: true, dnn: 'function', fs: true, rgba: [11, 22, 33, 255] })
})

test('Chromium executes OpenCV 5 matrix types, shapes and CPU additions', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runOpenCV5Checks } = await import('/tests/opencv5-checks.mjs')
    return runOpenCV5Checks(await helpers.createOpenCV(), helpers)
  })
  expect(result).toHaveLength(8)
})

test('real Chromium executes native algorithms and image conversion', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runChecks } = await import('/tests/runtime-checks.mjs')
    const cv = await helpers.createOpenCV()
    const model = new Uint8Array(await (await fetch('/tests/fixtures/relu.onnx')).arrayBuffer())
    const checks = runChecks(cv, helpers, model)
    const original = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1)
    const mat = helpers.matFromImageData(cv, original)
    const restored = helpers.toImageData(cv, mat)
    mat.delete()
    return { checks, pixels: Array.from(restored.data), isolated: crossOriginIsolated }
  })
  expect(result.checks).toHaveLength(12)
  expect(result.pixels).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  expect(result.isolated).toBe(false)
})

test('ES module worker loads its own native runtime', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/tests/worker.mjs', { type: 'module' })
    worker.onmessage = event => { worker.terminate(); resolve(event.data) }
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)) }
  }))
  expect(result).toEqual({ data: [0, 255], exports: true })
})

test('Chromium executes graphs, video files and Python API aliases', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runParityChecks } = await import('/tests/parity-checks.mjs')
    const cv = await helpers.createOpenCV()
    try { return runParityChecks(cv, helpers) }
    catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
  })
  expect(result).toHaveLength(5)
})

test('Chromium executes font rendering, OCR, HDF5 and SFM', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runDependencyChecks } = await import('/tests/dependency-checks.mjs')
    const cv = await helpers.createOpenCV()
    const assets = await Promise.all(['/vendor/dependencies/harfbuzz-10.2.0/perf/fonts/Roboto-Regular.ttf', '/.cache/eng.traineddata'].map(async path => new Uint8Array(await (await fetch(path)).arrayBuffer())))
    try { return runDependencyChecks(cv, helpers, ...assets) }
    catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
  })
  expect(result).toHaveLength(5)
})

test('Chromium contrib results agree with native Python', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runModuleChecks } = await import('/tests/module-checks.mjs')
    const reference = await (await fetch('/tests/fixtures/python-behavior.json')).json()
    return runModuleChecks(await helpers.createOpenCV(), helpers, reference)
  })
  expect(result).toHaveLength(16)
})

test('Chromium runs custom graph kernels and async streams', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runGraphChecks } = await import('/tests/graph-checks.mjs')
    const cv = await helpers.createOpenCV()
    try { return await runGraphChecks(cv, helpers) }
    catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
  })
  expect(result).toHaveLength(6)
})

test('Chromium executes DNN graph tensor, region and list inference', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runInferenceChecks } = await import('/tests/inference-checks.mjs')
    const models = await Promise.all(['relu', 'arithmetic'].map(async name => new Uint8Array(await (await fetch(`/tests/fixtures/${name}.onnx`)).arrayBuffer())))
    const reference = await (await fetch('/tests/fixtures/python-behavior.json')).json()
    const cv = await helpers.createOpenCV()
    try {
      const checks = []
      for (const engine of [cv.dnn.ENGINE_NEW, cv.dnn.ENGINE_CLASSIC]) {
        checks.push(...await runInferenceChecks(cv, helpers, ...models, reference, engine))
      }
      return checks
    }
    catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
  })
  expect(result).toHaveLength(12)
})

test('Chromium executes typed custom kernels with scalar, array and opaque ports', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helpers = await import('/lib/index.js')
    const { runTypedGraphChecks } = await import('/tests/typed-graph-checks.mjs')
    const cv = await helpers.createOpenCV()
    try { return runTypedGraphChecks(cv, helpers) }
    catch (error) { if (typeof error === 'number') throw new Error(cv.exceptionFromPtr(error).msg); throw error }
  })
  expect(result).toHaveLength(5)
})
