import { BORDER_REFLECT_101, COLOR_BGR2RGBA, COLOR_GRAY2RGBA, COLOR_RGBA2GRAY, CV_8U, CV_8UC3, CV_32F, CV_64F, INTER_LINEAR, Mat, calcOpticalFlowFarneback, cornerMinEigenVal, createHanningWindow, cvtColor, matFromArray, minMaxLoc, phaseCorrelate, transform, warpAffine, } from '@banou/opencv-wasm';
import { poolMotion } from "./flow.js";
function validateFrame(frame) {
    if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height)
        || frame.width < 8 || frame.height < 8 || !Number.isSafeInteger(frame.width * frame.height * 3)
        || frame.data.length !== frame.width * frame.height * 3) {
        throw new RangeError('Vector candidates require matching BGR data at least 8 by 8 pixels');
    }
}
/**
 * Regional motion vectors prefab proposals, not verified pixel ownership.
 * Float Rec601, sequential reflected X/Y alignment, and relative texture gates
 * follow the editor primitives. Unlike strict dense motion, grain and reflected
 * edge patches may pass. Await initOpenCV first; input pixels are never changed.
 * Parity starts at these 8-bit analysis pixels: upstream float editor resizing
 * can differ from a decoder or a resize already rounded to 8-bit BGR.
 */
export function estimateVectorCandidates(a, b, options = {}) {
    validateFrame(a);
    validateFrame(b);
    if (a.width !== b.width || a.height !== b.height)
        throw new RangeError('Vector candidate frame sizes differ');
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
    const { width, height } = a, size = { width, height }, owned = [];
    const keep = (matrix) => { owned.push(matrix); return matrix; };
    try {
        const weights = keep(matFromArray(1, 4, CV_32F, [.299, .587, .114, 0]));
        const grayscaleFrame = (frame) => {
            const source = keep(matFromArray(height, width, CV_8UC3, frame.data));
            const rgba = keep(new Mat()), unit = keep(new Mat()), gray = keep(new Mat()), result = keep(new Mat());
            cvtColor(source, rgba, COLOR_BGR2RGBA);
            rgba.convertTo(unit, CV_32F, 1 / 255);
            transform(unit, gray, weights);
            cvtColor(gray, result, COLOR_GRAY2RGBA);
            return result;
        };
        const frameA = grayscaleFrame(a), frameB = grayscaleFrame(b);
        const phaseA = keep(new Mat()), phaseB = keep(new Mat()), hann = keep(new Mat());
        cvtColor(frameA, phaseA, COLOR_RGBA2GRAY);
        cvtColor(frameB, phaseB, COLOR_RGBA2GRAY);
        createHanningWindow(hann, size, CV_32F);
        const phase = phaseCorrelate(phaseA, phaseB, hann);
        const used = Number.isFinite(phase.value.x) && Number.isFinite(phase.value.y)
            && Number.isFinite(phase.response) && phase.response >= .1
            && Math.abs(phase.value.x) < width * .45 && Math.abs(phase.value.y) < height * .45;
        const dx = used ? phase.value.x : 0, dy = used ? phase.value.y : 0;
        const pan = { dx, dy, response: Number.isFinite(phase.response) ? phase.response : 0, used };
        const gray8 = (frame) => {
            const gray = keep(new Mat()), bytes = keep(new Mat());
            cvtColor(frame, gray, COLOR_RGBA2GRAY);
            gray.convertTo(bytes, CV_8U, 255);
            return bytes;
        };
        const align = (frame, x, y) => {
            const matrixX = keep(matFromArray(2, 3, CV_64F, [1, 0, x, 0, 1, 0]));
            const matrixY = keep(matFromArray(2, 3, CV_64F, [1, 0, 0, 0, 1, y]));
            const shiftedX = keep(new Mat()), shiftedY = keep(new Mat());
            warpAffine(frame, shiftedX, matrixX, size, INTER_LINEAR, BORDER_REFLECT_101, [0, 0, 0, 1]);
            warpAffine(shiftedX, shiftedY, matrixY, size, INTER_LINEAR, BORDER_REFLECT_101, [0, 0, 0, 1]);
            return gray8(shiftedY);
        };
        const grayA = gray8(frameA), grayB = gray8(frameB);
        const alignedB = align(frameB, -dx, -dy), alignedA = align(frameA, dx, dy);
        const forward = keep(new Mat()), backward = keep(new Mat()), texture = keep(new Mat());
        calcOpticalFlowFarneback(grayA, alignedB, forward, .5, levels, window, 5, 7, 1.5, 0);
        calcOpticalFlowFarneback(grayB, alignedA, backward, .5, levels, window, 5, 7, 1.5, 0);
        cornerMinEigenVal(grayA, texture, 7, 3);
        const peak = minMaxLoc(texture).maxVal;
        texture.convertTo(texture, CV_32F, peak > 1e-9 ? 1 / peak : 0);
        // Native allocations may grow WASM memory, so acquire views only afterward.
        const vectors = forward.data32F.slice(), reverse = backward.data32F.slice(), eigen = texture.data32F.slice();
        const valid = new Uint8Array(width * height), roundTrip = new Float32Array(width * height).fill(NaN);
        for (let p = 0; p < valid.length; p++) {
            vectors[p * 2] += dx;
            vectors[p * 2 + 1] += dy;
            reverse[p * 2] -= dx;
            reverse[p * 2 + 1] -= dy;
        }
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const p = y * width + x, vx = vectors[p * 2], vy = vectors[p * 2 + 1];
                const qx = x + vx, qy = y + vy;
                if (!Number.isFinite(qx) || !Number.isFinite(qy) || qx < 0 || qy < 0 || qx > width - 1 || qy > height - 1)
                    continue;
                const x0 = Math.floor(qx), y0 = Math.floor(qy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
                const fx = qx - x0, fy = qy - y0;
                const sample = (c) => (reverse[(y0 * width + x0) * 2 + c] * (1 - fx) + reverse[(y0 * width + x1) * 2 + c] * fx) * (1 - fy)
                    + (reverse[(y1 * width + x0) * 2 + c] * (1 - fx) + reverse[(y1 * width + x1) * 2 + c] * fx) * fy;
                const error = Math.hypot(vx + sample(0), vy + sample(1));
                if (!Number.isFinite(error))
                    continue;
                roundTrip[p] = error;
                if (eigen[p] > textureFraction && error <= tolerance)
                    valid[p] = 255;
            }
        return { width, height, vectors, valid, roundTrip, pan };
    }
    finally {
        for (const matrix of owned.reverse())
            matrix.delete();
    }
}
/** Median proposals retain mixed cells; coherent/spread remain diagnostics. */
export function poolVectorCandidates(flow, cellSize) {
    return poolMotion(flow, cellSize);
}
