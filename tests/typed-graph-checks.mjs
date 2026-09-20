/** Execute heterogeneous TypeScript kernels inside native graphs, including conversion failures. */
export const runTypedGraphChecks = (cv, helpers) => {
  const owned = [], passed = []
  const own = value => { owned.push(value); return value }
  const assert = (value, message) => { if (!value) throw new Error(message) }
  const plain = value => typeof value === 'bigint' ? String(value) : value instanceof cv.Mat ? [...value.data32F] : Array.isArray(value) ? value.map(plain) : value
  const equal = (actual, expected) => assert(JSON.stringify(plain(actual)) === JSON.stringify(plain(expected)), `Value mismatch: ${JSON.stringify(plain(actual))} != ${JSON.stringify(plain(expected))}`)
  const throws = fn => { let failed = false; try { fn() } catch { failed = true }; assert(failed, 'Invalid graph operation was accepted') }
  const take = values => values.map(value => Array.isArray(value) ? take(value) : value instanceof cv.Mat || value instanceof cv.GDrawPrim ? own(value) : value)
  const graph = (inputs, outputs) => own(new cv.GComputation(own(cv.GIn(inputs)), own(cv.GOut(outputs))))
  try {
    const mat = own(helpers.matFromArray(cv, 1, 3, cv.CV_32FC1, [1, 2, 3]))
    const input = own(new cv.GMat()), points = own(cv.GArray.Point2f())
    let borrowed
    const operation = own(cv.gapi.op('test.typed.summary', {
      inputs: ['mat', 'array:point2f'], outputs: ['mat', 'array:rect', 'scalar', 'opaque:string'],
      outMeta: layouts => [layouts[0], null, null, null],
    }))
    const kernel = own(cv.gapi.kernel(operation, (inputs, outputs) => {
      borrowed = [inputs[0], outputs[0]]
      outputs[0].data32F.set(inputs[0].data32F.map(x => x * 2))
      outputs[1] = inputs[1].map(p => ({ x: Math.floor(p.x), y: Math.floor(p.y), width: 2, height: 3 }))
      outputs[2] = [inputs[1].length, 0, 0, 0]
      outputs[3] = `points:${inputs[1].length}`
    }))
    const nodes = operation.on([input, points]).map(own)
    const added = own(cv.gapi.addC(nodes[0], nodes[2]))
    const calculation = graph([input, points], [added, nodes[1], nodes[3]])
    const options = own(cv.gapi.compile_args(kernel))
    const result = take(calculation.apply([mat, [{ x: 1.5, y: 2.5 }, { x: 3.5, y: 4.5 }]], options))
    equal(result, [[4, 6, 8], [{ x: 1, y: 2, width: 2, height: 3 }, { x: 3, y: 4, width: 2, height: 3 }], 'points:2'])
    assert(borrowed.every(handle => handle.isDeleted()), 'Mixed callback retained borrowed matrices')
    equal(take(calculation.apply([mat, []], options)), [[2, 4, 6], [], 'points:0'])
    passed.push('mixed matrix, array, scalar and opaque kernels compose with native operations')

    const samples = {
      bool: [cv.GOpaque.Bool, cv.GArray.Bool, true], int: [cv.GOpaque.Int, cv.GArray.Int, -42],
      int64: [cv.GOpaque.Int64, cv.GArray.Int64, -(1n << 62n)], uint64: [cv.GOpaque.UInt64, cv.GArray.UInt64, (1n << 64n) - 1n],
      double: [cv.GOpaque.Double, cv.GArray.Double, 2.5], float: [cv.GOpaque.Float, cv.GArray.Float, -3.25],
      string: [cv.GOpaque.String, cv.GArray.String, 'hello 日本'], point: [cv.GOpaque.Point, cv.GArray.Point, { x: 1, y: -2 }],
      point2f: [cv.GOpaque.Point2f, cv.GArray.Point2f, { x: 1.5, y: -2.5 }],
      point3f: [cv.GOpaque.Point3f, cv.GArray.Point3f, { x: 1.5, y: 2.5, z: 3.5 }],
      size: [cv.GOpaque.Size, cv.GArray.Size, { width: 3, height: 4 }], rect: [cv.GOpaque.Rect, cv.GArray.Rect, { x: 1, y: 2, width: 3, height: 4 }],
    }
    const ports = [], inputs = [], values = []
    for (const [type, [opaque, array, value]] of Object.entries(samples)) {
      ports.push(`opaque:${type}`, `array:${type}`)
      inputs.push(own(opaque()), own(array()))
      values.push(value, [value, value])
    }
    ports.push('scalar', 'array:scalar', 'array:mat')
    inputs.push(own(new cv.GScalar()), own(cv.GArray.Scalar()), own(cv.GArray.Mat()))
    values.push([1, 2, 3, 4], [[1, 2, 3, 4]], [mat, mat])
    const identity = own(cv.gapi.op('test.typed.values', { inputs: ports, outputs: ports }))
    const identityKernel = own(identity.kernel((inputs, outputs) => { inputs.forEach((value, i) => { outputs[i] = value }) }))
    const identityNodes = identity.on(inputs).map(own)
    const identityGraph = graph(inputs, identityNodes)
    const identityOptions = own(cv.gapi.compile_args(identityKernel))
    const first = take(identityGraph.apply(values, identityOptions))
    equal(first, values)
    const emptyArrays = values.map((value, i) => ports[i].startsWith('array:') ? [] : value)
    equal(take(identityGraph.apply(emptyArrays, identityOptions)), emptyArrays)
    assert(first.at(-1).every(handle => !handle.isDeleted()), 'Returned matrix arrays shared borrowed handles')
    passed.push('all primitive and geometry port types preserve values, bigint widths and empty arrays')

    const primitives = own(cv.GArray.Prim())
    const primitiveOp = own(cv.gapi.op('test.typed.drawing', { inputs: ['array:prim'], outputs: ['array:prim'] }))
    const primitiveKernel = own(primitiveOp.kernel((inputs, outputs) => { outputs[0] = inputs[0] }))
    const primitiveOut = own(primitiveOp.on([primitives])[0])
    const imageNode = own(new cv.GMat()), rendered = own(cv.gapi.wip.draw.render3ch(imageNode, primitiveOut))
    const drawingGraph = graph([imageNode, primitives], [rendered, primitiveOut])
    const image = own(new cv.Mat(8, 8, cv.CV_8UC3, [0, 0, 0, 0]))
    const rect = own(new cv.gapi.wip.draw.Rect())
    rect.rect = { x: 1, y: 1, width: 3, height: 3 }
    rect.color = [0, 0, 255, 0]
    rect.thick = -1
    const primitive = own(cv.GDrawPrim.fromRect(rect))
    const drawingOptions = own(cv.gapi.compile_args(primitiveKernel))
    const drawings = take(drawingGraph.apply([image, [primitive]], drawingOptions))
    assert(drawings[0].ucharPtr(2, 2)[2] === 255, 'Returned primitives did not render')
    primitive.delete()
    const reused = take(drawingGraph.apply([image, drawings[1]], drawingOptions))
    assert(reused[0].ucharPtr(2, 2)[2] === 255, 'Primitive outputs did not retain native values')
    passed.push('custom drawing-primitive arrays retain ownership and feed the native renderer')

    let invalid = false, failure = false, retainedBorrowed
    const checked = own(cv.gapi.op('test.typed.checked', { inputs: ['array:mat'], outputs: ['opaque:int', 'array:mat'] }))
    const checkedKernel = own(checked.kernel((inputs, outputs) => {
      retainedBorrowed = [...inputs[0]]
      if (failure) { inputs.length = 0; outputs.length = 0; throw new Error('intentional typed callback failure') }
      outputs[0] = invalid ? 1.5 : 7
      outputs[1] = retainedBorrowed
    }))
    const matrixList = own(cv.GArray.Mat()), checkedNodes = checked.on([matrixList]).map(own)
    const checkedGraph = graph([matrixList], checkedNodes), checkedOptions = own(cv.gapi.compile_args(checkedKernel))
    for (const mode of ['invalid', 'failure', 'valid']) {
      invalid = mode === 'invalid'; failure = mode === 'failure'
      if (mode === 'valid') equal(take(checkedGraph.apply([[mat]], checkedOptions)), [7, [mat]])
      else throws(() => checkedGraph.apply([[mat]], checkedOptions))
      assert(retainedBorrowed.every(handle => handle.isDeleted()), 'Callback conversion failure leaked borrowed matrices')
    }
    passed.push('typed callback failures and invalid results clean up and allow recovery')

    const invalidValues = {
      'opaque:int': 2 ** 31, 'opaque:int64': 1n << 63n, 'opaque:uint64': -1n,
      'opaque:bool': 1, 'opaque:string': 17, 'opaque:point3f': { x: 1, y: 2 },
      scalar: [1, 2], 'array:int': [1, 2.5], 'array:mat': [null],
    }
    for (const [port, value] of Object.entries(invalidValues)) {
      const op = own(cv.gapi.op(`test.invalid.${port}`, { inputs: ['mat'], outputs: [port] }))
      const impl = own(op.kernel((_, outputs) => { outputs[0] = value }))
      const node = own(op.on([input])[0])
      const computation = graph([input], [node]), opts = own(cv.gapi.compile_args(impl))
      throws(() => computation.apply([mat], opts))
    }
    throws(() => operation.on([points, input]))
    throws(() => cv.gapi.op('invalid', { inputs: ['unknown'], outputs: ['scalar'] }))
    throws(() => cv.gapi.op('missing-layout', { inputs: ['mat'], outputs: ['mat'] }))
    passed.push('runtime signature and result validation rejects malformed scalars, arrays and integers')
    return passed
  } finally {
    for (const value of owned.reverse()) if (!value.isDeleted()) value.delete()
  }
}
