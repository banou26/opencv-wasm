import type { OpenCV } from '../../../lib/index.js'
import type * as Runtime from '../../../lib/index.js'

/** Worker messages contain ordinary pixel arrays, never native handles. */
type Request = { id: number; pixels: Uint8ClampedArray; width: number; height: number; algorithm: string; amount: number }
let instance: Promise<{ cv: OpenCV; runtime: typeof Runtime }> | undefined
const load = () => instance ??= (async () => {
  const path = '/runtime/index.js'
  const runtime = await import(/* @vite-ignore */ path) as typeof Runtime
  const cv = await runtime.createOpenCV({ wasmUrl: '/runtime/opencv_js.wasm' })
  return { cv, runtime }
})().catch(error => { instance = undefined; throw error })

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const { cv, runtime } = await load()
    const start = performance.now()
    using src = runtime.matFromArray(cv, data.height, data.width, cv.CV_8UC4, data.pixels)
    using gray = new cv.Mat(), dst = new cv.Mat(), intermediate = new cv.Mat()
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    const amount = data.amount, kernel = 2 * Math.max(1, Math.round(amount / 12)) + 1
    switch (data.algorithm) {
      case 'gaussian': cv.GaussianBlur(gray, dst, { width: kernel, height: kernel }, Math.max(.1, amount / 18)); break
      case 'median': cv.medianBlur(gray, dst, kernel); break
      case 'bilateral': cv.bilateralFilter(gray, dst, 9, amount * 2, 7); break
      case 'canny': cv.Canny(gray, dst, amount, amount * 2.5); break
      case 'sobel': cv.Sobel(gray, intermediate, cv.CV_16S, 1, 0); cv.convertScaleAbs(intermediate, dst, amount / 40); break
      case 'threshold': cv.threshold(gray, dst, amount * 2.55, 255, cv.THRESH_BINARY); break
      case 'adaptive': cv.adaptiveThreshold(gray, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, kernel, 5); break
      case 'closing': {
        cv.threshold(gray, intermediate, 127, 255, cv.THRESH_BINARY)
        using element = cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: kernel, height: kernel })
        cv.morphologyEx(intermediate, dst, cv.MORPH_CLOSE, element)
        break
      }
      case 'distance': {
        cv.threshold(gray, intermediate, amount * 2.55, 255, cv.THRESH_BINARY)
        using distances = new cv.Mat()
        cv.distanceTransform(intermediate, distances, cv.DIST_L2, cv.DIST_MASK_PRECISE)
        cv.normalize(distances, dst, 0, 255, cv.NORM_MINMAX, cv.CV_8U)
        break
      }
      case 'clahe': {
        using clahe = cv.createCLAHE(Math.max(.1, amount / 12), { width: 8, height: 8 })
        if (!clahe) throw new Error('CLAHE factory returned no handle')
        clahe.apply(gray, dst)
        break
      }
      default: throw new Error(`Unknown algorithm: ${data.algorithm}`)
    }
    const result = runtime.toImageData(cv, dst), elapsed = performance.now() - start
    self.postMessage({ id: data.id, algorithm: data.algorithm, pixels: result.data, width: result.width, height: result.height, elapsed, version: cv.getVersionString() }, { transfer: [result.data.buffer] })
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }) }
}
