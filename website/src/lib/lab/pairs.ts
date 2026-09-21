import { mint, orange, type Experiment } from './context'
/** Run matching, alignment, motion, tracking and image-comparison experiments on two frames. */
export const pairs = (e: Experiment): boolean => {
  const { cv, bgr, gray, out } = e,
    id = e.request.algorithm,
    n = (key: string) => e.n(key),
    s = (key: string) => e.s(key)
  switch (id) {
    case 'template-matching': {
      const second = e.second(true),
        rect = e.rect(),
        patch = e.own(second.roi(rect)),
        scores = e.mat(),
        method =
          s('method') === 'SQDIFF_NORMED'
            ? cv.TM_SQDIFF_NORMED
            : s('method') === 'CCORR_NORMED'
              ? cv.TM_CCORR_NORMED
              : cv.TM_CCOEFF_NORMED
      cv.matchTemplate(gray, patch, scores, method)
      const extrema = cv.minMaxLoc(scores),
        point = method === cv.TM_SQDIFF_NORMED ? extrema.minLoc : extrema.maxLoc
      bgr.copyTo(out)
      cv.rectangle(out, point, { x: point.x + rect.width, y: point.y + rect.height }, mint, 2)
      e.note = `Best match at (${point.x}, ${point.y}), score ${(method === cv.TM_SQDIFF_NORMED ? extrema.minVal : extrema.maxVal).toFixed(5)}. Template ${rect.width} × ${rect.height}.`
      break
    }
    case 'phase-correlation': {
      const first = e.mat(),
        second = e.mat(),
        window = e.mat()
      gray.convertTo(first, cv.CV_32F)
      e.second(true).convertTo(second, cv.CV_32F)
      if (s('window') === 'hann') cv.createHanningWindow(window, e.size(), cv.CV_32F)
      const result = cv.phaseCorrelate(first, second, window),
        m = e.array(2, 3, cv.CV_64F, [1, 0, -result.value.x, 0, 1, -result.value.y])
      cv.warpAffine(e.second(), out, m, e.size())
      e.note = `Translation: dx ${result.value.x.toFixed(3)}, dy ${result.value.y.toFixed(3)} px. Response ${result.response.toFixed(5)}.`
      break
    }
    case 'ecc-alignment': {
      const second = e.second(true),
        matrix = e.array(2, 3, cv.CV_32F, [1, 0, 0, 0, 1, 0]),
        mask = e.mat(),
        motion =
          s('motion') === 'affine'
            ? cv.MOTION_AFFINE
            : s('motion') === 'euclidean'
              ? cv.MOTION_EUCLIDEAN
              : cv.MOTION_TRANSLATION
      const score = cv.findTransformECC(
        gray,
        second,
        matrix,
        motion,
        { type: cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, maxCount: n('iterations'), epsilon: 1e-5 },
        mask,
        5
      )
      cv.warpAffine(e.second(), out, matrix, e.size(), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP)
      e.note = `ECC correlation: ${score.toFixed(6)}. Transform: ${Array.from(matrix.data32F)
        .map((x) => x.toFixed(4))
        .join(', ')}.`
      break
    }
    case 'brute-force-matching':
    case 'flann': {
      const second = e.second(true),
        a = e.own(new cv.KeyPointVector()),
        b = e.own(new cv.KeyPointVector()),
        da = e.mat(),
        db = e.mat(),
        mask = e.mat(),
        detector = e.own(id === 'flann' ? cv.SIFT.create(n('features')) : cv.ORB.create(n('features')))
      detector.detectAndCompute(gray, mask, a, da)
      detector.detectAndCompute(second, mask, b, db)
      const selected = e.own(new cv.DMatchVector())
      if (!da.empty() && !db.empty() && db.rows >= 2) {
        if (id === 'flann') {
          const matcher = e.own(new cv.FlannBasedMatcher()),
            matches = e.own(new cv.DMatchVectorVector())
          matcher.knnMatch(da, db, matches, 2)
          for (let i = 0; i < matches.size(); i++) {
            const group = e.own(matches.get(i))
            if (group.size() > 1) {
              const first = group.get(0)!,
                next = group.get(1)!
              if (first.distance < n('ratio') * next.distance) selected.push_back(first)
            }
          }
        } else {
          const matcher = e.own(new cv.BFMatcher(cv.NORM_HAMMING, true)),
            matches = e.own(new cv.DMatchVector())
          matcher.match(da, db, matches)
          const ordered = Array.from({ length: matches.size() }, (_, i) => matches.get(i)!).sort(
            (x, y) => x.distance - y.distance
          )
          for (const match of ordered.slice(0, n('matches'))) selected.push_back(match)
        }
      }
      cv.drawMatches(bgr, a, e.second(), b, selected, out, mint, orange)
      e.note = `${a.size()} / ${b.size()} keypoints; ${selected.size()} matches drawn. Matching alone does not verify geometry.`
      break
    }
    case 'optical-flow-lk': {
      const first = e.mat(),
        next = e.mat(),
        status = e.mat(),
        error = e.mat()
      cv.goodFeaturesToTrack(gray, first, n('features'), 0.01, 8)
      e.second().copyTo(out)
      if (!first.empty()) {
        cv.calcOpticalFlowPyrLK(gray, e.second(true), first, next, status, error, {
          width: n('window'),
          height: n('window')
        })
        const a = Array.from(first.data32F),
          b = Array.from(next.data32F),
          ok = Array.from(status.data)
        let accepted = 0
        for (let i = 0; i < ok.length; i++)
          if (ok[i]) {
            accepted++
            cv.arrowedLine(
              out,
              { x: Math.round(a[i * 2]), y: Math.round(a[i * 2 + 1]) },
              { x: Math.round(b[i * 2]), y: Math.round(b[i * 2 + 1]) },
              mint,
              1
            )
          }
        e.note = `Tracked ${accepted} of ${ok.length} corners.`
      } else e.note = 'No trackable corners found.'
      break
    }
    case 'optical-flow-farneback':
    case 'optical-flow-dis':
    case 'optical-flow-tvl1': {
      const second = e.second(true),
        flow = e.mat()
      if (id === 'optical-flow-farneback')
        cv.calcOpticalFlowFarneback(gray, second, flow, 0.5, n('levels'), n('window'), 3, 5, 1.2, 0)
      else if (id === 'optical-flow-dis')
        e.own(
          cv.DISOpticalFlow.create(
            s('preset') === 'ultrafast'
              ? cv.DISOpticalFlow_PRESET_ULTRAFAST
              : s('preset') === 'medium'
                ? cv.DISOpticalFlow_PRESET_MEDIUM
                : cv.DISOpticalFlow_PRESET_FAST
          )
        ).calc(gray, second, flow)
      else {
        const algorithm = e.own(cv.optflow.DualTVL1OpticalFlow.create())
        algorithm.setLambda(n('lambda'))
        algorithm.setScalesNumber(n('scales'))
        algorithm.calc(gray, second, flow)
      }
      e.raw(flow, ['dx (px)', 'dy (px)'])
      const hsv = e.own(new cv.Mat(gray.rows, gray.cols, cv.CV_8UC3)),
        values = flow.data32F,
        pixels = hsv.data
      let sum = 0
      for (let i = 0; i < values.length; i += 2) {
        const magnitude = Math.hypot(values[i], values[i + 1])
        pixels[(i / 2) * 3] = ((Math.atan2(values[i + 1], values[i]) + Math.PI) * 90) / Math.PI
        pixels[(i / 2) * 3 + 1] = 255
        pixels[(i / 2) * 3 + 2] = Math.min(255, magnitude * 16)
        sum += magnitude
      }
      cv.cvtColor(hsv, out, cv.COLOR_HSV2BGR)
      e.note = `Mean displacement magnitude: ${(sum / (gray.rows * gray.cols)).toFixed(3)} px. Brightness saturates at about 16 px.`
      break
    }
    case 'background-mog2':
    case 'background-knn': {
      const background = e.own(
        id === 'background-mog2'
          ? cv.createBackgroundSubtractorMOG2(100, n('threshold'), s('shadows') === 'on')
          : cv.createBackgroundSubtractorKNN(100, n('threshold'), s('shadows') === 'on')
      )
      const warm = e.mat()
      for (let i = 0; i < 20; i++) background.apply(bgr, warm, 0.5)
      background.apply(e.second(), out, 0)
      e.note = '0 background, 127 shadow (when enabled), 255 foreground. First image repeated for 20 warm-up frames.'
      break
    }
    case 'tracker-csrt':
    case 'tracker-kcf':
    case 'tracker-mil': {
      const tracker = e.own(
        id === 'tracker-csrt'
          ? cv.TrackerCSRT.create()
          : id === 'tracker-kcf'
            ? cv.TrackerKCF.create()
            : cv.TrackerMIL.create()
      )
      tracker.init(bgr, e.rect())
      if (id === 'tracker-kcf') tracker.update(bgr)
      const second = e.second(),
        [found, r] = tracker.update(second)
      second.copyTo(out)
      if (found) cv.rectangle(out, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, mint, 2)
      e.note = found
        ? `Tracked rectangle: x ${r.x}, y ${r.y}, width ${r.width}, height ${r.height}.`
        : 'Tracker did not locate the rectangle in the second image.'
      break
    }
    case 'stereo-bm':
    case 'stereo-sgbm': {
      if (gray.cols <= n('disparities') + n('block'))
        throw new Error('Input width must exceed disparity range plus block width.')
      const disparity = e.mat(),
        float = e.mat(),
        matcher = e.own(
          id === 'stereo-bm'
            ? cv.StereoBM.create(n('disparities'), n('block'))
            : cv.StereoSGBM.create(0, n('disparities'), n('block'), 8 * n('block') ** 2, 32 * n('block') ** 2)
        )
      matcher.compute(gray, e.second(true), disparity)
      disparity.convertTo(float, cv.CV_32F, 1 / 16)
      e.field(float, ['disparity (px)'])
      break
    }
    case 'image-hashing': {
      const hash = e.own(
          s('method') === 'average'
            ? cv.img_hash.AverageHash.create()
            : s('method') === 'block-mean'
              ? cv.img_hash.BlockMeanHash.create()
              : cv.img_hash.PHash.create()
        ),
        a = e.mat(),
        b = e.mat(),
        second = e.second()
      hash.compute(bgr, a)
      hash.compute(second, b)
      const distance = hash.compare(a, b)
      second.copyTo(out)
      e.note = `Hash distance: ${distance}. Lower is more similar; this is not a pixel error score.`
      break
    }
    case 'quality-metrics': {
      const second = e.second(true),
        map = e.mat()
      if (s('method') === 'SSIM') {
        const score = cv.quality.QualitySSIM_compute(gray, second, map)
        e.field(map, ['SSIM'])
        e.note = `Grayscale SSIM: ${score[0].toFixed(6)}. Higher is more similar.`
      } else {
        const score = cv.quality.QualityMSE_compute(gray, second, map)
        e.field(map, ['squared error'])
        e.note = `Grayscale MSE: ${score[0].toFixed(6)}. PSNR: ${cv.PSNR(gray, second).toFixed(3)} dB.`
      }
      break
    }
    case 'stitching': {
      const stitcher = e.own(cv.Stitcher.create(s('mode') === 'scans' ? cv.Stitcher_SCANS : cv.Stitcher_PANORAMA)),
        images = e.own(new cv.MatVector())
      stitcher.setPanoConfidenceThresh(n('confidence'))
      images.push_back(bgr)
      images.push_back(e.second())
      const status = stitcher.stitch(images, out)
      if (status !== cv.Stitcher_OK)
        throw new Error(
          `Panorama could not be estimated (status ${status}). Try textured photos with substantial overlap or reduce the confidence threshold.`
        )
      e.note = `Panorama ${out.cols} × ${out.rows}.`
      break
    }
    case 'icp': {
      const second = e.second(true),
        cloud = (image: typeof gray) => {
          const values = Array.from(image.data),
            samples: number[] = [],
            step = Math.max(2, Math.floor(Math.max(gray.cols, gray.rows) / 40))
          for (let y = step; y < gray.rows - step; y += step)
            for (let x = step; x < gray.cols - step; x += step) {
              const z = (values[y * gray.cols + x] / 255) * n('height'),
                dx = ((values[y * gray.cols + x + 1] - values[y * gray.cols + x - 1]) / 510) * n('height') * gray.cols,
                dy =
                  ((values[(y + 1) * gray.cols + x] - values[(y - 1) * gray.cols + x]) / 510) * n('height') * gray.rows,
                len = Math.hypot(dx, dy, 1)
              samples.push(x / gray.cols, y / gray.rows, z, -dx / len, -dy / len, 1 / len)
            }
          return e.array(samples.length / 6, 6, cv.CV_32F, samples)
        }
      const firstCloud = cloud(gray),
        secondCloud = cloud(second),
        icp = e.own(new cv.ppf_match_3d.ICP(n('iterations'), 0.005, 2.5, 4)),
        result = icp.registerModelToScene(firstCloud, secondCloud)
      if (result.value !== 0) throw new Error(`ICP returned status ${result.value}.`)
      e.second().copyTo(out)
      e.note = `ICP residual ${result.residual.toExponential(4)}. Pose: ${JSON.stringify(result.pose)}. Preview shows the second image; the fitted transform acts on the intensity point cloud.`
      break
    }
    default:
      return false
  }
  return true
}
