/** Exercise OpenCV 5 matrix storage, tensor shapes and new CPU algorithms. */
export const runOpenCV5Checks = (cv, helpers) => {
  const passed = []
  const check = (name, run) => {
    const handles = []
    const own = value => { handles.push(value); return value }
    const equal = (actual, expected) => {
      const stringify = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? `${item}n` : item)
      if (stringify(actual) !== stringify(expected)) throw new Error(`${name}: ${stringify(actual)} != ${stringify(expected)}`)
    }
    try { run(own, equal); passed.push(name) }
    catch (error) { throw new Error(`${name}: ${typeof error === 'number' ? cv.exceptionFromPtr(error).msg : error.message}`) }
    finally { for (const handle of handles.reverse()) handle.delete() }
  }
  check('OpenCV 5 matrix type encoding', (own, equal) => {
    equal([cv.CV_8UC3, cv.CV_16FC2, cv.CV_32UC4], [64, 39, 108])
    for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const type = cv.CV_MAKETYPE(depth, 3)
      const mat = own(new cv.Mat(2, 4, type))
      equal([mat.depth(), mat.channels(), mat.type()], [depth, 3, type])
      equal(cv.CV_MAT_DEPTH(type), depth)
    }
    const maximum = own(new cv.Mat(1, 1, cv.CV_8UC(128)))
    equal(maximum.channels(), 128)
    let rejected = 0
    for (const [depth, channels] of [[13, 1], [0, 129], [-1, 1], [0, 0]]) {
      try { cv.CV_MAKETYPE(depth, channels) } catch (error) { if (error instanceof RangeError) rejected++ }
    }
    equal(rejected, 4)
  })
  check('Exact unsigned and 64-bit integer pixels', (own, equal) => {
    for (const [type, field, values] of [
      [cv.CV_32U, 'data32U', [0, 2 ** 32 - 1]],
      [cv.CV_64U, 'data64U', [0n, 2n ** 64n - 1n]],
      [cv.CV_64S, 'data64S', [-(2n ** 63n), 2n ** 63n - 1n]],
    ]) {
      const mat = own(helpers.matFromArray(cv, 1, 2, type, values))
      const copy = own(new cv.Mat())
      mat.copyTo(copy)
      equal([...mat[field]], values)
      equal([...copy[field]], values)
    }
    let rejected = 0
    for (const [type, value] of [[cv.CV_64U, -1n], [cv.CV_64S, 2n ** 63n], [cv.CV_64U, 3]]) {
      try { helpers.matFromArray(cv, 1, 1, type, [value]) } catch (error) { if (error instanceof RangeError) rejected++ }
    }
    equal(rejected, 3)
  })
  check('Boolean matrix storage', (own, equal) => {
    const bools = own(helpers.matFromArray(cv, 1, 3, cv.CV_Bool, [true, false, true]))
    const numbers = own(helpers.matFromArray(cv, 1, 3, cv.CV_Bool, [0, -2, NaN]))
    equal([...bools.data], [1, 0, 1])
    equal([...numbers.data], [0, 1, 1])
  })
  check('Half and bfloat matrix conversion', (own, equal) => {
    for (const depth of [cv.CV_16F, cv.CV_16BF]) {
      const half = own(helpers.matFromArray(cv, 1, 2, cv.CV_MAKETYPE(depth, 2), [1.5, -2, 0.25, 4]))
      const floats = own(new cv.Mat())
      half.convertTo(floats, cv.CV_32F)
      equal([...floats.data32F], [1.5, -2, 0.25, 4])
      equal([half.depth(), half.channels(), half.elemSize1()], [depth, 2, 2])
      for (const length of [1, 3, 4, 7, 8, 17]) {
        const values = Array.from({ length }, (_, index) => (index - 8) / 4)
        const input = own(helpers.matFromArray(cv, 1, length, depth, values))
        const output = own(new cv.Mat())
        input.convertTo(output, cv.CV_32F)
        equal([...output.data32F], values)
      }
    }
  })
  check('MatShape and scalar or one-dimensional tensors', (own, equal) => {
    const sizes = own(new cv.IntVector())
    sizes.push_back(2); sizes.push_back(3)
    const shape = own(new cv.MatShape(sizes))
    equal([shape.dims, shape.total(), shape.empty(), shape.isScalar()], [2, 6, false, false])
    shape.erase(0)
    equal([shape.dims, shape.total()], [1, 3])
    const scalar = own(cv.MatShape.scalar())
    equal([scalar.dims, scalar.total(), scalar.empty(), scalar.isScalar()], [0, 1, false, true])
    const empty = own(new cv.IntVector())
    const scalarMat = own(cv.matWithShape(empty, cv.CV_32F))
    equal([scalarMat.dims, scalarMat.total()], [0, 1])
    empty.push_back(5)
    const vector = own(cv.matWithShape(empty, cv.CV_32F))
    equal([vector.dims, vector.total(), vector.matSize], [1, 5, [5]])
  })
  check('Finite-value masks and parameterized filtering', (own, equal) => {
    const values = own(helpers.matFromArray(cv, 1, 4, cv.CV_32F, [2, NaN, Infinity, -3]))
    const mask = own(new cv.Mat())
    cv.finiteMask(values, mask)
    equal([...mask.data], [255, 0, 0, 255])
    const source = own(helpers.matFromArray(cv, 1, 3, cv.CV_32F, [1, 2, 3]))
    const kernel = own(helpers.matFromArray(cv, 1, 1, cv.CV_32F, [2]))
    const params = own(new cv.Filter2DParams())
    params.shift = 1
    const result = own(new cv.Mat())
    cv.filter2Dp(source, result, kernel, params)
    equal([...result.data32F], [3, 5, 7])
    params.borderType = cv.BORDER_CONSTANT
    params.borderValue = [10, 0, 0, 0]
    params.shift = 0
    const wideKernel = own(helpers.matFromArray(cv, 1, 3, cv.CV_32F, [1, 1, 1]))
    let rejected = false
    try { cv.filter2Dp(source, result, wideKernel, params) } catch { rejected = true }
    equal(rejected, true)
    params.borderValue = [0, 0, 0, 0]
    cv.filter2Dp(source, result, wideKernel, params)
    equal([...result.data32F], [3, 6, 5])
  })
  check('ANN feature index builds and queries on the CPU', (own, equal) => {
    const index = own(cv.ANNIndex.create(2))
    index.setSeed(42)
    const samples = own(helpers.matFromArray(cv, 3, 2, cv.CV_32F, [0, 0, 1, 1, 5, 5]))
    index.addItems(samples)
    index.build(2)
    const query = own(helpers.matFromArray(cv, 1, 2, cv.CV_32F, [1, 1]))
    const indices = own(new cv.Mat()), distances = own(new cv.Mat())
    index.knnSearch(query, indices, distances, 1)
    equal(index.getItemNumber(), 3)
    equal([...indices.data32S], [1])
    equal([...distances.data32F], [0])
  })
  check('Point-cloud octree stores points and finds nearest neighbors', (own, equal) => {
    const tree = own(cv.Octree.createWithDepth(4, 8))
    equal(tree.insertPoint({ x: 1, y: 2, z: 3 }), true)
    equal(tree.insertPoint({ x: 4, y: 4, z: 4 }), true)
    const points = own(new cv.Mat()), distances = own(new cv.Mat())
    tree.KNNSearch({ x: 2, y: 2, z: 3 }, 1, points, distances)
    equal([...points.data32F], [1, 2, 3])
    equal([...distances.data32F], [1])
    equal(tree.deletePoint({ x: 1, y: 2, z: 3 }), true)
  })
  return passed
}
