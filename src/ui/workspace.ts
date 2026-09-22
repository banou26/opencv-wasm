import { create } from 'zustand'
import { parseDocument } from '../engine/graph'
import type { GraphDocument } from '../engine/types'
import { useEditor } from './store'

/** A chosen folder is the project: graph JSON, original media and explicit exports. */
type MediaEntry = { id: string; file: string; name: string }
type ProjectFile = GraphDocument & { media?: MediaEntry[]; referenceAsset?: string }
type DirectoryWindow = Window & { showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }
export const supportsProjectFolder = () => typeof (window as DirectoryWindow).showDirectoryPicker === 'function'
export const useWorkspace = create<{ name: string; status: string; error: string; queued: number; dirty: boolean }>(() => ({ name: '', status: '', error: '', queued: 0, dirty: false }))
const media = new Map<string, File>()
let folder: FileSystemDirectoryHandle | undefined
let manifest = new Map<string, MediaEntry>()
let diskText: string | null = null
let queue = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | undefined
let selecting = false

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const report = (error: unknown) => useWorkspace.setState({ status: 'Save failed', error: errorText(error) })
const enqueue = (job: () => Promise<void>) => {
  useWorkspace.setState(state => ({ queued: state.queued + 1 }))
  const task = queue.then(job)
  queue = task.catch(report).finally(() => useWorkspace.setState(state => ({ queued: state.queued - 1 })))
  return task
}
const write = async (handle: FileSystemFileHandle, blob: Blob) => {
  const stream = await handle.createWritable()
  // Stream original clips instead of copying their whole contents into JS memory.
  await blob.stream().pipeTo(stream)
}
const textIn = async (directory: FileSystemDirectoryHandle): Promise<string | null> => {
  try { return await (await (await directory.getFileHandle('cadence-graph.json')).getFile()).text() }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
}
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'video.mp4'

/** Register the actual File only after its container has indexed successfully. */
export const rememberMedia = (id: string, file: File) => { media.set(id, file) }

/** Serialize writes and check for outside edits before replacing the project file. */
export const syncProject = () => {
  clearTimeout(timer)
  if (!folder || selecting) return Promise.resolve()
  if (useEditor.getState().busy === 'load') { timer = setTimeout(() => { void syncProject().catch(() => {}) }, 700); return Promise.resolve() }
  const destination = folder, { doc, source } = useEditor.getState()
  useWorkspace.setState({ status: 'Saving…', error: '', dirty: true })
  return enqueue(async () => {
    if (folder !== destination) return
    if (await textIn(destination) !== diskText) throw new Error('cadence-graph.json changed outside this editor. Reopen the project folder to read it before saving again.')
    const used = new Set([source?.id, ...doc.nodes.map(n => n.asset), ...(doc.definitions ?? []).flatMap(d => d.graph.nodes.map(n => n.asset))].filter((id): id is string => !!id))
    for (const id of used) {
      const file = media.get(id)
      if (!file || manifest.has(id)) continue
      const directory = await destination.getDirectoryHandle('media', { create: true }), name = `${id}-${safeName(file.name)}`
      await write(await directory.getFileHandle(name, { create: true }), file)
      manifest.set(id, { id, file: name, name: file.name })
    }
    const value: ProjectFile = { ...doc, media: [...manifest.values()].filter(entry => used.has(entry.id)), ...(source ? { referenceAsset: source.id } : {}) }
    const text = JSON.stringify(value, null, 2)
    if (await textIn(destination) !== diskText) throw new Error('cadence-graph.json changed outside this editor. Reopen the project folder before saving again.')
    await write(await destination.getFileHandle('cadence-graph.json', { create: true }), new Blob([text], { type: 'application/json' }))
    diskText = text
    const current = useEditor.getState(), dirty = current.doc !== doc || current.source?.id !== source?.id
    useWorkspace.setState({ status: dirty ? 'Unsaved changes' : 'Saved', error: '', dirty })
  })
}

/** Read first: choosing an existing project never overwrites it with the current graph. */
export const chooseProjectFolder = async (mode: 'open' | 'save' = 'open'): Promise<{ files: { id: string; file: File }[]; referenceAsset?: string } | undefined> => {
  const picker = (window as DirectoryWindow).showDirectoryPicker
  if (!picker) { report(new Error('Project folders require desktop Chrome on localhost or HTTPS.')); return }
  try {
    const selected = await picker.call(window, { id: 'cadence-project', mode: 'readwrite' })
    selecting = true
    clearTimeout(timer)
    await queue
    const text = await textIn(selected)
    if (mode === 'save' && text !== null) throw new Error('This folder already contains a Cadence project. Open it with Project folder…, or choose a new folder to save the current graph.')
    const raw = text === null ? undefined : JSON.parse(text) as ProjectFile
    const doc = raw ? parseDocument(raw) : undefined
    const entries = raw?.media ?? []
    if (!Array.isArray(entries) || entries.length > 1000 || entries.some(e => !e || !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id) || typeof e.file !== 'string' || !e.file || /[/\\]/.test(e.file) || e.file === '.' || e.file === '..' || typeof e.name !== 'string')) throw new Error('Invalid project media manifest')
    const files: { id: string; file: File }[] = [], missing: string[] = []
    for (const entry of entries) {
      try {
        const directory = await selected.getDirectoryHandle('media'), saved = await (await directory.getFileHandle(entry.file)).getFile()
        const file = new File([saved], entry.name, { type: saved.type || 'video/mp4', lastModified: saved.lastModified })
        files.push({ id: entry.id, file }); rememberMedia(entry.id, file)
      } catch { missing.push(entry.name) }
    }
    folder = selected; diskText = text; manifest = new Map(entries.filter(e => !missing.includes(e.name)).map(e => [e.id, e]))
    if (doc) {
      useEditor.getState().replace(doc)
      useEditor.setState({ source: null, assets: {}, frame: 0, result: null })
    }
    useWorkspace.setState({ name: selected.name, dirty: !doc, status: missing.length ? 'Missing media' : 'Saved', error: missing.length ? `Reattach missing clips: ${missing.join(', ')}` : '' })
    selecting = false
    if (!doc) await syncProject()
    return { files, referenceAsset: raw?.referenceAsset }
  } catch (error) {
    selecting = false
    if (error instanceof DOMException && error.name === 'AbortError') return
    report(error)
    return
  }
}

/** Call from a user gesture before asynchronous rendering or encoding starts. */
export const ensureProjectFolder = async () => !!folder || !!await chooseProjectFolder('save')

/** Every artifact is written into the selected project, with no download fallback. */
export const saveArtifact = async (blob: Blob, name: string) => {
  if (!await ensureProjectFolder()) return
  const destination = folder!
  useWorkspace.setState({ status: 'Saving export…', error: '' })
  await enqueue(async () => {
    const exports = await destination.getDirectoryHandle('exports', { create: true })
    const dot = name.lastIndexOf('.'), base = dot >= 0 ? name.slice(0, dot) : name, extension = dot >= 0 ? name.slice(dot) : ''
    let candidate = name, index = 1
    // Repeated exports are retained; graph autosave alone replaces its fixed JSON file.
    while (true) {
      try { await exports.getFileHandle(candidate); candidate = `${base}-${++index}${extension}` }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') break; throw error }
    }
    await write(await exports.getFileHandle(candidate, { create: true }), blob)
    useWorkspace.setState({ status: `Saved exports/${candidate}`, error: '' })
  })
}
export const saveGraph = async () => {
  if (await ensureProjectFolder()) await syncProject()
}
const unsubscribe = useEditor.subscribe((state, previous) => {
  if (!folder || selecting || state.doc === previous.doc && state.source?.id === previous.source?.id) return
  useWorkspace.setState({ status: 'Unsaved changes', dirty: true })
  clearTimeout(timer)
  timer = setTimeout(() => { void syncProject().catch(() => {}) }, 700)
})
window.addEventListener('beforeunload', event => {
  if (folder && (useWorkspace.getState().queued > 0 || useWorkspace.getState().dirty || ['Unsaved changes', 'Saving…', 'Save failed'].includes(useWorkspace.getState().status))) event.preventDefault()
})
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribe(); clearTimeout(timer) })
