import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV, Mat, matFromArray, CV_32FC4, CV_32FC2, CV_64F, warpAffine, INTER_LINEAR, BORDER_REFLECT_101 } from '@banou/opencv-wasm'
import { motionVectorsGraph } from '../src/engine/motion-prefab'
import { parseDocument } from '../src/engine/graph'
import { evaluateGraph } from '../src/engine/evaluate'
import { ResultCache } from '../src/engine/cache'
import { runKernel } from '../src/worker/kernels'
import { drawFlow, flowKernel } from '../src/worker/flow-kernels'
import { image, payloadBundle, parameterValue, clonePayload } from '../src/worker/payload'
import type { Frame, Flow, Payload } from '../src/worker/payload'
import { defaultParams } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'

beforeAll(async () => { await initOpenCV() }, 60000)
const invoke = (type: NodeType, params: Params, inputs: Record<string, Payload>) => flowKernel({ key: 'test', node: { id: 'n1', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 }, inputs)!
const makeFrame = (width: number, height: number): Frame => {
  let seed = 412947
  const pixels = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = (seed >>> 24) / 255
    pixels[i * 4 + 3] = 1
  }
  return { kind: 'frame', mat: matFromArray(height, width, CV_32FC4, pixels), range: 'unit' }
}

test('the complete editable cookbook estimates a known pan and renders sparse arrows', async () => {
  const a = makeFrame(192, 128), b: Frame = { ...a, mat: new Mat() }, doc = parseDocument(motionVectorsGraph())
  using affine = matFromArray(2, 3, CV_64F, [1, 0, 12, 0, 1, -5])
  warpAffine(a.mat, b.mat, affine, { width: 192, height: 128 }, INTER_LINEAR, BORDER_REFLECT_101)
  const cache = new ResultCache<Payload>(128 * 1024 ** 2), info = { id: 'clip', name: 'fixture', width: 192, height: 128, frameCount: 2, fps: 24, codec: 'test', decoder: 'software' as const, warnings: [] }
  const evaluate = (selected: string, port: string | null, time = 0) => evaluateGraph(doc, selected, port, time, [], {
    cache, assets: { clip: info }, sourceId: 'clip', parameter: parameterValue, cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {},
    kernel: async (step, inputs) => {
      if (step.node.type === 'clip') return payloadBundle({ 'out:video:clip': { kind: 'video', asset: 'clip', info } })
      if (step.node.type === 'readFrame') { const index = Number(step.node.params.frame); expect(index).toBeLessThan(2); return payloadBundle({ 'out:frame:image': clonePayload(index === 0 ? a : b) }) }
      return runKernel(step, inputs, undefined, () => false, doc)
    },
  })
  try {
    for (const [port, expected] of [['dx', 12], ['dy', -5]] as const) {
      const result = await evaluate('ngrid', `out:scalar:${port}`)
      try { expect(result.value.kind).toBe('scalar'); if (result.value.kind === 'scalar') expect(result.value.value).toBeCloseTo(expected, 0) } finally { result.release() }
    }
    const accepted = await evaluate('ngrid', 'out:scalar:accepted')
    try { if (accepted.value.kind !== 'scalar') throw new Error('Missing acceptance fraction'); expect(accepted.value.value).toBeGreaterThan(0.5) } finally { accepted.release() }
    const rendered = await evaluate('n5', null)
    try { const pixels = image(rendered.value).mat.data32F; expect(pixels.some((v, i) => i % 4 === 1 && v > 0.8 && pixels[i - 1]! < 0.4)).toBe(true) } finally { rendered.release() }
    // The final pair clamps to the last drawing even in interactive inspection.
    const last = await evaluate('ngrid', 'out:scalar:dx', 1)
    try { if (last.value.kind !== 'scalar') throw new Error('Missing delta'); expect(Math.abs(last.value.value)).toBeLessThan(0.1) } finally { last.release() }
    doc.nodes.find(n => n.id === 'nworking')!.params.limit = 96
    const working = await evaluate('nworking', 'a')
    try { expect(image(working.value).mat.cols).toBe(96) } finally { working.release() }
    const full = await evaluate('n5', null)
    try { expect(image(full.value).mat.cols).toBe(192); expect(image(full.value).mat.rows).toBe(128) } finally { full.release() }
  } finally { cache.clear(); a.mat.delete(); b.mat.delete() }
})

test('reverse-flow validation rejects off-image destinations and inconsistent vectors', () => {
  const base = makeFrame(32, 24), forward: Flow = { kind: 'flow', base, mat: new Mat(24, 32, CV_32FC2, [3, 2, 0, 0]) }, backward: Flow = { kind: 'flow', base, mat: new Mat(24, 32, CV_32FC2, [-3, -2, 0, 0]) }
  try {
    const result = invoke('flowConsistency', { tolerance: 0.1 }, { 'in:flow:forward': forward, 'in:flow:backward': backward })
    try {
      const mask = image(result.outputs['out:frame:image']).mat.data32F
      expect(mask[0]).toBe(1); expect(mask[(31 * 4)]).toBe(0); expect(mask[(23 * 32 * 4)]).toBe(0)
    } finally { result.dispose() }
    backward.mat.setTo([0, 0, 0, 0])
    const bad = invoke('flowConsistency', { tolerance: 0.1 }, { 'in:flow:forward': forward, 'in:flow:backward': backward })
    try { expect(image(bad.outputs['out:frame:image']).mat.data32F.every((v, i) => i % 4 === 3 || v === 0)).toBe(true) } finally { bad.dispose() }
    const copy = clonePayload(forward)
    try { expect(copy.kind).toBe('flow'); if (copy.kind === 'flow') { forward.mat.setTo([9, 9, 0, 0]); expect(copy.mat.data32F[0]).toBe(3); expect(payloadBundle({ copy }).bytes).toBe(32 * 24 * (8 + 16)) } } finally { payloadBundle({ copy }).dispose() }
  } finally { forward.mat.delete(); backward.mat.delete(); base.mat.delete() }
})

test('a flat image has no texture evidence and unsupported cells are explicit', () => {
  const base: Frame = { kind: 'frame', mat: Mat.zeros(24, 32, CV_32FC4), range: 'unit' }, flow: Flow = { kind: 'flow', mat: Mat.zeros(24, 32, CV_32FC2), base }
  try {
    const texture = invoke('cornerStrength', {}, { 'in:frame:image': base })
    try {
      const mask = image(texture.outputs['out:frame:image']); expect(mask.mat.data32F.every((v, i) => i % 4 === 3 || v === 0)).toBe(true)
      const grid = invoke('flowGrid', { cell: 16, mode: 'residual' }, { 'in:flow:field': flow, 'in:frame:mask': mask })
      try { expect(image(grid.outputs['out:frame:image']).mat.data32F.every((v, i) => i % 4 === 3 || v === 0)).toBe(true); expect(grid.outputs['out:scalar:accepted']).toEqual({ kind: 'scalar', value: 0 }) } finally { grid.dispose() }
    } finally { texture.dispose() }
  } finally { flow.mat.delete(); base.mat.delete() }
})

test('small flow fields draw scaled vectors over untouched full-resolution background detail', () => {
  const base = makeFrame(32, 24), background = makeFrame(96, 48)
  const flow: Flow = { kind: 'flow', base, mat: new Mat(24, 32, CV_32FC2, [4, 3, 0, 0]) }
  const mask: Frame = { kind: 'frame', range: 'unit', mat: new Mat(24, 32, CV_32FC4, [1, 1, 1, 1]) }
  try {
    const out = drawFlow(flow, background, 16, 1, 1, false, false, mask)
    try {
      expect(out.mat.cols).toBe(96); expect(out.mat.rows).toBe(48)
      const pixels = out.mat.data32F, source = background.mat.data32F
      // The top strip has no overlay, including one-pixel random texture that
      // would disappear if we enlarged the smaller working image instead.
      for (let x = 0; x < 96; x++) for (let c = 0; c < 4; c++) expect(pixels[x * 4 + c]).toBeCloseTo(source[x * 4 + c]!, 5)
      // First cell center (8,8) maps to (25,17). Displacement (4,3)
      // becomes (12,6), so the arrow must reach (37,23), not (29,20).
      const tip = (23 * 96 + 37) * 4
      expect(pixels[tip + 1]).toBeGreaterThan(0.75); expect(pixels[tip]).toBeLessThan(0.45)
    } finally { out.mat.delete() }
    mask.mat.setTo([0, 0, 0, 1])
    const rejected = drawFlow(flow, background, 16, 1, 1, false, false, mask)
    try { const center = (17 * 96 + 25) * 4; expect(rejected.mat.data32F[center]).toBeCloseTo(130 / 255, 5) } finally { rejected.mat.delete() }
  } finally { flow.mat.delete(); base.mat.delete(); background.mat.delete(); mask.mat.delete() }
})
