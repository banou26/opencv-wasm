import { regionalFineGrid } from "./regions.js";
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
function layout(sequence, families, options = {}) {
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
    return { width, height, frameCount, cellSize, columns, rows, count, options: resolved };
}
/** A local seed hull forbids one-sided expansion of an isolated interior object. */
function surrounded(p, owner, label, columns, rows, radius) {
    const x = p % columns, y = Math.floor(p / columns), angles = [];
    for (let ny = Math.max(0, y - radius); ny <= Math.min(rows - 1, y + radius); ny++) {
        for (let nx = Math.max(0, x - radius); nx <= Math.min(columns - 1, x + radius); nx++) {
            if (owner[ny * columns + nx] === label)
                angles.push(Math.atan2(ny - y, nx - x));
        }
    }
    if (angles.length < 2)
        return false;
    angles.sort((a, b) => a - b);
    let largestGap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++)
        largestGap = Math.max(largestGap, angles[i] - angles[i - 1]);
    return largestGap <= Math.PI + 1e-10;
}
/** Shortest eight-neighbor paths, with no diagonal crossing of blocked corners. */
function reachable(seeds, allowed, columns, rows, limit) {
    const result = new Float64Array(allowed.length).fill(Infinity), queue = new Int32Array(allowed.length);
    let head = 0, tail = 0;
    for (const p of seeds) {
        result[p] = 0;
        queue[tail++] = p;
    }
    while (head < tail) {
        const p = queue[head++], x = p % columns, y = Math.floor(p / columns), nextDistance = result[p] + 1;
        if (nextDistance > limit)
            continue;
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
                if ((!dx && !dy) || x + dx < 0 || x + dx >= columns || y + dy < 0 || y + dy >= rows)
                    continue;
                const q = (y + dy) * columns + x + dx;
                if (!allowed[q] || result[q] <= nextDistance)
                    continue;
                if (dx && dy && (!allowed[y * columns + x + dx] || !allowed[(y + dy) * columns + x]))
                    continue;
                result[q] = nextDistance;
                queue[tail++] = q;
            }
    }
    return result;
}
/**
 * Independent per-pair proposals with whole-scene contradiction checks. The generator
 * lets browser workers yield between pairs without throwing away temporal evidence.
 * Ownership is inferred; source flow, families and drawing timing remain untouched.
 */
export function* completeMotionSupportFrames(sequence, families, options = {}) {
    const { width, height, frameCount, cellSize, columns, rows, count, options: resolved } = layout(sequence, families, options);
    const validFrame = (frame) => Number.isSafeInteger(frame) && frame >= 0 && frame < frameCount - 1;
    const history = new Map(families.frames.map(frame => [frame.frame, frame]));
    if (history.size !== families.frames.length || families.frames.some(frame => !validFrame(frame.frame))) {
        throw new RangeError('Invalid or duplicate completion family frame');
    }
    const knownIds = new Set(families.families.map(family => family.id));
    if (knownIds.size !== families.families.length || [...knownIds].some(id => !Number.isSafeInteger(id) || id < 0)) {
        throw new RangeError('Invalid or duplicate completion family ID');
    }
    const seen = new Set();
    const contexts = [...sequence.pairs].sort((a, b) => a.frame - b.frame).map(pair => {
        const frame = history.get(pair.frame), grid = regionalFineGrid(pair);
        if (!validFrame(pair.frame) || seen.has(pair.frame) || !frame)
            throw new RangeError('Missing or duplicate completion pair/family frame');
        seen.add(pair.frame);
        if (pair.flow.width !== width || pair.flow.height !== height || grid.cellSize !== cellSize
            || grid.columns !== columns || grid.rows !== rows || grid.cells.length !== count) {
            throw new RangeError('Completion fine-grid geometry differs');
        }
        // Store observation indices rather than IDs, so large valid IDs cannot overflow.
        const owner = new Int32Array(count).fill(-1);
        for (const [p, cell] of grid.cells.entries()) {
            const x = p % columns * cellSize, y = Math.floor(p / columns) * cellSize;
            if (cell.x !== x || cell.y !== y || cell.width !== Math.min(cellSize, width - x)
                || cell.height !== Math.min(cellSize, height - y)
                || !Number.isSafeInteger(cell.accepted) || cell.accepted < 0 || cell.accepted > cell.width * cell.height) {
                throw new RangeError('Invalid completion cell geometry or support');
            }
            // Sparse accepted samples without a vector are unknown, not evidence of a foreign layer.
            if (cell.coherent || cell.dx !== null || cell.dy !== null)
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
            return { id: observation.id, measuredCells, motionCells: [], holeCells: [], borderCells: [] };
        });
        return { frame: pair.frame, grid, owner, observations,
            velocities: new Map(frame.observations.map(o => [o.id, { dx: o.dx, dy: o.dy }])) };
    });
    const byFrame = new Map(contexts.map(context => [context.frame, context]));
    const fits = (cell, velocity) => cell.coherent && cell.accepted > 0 && cell.dx !== null && cell.dy !== null && cell.spread !== null && Number.isFinite(cell.spread)
        && cell.spread >= 0 && cell.spread <= 1 && Math.hypot(cell.dx - velocity.dx, cell.dy - velocity.dy) <= families.options.tolerance;
    for (const context of contexts) {
        const { owner: original, observations, grid } = context, owner = original.slice();
        const stable = (p, label, requireWitness) => {
            const id = observations[label].id, cell = grid.cells[p];
            let witnesses = 0;
            for (const direction of [-1, 1]) {
                let x = cell.x + cell.width / 2, y = cell.y + cell.height / 2, current = context;
                for (let step = 1; step <= 2; step++) {
                    const target = byFrame.get(context.frame + direction * step);
                    if (!target)
                        break;
                    const velocity = (direction > 0 ? current : target).velocities.get(id), nextVelocity = target.velocities.get(id);
                    if (!velocity)
                        break;
                    x += direction * velocity.dx;
                    y += direction * velocity.dy;
                    if (x < 0 || y < 0 || x >= width || y >= height)
                        break;
                    const q = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize), other = target.owner[q];
                    if (other >= 0) {
                        if (target.observations[other].id !== id)
                            return false;
                        witnesses++;
                    }
                    else if (other === -2) {
                        if (!target.grid.cells[q].coherent)
                            return false;
                        if (!nextVelocity)
                            break;
                        if (!fits(target.grid.cells[q], nextVelocity))
                            return false;
                        witnesses++;
                    }
                    current = target;
                }
            }
            return !requireWitness || witnesses > 0;
        };
        const originalDistances = observations.map(o => distances(o.measuredCells, columns, rows));
        const nearest = new Int32Array(count).fill(-1), first = new Float64Array(count).fill(Infinity);
        const second = new Float64Array(count).fill(Infinity);
        for (const [label, distance] of originalDistances.entries()) {
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
        const { maxHoleDistance, maxBorderDistance, competitorClearance } = resolved;
        const contradictions = observations.map((observation, label) => {
            const velocity = context.velocities.get(observation.id), cells = [];
            for (let p = 0; p < count; p++)
                if (original[p] === -2
                    && (!fits(grid.cells[p], velocity) || !stable(p, label, false)))
                    cells.push(p);
            return distances(cells, columns, rows);
        });
        for (let p = 0; p < count; p++) {
            const label = nearest[p];
            if (owner[p] !== -2 || label < 0 || first[p] > 2 || second[p] <= first[p] + competitorClearance)
                continue;
            if (contradictions[label][p] <= first[p] + competitorClearance)
                continue;
            if (!fits(grid.cells[p], context.velocities.get(observations[label].id)) || !stable(p, label, true))
                continue;
            observations[label].motionCells.push(p);
            owner[p] = label;
        }
        const blockers = [];
        for (let p = 0; p < count; p++)
            if (owner[p] === -2)
                blockers.push(p);
        const blockedDistance = distances(blockers, columns, rows);
        // Independently observed motion associations can block other families, but never restart reach.
        const evidenceDistances = observations.map(o => distances([...o.measuredCells, ...o.motionCells], columns, rows));
        let holes = 0, border = 0;
        const limit = Math.max(maxHoleDistance, maxBorderDistance);
        const assigned = new Int32Array(count).fill(-1);
        for (const [label, observation] of observations.entries()) {
            const allowed = new Uint8Array(count);
            for (let p = 0; p < count; p++) {
                if (owner[p] === label || (owner[p] === -1 && stable(p, label, false)))
                    allowed[p] = 1;
            }
            const reach = reachable(observation.measuredCells, allowed, columns, rows, limit);
            const competitor = blockedDistance.slice();
            for (const [other, distance] of evidenceDistances.entries())
                if (other !== label) {
                    for (let p = 0; p < count; p++)
                        competitor[p] = Math.min(competitor[p], distance[p]);
                }
            for (let p = 0; p < count; p++) {
                if (owner[p] !== -1 || reach[p] > limit || competitor[p] <= reach[p] + competitorClearance)
                    continue;
                const x = p % columns, y = Math.floor(p / columns);
                const hole = reach[p] <= maxHoleDistance && surrounded(p, original, label, columns, rows, maxHoleDistance);
                const edge = reach[p] <= maxBorderDistance && Math.min(x + 1, columns - x, y + 1, rows - y) <= maxBorderDistance;
                if (!hole && !edge)
                    continue;
                if (assigned[p] !== -1)
                    throw new Error('Ambiguous completion escaped competitor clearance');
                assigned[p] = label;
                if (hole) {
                    observation.holeCells.push(p);
                    holes++;
                }
                else {
                    observation.borderCells.push(p);
                    border++;
                }
            }
        }
        const measured = observations.reduce((sum, o) => sum + o.measuredCells.length, 0), blocked = blockers.length;
        const motion = observations.reduce((sum, o) => sum + o.motionCells.length, 0);
        yield { frame: context.frame, observations, counts: { measured, motion, holes, border, blocked,
                unknown: count - measured - motion - holes - border - blocked } };
    }
}
/** Source-preserving motion associations and bounded geometry; not certified silhouettes. */
export function completeMotionSupport(sequence, families, options = {}) {
    const { count: _, ...geometry } = layout(sequence, families, options);
    return { ...geometry, frames: [...completeMotionSupportFrames(sequence, families, options)] };
}
