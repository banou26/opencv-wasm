import assert from 'node:assert/strict'
import test from 'node:test'
import * as api from '../lib/index.js'
import { initOpenCV, Mat, GaussianBlur, CV_8UC1, THRESH_BINARY, threshold, createOpenCV } from '../lib/index.js'

test('named imports initialize lazily, retry failures and retain native identity', async () => {
  assert.throws(() => new Mat(), /await initOpenCV/)
  assert.throws(() => GaussianBlur(), /await initOpenCV/)
  assert.throws(() => api.ml.SVM, /await initOpenCV/)
  await assert.rejects(initOpenCV({ wasmUrl: new URL('./missing.wasm', import.meta.url), printErr: () => {} }))
  const first = initOpenCV(), concurrent = initOpenCV()
  assert.equal(first, concurrent)
  const cv = await first
  assert.equal(await initOpenCV(), cv)
  assert.equal(Mat, cv.Mat)
  let checked = 0
  for (const [name, value] of Object.entries(api)) if (name in cv) {
    assert.equal(value, cv[name], name)
    checked++
  }
  assert(checked > 4700)
  using input = new Mat(3, 3, CV_8UC1, [42, 0, 0, 0]), smooth = new Mat(), mask = new Mat()
  GaussianBlur(input, smooth, { width: 3, height: 3 }, 1)
  assert.deepEqual([...smooth.data], Array(9).fill(42))
  threshold(smooth, mask, 20, 255, THRESH_BINARY)
  assert.deepEqual([...mask.data], Array(9).fill(255))
  assert(mask instanceof Mat)
  using copied = api.matFromArray(1, 3, CV_8UC1, [1, 2, 3])
  using decoded = api.decodeImage(api.encodeImage('.png', copied))
  assert.deepEqual([...decoded.data], [1, 1, 1, 2, 2, 2, 3, 3, 3])
  using zero = Mat.zeros(2, 2, CV_8UC1)
  assert.deepEqual([...zero.data], [0, 0, 0, 0])
  using detector = api.SIFT.create()
  assert(detector)
  const previous = Mat, other = await createOpenCV()
  assert.notEqual(other.Mat, Mat)
  assert.equal(previous, Mat)
  assert.equal(mask.data[0], 255)
  let owned
  { using disposed = new Mat(); owned = disposed }
  assert(owned.isDeleted())
})
