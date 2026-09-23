import { estimateDenseMotion, poolMotion } from "./flow.js";
import { measureDrawingEvent, summarizeTiming } from "./timing.js";
export const REGIONAL_SCALES = [96, 48, 24, 12, 8];
/** Single pair entry point for browser workers that yield between measurements. */
export function analyzeMotionPair(a, b, frame, options = {}) {
    if (!Number.isSafeInteger(frame) || frame < 0)
        throw new RangeError('Pair frame must be a nonnegative integer');
    const flow = estimateDenseMotion(a, b, options);
    return { frame, flow, grids: (options.cellSizes ?? REGIONAL_SCALES).map(size => poolMotion(flow, size)) };
}
/** Whole-shot forward fields. Analysis pixels only; never alters source artwork. */
export function analyzeMotionPairs(frames, options = {}) {
    if (frames.length < 2)
        throw new RangeError('Regional analysis needs at least two frames');
    const { width, height } = frames[0];
    if (frames.some(f => f.width !== width || f.height !== height || f.data.length !== width * height * 3)) {
        throw new RangeError('Regional scene frame dimensions must match');
    }
    const pairs = [];
    for (let frame = 0; frame < frames.length - 1; frame++) {
        pairs.push(analyzeMotionPair(frames[frame], frames[frame + 1], frame, options));
        options.onProgress?.(frame + 1, frames.length - 1);
    }
    return { width, height, frameCount: frames.length, pairs };
}
/** Alternative poolings share their flow measurements; scales are not independent votes. */
export function poolMotionSequence(sequence, scales = REGIONAL_SCALES) {
    if (!scales.length || scales.some(s => !Number.isSafeInteger(s) || s < 1))
        throw new RangeError('At least one positive cell size is required');
    return { ...sequence, pairs: sequence.pairs.map(pair => ({ ...pair, grids: scales.map(size => poolMotion(pair.flow, size)) })) };
}
function median(values) {
    values.sort((a, b) => a - b);
    const n = values.length;
    return n % 2 ? values[n >> 1] : (values[n / 2 - 1] + values[n / 2]) / 2;
}
/** Smallest spatial pooling is the support lattice, never a pixel-accurate silhouette. */
export function regionalFineGrid(pair) {
    if (!pair.grids.length)
        throw new RangeError('Pool regional motion before tracking');
    return pair.grids.reduce((a, b) => a.cellSize < b.cellSize ? a : b);
}
/**
 * Advect supported sites, then join spatial neighbors only when their overlapping
 * whole-shot motion histories agree. A shared held frame cannot merge identities.
 * Co-moving artwork is deliberately unresolved: motion alone cannot identify it.
 */
export function trackRegionalMotion(sequence, options = {}) {
    const tolerance = options.tolerance ?? .75, minimumOverlap = options.minimumOverlap ?? 4, minimumCells = options.minimumCells ?? 4;
    if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isSafeInteger(minimumOverlap) || minimumOverlap < 2
        || !Number.isSafeInteger(minimumCells) || minimumCells < 1) {
        throw new RangeError('Invalid temporal grouping tolerance or overlap');
    }
    const { width, height, frameCount, pairs } = sequence;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || !Number.isSafeInteger(frameCount) || frameCount < 2)
        throw new RangeError('Invalid regional scene geometry');
    if (pairs.length !== frameCount - 1 || !pairs.length || pairs.some((p, i) => p.frame !== i))
        throw new RangeError('Motion pairs must cover one contiguous scene');
    const grids = pairs.map(regionalFineGrid), cellSize = grids[0].cellSize;
    for (const pair of pairs)
        for (const grid of pair.grids) {
            if (!Number.isSafeInteger(grid.cellSize) || grid.cellSize < 1 || grid.columns !== Math.ceil(width / grid.cellSize)
                || grid.rows !== Math.ceil(height / grid.cellSize) || grid.cells.length !== grid.columns * grid.rows)
                throw new RangeError('Invalid regional grid geometry');
            for (const [i, cell] of grid.cells.entries()) {
                const x = i % grid.columns * grid.cellSize, y = Math.floor(i / grid.columns) * grid.cellSize;
                if (cell.x !== x || cell.y !== y || cell.width !== Math.min(grid.cellSize, width - x)
                    || cell.height !== Math.min(grid.cellSize, height - y)
                    || (cell.coherent && (cell.dx === null || cell.dy === null || !Number.isFinite(cell.dx) || !Number.isFinite(cell.dy)))) {
                    throw new RangeError('Invalid regional cell geometry or coherent motion');
                }
            }
        }
    if (grids.some(g => g.cellSize !== cellSize))
        throw new RangeError('Tracking grid geometry must be stable');
    const tracks = [], owners = [];
    let previous = new Map();
    for (const [frame, grid] of grids.entries()) {
        const owner = new Int32Array(grid.cells.length).fill(-1);
        const next = new Map();
        for (const [cellIndex, cell] of grid.cells.entries()) {
            if (!cell.coherent || cell.dx === null || cell.dy === null)
                continue;
            const inherited = previous.get(cellIndex);
            const track = inherited?.track ?? { id: tracks.length, group: null, samples: [] };
            if (!inherited)
                tracks.push(track);
            const x = inherited?.x ?? cell.x + cell.width / 2, y = inherited?.y ?? cell.y + cell.height / 2;
            track.samples.push({ frame, cell: cellIndex, x, y, dx: cell.dx, dy: cell.dy });
            owner[cellIndex] = track.id;
            const nx = x + cell.dx, ny = y + cell.dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                continue;
            const col = Math.floor(nx / cellSize), row = Math.floor(ny / cellSize), slot = row * grid.columns + col;
            // A many-to-one cell collision does not identify which artwork survived.
            // End both histories instead of choosing a cosmetically stable identity.
            next.set(slot, next.has(slot) ? null : { track, x: nx, y: ny });
        }
        owners.push(owner);
        previous = next;
    }
    const edges = new Set();
    const edge = (a, b) => {
        if (a >= 0 && b >= 0 && a !== b)
            edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    };
    for (const [frame, grid] of grids.entries()) {
        const owner = owners[frame];
        for (let i = 0; i < owner.length; i++)
            if (owner[i] >= 0) {
                if (i % grid.columns)
                    edge(owner[i], owner[i - 1]);
                if (i >= grid.columns)
                    edge(owner[i], owner[i - grid.columns]);
            }
        // Coarse coherent cells propose links across texture holes. Every proposed
        // link must still pass the same temporal test; coarse majorities cannot vote
        // away small independently moving regions.
        for (const coarse of pairs[frame].grids) {
            if (coarse.cellSize === cellSize)
                continue;
            const anchors = new Int32Array(coarse.cells.length).fill(-1);
            for (const [i, cell] of grid.cells.entries())
                if (owner[i] >= 0) {
                    const slot = Math.floor((cell.y + cell.height / 2) / coarse.cellSize) * coarse.columns
                        + Math.floor((cell.x + cell.width / 2) / coarse.cellSize);
                    const parent = coarse.cells[slot];
                    if (!parent?.coherent || parent.dx === null || parent.dy === null
                        || Math.hypot(cell.dx - parent.dx, cell.dy - parent.dy) > tolerance)
                        continue;
                    edge(anchors[slot], owner[i]);
                    anchors[slot] = owner[i];
                }
        }
    }
    const samples = tracks.map(t => new Map(t.samples.map(s => [s.frame, s])));
    const candidates = [];
    for (const key of edges) {
        const [a, b] = key.split(':').map(Number);
        let overlap = 0, error = 0, maximum = 0;
        for (const sample of tracks[a].samples) {
            const other = samples[b].get(sample.frame);
            if (!other)
                continue;
            const delta = Math.hypot(sample.dx - other.dx, sample.dy - other.dy);
            overlap++;
            error += delta;
            maximum = Math.max(maximum, delta);
        }
        if (overlap >= minimumOverlap && maximum <= tolerance)
            candidates.push({ a, b, error: error / overlap, overlap });
    }
    candidates.sort((a, b) => a.error - b.error || b.overlap - a.overlap || a.a - b.a || a.b - b.b);
    const roots = tracks.map(t => t.id), sizes = tracks.map(() => 1);
    const profiles = tracks.map(t => new Map(t.samples.map(s => [s.frame, { minX: s.dx, maxX: s.dx, minY: s.dy, maxY: s.dy }])));
    const root = (id) => {
        let r = id;
        while (roots[r] !== r)
            r = roots[r];
        while (roots[id] !== id) {
            const next = roots[id];
            roots[id] = r;
            id = next;
        }
        return r;
    };
    for (const candidate of candidates) {
        let a = root(candidate.a), b = root(candidate.b);
        if (a === b)
            continue;
        if (sizes[a] < sizes[b])
            [a, b] = [b, a];
        let compatible = true;
        for (const [frame, p] of profiles[b]) {
            const q = profiles[a].get(frame);
            if (q && Math.hypot(Math.max(p.maxX, q.maxX) - Math.min(p.minX, q.minX), Math.max(p.maxY, q.maxY) - Math.min(p.minY, q.minY)) > tolerance) {
                compatible = false;
                break;
            }
        }
        if (!compatible)
            continue;
        roots[b] = a;
        sizes[a] += sizes[b];
        for (const [frame, p] of profiles[b]) {
            const q = profiles[a].get(frame);
            profiles[a].set(frame, q ? { minX: Math.min(p.minX, q.minX), maxX: Math.max(p.maxX, q.maxX),
                minY: Math.min(p.minY, q.minY), maxY: Math.max(p.maxY, q.maxY) } : p);
        }
        profiles[b].clear();
    }
    const members = new Map();
    for (const track of tracks)
        if (track.samples.length >= minimumOverlap) {
            const r = root(track.id), group = members.get(r) ?? [];
            group.push(track.id);
            members.set(r, group);
        }
    // A lone surviving feature is a track, not a layer hypothesis. Preserve such
    // tracklets as unassigned instead of displaying hundreds of one-cell layers.
    const spatiallySupported = [...members.values()].filter(ids => {
        const counts = new Uint32Array(pairs.length);
        for (const id of ids)
            for (const sample of tracks[id].samples)
                counts[sample.frame]++;
        let supportedFrames = 0;
        for (const count of counts)
            if (count >= minimumCells)
                supportedFrames++;
        return supportedFrames >= minimumOverlap;
    });
    const groups = spatiallySupported.sort((a, b) => a[0] - b[0]).map((trackIds, i) => ({ id: i + 1, trackIds }));
    for (const group of groups)
        for (const id of group.trackIds)
            tracks[id].group = group.id;
    const frames = grids.map((grid, frame) => {
        const assigned = new Map();
        for (const [cell, id] of owners[frame].entries()) {
            const group = id >= 0 ? tracks[id].group : null;
            if (group === null)
                continue;
            const cells = assigned.get(group) ?? [];
            cells.push(cell);
            assigned.set(group, cells);
        }
        const observations = [...assigned].map(([id, cells]) => {
            const dx = median(cells.map(i => grid.cells[i].dx)), dy = median(cells.map(i => grid.cells[i].dy));
            const errors = cells.map(i => Math.hypot(grid.cells[i].dx - dx, grid.cells[i].dy - dy)).sort((a, b) => a - b);
            return { id, cells, dx, dy, spread: errors[Math.ceil(errors.length * .9) - 1] };
        }).sort((a, b) => a.id - b.id);
        return { frame, observations };
    });
    return { width, height, frameCount, cellSize, tracks, groups, frames };
}
const unknownTiming = (reason) => ({
    status: 'unknown', compared: 0, changed: 0, changedFraction: null, error: null, noise: null, reason,
});
const unobservedGroup = (id) => ({
    id, cells: [], dx: 0, dy: 0, spread: 0, event: unknownTiming('group-unobserved'),
});
/** Current flow validity cannot decide which appearance pixels are allowed to change. */
export function analyzeRegionalTimingFrame(a, b, pair, observations, context = {}) {
    const grid = regionalFineGrid(pair), { width, height } = a;
    if (b.width !== width || b.height !== height || a.data.length !== width * height * 3 || b.data.length !== a.data.length ||
        pair.flow.width !== width || pair.flow.height !== height)
        throw new RangeError('Regional timing frame geometry differs');
    if (context.previous && context.previous.pair.frame !== pair.frame - 1)
        throw new RangeError('Previous timing support must come from the adjacent pair');
    const current = new Map(observations.map(o => [o.id, o])), prior = new Map(context.previous?.observations.map(o => [o.id, o]) ?? []);
    if (current.size !== observations.length)
        throw new RangeError('Regional observation IDs must be unique');
    const owners = new Int32Array(grid.cells.length).fill(-1);
    for (const observation of observations)
        for (const cell of observation.cells) {
            if (!Number.isSafeInteger(cell) || cell < 0 || cell >= owners.length)
                throw new RangeError('Regional observation refers to a missing cell');
            owners[cell] = owners[cell] === -1 || owners[cell] === observation.id ? observation.id : -2;
        }
    const ids = [...new Set([...(context.groupIds ?? []), ...current.keys(), ...prior.keys()])].sort((x, y) => x - y);
    const priorGrid = context.previous ? regionalFineGrid(context.previous.pair) : undefined;
    const measured = ids.map(id => {
        const observation = current.get(id), previous = prior.get(id);
        if (!observation)
            return unobservedGroup(id);
        if (!observation.cells.length || ![observation.dx, observation.dy].every(Number.isFinite))
            throw new RangeError('Regional observation needs finite supported motion');
        if (!previous || !priorGrid)
            return { ...observation, event: unknownTiming('no-independent-prior-support') };
        if (![previous.dx, previous.dy].every(Number.isFinite))
            throw new RangeError('Prior regional observation needs finite motion');
        const rectangles = [];
        for (const i of observation.cells) {
            const cell = grid.cells[i];
            if (!cell)
                throw new RangeError('Regional observation refers to a missing cell');
            rectangles.push(cell);
        }
        let expected = 0, clipped = 0, competing = false;
        for (const i of previous.cells) {
            const cell = priorGrid.cells[i];
            if (!cell)
                throw new RangeError('Previous regional observation refers to a missing cell');
            const x = cell.x + previous.dx, y = cell.y + previous.dy;
            rectangles.push({ x, y, width: cell.width, height: cell.height });
            expected += cell.width * cell.height;
            clipped += Math.max(0, Math.min(width, x + cell.width) - Math.max(0, x)) * Math.max(0, Math.min(height, y + cell.height) - Math.max(0, y));
            const cx = x + cell.width / 2, cy = y + cell.height / 2;
            if (cx < 0 || cy < 0 || cx >= width || cy >= height)
                continue;
            const slot = Math.floor(cy / grid.cellSize) * grid.columns + Math.floor(cx / grid.cellSize);
            if (owners[slot] !== -1 && owners[slot] !== id)
                competing = true;
        }
        if (!expected || clipped < expected * .8)
            return { ...observation, event: unknownTiming('transported-support-clipped') };
        if (competing)
            return { ...observation, event: unknownTiming('transported-support-conflicts-with-another-group') };
        let x0 = Math.min(...rectangles.map(r => r.x)), y0 = Math.min(...rectangles.map(r => r.y));
        let x1 = Math.max(...rectangles.map(r => r.x + r.width)), y1 = Math.max(...rectangles.map(r => r.y + r.height));
        x0 = Math.max(0, Math.floor(x0 + Math.min(0, observation.dx)) - 3);
        y0 = Math.max(0, Math.floor(y0 + Math.min(0, observation.dy)) - 3);
        x1 = Math.min(width, Math.ceil(x1 + Math.max(0, observation.dx)) + 3);
        y1 = Math.min(height, Math.ceil(y1 + Math.max(0, observation.dy)) + 3);
        const w = x1 - x0, h = y1 - y0;
        if (w < 5 || h < 5)
            return { ...observation, event: unknownTiming('insufficient-transported-support') };
        const mask = new Uint8Array(w * h);
        for (const r of rectangles) {
            const left = Math.max(x0, Math.floor(r.x)), right = Math.min(x1, Math.ceil(r.x + r.width));
            for (let y = Math.max(y0, Math.floor(r.y)); y < Math.min(y1, Math.ceil(r.y + r.height)); y++) {
                mask.fill(255, (y - y0) * w + left - x0, (y - y0) * w + right - x0);
            }
        }
        const crop = (source) => {
            const data = new Uint8Array(w * h * 3);
            for (let y = 0; y < h; y++)
                data.set(source.data.subarray(((y0 + y) * width + x0) * 3, ((y0 + y) * width + x1) * 3), y * w * 3);
            return { width: w, height: h, data };
        };
        const event = measureDrawingEvent(crop(a), crop(b), { width: w, height: h, mask }, observation);
        return { ...observation, event };
    });
    return { frame: pair.frame, observations: measured };
}
/** Finalize explicit pair events without inventing timing across missing evidence. */
export function finishRegionalTiming(frames, groupIds) {
    const normalized = frames.map(f => ({ ...f, observations: groupIds.map(id => f.observations.find(o => o.id === id) ?? unobservedGroup(id)) }));
    return { frames: normalized, groups: groupIds.map(id => ({ id, timing: summarizeTiming(normalized.map(f => ({
                frame: f.frame + 1, event: f.observations.find(o => o.id === id).event,
            }))) })) };
}
/** Compare group interiors under one robust translation, not the dense deformation. */
export function analyzeRegionalTiming(frames, sequence, tracks, onProgress) {
    if (frames.length !== sequence.frameCount || tracks.frameCount !== sequence.frameCount)
        throw new RangeError('Regional timing frame counts differ');
    const result = tracks.frames.map(({ frame, observations }) => {
        const measured = analyzeRegionalTimingFrame(frames[frame], frames[frame + 1], sequence.pairs[frame], observations, {
            previous: frame ? { pair: sequence.pairs[frame - 1], observations: tracks.frames[frame - 1].observations } : undefined,
            groupIds: tracks.groups.map(g => g.id),
        });
        onProgress?.(frame + 1, tracks.frames.length);
        return measured;
    });
    return finishRegionalTiming(result, tracks.groups.map(g => g.id));
}
