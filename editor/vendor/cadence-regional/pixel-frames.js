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
import { CV_32S, CV_8UC1, Mat, connectedComponents, matFromArray } from '@banou/opencv-wasm';
import { frameOffset } from "./pixel-drawings.js";
import { unpackMask } from "./pixel-layers.js";
function silhouetteComponents(silhouettes, frame) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const { width, height } = silhouettes;
        const source = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, unpackMask(silhouettes.frames[frame].packed, width * height)), false), labels = __addDisposableResource(env_1, new Mat(), false);
        const count = connectedComponents(source, labels, 8, CV_32S);
        return { labels: labels.data32S.slice(), count: count - 1 };
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/** Layer id plus one for every pixel of a frame, 0 outside all silhouettes. */
export function frameLayerLabels(silhouettes, frames, frame) {
    const { labels } = silhouetteComponents(silhouettes, frame), layers = frames.componentLayers[frame];
    return Uint16Array.from(labels, l => l ? layers[l - 1] + 1 : 0);
}
export function layerFrames(evidence, silhouettes, options = {}) {
    const minimumChanges = options.minimumChanges ?? 60, minimumFraction = options.minimumFraction ?? .004;
    const { camera, atlas } = evidence, { width, height } = camera, size = width * height, count = silhouettes.frames.length;
    // Pass one links components of consecutive frames; only two frames of labels are ever held.
    const firstLabel = [], links = [];
    let total = 0, previous;
    for (let frame = 0; frame < count; frame++) {
        const { labels, count: n } = silhouetteComponents(silhouettes, frame);
        firstLabel.push(total);
        if (previous) {
            const a = frameOffset(camera, atlas, frame - 1), b = frameOffset(camera, atlas, frame), dx = a.x - b.x, dy = a.y - b.y;
            const seen = new Set();
            for (let y = 0; y < height; y++) {
                const ty = y + dy;
                if (ty < 0 || ty >= height)
                    continue;
                for (let x = 0; x < width; x++) {
                    const l = previous[y * width + x], tx = x + dx;
                    if (!l || tx < 0 || tx >= width)
                        continue;
                    const m = labels[ty * width + tx], key = l * 65536 + m;
                    if (m && !seen.has(key)) {
                        seen.add(key);
                        links.push([firstLabel[frame - 1] + l - 1, total + m - 1]);
                    }
                }
            }
        }
        total += n;
        previous = labels;
    }
    const parent = Int32Array.from({ length: total }, (_, i) => i);
    const find = (i) => { while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
    } return i; };
    for (const [i, j] of links)
        parent[find(i)] = find(j);
    const layerOf = new Map(), componentLayer = new Int32Array(total);
    for (let i = 0; i < total; i++) {
        const root = find(i);
        if (!layerOf.has(root))
            layerOf.set(root, layerOf.size);
        componentLayer[i] = layerOf.get(root);
    }
    const layerCount = layerOf.size;
    const componentLayers = firstLabel.map((start, frame) => componentLayer.slice(start, frame + 1 < count ? firstLabel[frame + 1] : total));
    const layers = Array.from({ length: layerCount }, (_, id) => ({ id, drawings: [] }));
    const frames = [], open = new Map();
    let redraw;
    for (let frame = 0; frame < count; frame++) {
        const { labels } = silhouetteComponents(silhouettes, frame), table = componentLayers[frame];
        const map = Uint16Array.from(labels, l => l ? table[l - 1] + 1 : 0);
        const offset = frameOffset(camera, atlas, frame), present = new Map();
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const l = map[y * width + x];
                if (!l)
                    continue;
                const b = present.get(l - 1) ?? [Infinity, Infinity, -Infinity, -Infinity, 0];
                b[0] = Math.min(b[0], x + offset.x);
                b[1] = Math.min(b[1], y + offset.y);
                b[2] = Math.max(b[2], x + offset.x);
                b[3] = Math.max(b[3], y + offset.y);
                b[4]++;
                present.set(l - 1, b);
            }
        const shown = [];
        for (const [layer, b] of [...present].sort((p, q) => p[0] - q[0])) {
            let drawing = open.get(layer);
            if (!drawing || drawing.last !== frame - 1 || redraw?.[layer]) {
                drawing = { id: layers[layer].drawings.length, first: frame, last: frame, box: [b[0], b[1], b[2] - b[0] + 1, b[3] - b[1] + 1], area: b[4] };
                layers[layer].drawings.push(drawing);
                open.set(layer, drawing);
            }
            else {
                drawing.last = frame;
                const [x0, y0, w0, h0] = drawing.box, x1 = Math.min(x0, b[0]), y1 = Math.min(y0, b[1]);
                drawing.box = [x1, y1, Math.max(x0 + w0 - 1, b[2]) - x1 + 1, Math.max(y0 + h0 - 1, b[3]) - y1 + 1];
                drawing.area = Math.max(drawing.area, b[4]);
            }
            shown.push([layer, drawing.id]);
        }
        frames.push(shown);
        // Changes of the outgoing pair, counted inside each layer at this frame, decide the next frame's drawing.
        if (frame + 1 < count) {
            const hits = new Uint32Array(layerCount + 1), area = new Uint32Array(layerCount + 1), { indices } = evidence.pairs[frame];
            for (let p = 0; p < size; p++)
                area[map[p]]++;
            for (let i = 0; i < indices.length; i++) {
                const ay = Math.floor(indices[i] / atlas.width), x = indices[i] - ay * atlas.width - offset.x, y = ay - offset.y;
                if (x >= 0 && y >= 0 && x < width && y < height)
                    hits[map[y * width + x]]++;
            }
            redraw = Uint8Array.from({ length: layerCount }, (_, layer) => Number(area[layer + 1] > 0 && hits[layer + 1] >= Math.max(minimumChanges, minimumFraction * area[layer + 1])));
        }
    }
    return { layers, frames, componentLayers, options: { minimumChanges, minimumFraction } };
}
