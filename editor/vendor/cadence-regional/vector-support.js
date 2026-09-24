function neighbors(index, columns, rows, visit) {
    const x = index % columns, y = Math.floor(index / columns);
    for (let j = Math.max(0, y - 1); j <= Math.min(rows - 1, y + 1); j++) {
        for (let i = Math.max(0, x - 1); i <= Math.min(columns - 1, x + 1); i++) {
            const next = j * columns + i;
            if (next !== index)
                visit(next);
        }
    }
}
/** Eight-neighbor distance to frozen measured support; missing cells are not obstacles. */
function distances(raw, columns, rows, isSeed) {
    const result = new Float64Array(raw.length).fill(Infinity), queue = [];
    for (const [index, label] of raw.entries())
        if (isSeed(label)) {
            result[index] = 0;
            queue.push(index);
        }
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const index = queue[cursor];
        neighbors(index, columns, rows, next => {
            if (result[next] !== Infinity)
                return;
            result[next] = result[index] + 1;
            queue.push(next);
        });
    }
    return result;
}
function unknownComponents(labels, columns, rows) {
    const visited = new Uint8Array(labels.length);
    const result = [];
    for (let seed = 0; seed < labels.length; seed++) {
        if (labels[seed] >= 0 || visited[seed])
            continue;
        const cells = [seed], boundary = new Set();
        let edges = 0;
        visited[seed] = 1;
        for (let cursor = 0; cursor < cells.length; cursor++) {
            const index = cells[cursor], x = index % columns, y = Math.floor(index / columns);
            if (x === 0)
                edges |= 1;
            if (x === columns - 1)
                edges |= 2;
            if (y === 0)
                edges |= 4;
            if (y === rows - 1)
                edges |= 8;
            neighbors(index, columns, rows, next => {
                if (labels[next] >= 0)
                    boundary.add(labels[next]);
                else if (!visited[next]) {
                    visited[next] = 1;
                    cells.push(next);
                }
            });
        }
        result.push({ cells, boundary, edges });
    }
    return result;
}
function completeFrame(frame, columns, rows, options) {
    const raw = frame.labels, labels = raw.slice(), provenance = Uint8Array.from(raw, label => label >= 0 ? 1 : 0);
    const observations = frame.observations.map(group => ({ id: group.id, holeCells: [], borderCells: [] }));
    const byId = new Map(observations.map(group => [group.id, group]));
    const measuredSizes = new Map(frame.observations.map(group => [group.id, group.cells.length]));
    const counts = { measured: raw.filter(label => label >= 0).length, holes: 0, border: 0, unknown: 0 };
    if (options.fillEdges && options.edgeReach > 0) {
        const edgeProposals = new Int32Array(raw.length).fill(-1);
        const proposals = new Int32Array(raw.length).fill(-1), margins = new Map();
        const qualified = new Map();
        for (let edge = 0; edge < 4; edge++) {
            const vertical = edge < 2, lineCount = vertical ? rows : columns, depth = vertical ? columns : rows;
            const at = (line, step) => edge === 0 ? line * columns + step
                : edge === 1 ? line * columns + columns - step - 1 : edge === 2 ? step * columns + line
                    : (rows - step - 1) * columns + line;
            // Only original measured cells touching this edge vote for its owner.
            // New corner fills must not establish ownership of an adjacent empty edge.
            const touching = new Map();
            let measured = 0;
            for (let line = 0; line < lineCount; line++) {
                const owner = raw[at(line, 0)];
                if (owner < 0)
                    continue;
                touching.set(owner, (touching.get(owner) ?? 0) + 1);
                measured++;
            }
            const edgeWinner = [...touching].find(([, count]) => count * 4 >= measured * 3);
            if (edgeWinner) {
                const owner = edgeWinner[0];
                for (let line = 0; line < lineCount; line++) {
                    const index = at(line, 0);
                    if (raw[index] >= 0)
                        continue;
                    if (edgeProposals[index] === -1)
                        edgeProposals[index] = owner;
                    else if (edgeProposals[index] !== owner)
                        edgeProposals[index] = -2;
                }
            }
            const rays = [], votes = new Map(), coherent = new Map();
            for (let line = 0; line < lineCount; line++)
                for (let step = 0; step <= Math.min(options.edgeReach, depth - 1); step++) {
                    const index = at(line, step), owner = raw[index];
                    if (owner < 0)
                        continue;
                    rays.push({ line, step, owner });
                    votes.set(owner, (votes.get(owner) ?? 0) + 1);
                    if (frame.confidence[index] === 2)
                        coherent.set(owner, (coherent.get(owner) ?? 0) + 1);
                    break;
                }
            const winner = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
            // An edge needs broad original support, not merely one isolated island.
            // Minority layers are allowed in the vote but still block nearby expansion.
            if (!winner || rays.length * 2 < lineCount || winner[1] * 10 < rays.length * 9 || (coherent.get(winner[0]) ?? 0) < 3)
                continue;
            const owner = winner[0];
            qualified.set(owner, (qualified.get(owner) ?? 0) | (1 << edge));
            if (!margins.has(owner))
                margins.set(owner, {
                    own: distances(raw, columns, rows, label => label === owner),
                    other: distances(raw, columns, rows, label => label >= 0 && label !== owner),
                });
            const { own, other } = margins.get(owner);
            for (const ray of rays) {
                if (ray.owner !== owner)
                    continue;
                for (let step = 0; step < ray.step; step++) {
                    const index = at(ray.line, step);
                    if (other[index] <= own[index] + 1)
                        continue;
                    if (proposals[index] === -1)
                        proposals[index] = owner;
                    else if (proposals[index] !== owner)
                        proposals[index] = -2;
                }
            }
        }
        // Winding edge pockets can lack a straight ray. Their entire ORIGINAL
        // boundary must agree, every cell must fit the reach, and an edge must have
        // qualified independently. This is not closing over previously inferred cells.
        for (const { cells, boundary, edges } of unknownComponents(raw, columns, rows)) {
            if (!edges || boundary.size !== 1)
                continue;
            const pocket = { cells, edges, owner: boundary.values().next().value };
            if (!((qualified.get(pocket.owner) ?? 0) & pocket.edges))
                continue;
            const { own, other } = margins.get(pocket.owner);
            if (pocket.cells.some(index => own[index] > options.edgeReach || other[index] <= own[index] + 1))
                continue;
            for (const index of pocket.cells) {
                if (proposals[index] === -1)
                    proposals[index] = pocket.owner;
                else if (proposals[index] !== pocket.owner)
                    proposals[index] = -2;
            }
        }
        // Explicit edge ownership outranks bounded inward fallback. Conflicting
        // corners remain unknown; neither kind of fill supplies new edge votes.
        for (let index = 0; index < raw.length; index++) {
            const owner = edgeProposals[index] !== -1 ? edgeProposals[index] : proposals[index];
            if (owner >= 0 && raw[index] < 0) {
                labels[index] = owner;
                provenance[index] = 3;
                byId.get(owner).borderCells.push(index);
                counts.border++;
            }
        }
    }
    if (options.fillHoles) {
        // Repeat to a fixed point without rerunning edge votes or changing known
        // labels. Whole connected holes normally finish in one productive pass.
        let added;
        do {
            added = 0;
            for (const { cells, boundary, edges } of unknownComponents(labels, columns, rows)) {
                if (edges || !boundary.size)
                    continue;
                // Only touching groups compete. Freeze their measured sizes so earlier
                // inferred fills cannot enlarge a group and change later ownership.
                const owner = [...boundary].sort((a, b) => measuredSizes.get(b) - measuredSizes.get(a) || a - b)[0];
                for (const index of cells) {
                    labels[index] = owner;
                    provenance[index] = 2;
                    byId.get(owner).holeCells.push(index);
                }
                added += cells.length;
            }
            counts.holes += added;
        } while (added > 0);
    }
    for (const group of observations)
        group.holeCells.sort((a, b) => a - b);
    counts.unknown = raw.length - counts.measured - counts.holes - counts.border;
    return { frame: frame.frame, labels, provenance, counts, observations };
}
/** Infer missing support from frozen geometry without modifying raw groups or inventing vectors. */
export function completeFrameVectorSupport(groups, options = {}) {
    const resolved = { fillHoles: options.fillHoles ?? true, fillEdges: options.fillEdges ?? true, edgeReach: options.edgeReach ?? 8 };
    if (typeof resolved.fillHoles !== 'boolean' || typeof resolved.fillEdges !== 'boolean')
        throw new TypeError('Support completion switches must be boolean');
    if (!Number.isSafeInteger(resolved.edgeReach) || resolved.edgeReach < 0 || resolved.edgeReach > 32)
        throw new RangeError('Edge reach must be a whole cell count from 0 to 32');
    const { width, height, frameCount, cellSize } = groups;
    if (![width, height, cellSize, frameCount].every(Number.isSafeInteger) || Math.min(width, height, cellSize) < 1
        || frameCount < 2 || groups.frames.length !== frameCount - 1)
        throw new RangeError('Expected contiguous frame-local groups');
    const columns = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize), count = columns * rows;
    const frames = groups.frames.map((frame, index) => {
        if (frame.frame !== index || frame.labels.length !== count || frame.confidence.length !== count)
            throw new RangeError('Invalid support frame geometry');
        const ids = new Set(), seen = new Set();
        for (const group of frame.observations) {
            if (!Number.isSafeInteger(group.id) || group.id < 0 || ids.has(group.id) || !group.cells.length)
                throw new RangeError('Invalid support group identity');
            ids.add(group.id);
            for (const cell of group.cells) {
                if (!Number.isSafeInteger(cell) || cell < 0 || cell >= count || seen.has(cell) || frame.labels[cell] !== group.id)
                    throw new RangeError('Support groups must partition measured labels');
                seen.add(cell);
            }
        }
        for (const [cell, label] of frame.labels.entries()) {
            if (!Number.isSafeInteger(label) || label < -1 || (label >= 0) !== seen.has(cell)
                || (label < 0 ? frame.confidence[cell] !== 0 : ![1, 2].includes(frame.confidence[cell])))
                throw new RangeError('Invalid measured support or confidence');
        }
        return completeFrame(frame, columns, rows, resolved);
    });
    return { width, height, frameCount, cellSize, columns, rows, options: resolved, frames };
}
