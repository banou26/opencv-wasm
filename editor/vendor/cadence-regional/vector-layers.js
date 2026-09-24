import { poolVectorModes } from "./vector-modes.js";
const median = (values) => {
    values.sort((a, b) => a - b);
    const middle = values.length >> 1;
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};
function gridsFor(sequence) {
    const { width, height, frameCount, pairs } = sequence;
    if (![width, height, frameCount].every(Number.isSafeInteger) || width < 1 || height < 1 || frameCount < 2
        || pairs.length !== frameCount - 1)
        throw new RangeError('Expected one contiguous vector-candidate scene');
    let size = 0;
    return pairs.map((pair, frame) => {
        if (pair.frame !== frame || pair.flow.width !== width || pair.flow.height !== height || pair.grids.length !== 1) {
            throw new RangeError('Vector grouping requires exactly one candidate grid per ordered pair');
        }
        const grid = pair.grids[0];
        if (!Number.isSafeInteger(grid.cellSize) || grid.cellSize < 1 || (size && size !== grid.cellSize)
            || grid.columns !== Math.ceil(width / grid.cellSize) || grid.rows !== Math.ceil(height / grid.cellSize)
            || grid.cells.length !== grid.columns * grid.rows)
            throw new RangeError('Invalid candidate grid geometry');
        size = grid.cellSize;
        for (const [i, cell] of grid.cells.entries()) {
            const x = i % grid.columns * size, y = Math.floor(i / grid.columns) * size;
            if (cell.x !== x || cell.y !== y || cell.width !== Math.min(size, width - x) || cell.height !== Math.min(size, height - y)
                || !Number.isSafeInteger(cell.accepted) || cell.accepted < 0 || cell.accepted > cell.width * cell.height
                || !Number.isFinite(cell.coverage) || cell.coverage < 0 || cell.coverage > 1
                || (cell.dx === null) !== (cell.dy === null)
                || (cell.dx !== null && (!Number.isFinite(cell.dx) || !Number.isFinite(cell.dy)
                    || cell.spread === null || !Number.isFinite(cell.spread) || cell.spread < 0 || cell.accepted < 1))
                || (cell.coherent && cell.dx === null))
                throw new RangeError('Invalid candidate cell');
        }
        return grid;
    });
}
/** All measured candidates survive here, including internally mixed cells. No spatial filling. */
function trajectories(grids, raw, width, height) {
    const tracks = [];
    let previous = new Map();
    for (const [frame, grid] of grids.entries()) {
        const next = new Map();
        for (const [cellIndex, cell] of grid.cells.entries()) {
            if (cell.dx === null || cell.dy === null)
                continue;
            const arrival = previous.get(cellIndex);
            const inherited = arrival?.track.samples.at(-1)?.consensus === cell.coherent ? arrival : undefined;
            const track = inherited?.track ?? { id: tracks.length, group: null, samples: [] };
            if (!inherited)
                tracks.push(track);
            const original = raw[frame].cells[cellIndex];
            track.samples.push({ frame, cell: cellIndex, dx: original.dx, dy: original.dy, coherent: original.coherent,
                consensus: cell.coherent, modelDx: cell.dx, modelDy: cell.dy });
            const x = (inherited?.x ?? cell.x + cell.width / 2) + cell.dx;
            const y = (inherited?.y ?? cell.y + cell.height / 2) + cell.dy;
            if (x < 0 || y < 0 || x >= width || y >= height)
                continue;
            const slot = Math.floor(y / grid.cellSize) * grid.columns + Math.floor(x / grid.cellSize);
            // A converging grid mapping is not enough to choose which drawing survived.
            next.set(slot, next.has(slot) ? null : { track, x, y });
        }
        previous = next;
    }
    return tracks;
}
/**
 * Direct whole-scene velocity proposals. There is no spatial-region grouping or
 * support completion. Coherent multi-pair trajectories build bounded velocity
 * profiles; short/mixed histories can attach, but cannot change those profiles.
 * Identical motion still cannot distinguish different co-moving drawings.
 */
export function groupVectorCandidates(sequence, options = {}) {
    const tolerance = options.tolerance ?? .75, minimumOverlap = options.minimumOverlap ?? 4;
    const modeRadius = options.modeRadius ?? .75, minimumModeCells = options.minimumModeCells ?? 4;
    if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isSafeInteger(minimumOverlap) || minimumOverlap < 2
        || !Number.isFinite(modeRadius) || modeRadius < 0 || !Number.isSafeInteger(minimumModeCells) || minimumModeCells < 1) {
        throw new RangeError('Invalid vector grouping tolerance or minimum overlap');
    }
    const raw = gridsFor(sequence), { width, height, frameCount } = sequence, cellSize = raw[0].cellSize;
    const grids = modeRadius ? raw.map(grid => poolVectorModes(grid, { tolerance: modeRadius, minimumCells: minimumModeCells })) : raw;
    const tracks = trajectories(grids, raw, width, height), profiles = [];
    const modelSample = (sample) => ({ ...sample, dx: sample.modelDx, dy: sample.modelDy });
    const strong = tracks.map(track => track.samples.filter(sample => sample.consensus).map(modelSample));
    // A fixed representative at each profile/time gives a cheap candidate index.
    // Exact comparisons below still inspect every shared reliable observation.
    const bins = new Map();
    const key = (frame, x, y) => `${frame}:${x}:${y}`;
    const proposals = (samples, minimum) => {
        const counts = new Map();
        for (const sample of samples) {
            const x = Math.floor(sample.dx / tolerance), y = Math.floor(sample.dy / tolerance);
            for (let j = -1; j <= 1; j++)
                for (let i = -1; i <= 1; i++) {
                    for (const id of bins.get(key(sample.frame, x + i, y + j)) ?? [])
                        counts.set(id, (counts.get(id) ?? 0) + 1);
                }
        }
        return [...counts].filter(([, count]) => count >= minimum).map(([id]) => id).sort((a, b) => a - b);
    };
    const fits = (samples, profile, minimum) => {
        let overlap = 0;
        for (const sample of samples) {
            const bounds = profile.get(sample.frame);
            if (!bounds)
                continue;
            overlap++;
            // Bounding corners conservatively prevent a chain of near-matches from
            // accumulating into a group containing contradictory reliable velocities.
            const dx = Math.max(sample.dx, bounds.maxX) - Math.min(sample.dx, bounds.minX);
            const dy = Math.max(sample.dy, bounds.maxY) - Math.min(sample.dy, bounds.minY);
            if (Math.hypot(dx, dy) > tolerance + 1e-9)
                return false;
        }
        return overlap >= minimum;
    };
    const bestMatches = (samples, minimum) => {
        const matches = proposals(samples, minimum).filter(id => fits(samples, profiles[id], minimum));
        // A tiny profile observed only during a shared hold cannot outweigh a
        // compatible profile explaining the entire trajectory. Equal support is
        // genuinely ambiguous; there is no nearest-position or nearest-speed tie.
        const overlap = matches.map(id => samples.reduce((sum, sample) => sum + Number(profiles[id].has(sample.frame)), 0));
        const maximum = Math.max(0, ...overlap);
        return matches.filter((_, i) => overlap[i] === maximum);
    };
    const extend = (id, samples) => {
        const profile = profiles[id];
        for (const sample of samples) {
            const bounds = profile.get(sample.frame);
            if (bounds) {
                bounds.minX = Math.min(bounds.minX, sample.dx);
                bounds.maxX = Math.max(bounds.maxX, sample.dx);
                bounds.minY = Math.min(bounds.minY, sample.dy);
                bounds.maxY = Math.max(bounds.maxY, sample.dy);
            }
            else {
                profile.set(sample.frame, { minX: sample.dx, maxX: sample.dx, minY: sample.dy, maxY: sample.dy, x: sample.dx, y: sample.dy });
                const k = key(sample.frame, Math.floor(sample.dx / tolerance), Math.floor(sample.dy / tolerance));
                if (!bins.has(k))
                    bins.set(k, new Set());
                bins.get(k).add(id);
            }
        }
    };
    const ordered = tracks.filter(track => strong[track.id].length >= minimumOverlap)
        .sort((a, b) => strong[b.id].length - strong[a.id].length || a.id - b.id);
    for (const track of ordered) {
        const samples = strong[track.id];
        const matches = bestMatches(samples, minimumOverlap);
        if (matches.length > 1)
            continue;
        const id = matches[0] ?? profiles.length;
        if (id === profiles.length)
            profiles.push(new Map());
        extend(id, samples);
    }
    const frames = grids.map((grid, frame) => ({ frame,
        labels: new Int32Array(grid.cells.length).fill(-1), confidence: new Uint8Array(grid.cells.length), observations: [] }));
    const members = profiles.map(() => 0);
    // Re-evaluate against the complete frozen models: a later discovered motion
    // can make a formerly unique short/held match ambiguous. No label feedback.
    for (const track of tracks) {
        const reliable = strong[track.id], samples = reliable.length ? reliable : track.samples;
        const required = Math.min(minimumOverlap, samples.length);
        const matches = bestMatches(samples, required);
        const id = matches.length === 1 ? matches[0] : null;
        track.group = id;
        if (id !== null)
            members[id]++;
        for (const sample of track.samples) {
            const out = frames[sample.frame], bounds = id === null ? undefined : profiles[id].get(sample.frame);
            if (id === null) {
                out.confidence[sample.cell] = matches.length > 1 ? 3 : 4;
                continue;
            }
            // Mixed samples never extend a model across a time at which it has no
            // reliable evidence, even when another part of this trajectory matched.
            if (!bounds || !fits([sample.consensus ? modelSample(sample) : sample], profiles[id], 1)) {
                out.confidence[sample.cell] = 4;
                continue;
            }
            out.labels[sample.cell] = id;
            out.confidence[sample.cell] = sample.consensus && reliable.length >= minimumOverlap ? 2 : 1;
        }
    }
    for (const frame of frames) {
        const groups = new Map();
        for (const [cell, id] of frame.labels.entries())
            if (id >= 0) {
                if (!groups.has(id))
                    groups.set(id, []);
                groups.get(id).push(cell);
            }
        frame.observations = [...groups].sort(([a], [b]) => a - b).map(([id, cells]) => ({ id, cells,
            dx: median(cells.map(cell => grids[frame.frame].cells[cell].dx)),
            dy: median(cells.map(cell => grids[frame.frame].cells[cell].dy)),
            strongCells: cells.filter(cell => frame.confidence[cell] === 2).length, }));
    }
    return { width, height, frameCount, cellSize, options: { tolerance, minimumOverlap, modeRadius, minimumModeCells },
        groups: profiles.map((profile, id) => ({ id, trackCount: members[id], observedPairs: profile.size })), frames, tracks };
}
