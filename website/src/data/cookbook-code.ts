/** Typechecked core chains. The recipe pages define the cv, image, nextImage and rect inputs used here. */
export const cookbookCode: Record<string, string> = {
  'motion-vectors': `using beforeGray = new cv.Mat(), afterGray = new cv.Mat()
cv.cvtColor(image, beforeGray, cv.COLOR_BGR2GRAY)
cv.cvtColor(nextImage, afterGray, cv.COLOR_BGR2GRAY)
using a = new cv.Mat(), b = new cv.Mat(), hann = new cv.Mat()
beforeGray.convertTo(a, cv.CV_32F)
afterGray.convertTo(b, cv.CV_32F)
cv.createHanningWindow(hann, { width: image.cols, height: image.rows }, cv.CV_32F)
const pan = cv.phaseCorrelate(a, b, hann)
const usable = Number.isFinite(pan.value.x) && Number.isFinite(pan.value.y) && pan.response >= 0.1
  && Math.abs(pan.value.x) < image.cols * 0.45 && Math.abs(pan.value.y) < image.rows * 0.45
const dx = usable ? pan.value.x : 0, dy = usable ? pan.value.y : 0
using toFirst = new cv.Mat(2, 3, cv.CV_64F), toSecond = new cv.Mat(2, 3, cv.CV_64F)
toFirst.data64F.set([1, 0, -dx, 0, 1, -dy])
toSecond.data64F.set([1, 0, dx, 0, 1, dy])
using alignedAfter = new cv.Mat(), alignedBefore = new cv.Mat()
const size = { width: image.cols, height: image.rows }
cv.warpAffine(afterGray, alignedAfter, toFirst, size, cv.INTER_LINEAR, cv.BORDER_REFLECT_101)
cv.warpAffine(beforeGray, alignedBefore, toSecond, size, cv.INTER_LINEAR, cv.BORDER_REFLECT_101)
using forward = new cv.Mat(), backward = new cv.Mat()
cv.calcOpticalFlowFarneback(beforeGray, alignedAfter, forward, 0.5, 4, 25, 5, 7, 1.5, 0)
cv.calcOpticalFlowFarneback(afterGray, alignedBefore, backward, 0.5, 4, 25, 5, 7, 1.5, 0)
const f = Float32Array.from(forward.data32F), r = Float32Array.from(backward.data32F)
for (let i = 0; i < f.length; i += 2) {
  f[i] += dx; f[i + 1] += dy
  r[i] -= dx; r[i + 1] -= dy
}
forward.data32F.set(f)
backward.data32F.set(r)
using texture = new cv.Mat()
cv.cornerMinEigenVal(beforeGray, texture, 7, 3)
// forward.data32F[(y * image.cols + x) * 2 + 0] is dx, +1 is dy.
// A point (x,y) in image should land at (x+dx,y+dy) in nextImage.
// The full recipe bilinearly samples backward flow at that destination,
// rejects weak texture and inconsistent returns, and takes per-cell medians.
// Never report a textureless cell as a known zero-displacement measurement.
`,
  'track-region': `using beforeGray = new cv.Mat(), afterGray = new cv.Mat()
cv.cvtColor(image, beforeGray, cv.COLOR_BGR2GRAY)
cv.cvtColor(nextImage, afterGray, cv.COLOR_BGR2GRAY)
using mask = cv.Mat.zeros(image.rows, image.cols, cv.CV_8U)
cv.rectangle(mask, { x: rect.x, y: rect.y },
  { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }, [255, 0, 0, 0], -1)
using points = new cv.Mat(), tracked = new cv.Mat()
using status = new cv.Mat(), error = new cv.Mat()
cv.goodFeaturesToTrack(beforeGray, points, 150, 0.01, 5, mask)
if (points.rows < 4) throw new Error('Select a textured region with at least four corners')
cv.calcOpticalFlowPyrLK(beforeGray, afterGray, points, tracked, status, error)
using returned = new cv.Mat(), backwardStatus = new cv.Mat(), backwardError = new cv.Mat()
cv.calcOpticalFlowPyrLK(afterGray, beforeGray, tracked, returned, backwardStatus, backwardError)
const from: number[] = [], to: number[] = []
for (let i = 0; i < points.rows; i++) {
  const x = points.data32F[i * 2], y = points.data32F[i * 2 + 1]
  const backwardDistance = Math.hypot(x - returned.data32F[i * 2], y - returned.data32F[i * 2 + 1])
  if (status.data[i] && backwardStatus.data[i] && backwardDistance <= 1.5) {
    from.push(x, y)
    to.push(tracked.data32F[i * 2], tracked.data32F[i * 2 + 1])
  }
}
if (from.length < 8) throw new Error('Too few consistent tracks')
using sourcePoints = new cv.Mat(from.length / 2, 1, cv.CV_32FC2)
using targetPoints = new cv.Mat(to.length / 2, 1, cv.CV_32FC2), inliers = new cv.Mat()
sourcePoints.data32F.set(from)
targetPoints.data32F.set(to)
using transform = cv.estimateAffinePartial2D(sourcePoints, targetPoints, inliers, cv.RANSAC, 3)
if (transform.empty() || cv.countNonZero(inliers) < 3) throw new Error('No stable region transform')
const m = Array.from(transform.data64F)
const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
  [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
  .map(([x, y]) => ({ x: Math.round(m[0] * x + m[1] * y + m[2]), y: Math.round(m[3] * x + m[4] * y + m[5]) }))
using output = nextImage.clone()
for (let i = 0; i < 4; i++) cv.line(output, corners[i], corners[(i + 1) % 4], [178, 216, 85, 255], 3)
`,
  'locate-template': `using beforeGray = new cv.Mat(), afterGray = new cv.Mat()
cv.cvtColor(image, beforeGray, cv.COLOR_BGR2GRAY)
cv.cvtColor(nextImage, afterGray, cv.COLOR_BGR2GRAY)
using template = beforeGray.roi(rect), scores = new cv.Mat()
using mean = new cv.Mat(), deviation = new cv.Mat()
cv.meanStdDev(template, mean, deviation)
if (deviation.data64F[0] < 1) throw new Error('Select a textured patch')
cv.matchTemplate(afterGray, template, scores, cv.TM_CCOEFF_NORMED)
const { maxLoc, maxVal } = cv.minMaxLoc(scores)
if (maxVal >= 0.6) {
  console.log('Template top-left:', maxLoc, 'score:', maxVal)
}
`,
  'align-images': `using orb = cv.ORB.create(800), matcher = new cv.BFMatcher(cv.NORM_HAMMING, true)
if (!orb) throw new Error('ORB factory failed')
using first = new cv.KeyPointVector(), second = new cv.KeyPointVector()
using a = new cv.Mat(), b = new cv.Mat(), mask = new cv.Mat()
orb.detectAndCompute(image, mask, first, a)
orb.detectAndCompute(nextImage, mask, second, b)
if (a.empty() || b.empty()) throw new Error('Both images need features')
using matches = new cv.DMatchVector()
matcher.match(a, b, matches)
const ordered = Array.from({ length: matches.size() }, (_, i) => matches.get(i)!)
  .sort((a, b) => a.distance - b.distance).slice(0, 200)
if (ordered.length < 4) throw new Error('Fewer than four matches')
const from = ordered.flatMap(m => { const p = first.get(m.queryIdx)!.pt; return [p.x, p.y] })
const to = ordered.flatMap(m => { const p = second.get(m.trainIdx)!.pt; return [p.x, p.y] })
using sourcePoints = new cv.Mat(ordered.length, 1, cv.CV_32FC2)
using targetPoints = new cv.Mat(ordered.length, 1, cv.CV_32FC2), inliers = new cv.Mat()
sourcePoints.data32F.set(from)
targetPoints.data32F.set(to)
using homography = cv.findHomography(sourcePoints, targetPoints, cv.RANSAC, 3, inliers)
if (homography.empty() || cv.countNonZero(inliers) < 4) throw new Error('No stable homography')
using output = new cv.Mat()
cv.warpPerspective(nextImage, output, homography, { width: image.cols, height: image.rows },
  cv.INTER_LINEAR | cv.WARP_INVERSE_MAP)
`,
  'match-features': `using orb = cv.ORB.create(800), matcher = new cv.BFMatcher(cv.NORM_HAMMING, true)
if (!orb) throw new Error('ORB factory failed')
using first = new cv.KeyPointVector(), second = new cv.KeyPointVector()
using a = new cv.Mat(), b = new cv.Mat(), mask = new cv.Mat()
orb.detectAndCompute(image, mask, first, a)
orb.detectAndCompute(nextImage, mask, second, b)
using matches = new cv.DMatchVector(), output = new cv.Mat()
if (!a.empty() && !b.empty()) matcher.match(a, b, matches)
cv.drawMatches(image, first, nextImage, second, matches, output)
// This is the candidate view. RANSAC in the full recipe rejects inconsistent matches.
`,
  'detect-motion': `using a = new cv.Mat(), b = new cv.Mat(), difference = new cv.Mat(), mask = new cv.Mat()
cv.cvtColor(image, a, cv.COLOR_BGR2GRAY)
cv.cvtColor(nextImage, b, cv.COLOR_BGR2GRAY)
cv.GaussianBlur(a, a, { width: 5, height: 5 }, 1)
cv.GaussianBlur(b, b, { width: 5, height: 5 }, 1)
cv.absdiff(a, b, difference)
cv.threshold(difference, mask, 25, 255, cv.THRESH_BINARY)
using kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: 3, height: 3 })
cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel)
using labels = new cv.Mat(), stats = new cv.Mat(), centres = new cv.Mat()
cv.connectedComponentsWithStats(mask, labels, stats, centres)
`,
  'compare-images': `using a = new cv.Mat(), b = new cv.Mat(), similarity = new cv.Mat(), mask = new cv.Mat()
cv.cvtColor(image, a, cv.COLOR_BGR2GRAY)
cv.cvtColor(nextImage, b, cv.COLOR_BGR2GRAY)
const score = cv.quality.QualitySSIM_compute(a, b, similarity)
cv.threshold(similarity, mask, 0.8, 255, cv.THRESH_BINARY_INV)
mask.convertTo(mask, cv.CV_8U)
using kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: 3, height: 3 })
cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel)
console.log('Mean grayscale SSIM:', score[0])
`,
  'count-objects': `using gray = new cv.Mat(), mask = new cv.Mat()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.GaussianBlur(gray, gray, { width: 5, height: 5 }, 1)
cv.threshold(gray, mask, 127, 255, cv.THRESH_BINARY)
using kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: 3, height: 3 })
cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel)
using labels = new cv.Mat(), stats = new cv.Mat(), centroids = new cv.Mat()
const count = cv.connectedComponentsWithStats(mask, labels, stats, centroids)
let retained = 0
for (let label = 1; label < count; label++) {
  if (stats.data32S[label * 5 + cv.CC_STAT_AREA] >= 80) retained++
}
console.log('Objects:', retained)
`,
  'segment-touching': `using gray = new cv.Mat(), mask = new cv.Mat(), distance = new cv.Mat()
using seeds = new cv.Mat(), markers = new cv.Mat(), dilated = new cv.Mat(), peaks = new cv.Mat()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.threshold(gray, mask, 127, 255, cv.THRESH_BINARY)
cv.distanceTransform(mask, distance, cv.DIST_L2, 5)
cv.threshold(distance, seeds, cv.minMaxLoc(distance).maxVal * 0.35, 255, cv.THRESH_BINARY)
seeds.convertTo(seeds, cv.CV_8U)
using neighborhood = cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: 31, height: 31 })
cv.dilate(distance, dilated, neighborhood)
cv.compare(distance, dilated, peaks, cv.CMP_GE)
cv.bitwise_and(peaks, seeds, seeds)
cv.connectedComponents(seeds, markers)
for (let i = 0; i < markers.data32S.length; i++) {
  const label = markers.data32S[i]
  markers.data32S[i] = mask.data[i] === 0 ? 1 : label ? label + 1 : 0
}
cv.watershed(image, markers)
`,
  'measure-shapes': `using gray = new cv.Mat(), mask = new cv.Mat(), hierarchy = new cv.Mat()
using contours = new cv.MatVector()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.threshold(gray, mask, 127, 255, cv.THRESH_BINARY)
cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
for (let i = 0; i < contours.size(); i++) {
  using contour = contours.get(i)!
  const area = cv.contourArea(contour), perimeter = cv.arcLength(contour, true)
  if (area >= 80) console.log({ area, perimeter, circularity: 4 * Math.PI * area / perimeter ** 2 })
}
`,
  'colour-mask': `using hsv = new cv.Mat(), mask = new cv.Mat()
cv.cvtColor(image, hsv, cv.COLOR_BGR2HSV)
using low = new cv.Mat(image.rows, image.cols, cv.CV_8UC3, [25, 40, 0, 0])
using high = new cv.Mat(image.rows, image.cols, cv.CV_8UC3, [95, 255, 255, 0])
cv.inRange(hsv, low, high, mask)
using kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, { width: 3, height: 3 })
cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel)
using labels = new cv.Mat(), stats = new cv.Mat(), centres = new cv.Mat()
cv.connectedComponentsWithStats(mask, labels, stats, centres)
`,
  'crop-object': `using gray = new cv.Mat(), mask = new cv.Mat(), hierarchy = new cv.Mat()
using contours = new cv.MatVector(), output = new cv.Mat()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.threshold(gray, mask, 127, 255, cv.THRESH_BINARY)
cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
let largest = 0, bounds = rect
for (let i = 0; i < contours.size(); i++) {
  using contour = contours.get(i)!
  const area = cv.contourArea(contour)
  if (area > largest) { largest = area; bounds = cv.boundingRect(contour) }
}
if (!largest) throw new Error('No foreground found')
using crop = image.roi(bounds)
crop.copyTo(output)
`,
  'remove-background': `using mask = new cv.Mat(), background = new cv.Mat(), foreground = new cv.Mat()
cv.grabCut(image, mask, rect, background, foreground, 3, cv.GC_INIT_WITH_RECT)
using rgba = new cv.Mat()
cv.cvtColor(image, rgba, cv.COLOR_BGR2RGBA)
for (let i = 0; i < mask.data.length; i++) {
  const label = mask.data[i]
  rgba.data[i * 4 + 3] = label === cv.GC_FGD || label === cv.GC_PR_FGD ? 255 : 0
}
`,
  'blur-background': `using mask = new cv.Mat(), background = new cv.Mat(), foreground = new cv.Mat()
cv.grabCut(image, mask, rect, background, foreground, 3, cv.GC_INIT_WITH_RECT)
for (let i = 0; i < mask.data.length; i++) {
  const label = mask.data[i]
  mask.data[i] = label === cv.GC_FGD || label === cv.GC_PR_FGD ? 255 : 0
}
using output = new cv.Mat()
cv.GaussianBlur(image, output, { width: 0, height: 0 }, 8)
image.copyTo(output, mask)
// The full recipe feathers the mask before blending the boundary.
`,
  'blur-region': `using mask = cv.Mat.zeros(image.rows, image.cols, cv.CV_8U)
using blurred = new cv.Mat(), output = new cv.Mat()
cv.rectangle(mask, { x: rect.x, y: rect.y },
  { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }, [255, 0, 0, 0], -1)
cv.GaussianBlur(image, blurred, { width: 0, height: 0 }, 8)
image.copyTo(output)
blurred.copyTo(output, mask)
`,
  'denoise-detail': `using denoised = new cv.Mat(), lab = new cv.Mat(), lightness = new cv.Mat(), output = new cv.Mat()
cv.fastNlMeansDenoisingColored(image, denoised, 8, 8, 7, 21)
cv.cvtColor(denoised, lab, cv.COLOR_BGR2Lab)
cv.extractChannel(lab, lightness, 0)
using clahe = cv.createCLAHE(2, { width: 8, height: 8 })
if (!clahe) throw new Error('CLAHE factory failed')
clahe.apply(lightness, lightness)
cv.insertChannel(lightness, lab, 0)
cv.cvtColor(lab, output, cv.COLOR_Lab2BGR)
`,
  'sharpen-details': `using blurred = new cv.Mat(), output = new cv.Mat()
cv.GaussianBlur(image, blurred, { width: 0, height: 0 }, 2)
const amount = 1
cv.addWeighted(image, 1 + amount, blurred, -amount, 0, output)
`,
  'focus-map': `using gray = new cv.Mat(), derivative = new cv.Mat(), energy = new cv.Mat(), display = new cv.Mat()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.Laplacian(gray, derivative, cv.CV_32F, 3)
cv.multiply(derivative, derivative, energy)
cv.blur(energy, energy, { width: 15, height: 15 })
cv.normalize(energy, display, 0, 255, cv.NORM_MINMAX, cv.CV_8U)
console.log('Mean squared Laplacian:', cv.mean(energy)[0])
`,
  'scan-document': `using gray = new cv.Mat(), edges = new cv.Mat(), hierarchy = new cv.Mat()
using contours = new cv.MatVector()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.GaussianBlur(gray, gray, { width: 5, height: 5 }, 1)
cv.Canny(gray, edges, 40, 120)
cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
for (let i = 0; i < contours.size(); i++) {
  using contour = contours.get(i)!, polygon = new cv.Mat()
  cv.approxPolyDP(contour, polygon, 0.02 * cv.arcLength(contour, true), true)
  if (polygon.rows === 4 && cv.isContourConvex(polygon)) console.log('Candidate area:', cv.contourArea(polygon))
}
// Order the largest quadrilateral, fit getPerspectiveTransform, then warpPerspective.
`,
  'clean-document': `using gray = new cv.Mat(), illumination = new cv.Mat(), normalized = new cv.Mat(), output = new cv.Mat()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
gray.convertTo(gray, cv.CV_32F)
cv.GaussianBlur(gray, illumination, { width: 0, height: 0 }, 20)
for (let i = 0; i < illumination.data32F.length; i++) illumination.data32F[i] = Math.max(1, illumination.data32F[i])
cv.divide(gray, illumination, normalized, 220)
normalized.convertTo(normalized, cv.CV_8U)
cv.adaptiveThreshold(normalized, output, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 9)
`,
  'deskew-text': `using gray = new cv.Mat(), edges = new cv.Mat(), lines = new cv.Mat()
cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY)
cv.Canny(gray, edges, 50, 150)
cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 25, 50, 15)
const angles: number[] = []
for (let i = 0; i < lines.data32S.length; i += 4) {
  const [x1, y1, x2, y2] = lines.data32S.slice(i, i + 4)
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
  if (Math.abs(angle) <= 25) angles.push(angle)
}
if (!angles.length) throw new Error('No near-horizontal lines found')
angles.sort((a,b) => a-b)
using rotation = cv.getRotationMatrix2D({ x: image.cols / 2, y: image.rows / 2 }, angles[Math.floor(angles.length / 2)], 1)
using output = new cv.Mat()
cv.warpAffine(image, output, rotation, { width: image.cols, height: image.rows })
`,
  'stereo-depth': `using left = new cv.Mat(), right = new cv.Mat(), disparity = new cv.Mat()
cv.cvtColor(image, left, cv.COLOR_BGR2GRAY)
cv.cvtColor(nextImage, right, cv.COLOR_BGR2GRAY)
using stereo = cv.StereoSGBM.create(0, 64, 9, 8 * 81, 32 * 81)
if (!stereo) throw new Error('Stereo factory failed')
stereo.compute(left, right, disparity)
const focalPixels = 500, baselineMetres = 0.1
const depthMetres = Float32Array.from(disparity.data16S, fixed => {
  const pixels = fixed / 16
  return pixels > 0 ? focalPixels * baselineMetres / pixels : 0
})
console.log('Depth values; 0 means invalid:', depthMetres)
`,
  'colour-palette': `using smooth = new cv.Mat()
cv.bilateralFilter(image, smooth, 7, 40, 5)
// Flatten copied BGR samples into one row per pixel before clustering.
using samples = new cv.Mat(smooth.rows * smooth.cols, 3, cv.CV_32F)
samples.data32F.set(smooth.data)
using labels = new cv.Mat(), centres = new cv.Mat()
cv.kmeans(samples, 6, labels,
  { type: cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, maxCount: 20, epsilon: 0.5 },
  1, cv.KMEANS_PP_CENTERS, centres)
// labels.data32S chooses a BGR triplet from centres.data32F for each pixel.
`
}
