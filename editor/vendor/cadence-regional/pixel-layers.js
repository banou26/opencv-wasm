import { measurePairChange } from "./pixel-change.js";
import { coarseTranslation, refineTranslation } from "./pixel-camera.js";
import { cameraPath, drawingSilhouette, pairEvidence, worldAtlas } from "./pixel-drawings.js";
import { pixelLuma } from "./pixel-frame.js";
import { addPlateSamples, finishPlate, plateReference, plateStatistics } from "./pixel-plate.js";
/** `start` overrides the phase-correlation estimate for a pair, e.g. with the dominant motion group. */
export async function measureCameraPath(source, options = {}) {
    const fits = [], coarse = [];
    let previous = pixelLuma(await source.frame(0));
    for (let pair = 0; pair < source.count - 1; pair++) {
        await options.progress?.(pair, source.count - 1);
        const next = pixelLuma(await source.frame(pair + 1));
        const phase = coarseTranslation(previous, next, source.width, source.height);
        coarse.push(phase);
        fits.push(refineTranslation(previous, next, source.width, source.height, options.start?.(pair) ?? phase));
        previous = next;
    }
    return { ...cameraPath(source.width, source.height, fits), fits, coarse };
}
export async function measureDrawingEvidence(source, camera, options = {}) {
    const atlas = worldAtlas(camera), dilation = options.dilation ?? 1, inkDilation = options.inkDilation ?? 1;
    const { progress, dilation: _, inkDilation: __, ...changeOptions } = options;
    const pairs = [], summaries = [];
    let previous = await source.frame(0);
    for (let pair = 0; pair < source.count - 1; pair++) {
        await progress?.(pair, source.count - 1);
        const next = await source.frame(pair + 1), step = camera.positions[pair + 1], base = camera.positions[pair];
        const d = { dx: step.dx - base.dx, dy: step.dy - base.dy };
        const forward = measurePairChange(previous, next, d, changeOptions);
        const backward = measurePairChange(next, previous, { dx: -d.dx, dy: -d.dy }, changeOptions);
        const evidence = pairEvidence(camera, atlas, pair, forward, backward, dilation, inkDilation);
        pairs.push(evidence);
        summaries.push({ forward: forward.changed, backward: backward.changed, noise: forward.noise, evidence: evidence.indices.length });
        previous = next;
    }
    return { camera, atlas, dilation, inkDilation, pairs, summaries, options: changeOptions };
}
/** One bit per pixel, row-major, most significant bit first. */
export const packMask = (mask) => {
    const out = new Uint8Array(Math.ceil(mask.length / 8));
    for (let p = 0; p < mask.length; p++)
        if (mask[p])
            out[p >> 3] |= 128 >> (p & 7);
    return out;
};
export const unpackMask = (packed, length) => {
    const out = new Uint8Array(length);
    for (let p = 0; p < length; p++)
        out[p] = (packed[p >> 3] >> (7 - (p & 7))) & 1;
    return out;
};
export async function sceneSilhouettes(evidence, options = {}) {
    const { progress, ...silhouetteOptions } = options, { width, height } = evidence.camera, frames = [];
    for (let frame = 0; frame <= evidence.pairs.length; frame++) {
        await progress?.(frame, evidence.pairs.length + 1);
        const silhouette = drawingSilhouette(evidence, frame, silhouetteOptions);
        frames.push({ packed: packMask(silhouette.mask), area: silhouette.components.reduce((sum, c) => sum + c.area, 0), components: silhouette.components });
    }
    return { width, height, options: silhouetteOptions, frames };
}
/** Two passes: a plain mean outside the drawings, then a mean of the samples near it. */
export async function buildLayerPlate(source, camera, silhouettes, options = {}) {
    const atlas = worldAtlas(camera), margin = options.margin ?? 3, size = source.width * source.height;
    const first = plateStatistics(atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(frame, source.count * 2);
        addPlateSamples(first, camera, frame, await source.frame(frame), unpackMask(silhouettes.frames[frame].packed, size), margin);
    }
    const reference = plateReference(first, options.floor ?? 4), trimmed = plateStatistics(atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(source.count + frame, source.count * 2);
        addPlateSamples(trimmed, camera, frame, await source.frame(frame), unpackMask(silhouettes.frames[frame].packed, size), margin, reference);
    }
    return finishPlate(trimmed);
}
