import { initOpenCV, Mat, CV_8UC1, threshold, THRESH_BINARY, dnn_readNetFromONNX } from '../lib/index.js'
await initOpenCV()
const input = new Mat(1, 2, CV_8UC1)
input.data.set([42, 200])
const result = new Mat()
threshold(input, result, 100, 255, THRESH_BINARY)
postMessage({ data: [...result.data], exports: typeof dnn_readNetFromONNX === 'function' })
result.delete()
input.delete()
