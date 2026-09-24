import type { AnalysisFrame, SourceFrame } from './types.ts';
/** Full-resolution BGR analysis pixels in fractional 8-bit code units. Never exported artwork. */
export type PixelFrame = {
    width: number;
    height: number;
    data: Float32Array;
};
/** Content at A(x) appears at B(x + d). */
export type Translation = {
    dx: number;
    dy: number;
};
export declare function checkPixelFrame(frame: PixelFrame): void;
/** 16-bit sources keep their precision as fractions of an 8-bit code; 8-bit decodes are used unchanged. */
export declare function pixelFrame(frame: AnalysisFrame | SourceFrame): PixelFrame;
/** Browser decoders return RGBA; alpha is dropped and channels reordered to BGR. */
export declare function pixelFrameFromRgba(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): PixelFrame;
/** Rec. 709 weights applied to the stored BGR values. */
export declare function pixelLuma(frame: PixelFrame): Float32Array;
