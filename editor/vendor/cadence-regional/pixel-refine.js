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
import { BORDER_REPLICATE, CC_STAT_AREA, CV_32F, CV_32FC1, CV_32FC3, CV_64FC1, CV_8UC1, DIST_L2, INTER_CUBIC, MORPH_BLACKHAT, MORPH_ELLIPSE, WARP_INVERSE_MAP, Mat, connectedComponentsWithStats, distanceTransform, getStructuringElement, matFromArray, morphologyEx, warpAffine, } from '@banou/opencv-wasm';
import { frameOffset, worldAtlas } from "./pixel-drawings.js";
import { pixelLuma } from "./pixel-frame.js";
import { buildLayerPlate, packMask, unpackMask } from "./pixel-layers.js";
import { renderPlate } from "./pixel-plate.js";
import { buildRigidPlate, measureRigidCover, refineRigidCover, renderCover, renderScene } from "./pixel-rigid.js";
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
 * Median of every observation, silhouettes ignored, of the world pixels that fall in some frame's edge
 * band. Where a drawing's outline jitters over background, the background is what most frames show, so
 * the median recovers it where the plate, which excludes every silhouette, has nothing. A pixel a drawing
 * covers most of the time gets the drawing; the carve's line-art stop protects that case.
 */
export async function bandMedianPlate(source, camera, silhouettes, band = 8, progress) {
    const atlas = worldAtlas(camera), { width, height } = source, size = width * height, index = new Int32Array(atlas.width * atlas.height).fill(-1);
    let count = 0;
    for (let frame = 0; frame < silhouettes.frames.length; frame++) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const mask = unpackMask(silhouettes.frames[frame].packed, size), offset = frameOffset(camera, atlas, frame);
            const inside = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 255 : 0)), false), outside = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 0 : 255)), false), din = __addDisposableResource(env_2, new Mat(), false), dout = __addDisposableResource(env_2, new Mat(), false);
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
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    const frames = silhouettes.frames.length, samples = new Uint8Array(count * frames * 3), seen = new Uint8Array(count);
    for (let frame = 0; frame < frames; frame++) {
        const env_3 = { stack: [], error: void 0, hasError: false };
        try {
            await progress?.(frame, frames);
            const pixels = await source.frame(frame), position = camera.positions[frame], offset = frameOffset(camera, atlas, frame);
            const image = __addDisposableResource(env_3, matFromArray(height, width, CV_32FC3, pixels.data), false), warped = __addDisposableResource(env_3, new Mat(), false);
            const transform = __addDisposableResource(env_3, matFromArray(2, 3, CV_64FC1, [1, 0, position.dx - Math.round(position.dx), 0, 1, position.dy - Math.round(position.dy)]), false);
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
        catch (e_3) {
            env_3.error = e_3;
            env_3.hasError = true;
        }
        finally {
            __disposeResources(env_3);
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
/**
 * Carve every frame's silhouettes against a plate built from them, with `layers` (rigid layers whose plates
 * are built) over it; the plates should be rebuilt afterwards.
 */
export async function refineSilhouettes(source, camera, silhouettes, plate, options = {}) {
    const { progress, minimumArea: area, medianFallback: _, layers: rigid = [], ...carve } = options, minimumCount = carve.minimumCount ?? 3, size = source.width * source.height;
    const minimumArea = area ?? silhouettes.options.minimumArea ?? 800;
    const trust = (p) => ({ ...p, count: p.count.map(n => n >= minimumCount ? n : 0) });
    const trusted = trust(plate), layers = rigid.map(layer => ({ ...layer, plate: layer.plate && trust(layer.plate) }));
    // Where the plate is not trusted, the band median may stand in, if enough frames observed it.
    const band = options.medianFallback === false ? undefined : await bandMedianPlate(source, camera, silhouettes, carve.band ?? 8);
    const median = band && { ...band, count: band.count.map((n, a) => n >= 10 && !trusted.count[a] ? n : 0) };
    const frames = [], carved = [];
    for (let frame = 0; frame < silhouettes.frames.length; frame++) {
        const env_4 = { stack: [], error: void 0, hasError: false };
        try {
            await progress?.(frame, silhouettes.frames.length);
            const before = silhouettes.frames[frame], rendered = renderScene(trusted, camera, layers, frame);
            // The band median is taken in the camera's coordinates and says nothing where a rigid layer paints.
            const covered = new Uint8Array(size);
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
            const solid = __addDisposableResource(env_4, matFromArray(source.height, source.width, CV_8UC1, result.mask), false), labels = __addDisposableResource(env_4, new Mat(), false), stats = __addDisposableResource(env_4, new Mat(), false), centroids = __addDisposableResource(env_4, new Mat(), false);
            const count = connectedComponentsWithStats(solid, labels, stats, centroids, 8), l = labels.data32S, keep = new Uint8Array(count);
            for (let label = 1; label < count; label++)
                keep[label] = Number(stats.data32S[label * stats.cols + CC_STAT_AREA] >= minimumArea);
            for (let p = 0; p < size; p++)
                if (result.mask[p] && !keep[l[p]])
                    result.mask[p] = 0;
            const area = result.mask.reduce((sum, m) => sum + m, 0);
            frames.push({ packed: packMask(result.mask), area, components: before.components });
            carved.push(result.carved);
        }
        catch (e_4) {
            env_4.error = e_4;
            env_4.hasError = true;
        }
        finally {
            __disposeResources(env_4);
        }
    }
    return { ...silhouettes, frames, carved };
}
/**
 * The second pass over rigid layers, once the drawings are known: each cover is measured again without
 * the drawings, cover the camera plate explains is dropped, both kinds of plate are rebuilt and the
 * silhouettes carved again against the new scene. The returned plate is the camera plate the carve used;
 * rebuild it from the returned silhouettes. With no rigid layers the input comes back unchanged.
 */
export async function refineRigidScene(source, camera, silhouettes, layers, options = {}) {
    if (!layers.length)
        return { layers, silhouettes, dropped: [] };
    const size = source.width * source.height, drawn = (frame) => unpackMask(silhouettes.frames[frame].packed, size);
    let next = [];
    for (const layer of layers)
        next.push(await measureRigidCover(source, camera, layer, { exclude: drawn, progress: options.progress }));
    const covers = (frame) => next.map(layer => renderCover(layer, frame, true)), evidence = options.evidence;
    const scene = await buildLayerPlate(source, camera, silhouettes, { covers, progress: options.progress, ...(evidence ? { evidence } : {}) });
    const dropped = [], refined = [];
    for (const layer of next) {
        const { dropped: count, ...kept } = await refineRigidCover(source, camera, scene, layer, { exclude: drawn, progress: options.progress });
        refined.push(kept);
        dropped.push(count);
    }
    next = refined;
    const plate = await buildLayerPlate(source, camera, silhouettes, { covers, progress: options.progress, ...(evidence ? { evidence } : {}) });
    for (const layer of next)
        layer.plate = await buildRigidPlate(source, layer, drawn, { progress: options.progress });
    const carved = await refineSilhouettes(source, camera, silhouettes, plate, { ...options.carve, layers: next, progress: options.progress });
    return { layers: next, silhouettes: carved, plate, dropped };
}
