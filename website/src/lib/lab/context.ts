import type { Mat, OpenCV, Scalar } from '../../../../lib/index.js'
import type * as Runtime from '../../../../lib/index.js'
import type { LabDownload, LabRequest, LabStage, NativePixels } from './types'
/** Native resources belong to one experiment and are released together, including on errors. */
export class Experiment {
  private handles: { delete(): void }[] = []
  readonly src: Mat
  readonly bgr: Mat
  readonly gray: Mat
  readonly out: Mat
  note = ''
  native?: NativePixels
  stages: LabStage[] = []
  download?: LabDownload
  constructor(
    readonly cv: OpenCV,
    readonly runtime: typeof Runtime,
    readonly request: LabRequest
  ) {
    this.src = this.own(runtime.matFromArray(cv, request.height, request.width, cv.CV_8UC4, request.pixels))
    this.bgr = this.mat()
    this.gray = this.mat()
    this.out = this.mat()
    cv.cvtColor(this.src, this.bgr, cv.COLOR_RGBA2BGR)
    cv.cvtColor(this.src, this.gray, cv.COLOR_RGBA2GRAY)
  }
  /** Register a returned owned handle, rejecting a failed factory immediately. */
  own<T extends { delete(): void }>(handle: T | null | undefined): T {
    if (!handle) throw new Error('The OpenCV factory returned no object.')
    this.handles.push(handle)
    return handle
  }
  /** Allocate a matrix and attach it to this experiment's lifetime. */
  mat(): Mat {
    return this.own(new this.cv.Mat())
  }
  /** Copy JavaScript samples into a matrix owned by this experiment. */
  array(rows: number, cols: number, type: number, values: ArrayLike<number>): Mat {
    return this.own(this.runtime.matFromArray(this.cv, rows, cols, type, values))
  }
  /** Read a validated numeric parameter. */
  n(key: string): number {
    const value = Number(this.request.params[key])
    if (!Number.isFinite(value)) throw new Error(`Invalid number: ${key}`)
    return value
  }
  /** Read a selection or textual parameter. */
  s(key: string): string {
    return String(this.request.params[key])
  }
  /** Parse a finite rectangular JSON point/kernel table before invoking native code. */
  table(key: string, columns?: number, minRows = 1): number[][] {
    let value: unknown
    try {
      value = JSON.parse(this.s(key))
    } catch {
      throw new Error(`${key}: enter a valid JSON array of numeric rows.`)
    }
    if (!Array.isArray(value) || value.length < minRows || value.length > 4096)
      throw new Error(`${key}: expected ${minRows} to 4096 rows.`)
    const width = columns ?? (Array.isArray(value[0]) ? value[0].length : 0)
    if (
      !width ||
      !value.every(
        (row) =>
          Array.isArray(row) && row.length === width && row.every((x) => typeof x === 'number' && Number.isFinite(x))
      )
    )
      throw new Error(`${key}: every row must contain ${width} finite numbers.`)
    return value as number[][]
  }
  /** Obtain a colour or grayscale second image, resized to the input dimensions. A labelled synthetic pair is used when absent. */
  second(gray = false): Mat {
    const { cv } = this,
      image = this.request.second,
      result = this.mat()
    if (image) {
      const rgba = this.array(image.height, image.width, cv.CV_8UC4, image.pixels)
      cv.cvtColor(rgba, result, gray ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGBA2BGR)
      if (result.cols !== this.gray.cols || result.rows !== this.gray.rows) cv.resize(result, result, this.size())
    } else if (this.request.algorithm === 'template-matching') (gray ? this.gray : this.bgr).copyTo(result)
    else if (this.request.algorithm === 'hdr') this.bgr.convertTo(result, -1, 0.45)
    else {
      const translation = this.array(2, 3, cv.CV_64F, [1, 0, -12, 0, 1, 0])
      cv.warpAffine(
        gray ? this.gray : this.bgr,
        result,
        translation,
        this.size(),
        cv.INTER_LINEAR,
        cv.BORDER_REFLECT_101
      )
    }
    return result
  }
  /** Current processed image dimensions. */
  size() {
    return { width: this.gray.cols, height: this.gray.rows }
  }
  /** Clamp a percentage rectangle to the image. The default one-pixel border supplies background for GrabCut; pass 0 to include image edges. */
  rect(border = 1) {
    const x = Math.max(border, Math.min(this.gray.cols - border - 1, Math.floor((this.gray.cols * this.n('x')) / 100))),
      y = Math.max(border, Math.min(this.gray.rows - border - 1, Math.floor((this.gray.rows * this.n('y')) / 100)))
    return {
      x,
      y,
      width: Math.max(1, Math.min(this.gray.cols - x - border, Math.floor((this.gray.cols * this.n('width')) / 100))),
      height: Math.max(1, Math.min(this.gray.rows - y - border, Math.floor((this.gray.rows * this.n('height')) / 100)))
    }
  }
  /** Produce a binary mask from the grayscale threshold control. */
  mask(): Mat {
    const m = this.mat()
    this.cv.threshold(this.gray, m, this.n('threshold'), 255, this.cv.THRESH_BINARY)
    return m
  }
  /** Retain unscaled values for the pixel inspector, copying them before any native allocation can move the heap. */
  raw(mat: Mat, labels: string[] = ['value']) {
    const temp = this.mat()
    mat.convertTo(temp, this.cv.CV_32F)
    this.native = { values: Float32Array.from(temp.data32F), channels: mat.channels(), labels }
  }
  /** Normalize a single-channel numeric field for display while retaining its original units. */
  field(mat: Mat, labels = ['value']) {
    this.raw(mat, labels)
    this.cv.normalize(mat, this.out, 0, 255, this.cv.NORM_MINMAX, this.cv.CV_8U)
  }
  /** Copy an intermediate image and optional native measurements; every stage owns independent transferable buffers. */
  stage(title: string, mat: Mat, description: string, measurements?: NativePixels) {
    let display = mat,
      native: NativePixels | undefined
    if (mat.depth() !== this.cv.CV_8U) {
      const numeric = this.mat()
      mat.convertTo(numeric, this.cv.CV_32F)
      native = { values: Float32Array.from(numeric.data32F), channels: mat.channels(), labels: ['value'] }
      display = this.mat()
      this.cv.normalize(mat, display, 0, 255, this.cv.NORM_MINMAX, this.cv.CV_8U)
    }
    const image = this.runtime.toImageData(this.cv, display)
    if (measurements) {
      if (measurements.values.length !== image.width * image.height * measurements.channels)
        throw new Error('Stage measurements must match the preview dimensions.')
      native = { ...measurements, values: Float32Array.from(measurements.values) }
    }
    this.stages.push({ title, description, pixels: image.data, width: image.width, height: image.height, native })
  }
  /** Release all native allocations in reverse construction order. */
  dispose() {
    for (let i = this.handles.length - 1; i >= 0; i--) this.handles[i].delete()
    this.handles = []
  }
}
/** BGR colours used for diagnostic overlays. */
export const mint: Scalar = [178, 216, 85, 255]
/** Orange overlay colour in BGR channel order. */
export const orange: Scalar = [109, 154, 244, 255]
