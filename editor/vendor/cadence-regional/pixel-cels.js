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
import { BORDER_REPLICATE, CV_32FC4, CV_64FC1, INTER_CUBIC, Mat, WARP_INVERSE_MAP, matFromArray, warpAffine } from '@banou/opencv-wasm';
import { frameLayerLabels } from "./pixel-frames.js";
import { matteLayer } from "./pixel-matte.js";
/**
 * Assemble a held drawing from every frame of its hold: in each, the layer's pixels are matted against
 * what is behind them and resampled onto the world atlas at the frame's sub-pixel camera position; per
 * pixel the frames agreeing with the median alpha are averaged. A drawing entering the frame edge is
 * complete wherever most frames of its hold showed it whole, and its edge averages the sampling phases
 * of the hold. World-held drawings only: the camera carries it.
 */
export async function assembleCel(source, camera, atlas, silhouettes, frames, layer, drawing, behind, margin = 2) {
    const held = frames.layers[layer].drawings[drawing], [bx, by, bw, bh] = held.box, { width, height } = source, size = width * height;
    const x = bx - margin, y = by - margin, w = bw + 2 * margin, h = bh + 2 * margin;
    // Per frame of the hold, its premultiplied color and alpha on the box; NaN where the frame does not reach.
    const observed = [];
    for (let f = held.first; f <= held.last; f++) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const pixels = await source.frame(f), own = Uint8Array.from(frameLayerLabels(silhouettes, frames, f), l => l === layer + 1 ? 1 : 0), matte = matteLayer(pixels, own, behind(f));
            const premultiplied = new Float32Array(size * 4);
            for (let p = 0; p < size; p++) {
                const a = matte.alpha[p];
                premultiplied[p * 4 + 3] = a;
                for (let c = 0; c < 3; c++)
                    premultiplied[p * 4 + c] = matte.color[p * 3 + c] * a;
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
 * Composite held drawings over what is behind a frame, each resampled bilinearly at the frame's camera
 * position, in the order given. `layered` marks pixels a drawing reaches with alpha over 1%.
 */
export function composeCels(behind, camera, atlas, cels, frame) {
    const { width, height } = camera, data = behind.data.slice(), known = behind.known.slice(), layered = new Uint8Array(width * height);
    const sx = camera.positions[frame].dx + atlas.x, sy = camera.positions[frame].dy + atlas.y;
    for (const cel of cels) {
        const x0 = Math.max(0, Math.floor(cel.x + sx)), x1 = Math.min(width - 1, Math.ceil(cel.x + cel.width + sx));
        const y0 = Math.max(0, Math.floor(cel.y + sy)), y1 = Math.min(height - 1, Math.ceil(cel.y + cel.height + sy));
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
                const u = x - sx - cel.x, v = y - sy - cel.y, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
                if (iu < 0 || iv < 0 || iu + 1 >= cel.width || iv + 1 >= cel.height)
                    continue;
                const t00 = iv * cel.width + iu, t10 = t00 + 1, t01 = t00 + cel.width, t11 = t01 + 1;
                const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
                const a = w00 * cel.alpha[t00] + w10 * cel.alpha[t10] + w01 * cel.alpha[t01] + w11 * cel.alpha[t11];
                if (a < .01)
                    continue;
                const p = y * width + x;
                layered[p] = 1;
                for (let c = 0; c < 3; c++) {
                    const g = w00 * cel.color[t00 * 3 + c] + w10 * cel.color[t10 * 3 + c] + w01 * cel.color[t01 * 3 + c] + w11 * cel.color[t11 * 3 + c];
                    data[p * 3 + c] = g + (1 - a) * data[p * 3 + c];
                }
                if (a > .99)
                    known[p] = 1;
            }
    }
    return { data, known, layered };
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
