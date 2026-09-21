import { mint, type Experiment } from './context'
/** Segment regions, extract features and render overlays using the actual native results. */
export const regions = (e: Experiment): boolean => {
  const { cv, bgr, gray, out } = e,
    id = e.request.algorithm,
    n = (key: string) => e.n(key),
    s = (key: string) => e.s(key)
  if (['contours', 'polygon-approximation', 'convex-hull', 'moments'].includes(id)) {
    const contours = e.own(new cv.MatVector()),
      hierarchy = e.mat()
    cv.findContours(
      e.mask(),
      contours,
      hierarchy,
      id === 'contours' && s('retrieval') === 'tree'
        ? cv.RETR_TREE
        : id === 'contours' && s('retrieval') === 'list'
          ? cv.RETR_LIST
          : cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    )
    bgr.copyTo(out)
    let count = 0,
      largestArea = 0,
      huValues: number[] = []
    for (let i = 0; i < contours.size(); i++) {
      const contour = e.own(contours.get(i)),
        area = Math.abs(cv.contourArea(contour))
      if ((id === 'convex-hull' || id === 'moments') && area < n('area')) continue
      count++
      if (id === 'contours') cv.drawContours(out, contours, i, mint, 2)
      else if (id === 'moments') {
        const moments = cv.moments(contour)
        if (moments.m00) {
          const x = moments.m10 / moments.m00,
            y = moments.m01 / moments.m00
          cv.circle(out, { x: Math.round(x), y: Math.round(y) }, 4, mint, -1)
          if (area > largestArea) {
            largestArea = area
            const hu = e.mat()
            cv.HuMoments(moments, hu)
            huValues = Array.from(hu.data64F)
          }
        }
      } else {
        const polygon = e.mat(),
          list = e.own(new cv.MatVector())
        if (id === 'polygon-approximation')
          cv.approxPolyDP(contour, polygon, (cv.arcLength(contour, true) * n('epsilon')) / 100, true)
        else cv.convexHull(contour, polygon)
        list.push_back(polygon)
        cv.drawContours(out, list, 0, mint, 2)
      }
    }
    e.note = `${count} contours.${huValues.length ? ` Largest area: ${largestArea.toFixed(1)} px². Hu: ${huValues.map((x) => x.toExponential(3)).join(', ')}.` : ''}`
    return true
  }
  switch (id) {
    case 'connected-components': {
      const labels = e.mat(),
        count = cv.connectedComponents(e.mask(), labels, Number(s('connectivity')), cv.CV_32S)
      e.raw(labels, ['region ID'])
      out.create(gray.rows, gray.cols, cv.CV_8UC3)
      const data = labels.data32S,
        pixels = out.data
      for (let i = 0; i < data.length; i++) {
        const label = data[i]
        pixels[i * 3] = label ? ((label * 67) % 210) + 45 : 0
        pixels[i * 3 + 1] = label ? ((label * 131) % 210) + 45 : 0
        pixels[i * 3 + 2] = label ? ((label * 193) % 210) + 45 : 0
      }
      e.note = `${count - 1} foreground regions; label 0 is background.`
      break
    }
    case 'watershed': {
      const mask = e.mask(),
        distance = e.mat(),
        sure = e.mat(),
        markers = e.mat()
      cv.distanceTransform(mask, distance, cv.DIST_L2, 5)
      const max = cv.minMaxLoc(distance).maxVal
      cv.threshold(distance, sure, max * n('seed'), 255, cv.THRESH_BINARY)
      sure.convertTo(sure, cv.CV_8U)
      const count = cv.connectedComponents(sure, markers)
      const labels = markers.data32S,
        binary = mask.data
      for (let i = 0; i < labels.length; i++) labels[i] = binary[i] === 0 ? 1 : labels[i] ? labels[i] + 1 : 0
      cv.watershed(bgr, markers)
      bgr.copyTo(out)
      e.raw(markers, ['watershed label'])
      const marked = markers.data32S,
        pixels = out.data
      for (let i = 0; i < marked.length; i++)
        if (marked[i] === -1) {
          pixels[i * 3] = 80
          pixels[i * 3 + 1] = 90
          pixels[i * 3 + 2] = 255
        }
      e.note = `${count - 1} foreground seeds. Label -1 marks a watershed boundary.`
      break
    }
    case 'grabcut': {
      const mask = e.mat(),
        bg = e.mat(),
        fg = e.mat()
      cv.grabCut(bgr, mask, e.rect(), bg, fg, n('iterations'), cv.GC_INIT_WITH_RECT)
      bgr.copyTo(out)
      e.raw(mask, ['GrabCut class'])
      const labels = mask.data,
        pixels = out.data
      for (let i = 0; i < labels.length; i++)
        if (labels[i] !== cv.GC_FGD && labels[i] !== cv.GC_PR_FGD) {
          pixels[i * 3] = Math.round(pixels[i * 3] * 0.15)
          pixels[i * 3 + 1] = Math.round(pixels[i * 3 + 1] * 0.15)
          pixels[i * 3 + 2] = Math.round(pixels[i * 3 + 2] * 0.15)
        }
      e.note =
        'Background is dimmed. Native classes: 0 background, 1 foreground, 2 probable background, 3 probable foreground.'
      break
    }
    case 'orb':
    case 'sift':
    case 'akaze':
    case 'brisk':
    case 'fast': {
      const detector = e.own(
        id === 'orb'
          ? cv.ORB.create(n('features'), 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, n('threshold'))
          : id === 'sift'
            ? cv.SIFT.create(n('features'), 3, n('contrast'))
            : id === 'akaze'
              ? cv.xfeatures2d.AKAZE.create(cv.xfeatures2d.AKAZE_DESCRIPTOR_MLDB, 0, 3, n('threshold'))
              : id === 'brisk'
                ? cv.xfeatures2d.BRISK.create(n('threshold'), n('octaves'))
                : cv.FastFeatureDetector.create(n('threshold'), s('nonmax') === 'on')
      )
      const points = e.own(new cv.KeyPointVector())
      detector.detect(gray, points)
      cv.drawKeypoints(bgr, points, out, mint, cv.DrawMatchesFlags_DRAW_RICH_KEYPOINTS)
      e.note = `${points.size()} keypoints.`
      break
    }
    case 'good-features': {
      const points = e.mat(),
        mask = e.mat()
      cv.goodFeaturesToTrack(
        gray,
        points,
        n('features'),
        n('quality'),
        n('distance'),
        mask,
        3,
        s('method') === 'harris',
        0.04
      )
      bgr.copyTo(out)
      const data = Array.from(points.data32F)
      for (let i = 0; i < data.length; i += 2)
        cv.circle(out, { x: Math.round(data[i]), y: Math.round(data[i + 1]) }, 3, mint, 1)
      e.note = `${data.length / 2} corners.`
      break
    }
    case 'mser': {
      const detector = e.own(cv.MSER.create(n('delta'), n('area'), Math.round(gray.rows * gray.cols * 0.25))),
        regions = e.own(new cv.PointVectorVector()),
        boxes = e.own(new cv.RectVector())
      detector.detectRegions(gray, regions, boxes)
      bgr.copyTo(out)
      for (let i = 0; i < boxes.size(); i++) {
        const r = boxes.get(i)!
        cv.rectangle(out, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, mint, 1)
      }
      e.note = `${boxes.size()} stable regions.`
      break
    }
    case 'hough-lines': {
      const edges = e.mat(),
        lines = e.mat()
      cv.Canny(gray, edges, 50, 150)
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, n('votes'), n('length'), n('gap'))
      bgr.copyTo(out)
      const data = Array.from(lines.data32S)
      for (let i = 0; i < data.length; i += 4)
        cv.line(out, { x: data[i], y: data[i + 1] }, { x: data[i + 2], y: data[i + 3] }, mint, 2)
      e.note = `${data.length / 4} line segments.`
      break
    }
    case 'hough-circles': {
      const smooth = e.mat(),
        circles = e.mat()
      cv.GaussianBlur(gray, smooth, { width: 5, height: 5 }, 1.5)
      cv.HoughCircles(smooth, circles, cv.HOUGH_GRADIENT, 1, n('distance'), 100, n('votes'), 0, n('radius'))
      bgr.copyTo(out)
      const data = Array.from(circles.data32F)
      for (let i = 0; i < data.length; i += 3)
        cv.circle(out, { x: Math.round(data[i]), y: Math.round(data[i + 1]) }, Math.round(data[i + 2]), mint, 2)
      e.note = `${data.length / 3} circles.`
      break
    }
    case 'superpixels': {
      const lab = e.mat(),
        mask = e.mat(),
        labels = e.mat()
      cv.cvtColor(bgr, lab, cv.COLOR_BGR2Lab)
      const slic = e.own(cv.ximgproc.createSuperpixelSLIC(lab, cv.ximgproc.SLIC, n('size'), n('ruler')))
      slic.iterate(n('iterations'))
      slic.getLabelContourMask(mask)
      slic.getLabels(labels)
      bgr.copyTo(out)
      out.setTo(mint, mask)
      e.raw(labels, ['superpixel ID'])
      e.note = `${slic.getNumberOfSuperpixels()} superpixels.`
      break
    }
    case 'aruco': {
      const dict = e.own(
          cv.aruco.getPredefinedDictionary(
            s('dictionary') === '4x4-50'
              ? cv.aruco.DICT_4X4_50
              : s('dictionary') === '5x5-100'
                ? cv.aruco.DICT_5X5_100
                : cv.aruco.DICT_6X6_250
          )
        ),
        detector = e.own(new cv.aruco.ArucoDetector(dict)),
        corners = e.own(new cv.MatVector()),
        ids = e.mat()
      detector.detectMarkers(gray, corners, ids)
      bgr.copyTo(out)
      if (!ids.empty()) cv.aruco.drawDetectedMarkers(out, corners, ids, mint)
      e.note = ids.empty()
        ? 'No markers found in this dictionary.'
        : `Marker IDs: ${Array.from(ids.data32S).join(', ')}.`
      break
    }
    case 'qr-code': {
      const detector = e.own(new cv.QRCodeDetector()),
        points = e.mat()
      detector.setEpsX(n('epsilon'))
      const decoded = detector.detectAndDecode(gray, points)
      bgr.copyTo(out)
      if (!points.empty()) {
        const data = Array.from(points.data32F)
        for (let i = 0; i < 4; i++)
          cv.line(
            out,
            { x: Math.round(data[2 * i]), y: Math.round(data[2 * i + 1]) },
            { x: Math.round(data[2 * ((i + 1) % 4)]), y: Math.round(data[2 * ((i + 1) % 4) + 1]) },
            mint,
            2
          )
      }
      e.note = decoded ? `Decoded text: ${decoded}` : 'No readable QR code found.'
      break
    }
    case 'alpha-matting': {
      const trimap = e.own(new cv.Mat(gray.rows, gray.cols, cv.CV_8U, [0, 0, 0, 0])),
        r = e.rect(),
        band = n('band')
      cv.rectangle(
        trimap,
        { x: Math.max(0, r.x - band), y: Math.max(0, r.y - band) },
        { x: Math.min(gray.cols - 1, r.x + r.width + band), y: Math.min(gray.rows - 1, r.y + r.height + band) },
        [128, 0, 0, 0],
        -1
      )
      cv.rectangle(trimap, { x: r.x, y: r.y }, { x: r.x + r.width - 1, y: r.y + r.height - 1 }, [255, 0, 0, 0], -1)
      cv.alphamat.infoFlow(bgr, trimap, out)
      e.raw(out, ['alpha (0..255)'])
      break
    }
    default:
      return false
  }
  return true
}
