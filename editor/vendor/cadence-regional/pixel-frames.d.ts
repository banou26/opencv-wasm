import { type DrawingEvidence } from './pixel-drawings.ts';
import { type SceneSilhouettes } from './pixel-layers.ts';
import type { Box } from './types.ts';
/** One held drawing: the frames it is shown on and its extent in world-atlas pixels. */
export type LayerDrawing = {
    id: number;
    first: number;
    last: number;
    box: Box;
    area: number;
};
/**
 * Silhouette components linked through time by overlap in world coordinates. A layer is a union of
 * everything that ever touched, so characters that meet become one layer. A drawing ends at a pair whose
 * changes inside the layer exceed the redraw threshold.
 */
export type LayerFrames = {
    layers: {
        id: number;
        drawings: LayerDrawing[];
    }[];
    /** Per frame: the drawing shown by each layer present, as [layer, drawing] pairs. */
    frames: [number, number][][];
    /** Per frame, the layer of each silhouette component, in connectedComponents label order (label 1 first). */
    componentLayers: Int32Array[];
    options: {
        minimumChanges: number;
        minimumFraction: number;
    };
};
/** Layer id plus one for every pixel of a frame, 0 outside all silhouettes. */
export declare function frameLayerLabels(silhouettes: SceneSilhouettes, frames: LayerFrames, frame: number): Uint16Array;
export declare function layerFrames(evidence: DrawingEvidence, silhouettes: SceneSilhouettes, options?: {
    minimumChanges?: number;
    minimumFraction?: number;
}): LayerFrames;
