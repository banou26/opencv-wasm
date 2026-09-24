import { groupFrameVectors } from "./vector-frame-groups.js";
function interior(cell, width, height, margin) {
    return cell.coherent && [0, 1].every(t => cell.x + t * cell.dx >= margin && cell.y + t * cell.dy >= margin
        && cell.x + cell.width + t * cell.dx <= width - margin
        && cell.y + cell.height + t * cell.dy <= height - margin);
}
function compare(a, b, bounds, candidate, reference) {
    const { width, height } = a;
    const visible = (x, y, motion) => x + motion.dx >= 0 && x + motion.dx <= width - 1
        && y + motion.dy >= 0 && y + motion.dy <= height - 1;
    const sample = (x, y, c) => {
        const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        const fx = x - x0, fy = y - y0;
        return (b.data[(y0 * width + x0) * 3 + c] * (1 - fx) + b.data[(y0 * width + x1) * 3 + c] * fx) * (1 - fy)
            + (b.data[(y1 * width + x0) * 3 + c] * (1 - fx) + b.data[(y1 * width + x1) * 3 + c] * fx) * fy;
    };
    let compared = 0, candidateVisible = 0, originalAbs = 0, originalSquare = 0, referenceAbs = 0, referenceSquare = 0;
    for (let y = Math.max(0, bounds.top); y < Math.min(height, bounds.bottom); y++) {
        for (let x = Math.max(0, bounds.left); x < Math.min(width, bounds.right); x++) {
            if (!visible(x, y, candidate))
                continue;
            candidateVisible++;
            if (!visible(x, y, reference))
                continue;
            compared++;
            for (let c = 0; c < 3; c++) {
                const value = a.data[(y * width + x) * 3 + c];
                const originalError = value - sample(x + candidate.dx, y + candidate.dy, c);
                const referenceError = value - sample(x + reference.dx, y + reference.dy, c);
                originalAbs += Math.abs(originalError);
                originalSquare += originalError * originalError;
                referenceAbs += Math.abs(referenceError);
                referenceSquare += referenceError * referenceError;
            }
        }
    }
    const denominator = compared * 3 || 1;
    return { compared, candidateVisible,
        candidate: { mae: originalAbs / denominator, mse: originalSquare / denominator },
        reference: { mae: referenceAbs / denominator, mse: referenceSquare / denominator } };
}
const wins = (score, minimum, maximumError) => score.compared >= minimum
    && score.reference.mae <= maximumError && score.candidate.mae - score.reference.mae >= .5
    && score.reference.mae <= score.candidate.mae * .5 && score.reference.mse <= score.candidate.mse * .5;
function preservesPartition(before, after, corrected) {
    const a = before.frames[0].labels, b = after.frames[0].labels;
    const forward = new Map(), backward = new Map();
    for (const [index, old] of a.entries()) {
        const next = b[index];
        if (corrected.has(index)) {
            if (next !== 0)
                return false;
            continue;
        }
        if (old < 0 || next < 0) {
            if (old !== next)
                return false;
            continue;
        }
        if (old === 0 && next !== 0 || forward.has(old) && forward.get(old) !== next
            || backward.has(next) && backward.get(next) !== old)
            return false;
        forward.set(old, next);
        backward.set(next, old);
    }
    return true;
}
/**
 * Check border-only velocity modes against a well-supported interior motion.
 * Only genuinely observed pixels may overturn a candidate. Raw flow, the input
 * grid and coverage/confidence stay intact; explicit corrections describe the
 * derived grid. This is motion refinement, not a layer-ownership measurement.
 */
export function refineVectorBorders(a, b, grid) {
    const { width, height } = a;
    if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1
        || b.width !== width || b.height !== height || a.data.length !== width * height * 3 || b.data.length !== a.data.length) {
        throw new RangeError('Border refinement requires matching analysis frames');
    }
    const sequence = (candidateGrid) => ({ width, height, frameCount: 2,
        pairs: [{ frame: 0, flow: { width, height }, grids: [candidateGrid] }] });
    const coarseOptions = { splitSubtleMotion: false, splitDistantRegions: false };
    const grouped = groupFrameVectors(sequence(grid), coarseOptions);
    const output = { ...grid, cells: grid.cells.map(cell => ({ ...cell })) }, corrections = [];
    const groups = grouped.frames[0].observations, dominant = groups[0], margin = grid.cellSize * 2;
    if (!dominant || dominant.cells.filter(index => interior(grid.cells[index], width, height, margin)).length < 12) {
        return { grid: output, corrections };
    }
    const reference = { dx: dominant.dx, dy: dominant.dy };
    for (const group of groups.slice(1)) {
        if (group.cells.some(index => interior(grid.cells[index], width, height, margin)))
            continue;
        for (const index of group.cells) {
            const cell = grid.cells[index];
            // An interior cell is never changed just because its small group is weak.
            if ([0, 1].every(t => cell.x + t * cell.dx >= margin && cell.y + t * cell.dy >= margin
                && cell.x + cell.width + t * cell.dx <= width - margin && cell.y + cell.height + t * cell.dy <= height - margin))
                continue;
            const original = { dx: cell.dx, dy: cell.dy };
            const footprint = compare(a, b, { left: cell.x, top: cell.y, right: cell.x + cell.width, bottom: cell.y + cell.height }, original, reference);
            // A model must not improve its score by moving the distinguishing pixels
            // offscreen. This matters for a genuinely entering foreground object.
            if (footprint.compared !== footprint.candidateVisible || !wins(footprint, 8, 4))
                continue;
            const radius = Math.ceil(grid.cellSize * 1.5), cx = cell.x + cell.width / 2, cy = cell.y + cell.height / 2;
            const context = compare(a, b, { left: Math.floor(cx - radius), top: Math.floor(cy - radius),
                right: Math.ceil(cx + radius), bottom: Math.ceil(cy + radius) }, original, reference);
            if (!wins(context, 32, 8))
                continue;
            output.cells[index] = { ...cell, ...reference };
            corrections.push({ cell: index, motionId: group.motionId, original, replacement: { ...reference }, footprint, context });
        }
    }
    if (corrections.length) {
        // Greedy velocity pooling can regroup untouched weak remnants when their
        // border witnesses move. Accept a batch only when no other partition changes,
        // both before and after the approved subtle-motion/proximity refinements.
        const changed = new Set(corrections.map(correction => correction.cell));
        if (!preservesPartition(grouped, groupFrameVectors(sequence(output), coarseOptions), changed)
            || !preservesPartition(groupFrameVectors(sequence(grid)), groupFrameVectors(sequence(output)), changed)) {
            for (const correction of corrections)
                output.cells[correction.cell] = { ...grid.cells[correction.cell] };
            return { grid: output, corrections: [] };
        }
    }
    return { grid: output, corrections };
}
