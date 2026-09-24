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
import { BORDER_REPLICATE, CV_32F, CV_32FC1, CV_32FC3, CV_64FC1, CV_8UC1, INTER_CUBIC, MORPH_RECT, WARP_INVERSE_MAP, Mat, Sobel, blur, dilate, getStructuringElement, matFromArray, warpAffine, } from '@banou/opencv-wasm';
import { checkPixelFrame, pixelLuma } from "./pixel-frame.js";
export const CHANGED = 1;
/** This frame is darker than its counterpart: ink is present here. */
export const INK_HERE = 2;
/** The counterpart is darker: ink is present in the other frame. */
export const INK_THERE = 4;
export const OBSERVED = 8;
/** Unchanged only under one of the other motions: the pixel belongs to another rigid layer. */
export const OTHER_LAYER = 16;
/** Changed because another rigid layer covers the pixel in the other frame, not redrawn. */
export const OCCLUDED = 32;
/** Changed, yet its structured 5x5 neighborhood reappears within 2 px: a line that boiled in place, not new content. */
export const NEAR = 64;
function median(values, count) {
    const histogram = new Uint32Array(4097);
    for (let i = 0; i < count; i++)
        histogram[Math.min(4096, Math.round(values[i] * 32))]++;
    let cumulative = 0;
    for (let i = 0; i < histogram.length; i++) {
        cumulative += histogram[i];
        if (cumulative * 2 >= count)
            return i / 32;
    }
    return 128;
}
function gradientMagnitude(luma, width, height) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const source = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC1, luma), false), gx = __addDisposableResource(env_1, new Mat(), false), gy = __addDisposableResource(env_1, new Mat(), false), grown = __addDisposableResource(env_1, new Mat(), false);
        Sobel(source, gx, CV_32F, 1, 0, 3, 1 / 8, 0, BORDER_REPLICATE);
        Sobel(source, gy, CV_32F, 0, 1, 3, 1 / 8, 0, BORDER_REPLICATE);
        const x = gx.data32F, y = gy.data32F, out = new Float32Array(width * height);
        for (let p = 0; p < out.length; p++)
            out[p] = Math.hypot(x[p], y[p]);
        const kernel = __addDisposableResource(env_1, getStructuringElement(MORPH_RECT, { width: 3, height: 3 }), false), magnitude = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC1, out), false);
        dilate(magnitude, grown, kernel);
        return grown.data32F.slice();
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
function boxMean(luma, width, height) {
    const env_2 = { stack: [], error: void 0, hasError: false };
    try {
        const source = __addDisposableResource(env_2, matFromArray(height, width, CV_32FC1, luma), false), out = __addDisposableResource(env_2, new Mat(), false);
        blur(source, out, { width: 7, height: 7 }, { x: -1, y: -1 }, BORDER_REPLICATE);
        return out.data32F.slice();
    }
    catch (e_2) {
        env_2.error = e_2;
        env_2.hasError = true;
    }
    finally {
        __disposeResources(env_2);
    }
}
/**
 * Test every pixel of A against B displaced by `d`. Await initOpenCV first. The interval test accepts any
 * value between the minimum and maximum of B sampled within `reach` pixels, so a different resampling
 * phase of the same drawing is explained while a redrawn line, moved by a pixel or more, is not.
 */
export function measurePairChange(a, b, d, options = {}) {
    checkPixelFrame(a);
    checkPixelFrame(b);
    if (a.width !== b.width || a.height !== b.height)
        throw new RangeError('Pair frames must have the same size');
    const reach = options.reach ?? .5, noiseFactor = options.noiseFactor ?? 4, minimumThreshold = options.minimumThreshold ?? 2.5;
    const slope = options.gradientSlope ?? .1, inkDelta = options.inkDelta ?? 8, lineDelta = options.lineDelta ?? 2, minimumNeighbors = options.minimumNeighbors ?? 3;
    if (!(reach >= 0 && reach <= 2) || !(noiseFactor > 0) || !(minimumThreshold >= 0) || !(slope >= 0) || !(inkDelta >= 0) || !(lineDelta >= 0)
        || !Number.isInteger(minimumNeighbors) || minimumNeighbors < 1 || minimumNeighbors > 9)
        throw new RangeError('Invalid pair change options');
    const { width, height } = a, size = width * height;
    const x0 = Math.max(0, Math.ceil(1 - d.dx + reach)), x1 = Math.min(width - 1, Math.floor(width - 3 - d.dx - reach));
    const y0 = Math.max(0, Math.ceil(1 - d.dy + reach)), y1 = Math.min(height - 1, Math.floor(height - 3 - d.dy - reach));
    const best = new Float32Array(size).fill(Infinity), camera = new Float32Array(size).fill(Infinity);
    let exact;
    {
        const env_3 = { stack: [], error: void 0, hasError: false };
        try {
            const source = __addDisposableResource(env_3, matFromArray(height, width, CV_32FC3, b.data), false);
            for (const [k, motion] of [d, ...(options.otherMotions ?? [])].entries()) {
                const lo = new Float32Array(size * 3).fill(Infinity), hi = new Float32Array(size * 3).fill(-Infinity);
                for (const [sx, sy] of [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
                    const env_4 = { stack: [], error: void 0, hasError: false };
                    try {
                        if (reach === 0 && (sx || sy))
                            continue;
                        const transform = __addDisposableResource(env_4, matFromArray(2, 3, CV_64FC1, [1, 0, motion.dx + sx, 0, 1, motion.dy + sy]), false), warped = __addDisposableResource(env_4, new Mat(), false);
                        warpAffine(source, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
                        const values = warped.data32F;
                        if (k === 0 && !exact)
                            exact = values.slice();
                        for (let i = 0; i < values.length; i++) {
                            const v = values[i];
                            if (v < lo[i])
                                lo[i] = v;
                            if (v > hi[i])
                                hi[i] = v;
                        }
                    }
                    catch (e_3) {
                        env_4.error = e_3;
                        env_4.hasError = true;
                    }
                    finally {
                        __disposeResources(env_4);
                    }
                }
                const mx0 = Math.ceil(1 - motion.dx + reach), mx1 = Math.floor(width - 3 - motion.dx - reach);
                const my0 = Math.ceil(1 - motion.dy + reach), my1 = Math.floor(height - 3 - motion.dy - reach);
                for (let y = Math.max(y0, my0); y <= Math.min(y1, my1); y++)
                    for (let x = Math.max(x0, mx0); x <= Math.min(x1, mx1); x++) {
                        const p = y * width + x, q = p * 3;
                        let error = 0;
                        for (let c = 0; c < 3; c++) {
                            const v = a.data[q + c], e = v < lo[q + c] ? lo[q + c] - v : v > hi[q + c] ? v - hi[q + c] : 0;
                            if (e > error)
                                error = e;
                        }
                        if (error < best[p])
                            best[p] = error;
                        if (k === 0)
                            camera[p] = error;
                    }
            }
        }
        catch (e_4) {
            env_3.error = e_4;
            env_3.hasError = true;
        }
        finally {
            __disposeResources(env_3);
        }
    }
    const lumaA = pixelLuma(a), gradient = gradientMagnitude(lumaA, width, height);
    const lumaB = pixelLuma({ width, height, data: exact });
    const meanA = boxMean(lumaA, width, height), meanB = boxMean(lumaB, width, height);
    const flat = new Float32Array(size);
    let flatCount = 0;
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
            const p = y * width + x;
            if (gradient[p] >= 2)
                continue;
            const q = p * 3;
            flat[flatCount++] = Math.max(Math.abs(exact[q] - a.data[q]), Math.abs(exact[q + 1] - a.data[q + 1]), Math.abs(exact[q + 2] - a.data[q + 2]));
        }
    const noise = flatCount ? 1.4826 * median(flat, flatCount) : NaN;
    const base = Math.max(minimumThreshold, noiseFactor * (Number.isFinite(noise) ? noise : 1));
    const raw = new Uint8Array(size), flags = new Uint8Array(size);
    let observed = 0;
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
            const p = y * width + x;
            const limit = base + slope * gradient[p];
            flags[p] = OBSERVED | (camera[p] > limit && best[p] <= limit ? OTHER_LAYER : 0);
            observed++;
            raw[p] = Number(best[p] > limit);
        }
    // Another rigid layer sliding over this one covers pixels: then B at x shows that layer's content,
    // which A holds at x minus the layer's step. Such a pixel has no counterpart but was not redrawn.
    let occluded;
    if (options.otherMotions?.length) {
        const env_5 = { stack: [], error: void 0, hasError: false };
        try {
            occluded = new Uint8Array(size);
            const sourceA = __addDisposableResource(env_5, matFromArray(height, width, CV_32FC3, a.data), false);
            for (const motion of options.otherMotions) {
                const lo = new Float32Array(size * 3).fill(Infinity), hi = new Float32Array(size * 3).fill(-Infinity);
                for (const [sx, sy] of [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
                    const env_6 = { stack: [], error: void 0, hasError: false };
                    try {
                        if (reach === 0 && (sx || sy))
                            continue;
                        const transform = __addDisposableResource(env_6, matFromArray(2, 3, CV_64FC1, [1, 0, d.dx - motion.dx + sx, 0, 1, d.dy - motion.dy + sy]), false), warped = __addDisposableResource(env_6, new Mat(), false);
                        warpAffine(sourceA, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
                        const values = warped.data32F;
                        for (let i = 0; i < values.length; i++) {
                            const v = values[i];
                            if (v < lo[i])
                                lo[i] = v;
                            if (v > hi[i])
                                hi[i] = v;
                        }
                    }
                    catch (e_5) {
                        env_6.error = e_5;
                        env_6.hasError = true;
                    }
                    finally {
                        __disposeResources(env_6);
                    }
                }
                // Compare B at the camera-displaced position of x with A at that position minus the other step.
                for (let y = y0; y <= y1; y++)
                    for (let x = x0; x <= x1; x++) {
                        const p = y * width + x;
                        if (!raw[p])
                            continue;
                        const q = p * 3;
                        let error = 0;
                        for (let c = 0; c < 3; c++) {
                            const v = exact[q + c], e = v < lo[q + c] ? lo[q + c] - v : v > hi[q + c] ? v - hi[q + c] : 0;
                            if (e > error)
                                error = e;
                        }
                        if (error <= base + slope * gradient[p])
                            occluded[p] = 255;
                    }
            }
            // The antialiased rim of a sliding layer mixes both layers, so neither explains it: two pixels around
            // covered pixels and the other layer's own count as occlusion too.
            for (let p = 0; p < size; p++)
                if (flags[p] & OTHER_LAYER)
                    occluded[p] = 255;
            const source = __addDisposableResource(env_5, matFromArray(height, width, CV_8UC1, occluded), false), grown = __addDisposableResource(env_5, new Mat(), false), kernel = __addDisposableResource(env_5, getStructuringElement(MORPH_RECT, { width: 5, height: 5 }), false);
            dilate(source, grown, kernel);
            occluded = grown.data.slice();
        }
        catch (e_6) {
            env_5.error = e_6;
            env_5.hasError = true;
        }
        finally {
            __disposeResources(env_5);
        }
    }
    // A line that boiled is the same structure within two pixels: a 5x5 luma patch of A found in B at a
    // small offset. Flat patches match anything, so they never count as boiled.
    const boilTolerance = Math.max(3, 1.5 * (Number.isFinite(noise) ? noise : 1));
    const boiled = (x, y) => {
        if (x < 4 || y < 4 || x >= width - 4 || y >= height - 4)
            return false;
        let mean = 0, square = 0;
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
                const v = lumaA[(y + dy) * width + x + dx];
                mean += v;
                square += v * v;
            }
        mean /= 25;
        if (square / 25 - mean * mean < 100)
            return false;
        for (let oy = -2; oy <= 2; oy++)
            for (let ox = -2; ox <= 2; ox++) {
                if (!ox && !oy)
                    continue;
                let error = 0;
                for (let dy = -2; dy <= 2 && error <= boilTolerance * 25; dy++)
                    for (let dx = -2; dx <= 2; dx++)
                        error += Math.abs(lumaA[(y + dy) * width + x + dx] - lumaB[(y + dy + oy) * width + x + dx + ox]);
                if (error <= boilTolerance * 25)
                    return true;
            }
        return false;
    };
    let changed = 0;
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
            const p = y * width + x;
            if (!raw[p])
                continue;
            if (occluded?.[p]) {
                flags[p] |= OCCLUDED;
                continue;
            }
            if (boiled(x, y))
                flags[p] |= NEAR;
            let neighbors = 0;
            for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++)
                for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++)
                    neighbors += raw[yy * width + xx];
            if (neighbors < minimumNeighbors)
                continue;
            const difference = lumaA[p] - lumaB[p];
            const here = difference < -inkDelta && lumaA[p] < meanA[p] - lineDelta, there = difference > inkDelta && lumaB[p] < meanB[p] - lineDelta;
            flags[p] |= CHANGED | (here ? INK_HERE : there ? INK_THERE : 0);
            changed++;
        }
    const round = (plane) => Uint8Array.from(plane, v => Math.max(0, Math.min(255, Math.round(v))));
    return { width, height, flags, noise, changed, observed, here: round(lumaA), there: round(lumaB) };
}
