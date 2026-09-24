import { poolVectorModes } from "./vector-modes.js";
import { spatialIslands } from "./vector-proximity.js";
const median = (values) => {
    values.sort((a, b) => a - b);
    const middle = values.length >> 1;
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};
const center = (cells, raw) => ({ cells,
    dx: median(cells.map(index => raw[index].dx)), dy: median(cells.map(index => raw[index].dy)) });
const order = (a, b) => b.cells.length - a.cells.length || a.dx - b.dx || a.dy - b.dy;
const withinRadius = (group, raw, tolerance) => group.cells.every(index => Math.hypot(raw[index].dx - group.dx, raw[index].dy - group.dy) <= tolerance + 1e-9);
function coarseClusters(grid, tolerance, included) {
    // The arrows already passed measurement acceptance. Even a mixed median or
    // singleton is a valid first-pass proposal; neither needs a temporal witness.
    const modes = poolVectorModes({ ...grid, cells: grid.cells.map((cell, index) => included && !included.has(index)
            ? { ...cell, dx: null, dy: null, coherent: false } : { ...cell, coherent: cell.dx !== null }) }, { tolerance, minimumCells: 1 });
    const grouped = new Map(), remaining = [];
    for (const [index, cell] of modes.cells.entries()) {
        if (cell.dx === null)
            continue;
        if (!cell.coherent) {
            remaining.push(index);
            continue;
        }
        const key = `${cell.dx}:${cell.dy}`;
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(index);
    }
    const clusters = [...grouped.values()].map(cells => center(cells, grid.cells)).sort(order);
    remaining.sort((a, b) => grid.cells[a].dx - grid.cells[b].dx || grid.cells[a].dy - grid.cells[b].dy);
    for (const index of remaining) {
        let choice = -1, distance = Infinity, replacement;
        for (const [i, group] of clusters.entries()) {
            const error = Math.hypot(grid.cells[index].dx - group.dx, grid.cells[index].dy - group.dy);
            if (error > tolerance * 2 || error >= distance)
                continue;
            const next = center([...group.cells, index], grid.cells);
            if (withinRadius(next, grid.cells, tolerance)) {
                choice = i;
                distance = error;
                replacement = next;
            }
        }
        if (replacement)
            clusters[choice] = replacement;
        else
            clusters.push(center([index], grid.cells));
    }
    // Refinement can leave neighboring proposals. Merge only if every original
    // vector fits the final median: a chain of close vectors cannot grow forever.
    let merged = true;
    while (merged) {
        merged = false;
        clusters.sort(order);
        outer: for (let a = 0; a < clusters.length; a++)
            for (let b = a + 1; b < clusters.length; b++) {
                if (Math.hypot(clusters[a].dx - clusters[b].dx, clusters[a].dy - clusters[b].dy) > tolerance * 2)
                    continue;
                const next = center([...clusters[a].cells, ...clusters[b].cells], grid.cells);
                if (!withinRadius(next, grid.cells, tolerance))
                    continue;
                clusters[a] = next;
                clusters.splice(b, 1);
                merged = true;
                break outer;
            }
    }
    return clusters.sort(order);
}
function splitTightCore(group, grid, tolerance, width, height) {
    const strong = group.cells.filter(index => grid.cells[index].coherent);
    if (strong.length < 12)
        return [group];
    const dominant = center(strong, grid.cells);
    const residual = (index) => Math.hypot(grid.cells[index].dx - dominant.dx, grid.cells[index].dy - dominant.dy);
    // A broad velocity radius is not a noise estimate. Protect a tightly measured
    // dominant motion, using the same minimum image-relative displacement at each resolution.
    const radius = Math.max(.03 * Math.max(width, height) / 320, 4 * median(strong.map(residual)));
    if (radius >= tolerance / 2)
        return [group];
    const outliers = new Set(strong.filter(index => residual(index) > radius));
    if (outliers.size > strong.length / 4 || outliers.size < 3)
        return [group];
    const neighbors = (index) => {
        const x = index % grid.columns, y = Math.floor(index / grid.columns), result = [];
        for (let j = -1; j <= 1; j++)
            for (let i = -1; i <= 1; i++) {
                if ((!i && !j) || x + i < 0 || x + i >= grid.columns || y + j < 0 || y + j >= grid.rows)
                    continue;
                result.push((y + j) * grid.columns + x + i);
            }
        return result;
    };
    // Local support rejects isolated grain excursions. It does not assign object
    // identities: disconnected supported residuals still group by velocity below.
    const supported = new Set(), seen = new Set();
    for (const index of outliers) {
        if (seen.has(index))
            continue;
        const component = [index];
        seen.add(index);
        for (let cursor = 0; cursor < component.length; cursor++)
            for (const next of neighbors(component[cursor])) {
                if (!outliers.has(next) || seen.has(next))
                    continue;
                seen.add(next);
                component.push(next);
            }
        // Reflected-border excursions cannot establish a new motion by themselves.
        // Interior witnesses may still carry a supported component to the frame edge.
        const margin = grid.cellSize * 2;
        const witnesses = component.filter(index => {
            const cell = grid.cells[index];
            return [0, 1].every(t => cell.x + t * cell.dx >= margin && cell.y + t * cell.dy >= margin
                && cell.x + cell.width + t * cell.dx <= width - margin
                && cell.y + cell.height + t * cell.dy <= height - margin);
        });
        if (witnesses.length >= 3 && median(witnesses.map(residual)) >= radius * 2) {
            for (const cell of component)
                supported.add(cell);
        }
    }
    if (!supported.size)
        return [group];
    const remaining = new Set(supported);
    for (const index of group.cells) {
        if (!grid.cells[index].coherent && residual(index) > radius && neighbors(index).some(next => supported.has(next)))
            remaining.add(index);
    }
    const core = center(group.cells.filter(index => !remaining.has(index)), grid.cells);
    if (!withinRadius(core, grid.cells, tolerance))
        return [group];
    return [core, ...coarseClusters(grid, tolerance, remaining)];
}
function groupGrid(grid, options, width, height) {
    const { tolerance, splitSubtleMotion, splitDistantRegions, proximityGap } = options;
    const coarse = coarseClusters(grid, tolerance);
    const clusters = (splitSubtleMotion ? coarse.flatMap(group => splitTightCore(group, grid, tolerance, width, height)) : coarse).sort(order);
    const labels = new Int32Array(grid.cells.length).fill(-1), confidence = new Uint8Array(grid.cells.length);
    const observations = clusters.map((group, id) => {
        group.cells.sort((a, b) => a - b);
        for (const index of group.cells) {
            labels[index] = id;
            confidence[index] = grid.cells[index].coherent ? 2 : 1;
        }
        return { id, motionId: id, ...group, strongCells: group.cells.filter(index => grid.cells[index].coherent).length };
    });
    // Freeze motion IDs first. The dominant group is untouched, and new spatial
    // children are appended so unrelated groups keep their existing colors.
    if (splitDistantRegions)
        for (const group of observations.slice(1)) {
            const islands = spatialIslands(group.cells, grid, proximityGap);
            if (islands.length < 2)
                continue;
            group.cells = islands[0];
            group.strongCells = group.cells.filter(index => grid.cells[index].coherent).length;
            for (const cells of islands.slice(1)) {
                const id = observations.length;
                observations.push({ ...group, id, cells, strongCells: cells.filter(index => grid.cells[index].coherent).length });
                for (const index of cells)
                    labels[index] = id;
            }
        }
    return { frame: 0, labels, confidence, observations };
}
/**
 * Group each frame's measured (dx,dy) vectors without temporal identity gating.
 * Every candidate appears exactly once. Speed/direction may change freely
 * between frames, including easing and reversal. No missing cells are filled.
 */
export function groupFrameVectors(sequence, options = {}) {
    const tolerance = options.tolerance ?? .75, splitSubtleMotion = options.splitSubtleMotion ?? true;
    const splitDistantRegions = options.splitDistantRegions ?? true, proximityGap = options.proximityGap ?? 4;
    const { width, height, frameCount, pairs } = sequence;
    if (!Number.isFinite(tolerance) || tolerance <= 0)
        throw new RangeError('Velocity radius must be positive and finite');
    if (typeof splitSubtleMotion !== 'boolean')
        throw new TypeError('Subtle motion splitting must be a boolean');
    if (typeof splitDistantRegions !== 'boolean')
        throw new TypeError('Distant region splitting must be a boolean');
    if (!Number.isFinite(proximityGap) || proximityGap < 0 || proximityGap > 16)
        throw new RangeError('Proximity gap must be between 0 and 16 cells');
    const resolved = { tolerance, splitSubtleMotion, splitDistantRegions, proximityGap };
    if (![width, height, frameCount].every(Number.isSafeInteger) || width < 1 || height < 1 || frameCount < 2
        || pairs.length !== frameCount - 1)
        throw new RangeError('Expected one contiguous candidate scene');
    let cellSize = 0;
    const frames = pairs.map((pair, frame) => {
        if (pair.frame !== frame || pair.flow.width !== width || pair.flow.height !== height || pair.grids.length !== 1) {
            throw new RangeError('Frame grouping requires one ordered grid per pair');
        }
        const grid = pair.grids[0], size = grid.cellSize;
        if (!Number.isSafeInteger(size) || size < 1 || (cellSize && size !== cellSize)
            || grid.columns !== Math.ceil(width / size) || grid.rows !== Math.ceil(height / size)
            || grid.cells.length !== grid.columns * grid.rows)
            throw new RangeError('Invalid candidate grid geometry');
        cellSize = size;
        for (const [index, cell] of grid.cells.entries()) {
            const x = index % grid.columns * size, y = Math.floor(index / grid.columns) * size;
            if (cell.x !== x || cell.y !== y || cell.width !== Math.min(size, width - x) || cell.height !== Math.min(size, height - y)
                || !Number.isSafeInteger(cell.accepted) || cell.accepted < 0 || cell.accepted > cell.width * cell.height
                || !Number.isFinite(cell.coverage) || cell.coverage < 0 || cell.coverage > 1
                || (cell.dx === null) !== (cell.dy === null)
                || (cell.dx !== null && (!Number.isFinite(cell.dx) || !Number.isFinite(cell.dy) || cell.accepted < 1))
                || (cell.coherent && cell.dx === null))
                throw new RangeError('Invalid candidate measurement');
        }
        return { ...groupGrid(grid, resolved, width, height), frame };
    });
    return { width, height, frameCount, cellSize, options: resolved, frames };
}
