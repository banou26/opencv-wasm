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
import { CC_STAT_AREA, CV_32F, CV_8UC1, DIST_L2, Mat, connectedComponentsWithStats, distanceTransform, matFromArray } from '@banou/opencv-wasm';
import { packMask, unpackMask } from "./pixel-layers.js";
import { renderPlate } from "./pixel-plate.js";
/**
 * Remove silhouette pixels the plate explains, from the outside in. A pixel within `band` of the edge
 * whose value matches a well-observed plate is background only when it connects to the exterior through
 * such pixels, so an interior fill that happens to match the scenery is never carved and the outline,
 * which does not match it, stops the carve.
 */
export function carveSilhouette(mask, pixels, plate, options = {}) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const band = options.band ?? 8, tolerance = options.tolerance ?? 6, slope = options.gradientSlope ?? .1;
        const { width, height } = pixels, size = width * height, v = pixels.data, p3 = plate.data;
        const source = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 255 : 0)), false), distance = __addDisposableResource(env_1, new Mat(), false);
        distanceTransform(source, distance, DIST_L2, 3, CV_32F);
        const depth = distance.data32F, candidate = new Uint8Array(size);
        for (let y = 1; y < height - 1; y++)
            for (let x = 1; x < width - 1; x++) {
                const p = y * width + x;
                if (!mask[p] || depth[p] > band || !plate.known[p])
                    continue;
                const q = p * 3, luma = (i) => .0722 * p3[i * 3] + .7152 * p3[i * 3 + 1] + .2126 * p3[i * 3 + 2];
                const gradient = Math.hypot(luma(p + 1) - luma(p - 1), luma(p + width) - luma(p - width)) / 2;
                const limit = tolerance + slope * gradient;
                candidate[p] = Number(Math.abs(v[q] - p3[q]) <= limit && Math.abs(v[q + 1] - p3[q + 1]) <= limit && Math.abs(v[q + 2] - p3[q + 2]) <= limit);
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
/** Carve every frame's silhouettes against a plate built from them; the plate should be rebuilt afterwards. */
export async function refineSilhouettes(source, camera, silhouettes, plate, options = {}) {
    const { progress, minimumArea: area, ...carve } = options, minimumCount = carve.minimumCount ?? 3, size = source.width * source.height;
    const minimumArea = area ?? silhouettes.options.minimumArea ?? 800;
    const trusted = { ...plate, count: plate.count.map(n => n >= minimumCount ? n : 0) };
    const frames = [], carved = [];
    for (let frame = 0; frame < silhouettes.frames.length; frame++) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            await progress?.(frame, silhouettes.frames.length);
            const before = silhouettes.frames[frame], rendered = renderPlate(trusted, camera, frame);
            const result = carveSilhouette(unpackMask(before.packed, size), await source.frame(frame), rendered, carve);
            // Carving can cut splinters off a silhouette; they go the way of any small component.
            const solid = __addDisposableResource(env_2, matFromArray(source.height, source.width, CV_8UC1, result.mask), false), labels = __addDisposableResource(env_2, new Mat(), false), stats = __addDisposableResource(env_2, new Mat(), false), centroids = __addDisposableResource(env_2, new Mat(), false);
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
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    return { ...silhouettes, frames, carved };
}
