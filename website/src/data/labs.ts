import type { LabControl, LabRecipe } from '../lib/lab/types'
const n = (key: string, label: string, value: number, min: number, max: number, step = 1): LabControl => ({
  key,
  label,
  value,
  min,
  max,
  step
})
const s = (key: string, label: string, value: string, values: string[]): LabControl => ({
  key,
  label,
  value,
  options: values.map((v) => [v, v])
})
const j = (key: string, label: string, value: unknown): LabControl => ({
  key,
  label,
  value: JSON.stringify(value),
  json: true
})
const recipe = (note: string, controls: LabControl[], extra: Partial<LabRecipe> = {}): LabRecipe => ({
  note,
  controls,
  ...extra
})
const kernel = () => n('kernel', 'Kernel width (odd pixels)', 5, 3, 31, 2)
const threshold = () => n('threshold', 'Threshold', 127, 0, 255)
const features = () => n('features', 'Maximum features', 250, 10, 1000, 10)
const pair = { second: true }
const rect = () => [
  n('x', 'Rectangle left (%)', 15, 0, 80),
  n('y', 'Rectangle top (%)', 10, 0, 80),
  n('width', 'Rectangle width (%)', 65, 5, 90),
  n('height', 'Rectangle height (%)', 75, 5, 90)
]
const stereo = () => [
  n('disparities', 'Disparity range', 64, 16, 128, 16),
  n('block', 'Block width (odd)', 9, 5, 31, 2)
]
const camera = () => [n('focal', 'Focal length / image width', 1.2, 0.3, 3, 0.1)]
const pairs = [
  [0.15, 0.2, 0.19, 0.22],
  [0.7, 0.2, 0.74, 0.22],
  [0.7, 0.7, 0.74, 0.72],
  [0.15, 0.7, 0.19, 0.72],
  [0.4, 0.3, 0.44, 0.32],
  [0.6, 0.6, 0.64, 0.62],
  [0.3, 0.5, 0.34, 0.52],
  [0.5, 0.8, 0.54, 0.82]
]
/** One runnable experiment for every atlas entry. Recipes describe scope, preprocessing and required inputs. */
export const labRecipes: Record<string, LabRecipe> = {
  'gaussian-blur': recipe('Smooth the colour image. Sigma controls the spread; kernel width limits its support.', [
    kernel(),
    n('sigma', 'Sigma (pixels)', 1.5, 0.1, 10, 0.1)
  ]),
  'box-filter': recipe('Average the colour image with a square box.', [kernel()]),
  'median-filter': recipe('Replace each colour channel with its neighbourhood median.', [kernel()]),
  'bilateral-filter': recipe('Smooth similar colours while preserving boundaries.', [
    n('diameter', 'Diameter', 9, 3, 15, 2),
    n('colour', 'Colour sigma', 50, 1, 200),
    n('space', 'Spatial sigma', 7, 1, 30)
  ]),
  filter2d: recipe(
    'Correlate grayscale pixels with a custom square kernel. Display shows absolute response; inspect signed native values below.',
    [
      j('kernel', 'Kernel coefficients (square JSON array)', [
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ]),
      n('gain', 'Display gain', 1, 0.1, 5, 0.1)
    ]
  ),
  sobel: recipe(
    'Signed grayscale derivative. The preview displays absolute magnitude; native samples preserve the sign.',
    [s('axis', 'Derivative direction', 'x', ['x', 'y']), kernel(), n('gain', 'Display gain', 0.25, 0.01, 2, 0.01)]
  ),
  scharr: recipe('A 3 × 3 signed grayscale derivative, displayed as absolute magnitude.', [
    s('axis', 'Derivative direction', 'x', ['x', 'y']),
    n('gain', 'Display gain', 0.1, 0.01, 1, 0.01)
  ]),
  laplacian: recipe('Second derivative of grayscale intensity. Inspect signed values alongside the absolute preview.', [
    kernel(),
    n('gain', 'Display gain', 0.25, 0.01, 2, 0.01)
  ]),
  canny: recipe('Detect edges in grayscale. The two thresholds control weak and strong gradient responses.', [
    n('low', 'Low threshold', 40, 0, 250),
    n('high', 'High threshold', 100, 1, 500),
    s('norm', 'Gradient norm', 'L2', ['L2', 'L1'])
  ]),
  threshold: recipe('Threshold grayscale pixels, optionally choosing the level with Otsu.', [
    threshold(),
    s('mode', 'Method', 'binary', ['binary', 'inverse', 'otsu', 'truncate', 'to-zero'])
  ]),
  'adaptive-threshold': recipe('Compute a threshold in each local grayscale neighbourhood.', [
    kernel(),
    n('offset', 'Subtract C', 5, -30, 30),
    s('method', 'Local statistic', 'gaussian', ['gaussian', 'mean'])
  ]),
  erosion: recipe('Shrink white regions in a thresholded mask.', [
    threshold(),
    kernel(),
    n('iterations', 'Iterations', 1, 1, 5)
  ]),
  dilation: recipe('Grow white regions in a thresholded mask.', [
    threshold(),
    kernel(),
    n('iterations', 'Iterations', 1, 1, 5)
  ]),
  morphology: recipe('Apply morphology to a thresholded mask with an elliptical kernel.', [
    threshold(),
    kernel(),
    s('operation', 'Operation', 'close', ['open', 'close', 'gradient', 'top-hat', 'black-hat'])
  ]),
  'distance-transform': recipe(
    'Distance from each white mask pixel to its nearest zero. Preview is normalized; native values are distances in pixels.',
    [threshold(), s('metric', 'Distance metric', 'L2', ['L2', 'L1', 'chessboard'])]
  ),
  'connected-components': recipe(
    'Label connected white regions. Colours encode label IDs; inspect the numeric ID underneath.',
    [threshold(), s('connectivity', 'Connectivity', '8', ['4', '8'])]
  ),
  contours: recipe('Draw outlines of white regions after thresholding.', [
    threshold(),
    s('retrieval', 'Contour retrieval', 'external', ['external', 'tree', 'list'])
  ]),
  'polygon-approximation': recipe(
    'Approximate thresholded contours with polygons. Epsilon is a fraction of each contour perimeter.',
    [threshold(), n('epsilon', 'Epsilon (% of perimeter)', 2, 0.1, 15, 0.1)]
  ),
  'convex-hull': recipe('Draw convex hulls around thresholded connected contours.', [
    threshold(),
    n('area', 'Minimum contour area', 30, 0, 2000, 10)
  ]),
  moments: recipe('Mark contour centroids and report area and Hu moments for the largest region.', [
    threshold(),
    n('area', 'Minimum contour area', 30, 0, 2000, 10)
  ]),
  watershed: recipe(
    'Create foreground seeds from a distance transform of the thresholded mask, then flood the colour image. Red marks watershed boundaries.',
    [threshold(), n('seed', 'Seed distance fraction', 0.4, 0.05, 0.9, 0.05)]
  ),
  grabcut: recipe(
    'Initialize GrabCut with a rectangle. Everything outside is definite background; the inside is learned over several iterations.',
    [...rect(), n('iterations', 'Iterations', 3, 1, 5)],
    { maxSide: 512 }
  ),
  resize: recipe(
    'Resample the colour image. Input and output have different pixel coordinates when their sizes differ.',
    [
      n('scale', 'Scale', 0.5, 0.1, 2, 0.1),
      s('interpolation', 'Interpolation', 'linear', ['nearest', 'linear', 'cubic', 'area', 'lanczos'])
    ]
  ),
  remap: recipe(
    'Build a sinusoidal sampling map. Amplitude zero is the identity; positive values bend rows horizontally.',
    [n('amplitude', 'Wave amplitude (pixels)', 15, 0, 80), n('period', 'Wave period (pixels)', 100, 10, 400, 10)]
  ),
  'affine-warp': recipe('Rotate and scale around the image centre with a constant black border.', [
    n('angle', 'Rotation (degrees)', 15, -180, 180),
    n('scale', 'Scale', 1, 0.2, 2, 0.1)
  ]),
  homography: recipe(
    'Map the four image corners to a trapezoid and warp the image. This experiment isolates projective warping; correspondence fitting is a separate step.',
    [
      n('inset', 'Top corner inset (%)', 18, 0, 45),
      s('interpolation', 'Interpolation', 'linear', ['nearest', 'linear', 'cubic'])
    ]
  ),
  'polar-warp': recipe('Unroll distances and angles around the image centre. The output coordinate system is polar.', [
    s('mode', 'Radius mapping', 'linear', ['linear', 'log']),
    n('radius', 'Radius (% of shorter side)', 50, 10, 100)
  ]),
  'image-pyramids': recipe(
    'Inspect a Gaussian level or signed Laplacian residual. Residual display uses mid-gray for zero; native values keep the sign.',
    [n('level', 'Pyramid level', 1, 1, 4), s('view', 'Show', 'gaussian', ['gaussian', 'laplacian', 'reconstruction'])]
  ),
  'template-matching': recipe(
    'Search the input for a crop of the second image. Without an upload, the template is cropped from the input itself.',
    [...rect(), s('method', 'Matching score', 'CCOEFF_NORMED', ['CCOEFF_NORMED', 'CCORR_NORMED', 'SQDIFF_NORMED'])],
    pair
  ),
  'phase-correlation': recipe(
    'Estimate a global translation between grayscale images, then align the second image to the first.',
    [s('window', 'Window', 'hann', ['hann', 'none'])],
    pair
  ),
  'ecc-alignment': recipe(
    'Align the second grayscale image to the first using iterative correlation. Small overlap or unrelated photos may not converge.',
    [
      s('motion', 'Motion model', 'translation', ['translation', 'euclidean', 'affine']),
      n('iterations', 'Maximum iterations', 30, 5, 100, 5)
    ],
    pair
  ),
  orb: recipe('Detect and draw oriented ORB keypoints on the image.', [
    features(),
    n('threshold', 'FAST threshold', 20, 1, 80)
  ]),
  sift: recipe('Detect and draw SIFT keypoints. Circle size reflects feature scale.', [
    features(),
    n('contrast', 'Contrast threshold', 0.04, 0.01, 0.2, 0.01)
  ]),
  akaze: recipe('Detect nonlinear scale-space keypoints using AKAZE.', [
    n('threshold', 'Response threshold', 0.001, 0.0001, 0.01, 0.0001)
  ]),
  brisk: recipe('Detect and draw BRISK keypoints.', [
    n('threshold', 'Threshold', 30, 1, 100),
    n('octaves', 'Octaves', 3, 0, 5)
  ]),
  fast: recipe('Detect FAST corners. These locations have no descriptor or scale estimate.', [
    n('threshold', 'Threshold', 20, 1, 100),
    s('nonmax', 'Nonmaximum suppression', 'on', ['on', 'off'])
  ]),
  'good-features': recipe('Find strong, separated grayscale corners for tracking.', [
    features(),
    n('quality', 'Quality level', 0.01, 0.001, 0.2, 0.001),
    n('distance', 'Minimum separation (pixels)', 10, 1, 40),
    s('method', 'Corner score', 'shi-tomasi', ['shi-tomasi', 'harris'])
  ]),
  mser: recipe('Draw bounding boxes around stable grayscale intensity regions.', [
    n('delta', 'Threshold step', 5, 1, 20),
    n('area', 'Minimum area', 60, 10, 1000, 10)
  ]),
  'brute-force-matching': recipe(
    'Compute ORB descriptors in both images, match using Hamming cross-check, and draw the best correspondences side by side.',
    [features(), n('matches', 'Matches to draw', 30, 1, 100)],
    pair
  ),
  flann: recipe(
    'Compute float SIFT descriptors and match them with FLANN. A ratio test removes ambiguous nearest neighbours.',
    [features(), n('ratio', 'Nearest-neighbour ratio', 0.7, 0.1, 0.95, 0.05)],
    pair
  ),
  'hough-lines': recipe('Run Canny first, then detect and draw probabilistic Hough line segments.', [
    n('votes', 'Vote threshold', 40, 5, 150, 5),
    n('length', 'Minimum length (pixels)', 30, 5, 200, 5),
    n('gap', 'Maximum gap (pixels)', 10, 0, 50)
  ]),
  'hough-circles': recipe('Blur grayscale first, then detect circles using the Hough gradient method.', [
    n('votes', 'Centre threshold', 30, 5, 100),
    n('radius', 'Maximum radius (pixels)', 90, 10, 200, 10),
    n('distance', 'Minimum centre separation', 30, 5, 150, 5)
  ]),
  'optical-flow-lk': recipe(
    'Track Shi-Tomasi corners from the first image into the second. Lines show estimated motion at accepted points.',
    [features(), n('window', 'Window width (odd)', 21, 5, 41, 2)],
    pair
  ),
  'optical-flow-farneback': recipe(
    'Estimate dense motion from input to second image. Colour gives direction, brightness gives speed; inspect dx and dy in pixels.',
    [n('window', 'Window width (odd)', 15, 5, 41, 2), n('levels', 'Pyramid levels', 3, 1, 5)],
    pair
  ),
  'optical-flow-dis': recipe(
    'Estimate dense motion using DIS; inspect dx and dy in pixels.',
    [s('preset', 'Preset', 'fast', ['ultrafast', 'fast', 'medium'])],
    pair
  ),
  'optical-flow-tvl1': recipe(
    'Estimate dense motion with TV-L1 regularization. This is an iterative CPU experiment.',
    [n('lambda', 'Data attachment weight', 0.15, 0.05, 0.5, 0.05), n('scales', 'Pyramid scales', 3, 1, 5)],
    { ...pair, maxSide: 384 }
  ),
  'background-mog2': recipe(
    'Learn the first image as a static background, then classify the second image. This is a two-frame experiment, not a video history.',
    [n('threshold', 'Variance threshold', 16, 1, 64), s('shadows', 'Detect shadows', 'on', ['on', 'off'])],
    pair
  ),
  'background-knn': recipe(
    'Warm up a KNN background model using the first image, then classify the second image.',
    [
      n('threshold', 'Squared distance threshold', 400, 50, 1500, 50),
      s('shadows', 'Detect shadows', 'on', ['on', 'off'])
    ],
    pair
  ),
  kalman: recipe(
    'Filter an editable sequence of normalized (x,y) measurements with a constant-velocity model. The image is a backdrop: orange measurements, mint estimates.',
    [
      j('points', 'Measured positions [x,y], from 0 to 1', [
        [0.1, 0.2],
        [0.2, 0.24],
        [0.3, 0.35],
        [0.4, 0.32],
        [0.5, 0.45],
        [0.6, 0.47],
        [0.7, 0.65],
        [0.8, 0.66]
      ]),
      n('noise', 'Measurement noise', 0.03, 0.001, 0.2, 0.001)
    ]
  ),
  'tracker-csrt': recipe(
    'Initialize a tracker on the input rectangle, then locate it in the second image. One update previews tracking; it cannot assess long-term drift.',
    rect(),
    { ...pair, maxSide: 512 }
  ),
  'tracker-kcf': recipe('Track an input rectangle into the second image with KCF.', rect(), pair),
  'tracker-mil': recipe('Track an input rectangle into the second image with MIL.', rect(), { ...pair, maxSide: 512 }),
  'camera-calibration': recipe(
    'Preview calibration corner detection in your checkerboard photo. A single view cannot provide a reliable camera calibration; this lab focuses on its image-dependent corner stage.',
    [n('columns', 'Inner corner columns', 7, 2, 15), n('rows', 'Inner corner rows', 5, 2, 15)]
  ),
  undistortion: recipe(
    'Apply a known radial distortion model. Values are assumed calibration parameters, not estimates from this image.',
    [
      ...camera(),
      n('k1', 'Radial coefficient k1', -0.3, -1, 1, 0.05),
      n('k2', 'Radial coefficient k2', 0.05, -0.5, 0.5, 0.01)
    ]
  ),
  pnp: recipe(
    'Solve camera pose from four coplanar object corners and their image positions. Edit normalized image points to match a planar square in your photo; orange points show reprojection.',
    [
      ...camera(),
      j('points', 'Image points for square corners [x,y]', [
        [0.3, 0.3],
        [0.7, 0.3],
        [0.7, 0.7],
        [0.3, 0.7]
      ])
    ]
  ),
  'epipolar-geometry': recipe(
    'Estimate a fundamental matrix from your matching points and draw epipolar lines on the second image. Defaults are illustrative correspondences, not detected features.',
    [
      j('pairs', 'At least 8 matches [x1,y1,x2,y2], normalized', pairs),
      n('threshold', 'RANSAC tolerance (pixels)', 3, 0.5, 10, 0.5)
    ],
    pair
  ),
  'stereo-bm': recipe(
    'Compute disparity from rectified grayscale stereo views. The second image must use the same rectification. Native values are disparity pixels; negative values denote invalid matches.',
    stereo(),
    pair
  ),
  'stereo-sgbm': recipe(
    'Compute semi-global disparity from rectified grayscale views. The default translated pair only illustrates disparity, not metric depth.',
    stereo(),
    pair
  ),
  triangulation: recipe(
    'Triangulate editable correspondences with two parallel synthetic pinhole cameras. Focal length and baseline must match your rectified images for physical units to be meaningful.',
    [
      ...camera(),
      n('baseline', 'Camera baseline (world units)', 0.1, 0.01, 1, 0.01),
      j('pairs', 'Matches [x1,y1,x2,y2], normalized', [
        [0.3, 0.3, 0.25, 0.3],
        [0.7, 0.3, 0.65, 0.3],
        [0.5, 0.6, 0.47, 0.6]
      ])
    ],
    pair
  ),
  aruco: recipe(
    'Detect ArUco markers in the selected dictionary and draw their corners and IDs. Upload a marker photo to get detections.',
    [s('dictionary', 'Dictionary', '4x4-50', ['4x4-50', '5x5-100', '6x6-250'])]
  ),
  'qr-code': recipe('Detect and decode a QR code in your image. An empty result means no readable code was found.', [
    n('epsilon', 'Horizontal scan tolerance', 0.2, 0.05, 0.5, 0.05)
  ]),
  'histogram-equalization': recipe('Equalize the global grayscale histogram.', []),
  clahe: recipe('Equalize grayscale locally while clipping excessive histogram peaks.', [
    n('clip', 'Contrast limit', 2, 0.1, 10, 0.1),
    n('tiles', 'Tiles per axis', 8, 2, 16)
  ]),
  'colour-conversion': recipe(
    'Inspect a colour space channel. Preview normalizes that channel; native values use OpenCV units (8-bit HSV hue is 0..179).',
    [
      s('space', 'Colour space', 'HSV', ['HSV', 'Lab', 'YCrCb', 'gray']),
      n('channel', 'Channel index (0-based)', 0, 0, 2)
    ]
  ),
  'in-range': recipe('Select pixels in an HSV interval. Hue uses OpenCV’s 0..179 scale.', [
    n('hueMin', 'Minimum hue', 25, 0, 179),
    n('hueMax', 'Maximum hue', 95, 0, 179),
    n('saturation', 'Minimum saturation', 40, 0, 255)
  ]),
  dft: recipe(
    'Transform grayscale to a complex Fourier spectrum. Preview shows log magnitude with DC at the upper left; native channels contain the real and imaginary coefficients.',
    [s('view', 'Show', 'spectrum', ['spectrum', 'reconstruction'])]
  ),
  dct: recipe(
    'Compute the grayscale cosine transform after padding to even dimensions. Preview shows log absolute coefficients, DC at the upper left.',
    [s('view', 'Show', 'coefficients', ['coefficients', 'reconstruction'])]
  ),
  'nonlocal-means': recipe(
    'Denoise the colour image by comparing similar patches.',
    [n('strength', 'Denoising strength', 10, 1, 40), n('search', 'Search window (odd)', 21, 7, 31, 2)],
    { maxSide: 640 }
  ),
  inpainting: recipe(
    'Remove a rectangular region using surrounding pixels. The selected rectangle is the repair mask.',
    [
      ...rect(),
      n('radius', 'Neighbourhood radius', 3, 1, 10),
      s('method', 'Method', 'telea', ['telea', 'navier-stokes'])
    ]
  ),
  'seamless-cloning': recipe(
    'Clone the rectangle from the second image into the centre of the input. The Poisson solve blends gradients across the mask boundary.',
    [...rect(), s('mode', 'Gradient mode', 'normal', ['normal', 'mixed'])],
    pair
  ),
  hdr: recipe(
    'Fuse two exposure images with Mertens exposure fusion. Without an upload, the second image is a darker exposure of the input. This experiment produces an LDR fusion, not calibrated HDR radiance.',
    [
      n('contrast', 'Contrast weight', 1, 0, 2, 0.1),
      n('saturation', 'Saturation weight', 1, 0, 2, 0.1),
      n('exposure', 'Exposure weight', 1, 0, 2, 0.1)
    ],
    pair
  ),
  'guided-filter': recipe('Use the colour image as its own guide for edge-preserving filtering.', [
    n('radius', 'Radius (pixels)', 8, 1, 30),
    n('epsilon', 'Regularization (intensity squared)', 100, 1, 2000)
  ]),
  thinning: recipe('Skeletonize the thresholded white foreground.', [
    threshold(),
    s('method', 'Method', 'zhang-suen', ['zhang-suen', 'guo-hall'])
  ]),
  superpixels: recipe('Partition Lab colours into SLIC superpixels and draw their boundaries on the original.', [
    n('size', 'Region size (pixels)', 20, 5, 60),
    n('ruler', 'Compactness', 10, 1, 40),
    n('iterations', 'Iterations', 10, 1, 30)
  ]),
  kmeans: recipe(
    'Cluster colour samples into a small palette, then replace each pixel by its cluster centre.',
    [n('clusters', 'Palette colours', 6, 2, 16), n('iterations', 'Maximum iterations', 15, 3, 40)],
    { maxSide: 640 }
  ),
  svm: recipe(
    'Train a colour classifier: samples inside the rectangle are foreground, image-border samples are background. Apply it to every pixel. This demonstrates supervised training, not semantic segmentation.',
    [...rect(), n('c', 'SVM C', 1, 0.1, 10, 0.1)]
  ),
  'knn-classifier': recipe(
    'Train a colour classifier from the rectangle (foreground) and image border (background). Classify pixels by their nearest training colours.',
    [...rect(), n('k', 'Neighbours', 5, 1, 15, 2)]
  ),
  'random-forests': recipe('Train a random forest on rectangle and border colour samples, then classify every pixel.', [
    ...rect(),
    n('depth', 'Maximum tree depth', 8, 2, 20)
  ]),
  pca: recipe(
    'Project BGR colour vectors into fewer principal components, then reconstruct the image. Components are learned from this image’s colour distribution.',
    [n('components', 'Retained colour components', 1, 1, 3)]
  ),
  'dnn-inference': recipe(
    'Run a user-supplied ONNX network with an NCHW colour blob and inspect one output plane. The built-in model is only a ReLU demonstration, not a trained vision network.',
    [
      n('size', 'Network input size', 64, 16, 512, 16),
      n('scale', 'Input multiplier', 0.0039215686, 0.001, 1, 0.001),
      n('channel', 'Output plane', 0, 0, 63)
    ],
    { assets: [{ key: 'model', label: 'ONNX network (optional)', accept: '.onnx' }] }
  ),
  nms: recipe(
    'Suppress overlapping candidate boxes. Coordinates use fractions of the input dimensions; each row is [x,y,width,height,score].',
    [
      j('boxes', 'Candidate boxes and confidence', [
        [0.15, 0.15, 0.4, 0.4, 0.95],
        [0.18, 0.18, 0.4, 0.4, 0.8],
        [0.65, 0.3, 0.25, 0.5, 0.7]
      ]),
      n('score', 'Minimum score', 0.3, 0, 1, 0.05),
      n('overlap', 'Maximum IoU', 0.4, 0, 1, 0.05)
    ]
  ),
  'dnn-super-resolution': recipe(
    'Upscale with the bundled FSRCNN ×2 model, or upload a compatible TensorFlow .pb model. Architecture and scale must match the model. Input is capped at 256 pixels for this CPU preview.',
    [
      s('architecture', 'Architecture', 'fsrcnn', ['fsrcnn', 'espcn', 'lapsrn', 'edsr']),
      s('scale', 'Model scale', '2', ['2', '3', '4'])
    ],
    { maxSide: 256, assets: [{ key: 'model', label: 'Custom model (.pb, optional)', accept: '.pb' }] }
  ),
  ocr: recipe(
    'Recognize English text using the bundled Tesseract model (4 MB, loaded on first use), or supply your own English traineddata. Text appears below the preview. Dense pages benefit from a larger processing size.',
    [s('layout', 'Page segmentation', '6', ['3', '6', '7', '8', '11', '13'])],
    { assets: [{ key: 'language', label: 'English traineddata (optional)', accept: '.traineddata' }] }
  ),
  'text-detection': recipe(
    'Detect text-like extremal regions with the bundled OpenCV NM classifiers and draw grouped text boxes. These are regions, not recognized words.',
    [n('probability', 'Minimum region probability', 0.5, 0.1, 0.9, 0.1)],
    { maxSide: 640 }
  ),
  'image-hashing': recipe(
    'Compare perceptual hashes of the input and second image. The output is the compared image; the report gives Hamming distance.',
    [s('method', 'Hash', 'phash', ['phash', 'average', 'block-mean'])],
    pair
  ),
  'quality-metrics': recipe(
    'Compare equal-sized images. Preview shows the error map; scores appear below. The second upload is resized to match the input.',
    [s('method', 'Metric', 'SSIM', ['SSIM', 'MSE', 'PSNR'])],
    pair
  ),
  saliency: recipe(
    'Compute a static saliency map. Bright values suggest visually distinctive regions, not necessarily recognized objects.',
    [s('method', 'Method', 'spectral', ['spectral', 'fine-grained'])]
  ),
  'alpha-matting': recipe(
    'Build a rectangular trimap: centre is definite foreground, outer frame is definite background, and the band is unknown. The output is an estimated alpha matte, not a semantic object mask.',
    [...rect(), n('band', 'Unknown band (pixels)', 8, 2, 20)],
    { maxSide: 192 }
  ),
  'white-balance': recipe('Estimate and correct colour balance using image statistics.', [
    s('method', 'Method', 'simple', ['simple', 'gray-world']),
    n('percent', 'SimpleWB trim (%)', 2, 0.1, 10, 0.1)
  ]),
  stitching: recipe(
    'Attempt a panorama from two overlapping photos. The synthetic pair has translation only; real panoramas need sufficient texture and overlap. Failure to estimate a panorama is reported explicitly.',
    [
      s('mode', 'Stitcher mode', 'scans', ['scans', 'panorama']),
      n('confidence', 'Panorama confidence threshold', 0.3, 0.1, 1, 0.1)
    ],
    { ...pair, maxSide: 800 }
  ),
  icp: recipe(
    'Convert both grayscale images to sampled height fields, then align them as 3D point clouds with ICP. This is an intensity-surface experiment, not depth recovered from photos.',
    [n('height', 'Intensity height scale', 0.2, 0.05, 1, 0.05), n('iterations', 'Maximum iterations', 30, 5, 100, 5)],
    pair
  ),
  'structured-light': recipe(
    'Generate Gray-code projector patterns. These do not transform the input photo; decoding physical depth requires a synchronized camera capture for every projected pattern.',
    [n('pattern', 'Pattern index', 0, 0, 43), s('axis', 'Pattern dimensions', 'input', ['input', 'square'])]
  ),
  'phase-unwrapping': recipe(
    'Interpret grayscale intensity as phase in [-π, π], then unwrap discontinuities. Real measurements must first be encoded as a wrapped phase map; ordinary photos are only illustrative.',
    []
  ),
  retina: recipe(
    'Process the colour image through the retina model. Parvo preserves detail; Magno measures change after a dark initial frame.',
    [s('pathway', 'Pathway', 'parvo', ['parvo', 'magno'])],
    { maxSide: 640 }
  )
}
