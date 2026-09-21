import type { LabControl, LabRecipe } from '../lib/lab/types'
/** A practical, executable chain linked to the individual algorithm explanations. */
export type CookbookRecipe = {
  id: string
  title: string
  category: string
  summary: string
  steps: { title: string; detail: string; algorithm: string }[]
  caveat: string
  lab: LabRecipe
}
const n = (key: string, label: string, value: number, min: number, max: number, step = 1): LabControl => ({
  key,
  label,
  value,
  min,
  max,
  step
})
const rect = (): LabControl[] => [
  n('x', 'Region left (%)', 12, 0, 99, 0.1),
  n('y', 'Region top (%)', 8, 0, 99, 0.1),
  n('width', 'Region width (%)', 38, 0.1, 100, 0.1),
  n('height', 'Region height (%)', 75, 0.1, 100, 0.1)
]
const threshold = () => n('threshold', 'Intensity threshold', 127, 0, 255)
const area = () => n('area', 'Minimum area (pixels)', 80, 1, 5000)
const kernel = () => n('kernel', 'Cleanup kernel (odd pixels)', 3, 1, 15, 2)
const step = (title: string, detail: string, algorithm: string) => ({ title, detail, algorithm })
const recipe = (
  id: string,
  title: string,
  category: string,
  summary: string,
  steps: CookbookRecipe['steps'],
  caveat: string,
  controls: LabControl[],
  extra: Partial<LabRecipe> = {}
): CookbookRecipe => ({
  id,
  title,
  category,
  summary,
  steps,
  caveat,
  lab: { note: summary, controls, maxSide: 800, ...extra }
})
/** Curated recipes cover common multi-stage image tasks. Every recipe executes native OpenCV in the shared lab. */
export const cookbook: CookbookRecipe[] = [
  recipe(
    'motion-vectors',
    'Measure regional motion vectors',
    'Motion and matching',
    'Measure delta vectors between a before frame and an after frame. See how far each region translated during a camera pan, inspect dense dx/dy values, or subtract the dominant image motion.',
    [
      step(
        'Compensate for the initial pan',
        'Phase correlation estimates a translation, then each frame is warped into the other’s coordinates before local flow estimation.',
        'phase-correlation'
      ),
      step(
        'Estimate dense displacement',
        'Pyramidal Farneback flow estimates local residual motion in both directions. The preliminary pan is added back to obtain full displacement.',
        'optical-flow-farneback'
      ),
      step(
        'Check texture and summarize regions',
        'Corner response and backward consistency filter uncertain samples. Each grid cell reports the median of its accepted vectors.',
        'good-features'
      )
    ],
    'Vectors map input pixels to the second image: positive dx is right, positive dy is down, in processed-image pixels per frame pair. The dominant median describes image motion, not physical camera motion. Subtracting it removes translation only. Rotation, parallax, occlusion, lighting changes and repeated patterns can defeat the estimates. Passing the checks is not a probability of correctness; dark or unlabelled cells have insufficient evidence. Both images are processed at the first image’s dimensions.',
    [
      n('cell', 'Region size (pixels)', 48, 16, 128, 8),
      n('window', 'Flow window (odd pixels)', 25, 5, 61, 2),
      n('levels', 'Pyramid levels', 4, 1, 6),
      n('tolerance', 'Forward/backward tolerance (px)', 1.5, 0.25, 5, 0.25),
      n('texture', 'Minimum texture (% strongest response)', 0.5, 0.1, 10, 0.1),
      n('range', 'Dense colour scale (pixels)', 24, 1, 100),
      n('gain', 'Arrow display multiplier', 1, 1, 8),
      {
        key: 'mode',
        label: 'Vector view',
        value: 'total',
        options: [
          ['total', 'Total displacement'],
          ['residual', 'Subtract dominant translation']
        ]
      }
    ],
    { second: true, maxSide: 640 }
  ),
  recipe(
    'track-region',
    'Track a selected region',
    'Motion and matching',
    'Upload a before frame and an after frame, then draw a region on the first image. Track its corners and estimate where that region moved.',
    [
      step('Find corners in the region', 'Restrict Shi-Tomasi detection to the selected rectangle.', 'good-features'),
      step(
        'Track forwards and backwards',
        'Lucas-Kanade follows each point into the next frame; a backward check rejects inconsistent tracks.',
        'optical-flow-lk'
      ),
      step(
        'Fit a robust transform',
        'RANSAC fits translation, rotation and uniform scale; the transformed rectangle is drawn on the second frame.',
        'affine-warp'
      )
    ],
    'Needs texture, overlap and moderate motion. The fitted region is a geometric estimate, not a semantic object boundary. Tracking failure is reported when too few consistent points remain.',
    [
      ...rect(),
      n('features', 'Maximum corners', 150, 20, 500, 10),
      n('tolerance', 'Forward/backward tolerance (px)', 1.5, 0.5, 5, 0.5)
    ],
    { second: true }
  ),
  recipe(
    'locate-template',
    'Find a patch in another image',
    'Motion and matching',
    'Draw a patch on the first image and locate its best matching position in the second image.',
    [
      step('Crop the selected patch', 'Extract the first-image rectangle as the template.', 'resize'),
      step('Search the next image', 'Normalized correlation scores every possible placement.', 'template-matching'),
      step(
        'Mark the strongest response',
        'Use the peak location to draw the template-sized rectangle on the second image.',
        'template-matching'
      )
    ],
    'Works best without rotation, scale changes or substantial appearance changes. A low score still has a maximum and is not proof of a match.',
    [...rect(), n('score', 'Minimum accepted score', 0.6, 0, 1, 0.05)],
    { second: true }
  ),
  recipe(
    'align-images',
    'Align two overlapping images',
    'Motion and matching',
    'Match ORB features, reject inconsistent correspondences with RANSAC, then warp the second image into the first image’s coordinates.',
    [
      step('Describe both images', 'ORB produces oriented keypoints and binary descriptors.', 'orb'),
      step('Keep consistent matches', 'Hamming matches feed a RANSAC homography.', 'brute-force-matching'),
      step(
        'Warp to the reference',
        'Apply the inverse mapping so the second image lines up with the first.',
        'homography'
      )
    ],
    'A homography assumes a planar scene or mostly rotational camera motion. Parallax and moving objects can stay misaligned.',
    [n('features', 'ORB features', 800, 200, 2000, 100), n('tolerance', 'RANSAC tolerance (px)', 3, 1, 10)],
    { second: true }
  ),
  recipe(
    'match-features',
    'Visualize verified feature matches',
    'Motion and matching',
    'See which ORB descriptor matches agree with one estimated projective transform.',
    [
      step('Extract ORB features', 'Detect and describe both images.', 'orb'),
      step('Match descriptors', 'Cross-check binary descriptors with Hamming distance.', 'brute-force-matching'),
      step('Verify geometry', 'Draw only correspondences accepted by RANSAC.', 'homography')
    ],
    'Geometric consistency is stronger than descriptor similarity, but repeated patterns can still produce a wrong transform.',
    [n('features', 'ORB features', 800, 200, 2000, 100), n('tolerance', 'RANSAC tolerance (px)', 3, 1, 10)],
    { second: true }
  ),
  recipe(
    'detect-motion',
    'Find changed regions between frames',
    'Motion and matching',
    'Compare two frames, suppress noise, clean the difference mask and draw connected changed regions.',
    [
      step('Suppress image noise', 'Gaussian smoothing reduces isolated pixel differences.', 'gaussian-blur'),
      step('Threshold frame differences', 'Absolute grayscale differences become a binary mask.', 'threshold'),
      step(
        'Group changed pixels',
        'Morphological closing and component area filtering produce region boxes.',
        'connected-components'
      )
    ],
    'Camera movement and lighting changes also appear as motion. Use aligned frames for object-motion analysis.',
    [n('threshold', 'Difference threshold', 25, 1, 150), kernel(), area()],
    { second: true }
  ),
  recipe(
    'compare-images',
    'Highlight structural image differences',
    'Motion and matching',
    'Compute a local SSIM map, threshold low similarity and highlight contiguous differences on the second image.',
    [
      step('Measure structural similarity', 'SSIM compares local means, contrast and structure.', 'quality-metrics'),
      step(
        'Select low-similarity pixels',
        'Threshold the numeric map, retaining its original values for inspection.',
        'threshold'
      ),
      step('Draw difference regions', 'Close small gaps and reject tiny components.', 'connected-components')
    ],
    'Images must already be aligned. SSIM is not a semantic assessment and colour-only changes may be missed in this grayscale recipe.',
    [n('similarity', 'Minimum local SSIM', 0.8, 0, 1, 0.05), kernel(), area()],
    { second: true }
  ),
  recipe(
    'count-objects',
    'Count separated objects',
    'Regions and masks',
    'Separate bright objects from a dark background, clean the mask and count connected regions that pass an area filter.',
    [
      step('Create a foreground mask', 'Smooth grayscale intensity and apply a threshold.', 'threshold'),
      step('Remove small noise', 'Morphological opening removes isolated specks.', 'morphology'),
      step(
        'Count components',
        'Connected-component statistics provide areas, centroids and boxes.',
        'connected-components'
      )
    ],
    'Touching objects become one component. Uneven lighting may need local thresholding or colour segmentation.',
    [threshold(), kernel(), area()],
    { sample: 'objects' }
  ),
  recipe(
    'segment-touching',
    'Separate touching objects',
    'Regions and masks',
    'Use peaks in the foreground distance map as seeds for watershed segmentation.',
    [
      step('Threshold the foreground', 'Build a binary object mask.', 'threshold'),
      step('Find interior seeds', 'Distance peaks identify well-inside pixels of each object.', 'distance-transform'),
      step('Flood from the seeds', 'Watershed separates regions and marks their boundaries.', 'watershed')
    ],
    'Seed quality controls the split. Very strong overlap can leave only one peak; noise can create too many seeds. Lower the peak height for smaller objects and adjust the suppression radius to their spacing.',
    [
      threshold(),
      n('seed', 'Minimum peak height (fraction of maximum)', 0.35, 0.05, 0.95, 0.05),
      n('radius', 'Peak suppression radius (px)', 15, 1, 50)
    ],
    { sample: 'objects' }
  ),
  recipe(
    'measure-shapes',
    'Measure contour geometry',
    'Regions and masks',
    'Threshold a silhouette, simplify its outline, and report each retained shape’s area, perimeter, circularity and centroid.',
    [
      step('Extract silhouettes', 'Threshold grayscale pixels.', 'threshold'),
      step('Find and simplify contours', 'Approximate each outline with a polygon.', 'polygon-approximation'),
      step('Measure geometry', 'Contour area, arc length and moments summarize each shape.', 'moments')
    ],
    'Measurements are in processed-image pixels, not physical units. Perspective and resolution affect them.',
    [threshold(), area(), n('epsilon', 'Polygon tolerance (% perimeter)', 1, 0.1, 10, 0.1)],
    { sample: 'objects' }
  ),
  recipe(
    'colour-mask',
    'Select and group a colour',
    'Regions and masks',
    'Select an HSV colour range, close small holes and outline matching colour regions.',
    [
      step('Convert BGR to HSV', 'Separate hue from brightness.', 'colour-conversion'),
      step('Select the colour interval', 'Apply hue and saturation bounds.', 'in-range'),
      step(
        'Clean and group the selection',
        'Morphology and connected components turn pixels into regions.',
        'morphology'
      )
    ],
    'HSV hue is 0..179. Red may wrap across zero and need two intervals; this recipe demonstrates one contiguous interval.',
    [
      n('hueMin', 'Minimum hue', 25, 0, 179),
      n('hueMax', 'Maximum hue', 95, 0, 179),
      n('saturation', 'Minimum saturation', 40, 0, 255),
      kernel(),
      area()
    ]
  ),
  recipe(
    'crop-object',
    'Crop the largest foreground object',
    'Regions and masks',
    'Threshold and clean a mask, find the largest external contour, then crop its bounding box with padding.',
    [
      step('Build a clean mask', 'Threshold and close small gaps.', 'morphology'),
      step('Find the largest object', 'Compare external contour areas.', 'contours'),
      step('Crop its bounding rectangle', 'Add a configurable margin while staying inside the image.', 'resize')
    ],
    'The largest bright component is not always the subject. This produces a rectangular crop, not a cutout.',
    [threshold(), kernel(), n('padding', 'Crop padding (pixels)', 12, 0, 80)],
    { sample: 'objects' }
  ),
  recipe(
    'remove-background',
    'Create a transparent cutout',
    'Regions and masks',
    'Draw a rectangle around the subject, refine its foreground mask with GrabCut, then export the cutout as RGBA.',
    [
      step(
        'Initialize foreground models',
        'The region interior is possible foreground; its exterior is background.',
        'grabcut'
      ),
      step('Refine the mask', 'GrabCut alternates colour models and graph cuts.', 'grabcut'),
      step(
        'Build an alpha channel',
        'Optionally soften the binary boundary and attach alpha to the original colour.',
        'gaussian-blur'
      )
    ],
    'Keep the entire subject inside the rectangle and leave background outside. Feathering softens a mask; it does not recover unknown edge colours.',
    [...rect(), n('iterations', 'GrabCut iterations', 3, 1, 5), n('feather', 'Alpha feather radius', 1, 0, 5)],
    { maxSide: 512 }
  ),
  recipe(
    'blur-background',
    'Keep a subject sharp',
    'Photography',
    'Select the subject, separate it with GrabCut, then blend it over a blurred version of the image.',
    [
      step('Separate the subject', 'GrabCut creates a foreground mask from the rectangle.', 'grabcut'),
      step('Blur the surroundings', 'Gaussian filtering produces the background layer.', 'gaussian-blur'),
      step('Blend with the mask', 'A softened mask keeps foreground details sharp.', 'filter2d')
    ],
    'Imperfect masks can blur subject edges or retain background patches. This is mask-based blur, not an optical depth-of-field simulation.',
    [...rect(), n('iterations', 'GrabCut iterations', 3, 1, 5), n('sigma', 'Background blur sigma', 8, 1, 20)],
    { maxSide: 512 }
  ),
  recipe(
    'blur-region',
    'Blur a selected region',
    'Photography',
    'Draw an area to blur while preserving the rest of the image.',
    [
      step('Make a region mask', 'Convert the selected rectangle into a binary mask.', 'threshold'),
      step('Blur the image', 'Gaussian filtering builds a smooth replacement.', 'gaussian-blur'),
      step('Copy through the mask', 'Only selected pixels receive the blurred values.', 'filter2d')
    ],
    'Blur strength depends on the processed resolution. The rectangular boundary remains abrupt.',
    [...rect(), n('sigma', 'Blur sigma', 8, 1, 25)]
  ),
  recipe(
    'denoise-detail',
    'Denoise and restore local contrast',
    'Photography',
    'Reduce colour noise, then enhance luminance contrast without applying separate histogram equalization to each colour channel.',
    [
      step('Remove similar-patch noise', 'Colour nonlocal means averages matching patches.', 'nonlocal-means'),
      step('Work in Lab luminance', 'Separate lightness from colour.', 'colour-conversion'),
      step('Enhance local lightness', 'CLAHE adjusts the L channel before conversion back to BGR.', 'clahe')
    ],
    'Large denoising strengths erase texture; aggressive contrast enhancement can expose remaining noise.',
    [n('strength', 'Denoising strength', 8, 1, 30), n('clip', 'CLAHE contrast limit', 2, 0.5, 6, 0.5)],
    { maxSide: 640 }
  ),
  recipe(
    'sharpen-details',
    'Sharpen edges with an unsharp mask',
    'Photography',
    'Subtract a smoothed image to isolate detail, then add a controlled amount of that detail back.',
    [
      step('Estimate the smooth image', 'Gaussian blur removes high-frequency detail.', 'gaussian-blur'),
      step('Extract signed detail', 'Subtract the blur from the original in floating point.', 'filter2d'),
      step('Add the detail back', 'Weighted addition sharpens the output.', 'filter2d')
    ],
    'High amounts create halos and amplify noise. The display clamps final values to 8-bit colour.',
    [n('sigma', 'Blur sigma', 2, 0.5, 8, 0.5), n('amount', 'Detail amount', 1, 0, 3, 0.1)]
  ),
  recipe(
    'focus-map',
    'Inspect local sharpness',
    'Photography',
    'Compute a Laplacian response, square it and average locally to visualize high-frequency energy.',
    [
      step('Measure second derivatives', 'A signed Laplacian highlights rapid intensity changes.', 'laplacian'),
      step('Measure local energy', 'Square responses and average in a neighbourhood.', 'box-filter'),
      step(
        'Visualize the field',
        'Normalize the energy for display; retain numeric values for inspection.',
        'histogram-equalization'
      )
    ],
    'Texture and noise increase this score too. It is not a calibrated focus or perceptual quality measurement.',
    [n('window', 'Energy window (odd pixels)', 15, 3, 51, 2)]
  ),
  recipe(
    'scan-document',
    'Find and flatten a document',
    'Documents',
    'Find the largest convex quadrilateral in the edge map, correct its perspective, then produce a locally thresholded document view.',
    [
      step('Detect document outlines', 'Blur and Canny produce candidate boundaries.', 'canny'),
      step(
        'Choose four corners',
        'Approximate contours and retain the largest convex quadrilateral.',
        'polygon-approximation'
      ),
      step(
        'Flatten and binarize',
        'Perspective warping and adaptive thresholding create a readable scan.',
        'homography'
      )
    ],
    'The page must have a visible four-sided border. The recipe reports failure if none is found; it does not invent corners.',
    [n('low', 'Canny low threshold', 40, 1, 150), n('offset', 'Adaptive threshold C', 9, -10, 30)],
    { sample: 'document' }
  ),
  recipe(
    'clean-document',
    'Clean uneven document lighting',
    'Documents',
    'Estimate the background illumination, divide it out, then apply local thresholding.',
    [
      step('Estimate illumination', 'A broad Gaussian blur models slowly varying lighting.', 'gaussian-blur'),
      step('Normalize the page', 'Divide grayscale intensity by that background estimate.', 'filter2d'),
      step('Separate ink', 'Adaptive thresholding preserves locally dark strokes.', 'adaptive-threshold')
    ],
    'Large graphics and broad shadows can contaminate the illumination estimate. Use the processing size control to preserve small text.',
    [
      n('sigma', 'Illumination blur sigma', 20, 5, 60, 5),
      n('block', 'Threshold window (odd)', 31, 3, 71, 2),
      n('offset', 'Threshold C', 9, -10, 30)
    ],
    { sample: 'document' }
  ),
  recipe(
    'deskew-text',
    'Straighten a tilted page',
    'Documents',
    'Estimate a dominant near-horizontal line angle and rotate the page to make those lines level.',
    [
      step('Find strong edges', 'Canny exposes text and page boundaries.', 'canny'),
      step('Estimate the tilt', 'Probabilistic Hough segments vote through their median angle.', 'hough-lines'),
      step('Rotate around the centre', 'An affine warp applies the estimated correction.', 'affine-warp')
    ],
    'Requires several near-horizontal lines. Tables, perspective distortion and vertical layouts can bias the estimate.',
    [
      n('angle', 'Maximum accepted tilt (degrees)', 25, 5, 45, 5),
      n('length', 'Minimum line length (pixels)', 50, 10, 200, 10)
    ],
    { sample: 'document' }
  ),
  recipe(
    'stereo-depth',
    'Estimate depth from rectified stereo',
    'Geometry',
    'Compute disparity, reject invalid matches and convert positive disparities into depth using the supplied focal length and camera baseline.',
    [
      step('Match rectified rows', 'Stereo SGBM estimates horizontal disparity.', 'stereo-sgbm'),
      step('Reject invalid disparities', 'Nonpositive disparities are excluded from depth conversion.', 'threshold'),
      step('Convert disparity to depth', 'Depth = focal length × baseline / disparity.', 'triangulation')
    ],
    'Input views must be calibrated and rectified. Focal length is in processed-image pixels; baseline determines the depth unit. The default pair is synthetic.',
    [
      n('disparities', 'Disparity range', 64, 16, 128, 16),
      n('focal', 'Focal length (processed pixels)', 500, 50, 2000, 50),
      n('baseline', 'Baseline (metres)', 0.1, 0.01, 1, 0.01)
    ],
    { second: true }
  ),
  recipe(
    'colour-palette',
    'Simplify an image into colour regions',
    'Photography',
    'Smooth small colour fluctuations, cluster colours with k-means and render the reduced palette.',
    [
      step(
        'Smooth within colour regions',
        'Bilateral filtering reduces small variations while retaining boundaries.',
        'bilateral-filter'
      ),
      step('Learn a palette', 'K-means groups BGR colour samples into clusters.', 'kmeans'),
      step('Recolour the image', 'Replace each pixel with its assigned cluster centre.', 'kmeans')
    ],
    'Results depend on the image’s colour distribution. Small but significant colours may disappear into larger clusters.',
    [n('clusters', 'Palette colours', 6, 2, 16), n('colour', 'Bilateral colour sigma', 40, 5, 100, 5)],
    { maxSide: 640 }
  )
]
/** Recipe categories in first-appearance order, shared by the index and sidebar. */
export const cookbookGroups = [...new Set(cookbook.map((r) => r.category))].map((category) => ({
  category,
  recipes: cookbook.filter((r) => r.category === category)
}))
