import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV } from '@banou/opencv-wasm'
import { unpackMask } from 'cadence/regional'
import { parseDocument } from '../src/engine/graph'
import { planGraph } from '../src/engine/plan'
import { pixelLayersGraph } from '../src/engine/pixel-prefab'
import { explicitGraph } from '../src/engine/prefabs'
import { defaultParams, specFor } from '../src/engine/specs'
import type { NodeType, Params } from '../src/engine/types'
import type { VideoSource } from '../src/video/source'
import type { Payload } from '../src/worker/payload'
import { pixelKernel } from '../src/worker/pixel-kernels'
import type { RegionalData } from '../src/worker/regional-data'

beforeAll(async () => { await initOpenCV() }, 60000)

const W = 192, H = 128, COUNT = 10, PAN = 2.6
const step = (type: NodeType, params: Params = {}) => ({ key: 'test', node: { id: 'ntest', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } }, inputs: {}, frame: 0 })
const texture = (u: number, v: number) => 110 + 45 * Math.sin(u / 7.3) * Math.cos(v / 5.1) + 30 * Math.sin((u + v) / 3.7)
const character = (t: number) => ({ cx: 90 + Math.floor(t / 3) * 4, cy: 64, rx: 18 + (Math.floor(t / 3) % 2), ry: 28 })
const prop = { cx: 150, cy: 70, rx: 14, ry: 12 }
const cel = (d: { cx: number; cy: number; rx: number; ry: number }, u: number, v: number, fill: number) => {
  const edge = (Math.hypot((u - d.cx) / d.rx, (v - d.cy) / d.ry) - 1) * Math.min(d.rx, d.ry)
  return edge > 0 ? undefined : edge > -2 ? 24 : fill
}
const rgba = (t: number) => {
  const out = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let value = 0
    for (const [sx, sy] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]] as const) {
      const u = x + sx + PAN * t, v = y + sy
      value += (cel(character(t), u, v, 205) ?? cel(prop, u, v, 70) ?? texture(u, v)) / 4
    }
    out.fill(Math.round(value), (y * W + x) * 4, (y * W + x) * 4 + 3); out[(y * W + x) * 4 + 3] = 255
  }
  return out
}
const pixels = Array.from({ length: COUNT }, (_, t) => rgba(t))
const video = { info: { id: 'clip', width: W, height: H, frameCount: COUNT }, frameAt: async (index: number) => ({ displayWidth: W, displayHeight: H, visibleRect: null, copyTo: async (out: Uint8Array) => { out.set(pixels[index]!) }, close: () => {} }) } as unknown as VideoSource
const scene: RegionalData = { stage: 'scene', scene: { asset: 'clip', first: 0, last: COUNT - 1, sourceWidth: W, sourceHeight: H, frames: [] } }
const run = async (type: NodeType, data: RegionalData, params: Params = {}) => {
  const bundle = await pixelKernel(step(type, params), { 'in:regions:data': { kind: 'regions', data } }, () => video, () => false)
  if (!bundle) throw new Error(`${type} did not run`)
  return bundle
}
const regions = (outputs: Record<string, Payload>) => { const value = outputs['out:regions:data']; if (value?.kind !== 'regions') throw new Error('Expected regional data'); return value.data }

test('pixel prefab chains every full-resolution stage into one inspected 2 x 2 output', () => {
  const doc = parseDocument(pixelLayersGraph())
  expect(explicitGraph('pixelLayers')).toEqual(pixelLayersGraph())
  expect(doc.nodes.filter(node => node.type === 'output')).toHaveLength(1)
  const steps = planGraph(doc, 'n5', null, 3, 'clip', COUNT).steps.map(s => s.node.type)
  for (const type of ['sceneRange', 'pixelCamera', 'pixelEvidence', 'pixelScenery', 'pixelSilhouettes', 'pixelPlate', 'pixelRefine', 'pixelFrames', 'pixelInspect'] as const) expect(steps).toContain(type)
  expect(specFor(doc.nodes.find(node => node.id === 'ninspect')!, doc).outputs.map(port => port.id)).toEqual(['out:frame:source', 'out:frame:changes', 'out:frame:ink', 'out:frame:layer', 'out:frame:plate', 'out:frame:drawings', 'out:string:summary'])
})

test('kernels measure the pan, outline the redrawn character, keep the static prop in the plate and inspect a frame', async () => {
  const camera = regions((await run('pixelCamera', scene)).outputs)
  for (const fit of camera.pixelCamera!.fits) { expect(Math.abs(fit.dx + PAN)).toBeLessThan(.06); expect(Math.abs(fit.dy)).toBeLessThan(.06) }
  const evidence = regions((await run('pixelEvidence', camera)).outputs)
  const redraws = evidence.pixelEvidence!.summaries.flatMap((summary, pair) => summary.forward > 100 ? [pair] : [])
  expect(redraws).toEqual([2, 5, 8])
  const annotated = regions((await run('pixelScenery', evidence)).outputs)
  const silhouettes = regions((await run('pixelSilhouettes', annotated, { minimumArea: 200 })).outputs)
  const frame = 4, mask = unpackMask(silhouettes.pixelSilhouettes!.frames[frame]!.packed, W * H), d = character(frame)
  let inside = 0, covered = 0, onProp = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x + .5 + PAN * frame, v = y + .5, p = y * W + x
    if (Math.hypot((u - d.cx) / d.rx, (v - d.cy) / d.ry) < .9) { inside++; covered += mask[p]! }
    if (Math.hypot((u - prop.cx) / prop.rx, (v - prop.cy) / prop.ry) < 1) onProp += mask[p]!
  }
  expect(covered / inside).toBeGreaterThan(.97)
  expect(onProp).toBe(0)
  const plate = regions((await run('pixelPlate', silhouettes)).outputs)
  const refined = regions((await run('pixelRefine', plate)).outputs)
  expect(refined.pixelCarved).toHaveLength(COUNT)
  const replated = regions((await run('pixelPlate', refined)).outputs)
  const layered = regions((await run('pixelFrames', replated)).outputs)
  expect(layered.pixelFrames!.layers.map(layer => layer.drawings.map(d => [d.first, d.last]))).toEqual([[[0, 2], [3, 5], [6, 8], [9, 9]]])
  expect(layered.pixelDrawings).toHaveLength(4)
  const view = await run('pixelInspect', layered, { frame, displayMaxSide: 0 })
  for (const key of ['source', 'changes', 'ink', 'layer', 'plate']) {
    const panel = view.outputs[`out:frame:${key}`]
    expect(panel?.kind).toBe('frame')
    if (panel?.kind === 'frame') { expect(panel.mat.cols).toBe(W); expect(panel.mat.rows).toBe(H) }
  }
  const summary = view.outputs['out:string:summary']
  expect(summary?.kind === 'string' && summary.value).toMatch(/Silhouettes: 1 components/)
  expect(summary?.kind === 'string' && summary.value).toMatch(/Layer 0: drawing 1 of 4, frames 3 to 5/)
  view.dispose()
})
