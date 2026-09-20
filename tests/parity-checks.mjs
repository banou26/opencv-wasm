/** Behavior checks for graph execution, native video files, and Python API aliases. */
export const runParityChecks = (cv, helpers) => {
  const owned = []
  const own = value => { if (!value) throw new Error('Native object was not created'); owned.push(value); return value }
  const equal = (actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
  const passed = []
  try {
    const input = own(new cv.GMat())
    const gray = own(cv.gapi.BGR2Gray(input))
    const sum = own(cv.gapi.sum(gray)), count = own(cv.gapi.countNonZero(gray))
    const ins = own(cv.GIn([input])), outs = own(cv.GOut([gray, sum, count]))
    const graph = own(new cv.GComputation(ins, outs))
    const pixels = own(helpers.matFromArray(cv, 1, 2, cv.CV_8UC3, [255, 255, 255, 0, 0, 0]))
    const [result, total, nonzero] = graph.apply([pixels])
    own(result)
    equal([...result.data], [255, 0])
    equal(total, [255, 0, 0, 0])
    equal(nonzero, 1)
    const [again] = graph.apply([pixels]); own(again)
    equal([...again.data], [255, 0])
    passed.push('G-API graph with matrix, scalar, and opaque outputs')

    const drawingInput = own(new cv.GMat())
    const primitives = own(cv.GArray.Prim())
    const drawingOutput = own(cv.gapi.wip.draw.render3ch(drawingInput, primitives))
    const drawing = own(new cv.GComputation(own(cv.GIn([drawingInput, primitives])), own(cv.GOut([drawingOutput]))))
    const canvas = own(new cv.Mat(8, 8, cv.CV_8UC3, [0, 0, 0, 0]))
    const rectangle = own(new cv.gapi.wip.draw.Rect())
    Object.assign(rectangle, { rect: { x: 1, y: 1, width: 4, height: 4 }, color: [10, 20, 30, 0], thick: -1, lt: 8, shift: 0 })
    const primitive = own(cv.GDrawPrim.fromRect(rectangle))
    const [painted] = drawing.apply([canvas, [primitive]])
    own(painted)
    equal([...painted.data.slice(27, 30)], [10, 20, 30])
    equal(cv.gapi.CV_BOOL, 0)
    equal(cv.gapi.CV_GMAT, 14)
    passed.push('G-API drawing graph')

    const file = '/parity-test.avi'
    const writer = own(new cv.VideoWriter(file, cv.CAP_OPENCV_MJPEG, cv.VideoWriter_fourcc(77, 74, 80, 71), 10, { width: 32, height: 32 }, true))
    equal(writer.isOpened(), true)
    for (const value of [40, 100, 180]) {
      const frame = own(new cv.Mat(32, 32, cv.CV_8UC3, [value, value, value, 0]))
      writer.write(frame)
    }
    writer.release()
    const reader = own(new cv.VideoCapture(file, cv.CAP_OPENCV_MJPEG))
    equal(reader.isOpened(), true)
    const frame = own(new cv.Mat()), values = []
    while (reader.read(frame)) values.push(frame.data[0])
    equal(values, [40, 100, 180])
    equal(reader.get(cv.CAP_PROP_FRAME_COUNT), 3)
    reader.release()
    cv.FS.unlink(file)
    passed.push('AVI MJPEG encode and decode')

    equal(cv.CV_16FC(2), cv.CV_16FC2)
    equal(cv.ml.SVM_C_SVC, 100)
    const sift = own(cv.SIFT_create())
    equal(sift.descriptorSize(), 128)
    const params = own(new cv.TrackerCSRT.Params())
    equal(typeof params.use_hog, 'boolean')
    const superres = own(cv.dnn_superres.DnnSuperResImpl_create())
    equal(typeof superres.getScale(), 'number')
    passed.push('Python factory, nested class and namespace aliases')

    let borrowed, fail = false
    cv.dnn_registerLayer('TypeScriptAffine', config => {
      if (config.params.gain !== 3n) throw new Error('Custom layer integer parameter changed')
      return {
        getMemoryShapes: shapes => shapes,
        forward: (inputs, outputs) => {
          borrowed = [...inputs, ...outputs]
          if (fail) throw new Error('deliberate callback failure')
          const source = inputs[0].data32F, target = outputs[0].data32F
          for (let i = 0; i < source.length; i++) target[i] = 3 * source[i] + 2
        },
      }
    })
    try {
      const net = own(new cv.dnn.Net()), params = own(new cv.dnn.LayerParams())
      params.setInt('gain', 3)
      net.addLayerToPrev('affine', 'TypeScriptAffine', cv.CV_32F, params)
      const data = own(helpers.matFromArray(cv, 1, 3, cv.CV_32FC1, [-2, 0, 4]))
      net.setInput(data)
      const output = own(net.forward())
      equal([...output.data32F], [-4, 2, 14])
      equal(borrowed.every(value => value.isDeleted()), true)
      fail = true
      net.setInput(data)
      let rejected = false
      try { own(net.forward()) } catch { rejected = true }
      equal(rejected, true)
      equal(borrowed.every(value => value.isDeleted()), true)
      fail = false
      net.setInput(data)
      equal([...own(net.forward()).data32F], [-4, 2, 14])
    } finally { cv.dnn_unregisterLayer('TypeScriptAffine') }
    passed.push('TypeScript DNN layer with callback cleanup and recovery')
    return passed
  } finally {
    for (const value of owned.reverse()) if (!value.isDeleted()) value.delete()
  }
}
