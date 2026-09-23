/**
 * Read-only raw motion vetoes beside the source-appearance event reports.
 * A redraw can explain why flow disagrees; it does not prove shared placement.
 * Missing pairs remain absent, and event evidence never edits the motion verdict.
 */
export function motionComparisonEvidence(tracks, history, timing, page = 0) {
    if (tracks.width !== history.width || tracks.height !== history.height
        || tracks.cellSize !== history.cellSize || tracks.frameCount !== history.frameCount) {
        throw new RangeError('Motion comparison geometry differs');
    }
    const pairs = history.comparisons.filter(pair => pair.status === 'different')
        .sort((a, b) => a.error - b.error || a.maximum - b.maximum || a.a - b.a || a.b - b.b);
    if (!Number.isSafeInteger(page) || page < 0 || page > 0 && page * 8 >= pairs.length) {
        throw new RangeError('Comparison page is outside the observed motion conflicts');
    }
    const families = new Map(history.families.flatMap(family => family.regionIds.map(id => [id, family.id])));
    const frames = [...tracks.frames].sort((a, b) => a.frame - b.frame);
    const observations = frames.map(frame => new Map(frame.observations.map(observation => [observation.id, observation])));
    const events = new Map(timing?.frames.map(frame => [frame.frame,
        new Map(frame.observations.map(observation => [observation.id, observation.event.status]))]));
    const comparisons = pairs.slice(page * 8, page * 8 + 8).map(pair => {
        const familyA = families.get(pair.a), familyB = families.get(pair.b);
        if (familyA === undefined || familyB === undefined)
            throw new RangeError('Motion comparison refers to an unknown region');
        const samples = [];
        for (const [i, frame] of frames.entries()) {
            const a = observations[i].get(pair.a), b = observations[i].get(pair.b);
            if (!a || !b)
                continue;
            const error = Math.hypot(a.dx - b.dx, a.dy - b.dy);
            samples.push({ frame: frame.frame, dxA: a.dx, dyA: a.dy, dxB: b.dx, dyB: b.dy,
                error, veto: error > history.options.tolerance,
                eventA: events.get(frame.frame)?.get(pair.a) ?? null, eventB: events.get(frame.frame)?.get(pair.b) ?? null });
        }
        return { a: pair.a, b: pair.b, familyA, familyB, error: pair.error, maximum: pair.maximum,
            tolerance: history.options.tolerance, samples };
    });
    return { pairCount: pairs.length, comparisons };
}
