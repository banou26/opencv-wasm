/** Serializable image owned by the lab; native OpenCV handles never cross worker boundaries. */
export type LabImage = { pixels: Uint8ClampedArray; width: number; height: number }
/** Algorithm controls retain their numeric or textual value when passed to the worker. */
export type Parameters = Record<string, number | string>
/** One complete, revision-tagged experiment. Assets are local uploads, keyed by their control name. */
export type LabRequest = LabImage & {
  id: number
  algorithm: string
  params: Parameters
  second?: LabImage
  assets: Record<string, Uint8Array>
}
/** Optional unscaled matrix values, in row-major interleaved channel order, independent of display colours. */
export type NativePixels = { values: Float32Array; channels: number; labels: string[] }
/** A completed experiment or an actionable error. Revisions let the UI discard obsolete results. */
export type LabResponse =
  | { id: number; error: string }
  | (LabImage & {
      id: number
      algorithm: string
      elapsed: number
      version: string
      note: string
      native?: NativePixels
    })
/** A labelled numeric, selection or JSON control with a documented starting value. */
export type LabControl = {
  key: string
  label: string
  value: number | string
  min?: number
  max?: number
  step?: number
  options?: [string, string][]
  json?: boolean
}
/** A lab recipe explains its assumptions and the extra inputs needed for a real native call. */
export type LabRecipe = {
  note: string
  controls: LabControl[]
  second?: boolean
  assets?: { key: string; label: string; accept: string; required?: boolean }[]
  maxSide?: number
}
