import { mint, orange, type Experiment } from './context'
/** Run colour clustering, supervised colour classification, PCA and editable box suppression. */
export const learning = (e: Experiment): boolean => {
  const { cv, bgr, gray, out } = e,
    id = e.request.algorithm,
    n = (key: string) => e.n(key)
  if (['kmeans', 'pca', 'svm', 'knn-classifier', 'random-forests'].includes(id)) {
    const colors = Float32Array.from(bgr.data, (v) => v / 255),
      samples = e.array(gray.rows * gray.cols, 3, cv.CV_32F, colors)
    if (id === 'kmeans') {
      const labels = e.mat(),
        centres = e.mat()
      const compactness = cv.kmeans(
        samples,
        n('clusters'),
        labels,
        { type: cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, maxCount: n('iterations'), epsilon: 0.01 },
        1,
        cv.KMEANS_PP_CENTERS,
        centres
      )
      out.create(gray.rows, gray.cols, cv.CV_8UC3)
      const indices = labels.data32S,
        palette = centres.data32F,
        pixels = out.data
      for (let i = 0; i < indices.length; i++)
        for (let c = 0; c < 3; c++) pixels[i * 3 + c] = Math.round(palette[indices[i] * 3 + c] * 255)
      e.raw(e.array(gray.rows, gray.cols, cv.CV_32S, Int32Array.from(labels.data32S)), ['cluster ID'])
      e.note = `Colour compactness: ${compactness.toFixed(3)}.`
    } else if (id === 'pca') {
      const mean = e.mat(),
        vectors = e.mat(),
        projected = e.mat(),
        restored = e.mat()
      cv.PCACompute(samples, mean, vectors, n('components'))
      cv.PCAProject(samples, mean, vectors, projected)
      cv.PCABackProject(projected, mean, vectors, restored)
      const reshaped = e.array(gray.rows, gray.cols, cv.CV_32FC3, Float32Array.from(restored.data32F))
      reshaped.convertTo(out, cv.CV_8U, 255)
      e.note = `Colour mean (BGR): ${Array.from(mean.data32F)
        .map((x) => (x * 255).toFixed(2))
        .join(', ')}.`
    } else {
      const r = e.rect(),
        training: number[] = [],
        labels: number[] = []
      for (let y = 0; y < gray.rows; y += Math.max(1, Math.floor(gray.rows / 24)))
        for (let x = 0; x < gray.cols; x += Math.max(1, Math.floor(gray.cols / 24))) {
          const fg = x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
            bg = x < gray.cols * 0.08 || x > gray.cols * 0.92 || y < gray.rows * 0.08 || y > gray.rows * 0.92
          if (!fg && !bg) continue
          training.push(...colors.slice((y * gray.cols + x) * 3, (y * gray.cols + x) * 3 + 3))
          labels.push(fg ? 1 : 0)
        }
      if (!labels.includes(0) || !labels.includes(1))
        throw new Error('Choose a rectangle containing both foreground samples and a separate background border.')
      const train = e.array(labels.length, 3, cv.CV_32F, training),
        responses = e.array(labels.length, 1, id === 'knn-classifier' ? cv.CV_32F : cv.CV_32S, labels),
        predictions = e.mat()
      if (id === 'svm') {
        const svm = e.own(cv.ml.SVM.create())
        svm.setType(cv.ml.SVM_C_SVC)
        svm.setKernel(cv.ml.SVM_RBF)
        svm.setC(n('c'))
        svm.setGamma(2)
        if (!svm.train1(train, cv.ml.ROW_SAMPLE, responses)) throw new Error('SVM training failed.')
        svm.predict(samples, predictions)
      } else if (id === 'knn-classifier') {
        const knn = e.own(cv.ml.KNearest.create())
        knn.setDefaultK(n('k'))
        knn.setIsClassifier(true)
        if (!knn.train1(train, cv.ml.ROW_SAMPLE, responses)) throw new Error('KNN training failed.')
        knn.findNearest(samples, n('k'), predictions)
      } else {
        const forest = e.own(cv.ml.RTrees.create())
        forest.setMaxDepth(n('depth'))
        forest.setMinSampleCount(2)
        forest.setTermCriteria({ type: cv.TERM_CRITERIA_COUNT, maxCount: 30, epsilon: 0 })
        if (!forest.train1(train, cv.ml.ROW_SAMPLE, responses)) throw new Error('Forest training failed.')
        forest.predict(samples, predictions)
      }
      const shaped = e.array(gray.rows, gray.cols, cv.CV_32F, Float32Array.from(predictions.data32F))
      shaped.convertTo(out, cv.CV_8U, 255)
      e.raw(shaped, ['predicted class'])
      e.note = `Trained on ${labels.filter((x) => x === 1).length} foreground and ${labels.filter((x) => x === 0).length} background colour samples.`
    }
    return true
  }
  if (id === 'nms') {
    const table = e.table('boxes', 5),
      boxes = e.own(new cv.Rect2dVector()),
      scores = e.own(new cv.FloatVector()),
      keep = e.own(new cv.IntVector())
    bgr.copyTo(out)
    for (const [x, y, w, h, score] of table) {
      if (w <= 0 || h <= 0 || score < 0 || score > 1)
        throw new Error('Box widths/heights must be positive; confidence must be in 0..1.')
      boxes.push_back({ x: x * gray.cols, y: y * gray.rows, width: w * gray.cols, height: h * gray.rows })
      scores.push_back(score)
    }
    cv.dnn.NMSBoxes(boxes, scores, n('score'), n('overlap'), keep)
    const selected = new Set(Array.from({ length: keep.size() }, (_, i) => keep.get(i)))
    for (let i = 0; i < boxes.size(); i++) {
      const r = boxes.get(i)!
      cv.rectangle(
        out,
        { x: Math.round(r.x), y: Math.round(r.y) },
        { x: Math.round(r.x + r.width), y: Math.round(r.y + r.height) },
        selected.has(i) ? mint : orange,
        selected.has(i) ? 3 : 1
      )
    }
    e.note = `Retained box indices: ${[...selected].join(', ') || 'none'}. Mint retained, orange suppressed.`
    return true
  }
  return false
}
