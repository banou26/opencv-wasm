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
import { CV_8UC1, DIST_L2, DIST_LABEL_PIXEL, Mat, distanceTransformWithLabels, matFromArray } from '@banou/opencv-wasm';
export function matteLayer(pixels, mask, plate, options = {}) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const inner = options.inner ?? 2, outer = options.outer ?? 1, depth = options.depth ?? (options.foreground === 'fitting' ? 2 : 2.5), minimumContrast = options.minimumContrast ?? 12;
        const { width, height } = pixels, size = width * height, v = pixels.data, b = plate.data;
        // Distance inside the silhouette, and the nearest deep interior pixel for every pixel.
        const inside = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 255 : 0)), false), depthMap = __addDisposableResource(env_1, new Mat(), false), none = __addDisposableResource(env_1, new Mat(), false);
        distanceTransformWithLabels(inside, depthMap, none, DIST_L2, 3, DIST_LABEL_PIXEL);
        const interior = depthMap.data32F.slice();
        const core = new Uint8Array(size);
        for (let p = 0; p < size; p++)
            core[p] = interior[p] >= depth ? 0 : 255;
        const notCore = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, core), false), toCore = __addDisposableResource(env_1, new Mat(), false), labels = __addDisposableResource(env_1, new Mat(), false);
        distanceTransformWithLabels(notCore, toCore, labels, DIST_L2, 3, DIST_LABEL_PIXEL);
        const outside = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 0 : 255)), false), exterior = __addDisposableResource(env_1, new Mat(), false), unused = __addDisposableResource(env_1, new Mat(), false);
        distanceTransformWithLabels(outside, exterior, unused, DIST_L2, 3, DIST_LABEL_PIXEL);
        const outsideDistance = exterior.data32F, label = labels.data32S, coreDistance = toCore.data32F;
        let labelCount = 0;
        for (let p = 0; p < size; p++)
            if (label[p] > labelCount)
                labelCount = label[p];
        const source = new Int32Array(labelCount + 1).fill(-1);
        for (let p = 0; p < size; p++)
            if (!core[p])
                source[label[p]] = p;
        const alpha = new Float32Array(size), color = new Float32Array(size * 3), fitting = options.foreground === 'fitting', reach = options.reach ?? 3.5, span = Math.ceil(reach);
        // The candidate whose color line through the plate passes closest to the pixel; nearer wins a tie.
        const fittingForeground = (p, fallback) => {
            const x = p % width, y = (p - x) / width, q = p * 3;
            let best = fallback, score = Infinity;
            for (let dy = -span; dy <= span; dy++)
                for (let dx = -span; dx <= span; dx++) {
                    const cx = x + dx, cy = y + dy, distance = Math.hypot(dx, dy);
                    if (distance > reach || cx < 0 || cy < 0 || cx >= width || cy >= height)
                        continue;
                    const f = cy * width + cx;
                    if (!mask[f] || interior[f] < depth)
                        continue;
                    let dot = 0, norm = 0;
                    for (let c = 0; c < 3; c++) {
                        const d = v[f * 3 + c] - b[q + c];
                        dot += (v[q + c] - b[q + c]) * d;
                        norm += d * d;
                    }
                    if (norm < minimumContrast ** 2)
                        continue;
                    const a = Math.min(1, Math.max(0, dot / norm));
                    let miss = 0;
                    for (let c = 0; c < 3; c++)
                        miss += (v[q + c] - b[q + c] - a * (v[f * 3 + c] - b[q + c])) ** 2;
                    if (miss + distance < score) {
                        score = miss + distance;
                        best = f;
                    }
                }
            return best;
        };
        let unmixed = 0;
        for (let p = 0; p < size; p++) {
            const q = p * 3, inMask = mask[p] === 1;
            if (inMask) {
                alpha[p] = 1;
                color[q] = v[q];
                color[q + 1] = v[q + 1];
                color[q + 2] = v[q + 2];
            }
            const band = inMask ? interior[p] <= inner : outsideDistance[p] <= outer;
            if (!band || !plate.known[p])
                continue;
            let f = source[label[p]];
            if (f < 0 || coreDistance[p] > inner + outer + depth + 2)
                continue;
            if (fitting)
                f = fittingForeground(p, f);
            const fq = f * 3;
            let dot = 0, norm = 0;
            for (let c = 0; c < 3; c++) {
                const d = v[fq + c] - b[q + c];
                dot += (v[q + c] - b[q + c]) * d;
                norm += d * d;
            }
            if (norm < minimumContrast ** 2)
                continue;
            const a = Math.min(1, Math.max(0, dot / norm));
            alpha[p] = a;
            for (let c = 0; c < 3; c++)
                color[q + c] = a > .02 ? Math.min(255, Math.max(0, (v[q + c] - (1 - a) * b[q + c]) / a)) : v[fq + c];
            unmixed++;
        }
        return { width, height, alpha, color, unmixed };
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
