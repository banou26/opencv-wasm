import { expect, test } from 'vite-plus/test'
import { groupMotionHistories, type DrawingEvent, type RegionalTracks } from 'cadence/regional'
import type { RegionalData } from '../src/worker/regional-data'
import { renderRegional } from '../src/worker/regional-render'

const fixture = (): RegionalData => {
  const width = 64, height = 16, frameCount = 7, errors = [.2, .4, 0, 1.2, 1.5, .1]
  const tracks: RegionalTracks = { width, height, frameCount, cellSize: 8, tracks: [], groups: [1, 2].map(id => ({ id, trackIds: [] })),
    frames: errors.map((dx, frame) => ({ frame, observations: frame === 2 ? [] : [
      { id: 1, cells: [0], dx: 0, dy: 0, spread: 0 }, { id: 2, cells: [7], dx, dy: 0, spread: 0 },
    ] })) }
  const status = (frame: number, id: number): DrawingEvent['status'] => frame === 0 || frame === 5 ? 'held'
    : frame === 3 || frame === 4 && id === 1 ? 'changed' : 'unknown'
  return {
    stage: 'timing', tracks, families: groupMotionHistories(tracks),
    scene: { asset: 'clip', first: 10, last: 16, sourceWidth: width, sourceHeight: height,
      frames: Array.from({ length: frameCount }, () => ({ width, height, data: new Uint8Array(width * height * 3) })) },
    sequence: { width, height, frameCount, pairs: [] },
    analysis: { groups: [], frames: tracks.frames.map(({ frame, observations }) => ({ frame, observations: observations.map(observation => ({ ...observation,
      event: { status: status(frame, observation.id), compared: 1, changed: 0, changedFraction: null, error: null, noise: null, reason: 'fixture' },
    })) })) },
  }
}

test('conflict chart preserves raw evidence and distinguishes drawing statuses from motion gaps', () => {
  const data = fixture(), before = structuredClone(data), chart = renderRegional(data, 16, 'conflicts', 8)
  expect(chart.summary).toContain('Conflict page 0: 1/1 raw-veto pairs')
  expect(chart.summary).toContain('G1/2: families F1/F2; mean 0.680; maximum 1.500; tolerance 0.750; vetoes 2/5 shared pairs')
  expect(chart.summary).toContain('10->11: error 0.200; A 0.000,0.000; B 0.200,0.000; events held/held; within tolerance')
  expect(chart.summary).toContain('12->13: ? (unobserved)')
  expect(chart.summary).toContain('13->14: error 1.200; A 0.000,0.000; B 1.200,0.000; events changed/changed; VETO')
  expect(chart.summary).toContain('events changed/unknown; VETO')
  expect(chart.labels).toContainEqual(expect.objectContaining({ text: 'Source 16: final frame, no outgoing pair' }))
  const pixel = (x: number, y: number) => [...chart.pixels.subarray((y * chart.width + x) * 4, (y * chart.width + x + 1) * 4)]
  // Below every positive-error bar, above the baseline; absent shared motion stays blank.
  expect(pixel(89, 111)).toEqual([61, 211, 139, 255])
  expect(pixel(101, 111)).toEqual([150, 150, 165, 255])
  expect(pixel(113, 111)).toEqual([24, 25, 27, 255])
  expect(pixel(125, 111)).toEqual([246, 87, 72, 255])
  expect(pixel(137, 111)).toEqual([150, 150, 165, 255])
  expect(chart.pixels.some((value, index) => index % 4 < 3 && value === 255)).toBe(false)
  expect(data).toEqual(before)
})

test('conflict cursor and summary use absolute outgoing frames, including unobserved and final frames', () => {
  const data = fixture(), observed = renderRegional(data, 13, 'conflicts', 8), missing = renderRegional(data, 12, 'conflicts', 8)
  expect(observed.summary).toContain('Source 13 -> 14')
  expect(observed.summary).toContain('Current 13->14: error 1.200')
  expect([...observed.pixels.subarray((58 * observed.width + 124) * 4, (58 * observed.width + 125) * 4)]).toEqual([255, 255, 255, 255])
  expect(missing.summary).toContain('Current 12->13: ? (unobserved)')
  const final = renderRegional(data, 16, 'conflicts', 8)
  expect(final.summary).toContain('final frame, no outgoing pair')
  expect(final.summary).not.toContain('16->17')
  expect(final.summary).not.toContain('Current ')
  expect(() => renderRegional(data, 17, 'conflicts', 8)).toThrow(/analyzed range/)
})

test('missing timing remains explicit and cannot remove any raw vetoes', () => {
  const data = fixture(), complete = renderRegional(data, 13, 'conflicts', 8)
  const missing = renderRegional({ ...data, analysis: undefined }, 13, 'conflicts', 8)
  expect(missing.summary).toContain('events null (not measured)/null (not measured); VETO')
  for (const summary of [complete.summary, missing.summary]) expect(summary).toContain('vetoes 2/5 shared pairs')
  expect(() => renderRegional({ ...data, families: undefined }, 13, 'conflicts', 8)).toThrow(/motion-history grouping/)
  expect(() => renderRegional({ ...data, tracks: undefined }, 13, 'conflicts', 8)).toThrow(/whole-scene tracks/)
})

test('conflict pages are bounded to eight pairs and an empty first page is explicit', () => {
  const data = fixture(), tracks = data.tracks!
  tracks.groups = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, trackIds: [] }))
  tracks.frames = Array.from({ length: 6 }, (_, frame) => ({ frame, observations: tracks.groups.map(({ id }) => ({ id, cells: [id], dx: id * 2, dy: 0, spread: 0 })) }))
  data.families = groupMotionHistories(tracks)
  const first = renderRegional(data, 10, 'conflicts', 8), next = renderRegional(data, 10, 'conflicts', 8, 1)
  expect(first.summary).toContain('Conflict page 0: 8/15 raw-veto pairs')
  expect(next.summary).toContain('Conflict page 1: 7/15 raw-veto pairs')
  expect(first.labels!.filter(label => label.text.startsWith('G'))).toHaveLength(8)
  expect(next.labels!.filter(label => label.text.startsWith('G'))).toHaveLength(7)
  for (const page of [-1, .5, 2]) expect(() => renderRegional(data, 10, 'conflicts', 8, page)).toThrow(/outside/)
  for (const frame of tracks.frames) for (const observation of frame.observations) observation.dx = 0
  data.families = groupMotionHistories(tracks)
  const empty = renderRegional(data, 10, 'conflicts', 8)
  expect(empty.summary).toContain('Conflict page 0: 0/0 raw-veto pairs')
  expect(empty.labels).toContainEqual(expect.objectContaining({ text: 'No raw motion conflicts' }))
  expect(() => renderRegional(data, 10, 'conflicts', 8, 1)).toThrow(/outside/)
})
