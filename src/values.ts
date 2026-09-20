import type { DMatch as NativeDMatch, KeyPoint as NativeKeyPoint, MainModule, Point2f, RotatedRect as NativeRotatedRect, Size2f } from '../lib/opencv.js'

/** A feature location stored as an ordinary JavaScript value. No disposal is needed. */
export class KeyPoint implements NativeKeyPoint {
  /** Feature center in image pixel coordinates. */
  pt: Point2f
  /** Create a feature location with its detector scale, orientation and classification metadata. */
  constructor(x = 0, y = 0,
    /** Diameter of the meaningful feature neighborhood, in pixels. */
    public size = 0,
    /** Clockwise orientation in degrees [0, 360), or -1 when unspecified. */
    public angle = -1,
    /** Detector response used to rank features. */
    public response = 0,
    /** Pyramid octave in which the feature was detected. */
    public octave = 0,
    /** Application-assigned feature classification identifier, or -1. */
    public class_id = -1) {
    this.pt = { x, y }
  }
}

/** A descriptor match stored as an ordinary JavaScript value. */
export class DMatch implements NativeDMatch {
  /** Create a descriptor correspondence. Smaller distances indicate closer matches under the chosen metric. */
  constructor(
    /** Descriptor row in the query set. */
    public queryIdx = -1,
    /** Descriptor row in the matched training set. */
    public trainIdx = -1,
    /** Training image/set index. */
    public imgIdx = -1,
    /** Descriptor distance under the matcher's metric. */
    public distance = Number.MAX_VALUE) {}
}

/** A rotated rectangle stored as an ordinary JavaScript value. */
export class RotatedRect implements NativeRotatedRect {
  /** Create a rectangle described by its center, extent and clockwise rotation. */
  constructor(
    /** Center in image coordinates. */
    public center: Point2f = { x: 0, y: 0 },
    /** Rectangle width and height before rotation. */
    public size: Size2f = { width: 0, height: 0 },
    /** Clockwise rotation in degrees. */
    public angle = 0) {}
}

/** Construct an OpenCV 5 matrix type code with a supported depth and 1 to 128 channels. */
export const CV_MAKETYPE = (depth: number, channels: number): number => {
  if (!Number.isInteger(depth) || depth < 0 || depth > 12 || !Number.isInteger(channels) || channels < 1 || channels > 128) {
    throw new RangeError('Expected depth 0..12 and channel count 1..128')
  }
  return depth + ((channels - 1) << 5)
}

/** JavaScript value constructors and OpenCV 5 matrix type constants/functions. */
export const valueAPI = {
  KeyPoint, DMatch, RotatedRect, CV_MAKETYPE,
  /** Alias for CV_MAKETYPE: combine a supported matrix depth and channel count. */
  CV_MAKE_TYPE: CV_MAKETYPE,
  /** Depth code for unsigned 8-bit integer elements. */
  CV_8U: 0,
  /** Matrix type with 1 unsigned 8-bit integer channels. */
  CV_8UC1: 0,
  /** Matrix type with 2 unsigned 8-bit integer channels. */
  CV_8UC2: 32,
  /** Matrix type with 3 unsigned 8-bit integer channels. */
  CV_8UC3: 64,
  /** Matrix type with 4 unsigned 8-bit integer channels. */
  CV_8UC4: 96,
  /** Construct an unsigned 8-bit integer matrix type with 1 to 128 channels. */
  CV_8UC: (channels: number) => CV_MAKETYPE(0, channels),
  /** Depth code for signed 8-bit integer elements. */
  CV_8S: 1,
  /** Matrix type with 1 signed 8-bit integer channels. */
  CV_8SC1: 1,
  /** Matrix type with 2 signed 8-bit integer channels. */
  CV_8SC2: 33,
  /** Matrix type with 3 signed 8-bit integer channels. */
  CV_8SC3: 65,
  /** Matrix type with 4 signed 8-bit integer channels. */
  CV_8SC4: 97,
  /** Construct a signed 8-bit integer matrix type with 1 to 128 channels. */
  CV_8SC: (channels: number) => CV_MAKETYPE(1, channels),
  /** Depth code for unsigned 16-bit integer elements. */
  CV_16U: 2,
  /** Matrix type with 1 unsigned 16-bit integer channels. */
  CV_16UC1: 2,
  /** Matrix type with 2 unsigned 16-bit integer channels. */
  CV_16UC2: 34,
  /** Matrix type with 3 unsigned 16-bit integer channels. */
  CV_16UC3: 66,
  /** Matrix type with 4 unsigned 16-bit integer channels. */
  CV_16UC4: 98,
  /** Construct an unsigned 16-bit integer matrix type with 1 to 128 channels. */
  CV_16UC: (channels: number) => CV_MAKETYPE(2, channels),
  /** Depth code for signed 16-bit integer elements. */
  CV_16S: 3,
  /** Matrix type with 1 signed 16-bit integer channels. */
  CV_16SC1: 3,
  /** Matrix type with 2 signed 16-bit integer channels. */
  CV_16SC2: 35,
  /** Matrix type with 3 signed 16-bit integer channels. */
  CV_16SC3: 67,
  /** Matrix type with 4 signed 16-bit integer channels. */
  CV_16SC4: 99,
  /** Construct a signed 16-bit integer matrix type with 1 to 128 channels. */
  CV_16SC: (channels: number) => CV_MAKETYPE(3, channels),
  /** Depth code for signed 32-bit integer elements. */
  CV_32S: 4,
  /** Matrix type with 1 signed 32-bit integer channels. */
  CV_32SC1: 4,
  /** Matrix type with 2 signed 32-bit integer channels. */
  CV_32SC2: 36,
  /** Matrix type with 3 signed 32-bit integer channels. */
  CV_32SC3: 68,
  /** Matrix type with 4 signed 32-bit integer channels. */
  CV_32SC4: 100,
  /** Construct a signed 32-bit integer matrix type with 1 to 128 channels. */
  CV_32SC: (channels: number) => CV_MAKETYPE(4, channels),
  /** Depth code for 32-bit floating-point elements. */
  CV_32F: 5,
  /** Matrix type with 1 32-bit floating-point channels. */
  CV_32FC1: 5,
  /** Matrix type with 2 32-bit floating-point channels. */
  CV_32FC2: 37,
  /** Matrix type with 3 32-bit floating-point channels. */
  CV_32FC3: 69,
  /** Matrix type with 4 32-bit floating-point channels. */
  CV_32FC4: 101,
  /** Construct a 32-bit floating-point matrix type with 1 to 128 channels. */
  CV_32FC: (channels: number) => CV_MAKETYPE(5, channels),
  /** Depth code for 64-bit floating-point elements. */
  CV_64F: 6,
  /** Matrix type with 1 64-bit floating-point channels. */
  CV_64FC1: 6,
  /** Matrix type with 2 64-bit floating-point channels. */
  CV_64FC2: 38,
  /** Matrix type with 3 64-bit floating-point channels. */
  CV_64FC3: 70,
  /** Matrix type with 4 64-bit floating-point channels. */
  CV_64FC4: 102,
  /** Construct a 64-bit floating-point matrix type with 1 to 128 channels. */
  CV_64FC: (channels: number) => CV_MAKETYPE(6, channels),
  /** Depth code for half-precision floating-point elements. */
  CV_16F: 7,
  /** Matrix type with 1 half-precision floating-point channels. */
  CV_16FC1: 7,
  /** Matrix type with 2 half-precision floating-point channels. */
  CV_16FC2: 39,
  /** Matrix type with 3 half-precision floating-point channels. */
  CV_16FC3: 71,
  /** Matrix type with 4 half-precision floating-point channels. */
  CV_16FC4: 103,
  /** Construct a half-precision floating-point matrix type with 1 to 128 channels. */
  CV_16FC: (channels: number) => CV_MAKETYPE(7, channels),
  /** Depth code for bfloat16 elements. */
  CV_16BF: 8,
  /** Matrix type with 1 bfloat16 channels. */
  CV_16BFC1: 8,
  /** Matrix type with 2 bfloat16 channels. */
  CV_16BFC2: 40,
  /** Matrix type with 3 bfloat16 channels. */
  CV_16BFC3: 72,
  /** Matrix type with 4 bfloat16 channels. */
  CV_16BFC4: 104,
  /** Construct a bfloat16 matrix type with 1 to 128 channels. */
  CV_16BFC: (channels: number) => CV_MAKETYPE(8, channels),
  /** Depth code for boolean elements. */
  CV_Bool: 9,
  /** Matrix type with 1 boolean channels. */
  CV_BoolC1: 9,
  /** Matrix type with 2 boolean channels. */
  CV_BoolC2: 41,
  /** Matrix type with 3 boolean channels. */
  CV_BoolC3: 73,
  /** Matrix type with 4 boolean channels. */
  CV_BoolC4: 105,
  /** Construct a boolean matrix type with 1 to 128 channels. */
  CV_BoolC: (channels: number) => CV_MAKETYPE(9, channels),
  /** Depth code for unsigned 64-bit integer elements. */
  CV_64U: 10,
  /** Matrix type with 1 unsigned 64-bit integer channels. */
  CV_64UC1: 10,
  /** Matrix type with 2 unsigned 64-bit integer channels. */
  CV_64UC2: 42,
  /** Matrix type with 3 unsigned 64-bit integer channels. */
  CV_64UC3: 74,
  /** Matrix type with 4 unsigned 64-bit integer channels. */
  CV_64UC4: 106,
  /** Construct an unsigned 64-bit integer matrix type with 1 to 128 channels. */
  CV_64UC: (channels: number) => CV_MAKETYPE(10, channels),
  /** Depth code for signed 64-bit integer elements. */
  CV_64S: 11,
  /** Matrix type with 1 signed 64-bit integer channels. */
  CV_64SC1: 11,
  /** Matrix type with 2 signed 64-bit integer channels. */
  CV_64SC2: 43,
  /** Matrix type with 3 signed 64-bit integer channels. */
  CV_64SC3: 75,
  /** Matrix type with 4 signed 64-bit integer channels. */
  CV_64SC4: 107,
  /** Construct a signed 64-bit integer matrix type with 1 to 128 channels. */
  CV_64SC: (channels: number) => CV_MAKETYPE(11, channels),
  /** Depth code for unsigned 32-bit integer elements. */
  CV_32U: 12,
  /** Matrix type with 1 unsigned 32-bit integer channels. */
  CV_32UC1: 12,
  /** Matrix type with 2 unsigned 32-bit integer channels. */
  CV_32UC2: 44,
  /** Matrix type with 3 unsigned 32-bit integer channels. */
  CV_32UC3: 76,
  /** Matrix type with 4 unsigned 32-bit integer channels. */
  CV_32UC4: 108,
  /** Construct an unsigned 32-bit integer matrix type with 1 to 128 channels. */
  CV_32UC: (channels: number) => CV_MAKETYPE(12, channels),
}

/** Value factories use this instance's native algorithms for geometric operations. */
export const createValueAPI = (cv: MainModule) => {
  class InstanceKeyPoint extends KeyPoint {
    /** Return the intersection-over-union of the circular neighborhoods of two keypoints. */
    static overlap = cv.KeyPoint_overlap
    /** Convert keypoint locations to point values. The native overload determines the source and destination vectors. */
    static convert = cv.KeyPoint_convert
  }
  class InstanceRotatedRect extends RotatedRect {
    /** Return the four corner coordinates as independent point values. */
    points() { return cv.rotatedRectPoints(this) }
    /** Return the smallest upright integer rectangle containing this rotated rectangle. */
    boundingRect() { return cv.rotatedRectBoundingRect(this) }
    /** Return the upright floating-point bounds of this rectangle. */
    boundingRect2f() { return cv.rotatedRectBoundingRect2f(this) }
  }
  return { ...valueAPI, KeyPoint: InstanceKeyPoint, RotatedRect: InstanceRotatedRect }
}
