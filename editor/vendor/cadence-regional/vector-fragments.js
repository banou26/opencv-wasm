function neighbors(cell, columns, rows, visit) {
    const x = cell % columns, y = Math.floor(cell / columns);
    for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
            if ((!i && !j) || x + i < 0 || y + j < 0 || x + i >= columns || y + j >= rows)
                continue;
            visit((y + j) * columns + x + i, j === 0 ? i < 0 ? 1 : 2 : i === 0 ? j < 0 ? 4 : 8 : 0);
        }
}
function components(labels, columns, rows) {
    const seen = new Uint8Array(labels.length), result = [];
    for (let seed = 0; seed < labels.length; seed++) {
        if (labels[seed] <= 0 || seen[seed])
            continue;
        const cells = [seed], id = labels[seed];
        seen[seed] = 1;
        for (let cursor = 0; cursor < cells.length; cursor++)
            neighbors(cells[cursor], columns, rows, next => {
                if (!seen[next] && labels[next] === id) {
                    seen[next] = 1;
                    cells.push(next);
                }
            });
        result.push({ id, cells: cells.sort((a, b) => a - b) });
    }
    return result;
}
function validate(groups, support, identities) {
    const { width, height, frameCount, cellSize } = groups;
    if (![width, height, frameCount, cellSize].every(Number.isSafeInteger) || Math.min(width, height, cellSize) < 1 || frameCount < 2) {
        throw new RangeError('Invalid fragment geometry');
    }
    const columns = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize), count = columns * rows;
    if (support.columns !== columns || support.rows !== rows)
        throw new RangeError('Invalid completed fragment grid');
    for (const input of [groups, support, identities]) {
        if (input.width !== width || input.height !== height || input.frameCount !== frameCount || input.cellSize !== cellSize
            || input.frames.length !== frameCount - 1 || input.frames.some((frame, index) => frame.frame !== index)) {
            throw new RangeError('Fragment inputs must describe the same contiguous scene');
        }
    }
    return groups.frames.map((frame, index) => {
        const completed = support.frames[index], identity = identities.frames[index];
        if (frame.labels.length !== count || frame.confidence.length !== count || completed.labels.length !== count
            || completed.provenance.length !== count)
            throw new RangeError('Incomplete fragment maps');
        const known = new Map(), seen = new Uint8Array(count), mapping = new Map(), assigned = new Set();
        for (const group of frame.observations) {
            if (!Number.isSafeInteger(group.id) || group.id < 0 || known.has(group.id) || !group.cells.length)
                throw new RangeError('Invalid fragment group');
            known.set(group.id, group.cells.length);
            for (const cell of group.cells) {
                if (!Number.isSafeInteger(cell) || cell < 0 || cell >= count || seen[cell] || frame.labels[cell] !== group.id)
                    throw new RangeError('Invalid fragment group partition');
                seen[cell] = 1;
            }
        }
        for (const { groupId, trackId } of identity.observations) {
            if (!known.has(groupId) || mapping.has(groupId) || !Number.isSafeInteger(trackId) || trackId < 0 || assigned.has(trackId)
                || (groupId === 0) !== (trackId === 0))
                throw new RangeError('Fragment identities must map each original group one-to-one');
            mapping.set(groupId, trackId);
            assigned.add(trackId);
        }
        if (known.size !== mapping.size)
            throw new RangeError('Missing fragment identity');
        for (let cell = 0; cell < count; cell++) {
            const raw = frame.labels[cell], label = completed.labels[cell], reason = completed.provenance[cell];
            if (raw < -1 || label < -1 || (raw >= 0) !== Boolean(seen[cell])
                || (raw < 0 ? frame.confidence[cell] !== 0 : ![1, 2].includes(frame.confidence[cell]))
                || (raw >= 0 ? label !== raw || reason !== 1 : label < 0 ? reason !== 0 : !known.has(label) || ![2, 3].includes(reason))) {
                throw new RangeError('Completion must preserve the original fragment evidence');
            }
        }
        return { known, mapping };
    });
}
/** Inferred membership only: no source pixels, vectors, raw groups or identity history are modified. */
export function mergeFrameVectorFragments(groups, support, identities, options = {}) {
    const resolved = { enabled: options.enabled ?? true, maxCells: options.maxCells ?? 5, maxRun: options.maxRun ?? 1 };
    if (typeof resolved.enabled !== 'boolean' || !Number.isSafeInteger(resolved.maxCells) || resolved.maxCells < 1 || resolved.maxCells > 16
        || !Number.isSafeInteger(resolved.maxRun) || resolved.maxRun < 1 || resolved.maxRun > 4)
        throw new RangeError('Invalid fragment merge options');
    const validated = validate(groups, support, identities), { width, height, frameCount, cellSize } = groups;
    const { columns, rows } = support, history = new Map();
    for (const frame of identities.frames)
        for (const { trackId } of frame.observations) {
            if (!history.has(trackId))
                history.set(trackId, []);
            history.get(trackId).push(frame.frame);
        }
    const runs = identities.frames.map(() => new Map());
    for (const [track, frames] of history)
        for (let first = 0; first < frames.length;) {
            let end = first + 1;
            while (end < frames.length && frames[end] === frames[end - 1] + 1)
                end++;
            for (let i = first; i < end; i++)
                runs[frames[i]].set(track, end - first);
            first = end;
        }
    const frames = groups.frames.map((frame, index) => {
        const { mapping, known } = validated[index], completed = support.frames[index], raw = frame.labels;
        const output = { frame: index,
            trackLabels: Int32Array.from(completed.labels, id => id < 0 ? -1 : mapping.get(id)), merged: new Uint8Array(raw.length), merges: [] };
        if (!resolved.enabled)
            return output;
        const proposals = new Map();
        const sourceGroups = new Set();
        for (const component of components(raw, columns, rows)) {
            const runLength = runs[index].get(mapping.get(component.id));
            if (component.cells.length > resolved.maxCells * 4 || runLength > resolved.maxRun
                || component.cells.some(cell => cell % columns === 0 || cell % columns === columns - 1
                    || cell < columns || cell >= (rows - 1) * columns))
                continue;
            const boundary = new Set(), directions = new Map(), contacts = new Map();
            let cardinal = 0;
            for (const cell of component.cells)
                neighbors(cell, columns, rows, (next, direction) => {
                    if (raw[next] === component.id)
                        return;
                    boundary.add(next);
                    if (direction) {
                        cardinal++;
                        if (raw[next] >= 0) {
                            directions.set(raw[next], (directions.get(raw[next]) ?? 0) | direction);
                            contacts.set(raw[next], (contacts.get(raw[next]) ?? 0) + 1);
                        }
                    }
                });
            const owners = new Set([...boundary].map(cell => raw[cell]).filter(id => id > 0));
            // A third foreground owner is ambiguous. Background never absorbs or
            // supplies a fragment, even if completion painted an apparent enclosure.
            if (owners.size !== 1)
                continue;
            const owner = owners.values().next().value, host = mapping.get(owner);
            if ((known.get(owner) ?? 0) < component.cells.length * 4 || (history.get(host)?.length ?? 0) < 2)
                continue;
            const count = [...boundary].filter(cell => raw[cell] === owner).length, sides = directions.get(owner) ?? 0;
            const fully = [...boundary].every(cell => raw[cell] === -1 || raw[cell] === owner)
                && count >= boundary.size * .75 && sides === 15 && (contacts.get(owner) ?? 0) >= cardinal * .9;
            const partial = component.cells.length <= resolved.maxCells && count >= boundary.size * .5
                && [1, 2, 4, 8].filter(side => sides & side).length >= 2;
            if (!fully && !partial)
                continue;
            const proposal = { id: component.id, owner, cells: component.cells, reason: fully ? 'enclosed' : 'partial', runLength };
            for (const cell of component.cells)
                proposals.set(cell, proposal);
            sourceGroups.add(component.id);
        }
        // Inferred attachments follow only unanimous measured anchors in the same
        // original completed component. Decisions never grow hosts or merge chains.
        for (const component of components(completed.labels, columns, rows)) {
            const measuredCells = component.cells.filter(cell => raw[cell] === component.id);
            if (!measuredCells.length || component.cells.length > measuredCells.length * 4)
                continue;
            const first = proposals.get(measuredCells[0]);
            if (!first || sourceGroups.has(first.owner)
                || measuredCells.some(cell => proposals.get(cell)?.owner !== first.owner))
                continue;
            const fromTrackId = mapping.get(component.id), toTrackId = mapping.get(first.owner);
            for (const cell of component.cells) {
                output.trackLabels[cell] = toTrackId;
                output.merged[cell] = 1;
            }
            output.merges.push({ fromGroupId: component.id, toGroupId: first.owner, fromTrackId, toTrackId,
                cells: component.cells, measuredCells, reason: measuredCells.every(cell => proposals.get(cell).reason === 'enclosed') ? 'enclosed' : 'partial',
                runLength: first.runLength });
        }
        return output;
    });
    return { width, height, frameCount, cellSize, columns, rows, options: resolved, frames };
}
