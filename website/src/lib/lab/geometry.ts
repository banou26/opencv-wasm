import { mint, orange, type Experiment } from './context'
/** Preview calibration observations and run geometric estimation on explicitly supplied correspondences. */
export const geometry = (e: Experiment): boolean => {
  const { cv, bgr, gray, out } = e,
    id = e.request.algorithm,
    n = (key: string) => e.n(key)
  const camera = () =>
    e.array(3, 3, cv.CV_64F, [
      gray.cols * n('focal'),
      0,
      gray.cols / 2,
      0,
      gray.cols * n('focal'),
      gray.rows / 2,
      0,
      0,
      1
    ])
  switch (id) {
    case 'camera-calibration': {
      const corners = e.mat(),
        size = { width: n('columns'), height: n('rows') },
        found = cv.findChessboardCorners(gray, size, corners, cv.CALIB_CB_ADAPTIVE_THRESH | cv.CALIB_CB_NORMALIZE_IMAGE)
      bgr.copyTo(out)
      if (found) {
        cv.cornerSubPix(
          gray,
          corners,
          { width: 5, height: 5 },
          { width: -1, height: -1 },
          { type: cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, maxCount: 30, epsilon: 0.01 }
        )
        cv.drawChessboardCorners(out, size, corners, found)
      }
      e.note = found
        ? `Detected ${corners.rows} calibration corners. Collect several views at different orientations before fitting camera intrinsics.`
        : 'No complete checkerboard found. Set the number of inner corners, not the number of squares.'
      break
    }
    case 'undistortion': {
      const k = camera(),
        dist = e.array(1, 5, cv.CV_64F, [n('k1'), n('k2'), 0, 0, 0])
      cv.undistort(bgr, out, k, dist)
      break
    }
    case 'pnp': {
      const points = e.table('points', 2, 4)
      if (points.length !== 4) throw new Error('Provide exactly four image points for the four square corners.')
      const object = e.array(4, 1, cv.CV_32FC3, [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        image = e.array(
          4,
          1,
          cv.CV_32FC2,
          points.flatMap(([x, y]) => [x * gray.cols, y * gray.rows])
        ),
        k = camera(),
        dist = e.own(cv.Mat.zeros(1, 5, cv.CV_64F)),
        rotation = e.mat(),
        translation = e.mat(),
        projected = e.mat()
      if (!cv.solvePnP(object, image, k, dist, rotation, translation))
        throw new Error('Pose could not be estimated from these points.')
      cv.projectPoints(object, rotation, translation, k, dist, projected)
      bgr.copyTo(out)
      const values = Array.from(projected.data32F)
      for (let i = 0; i < 4; i++) {
        cv.circle(out, { x: Math.round(points[i][0] * gray.cols), y: Math.round(points[i][1] * gray.rows) }, 6, mint, 1)
        cv.circle(out, { x: Math.round(values[i * 2]), y: Math.round(values[i * 2 + 1]) }, 3, orange, -1)
      }
      e.note = `Rotation vector: ${Array.from(rotation.data64F)
        .map((x) => x.toFixed(5))
        .join(', ')}. Translation: ${Array.from(translation.data64F)
        .map((x) => x.toFixed(5))
        .join(', ')}.`
      break
    }
    case 'epipolar-geometry': {
      const table = e.table('pairs', 4, 8),
        a = e.array(
          table.length,
          1,
          cv.CV_32FC2,
          table.flatMap((p) => [p[0] * gray.cols, p[1] * gray.rows])
        ),
        b = e.array(
          table.length,
          1,
          cv.CV_32FC2,
          table.flatMap((p) => [p[2] * gray.cols, p[3] * gray.rows])
        ),
        fundamental = e.own(cv.findFundamentalMat(a, b, cv.FM_RANSAC, n('threshold'), 0.99, 1000)),
        lines = e.mat()
      if (fundamental.empty())
        throw new Error(
          'The correspondences are degenerate. Supply at least eight distinct matches across a non-planar scene.'
        )
      cv.computeCorrespondEpilines(a, 1, fundamental, lines)
      e.second().copyTo(out)
      const data = Array.from(lines.data32F)
      for (let i = 0; i < table.length; i++) {
        const [aa, bb, c] = data.slice(i * 3, i * 3 + 3)
        if (Math.abs(bb) > 1e-8)
          cv.line(
            out,
            { x: 0, y: Math.round(-c / bb) },
            { x: gray.cols - 1, y: Math.round(-(aa * (gray.cols - 1) + c) / bb) },
            mint,
            1
          )
        cv.circle(out, { x: Math.round(table[i][2] * gray.cols), y: Math.round(table[i][3] * gray.rows) }, 4, orange, 1)
      }
      e.note = `Fundamental matrix: ${Array.from(fundamental.data64F)
        .map((x) => x.toExponential(3))
        .join(', ')}.`
      break
    }
    case 'triangulation': {
      const table = e.table('pairs', 4),
        f = n('focal') * gray.cols,
        cx = gray.cols / 2,
        cy = gray.rows / 2,
        baseline = n('baseline'),
        a = e.array(3, 4, cv.CV_64F, [f, 0, cx, 0, 0, f, cy, 0, 0, 0, 1, 0]),
        b = e.array(3, 4, cv.CV_64F, [f, 0, cx, -f * baseline, 0, f, cy, 0, 0, 0, 1, 0]),
        left = e.array(2, table.length, cv.CV_64F, [
          ...table.map((p) => p[0] * gray.cols),
          ...table.map((p) => p[1] * gray.rows)
        ]),
        right = e.array(2, table.length, cv.CV_64F, [
          ...table.map((p) => p[2] * gray.cols),
          ...table.map((p) => p[3] * gray.rows)
        ]),
        points = e.mat()
      cv.triangulatePoints(a, b, left, right, points)
      bgr.copyTo(out)
      const values = Array.from(points.data64F),
        coordinates: string[] = []
      for (let i = 0; i < table.length; i++) {
        const w = values[3 * table.length + i]
        coordinates.push(
          Math.abs(w) < 1e-10
            ? `${i}: at infinity`
            : `${i}: (${[0, 1, 2].map((c) => (values[c * table.length + i] / w).toFixed(4)).join(', ')})`
        )
        cv.circle(out, { x: Math.round(table[i][0] * gray.cols), y: Math.round(table[i][1] * gray.rows) }, 4, mint, 2)
      }
      e.note = `Triangulated XYZ: ${coordinates.join('; ')}.`
      break
    }
    case 'kalman': {
      const table = e.table('points', 2, 2),
        filter = e.own(new cv.KalmanFilter(4, 2, 0, cv.CV_32F))
      filter.transitionMatrix = e.array(4, 4, cv.CV_32F, [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1])
      filter.measurementMatrix = e.array(2, 4, cv.CV_32F, [1, 0, 0, 0, 0, 1, 0, 0])
      filter.processNoiseCov = e.array(
        4,
        4,
        cv.CV_32F,
        [0.0001, 0, 0, 0, 0, 0.0001, 0, 0, 0, 0, 0.0001, 0, 0, 0, 0, 0.0001]
      )
      filter.measurementNoiseCov = e.array(2, 2, cv.CV_32F, [n('noise'), 0, 0, n('noise')])
      filter.errorCovPost = e.array(4, 4, cv.CV_32F, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      filter.statePost = e.array(4, 1, cv.CV_32F, [...table[0], 0, 0])
      bgr.copyTo(out)
      let previous: { x: number; y: number } | undefined
      for (const point of table) {
        e.own(filter.predict())
        const measurement = e.array(2, 1, cv.CV_32F, point),
          estimate = e.own(filter.correct(measurement)),
          values = Array.from(estimate.data32F),
          p = { x: Math.round(values[0] * gray.cols), y: Math.round(values[1] * gray.rows) }
        cv.circle(out, { x: Math.round(point[0] * gray.cols), y: Math.round(point[1] * gray.rows) }, 4, orange, 1)
        if (previous) cv.line(out, previous, p, mint, 2)
        cv.circle(out, p, 2, mint, -1)
        previous = p
      }
      e.note = `Filtered ${table.length} measurements at a fixed one-step time interval.`
      break
    }
    default:
      return false
  }
  return true
}
