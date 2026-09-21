import type { Mat } from '../../../../lib/index.js'
import { Experiment, mint, orange } from './context'
import { motionVectors } from './motion'

/** Join two native views for a diagnostic preview without changing either input. */
const pairPreview = (e: Experiment, left: Mat, right: Mat) => {
  const images = e.own(new e.cv.MatVector()),
    output = e.mat()
  images.push_back(left)
  images.push_back(right)
  e.cv.hconcat(images, output)
  return output
}

const regionMask = (e: Experiment) => {
  const mask = e.own(e.cv.Mat.zeros(e.gray.rows, e.gray.cols, e.cv.CV_8U)),
    r = e.rect(0)
  e.cv.rectangle(mask, { x: r.x, y: r.y }, { x: r.x + r.width - 1, y: r.y + r.height - 1 }, [255, 0, 0, 0], -1)
  return mask
}
const cleaned = (e: Experiment, mask: Mat, operation: number) => {
  const out = e.mat(),
    element = e.own(e.cv.getStructuringElement(e.cv.MORPH_ELLIPSE, { width: e.n('kernel'), height: e.n('kernel') }))
  e.cv.morphologyEx(mask, out, operation, element)
  return out
}
const components = (e: Experiment, mask: Mat, background: Mat) => {
  const { cv } = e,
    labels = e.mat(),
    stats = e.mat(),
    centroids = e.mat(),
    count = cv.connectedComponentsWithStats(mask, labels, stats, centroids),
    data = Array.from(stats.data32S)
  background.copyTo(e.out)
  let kept = 0
  for (let i = 1; i < count; i++) {
    const [x, y, w, h, area] = data.slice(i * 5, i * 5 + 5)
    if (area < e.n('area')) continue
    kept++
    cv.rectangle(e.out, { x, y }, { x: x + w - 1, y: y + h - 1 }, mint, 2)
    cv.putText(e.out, String(kept), { x, y: Math.max(14, y - 4) }, cv.FONT_HERSHEY_SIMPLEX, 0.5, mint, 1)
  }
  e.raw(labels, ['component ID'])
  e.note = `${kept} regions retained from ${count - 1} foreground components.`
}
const foreground = (e: Experiment) => {
  const { cv } = e,
    mask = e.mat(),
    bg = e.mat(),
    fg = e.mat()
  const selection = e.own(e.bgr.mat_clone()),
    r = e.rect()
  e.cv.rectangle(selection, { x: r.x, y: r.y }, { x: r.x + r.width - 1, y: r.y + r.height - 1 }, orange, 2)
  e.stage(
    'Initial region',
    selection,
    'Inside the orange rectangle is possible foreground. Outside supplies known background to initialize GrabCut.'
  )
  cv.grabCut(e.bgr, mask, e.rect(), bg, fg, e.n('iterations'), cv.GC_INIT_WITH_RECT)
  const values = Uint8Array.from(mask.data, (value) => (value === cv.GC_FGD || value === cv.GC_PR_FGD ? 255 : 0))
  return e.array(mask.rows, mask.cols, cv.CV_8U, values)
}
const correspondences = (e: Experiment) => {
  const { cv } = e,
    first = e.own(new cv.KeyPointVector()),
    second = e.own(new cv.KeyPointVector()),
    a = e.mat(),
    b = e.mat(),
    empty = e.mat(),
    detector = e.own(cv.ORB.create(e.n('features'))),
    after = e.second()
  detector.detectAndCompute(e.gray, empty, first, a)
  detector.detectAndCompute(e.second(true), empty, second, b)
  const firstFeatures = e.mat(),
    secondFeatures = e.mat()
  cv.drawKeypoints(e.bgr, first, firstFeatures, mint)
  cv.drawKeypoints(after, second, secondFeatures, mint)
  const featurePair = pairPreview(e, firstFeatures, secondFeatures)
  e.stage(
    'Detected ORB features',
    featurePair,
    'Circles mark detected features in each frame. Each feature also has a binary descriptor; correspondence has not been established yet.'
  )
  if (a.empty() || b.empty()) throw new Error('Both images need textured features. Try a sharper, overlapping pair.')
  const matcher = e.own(new cv.BFMatcher(cv.NORM_HAMMING, true)),
    matches = e.own(new cv.DMatchVector())
  matcher.match(a, b, matches)
  const ordered = Array.from({ length: matches.size() }, (_, i) => matches.get(i)!)
    .sort((x, y) => x.distance - y.distance)
    .slice(0, 200)
  if (ordered.length < 4) throw new Error('Fewer than four descriptor matches were found.')
  const from = e.array(
      ordered.length,
      1,
      cv.CV_32FC2,
      ordered.flatMap((m) => {
        const p = first.get(m.queryIdx)!.pt
        return [p.x, p.y]
      })
    ),
    to = e.array(
      ordered.length,
      1,
      cv.CV_32FC2,
      ordered.flatMap((m) => {
        const p = second.get(m.trainIdx)!.pt
        return [p.x, p.y]
      })
    ),
    inliers = e.mat(),
    h = e.own(cv.findHomography(from, to, cv.RANSAC, e.n('tolerance'), inliers)),
    selected = e.own(new cv.DMatchVector()),
    all = e.own(new cv.DMatchVector())
  if (h.empty()) throw new Error('The matches do not support a stable homography.')
  const accepted = Array.from(inliers.data)
  ordered.forEach((match, i) => {
    all.push_back(match)
    if (accepted[i]) selected.push_back(match)
  })
  if (selected.size() < 4) throw new Error('Fewer than four geometrically consistent matches remain.')
  const preview = e.mat()
  cv.drawMatches(e.bgr, first, after, second, all, preview, orange, mint)
  e.stage('Candidate matches', preview, 'Cross-checked ORB descriptors before geometric rejection.')
  cv.drawMatches(e.bgr, first, after, second, selected, preview, mint, orange)
  e.stage('RANSAC inliers', preview, 'Only matches consistent with the fitted homography remain.')
  e.note = `${selected.size()} RANSAC inliers from ${ordered.length} candidate matches.`
  return { h, preview, after }
}

/** Execute practical multi-stage recipes, retaining intermediate images for independent inspection. */
export const cook = (e: Experiment): boolean => {
  if (!e.request.algorithm.startsWith('cookbook-')) return false
  const { cv, bgr, gray, out } = e,
    id = e.request.algorithm.slice(9),
    n = (key: string) => e.n(key)
  switch (id) {
    case 'motion-vectors':
      motionVectors(e)
      break
    case 'track-region': {
      const roi = regionMask(e),
        points = e.mat(),
        next = e.mat(),
        back = e.mat(),
        forwardStatus = e.mat(),
        backStatus = e.mat(),
        error = e.mat(),
        backError = e.mat(),
        after = e.second(),
        afterGray = e.second(true)
      cv.goodFeaturesToTrack(gray, points, n('features'), 0.01, 5, roi)
      if (points.rows < 4) throw new Error('Select a textured region with at least four detectable corners.')
      const corners = Array.from(points.data32F),
        preview = e.own(bgr.mat_clone())
      for (let i = 0; i < corners.length; i += 2)
        cv.circle(preview, { x: Math.round(corners[i]), y: Math.round(corners[i + 1]) }, 3, mint, 1)
      e.stage('Selected corners', preview, 'Corners detected only inside the selected region.')
      cv.calcOpticalFlowPyrLK(gray, afterGray, points, next, forwardStatus, error, { width: 21, height: 21 }, 3)
      cv.calcOpticalFlowPyrLK(afterGray, gray, next, back, backStatus, backError, { width: 21, height: 21 }, 3)
      const end = Array.from(next.data32F),
        returned = Array.from(back.data32F),
        ok = Array.from(forwardStatus.data),
        backOK = Array.from(backStatus.data),
        a: number[] = [],
        b: number[] = []
      after.copyTo(preview)
      for (let i = 0; i < ok.length; i++)
        if (
          ok[i] &&
          backOK[i] &&
          Math.hypot(corners[i * 2] - returned[i * 2], corners[i * 2 + 1] - returned[i * 2 + 1]) <= n('tolerance')
        ) {
          a.push(corners[i * 2], corners[i * 2 + 1])
          b.push(end[i * 2], end[i * 2 + 1])
          cv.arrowedLine(
            preview,
            { x: Math.round(corners[i * 2]), y: Math.round(corners[i * 2 + 1]) },
            { x: Math.round(end[i * 2]), y: Math.round(end[i * 2 + 1]) },
            mint,
            1
          )
        }
      if (a.length < 8)
        throw new Error('Too few consistent tracks remain. Try a larger textured region or frames closer in time.')
      e.stage(
        'Consistent tracks',
        preview,
        'Forward/backward checking removes points that do not return close to their original position.'
      )
      const inliers = e.mat(),
        matrix = e.own(
          cv.estimateAffinePartial2D(
            e.array(a.length / 2, 1, cv.CV_32FC2, a),
            e.array(b.length / 2, 1, cv.CV_32FC2, b),
            inliers,
            cv.RANSAC,
            3
          )
        )
      if (matrix.empty() || cv.countNonZero(inliers) < 3)
        throw new Error('The remaining tracks do not support a stable region transform.')
      const m = Array.from(matrix.data64F),
        r = e.rect(0),
        transformed = [
          [r.x, r.y],
          [r.x + r.width, r.y],
          [r.x + r.width, r.y + r.height],
          [r.x, r.y + r.height]
        ].map(([x, y]) => ({ x: Math.round(m[0] * x + m[1] * y + m[2]), y: Math.round(m[3] * x + m[4] * y + m[5]) }))
      after.copyTo(out)
      for (let i = 0; i < 4; i++) {
        cv.line(out, transformed[i], transformed[(i + 1) % 4], mint, 3)
        cv.circle(out, transformed[i], 4, orange, -1)
      }
      e.note = `Tracked region: ${cv.countNonZero(inliers)} inliers / ${a.length / 2} consistent tracks / ${points.rows} initial corners. Translation dx ${m[2].toFixed(3)}, dy ${m[5].toFixed(3)} px. Scale ${Math.hypot(m[0], m[3]).toFixed(4)}; rotation ${((Math.atan2(m[3], m[0]) * 180) / Math.PI).toFixed(2)}°.`
      break
    }
    case 'locate-template': {
      const r = e.rect(0),
        patch = e.own(gray.roi(r)),
        scores = e.mat(),
        after = e.second()
      const mean = e.mat(),
        deviation = e.mat()
      cv.meanStdDev(patch, mean, deviation)
      if (deviation.data64F[0] < 1)
        throw new Error('Select a patch with visible texture. A flat patch has no distinctive correlation peak.')
      e.stage('Selected patch', patch, 'The first-image selection is the template searched for in the second frame.')
      cv.matchTemplate(e.second(true), patch, scores, cv.TM_CCOEFF_NORMED)
      e.stage(
        'Correlation map',
        scores,
        'Each score belongs to a possible top-left placement of the template. Higher is more similar.'
      )
      const best = cv.minMaxLoc(scores)
      after.copyTo(out)
      if (best.maxVal >= n('score'))
        cv.rectangle(out, best.maxLoc, { x: best.maxLoc.x + r.width - 1, y: best.maxLoc.y + r.height - 1 }, mint, 3)
      e.note = `Best score ${best.maxVal.toFixed(5)} at (${best.maxLoc.x}, ${best.maxLoc.y}). ${best.maxVal >= n('score') ? 'Match accepted.' : 'Below the acceptance threshold; no box drawn.'}`
      break
    }
    case 'align-images':
    case 'match-features': {
      const match = correspondences(e)
      if (id === 'match-features') match.preview.copyTo(out)
      else {
        cv.warpPerspective(match.after, out, match.h, e.size(), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP)
        const overlay = e.mat()
        cv.addWeighted(bgr, 0.5, out, 0.5, 0, overlay)
        e.stage(
          'Alignment overlay',
          overlay,
          'Equal blend of the reference and aligned frame. Double edges reveal disagreement.'
        )
        e.note += ' Output is the second image warped to the first image’s coordinates.'
      }
      break
    }
    case 'detect-motion':
    case 'compare-images': {
      const after = e.second(),
        a = e.mat(),
        b = e.mat(),
        difference = e.mat(),
        mask = e.mat()
      if (id === 'detect-motion') {
        cv.GaussianBlur(gray, a, { width: 5, height: 5 }, 1)
        cv.GaussianBlur(e.second(true), b, { width: 5, height: 5 }, 1)
        const pair = pairPreview(e, a, b)
        e.stage(
          'Smoothed frame pair',
          pair,
          'Both grayscale frames receive the same Gaussian blur before comparison. The second frame is on the right.'
        )
        cv.absdiff(a, b, difference)
        e.stage('Absolute difference', difference, 'Differences after smoothing; unchanged areas are dark.')
        cv.threshold(difference, mask, n('threshold'), 255, cv.THRESH_BINARY)
      } else {
        const score = cv.quality.QualitySSIM_compute(gray, e.second(true), difference)
        e.stage(
          'Local SSIM',
          difference,
          'Native values measure local structural similarity; the preview is normalized.'
        )
        cv.threshold(difference, mask, n('similarity'), 255, cv.THRESH_BINARY_INV)
        mask.convertTo(mask, cv.CV_8U)
        e.note = `Mean SSIM ${score[0].toFixed(5)}. `
      }
      e.stage(
        'Thresholded differences',
        mask,
        'White marks pixels that pass the difference cutoff, before gaps are closed or small regions are discarded.'
      )
      const clean = cleaned(e, mask, cv.MORPH_CLOSE)
      e.stage(
        'Clean difference mask',
        clean,
        'Morphological closing joins nearby differences before component filtering.'
      )
      const prefix = e.note
      components(e, clean, after)
      e.note = prefix + e.note
      break
    }
    case 'count-objects': {
      const smooth = e.mat(),
        mask = e.mat()
      cv.GaussianBlur(gray, smooth, { width: 5, height: 5 }, 1)
      cv.threshold(smooth, mask, n('threshold'), 255, cv.THRESH_BINARY)
      e.stage('Threshold mask', mask, 'Bright foreground after smoothing and thresholding.')
      const clean = cleaned(e, mask, cv.MORPH_OPEN)
      e.stage('Opened mask', clean, 'Opening removes specks smaller than the structuring element.')
      components(e, clean, bgr)
      break
    }
    case 'segment-touching': {
      const mask = e.mask(),
        distance = e.mat(),
        sure = e.mat(),
        dilated = e.mat(),
        peaks = e.mat(),
        markers = e.mat()
      e.stage('Foreground mask', mask, 'The white foreground contains the objects to separate.')
      cv.distanceTransform(mask, distance, cv.DIST_L2, 5)
      e.stage('Interior distance', distance, 'Distance in pixels to the mask boundary.')
      cv.threshold(distance, sure, cv.minMaxLoc(distance).maxVal * n('seed'), 255, cv.THRESH_BINARY)
      sure.convertTo(sure, cv.CV_8U)
      const size = 2 * n('radius') + 1,
        neighborhood = e.own(cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: size, height: size }))
      cv.dilate(distance, dilated, neighborhood)
      cv.compare(distance, dilated, peaks, cv.CMP_GE)
      cv.bitwise_and(peaks, sure, sure)
      e.stage(
        'Foreground seeds',
        sure,
        'Local distance maxima above the minimum peak height initialize separate watershed labels.'
      )
      const count = cv.connectedComponents(sure, markers),
        seedLabels = Int32Array.from(markers.data32S),
        locations = Array.from({ length: count }, () => ({ x: 0, y: 0, count: 0 })),
        seedPreview = e.mat()
      for (let i = 0; i < seedLabels.length; i++) {
        const label = seedLabels[i]
        if (!label) continue
        locations[label].x += i % gray.cols
        locations[label].y += Math.floor(i / gray.cols)
        locations[label].count++
      }
      bgr.convertTo(seedPreview, -1, 0.4)
      locations.slice(1).forEach((point, index) => {
        const centre = { x: Math.round(point.x / point.count), y: Math.round(point.y / point.count) }
        cv.circle(seedPreview, centre, 6, orange, 2)
        cv.putText(
          seedPreview,
          String(index + 1),
          { x: centre.x + 9, y: centre.y + 4 },
          cv.FONT_HERSHEY_SIMPLEX,
          0.45,
          mint,
          1
        )
      })
      e.stage(
        'Labelled seed locations',
        seedPreview,
        `${count - 1} connected seed regions. Enlarged circles and numbers show their locations on a dimmed source; these annotations do not enlarge the actual watershed seeds.`,
        { values: Float32Array.from(seedLabels), channels: 1, labels: ['seed ID; 0 means no seed'] }
      )
      const labels = markers.data32S,
        binary = mask.data
      for (let i = 0; i < labels.length; i++) labels[i] = binary[i] === 0 ? 1 : labels[i] ? labels[i] + 1 : 0
      cv.watershed(bgr, markers)
      bgr.copyTo(out)
      e.raw(markers, ['watershed label'])
      const values = markers.data32S,
        pixels = out.data
      for (let i = 0; i < values.length; i++)
        if (values[i] === -1) {
          pixels[i * 3] = 80
          pixels[i * 3 + 1] = 90
          pixels[i * 3 + 2] = 255
        }
      e.note = `${count - 1} foreground seeds. Red boundaries separate watershed regions; label -1 marks a boundary.`
      break
    }
    case 'measure-shapes':
    case 'crop-object': {
      const mask = id === 'crop-object' ? cleaned(e, e.mask(), cv.MORPH_CLOSE) : e.mask(),
        contours = e.own(new cv.MatVector()),
        hierarchy = e.mat()
      e.stage('Foreground mask', mask, 'Foreground pixels used for external contour extraction.')
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      bgr.copyTo(out)
      let largest = 0,
        largestIndex = -1
      const measured: string[] = []
      const outlines = e.own(bgr.mat_clone())
      for (let i = 0; i < contours.size(); i++) {
        const contour = e.own(contours.get(i)),
          area = cv.contourArea(contour)
        if (area > largest) {
          largest = area
          largestIndex = i
        }
        if (id === 'measure-shapes' && area >= n('area')) {
          const perimeter = cv.arcLength(contour, true),
            polygon = e.mat(),
            vector = e.own(new cv.MatVector())
          cv.approxPolyDP(contour, polygon, (perimeter * n('epsilon')) / 100, true)
          vector.push_back(polygon)
          cv.drawContours(out, vector, 0, mint, 2)
          cv.drawContours(outlines, vector, 0, mint, 2)
          const m = cv.moments(contour),
            cx = m.m10 / m.m00,
            cy = m.m01 / m.m00
          cv.circle(out, { x: Math.round(cx), y: Math.round(cy) }, 3, orange, -1)
          measured.push(
            `Area ${area.toFixed(1)} px², perimeter ${perimeter.toFixed(1)} px, circularity ${((4 * Math.PI * area) / (perimeter * perimeter)).toFixed(3)}, centroid (${cx.toFixed(1)}, ${cy.toFixed(1)})`
          )
        }
      }
      if (id === 'measure-shapes') {
        e.stage(
          'Simplified contours',
          outlines,
          'Green polygons approximate the retained external outlines. The next step measures the original contours and marks their centroids.'
        )
        e.note = `${measured.length} shapes.\n${measured.slice(0, 20).join('\n')}`
      } else {
        if (largestIndex < 0) throw new Error('No foreground object was found at this threshold.')
        const contour = e.own(contours.get(largestIndex)),
          r = cv.boundingRect(contour),
          padding = n('padding'),
          x = Math.max(0, r.x - padding),
          y = Math.max(0, r.y - padding),
          width = Math.min(gray.cols, r.x + r.width + padding) - x,
          height = Math.min(gray.rows, r.y + r.height + padding) - y
        cv.rectangle(out, { x, y }, { x: x + width - 1, y: y + height - 1 }, mint, 2)
        e.stage('Selected bounds', out, 'Bounding rectangle of the largest external contour plus padding.')
        e.own(bgr.roi({ x, y, width, height })).copyTo(out)
        e.note = `Crop (${x}, ${y}), ${width} × ${height}; contour area ${largest.toFixed(1)} px².`
      }
      break
    }
    case 'colour-mask': {
      if (n('hueMin') > n('hueMax')) throw new Error('Minimum hue must not exceed maximum hue.')
      const hsv = e.mat(),
        mask = e.mat()
      cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV)
      const hue = e.mat(),
        saturation = e.mat()
      cv.extractChannel(hsv, hue, 0)
      cv.extractChannel(hsv, saturation, 1)
      e.stage(
        'Hue channel',
        hue,
        'Grayscale displays the numeric hue code, 0 to 179. Brightness here represents hue, not scene brightness; low-saturation pixels have unreliable hue.'
      )
      e.stage(
        'Saturation channel',
        saturation,
        'Bright pixels have stronger colour saturation. The saturation floor prevents gray pixels from entering the hue selection.'
      )
      const low = e.own(new cv.Mat(gray.rows, gray.cols, cv.CV_8UC3, [n('hueMin'), n('saturation'), 0, 0])),
        high = e.own(new cv.Mat(gray.rows, gray.cols, cv.CV_8UC3, [n('hueMax'), 255, 255, 0]))
      cv.inRange(hsv, low, high, mask)
      e.stage('HSV selection', mask, 'White pixels satisfy the hue, saturation and brightness interval.')
      const clean = cleaned(e, mask, cv.MORPH_CLOSE)
      e.stage('Closed selection', clean, 'Closing fills small holes in the colour selection.')
      components(e, clean, bgr)
      break
    }
    case 'remove-background':
    case 'blur-background': {
      const mask = foreground(e),
        alpha = e.mat()
      e.stage('GrabCut foreground', mask, 'Definite and probable foreground become white.')
      const radius = id === 'blur-background' ? 2 : n('feather')
      if (radius) cv.GaussianBlur(mask, alpha, { width: radius * 2 + 1, height: radius * 2 + 1 }, 0)
      else mask.copyTo(alpha)
      e.stage(
        'Soft mask',
        alpha,
        'This feathered boundary controls compositing; it does not recover mixed foreground colours.'
      )
      if (id === 'remove-background') {
        cv.cvtColor(bgr, out, cv.COLOR_BGR2RGBA)
        const values = alpha.data,
          pixels = out.data
        for (let i = 0; i < values.length; i++) pixels[i * 4 + 3] = values[i]
        e.note = 'RGBA cutout. Save PNG preserves the alpha channel.'
      } else {
        const blurred = e.mat()
        cv.GaussianBlur(bgr, blurred, { width: 0, height: 0 }, n('sigma'))
        e.stage('Blurred background', blurred, 'A smoothed layer is used only outside the foreground mask.')
        bgr.copyTo(out)
        const a = alpha.data,
          fg = bgr.data,
          bg = blurred.data,
          pixels = out.data
        for (let i = 0; i < a.length; i++)
          for (let c = 0; c < 3; c++)
            pixels[i * 3 + c] = Math.round((fg[i * 3 + c] * a[i]) / 255 + bg[i * 3 + c] * (1 - a[i] / 255))
        e.note = 'Foreground is blended over the blurred background using the soft mask.'
      }
      break
    }
    case 'blur-region': {
      const mask = regionMask(e),
        blurred = e.mat()
      e.stage('Selected mask', mask, 'Only this rectangle will receive blurred pixels.')
      cv.GaussianBlur(bgr, blurred, { width: 0, height: 0 }, n('sigma'))
      e.stage('Blurred layer', blurred, 'The smoothed replacement image.')
      bgr.copyTo(out)
      blurred.copyTo(out, mask)
      e.note = 'Pixels outside the selected region are unchanged.'
      break
    }
    case 'denoise-detail': {
      const denoised = e.mat(),
        lab = e.mat(),
        l = e.mat(),
        enhanced = e.mat()
      cv.fastNlMeansDenoisingColored(bgr, denoised, n('strength'), n('strength'), 7, 21)
      e.stage('Denoised colour', denoised, 'Nonlocal means reduces small colour fluctuations.')
      cv.cvtColor(denoised, lab, cv.COLOR_BGR2Lab)
      cv.extractChannel(lab, l, 0)
      e.stage('Lab lightness', l, 'Contrast is adjusted in lightness while colour channels are retained.')
      e.own(cv.createCLAHE(n('clip'), { width: 8, height: 8 })).apply(l, enhanced)
      cv.insertChannel(enhanced, lab, 0)
      cv.cvtColor(lab, out, cv.COLOR_Lab2BGR)
      break
    }
    case 'sharpen-details': {
      const blurred = e.mat(),
        detail = e.mat(),
        a = e.mat(),
        b = e.mat()
      cv.GaussianBlur(bgr, blurred, { width: 0, height: 0 }, n('sigma'))
      e.stage('Smooth image', blurred, 'The low-frequency layer used by the unsharp mask.')
      bgr.convertTo(a, cv.CV_32F)
      blurred.convertTo(b, cv.CV_32F)
      cv.subtract(a, b, detail)
      e.stage(
        'Signed detail',
        detail,
        'Original minus smooth image, normalized for display; inspect signed native values.'
      )
      cv.addWeighted(bgr, 1 + n('amount'), blurred, -n('amount'), 0, out)
      break
    }
    case 'focus-map': {
      const derivative = e.mat(),
        energy = e.mat(),
        average = e.mat()
      cv.Laplacian(gray, derivative, cv.CV_32F, 3)
      e.stage('Signed Laplacian', derivative, 'Second derivatives emphasize high-frequency structure.')
      cv.multiply(derivative, derivative, energy)
      cv.blur(energy, average, { width: n('window'), height: n('window') })
      e.stage(
        'Local energy',
        average,
        'Mean squared Laplacian response in each window, normalized here for display. The final preview uses this same image; numeric energy remains available in the lab inspector.'
      )
      e.field(average, ['Laplacian energy'])
      e.note = `Mean local energy ${cv.mean(average)[0].toFixed(3)} intensity². Texture and noise also increase this value.`
      break
    }
    case 'clean-document': {
      const light = e.mat(),
        a = e.mat(),
        b = e.mat(),
        normalized = e.mat()
      cv.GaussianBlur(gray, light, { width: 0, height: 0 }, n('sigma'))
      e.stage('Illumination estimate', light, 'A broad blur approximates slowly varying page illumination.')
      gray.convertTo(a, cv.CV_32F)
      light.convertTo(b, cv.CV_32F)
      const values = b.data32F
      for (let i = 0; i < values.length; i++) values[i] = Math.max(1, values[i])
      cv.divide(a, b, normalized, 220)
      normalized.convertTo(normalized, cv.CV_8U)
      e.stage(
        'Normalized page',
        normalized,
        'Dividing by the illumination estimate reduces broad brightness variations.'
      )
      cv.adaptiveThreshold(
        normalized,
        out,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        n('block'),
        n('offset')
      )
      break
    }
    case 'deskew-text': {
      const edges = e.mat(),
        lines = e.mat()
      cv.Canny(gray, edges, 50, 150)
      e.stage('Page edges', edges, 'Edges used to estimate the dominant line orientation.')
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 25, n('length'), 15)
      const data = Array.from(lines.data32S),
        angles: number[] = [],
        preview = e.own(bgr.mat_clone())
      for (let i = 0; i < data.length; i += 4) {
        let angle = (Math.atan2(data[i + 3] - data[i + 1], data[i + 2] - data[i]) * 180) / Math.PI
        while (angle > 90) angle -= 180
        while (angle < -90) angle += 180
        if (Math.abs(angle) <= n('angle')) {
          angles.push(angle)
          cv.line(preview, { x: data[i], y: data[i + 1] }, { x: data[i + 2], y: data[i + 3] }, mint, 2)
        }
      }
      if (!angles.length)
        throw new Error('No near-horizontal lines were found. Reduce minimum line length or try a clearer page.')
      angles.sort((a, b) => a - b)
      const angle = angles[Math.floor(angles.length / 2)]
      e.stage('Accepted lines', preview, 'The median angle of these lines determines the correction.')
      const matrix = e.own(cv.getRotationMatrix2D({ x: gray.cols / 2, y: gray.rows / 2 }, angle, 1))
      cv.warpAffine(bgr, out, matrix, e.size(), cv.INTER_CUBIC, cv.BORDER_CONSTANT, [255, 255, 255, 255])
      e.note = `Corrected ${angle.toFixed(3)}° using ${angles.length} line segments.`
      break
    }
    case 'scan-document': {
      const smooth = e.mat(),
        edges = e.mat(),
        contours = e.own(new cv.MatVector()),
        hierarchy = e.mat()
      cv.GaussianBlur(gray, smooth, { width: 5, height: 5 }, 1)
      cv.Canny(smooth, edges, n('low'), n('low') * 3)
      e.stage('Page edges', edges, 'Candidate page boundaries after smoothing and edge detection.')
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
      let corners: { x: number; y: number }[] = [],
        largest = 0
      for (let i = 0; i < contours.size(); i++) {
        const contour = e.own(contours.get(i)),
          polygon = e.mat()
        cv.approxPolyDP(contour, polygon, 0.02 * cv.arcLength(contour, true), true)
        const area = Math.abs(cv.contourArea(polygon))
        if (
          polygon.rows === 4 &&
          cv.isContourConvex(polygon) &&
          area > largest &&
          area > gray.cols * gray.rows * 0.05
        ) {
          largest = area
          const values = Array.from(polygon.data32S)
          corners = Array.from({ length: 4 }, (_, j) => ({ x: values[j * 2], y: values[j * 2 + 1] }))
        }
      }
      if (!corners.length)
        throw new Error(
          'No large four-sided page boundary was found. Include the whole page against a contrasting background.'
        )
      const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4,
        cy = corners.reduce((sum, p) => sum + p.y, 0) / 4
      corners.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
      const start = corners.reduce((best, p, i) => (p.x + p.y < corners[best].x + corners[best].y ? i : best), 0)
      corners = [...corners.slice(start), ...corners.slice(0, start)]
      const preview = e.own(bgr.mat_clone())
      for (let i = 0; i < 4; i++) cv.line(preview, corners[i], corners[(i + 1) % 4], mint, 3)
      e.stage('Selected page', preview, 'The largest convex quadrilateral is ordered around its centre.')
      const distance = (a: number, b: number) => Math.hypot(corners[a].x - corners[b].x, corners[a].y - corners[b].y),
        width = Math.max(32, Math.round(Math.max(distance(0, 1), distance(2, 3)))),
        height = Math.max(32, Math.round(Math.max(distance(0, 3), distance(1, 2)))),
        from = e.array(
          4,
          1,
          cv.CV_32FC2,
          corners.flatMap((p) => [p.x, p.y])
        ),
        to = e.array(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]),
        matrix = e.own(cv.getPerspectiveTransform(from, to)),
        flat = e.mat()
      cv.warpPerspective(gray, flat, matrix, { width, height })
      e.stage('Flattened page', flat, 'Perspective-corrected grayscale page before binarization.')
      cv.adaptiveThreshold(flat, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, n('offset'))
      e.note = `Page area ${largest.toFixed(0)} px²; rectified size ${width} × ${height}.`
      break
    }
    case 'stereo-depth': {
      if (gray.cols <= n('disparities') + 9)
        throw new Error('Image width must exceed the disparity search range plus 9 pixels.')
      const raw = e.mat(),
        disparity = e.mat(),
        matcher = e.own(cv.StereoSGBM.create(0, n('disparities'), 9, 8 * 81, 32 * 81))
      const pair = pairPreview(e, gray, e.second(true))
      e.stage(
        'Rectified grayscale pair',
        pair,
        'Left and right grayscale views must already have corresponding points on the same rows. This recipe assumes rectification; it does not calibrate cameras.'
      )
      matcher.compute(gray, e.second(true), raw)
      raw.convertTo(disparity, cv.CV_32F, 1 / 16)
      e.stage(
        'Disparity',
        disparity,
        'Positive disparity is horizontal displacement in pixels. Negative values are invalid.'
      )
      const values = Float32Array.from(disparity.data32F, (d) => (d > 0 ? (n('focal') * n('baseline')) / d : 0)),
        depth = e.array(gray.rows, gray.cols, cv.CV_32F, values)
      e.stage(
        'Valid disparities',
        e.array(
          gray.rows,
          gray.cols,
          cv.CV_8U,
          Uint8Array.from(values, (d) => (d > 0 ? 255 : 0))
        ),
        'White marks positive disparities eligible for depth conversion. Black is invalid or nonpositive, not a measured zero distance.'
      )
      e.field(depth, ['depth (m; 0 invalid)'])
      e.note = `${values.filter((value) => value > 0).length} positive-depth samples. Calibration assumptions determine the units and accuracy.`
      break
    }
    case 'colour-palette': {
      const smooth = e.mat()
      cv.bilateralFilter(bgr, smooth, 7, n('colour'), 5)
      e.stage('Smoothed colours', smooth, 'Bilateral filtering reduces within-region variation before clustering.')
      const samples = e.array(gray.rows * gray.cols, 3, cv.CV_32F, Float32Array.from(smooth.data)),
        labels = e.mat(),
        centres = e.mat()
      cv.kmeans(
        samples,
        n('clusters'),
        labels,
        { type: cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, maxCount: 20, epsilon: 0.5 },
        1,
        cv.KMEANS_PP_CENTERS,
        centres
      )
      const palettePreview = e.own(new cv.Mat(64, n('clusters') * 64, cv.CV_8UC3))
      const centreValues = Array.from(centres.data32F)
      for (let i = 0; i < n('clusters'); i++)
        cv.rectangle(
          palettePreview,
          { x: i * 64, y: 0 },
          { x: (i + 1) * 64 - 1, y: 63 },
          [centreValues[i * 3], centreValues[i * 3 + 1], centreValues[i * 3 + 2], 255],
          -1
        )
      e.stage(
        'Learned palette',
        palettePreview,
        'Each swatch is one learned BGR cluster centre. Cluster IDs assign every image pixel to one of these colours.'
      )
      out.create(gray.rows, gray.cols, cv.CV_8UC3)
      const ids = labels.data32S,
        palette = centres.data32F,
        pixels = out.data
      for (let i = 0; i < ids.length; i++)
        for (let c = 0; c < 3; c++) pixels[i * 3 + c] = Math.round(palette[ids[i] * 3 + c])
      e.raw(e.array(gray.rows, gray.cols, cv.CV_32S, Int32Array.from(labels.data32S)), ['palette ID'])
      e.note = `Reduced to ${n('clusters')} learned BGR colours.`
      break
    }
    default:
      return false
  }
  return true
}
