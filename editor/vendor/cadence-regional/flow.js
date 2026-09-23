import { BORDER_CONSTANT, COLOR_BGR2GRAY, CV_8UC3, CV_32F, CV_64FC1, INTER_LINEAR, Mat, calcOpticalFlowFarneback, cornerMinEigenVal, createHanningWindow, cvtColor, matFromArray, minMaxLoc, phaseCorrelate, warpAffine, } from '@banou/opencv-wasm';
function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || !Number.isSafeInteger(width * height * 3))
        throw new RangeError('Invalid flow image dimensions');
}
function validateFrame(frame) {
    dimensions(frame.width, frame.height);
    if (frame.width < 32 || frame.height < 32 || frame.data.length !== frame.width * frame.height * 3) {
        throw new RangeError('Dense flow requires matching BGR data at least 32 by 32 pixels');
    }
}
function median(values) {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}
/**
 * One A-to-B measurement field shared by every later grid scale. Await
 * initOpenCV first. Raw vectors remain available even when valid is zero;
 * an unsupported vector is never evidence of a stationary layer.
 */
export function estimateDenseMotion(a, b, options = {}) {
    validateFrame(a);
    validateFrame(b);
    if (a.width !== b.width || a.height !== b.height)
        throw new RangeError('Dense flow frame sizes differ');
    const window = options.window ?? 25, levels = options.levels ?? 4;
    const tolerance = options.roundTrip ?? 1.5, textureFraction = options.textureFraction ?? .005;
    if (!Number.isInteger(window) || window < 5 || window > 61 || window % 2 !== 1)
        throw new RangeError('Flow window must be odd, between 5 and 61');
    if (!Number.isInteger(levels) || levels < 1 || levels > 6)
        throw new RangeError('Flow pyramid levels must be between 1 and 6');
    if (!Number.isFinite(tolerance) || tolerance < 0)
        throw new RangeError('Round-trip tolerance must be finite and nonnegative');
    if (!Number.isFinite(textureFraction) || textureFraction <= 0 || textureFraction > 1)
        throw new RangeError('Texture fraction must be in (0, 1]');
    const { width, height } = a;
    const owned = [];
    const keep = (matrix) => { owned.push(matrix); return matrix; };
    try {
        const sourceA = keep(matFromArray(height, width, CV_8UC3, a.data));
        const sourceB = keep(matFromArray(height, width, CV_8UC3, b.data));
        const grayA = keep(new Mat()), grayB = keep(new Mat());
        cvtColor(sourceA, grayA, COLOR_BGR2GRAY);
        cvtColor(sourceB, grayB, COLOR_BGR2GRAY);
        const floatA = keep(new Mat()), floatB = keep(new Mat()), hann = keep(new Mat());
        grayA.convertTo(floatA, CV_32F);
        grayB.convertTo(floatB, CV_32F);
        createHanningWindow(hann, { width, height }, CV_32F);
        const phase = phaseCorrelate(floatA, floatB, hann);
        const used = Number.isFinite(phase.value.x) && Number.isFinite(phase.value.y)
            && Number.isFinite(phase.response) && phase.response >= .1
            && Math.abs(phase.value.x) < width * .45 && Math.abs(phase.value.y) < height * .45;
        const dx = used ? phase.value.x : 0, dy = used ? phase.value.y : 0;
        const pan = { dx, dy, response: Number.isFinite(phase.response) ? phase.response : 0, used };
        const toA = keep(matFromArray(2, 3, CV_64FC1, [1, 0, -dx, 0, 1, -dy]));
        const toB = keep(matFromArray(2, 3, CV_64FC1, [1, 0, dx, 0, 1, dy]));
        const alignedB = keep(new Mat()), alignedA = keep(new Mat());
        warpAffine(grayB, alignedB, toA, { width, height }, INTER_LINEAR, BORDER_CONSTANT, [0, 0, 0, 0]);
        warpAffine(grayA, alignedA, toB, { width, height }, INTER_LINEAR, BORDER_CONSTANT, [0, 0, 0, 0]);
        const forward = keep(new Mat()), backward = keep(new Mat()), texture = keep(new Mat());
        calcOpticalFlowFarneback(grayA, alignedB, forward, .5, levels, window, 5, 7, 1.5, 0);
        calcOpticalFlowFarneback(grayB, alignedA, backward, .5, levels, window, 5, 7, 1.5, 0);
        cornerMinEigenVal(grayA, texture, 7, 3);
        const peak = minMaxLoc(texture).maxVal;
        // Copy only after native allocations finish: WASM growth can detach old views.
        const vectors = forward.data32F.slice(), reverse = backward.data32F.slice(), eigen = texture.data32F.slice();
        const valid = new Uint8Array(width * height), roundTrip = new Float32Array(width * height).fill(NaN);
        for (let p = 0; p < valid.length; p++) {
            vectors[p * 2] += dx;
            vectors[p * 2 + 1] += dy;
            reverse[p * 2] -= dx;
            reverse[p * 2 + 1] -= dy;
        }
        // Require real source pixels for both full-resolution flow patches, their
        // polynomial neighborhoods, and alignment interpolation. This does not
        // certify correspondence or remove the influence of coarse-level smoothing.
        const margin = Math.ceil(window / 2) + 4;
        const observed = (x, y) => Math.floor(x) >= margin && Math.floor(y) >= margin
            && Math.ceil(x) <= width - 1 - margin && Math.ceil(y) <= height - 1 - margin;
        const sample = (x, y, c) => {
            const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
            const fx = x - x0, fy = y - y0;
            return (reverse[(y0 * width + x0) * 2 + c] * (1 - fx) + reverse[(y0 * width + x1) * 2 + c] * fx) * (1 - fy)
                + (reverse[(y1 * width + x0) * 2 + c] * (1 - fx) + reverse[(y1 * width + x1) * 2 + c] * fx) * fy;
        };
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const p = y * width + x, vx = vectors[p * 2], vy = vectors[p * 2 + 1];
                const qx = x + vx, qy = y + vy;
                if (!Number.isFinite(qx) || !Number.isFinite(qy) || qx < 0 || qy < 0 || qx > width - 1 || qy > height - 1)
                    continue;
                const error = Math.hypot(vx + sample(qx, qy, 0), vy + sample(qx, qy, 1));
                if (!Number.isFinite(error))
                    continue;
                roundTrip[p] = error;
                if (peak <= 1e-9 || eigen[p] < peak * textureFraction || error > tolerance)
                    continue;
                if (!observed(x, y) || !observed(qx, qy) || !observed(x + dx, y + dy) || !observed(qx - dx, qy - dy))
                    continue;
                valid[p] = 255;
            }
        return { width, height, vectors, valid, roundTrip, pan };
    }
    finally {
        for (const matrix of owned.reverse())
            matrix.delete();
    }
}
/** Pool, never re-estimate, the same accepted field. Mixed cells are explicitly incoherent. */
export function poolMotion(flow, cellSize) {
    const { width, height, vectors, valid, roundTrip } = flow;
    dimensions(width, height);
    if (vectors.length !== width * height * 2 || valid.length !== width * height || roundTrip.length !== width * height) {
        throw new RangeError('Dense flow array dimensions differ');
    }
    if (!Number.isSafeInteger(cellSize) || cellSize < 1)
        throw new RangeError('Cell size must be a positive integer');
    const cells = [];
    for (let y = 0; y < height; y += cellSize)
        for (let x = 0; x < width; x += cellSize) {
            const w = Math.min(cellSize, width - x), h = Math.min(cellSize, height - y);
            const xs = [], ys = [];
            for (let py = y; py < y + h; py++)
                for (let px = x; px < x + w; px++) {
                    const p = py * width + px;
                    if (!valid[p] || !Number.isFinite(vectors[p * 2]) || !Number.isFinite(vectors[p * 2 + 1]))
                        continue;
                    xs.push(vectors[p * 2]);
                    ys.push(vectors[p * 2 + 1]);
                }
            const accepted = xs.length, coverage = accepted / (w * h);
            if (accepted < Math.max(8, Math.ceil(w * h * .05))) {
                cells.push({ x, y, width: w, height: h, dx: null, dy: null, accepted, coverage, spread: null, coherent: false });
                continue;
            }
            // Median sorts its inputs, so keep the original x/y pairings for spread.
            const dx = median(xs.slice()), dy = median(ys.slice());
            const residuals = xs.map((value, i) => Math.hypot(value - dx, ys[i] - dy)).sort((a, b) => a - b);
            const spread = residuals[Math.ceil(accepted * .9) - 1];
            cells.push({ x, y, width: w, height: h, dx, dy, accepted, coverage, spread, coherent: spread <= 1 });
        }
    return { cellSize, columns: Math.ceil(width / cellSize), rows: Math.ceil(height / cellSize), cells };
}
