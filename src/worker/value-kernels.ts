import type { Step } from '../engine/plan'
import { specFor } from '../engine/specs'
import type { GraphDocument } from '../engine/types'
import type { VideoSource } from '../video/source'
import { clonePayload, image, parameterValue, payloadBundle } from './payload'
import type { Payload } from './payload'

/** Pure value operations work even before a clip is attached. */
export const valueKernel = (step: Step, inputs: Record<string, Payload>, source: VideoSource | undefined, doc: GraphDocument) => {
  const { type, params: p } = step.node, outputs: Record<string, Payload> = {}
  const number = (key: string, value: number) => { if (!Number.isFinite(value)) throw new Error('The numeric operation produced a non-finite value'); outputs[`out:scalar:${key}`] = { kind: 'scalar', value } }
  const bool = (value: boolean) => { outputs['out:boolean:value'] = { kind: 'boolean', value } }
  if (type === 'time') {
    number('fraction', step.frame - Math.floor(step.frame)); number('frame', step.frame); number('index', Math.floor(step.frame)); number('seconds', step.frame / (source?.info.fps ?? 24))
  } else if (type === 'clip') {
    if (!source) throw new Error('Attach a video clip to this source')
    outputs['out:video:clip'] = { kind: 'video', asset: source.info.id, info: source.info }
  } else if (type === 'videoInfo') {
    const clip = inputs['in:video:clip']
    if (clip?.kind !== 'video') throw new Error('Video Info requires a video clip')
    number('width', clip.info.width); number('height', clip.info.height); number('frames', clip.info.frameCount); number('fps', clip.info.fps); number('seconds', clip.info.frameCount / clip.info.fps)
  } else if (type === 'imageInfo') {
    const frame = image(inputs['in:frame:image']); number('width', frame.mat.cols); number('height', frame.mat.rows)
  } else if (type === 'constant') number('value', Number(p.value))
  else if (type === 'multiply') { const a = inputs['in:scalar:a']; number('value', Number(a && parameterValue(a)) * Number(p.factor)) }
  else if (type === 'text') outputs['out:string:value'] = { kind: 'string', value: String(p.value) }
  else if (type === 'boolean') bool(Boolean(p.value))
  else if (type === 'vector') outputs['out:vector:value'] = { kind: 'vector', x: Number(p.x), y: Number(p.y) }
  else if (type === 'rectangle') outputs['out:rect:value'] = { kind: 'rect', x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height) }
  else if (type === 'splitVector' || type === 'splitRectangle') {
    const value = inputs[type === 'splitVector' ? 'in:vector:value' : 'in:rect:value']
    if (value?.kind !== (type === 'splitVector' ? 'vector' : 'rect')) throw new Error('Connect the matching structured value')
    if (value.kind === 'vector' || value.kind === 'rect') { number('x', value.x); number('y', value.y); if (value.kind === 'rect') { number('width', value.width); number('height', value.height) } }
  } else if (type === 'math') {
    const a = Number(p.a), b = Number(p.b)
    const operations: Record<string, () => number> = { add: () => a + b, subtract: () => a - b, multiply: () => a * b, divide: () => a / b, power: () => a ** b, min: () => Math.min(a, b), max: () => Math.max(a, b), modulo: () => a % b, floor: () => Math.floor(a), ceil: () => Math.ceil(a), round: () => Math.round(a), absolute: () => Math.abs(a) }
    number('value', operations[String(p.operation)]!())
  } else if (type === 'compare') {
    const a = Number(p.a), b = Number(p.b)
    const operations: Record<string, boolean> = { less: a < b, greater: a > b, equal: a === b, 'less or equal': a <= b, 'greater or equal': a >= b, 'not equal': a !== b }
    bool(operations[String(p.operation)]!)
  } else if (type === 'logic') {
    const a = Boolean(p.a), b = Boolean(p.b)
    bool(p.operation === 'and' ? a && b : p.operation === 'or' ? a || b : p.operation === 'not' ? !a : a !== b)
  } else if (type === 'selectNumber') number('value', Number(p.condition ? p.a : p.b))
  else if (type === 'frameList') {
    const frames = []
    try { for (let i = 0; i < 4; i++) frames.push(clonePayload(image(inputs[`in:frame:level${i}`])) as import('./payload').Frame) }
    catch (error) { payloadBundle(Object.fromEntries(frames.map((f, i) => [i, f]))).dispose(); throw error }
    outputs['out:frames:levels'] = { kind: 'frames', frames, pyramid: p.kind === 'laplacian' ? 'laplacian' : 'gaussian' }
  }
  else if (type === 'makeRecord') {
    const fields: Record<string, Payload> = {}
    try {
      for (const port of specFor(step.node, doc).inputs) {
        const input = inputs[port.id]
        fields[port.id] = input ? clonePayload(input) : port.type === 'scalar' ? { kind: 'scalar', value: Number(p[port.id]) } : port.type === 'boolean' ? { kind: 'boolean', value: Boolean(p[port.id]) } : { kind: 'string', value: String(p[port.id]) }
      }
      outputs.record = { kind: 'custom', schema: step.node.dataType!, fields }
    } catch (error) { payloadBundle(fields).dispose(); throw error }
  } else if (type === 'breakRecord') {
    const record = inputs.record
    if (record?.kind !== 'custom' || record.schema !== step.node.dataType) throw new Error('Connect a record with the same named data type')
    try { for (const port of specFor(step.node, doc).outputs) { const field = record.fields[port.id]; if (!field) throw new Error(`Missing record field: ${port.label}`); outputs[port.id] = clonePayload(field) } }
    catch (error) { payloadBundle(outputs).dispose(); throw error }
  } else return null
  return payloadBundle(outputs)
}
