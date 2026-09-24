function median(values) {
    values.sort((a, b) => a - b);
    const middle = values.length >> 1;
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}
/**
 * Consolidate supported velocity modes without spatial grouping or hole filling.
 * Tolerance is a radius around the mode, not a pairwise velocity-diameter bound.
 * Raw input and weak measurements remain intact; output vectors are proposals.
 */
export function poolVectorModes(grid, options = {}) {
    const tolerance = options.tolerance ?? .75, minimumCells = options.minimumCells ?? 4;
    if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isSafeInteger(minimumCells) || minimumCells < 1) {
        throw new RangeError('Invalid vector mode tolerance or minimum cells');
    }
    if (!Number.isSafeInteger(grid.cellSize) || grid.cellSize < 1 || !Number.isSafeInteger(grid.columns) || grid.columns < 1
        || !Number.isSafeInteger(grid.rows) || grid.rows < 1 || grid.cells.length !== grid.columns * grid.rows) {
        throw new RangeError('Invalid vector mode grid');
    }
    const result = { ...grid, cells: grid.cells.map(cell => ({ ...cell })) };
    const bins = new Map(), key = (x, y) => `${x}:${y}`;
    for (const [cell, motion] of grid.cells.entries()) {
        if ((motion.dx === null) !== (motion.dy === null)
            || (motion.dx !== null && (!Number.isFinite(motion.dx) || !Number.isFinite(motion.dy)))
            || (motion.coherent && motion.dx === null))
            throw new RangeError('Invalid vector mode measurement');
        if (!motion.coherent || motion.dx === null || motion.dy === null)
            continue;
        result.cells[cell].coherent = false;
        const x = Math.floor(motion.dx / tolerance), y = Math.floor(motion.dy / tolerance), k = key(x, y);
        if (!bins.has(k))
            bins.set(k, { x, y, points: [] });
        bins.get(k).points.push({ cell, dx: motion.dx, dy: motion.dy });
    }
    const radiusSquared = tolerance * tolerance;
    const near = (dx, dy) => {
        const x = Math.floor(dx / tolerance), y = Math.floor(dy / tolerance), points = [];
        for (let j = -1; j <= 1; j++)
            for (let i = -1; i <= 1; i++) {
                for (const point of bins.get(key(x + i, y + j))?.points ?? []) {
                    if ((point.dx - dx) ** 2 + (point.dy - dy) ** 2 <= radiusSquared)
                        points.push(point);
                }
            }
        return points;
    };
    // Density is evaluated only at occupied-bin medians, not at every pair of
    // cells. Membership still uses exact velocities rather than bin membership.
    const peaks = [...bins.values()].map(bin => {
        const dx = median(bin.points.map(point => point.dx)), dy = median(bin.points.map(point => point.dy));
        return { ...bin, dx, dy, density: near(dx, dy).length };
    }).sort((a, b) => b.density - a.density || b.points.length - a.points.length || a.dx - b.dx || a.dy - b.dy);
    const assigned = new Uint8Array(grid.cells.length);
    for (const peak of peaks) {
        if (peak.points.every(point => assigned[point.cell]))
            continue;
        let points = near(peak.dx, peak.dy).filter(point => !assigned[point.cell]);
        while (points.length >= minimumCells) {
            const dx = median(points.map(point => point.dx)), dy = median(points.map(point => point.dy));
            const inside = points.filter(point => (point.dx - dx) ** 2 + (point.dy - dy) ** 2 <= radiusSquared);
            if (inside.length !== points.length) {
                points = inside;
                continue;
            }
            for (const point of points) {
                const cell = result.cells[point.cell];
                cell.dx = dx;
                cell.dy = dy;
                cell.coherent = true;
                assigned[point.cell] = 1;
            }
            break;
        }
    }
    return result;
}
