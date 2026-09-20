export const runChecks = (cv, helpers, model) => {
  const passed = []
  const check = (name, fn) => {
    const owned = []
    const own = value => { owned.push(value); return value }
    const equal = (actual, expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
    }
    try { fn(own, equal); passed.push(name) }
    finally { for (const value of owned.reverse()) if (!value.isDeleted()) value.delete() }
  }
  check('matrix data and threshold', (own, equal) => {
    const input = own(helpers.matFromArray(cv, 2, 2, cv.CV_8UC1, [0, 50, 200, 255]))
    const output = own(new cv.Mat())
    cv.threshold(input, output, 100, 255, cv.THRESH_BINARY)
    equal([...output.data], [0, 0, 255, 255])
    equal(output.data instanceof Uint8Array, true)
    const copy = own(output.mat_clone())
    output.data[0] = 19
    equal(copy.data[0], 0)
    input[Symbol.dispose]()
    equal(input.isDeleted(), true)
    input[Symbol.dispose]()
  })
  check('PNG JPEG WebP TIFF codecs and native filesystem', (own, equal) => {
    const input = own(new cv.Mat(16, 16, cv.CV_8UC3, [60, 120, 180, 0]))
    for (const extension of ['.png', '.jpg', '.webp', '.tiff']) {
      const bytes = helpers.encodeImage(cv, extension, input)
      const decoded = own(helpers.decodeImage(cv, bytes))
      equal([decoded.rows, decoded.cols, decoded.channels()], [16, 16, 3])
      if (extension === '.png') {
        equal([...decoded.data.slice(0, 3)], [60, 120, 180])
        cv.FS.writeFile('/test.png', bytes)
        const fromFile = own(cv.imread('/test.png'))
        equal([...fromFile.data.slice(0, 3)], [60, 120, 180])
        cv.FS.unlink('/test.png')
      }
    }
  })
  check('SIFT SURF and ORB feature detection', (own, equal) => {
    const input = own(new cv.Mat(192, 192, cv.CV_8UC1))
    let seed = 1_234_567
    for (let i = 0; i < input.data.length; i++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      input.data[i] = seed >>> 24
    }
    const mask = own(new cv.Mat())
    for (const detector of [cv.SIFT.create(), cv.xfeatures2d.SURF.create(), cv.ORB.create()]) {
      own(detector)
      const keys = own(new cv.KeyPointVector())
      const descriptors = own(new cv.Mat())
      detector.detectAndCompute(input, mask, keys, descriptors)
      equal(keys.size() > 0, true)
      equal(descriptors.rows, keys.size())
    }
  })
  check('SVM training and prediction', (own, equal) => {
    const samples = own(helpers.matFromArray(cv, 4, 2, cv.CV_32FC1, [-2, -1, -1, -2, 1, 2, 2, 1]))
    const labels = own(helpers.matFromArray(cv, 4, 1, cv.CV_32SC1, [-1, -1, 1, 1]))
    const svm = own(cv.ml.SVM.create())
    svm.setType(cv.ml.SVM_C_SVC)
    svm.setKernel(cv.ml.SVM_LINEAR)
    equal(svm.train1(samples, cv.ml.ROW_SAMPLE, labels), true)
    const query = own(helpers.matFromArray(cv, 1, 2, cv.CV_32FC1, [3, 2]))
    equal(svm.predict(query), 1)
  })
  check('DNN ONNX inference', (own, equal) => {
    cv.FS.writeFile('/relu.onnx', model)
    const net = own(cv.dnn.readNetFromONNX('/relu.onnx'))
    cv.FS.unlink('/relu.onnx')
    const input = own(helpers.matFromArray(cv, 2, 2, cv.CV_32FC1, [-2, 3, -4, 5]))
    const blob = own(cv.dnn.blobFromImage(input))
    net.setInput(blob)
    const result = own(net.forward())
    equal([...result.data32F], [0, 3, 0, 5])
  })
  check('ArUco markers and contrib thinning', (own, equal) => {
    const dictionary = own(cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50))
    const marker = own(new cv.Mat())
    cv.aruco.generateImageMarker(dictionary, 7, 120, marker)
    equal([marker.rows, marker.cols], [120, 120])
    const output = own(new cv.Mat())
    cv.ximgproc.thinning(marker, output)
    equal([output.rows, output.cols], [120, 120])
    equal(cv.countNonZero(output) < cv.countNonZero(marker), true)
  })
  check('optical flow and background subtraction', (own, equal) => {
    const input = own(new cv.Mat(32, 32, cv.CV_8UC1, [0, 0, 0, 0]))
    const flow = own(new cv.Mat())
    cv.calcOpticalFlowFarneback(input, input, flow, 0.5, 3, 15, 3, 5, 1.2, 0)
    equal([flow.rows, flow.cols, flow.channels()], [32, 32, 2])
    const bg = own(cv.bgsegm.createBackgroundSubtractorMOG())
    const mask = own(new cv.Mat())
    bg.apply(input, mask)
    equal([mask.rows, mask.cols], [32, 32])
  })
  check('typed scalar output results', (own, equal) => {
    const size = cv.getTextSize('hello', cv.FONT_HERSHEY_SIMPLEX, 1, 1)
    equal(size.value.width > 0 && size.baseLine > 0, true)
    const input = own(helpers.matFromArray(cv, 1, 2, cv.CV_32FC1, [1, 2]))
    const range = cv.checkRange(input)
    equal(range.value, true)
  })
  check('JPEG 2000 and OpenEXR memory round trips', (own, equal) => {
    for (const extension of ['.jp2', '.exr']) {
      const type = extension === '.exr' ? cv.CV_32FC1 : cv.CV_8UC1
      const input = own(new cv.Mat(64, 64, type, [extension === '.exr' ? 0.5 : 128, 0, 0, 0]))
      const output = own(helpers.decodeImage(cv, helpers.encodeImage(cv, extension, input), cv.IMREAD_UNCHANGED))
      equal([output.rows, output.cols, output.type()], [64, 64, type])
      equal(extension === '.exr' ? output.data32F[0] : output.data[0], extension === '.exr' ? 0.5 : 128)
    }
  })
  check('FLANN indexing and UMat CPU storage', (own, equal) => {
    const samples = own(helpers.matFromArray(cv, 3, 2, cv.CV_32FC1, [0, 0, 1, 1, 5, 5]))
    const params = own(new cv.flann.KDTreeIndexParams(2))
    const index = own(new cv.flann.Index(samples, params))
    const indices = own(new cv.Mat()), distances = own(new cv.Mat())
    const query = own(helpers.matFromArray(cv, 1, 2, cv.CV_32FC1, [1, 1]))
    index.knnSearch(query, indices, distances, 1)
    equal([...indices.data32S], [1])
    equal([...distances.data32F], [0])
    const unified = own(cv.toUMat(samples, cv.ACCESS_READ))
    const mapped = own(unified.getMat(cv.ACCESS_READ))
    equal([...mapped.data32F], [...samples.data32F])
  })
  check('EMD flow output and omnidirectional projection', (own, equal) => {
    const a = own(helpers.matFromArray(cv, 1, 2, cv.CV_32FC1, [1, 0]))
    const b = own(helpers.matFromArray(cv, 1, 2, cv.CV_32FC1, [1, 5]))
    const cost = own(new cv.Mat()), flow = own(new cv.Mat())
    equal(cv.EMD(a, b, cv.DIST_L1, cost, 1_000_000, flow), { value: 5, lowerBound: 5 })
    equal([...flow.data32F], [1])
    const point = own(helpers.matFromArray(cv, 1, 1, cv.CV_64FC3, [0, 0, 1]))
    const origin = own(new cv.Mat(3, 1, cv.CV_64FC1, [0, 0, 0, 0]))
    const camera = own(helpers.matFromArray(cv, 3, 3, cv.CV_64FC1, [500, 0, 50, 0, 500, 50, 0, 0, 1]))
    const distortion = own(new cv.Mat(1, 4, cv.CV_64FC1, [0, 0, 0, 0]))
    const projected = own(new cv.Mat())
    cv.omnidir.projectPoints(point, projected, origin, origin, camera, 0, distortion)
    equal([...projected.data64F], [50, 50])
    equal(cv.calibrationMatrixValues(camera, { width: 100, height: 100 }, 10, 10).principalPoint, { x: 5, y: 5 })
  })
  check('QR byte decoding returns bytes', (own, equal) => {
    const encoder = own(cv.QRCodeEncoder.create())
    const qr = own(new cv.Mat()), border = own(new cv.Mat()), large = own(new cv.Mat())
    encoder.encode('hello', qr)
    cv.copyMakeBorder(qr, border, 4, 4, 4, 4, cv.BORDER_CONSTANT, [255, 255, 255, 255])
    cv.resize(border, large, { width: 330, height: 330 }, 0, 0, cv.INTER_NEAREST)
    const decoder = own(new cv.QRCodeDetector())
    const bytes = own(decoder.detectAndDecodeBytes(large))
    equal(Array.from({ length: bytes.size() }, (_, i) => bytes.get(i)), [104, 101, 108, 108, 111])
  })
  return passed
}
