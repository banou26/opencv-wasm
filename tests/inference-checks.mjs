/** Run native G-API inference through the WASM DNN backend, including list ownership and failures. */
export const runInferenceChecks = async (cv, helpers, reluModel, arithmeticModel, reference, engine = cv.dnn.ENGINE_NEW) => {
  const owned = [], streams = [], passed = []
  const own = value => { owned.push(value); return value }
  const assert = (value, message) => { if (!value) throw new Error(message) }
  const equal = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  const throws = fn => { let failed = false; try { fn() } catch { failed = true }; assert(failed, 'Invalid inference input was accepted') }
  const take = values => values.map(value => Array.isArray(value) ? take(value) : value instanceof cv.Mat ? own(value) : value)
  const pixels = value => Array.isArray(value) ? value.map(pixels) : [...value.data32F]
  const tensor = (values, dims = [1, 1, 2, 2]) => {
    const sizes = own(new cv.IntVector())
    dims.forEach(n => sizes.push_back(n))
    const result = own(cv.matWithShape(sizes, cv.CV_32FC1))
    result.data32F.set(values)
    return result
  }
  const graph = (inputs, outputs) => own(new cv.GComputation(own(cv.GIn(inputs)), own(cv.GOut(outputs))))
  const options = params => own(cv.gapi.compile_args(own(cv.gapi.networks(...params))))
  const model = (name, bytes) => { cv.FS.writeFile(name, bytes); return own(cv.dnn.readNetFromONNX(name, engine)) }
  try {
    const net = model('/graph-arithmetic.onnx', arithmeticModel)
    const params = own(new cv.gapi.dnn.Params('arithmetic', net))
    const args = options([params])
    const left = own(new cv.GMat()), right = own(new cv.GMat())
    const inputs = own(new cv.GInferInputs())
    inputs.setInput('right', right)
    inputs.setInput('left', left)
    const outputs = own(cv.gapi.infer('arithmetic', inputs))
    const difference = own(outputs.at('difference')), sum = own(outputs.at('sum'))
    const calculation = graph([left, right], [difference, sum])
    const a = tensor([1, 2, 3, 4]), b = tensor([10, 20, 30, 40])
    equal(pixels(take(calculation.apply([a, b], args))), [reference.results.dnnDifference, reference.results.dnnSum])
    equal(pixels(take(calculation.apply([b, a], args))), [[9, 18, 27, 36], [11, 22, 33, 44]])
    // Same graph, new dimensions: output metadata must be recomputed in model input order.
    const changed = tensor([5, 6, 7], [1, 1, 1, 3])
    equal(pixels(take(calculation.apply([changed, changed], args))), [[0, 0, 0], [10, 12, 14]])
    passed.push('named multi-input and multi-output ONNX graph inference with reshaping')

    const unconfigured = graph([left, right], [sum])
    throws(() => unconfigured.apply([a, b]))
    const badInputs = own(new cv.GInferInputs())
    badInputs.setInput('missing', left)
    const badOutputs = own(cv.gapi.infer('arithmetic', badInputs))
    const badGraph = graph([left], [own(badOutputs.at('sum'))])
    throws(() => badGraph.apply([a], args))
    const invalidOutput = own(cv.gapi.infer('arithmetic', inputs))
    const invalidGraph = graph([left, right], [own(invalidOutput.at('missing'))])
    throws(() => invalidGraph.apply([a, b], args))
    throws(() => cv.gapi.networks(params, params))
    const bytes = own(helpers.matFromArray(cv, 2, 2, cv.CV_8UC1, [1, 2, 3, 4]))
    throws(() => calculation.apply([bytes, b], args))
    equal(pixels(take(calculation.apply([a, b], args))), [[-9, -18, -27, -36], [11, 22, 33, 44]])
    passed.push('invalid tags, names, tensor types and duplicate packages reject and recover')

    const relu = model('/graph-relu.onnx', reluModel)
    const regionParams = own(new cv.gapi.dnn.Params('regions', relu))
    regionParams.cfgInput('input', { size: { width: 2, height: 2 }, scale: 2, mean: [1, 0, 0, 0] })
    const regionArgs = options([regionParams])
    const image = own(new cv.GMat()), rect = own(cv.GOpaque.Rect()), rects = own(cv.GArray.Rect())
    const imageInputs = own(new cv.GInferInputs())
    imageInputs.setInput('input', image)
    const regionOutputs = own(cv.gapi.infer('regions', rect, imageInputs))
    const regionGraph = graph([image, rect], [own(regionOutputs.at('output'))])
    const source = own(helpers.matFromArray(cv, 2, 4, cv.CV_32FC1, [-1, 0, 10, 20, 2, 3, 30, 40]))
    const first = { x: 0, y: 0, width: 2, height: 2 }, second = { x: 2, y: 0, width: 2, height: 2 }
    equal(pixels(take(regionGraph.apply([source, first], regionArgs))), [[0, 0, 2, 4]])
    throws(() => regionGraph.apply([source, { ...first, x: -1 }], regionArgs))
    equal(pixels(take(regionGraph.apply([source, second], regionArgs))), [[18, 38, 58, 78]])
    const colorParams = own(new cv.gapi.dnn.Params('color', relu))
    colorParams.cfgInput('input', { size: { width: 2, height: 2 }, scale: 0.5, mean: [1, 2, 3, 0], swapRB: true })
    const colorOutputs = own(cv.gapi.infer('color', imageInputs))
    const colorGraph = graph([image], [own(colorOutputs.at('output'))])
    const color = own(helpers.matFromArray(cv, 2, 2, cv.CV_8UC3, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]))
    equal(pixels(take(colorGraph.apply([color], options([colorParams])))), [reference.results.dnnColour])
    passed.push('single-region inference and explicit scale, mean and color preprocessing')

    const listOutputs = own(cv.gapi.infer('regions', rects, imageInputs))
    const listGraph = graph([image, rects], [own(listOutputs.at('output'))])
    const retained = take(listGraph.apply([source, [first, second]], regionArgs))
    equal(pixels(retained).flat(2), reference.results.dnnRegions)
    equal(pixels(retained), [[[0, 0, 2, 4], [18, 38, 58, 78]]])
    equal(pixels(take(listGraph.apply([source, []], regionArgs))), [[]])
    equal(pixels(take(listGraph.apply([source, [second]], regionArgs))), [[[18, 38, 58, 78]]])
    equal(pixels(retained), [[[0, 0, 2, 4], [18, 38, 58, 78]]])
    passed.push('region lists, empty lists and independently owned output tensors')

    const listParams = own(new cv.gapi.dnn.Params('mixed', net))
    listParams.cfgInput('left', { size: { width: 2, height: 2 } })
    const mixedArgs = options([listParams])
    const matrices = own(cv.GArray.Mat()), listInputs = own(new cv.GInferListInputs())
    listInputs.setInput('right', matrices)
    listInputs.setInput('left', rects)
    const mixedOutputs = own(cv.gapi.infer2('mixed', image, listInputs))
    const mixedGraph = graph([image, rects, matrices], [own(mixedOutputs.at('sum')), own(mixedOutputs.at('difference'))])
    equal(pixels(take(mixedGraph.apply([source, [first, second], [a, b]], mixedArgs))), [
      [[0, 2, 5, 7], [20, 40, 60, 80]],
      [[-2, -2, -1, -1], [0, 0, 0, 0]],
    ])
    throws(() => mixedGraph.apply([source, [first, second], [a]], mixedArgs))
    equal(pixels(take(mixedGraph.apply([source, [], []], mixedArgs))), [[], []])
    equal(pixels(take(mixedGraph.apply([source, [second], [b]], mixedArgs))), [[[20, 40, 60, 80]], [[0, 0, 0, 0]]])
    passed.push('infer2 mixes region and tensor lists with multiple named outputs')

    const stream = calculation.compileStreaming(args)
    streams.push(stream)
    args.delete()
    params.delete()
    net.delete()
    calculation.delete()
    stream.setSource([[a, b], [b, a]])
    stream.start()
    equal(pixels(take(await stream.pull())), [[-9, -18, -27, -36], [11, 22, 33, 44]])
    equal(pixels(take(await stream.pull())), [[9, 18, 27, 36], [11, 22, 33, 44]])
    equal(await stream.pull(), null)
    passed.push('streaming inference retains graphs, model and compile configuration')
    return passed
  } finally {
    for (const stream of streams.reverse()) await stream.delete()
    for (const value of owned.reverse()) if (!value.isDeleted()) value.delete()
    for (const path of ['/graph-arithmetic.onnx', '/graph-relu.onnx']) {
      try { cv.FS.unlink(path) } catch {}
    }
  }
}
