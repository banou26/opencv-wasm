import { beforeAll, expect, test } from 'vite-plus/test'
import { initOpenCV, matFromArray, CV_32FC4 } from '@banou/opencv-wasm'
import { runKernel } from '../src/worker/kernels'
import { image, payloadBundle } from '../src/worker/payload'
import type { Frame, Payload } from '../src/worker/payload'
import { CATALOG } from '../src/engine/catalog'
import { defaultParams } from '../src/engine/specs'
import { ResultCache } from '../src/engine/cache'
import { evaluateGraph } from '../src/engine/evaluate'
import { parameterValue } from '../src/worker/payload'
import { borderFillDefinition, pyramidDefinition } from '../src/engine/prefabs'
import { connect, parseDocument } from '../src/engine/graph'
import type { GraphDocument, GraphNode, NodeType, Params } from '../src/engine/types'

beforeAll(async () => { await initOpenCV() }, 60000)
const node = (type: NodeType, params: Params = {}): GraphNode => ({ id: 'noperation', type, params: { ...defaultParams(type), ...params }, position: { x: 0, y: 0 } })
const invoke = (type: NodeType, params: Params, inputs: Record<string, Payload>, doc?: GraphDocument) => runKernel({ key: 'test', node: node(type, params), frame: 0, inputs: {} }, inputs, undefined, () => false, doc)
const fixture = (width = 19, height = 13): Frame => ({ kind: 'frame', mat: matFromArray(height, width, CV_32FC4, Float32Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 1 : ((i * 17 + Math.floor(i / 4) * 3) % 251) / 255)), range: 'unit' })
const evaluate = (doc: GraphDocument, sourceFrames: Record<string, Frame>, selected = 'noutput') => {
  const cache = new ResultCache<Payload>(64 * 1024 ** 2)
  return { cache, result: evaluateGraph(parseDocument(doc), selected, null, 0, [], {
    cache, assets: Object.fromEntries(Object.keys(sourceFrames).map(id => [id, { frameCount: 1 }])), sourceId: Object.keys(sourceFrames)[0], parameter: parameterValue,
    cancelled: () => false, yield: async () => {}, now: () => 0, status: () => {},
    kernel: (step, inputs) => step.node.type === 'source' ? Promise.resolve(payloadBundle({ 'out:frame:image': { ...sourceFrames[step.asset!]!, mat: sourceFrames[step.asset!]!.mat.clone() } })) : runKernel(step, inputs, undefined, () => false, doc),
  }) }
}

test('every image catalog entry executes the actual WASM API and returns finite pixels', async () => {
  const original = fixture(96, 64), frames = { 'in:frame:image': original, 'in:frame:a': original, 'in:frame:b': original, 'in:frame:base': original, 'in:frame:patch': original, 'in:frame:red': original, 'in:frame:green': original, 'in:frame:blue': original, 'in:frame:x': original, 'in:frame:y': original, 'in:rect:region': { kind: 'rect' as const, x: 3, y: 4, width: 19, height: 13 } }
  const skip = new Set(['clip', 'readFrame', 'videoInfo', 'imageInfo', 'text', 'boolean', 'vector', 'rectangle', 'splitVector', 'splitRectangle', 'math', 'compare', 'logic', 'selectNumber', 'pyramidLevel', 'reconstructPyramid', 'frameList', 'makeRecord', 'breakRecord'])
  try {
    for (const spec of CATALOG.filter(s => !skip.has(s.type))) {
      const result = await invoke(spec.type, {}, frames)
      try {
        const value = Object.values(result.outputs)[0]!
        const outputFrames = value.kind === 'frame' ? [value] : value.kind === 'frames' ? value.frames : value.kind === 'motion' ? [value.preview] : []
        expect(outputFrames.length, spec.title).toBeGreaterThan(0)
        for (const frame of outputFrames) { expect(frame.mat.type(), spec.title).toBe(CV_32FC4); expect([...frame.mat.data32F].every(Number.isFinite), spec.title).toBe(true) }
      } finally { result.dispose() }
    }
  } finally { original.mat.delete() }
})
test('crop and paste preserve exact source and outside-region pixels', async () => {
  const original = fixture(), region: Payload = { kind: 'rect', x: 3, y: 2, width: 7, height: 5 }
  try {
    const crop = await invoke('crop', {}, { 'in:frame:image': original, 'in:rect:region': region })
    try {
      const patch = image(crop.outputs['out:frame:image'])
      expect([patch.mat.cols, patch.mat.rows]).toEqual([7, 5])
      for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) for (let c = 0; c < 4; c++) expect(patch.mat.data32F[(y * 7 + x) * 4 + c]).toBe(original.mat.data32F[((y + 2) * 19 + x + 3) * 4 + c])
      const inverted = await invoke('invert', {}, { 'in:frame:image': patch })
      try {
        const paste = await invoke('paste', { x: 3, y: 2 }, { 'in:frame:base': original, 'in:frame:patch': inverted.outputs['out:frame:image']! })
        try {
          const result = image(paste.outputs['out:frame:image'])
          for (let y = 0; y < 13; y++) for (let x = 0; x < 19; x++) for (let c = 0; c < 4; c++) {
            const before = original.mat.data32F[(y * 19 + x) * 4 + c]!, changed = x >= 3 && x < 10 && y >= 2 && y < 7 && c < 3
            expect(result.mat.data32F[(y * 19 + x) * 4 + c]).toBeCloseTo(changed ? 1 - before : before, 6)
          }
        } finally { paste.dispose() }
      } finally { inverted.dispose() }
    } finally { crop.dispose() }
    await expect(invoke('crop', {}, { 'in:frame:image': original, 'in:rect:region': { ...region, x: 18 } })).rejects.toThrow('inside')
  } finally { original.mat.delete() }
})
test('odd-size Laplacian pyramids reconstruct their original float pixels', async () => {
  const original = fixture()
  try {
    const pyramid = await invoke('laplacianPyramid', { levels: 3 }, { 'in:frame:image': original })
    try {
      const list = pyramid.outputs['out:frames:levels']!
      if (list.kind !== 'frames') throw new Error('Missing pyramid')
      expect(list.frames.map(f => [f.mat.cols, f.mat.rows])).toEqual([[19, 13], [10, 7], [5, 4], [3, 2]])
      expect([...list.frames[0]!.mat.data32F].some(v => v < -0.01)).toBe(true)
      const rebuilt = await invoke('reconstructPyramid', {}, { 'in:frames:levels': list })
      try { const actual = image(rebuilt.outputs['out:frame:image']); original.mat.data32F.forEach((value, i) => expect(actual.mat.data32F[i]).toBeCloseTo(value, 6)) }
      finally { rebuilt.dispose() }
    } finally { pyramid.dispose() }
  } finally { original.mat.delete() }
})
test('the editable Down/Up/Subtract pyramid group matches native pyramid bands', async () => {
  const original = fixture(), definition = pyramidDefinition(true)
  let doc: GraphDocument = { version: 1, definitions: [definition], nodes: [{ ...node('source'), id: 'nsource', asset: 'clip' }, { ...node('group'), id: 'ngroup', definition: definition.id }, { ...node('reconstructPyramid'), id: 'noutput' }], edges: [] }
  doc = connect(doc, { source: 'nsource', sourceHandle: 'out:frame:image', target: 'ngroup', targetHandle: 'image' }); doc = connect(doc, { source: 'ngroup', sourceHandle: 'levels', target: 'noutput', targetHandle: 'in:frames:levels' })
  const run = evaluate(doc, { clip: original })
  try {
    const result = await run.result
    try { const reconstructed = image(result.value); original.mat.data32F.forEach((v, i) => expect(reconstructed.mat.data32F[i]).toBeCloseTo(v, 6)) }
    finally { result.release() }
  } finally { run.cache.clear(); original.mat.delete() }
})
for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]] as const) test(`camera border fill handles displacement (${dx}, ${dy}) without replacing covered A pixels`, async () => {
  const width = 20, height = 12
  const make = (startX: number, startY: number, green: number): Frame => ({ kind: 'frame', range: 'unit', mat: matFromArray(height, width, CV_32FC4, Float32Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 1 : i % 4 === 1 ? green : i % 4 === 0 ? (startX + Math.floor(i / 4) % width + 1) / 40 : (startY + Math.floor(i / 4 / width) + 1) / 40)) })
  const a = make(Math.max(dx, 0), Math.max(dy, 0), 0.2), b = make(Math.max(-dx, 0), Math.max(-dy, 0), 0.8), definition = borderFillDefinition()
  let doc: GraphDocument = { version: 1, definitions: [definition], nodes: [{ ...node('source'), id: 'na', asset: 'a' }, { ...node('source'), id: 'nb', asset: 'b' }, { ...node('translateX', { pixels: dx / 2 }), id: 'nwarpx' }, { ...node('translateY', { pixels: dy / 2 }), id: 'nwarpy' }, { ...node('group'), id: 'noutput', definition: definition.id, params: { dx: dx, dy: dy, fraction: 0.5 } }], edges: [] }
  for (const c of [{ source: 'na', sourceHandle: 'out:frame:image', target: 'nwarpx', targetHandle: 'in:frame:image' }, { source: 'nwarpx', sourceHandle: 'out:frame:image', target: 'nwarpy', targetHandle: 'in:frame:image' }, { source: 'nwarpy', sourceHandle: 'out:frame:image', target: 'noutput', targetHandle: 'a' }, { source: 'nb', sourceHandle: 'out:frame:image', target: 'noutput', targetHandle: 'b' }]) doc = connect(doc, c)
  const run = evaluate(doc, { a, b })
  try {
    const result = await run.result
    try {
      const output = image(result.value)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const exposed = x - dx / 2 < 0 || x - dx / 2 >= width || y - dy / 2 < 0 || y - dy / 2 >= height, at = (y * width + x) * 4
        expect(output.mat.data32F[at]).toBeCloseTo((x + Math.abs(dx) / 2 + 1) / 40, 6)
        expect(output.mat.data32F[at + 2]).toBeCloseTo((y + Math.abs(dy) / 2 + 1) / 40, 6)
        expect(output.mat.data32F[at + 1]).toBeCloseTo(exposed ? 0.8 : 0.2, 6)
      }
    } finally { result.release() }
  } finally { run.cache.clear(); a.mat.delete(); b.mat.delete() }
})

test('fractional diagonal fill never replaces partially covered A with an unknown B corner', async () => {
  const solid = (rgb: number[]): Frame => ({ kind: 'frame', range: 'unit', mat: matFromArray(12, 20, CV_32FC4, Float32Array.from({ length: 12 * 20 * 4 }, (_, i) => i % 4 === 3 ? 1 : rgb[i % 4]!)) })
  const a = solid([0.4, 0.2, 0.3]), b = solid([0.8, 0.9, 0.7]), definition = borderFillDefinition()
  let doc: GraphDocument = { version: 1, definitions: [definition], nodes: [{ ...node('source'), id: 'na', asset: 'a' }, { ...node('source'), id: 'nb', asset: 'b' }, { ...node('translateX', { pixels: -3 }), id: 'nx' }, { ...node('translateY', { pixels: 0.25 }), id: 'ny' }, { ...node('group'), id: 'noutput', definition: definition.id, params: { dx: -6, dy: 0.5, fraction: 0.5 } }], edges: [] }
  for (const c of [{ source: 'na', sourceHandle: 'out:frame:image', target: 'nx', targetHandle: 'in:frame:image' }, { source: 'nx', sourceHandle: 'out:frame:image', target: 'ny', targetHandle: 'in:frame:image' }, { source: 'ny', sourceHandle: 'out:frame:image', target: 'noutput', targetHandle: 'a' }, { source: 'nb', sourceHandle: 'out:frame:image', target: 'noutput', targetHandle: 'b' }]) doc = connect(doc, c)
  const run = evaluate(doc, { a, b })
  try {
    const result = await run.result
    try {
      const output = image(result.value).mat.data32F
      // A's top-left has 75% geometric coverage. B has no pixels there at all.
      expect(output[0]).toBeCloseTo(0.4 * 0.75, 6)
      expect(output[1]).toBeCloseTo(0.2 * 0.75, 6)
      // In the newly revealed right-hand strip, B is fully covered.
      expect(output[(5 * 20 + 19) * 4]).toBeCloseTo(0.8, 6)
      // The interior still belongs to A, even though B's color differs.
      expect(output[(5 * 20 + 10) * 4]).toBeCloseTo(0.4, 6)
    } finally { result.release() }
  } finally { run.cache.clear(); a.mat.delete(); b.mat.delete() }
})
