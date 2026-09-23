import { Mat } from '@banou/opencv-wasm'
import type { SourceInfo } from '../protocol'
import type { Bundle } from '../engine/types'
import { regionalResources, regionalSummary, type RegionalData } from './regional-data'

/** Normalized float RGBA pixels; signed results retain negative values. */
export type Frame = { kind: 'frame'; mat: Mat; range: 'unit' | 'signed' }
/** Dense CV_32FC2 displacements in image pixels, plus an owned image for sparse previews. */
export type Flow = { kind: 'flow'; mat: Mat; base: Frame }
export type Payload = Frame
  | { kind: 'regions'; data: RegionalData }
  | Flow
  | { kind: 'scalar'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'video'; asset: string; info: SourceInfo }
  | { kind: 'vector'; x: number; y: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'frames'; frames: Frame[]; pyramid: 'gaussian' | 'laplacian' }
  | { kind: 'custom'; schema: string; fields: Record<string, Payload> }
  | { kind: 'motion'; dx: number; dy: number; response: number; preview: Frame }

export const image = (value: Payload | undefined): Frame => {
  if (value?.kind !== 'frame') throw new Error('A frame input is required; extract a frame from the video first')
  return value
}
export const parameterValue = (value: Payload): string | number | boolean => {
  if (value.kind !== 'scalar' && value.kind !== 'boolean' && value.kind !== 'string') throw new Error('A parameter expects a Number, Boolean or Text value')
  return value.value
}
const walk = (value: Payload, visit: (mat: Mat) => void) => {
  if (value.kind === 'frame') visit(value.mat)
  else if (value.kind === 'flow') { visit(value.mat); visit(value.base.mat) }
  else if (value.kind === 'motion') visit(value.preview.mat)
  else if (value.kind === 'frames') value.frames.forEach(frame => visit(frame.mat))
  else if (value.kind === 'custom') Object.values(value.fields).forEach(field => walk(field, visit))
}
/** Copy pixel storage; opencv-wasm 0.0.6 inherits Embind clone(), which only retains the same handle. */
export const copyMat = (source: Mat): Mat => {
  const out = new Mat()
  try { source.copyTo(out); return out } catch (error) { out.delete(); throw error }
}
/** A record or selected pyramid level owns copies, so cache eviction cannot invalidate a field. */
export const clonePayload = (value: Payload): Payload => {
  const allocated: Mat[] = []
  const copyFrame = (frame: Frame): Frame => { const mat = copyMat(frame.mat); allocated.push(mat); return { ...frame, mat } }
  const copy = (value: Payload): Payload => {
    if (value.kind === 'regions') return { kind: 'regions', data: structuredClone(value.data) }
    if (value.kind === 'frame') return copyFrame(value)
    if (value.kind === 'flow') { const mat = copyMat(value.mat); allocated.push(mat); return { ...value, mat, base: copyFrame(value.base) } }
    if (value.kind === 'motion') return { ...value, preview: copyFrame(value.preview) }
    if (value.kind === 'frames') return { ...value, frames: value.frames.map(copyFrame) }
    if (value.kind === 'custom') return { ...value, fields: Object.fromEntries(Object.entries(value.fields).map(([key, field]) => [key, copy(field)])) }
    return { ...value }
  }
  try { return copy(value) } catch (error) { allocated.forEach(mat => mat.delete()); throw error }
}
export const payloadBundle = (outputs: Record<string, Payload>): Bundle<Payload> => {
  const matrices = new Set<Mat>()
  Object.values(outputs).forEach(value => walk(value, mat => matrices.add(mat)))
  const seen = new Set<object>()
  const shared = new Map<object, number>()
  const extra = (value: Payload): void => {
    if (value.kind === 'regions') regionalResources(value.data, shared, seen)
    else if (value.kind === 'custom') Object.values(value.fields).forEach(extra)
  }
  Object.values(outputs).forEach(extra)
  const bytes = [...shared.values()].reduce((sum, size) => sum + size, matrices.size ? 0 : 128)
  return { outputs, bytes: [...matrices].reduce((sum, mat) => sum + mat.rows * mat.cols * mat.elemSize(), bytes), ...(shared.size ? { shared } : {}), dispose: () => matrices.forEach(mat => mat.delete()) }
}
/** Summaries cross the worker boundary; native handles and full-resolution pixels stay in the worker. */
export const payloadSummary = (value: Payload): string => {
  if (value.kind === 'regions') return regionalSummary(value.data)
  if (value.kind === 'flow') return `${value.mat.cols} × ${value.mat.rows} displacement field\nX right / Y down · pixels per frame pair`
  if (value.kind === 'frame') return `${value.mat.cols} × ${value.mat.rows} frame`
  if (value.kind === 'scalar') return String(value.value)
  if (value.kind === 'boolean' || value.kind === 'string') return String(value.value)
  if (value.kind === 'video') return `${value.info.name}\n${value.info.width} × ${value.info.height}\n${value.info.frameCount} frames · ${value.info.fps.toFixed(3)} fps\nVideo clip → Extract Video Frame`
  if (value.kind === 'vector') return `X ${value.x} · Y ${value.y}`
  if (value.kind === 'rect') return `X ${value.x} · Y ${value.y}\n${value.width} × ${value.height} pixels`
  if (value.kind === 'frames') return `${value.pyramid === 'gaussian' ? 'Gaussian levels' : 'Laplacian bands'}\n${value.frames.map((f, i) => `${i}: ${f.mat.cols} × ${f.mat.rows}`).join('\n')}`
  if (value.kind === 'custom') return Object.entries(value.fields).map(([key, field]) => `${key}: ${payloadSummary(field)}`).join('\n')
  return `X ${value.dx} · Y ${value.dy}`
}
