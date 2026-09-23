function weightedMedian(observations, coordinate) {
    const ordered = [...observations].sort((a, b) => a[coordinate] - b[coordinate] || a.id - b.id);
    const half = ordered.reduce((sum, o) => sum + o.cells.length, 0) / 2;
    let weight = 0;
    for (const [i, o] of ordered.entries()) {
        weight += o.cells.length;
        if (weight > half)
            return o[coordinate];
        if (weight === half)
            return (o[coordinate] + ordered[i + 1][coordinate]) / 2;
    }
    throw new Error('Cannot summarize an empty motion family');
}
/**
 * Join spatially disconnected regions using simultaneous whole-scene velocities.
 * Every pair of constituent histories must agree with enough shared evidence;
 * a compatible bridge cannot erase a contradiction or an unobserved interval.
 * Matching motion does not establish shared artwork or fill unsupported cells.
 */
export function groupMotionHistories(tracks, options = {}) {
    const tolerance = options.tolerance ?? .75, minimumOverlap = options.minimumOverlap ?? 4;
    if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isSafeInteger(minimumOverlap) || minimumOverlap < 2) {
        throw new RangeError('Invalid motion-history tolerance or overlap');
    }
    const { width, height, frameCount, cellSize } = tracks;
    if (![width, height, cellSize].every(n => Number.isSafeInteger(n) && n > 0)
        || !Number.isSafeInteger(frameCount) || frameCount < 2)
        throw new RangeError('Invalid motion-history geometry');
    const ids = tracks.groups.map(g => g.id).sort((a, b) => a - b);
    if (ids.some((id, i) => !Number.isSafeInteger(id) || id < 0 || (i > 0 && id === ids[i - 1]))) {
        throw new RangeError('Motion-history region IDs must be unique nonnegative integers');
    }
    const indices = new Map(ids.map((id, index) => [id, index]));
    const histories = ids.map(() => new Map());
    const frames = [...tracks.frames].sort((a, b) => a.frame - b.frame);
    const cellCount = Math.ceil(width / cellSize) * Math.ceil(height / cellSize);
    for (const [i, frame] of frames.entries()) {
        if (!Number.isSafeInteger(frame.frame) || frame.frame < 0 || frame.frame >= frameCount - 1
            || (i > 0 && frame.frame === frames[i - 1].frame))
            throw new RangeError('Invalid or duplicate motion-history frame');
        const occupied = new Set();
        for (const observation of frame.observations) {
            const index = indices.get(observation.id);
            if (index === undefined || histories[index].has(frame.frame))
                throw new RangeError('Unknown or duplicate motion-history region');
            if (![observation.dx, observation.dy, observation.spread].every(Number.isFinite) || observation.spread < 0
                || !observation.cells.length)
                throw new RangeError('Invalid motion-history observation');
            for (const cell of observation.cells) {
                if (!Number.isSafeInteger(cell) || cell < 0 || cell >= cellCount || occupied.has(cell)) {
                    throw new RangeError('Invalid or multiply owned motion-history cell');
                }
                occupied.add(cell);
            }
            histories[index].set(frame.frame, observation);
        }
    }
    const comparisons = [];
    const compatible = ids.map(() => new Set());
    for (let a = 0; a < ids.length; a++)
        for (let b = a + 1; b < ids.length; b++) {
            let overlap = 0, sum = 0, maximum = 0;
            for (const [frame, one] of histories[a]) {
                const other = histories[b].get(frame);
                if (!other)
                    continue;
                const error = Math.hypot(one.dx - other.dx, one.dy - other.dy);
                overlap++;
                sum += error;
                maximum = Math.max(maximum, error);
            }
            const status = overlap < minimumOverlap ? 'insufficient-overlap' : maximum > tolerance ? 'different' : 'compatible';
            comparisons.push({ a: ids[a], b: ids[b], overlap, error: overlap ? sum / overlap : null,
                maximum: overlap ? maximum : null, status });
            if (status === 'compatible') {
                compatible[a].add(b);
                compatible[b].add(a);
            }
        }
    const roots = ids.map((_, i) => i), members = ids.map((_, i) => [i]);
    const root = (id) => {
        while (roots[id] !== id) {
            roots[id] = roots[roots[id]];
            id = roots[id];
        }
        return id;
    };
    const candidates = comparisons.filter(p => p.status === 'compatible')
        .sort((a, b) => a.error - b.error || b.overlap - a.overlap || a.a - b.a || a.b - b.b);
    for (const candidate of candidates) {
        let a = root(indices.get(candidate.a)), b = root(indices.get(candidate.b));
        if (a === b || !members[a].every(one => members[b].every(other => compatible[one].has(other))))
            continue;
        if (b < a)
            [a, b] = [b, a];
        roots[b] = a;
        members[a].push(...members[b]);
        members[b] = [];
    }
    const families = members.filter(group => group.length).map(group => {
        const regionIds = group.map(index => ids[index]).sort((a, b) => a - b);
        return { id: regionIds[0], regionIds };
    });
    const familyIds = new Map(families.flatMap(family => family.regionIds.map(id => [id, family.id])));
    const groupedFrames = frames.map(({ frame, observations }) => {
        const present = new Map();
        for (const observation of observations) {
            const id = familyIds.get(observation.id), family = present.get(id) ?? [];
            family.push(observation);
            present.set(id, family);
        }
        return { frame, observations: [...present].sort(([a], [b]) => a - b).map(([id, group]) => {
                const dx = weightedMedian(group, 'dx'), dy = weightedMedian(group, 'dy');
                return { id, regionIds: group.map(o => o.id).sort((a, b) => a - b),
                    cells: group.flatMap(o => o.cells).sort((a, b) => a - b), dx, dy,
                    spread: Math.max(...group.map(o => o.spread + Math.hypot(o.dx - dx, o.dy - dy))) };
            }) };
    });
    return { width, height, frameCount, cellSize, options: { tolerance, minimumOverlap }, families,
        frames: groupedFrames, comparisons };
}
