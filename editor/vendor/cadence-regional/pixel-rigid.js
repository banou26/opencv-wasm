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
import { BORDER_CONSTANT, BORDER_REPLICATE, CC_STAT_AREA, CC_STAT_HEIGHT, CC_STAT_LEFT, CC_STAT_TOP, CC_STAT_WIDTH, CV_32FC3, CV_32FC4, CV_64FC1, CV_8UC1, INTER_CUBIC, INTER_NEAREST, MORPH_CLOSE, MORPH_ELLIPSE, MORPH_RECT, WARP_INVERSE_MAP, Mat, connectedComponentsWithStats, dilate, getStructuringElement, matFromArray, morphologyEx, warpAffine, } from '@banou/opencv-wasm';
import { explainingMotions } from "./pixel-change.js";
import { cameraPath, frameOffset, worldAtlas } from "./pixel-drawings.js";
import { motionTracks } from "./pixel-layers.js";
import { addPlateSamples, finishPlate, plateReference, plateStatistics, renderPlate } from "./pixel-plate.js";
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
/**
 * Fill the enclosed holes of `mask` under `maximum` pixels whose mean `open` score stays under `openLimit`,
 * then drop components of it under `minimum` pixels.
 */
function tidyCover(mask, width, height, maximum, open, openLimit, minimum) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const out = mask.slice();
        {
            const env_2 = { stack: [], error: void 0, hasError: false };
            try {
                const source = __addDisposableResource(env_2, matFromArray(height, width, CV_8UC1, mask.map(m => m ? 0 : 255)), false), labels = __addDisposableResource(env_2, new Mat(), false), stats = __addDisposableResource(env_2, new Mat(), false), centroids = __addDisposableResource(env_2, new Mat(), false);
                const count = connectedComponentsWithStats(source, labels, stats, centroids, 4), l = labels.data32S, score = new Float32Array(count), s = stats.data32S, columns = stats.cols;
                for (let p = 0; p < out.length; p++)
                    score[l[p]] += open[p];
                const fill = new Uint8Array(count);
                for (let label = 1; label < count; label++) {
                    const area = s[label * columns + CC_STAT_AREA], left = s[label * columns + CC_STAT_LEFT], top = s[label * columns + CC_STAT_TOP];
                    const border = left === 0 || top === 0 || left + s[label * columns + CC_STAT_WIDTH] === width || top + s[label * columns + CC_STAT_HEIGHT] === height;
                    fill[label] = Number(!border && area < maximum && score[label] / area < openLimit);
                }
                for (let p = 0; p < out.length; p++)
                    if (!out[p] && fill[l[p]])
                        out[p] = 1;
            }
            catch (e_1) {
                env_2.error = e_1;
                env_2.hasError = true;
            }
            finally {
                __disposeResources(env_2);
            }
        }
        const solid = __addDisposableResource(env_1, matFromArray(height, width, CV_8UC1, out), false), labels = __addDisposableResource(env_1, new Mat(), false), stats = __addDisposableResource(env_1, new Mat(), false), centroids = __addDisposableResource(env_1, new Mat(), false);
        const count = connectedComponentsWithStats(solid, labels, stats, centroids, 8), l = labels.data32S, small = new Uint8Array(count);
        for (let label = 1; label < count; label++)
            small[label] = Number(stats.data32S[label * stats.cols + CC_STAT_AREA] < minimum);
        for (let p = 0; p < out.length; p++)
            if (out[p] && small[l[p]])
                out[p] = 0;
        return out;
    }
    catch (e_2) {
        env_1.error = e_2;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/**
 * Paths of the rigid layers other than the camera: non-camera candidate motions linked into tracks, tracks
 * whose mean motions agree within `merge` pixels joined into one layer (a layer found twice on some pairs
 * splits the greedy linking into several tracks), and a layer kept when measured on `minimumPresence` of
 * the pairs. A pair's step is the median of the layer's candidates there; missing pairs interpolate.
 */
export function rigidPaths(camera, minimumPresence = .5, merge = .5) {
    const others = camera.motions.map(m => m.slice(1)), pairs = others.length;
    const tracks = motionTracks(others).map(track => {
        const present = track.members.filter(m => m !== undefined);
        return { track, dx: present.reduce((s, m) => s + m.dx, 0) / present.length, dy: present.reduce((s, m) => s + m.dy, 0) / present.length, support: track.support };
    }).sort((a, b) => b.support - a.support);
    const groups = [];
    for (const track of tracks) {
        const group = groups.find(g => Math.hypot(g[0].dx - track.dx, g[0].dy - track.dy) <= merge);
        if (group)
            group.push(track);
        else
            groups.push([track]);
    }
    return groups.flatMap(group => {
        const measured = [];
        for (let pair = 0; pair < pairs; pair++) {
            const found = group.flatMap(({ track }) => track.members[pair] ? [track.members[pair]] : []);
            measured.push(found.length ? { dx: median(found.map(m => m.dx)), dy: median(found.map(m => m.dy)) } : undefined);
        }
        const present = measured.flatMap((m, i) => m ? [i] : []);
        if (!pairs || present.length < minimumPresence * pairs)
            return [];
        const steps = [];
        for (let pair = 0; pair < pairs; pair++) {
            const own = measured[pair];
            if (own) {
                steps.push(own);
                continue;
            }
            const before = present.filter(i => i < pair).pop(), after = present.find(i => i > pair);
            const a = measured[before ?? after], b = measured[after ?? before], f = before !== undefined && after !== undefined ? (pair - before) / (after - before) : 0;
            steps.push({ dx: a.dx + (b.dx - a.dx) * f, dy: a.dy + (b.dy - a.dy) * f });
        }
        return [{ path: cameraPath(camera.width, camera.height, steps), measured: present.length, steps }];
    });
}
/**
 * Where a rigid layer paints, from frames a baseline apart: a pixel of the layer holds its value in the
 * layer's coordinates, a pixel where the camera's scenery shows through holds it in the camera's. Frames
 * a pair apart cannot tell smooth scenery from paint, as it repeats a few pixels on; each baseline spans
 * one of `displacements` in pixels of relative motion. Pixels neither motion decides are paint only
 * inside enclosed holes that the camera does not explain.
 */
export async function measureRigidCover(source, camera, layer, options = {}) {
    return measurePlaneCover(source, layer, [camera, ...(options.others ?? [])], options);
}
/**
 * The same test for any plane against every other one, the camera's included: bit 0 of each test is
 * this plane's motion. Used as is for the camera's own plane when planes lie behind it.
 */
export async function measurePlaneCover(source, layer, others, options = {}) {
    const env_3 = { stack: [], error: void 0, hasError: false };
    try {
        const { path } = layer, atlas = worldAtlas(path), size = atlas.width * atlas.height, closing = options.closing ?? 2;
        const displacements = options.displacements ?? [12, 48, 192], strides = options.strides ?? [2, 2, 4];
        const own = new Uint16Array(size), back = new Uint16Array(size), both = new Uint16Array(size), tested = new Uint16Array(size), { width, height } = source, frames = source.count;
        const planes = [path, ...others], all = (1 << planes.length) - 1, arrival = options.arrival ?? false;
        // The baselines must separate this plane from the one moving most like it.
        const speed = Math.min(...others.map(other => {
            const relative = [];
            for (let t = 0; t + 1 < frames; t++) {
                const c = other.positions, r = path.positions;
                relative.push(Math.hypot(r[t + 1].dx - r[t].dx - (c[t + 1].dx - c[t].dx), r[t + 1].dy - r[t].dy - (c[t + 1].dy - c[t].dy)));
            }
            return median(relative);
        }));
        const baselines = displacements.map(d => Math.max(1, Math.min(Math.floor((frames - 1) / 2), Math.ceil(d / Math.max(speed, 1e-3)))));
        const tests = baselines.flatMap((baseline, k) => {
            const out = [];
            for (let t = 0; t + baseline < frames; t += strides[k] ?? 2)
                out.push([t, baseline]);
            return out;
        });
        const motions = (t, u) => planes.map(plane => ({ dx: plane.positions[u].dx - plane.positions[t].dx, dy: plane.positions[u].dy - plane.positions[t].dy }));
        // Scenery that changes slowly would pass for noise across a baseline; neighboring frames measure it.
        const samples = [];
        for (let k = 0; k < 5 && frames > 1; k++) {
            const t = Math.min(frames - 2, Math.floor((k + .5) * (frames - 1) / 5));
            samples.push(explainingMotions(await source.frame(t), await source.frame(t + 1), motions(t, t + 1)).noise);
        }
        const noise = samples.filter(Number.isFinite).sort((a, b) => a - b)[samples.length >> 1];
        for (const [done, [t, baseline]] of tests.entries()) {
            await options.progress?.(done, tests.length);
            const u = t + baseline;
            const pair = motions(t, u), { bits, inside } = explainingMotions(await source.frame(t), await source.frame(u), pair, { noise });
            const offset = frameOffset(path, atlas, t), shifts = pair.map(m => [Math.round(m.dx), Math.round(m.dy)]), before = options.exclude?.(t), after = options.exclude?.(u);
            const hiddenBefore = options.occluders?.(t), hiddenAfter = options.occluders?.(u);
            const covered = (mask, x, y) => !!mask && x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
            const [sx, sy] = shifts[0];
            const inFrame = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
            const arrives = (x2, y2) => {
                if (!inFrame(x2, y2))
                    return false;
                if (!arrival)
                    return !(bits[y2 * width + x2] & ~1);
                for (let k = 1; k < shifts.length; k++) {
                    const xk = x2 - shifts[k][0], yk = y2 - shifts[k][1];
                    if (!inFrame(xk, yk) || bits[yk * width + xk] & 1 << k)
                        return false;
                }
                return true;
            };
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const p = y * width + x, b = bits[p], a = (y + offset.y) * atlas.width + x + offset.x;
                    if (inside[p] !== all)
                        continue;
                    if (before?.[p] || shifts.some(([dx, dy]) => covered(after, x + dx, y + dy)))
                        continue;
                    if (hiddenBefore?.[p] || covered(hiddenAfter, x + sx, y + sy))
                        continue;
                    if (tested[a] < 65535)
                        tested[a]++;
                    // Where the layer's paint goes no other plane may explain the frame either: smooth scenery that paint
                    // covers by the second frame matches the layer's motion there, yet holds still where it went.
                    if (b === 1 && own[a] < 65535 && arrives(x + sx, y + sy))
                        own[a]++;
                    else if (b && !(b & 1) && back[a] < 65535)
                        back[a]++;
                    else if (b & 1 && b & ~1 && both[a] < 65535)
                        both[a]++;
                }
        }
        // Only this layer's motion explaining a pixel is paint. Another plane's alone is weaker evidence against:
        // a drawing held in front of the layer, or a nearer plane, shows it too, so paint tolerates `occlusion`
        // times as much.
        const occlusion = options.occlusion ?? 3, minimum = options.minimumOwn ?? 3, fraction = options.ownFraction ?? .3;
        const paint = new Uint8Array(size);
        for (let a = 0; a < size; a++)
            paint[a] = own[a] >= minimum && own[a] * occlusion >= back[a] && own[a] >= fraction * (tested[a] - back[a]) ? 255 : 0;
        // Flat paint repeats in both coordinates and decides nothing; small gaps inside paint are paint.
        const painted = __addDisposableResource(env_3, matFromArray(atlas.height, atlas.width, CV_8UC1, paint), false), closed = __addDisposableResource(env_3, new Mat(), false);
        const kernel = __addDisposableResource(env_3, getStructuringElement(MORPH_ELLIPSE, { width: 2 * closing + 1, height: 2 * closing + 1 }), false);
        morphologyEx(painted, closed, MORPH_CLOSE, kernel);
        // A hole is flat paint unless the camera alone explains it most of the time: scenery seen through a gap.
        // Filling leans generous, as `refineRigidCover` later drops what the camera plate explains.
        const open = new Float32Array(size);
        for (let a = 0; a < size; a++)
            open[a] = tested[a] ? back[a] / tested[a] : 0;
        const cover = tidyCover(closed.data.map(v => Number(v !== 0)), atlas.width, atlas.height, options.maximumHole ?? 6000, open, options.openHole ?? .3, options.minimumArea ?? 256);
        const decided = new Uint8Array(size), minimumTests = options.minimumTests ?? 3;
        for (let a = 0; a < size; a++)
            decided[a] = Number(tested[a] >= minimumTests || cover[a] === 1);
        return { path, atlas, measured: layer.measured, depth: pathSpeed(path), baselines, own, back, both, tested, cover, decided };
    }
    catch (e_3) {
        env_3.error = e_3;
        env_3.hasError = true;
    }
    finally {
        __disposeResources(env_3);
    }
}
/** Median step length of a path in pixels per frame. */
export function pathSpeed(path) {
    const { positions } = path, steps = [];
    for (let t = 0; t + 1 < positions.length; t++)
        steps.push(Math.hypot(positions[t + 1].dx - positions[t].dx, positions[t + 1].dy - positions[t].dy));
    return median(steps);
}
/**
 * The scene's planes back to front. In a pan, scenery moves the way the camera's own plane does and the
 * farther the slower, so a plane is behind the camera's when it is slower and its median step points the
 * same way. With none behind, the found planes are all in front, faster nearer, and the camera's plane is
 * the plate as before. Otherwise the camera's own plane joins between them and the farthest plane becomes
 * the backdrop. Speed is only a parallax prior: a plane moving on its own, or scenery sliding behind a
 * still foreground, gets the wrong depth.
 */
export function orderPlanes(camera, found) {
    const heading = (path) => {
        const { positions } = path, dx = [], dy = [];
        for (let t = 0; t + 1 < positions.length; t++) {
            dx.push(positions[t + 1].dx - positions[t].dx);
            dy.push(positions[t + 1].dy - positions[t].dy);
        }
        return [median(dx), median(dy)];
    };
    const speed = pathSpeed(camera), [cx, cy] = heading(camera);
    const planes = found.map(entry => ({ entry: { path: entry.path, measured: entry.measured }, speed: pathSpeed(entry.path), heading: heading(entry.path) }));
    const behind = planes.filter(p => p.speed < speed && p.heading[0] * cx + p.heading[1] * cy > 0).sort((a, b) => a.speed - b.speed);
    const front = planes.filter(p => !behind.includes(p)).sort((a, b) => a.speed - b.speed);
    if (!behind.length)
        return front.map(p => p.entry);
    const own = { path: { width: camera.width, height: camera.height, positions: camera.positions }, measured: camera.positions.length - 1, camera: true };
    return [{ ...behind[0].entry, backdrop: true }, ...behind.slice(1).map(p => p.entry), own, ...front.map(p => p.entry)];
}
/**
 * Covers for planes in back-to-front order, measured front to back: each plane is tested against every
 * other one, and only where the planes already measured in front of it leave it visible. The backdrop is
 * never measured, and one already built is reused, as is every other plane's order. With a camera entry
 * the other planes follow their paint to where it arrives; without one this is `measureRigidCover` for
 * each plane.
 */
export async function measureScenePlanes(source, camera, planes, options = {}) {
    const hasCamera = planes.some(plane => plane.camera), out = new Array(planes.length);
    for (let k = planes.length - 1; k >= 0; k--) {
        const plane = planes[k];
        if (plane.backdrop) {
            if ('cover' in plane) {
                out[k] = plane;
                continue;
            }
            const atlas = worldAtlas(plane.path), size = atlas.width * atlas.height, none = new Uint16Array(size), all = new Uint8Array(size).fill(1);
            out[k] = { path: plane.path, atlas, measured: plane.measured, depth: pathSpeed(plane.path), backdrop: true, baselines: [], own: none, back: none, both: none, tested: none, cover: all, decided: all };
            continue;
        }
        const nearer = out.slice(k + 1);
        const occluders = nearer.length ? (frame) => {
            const union = renderCover(nearer[0], frame, true);
            for (const layer of nearer.slice(1)) {
                const mask = renderCover(layer, frame, true);
                for (let p = 0; p < union.length; p++)
                    union[p] |= mask[p];
            }
            return union;
        } : undefined;
        const others = [...(hasCamera ? [] : [camera]), ...planes.filter((_, j) => j !== k).map(other => other.path)];
        const measured = await measurePlaneCover(source, plane, others, { ...options, arrival: options.arrival ?? hasCamera, occluders });
        out[k] = plane.camera ? { ...measured, camera: true } : measured;
    }
    return out;
}
/**
 * Per frame, what hides plane `index` of a back-to-front list: `exclude` (drawings in front), and every
 * nearer plane's cover and undecided pixels grown by `rim` pixels, where that plane's antialiased edge
 * mixes into what is behind it. `exclude` itself when no plane is nearer.
 */
export function hiddenBy(layers, index, exclude, rim = 1) {
    const nearer = layers.slice(index + 1), { width, height } = layers[index]?.path ?? { width: 0, height: 0 };
    if (!nearer.length)
        return exclude;
    return frame => {
        const env_4 = { stack: [], error: void 0, hasError: false };
        try {
            const hidden = new Uint8Array(width * height);
            for (const layer of nearer) {
                const mask = renderCover(layer, frame, true);
                for (let p = 0; p < hidden.length; p++)
                    hidden[p] |= mask[p];
            }
            const mask = __addDisposableResource(env_4, matFromArray(height, width, CV_8UC1, hidden), false), grown = __addDisposableResource(env_4, new Mat(), false), kernel = __addDisposableResource(env_4, getStructuringElement(MORPH_RECT, { width: 2 * rim + 1, height: 2 * rim + 1 }), false);
            dilate(mask, grown, kernel);
            const out = grown.data.slice(), base = exclude?.(frame);
            if (base)
                for (let p = 0; p < out.length; p++)
                    out[p] |= base[p] ? 1 : 0;
            return out;
        }
        catch (e_4) {
            env_4.error = e_4;
            env_4.hasError = true;
        }
        finally {
            __disposeResources(env_4);
        }
    };
}
/**
 * Drop cover what lies behind the layer explains: the camera's plate, or `behind` for a plane with planes
 * behind it. A narrow gap of smooth scenery between two pieces of paint holds still in the layer's
 * coordinates while paint crosses its scenery, so motion alone calls it paint, but its pixels show what is
 * behind at their own positions, where paint only matches it by coincidence. A cover pixel is dropped when
 * at least `minimumAgree` frames, and `fraction` of the frames where what is behind is known, match it
 * within `tolerance` codes. `exclude` keeps drawings and nearer planes in front out of the count.
 */
export async function refineRigidCover(source, camera, plate, layer, options = {}) {
    const tolerance = options.tolerance ?? 6, fraction = options.fraction ?? .5, minimumAgree = options.minimumAgree ?? 3;
    const { atlas, path, cover } = layer, { width, height } = source, agree = new Uint16Array(cover.length), known = new Uint16Array(cover.length);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(frame, source.count);
        const rendered = options.behind ? options.behind(frame) : renderPlate(plate, camera, frame), pixels = (await source.frame(frame)).data, offset = frameOffset(path, atlas, frame), skip = options.exclude?.(frame);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const p = y * width + x, a = (y + offset.y) * atlas.width + x + offset.x, q = p * 3;
                if (!cover[a] || !rendered.known[p] || skip?.[p])
                    continue;
                known[a]++;
                const d = Math.max(Math.abs(pixels[q] - rendered.data[q]), Math.abs(pixels[q + 1] - rendered.data[q + 1]), Math.abs(pixels[q + 2] - rendered.data[q + 2]));
                if (d <= tolerance)
                    agree[a]++;
            }
    }
    const refined = cover.slice();
    let dropped = 0;
    for (let a = 0; a < refined.length; a++)
        if (refined[a] && agree[a] >= minimumAgree && agree[a] >= fraction * known[a]) {
            refined[a] = 0;
            dropped++;
        }
    return { ...layer, cover: refined, dropped };
}
/** Where plane `index` of a back-to-front list shows on one frame: its cover, outside every nearer plane's cover and undecided pixels. */
export function planeShown(layers, index, frame) {
    const shown = renderCover(layers[index], frame);
    for (const layer of layers.slice(index + 1)) {
        const nearer = renderCover(layer, frame, true);
        for (let p = 0; p < shown.length; p++)
            if (nearer[p])
                shown[p] = 0;
    }
    return shown;
}
/**
 * Add cover where the layer's content holds still in its own coordinates and what lies behind does not
 * explain it: the inside of a smooth trunk wider than the tests' shifts matches every motion, so no test
 * calls it paint, and it touches the frame's edges, so no hole filling reaches it. Every atlas pixel gets
 * a candidate color, the trimmed mean of the frames where nothing in front hides it (`exclude`); a pixel
 * outside the cover is claimed when at least `minimumFrames` frames saw it, `fraction` of them match the
 * candidate within `tolerance` codes, and what lies behind (the camera plate, or `behind`) misses them by
 * `margin` codes more on average, and it connects to the cover through other claimed pixels.
 */
export async function claimRigidCover(source, camera, plate, layer, options = {}) {
    const tolerance = options.tolerance ?? 6, fraction = options.fraction ?? .7, margin = options.margin ?? 6, minimumFrames = options.minimumFrames ?? 6;
    const { atlas, path, cover } = layer, { width, height } = source, size = cover.length, all = new Uint8Array(size).fill(1);
    const candidate = await buildRigidPlate(source, { ...layer, cover: all }, options.exclude);
    const probe = { ...layer, cover: all, decided: all, plate: candidate, matte: undefined };
    const seen = new Uint16Array(size), agree = new Uint16Array(size), own = new Float32Array(size), missed = new Float32Array(size);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(frame, source.count);
        const behind = options.behind ? options.behind(frame) : renderPlate(plate, camera, frame), mine = renderPlane(probe, frame);
        const pixels = (await source.frame(frame)).data, offset = frameOffset(path, atlas, frame), skip = options.exclude?.(frame);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const p = y * width + x, a = (y + offset.y) * atlas.width + x + offset.x, q = p * 3;
                if (cover[a] || skip?.[p] || mine.unknown[p] || !behind.known[p])
                    continue;
                let e = 0, b = 0;
                for (let c = 0; c < 3; c++) {
                    e = Math.max(e, Math.abs(pixels[q + c] - mine.rgba[p * 4 + c]));
                    b = Math.max(b, Math.abs(pixels[q + c] - behind.data[q + c]));
                }
                seen[a]++;
                own[a] += e;
                missed[a] += b;
                if (e <= tolerance)
                    agree[a]++;
            }
    }
    // Smooth paint is bounded by paint the tests found: a claim grows from the cover, so a candidate alone in
    // a gap, where what lies behind happens to be poorly known, stays out.
    const eligible = new Uint8Array(size), claimed = cover.slice(), decided = layer.decided.slice(), queue = new Int32Array(size);
    for (let a = 0; a < size; a++)
        eligible[a] = Number(!cover[a] && seen[a] >= minimumFrames && agree[a] >= fraction * seen[a] && missed[a] >= own[a] + margin * seen[a]);
    let head = 0, tail = 0;
    const reach = (a) => { if (eligible[a]) {
        eligible[a] = 0;
        claimed[a] = 1;
        decided[a] = 1;
        queue[tail++] = a;
    } };
    for (let a = 0; a < size; a++)
        if (cover[a])
            queue[tail++] = a;
    while (head < tail) {
        const a = queue[head++], x = a % atlas.width;
        if (x > 0)
            reach(a - 1);
        if (x < atlas.width - 1)
            reach(a + 1);
        if (a >= atlas.width)
            reach(a - atlas.width);
        if (a + atlas.width < size)
            reach(a + atlas.width);
    }
    let count = 0;
    for (let a = 0; a < size; a++)
        count += claimed[a] - cover[a];
    return { ...layer, cover: claimed, decided, claimed: count };
}
/** The layer's cover on one frame's pixel grid, at the frame's integer placement; `undecided` also marks pixels nobody decided. */
export function renderCover(layer, frame, undecided = false) {
    const { path, atlas, cover, decided } = layer, { width, height } = path, offset = frameOffset(path, atlas, frame), out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const a = (y + offset.y) * atlas.width + x + offset.x;
            out[y * width + x] = cover[a] || (undecided && !decided[a]) ? 1 : 0;
        }
    return out;
}
/** The layer's paint: a trimmed mean in its own coordinates of every frame pixel under its cover, outside `exclude`. */
export async function buildRigidPlate(source, layer, exclude, options = {}) {
    const margin = options.margin ?? 1;
    const outside = (frame) => {
        const covered = renderCover(layer, frame), extra = exclude?.(frame), mask = new Uint8Array(covered.length);
        for (let p = 0; p < mask.length; p++)
            mask[p] = Number(!covered[p] || !!extra?.[p]);
        return mask;
    };
    const first = plateStatistics(layer.atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(frame, source.count * 2);
        addPlateSamples(first, layer.path, frame, await source.frame(frame), outside(frame), margin);
    }
    const reference = plateReference(first, options.floor ?? 4), trimmed = plateStatistics(layer.atlas);
    for (let frame = 0; frame < source.count; frame++) {
        await options.progress?.(source.count + frame, source.count * 2);
        addPlateSamples(trimmed, layer.path, frame, await source.frame(frame), outside(frame), margin, reference);
    }
    return finishPlate(trimmed);
}
/**
 * Unmix the rim of a rigid layer from what shows behind it. A layer pixel slides over changing scenery,
 * so its observations follow `frame = G + (1 - alpha) * behind` with one premultiplied color G and one
 * alpha for every frame: least squares over the frames gives alpha = 1 - cov(frame, behind) / var(behind)
 * summed over channels. Frames are resampled onto the layer's atlas grid, and the camera plate with them,
 * so every observation of an atlas pixel is the same point of the layer. Pixels within `band` of the
 * cover's edge are solved where the scenery behind them varied by at least `minimumSpread` codes; frames
 * where `exclude` (drawings or nearer planes in front) or an unknown plate touches the pixel are skipped.
 * What is behind is the camera plate unless `behind` renders the farther planes instead.
 */
export async function matteRigidLayer(source, camera, plate, layer, options = {}) {
    const env_5 = { stack: [], error: void 0, hasError: false };
    try {
        const band = options.band ?? 2, minimumSpread = options.minimumSpread ?? 6, minimumFrames = options.minimumFrames ?? 4;
        const { atlas, path, cover } = layer, { width, height } = source, size = atlas.width * atlas.height;
        const edge = new Uint8Array(size);
        for (let y = 1; y < atlas.height - 1; y++)
            for (let x = 1; x < atlas.width - 1; x++) {
                const a = y * atlas.width + x;
                if (cover[a] !== cover[a - 1] || cover[a] !== cover[a + 1] || cover[a] !== cover[a - atlas.width] || cover[a] !== cover[a + atlas.width])
                    edge[a] = 255;
            }
        const edges = __addDisposableResource(env_5, matFromArray(atlas.height, atlas.width, CV_8UC1, edge), false), grown = __addDisposableResource(env_5, new Mat(), false), kernel = __addDisposableResource(env_5, getStructuringElement(MORPH_RECT, { width: 2 * band - 1, height: 2 * band - 1 }), false);
        dilate(edges, grown, kernel);
        const slot = new Int32Array(size).fill(-1), rim = grown.data;
        let slots = 0;
        for (let a = 0; a < size; a++)
            if (rim[a])
                slot[a] = slots++;
        // Per slot: frames, and sums of behind, behind squared (over channels), frame minus behind, and their product.
        const n = new Uint16Array(slots), sb = new Float32Array(slots * 3), sbb = new Float32Array(slots), sy = new Float32Array(slots * 3), syb = new Float32Array(slots);
        for (let frame = 0; frame < source.count; frame++) {
            const env_6 = { stack: [], error: void 0, hasError: false };
            try {
                await options.progress?.(frame, source.count);
                const position = path.positions[frame], offset = frameOffset(path, atlas, frame);
                const behind = options.behind ? options.behind(frame) : renderPlate(plate, camera, frame), skip = options.exclude?.(frame);
                const transform = __addDisposableResource(env_6, matFromArray(2, 3, CV_64FC1, [1, 0, position.dx - Math.round(position.dx), 0, 1, position.dy - Math.round(position.dy)]), false);
                const frameMat = __addDisposableResource(env_6, matFromArray(height, width, CV_32FC3, (await source.frame(frame)).data), false), behindMat = __addDisposableResource(env_6, matFromArray(height, width, CV_32FC3, behind.data), false);
                const warpedFrame = __addDisposableResource(env_6, new Mat(), false), warpedBehind = __addDisposableResource(env_6, new Mat(), false);
                warpAffine(frameMat, warpedFrame, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
                warpAffine(behindMat, warpedBehind, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_REPLICATE);
                const o = warpedFrame.data32F, b = warpedBehind.data32F;
                for (let y = 3; y < height - 3; y++)
                    for (let x = 3; x < width - 3; x++) {
                        const p = y * width + x, k = slot[(y + offset.y) * atlas.width + x + offset.x];
                        if (k < 0 || skip?.[p] || !behind.known[p] || !behind.known[p - 1] || !behind.known[p + 1] || !behind.known[p - width] || !behind.known[p + width])
                            continue;
                        n[k]++;
                        for (let c = 0; c < 3; c++) {
                            const bc = b[p * 3 + c], yc = o[p * 3 + c] - bc;
                            sb[k * 3 + c] += bc;
                            sy[k * 3 + c] += yc;
                            sbb[k] += bc * bc;
                            syb[k] += yc * bc;
                        }
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
        const alpha = new Float32Array(slots).fill(NaN), color = new Float32Array(slots * 3), identified = new Uint8Array(slots);
        let solved = 0;
        for (let k = 0; k < slots; k++) {
            if (n[k] < minimumFrames)
                continue;
            let variance = sbb[k], covariance = syb[k];
            for (let c = 0; c < 3; c++) {
                variance -= sb[k * 3 + c] ** 2 / n[k];
                covariance -= sb[k * 3 + c] * sy[k * 3 + c] / n[k];
            }
            // Spread of the scenery behind, per channel and frame; below it alpha is not identifiable.
            if (variance / (3 * n[k]) < minimumSpread ** 2)
                continue;
            alpha[k] = Math.min(1, Math.max(0, -covariance / variance));
            identified[k] = 1;
            solved++;
        }
        // Over scenery that barely changes any alpha recomposes the same frames once its color is solved against
        // the mean behind, so it borrows the mean of identified alphas within two pixels, or the cover's.
        for (let a = 0; a < size; a++) {
            const k = slot[a];
            if (k < 0 || n[k] < minimumFrames || identified[k])
                continue;
            const x = a % atlas.width, y = (a - x) / atlas.width;
            let sum = 0, count = 0;
            for (let yy = Math.max(0, y - 2); yy <= Math.min(atlas.height - 1, y + 2); yy++)
                for (let xx = Math.max(0, x - 2); xx <= Math.min(atlas.width - 1, x + 2); xx++) {
                    const j = slot[yy * atlas.width + xx];
                    if (j >= 0 && identified[j]) {
                        sum += alpha[j];
                        count++;
                    }
                }
            alpha[k] = count ? sum / count : cover[a];
        }
        for (let k = 0; k < slots; k++)
            if (alpha[k] >= 0)
                for (let c = 0; c < 3; c++)
                    color[k * 3 + c] = (sy[k * 3 + c] + alpha[k] * sb[k * 3 + c]) / n[k];
        return { slot, alpha, color, identified, solved };
    }
    catch (e_6) {
        env_5.error = e_6;
        env_5.hasError = true;
    }
    finally {
        __disposeResources(env_5);
    }
}
/** Premultiplied RGBA of a layer on its atlas, and 255 where what it contributes is unknown; rebuilt when its plate or matte is replaced. */
const layerImages = new WeakMap();
function layerImage(layer) {
    const cached = layerImages.get(layer.cover);
    if (cached && cached.plate === layer.plate && cached.matte === layer.matte)
        return cached;
    const { cover, decided, matte, plate } = layer, size = cover.length, rgba = new Float32Array(size * 4), unknown = new Uint8Array(size);
    for (let a = 0; a < size; a++) {
        const k = matte ? matte.slot[a] : -1;
        if (k >= 0 && matte.alpha[k] >= 0) {
            for (let c = 0; c < 3; c++)
                rgba[a * 4 + c] = matte.color[k * 3 + c];
            rgba[a * 4 + 3] = matte.alpha[k];
        }
        else if (cover[a]) {
            if (!plate?.count[a]) {
                unknown[a] = 255;
                continue;
            }
            for (let c = 0; c < 3; c++)
                rgba[a * 4 + c] = plate.data[a * 3 + c];
            rgba[a * 4 + 3] = 1;
        }
        else if (!decided[a])
            unknown[a] = 255;
    }
    const image = { plate, matte, rgba, unknown };
    layerImages.set(cover, image);
    return image;
}
/**
 * One plane alone on a frame's pixel grid, as `renderScene` places it: premultiplied color and alpha
 * (four per pixel), resampled at its sub-pixel position, and 255 in `unknown` where what it contributes is
 * not known (paint never observed, or a pixel nobody decided). Needs the plane's plate.
 */
export function renderPlane(layer, frame) {
    const env_7 = { stack: [], error: void 0, hasError: false };
    try {
        const { rgba, unknown } = layerImage(layer), { atlas } = layer, { width, height } = layer.path, position = layer.path.positions[frame];
        const transform = __addDisposableResource(env_7, matFromArray(2, 3, CV_64FC1, [1, 0, -(position.dx + atlas.x), 0, 1, -(position.dy + atlas.y)]), false);
        const image = __addDisposableResource(env_7, matFromArray(atlas.height, atlas.width, CV_32FC4, rgba), false), warped = __addDisposableResource(env_7, new Mat(), false);
        warpAffine(image, warped, transform, { width, height }, INTER_CUBIC | WARP_INVERSE_MAP, BORDER_CONSTANT, [0, 0, 0, 0]);
        // Cubic taps reach two atlas pixels, as in `renderPlate`.
        const holes = __addDisposableResource(env_7, matFromArray(atlas.height, atlas.width, CV_8UC1, unknown), false), grown = __addDisposableResource(env_7, new Mat(), false), sampled = __addDisposableResource(env_7, new Mat(), false);
        const kernel = __addDisposableResource(env_7, getStructuringElement(MORPH_ELLIPSE, { width: 5, height: 5 }), false);
        dilate(holes, grown, kernel);
        warpAffine(grown, sampled, transform, { width, height }, INTER_NEAREST | WARP_INVERSE_MAP, BORDER_CONSTANT, [255, 255, 255, 255]);
        return { rgba: warped.data32F.slice(), unknown: sampled.data.slice() };
    }
    catch (e_7) {
        env_7.error = e_7;
        env_7.hasError = true;
    }
    finally {
        __disposeResources(env_7);
    }
}
/**
 * The scene without its drawings: the camera plate with the rigid layers composited over it in order,
 * back to front, each resampled at its sub-pixel position as premultiplied color and alpha: its plate
 * where it covers, and its matte, when solved, on its rim. A pixel is unknown where a layer's contribution
 * is (paint never observed, or a pixel nobody decided), or where it is not opaque and what is behind is.
 */
export function renderScene(plate, camera, layers, frame) {
    const out = renderPlate(plate, camera, frame), { width, height } = camera;
    for (const layer of layers) {
        if (!layer.plate)
            continue;
        const { rgba: w, unknown: gap } = renderPlane(layer, frame);
        for (let p = 0; p < width * height; p++) {
            const a = Math.min(1, Math.max(0, w[p * 4 + 3]));
            if (gap[p]) {
                out.known[p] = 0;
                continue;
            }
            if (a < 1e-3)
                continue;
            for (let c = 0; c < 3; c++)
                out.data[p * 3 + c] = w[p * 4 + c] + (1 - a) * out.data[p * 3 + c];
            if (a > .999)
                out.known[p] = 1;
        }
    }
    return out;
}
