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
    if (!Number.isFinite(groups.options?.tolerance) || groups.options.tolerance <= 0)
        throw new RangeError('Invalid fragment motion tolerance');
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
            if (!Number.isSafeInteger(group.id) || group.id < 0 || known.has(group.id) || !group.cells.length
                || !Number.isFinite(group.dx) || !Number.isFinite(group.dy))
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
    const camera = [{ x: 0, y: 0, missing: 0 }];
    for (const frame of groups.frames) {
        const dominant = frame.observations.find(group => group.id === 0), previous = camera.at(-1);
        camera.push({ x: previous.x + (dominant?.dx ?? 0), y: previous.y + (dominant?.dy ?? 0),
            missing: previous.missing + Number(!dominant) });
    }
    const temporalEvidence = (index, cells, child, host) => {
        const observations = history.get(host);
        const before = observations.filter(frame => frame < index && index - frame <= 12).slice(-3).reverse();
        const after = observations.filter(frame => frame > index && frame - index <= 12).slice(0, 3);
        const witness = (frame) => {
            if (camera[frame].missing !== camera[index].missing)
                return;
            const dx = camera[frame].x - camera[index].x, dy = camera[frame].y - camera[index].y;
            const raw = groups.frames[frame], mapping = validated[frame].mapping, covered = [];
            for (const cell of cells) {
                const left = cell % columns * cellSize, top = Math.floor(cell / columns) * cellSize;
                const x = (left + Math.min(width, left + cellSize)) / 2 + dx;
                const y = (top + Math.min(height, top + cellSize)) / 2 + dy;
                if (x < 0 || y < 0 || x >= width || y >= height)
                    return;
                const target = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
                const track = mapping.get(raw.labels[target]) ?? -1;
                if (track > 0 && track !== host && track !== child)
                    return;
                if (track === host && raw.confidence[target] === 2)
                    covered.push(cell);
            }
            return covered.length >= cells.length * .75 ? { frame, cells: covered } : undefined;
        };
        const past = before.map(witness).filter((item) => Boolean(item));
        const future = after.map(witness).filter((item) => Boolean(item));
        const pairs = [];
        for (const a of past)
            for (const b of future)
                pairs.push({ mode: 'bracketed', witnesses: [a, b] });
        if (observations[0] === index && history.get(child)[0] === index) {
            for (let a = 0; a < future.length; a++)
                for (let b = a + 1; b < future.length; b++) {
                    pairs.push({ mode: 'birth', witnesses: [future[a], future[b]] });
                }
        }
        pairs.sort((a, b) => a.witnesses.reduce((sum, item) => sum + Math.abs(item.frame - index), 0)
            - b.witnesses.reduce((sum, item) => sum + Math.abs(item.frame - index), 0)
            || a.witnesses[0].frame - b.witnesses[0].frame || a.witnesses[1].frame - b.witnesses[1].frame);
        for (const pair of pairs) {
            const covered = new Set(pair.witnesses[1].cells), commonCells = pair.witnesses[0].cells.filter(cell => covered.has(cell));
            if (commonCells.length >= cells.length * .75)
                return { cells, ...pair, commonCells };
        }
    };
    const frames = groups.frames.map((frame, index) => {
        const { mapping, known } = validated[index], completed = support.frames[index], raw = frame.labels;
        const output = { frame: index,
            trackLabels: Int32Array.from(completed.labels, id => id < 0 ? -1 : mapping.get(id)), merged: new Uint8Array(raw.length), merges: [] };
        if (!resolved.enabled)
            return output;
        const proposals = new Map(), temporalProposals = new Map();
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
            const background = [...boundary].filter(cell => raw[cell] === 0).length;
            // At a parallax boundary, a near trunk can partially wrap flow bleeding
            // from the far background. A bare foreground majority is not sufficient.
            // Missing motion abstains from the ownership vote, but at least half
            // the boundary still needs measured support before a partial merge.
            const partialBoundary = count + background >= boundary.size * .5
                && count >= background * 2 && [1, 2, 4, 8].filter(side => sides & side).length >= 2;
            const partial = component.cells.length <= resolved.maxCells && partialBoundary;
            const dominant = frame.observations.find(group => group.id === 0);
            const child = frame.observations.find(group => group.id === component.id);
            const parent = frame.observations.find(group => group.id === owner);
            // Incomplete enclosure cannot override clear independent motion.
            const contradictsMotion = dominant && Math.hypot(parent.dx - dominant.dx, parent.dy - dominant.dy) > groups.options.tolerance
                && Math.hypot(child.dx - dominant.dx, child.dy - dominant.dy) * 2
                    < Math.hypot(child.dx - parent.dx, child.dy - parent.dy);
            if (fully || partial) {
                if (count < boundary.size * .5 && contradictsMotion)
                    continue;
                const proposal = { id: component.id, owner, cells: component.cells, reason: fully ? 'enclosed' : 'partial', runLength };
                for (const cell of component.cells)
                    proposals.set(cell, proposal);
                sourceGroups.add(component.id);
            }
            else if (component.cells.length > resolved.maxCells && partialBoundary && !contradictsMotion) {
                const temporal = temporalEvidence(index, component.cells, mapping.get(component.id), host);
                if (!temporal)
                    continue;
                const proposal = { id: component.id, owner, cells: component.cells, reason: 'temporal', runLength, temporal };
                for (const cell of component.cells)
                    temporalProposals.set(cell, proposal);
            }
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
        // Preserve the spatial pass before considering temporal additions. New
        // proposals cannot veto or retarget an already accepted local decision.
        const baseTargets = new Set([...proposals.values()].map(item => item.owner));
        const temporalSources = new Set([...temporalProposals.values()].map(item => item.id));
        for (const component of components(completed.labels, columns, rows)) {
            if (component.cells.some(cell => output.merged[cell]) || baseTargets.has(component.id))
                continue;
            const measuredCells = component.cells.filter(cell => raw[cell] === component.id), first = temporalProposals.get(measuredCells[0]);
            if (!first || component.cells.length > measuredCells.length * 4 || sourceGroups.has(first.owner) || temporalSources.has(first.owner)
                || measuredCells.some(cell => temporalProposals.get(cell)?.owner !== first.owner))
                continue;
            const fromTrackId = mapping.get(component.id), toTrackId = mapping.get(first.owner);
            const evidence = [...new Set(measuredCells.map(cell => temporalProposals.get(cell).temporal))];
            for (const cell of component.cells) {
                output.trackLabels[cell] = toTrackId;
                output.merged[cell] = 1;
            }
            output.merges.push({ fromGroupId: component.id, toGroupId: first.owner, fromTrackId, toTrackId,
                cells: component.cells, measuredCells, reason: 'temporal', runLength: first.runLength, temporal: evidence });
        }
        return output;
    });
    return { width, height, frameCount, cellSize, columns, rows, options: resolved, frames };
}
