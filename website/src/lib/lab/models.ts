import { mint, type Experiment } from './context'
const assets = new Map<string, Promise<Uint8Array>>()
const fetchAsset = (name: string) => {
  let promise = assets.get(name)
  if (!promise) {
    promise = fetch(`/lab-assets/${name}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load lab asset ${name} (${response.status}).`)
        return new Uint8Array(await response.arrayBuffer())
      })
      .catch((error) => {
        assets.delete(name)
        throw error
      })
    assets.set(name, promise)
  }
  return promise
}
/** Run model-backed experiments. Uploaded bytes are scoped to temporary files and removed even on errors. */
export const models = async (e: Experiment): Promise<boolean> => {
  const { cv, bgr, gray, out } = e,
    id = e.request.algorithm,
    n = (key: string) => e.n(key),
    s = (key: string) => e.s(key),
    files: string[] = []
  const file = (name: string, bytes: Uint8Array) => {
    const path = `/lab-${name}`
    cv.FS.writeFile(path, bytes)
    files.push(path)
    return path
  }
  try {
    switch (id) {
      case 'dnn-inference': {
        const bytes = e.request.assets.model ?? (await fetchAsset('relu.onnx')),
          path = file('network.onnx', bytes),
          net = e.own(cv.dnn.readNetFromONNX(path)),
          blob = e.own(
            cv.dnn.blobFromImage(bgr, n('scale'), { width: n('size'), height: n('size') }, [0, 0, 0, 0], true, false)
          )
        net.setInput(blob)
        const tensor = e.own(net.forward()),
          numeric = e.mat(),
          shape = tensor.matSize
        tensor.convertTo(numeric, cv.CV_32F)
        const values = Float32Array.from(numeric.data32F)
        if (!values.length) throw new Error('The network produced an empty output.')
        const width = shape.length >= 2 ? shape[shape.length - 1] : values.length,
          height = shape.length >= 2 ? shape[shape.length - 2] : 1,
          planes = Math.max(1, Math.floor(values.length / (width * height))),
          plane = Math.min(n('channel'), planes - 1),
          field = e.array(height, width, cv.CV_32F, values.slice(plane * width * height, (plane + 1) * width * height))
        e.field(field, ['network value'])
        e.note = `${e.request.assets.model ? 'Uploaded network' : 'Built-in ReLU demo'}. Output shape [${shape.join(', ')}]; showing plane ${plane} of ${planes} (zero-based). Display is normalized.`
        break
      }
      case 'dnn-super-resolution': {
        if (!e.request.assets.model && (s('architecture') !== 'fsrcnn' || s('scale') !== '2'))
          throw new Error(
            'The built-in model is FSRCNN ×2. Upload a .pb model matching the chosen architecture and scale.'
          )
        const bytes = e.request.assets.model ?? (await fetchAsset('FSRCNN_x2.pb'))
        const path = file('superres.pb', bytes),
          network = e.own(cv.dnn_superres.DnnSuperResImpl.create())
        network.readModel(path)
        network.setModel(s('architecture'), Number(s('scale')))
        network.upsample(bgr, out)
        e.note = e.request.assets.model
          ? 'Using the uploaded super-resolution model.'
          : 'Using the bundled FSRCNN ×2 model.'
        break
      }
      case 'ocr': {
        const bytes = e.request.assets.language ?? (await fetchAsset('eng.traineddata'))
        const path = '/eng.traineddata'
        cv.FS.writeFile(path, bytes)
        files.push(path)
        const engine = e.own(cv.text.OCRTesseract.create('/', 'eng', '', 1, Number(s('layout')))),
          text = engine.run(gray, 0)
        bgr.copyTo(out)
        e.note = text.trim() ? `Recognized text: ${text.trim()}` : 'No text was recognized.'
        break
      }
      case 'text-detection': {
        const [first, second] = await Promise.all([
            fetchAsset('trained_classifierNM1.xml'),
            fetchAsset('trained_classifierNM2.xml')
          ]),
          one = file('nm1.xml', first),
          two = file('nm2.xml', second),
          cb1 = e.own(cv.text.loadClassifierNM1(one)),
          cb2 = e.own(cv.text.loadClassifierNM2(two)),
          filter1 = e.own(cv.text.createERFilterNM1(cb1, 8, 0.00015, 0.13, n('probability'), true, 0.1)),
          filter2 = e.own(cv.text.createERFilterNM2(cb2, 0.5)),
          regions = e.own(new cv.PointVectorVector()),
          boxes = e.own(new cv.RectVector())
        cv.text.detectRegions(gray, filter1, filter2, regions)
        cv.text.erGrouping(bgr, gray, regions, boxes)
        bgr.copyTo(out)
        for (let i = 0; i < boxes.size(); i++) {
          const r = boxes.get(i)!
          cv.rectangle(out, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, mint, 2)
        }
        e.note = `${regions.size()} candidate regions, ${boxes.size()} grouped text boxes. No recognition is performed.`
        break
      }
      default:
        return false
    }
    return true
  } finally {
    for (const path of files) cv.FS.unlink(path)
  }
}
