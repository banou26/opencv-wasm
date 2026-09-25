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
import { BORDER_REPLICATE, CC_STAT_AREA, CC_STAT_HEIGHT, CC_STAT_LEFT, CC_STAT_TOP, CC_STAT_WIDTH, CV_32F, CV_32FC1, CV_32FC3, CV_64FC1, CV_8UC1, DIST_L2, DIST_MASK_PRECISE, INTER_CUBIC, MORPH_BLACKHAT, MORPH_ELLIPSE, WARP_INVERSE_MAP, Mat, connectedComponentsWithStats, distanceTransform, erode, getStructuringElement, matFromArray, morphologyEx, warpAffine, } from '@banou/opencv-wasm';
import { fillEnclosed, frameOffset, worldAtlas } from "./pixel-drawings.js";
import { frameLayerLabels } from "./pixel-frames.js";
import { pixelLuma } from "./pixel-frame.js";
import { buildLayerPlate, packMask, unpackMask } from "./pixel-layers.js";
import { finishPlate, plateStatistics, renderPlate } from "./pixel-plate.js";
import { shareDeep, splitRange } from "./pixel-share.js";
import { buildRigidPlate, claimRigidCover, hiddenBy, planeHiding, matteRigidLayer, measureScenePlanes, peelNearer, planeShown, refineRigidCover, renderCover, renderScene } from "./pixel-rigid.js";
/**
 * Remove silhouette pixels the plate explains, from the outside in. A pixel within `band` of the edge
 * whose value matches a well-observed plate is background only when it connects to the exterior through
 * such pixels, so an interior fill that happens to match the scenery is never carved and the outline,
 * which does not match it, stops the carve. Pixels in `deep` can be carved at any depth.
 */
export function carveSilhouette(mask, pixels, plate, options = {}, fallback, deep) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const band = options.band ?? 8, tolerance = options.tolerance ?? 6, slope = options.gradientSlope ?? .1, lineDelta = options.lineDelta ?? 6;
        const { width, height } = pixels, size = width * height, v = pixels.data, p3 = plate.data;
        const source = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 255 : 0)), false), distance = __addDisposableResource(env_1, new Mat(), false);
        distanceTransform(source, distance, DIST_L2, 3, CV_32F);
        const luma = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC1, pixelLuma(pixels)), false), hat = __addDisposableResource(env_1, new Mat(), false), kernel = __addDisposableResource(env_1, getStructuringElement(MORPH_ELLIPSE, { width: 7, height: 7 }), false);
        morphologyEx(luma, hat, MORPH_BLACKHAT, kernel);
        const depth = distance.data32F, line = hat.data32F, candidate = new Uint8Array(size);
        for (let y = 1; y < height - 1; y++)
            for (let x = 1; x < width - 1; x++) {
                const p = y * width + x;
                // A rigid layer's paint can fill a silhouette to any depth, as the drawings' ink never bounded it.
                if (!mask[p] || (depth[p] > band && !deep?.[p]))
                    continue;
                // The median fallback can hold a drawing that stood still; line art in the frame stops a carve there.
                const own = plate.known[p] === 1, reference = own ? p3 : fallback && fallback.known[p] && line[p] <= lineDelta ? fallback.data : undefined;
                if (!reference)
                    continue;
                const q = p * 3, luma = (i) => .0722 * reference[i * 3] + .7152 * reference[i * 3 + 1] + .2126 * reference[i * 3 + 2];
                const gradient = Math.hypot(luma(p + 1) - luma(p - 1), luma(p + width) - luma(p - width)) / 2;
                const limit = tolerance + slope * gradient;
                candidate[p] = Number(Math.abs(v[q] - reference[q]) <= limit && Math.abs(v[q + 1] - reference[q + 1]) <= limit && Math.abs(v[q + 2] - reference[q + 2]) <= limit);
            }
        const out = mask.slice(), queue = new Int32Array(size);
        let head = 0, tail = 0;
        for (let p = 0; p < size; p++) {
            if (!candidate[p])
                continue;
            const x = p % width;
            if ((x > 0 && !mask[p - 1]) || (x < width - 1 && !mask[p + 1]) || (p >= width && !mask[p - width]) || (p + width < size && !mask[p + width])) {
                queue[tail++] = p;
                candidate[p] = 0;
                out[p] = 0;
            }
        }
        while (head < tail) {
            const p = queue[head++], x = p % width;
            for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
                if (n < 0 || n >= size || !candidate[n])
                    continue;
                candidate[n] = 0;
                out[n] = 0;
                queue[tail++] = n;
            }
        }
        return { mask: out, carved: tail };
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/**
 * Add to a silhouette the pixels next to it that the scene cannot explain: a part of a drawing that never
 * changed carries no ink, and the plate behind it, seen as that part in some frames and as scenery in
 * others, matches neither. Growth floods from the silhouette's edge through such pixels, within `band`
 * of it and inside its concavities (its closing by `bay`).
 */
/**
 * A binary mask closed by a disc of `radius` pixels (and a half, which is closest to OpenCV's ellipse):
 * dilated where the exact distance to the mask is within it, then eroded where the distance to what the
 * dilation left out exceeds it; outside the frame counts as neither mask nor gap. Linear in the frame,
 * where a 97 x 97 structuring element visited seven thousand cells a pixel (15 s over 30 frames of
 * market-pan, 2026-09-26). OpenCV's ellipse rounds each row on its own, so it is no disc and the two
 * differ by a pixel along some edges.
 */
export function closeByDisc(mask, width, height, radius) {
    const env_2 = { stack: [], error: void 0, hasError: false };
    try {
        const reach = radius + .5, out = new Uint8Array(mask.length);
        if (!mask.some(Boolean))
            return out;
        const gaps = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 0 : 255)), false), toMask = __addDisposableResource(env_2, new Mat(), false);
        distanceTransform(gaps, toMask, DIST_L2, DIST_MASK_PRECISE, CV_32F);
        const near = toMask.data32F, dilated = new Uint8Array(mask.length);
        for (let p = 0; p < mask.length; p++)
            dilated[p] = near[p] <= reach ? 255 : 0;
        if (dilated.every(Boolean))
            return out.fill(1);
        const kept = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, dilated), false), toGap = __addDisposableResource(env_2, new Mat(), false);
        distanceTransform(kept, toGap, DIST_L2, DIST_MASK_PRECISE, CV_32F);
        const deep = toGap.data32F;
        for (let p = 0; p < mask.length; p++)
            out[p] = Number(deep[p] > reach);
        return out;
    }
    catch (e_2) {
        env_2.error = e_2;
        env_2.hasError = true;
    }
    finally {
        __disposeResources(env_2);
    }
}
export function growSilhouette(mask, pixels, scene, options = {}) {
    const env_3 = { stack: [], error: void 0, hasError: false };
    try {
        const band = options.band ?? 24, bayRadius = options.bay ?? 48, tolerance = options.tolerance ?? 16, slope = options.gradientSlope ?? .2;
        const { width, height } = pixels, size = width * height, v = pixels.data, b = scene.data;
        // Only the silhouette's concavities: its closing by `bay`. Scenery beside a drawing that will stand
        // there later disagrees with a plate that remembers it too, and growth must not flood into it.
        const bay = closeByDisc(mask, width, height, bayRadius);
        const outside = __addDisposableResource(env_3, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 0 : 255)), false), distance = __addDisposableResource(env_3, new Mat(), false);
        distanceTransform(outside, distance, DIST_L2, 3, CV_32F);
        const far = distance.data32F, candidate = new Uint8Array(size);
        const sceneLuma = (i) => .0722 * b[i * 3] + .7152 * b[i * 3 + 1] + .2126 * b[i * 3 + 2];
        for (let y = 1; y < height - 1; y++)
            for (let x = 1; x < width - 1; x++) {
                const p = y * width + x, q = p * 3;
                if (mask[p] || !scene.known[p] || !bay[p] || far[p] > band)
                    continue;
                const gradient = Math.hypot(sceneLuma(p + 1) - sceneLuma(p - 1), sceneLuma(p + width) - sceneLuma(p - width)) / 2, limit = tolerance + slope * gradient;
                candidate[p] = Number(Math.abs(v[q] - b[q]) > limit || Math.abs(v[q + 1] - b[q + 1]) > limit || Math.abs(v[q + 2] - b[q + 2]) > limit);
            }
        const out = mask.slice(), queue = new Int32Array(size);
        let head = 0, tail = 0;
        for (let p = 0; p < size; p++) {
            if (!candidate[p])
                continue;
            const x = p % width;
            if ((x > 0 && mask[p - 1]) || (x < width - 1 && mask[p + 1]) || (p >= width && mask[p - width]) || (p + width < size && mask[p + width])) {
                queue[tail++] = p;
                candidate[p] = 0;
                out[p] = 1;
            }
        }
        while (head < tail) {
            const p = queue[head++], x = p % width;
            for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
                if (n < 0 || n >= size || !candidate[n])
                    continue;
                candidate[n] = 0;
                out[n] = 1;
                queue[tail++] = n;
            }
        }
        return { mask: out, grown: tail };
    }
    catch (e_3) {
        env_3.error = e_3;
        env_3.hasError = true;
    }
    finally {
        __disposeResources(env_3);
    }
}
/** Grow every frame's silhouettes into what the scene cannot explain next to them (see `growSilhouette`), then fill enclosed holes; with `frames`, only those from its first up to its second, and with `pool` on its threads. */
export async function growSilhouettes(source, camera, silhouettes, plate, options = {}) {
    const { layers = [], progress, frames: range, pool, ...grow } = options, size = source.width * source.height, frames = [], grown = [];
    if (pool && !range) {
        const parts = await pool.map('grow', shareDeep({ camera, silhouettes, plate, options: { ...grow, layers } }), splitRange(0, silhouettes.frames.length, pool.size * 3));
        return { ...silhouettes, frames: parts.flatMap(p => p.frames), grown: parts.flatMap(p => p.grown) };
    }
    const [first, end] = range ?? [0, silhouettes.frames.length];
    for (let frame = first; frame < end; frame++) {
        await progress?.(frame, silhouettes.frames.length);
        const before = silhouettes.frames[frame], scene = layers.length ? renderScene(plate, camera, layers, frame) : renderPlate(plate, camera, frame);
        const result = growSilhouette(unpackMask(before.packed, size), await source.frame(frame), scene, grow);
        frames.push(silhouetteFrame(fillEnclosed(result.mask, source.width, source.height), source.width, source.height));
        grown.push(result.grown);
    }
    return { ...silhouettes, frames, grown };
}
/**
 * Median of every observation, silhouettes ignored, of the world pixels that fall in some frame's edge
 * band. Where a drawing's outline jitters over background, the background is what most frames show, so
 * the median recovers it where the plate, which excludes every silhouette, has nothing. A pixel a drawing
 * covers most of the time gets the drawing; the carve's line-art stop protects that case.
 */
export async function bandMedianPlate(source, camera, silhouettes, band = 8, progress) {
    const atlas = worldAtlas(camera), { width, height } = source, size = width * height, index = new Int32Array(atlas.width * atlas.height).fill(-1);
    let count = 0;
    for (let frame = 0; frame < silhouettes.frames.length; frame++) {
        const env_4 = { stack: [], error: void 0, hasError: false };
        try {
            const mask = unpackMask(silhouettes.frames[frame].packed, size), offset = frameOffset(camera, atlas, frame);
            const inside = __addDisposableResource(env_4, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 255 : 0)), false), outside = __addDisposableResource(env_4, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 0 : 255)), false), din = __addDisposableResource(env_4, new Mat(), false), dout = __addDisposableResource(env_4, new Mat(), false);
            distanceTransform(inside, din, DIST_L2, 3, CV_32F);
            distanceTransform(outside, dout, DIST_L2, 3, CV_32F);
            const a = din.data32F, b = dout.data32F;
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const p = y * width + x;
                    if (!(mask[p] ? a[p] <= band : b[p] <= 2))
                        continue;
                    const at = (y + offset.y) * atlas.width + x + offset.x;
                    if (index[at] < 0)
                        index[at] = count++;
                }
        }
        catch (e_4) {
            env_4.error = e_4;
            env_4.hasError = true;
        }
        finally {
            __disposeResources(env_4);
        }
    }
    const frames = silhouettes.frames.length, samples = new Uint8Array(count * frames * 3), seen = new Uint8Array(count);
    for (let frame = 0; frame < frames; frame++) {
        const env_5 = { stack: [], error: void 0, hasError: false };
        try {
            await progress?.(frame, frames);
            const pixels = await source.frame(frame), position = camera.positions[frame], offset = frameOffset(camera, atlas, frame);
            const image = __addDisposableResource(env_5, matFromArray(height, width, CV_32FC3, pixels.data), false), warped = __addDisposableResource(env_5, new Mat(), false);
            const transform = __addDisposableResource(env_5, matFromArray(2, 3, CV_64FC1, [1, 0, position.dx - Math.round(position.dx), 0, 1, position.dy - Math.round(position.dy)]), false);
            warpAffine(image, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
            const w = warped.data32F;
            for (let y = 3; y < height - 3; y++)
                for (let x = 3; x < width - 3; x++) {
                    const i = index[(y + offset.y) * atlas.width + x + offset.x];
                    if (i < 0)
                        continue;
                    const o = (i * frames + seen[i]) * 3, q = (y * width + x) * 3;
                    for (let c = 0; c < 3; c++)
                        samples[o + c] = Math.max(0, Math.min(255, Math.round(w[q + c])));
                    seen[i]++;
                }
        }
        catch (e_5) {
            env_5.error = e_5;
            env_5.hasError = true;
        }
        finally {
            __disposeResources(env_5);
        }
    }
    const data = new Float32Array(atlas.width * atlas.height * 3), counts = new Uint16Array(atlas.width * atlas.height), values = new Uint8Array(frames);
    for (let at = 0; at < index.length; at++) {
        const i = index[at];
        if (i < 0 || seen[i] === 0)
            continue;
        counts[at] = seen[i];
        for (let c = 0; c < 3; c++) {
            for (let k = 0; k < seen[i]; k++)
                values[k] = samples[(i * frames + k) * 3 + c];
            const sorted = values.subarray(0, seen[i]).sort();
            data[at * 3 + c] = sorted[sorted.length >> 1];
        }
    }
    return { atlas, data, count: counts };
}
/** One frame of silhouettes from its mask: the packed mask, its area and its components. */
function silhouetteFrame(mask, width, height) {
    const env_6 = { stack: [], error: void 0, hasError: false };
    try {
        const solid = __addDisposableResource(env_6, matFromArray(height, width, CV_8UC1, mask), false), labels = __addDisposableResource(env_6, new Mat(), false), stats = __addDisposableResource(env_6, new Mat(), false), centroids = __addDisposableResource(env_6, new Mat(), false);
        const count = connectedComponentsWithStats(solid, labels, stats, centroids, 8), s = stats.data32S, columns = stats.cols, components = [];
        for (let label = 1; label < count; label++)
            components.push({ area: s[label * columns + CC_STAT_AREA], box: [s[label * columns + CC_STAT_LEFT], s[label * columns + CC_STAT_TOP], s[label * columns + CC_STAT_WIDTH], s[label * columns + CC_STAT_HEIGHT]] });
        return { packed: packMask(mask), area: mask.reduce((sum, m) => sum + m, 0), components };
    }
    catch (e_6) {
        env_6.error = e_6;
        env_6.hasError = true;
    }
    finally {
        __disposeResources(env_6);
    }
}
const REVEALED = 1;
/**
 * Release the scenery a layer's silhouette holds between its drawings. A layer is what updates on its own
 * redraws, so inside each hold's silhouette a region whose pixels changed at neither redraw bounding the
 * hold (the pair into its first frame and the pair out of its last) is not this layer's update. When it
 * also carries scenery's texture, rather than a cel's flat fill, and is ringed by the layer's lines that
 * moved at the redraw, it is what shows between the drawings (the wagon between market-pan's walkers) and
 * is taken out of every frame of the hold, so the plate learns it; pieces the release cuts off under the
 * silhouettes' minimum area go too. A hold with no redraw on either side has nothing to compare and is kept. Run it on the final
 * silhouettes: growth fills enclosed holes again.
 */
export async function releaseHeldScenery(source, evidence, silhouettes, frames, options = {}) {
    const gradient = options.gradient ?? 8, texture = options.texture ?? .25, minimumArea = options.minimumArea ?? 32, enclosed = options.enclosed ?? .5, margin = options.margin ?? 2;
    const revealed = options.revealed ?? REVEALED, window = options.window ?? 1;
    const splinter = silhouettes.options.minimumArea ?? 800;
    const { width, height } = source, size = width * height, { atlas, camera, pairs } = evidence;
    const masks = silhouettes.frames.map(f => unpackMask(f.packed, size)), released = silhouettes.frames.map(() => 0);
    // What every world pixel shows outside every silhouette: count, and sums of luma and its square.
    const uncovered = new Uint16Array(atlas.width * atlas.height), lumaSum = new Float32Array(uncovered.length), lumaSquare = new Float32Array(uncovered.length);
    if (revealed < 1)
        for (let f = 0; f < source.count; f++) {
            const luma = pixelLuma(await source.frame(f)), o = frameOffset(camera, atlas, f), mask = masks[f];
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const p = y * width + x;
                    if (mask[p])
                        continue;
                    const a = (y + o.y) * atlas.width + x + o.x;
                    uncovered[a]++;
                    lumaSum[a] += luma[p];
                    lumaSquare[a] += luma[p] * luma[p];
                }
        }
    const holds = frames.layers.flatMap(layer => layer.drawings.map((drawing, index) => ({ layer: layer.id, drawing, index, drawings: layer.drawings })));
    for (const [done, { layer, drawing, index, drawings }] of holds.entries()) {
        const env_7 = { stack: [], error: void 0, hasError: false };
        try {
            await options.progress?.(done, holds.length);
            const bounding = [drawing.first - 1, drawing.last].filter(pair => pair >= 0 && pair < pairs.length);
            if (!bounding.length)
                continue;
            const first = drawing.first, offset = frameOffset(camera, atlas, first), own = frameLayerLabels(silhouettes, frames, first);
            const mark = (list) => {
                const out = new Uint8Array(size);
                for (const pair of list)
                    for (const a of pairs[pair].indices) {
                        const ay = Math.floor(a / atlas.width), x = a - ay * atlas.width - offset.x, y = ay - offset.y;
                        if (x >= 0 && y >= 0 && x < width && y < height)
                            out[y * width + x] = 1;
                    }
                return out;
            };
            // Pixels of the layer at its first frame that changed at a bounding redraw, and at the layer's redraws
            // `window` holds either side: scenery holds still through all of them (the wagon between market-pan's
            // walkers for a dozen), where a still part of a drawing changes once its drawing moves.
            const changed = mark(bounding), around = drawings.slice(Math.max(0, index - window), index + window + 1)
                .flatMap(d => [d.first - 1, d.last]).filter(pair => pair >= 0 && pair < pairs.length && !bounding.includes(pair));
            const stirred = around.length ? mark([...new Set(around)]) : undefined;
            const held = new Uint8Array(size);
            for (let p = 0; p < size; p++)
                held[p] = own[p] === layer + 1 && !changed[p] && !stirred?.[p] ? 255 : 0;
            const luma = pixelLuma(await source.frame(first));
            const heldMat = __addDisposableResource(env_7, matFromArray(height, width, CV_8UC1, held), false), labels = __addDisposableResource(env_7, new Mat(), false), stats = __addDisposableResource(env_7, new Mat(), false), centroids = __addDisposableResource(env_7, new Mat(), false);
            const count = connectedComponentsWithStats(heldMat, labels, stats, centroids, 4), l = labels.data32S, rough = new Uint32Array(count), area = new Uint32Array(count);
            // Border per region: neighbors outside it, those outside the layer, and those that moved at the redraw.
            const border = new Uint32Array(count), open = new Uint32Array(count), moving = new Uint32Array(count), shown = new Uint32Array(count), differ = new Uint32Array(count);
            for (let y = 1; y < height - 1; y++)
                for (let x = 1; x < width - 1; x++) {
                    const p = y * width + x, k = l[p];
                    if (!k)
                        continue;
                    area[k]++;
                    if (Math.hypot(luma[p + 1] - luma[p - 1], luma[p + width] - luma[p - width]) / 2 > gradient)
                        rough[k]++;
                    const a = (y + offset.y) * atlas.width + x + offset.x, n = uncovered[a];
                    if (n >= 3) {
                        const mean = lumaSum[a] / n, spread = Math.sqrt(Math.max(0, lumaSquare[a] / n - mean * mean));
                        shown[k]++;
                        if (Math.abs(luma[p] - mean) > Math.max(6, 3 * spread))
                            differ[k]++;
                    }
                    for (const q of [p - 1, p + 1, p - width, p + width]) {
                        if (l[q] === k)
                            continue;
                        border[k]++;
                        if (own[q] !== layer + 1)
                            open[k]++;
                        else if (changed[q] || stirred?.[q])
                            moving[k]++;
                    }
                }
            const release = new Uint8Array(count);
            for (let k = 1; k < count; k++)
                release[k] = Number(area[k] >= minimumArea && rough[k] >= texture * area[k] && open[k] <= .1 * border[k] && moving[k] >= enclosed * border[k]
                    && differ[k] <= revealed * shown[k]);
            // The lines ringing a released region keep their antialiased edge: where a line held still through the
            // redraw its edge pixels are held too, and released they would leave half ink in the plate and a cut
            // edge on the cel. So `margin` pixels of the region stay, for the matte to unmix.
            const chosen = new Uint8Array(size);
            for (let p = 0; p < size; p++)
                chosen[p] = release[l[p]] ? 255 : 0;
            const chosenMat = __addDisposableResource(env_7, matFromArray(height, width, CV_8UC1, chosen), false), inner = __addDisposableResource(env_7, new Mat(), false), shrink = __addDisposableResource(env_7, getStructuringElement(MORPH_ELLIPSE, { width: 2 * margin + 1, height: 2 * margin + 1 }), false);
            erode(chosenMat, inner, shrink);
            const out = inner.data;
            // The hold's drawing stays put in the world, so every frame of it loses the same world pixels.
            for (let f = first; f <= drawing.last; f++) {
                const o = frameOffset(camera, atlas, f), dx = o.x - offset.x, dy = o.y - offset.y, mask = masks[f];
                for (let y = 0; y < height; y++)
                    for (let x = 0; x < width; x++) {
                        const p = y * width + x;
                        if (!out[p])
                            continue;
                        const fx = x - dx, fy = y - dy;
                        if (fx < 0 || fy < 0 || fx >= width || fy >= height || !mask[fy * width + fx])
                            continue;
                        mask[fy * width + fx] = 0;
                        released[f]++;
                    }
            }
        }
        catch (e_7) {
            env_7.error = e_7;
            env_7.hasError = true;
        }
        finally {
            __disposeResources(env_7);
        }
    }
    // What a release cuts off a silhouette goes the way of any small component.
    return { ...silhouettes, frames: masks.map((mask, f) => released[f] ? silhouetteFrame(dropSmall(mask, width, height, splinter), width, height) : silhouettes.frames[f]), released };
}
/** The mask without its 8-connected components under `minimum` pixels. */
function dropSmall(mask, width, height, minimum) {
    const env_8 = { stack: [], error: void 0, hasError: false };
    try {
        const solid = __addDisposableResource(env_8, matFromArray(height, width, CV_8UC1, mask), false), labels = __addDisposableResource(env_8, new Mat(), false), stats = __addDisposableResource(env_8, new Mat(), false), centroids = __addDisposableResource(env_8, new Mat(), false);
        const count = connectedComponentsWithStats(solid, labels, stats, centroids, 8), l = labels.data32S, keep = new Uint8Array(count);
        for (let k = 1; k < count; k++)
            keep[k] = Number(stats.data32S[k * stats.cols + CC_STAT_AREA] >= minimum);
        return mask.map((m, p) => m && keep[l[p]] ? 1 : 0);
    }
    catch (e_8) {
        env_8.error = e_8;
        env_8.hasError = true;
    }
    finally {
        __disposeResources(env_8);
    }
}
/**
 * Carve every frame's silhouettes against a plate built from them, with `layers` (rigid layers whose plates
 * are built) over it; the plates should be rebuilt afterwards. `bandMedian` hands in the fallback plate
 * (`bandMedianPlate`) instead of building it, and `frames` carves only those from its first up to its second;
 * with `pool` the frames are carved on its threads, a range each, the band median built here once.
 */
export async function refineSilhouettes(source, camera, silhouettes, plate, options = {}) {
    const { progress, minimumArea: area, medianFallback: _, layers: rigid = [], bandMedian, frames: range, pool: __, ...carve } = options, minimumCount = carve.minimumCount ?? 3, size = source.width * source.height;
    const minimumArea = area ?? silhouettes.options.minimumArea ?? 800;
    const trust = (p) => ({ ...p, count: p.count.map(n => n >= minimumCount ? n : 0) });
    const trusted = trust(plate), layers = rigid.map(layer => ({ ...layer, plate: layer.plate && trust(layer.plate) })), own = layers.findIndex(layer => layer.camera);
    // Where the plate is not trusted, the band median may stand in, if enough frames observed it.
    const band = options.medianFallback === false ? undefined : bandMedian ?? await bandMedianPlate(source, camera, silhouettes, carve.band ?? 8);
    if (options.pool && !range) {
        const { pool, progress: _, ...rest } = options, input = shareDeep({ camera, silhouettes, plate, options: { ...rest, ...(band ? { bandMedian: band } : {}) } });
        const parts = await pool.map('carve', input, splitRange(0, silhouettes.frames.length, pool.size * 3));
        return { ...silhouettes, frames: parts.flatMap(p => p.frames), carved: parts.flatMap(p => p.carved) };
    }
    const median = band && { ...band, count: band.count.map((n, a) => n >= 10 && !trusted.count[a] ? n : 0) };
    const frames = [], carved = [], [first, end] = range ?? [0, silhouettes.frames.length];
    for (let frame = first; frame < end; frame++) {
        const env_9 = { stack: [], error: void 0, hasError: false };
        try {
            await progress?.(frame, silhouettes.frames.length);
            const before = silhouettes.frames[frame], rendered = renderScene(trusted, camera, layers, frame);
            // Another plane's paint can fill a silhouette to any depth, the camera's own scenery only near its edge,
            // and the band median, taken in the camera's coordinates, says nothing where another plane paints.
            const covered = new Uint8Array(size);
            if (own >= 0) {
                const shown = planeShown(layers, own, frame);
                for (let p = 0; p < size; p++)
                    covered[p] = 1 - shown[p];
            }
            else
                for (const layer of layers) {
                    const cover = renderCover(layer, frame, true);
                    for (let p = 0; p < size; p++)
                        covered[p] |= cover[p];
                }
            const fallback = median && renderPlate(median, camera, frame);
            if (fallback)
                for (let p = 0; p < size; p++)
                    if (covered[p])
                        fallback.known[p] = 0;
            const result = carveSilhouette(unpackMask(before.packed, size), await source.frame(frame), rendered, carve, fallback, layers.length ? covered : undefined);
            // Carving can cut splinters off a silhouette; they go the way of any small component.
            const solid = __addDisposableResource(env_9, matFromArray(source.height, source.width, CV_8UC1, result.mask), false), labels = __addDisposableResource(env_9, new Mat(), false), stats = __addDisposableResource(env_9, new Mat(), false), centroids = __addDisposableResource(env_9, new Mat(), false);
            const count = connectedComponentsWithStats(solid, labels, stats, centroids, 8), l = labels.data32S, keep = new Uint8Array(count), s = stats.data32S, columns = stats.cols;
            const components = [];
            for (let label = 1; label < count; label++) {
                keep[label] = Number(s[label * columns + CC_STAT_AREA] >= minimumArea);
                if (keep[label])
                    components.push({ area: s[label * columns + CC_STAT_AREA], box: [s[label * columns + CC_STAT_LEFT], s[label * columns + CC_STAT_TOP], s[label * columns + CC_STAT_WIDTH], s[label * columns + CC_STAT_HEIGHT]] });
            }
            for (let p = 0; p < size; p++)
                if (result.mask[p] && !keep[l[p]])
                    result.mask[p] = 0;
            const area = result.mask.reduce((sum, m) => sum + m, 0);
            frames.push({ packed: packMask(result.mask), area, components });
            carved.push(result.carved);
        }
        catch (e_9) {
            env_9.error = e_9;
            env_9.hasError = true;
        }
        finally {
            __disposeResources(env_9);
        }
    }
    return { ...silhouettes, frames, carved };
}
/**
 * Plates for planes in back-to-front order. The camera plate comes from the frames outside every plane,
 * and is empty once a backdrop is in the list, as then no pixel shows the camera's plane as a plate. Each
 * plane's plate comes from the frames where no drawing and no nearer plane hides it, and its rim is
 * unmixed against the planes behind it composited, or the camera plate for the farthest front plane.
 * A lone backdrop's plate carries a lighting drift on `backdropDrift` cells (64; 0 disables), and unless
 * `backdropMedian` is false it is trimmed around each pixel's median (`buildRigidPlate` `median`): a follow
 * shot's drawings sweep over all of it, and those the silhouettes miss stay out. `band` is how
 * far from the cover's edge rims are solved (a defocused edge needs more than the default),
 * and each `peel` round rebuilds the plates with the nearer planes peeled off (`peelNearer`), then every
 * rim. With `pool`, the camera plate is sampled on its threads (`buildLayerPlate`). Returns copies of the layers.
 */
export async function buildScenePlates(source, camera, silhouettes, layers, options = {}) {
    const size = source.width * source.height, drawn = (frame) => unpackMask(silhouettes.frames[frame].packed, size), { evidence, drift, margin, floor, progress } = options;
    const band = options.band === undefined ? {} : { band: options.band };
    const plate = layers.some(layer => layer.backdrop) ? finishPlate(plateStatistics(worldAtlas(camera)))
        : await buildLayerPlate(source, camera, silhouettes, {
            layers, progress, ...(evidence ? { evidence } : {}), ...(drift === undefined ? {} : { drift }), ...(options.pool ? { pool: options.pool } : {}),
            ...(margin === undefined ? {} : { margin }), ...(floor === undefined ? {} : { floor }),
        });
    const out = layers.map(layer => ({ ...layer }));
    for (const [k, layer] of out.entries()) {
        const hidden = hiddenBy(out, k, drawn);
        // A lone backdrop (a follow shot's painting) carries the lighting drift the camera plate would have.
        const lone = layer.backdrop && out.length === 1 ? { drift: options.backdropDrift ?? 64, median: options.backdropMedian ?? true } : {};
        layer.plate = await buildRigidPlate(source, layer, planeHiding(out, k, silhouettes), { progress, ...lone, ...(options.pool ? { pool: options.pool } : {}) });
        if (layer.backdrop || options.mattes === false)
            continue;
        const behind = k > 0 ? { behind: (frame) => renderScene(plate, camera, out.slice(0, k), frame) } : {};
        layer.matte = await matteRigidLayer(source, camera, plate, layer, { exclude: hidden, progress, ...behind, ...band });
    }
    // With every rim matted, each plate again from the frames with the planes in front of it peeled off, then
    // every rim again against the plates behind it: a defocused rim no longer leaves blends in them.
    for (let round = 0; round < (options.peel ?? 0) && options.mattes !== false; round++) {
        for (let k = 0; k < out.length - 1; k++) {
            const peeled = peelNearer(source, out.slice(k + 1), drawn);
            out[k] = { ...out[k], plate: await buildRigidPlate(peeled.source, out[k], peeled.exclude, { progress }) };
        }
        for (let k = 0; k < out.length; k++) {
            if (out[k].backdrop)
                continue;
            const behind = k > 0 ? { behind: (frame) => renderScene(plate, camera, out.slice(0, k), frame) } : {};
            out[k] = { ...out[k], matte: await matteRigidLayer(source, camera, plate, out[k], { exclude: hiddenBy(out, k, drawn), progress, ...behind, ...band }) };
        }
    }
    return { plate, layers: out };
}
/**
 * The second pass over the scene's planes, in back-to-front order, once the drawings are known: each
 * plane but the backdrop is measured again without the drawings, front to back; cover what lies behind a
 * plane explains is dropped, and where planes lie behind the camera's own, smooth paint is claimed
 * (`claimRigidCover`); the plates and rims are rebuilt back to front and the silhouettes carved again
 * against the new scene. The returned plate is the camera plate the carve used; rebuild it from the
 * returned silhouettes. With no rigid layers the input comes back unchanged.
 */
export async function refineRigidScene(source, camera, silhouettes, layers, options = {}) {
    if (!layers.length)
        return { layers, silhouettes, dropped: [], claimed: [] };
    const size = source.width * source.height, drawn = (frame) => unpackMask(silhouettes.frames[frame].packed, size), { evidence, progress } = options;
    const next = await measureScenePlanes(source, camera, layers, { drawnBy: silhouettes, progress, ...(options.pool ? { pool: options.pool } : {}) });
    // What lies behind each plane, from the new covers: the camera plate, and the farther planes' plates.
    const scene = next.some(layer => layer.backdrop) ? finishPlate(plateStatistics(worldAtlas(camera)))
        : await buildLayerPlate(source, camera, silhouettes, { layers: next, progress, ...(evidence ? { evidence } : {}), ...(options.pool ? { pool: options.pool } : {}) });
    const withPlates = [];
    for (const [k, layer] of next.entries())
        withPlates.push(k < next.length - 1 ? { ...layer, plate: await buildRigidPlate(source, layer, planeHiding(next, k, silhouettes), { progress, ...(options.pool ? { pool: options.pool } : {}) }) } : layer);
    const dropped = [], refined = [];
    for (const [k, layer] of next.entries()) {
        if (layer.backdrop) {
            refined.push(layer);
            dropped.push(0);
            continue;
        }
        const behind = k > 0 ? { behind: (frame) => renderScene(scene, camera, withPlates.slice(0, k), frame) } : {};
        const { dropped: count, ...kept } = await refineRigidCover(source, camera, scene, layer, { exclude: hiddenBy(next, k, drawn), progress, ...behind });
        refined.push(kept);
        dropped.push(count);
    }
    // With planes behind the camera's own, smooth paint no test decided is claimed front to back where it
    // holds still and what lies behind misses it.
    const claimed = refined.map(() => 0);
    if (next.some(layer => layer.camera))
        for (let k = refined.length - 1; k >= 0; k--) {
            if (refined[k].backdrop)
                continue;
            const behind = k > 0 ? { behind: (frame) => renderScene(scene, camera, withPlates.slice(0, k), frame) } : {};
            const { claimed: count, ...kept } = await claimRigidCover(source, camera, scene, refined[k], { exclude: hiddenBy(refined, k, drawn), progress, ...behind });
            refined[k] = kept;
            claimed[k] = count;
        }
    const pool = options.pool ? { pool: options.pool } : {};
    const { plate, layers: out } = await buildScenePlates(source, camera, silhouettes, refined, { progress, ...(evidence ? { evidence } : {}), ...pool });
    const carved = await refineSilhouettes(source, camera, silhouettes, plate, { ...options.carve, layers: out, progress, ...pool });
    return { layers: out, silhouettes: carved, plate, dropped, claimed };
}
