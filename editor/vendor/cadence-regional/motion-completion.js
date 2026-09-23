import { regionalFineGrid } from "./regions.js";
const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
/** Exact eight-neighbor distance on the cell lattice, without changing or spreading labels. */
function distances(seeds, columns, rows) {
    const distance = new Float64Array(columns * rows).fill(Infinity);
    for (const cell of seeds)
        distance[cell] = 0;
    for (let y = 0; y < rows; y++)
        for (let x = 0; x < columns; x++) {
            const p = y * columns + x;
            if (x)
                distance[p] = Math.min(distance[p], distance[p - 1] + 1);
            if (y) {
                distance[p] = Math.min(distance[p], distance[p - columns] + 1);
                if (x)
                    distance[p] = Math.min(distance[p], distance[p - columns - 1] + 1);
                if (x + 1 < columns)
                    distance[p] = Math.min(distance[p], distance[p - columns + 1] + 1);
            }
        }
    for (let y = rows - 1; y >= 0; y--)
        for (let x = columns - 1; x >= 0; x--) {
            const p = y * columns + x;
            if (x + 1 < columns)
                distance[p] = Math.min(distance[p], distance[p + 1] + 1);
            if (y + 1 < rows) {
                distance[p] = Math.min(distance[p], distance[p + columns] + 1);
                if (x)
                    distance[p] = Math.min(distance[p], distance[p + columns - 1] + 1);
                if (x + 1 < columns)
                    distance[p] = Math.min(distance[p], distance[p + columns + 1] + 1);
            }
        }
    return distance;
}
/**
 * Bounded geometric support proposals, NOT new flow measurements or layer silhouettes.
 * Original family labels and all unassigned measured cells remain immutable. A hole
 * needs agreeing opposite seeds; an edge extension needs a seed opposite the real
 * frame boundary. Competing evidence vetoes both. Inferred cells never seed growth.
 * A wholly unobserved object cannot be excluded by geometry alone.
 */
export function completeMotionSupport(sequence, families, options = {}) {
    const resolved = { maxHoleDistance: options.maxHoleDistance ?? 6, maxBorderDistance: options.maxBorderDistance ?? 6,
        competitorClearance: options.competitorClearance ?? 2 };
    if (Object.values(resolved).some(n => !Number.isSafeInteger(n) || n < 0 || n > 32)) {
        throw new RangeError('Completion distances must be whole cell counts from 0 to 32');
    }
    const { width, height, frameCount } = sequence, { cellSize } = families;
    if (![width, height, cellSize].every(n => Number.isSafeInteger(n) && n > 0)
        || !Number.isSafeInteger(frameCount) || frameCount < 2
        || families.width !== width || families.height !== height || families.frameCount !== frameCount) {
        throw new RangeError('Completion geometry must match the motion families');
    }
    const columns = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize), count = columns * rows;
    const validFrame = (frame) => Number.isSafeInteger(frame) && frame >= 0 && frame < frameCount - 1;
    const history = new Map(families.frames.map(frame => [frame.frame, frame]));
    if (history.size !== families.frames.length || families.frames.some(frame => !validFrame(frame.frame))) {
        throw new RangeError('Invalid or duplicate completion family frame');
    }
    const knownIds = new Set(families.families.map(family => family.id));
    if (knownIds.size !== families.families.length || [...knownIds].some(id => !Number.isSafeInteger(id) || id < 0)) {
        throw new RangeError('Invalid or duplicate completion family ID');
    }
    const frames = [], seen = new Set();
    for (const pair of [...sequence.pairs].sort((a, b) => a.frame - b.frame)) {
        const frame = history.get(pair.frame), grid = regionalFineGrid(pair);
        if (!validFrame(pair.frame) || seen.has(pair.frame) || !frame)
            throw new RangeError('Missing or duplicate completion pair/family frame');
        seen.add(pair.frame);
        if (pair.flow.width !== width || pair.flow.height !== height || grid.cellSize !== cellSize
            || grid.columns !== columns || grid.rows !== rows || grid.cells.length !== count) {
            throw new RangeError('Completion fine-grid geometry differs');
        }
        // Store observation indices rather than IDs, so large valid IDs cannot overflow.
        const owner = new Int32Array(count).fill(-1), blockers = [];
        for (const [p, cell] of grid.cells.entries()) {
            const x = p % columns * cellSize, y = Math.floor(p / columns) * cellSize;
            if (cell.x !== x || cell.y !== y || cell.width !== Math.min(cellSize, width - x)
                || cell.height !== Math.min(cellSize, height - y)
                || !Number.isSafeInteger(cell.accepted) || cell.accepted < 0 || cell.accepted > cell.width * cell.height) {
                throw new RangeError('Invalid completion cell geometry or support');
            }
            // Even a sparse, untracked observation is evidence, not a fillable empty cell.
            if (cell.accepted > 0 || cell.coherent || cell.dx !== null || cell.dy !== null)
                owner[p] = -2;
        }
        const observations = [...frame.observations].sort((a, b) => a.id - b.id).map((observation, index, sorted) => {
            if (!knownIds.has(observation.id) || (index > 0 && sorted[index - 1].id === observation.id)) {
                throw new RangeError('Unknown or duplicate completion observation');
            }
            const measuredCells = [...observation.cells].sort((a, b) => a - b);
            for (const p of measuredCells) {
                const cell = grid.cells[p];
                if (!Number.isSafeInteger(p) || p < 0 || p >= count || owner[p] >= 0 || !cell.coherent || cell.accepted < 1
                    || cell.dx === null || cell.dy === null || !Number.isFinite(cell.dx) || !Number.isFinite(cell.dy)) {
                    throw new RangeError('Completion seeds must be distinct observed coherent cells');
                }
                owner[p] = index;
            }
            return { id: observation.id, measuredCells, holeCells: [], borderCells: [] };
        });
        for (let p = 0; p < count; p++)
            if (owner[p] === -2)
                blockers.push(p);
        const nearest = new Int32Array(count).fill(-1), first = new Float64Array(count).fill(Infinity);
        const second = new Float64Array(count).fill(Infinity);
        // Geometry ignores obstacles here: a competitor across a barrier must still veto.
        for (const [label, seeds] of [...observations.map((o, i) => [i, o.measuredCells]), [-2, blockers]]) {
            if (!seeds.length)
                continue;
            const distance = distances(seeds, columns, rows);
            for (let p = 0; p < count; p++) {
                if (distance[p] < first[p]) {
                    second[p] = first[p];
                    first[p] = distance[p];
                    nearest[p] = label;
                }
                else if (distance[p] < second[p])
                    second[p] = distance[p];
            }
        }
        const ray = (p, dx, dy, limit) => {
            const x = p % columns, y = Math.floor(p / columns);
            for (let step = 1; step <= limit; step++) {
                const nx = x + dx * step, ny = y + dy * step;
                if (nx < 0 || nx >= columns || ny < 0 || ny >= rows)
                    return { label: -3, distance: step };
                const label = owner[ny * columns + nx];
                if (label !== -1)
                    return { label, distance: step };
            }
            return { label: -1, distance: Infinity };
        };
        let holes = 0, border = 0;
        const { maxHoleDistance, maxBorderDistance, competitorClearance } = resolved;
        const limit = Math.max(maxHoleDistance, maxBorderDistance);
        for (let p = 0; p < count; p++) {
            const label = nearest[p];
            if (owner[p] !== -1 || label < 0 || first[p] > limit || second[p] <= first[p] + competitorClearance)
                continue;
            let hole = false, edge = false, conflict = false;
            for (const [dx, dy] of axes) {
                const a = ray(p, dx, dy, limit), b = ray(p, -dx, -dy, limit);
                if (a.label >= 0 && b.label >= 0) {
                    if (a.label !== label || b.label !== label)
                        conflict = true;
                    else if (Math.max(a.distance, b.distance) <= maxHoleDistance)
                        hole = true;
                }
                if (Math.max(a.distance, b.distance) <= maxBorderDistance
                    && ((a.label === label && b.label === -3) || (b.label === label && a.label === -3)))
                    edge = true;
            }
            if (conflict)
                continue;
            if (hole) {
                observations[label].holeCells.push(p);
                holes++;
            }
            else if (edge) {
                observations[label].borderCells.push(p);
                border++;
            }
        }
        const measured = observations.reduce((sum, o) => sum + o.measuredCells.length, 0), blocked = blockers.length;
        frames.push({ frame: pair.frame, observations, counts: { measured, holes, border, blocked,
                unknown: count - measured - holes - border - blocked } });
    }
    return { width, height, frameCount, cellSize, columns, rows, options: resolved, frames };
}
