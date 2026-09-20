/** Compare numeric results with native Python and execute additional contrib algorithms. */
export const runModuleChecks = (cv, helpers, reference) => {
  const passed = []
  const check = (name, run) => {
    const owned = []
    const own = value => { if (!value) throw new Error(`${name}: no native result`); owned.push(value); return value }
    const assert = (value, message) => { if (!value) throw new Error(`${name}: ${message}`) }
    const same = (key, values, tolerance = 1e-5) => {
      const expected = reference.results[key], actual = Array.from(values)
      assert(actual.length === expected.length, `${key} length differs from Python`)
      assert(actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) <= tolerance), `${key} differs from Python: ${actual}`)
    }
    const mat = (rows, cols, type, values) => own(helpers.matFromArray(cv, rows, cols, type, values))
    try { run({ own, assert, same, mat }); passed.push(name) }
    catch (error) { throw new Error(`${name}: ${typeof error === 'number' ? cv.exceptionFromPtr(error).msg : error.message}`) }
    finally { for (const value of owned.reverse()) if (!value.isDeleted()) value.delete() }
  }

  check('intensity_transform', ({ own, mat, same }) => {
    const input = mat(2, 3, cv.CV_8UC1, [0, 16, 64, 128, 200, 255]), output = own(new cv.Mat())
    cv.intensity_transform.gammaCorrection(input, output, 2)
    same('gamma', output.data)
  })
  check('img_hash', ({ own, mat, same }) => {
    const input = mat(16, 16, cv.CV_8UC1, Array.from({ length: 256 }, (_, i) => i)), output = own(new cv.Mat())
    cv.img_hash.averageHash(input, output)
    same('averageHash', output.data)
  })
  check('quality', ({ own, mat, same }) => {
    const input = mat(1, 3, cv.CV_8UC1, [1, 2, 3]), other = mat(1, 3, cv.CV_8UC1, [2, 4, 6]), map = own(new cv.Mat())
    same('quality', cv.quality.QualityMSE_compute(input, other, map))
    same('qualityMap', map.data32F)
  })
  check('ptcloud', ({ own, mat, same }) => {
    const depth = mat(2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6])
    const camera = mat(3, 3, cv.CV_32FC1, [2, 0, 1, 0, 2, .5, 0, 0, 1]), points = own(new cv.Mat())
    cv.depthTo3d(depth, camera, points)
    same('depth3d', points.data32F)
  })
  check('phase_unwrapping', ({ own, mat, same }) => {
    const params = own(new cv.phase_unwrapping.HistogramPhaseUnwrapping.Params())
    params.width = 8
    params.height = 6
    const wrapped = mat(6, 8, cv.CV_32FC1, Array.from({ length: 48 }, (_, i) => ((i % 8) * .8 + Math.PI) % (2 * Math.PI) - Math.PI))
    const output = own(new cv.Mat()), algorithm = own(cv.phase_unwrapping.HistogramPhaseUnwrapping.create(params))
    algorithm.unwrapPhaseMap(wrapped, output)
    same('unwrapped', output.data32F)
  })
  check('structured_light', ({ own, assert, same }) => {
    const generator = own(cv.structured_light.GrayCodePattern.create(8, 4)), patterns = own(new cv.MatVector())
    assert(generator.generate(patterns) && patterns.size() === 10, 'Gray code pattern generation failed')
    const projected = generator.getProjPixel(patterns, 3, 2)
    same('projectorPixel', [Number(projected.value), projected.projPix.x, projected.projPix.y])
    same('patternFirstRow', own(patterns.get(0)).data.slice(0, 8))
  })
  check('reg', ({ own, mat, same }) => {
    const shift = own(new cv.reg.MapShift(mat(2, 1, cv.CV_64FC1, [.25, -.5])))
    const inverse = own(shift.inverseMap()), converted = own(cv.reg.MapTypeCaster_toShift(inverse))
    const result = own(new cv.Mat())
    converted.getShift(result)
    same('inverseShift', result.data64F)
  })
  check('xphoto', ({ own, mat, same }) => {
    const input = mat(10, 10, cv.CV_8UC3, Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256))
    const output = own(new cv.Mat()), balance = own(cv.xphoto.createSimpleWB())
    balance.balanceWhite(input, output)
    same('whiteBalance', output.data, 1)
  })
  check('signal', ({ own, mat, same }) => {
    const input = mat(1, 8, cv.CV_32FC1, [0, 1, 0, -1, 0, 1, 0, -1]), output = own(new cv.Mat())
    cv.signal.resampleSignal(input, output, 8000, 4000)
    same('resampled', output.data32F)
  })
  check('shape', ({ own, mat, same }) => {
    const input = mat(4, 1, cv.CV_32FC2, [0, 0, 4, 0, 4, 4, 0, 4])
    const other = mat(4, 1, cv.CV_32FC2, [2, 0, 6, 0, 6, 4, 2, 4])
    same('hausdorff', [own(cv.createHausdorffDistanceExtractor()).computeDistance(input, other)])
  })
  check('face', ({ own, mat, assert }) => {
    const face = mat(32, 32, cv.CV_8UC1, Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) % 256))
    const images = own(new cv.MatVector()), labels = mat(1, 1, cv.CV_32SC1, [7])
    images.push_back(face)
    const recognizer = own(cv.face.LBPHFaceRecognizer.create())
    recognizer.train(images, labels)
    const prediction = recognizer.predict(face)
    assert(prediction.label === 7 && Math.abs(prediction.confidence) < 1e-8, 'Trained face was not recognized')
  })
  check('saliency', ({ own, assert }) => {
    const input = own(new cv.Mat(64, 64, cv.CV_8UC3, [0, 0, 0, 0])), output = own(new cv.Mat())
    cv.rectangle(input, { x: 10, y: 20 }, { x: 30, y: 40 }, [255, 255, 255, 0], -1)
    const algorithm = own(cv.saliency.StaticSaliencySpectralResidual.create())
    assert(algorithm.computeSaliency(input, output), 'Saliency computation failed')
    assert(output.rows === 64 && output.cols === 64 && output.data32F.every(Number.isFinite) && output.data32F.some(value => value > .5), 'Invalid saliency map')
  })
  check('bioinspired', ({ own, mat, assert }) => {
    const input = mat(16, 16, cv.CV_8UC3, Array.from({ length: 768 }, (_, i) => (i * 37 + 11) % 256))
    const retina = own(cv.bioinspired.Retina.create({ width: 16, height: 16 })), output = own(new cv.Mat())
    retina.run(input)
    retina.getParvo(output)
    assert(output.rows === 16 && output.cols === 16 && output.channels() === 3 && output.data.some(value => value > 0), 'Retina produced no visual response')
  })
  check('plot', ({ own, mat, assert }) => {
    const plot = own(cv.plot.Plot2d.create(mat(4, 1, cv.CV_64FC1, [0, 1, -1, 2]))), output = own(new cv.Mat())
    plot.render(output)
    assert(output.rows > 100 && output.cols > 100 && output.channels() === 3 && output.data.some(value => value > 0), 'Plot image was empty')
  })
  check('hfs', ({ own, mat, assert }) => {
    const input = mat(32, 32, cv.CV_8UC3, Array.from({ length: 3072 }, (_, i) => (i * 37 + 11) % 256))
    const segmenter = own(cv.hfs.HfsSegment.create(32, 32)), output = own(segmenter.performSegmentCpu(input))
    assert(output.rows === 32 && output.cols === 32 && !output.empty(), 'CPU segmentation produced no image')
  })
  check('text', ({ own, mat, assert }) => {
    const input = mat(16, 16, cv.CV_8UC3, Array.from({ length: 768 }, (_, i) => (i * 37 + 11) % 256)), channels = own(new cv.MatVector())
    cv.text.computeNMChannels(input, channels)
    assert(channels.size() >= 4, 'Text channels were not produced')
    for (let i = 0; i < channels.size(); i++) {
      const channel = own(channels.get(i))
      assert(channel.rows === 16 && channel.cols === 16 && channel.channels() === 1, 'Invalid text channel')
    }
  })
  return passed
}
