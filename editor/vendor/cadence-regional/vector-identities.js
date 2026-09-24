function footprint(cells, columns) {
    const points = [...cells].sort((a, b) => a - b).map(cell => ({ x: cell % columns, y: Math.floor(cell / columns) }));
    let x = 0, y = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const point of points) {
        x += point.x;
        y += point.y;
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
    }
    return { points, x: x / points.length, y: y / points.length, left, top, right, bottom };
}
function agreement(a, b, shift, radius) {
    const reach = radius + 1;
    if (Math.max(a.left - b.right - shift.x, b.left + shift.x - a.right) >= reach
        || Math.max(a.top - b.bottom - shift.y, b.top + shift.y - a.bottom) >= reach)
        return 0;
    const distances = new Float64Array(b.points.length).fill(reach);
    let forward = 0;
    for (const point of a.points) {
        let nearest = reach;
        for (let i = 0; i < b.points.length; i++) {
            const other = b.points[i], distance = Math.hypot(point.x - other.x - shift.x, point.y - other.y - shift.y);
            nearest = Math.min(nearest, distance);
            distances[i] = Math.min(distances[i], distance);
        }
        forward += Math.max(0, 1 - nearest / reach);
    }
    let backward = 0;
    for (const distance of distances)
        backward += Math.max(0, 1 - distance / reach);
    const centerDistance = Math.hypot(a.x - b.x - shift.x, a.y - b.y - shift.y);
    // Both footprints must agree: a tiny fragment inside a large old region is
    // weaker evidence than a similar-sized observation at that same position.
    return Math.sqrt(forward / a.points.length * backward / b.points.length) * (.75 + .25 / (1 + centerDistance));
}
/** Maximum-weight one-to-one association, with one unmatched column per row. */
function assign(scores) {
    const rows = scores.length;
    if (!rows)
        return [];
    const tracks = scores[0].length, columns = tracks + rows;
    const u = new Float64Array(rows + 1), v = new Float64Array(columns + 1);
    const p = new Int32Array(columns + 1), way = new Int32Array(columns + 1);
    for (let row = 1; row <= rows; row++) {
        p[0] = row;
        let column = 0;
        const min = new Float64Array(columns + 1).fill(Infinity), seen = new Uint8Array(columns + 1);
        do {
            seen[column] = 1;
            const current = p[column];
            let delta = Infinity, next = 0;
            for (let j = 1; j <= columns; j++) {
                if (seen[j])
                    continue;
                const cost = (j <= tracks ? -scores[current - 1][j - 1] : 0) - u[current] - v[j];
                if (cost < min[j]) {
                    min[j] = cost;
                    way[j] = column;
                }
                if (min[j] < delta) {
                    delta = min[j];
                    next = j;
                }
            }
            for (let j = 0; j <= columns; j++) {
                if (seen[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                }
                else
                    min[j] -= delta;
            }
            column = next;
        } while (p[column]);
        do {
            const previous = way[column];
            p[column] = p[previous];
            column = previous;
        } while (column);
    }
    const result = Array(rows).fill(-1);
    for (let j = 1; j <= tracks; j++)
        if (p[j] && scores[p[j] - 1][j - 1] > 0)
            result[p[j] - 1] = j - 1;
    return result;
}
function validate(groups) {
    const { width, height, frameCount, cellSize } = groups;
    if (![width, height, frameCount, cellSize].every(Number.isSafeInteger) || width < 1 || height < 1
        || frameCount < 2 || cellSize < 1 || groups.frames.length !== frameCount - 1) {
        throw new RangeError('Identity tracking requires one contiguous grouped scene');
    }
    const count = Math.ceil(width / cellSize) * Math.ceil(height / cellSize);
    for (const [index, frame] of groups.frames.entries()) {
        if (frame.frame !== index || frame.labels.length !== count || frame.confidence.length !== count) {
            throw new RangeError('Invalid identity frame geometry or ordering');
        }
        const ids = new Set(), seen = new Uint8Array(count);
        for (const observation of frame.observations) {
            if (!Number.isSafeInteger(observation.id) || observation.id < 0 || ids.has(observation.id)
                || !observation.cells.length || !Number.isFinite(observation.dx) || !Number.isFinite(observation.dy)) {
                throw new RangeError('Invalid identity observation');
            }
            ids.add(observation.id);
            for (const cell of observation.cells) {
                if (!Number.isSafeInteger(cell) || cell < 0 || cell >= count || seen[cell] || frame.labels[cell] !== observation.id) {
                    throw new RangeError('Identity observations must partition the original labels');
                }
                seen[cell] = 1;
            }
        }
        for (let cell = 0; cell < count; cell++) {
            if (frame.labels[cell] < -1 || Number(seen[cell]) !== Number(frame.labels[cell] >= 0)
                || (frame.labels[cell] < 0 ? frame.confidence[cell] !== 0 : ![1, 2].includes(frame.confidence[cell]))) {
                throw new RangeError('Invalid identity labels or measurement confidence');
            }
        }
    }
}
/**
 * Scene-local display identities only. No candidate, group, support or vector
 * changes. Dominant group0 is the camera anchor, not a semantic classification.
 * An absent foreground stays dormant; held-frame foreground masks are not made.
 */
export function trackFrameVectorIdentities(groups, options = {}) {
    const maxGap = options.maxGap ?? 24, matchRadius = options.matchRadius ?? 3;
    if (!Number.isSafeInteger(maxGap) || maxGap < 0 || maxGap > 120
        || !Number.isFinite(matchRadius) || matchRadius < 0 || matchRadius > 16) {
        throw new RangeError('Identity max gap must be 0..120 pairs and match radius 0..16 cells');
    }
    validate(groups);
    const { width, height, frameCount, cellSize } = groups, columns = Math.ceil(width / cellSize);
    const result = { width, height, frameCount, cellSize, options: { maxGap, matchRadius }, frames: [], tracks: [] };
    const summaries = new Map(), active = new Map();
    const camera = { x: 0, y: 0 };
    let nextId = 1;
    for (const frame of groups.frames) {
        const output = { frame: frame.frame, observations: [], dormantTrackIds: [] };
        const observed = new Set(), dominant = frame.observations.find(group => group.id === 0);
        const record = (groupId, trackId, score) => {
            const summary = summaries.get(trackId);
            output.observations.push({ groupId, trackId, previousFrame: summary?.lastFrame ?? null, score });
            if (summary) {
                summary.lastFrame = frame.frame;
                summary.observations++;
            }
            else
                summaries.set(trackId, { id: trackId, firstFrame: frame.frame, lastFrame: frame.frame, observations: 1 });
            observed.add(trackId);
        };
        if (dominant)
            record(0, 0, null);
        for (const [id, track] of active)
            if (frame.frame - track.frame - 1 > maxGap)
                active.delete(id);
        const candidates = [...active.values()].sort((a, b) => a.id - b.id);
        const regions = frame.observations.filter(group => group.id !== 0)
            .map(group => ({ group, footprint: footprint(group.cells, columns) }))
            .sort((a, b) => a.footprint.x - b.footprint.x || a.footprint.y - b.footprint.y || a.group.id - b.group.id);
        const scores = regions.map(region => candidates.map(track => {
            const shift = { x: camera.x - track.camera.x, y: camera.y - track.camera.y };
            const score = agreement(region.footprint, track.footprint, shift, matchRadius);
            const gap = frame.frame - track.frame - 1;
            return score * (1 - .15 * gap / (maxGap + 1));
        }));
        const assignment = assign(scores.map(row => row.map(score => score >= .3 ? score : -1)));
        for (const [index, region] of regions.entries()) {
            const match = assignment[index], id = match >= 0 ? candidates[match].id : nextId++;
            record(region.group.id, id, match >= 0 ? scores[index][match] : null);
            active.set(id, { id, frame: frame.frame, footprint: region.footprint, camera: { ...camera } });
        }
        output.observations.sort((a, b) => a.groupId - b.groupId);
        output.dormantTrackIds = [...active.values()].filter(track => !observed.has(track.id) && frame.frame - track.frame <= maxGap)
            .map(track => track.id).sort((a, b) => a - b);
        result.frames.push(output);
        // Drawing-change flow need not be rigid actor translation. Do not repeat
        // its residual through a hold; use the independently measured pan per pair.
        camera.x += (dominant?.dx ?? 0) / cellSize;
        camera.y += (dominant?.dy ?? 0) / cellSize;
    }
    result.tracks = [...summaries.values()].sort((a, b) => a.id - b.id);
    return result;
}
