/** Round trips and numeric checks for the separately compiled CPU dependencies. */
export const runDependencyChecks = (cv, helpers, fontBytes, languageBytes) => {
  const owned = []
  const own = value => { if (!value) throw new Error('Native object was not created'); owned.push(value); return value }
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const passed = []
  try {
    cv.FS.writeFile('/test-font.ttf', fontBytes)
    const font = own(cv.freetype.createFreeType2())
    font.loadFontData('/test-font.ttf', 0)
    const pixels = own(new cv.Mat(100, 320, cv.CV_8UC3, [255, 255, 255, 0]))
    font.putText(pixels, 'Hello', { x: 10, y: 70 }, 48, [0, 0, 0, 0], -1, cv.LINE_AA, false)
    assert(pixels.data.some(value => value < 100), 'FreeType did not render glyph pixels')
    const size = font.getTextSize('Hello', 48, -1)
    assert(size.value.width > 50 && size.value.height > 20, 'Unexpected font metrics')
    passed.push('FreeType and HarfBuzz font rendering')

    cv.FS.mkdirTree('/tessdata')
    cv.FS.writeFile('/tessdata/eng.traineddata', languageBytes)
    const text = own(new cv.Mat(90, 320, cv.CV_8UC3, [255, 255, 255, 0]))
    cv.putText(text, 'HELLO', { x: 20, y: 65 }, cv.FONT_HERSHEY_SIMPLEX, 1.6, [0, 0, 0, 0], 3, cv.LINE_AA)
    const ocr = own(cv.text.OCRTesseract.create('/tessdata', 'eng', '', 1, 7))
    const recognized = ocr.run(text, 0).trim()
    assert(recognized === 'HELLO', `OCR returned ${JSON.stringify(recognized)}`)
    passed.push('Tesseract LSTM recognition')

    const source = own(helpers.matFromArray(cv, 2, 3, cv.CV_32FC1, [1, 2, 3, 4, 5, 6]))
    const file = own(cv.hdf.open('/roundtrip.h5'))
    file.dscreate(2, 3, cv.CV_32FC1, 'matrix')
    file.dswrite(source, 'matrix')
    file.atwrite(42, 'answer')
    file.close()
    const reopened = own(cv.hdf.open('/roundtrip.h5'))
    const restored = own(new cv.Mat())
    reopened.dsread(restored, 'matrix')
    assert([...restored.data32F].join(',') === '1,2,3,4,5,6', 'HDF5 matrix data changed')
    assert(reopened.atread('answer').value === 42, 'HDF5 scalar attribute changed')
    reopened.close()
    assert([...cv.FS.readFile('/roundtrip.h5').slice(0, 8)].join(',') === '137,72,68,70,13,10,26,10', 'HDF5 file signature missing')
    passed.push('HDF5 matrix and attribute persistence')

    const projections = own(new cv.MatVector()), points = own(new cv.MatVector())
    for (const [tx, ty] of [[0, 0], [-1, 0], [0, -1]]) {
      const projection = own(helpers.matFromArray(cv, 3, 4, cv.CV_64FC1, [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, 0]))
      const point = own(helpers.matFromArray(cv, 2, 1, cv.CV_64FC1, [(1 + tx) / 5, (2 + ty) / 5]))
      projections.push_back(projection)
      points.push_back(point)
    }
    const triangulated = own(new cv.Mat())
    cv.sfm.triangulatePoints(points, projections, triangulated)
    assert([...triangulated.data64F].every((value, index) => Math.abs(value - [1, 2, 5][index]) < 1e-8), 'Multi-view triangulation changed the 3D point')
    assert(triangulated.total() === 3, 'Triangulation result has the wrong shape')
    passed.push('SFM multi-view triangulation')

    const options = own(new cv.sfm.libmv_ReconstructionOptions(0, 1, 0, 0, -1))
    const intrinsics = own(new cv.sfm.libmv_CameraIntrinsicsOptions(0, 600, 600, 320, 240))
    assert(intrinsics.polynomial_p1 === 0 && intrinsics.polynomial_p2 === 0, 'SFM distortion fields must be initialized')
    const reconstruction = own(cv.sfm.SFMLibmvEuclideanReconstruction.create(intrinsics, options))
    const views = own(new cv.MatVector())
    for (let camera = 0; camera < 3; camera++) {
      const x = [], y = []
      for (let i = 0; i < 40; i++) {
        const px = Math.sin(i * 1.7), py = Math.cos(i * 2.3), pz = 5 + (i % 7) / 3
        x.push(600 * (px - camera * 0.6) / pz + 320)
        y.push(600 * (py - camera * 0.05) / pz + 240)
      }
      views.push_back(own(helpers.matFromArray(cv, 2, 40, cv.CV_64FC1, [...x, ...y])))
    }
    reconstruction.run(views)
    const reconstructed = own(new cv.MatVector()), rotations = own(new cv.MatVector()), translations = own(new cv.MatVector())
    reconstruction.getPoints(reconstructed)
    reconstruction.getCameras(rotations, translations)
    assert(reconstruction.getError() < 1e-4, 'SFM reconstruction reprojection error is too large')
    assert(reconstructed.size() === 40 && rotations.size() === 3 && translations.size() === 3, 'SFM did not recover all scene points and cameras')
    for (let i = 0; i < reconstructed.size(); i++) {
      const point = own(reconstructed.get(i))
      assert(point.total() === 3 && point.data64F.every(Number.isFinite), 'SFM returned an invalid point')
    }
    passed.push('SFM libmv and Ceres reconstruction')
    return passed
  } finally {
    for (const value of owned.reverse()) if (!value.isDeleted()) value.delete()
    for (const file of ['/test-font.ttf', '/tessdata/eng.traineddata', '/roundtrip.h5']) {
      try { cv.FS.unlink(file) } catch {}
    }
  }
}
