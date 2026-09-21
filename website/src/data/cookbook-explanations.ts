/** One algorithm choice, including the data contract that connects it to the next operation. */
export type RecipeReasoning = {
  intuition: string
  stages: { algorithms: string[]; input: string; why: string; output: string }[]
  tuning: string
  check: string
}
const stage = (algorithms: string[], input: string, why: string, output: string) => ({ algorithms, input, why, output })
/** Authored reasoning for every runnable cookbook, checked against its actual processing chain. */
export const cookbookExplanations: Record<string, RecipeReasoning> = {
  'motion-vectors': {
    intuition:
      'A pan gives much of the image one shared displacement, while moving objects add their own motion. Estimate that large common shift first, then solve the smaller local differences. Finally turn a noisy field of pixel estimates into regional measurements you can use.',
    stages: [
      stage(
        ['phaseCorrelate', 'createHanningWindow', 'warpAffine'],
        'Two equally sized grayscale frames, converted to float32.',
        'Phase correlation looks for the global translation through frequency-domain phase differences. The Hann window reduces hard image-border discontinuities. Prewarping by this estimate brings the frames closer together, making local optical flow less likely to settle on an incorrect small-motion solution. A weak or implausibly large estimate is ignored.',
        'Two approximately aligned frames and an initial dx,dy estimate. Keep that estimate: the next step measures residual motion.'
      ),
      stage(
        ['calcOpticalFlowFarneback'],
        'Each original frame and the other frame warped into its coordinates.',
        'Farneback fits local image structure at several resolutions to estimate a dense two-channel displacement field. Running it in both directions gives a way to check whether a proposed match can return to its starting point. Add the initial pan back to the forward field and subtract it from the reverse field before checking correspondence.',
        'Forward and backward float32 dx,dy fields in the original processed-frame coordinates.'
      ),
      stage(
        ['cornerMinEigenVal', 'Per-cell median'],
        'The displacement fields, grayscale texture and regular grid cells.',
        'A flat patch cannot determine a unique motion. Corner response rejects weak texture; sampling backward flow at the predicted destination rejects inconsistent matches. A median within each cell reduces the influence of remaining outliers. Subtracting the image-wide median exposes local motion relative to the dominant translation.',
        'Signed regional vectors, accepted-sample fractions and unknown cells. Positive dx points right; positive dy points down. The JSON and pixel inspector retain measurements independently of arrow scaling.'
      )
    ],
    tuning:
      'Start in Total displacement mode. Smaller regions reveal finer motion but have fewer reliable samples. Increase pyramid levels for larger residual displacements and the flow window for more spatial support, at the cost of mixing nearby motions. Tighten the backward tolerance to reject more estimates. The arrow multiplier and colour scale only change the visualization.',
    check:
      'With a simple pan, supported cells should point in roughly the same direction. In residual mode, a stationary background should approach zero while independently moving objects remain visible. Crosses mean insufficient evidence, not a measured zero. Rotation and parallax require a richer global model than translation subtraction.'
  },
  'track-region': {
    intuition:
      'A rectangle has no visual identity of its own. Give it a set of distinctive points, follow those points into the next frame, then use their shared geometric motion to move the rectangle.',
    stages: [
      stage(
        ['goodFeaturesToTrack'],
        'Grayscale first frame and a binary mask of your selected rectangle.',
        'Shi-Tomasi corners have intensity variation in two directions, which makes their position less ambiguous than a point on a straight edge. The mask restricts evidence to the selected region so background features cannot dominate the fit.',
        'A sparse list of 2D corner coordinates inside the selected region.'
      ),
      stage(
        ['calcOpticalFlowPyrLK'],
        'Corner coordinates and both grayscale frames.',
        'Pyramidal Lucas-Kanade searches for small patches with similar appearance, working from coarse images to finer ones. Tracking back into the first frame reveals points that jumped to an unrelated patch. The lab drops failed tracks and points whose return distance exceeds the tolerance.',
        'Pairs of original and tracked points that pass the forward/backward check.'
      ),
      stage(
        ['estimateAffinePartial2D', 'RANSAC', 'line'],
        'The surviving point pairs and the rectangle corners.',
        'A partial affine model describes translation, rotation and uniform scale with fewer parameters than a homography. RANSAC fits that shared motion while rejecting points on occluded or independently moving content. Applying the transform to the four rectangle corners produces the tracked outline.',
        'A quadrilateral on the second image plus inlier count, translation, scale and rotation.'
      )
    ],
    tuning:
      'Select a region with several distinct corners distributed across the object. Increase maximum corners when the region has rich texture; increasing it cannot help a blank surface. A smaller backward tolerance is stricter. For large jumps, use closer frames or feature-based alignment.',
    check:
      'Inspect Selected corners and Consistent tracks before trusting the final box. They should follow the same object and cover its area. A few clustered inliers or a box stretching onto the background indicate poor support. This estimates geometry, not an object segmentation mask.'
  },
  'locate-template': {
    intuition:
      'If a patch keeps its appearance and size, finding it is a search over translations. Compare the patch with every same-sized window in the next image, then interpret the resulting score map.',
    stages: [
      stage(
        ['Mat.roi', 'meanStdDev'],
        'Your rectangle in the first grayscale frame.',
        'Cropping preserves the exact texture to search for. The standard-deviation check rejects almost uniform patches: normalized correlation needs variation, and a flat patch has little distinctive information.',
        'A textured grayscale template with a fixed width and height.'
      ),
      stage(
        ['matchTemplate', 'TM_CCOEFF_NORMED'],
        'The template and second grayscale frame.',
        'Normalized, mean-centred correlation compares spatial patterns with less sensitivity to a uniform brightness offset or scale. It evaluates every valid top-left placement. The score map is smaller than the image because the whole template must fit inside each candidate window.',
        'A floating score map indexed by candidate template top-left positions.'
      ),
      stage(
        ['minMaxLoc', 'rectangle'],
        'The correlation map and original template dimensions.',
        'The maximum identifies the best candidate, but even unrelated images have a maximum. The acceptance threshold decides whether to draw a rectangle; preserving the score lets you assess how convincing that candidate is.',
        'An accepted rectangle in the second frame, or a below-threshold result without a box.'
      )
    ],
    tuning:
      'Choose a distinctive patch that includes texture but little independently moving background. Raise the minimum score when false matches are common. If the object rotates or changes scale, use feature matching or region tracking instead of expecting the threshold to compensate.',
    check:
      'Inspect the correlation map. One isolated peak is more useful than several similar peaks from repeated windows, tiles or text. Map coordinates refer to the patch top-left, not its centre.'
  },
  'align-images': {
    intuition:
      'Alignment needs corresponding locations before it can decide how to warp pixels. Descriptors propose those locations; a geometric model tests whether they can belong to the same view change.',
    stages: [
      stage(
        ['ORB.create', 'detectAndCompute'],
        'Two overlapping grayscale views.',
        'ORB finds multiscale, oriented keypoints and describes each neighbourhood as a binary pattern. This gives matching evidence even when a plain pixel comparison fails because the images are translated, rotated or moderately rescaled.',
        'Keypoint coordinates and a descriptor matrix for each image. Descriptor rows correspond to keypoints.'
      ),
      stage(
        ['BFMatcher', 'NORM_HAMMING', 'findHomography'],
        'Binary descriptor pairs, then their matched 2D coordinates.',
        'Hamming distance counts differing descriptor bits. Cross-checking keeps mutual best matches; the lab retains up to 200 lowest-distance candidates. Similar-looking patches can still be wrong, so RANSAC keeps matches consistent with a single projective transform rather than trusting descriptor distance alone.',
        'A first-to-second 3×3 homography and an inlier mask.'
      ),
      stage(
        ['warpPerspective', 'WARP_INVERSE_MAP', 'addWeighted'],
        'The second colour frame and the fitted first-to-second homography.',
        'The output should use first-frame coordinates. WARP_INVERSE_MAP lets the warp use the fitted first-to-second map to look up source pixels in the second frame for each output position. An equal-weight overlay makes residual misalignment visible as doubled edges.',
        'The second image resampled onto the first image grid, ready for comparison or compositing.'
      )
    ],
    tuning:
      'Increase ORB features when overlap is small or features are unevenly distributed. RANSAC tolerance is a reprojection distance in processed pixels: too tight rejects useful noisy matches; too loose accepts the wrong geometry.',
    check:
      'Look at both the inlier distribution and Alignment overlay. A correct fit should align structures across the shared plane, not just in one corner. A planar scene or camera rotation can fit a homography; depth-dependent parallax and independently moving objects often cannot.'
  },
  'match-features': {
    intuition:
      'A descriptor match says two patches look alike. A verified match also agrees with a shared spatial transformation. Comparing candidate and verified links teaches which kind of evidence each stage contributes.',
    stages: [
      stage(
        ['ORB.create', 'detectAndCompute'],
        'Two grayscale images.',
        'ORB produces repeatable keypoints and compact binary descriptions. Keeping coordinates beside each descriptor matters: descriptors support appearance matching, while coordinates support the later geometry check.',
        'Keypoint vectors and binary descriptor matrices.'
      ),
      stage(
        ['BFMatcher', 'NORM_HAMMING'],
        'Both descriptor matrices.',
        'Mutual best matching reduces one-sided ambiguous matches. Sorting by Hamming distance and retaining up to 200 candidates gives the geometry fit a stronger starting set, but appearance alone can confuse repeated patterns.',
        'Candidate descriptor matches, each linking one first-image point to one second-image point.'
      ),
      stage(
        ['findHomography', 'RANSAC', 'drawMatches'],
        'Candidate coordinate pairs.',
        'RANSAC searches for a homography supported by a subset of the pairs. Its inlier mask selects which links to draw, letting you distinguish appearance candidates from geometrically consistent evidence. Unlike the alignment recipe, this recipe stops at correspondence visualization.',
        'A side-by-side image with lines connecting inlier keypoints, plus an inlier count.'
      )
    ],
    tuning:
      'Try a stricter RANSAC tolerance to see weak correspondences disappear, then inspect whether enough well-spread evidence remains. More features can help coverage but can also add repeated or low-quality candidates.',
    check:
      'Useful inliers span the overlapping scene and follow one coherent mapping. Many nearly coincident points or repeated motifs can support a misleading model. A high inlier count alone does not establish that the images were aligned correctly.'
  },
  'detect-motion': {
    intuition:
      'For aligned views, a pixel that changes enough is evidence of a changed region. The chain first suppresses small fluctuations, then turns differences into a mask, and finally turns that mask into objects you can count or box.',
    stages: [
      stage(
        ['GaussianBlur'],
        'Two equally sized grayscale frames.',
        'Small sensor fluctuations and subpixel changes would create many isolated differences. Applying the same 5×5 Gaussian blur to both images suppresses some of that variation before subtraction, so thresholding is less sensitive to individual noisy pixels.',
        'Two smoothed frames on the same coordinate grid.'
      ),
      stage(
        ['absdiff', 'threshold'],
        'The smoothed grayscale frames.',
        'Absolute difference measures the magnitude of change without cancelling brightening against darkening. Thresholding converts that continuous evidence into a decision mask: white means the change exceeds your chosen intensity threshold.',
        'An 8-bit binary changed-pixel mask, plus an inspectable difference image.'
      ),
      stage(
        ['morphologyEx', 'MORPH_CLOSE', 'connectedComponentsWithStats'],
        'The changed-pixel mask.',
        'Closing joins small gaps within changed regions. Connected components assign a label to each contiguous region and compute its area and bounds. Filtering by area removes remaining tiny regions before drawing boxes.',
        'Boxes and component IDs for changed regions large enough to retain.'
      )
    ],
    tuning:
      'Raise the difference threshold to ignore smaller intensity changes. Increase the cleanup kernel only enough to reconnect fragmented regions; large kernels merge nearby objects. Minimum area is measured after preprocessing and mask cleanup.',
    check:
      'If most of the scene becomes white, inspect camera movement or lighting changes first. Align the images before this chain when the camera moves. A moving object can create two changed regions, where it was and where it is now; this recipe does not estimate a motion vector.'
  },
  'compare-images': {
    intuition:
      'When local appearance changes matter more than raw per-pixel brightness error, compare neighbourhood structure first. Then localize low-similarity areas with the same mask-to-region machinery used for change detection.',
    stages: [
      stage(
        ['quality_QualitySSIM_compute'],
        'Two aligned grayscale images.',
        'SSIM compares local means, contrast and correlation. Its map tells you where neighbourhood structure agrees; the mean score alone would hide the location of differences. The lab retains the native values because display normalization changes their visual brightness.',
        'A floating local SSIM map and a mean similarity score.'
      ),
      stage(
        ['threshold', 'THRESH_BINARY_INV', 'Mat.convertTo'],
        'The native SSIM map.',
        'High values indicate greater similarity. Inverse thresholding selects values below the minimum similarity, then conversion to 8-bit gives morphology and component labelling the binary format they require.',
        'An 8-bit mask of locally dissimilar pixels.'
      ),
      stage(
        ['morphologyEx', 'MORPH_CLOSE', 'connectedComponentsWithStats'],
        'The low-similarity mask.',
        'Closing connects nearby fragments of one difference. Component statistics provide region bounds and area, so a minimum-area decision removes small isolated changes without discarding the numeric SSIM evidence.',
        'Outlined difference regions on the second image.'
      )
    ],
    tuning:
      'Raising minimum SSIM marks more subtle differences. Lower it to focus on large structural disagreements. Tune cleanup and area only after the raw map identifies the differences you care about.',
    check:
      'Misregistration often produces differences along almost every edge. Align first. This grayscale chain can miss colour-only changes and does not know which differences are meaningful to a person.'
  },
  'count-objects': {
    intuition:
      'Counting starts with a definition of foreground. Here that definition is brightness. Once each object is a separate white island, connected-component labelling turns the counting problem into counting islands.',
    stages: [
      stage(
        ['GaussianBlur', 'threshold'],
        'An image with brighter objects on a darker background.',
        'Blur reduces small fluctuations, and the threshold decides which intensities belong to foreground. That decision determines what an object means for every following step; the component counter has no knowledge of the original appearance.',
        'A binary foreground mask.'
      ),
      stage(
        ['morphologyEx', 'MORPH_OPEN'],
        'The foreground mask.',
        'Opening erodes and then dilates the mask, removing bright specks too small to hold the structuring element. It can also break narrow connections, but it can erase real thin objects, so its size must reflect the objects you want to count.',
        'A cleaner set of foreground islands.'
      ),
      stage(
        ['connectedComponentsWithStats'],
        'The cleaned binary mask.',
        'Labelling gives each connected island an integer ID. Statistics provide pixel area, bounding box and centroid; label zero is background. Only foreground labels meeting the minimum-area threshold contribute to the reported count.',
        'Object count, numbered boxes and inspectable component IDs.'
      )
    ],
    tuning:
      'First choose a threshold that separates objects from their surroundings, then use the smallest opening kernel that removes noise. Finally set the area cutoff below the smallest legitimate object. For dark objects, invert the threshold in your own chain.',
    check:
      'Compare the mask with the image: one island should correspond to one intended object. Touching objects count as one; use the watershed recipe when they need splitting. Uneven lighting may call for adaptive thresholding or colour selection.'
  },
  'segment-touching': {
    intuition:
      'Touching objects share a connected silhouette, so counting connected components cannot separate them. Their interiors can still have distinct centres. Use those centres as competing seeds and grow separate regions from them.',
    stages: [
      stage(
        ['threshold'],
        'Bright touching objects against a darker background.',
        'Thresholding limits the problem to a foreground silhouette. Its boundary is crucial: the distance transform will measure distance to this boundary, so a missing edge or merged background region changes where object centres appear.',
        'A binary foreground mask that may contain several touching objects in one component.'
      ),
      stage(
        ['distanceTransform', 'dilate', 'compare', 'connectedComponents'],
        'The foreground mask.',
        'Distance increases toward the interior. Comparing the distance map with its local dilation finds local maxima; a height threshold rejects shallow peaks. Connected components turn surviving peak areas into separate marker IDs. Pixels outside the mask become a known background marker, while the rest remain unassigned.',
        'A signed 32-bit marker image with distinct foreground seeds, background and unknown pixels.'
      ),
      stage(
        ['watershed'],
        'The colour image and marker labels.',
        'Marker-controlled watershed expands competing regions using image differences. Where competing basins meet, it marks a boundary. This can split a connected silhouette because its seeds already encode multiple candidate objects.',
        'A label image with -1 at watershed boundaries, overlaid as red lines on the original image.'
      )
    ],
    tuning:
      'Lower the minimum peak height if smaller objects have no seeds. Increase the suppression radius if one object receives many nearby seeds, but keep it smaller than the spacing between genuine centres.',
    check:
      'Inspect Foreground seeds before the final boundary. Aim for one seed per intended object. If strong overlap leaves only one interior peak, watershed has no evidence that there should be two objects. Correct the mask or provide better markers.'
  },
  'measure-shapes': {
    intuition:
      'Geometry should be measured on a chosen silhouette, not on arbitrary image texture. Turn foreground into outlines, simplify those outlines for a readable drawing, then compute measurements from the original contours.',
    stages: [
      stage(
        ['threshold'],
        'A grayscale view with a useful foreground intensity separation.',
        'Thresholding defines the silhouette whose geometry you will measure. Moving the threshold moves the boundary, so later precision in area or centroid does not compensate for an inaccurate mask.',
        'A binary silhouette mask.'
      ),
      stage(
        ['findContours', 'approxPolyDP'],
        'The silhouette mask.',
        'External contours convert the raster boundary into point sequences. Polygon approximation replaces small boundary wiggles with fewer segments for display. The tolerance is a fraction of perimeter so it scales with contour size; tiny contours are filtered by area.',
        'Original contour point lists and simplified display polygons.'
      ),
      stage(
        ['contourArea', 'arcLength', 'moments'],
        'Original contours that pass the area cutoff.',
        'Area and perimeter describe size and boundary length. Moments give the centroid as m10/m00 and m01/m00. Circularity, 4πA/P², combines area and perimeter to indicate how compact the outline is. The lab measures the original contours, not the simplified drawing.',
        'Pixel area, pixel perimeter, circularity and centroid for each retained shape.'
      )
    ],
    tuning:
      'Set threshold and minimum area first. Change polygon tolerance to make the outline easier to interpret; it should not change the reported measurements in this recipe. Physical measurements require calibration and a suitable view of the measured plane.',
    check:
      'A contour around a shadow measures that shadow. External-only retrieval also omits interior holes from the measured shape model. Compare the silhouette and centroid with the intended object before using the numbers.'
  },
  'colour-mask': {
    intuition:
      'Colour can separate objects that overlap in brightness. Select a colour in a representation that separates hue from intensity, then convert scattered selected pixels into contiguous regions.',
    stages: [
      stage(
        ['cvtColor', 'COLOR_BGR2HSV'],
        'An 8-bit BGR image.',
        'HSV gives separate channels for hue, saturation and value. A hue interval is easier to specify than three independent BGR intervals, while a saturation floor excludes gray pixels whose hue is unstable or uninformative.',
        'An 8-bit HSV image; hue is encoded on 0..179.'
      ),
      stage(
        ['inRange'],
        'HSV pixels and lower/upper bounds.',
        'Range testing makes the colour definition explicit. This lab selects one contiguous hue interval and a minimum saturation while allowing the full value range. Every passing pixel becomes white; all others become black.',
        'A binary colour-selection mask.'
      ),
      stage(
        ['morphologyEx', 'MORPH_CLOSE', 'connectedComponentsWithStats'],
        'The colour mask.',
        'Closing fills small holes and joins small gaps within the selection. Component statistics then turn selected pixels into area-filtered boxes. They group by connectivity, so adjacent objects of the same colour may merge.',
        'Colour-region boxes and component IDs.'
      )
    ],
    tuning:
      'Use the pixel inspector and HSV guide to choose the hue interval. Raise minimum saturation to reject pale or gray regions. Use a small closing kernel. A red interval spanning the hue wrap needs two inRange masks joined with bitwise_or in your own chain.',
    check:
      'Inspect the raw mask before cleanup: morphology cannot rescue an incorrect colour range. Illumination, reflections and white balance can shift colours beyond fixed bounds.'
  },
  'crop-object': {
    intuition:
      'Automatic cropping combines a foreground decision with a simple selection rule: keep the largest silhouette. Its bounding rectangle determines which original pixels to retain.',
    stages: [
      stage(
        ['threshold', 'morphologyEx', 'MORPH_CLOSE'],
        'Grayscale intensity.',
        'Thresholding identifies bright foreground and closing fills small breaks. Repairing the mask before finding contours reduces the chance that one intended object is split into multiple smaller candidates.',
        'A cleaned foreground mask.'
      ),
      stage(
        ['findContours', 'contourArea'],
        'The cleaned mask.',
        'External contours describe each candidate silhouette. Comparing contour areas chooses the largest foreground object, which is a useful heuristic when one subject dominates the frame but is not a semantic subject detector.',
        'The contour with the largest enclosed area.'
      ),
      stage(
        ['boundingRect', 'Mat.roi', 'Mat.copyTo'],
        'The selected contour and original colour image.',
        'An axis-aligned bounding box includes the complete contour. Padding adds context, clipping keeps the rectangle inside the image, and copying the ROI creates an independently owned crop. No resizing is needed.',
        'A smaller colour image with the selected bounds and crop dimensions reported.'
      )
    ],
    tuning:
      'Fix the foreground threshold before adjusting crop padding. Larger closing kernels can merge unrelated bright areas and change which object wins. Padding is measured in processed-image pixels.',
    check:
      'Selected bounds should surround the intended subject. A bright wall or frame may be larger than that subject. Cropping retains background inside the rectangle; use the cutout recipe when you need transparency.'
  },
  'remove-background': {
    intuition:
      'A loose rectangle is easier to provide than an exact silhouette. GrabCut uses that initial constraint to estimate foreground, then the foreground mask becomes the image alpha channel.',
    stages: [
      stage(
        ['grabCut', 'GC_INIT_WITH_RECT'],
        'A colour image and a rectangle containing the entire subject.',
        'The rectangle gives initial evidence: pixels outside it are background, and pixels inside are candidates for foreground. This constraint allows the algorithm to learn foreground and background colour models without a manually drawn silhouette.',
        'An initialized four-state segmentation mask and colour-model storage.'
      ),
      stage(
        ['grabCut', 'GC_FGD', 'GC_PR_FGD'],
        'The initialized colour models, image and labels.',
        'GrabCut alternates colour-model fitting with graph-cut segmentation, balancing appearance with spatial continuity. Definite and probable foreground labels are collapsed into white for compositing. Probable foreground is a discrete label, not a calibrated opacity.',
        'A binary foreground mask retaining definite and probable foreground.'
      ),
      stage(
        ['GaussianBlur', 'cvtColor', 'COLOR_BGR2RGBA'],
        'The foreground mask and original BGR pixels.',
        'Optional feathering softens the binary edge. Converting colour to RGBA and writing the mask into alpha makes outside pixels transparent while preserving the original colour channels. PNG export keeps this alpha channel.',
        'An RGBA cutout with optional soft edges.'
      )
    ],
    tuning:
      'Keep the whole subject inside the rectangle and enough true background outside it. More iterations refine the current model but do not fix an incorrect foreground constraint. Use a small feather radius and inspect hair or fine outlines at pixel scale.',
    check:
      'Inspect the binary foreground before the soft mask. A smooth wrong edge is still wrong. Feathering does not recover foreground colour from mixed boundary pixels, so coloured fringes may remain when compositing onto a different background.'
  },
  'blur-background': {
    intuition:
      'Separating where an effect applies from how the effect is computed makes many image edits composable. Compute a subject mask, create a blurred alternative image, then use the mask to choose between the two.',
    stages: [
      stage(
        ['grabCut'],
        'The image and a rectangle around the subject.',
        'GrabCut estimates a subject mask from foreground/background colour models and the rectangle constraint. Retaining definite and probable foreground yields a binary selection that controls where sharp pixels survive.',
        'A binary subject mask.'
      ),
      stage(
        ['GaussianBlur'],
        'The full colour image.',
        'Gaussian blur creates a smooth alternative layer. Computing the blur over the whole image gives each background pixel a complete neighbourhood, but it also means subject colours can spread into that layer near boundaries.',
        'A blurred colour layer with the same dimensions as the original.'
      ),
      stage(
        ['GaussianBlur', 'Alpha-weighted compositing'],
        'The original, blurred layer and subject mask.',
        'A small blur of the mask creates a gradual transition. For each channel the lab computes alpha × original + (1 - alpha) × blurred. The mask, not the blur algorithm, determines which regions stay sharp.',
        'A composite with the selected foreground sharp and its surroundings blurred.'
      )
    ],
    tuning:
      'Tune the rectangle and GrabCut mask before the blur strength. Sigma sets the spatial blur scale in processed pixels. Strong blur makes segmentation mistakes more visible, especially around thin structures.',
    check:
      'Use the mask and blurred-layer stages to distinguish segmentation errors from blur behaviour. Subject-colour spill and mask mistakes can produce halos; this simple composite is not a depth-aware lens simulation.'
  },
  'blur-region': {
    intuition:
      'The reusable pattern is effect plus selection: make an edited version of the image, then copy only the selected pixels back. A rectangle gives the selection without needing object segmentation.',
    stages: [
      stage(
        ['Mat.zeros', 'rectangle'],
        'A rectangle in processed-image coordinates.',
        'Drawing white into a zero-filled 8-bit mask creates a precise write selection. Keeping the selection separate from the image lets the same masking pattern work with other effects or selection algorithms.',
        'A binary mask: white inside the rectangle, black outside.'
      ),
      stage(
        ['GaussianBlur'],
        'The complete original image.',
        'Gaussian filtering forms the replacement image. Blurring the full frame rather than only the crop provides surrounding pixels at the selection boundary and avoids treating that boundary as an artificial image edge.',
        'A smooth replacement layer at the original dimensions.'
      ),
      stage(
        ['Mat.copyTo'],
        'A copy of the original, the blurred layer and the binary mask.',
        'Masked copy writes blurred pixels only where the mask is nonzero. The untouched original remains everywhere else, making the output easy to verify and the selection logic independent of the chosen effect.',
        'An image with exactly the selected rectangle replaced by blurred values.'
      )
    ],
    tuning:
      'Sigma controls how broadly the blur averages nearby pixels. Its visual effect changes with processing resolution. To soften the rectangle boundary in your own chain, use a feathered mask and weighted blending instead of binary copy.',
    check:
      'The mask should match your intended region, and pixels outside it should stay identical. An abrupt transition is expected from a binary rectangle; it is not a blur failure.'
  },
  'denoise-detail': {
    intuition:
      'Local contrast enhancement can amplify noise. Reduce noise first, then enhance brightness structure separately from colour to avoid independently distorting the colour channels.',
    stages: [
      stage(
        ['fastNlMeansDenoisingColored'],
        'An 8-bit BGR image.',
        'Nonlocal means averages evidence from similar patches, allowing repeated image structure to contribute to denoising. The colour version treats brightness and colour noise separately internally. This stage comes before contrast enhancement so the next operation has less noise to amplify.',
        'A denoised colour image.'
      ),
      stage(
        ['cvtColor', 'COLOR_BGR2Lab', 'extractChannel'],
        'The denoised colour image.',
        'Lab separates lightness from the a and b colour components. Extracting only L lets the contrast operation change lightness while retaining the two colour channels, rather than equalizing B, G and R independently.',
        'An L-channel matrix and a Lab image holding the retained colour channels.'
      ),
      stage(
        ['createCLAHE', 'insertChannel', 'COLOR_Lab2BGR'],
        'The lightness channel.',
        'CLAHE adjusts local intensity distributions with a clip limit that restrains amplification. Inserting enhanced L back into Lab and converting to BGR produces the final colour result. This restores visibility of local contrast, not detail already removed by denoising.',
        'A colour image with reduced noise and enhanced local lightness contrast.'
      )
    ],
    tuning:
      'Start with modest denoising strength, then increase the CLAHE clip limit only as needed. Compare fine texture before and after denoising: once erased, contrast enhancement cannot reconstruct it. Remaining noise often becomes visible at high clip limits.',
    check:
      'Inspect Denoised colour before judging the final contrast. Waxy texture points to excess denoising; grain that appears only in the final image points to contrast amplification.'
  },
  'sharpen-details': {
    intuition:
      'Sharpening can be understood as amplifying the difference between an image and a smooth version of itself. That difference contains edges and fine texture, along with noise.',
    stages: [
      stage(
        ['GaussianBlur'],
        'The original colour image.',
        'Gaussian blur estimates the slowly varying part of the image. Its sigma chooses which spatial scales are treated as detail: a small sigma isolates fine changes, while a larger sigma includes broader edge transitions.',
        'A smooth low-frequency colour layer.'
      ),
      stage(
        ['Mat.convertTo', 'subtract'],
        'Original and smooth layers in float32.',
        'Subtracting smooth from original yields positive and negative detail. Float32 preserves the negative lobes that unsigned subtraction would clip. The normalized preview shows their shape, while the pixel inspector retains their signed values.',
        'A signed detail layer: detail = original - smooth.'
      ),
      stage(
        ['addWeighted'],
        'The original and smooth colour images.',
        'The equivalent formula original + amount × detail becomes (1 + amount) × original - amount × smooth. addWeighted performs that combination into the final 8-bit image, where out-of-range values saturate.',
        'A sharpened colour image with contrast increased around details.'
      )
    ],
    tuning:
      'Set sigma for the width of detail you want to emphasize, then adjust amount. At amount zero the output should reproduce the original. Denoise beforehand if grain dominates the detail layer.',
    check:
      'Inspect strong edges for bright and dark halos and inspect smooth regions for amplified noise. Large amounts can clip highlights and shadows; stronger local contrast is not recovered information.'
  },
  'focus-map': {
    intuition:
      'Blur weakens rapid intensity changes. A derivative-energy map can show where those changes remain, but the result is also driven by how much texture and noise the scene contains.',
    stages: [
      stage(
        ['Laplacian'],
        'Grayscale intensity.',
        'The Laplacian is a second spatial derivative and responds strongly around rapid transitions. A float32 destination retains both signs instead of clipping one side of an edge.',
        'A signed derivative field.'
      ),
      stage(
        ['multiply', 'blur'],
        'The signed derivative values.',
        'Squaring turns both positive and negative responses into nonnegative energy. Box averaging summarizes energy in a local neighbourhood, so a window receives a score rather than alternating signs that would cancel.',
        'A float32 mean-squared-Laplacian map in intensity-squared units.'
      ),
      stage(
        ['normalize'],
        'The local energy map.',
        'Min-max normalization maps the field into an 8-bit preview so its spatial pattern is visible. The lab keeps native values for numeric inspection. This is display scaling, not histogram equalization, and it does not calibrate the score across images.',
        'A visible sharpness-related map and its original local energy values.'
      )
    ],
    tuning:
      'A small energy window gives a localized but noisier map; a large window smooths the score across features. Keep image size, exposure and processing settings fixed when comparing numeric values across a sequence.',
    check:
      'A blank but sharply focused wall can score below a blurry patterned surface. Noise also raises the score. Compare the same textured region across candidate frames rather than treating the map as universal image quality.'
  },
  'scan-document': {
    intuition:
      'A photographed page is usually a quadrilateral. Find that geometry first, map it to a rectangle, then decide which pixels represent ink in the corrected view.',
    stages: [
      stage(
        ['GaussianBlur', 'Canny'],
        'A grayscale photo containing the whole page.',
        'A small blur suppresses fine noise before Canny detects strong connected edges. The edge map emphasizes candidate page boundaries, reducing the geometry search from all pixels to visible outlines.',
        'An 8-bit edge map.'
      ),
      stage(
        ['findContours', 'approxPolyDP', 'isContourConvex'],
        'The edge map.',
        'Contours group edge pixels into outlines. Polygon approximation reduces each outline to dominant corners, and the lab selects the largest convex four-corner candidate covering at least 5% of the image. Ordering its corners consistently is essential before constructing correspondences.',
        'Four ordered page corners, or an explicit failure if no suitable candidate exists.'
      ),
      stage(
        ['getPerspectiveTransform', 'warpPerspective', 'adaptiveThreshold'],
        'Four page corners and four destination rectangle corners.',
        'The perspective transform maps the planar page into a flat rectangle; output dimensions are estimated from opposing edge lengths. Adaptive thresholding then separates ink using local neighbourhood brightness, helping when illumination still varies across the corrected page.',
        'A perspective-corrected black-and-white document image.'
      )
    ],
    tuning:
      'Include all page corners and contrast between the page and surrounding surface. Adjust the Canny low threshold if the page border disappears or excessive clutter dominates. Threshold C adjusts ink selection after the geometry has been established.',
    check:
      'Inspect Selected page and Flattened page separately. If the chosen quadrilateral is wrong, no threshold adjustment can repair the geometry. A curved page or missing border needs another model or manually supplied corners.'
  },
  'clean-document': {
    intuition:
      'The page combines ink detail with slower lighting variation. Estimate that slow variation, divide it out, then use a local decision rule for the remaining ink.',
    stages: [
      stage(
        ['GaussianBlur'],
        'Grayscale page intensity.',
        'A broad blur suppresses thin strokes while retaining slow brightness changes. Under the assumption that the page is mostly background at this scale, this gives an approximate illumination field rather than a useful sharpened or denoised page.',
        'A smooth estimate of background illumination.'
      ),
      stage(
        ['Mat.convertTo', 'divide'],
        'Original grayscale and illumination estimate in float32.',
        'Dividing original intensity by estimated illumination compensates for multiplicative shading. The denominator is clamped to at least one to avoid division by zero, and a scale of 220 maps background near a readable brightness before conversion back to 8-bit.',
        'A page with reduced broad brightness variation.'
      ),
      stage(
        ['adaptiveThreshold', 'ADAPTIVE_THRESH_GAUSSIAN_C'],
        'The normalized 8-bit page.',
        'A locally weighted mean minus C supplies a threshold for each pixel. The neighbourhood adapts to residual lighting differences that one global threshold would miss, turning darker strokes into black ink on a white background.',
        'A binary document suitable for inspection or a later OCR stage.'
      )
    ],
    tuning:
      'Illumination sigma should be broad compared with stroke width. The threshold window should span several strokes while remaining local to lighting variation. Increasing C lowers the threshold and generally makes more pixels white, which can remove both background noise and faint ink.',
    check:
      'If text remains visible in the illumination estimate, the blur scale is too small or the background assumption is failing. Large graphics and abrupt shadows can contaminate the estimate. Preserve enough processing resolution for thin strokes.'
  },
  'deskew-text': {
    intuition:
      'Many text baselines or ruled lines share a small tilt. Detect those directions, summarize the dominant angle robustly, then correct the entire page with one rotation.',
    stages: [
      stage(
        ['Canny'],
        'The grayscale page.',
        'Canny emphasizes text and rule edges. A sparse edge representation gives the following line detector evidence about direction without treating every filled character pixel as an independent feature.',
        'An edge map.'
      ),
      stage(
        ['HoughLinesP', 'Median angle'],
        'The edge map.',
        'Probabilistic Hough detection extracts line segments. The lab normalizes their directions and keeps only segments within the accepted near-horizontal angle range. Taking the median reduces the influence of a few slanted graphics or incorrect segments.',
        'A set of accepted segments and one median tilt estimate.'
      ),
      stage(
        ['getRotationMatrix2D', 'warpAffine'],
        'The colour page and median angle.',
        'A rotation about the image centre applies the estimated correction to all pixels consistently. With image coordinates increasing downward, the measured atan2 angle is passed to OpenCV’s rotation matrix to level those segments. Cubic interpolation resamples pixels and a white border fills exposed space.',
        'A page rotated into the same output dimensions, with the correction angle reported.'
      )
    ],
    tuning:
      'Increase minimum line length to reject short character fragments, or decrease it when no useful segments survive. Limit accepted tilt to the expected document orientation so vertical rules do not dominate.',
    check:
      'Inspect Accepted lines: they should follow text or intended horizontal rules. Tables and decorative lines can bias the median. Rotation can clip corners in the unchanged canvas size, and it cannot remove perspective distortion.'
  },
  'stereo-depth': {
    intuition:
      'In a rectified stereo pair, a scene point appears at different horizontal positions in the two views. Nearby points shift more than distant points. Estimate that disparity first, then convert it to depth with calibrated camera geometry.',
    stages: [
      stage(
        ['StereoSGBM.create', 'StereoSGBM.compute'],
        'Left and right grayscale views with matching rectified rows.',
        'Semi-global block matching compares candidate horizontal offsets and regularizes neighbouring disparities. Rectification is a prerequisite: otherwise the corresponding point may lie on a different row that this search never considers.',
        'A signed 16-bit disparity map encoded with four fractional bits.'
      ),
      stage(
        ['Mat.convertTo', 'Positive-disparity selection'],
        'The fixed-point disparity map.',
        'Multiplying by 1/16 recovers disparity in pixels. The lab excludes nonpositive values from depth conversion because they are invalid for this positive-baseline setup or would cause division by zero. This validity test alone does not establish a correct correspondence.',
        'Positive pixel disparities plus invalid samples.'
      ),
      stage(
        ['Depth = focal length × baseline / disparity'],
        'Positive disparity, focal length in processed pixels and baseline in metres.',
        'Similar-triangle geometry gives Z = fB/d for this calibrated, rectified arrangement. Converting units consistently is essential: resizing images changes the focal length in pixels. Small disparity errors at long distance can produce large depth errors because disparity is in the denominator.',
        'A float32 depth field in metres. The lab uses zero as an invalid-value marker.'
      )
    ],
    tuning:
      'Choose a disparity range large enough for the nearest expected objects and smaller than image width. Supply calibrated focal length adjusted for the processing scale and the real camera baseline. Arbitrary values yield arbitrary depth units or scale.',
    check:
      'The demo pair illustrates the calculation, not a calibrated camera measurement. Inspect disparity before depth, especially around occlusions, repeated texture and flat areas. Temporal camera panning without a known stereo setup is not sufficient for metric depth.'
  },
  'colour-palette': {
    intuition:
      'To summarize an image with a small set of colours, first reduce incidental local variation, then learn representative colours and assign every pixel to one of them.',
    stages: [
      stage(
        ['bilateralFilter'],
        'An 8-bit BGR image.',
        'Bilateral filtering averages nearby pixels according to both position and colour similarity. This reduces fluctuations within colour regions while preserving some strong boundaries, giving clustering fewer small variations to spend palette entries on.',
        'A smoothed colour image.'
      ),
      stage(
        ['kmeans', 'KMEANS_PP_CENTERS'],
        'A float32 sample matrix with one BGR triplet per pixel.',
        'K-means alternates assigning pixels to their nearest colour centre and updating centres from assigned samples. K-means++ chooses spread-out initial centres. The lab clusters colour only, so disconnected areas of similar colour can share the same palette entry.',
        'One integer cluster ID per pixel and K learned BGR centres.'
      ),
      stage(
        ['Palette lookup'],
        'Cluster labels and colour centres.',
        'Replacing each pixel by its assigned centre turns the learned clusters into a visible reduced-palette image. Keeping the label field allows later grouping, recolouring or measuring palette usage without reclustering.',
        'A quantized colour image and inspectable palette IDs.'
      )
    ],
    tuning:
      'Increase palette colours to retain more distinctions; decrease them for stronger simplification. Increase bilateral colour sigma to smooth a broader range of colours before clustering, while watching for merging of important boundaries.',
    check:
      'K-means optimizes sample distances, not semantic importance or perceptual colour difference. A small but important accent colour may disappear. For perceptual palette work, consider clustering in Lab and handling conversion and gamut deliberately.'
  }
}
