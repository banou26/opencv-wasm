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
import { CC_STAT_AREA, CC_STAT_HEIGHT, CC_STAT_LEFT, CC_STAT_TOP, CC_STAT_WIDTH, CV_32FC1, CV_8UC1, MORPH_CLOSE, MORPH_ELLIPSE, Mat, blur, connectedComponentsWithStats, erode, getStructuringElement, matFromArray, morphologyEx, } from '@banou/opencv-wasm';
import { CHANGED, INK_HERE, INK_THERE, NEAR } from "./pixel-change.js";
/** Ink appears across the pair: the later frame is darker. */
export const ARRIVE = 1;
/** Ink disappears across the pair: the earlier frame is darker. */
export const LEAVE = 2;
export const CHANGE = 4;
/** A change carries the luma just before and after it (bit VALUED set). */
export const VALUED = 8;
/** The change only boiled: a counterpart lies within 1.5 px. */
export const BOILED = 16;
/** The value after the change is the pixel's scenery (its median over the shot). */
export const AFTER_SCENERY = 32;
/** The value before the change is the pixel's scenery. */
export const BEFORE_SCENERY = 64;
export function cameraPath(width, height, steps) {
    const positions = [{ dx: 0, dy: 0 }];
    for (const step of steps) {
        const last = positions[positions.length - 1];
        positions.push({ dx: last.dx + step.dx, dy: last.dy + step.dy });
    }
    return { width, height, positions };
}
export function worldAtlas(camera, margin = 2) {
    const xs = camera.positions.map(p => -Math.round(p.dx)), ys = camera.positions.map(p => -Math.round(p.dy));
    const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin;
    return { x, y, width: Math.max(...xs) + camera.width + margin - x, height: Math.max(...ys) + camera.height + margin - y };
}
/** Integer atlas offset of a frame: atlas column = x + offset.x, row = y + offset.y. */
export function frameOffset(camera, atlas, frame) {
    const p = camera.positions[frame];
    return { x: -Math.round(p.dx) - atlas.x, y: -Math.round(p.dy) - atlas.y };
}
/**
 * Merge a pair's two directions into world coordinates. `forward` tests frame `pair` against the next
 * frame, `backward` the next frame against `pair`; each keeps its own frame's pixel grid.
 */
export function pairEvidence(camera, atlas, pair, forward, backward, dilation = 1, inkDilation = 0) {
    const { width, height } = camera;
    if (forward.width !== width || backward.width !== width || forward.height !== height || backward.height !== height)
        throw new RangeError('Pair changes must match the camera frame size');
    const a = frameOffset(camera, atlas, pair), b = frameOffset(camera, atlas, pair + 1);
    const left = Math.min(a.x, b.x) - dilation, top = Math.min(a.y, b.y) - dilation;
    const w = Math.max(a.x, b.x) + width + dilation - left, h = Math.max(a.y, b.y) + height + dilation - top;
    const raw = new Uint8Array(w * h), rawBefore = new Uint8Array(w * h), rawAfter = new Uint8Array(w * h);
    const mark = (change, offset, here, there, earlier) => {
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const p = y * width + x, f = change.flags[p];
                if (!(f & CHANGED))
                    continue;
                const r = (y + offset.y - top) * w + x + offset.x - left;
                if (!(raw[r] & VALUED)) {
                    rawBefore[r] = earlier ? change.here[p] : change.there[p];
                    rawAfter[r] = earlier ? change.there[p] : change.here[p];
                }
                raw[r] |= CHANGE | VALUED | (f & INK_HERE ? here : 0) | (f & INK_THERE ? there : 0) | (f & NEAR ? BOILED : 0);
            }
    };
    mark(forward, a, LEAVE, ARRIVE, true);
    mark(backward, b, ARRIVE, LEAVE, false);
    // Only the change bit grows: it absorbs integer placement for the brackets. Ink stays where it was
    // measured, or a line leaving one pixel lends its neighbor the ink of a line arriving next to it.
    // Growth absorbs the half-pixel quantization of each frame's world placement. A pixel's own measured
    // ink always wins over ink lent by a neighbor: a line leaving it next to a line arriving must not
    // read as both.
    const grown = raw.slice(), reach = Math.max(dilation, inkDilation);
    if (reach > 0)
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const f = raw[y * w + x];
                if (!f)
                    continue;
                for (let yy = Math.max(0, y - reach); yy <= Math.min(h - 1, y + reach); yy++)
                    for (let xx = Math.max(0, x - reach); xx <= Math.min(w - 1, x + reach); xx++) {
                        const near = Math.max(Math.abs(yy - y), Math.abs(xx - x)), target = yy * w + xx;
                        grown[target] |= (near <= dilation ? CHANGE : 0) | (near <= inkDilation && !(raw[target] & (ARRIVE | LEAVE)) ? f & (ARRIVE | LEAVE) : 0) | (raw[target] & (VALUED | BOILED));
                    }
            }
    let count = 0;
    for (let i = 0; i < grown.length; i++)
        count += Number(grown[i] !== 0);
    const indices = new Uint32Array(count), flags = new Uint8Array(count), before = new Uint8Array(count), after = new Uint8Array(count);
    let k = 0;
    for (let y = 0; y < h; y++) {
        const ay = y + top;
        if (ay < 0 || ay >= atlas.height)
            continue;
        for (let x = 0; x < w; x++) {
            const f = grown[y * w + x], ax = x + left;
            if (!f || ax < 0 || ax >= atlas.width)
                continue;
            indices[k] = ay * atlas.width + ax;
            before[k] = rawBefore[y * w + x];
            after[k] = rawAfter[y * w + x];
            flags[k++] = f;
        }
    }
    return { indices: indices.slice(0, k), flags: flags.slice(0, k), before: before.slice(0, k), after: after.slice(0, k) };
}
/**
 * `consistency` keeps an ink pixel only where its bracket (last change, next change) holds at least
 * `fraction` of the ink of the dominant bracket within `radius`: every line of one drawing changes at the
 * same redraws, while scenery revealed or about to be covered next to it has a bracket of its own.
 */
export function drawingInk(evidence, frame, rule = 'either', recurrence = 0, consistency, spread = 1, sceneryLeaves = 'recurring') {
    const { camera, atlas, pairs } = evidence, { width, height } = camera, size = width * height;
    if (!Number.isInteger(frame) || frame < 0 || frame > pairs.length)
        throw new RangeError('Frame is outside the evidence');
    const offset = frameOffset(camera, atlas, frame);
    const last = new Uint8Array(size), next = new Uint8Array(size);
    const lastPair = new Int16Array(size).fill(-1), nextPair = new Int16Array(size).fill(-1), current = new Int16Array(size).fill(-1);
    const visit = (pair, each) => {
        const { indices } = pairs[pair];
        for (let i = 0; i < indices.length; i++) {
            const index = indices[i], ay = Math.floor(index / atlas.width), x = index - ay * atlas.width - offset.x, y = ay - offset.y;
            if (x >= 0 && y >= 0 && x < width && y < height)
                each(y * width + x, i);
        }
    };
    for (let pair = 0; pair < frame; pair++)
        visit(pair, (p, i) => {
            const f = pairs[pair].flags[i];
            last[p] = f;
            lastPair[p] = pair;
            if (f & VALUED && pairs[pair].after)
                current[p] = pairs[pair].after[i];
        });
    for (let pair = pairs.length - 1; pair >= frame; pair--)
        visit(pair, (p, i) => {
            next[p] = pairs[pair].flags[i];
            nextPair[p] = pair;
        });
    const ink = new Uint8Array(size);
    for (let p = 0; p < size; p++) {
        // Ink that did not merely boil and whose value is the pixel's scenery was revealed or is about to be covered.
        const revealed = !(last[p] & BOILED) && last[p] & AFTER_SCENERY, covered = sceneryLeaves === 'always' && !(next[p] & BOILED) && next[p] & BEFORE_SCENERY;
        const arrived = revealed ? 0 : last[p] & ARRIVE, leaves = covered ? 0 : next[p] & LEAVE;
        ink[p] = rule === 'both' && last[p] & CHANGE && next[p] & CHANGE ? (arrived && leaves ? arrived | leaves : 0) : arrived | leaves;
    }
    if (consistency && consistency.radius > 0) {
        const code = new Int32Array(size).fill(-1), counts = new Map();
        for (let p = 0; p < size; p++)
            if (ink[p]) {
                const c = (lastPair[p] + 1) * 4096 + nextPair[p] + 1;
                code[p] = c;
                counts.set(c, (counts.get(c) ?? 0) + 1);
            }
        const frequent = [...counts].filter(([, n]) => n >= 50).sort((a, b) => b[1] - a[1]).slice(0, 64).map(([c]) => c);
        const own = new Float32Array(size), best = new Float32Array(size), side = consistency.radius * 2 + 1;
        for (const c of frequent) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const map = new Float32Array(size);
                for (let p = 0; p < size; p++)
                    map[p] = code[p] === c ? 1 : 0;
                const source = __addDisposableResource(env_1, matFromArray(height, width, CV_32FC1, map), false), density = __addDisposableResource(env_1, new Mat(), false);
                blur(source, density, { width: side, height: side });
                const d = density.data32F;
                for (let p = 0; p < size; p++) {
                    if (d[p] > best[p])
                        best[p] = d[p];
                    if (code[p] === c)
                        own[p] = d[p];
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
        for (let p = 0; p < size; p++)
            if (ink[p] && own[p] < consistency.fraction * best[p])
                ink[p] = 0;
    }
    // Leaving ink on scenery that will be covered: the value is the scenery, did not boil, and recurs across
    // a different stretch of time. A drawing that stood still from the first frame does not bring its old
    // value back after its first redraw, so it keeps its outline.
    const recurring = sceneryLeaves === 'recurring', suspect = new Uint8Array(size);
    if (recurring)
        for (let p = 0; p < size; p++)
            suspect[p] = Number(!!(ink[p] & LEAVE) && !(next[p] & BOILED) && !!(next[p] & BEFORE_SCENERY));
    if (recurrence > 0 || recurring) {
        // With no earlier change the current value is the one just before the next change.
        for (let pair = frame; pair < pairs.length; pair++)
            visit(pair, (p, i) => {
                if (current[p] < 0 && nextPair[p] === pair && pairs[pair].flags[i] & VALUED && pairs[pair].before)
                    current[p] = pairs[pair].before[i];
            });
        const recurs = new Uint8Array(size);
        for (let pair = 0; pair < pairs.length; pair++) {
            const { flags, before, after } = pairs[pair];
            if (!before || !after)
                continue;
            visit(pair, (p, i) => {
                if (!ink[p] || current[p] < 0 || !(flags[i] & VALUED))
                    return;
                const tolerance = Math.max(recurrence, suspect[p] ? 10 : 0);
                if (!tolerance)
                    return;
                const earlier = lastPair[p] >= 0 ? pair < lastPair[p] : false, later = nextPair[p] >= 0 ? pair > nextPair[p] : false;
                if (earlier && Math.abs(before[i] - current[p]) <= tolerance)
                    recurs[p] = 1;
                if (later && Math.abs(after[i] - current[p]) <= tolerance)
                    recurs[p] = 1;
            });
        }
        for (let p = 0; p < size; p++) {
            if (recurrence > 0 && recurs[p])
                ink[p] = 0;
            else if (suspect[p] && recurs[p])
                ink[p] &= ~LEAVE;
        }
    }
    // Each frame's world placement is quantized to half a pixel, so a pixel may see its neighbor's event.
    // Surviving ink spreads one pixel to cover it; rejected ink is gone before it can spread.
    if (spread > 0) {
        const grown = ink.slice();
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const f = ink[y * width + x];
                if (!f)
                    continue;
                for (let yy = Math.max(0, y - spread); yy <= Math.min(height - 1, y + spread); yy++)
                    for (let xx = Math.max(0, x - spread); xx <= Math.min(width - 1, x + spread); xx++)
                        if (!ink[yy * width + xx])
                            grown[yy * width + xx] |= f;
            }
        return grown;
    }
    return ink;
}
export function fillEnclosed(mask, width, height) {
    const env_2 = { stack: [], error: void 0, hasError: false };
    try {
        const inverse = new Uint8Array(mask.length);
        for (let p = 0; p < mask.length; p++)
            inverse[p] = mask[p] ? 0 : 255;
        const source = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, inverse), false), labels = __addDisposableResource(env_2, new Mat(), false), stats = __addDisposableResource(env_2, new Mat(), false), centroids = __addDisposableResource(env_2, new Mat(), false);
        const count = connectedComponentsWithStats(source, labels, stats, centroids, 4);
        const touches = new Uint8Array(count), s = stats.data32S, columns = stats.cols;
        for (let label = 1; label < count; label++) {
            const left = s[label * columns + CC_STAT_LEFT], top = s[label * columns + CC_STAT_TOP];
            const right = left + s[label * columns + CC_STAT_WIDTH], bottom = top + s[label * columns + CC_STAT_HEIGHT];
            touches[label] = Number(left === 0 || top === 0 || right === width || bottom === height);
        }
        const out = mask.slice(), l = labels.data32S;
        for (let p = 0; p < out.length; p++)
            if (!out[p] && !touches[l[p]])
                out[p] = 1;
        return out;
    }
    catch (e_2) {
        env_2.error = e_2;
        env_2.hasError = true;
    }
    finally {
        __disposeResources(env_2);
    }
}
export function drawingSilhouette(evidence, frame, options = {}) {
    const env_3 = { stack: [], error: void 0, hasError: false };
    try {
        const closeRadius = options.closeRadius ?? 6, minimumArea = options.minimumArea ?? 800;
        if (!Number.isInteger(closeRadius) || closeRadius < 0 || closeRadius > 32 || !Number.isInteger(minimumArea) || minimumArea < 1
            || !Number.isInteger(options.erode ?? 0) || (options.erode ?? 0) < 0 || (options.erode ?? 0) > 8)
            throw new RangeError('Invalid silhouette options');
        const { width, height } = evidence.camera;
        const ink = drawingInk(evidence, frame, options.inkRule, options.recurrence ?? 0, options.consistency ?? { radius: 0, fraction: .3 }, options.spread ?? 1, options.sceneryLeaves ?? 'never');
        const binary = new Uint8Array(ink.length);
        for (let p = 0; p < ink.length; p++)
            binary[p] = ink[p] ? 255 : 0;
        const minimumInk = options.minimumInk ?? 0;
        if (minimumInk > 1) {
            const env_4 = { stack: [], error: void 0, hasError: false };
            try {
                const strokes = __addDisposableResource(env_4, matFromArray(height, width, CV_8UC1, binary), false), labels = __addDisposableResource(env_4, new Mat(), false), stats = __addDisposableResource(env_4, new Mat(), false), centroids = __addDisposableResource(env_4, new Mat(), false);
                const count = connectedComponentsWithStats(strokes, labels, stats, centroids, 8), l = labels.data32S, small = new Uint8Array(count);
                for (let label = 1; label < count; label++)
                    small[label] = Number(stats.data32S[label * stats.cols + CC_STAT_AREA] < minimumInk);
                for (let p = 0; p < binary.length; p++)
                    if (small[l[p]]) {
                        binary[p] = 0;
                        ink[p] = 0;
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
        const source = __addDisposableResource(env_3, matFromArray(height, width, CV_8UC1, binary), false), closed = __addDisposableResource(env_3, new Mat(), false);
        if (closeRadius > 0) {
            const env_5 = { stack: [], error: void 0, hasError: false };
            try {
                const kernel = __addDisposableResource(env_5, getStructuringElement(MORPH_ELLIPSE, { width: closeRadius * 2 + 1, height: closeRadius * 2 + 1 }), false);
                morphologyEx(source, closed, MORPH_CLOSE, kernel);
            }
            catch (e_4) {
                env_5.error = e_4;
                env_5.hasError = true;
            }
            finally {
                __disposeResources(env_5);
            }
        }
        else
            source.copyTo(closed);
        const filled = fillEnclosed(closed.data.map(v => Number(v !== 0)), width, height);
        const solid = __addDisposableResource(env_3, matFromArray(height, width, CV_8UC1, filled), false), labels = __addDisposableResource(env_3, new Mat(), false), stats = __addDisposableResource(env_3, new Mat(), false), centroids = __addDisposableResource(env_3, new Mat(), false);
        const shrink = options.erode ?? 0;
        if (shrink > 0) {
            const env_6 = { stack: [], error: void 0, hasError: false };
            try {
                const kernel = __addDisposableResource(env_6, getStructuringElement(MORPH_ELLIPSE, { width: shrink * 2 + 1, height: shrink * 2 + 1 }), false);
                erode(solid, solid, kernel);
            }
            catch (e_5) {
                env_6.error = e_5;
                env_6.hasError = true;
            }
            finally {
                __disposeResources(env_6);
            }
        }
        const count = connectedComponentsWithStats(solid, labels, stats, centroids, 8);
        const keep = new Int32Array(count).fill(-1), components = [], s = stats.data32S, columns = stats.cols;
        for (let label = 1; label < count; label++) {
            const area = s[label * columns + CC_STAT_AREA];
            if (area < minimumArea)
                continue;
            keep[label] = components.length;
            components.push({ area, box: [s[label * columns + CC_STAT_LEFT], s[label * columns + CC_STAT_TOP], s[label * columns + CC_STAT_WIDTH], s[label * columns + CC_STAT_HEIGHT]] });
        }
        const mask = new Uint8Array(width * height), l = labels.data32S;
        for (let p = 0; p < mask.length; p++)
            mask[p] = Number(keep[l[p]] >= 0);
        // A pixel another rigid layer explains on both sides of the frame belongs to that layer, not a drawing.
        const forward = evidence.others?.[frame], backward = frame > 0 ? evidence.othersBackward?.[frame - 1] : undefined;
        if (forward || backward)
            for (let p = 0; p < mask.length; p++) {
                const bit = 128 >> (p & 7), f = forward ? forward[p >> 3] & bit : 1, b = backward ? backward[p >> 3] & bit : 1;
                if (f && b)
                    mask[p] = 0;
            }
        return { width, height, frame, mask, ink, components };
    }
    catch (e_6) {
        env_3.error = e_6;
        env_3.hasError = true;
    }
    finally {
        __disposeResources(env_3);
    }
}
