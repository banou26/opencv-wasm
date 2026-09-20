import { createOpenCV, matFromArray } from '../lib/index.js'
const cv = await createOpenCV()
const input = matFromArray(cv, 1, 2, cv.CV_8UC1, [42, 200])
const result = new cv.Mat()
cv.threshold(input, result, 100, 255, cv.THRESH_BINARY)
postMessage({ data: [...result.data], exports: typeof cv.dnn.readNetFromONNX === 'function' })
result.delete()
input.delete()
