var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { OTHER_LAYER, measurePairChange } from "./pixel-change.js";
import { candidateMotions, coarseTranslation, refineTranslation } from "./pixel-camera.js";
import { AFTER_SCENERY, BEFORE_SCENERY, VALUED, cameraPath, drawingSilhouette, frameOffset, pairEvidence, worldAtlas } from "./pixel-drawings.js";
import { pixelLuma } from "./pixel-frame.js";
import { BORDER_REPLICATE, CV_32FC1, CV_64FC1, CV_8UC1, INTER_CUBIC, MORPH_RECT, Mat, WARP_INVERSE_MAP, dilate, getStructuringElement, matFromArray, warpAffine } from '@banou/opencv-wasm';
import { renderCover } from "./pixel-rigid.js";
import { addPlateSamples, finishPlate, measureDrift, plateReference, plateStatistics, renderPlate } from "./pixel-plate.js";
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
/**
 * Pixels within `width` of a boundary of any rigid layer's cover at the frame. The camera's own plane and
 * the backdrop are left out: the camera plane's first-pass cover holds every held drawing, so its edge
 * would mark drawing outlines as occlusion, and the backdrop covers everything.
 */
export function rigidRim(layers, frame, width) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const { width: w, height: h } = layers[0].path, edge = new Uint8Array(w * h);
        const covers = layers.filter(layer => !layer.camera && !layer.backdrop).map(layer => renderCover(layer, frame));
        for (const cover of covers)
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++) {
                    const p = y * w + x;
                    if (cover[p] && ((x > 0 && !cover[p - 1]) || (x < w - 1 && !cover[p + 1]) || (y > 0 && !cover[p - w]) || (y < h - 1 && !cover[p + w])))
                        edge[p] = 255;
                }
        const source = __addDisposableResource(env_1, matFromArray(h, w, CV_8UC1, edge), false), grown = __addDisposableResource(env_1, new Mat(), false), kernel = __addDisposableResource(env_1, getStructuringElement(MORPH_RECT, { width: 2 * width + 1, height: 2 * width + 1 }), false);
        dilate(source, grown, kernel);
        return grown.data.map(v => v ? 1 : 0);
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
const shiftMask = (mask, dx, dy, width, height) => {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const sx = x - dx, sy = y - dy;
            if (sx >= 0 && sy >= 0 && sx < width && sy < height)
                out[y * width + x] = mask[sy * width + sx];
        }
    return out;
};
const unite = (a, b) => a.map((v, p) => v | b[p]);
const otherLayer = (change) => packMask(change.flags.map(f => f & OTHER_LAYER ? 1 : 0));
export async function measureDrawingEvidence(source, camera, options = {}) {
    const atlas = worldAtlas(camera), dilation = options.dilation ?? 1, inkDilation = options.inkDilation ?? 0;
    const { progress, dilation: _, inkDilation: __, rigid, rimWidth, ...changeOptions } = options;
    const rims = rigid?.length ? (frame) => rigidRim(rigid, frame, rimWidth ?? 2) : undefined;
    const pairs = [], summaries = [], others = [], othersBackward = [];
    let previous = await source.frame(0);
    for (let pair = 0; pair < source.count - 1; pair++) {
        await progress?.(pair, source.count - 1);
        const next = await source.frame(pair + 1), step = camera.positions[pair + 1], base = camera.positions[pair];
        const d = { dx: step.dx - base.dx, dy: step.dy - base.dy };
        const layers = camera.motions?.[pair]?.slice(1) ?? [];
        // Each test's rim is its own frame's, plus the other frame's brought onto its grid.
        const rimA = rims?.(pair), rimB = rims?.(pair + 1), sx = Math.round(d.dx), sy = Math.round(d.dy);
        const rimForward = rimA && rimB && unite(rimA, shiftMask(rimB, -sx, -sy, source.width, source.height));
        const rimBackward = rimA && rimB && unite(rimB, shiftMask(rimA, sx, sy, source.width, source.height));
        const forward = measurePairChange(previous, next, d, { ...changeOptions, otherMotions: layers, ...(rimForward ? { rim: rimForward } : {}) });
        const backward = measurePairChange(next, previous, { dx: -d.dx, dy: -d.dy }, { ...changeOptions, otherMotions: layers.map(m => ({ dx: -m.dx, dy: -m.dy })), ...(rimBackward ? { rim: rimBackward } : {}) });
        const evidence = pairEvidence(camera, atlas, pair, forward, backward, dilation, inkDilation);
        pairs.push(evidence);
        others.push(otherLayer(forward));
        othersBackward.push(otherLayer(backward));
        summaries.push({ forward: forward.changed, backward: backward.changed, noise: forward.noise, evidence: evidence.indices.length });
        previous = next;
    }
    return { camera, atlas, dilation, inkDilation, pairs, summaries, options: changeOptions, others, othersBackward };
}
/**
 * Mark every change event whose value before or after it is the pixel's scenery: its median luma over the
 * whole shot, within `tolerance` codes, from at least `minimumSamples` observations. A drawing passing
 * over a pixel is a minority of its history unless the drawing stood there, and standing drawings boil in
 * place, which the silhouette stage checks first.
 */
export async function annotateScenery(source, evidence, options = {}) {
    const tolerance = options.tolerance ?? 10, minimumSamples = options.minimumSamples ?? 8;
    const { camera, atlas, pairs } = evidence, { width, height } = source, slot = new Int32Array(atlas.width * atlas.height).fill(-1);
    let slots = 0;
    for (const pair of pairs)
        for (let i = 0; i < pair.indices.length; i++)
            if (pair.flags[i] & VALUED && slot[pair.indices[i]] < 0)
                slot[pair.indices[i]] = slots++;
    const frames = source.count, samples = new Uint8Array(slots * frames), seen = new Uint8Array(slots);
    for (let frame = 0; frame < frames; frame++) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            await options.progress?.(frame, frames);
            const position = camera.positions[frame], offset = frameOffset(camera, atlas, frame);
            const luma = __addDisposableResource(env_2, matFromArray(height, width, CV_32FC1, pixelLuma(await source.frame(frame))), false), warped = __addDisposableResource(env_2, new Mat(), false);
            const transform = __addDisposableResource(env_2, matFromArray(2, 3, CV_64FC1, [1, 0, position.dx - Math.round(position.dx), 0, 1, position.dy - Math.round(position.dy)]), false);
            warpAffine(luma, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
            const w = warped.data32F;
            for (let y = 2; y < height - 2; y++)
                for (let x = 2; x < width - 2; x++) {
                    const k = slot[(y + offset.y) * atlas.width + x + offset.x];
                    if (k < 0 || seen[k] === 255)
                        continue;
                    samples[k * frames + seen[k]++] = Math.max(0, Math.min(255, Math.round(w[y * width + x])));
                }
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    const median = new Int16Array(slots).fill(-1), histogram = new Uint16Array(256);
    for (let k = 0; k < slots; k++) {
        if (seen[k] < minimumSamples)
            continue;
        histogram.fill(0);
        for (let j = 0; j < seen[k]; j++)
            histogram[samples[k * frames + j]]++;
        let cumulative = 0, v = 0;
        for (; v < 256; v++) {
            cumulative += histogram[v];
            if (cumulative * 2 >= seen[k])
                break;
        }
        median[k] = v;
    }
    const annotated = pairs.map(pair => {
        const flags = pair.flags.slice();
        if (pair.before && pair.after)
            for (let i = 0; i < flags.length; i++) {
                if (!(flags[i] & VALUED))
                    continue;
                const m = median[slot[pair.indices[i]]];
                if (m < 0)
                    continue;
                if (Math.abs(pair.after[i] - m) <= tolerance)
                    flags[i] |= AFTER_SCENERY;
                if (Math.abs(pair.before[i] - m) <= tolerance)
                    flags[i] |= BEFORE_SCENERY;
            }
        return { ...pair, flags };
    });
    return { ...evidence, pairs: annotated };
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
/** With `source`, held ink is checked against each frame's own luma (see `holdTolerance`). */
export async function sceneSilhouettes(evidence, options = {}) {
    const { progress, source, ...silhouetteOptions } = options, { width, height } = evidence.camera, frames = [];
    for (let frame = 0; frame <= evidence.pairs.length; frame++) {
        await progress?.(frame, evidence.pairs.length + 1);
        const luma = source && Uint8Array.from(pixelLuma(await source.frame(frame)), v => Math.max(0, Math.min(255, Math.round(v))));
        const silhouette = drawingSilhouette(evidence, frame, silhouetteOptions, luma);
        frames.push({ packed: packMask(silhouette.mask), area: silhouette.components.reduce((sum, c) => sum + c.area, 0), components: silhouette.components });
    }
    return { width, height, options: silhouetteOptions, frames };
}
/**
 * Two passes: a plain mean outside the drawings and other rigid layers, then a mean of the samples near
 * it. Then, unless `drift` is 0, each frame's drift on cells of that many pixels (see `PlateDrift`). `covers` gives, per frame, the pixels each rigid layer paints or leaves undecided (`renderCover` with
 * `undecided`), which show no camera scenery the plate can trust.
 */
export async function buildLayerPlate(source, camera, silhouettes, options = {}) {
    const atlas = worldAtlas(camera), margin = options.margin ?? 3, size = source.width * source.height;
    const exclude = (frame) => {
        const mask = unpackMask(silhouettes.frames[frame].packed, size), ev = options.evidence;
        // Pixels a rigid layer paints show that layer, not this plate.
        for (const cover of options.covers?.(frame) ?? [])
            for (let p = 0; p < size; p++)
                mask[p] |= cover[p];
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
        await options.progress?.(frame, source.count * 3);
        addPlateSamples(first, camera, frame, await source.frame(frame), exclude(frame), margin);
    }
    const reference = plateReference(first, options.floor ?? 4), trimmed = plateStatistics(atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(source.count + frame, source.count * 3);
        addPlateSamples(trimmed, camera, frame, await source.frame(frame), exclude(frame), margin, reference);
    }
    const plate = finishPlate(trimmed), cell = options.drift ?? 64;
    if (!cell)
        return plate;
    // What the held paint cannot explain but a smooth field can: the shot's lighting changing.
    const drift = { cell, columns: 0, rows: 0, frames: [] };
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(source.count * 2 + frame, source.count * 3);
        const measured = measureDrift(renderPlate(plate, camera, frame), await source.frame(frame), exclude(frame), cell);
        drift.columns = measured.columns;
        drift.rows = measured.rows;
        drift.frames.push(measured.grid);
    }
    return { ...plate, drift };
}
