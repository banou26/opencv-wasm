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
import { CV_32F, CV_32FC1, INTER_AREA, Mat, BORDER_REPLICATE, GaussianBlur, createHanningWindow, matFromArray, phaseCorrelate, resize, } from '@banou/opencv-wasm';
function downsample(plane, width, height, sigma) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const source = __addDisposableResource(env_1, matFromArray(plane.height, plane.width, CV_32FC1, plane.data), false);
        const small = __addDisposableResource(env_1, new Mat(), false), blurred = __addDisposableResource(env_1, new Mat(), false);
        if (width === plane.width && height === plane.height)
            source.copyTo(small);
        else
            resize(source, small, { width, height }, 0, 0, INTER_AREA);
        if (sigma > 0)
            GaussianBlur(small, blurred, { width: 0, height: 0 }, sigma, sigma, BORDER_REPLICATE);
        else
            small.copyTo(blurred);
        return { width, height, data: blurred.data32F.slice() };
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/** Phase correlation on a reduced copy. It reports the strongest single motion, which need not be the camera. */
export function coarseTranslation(a, b, width, height, maxSide = 480) {
    const env_2 = { stack: [], error: void 0, hasError: false };
    try {
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const w = Math.max(16, Math.round(width * scale)), h = Math.max(16, Math.round(height * scale));
        const sa = downsample({ width, height, data: a }, w, h, 0), sb = downsample({ width, height, data: b }, w, h, 0);
        const ma = __addDisposableResource(env_2, matFromArray(h, w, CV_32FC1, sa.data), false), mb = __addDisposableResource(env_2, matFromArray(h, w, CV_32FC1, sb.data), false), hann = __addDisposableResource(env_2, new Mat(), false);
        createHanningWindow(hann, { width: w, height: h }, CV_32F);
        const phase = phaseCorrelate(ma, mb, hann);
        return { dx: phase.value.x * width / w, dy: phase.value.y * height / h, response: phase.response };
    }
    catch (e_2) {
        env_2.error = e_2;
        env_2.hasError = true;
    }
    finally {
        __disposeResources(env_2);
    }
}
function sample(plane, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, w = plane.width, p = y0 * w + x0, d = plane.data;
    return (d[p] * (1 - fx) + d[p + 1] * fx) * (1 - fy) + (d[p + w] * (1 - fx) + d[p + w + 1] * fx) * fy;
}
function robustScale(values, count) {
    const histogram = new Uint32Array(2049);
    for (let i = 0; i < count; i++)
        histogram[Math.min(2048, Math.round(Math.abs(values[i]) * 16))]++;
    let cumulative = 0;
    for (let i = 0; i < histogram.length; i++) {
        cumulative += histogram[i];
        if (cumulative * 2 >= count)
            return Math.max(1 / 32, 1.4826 * i / 16);
    }
    return 128;
}
/**
 * Inverse-compositional Gauss-Newton on one level. Pixels far from the fitted motion get zero weight,
 * so a second layer lowers the sample count rather than pulling the estimate toward itself.
 */
function refineLevel(a, b, start, maxIterations, maxSamples) {
    const { width, height } = a, margin = 3;
    const stride = Math.max(1, Math.floor(Math.sqrt(width * height / maxSamples)));
    const points = [];
    for (let y = margin; y < height - margin; y += stride)
        for (let x = margin; x < width - margin; x += stride) {
            const p = y * width + x;
            const gx = (a.data[p + 1] - a.data[p - 1]) / 2, gy = (a.data[p + width] - a.data[p - width]) / 2;
            if (gx * gx + gy * gy > 1e-6)
                points.push(x, y);
        }
    const count = points.length / 2, residuals = new Float32Array(count), inside = new Uint8Array(count), kept = new Float32Array(count);
    let dx = start.dx, dy = start.dy, scale = NaN, iterations = 0, used = 0;
    for (; iterations < maxIterations; iterations++) {
        let n = 0;
        for (let i = 0; i < count; i++) {
            const x = points[i * 2], y = points[i * 2 + 1], qx = x + dx, qy = y + dy;
            inside[i] = Number(qx >= 1 && qy >= 1 && qx <= width - 2 && qy <= height - 2);
            if (!inside[i])
                continue;
            residuals[i] = sample(b, qx, qy) - a.data[y * width + x];
            kept[n++] = residuals[i];
        }
        used = n;
        if (n < 64)
            break;
        scale = robustScale(kept, n);
        let hxx = 0, hxy = 0, hyy = 0, bx = 0, by = 0;
        const cutoff = 4 * scale, knee = 1.5 * scale;
        for (let i = 0; i < count; i++) {
            if (!inside[i])
                continue;
            const r = residuals[i], ar = Math.abs(r);
            if (ar > cutoff)
                continue;
            const weight = ar <= knee ? 1 : knee / ar;
            const p = points[i * 2 + 1] * width + points[i * 2];
            const gx = (a.data[p + 1] - a.data[p - 1]) / 2, gy = (a.data[p + width] - a.data[p - width]) / 2;
            hxx += weight * gx * gx;
            hxy += weight * gx * gy;
            hyy += weight * gy * gy;
            bx += weight * gx * r;
            by += weight * gy * r;
        }
        const det = hxx * hyy - hxy * hxy;
        if (!(Math.abs(det) > 1e-9))
            break;
        const ux = (hyy * bx - hxy * by) / det, uy = (hxx * by - hxy * bx) / det;
        dx -= ux;
        dy -= uy;
        if (Math.hypot(ux, uy) < 1e-3) {
            iterations++;
            break;
        }
    }
    return { dx, dy, residual: Number.isFinite(scale) ? scale : NaN, samples: used, iterations };
}
/**
 * Refine the translation from luma A to luma B, coarse to fine. Await initOpenCV first. The start
 * decides which motion is fitted when several layers move; pass the camera's own estimate.
 */
export function refineTranslation(a, b, width, height, start, options = {}) {
    if (a.length !== width * height || b.length !== width * height)
        throw new RangeError('Luma planes must match the frame size');
    const maxIterations = options.maxIterations ?? 30, maxSamples = options.maxSamples ?? 300_000, coarseSide = options.coarseSide ?? 240;
    const levels = [];
    let w = width, h = height;
    levels.push([downsample({ width, height, data: a }, w, h, .8), downsample({ width, height, data: b }, w, h, .8)]);
    while (Math.max(w, h) / 2 >= coarseSide) {
        w = Math.round(w / 2);
        h = Math.round(h / 2);
        const [pa, pb] = levels[levels.length - 1];
        levels.push([downsample(pa, w, h, .8), downsample(pb, w, h, .8)]);
    }
    let fit = { dx: start.dx * levels[levels.length - 1][0].width / width, dy: start.dy * levels[levels.length - 1][0].height / height, residual: NaN, samples: 0, iterations: 0 };
    for (let level = levels.length - 1; level >= 0; level--) {
        const [pa, pb] = levels[level];
        if (level < levels.length - 1) {
            const [previous] = levels[level + 1];
            fit = { ...fit, dx: fit.dx * pa.width / previous.width, dy: fit.dy * pa.height / previous.height };
        }
        fit = refineLevel(pa, pb, fit, maxIterations, maxSamples);
    }
    return fit;
}
