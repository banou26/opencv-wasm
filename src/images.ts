import type { MainModule, Mat } from '../lib/opencv.js'

/**
 * Copy numeric values into a new native matrix.
 * @param cv Initialized OpenCV instance that will own the allocation.
 * @param rows Nonnegative number of rows.
 * @param cols Nonnegative number of columns.
 * @param type OpenCV 5 matrix type code, such as CV_8UC3 or CV_32FC1.
 * @param data Row-major interleaved components. Use bigint for CV_64S/CV_64U, boolean or numeric values for CV_Bool, and numbers for other depths. Half and bfloat values are converted from numbers. Length must equal rows * cols * channels.
 * @returns An owned matrix to release with using or delete().
 */
export const matFromArray = (cv: MainModule, rows: number, cols: number, type: number, data: ArrayLike<number> | ArrayLike<bigint> | ArrayLike<boolean>): Mat => {
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 0 || cols < 0) {
    throw new RangeError('Matrix dimensions must be nonnegative integers')
  }
  const channels = Math.floor(type / 32) + 1, depth = type % 32
  if (!Number.isSafeInteger(type) || type < 0 || channels > 128 || depth > 12) {
    throw new RangeError('Unsupported matrix element type')
  }
  if (data.length !== rows * cols * channels) throw new RangeError('Data length does not match the matrix dimensions and channels')
  // A caller can pass a live view of this instance. Allocating the destination
  // may grow the heap and detach that view before its pixels have been copied.
  if (ArrayBuffer.isView(data) && data.buffer === cv.HEAPU8.buffer) {
    const borrowed = data as typeof data & { slice(): typeof data }
    data = borrowed.slice()
  }
  const mat = new cv.Mat(rows, cols, type)
  try {
    if (depth === 10 || depth === 11) {
      const view = depth === 10 ? mat.data64U : mat.data64S
      for (let index = 0; index < data.length; index++) {
        const value = data[index]
        if (typeof value !== 'bigint' || (depth === 10 ? BigInt.asUintN(64, value) : BigInt.asIntN(64, value)) !== value) throw new RangeError('64-bit integer matrices require bigint values within the selected signed or unsigned range')
        view[index] = value
      }
    } else if (depth === 7 || depth === 8) {
      const temporary = matFromArray(cv, rows, cols, 5 + (channels - 1) * 32, data)
      try { temporary.convertTo(mat, type) } finally { temporary.delete() }
    } else {
      const view = depth === 0 || depth === 9 ? mat.data : depth === 1 ? mat.data8S : depth === 2 ? mat.data16U
        : depth === 3 ? mat.data16S : depth === 4 ? mat.data32S : depth === 5 ? mat.data32F : depth === 6 ? mat.data64F : mat.data32U
      // Typed numeric arrays already guarantee numeric elements. Bulk copying is
      // substantially faster for full video frames and preserves TypedArray's
      // numeric conversion rules; boolean normalization still needs the loop.
      if (depth !== 9 && (data instanceof Uint8Array || data instanceof Uint8ClampedArray
        || data instanceof Int8Array || data instanceof Uint16Array || data instanceof Int16Array
        || data instanceof Uint32Array || data instanceof Int32Array || data instanceof Float32Array
        || data instanceof Float64Array)) {
        view.set(data)
        return mat
      }
      for (let index = 0; index < data.length; index++) {
        const value = data[index]
        if (depth === 9) {
          if (typeof value !== 'number' && typeof value !== 'boolean') throw new TypeError('Boolean matrices require boolean or numeric values')
          view[index] = value !== false && value !== 0 ? 1 : 0
        } else {
          if (typeof value !== 'number') throw new TypeError('This matrix depth requires numeric values')
          view[index] = value
        }
      }
    }
    return mat
  } catch (error) {
    mat.delete()
    throw error
  }
}

/**
 * Copy RGBA pixels from a canvas image into a new CV_8UC4 matrix.
 * @param cv Initialized OpenCV instance.
 * @param image ImageData or an equivalent object with RGBA bytes, width and height. The input remains caller-owned.
 * @returns An owned RGBA matrix. Dispose it after use; convert color order before passing it to algorithms that expect BGR.
 */
export const matFromImageData = (cv: MainModule, image: Pick<ImageData, 'data' | 'width' | 'height'>): Mat =>
  matFromArray(cv, image.height, image.width, cv.CV_8UC4, image.data)

/**
 * Copy an 8-bit image to independent browser ImageData pixels. Requires the ImageData global.
 * @param cv Instance owning the input matrix.
 * @param mat Nonempty 8-bit image with one, three or four channels; row strides are handled by a native copy.
 * @param order Input channel order. Defaults to BGR for three channels and RGBA for four; choose bgra for decoded alpha images.
 * @returns RGBA ImageData whose storage remains valid after the matrix is deleted.
 */
export const toImageData = (cv: MainModule, mat: Mat, order: 'bgr' | 'rgb' | 'bgra' | 'rgba' = 'bgr'): ImageData => {
  if (mat.empty() || mat.depth() !== cv.CV_8U) throw new TypeError('Expected a nonempty 8-bit image')
  const rgba = new cv.Mat()
  try {
    if (mat.channels() === 1) cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA)
    else if (mat.channels() === 3) cv.cvtColor(mat, rgba, order === 'bgr' || order === 'bgra' ? cv.COLOR_BGR2RGBA : cv.COLOR_RGB2RGBA)
    else if (mat.channels() === 4 && order === 'bgra') cv.cvtColor(mat, rgba, cv.COLOR_BGRA2RGBA)
    else if (mat.channels() === 4) mat.copyTo(rgba)
    else throw new TypeError('Expected 1, 3 or 4 image channels')
    return new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows)
  } finally {
    rgba.delete()
  }
}

/**
 * Decode encoded bytes with the native image codecs in browsers and Node.
 * @param cv Initialized OpenCV instance.
 * @param bytes Encoded image data, such as PNG or JPEG.
 * @param flags IMREAD flags, defaulting to IMREAD_COLOR. Color output uses BGR or BGRA.
 * @returns An owned decoded matrix. Throws if the codec cannot decode the image.
 */
export const decodeImage = (cv: MainModule, bytes: Uint8Array, flags = cv.IMREAD_COLOR): Mat => {
  const input = matFromArray(cv, 1, bytes.length, cv.CV_8UC1, bytes)
  try {
    const result = cv.imdecode(input, flags)
    if (result.empty()) {
      result.delete()
      throw new Error('OpenCV could not decode the image')
    }
    return result
  } finally {
    input.delete()
  }
}

/**
 * Encode a matrix to independent image bytes in browsers and Node.
 * @param cv Instance owning the input matrix.
 * @param extension Codec extension beginning with a dot, such as .png or .jpg.
 * @param mat Image to encode. Native codecs expect BGR or BGRA color order.
 * @param parameters Alternating IMWRITE parameter identifiers and values.
 * @returns A copied byte array with no native disposal requirement. Throws on an unsupported format or failed encoding.
 */
export const encodeImage = (cv: MainModule, extension: string, mat: Mat, parameters: readonly number[] = []): Uint8Array<ArrayBuffer> => {
  if (!extension.startsWith('.')) throw new TypeError('An image extension must start with a dot')
  if (parameters.length % 2) throw new RangeError('Codec parameters must be key/value pairs')
  const output = new cv.ucharVector()
  const params = new cv.IntVector()
  try {
    for (const value of parameters) params.push_back(value)
    if (!cv.imencode(extension, mat, output, params)) throw new Error(`OpenCV could not encode ${extension}`)
    return Uint8Array.from({ length: output.size() }, (_, index) => output.get(index)!)
  } finally {
    params.delete()
    output.delete()
  }
}
