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
} from '@banou/opencv-wasm'

// Start with two equally sized, 8-bit BGR Mats from the initialized engine:
// image is the BEFORE frame; nextImage is the AFTER frame.
// All positions and displacements below use these processed-image pixels.
// A Mat owns native storage. "using" releases it when this scope ends.

// 1. Reduce each colour image to one brightness channel.
// Optical flow follows local brightness patterns, so colour is not needed here.
// These empty destinations acquire their size and pixel type from cvtColor.
using beforeGray = new Mat()
using afterGray = new Mat()
// Convert the before frame from blue/green/red channels to grayscale.
cvtColor(image, beforeGray, COLOR_BGR2GRAY)
// Apply the identical conversion to the after frame so they are comparable.
cvtColor(nextImage, afterGray, COLOR_BGR2GRAY)

// 2. Estimate the large translation shared by much of the image.
// Phase correlation requires floating-point input; keep the 8-bit grayscale
// Mats above for Farneback, which we will run after removing this initial pan.
using beforeFloat = new Mat()
using afterFloat = new Mat()
using hann = new Mat() // A weight image that will taper the outer image edges.
// CV_32F means one 32-bit floating-point value per grayscale pixel.
beforeGray.convertTo(beforeFloat, CV_32F)
afterGray.convertTo(afterFloat, CV_32F)
// The same width and height are used for the window and aligned frames.
const size = { width: image.cols, height: image.rows }
// A Hann window reduces artificial frequency changes at the image border,
// helping phase correlation focus on the shared scene rather than its edges.
createHanningWindow(hann, size, CV_32F)
// Compare frequency-domain phases to estimate the before-to-after shift.
// pan.value is { x, y } in pixels; pan.response measures peak strength,
// not a calibrated probability that this translation is correct.
const pan = phaseCorrelate(beforeFloat, afterFloat, hann)

// Reject non-finite, weak or very large estimates before prealignment.
// 0.1 is this recipe's response cutoff; 0.45 limits each shift to 45% of
// the corresponding image dimension. These are heuristics, not guarantees.
const usable = Number.isFinite(pan.value.x) && Number.isFinite(pan.value.y)
  && pan.response >= 0.1
  && Math.abs(pan.value.x) < image.cols * 0.45
  && Math.abs(pan.value.y) < image.rows * 0.45
// Fall back to zero prealignment if the estimate is not usable.
// Positive dx means rightward image motion; positive dy means downward motion.
const dx = usable ? pan.value.x : 0
const dy = usable ? pan.value.y : 0

// 3. Cancel that pan before asking optical flow to find the local remainder.
// Each 2-row, 3-column affine matrix maps (x,y) to:
// (m00*x + m01*y + m02, m10*x + m11*y + m12).
// The identity entries preserve size/rotation; the last column adds a shift.
// CV_64F stores the six coefficients as 64-bit floating-point numbers.
using toFirst = new Mat(2, 3, CV_64F)
using toSecond = new Mat(2, 3, CV_64F)
// Move the after frame by -dx,-dy to approximately align it with before.
toFirst.data64F.set([1, 0, -dx, 0, 1, -dy])
// The reverse comparison needs the opposite shift: move before by +dx,+dy.
toSecond.data64F.set([1, 0, dx, 0, 1, dy])
using alignedAfter = new Mat()
using alignedBefore = new Mat()
// INTER_LINEAR interpolates fractional pixel positions. BORDER_REFLECT_101
// reflects pixels at exposed borders without repeating the edge pixel.
// These filled border pixels are not new observations of the scene.
warpAffine(afterGray, alignedAfter, toFirst, size, INTER_LINEAR, BORDER_REFLECT_101)
// Build the corresponding aligned image for the backward-flow check.
warpAffine(beforeGray, alignedBefore, toSecond, size, INTER_LINEAR, BORDER_REFLECT_101)

// 4. Estimate a remaining displacement at every pixel, in both directions.
// Each result stores float32 pairs: [dx0, dy0, dx1, dy1, ...], one pair per
// source pixel. Forward coordinates belong to before; backward to after.
using forward = new Mat()
using backward = new Mat()
calcOpticalFlowFarneback(
  beforeGray,   // Source frame: the pixel positions we want to track.
  alignedAfter, // Destination after removing the approximate global pan.
  forward,     // Output two-channel residual displacement field.
  0.5,         // Pyramid scale: each coarser image is half the previous size.
  4,           // Number of pyramid levels, including the original image.
  25,          // Window width in pixels: more support also mixes nearby motions.
  5,           // Refinement iterations at each pyramid level.
  7,           // Neighbourhood width for the local polynomial image model.
  1.5,         // Gaussian sigma used to smooth that polynomial estimate.
  0            // No optional flags; estimate from scratch on the aligned pair.
)
// Reverse the roles to ask where each after-frame pixel came from.
// Use the same parameters so the two estimates can be checked consistently.
calcOpticalFlowFarneback(afterGray, alignedBefore, backward, 0.5, 4, 25, 5, 7, 1.5, 0)

// 5. Restore the pan so the fields describe the ORIGINAL frame pair.
// data32F is a view into WASM memory; Float32Array.from makes an owned copy
// that stays valid if a later native allocation grows the WASM heap.
const forwardValues = Float32Array.from(forward.data32F)
const backwardValues = Float32Array.from(backward.data32F)
// Advance by two because every pixel stores horizontal then vertical motion.
for (let i = 0; i < forwardValues.length; i += 2) {
  // Forward motion = initially removed pan + locally estimated remainder.
  forwardValues[i] += dx
  forwardValues[i + 1] += dy
  // The backward direction has the opposite global translation.
  backwardValues[i] -= dx
  backwardValues[i + 1] -= dy
}
// Copy the corrected fields back into their native Mats for subsequent steps.
forward.data32F.set(forwardValues)
backward.data32F.set(backwardValues)

// 6. Measure where the first frame has enough texture to support tracking.
// The smaller eigenvalue measures intensity variation in the weakest local
// direction. Corners vary in two directions; a flat patch or straight edge
// does not constrain motion in both directions as well.
using texture = new Mat()
cornerMinEigenVal(
  beforeGray, // Source texture must use the same coordinates as forward flow.
  texture,    // Output float32 corner-strength image, not a binary mask.
  7,          // Accumulate local gradient information over a 7x7 block.
  3           // Use a 3x3 Sobel aperture to calculate the gradients.
)

// Reading the output: for pixel (x,y), index = (y * image.cols + x) * 2.
// forward.data32F[index] is dx and [index + 1] is dy.
// Its proposed destination in nextImage is therefore (x + dx, y + dy).
// For example, (-12, +5) means 12 pixels left and 5 pixels down.
// Read native views before these Mats are disposed; copy values to keep them.

// The executable lab continues beyond this core estimator:
// - Reject weak texture and destinations outside the second image.
// - Bilinearly sample backward flow at the proposed destination.
// - Reject samples whose forward + backward vector is too far from zero.
// - Take per-cell medians of the remaining vectors to draw the regional grid.
// - Optionally subtract the image-wide median to show motion relative to the pan.
// See the full recipe link below for those filtering and drawing steps.
// Unknown regions must stay unknown; a flat patch is not proof of zero motion.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// rect is an in-bounds { x, y, width, height } rectangle in processed pixels.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Prepare comparable single-channel images and a selection mask.
// Empty Mats are destinations; OpenCV allocates their storage as needed.
using beforeGray = new Mat(), afterGray = new Mat()
// Convert before-frame BGR pixels to brightness for corner detection.
cvtColor(image, beforeGray, COLOR_BGR2GRAY)
// Convert the after frame identically for patch matching.
cvtColor(nextImage, afterGray, COLOR_BGR2GRAY)
// Start with black everywhere: CV_8U is an 8-bit, single-channel mask.
using mask = Mat.zeros(image.rows, image.cols, CV_8U)
// Fill the selected rectangle white (255); thickness -1 means filled.
// Subtract one because the bottom-right pixel coordinate is inclusive.
rectangle(mask, { x: rect.x, y: rect.y },
  { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }, [255, 0, 0, 0], -1)
// points/tracked hold float32 x,y pairs; status/error describe each track.
using points = new Mat(), tracked = new Mat()
using status = new Mat(), error = new Mat()
// Find at most 150 corners inside the mask. Require 1% of the strongest
// corner response and at least 5 pixels between retained corners.
goodFeaturesToTrack(beforeGray, points, 150, 0.01, 5, mask)
// A nearly flat selection cannot provide enough independent tracking evidence.
if (points.rows < 4) throw new Error('Select a textured region with at least four corners')
// 2. Track the selected patches into the next frame using a coarse-to-fine pyramid.
calcOpticalFlowPyrLK(beforeGray, afterGray, points, tracked, status, error)
// Allocate a second set of results for tracking the proposed matches backward.
using returned = new Mat(), backwardStatus = new Mat(), backwardError = new Mat()
// Ask where those after-frame locations land back in the first frame.
calcOpticalFlowPyrLK(afterGray, beforeGray, tracked, returned, backwardStatus, backwardError)
// Collect only point pairs that both trackers accept and that return nearby.
const from: number[] = [], to: number[] = []
// Each row is one point; its two adjacent float values are x and y.
for (let i = 0; i < points.rows; i++) {
  const x = points.data32F[i * 2], y = points.data32F[i * 2 + 1]
  // Distance in pixels between the original point and its round-trip return.
  const backwardDistance = Math.hypot(x - returned.data32F[i * 2], y - returned.data32F[i * 2 + 1])
  // A nonzero status means that track succeeded. The 1.5-pixel return limit
  // rejects many points that jumped onto a different feature.
  if (status.data[i] && backwardStatus.data[i] && backwardDistance <= 1.5) {
    // Append matching x,y pairs in the same order for the transform estimator.
    from.push(x, y)
    to.push(tracked.data32F[i * 2], tracked.data32F[i * 2 + 1])
  }
}
// Two numbers represent each point; eight numbers means four surviving pairs.
if (from.length < 8) throw new Error('Too few consistent tracks')
// 3. Pack each point list into an N-by-1, two-channel float32 matrix.
// The inliers destination will mark pairs accepted by the geometric fit.
using sourcePoints = new Mat(from.length / 2, 1, CV_32FC2)
using targetPoints = new Mat(to.length / 2, 1, CV_32FC2), inliers = new Mat()
// Copy JavaScript point coordinates into native matrix storage.
sourcePoints.data32F.set(from)
targetPoints.data32F.set(to)
// Fit translation, rotation and uniform scale together. RANSAC rejects
// outliers using a 3-pixel reprojection threshold; it does not fit perspective.
using transform = estimateAffinePartial2D(sourcePoints, targetPoints, inliers, RANSAC, 3)
// Stop if no transform or fewer than three geometrically consistent pairs remain.
if (transform.empty() || countNonZero(inliers) < 3) throw new Error('No stable region transform')
// Copy the six affine coefficients before another native allocation can grow memory.
const m = Array.from(transform.data64F)
// Apply x' = m0*x + m1*y + m2 and y' = m3*x + m4*y + m5
// to the four selection corners; this moves the region as one rigid/scaled shape.
const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
  [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
  .map(([x, y]) => ({ x: Math.round(m[0] * x + m[1] * y + m[2]), y: Math.round(m[3] * x + m[4] * y + m[5]) }))
// Make an independent copy of the second image so drawing cannot modify its pixels.
using output = nextImage.mat_clone()
// Connect successive transformed corners with a 3-pixel coloured outline.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// rect is an in-bounds { x, y, width, height } rectangle in processed pixels.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale views of the two frames; matching uses brightness patterns.
using beforeGray = new Mat(), afterGray = new Mat()
// Convert the image containing your selected template to grayscale.
cvtColor(image, beforeGray, COLOR_BGR2GRAY)
// Convert the image we will search to the same representation.
cvtColor(nextImage, afterGray, COLOR_BGR2GRAY)
// roi selects the exact patch without resizing it; it shares the source storage.
// The scores destination will hold one float per possible top-left placement.
using template = beforeGray.roi(rect), scores = new Mat()
// Allocate outputs for the patch mean and standard deviation.
using mean = new Mat(), deviation = new Mat()
// Measure variation: a nearly uniform patch has no distinctive pattern to locate.
meanStdDev(template, mean, deviation)
// Reject a patch varying by less than one grayscale level (8-bit range 0..255).
if (deviation.data64F[0] < 1) throw new Error('Select a textured patch')
// 2. Slide the patch across the second image and compare mean-centred patterns.
// TM_CCOEFF_NORMED gives normalized correlation, with higher scores more similar.
matchTemplate(afterGray, template, scores, TM_CCOEFF_NORMED)
// 3. Find the strongest score and its template top-left position, not its centre.
const { maxLoc, maxVal } = minMaxLoc(scores)
// Accept only a score of at least 0.6. This cutoff is a choice, not a probability;
// even unrelated images have a maximum, and repeated patterns can have many peaks.
if (maxVal >= 0.6) {
  // The patch width/height plus this position define its candidate rectangle.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. ORB detects up to 800 oriented features and binary descriptors.
// Hamming distance compares descriptor bits; true enables mutual-best cross-checking.
using orb = ORB_create(800), matcher = new BFMatcher(NORM_HAMMING, true)
// Factories can return null, so check before using the detector.
if (!orb) throw new Error('ORB factory failed')
// Store each image's feature coordinates separately from its descriptor rows.
using first = new KeyPointVector(), second = new KeyPointVector()
// a/b will hold descriptors; an empty mask allows features anywhere in the image.
using a = new Mat(), b = new Mat(), mask = new Mat()
// Detect keypoints in the first image and write their descriptors into a.
orb.detectAndCompute(image, mask, first, a)
// Do the same for the second image; descriptor row i belongs to keypoint i.
orb.detectAndCompute(nextImage, mask, second, b)
// Matching requires at least some detectable features in both views.
if (a.empty() || b.empty()) throw new Error('Both images need features')
// 2. Allocate a native vector of descriptor-match records.
using matches = new DMatchVector()
// Match descriptors by Hamming distance with the cross-check selected above.
matcher.match(a, b, matches)
// Copy the match records into JavaScript, rank by distance (smaller is better),
// and retain the best 200 candidates for the geometric fit.
const ordered = Array.from({ length: matches.size() }, (_, i) => matches.get(i)!)
  .sort((a, b) => a.distance - b.distance).slice(0, 200)
// A homography needs at least four point correspondences; geometry must also be suitable.
if (ordered.length < 4) throw new Error('Fewer than four matches')
// queryIdx indexes first-image keypoints; pack their x,y coordinates.
const from = ordered.flatMap(m => { const p = first.get(m.queryIdx)!.pt; return [p.x, p.y] })
// trainIdx indexes second-image keypoints; preserve the same match order.
const to = ordered.flatMap(m => { const p = second.get(m.trainIdx)!.pt; return [p.x, p.y] })
// Pack the coordinate lists as N rows of two-channel float32 points.
// inliers will mark the correspondences consistent with one transform.
using sourcePoints = new Mat(ordered.length, 1, CV_32FC2)
using targetPoints = new Mat(ordered.length, 1, CV_32FC2), inliers = new Mat()
// Copy the first-image coordinates into the source-point matrix.
sourcePoints.data32F.set(from)
// Copy the corresponding second-image coordinates into the target matrix.
targetPoints.data32F.set(to)
// 3. RANSAC fits a first-to-second projective map while rejecting outliers.
// The 3-pixel threshold controls acceptable reprojection error in processed pixels.
using homography = findHomography(sourcePoints, targetPoints, RANSAC, 3, inliers)
// Reject failed fits and fits supported by fewer than four inlier pairs.
if (homography.empty() || countNonZero(inliers) < 4) throw new Error('No stable homography')
// Allocate the destination for the aligned second image.
using output = new Mat()
// For each first-frame output position, look up the corresponding second-frame
// source position with the fitted map. WARP_INVERSE_MAP selects that lookup direction;
// INTER_LINEAR interpolates fractional positions. Output uses the first frame's size.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. ORB detects up to 800 oriented features and binary descriptors.
// Hamming distance compares descriptor bits; true enables mutual-best cross-checking.
using orb = ORB_create(800), matcher = new BFMatcher(NORM_HAMMING, true)
// Factories can return null, so check before using the detector.
if (!orb) throw new Error('ORB factory failed')
// Store each image's feature coordinates separately from its descriptor rows.
using first = new KeyPointVector(), second = new KeyPointVector()
// a/b will hold descriptors; an empty mask allows features anywhere in the image.
using a = new Mat(), b = new Mat(), mask = new Mat()
// Detect keypoints in the first image and write their descriptors into a.
orb.detectAndCompute(image, mask, first, a)
// Do the same for the second image; descriptor row i belongs to keypoint i.
orb.detectAndCompute(nextImage, mask, second, b)
// 2. Allocate match records and the combined visualization image.
using matches = new DMatchVector(), output = new Mat()
// Find mutual-best matches only when both descriptor sets contain features.
if (!a.empty() && !b.empty()) matcher.match(a, b, matches)
// 3. Place the images side by side and connect the proposed keypoint pairs.
// These lines show descriptor similarity, not yet verified geometric agreement.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale frames, an intensity-difference image and a binary mask.
using a = new Mat(), b = new Mat(), difference = new Mat(), mask = new Mat()
// Represent the first frame as brightness instead of three colour channels.
cvtColor(image, a, COLOR_BGR2GRAY)
// Use the same representation for the second frame; they must already align.
cvtColor(nextImage, b, COLOR_BGR2GRAY)
// Smooth the first frame with a 5x5 kernel and sigma 1 pixel to suppress small noise.
GaussianBlur(a, a, { width: 5, height: 5 }, 1)
// Apply the identical smoothing to the second frame before comparing them.
GaussianBlur(b, b, { width: 5, height: 5 }, 1)
// 2. Measure absolute brightness change, so brightening and darkening both count.
absdiff(a, b, difference)
// Changes greater than 25 intensity levels become 255 (white); others become 0.
// This makes a decision mask from continuous difference evidence.
threshold(difference, mask, 25, 255, THRESH_BINARY)
// Choose a small elliptical 3x3 neighbourhood for cleaning that mask.
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
// Closing dilates then erodes, joining small gaps within changed regions.
morphologyEx(mask, mask, MORPH_CLOSE, kernel)
// 3. Prepare one label per pixel, per-region statistics, and x,y centroids.
using labels = new Mat(), stats = new Mat(), centres = new Mat()
// Group connected white pixels. stats rows contain left, top, width, height, area;
// row/label 0 is background. The full lab filters small areas and draws region boxes.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale images, a floating similarity map, and a decision mask.
using a = new Mat(), b = new Mat(), similarity = new Mat(), mask = new Mat()
// Use grayscale for the first image; this recipe does not compare colour alone.
cvtColor(image, a, COLOR_BGR2GRAY)
// Convert the second, already-aligned image to the same grayscale representation.
cvtColor(nextImage, b, COLOR_BGR2GRAY)
// SSIM compares local brightness, contrast and structure. similarity receives
// the local scores; score[0] is their overall grayscale-channel summary.
const score = quality_QualitySSIM_compute(a, b, similarity)
// 2. Mark similarity values at or below 0.8 white. The inverse threshold selects
// disagreement: a larger minimum similarity is stricter and marks more differences.
threshold(similarity, mask, 0.8, 255, THRESH_BINARY_INV)
// Thresholding kept the float depth; convert to an 8-bit mask for later region labelling.
mask.convertTo(mask, CV_8U)
// Choose a 3x3 ellipse so cleanup only bridges small spatial gaps.
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
// 3. Closing reconnects fragmented differences before region labelling in the lab.
morphologyEx(mask, mask, MORPH_CLOSE, kernel)
// Keep the mean score as a summary, but inspect the map to see where changes occurred.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate a grayscale view and a binary foreground mask.
using gray = new Mat(), mask = new Mat()
// Reduce colour to brightness because foreground is defined by intensity here.
cvtColor(image, gray, COLOR_BGR2GRAY)
// A 5x5 blur with sigma 1 suppresses small fluctuations before thresholding.
GaussianBlur(gray, gray, { width: 5, height: 5 }, 1)
// Pixels brighter than 127 become white (255); darker pixels become background (0).
threshold(gray, mask, 127, 255, THRESH_BINARY)
// Choose a 3x3 elliptical neighbourhood, smaller than objects you want to retain.
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
// 2. Opening erodes then dilates: tiny white specks disappear while larger islands remain.
morphologyEx(mask, mask, MORPH_OPEN, kernel)
// Allocate per-pixel labels, per-label statistics, and x,y centroids.
using labels = new Mat(), stats = new Mat(), centroids = new Mat()
// 3. Label connected foreground islands. The returned count includes background label 0.
const count = connectedComponentsWithStats(mask, labels, stats, centroids)
// Accumulate only components large enough to count as intended objects.
let retained = 0
// Start at 1 to skip background. Each stats row has five signed 32-bit integers.
for (let label = 1; label < count; label++) {
  // CC_STAT_AREA selects the pixel-count column; require at least 80 pixels.
  // Touching objects share a label, so this counts connected islands, not semantic objects.
  if (stats.data32S[label * 5 + CC_STAT_AREA] >= 80) retained++
}
// Report the retained island count, which depends on threshold and cleanup choices.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate brightness, foreground mask and distance-to-background images.
using gray = new Mat(), mask = new Mat(), distance = new Mat()
// Allocate candidate seeds, integer watershed labels, and local-maximum scratch images.
using seeds = new Mat(), markers = new Mat(), dilated = new Mat(), peaks = new Mat()
// Convert the colour image to brightness for foreground thresholding.
cvtColor(image, gray, COLOR_BGR2GRAY)
// White pixels (brightness >127) define the touching-object silhouette.
threshold(gray, mask, 127, 255, THRESH_BINARY)
// 2. Measure approximate Euclidean distance to the nearest zero/background pixel.
// DIST_L2 uses Euclidean distance; the 5x5 mask controls this approximation.
distanceTransform(mask, distance, DIST_L2, 5)
// Keep interior pixels farther than 35% of the global maximum distance.
// This height cutoff prevents very shallow bumps from becoming seeds.
threshold(distance, seeds, minMaxLoc(distance).maxVal * 0.35, 255, THRESH_BINARY)
// Convert the float threshold result into an 8-bit candidate mask.
seeds.convertTo(seeds, CV_8U)
// A 31x31 ellipse searches roughly 15 pixels around each point for stronger peaks.
using neighborhood = getStructuringElement(MORPH_ELLIPSE, { width: 31, height: 31 })
// At each pixel, dilation records the largest distance in that neighbourhood.
dilate(distance, dilated, neighborhood)
// Select pixels equal to the neighbourhood maximum: candidate object centres.
compare(distance, dilated, peaks, CMP_GE)
// Keep only local maxima that also pass the interior-distance cutoff.
bitwise_and(peaks, seeds, seeds)
// 3. Give each connected seed area its own signed 32-bit integer label.
connectedComponents(seeds, markers)
// Encode watershed markers: 1 is known background, 2+ are foreground seeds,
// and 0 is unknown foreground that must be assigned during flooding.
for (let i = 0; i < markers.data32S.length; i++) {
  // Read the seed-component ID for this pixel (0 if it was not a seed).
  const label = markers.data32S[i]
  // Use the original mask to distinguish true background from unseeded foreground.
  markers.data32S[i] = mask.data[i] === 0 ? 1 : label ? label + 1 : 0
}
// 4. Grow competing regions over the colour image. markers is overwritten
// with region IDs; -1 marks a boundary where regions meet. Inspect seeds first:
// watershed cannot split two objects if they were given only one foreground seed.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate brightness, a binary silhouette and contour hierarchy metadata.
using gray = new Mat(), mask = new Mat(), hierarchy = new Mat()
// A MatVector will hold each extracted contour as its own coordinate matrix.
using contours = new MatVector()
// Define the silhouette through brightness rather than colour.
cvtColor(image, gray, COLOR_BGR2GRAY)
// Select bright foreground above 127; this decision defines the measured boundary.
threshold(gray, mask, 127, 255, THRESH_BINARY)
// 2. RETR_EXTERNAL keeps outer silhouettes and ignores interior holes.
// CHAIN_APPROX_SIMPLE compresses straight boundary runs to their endpoints.
findContours(mask, contours, hierarchy, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
// Measure each silhouette independently.
for (let i = 0; i < contours.size(); i++) {
  // get() returns an owned handle; using releases that handle after this iteration.
  using contour = contours.get(i)!
  // Area is enclosed contour area in pixels squared. arcLength(..., true)
  // measures a closed boundary perimeter in pixels.
  const area = contourArea(contour), perimeter = arcLength(contour, true)
  // Ignore contours smaller than 80 px². Circularity 4*pi*area/perimeter²
  // describes compactness (an ideal circle has value 1); these are not physical units.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate the alternative colour representation and the resulting selection mask.
using hsv = new Mat(), mask = new Mat()
// HSV separates hue from saturation and brightness, making a colour interval easier to choose.
cvtColor(image, hsv, COLOR_BGR2HSV)
// Lower bounds are H=25, S=40, V=0. CV_8UC3 stores three 8-bit channels.
// The fourth scalar entry is unused because this matrix has only three channels.
using low = new Mat(image.rows, image.cols, CV_8UC3, [25, 40, 0, 0])
// Upper bounds are H=95, S=255, V=255; 8-bit HSV hue ranges from 0 to 179.
// Both bound Mats are filled with the same bound triplet at every pixel.
using high = new Mat(image.rows, image.cols, CV_8UC3, [95, 255, 255, 0])
// 2. Select pixels within all three channel intervals, inclusively.
// The saturation floor excludes grayish pixels with poorly defined hue.
inRange(hsv, low, high, mask)
// Choose a small 3x3 ellipse for filling gaps in the selected colour regions.
using kernel = getStructuringElement(MORPH_ELLIPSE, { width: 3, height: 3 })
// Closing fills small holes and connects nearby selected pixels.
morphologyEx(mask, mask, MORPH_CLOSE, kernel)
// 3. Allocate component IDs, five-column region statistics and x,y centroids.
using labels = new Mat(), stats = new Mat(), centres = new Mat()
// Group the cleaned mask into connected colour regions. Label 0 is background;
// the full lab uses each region's area and bounds to filter and draw boxes.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// rect is an in-bounds { x, y, width, height } rectangle in processed pixels.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale, a silhouette mask and hierarchy metadata for contours.
using gray = new Mat(), mask = new Mat(), hierarchy = new Mat()
// Keep contour coordinates in a vector and reserve an independent output Mat.
using contours = new MatVector(), output = new Mat()
// Convert colour to brightness for the simple bright-foreground selection.
cvtColor(image, gray, COLOR_BGR2GRAY)
// Mark values greater than 127 as white foreground.
threshold(gray, mask, 127, 255, THRESH_BINARY)
// 2. Extract external outlines; straight boundary runs are compressed.
// The full lab also closes small gaps in the mask before this extraction.
findContours(mask, contours, hierarchy, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
// Remember the largest enclosed area and its axis-aligned bounds.
// The initial rect is only a placeholder; a successful search replaces it.
let largest = 0, bounds = rect
// Consider each candidate foreground outline.
for (let i = 0; i < contours.size(); i++) {
  // Release each vector-returned contour handle when this iteration ends.
  using contour = contours.get(i)!
  // Measure enclosed contour area to choose the largest foreground candidate.
  const area = contourArea(contour)
  // When a larger object wins, keep its bounding rectangle as the crop region.
  if (area > largest) { largest = area; bounds = boundingRect(contour) }
}
// Do not silently return an unrelated crop when thresholding found no object.
if (!largest) throw new Error('No foreground found')
// 3. An ROI selects existing pixels without resizing and shares the source storage.
using crop = image.roi(bounds)
// Copy into independent storage so the output remains valid after the source is released.
// The full lab adds configurable padding and clips those bounds to the image.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// rect is an in-bounds { x, y, width, height } rectangle in processed pixels.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate GrabCut labels and its background/foreground colour-model buffers.
// Those model Mats hold learned statistics, not preview images.
using mask = new Mat(), background = new Mat(), foreground = new Mat()
// Initialize from rect: outside is background, inside is possible foreground.
// Run three refinement iterations. Keep the entire subject inside the rectangle.
grabCut(image, mask, rect, background, foreground, 3, GC_INIT_WITH_RECT)
// 2. Allocate a four-channel image whose alpha can express transparency.
using rgba = new Mat()
// Reorder BGR into RGB and add alpha; the original colour image stays unchanged.
cvtColor(image, rgba, COLOR_BGR2RGBA)
// 3. Convert GrabCut's four discrete labels into alpha, one pixel at a time.
for (let i = 0; i < mask.data.length; i++) {
  // Read this pixel's definite/probable foreground/background classification.
  const label = mask.data[i]
  // RGBA has four bytes per pixel; offset 3 is alpha. Keep definite or probable
  // foreground opaque (255), and make background transparent (0).
  // This core example has a hard edge; the full lab optionally feathers the mask.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// rect is an in-bounds { x, y, width, height } rectangle in processed pixels.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate GrabCut labels and its background/foreground colour-model buffers.
// Those model Mats hold learned statistics, not preview images.
using mask = new Mat(), background = new Mat(), foreground = new Mat()
// Initialize from rect: outside is background, inside is possible foreground.
// Run three refinement iterations. Keep the entire subject inside the rectangle.
grabCut(image, mask, rect, background, foreground, 3, GC_INIT_WITH_RECT)
// 2. Reuse the label Mat as a binary mask for compositing.
for (let i = 0; i < mask.data.length; i++) {
  // Read this pixel's four-state GrabCut label before replacing it.
  const label = mask.data[i]
  // White (255) retains definite/probable foreground; black (0) means background.
  mask.data[i] = label === GC_FGD || label === GC_PR_FGD ? 255 : 0
}
// 3. Allocate a replacement layer with blurred surroundings.
using output = new Mat()
// Use sigma 8 pixels. A zero kernel size lets OpenCV choose it from sigma.
// Blur the whole image first so neighbourhoods extend beyond the subject boundary.
GaussianBlur(image, output, { width: 0, height: 0 }, 8)
// Restore original sharp pixels wherever the foreground mask is nonzero.
// This is a hard selection; the full lab uses a softened alpha-weighted transition.
image.copyTo(output, mask)
`,
  'blur-region': `import {
  CV_8U,
  GaussianBlur,
  Mat,
  rectangle
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// rect is an in-bounds { x, y, width, height } rectangle in processed pixels.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Create an 8-bit black mask matching the image: no pixel is selected initially.
using mask = Mat.zeros(image.rows, image.cols, CV_8U)
// Allocate a blurred alternative layer and a separate final output.
using blurred = new Mat(), output = new Mat()
// Fill rect white with thickness -1. The scalar's first value is used for this
// single-channel mask, and the bottom-right pixel coordinate is inclusive.
rectangle(mask, { x: rect.x, y: rect.y },
  { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 }, [255, 0, 0, 0], -1)
// 2. Blur the entire image at sigma 8 pixels; zero kernel size is derived from sigma.
// Using the whole frame preserves neighbourhood context at the selection boundary.
GaussianBlur(image, blurred, { width: 0, height: 0 }, 8)
// 3. Start the output as an independent copy of the unmodified image.
image.copyTo(output)
// Replace only nonzero-mask pixels with blurred pixels; everything outside stays identical.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate denoised BGR, Lab colour, its lightness channel and final BGR output.
using denoised = new Mat(), lab = new Mat(), lightness = new Mat(), output = new Mat()
// Average similar patches to reduce noise before contrast enhancement amplifies it.
// The two 8s control brightness/colour denoising strength; 7 and 21 are the
// template-patch and search-window widths in pixels.
fastNlMeansDenoisingColored(image, denoised, 8, 8, 7, 21)
// 2. Split the denoised image into Lab lightness and two colour components.
cvtColor(denoised, lab, COLOR_BGR2Lab)
// Channel 0 is lightness (L); keep the a/b colour channels in lab unchanged.
extractChannel(lab, lightness, 0)
// 3. Limit local histogram contrast amplification with clip limit 2.
// The 8x8 size means an eight-by-eight grid of tiles across the image, not 8-pixel tiles.
using clahe = createCLAHE(2, { width: 8, height: 8 })
// Check the nullable factory result before applying the algorithm.
if (!clahe) throw new Error('CLAHE factory failed')
// Enhance only local lightness contrast; the same Mat is used as source and destination.
clahe.apply(lightness, lightness)
// Put enhanced L back into channel 0 beside the retained colour components.
insertChannel(lightness, lab, 0)
// Return to BGR for display or encoding. This cannot restore detail erased by denoising.
cvtColor(lab, output, COLOR_Lab2BGR)
`,
  'sharpen-details': `import {
  GaussianBlur,
  Mat,
  addWeighted
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// Allocate a smooth reference and an independent sharpened output.
using blurred = new Mat(), output = new Mat()
// 1. A sigma-2 blur removes fine variation; zero kernel size is chosen from sigma.
// The difference between original and blur is the signed detail we want to amplify.
GaussianBlur(image, blurred, { width: 0, height: 0 }, 2)
// 2. Add one extra copy of that detail. Zero would leave the original unchanged.
const amount = 1
// original + amount*(original - blurred) equals
// (1 + amount)*original - amount*blurred. The zero adds no brightness offset.
// The 8-bit result saturates to 0..255; large amounts amplify noise and create halos.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// Allocate brightness, a signed derivative, numeric energy and a display-only image.
using gray = new Mat(), derivative = new Mat(), energy = new Mat(), display = new Mat()
// Measure changes in brightness without mixing separate colour-channel scores.
cvtColor(image, gray, COLOR_BGR2GRAY)
// 1. A 3x3 Laplacian emphasizes rapid spatial changes. CV_32F preserves
// negative as well as positive responses; unsigned output would clip negatives.
Laplacian(gray, derivative, CV_32F, 3)
// 2. Square the derivative pointwise so opposite signs add energy instead of cancelling.
multiply(derivative, derivative, energy)
// Average that energy in a 15x15 window to obtain a local, less noisy score.
blur(energy, energy, { width: 15, height: 15 })
// 3. Map this image's minimum/maximum energy to 0..255 only for visualization.
// Keep the float energy Mat for real measurements; display brightness is not an absolute score.
normalize(energy, display, 0, 255, NORM_MINMAX, CV_8U)
// Report the mean native energy. Texture and noise also raise it, so compare
// the same scene region at the same resolution when using it to assess focus.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale, an edge map and contour hierarchy metadata.
using gray = new Mat(), edges = new Mat(), hierarchy = new Mat()
// Store candidate outlines as a vector of coordinate Mats.
using contours = new MatVector()
// Convert the page photo to brightness before boundary detection.
cvtColor(image, gray, COLOR_BGR2GRAY)
// A 5x5 Gaussian with sigma 1 suppresses small noisy edges.
GaussianBlur(gray, gray, { width: 5, height: 5 }, 1)
// Keep strong gradients above 120 and connected weaker edges above 40.
Canny(gray, edges, 40, 120)
// 2. RETR_LIST retrieves outlines without organizing parent/child hierarchy.
// CHAIN_APPROX_SIMPLE compresses straight runs so shape approximation has fewer points.
findContours(edges, contours, hierarchy, RETR_LIST, CHAIN_APPROX_SIMPLE)
// Inspect each candidate outline for a plausible four-sided page.
for (let i = 0; i < contours.size(); i++) {
  // Own the retrieved contour handle and allocate its simplified polygon.
  using contour = contours.get(i)!, polygon = new Mat()
  // Simplify the closed outline with a tolerance of 2% of its perimeter.
  // This removes small wiggles while retaining its dominant corners.
  approxPolyDP(contour, polygon, 0.02 * arcLength(contour, true), true)
  // Four vertices and convexity make a candidate quadrilateral; area ranks candidates.
  // This short example lists candidates rather than guessing a page when none exists.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// Allocate brightness, estimated lighting, corrected brightness and binary output.
using gray = new Mat(), illumination = new Mat(), normalized = new Mat(), output = new Mat()
// Convert the page to grayscale so the chain works on ink/background intensity.
cvtColor(image, gray, COLOR_BGR2GRAY)
// Use floating-point arithmetic for the upcoming division without early integer rounding.
gray.convertTo(gray, CV_32F)
// 1. A broad sigma-20 blur estimates slow lighting variation while averaging thin strokes.
// Zero kernel size is selected from sigma; choose a scale wider than the text strokes.
GaussianBlur(gray, illumination, { width: 0, height: 0 }, 20)
// Clamp the estimated illumination to at least one intensity unit to avoid division by zero.
for (let i = 0; i < illumination.data32F.length; i++) illumination.data32F[i] = Math.max(1, illumination.data32F[i])
// 2. Compute 220 * original / estimatedLighting at each pixel.
// This removes approximate multiplicative shading and places page background near 220.
divide(gray, illumination, normalized, 220)
// Adaptive thresholding expects 8-bit input; convert the corrected values back to 0..255.
normalized.convertTo(normalized, CV_8U)
// 3. Compare each pixel with a Gaussian-weighted local mean minus C=9,
// using a 31x31 neighbourhood. THRESH_BINARY makes brighter page pixels 255
// and darker strokes 0; larger C generally removes more faint ink as well as noise.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale, edge pixels and detected line-segment coordinates.
using gray = new Mat(), edges = new Mat(), lines = new Mat()
// Use brightness for line detection while keeping the colour input for final rotation.
cvtColor(image, gray, COLOR_BGR2GRAY)
// Build an edge map using low/high gradient thresholds 50 and 150.
Canny(gray, edges, 50, 150)
// 2. Detect line segments with 1-pixel distance bins and 1-degree angle bins.
// Require 25 votes, a length of at least 50 pixels, and gaps of at most 15 pixels.
HoughLinesP(edges, lines, 1, Math.PI / 180, 25, 50, 15)
// Collect near-horizontal line directions as candidates for the page tilt.
const angles: number[] = []
// Every segment occupies four integers: its start x,y followed by end x,y.
for (let i = 0; i < lines.data32S.length; i += 4) {
  // Read one segment's two endpoints from the native coordinate array.
  const [x1, y1, x2, y2] = lines.data32S.slice(i, i + 4)
  // atan2 gives its direction in radians; multiply by 180/pi for degrees.
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
  // Keep slopes within 25 degrees of horizontal to exclude vertical page edges.
  // The full lab also normalizes reversed endpoint directions before this check.
  if (Math.abs(angle) <= 25) angles.push(angle)
}
// Do not rotate arbitrarily if no suitable line evidence was found.
if (!angles.length) throw new Error('No near-horizontal lines found')
// 3. Sorting lets the middle angle act as a robust tilt estimate despite some outliers.
angles.sort((a,b) => a-b)
// Build a rotation about the image centre using that middle angle. Scale 1 keeps size.
// In image coordinates (y downward), this OpenCV rotation levels the measured slope.
using rotation = getRotationMatrix2D({ x: image.cols / 2, y: image.rows / 2 }, angles[Math.floor(angles.length / 2)], 1)
// Allocate the rotated colour result.
using output = new Mat()
// Resample into the original canvas dimensions. This short form uses default
// interpolation and border fill; the full lab uses cubic interpolation and white borders.
warpAffine(image, output, rotation, { width: image.cols, height: image.rows })
`,
  'stereo-depth': `import {
  COLOR_BGR2GRAY,
  Mat,
  StereoSGBM_create,
  cvtColor
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// nextImage is the equally sized second frame from the same engine.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate grayscale stereo views and a signed fixed-point disparity map.
// Inputs must already be calibrated/rectified so matches lie on the same image row.
using left = new Mat(), right = new Mat(), disparity = new Mat()
// Convert the left colour view to grayscale for block matching.
cvtColor(image, left, COLOR_BGR2GRAY)
// Convert the right view in the same way; matching uses horizontal offsets.
cvtColor(nextImage, right, COLOR_BGR2GRAY)
// 2. Search 64 disparities starting at 0 with a 9x9 matching block.
// The last two arguments are smoothness penalties P1 and P2; 81 is the
// block area (9*9) for one grayscale channel, with P2 larger to discourage jumps.
using stereo = StereoSGBM_create(0, 64, 9, 8 * 81, 32 * 81)
// Check the nullable matcher factory before computing disparity.
if (!stereo) throw new Error('Stereo factory failed')
// Estimate disparity x_left - x_right in pixels and store it multiplied by 16.
stereo.compute(left, right, disparity)
// 3. Example calibration: focal length 500 processed-image pixels, baseline 0.1 metres.
// Replace these with real calibration, adjusting focal length when images are resized.
const focalPixels = 500, baselineMetres = 0.1
// Create an independent JavaScript float array, one depth value per pixel.
const depthMetres = Float32Array.from(disparity.data16S, fixed => {
  // Divide the signed 16-bit fixed-point value by 16 to recover pixel disparity.
  const pixels = fixed / 16
  // Rectified stereo geometry gives Z = focalLength * baseline / disparity.
  // Reject nonpositive disparity and use zero as an invalid marker, not zero distance.
  return pixels > 0 ? focalPixels * baselineMetres / pixels : 0
})
// Inspect this numeric depth field; arbitrary calibration produces arbitrary depth scale.
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
} from '@banou/opencv-wasm'

// The engine is already initialized; image is an 8-bit BGR Mat.
// "using" releases native handles at scope exit; inspect or copy outputs before then.

// 1. Allocate an image with reduced variation inside colour regions.
using smooth = new Mat()
// Use a 7-pixel neighbourhood, colour sigma 40 and spatial sigma 5 pixels.
// Bilateral weights favour nearby, similar colours to smooth while retaining strong edges.
bilateralFilter(image, smooth, 7, 40, 5)
// 2. Each pixel becomes one sample row with three BGR values. CV_32F
// stores each component as a float, the format expected by k-means.
using samples = new Mat(smooth.rows * smooth.cols, 3, CV_32F)
// Copy interleaved 8-bit BGR components into float storage without changing their order.
samples.data32F.set(smooth.data)
// Allocate each sample's integer cluster ID and the learned BGR colour centres.
using labels = new Mat(), centres = new Mat()
// 3. Learn six colour groups. Stop after at most 20 updates or centre motion
// within epsilon 0.5; the flags enable both criteria. Use one attempt and
// k-means++ initialization to spread the starting centres across the samples.
kmeans(samples, 6, labels,
  { type: TERM_CRITERIA_COUNT | TERM_CRITERIA_EPS, maxCount: 20, epsilon: 0.5 },
  1, KMEANS_PP_CENTERS, centres)
// labels.data32S chooses a BGR triplet from centres.data32F for each pixel.
`
}
