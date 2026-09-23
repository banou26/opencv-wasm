import type { Inspection, WorkerCommand, WorkerEvent } from '../protocol'
import { nodeTitle, useEditor } from './store'
import type { SourceTarget } from './store'
import type { NodeStatus } from '../engine/execute'
import { DEFAULT_RENDER_WORKERS, type RenderWorkers } from '../engine/parallel-render'
import { rememberMedia, saveArtifact, chooseProjectFolder, ensureProjectFolder } from './workspace'

let worker: Worker | undefined, serial = 0, active = 0, bakeRequest = 0, bakeLabel = '', thumbnailGeneration = 0
const send = (message: WorkerCommand, transfer: Transferable[] = []) => worker?.postMessage(message, transfer)

// Many nodes finish in one display frame. Paint their latest states together instead
// of rebuilding the graph UI for every cached/running/done worker message.
let pendingStatuses: Record<string, NodeStatus> = {}, statusRequest = 0, statusPath = '', statusTick = 0
const drainStatuses = () => {
  cancelAnimationFrame(statusTick); statusTick = 0
  const values = statusRequest === active && statusPath === JSON.stringify(useEditor.getState().path) ? pendingStatuses : {}
  pendingStatuses = {}
  return values
}
const queueStatus = (request: number, value: NodeStatus) => {
  const path = JSON.stringify(value.path ?? [])
  if (request !== statusRequest || path !== statusPath) pendingStatuses = {}
  statusRequest = request; statusPath = path; pendingStatuses[value.node] = value
  if (!statusTick) statusTick = requestAnimationFrame(() => {
    const values = drainStatuses()
    if (Object.keys(values).length) useEditor.setState(s => ({ statuses: { ...s.statuses, ...values } }))
  })
}

export const saveBlob = (blob: Blob, name: string) => { void saveArtifact(blob, name).catch(() => {}) }

type Load = { file: File; asset: string; target?: SourceTarget }
const loads: Load[] = []
let loading: Load | undefined
let restoredReference: string | undefined
const failEngine = (error: string) => {
  worker?.terminate()
  active = ++serial; bakeRequest = 0; thumbnailGeneration++
  loads.length = 0; loading = undefined; restoredReference = undefined
  drainStatuses()
  useEditor.setState({ error, fatal: true, ready: false, busy: 'idle', loadingSource: null, cancelling: false, progress: null, statuses: {}, result: null, pixel: null })
}
const nextLoad = () => {
  const state = useEditor.getState()
  if (loading || !state.ready || state.fatal || state.busy === 'bake') return
  loading = loads.shift()
  if (!loading) { useEditor.setState({ busy: 'idle', loadingSource: null }); return }
  active = ++serial; thumbnailGeneration++
  useEditor.setState({ busy: 'load', loadingSource: loading.target ?? null, statuses: {}, error: '' })
  send({ type: 'load', request: active, file: loading.file, asset: loading.asset })
}

/** Transfer the preview once; native processing and encoding stay off the UI thread. */
export const initialize = (canvas: HTMLCanvasElement) => {
  if (!canvas || worker) return
  try {
    worker = new Worker(new URL('../worker/index.ts', import.meta.url), { type: 'module' })
    worker.onerror = event => failEngine(event.message || 'The processing worker stopped.')
    worker.onmessageerror = () => failEngine('The processing worker sent an unreadable message.')
    worker.onmessage = ({ data: event }: MessageEvent<WorkerEvent>) => {
      const state = useEditor.getState()
      if (state.fatal) { if (event.type === 'thumbnail') event.bitmap?.close(); return }
      if (event.type === 'thumbnail') {
        if (event.generation !== thumbnailGeneration || !state.previews[event.node] || JSON.stringify(event.path ?? []) !== JSON.stringify(state.path)) { event.bitmap?.close(); return }
        state.thumbnails[event.node]?.bitmap?.close()
        useEditor.setState(s => ({ thumbnails: { ...s.thumbnails, [event.node]: event } }))
      } else if (event.type === 'ready') { useEditor.setState({ ready: true, adapter: event.adapter }); nextLoad() }
      else if (event.type === 'error') {
        if (event.fatal) { failEngine(event.message); return }
        if (event.request === active || event.request === bakeRequest) { drainStatuses(); useEditor.setState({ error: event.message, busy: 'idle', cancelling: false, result: null, pixel: null }) }
        if (loading && event.request === active) { loading = undefined; nextLoad() }
      } else if (event.type === 'source' && event.request === active) {
        if (loading) {
          rememberMedia(event.value.id, loading.file)
          if (loading.target) state.bindSource(loading.target, event.value)
          else useEditor.setState(s => ({ assets: { ...s.assets, [event.value.id]: event.value }, ...(!s.source || restoredReference === event.value.id ? { source: event.value } : {}) }))
        }
        loading = undefined
        nextLoad()
      }
      else if (event.type === 'status' && event.request === active && JSON.stringify(event.value.path ?? []) === JSON.stringify(state.path)) queueStatus(event.request, event.value)
      else if (event.type === 'result' && event.request === active && event.selected === state.selected && JSON.stringify(event.path ?? []) === JSON.stringify(state.path)) useEditor.setState({ result: event, busy: 'idle', error: '', statuses: { ...state.statuses, ...drainStatuses() } })
      else if (event.type === 'bake-progress' && event.request === bakeRequest) useEditor.setState({ progress: { done: event.done, total: event.total, workers: event.workers } })
      else if (event.type === 'bake-done' && event.request === bakeRequest) {
        if (event.blob) {
          if (state.movie) URL.revokeObjectURL(state.movie.url)
          useEditor.setState({ movie: { url: URL.createObjectURL(event.blob), count: event.count, fps: event.fps, cancelled: event.cancelled, label: bakeLabel, workers: event.workers, elapsed: event.elapsed } })
        }
        useEditor.setState({ busy: 'idle', cancelling: false })
        bakeRequest = 0
      } else if (event.type === 'pixel' && event.request === active) useEditor.setState({ pixel: event })
      else if (event.type === 'export') saveBlob(event.blob, 'opencv-frame.png')
    }
    const surface = canvas.transferControlToOffscreen()
    send({ type: 'init', canvas: surface }, [surface])
  } catch (error) { failEngine(String(error)) }
}

const snapshot = (): Inspection => {
  const { doc, path, selected, port, frame, gain, source } = useEditor.getState()
  return { doc, path, selected, port, frame, gain, referenceAsset: source?.id }
}
export const inspect = () => {
  const state = useEditor.getState()
  if (!state.ready || !state.selected || state.busy === 'bake' || state.busy === 'load' || state.fatal) return
  active = ++serial; thumbnailGeneration++
  useEditor.setState({ busy: 'inspect', statuses: {}, pixel: null, error: '' })
  send({ type: 'inspect', request: active, value: snapshot() })
}
/** Queue imports independently of engine startup and keep each source bound to its own clip. */
export const loadVideo = (file: File, target?: SourceTarget) => {
  const state = useEditor.getState()
  if (state.fatal || state.busy === 'bake') return
  if (!target) {
    let node = state.view.nodes.find(n => n.id === state.focused && (n.type === 'source' || n.type === 'clip')) ?? state.view.nodes.find(n => (n.type === 'source' || n.type === 'clip'))
    if (!node) { state.add('clip', { x: 40, y: 80 }); node = useEditor.getState().view.nodes.find(n => n.id === useEditor.getState().focused && (n.type === 'source' || n.type === 'clip')) }
    if (!node) return
    target = { node: node.id, definition: state.view.interfaceId }
  }
  // Reattaching a missing saved asset preserves the bindings used elsewhere in that graph.
  const body = target.definition ? state.doc.definitions?.find(d => d.id === target.definition)?.graph : useEditor.getState().doc
  const previous = body?.nodes.find(n => n.id === target.node)?.asset
  const asset = previous && !state.assets[previous] ? previous : crypto.randomUUID()
  loads.push({ file, target, asset })
  if (!state.ready) useEditor.setState({ busy: 'load', loadingSource: target })
  nextLoad()
}
export const openProjectFolder = async () => {
  if (useEditor.getState().fatal) return
  const restored = await chooseProjectFolder()
  if (!restored || useEditor.getState().fatal) return
  restoredReference = restored.referenceAsset
  for (const entry of restored.files) loads.push({ file: entry.file, asset: entry.id })
  nextLoad()
}
export const bake = (start: number, end: number, fps: number, target: string, quality: import('../engine/render-quality').RenderQuality = 'high', workers: RenderWorkers = DEFAULT_RENDER_WORKERS) => {
  if (!useEditor.getState().ready || useEditor.getState().fatal) return
  const value = snapshot(), output = value.doc.nodes.find(n => n.id === target)
  if (output) { value.selected = output.id; value.port = null; value.path = [] }
  active = ++serial; bakeRequest = active; bakeLabel = nodeTitle(value.selected)
  useEditor.setState({ busy: 'bake', cancelling: false, progress: { done: 0, total: 0 }, error: '' })
  send({ type: 'bake', request: active, value, start, end, fps, quality, workers })
}
export const cancel = () => {
  if (useEditor.getState().fatal) return
  active = ++serial
  useEditor.setState({ cancelling: true })
  send({ type: 'cancel', request: active })
}
export const inspectPixel = (x: number, y: number) => { const state = useEditor.getState(); if (state.ready && !state.fatal && state.busy === 'idle') send({ type: 'pixel', request: active, x, y }) }
export const exportFrame = async () => {
  if (!useEditor.getState().fatal && await ensureProjectFolder() && !useEditor.getState().fatal) send({ type: 'export', request: active })
}

/** Low-priority, opt-in node images are refreshed after the main inspection settles. */
export const refreshThumbnails = () => {
  const state = useEditor.getState()
  if (!state.ready || state.fatal || state.busy !== 'idle') return
  const nodes = state.view.nodes.filter(n => state.previews[n.id]).map(n => n.id)
  send({ type: 'thumbnails', generation: ++thumbnailGeneration, value: snapshot(), nodes })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => { worker?.terminate(); cancelAnimationFrame(statusTick) })
  // An OffscreenCanvas cannot transfer twice after a processing-client hot reload.
  import.meta.hot.accept(() => window.location.reload())
}
