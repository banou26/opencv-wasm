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
import { BORDER_CONSTANT, BORDER_REPLICATE, CV_32FC3, CV_64FC1, CV_8UC1, INTER_CUBIC, INTER_NEAREST, MORPH_ELLIPSE, WARP_INVERSE_MAP, Mat, dilate, getStructuringElement, matFromArray, warpAffine, } from '@banou/opencv-wasm';
import { frameOffset } from "./pixel-drawings.js";
export function plateStatistics(atlas) {
    const size = atlas.width * atlas.height;
    return { atlas, sum: new Float32Array(size * 3), square: new Float32Array(size * 3), count: new Uint16Array(size) };
}
/** Frame samples on the atlas grid of its window, plus a per-pixel usable flag. */
function frameSamples(camera, atlas, frame, pixels, exclude, margin) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const { width, height } = pixels, position = camera.positions[frame], offset = frameOffset(camera, atlas, frame);
        const fx = position.dx - Math.round(position.dx), fy = position.dy - Math.round(position.dy);
        const source = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC3, pixels.data), false), transform = __addDisposableResource(env_1, matFromArray(2, 3, CV_64FC1, [1, 0, fx, 0, 1, fy]), false), warped = __addDisposableResource(env_1, new Mat(), false);
        warpAffine(source, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
        const usable = new Uint8Array(width * height);
        let grown;
        if (exclude) {
            const env_2 = { stack: [], error: void 0, hasError: false };
            try {
                const mask = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, exclude), false), kernel = __addDisposableResource(env_2, getStructuringElement(MORPH_ELLIPSE, { width: margin * 2 + 1, height: margin * 2 + 1 }), false), out = __addDisposableResource(env_2, new Mat(), false);
                dilate(mask, out, kernel);
                grown = out.data.slice();
            }
            catch (e_1) {
                env_2.error = e_1;
                env_2.hasError = true;
            }
            finally {
                __disposeResources(env_2);
            }
        }
        for (let y = 3; y < height - 3; y++)
            for (let x = 3; x < width - 3; x++)
                usable[y * width + x] = Number(!grown || !grown[y * width + x]);
        return { offset, data: warped.data32F.slice(), usable };
    }
    catch (e_2) {
        env_1.error = e_2;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/** Add one frame outside `exclude` (grown by `margin` pixels). With `reference`, only samples near it count. */
export function addPlateSamples(statistics, camera, frame, pixels, exclude, margin = 3, reference) {
    const { atlas, sum, square, count } = statistics, { width, height } = pixels;
    const { offset, data, usable } = frameSamples(camera, atlas, frame, pixels, exclude, margin);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            if (!usable[p])
                continue;
            const a = (y + offset.y) * atlas.width + x + offset.x, q = p * 3;
            if (reference) {
                const t = reference.tolerance[a];
                if (!(t >= 0) || Math.abs(data[q] - reference.mean[a * 3]) > t || Math.abs(data[q + 1] - reference.mean[a * 3 + 1]) > t || Math.abs(data[q + 2] - reference.mean[a * 3 + 2]) > t)
                    continue;
            }
            for (let c = 0; c < 3; c++) {
                sum[a * 3 + c] += data[q + c];
                square[a * 3 + c] += data[q + c] ** 2;
            }
            if (count[a] < 65535)
                count[a]++;
        }
}
/** Mean, plus a per-pixel tolerance for the trimmed pass: three spreads, never under `floor` codes. */
export function plateReference(statistics, floor = 4) {
    const { sum, square, count } = statistics, mean = new Float32Array(sum.length), tolerance = new Float32Array(count.length).fill(-1);
    for (let a = 0; a < count.length; a++) {
        const n = count[a];
        if (!n)
            continue;
        let spread = 0;
        for (let c = 0; c < 3; c++) {
            const m = sum[a * 3 + c] / n;
            mean[a * 3 + c] = m;
            spread = Math.max(spread, Math.sqrt(Math.max(0, square[a * 3 + c] / n - m * m)));
        }
        tolerance[a] = Math.max(floor, 3 * spread);
    }
    return { mean, tolerance };
}
export function finishPlate(statistics) {
    const { atlas, sum, count } = statistics, data = new Float32Array(sum.length);
    for (let a = 0; a < count.length; a++)
        if (count[a])
            for (let c = 0; c < 3; c++)
                data[a * 3 + c] = sum[a * 3 + c] / count[a];
    return { atlas, data, count: count.slice() };
}
/**
 * The plate seen by one frame, resampled at its sub-pixel camera position. `known` is 1 only where every
 * interpolation tap was observed.
 */
export function renderPlate(plate, camera, frame) {
    const env_3 = { stack: [], error: void 0, hasError: false };
    try {
        const { width, height } = camera, { atlas } = plate, position = camera.positions[frame];
        const source = __addDisposableResource(env_3, matFromArray(atlas.height, atlas.width, CV_32FC3, plate.data), false), warped = __addDisposableResource(env_3, new Mat(), false);
        const transform = __addDisposableResource(env_3, matFromArray(2, 3, CV_64FC1, [1, 0, -(position.dx + atlas.x), 0, 1, -(position.dy + atlas.y)]), false);
        warpAffine(source, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
        // Cubic taps reach two atlas pixels, so a frame pixel is known only when that neighborhood was observed.
        const unseen = new Uint8Array(plate.count.length);
        for (let a = 0; a < unseen.length; a++)
            unseen[a] = plate.count[a] ? 0 : 255;
        const holes = __addDisposableResource(env_3, matFromArray(atlas.height, atlas.width, CV_8UC1, unseen), false), grown = __addDisposableResource(env_3, new Mat(), false), sampled = __addDisposableResource(env_3, new Mat(), false);
        const kernel = __addDisposableResource(env_3, getStructuringElement(MORPH_ELLIPSE, { width: 5, height: 5 }), false);
        dilate(holes, grown, kernel);
        warpAffine(grown, sampled, transform, { width, height }, INTER_NEAREST | WARP_INVERSE_MAP, BORDER_CONSTANT, [255, 255, 255, 255]);
        const known = new Uint8Array(width * height), gap = sampled.data;
        for (let p = 0; p < known.length; p++)
            known[p] = Number(gap[p] === 0);
        return { data: warped.data32F.slice(), known };
    }
    catch (e_3) {
        env_3.error = e_3;
        env_3.hasError = true;
    }
    finally {
        __disposeResources(env_3);
    }
}
/** Largest per-channel difference to the rendered plate; NaN where the plate is unknown. */
export function plateResidual(plate, camera, frame, pixels) {
    const { data, known } = renderPlate(plate, camera, frame), out = new Float32Array(known.length);
    for (let p = 0, q = 0; p < out.length; p++, q += 3) {
        out[p] = known[p] ? Math.max(Math.abs(pixels.data[q] - data[q]), Math.abs(pixels.data[q + 1] - data[q + 1]), Math.abs(pixels.data[q + 2] - data[q + 2])) : NaN;
    }
    return out;
}
