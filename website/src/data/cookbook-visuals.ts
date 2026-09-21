/** Native lab snapshots grouped by the cookbook's conceptual data-flow steps.
 * Names are checked during generation, so a changed pipeline cannot silently show the wrong image.
 * Multiple frames reveal substeps such as a mask followed by its composited result.
 */
export const cookbookVisualStages: Record<string, string[][]> = {
  'motion-vectors': [
    ['Pan-compensated second frame'],
    ['Raw flow before validation'],
    ['Accepted samples', 'Dense displacement', 'Result']
  ],
  'track-region': [['Selected corners'], ['Consistent tracks'], ['Result']],
  'locate-template': [['Selected patch'], ['Correlation map'], ['Result']],
  'align-images': [['Detected ORB features'], ['Candidate matches', 'RANSAC inliers'], ['Alignment overlay', 'Result']],
  'match-features': [['Detected ORB features'], ['Candidate matches'], ['RANSAC inliers']],
  'detect-motion': [
    ['Smoothed frame pair'],
    ['Absolute difference', 'Thresholded differences'],
    ['Clean difference mask', 'Result']
  ],
  'compare-images': [['Local SSIM'], ['Thresholded differences'], ['Clean difference mask', 'Result']],
  'count-objects': [['Threshold mask'], ['Opened mask'], ['Result']],
  'segment-touching': [
    ['Foreground mask'],
    ['Interior distance', 'Foreground seeds', 'Labelled seed locations'],
    ['Result']
  ],
  'measure-shapes': [['Foreground mask'], ['Simplified contours'], ['Result']],
  'colour-mask': [['Hue channel', 'Saturation channel'], ['HSV selection'], ['Closed selection', 'Result']],
  'crop-object': [['Foreground mask'], ['Selected bounds'], ['Result']],
  'remove-background': [['Initial region'], ['GrabCut foreground'], ['Soft mask', 'Result']],
  'blur-background': [['Initial region', 'GrabCut foreground'], ['Blurred background'], ['Soft mask', 'Result']],
  'blur-region': [['Selected mask'], ['Blurred layer'], ['Result']],
  'denoise-detail': [['Denoised colour'], ['Lab lightness'], ['Result']],
  'sharpen-details': [['Smooth image'], ['Signed detail'], ['Result']],
  'focus-map': [['Signed Laplacian'], ['Local energy'], ['Result']],
  'scan-document': [['Page edges'], ['Selected page'], ['Flattened page', 'Result']],
  'clean-document': [['Illumination estimate'], ['Normalized page'], ['Result']],
  'deskew-text': [['Page edges'], ['Accepted lines'], ['Result']],
  'stereo-depth': [['Rectified grayscale pair', 'Disparity'], ['Valid disparities'], ['Result']],
  'colour-palette': [['Smoothed colours'], ['Learned palette'], ['Result']]
}
export type CookbookVisualFrame = {
  src: string
  title: string
  description: string
  width: number
  height: number
}
export type CookbookVisual = {
  input: CookbookVisualFrame
  second?: CookbookVisualFrame
  stages: CookbookVisualFrame[][]
  note: string
}
export type CookbookVisualManifest = {
  sourceHash: string
  version: string
  recipes: Record<string, CookbookVisual>
}
