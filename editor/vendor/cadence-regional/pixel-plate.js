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
const BLUE = .0722, GREEN = .7152, RED = .2126;
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
                if (!(t >= 0))
                    continue;
                if ('luma' in reference) {
                    if (Math.abs(BLUE * data[q] + GREEN * data[q + 1] + RED * data[q + 2] - reference.luma[a]) > t)
                        continue;
                }
                else if (Math.abs(data[q] - reference.mean[a * 3]) > t || Math.abs(data[q + 1] - reference.mean[a * 3 + 1]) > t || Math.abs(data[q + 2] - reference.mean[a * 3 + 2]) > t)
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
export function plateLumaSamples(atlas, capacity) {
    return { atlas, capacity, count: new Uint16Array(atlas.width * atlas.height), values: new Uint8Array(atlas.width * atlas.height * capacity) };
}
/** Add one frame's luma outside `exclude` (grown by `margin` pixels), as `addPlateSamples` would sample it. */
export function addLumaSamples(samples, camera, frame, pixels, exclude, margin = 3) {
    const { atlas, capacity, count, values } = samples, { width, height } = pixels;
    const { offset, data, usable } = frameSamples(camera, atlas, frame, pixels, exclude, margin);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            if (!usable[p])
                continue;
            const a = (y + offset.y) * atlas.width + x + offset.x, q = p * 3;
            if (count[a] >= capacity)
                continue;
            values[a * capacity + count[a]++] = Math.max(0, Math.min(255, Math.round(BLUE * data[q] + GREEN * data[q + 1] + RED * data[q + 2])));
        }
}
/** Luma samples of consecutive frame ranges joined per atlas pixel, in range order. */
export function mergeLumaSamples(parts) {
    const capacity = parts.reduce((sum, part) => sum + part.capacity, 0), merged = plateLumaSamples(parts[0].atlas, capacity);
    for (const part of parts)
        for (let a = 0; a < merged.count.length; a++) {
            const n = part.count[a];
            if (!n)
                continue;
            merged.values.set(part.values.subarray(a * part.capacity, a * part.capacity + n), a * capacity + merged.count[a]);
            merged.count[a] += n;
        }
    return merged;
}
/**
 * The median luma per atlas pixel, and a tolerance of three robust spreads (1.4826 median absolute
 * deviations), never under `floor` codes. It holds while up to half the samples show something else: on a
 * follow shot a drawing the silhouettes missed sweeps over the backdrop, and the mean `plateReference` starts
 * from moves toward it while its three spreads widen until they keep it.
 */
export function medianReference(samples, floor = 4) {
    const { capacity, count, values } = samples, luma = new Float32Array(count.length), tolerance = new Float32Array(count.length).fill(-1);
    const deviations = new Uint8Array(capacity);
    for (let a = 0; a < count.length; a++) {
        const n = count[a];
        if (!n)
            continue;
        const own = values.subarray(a * capacity, a * capacity + n).sort(), median = n % 2 ? own[n >> 1] : (own[(n >> 1) - 1] + own[n >> 1]) / 2;
        for (let k = 0; k < n; k++)
            deviations[k] = Math.min(255, Math.round(Math.abs(own[k] - median)));
        const spread = deviations.subarray(0, n).sort()[n >> 1];
        luma[a] = median;
        tolerance[a] = Math.max(floor, 3 * 1.4826 * spread);
    }
    return { luma, tolerance };
}
/** Adds `other`'s sums and counts into `statistics`, both on the same atlas. */
export function mergePlateStatistics(statistics, other) {
    const { sum, square, count } = statistics;
    for (let i = 0; i < sum.length; i++) {
        sum[i] += other.sum[i];
        square[i] += other.square[i];
    }
    for (let a = 0; a < count.length; a++)
        count[a] = Math.min(65535, count[a] + other.count[a]);
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
    const rendered = renderPaint(plate, camera, frame), drift = plate.drift;
    if (drift)
        addDrift(rendered.data, camera.width, camera.height, drift, frame);
    return rendered;
}
/** Adds one frame's drift to BGR `data` on the frame's grid: bilinear between cell centers, clamped at the border. */
export function addDrift(data, width, height, drift, frame) {
    const { cell, columns, rows } = drift, grid = drift.frames[frame];
    if (!grid)
        return;
    // A closure per pixel and channel made this 1.3 s a 1080p frame; the columns' weights repeat on every row.
    const left = new Int32Array(width), right = new Int32Array(width), weight = new Float64Array(width);
    for (let x = 0; x < width; x++) {
        const gx = Math.min(columns - 1, Math.max(0, (x + .5) / cell - .5)), x0 = Math.floor(gx);
        left[x] = x0 * 3;
        right[x] = Math.min(columns - 1, x0 + 1) * 3;
        weight[x] = gx - x0;
    }
    for (let y = 0; y < height; y++) {
        const gy = Math.min(rows - 1, Math.max(0, (y + .5) / cell - .5)), y0 = Math.floor(gy), y1 = Math.min(rows - 1, y0 + 1), fy = gy - y0;
        const top = y0 * columns * 3, bottom = y1 * columns * 3;
        for (let x = 0; x < width; x++) {
            const fx = weight[x], a = left[x], b = right[x], q = (y * width + x) * 3;
            for (let c = 0; c < 3; c++) {
                data[q + c] += (grid[top + a + c] * (1 - fx) + grid[top + b + c] * fx) * (1 - fy) + (grid[bottom + a + c] * (1 - fx) + grid[bottom + b + c] * fx) * fy;
            }
        }
    }
}
/**
 * One frame's drift: per cell and channel the median of frame minus plate over known pixels outside
 * `exclude`, ignoring residuals beyond `limit` codes (drawings the exclusion missed). Cells with fewer
 * than `minimum` samples take the mean of their measured neighbors, spreading until every cell has one.
 */
export function measureDrift(rendered, pixels, exclude, cell = 64, limit = 24, minimum = 32) {
    // Quarter-code bins: the correction is often a fraction of a code.
    const { width, height } = pixels, columns = Math.ceil(width / cell), rows = Math.ceil(height / cell), steps = 4, bins = 2 * limit * steps + 1;
    const histogram = new Uint16Array(columns * rows * 3 * bins), counts = new Uint32Array(columns * rows), v = pixels.data, w = rendered.data;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const p = y * width + x, q = p * 3;
            if (!rendered.known[p] || exclude?.[p])
                continue;
            const r0 = v[q] - w[q], r1 = v[q + 1] - w[q + 1], r2 = v[q + 2] - w[q + 2];
            if (Math.abs(r0) > limit || Math.abs(r1) > limit || Math.abs(r2) > limit)
                continue;
            const k = Math.floor(y / cell) * columns + Math.floor(x / cell), base = k * 3 * bins + limit * steps;
            counts[k]++;
            histogram[base + Math.round(r0 * steps)]++;
            histogram[base + bins + Math.round(r1 * steps)]++;
            histogram[base + 2 * bins + Math.round(r2 * steps)]++;
        }
    const grid = new Float32Array(columns * rows * 3), set = new Uint8Array(columns * rows);
    for (let k = 0; k < columns * rows; k++) {
        if (counts[k] < minimum)
            continue;
        set[k] = 1;
        for (let c = 0; c < 3; c++) {
            let cumulative = 0, b = 0;
            for (; b < bins; b++) {
                cumulative += histogram[(k * 3 + c) * bins + b];
                if (cumulative * 2 >= counts[k])
                    break;
            }
            grid[k * 3 + c] = (b - limit * steps) / steps;
        }
    }
    for (let changed = true; changed;) {
        changed = false;
        const next = set.slice();
        for (let k = 0; k < columns * rows; k++) {
            if (set[k])
                continue;
            const x = k % columns, y = (k - x) / columns, sum = [0, 0, 0];
            let n = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || !set[ny * columns + nx])
                    continue;
                for (let c = 0; c < 3; c++)
                    sum[c] += grid[(ny * columns + nx) * 3 + c];
                n++;
            }
            if (!n)
                continue;
            for (let c = 0; c < 3; c++)
                grid[k * 3 + c] = sum[c] / n;
            next[k] = 1;
            changed = true;
        }
        set.set(next);
    }
    return { columns, rows, grid };
}
function renderPaint(plate, camera, frame) {
    const env_3 = { stack: [], error: void 0, hasError: false };
    try {
        const { width, height } = camera, { atlas } = plate, position = camera.positions[frame];
        // Only the window the frame samples goes to OpenCV: cubic taps and the unseen mask's dilation both reach two
        // atlas pixels, so four around it change nothing, and an integer crop keeps every sub-pixel phase.
        const ox = -(position.dx + atlas.x), oy = -(position.dy + atlas.y);
        const x0 = Math.max(0, Math.floor(ox) - 4), y0 = Math.max(0, Math.floor(oy) - 4);
        const x1 = Math.min(atlas.width, Math.ceil(ox + width) + 4), y1 = Math.min(atlas.height, Math.ceil(oy + height) + 4), w = x1 - x0, h = y1 - y0;
        const window = new Float32Array(w * h * 3), unseen = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            const row = (y + y0) * atlas.width + x0;
            window.set(plate.data.subarray(row * 3, (row + w) * 3), y * w * 3);
            for (let x = 0; x < w; x++)
                unseen[y * w + x] = plate.count[row + x] ? 0 : 255;
        }
        const source = __addDisposableResource(env_3, matFromArray(h, w, CV_32FC3, window), false), warped = __addDisposableResource(env_3, new Mat(), false);
        const transform = __addDisposableResource(env_3, matFromArray(2, 3, CV_64FC1, [1, 0, ox - x0, 0, 1, oy - y0]), false);
        warpAffine(source, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
        // Cubic taps reach two atlas pixels, so a frame pixel is known only when that neighborhood was observed.
        const holes = __addDisposableResource(env_3, matFromArray(h, w, CV_8UC1, unseen), false), grown = __addDisposableResource(env_3, new Mat(), false), sampled = __addDisposableResource(env_3, new Mat(), false);
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
