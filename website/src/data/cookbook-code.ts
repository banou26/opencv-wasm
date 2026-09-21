/** Typechecked core chains. Initialize with initOpenCV first; the pages define image, nextImage and rect inputs. */
export const cookbookCode: Record<string, string> = {
  'motion-vectors': `import {
  BORDER_REFLECT_101,
  COLOR_BGR2GRAY,
  CV_32F,
  CV_64F,
  INTER_LINEAR,
  Mat,
  calcOpticalFlowFarneback,
  cornerMinEigenVal,
  createHanningWindow,
  cvtColor,
  phaseCorrelate,
  warpAffine
} from '@banou/opencv'

using beforeGray = new Mat(), afterGray = new Mat()
cvtColor(image, beforeGray, COLOR_BGR2GRAY)
cvtColor(nextImage, afterGray, COLOR_BGR2GRAY)
using a = new Mat(), b = new Mat(), hann = new Mat()
beforeGray.convertTo(a, CV_32F)
afterGray.convertTo(b, CV_32F)
createHanningWindow(hann, { width: image.cols, height: image.rows }, CV_32F)
const pan = phaseCorrelate(a, b, hann)
const usable = Number.isFinite(pan.value.x) && Number.isFinite(pan.value.y) && pan.response >= 0.1
  && Math.abs(pan.value.x) < image.cols * 0.45 && Math.abs(pan.value.y) < image.rows * 0.45
const dx = usable ? pan.value.x : 0, dy = usable ? pan.value.y : 0
using toFirst = new Mat(2, 3, CV_64F), toSecond = new Mat(2, 3, CV_64F)
toFirst.data64F.set([1, 0, -dx, 0, 1, -dy])
toSecond.data64F.set([1, 0, dx, 0, 1, dy])
using alignedAfter = new Mat(), alignedBefore = new Mat()
const size = { width: image.cols, height: image.rows }
warpAffine(afterGray, alignedAfter, toFirst, size, INTER_LINEAR, BORDER_REFLECT_101)
warpAffine(beforeGray, alignedBefore, toSecond, size, INTER_LINEAR, BORDER_REFLECT_101)
using forward = new Mat(), backward = new Mat()
calcOpticalFlowFarneback(beforeGray, alignedAfter, forward, 0.5, 4, 25, 5, 7, 1.5, 0)
calcOpticalFlowFarneback(afterGray, alignedBefore, backward, 0.5, 4, 25, 5, 7, 1.5, 0)
const f = Float32Array.from(forward.data32F), r = Float32Array.from(backward.data32F)
for (let i = 0; i < f.length; i += 2) {
  f[i] += dx; f[i + 1] += dy
  r[i] -= dx; r[i + 1] -= dy
}
forward.data32F.set(f)
backward.data32F.set(r)
using texture = new Mat()
cornerMinEigenVal(beforeGray, texture, 7, 3)
// forward.data32F[(y * image.cols + x) * 2 + 0] is dx, +1 is dy.
// A point (x,y) in image should land at (x+dx,y+dy) in nextImage.
// The full recipe bilinearly samples backward flow at that destination,
// rejects weak texture and inconsistent returns, and takes per-cell medians.
// Never report a textureless cell as a known zero-displacement measurement.
`,
  'track-region': `import {
  COLOR_BGR2GRAY,
  CV_32FC2,
  CV_8U,
  Mat,
  RANSAC,
  calcOpticalFlowPyrLK,
  countNonZero,
  cvtColor,
  estimateAffinePartial2D,
  goodFeaturesToTrack,
  line,
  rectangle
} from '@banou/opencv'

using beforeGray = new Mat(), afterGray = new Mat()
cvtColor(image, beforeGray, COLOR_BGR2GRAY)
cvtColor(nextImage, afterGray, COLOR_BGR2GRAY)
using mask = Mat.zeros(image.rows, image.cols, CV_8U)
rectangle(mask, { x: rect.x, y: rect.y },
  { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }, [255, 0, 0, 0], -1)
using points = new Mat(), tracked = new Mat()
using status = new Mat(), error = new Mat()
goodFeaturesToTrack(beforeGray, points, 150, 0.01, 5, mask)
if (points.rows < 4) throw new Error('Select a textured region with at least four corners')
calcOpticalFlowPyrLK(beforeGray, afterGray, points, tracked, status, error)
using returned = new Mat(), backwardStatus = new Mat(), backwardError = new Mat()
calcOpticalFlowPyrLK(afterGray, beforeGray, tracked, returned, backwardStatus, backwardError)
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
using sourcePoints = new Mat(from.length / 2, 1, CV_32FC2)
using targetPoints = new Mat(to.length / 2, 1, CV_32FC2), inliers = new Mat()
sourcePoints.data32F.set(from)
targetPoints.data32F.set(to)
using transform = estimateAffinePartial2D(sourcePoints, targetPoints, inliers, RANSAC, 3)
if (transform.empty() || countNonZero(inliers) < 3) throw new Error('No stable region transform')
const m = Array.from(transform.data64F)
const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
  [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
  .map(([x, y]) => ({ x: Math.round(m[0] * x + m[1] * y + m[2]), y: Math.round(m[3] * x + m[4] * y + m[5]) }))
using output = nextImage.mat_clone()
for (let i = 0; i < 4; i++) line(output, corners[i], corners[(i + 1) % 4], [178, 216, 85, 255], 3)
`,
  'locate-template': `import {
  COLOR_BGR2GRAY,
  Mat,
  TM_CCOEFF_NORMED,
  cvtColor,
  matchTemplate,
  meanStdDev,
  minMaxLoc
} from '@banou/opencv'

using beforeGray = new Mat(), afterGray = new Mat()
cvtColor(image, beforeGray, COLOR_BGR2GRAY)
cvtColor(nextImage, afterGray, COLOR_BGR2GRAY)
using template = beforeGray.roi(rect), scores = new Mat()
using mean = new Mat(), deviation = new Mat()
meanStdDev(template, mean, deviation)
if (deviation.data64F[0] < 1) throw new Error('Select a textured patch')
matchTemplate(afterGray, template, scores, TM_CCOEFF_NORMED)
const { maxLoc, maxVal } = minMaxLoc(scores)
if (maxVal >= 0.6) {
  console.log('Template top-left:', maxLoc, 'score:', maxVal)
}
`,
  'align-images': `import {
  BFMatcher,
  CV_32FC2,
  DMatchVector,
  INTER_LINEAR,
  KeyPointVector,
  Mat,
  NORM_HAMMING,
  ORB_create,
  RANSAC,
  WARP_INVERSE_MAP,
  countNonZero,
  findHomography,
  warpPerspective
} from '@banou/opencv'

using orb = ORB_create(800), matcher = new BFMatcher(NORM_HAMMING, true)
if (!orb) throw new Error('ORB factory failed')
using first = new KeyPointVector(), second = new KeyPointVector()
using a = new Mat(), b = new Mat(), mask = new Mat()
orb.detectAndCompute(image, mask, first, a)
orb.detectAndCompute(nextImage, mask, second, b)
if (a.empty() || b.empty()) throw new Error('Both images need features')
using matches = new DMatchVector()
matcher.match(a, b, matches)
const ordered = Array.from({ length: matches.size() }, (_, i) => matches.get(i)!)
  .sort((a, b) => a.distance - b.distance).slice(0, 200)
if (ordered.length < 4) throw new Error('Fewer than four matches')
const from = ordered.flatMap(m => { const p = first.get(m.queryIdx)!.pt; return [p.x, p.y] })
const to = ordered.flatMap(m => { const p = second.get(m.trainIdx)!.pt; return [p.x, p.y] })
using sourcePoints = new Mat(ordered.length, 1, CV_32FC2)
using targetPoints = new Mat(ordered.length, 1, CV_32FC2), inliers = new Mat()
sourcePoints.data32F.set(from)
targetPoints.data32F.set(to)
using homography = findHomography(sourcePoints, targetPoints, RANSAC, 3, inliers)
if (homography.empty() || countNonZero(inliers) < 4) throw new Error('No stable homography')
using output = new Mat()
warpPerspective(nextImage, output, homography, { width: image.cols, height: image.rows },
  INTER_LINEAR | WARP_INVERSE_MAP)
`,
  'match-features': `import {
  BFMatcher,
  DMatchVector,
  KeyPointVector,
  Mat,
  NORM_HAMMING,
  ORB_create,
  drawMatches
} from '@banou/opencv'

using orb = ORB_create(800), matcher = new BFMatcher(NORM_HAMMING, true)
if (!orb) throw new Error('ORB factory failed')
using first = new KeyPointVector(), second = new KeyPointVector()
using a = new Mat(), b = new Mat(), mask = new Mat()
orb.detectAndCompute(image, mask, first, a)
orb.detectAndCompute(nextImage, mask, second, b)
using matches = new DMatchVector(), output = new Mat()
if (!a.empty() && !b.empty()) matcher.match(a, b, matches)
drawMatches(image, first, nextImage, second, matches, output)
// This is the candidate view. RANSAC in the full recipe rejects inconsistent matches.
`,
  'detect-motion': `import {
  COLOR_BGR2GRAY,
  GaussianBlur,
  MORPH_CLOSE,
  MORPH_ELLIPSE,
  Mat,
  THRESH_BINARY,
  absdiff,
  connectedComponentsWithStats,
  cvtColor,
  getStructuringElement,
  morphologyEx,
  threshold
} from '@banou/opencv'

using a = new Mat(), b = new Mat(), difference = new Mat(), mask = new Mat()
cvtColor(image, a, COLOR_BGR2GRAY)
cvtColor(nextImage, b, COLOR_BGR2GRAY)
GaussianBlur(a, a, { width: 5, height: 5 }, 1)
GaussianBlur(b, b, { width: 5, height: 5 }, 1)
absdiff(a, b, difference)
threshold(difference, mask, 25, 255, THRESH_BINARY)
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
morphologyEx(mask, mask, MORPH_CLOSE, kernel)
using labels = new Mat(), stats = new Mat(), centres = new Mat()
connectedComponentsWithStats(mask, labels, stats, centres)
`,
  'compare-images': `import {
  COLOR_BGR2GRAY,
  CV_8U,
  MORPH_CLOSE,
  MORPH_ELLIPSE,
  Mat,
  THRESH_BINARY_INV,
  cvtColor,
  getStructuringElement,
  morphologyEx,
  quality_QualitySSIM_compute,
  threshold
} from '@banou/opencv'

using a = new Mat(), b = new Mat(), similarity = new Mat(), mask = new Mat()
cvtColor(image, a, COLOR_BGR2GRAY)
cvtColor(nextImage, b, COLOR_BGR2GRAY)
const score = quality_QualitySSIM_compute(a, b, similarity)
threshold(similarity, mask, 0.8, 255, THRESH_BINARY_INV)
mask.convertTo(mask, CV_8U)
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
morphologyEx(mask, mask, MORPH_CLOSE, kernel)
console.log('Mean grayscale SSIM:', score[0])
`,
  'count-objects': `import {
  CC_STAT_AREA,
  COLOR_BGR2GRAY,
  GaussianBlur,
  MORPH_ELLIPSE,
  MORPH_OPEN,
  Mat,
  THRESH_BINARY,
  connectedComponentsWithStats,
  cvtColor,
  getStructuringElement,
  morphologyEx,
  threshold
} from '@banou/opencv'

using gray = new Mat(), mask = new Mat()
cvtColor(image, gray, COLOR_BGR2GRAY)
GaussianBlur(gray, gray, { width: 5, height: 5 }, 1)
threshold(gray, mask, 127, 255, THRESH_BINARY)
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
morphologyEx(mask, mask, MORPH_OPEN, kernel)
using labels = new Mat(), stats = new Mat(), centroids = new Mat()
const count = connectedComponentsWithStats(mask, labels, stats, centroids)
let retained = 0
for (let label = 1; label < count; label++) {
  if (stats.data32S[label * 5 + CC_STAT_AREA] >= 80) retained++
}
console.log('Objects:', retained)
`,
  'segment-touching': `import {
  CMP_GE,
  COLOR_BGR2GRAY,
  CV_8U,
  DIST_L2,
  MORPH_ELLIPSE,
  Mat,
  THRESH_BINARY,
  bitwise_and,
  compare,
  connectedComponents,
  cvtColor,
  dilate,
  distanceTransform,
  getStructuringElement,
  minMaxLoc,
  threshold,
  watershed
} from '@banou/opencv'

using gray = new Mat(), mask = new Mat(), distance = new Mat()
using seeds = new Mat(), markers = new Mat(), dilated = new Mat(), peaks = new Mat()
cvtColor(image, gray, COLOR_BGR2GRAY)
threshold(gray, mask, 127, 255, THRESH_BINARY)
distanceTransform(mask, distance, DIST_L2, 5)
threshold(distance, seeds, minMaxLoc(distance).maxVal * 0.35, 255, THRESH_BINARY)
seeds.convertTo(seeds, CV_8U)
using neighborhood = getStructuringElement(MORPH_ELLIPSE, { width: 31, height: 31 })
dilate(distance, dilated, neighborhood)
compare(distance, dilated, peaks, CMP_GE)
bitwise_and(peaks, seeds, seeds)
connectedComponents(seeds, markers)
for (let i = 0; i < markers.data32S.length; i++) {
  const label = markers.data32S[i]
  markers.data32S[i] = mask.data[i] === 0 ? 1 : label ? label + 1 : 0
}
watershed(image, markers)
`,
  'measure-shapes': `import {
  CHAIN_APPROX_SIMPLE,
  COLOR_BGR2GRAY,
  Mat,
  MatVector,
  RETR_EXTERNAL,
  THRESH_BINARY,
  arcLength,
  contourArea,
  cvtColor,
  findContours,
  threshold
} from '@banou/opencv'

using gray = new Mat(), mask = new Mat(), hierarchy = new Mat()
using contours = new MatVector()
cvtColor(image, gray, COLOR_BGR2GRAY)
threshold(gray, mask, 127, 255, THRESH_BINARY)
findContours(mask, contours, hierarchy, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
for (let i = 0; i < contours.size(); i++) {
  using contour = contours.get(i)!
  const area = contourArea(contour), perimeter = arcLength(contour, true)
  if (area >= 80) console.log({ area, perimeter, circularity: 4 * Math.PI * area / perimeter ** 2 })
}
`,
  'colour-mask': `import {
  COLOR_BGR2HSV,
  CV_8UC3,
  MORPH_CLOSE,
  MORPH_ELLIPSE,
  Mat,
  connectedComponentsWithStats,
  cvtColor,
  getStructuringElement,
  inRange,
  morphologyEx
} from '@banou/opencv'

using hsv = new Mat(), mask = new Mat()
cvtColor(image, hsv, COLOR_BGR2HSV)
using low = new Mat(image.rows, image.cols, CV_8UC3, [25, 40, 0, 0])
using high = new Mat(image.rows, image.cols, CV_8UC3, [95, 255, 255, 0])
inRange(hsv, low, high, mask)
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
morphologyEx(mask, mask, MORPH_CLOSE, kernel)
using labels = new Mat(), stats = new Mat(), centres = new Mat()
connectedComponentsWithStats(mask, labels, stats, centres)
`,
  'crop-object': `import {
  CHAIN_APPROX_SIMPLE,
  COLOR_BGR2GRAY,
  Mat,
  MatVector,
  RETR_EXTERNAL,
  THRESH_BINARY,
  boundingRect,
  contourArea,
  cvtColor,
  findContours,
  threshold
} from '@banou/opencv'

using gray = new Mat(), mask = new Mat(), hierarchy = new Mat()
using contours = new MatVector(), output = new Mat()
cvtColor(image, gray, COLOR_BGR2GRAY)
threshold(gray, mask, 127, 255, THRESH_BINARY)
findContours(mask, contours, hierarchy, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
let largest = 0, bounds = rect
for (let i = 0; i < contours.size(); i++) {
  using contour = contours.get(i)!
  const area = contourArea(contour)
  if (area > largest) { largest = area; bounds = boundingRect(contour) }
}
if (!largest) throw new Error('No foreground found')
using crop = image.roi(bounds)
crop.copyTo(output)
`,
  'remove-background': `import {
  COLOR_BGR2RGBA,
  GC_FGD,
  GC_INIT_WITH_RECT,
  GC_PR_FGD,
  Mat,
  cvtColor,
  grabCut
} from '@banou/opencv'

using mask = new Mat(), background = new Mat(), foreground = new Mat()
grabCut(image, mask, rect, background, foreground, 3, GC_INIT_WITH_RECT)
using rgba = new Mat()
cvtColor(image, rgba, COLOR_BGR2RGBA)
for (let i = 0; i < mask.data.length; i++) {
  const label = mask.data[i]
  rgba.data[i * 4 + 3] = label === GC_FGD || label === GC_PR_FGD ? 255 : 0
}
`,
  'blur-background': `import {
  GC_FGD,
  GC_INIT_WITH_RECT,
  GC_PR_FGD,
  GaussianBlur,
  Mat,
  grabCut
} from '@banou/opencv'

using mask = new Mat(), background = new Mat(), foreground = new Mat()
grabCut(image, mask, rect, background, foreground, 3, GC_INIT_WITH_RECT)
for (let i = 0; i < mask.data.length; i++) {
  const label = mask.data[i]
  mask.data[i] = label === GC_FGD || label === GC_PR_FGD ? 255 : 0
}
using output = new Mat()
GaussianBlur(image, output, { width: 0, height: 0 }, 8)
image.copyTo(output, mask)
// The full recipe feathers the mask before blending the boundary.
`,
  'blur-region': `import {
  CV_8U,
  GaussianBlur,
  Mat,
  rectangle
} from '@banou/opencv'

using mask = Mat.zeros(image.rows, image.cols, CV_8U)
using blurred = new Mat(), output = new Mat()
rectangle(mask, { x: rect.x, y: rect.y },
  { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }, [255, 0, 0, 0], -1)
GaussianBlur(image, blurred, { width: 0, height: 0 }, 8)
image.copyTo(output)
blurred.copyTo(output, mask)
`,
  'denoise-detail': `import {
  COLOR_BGR2Lab,
  COLOR_Lab2BGR,
  Mat,
  createCLAHE,
  cvtColor,
  extractChannel,
  fastNlMeansDenoisingColored,
  insertChannel
} from '@banou/opencv'

using denoised = new Mat(), lab = new Mat(), lightness = new Mat(), output = new Mat()
fastNlMeansDenoisingColored(image, denoised, 8, 8, 7, 21)
cvtColor(denoised, lab, COLOR_BGR2Lab)
extractChannel(lab, lightness, 0)
using clahe = createCLAHE(2, { width: 8, height: 8 })
if (!clahe) throw new Error('CLAHE factory failed')
clahe.apply(lightness, lightness)
insertChannel(lightness, lab, 0)
cvtColor(lab, output, COLOR_Lab2BGR)
`,
  'sharpen-details': `import {
  GaussianBlur,
  Mat,
  addWeighted
} from '@banou/opencv'

using blurred = new Mat(), output = new Mat()
GaussianBlur(image, blurred, { width: 0, height: 0 }, 2)
const amount = 1
addWeighted(image, 1 + amount, blurred, -amount, 0, output)
`,
  'focus-map': `import {
  COLOR_BGR2GRAY,
  CV_32F,
  CV_8U,
  Laplacian,
  Mat,
  NORM_MINMAX,
  blur,
  cvtColor,
  mean,
  multiply,
  normalize
} from '@banou/opencv'

using gray = new Mat(), derivative = new Mat(), energy = new Mat(), display = new Mat()
cvtColor(image, gray, COLOR_BGR2GRAY)
Laplacian(gray, derivative, CV_32F, 3)
multiply(derivative, derivative, energy)
blur(energy, energy, { width: 15, height: 15 })
normalize(energy, display, 0, 255, NORM_MINMAX, CV_8U)
console.log('Mean squared Laplacian:', mean(energy)[0])
`,
  'scan-document': `import {
  CHAIN_APPROX_SIMPLE,
  COLOR_BGR2GRAY,
  Canny,
  GaussianBlur,
  Mat,
  MatVector,
  RETR_LIST,
  approxPolyDP,
  arcLength,
  contourArea,
  cvtColor,
  findContours,
  isContourConvex
} from '@banou/opencv'

using gray = new Mat(), edges = new Mat(), hierarchy = new Mat()
using contours = new MatVector()
cvtColor(image, gray, COLOR_BGR2GRAY)
GaussianBlur(gray, gray, { width: 5, height: 5 }, 1)
Canny(gray, edges, 40, 120)
findContours(edges, contours, hierarchy, RETR_LIST, CHAIN_APPROX_SIMPLE)
for (let i = 0; i < contours.size(); i++) {
  using contour = contours.get(i)!, polygon = new Mat()
  approxPolyDP(contour, polygon, 0.02 * arcLength(contour, true), true)
  if (polygon.rows === 4 && isContourConvex(polygon)) console.log('Candidate area:', contourArea(polygon))
}
// Order the largest quadrilateral, fit getPerspectiveTransform, then warpPerspective.
`,
  'clean-document': `import {
  ADAPTIVE_THRESH_GAUSSIAN_C,
  COLOR_BGR2GRAY,
  CV_32F,
  CV_8U,
  GaussianBlur,
  Mat,
  THRESH_BINARY,
  adaptiveThreshold,
  cvtColor,
  divide
} from '@banou/opencv'

using gray = new Mat(), illumination = new Mat(), normalized = new Mat(), output = new Mat()
cvtColor(image, gray, COLOR_BGR2GRAY)
gray.convertTo(gray, CV_32F)
GaussianBlur(gray, illumination, { width: 0, height: 0 }, 20)
for (let i = 0; i < illumination.data32F.length; i++) illumination.data32F[i] = Math.max(1, illumination.data32F[i])
divide(gray, illumination, normalized, 220)
normalized.convertTo(normalized, CV_8U)
adaptiveThreshold(normalized, output, 255, ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY, 31, 9)
`,
  'deskew-text': `import {
  COLOR_BGR2GRAY,
  Canny,
  HoughLinesP,
  Mat,
  cvtColor,
  getRotationMatrix2D,
  warpAffine
} from '@banou/opencv'

using gray = new Mat(), edges = new Mat(), lines = new Mat()
cvtColor(image, gray, COLOR_BGR2GRAY)
Canny(gray, edges, 50, 150)
HoughLinesP(edges, lines, 1, Math.PI / 180, 25, 50, 15)
const angles: number[] = []
for (let i = 0; i < lines.data32S.length; i += 4) {
  const [x1, y1, x2, y2] = lines.data32S.slice(i, i + 4)
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
  if (Math.abs(angle) <= 25) angles.push(angle)
}
if (!angles.length) throw new Error('No near-horizontal lines found')
angles.sort((a,b) => a-b)
using rotation = getRotationMatrix2D({ x: image.cols / 2, y: image.rows / 2 }, angles[Math.floor(angles.length / 2)], 1)
using output = new Mat()
warpAffine(image, output, rotation, { width: image.cols, height: image.rows })
`,
  'stereo-depth': `import {
  COLOR_BGR2GRAY,
  Mat,
  StereoSGBM_create,
  cvtColor
} from '@banou/opencv'

using left = new Mat(), right = new Mat(), disparity = new Mat()
cvtColor(image, left, COLOR_BGR2GRAY)
cvtColor(nextImage, right, COLOR_BGR2GRAY)
using stereo = StereoSGBM_create(0, 64, 9, 8 * 81, 32 * 81)
if (!stereo) throw new Error('Stereo factory failed')
stereo.compute(left, right, disparity)
const focalPixels = 500, baselineMetres = 0.1
const depthMetres = Float32Array.from(disparity.data16S, fixed => {
  const pixels = fixed / 16
  return pixels > 0 ? focalPixels * baselineMetres / pixels : 0
})
console.log('Depth values; 0 means invalid:', depthMetres)
`,
  'colour-palette': `import {
  CV_32F,
  KMEANS_PP_CENTERS,
  Mat,
  TERM_CRITERIA_COUNT,
  TERM_CRITERIA_EPS,
  bilateralFilter,
  kmeans
} from '@banou/opencv'

using smooth = new Mat()
bilateralFilter(image, smooth, 7, 40, 5)
// Flatten copied BGR samples into one row per pixel before clustering.
using samples = new Mat(smooth.rows * smooth.cols, 3, CV_32F)
samples.data32F.set(smooth.data)
using labels = new Mat(), centres = new Mat()
kmeans(samples, 6, labels,
  { type: TERM_CRITERIA_COUNT | TERM_CRITERIA_EPS, maxCount: 20, epsilon: 0.5 },
  1, KMEANS_PP_CENTERS, centres)
// labels.data32S chooses a BGR triplet from centres.data32F for each pixel.
`
}
