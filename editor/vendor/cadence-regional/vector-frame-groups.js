import { poolVectorModes } from "./vector-modes.js";
const median = (values) => {
    values.sort((a, b) => a - b);
    const middle = values.length >> 1;
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};
const center = (cells, raw) => ({ cells,
    dx: median(cells.map(index => raw[index].dx)), dy: median(cells.map(index => raw[index].dy)) });
const order = (a, b) => b.cells.length - a.cells.length || a.dx - b.dx || a.dy - b.dy;
const withinRadius = (group, raw, tolerance) => group.cells.every(index => Math.hypot(raw[index].dx - group.dx, raw[index].dy - group.dy) <= tolerance + 1e-9);
function groupGrid(grid, tolerance) {
    // The arrows already passed measurement acceptance. Even a mixed median or
    // singleton is a valid first-pass proposal; neither needs a temporal witness.
    const modes = poolVectorModes({ ...grid, cells: grid.cells.map(cell => ({ ...cell, coherent: cell.dx !== null })) }, { tolerance, minimumCells: 1 });
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
    clusters.sort(order);
    const labels = new Int32Array(grid.cells.length).fill(-1), confidence = new Uint8Array(grid.cells.length);
    const observations = clusters.map((group, id) => {
        group.cells.sort((a, b) => a - b);
        for (const index of group.cells) {
            labels[index] = id;
            confidence[index] = grid.cells[index].coherent ? 2 : 1;
        }
        return { id, ...group, strongCells: group.cells.filter(index => grid.cells[index].coherent).length };
    });
    return { frame: 0, labels, confidence, observations };
}
/**
 * Group each frame's measured (dx,dy) vectors without temporal identity gating.
 * Every candidate appears exactly once. Speed/direction may change freely
 * between frames, including easing and reversal. No missing cells are filled.
 */
export function groupFrameVectors(sequence, options = {}) {
    const tolerance = options.tolerance ?? .75, { width, height, frameCount, pairs } = sequence;
    if (!Number.isFinite(tolerance) || tolerance <= 0)
        throw new RangeError('Velocity radius must be positive and finite');
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
        return { ...groupGrid(grid, tolerance), frame };
    });
    return { width, height, frameCount, cellSize, options: { tolerance }, frames };
}
