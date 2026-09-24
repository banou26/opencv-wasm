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
  for (const type of ['sceneRange', 'pixelCamera', 'pixelRigid', 'pixelEvidence', 'pixelScenery', 'pixelSilhouettes', 'pixelPlate', 'pixelRefine', 'pixelRigidRefine', 'pixelFrames', 'pixelInspect'] as const) expect(steps).toContain(type)
  expect(specFor(doc.nodes.find(node => node.id === 'ninspect')!, doc).outputs.map(port => port.id)).toEqual(['out:frame:source', 'out:frame:changes', 'out:frame:ink', 'out:frame:layer', 'out:frame:plate', 'out:frame:drawings', 'out:string:summary'])
})

test('kernels measure the pan, outline the redrawn character, keep the static prop in the plate and inspect a frame', async () => {
  const measured = regions((await run('pixelCamera', scene)).outputs)
  for (const fit of measured.pixelCamera!.fits) { expect(Math.abs(fit.dx + PAN)).toBeLessThan(.06); expect(Math.abs(fit.dy)).toBeLessThan(.06) }
  const camera = regions((await run('pixelRigid', measured)).outputs)
  expect(camera.pixelRigid).toEqual([])
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
  const second = regions((await run('pixelRigidRefine', refined)).outputs)
  expect(second).toBe(refined)
  const replated = regions((await run('pixelPlate', second)).outputs)
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

test('a forest sliding over a still sky becomes a sliding layer whose plate the inspected scene uses', async () => {
  const w = 384, h = 256, count = 16, slide = 3.4, grain = (u: number, v: number) => 60 + 40 * Math.sin(u / 3.1) * Math.cos(v / 2.3) + 25 * Math.sin((u - v) / 1.7)
  const tree = (u: number, v: number) => { const c = Math.round(u / 64) * 64; return v > 110 + Math.abs(u - c) * 2.4 }
  const frames = Array.from({ length: count }, (_, t) => {
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let value = 0
      for (const [sx, sy] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]] as const) {
        const u = x + sx + slide * t, v = y + sy
        value += (tree(u, v) ? grain(u, v) : texture(x + sx, y + sy)) / 4
      }
      out.fill(Math.round(value), (y * w + x) * 4, (y * w + x) * 4 + 3); out[(y * w + x) * 4 + 3] = 255
    }
    return out
  })
  const forest = { info: { id: 'forest', width: w, height: h, frameCount: count }, frameAt: async (index: number) => ({ displayWidth: w, displayHeight: h, visibleRect: null, copyTo: async (out: Uint8Array) => { out.set(frames[index]!) }, close: () => {} }) } as unknown as VideoSource
  const start: RegionalData = { stage: 'scene', scene: { asset: 'forest', first: 0, last: count - 1, sourceWidth: w, sourceHeight: h, frames: [] } }
  const kernel = async (type: NodeType, data: RegionalData, params: Params = {}) => regions((await pixelKernel(step(type, params), { 'in:regions:data': { kind: 'regions', data } }, () => forest, () => false))!.outputs)
  // The camera stage's own measurement is covered in Cadence; here the two motions are given.
  const still = { dx: 0, dy: 0, residual: 0, samples: 0, iterations: 0 }
  const measured: RegionalData = { ...start, stage: 'pixel-camera', pixelCamera: {
    width: w, height: h, positions: frames.map(() => ({ dx: 0, dy: 0 })), fits: frames.slice(1).map(() => still), coarse: [],
    motions: frames.slice(1).map(() => [{ ...still, blocks: 6 }, { ...still, dx: -slide, blocks: 10 }]),
  } }
  const layered = await kernel('pixelRigid', measured, { minimumArea: 64 })
  expect(layered.pixelRigid).toHaveLength(1)
  const [layer] = layered.pixelRigid!, last = layer!.path.positions[count - 1]!
  expect(Math.abs(last.dx + slide * (count - 1))).toBeLessThan(1)
  // Decided atlas pixels agree with the forest where the layer was tested.
  let agree = 0, decided = 0
  for (let y = 4; y < h - 4; y++) for (let a = 0; a < layer!.atlas.width; a++) {
    const i = y * layer!.atlas.width + a
    if (layer!.tested[i]! < 4) continue
    decided++; agree += Number(layer!.cover[i] === Number(tree(a + layer!.atlas.x + .5, y + .5)))
  }
  expect(decided).toBeGreaterThan(w * h * .5)
  expect(agree / decided).toBeGreaterThan(.95)
  const silhouettes = await kernel('pixelSilhouettes', await kernel('pixelScenery', await kernel('pixelEvidence', layered)), { minimumArea: 200 })
  const plated = await kernel('pixelPlate', silhouettes)
  expect(plated.pixelRigid![0]!.plate).toBeDefined()
  expect(plated.pixelRigid![0]!.matte!.solved).toBeGreaterThan(100)
  const view = await pixelKernel(step('pixelInspect', { frame: 8, displayMaxSide: 0 }), { 'in:regions:data': { kind: 'regions', data: plated } }, () => forest, () => false)
  const summary = view!.outputs['out:string:summary']
  expect(summary?.kind === 'string' && summary.value).toMatch(/Sliding layers: 1, painting \d+ px/)
  expect(summary?.kind === 'string' && summary.value).toMatch(/Scene \(camera plate and sliding layers\)/)
  view!.dispose()
})
