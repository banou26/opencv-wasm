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
import { CV_8UC1, MORPH_ELLIPSE, Mat, dilate, getStructuringElement, matFromArray } from '@banou/opencv-wasm';
import { fillEnclosed, frameOffset } from "./pixel-drawings.js";
import { frameLayerLabels, layerFrames } from "./pixel-frames.js";
import { packMask, unpackMask } from "./pixel-layers.js";
import { closeByDisc, silhouetteFrame } from "./pixel-refine.js";
import { shareDeep, splitRange } from "./pixel-share.js";
/** Index a shot's change events by world pixel. */
export function indexEvents(evidence) {
    const { atlas, pairs } = evidence, size = atlas.width * atlas.height, start = new Uint32Array(size + 1);
    for (const { indices } of pairs)
        for (const a of indices)
            start[a + 1]++;
    for (let a = 0; a < size; a++)
        start[a + 1] += start[a];
    const fill = start.slice(0, size), pair = new Uint16Array(start[size]);
    for (const [k, { indices }] of pairs.entries())
        for (const a of indices)
            pair[fill[a]++] = k;
    return { atlas, pairs: pairs.length, start, pair };
}
/** A frame's bilinear weights at a camera position: pixel columns `x + ix` and `x + ix + ex` (rows alike). */
function bilinear(gx, gy) {
    const ix = Math.floor(gx), iy = Math.floor(gy), ax = gx - ix, ay = gy - iy;
    return { ix, iy, ex: ax > 0 ? 1 : 0, ey: ay > 0 ? 1 : 0, w00: (1 - ax) * (1 - ay), w10: ax * (1 - ay), w01: (1 - ax) * ay, w11: ax * ay };
}
/** The held plate of the atlas rows from `rows`' first up to its second (`HeldPlate`), with an atlas of those rows. */
export async function heldPlateRows(source, camera, atlas, rows, options = {}, silhouettes) {
    const hold = options.hold ?? 12, tolerance = options.tolerance ?? 8, slack = options.arrivalSlack ?? 2, shownTolerance = options.shownTolerance ?? 12, chromaTolerance = options.chromaTolerance ?? 10;
    const { width, height } = source, W = atlas.width, [v0, v1] = rows, size = W * (v1 - v0), count = camera.positions.length;
    const luma = new Float32Array(size).fill(-1), blue = new Float32Array(size), red = new Float32Array(size), first = new Int16Array(size).fill(-1), last = new Int16Array(size).fill(-1);
    const mean = new Float32Array(size), meanBlue = new Float32Array(size), meanRed = new Float32Array(size), length = new Uint16Array(size), start = new Int16Array(size), seen = new Int16Array(size).fill(-2);
    const from = new Int16Array(size).fill(-1), to = new Int16Array(size).fill(-1), longest = (options.pick ?? 'longest') === 'longest';
    // Each frame's samples of the rows `lo` up to `hi`, handed to `take` by point or else kept in the row buffers.
    const rowLuma = new Float32Array(W * (v1 - v0 + 2)), rowBlue = new Float32Array(rowLuma.length), rowRed = new Float32Array(rowLuma.length);
    const sampleFrame = async (s, lo, hi, take) => {
        const data = (await source.frame(s)).data, { dx, dy } = camera.positions[s], k = bilinear(atlas.x + dx, atlas.y + dy);
        const u0 = Math.max(0, -k.ix), u1 = Math.min(W - 1, width - 1 - k.ex - k.ix), va = Math.max(lo, -k.iy), vb = Math.min(hi - 1, height - 1 - k.ey - k.iy);
        if (!take)
            rowLuma.fill(-1);
        for (let v = va; v <= vb; v++) {
            const base = ((v + k.iy) * width + k.ix) * 3, right = k.ex * 3, down = k.ey * width * 3;
            for (let u = u0; u <= u1; u++) {
                const q = base + u * 3, q10 = q + right, q01 = q + down, q11 = q01 + right;
                const b = k.w00 * data[q] + k.w10 * data[q10] + k.w01 * data[q01] + k.w11 * data[q11];
                const g = k.w00 * data[q + 1] + k.w10 * data[q10 + 1] + k.w01 * data[q01 + 1] + k.w11 * data[q11 + 1];
                const r = k.w00 * data[q + 2] + k.w10 * data[q10 + 2] + k.w01 * data[q01 + 2] + k.w11 * data[q11 + 2];
                const y = .0722 * b + .7152 * g + .2126 * r;
                if (take) {
                    take((v - v0) * W + u, s, y, b - y, r - y);
                    continue;
                }
                const j = (v - lo) * W + u;
                rowLuma[j] = y;
                rowBlue[j] = b - y;
                rowRed[j] = r - y;
            }
        }
    };
    for (let s = 0; s < count; s++)
        await sampleFrame(s, v0, v1, (i, s, y, b, r) => {
            if (first[i] < 0)
                first[i] = s;
            last[i] = s;
            const n = seen[i] === s - 1 ? length[i] : 0;
            seen[i] = s;
            if (n && Math.abs(y - mean[i]) <= tolerance && Math.abs(b - meanBlue[i]) <= chromaTolerance && Math.abs(r - meanRed[i]) <= chromaTolerance) {
                mean[i] = (mean[i] * n + y) / (n + 1);
                meanBlue[i] = (meanBlue[i] * n + b) / (n + 1);
                meanRed[i] = (meanRed[i] * n + r) / (n + 1);
                length[i] = Math.min(65535, n + 1);
            }
            else {
                // A stretch that ended before the point left view is no arrival: the longest of them so far is the plate.
                if (longest && n >= hold && n > to[i] - from[i] + 1) {
                    luma[i] = mean[i];
                    blue[i] = meanBlue[i];
                    red[i] = meanRed[i];
                    from[i] = start[i];
                    to[i] = start[i] + n - 1;
                }
                mean[i] = y;
                meanBlue[i] = b;
                meanRed[i] = r;
                length[i] = 1;
                start[i] = s;
            }
            if (!longest && length[i] >= hold && (from[i] < 0 || from[i] === start[i])) {
                luma[i] = mean[i];
                blue[i] = meanBlue[i];
                red[i] = meanRed[i];
                from[i] = start[i];
                to[i] = s;
            }
        });
    if (longest) {
        // The stretch running at the point's last view: an arrival unless it ran from its first.
        for (let i = 0; i < size; i++)
            if (length[i] >= hold && start[i] <= first[i] + slack && length[i] > to[i] - from[i] + 1) {
                luma[i] = mean[i];
                blue[i] = meanBlue[i];
                red[i] = meanRed[i];
                from[i] = start[i];
                to[i] = last[i];
            }
    }
    else
        for (let i = 0; i < size; i++)
            if (from[i] > first[i] + slack && to[i] === last[i])
                luma[i] = -1;
    const share = new Float32Array(size), consistency = new Float32Array(size), firstShown = new Int16Array(size).fill(-1), lastShown = new Int16Array(size).fill(-1);
    const frames = new Uint16Array(size), bare = new Uint16Array(size);
    const lo = Math.max(0, v0 - 1), hi = Math.min(atlas.height, v1 + 1);
    for (let s = 0; s < count; s++) {
        await sampleFrame(s, lo, hi);
        const packed = silhouettes?.frames[s].packed, offset = frameOffset(camera, atlas, s);
        const covered = (u, v) => {
            const x = u - offset.x, y = v - offset.y;
            if (!packed || x < 0 || y < 0 || x >= width || y >= height)
                return false;
            const p = y * width + x;
            return (packed[p >> 3] >> (7 - (p & 7))) & 1;
        };
        for (let v = Math.max(1, v0); v < Math.min(atlas.height - 1, v1); v++)
            for (let u = 1; u < W - 1; u++) {
                const i = (v - v0) * W + u, plate = luma[i];
                if (plate < 0)
                    continue;
                let min = 255, max = 0, full = true;
                for (let dy = -1; dy <= 1 && full; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const y = rowLuma[(v + dy - lo) * W + u + dx];
                        if (y < 0) {
                            full = false;
                            break;
                        }
                        if (y < min)
                            min = y;
                        if (y > max)
                            max = y;
                    }
                if (!full)
                    continue;
                const j = (v - lo) * W + u;
                if (Math.abs(rowBlue[j] - blue[i]) > chromaTolerance || Math.abs(rowRed[j] - red[i]) > chromaTolerance || plate < min - shownTolerance || plate > max + shownTolerance) {
                    frames[i]++;
                    if (!covered(u, v))
                        bare[i]++;
                    continue;
                }
                frames[i]++;
                share[i]++;
                if (firstShown[i] < 0)
                    firstShown[i] = s;
                lastShown[i] = s;
            }
    }
    for (let i = 0; i < size; i++) {
        consistency[i] = share[i] ? share[i] / (share[i] + bare[i]) : 0;
        share[i] = frames[i] ? share[i] / frames[i] : 0;
    }
    return { atlas: { ...atlas, y: atlas.y + v0, height: v1 - v0 }, luma, blue, red, first, last, share, consistency, firstShown, lastShown };
}
/** The held plate of the whole atlas (`HeldPlate`), checked against `silhouettes`; with `pool`, bands of its rows on the pool's threads. */
export async function heldPlate(source, camera, atlas, options = {}) {
    const { pool, silhouettes, ...rest } = options;
    if (!pool)
        return heldPlateRows(source, camera, atlas, [0, atlas.height], rest, silhouettes);
    const parts = await pool.map('heldPlate', shareDeep({ camera, atlas, options: rest, silhouettes }), splitRange(0, atlas.height, pool.size * 2));
    const join = (key) => {
        const list = parts.map(part => part[key]), out = new list[0].constructor(list.reduce((n, a) => n + a.length, 0));
        let at = 0;
        for (const a of list) {
            out.set(a, at);
            at += a.length;
        }
        return out;
    };
    return { atlas, luma: join('luma'), blue: join('blue'), red: join('red'), first: join('first'), last: join('last'), share: join('share'), consistency: join('consistency'), firstShown: join('firstShown'), lastShown: join('lastShown') };
}
/**
 * Carve out of the silhouettes what holds still against the whole plate (`HeldPlate`): a point that shows the
 * scenery the shot shows there is background at any depth, and one that changes only while another layer
 * passes over it is still that scenery. Per frame, a silhouette pixel is trusted when its 3x3 patch is found in
 * the plate within `radius` pixels at a point whose `consistency` reaches `consistent` (a drawing held early and
 * moved later is not scenery). Two floods start beside the outside of the silhouettes, each on its own since
 * joined they would open each other's walls: one through trusted pixels, one through pixels that do not show
 * the plate and whose run without a change lasts `span` frames and ends while the point is in view (scenery the
 * plate does not know, uncovered and covered again), unless the point shows the plate before and after the run
 * (a drawing that stood over the scenery). Trusted pieces neither flood reached go when their median `share`
 * reaches `islands`. Of what is left, a piece under the silhouettes' minimum area goes when most of it shows
 * the plate, and a layer of such pieces (`layerFrames`) goes unless it lasts `lasting` frames. Last, what the
 * input silhouettes lost of a layer that stopped goes back into it (`continueLayers`). Only for scenery
 * held in the camera's coordinates: with a backdrop the camera holds the drawings instead. With `pool`, the
 * plate and the frames are worked on its threads.
 */
export async function carveStill(source, camera, evidence, silhouettes, options = {}) {
    const { pool, progress, ...rest } = options;
    const plate = await heldPlate(source, camera, evidence.atlas, { ...rest, silhouettes, ...(pool ? { pool } : {}) }), index = indexEvents(evidence);
    const carved = pool ? await (async () => {
        const parts = await pool.map('stillCarve', shareDeep({ camera, silhouettes, plate, index, options: rest }), splitRange(0, silhouettes.frames.length, pool.size * 3));
        return { ...silhouettes, frames: parts.flatMap(p => p.frames), stilled: parts.flatMap(p => p.stilled) };
    })() : await stillFrames(source, camera, silhouettes, plate, index, rest, [0, silhouettes.frames.length], progress);
    const kept = dropFleeting(evidence, carved, silhouettes.options.minimumArea ?? 800, options.lasting ?? 12);
    const out = options.covering === 0 ? { ...kept, continued: kept.frames.map(() => 0) } : { ...await continueLayers(source, camera, plate, silhouettes, kept, options), stilled: kept.stilled };
    // What the carve gave up, for the plate to sample beside what it kept (`buildLayerPlate`'s `clear`).
    const size = source.width * source.height;
    const taken = out.frames.map((frame, t) => { const before = unpackMask(silhouettes.frames[t].packed, size), after = unpackMask(frame.packed, size); return packMask(before.map((v, p) => v & ~after[p] & 1)); });
    return { ...out, taken };
}
/**
 * What a layer that stopped left without changing, put back into its carved silhouettes. Change evidence carries
 * no ink inside a flat drawing that stops, so the silhouettes can lose its inside while every pixel there still
 * shows what the layer showed the frame before, and the plate then learns the drawing (market-pan's red coat from
 * frame 98). Per world point, read as the held plate is, a stretch runs while each frame is within `tolerance` of
 * its mean luma and `chromaTolerance` of its color. A pixel outside `input` is kept when its point was inside
 * `carved` or kept the frame before, the frame continues that stretch, `carved` covered the stretch `covering`
 * frames, and the frame does not show the held plate there. Per frame, kept pieces under the silhouettes'
 * minimum area go, and what a closing by `closing` pixels encloses within that of a kept piece joins it (the rim
 * the stopped drawing's last redraw left). Scenery a silhouette merely covered shows its held plate or was
 * covered only a few frames. Run it after the carve, against the plate checked on the input silhouettes: fed
 * back into them, it would make the held plate of a walking coat consistent.
 */
export async function continueLayers(source, camera, plate, input, carved, options = {}) {
    const tolerance = options.tolerance ?? 8, chroma = options.chromaTolerance ?? 10, least = options.covering ?? 12, closing = options.closing ?? 4;
    const piece = carved.options.minimumArea ?? 800, { width, height } = source, size = width * height, { atlas } = plate, W = atlas.width, n = W * atlas.height;
    const mean = new Float32Array(n), meanBlue = new Float32Array(n), meanRed = new Float32Array(n), length = new Uint16Array(n), seen = new Int16Array(n).fill(-2);
    const run = new Uint16Array(n), covered = new Uint8Array(n), frames = [], continued = [];
    for (let s = 0; s < source.count; s++) {
        const data = (await source.frame(s)).data, { dx, dy } = camera.positions[s], o = frameOffset(camera, atlas, s), k = bilinear(atlas.x + dx, atlas.y + dy);
        const inside = unpackMask(input.frames[s].packed, size), cover = unpackMask(carved.frames[s].packed, size), kept = new Uint8Array(size);
        const u0 = Math.max(0, -k.ix), u1 = Math.min(W - 1, width - 1 - k.ex - k.ix), v0 = Math.max(0, -k.iy), v1 = Math.min(atlas.height - 1, height - 1 - k.ey - k.iy);
        for (let v = v0; v <= v1; v++)
            for (let u = u0; u <= u1; u++) {
                const q = ((v + k.iy) * width + k.ix + u) * 3, q10 = q + k.ex * 3, q01 = q + k.ey * width * 3, q11 = q01 + k.ex * 3, i = v * W + u;
                const b = k.w00 * data[q] + k.w10 * data[q10] + k.w01 * data[q01] + k.w11 * data[q11];
                const g = k.w00 * data[q + 1] + k.w10 * data[q10 + 1] + k.w01 * data[q01 + 1] + k.w11 * data[q11 + 1];
                const r = k.w00 * data[q + 2] + k.w10 * data[q10 + 2] + k.w01 * data[q01 + 2] + k.w11 * data[q11 + 2];
                const y = .0722 * b + .7152 * g + .2126 * r, bl = b - y, rd = r - y;
                const same = seen[i] === s - 1 && Math.abs(y - mean[i]) <= tolerance && Math.abs(bl - meanBlue[i]) <= chroma && Math.abs(rd - meanRed[i]) <= chroma;
                if (same) {
                    const m = length[i];
                    mean[i] = (mean[i] * m + y) / (m + 1);
                    meanBlue[i] = (meanBlue[i] * m + bl) / (m + 1);
                    meanRed[i] = (meanRed[i] * m + rd) / (m + 1);
                    length[i] = Math.min(65535, m + 1);
                }
                else {
                    mean[i] = y;
                    meanBlue[i] = bl;
                    meanRed[i] = rd;
                    length[i] = 1;
                    run[i] = 0;
                }
                seen[i] = s;
                const x = u - o.x, fy = v - o.y, p = fy * width + x, within = x >= 0 && fy >= 0 && x < width && fy < height;
                if (within && cover[p])
                    run[i]++;
                const shows = plate.luma[i] >= 0 && Math.abs(y - plate.luma[i]) <= tolerance && Math.abs(bl - plate.blue[i]) <= chroma && Math.abs(rd - plate.red[i]) <= chroma;
                const keep = within && !inside[p] && same && covered[i] === 1 && run[i] >= least && !shows;
                covered[i] = Number((within && cover[p] === 1) || keep);
                if (keep)
                    kept[p] = 1;
            }
        // A layer's piece is never under the area a silhouette may have.
        const done = new Uint8Array(size), members = [];
        for (let p = 0; p < size; p++) {
            if (!kept[p] || done[p])
                continue;
            members.length = 0;
            done[p] = 1;
            members.push(p);
            for (let m = 0; m < members.length; m++) {
                const q = members[m], x = q % width;
                for (let dy = -width; dy <= width; dy += width)
                    for (let dx = x > 0 ? -1 : 0; dx <= (x < width - 1 ? 1 : 0); dx++) {
                        const nb = q + dy + dx;
                        if (nb >= 0 && nb < size && kept[nb] && !done[nb]) {
                            done[nb] = 1;
                            members.push(nb);
                        }
                    }
            }
            if (members.length < piece)
                for (const q of members)
                    kept[q] = 0;
        }
        let count = 0;
        for (let p = 0; p < size; p++)
            count += kept[p];
        if (count && closing) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const union = cover.map((m, p) => m | inside[p] | kept[p]), closed = fillEnclosed(closeByDisc(union, width, height, closing), width, height);
                const marks = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, kept.map(v => v ? 255 : 0)), false), kernel = __addDisposableResource(env_1, getStructuringElement(MORPH_ELLIPSE, { width: closing * 2 + 1, height: closing * 2 + 1 }), false), near = __addDisposableResource(env_1, new Mat(), false);
                dilate(marks, near, kernel);
                const reach = near.data;
                for (let p = 0; p < size; p++)
                    if (closed[p] && !union[p] && reach[p]) {
                        kept[p] = 1;
                        count++;
                    }
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
        continued.push(count);
        if (!count) {
            frames.push(carved.frames[s]);
            continue;
        }
        for (let p = 0; p < size; p++)
            cover[p] |= kept[p];
        frames.push(silhouetteFrame(cover, width, height));
    }
    return { ...carved, frames, continued };
}
/** Without the layers under `minimum` pixels in every frame that last fewer than `lasting` frames: flicker the carve cut free. */
function dropFleeting(evidence, carved, minimum, lasting) {
    const layers = layerFrames(evidence, carved), fleeting = new Set(layers.layers.filter(({ drawings }) => Math.max(...drawings.map(d => d.area)) < minimum && drawings.reduce((n, d) => n + d.last - d.first + 1, 0) < lasting).map(layer => layer.id));
    if (!fleeting.size)
        return carved;
    const { width, height } = carved, size = width * height, frames = carved.frames.slice(), stilled = carved.stilled.slice();
    for (let t = 0; t < frames.length; t++) {
        if (!layers.frames[t].some(([layer]) => fleeting.has(layer)))
            continue;
        const labels = frameLayerLabels(carved, layers, t), mask = unpackMask(frames[t].packed, size);
        for (let p = 0; p < size; p++)
            if (labels[p] && fleeting.has(labels[p] - 1)) {
                mask[p] = 0;
                stilled[t]++;
            }
        frames[t] = silhouetteFrame(mask, width, height);
    }
    return { ...carved, frames, stilled };
}
/** `carveStill`'s frames from `range`'s first up to its second, against a held plate and event index made for the shot. */
export async function stillFrames(source, camera, silhouettes, plate, index, options, range, progress) {
    const radius = options.radius ?? 0, consistent = options.consistent ?? .95, meanTolerance = options.meanTolerance ?? 8, centerTolerance = options.centerTolerance ?? 12, chromaTolerance = options.chromaTolerance ?? 10;
    const span = options.span ?? 18, islands = options.islands ?? .9;
    const { width, height } = source, size = width * height, { atlas } = plate, W = atlas.width, minimum = silhouettes.options.minimumArea ?? 800;
    const frames = [], stilled = [], [firstFrame, end] = range;
    const Y = new Float32Array(size), B = new Float32Array(size), R = new Float32Array(size);
    for (let t = firstFrame; t < end; t++) {
        await progress?.(t, silhouettes.frames.length);
        const mask = unpackMask(silhouettes.frames[t].packed, size), offset = frameOffset(camera, atlas, t), { dx, dy } = camera.positions[t];
        // The frame read at its world points' exact positions, the plate's own sampling: -1 out of view.
        const data = (await source.frame(t)).data, k = bilinear(dx - Math.round(dx), dy - Math.round(dy));
        Y.fill(-1);
        for (let y = Math.max(0, -k.iy); y < Math.min(height, height - k.ey - k.iy); y++)
            for (let x = Math.max(0, -k.ix); x < Math.min(width, width - k.ex - k.ix); x++) {
                const q = ((y + k.iy) * width + x + k.ix) * 3, q10 = q + k.ex * 3, q01 = q + k.ey * width * 3, q11 = q01 + k.ex * 3, p = y * width + x;
                const b = k.w00 * data[q] + k.w10 * data[q10] + k.w01 * data[q01] + k.w11 * data[q11];
                const g = k.w00 * data[q + 1] + k.w10 * data[q10 + 1] + k.w01 * data[q01 + 1] + k.w11 * data[q11 + 1];
                const r = k.w00 * data[q + 2] + k.w10 * data[q10 + 2] + k.w01 * data[q01 + 2] + k.w11 * data[q11 + 2];
                Y[p] = .0722 * b + .7152 * g + .2126 * r;
                B[p] = b - Y[p];
                R[p] = r - Y[p];
            }
        const trusted = new Uint8Array(size), revealed = new Uint8Array(size), shows = new Uint8Array(size);
        for (let y = radius + 1; y < height - radius - 1; y++)
            for (let x = radius + 1; x < width - radius - 1; x++) {
                const p = y * width + x;
                if (!mask[p] || Y[p] < 0)
                    continue;
                const a = (y + offset.y) * W + x + offset.x;
                shows[p] = Number(plate.luma[a] >= 0 && Math.abs(Y[p] - plate.luma[a]) <= centerTolerance && Math.abs(B[p] - plate.blue[a]) <= chromaTolerance && Math.abs(R[p] - plate.red[a]) <= chromaTolerance);
                // Matching a plate the rest of the shot contradicts trusts nothing.
                search: for (let sy = -radius; sy <= radius; sy++)
                    for (let sx = -radius; sx <= radius; sx++) {
                        const b = a + sy * W + sx;
                        if (plate.luma[b] < 0 || Math.abs(Y[p] - plate.luma[b]) > centerTolerance)
                            continue;
                        if (Math.abs(B[p] - plate.blue[b]) > chromaTolerance || Math.abs(R[p] - plate.red[b]) > chromaTolerance)
                            continue;
                        let sum = 0, n = 0;
                        for (let ky = -1; ky <= 1; ky++)
                            for (let kx = -1; kx <= 1; kx++) {
                                const q = p + ky * width + kx, c = b + ky * W + kx;
                                if (Y[q] < 0 || plate.luma[c] < 0)
                                    continue;
                                sum += Math.abs(Y[q] - plate.luma[c]);
                                n++;
                            }
                        if (n >= 5 && sum / n <= meanTolerance) {
                            trusted[p] = Number(plate.consistency[b] >= consistent);
                            break search;
                        }
                    }
                // What shows the plate is the plate test's to judge.
                if (!span || shows[p])
                    continue;
                let before = -1, after = index.pairs;
                for (let e = index.start[a]; e < index.start[a + 1]; e++) {
                    const pair = index.pair[e];
                    if (pair < t)
                        before = pair;
                    else {
                        after = pair;
                        break;
                    }
                }
                const from = Math.max(before + 1, plate.first[a]), to = Math.min(after, plate.last[a]);
                if (to - from + 1 < span || after >= plate.last[a])
                    continue;
                if (plate.firstShown[a] >= 0 && plate.firstShown[a] < from && plate.lastShown[a] > to)
                    continue;
                revealed[p] = 1;
            }
        // The floods, from the pixels they cross that border the outside of the silhouettes.
        const carved = new Uint8Array(size), queue = new Int32Array(size);
        const flood = (through) => {
            const reached = new Uint8Array(size);
            let head = 0, tail = 0;
            for (let p = 0; p < size; p++) {
                if (!through[p])
                    continue;
                const x = p % width;
                if ((x > 0 && !mask[p - 1]) || (x < width - 1 && !mask[p + 1]) || (p >= width && !mask[p - width]) || (p + width < size && !mask[p + width])) {
                    reached[p] = 1;
                    queue[tail++] = p;
                }
            }
            while (head < tail) {
                const p = queue[head++], x = p % width;
                for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
                    if (n < 0 || n >= size || reached[n] || !through[n])
                        continue;
                    reached[n] = 1;
                    queue[tail++] = n;
                }
            }
            for (let p = 0; p < size; p++)
                carved[p] |= reached[p];
        };
        flood(trusted);
        if (span)
            flood(revealed);
        if (islands) {
            const seen = new Uint8Array(size), members = [];
            for (let p = 0; p < size; p++) {
                if (!trusted[p] || carved[p] || seen[p])
                    continue;
                members.length = 0;
                seen[p] = 1;
                members.push(p);
                for (let m = 0; m < members.length; m++) {
                    const q = members[m], x = q % width;
                    for (const n of [x > 0 ? q - 1 : -1, x < width - 1 ? q + 1 : -1, q - width, q + width])
                        if (n >= 0 && n < size && trusted[n] && !carved[n] && !seen[n]) {
                            seen[n] = 1;
                            members.push(n);
                        }
                }
                const shares = members.map(q => { const x = q % width, y = (q - x) / width; return plate.share[(y + offset.y) * W + x + offset.x]; }).sort((a, b) => a - b);
                if (shares[shares.length >> 1] >= islands)
                    for (const q of members)
                        carved[q] = 1;
            }
        }
        let taken = 0;
        for (let p = 0; p < size; p++)
            if (carved[p] && mask[p]) {
                mask[p] = 0;
                taken++;
            }
        if (!taken) {
            frames.push(silhouettes.frames[t]);
            stilled.push(0);
            continue;
        }
        // What the carve leaves under the silhouettes' minimum area goes too when most of it shows the plate, a
        // sliver of scenery beside a line; a moving part the carve cut free (an arm off a still body) stays.
        const seen = new Uint8Array(size), members = [];
        for (let p = 0; p < size; p++) {
            if (!mask[p] || seen[p])
                continue;
            members.length = 0;
            seen[p] = 1;
            members.push(p);
            let showing = 0;
            for (let m = 0; m < members.length && members.length < minimum; m++) {
                const q = members[m], x = q % width;
                showing += shows[q];
                for (let dy = -width; dy <= width; dy += width)
                    for (let dx = x > 0 ? -1 : 0; dx <= (x < width - 1 ? 1 : 0); dx++) {
                        const n = q + dy + dx;
                        if (n >= 0 && n < size && mask[n] && !seen[n]) {
                            seen[n] = 1;
                            members.push(n);
                        }
                    }
            }
            if (members.length >= minimum) {
                for (let m = 0; m < members.length; m++) {
                    const q = members[m], x = q % width;
                    for (let dy = -width; dy <= width; dy += width)
                        for (let dx = x > 0 ? -1 : 0; dx <= (x < width - 1 ? 1 : 0); dx++) {
                            const n = q + dy + dx;
                            if (n >= 0 && n < size && mask[n] && !seen[n]) {
                                seen[n] = 1;
                                members.push(n);
                            }
                        }
                }
                continue;
            }
            if (2 * showing < members.length)
                continue;
            for (const q of members)
                mask[q] = 0;
            taken += members.length;
        }
        frames.push(silhouetteFrame(mask, width, height));
        stilled.push(taken);
    }
    return { ...silhouettes, frames, stilled };
}
