import type { NodeSpec, Parameter, Port } from './types'

const number = (key: string, label: string, value: number, min: number, max: number, step = 1): Parameter => ({ kind: 'number', key, label, default: value, min, max, step })
const regions = (direction: 'in' | 'out', schema?: string): Port => ({ id: `${direction}:regions:data`, type: 'regions', label: schema ?? 'Regional data', ...(schema ? { schema } : {}) })
const stage = (type: NodeSpec['type'], title: string, description: string, input: string, output: string, parameters: Parameter[] = []): NodeSpec =>
  ({ type, title, description, category: 'Pixel layers', algorithm: 'cadence/regional pixel stages', version: 1, inputs: [regions('in', input)], outputs: [regions('out', output)], parameters })

/** Full-resolution stages: each decodes the scene's original frames on demand and keeps only compact evidence. */
export const PIXEL_CATALOG: NodeSpec[] = [
  stage('pixelCamera', 'Pixel Camera Path', 'Measure the camera between every adjacent pair at full resolution: phase correlation on a reduced copy, then robust coarse-to-fine Lucas-Kanade on luma. Pixels far from the fitted motion get no weight. The strongest motion wins, which is the camera only when it dominates the frame.', 'scene', 'pixel-camera'),
  stage('pixelEvidence', 'Redraw Ink Evidence', 'Test every pixel of each pair against the other frame displaced by the camera. A pixel is explained when its value lies between the minimum and maximum of the other frame sampled within Reach pixels, so a new resampling phase of the same drawing passes while a redrawn line fails. Changed pixels are stored in world coordinates with an ink sign: ink arrives when the later frame is darker and locally dark (a line), leaves when the earlier one is.', 'pixel-camera', 'pixel-evidence', [
    number('reach', 'Reach · px', .5, 0, 2, .05), number('noiseFactor', 'Noise factor', 4, .5, 20, .1), number('gradientSlope', 'Edge tolerance per gradient code', .1, 0, 2, .01),
    number('inkDelta', 'Ink contrast · codes', 8, 0, 128, 1), number('lineDelta', 'Line darkness · codes', 4, 0, 64, 1), number('dilation', 'Change dilation · px', 1, 0, 4, 1),
  ]),
  stage('pixelScenery', 'Scenery Median', 'Take the median luma of every world pixel that ever changed, over the whole shot, and mark each change whose value before or after it is that scenery (within Tolerance codes, from at least Minimum samples). Drawing Silhouettes then rejects ink revealed from under a drawing that is the scenery, unless the change only boiled (the same structure within 2 pixels). A drawing passing over a pixel is a minority of its history; one that stands still boils in place.', 'pixel-evidence', 'pixel-evidence', [
    number('tolerance', 'Tolerance · codes', 10, 0, 64, 1), number('minimumSamples', 'Minimum samples', 8, 1, 255, 1),
  ]),
  stage('pixelSilhouettes', 'Drawing Silhouettes', 'For every frame, take the ink of the drawing held at that frame: ink that arrived at each pixel’s last change before it, or leaves at its next change after it. Close the ink, fill enclosed holes and drop small components. Artwork that never changes stays in the scenery; background a drawing vacates or is about to cover carries the opposite ink sign. Ink whose value recurs before the previous change or after the next one, within Recurrence codes, is scenery a drawing covered and uncovered (0 disables).', 'pixel-evidence', 'pixel-silhouettes', [
    number('closeRadius', 'Close radius · px', 6, 0, 32, 1), number('minimumArea', 'Minimum area · px', 800, 1, 1000000, 1), number('erode', 'Erode · px', 0, 0, 8, 1), number('recurrence', 'Recurrence · codes', 0, 0, 64, 1), { kind: 'select', key: 'sceneryLeaves', label: 'Scenery about to be covered', default: 'never', options: ['never', 'recurring', 'always'] },
  ]),
  stage('pixelPlate', 'Background Plate', 'Accumulate every frame outside its silhouettes, grown by Margin, into a world atlas. Pixels only another rigid layer explains (a sliding background) stay out. A plain mean first, then the mean of samples within three spreads of it (never under Floor codes). Pixels never seen outside a drawing stay unknown.', 'pixel-silhouettes', 'pixel-plate', [
    number('margin', 'Margin · px', 3, 0, 16, 1), number('floor', 'Floor · codes', 4, 0, 64, .5),
  ]),
  stage('pixelRefine', 'Refine Silhouettes', 'Carve silhouette pixels the plate explains, from the outside in: within Band pixels of the edge, a pixel matching a plate observed at least Minimum count times (every channel within Tolerance codes, plus a gradient allowance) is background when it connects to the exterior through such pixels. The outline, which does not match the scenery, stops the carve, and interior fills that happen to match it are never reached. Rebuild the plate afterwards with a second Background Plate.', 'pixel-plate', 'pixel-silhouettes', [
    number('band', 'Band · px', 8, 0, 64, 1), number('tolerance', 'Tolerance · codes', 6, 0, 64, .5), number('minimumCount', 'Minimum count', 3, 1, 1000, 1),
  ]),
  stage('pixelFrames', 'Layer Frames', 'Link silhouette components through time by their overlap in world coordinates; everything that ever touches becomes one layer. Split each layer into held drawings at every pair whose changes inside it reach Minimum changes and Minimum fraction of its area. Each drawing keeps a thumbnail cut from its first frame.', 'pixel-plate', 'pixel-frames', [
    number('minimumChanges', 'Minimum changes · px', 60, 1, 1000000, 1), number('minimumFraction', 'Minimum fraction of layer', .06, 0, 1, .005),
  ]),
  { type: 'pixelInspect', title: 'Inspect Pixel Layers', category: 'Pixel layers', algorithm: 'Read-only full-resolution panels', version: 1,
    description: 'Show one source frame with the pixel stages computed so far. Changes: this frame to the next, green where ink arrives, magenta where it leaves, yellow for other changes. Ink: the held drawing’s ink with its silhouette outline in cyan. Layer: silhouette pixels over a checkerboard, with the edge unmixed against the plate where it is known (straight alpha). Plate: the background at this camera position, unknown in purple, disagreement outside the silhouettes in orange (over 12 codes) and red (over 20). Layer frames: every held drawing of the layers on screen, the one shown now outlined.',
    inputs: [regions('in')], outputs: [
      { id: 'out:frame:source', label: 'Source', type: 'frame' }, { id: 'out:frame:changes', label: 'Changes to next', type: 'frame' },
      { id: 'out:frame:ink', label: 'Held ink', type: 'frame' }, { id: 'out:frame:layer', label: 'Layer', type: 'frame' },
      { id: 'out:frame:plate', label: 'Plate', type: 'frame' }, { id: 'out:frame:drawings', label: 'Layer frames', type: 'frame' }, { id: 'out:string:summary', label: 'Summary', type: 'string' },
    ], parameters: [number('frame', 'Source frame', 0, 0, 1000000000), number('displayMaxSide', 'Display max side · 0 = full', 960, 0, 3840)] },
]
