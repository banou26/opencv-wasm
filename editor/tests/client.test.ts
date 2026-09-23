/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { SourceInfo, WorkerCommand, WorkerEvent } from '../src/protocol'

vi.mock('../src/ui/workspace', () => ({
  rememberMedia: vi.fn(), saveArtifact: vi.fn(), chooseProjectFolder: vi.fn(), ensureProjectFolder: vi.fn(),
}))

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: { data: WorkerEvent }) => void
  onerror?: (event: { message: string }) => void
  onmessageerror?: () => void
  commands: WorkerCommand[] = []
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
  postMessage(command: WorkerCommand) { this.commands.push(command) }
  emit(data: WorkerEvent) { this.onmessage?.({ data }) }
  get loads() { return this.commands.filter(command => command.type === 'load') }
}

let client: typeof import('../src/ui/client')
let useEditor: typeof import('../src/ui/store')['useEditor']
const canvas = () => ({ transferControlToOffscreen: () => ({}) }) as HTMLCanvasElement
const clip = (name = 'clip.mp4') => new File(['clip'], name)
const target = { node: 'source' }
const info = (id: string): SourceInfo => ({ id, name: 'clip.mp4', width: 640, height: 360, frameCount: 24, fps: 24, codec: 'avc1', decoder: 'software', warnings: [] })
const start = () => { client.initialize(canvas()); return FakeWorker.instances.at(-1)! }
const fatal = (worker: FakeWorker) => worker.emit({ type: 'error', request: 0, fatal: true, message: 'Incomplete OpenCV download. Try running again.' })
const expectStopped = () => expect(useEditor.getState()).toMatchObject({ ready: false, fatal: true, busy: 'idle', loadingSource: null, cancelling: false, progress: null, result: null, pixel: null, statuses: {} })

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  client = await import('../src/ui/client')
  ;({ useEditor } = await import('../src/ui/store'))
  useEditor.getState().replace({ version: 1, nodes: [{ id: target.node, type: 'source', params: {}, position: { x: 0, y: 0 } }], edges: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('render worker selection', () => {
  it('defaults render requests to four workers and preserves explicit Auto and serial choices', () => {
    const worker = start()
    worker.emit({ type: 'ready', adapter: 'test' })
    client.bake(0, 12, 60, target.node)
    client.bake(0, 12, 60, target.node, 'high', 0)
    client.bake(0, 12, 60, target.node, 'high', 1)
    expect(worker.commands.filter(command => command.type === 'bake').map(command => command.workers)).toEqual([4, 0, 1])
  })
})

describe('processing engine failure cleanup', () => {
  it('clears clips queued during startup and refuses new work or late readiness', async () => {
    const worker = start()
    client.loadVideo(clip(), target)
    client.loadVideo(clip('second.mp4'), target)
    expect(useEditor.getState()).toMatchObject({ ready: false, busy: 'load', loadingSource: target })
    expect(worker.loads).toHaveLength(0)

    fatal(worker)
    expectStopped()
    expect(worker.terminate).toHaveBeenCalledOnce()
    const doc = useEditor.getState().doc
    client.loadVideo(clip('third.mp4'))
    client.bake(0, 1, 60, target.node)
    client.cancel()
    client.inspectPixel(0, 0)
    await client.exportFrame()
    await client.openProjectFolder()
    worker.emit({ type: 'ready', adapter: 'late' })
    worker.emit({ type: 'error', request: 0, message: 'late recoverable error' })
    expectStopped()
    expect(useEditor.getState().error).toContain('Incomplete OpenCV download')
    expect(useEditor.getState().doc).toBe(doc)
    expect(worker.commands.map(command => command.type)).toEqual(['init'])
  })

  it('discards an in-flight import and closes late thumbnails after worker failure', () => {
    const worker = start()
    worker.emit({ type: 'ready', adapter: 'test' })
    client.loadVideo(clip(), target)
    client.loadVideo(clip('second.mp4'), target)
    const command = worker.loads[0]!
    worker.emit({ type: 'status', request: command.request, value: { node: target.node, state: 'running', frame: 0 } })
    useEditor.setState({ progress: { done: 1, total: 10 }, cancelling: true })
    worker.onerror?.({ message: 'Worker stopped' })
    expectStopped()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)

    worker.emit({ type: 'source', request: command.request, value: info(command.asset) })
    const close = vi.fn()
    worker.emit({ type: 'thumbnail', generation: 0, node: target.node, frame: 0, bitmap: { close } as unknown as ImageBitmap })
    worker.emit({ type: 'ready', adapter: 'late' })
    expect(close).toHaveBeenCalledOnce()
    expectStopped()
    expect(useEditor.getState().assets).toEqual({})
    expect(worker.loads).toHaveLength(1)
  })

  it('cleans up when transferring the preview fails before initialization', () => {
    client.loadVideo(clip(), target)
    client.initialize({ transferControlToOffscreen: () => { throw new Error('Cannot transfer preview') } } as unknown as HTMLCanvasElement)
    expectStopped()
    expect(useEditor.getState().error).toContain('Cannot transfer preview')
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce()
  })

  it('cleans up unreadable worker messages', () => {
    const worker = start()
    client.loadVideo(clip(), target)
    worker.onmessageerror?.()
    expectStopped()
    expect(useEditor.getState().error).toContain('unreadable message')
  })

  it('does not queue project media when a folder chooser finishes after a fatal error', async () => {
    const { chooseProjectFolder } = await import('../src/ui/workspace')
    let resolve!: (value: { files: { id: string; file: File }[] }) => void
    vi.mocked(chooseProjectFolder).mockReturnValue(new Promise(done => { resolve = done }))
    const worker = start(), opening = client.openProjectFolder()
    fatal(worker)
    resolve({ files: [{ id: 'restored', file: clip() }] })
    await opening
    worker.emit({ type: 'ready', adapter: 'late' })
    expectStopped()
    expect(worker.loads).toHaveLength(0)
  })

  it('keeps ordinary import errors recoverable and continues the serial queue', async () => {
    const { rememberMedia } = await import('../src/ui/workspace')
    const worker = start(), second = clip('second.mp4')
    client.loadVideo(clip(), target)
    client.loadVideo(second, target)
    worker.emit({ type: 'ready', adapter: 'test' })
    expect(worker.loads).toHaveLength(1)
    worker.emit({ type: 'error', request: worker.loads[0]!.request, message: 'Unsupported clip' })
    expect(worker.loads).toHaveLength(2)
    expect(useEditor.getState()).toMatchObject({ fatal: false, ready: true, busy: 'load', loadingSource: target })
    const command = worker.loads[1]!, source = info(command.asset)
    worker.emit({ type: 'source', request: command.request, value: source })
    expect(useEditor.getState()).toMatchObject({ fatal: false, ready: true, busy: 'idle', loadingSource: null, source })
    expect(rememberMedia).toHaveBeenCalledWith(command.asset, second)
    expect(worker.terminate).not.toHaveBeenCalled()
  })
})
