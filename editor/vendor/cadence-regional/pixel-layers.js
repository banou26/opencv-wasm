import { OTHER_LAYER, measurePairChange } from "./pixel-change.js";
import { candidateMotions, coarseTranslation, refineTranslation } from "./pixel-camera.js";
import { cameraPath, drawingSilhouette, frameOffset, pairEvidence, worldAtlas } from "./pixel-drawings.js";
import { pixelLuma } from "./pixel-frame.js";
import { addPlateSamples, finishPlate, plateReference, plateStatistics } from "./pixel-plate.js";
/**
 * Candidate motions linked across pairs: each continues the track whose latest candidate, at most
 * `maxGap` pairs back, is nearest within `continuity` pixels. A static layer drops out on redraw pairs,
 * where the redrawn drawings break its blocks, and must still be one track.
 */
export function motionTracks(found, continuity = 2, maxGap = 6) {
    const tracks = [];
    for (const [pair, candidates] of found.entries()) {
        const taken = new Set();
        for (const candidate of candidates) {
            let best = -1, distance = continuity;
            for (const [i, track] of tracks.entries()) {
                const last = pair - track.lastPair <= maxGap ? track.members[track.lastPair] : undefined;
                if (!last || taken.has(i))
                    continue;
                const d = Math.hypot(last.dx - candidate.dx, last.dy - candidate.dy);
                if (d <= distance) {
                    best = i;
                    distance = d;
                }
            }
            if (best < 0) {
                tracks.push({ support: 0, members: [], lastPair: pair });
                best = tracks.length - 1;
            }
            taken.add(best);
            tracks[best].members[pair] = candidate;
            tracks[best].support += candidate.blocks;
            tracks[best].lastPair = pair;
        }
    }
    return tracks.map(({ support, members }) => ({ support, members }));
}
/** The track with the most block support; `motionTracks` then `referenceTrack` decide the camera when several persist. */
export function cameraTrack(found, continuity = 2) {
    const tracks = motionTracks(found, continuity);
    return tracks.reduce((a, b) => b.support > a.support ? b : a, tracks[0] ?? { support: 0, members: [] }).members;
}
/** Steps of a track for every pair; a missing pair takes the candidate nearest the track's last step, else no motion. */
export function trackSteps(track, found) {
    const steps = [];
    for (let pair = 0; pair < found.length; pair++) {
        const own = track.members[pair], last = steps[pair - 1] ?? { dx: 0, dy: 0 };
        const nearest = found[pair].reduce((best, c) => !best || Math.hypot(c.dx - last.dx, c.dy - last.dy) < Math.hypot(best.dx - last.dx, best.dy - last.dy) ? c : best, undefined);
        steps.push(own ?? nearest ?? { dx: 0, dy: 0 });
    }
    return steps;
}
/**
 * Among persistent tracks, the reference is the one in whose coordinates the redraws stay put: pixels no
 * candidate explains, accumulated over the shot in each track's own world coordinates, cover the least
 * area. A static character redrawn in place smears by the slide speed per frame in a sliding layer's
 * coordinates. Runs at `scale` of the frame size; ties within 5% go to block support.
 */
export async function referenceTrack(source, found, tracks, scale = .25) {
    const span = (t) => { const pairs = t.members.flatMap((m, i) => m ? [i] : []); return pairs.length ? pairs[pairs.length - 1] - pairs[0] + 1 : 0; };
    const persistent = tracks.filter(t => span(t) >= found.length / 2);
    if (persistent.length < 2)
        return persistent[0] ?? tracks.reduce((a, b) => b.support > a.support ? b : a, { support: 0, members: [] });
    const w = Math.round(source.width * scale), h = Math.round(source.height * scale);
    const reduce = (frame) => {
        const luma = pixelLuma(frame), out = new Float32Array(w * h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                let sum = 0, n = 0;
                for (let sy = Math.floor(y / scale); sy < Math.floor((y + 1) / scale); sy++)
                    for (let sx = Math.floor(x / scale); sx < Math.floor((x + 1) / scale); sx++) {
                        sum += luma[sy * source.width + sx];
                        n++;
                    }
                out[y * w + x] = sum / n;
            }
        return out;
    };
    const sample = (plane, x, y) => {
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, p = y0 * w + x0;
        return (plane[p] * (1 - fx) + plane[p + 1] * fx) * (1 - fy) + (plane[p + w] * (1 - fx) + plane[p + w + 1] * fx) * fy;
    };
    const paths = persistent.map(track => cameraPath(w, h, trackSteps(track, found).map(s => ({ dx: s.dx * scale, dy: s.dy * scale }))));
    const unions = paths.map(path => { const atlas = worldAtlas(path); return { atlas, seen: new Uint8Array(atlas.width * atlas.height) }; });
    let previous = reduce(await source.frame(0));
    for (let pair = 0; pair < found.length; pair++) {
        const next = reduce(await source.frame(pair + 1)), motions = found[pair].map(m => ({ dx: m.dx * scale, dy: m.dy * scale }));
        const changed = new Uint8Array(w * h);
        for (let y = 2; y < h - 2; y++)
            for (let x = 2; x < w - 2; x++) {
                const p = y * w + x, v = previous[p];
                const gradient = Math.hypot(previous[p + 1] - previous[p - 1], previous[p + w] - previous[p - w]) / 2;
                let best = Infinity;
                for (const m of motions) {
                    const qx = x + m.dx, qy = y + m.dy;
                    if (qx < 1 || qy < 1 || qx > w - 2 || qy > h - 2)
                        continue;
                    best = Math.min(best, Math.abs(sample(next, qx, qy) - v));
                }
                changed[p] = Number(best !== Infinity && best > 10 + .3 * gradient);
            }
        for (const [k, path] of paths.entries()) {
            const offset = frameOffset(path, unions[k].atlas, pair), { atlas, seen } = unions[k];
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++)
                    if (changed[y * w + x])
                        seen[(y + offset.y) * atlas.width + x + offset.x] = 1;
        }
        previous = next;
    }
    const areas = unions.map(u => u.seen.reduce((sum, v) => sum + v, 0)), smallest = Math.min(...areas);
    const close = persistent.filter((_, k) => areas[k] <= smallest * 1.05);
    return close.reduce((a, b) => b.support > a.support ? b : a);
}
/**
 * Candidate motions are linked across pairs into tracks, and the camera is the reference track: the one
 * in whose coordinates the redraws hold still (see `referenceTrack`). A single dominant motion is simply
 * that motion. Pairs where the reference has no candidate take the one nearest its last step. `start`
 * overrides the camera for a pair.
 */
export async function measureCameraPath(source, options = {}) {
    const coarse = [], found = [], continuity = options.continuity ?? 2;
    let previous = pixelLuma(await source.frame(0));
    for (let pair = 0; pair < source.count - 1; pair++) {
        await options.progress?.(pair, source.count - 1);
        const next = pixelLuma(await source.frame(pair + 1));
        coarse.push(coarseTranslation(previous, next, source.width, source.height));
        found.push(candidateMotions(previous, next, source.width, source.height));
        previous = next;
    }
    const tracks = motionTracks(found, continuity), camera = (await referenceTrack(source, found, tracks)).members;
    const fits = [], motions = [];
    const present = camera.flatMap((m, i) => m ? [i] : []);
    for (let pair = 0; pair < found.length; pair++) {
        const start = options.start?.(pair);
        let chosen = start ? undefined : camera[pair];
        if (!chosen) {
            // The reference layer went unmeasured on this pair; refine from its nearest measured step, never
            // from another layer's candidate.
            const before = present.filter(i => i < pair).pop(), after = present.find(i => i > pair);
            const expected = before !== undefined && after !== undefined
                ? { dx: camera[before].dx + (camera[after].dx - camera[before].dx) * (pair - before) / (after - before), dy: camera[before].dy + (camera[after].dy - camera[before].dy) * (pair - before) / (after - before) }
                : camera[before ?? after ?? -1] ?? coarse[pair];
            const a = pixelLuma(await source.frame(pair)), b = pixelLuma(await source.frame(pair + 1));
            chosen = refineTranslation(a, b, source.width, source.height, start ?? expected);
            // A textured layer can pull the refinement onto itself; then trust the reference's own neighbors.
            const other = found[pair].some(c => Math.hypot(c.dx - chosen.dx, c.dy - chosen.dy) < .5);
            if (!start && other && Math.hypot(chosen.dx - expected.dx, chosen.dy - expected.dy) > 1)
                chosen = { ...expected, residual: NaN, samples: 0, iterations: 0 };
        }
        fits.push(chosen);
        motions.push([{ ...chosen, blocks: 'blocks' in chosen ? chosen.blocks : 0 }, ...found[pair].filter(c => Math.hypot(c.dx - chosen.dx, c.dy - chosen.dy) >= .15)]);
    }
    return { ...cameraPath(source.width, source.height, fits), fits, coarse, motions };
}
const otherLayer = (change) => packMask(change.flags.map(f => f & OTHER_LAYER ? 1 : 0));
export async function measureDrawingEvidence(source, camera, options = {}) {
    const atlas = worldAtlas(camera), dilation = options.dilation ?? 1, inkDilation = options.inkDilation ?? 1;
    const { progress, dilation: _, inkDilation: __, ...changeOptions } = options;
    const pairs = [], summaries = [], others = [], othersBackward = [];
    let previous = await source.frame(0);
    for (let pair = 0; pair < source.count - 1; pair++) {
        await progress?.(pair, source.count - 1);
        const next = await source.frame(pair + 1), step = camera.positions[pair + 1], base = camera.positions[pair];
        const d = { dx: step.dx - base.dx, dy: step.dy - base.dy };
        const layers = camera.motions?.[pair]?.slice(1) ?? [];
        const forward = measurePairChange(previous, next, d, { ...changeOptions, otherMotions: layers });
        const backward = measurePairChange(next, previous, { dx: -d.dx, dy: -d.dy }, { ...changeOptions, otherMotions: layers.map(m => ({ dx: -m.dx, dy: -m.dy })) });
        const evidence = pairEvidence(camera, atlas, pair, forward, backward, dilation, inkDilation);
        pairs.push(evidence);
        others.push(otherLayer(forward));
        othersBackward.push(otherLayer(backward));
        summaries.push({ forward: forward.changed, backward: backward.changed, noise: forward.noise, evidence: evidence.indices.length });
        previous = next;
    }
    return { camera, atlas, dilation, inkDilation, pairs, summaries, options: changeOptions, others, othersBackward };
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
/** Two passes: a plain mean outside the drawings and other rigid layers, then a mean of the samples near it. */
export async function buildLayerPlate(source, camera, silhouettes, options = {}) {
    const atlas = worldAtlas(camera), margin = options.margin ?? 3, size = source.width * source.height;
    const exclude = (frame) => {
        const mask = unpackMask(silhouettes.frames[frame].packed, size), ev = options.evidence;
        // Another layer only claims a pixel when neither neighbor pair explains it under the camera.
        if (!ev?.others.length)
            return mask;
        const forward = frame < ev.others.length ? unpackMask(ev.others[frame], size) : undefined;
        const backward = frame > 0 ? unpackMask(ev.othersBackward[frame - 1], size) : undefined;
        for (let p = 0; p < size; p++)
            if ((forward?.[p] ?? 1) && (backward?.[p] ?? 1) && (forward || backward))
                mask[p] = 1;
        return mask;
    };
    const first = plateStatistics(atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(frame, source.count * 2);
        addPlateSamples(first, camera, frame, await source.frame(frame), exclude(frame), margin);
    }
    const reference = plateReference(first, options.floor ?? 4), trimmed = plateStatistics(atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(source.count + frame, source.count * 2);
        addPlateSamples(trimmed, camera, frame, await source.frame(frame), exclude(frame), margin, reference);
    }
    return finishPlate(trimmed);
}
