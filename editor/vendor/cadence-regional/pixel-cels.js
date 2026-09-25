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
import { BORDER_CONSTANT, BORDER_REPLICATE, CV_32FC4, CV_64FC1, INTER_CUBIC, Mat, WARP_INVERSE_MAP, matFromArray, warpAffine } from '@banou/opencv-wasm';
import { frameLayerLabels } from "./pixel-frames.js";
import { matteLayer } from "./pixel-matte.js";
/**
 * Assemble a held drawing from every frame of its hold: in each, the layer's pixels are matted against
 * what is behind them and resampled onto the world atlas at the frame's sub-pixel camera position; per
 * pixel the frames agreeing with the median alpha are averaged. A drawing entering the frame edge is
 * complete wherever most frames of its hold showed it whole, and its edge averages the sampling phases
 * of the hold. World-held drawings only: the camera carries it. The matte picks each edge pixel's
 * foreground color from the drawing's pixels nearby that explain it best (`foreground: 'fitting'`).
 */
export async function assembleCel(source, camera, atlas, silhouettes, frames, layer, drawing, behind, margin = 2, matte = { foreground: 'fitting' }) {
    const held = frames.layers[layer].drawings[drawing], [bx, by, bw, bh] = held.box, { width, height } = source, size = width * height;
    const x = bx - margin, y = by - margin, w = bw + 2 * margin, h = bh + 2 * margin;
    // Per frame of the hold, its premultiplied color and alpha on the box; NaN where the frame does not reach.
    const observed = [];
    for (let f = held.first; f <= held.last; f++) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const pixels = await source.frame(f), own = Uint8Array.from(frameLayerLabels(silhouettes, frames, f), l => l === layer + 1 ? 1 : 0), unmixed = matteLayer(pixels, own, behind(f), matte);
            const premultiplied = new Float32Array(size * 4);
            for (let p = 0; p < size; p++) {
                const a = unmixed.alpha[p];
                premultiplied[p * 4 + 3] = a;
                for (let c = 0; c < 3; c++)
                    premultiplied[p * 4 + c] = unmixed.color[p * 3 + c] * a;
            }
            const position = camera.positions[f], ox = -Math.round(position.dx) - atlas.x, oy = -Math.round(position.dy) - atlas.y;
            const image = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC4, premultiplied), false), warped = __addDisposableResource(env_1, new Mat(), false);
            const transform = __addDisposableResource(env_1, matFromArray(2, 3, CV_64FC1, [1, 0, position.dx - Math.round(position.dx), 0, 1, position.dy - Math.round(position.dy)]), false);
            warpAffine(image, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
            const v = warped.data32F, box = new Float32Array(w * h * 4).fill(NaN);
            for (let j = 0; j < h; j++)
                for (let i = 0; i < w; i++) {
                    // Only pixels whose resampling stays clear of the frame edge.
                    const sx = x + i - ox, sy = y + j - oy;
                    if (sx < 3 || sy < 3 || sx >= width - 3 || sy >= height - 3)
                        continue;
                    const p = sy * width + sx, k = j * w + i;
                    box[k * 4 + 3] = Math.min(1, Math.max(0, v[p * 4 + 3]));
                    for (let c = 0; c < 3; c++)
                        box[k * 4 + c] = v[p * 4 + c];
                }
            observed.push(box);
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    // The frames agreeing with the median alpha, averaged: a frame whose silhouette touches the frame edge
    // is not filled there, and one frame's spill is outvoted.
    const alpha = new Float32Array(w * h), color = new Float32Array(w * h * 3), values = [];
    for (let k = 0; k < w * h; k++) {
        values.length = 0;
        for (const box of observed)
            if (box[k * 4 + 3] >= 0)
                values.push(box[k * 4 + 3]);
        if (!values.length)
            continue;
        values.sort((a, b) => a - b);
        const median = values[values.length >> 1];
        let n = 0;
        for (const box of observed) {
            const a = box[k * 4 + 3];
            if (!(Math.abs(a - median) <= .25))
                continue;
            alpha[k] += a;
            for (let c = 0; c < 3; c++)
                color[k * 3 + c] += box[k * 4 + c];
            n++;
        }
        alpha[k] /= n;
        for (let c = 0; c < 3; c++)
            color[k * 3 + c] /= n;
    }
    return { layer, drawing, first: held.first, last: held.last, x, y, width: w, height: h, alpha, color };
}
/**
 * Composite held drawings over what is behind a frame, each resampled at the frame's camera position with
 * the same cubic kernel the plate renders with, in the order given. `layered` marks pixels a drawing reaches
 * with alpha over 1%.
 */
export function composeCels(behind, camera, atlas, cels, frame) {
    const { width, height } = camera, data = behind.data.slice(), known = behind.known.slice(), layered = new Uint8Array(width * height);
    const sx = camera.positions[frame].dx + atlas.x, sy = camera.positions[frame].dy + atlas.y;
    for (const cel of cels) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const x0 = Math.max(0, Math.floor(cel.x + sx) - 2), x1 = Math.min(width, Math.ceil(cel.x + cel.width + sx) + 2);
            const y0 = Math.max(0, Math.floor(cel.y + sy) - 2), y1 = Math.min(height, Math.ceil(cel.y + cel.height + sy) + 2);
            if (x1 <= x0 || y1 <= y0)
                continue;
            const rgba = new Float32Array(cel.width * cel.height * 4);
            for (let k = 0; k < cel.width * cel.height; k++) {
                rgba[k * 4 + 3] = cel.alpha[k];
                for (let c = 0; c < 3; c++)
                    rgba[k * 4 + c] = cel.color[k * 3 + c];
            }
            // Output pixel (x, y) of the window samples the cel at (x0 + x - sx - cel.x, y0 + y - sy - cel.y).
            const image = __addDisposableResource(env_2, matFromArray(cel.height, cel.width, CV_32FC4, rgba), false), warped = __addDisposableResource(env_2, new Mat(), false);
            const transform = __addDisposableResource(env_2, matFromArray(2, 3, CV_64FC1, [1, 0, x0 - sx - cel.x, 0, 1, y0 - sy - cel.y]), false);
            warpAffine(image, warped, transform, { width: x1 - x0, height: y1 - y0 }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_CONSTANT, [0, 0, 0, 0]);
            const w = warped.data32F, ww = x1 - x0;
            for (let y = y0; y < y1; y++)
                for (let x = x0; x < x1; x++) {
                    const k = ((y - y0) * ww + x - x0) * 4, a = Math.min(1, Math.max(0, w[k + 3]));
                    if (a < .01)
                        continue;
                    const p = y * width + x;
                    layered[p] = 1;
                    for (let c = 0; c < 3; c++)
                        data[p * 3 + c] = w[k + c] + (1 - a) * data[p * 3 + c];
                    if (a > .99)
                        known[p] = 1;
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
    return { data, known, layered };
}
/**
 * Refine a held drawing against every frame of its hold. Its premultiplied color C and alpha A on the atlas
 * are solved by least squares (conjugate gradients) so that `frame = warp(C) + (1 - warp(A)) * behind`,
 * with the cubic warp `composeCels` renders with, holds over the whole hold at every sub-pixel phase the
 * camera put it at: recomposing the hold then reproduces its frames, antialiased edges included. Alpha
 * is only identifiable where what is behind changes over the hold; over a behind that stays the same (a
 * drawing held in the world over the plate) only C - A * behind shows, so alpha is pulled toward the
 * starting cel's (its matte) with `anchor` times the frames' weight, and the frames decide the color.
 * `exclude` keeps pixels other drawings cover out of the fit. Color stays within [0, 255 * alpha], alpha
 * within [0, 1].
 */
export async function solveCel(source, camera, atlas, cel, behind, options = {}) {
    const iterations = options.iterations ?? 60, anchor = options.anchor ?? 1, { width, height } = source, n = cel.width * cel.height;
    const views = [];
    let energy = 0, counted = 0;
    for (let f = cel.first; f <= cel.last; f++) {
        const sx = camera.positions[f].dx + atlas.x, sy = camera.positions[f].dy + atlas.y;
        const x0 = Math.max(0, Math.floor(cel.x + sx) - 2), x1 = Math.min(width, Math.ceil(cel.x + cel.width + sx) + 2);
        const y0 = Math.max(0, Math.floor(cel.y + sy) - 2), y1 = Math.min(height, Math.ceil(cel.y + cel.height + sy) + 2);
        if (x1 <= x0 || y1 <= y0)
            continue;
        const ww = x1 - x0, wh = y1 - y0, pixels = (await source.frame(f)).data, seen = behind(f), skip = options.exclude?.(f);
        const back = new Float32Array(ww * wh * 3), target = new Float32Array(ww * wh * 3), valid = new Uint8Array(ww * wh);
        for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
                const p = y * width + x, k = (y - y0) * ww + x - x0;
                if (!seen.known[p] || skip?.[p])
                    continue;
                valid[k] = 1;
                for (let c = 0; c < 3; c++) {
                    back[k * 3 + c] = seen.data[p * 3 + c];
                    target[k * 3 + c] = pixels[p * 3 + c] - seen.data[p * 3 + c];
                    energy += seen.data[p * 3 + c] ** 2;
                }
                counted++;
            }
        views.push({ ox: x0 - sx - cel.x, oy: y0 - sy - cel.y, ww, wh, back, target, valid });
    }
    if (!views.length)
        return cel;
    // The model and its adjoint: for a translation with a symmetric kernel, the adjoint warps back by the opposite shift.
    const forward = (x, v) => {
        const env_3 = { stack: [], error: void 0, hasError: false };
        try {
            const image = __addDisposableResource(env_3, matFromArray(cel.height, cel.width, CV_32FC4, x), false), warped = __addDisposableResource(env_3, new Mat(), false);
            const transform = __addDisposableResource(env_3, matFromArray(2, 3, CV_64FC1, [1, 0, v.ox, 0, 1, v.oy]), false);
            warpAffine(image, warped, transform, { width: v.ww, height: v.wh }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_CONSTANT, [0, 0, 0, 0]);
            const w = warped.data32F, out = new Float32Array(v.ww * v.wh * 3);
            for (let k = 0; k < v.ww * v.wh; k++)
                if (v.valid[k])
                    for (let c = 0; c < 3; c++)
                        out[k * 3 + c] = w[k * 4 + c] - w[k * 4 + 3] * v.back[k * 3 + c];
            return out;
        }
        catch (e_3) {
            env_3.error = e_3;
            env_3.hasError = true;
        }
        finally {
            __disposeResources(env_3);
        }
    };
    const adjoint = (r, v, into) => {
        const env_4 = { stack: [], error: void 0, hasError: false };
        try {
            const image = new Float32Array(v.ww * v.wh * 4);
            for (let k = 0; k < v.ww * v.wh; k++) {
                if (!v.valid[k])
                    continue;
                let a = 0;
                for (let c = 0; c < 3; c++) {
                    image[k * 4 + c] = r[k * 3 + c];
                    a -= r[k * 3 + c] * v.back[k * 3 + c];
                }
                image[k * 4 + 3] = a;
            }
            const source = __addDisposableResource(env_4, matFromArray(v.wh, v.ww, CV_32FC4, image), false), back = __addDisposableResource(env_4, new Mat(), false);
            const transform = __addDisposableResource(env_4, matFromArray(2, 3, CV_64FC1, [1, 0, -v.ox, 0, 1, -v.oy]), false);
            warpAffine(source, back, transform, { width: cel.width, height: cel.height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_CONSTANT, [0, 0, 0, 0]);
            const b = back.data32F;
            for (let k = 0; k < n * 4; k++)
                into[k] += b[k];
        }
        catch (e_4) {
            env_4.error = e_4;
            env_4.hasError = true;
        }
        finally {
            __disposeResources(env_4);
        }
    };
    // Alpha is pulled toward the start with `anchor` times the frames' own weight on it (the energy behind);
    // color only by a small ridge that keeps the system well posed, so the frames decide it.
    const scale = [1e-3, 1e-3, 1e-3, counted ? anchor * energy / counted : anchor], weight = views.length;
    const normal = (x) => {
        const out = new Float32Array(n * 4);
        for (const v of views)
            adjoint(forward(x, v), v, out);
        for (let k = 0; k < n * 4; k++)
            out[k] += weight * scale[k & 3] * x[k];
        return out;
    };
    const start = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
        start[k * 4 + 3] = cel.alpha[k];
        for (let c = 0; c < 3; c++)
            start[k * 4 + c] = cel.color[k * 3 + c];
    }
    const rhs = new Float32Array(n * 4);
    for (const v of views)
        adjoint(v.target, v, rhs);
    for (let k = 0; k < n * 4; k++)
        rhs[k] += weight * scale[k & 3] * start[k];
    const x = start.slice(), applied = normal(x), r = new Float32Array(n * 4);
    for (let k = 0; k < n * 4; k++)
        r[k] = rhs[k] - applied[k];
    const d = r.slice();
    let rr = r.reduce((s, v) => s + v * v, 0);
    for (let i = 0; i < iterations && rr > 1e-9; i++) {
        const q = normal(d);
        let dq = 0;
        for (let k = 0; k < n * 4; k++)
            dq += d[k] * q[k];
        if (!(dq > 0))
            break;
        const step = rr / dq;
        for (let k = 0; k < n * 4; k++) {
            x[k] += step * d[k];
            r[k] -= step * q[k];
        }
        const next = r.reduce((s, v) => s + v * v, 0), beta = next / rr;
        rr = next;
        for (let k = 0; k < n * 4; k++)
            d[k] = r[k] + beta * d[k];
    }
    const alpha = new Float32Array(n), color = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
        const a = Math.min(1, Math.max(0, x[k * 4 + 3]));
        alpha[k] = a;
        for (let c = 0; c < 3; c++)
            color[k * 3 + c] = Math.min(255 * a, Math.max(0, x[k * 4 + c]));
    }
    return { ...cel, alpha, color };
}
/** The drawings each frame shows, one per layer present, assembled once and reused. */
export async function assembleCels(source, camera, atlas, silhouettes, frames, behind) {
    const out = [];
    for (const layer of frames.layers) {
        const cels = [];
        for (let drawing = 0; drawing < layer.drawings.length; drawing++)
            cels.push(await assembleCel(source, camera, atlas, silhouettes, frames, layer.id, drawing, behind));
        out.push(cels);
    }
    return out;
}
