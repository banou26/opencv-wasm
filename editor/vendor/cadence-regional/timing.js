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
import { CV_8UC1, CV_32FC3, GaussianBlur, Mat, connectedComponentsWithStats, matFromArray, } from '@banou/opencv-wasm';
const unknown = (reason, compared = 0, error = null, noise = null) => ({ status: 'unknown', compared, changed: 0, changedFraction: null, error, noise, reason });
/** Requires initialized OpenCV. Masks describe geometric observation, never flow-error inliers. */
export function measureDrawingEvent(a, b, support, motion, options = {}) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        if (!a || !b || !support || !motion || !options)
            throw new TypeError('Timing requires frames, support, motion, and valid options');
        const { width, height } = a;
        const targetMask = support.targetMask;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 5 || height < 5 ||
            b.width !== width || b.height !== height || !(a.data instanceof Uint8Array) || !(b.data instanceof Uint8Array) ||
            a.data.length !== width * height * 3 || b.data.length !== a.data.length ||
            support.width !== width || support.height !== height || !(support.mask instanceof Uint8Array) ||
            support.mask.length !== width * height || (targetMask !== undefined &&
            (!(targetMask instanceof Uint8Array) || targetMask.length !== width * height)) ||
            !Number.isFinite(motion.dx) || !Number.isFinite(motion.dy) ||
            (options.noiseFloor !== undefined && (!Number.isFinite(options.noiseFloor) || options.noiseFloor < 0))) {
            throw new RangeError('Invalid timing geometry, support, translation, or noise floor');
        }
        const core = new Uint8Array(width * height), observed = new Uint8Array(width * height);
        let interior = 0, compared = 0;
        // Keep the analysis blur entirely inside the supplied source/target support.
        const footprint = (mask, x, y, fractional) => {
            const x0 = Math.floor(x), y0 = Math.floor(y);
            const x1 = fractional ? Math.ceil(x) : x0, y1 = fractional ? Math.ceil(y) : y0;
            if (x0 < 1 || y0 < 1 || x1 >= width - 1 || y1 >= height - 1)
                return false;
            if (!mask)
                return true;
            for (let yy = y0 - 1; yy <= y1 + 1; yy++)
                for (let xx = x0 - 1; xx <= x1 + 1; xx++) {
                    if (!mask[yy * width + xx])
                        return false;
                }
            return true;
        };
        const observedAt = (x, y, dx, dy) => {
            const tx = x + Math.round(dx), ty = y + Math.round(dy);
            return footprint(support.mask, tx - dx, ty - dy, true) && footprint(targetMask, tx, ty, false);
        };
        for (let y = 1; y < height - 1; y++)
            for (let x = 1; x < width - 1; x++) {
                const p = y * width + x;
                if (!footprint(support.mask, x, y, false))
                    continue;
                core[p] = 1;
                interior++;
                if (observedAt(x, y, motion.dx, motion.dy)) {
                    observed[p] = 1;
                    compared++;
                }
            }
        if (interior < 24)
            return unknown('insufficient-source-interior', compared);
        if (compared < 24 || compared / interior < .8)
            return unknown('insufficient-observed-overlap', compared);
        const noise = Math.max(options.noiseFloor ?? 0, estimateNoise(a, b, core, motion));
        if (noise > 6)
            return unknown('noise-exceeds-analysis-range', compared, null, noise);
        const threshold = Math.max(4, 3.5 * noise + 1);
        const inputA = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC3, a.data), false);
        const inputB = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC3, b.data), false);
        const blurredA = __addDisposableResource(env_1, new Mat(), false);
        const blurredB = __addDisposableResource(env_1, new Mat(), false);
        GaussianBlur(inputA, blurredA, { width: 3, height: 3 }, .65);
        GaussianBlur(inputB, blurredB, { width: 3, height: 3 }, .65);
        const left = blurredA.data32F, right = blurredB.data32F;
        const errorAt = (p, dx, dy) => {
            // Predict A on B's integer sample grid; inverse-sampling B would blur it twice.
            const tx = p % width + Math.round(dx), ty = Math.floor(p / width) + Math.round(dy);
            const x = tx - dx, y = ty - dy;
            const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
            const top = (y0 * width + x0) * 3, bottom = top + width * 3;
            let error = 0;
            for (let c = 0; c < 3; c++) {
                const value = (left[top + c] * (1 - fx) + left[top + 3 + c] * fx) * (1 - fy) +
                    (left[bottom + c] * (1 - fx) + left[bottom + 3 + c] * fx) * fy;
                error = Math.max(error, Math.abs(right[(ty * width + tx) * 3 + c] - value));
            }
            return error;
        };
        const raw = new Uint8Array(width * height), errors = new Float32Array(width * height);
        let sum = 0, rawChanged = 0;
        for (let p = 0; p < observed.length; p++)
            if (observed[p]) {
                const error = errorAt(p, motion.dx, motion.dy);
                errors[p] = error;
                sum += error;
                if (error > threshold) {
                    raw[p] = 255;
                    rawChanged++;
                }
            }
        const meanError = sum / compared;
        // Nearby rigid fits only diagnose uncertainty; they never replace the supplied fit.
        if (rawChanged >= 6) {
            const probes = [];
            let ordinal = 0;
            const stride = Math.max(1, Math.floor(compared / 2048));
            for (let p = 0; p < observed.length; p++)
                if (observed[p] && ordinal++ % stride === 0)
                    probes.push(p);
            for (const dy of [-1, -.5, 0, .5, 1])
                for (const dx of [-1, -.5, 0, .5, 1]) {
                    if (!dx && !dy)
                        continue;
                    let before = 0, after = 0, valid = 0;
                    for (const p of probes) {
                        if (!observedAt(p % width, Math.floor(p / width), motion.dx + dx, motion.dy + dy))
                            continue;
                        before += Math.min(errors[p], threshold * 3);
                        after += Math.min(errorAt(p, motion.dx + dx, motion.dy + dy), threshold * 3);
                        valid++;
                    }
                    if (valid >= probes.length * .95 && before - after > valid * Math.max(1, threshold * .2) && after < before * .55) {
                        return unknown('nearby-translation-explains-mismatch', compared, meanError, noise);
                    }
                }
        }
        const mask = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, raw), false);
        const labels = __addDisposableResource(env_1, new Mat(), false);
        const stats = __addDisposableResource(env_1, new Mat(), false);
        const centroids = __addDisposableResource(env_1, new Mat(), false);
        const count = connectedComponentsWithStats(mask, labels, stats, centroids, 8);
        const areas = stats.data32S;
        let changed = 0;
        for (let id = 1; id < count; id++)
            if (areas[id * 5 + 4] >= 6)
                changed += areas[id * 5 + 4];
        if (!changed && rawChanged > Math.max(6, compared * .02))
            return unknown('incoherent-appearance-mismatch', compared, meanError, noise);
        return { status: changed ? 'changed' : 'held', compared, changed, changedFraction: changed / compared,
            error: meanError, noise, reason: changed ? 'coherent-appearance-change' : 'observed-appearance-within-noise' };
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/** Estimate grain spatially, not from A-B differences that may contain a true redraw. */
function estimateNoise(a, b, core, motion) {
    const histograms = [new Uint32Array(129), new Uint32Array(129)], counts = [0, 0], { width, height } = a;
    for (let p = 0; p < core.length; p += 2)
        if (core[p]) {
            const x = p % width, y = Math.floor(p / width);
            for (const [frame, xx, yy, slot] of [[a, x, y, 0], [b, Math.round(x + motion.dx), Math.round(y + motion.dy), 1]]) {
                if (xx < 1 || yy < 1 || xx >= width - 1 || yy >= height - 1)
                    continue;
                const q = (yy * width + xx) * 3, data = frame.data;
                for (let c = 0; c < 3; c++) {
                    const neighbors = [data[q - 3 + c], data[q + 3 + c], data[q - width * 3 + c], data[q + width * 3 + c]];
                    if (Math.max(...neighbors) - Math.min(...neighbors) > 24)
                        continue;
                    const detail = Math.abs(data[q + c] - neighbors.reduce((s, v) => s + v, 0) / 4);
                    histograms[slot][Math.min(128, Math.round(detail * 4))]++;
                    counts[slot]++;
                }
            }
        }
    const sigmas = histograms.map((histogram, slot) => {
        if (counts[slot] < 24)
            return 1;
        let cumulative = 0;
        for (let i = 0; i < histogram.length; i++) {
            cumulative += histogram[i];
            if (cumulative >= counts[slot] / 2)
                return i / 4 / (.6745 * Math.sqrt(1.25));
        }
        return 1;
    });
    return .6 * Math.hypot(sigmas[0], sigmas[1]);
}
/** Only holds bounded by two observed changes are complete; unknowns and gaps censor runs. */
export function summarizeTiming(events) {
    const changeFrames = [], heldFrames = [], unknownFrames = [];
    const completedHolds = [];
    const holdLengthHistogram = {};
    let start = null, previous = null;
    for (const { frame, event } of events) {
        if (!Number.isSafeInteger(frame) || frame < 1 || (previous !== null && frame <= previous) ||
            !event || !['held', 'changed', 'unknown'].includes(event.status))
            throw new Error('Timing events must be ordered unique positive frame indices');
        if (previous !== null && frame !== previous + 1)
            start = null;
        if (event.status === 'changed') {
            changeFrames.push(frame);
            if (start !== null) {
                const length = frame - start;
                completedHolds.push({ startFrame: start, endFrame: frame - 1, length });
                holdLengthHistogram[length] = (holdLengthHistogram[length] ?? 0) + 1;
            }
            start = frame;
        }
        else if (event.status === 'held')
            heldFrames.push(frame);
        else {
            unknownFrames.push(frame);
            start = null;
        }
        previous = frame;
    }
    return { changeFrames, heldFrames, unknownFrames, completedHolds, holdLengthHistogram };
}
