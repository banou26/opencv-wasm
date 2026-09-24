export function checkPixelFrame(frame) {
    if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width < 8 || frame.height < 8
        || frame.data.length !== frame.width * frame.height * 3)
        throw new RangeError('Pixel frames need matching BGR data at least 8 by 8 pixels');
}
/** 16-bit sources keep their precision as fractions of an 8-bit code; 8-bit decodes are used unchanged. */
export function pixelFrame(frame) {
    const scale = frame.data instanceof Uint16Array ? 1 / 257 : 1;
    const data = new Float32Array(frame.data.length);
    for (let i = 0; i < data.length; i++)
        data[i] = frame.data[i] * scale;
    const out = { width: frame.width, height: frame.height, data };
    checkPixelFrame(out);
    return out;
}
/** Browser decoders return RGBA; alpha is dropped and channels reordered to BGR. */
export function pixelFrameFromRgba(width, height, rgba) {
    if (rgba.length !== width * height * 4)
        throw new RangeError('RGBA data must match the frame size');
    const data = new Float32Array(width * height * 3);
    for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
        data[p] = rgba[q + 2];
        data[p + 1] = rgba[q + 1];
        data[p + 2] = rgba[q];
    }
    const out = { width, height, data };
    checkPixelFrame(out);
    return out;
}
/** Rec. 709 weights applied to the stored BGR values. */
export function pixelLuma(frame) {
    const out = new Float32Array(frame.width * frame.height), data = frame.data;
    for (let p = 0, q = 0; p < out.length; p++, q += 3)
        out[p] = .0722 * data[q] + .7152 * data[q + 1] + .2126 * data[q + 2];
    return out;
}
