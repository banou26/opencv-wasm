import { create } from 'zustand'
import { connect, parseDocument, insertPrefab, groupNodes } from '../engine/graph'
import { explicitGraph } from '../engine/prefabs'
import { defaultParams, specFor } from '../engine/specs'
import { graphView, pathDefinition, replaceView } from '../engine/definitions'
import { updateDataType } from '../engine/data-types'
import { updateInterface } from '../engine/interfaces'
import type { Connection, GraphDocument, NodeDefinition, NodeType, DataTypeDefinition } from '../engine/types'
import type { NodeStatus } from '../engine/execute'
import type { SourceInfo, WorkerEvent } from '../protocol'

export type Result = Extract<WorkerEvent, { type: 'result' }>
export type Movie = { url: string; count: number; fps: number; cancelled: boolean; label: string }
export type SourceTarget = { node: string; definition?: string }
export type EditorTab = { id: string; path: string[]; definition?: string; focused?: string; selected?: string; port?: string | null }
type State = {
  doc: GraphDocument; view: GraphDocument; path: string[]; tabs: EditorTab[]; activeTab: string
  highlighted: string[]; focused: string; selected: string; port: string | null; frame: number; gain: number; inspectorView: 'frame' | 'movie'
  ready: boolean; adapter: string; source: SourceInfo | null; assets: Record<string, SourceInfo>; loadingSource: SourceTarget | null; busy: 'idle' | 'load' | 'inspect' | 'bake'
  error: string; fatal: boolean; result: Result | null; statuses: Record<string, NodeStatus>
  progress: { done: number; total: number } | null; movie: Movie | null; cancelling: boolean
  pixel: Extract<WorkerEvent, { type: 'pixel' }> | null; revision: number
  previews: Record<string, boolean>; thumbnails: Record<string, Extract<WorkerEvent, { type: 'thumbnail' }>>
  past: GraphDocument[]; future: GraphDocument[]
  bindSource: (target: SourceTarget, info: SourceInfo) => void
  togglePreview: (id: string) => void
  insert: (value: unknown, position?: { x: number; y: number }) => void
  focus: (id: string) => void
  select: (id: string, port?: string | null) => void
  parameter: (id: string, key: string, value: string | number | boolean) => void
  add: (type: NodeType, position: { x: number; y: number }, definition?: string) => void
  wire: (connection: Connection) => void
  remove: (ids: string | string[], edges?: string[]) => void
  replace: (value: unknown) => void
  edit: (change: (view: GraphDocument) => GraphDocument, remember?: boolean) => void
  openGroup: (id: string) => void
  switchTab: (id: string) => void
  closeTab: (id: string) => void
  makeGroup: (name?: string) => void
  changeDataType: (schema: DataTypeDefinition) => void
  changeInterface: (id: string, patch: Pick<NodeDefinition, 'name' | 'inputs' | 'outputs'>) => void
  undo: () => void; redo: () => void
}

const freshId = (prefix = 'n') => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`
const clearThumbnails = (state: State) => { for (const preview of Object.values(state.thumbnails)) preview.bitmap?.close() }
const target = (doc: GraphDocument) => doc.nodes.find(n => n.type === 'output' || n.type === 'groupOutput')?.id ?? doc.nodes[0]?.id ?? ''
const defaults = (doc: GraphDocument) => Object.fromEntries(doc.nodes.map(n => [n.id, ['source', 'clip', 'output', 'groupInput', 'groupOutput'].includes(n.type)]))
const initial = explicitGraph('filter')

/** Root project and reusable definitions are authoritative; the active tab is only a view. */
export const useEditor = create<State>((set, get) => {
  const commit = (doc: GraphDocument, remember = true) => {
    const state = get(), tabs = state.tabs.filter(tab => { try { pathDefinition(doc, tab.path); return true } catch { return false } })
    const tab = tabs.find(t => t.id === state.activeTab) ?? tabs[0]!, view = graphView(doc, tab.definition)
    set({ doc, view, tabs, activeTab: tab.id, path: tab.path, ...(remember ? { past: [...state.past.slice(-49), state.doc], future: [] } : {}), error: '' })
  }
  const edit = (change: (view: GraphDocument) => GraphDocument, remember = true) => {
    try { const s = get(); commit(replaceView(s.doc, s.view.interfaceId, change(s.view)), remember) }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
  }
  const switchTab = (id: string) => {
    const state = get(), tab = state.tabs.find(t => t.id === id)
    if (!tab || state.busy === 'bake') return
    const view = graphView(state.doc, tab.definition), selected = view.nodes.some(n => n.id === tab.selected) ? tab.selected! : target(view)
    const focused = view.nodes.some(n => n.id === tab.focused) ? tab.focused! : selected
    clearThumbnails(state)
    set({ view, path: tab.path, activeTab: id, selected, focused, highlighted: [focused], port: tab.port ?? null, previews: defaults(view), thumbnails: {}, result: null, statuses: {}, revision: state.revision + 1, tabs: state.tabs.map(t => t.id === state.activeTab ? { ...t, focused: state.focused, selected: state.selected, port: state.port } : t) })
  }
  return {
    doc: initial, view: initial, path: [], tabs: [{ id: 'main', path: [] }], activeTab: 'main',
    highlighted: ['n5'], focused: 'n5', selected: 'n5', port: null, frame: 0, gain: 1, inspectorView: 'frame',
    ready: false, adapter: '', source: null, assets: {}, loadingSource: null, busy: 'idle', error: '', fatal: false,
    result: null, statuses: {}, progress: null, movie: null, cancelling: false, pixel: null, revision: 0,
    previews: defaults(initial), thumbnails: {}, past: [], future: [],
    edit, switchTab,
    bindSource: (target, info) => {
      const state = get()
      if (target.definition && !state.doc.definitions?.some(d => d.id === target.definition)) { set({ assets: { ...state.assets, [info.id]: info }, source: state.source ?? info }); return }
      const body = graphView(state.doc, target.definition), previous = body.nodes.find(n => n.id === target.node)
      clearThumbnails(state)
      commit(replaceView(state.doc, target.definition, { ...body, nodes: body.nodes.map(n => n.id === target.node && (n.type === 'source' || n.type === 'clip') ? { ...n, asset: info.id, assetName: info.name } : n) }))
      const reference = !state.source || state.source.id === previous?.asset || !previous?.asset && state.assets[info.id] === undefined && Object.keys(state.assets).length === 0
      set({ assets: { ...state.assets, [info.id]: info }, ...(reference ? { source: info, frame: 0 } : {}), result: null, pixel: null, thumbnails: {}, statuses: {} })
    },
    togglePreview: id => {
      const state = get()
      if (state.previews[id]) { state.thumbnails[id]?.bitmap?.close(); const thumbnails = { ...state.thumbnails }; delete thumbnails[id]; set({ thumbnails }) }
      set(s => ({ previews: { ...s.previews, [id]: !s.previews[id] } }))
    },
    insert: (value, position) => {
      const before = new Set(get().view.nodes.map(n => n.id))
      edit(view => insertPrefab(view, value, position ?? { x: 40, y: Math.max(0, ...view.nodes.map(n => n.position.y)) + 600 }, freshId))
      const inserted = get().view.nodes.filter(n => !before.has(n.id))
      if (!inserted.length) return
      set(s => ({ highlighted: inserted.map(n => n.id), focused: inserted[0]!.id, revision: s.revision + 1, previews: { ...s.previews, ...Object.fromEntries(inserted.map(n => [n.id, (n.type === 'source' || n.type === 'clip') || n.type === 'output'])) } }))
    },
    // Editing focus and the inspector target are deliberately independent.
    focus: focused => set({ focused, highlighted: [focused] }),
    select: (selected, port = null) => set({ selected, port, pixel: null, inspectorView: 'frame' }),
    parameter: (id, key, value) => edit(view => ({ ...view, nodes: view.nodes.map(n => n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n) })),
    add: (type, position, definition) => {
      if (get().view.nodes.length >= 100) { set({ error: 'A graph can contain up to 100 nodes.' }); return }
      const id = freshId(), node = { id, type, position, params: defaultParams(type), ...(definition ? type === 'makeRecord' || type === 'breakRecord' ? { dataType: definition } : { definition } : {}) }
      try {
        if (type === 'group' || type === 'makeRecord' || type === 'breakRecord') node.params = Object.fromEntries(specFor(node, get().view).parameters.map(p => [p.key, p.default]))
        edit(view => { const next = { ...view, nodes: [...view.nodes, node] }; parseDocument(replaceView(get().doc, view.interfaceId, next)); return next })
        if (get().view.nodes.some(n => n.id === id)) set({ focused: id, highlighted: [id] })
      } catch (error) { set({ error: String(error) }) }
    },
    wire: connection => edit(view => connect(view, connection)),
    remove: (ids, edges = []) => {
      const state = get(), requested = new Set(typeof ids === 'string' ? [ids] : ids), edgeIds = new Set(edges)
      if (state.busy === 'bake') return
      const removed = new Set(state.view.nodes.filter(n => requested.has(n.id) && n.type !== 'groupInput' && n.type !== 'groupOutput').map(n => n.id))
      if (!removed.size && !state.view.edges.some(e => edgeIds.has(e.id))) return
      // One graph edit keeps the whole selection and its connections together in Undo.
      edit(view => ({ ...view, nodes: view.nodes.filter(n => !removed.has(n.id)), edges: view.edges.filter(e => !edgeIds.has(e.id) && !removed.has(e.source) && !removed.has(e.target)) }))
      for (const id of removed) state.thumbnails[id]?.bitmap?.close()
      set(s => ({ highlighted: s.highlighted.filter(id => !removed.has(id)), focused: removed.has(s.focused) ? '' : s.focused, ...(removed.has(s.selected) ? { selected: '', port: null, result: null, pixel: null } : {}), previews: Object.fromEntries(Object.entries(s.previews).filter(([id]) => !removed.has(id))), thumbnails: Object.fromEntries(Object.entries(s.thumbnails).filter(([id]) => !removed.has(id))), statuses: Object.fromEntries(Object.entries(s.statuses).filter(([id]) => !removed.has(id))) }))
    },
    replace: value => {
      try {
        const doc = parseDocument(value), selected = target(doc)
        clearThumbnails(get()); commit(doc)
        set(s => ({ view: doc, path: [], tabs: [{ id: 'main', path: [] }], activeTab: 'main', selected, focused: selected, highlighted: [selected], previews: defaults(doc), thumbnails: {}, port: null, statuses: {}, result: null, error: '', gain: 1, revision: s.revision + 1 }))
      } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
    },
    openGroup: id => {
      const state = get(), node = state.view.nodes.find(n => n.id === id)
      if (node?.type !== 'group' || !node.definition) return
      const path = [...state.path, id], key = path.join('/')
      if (!state.tabs.some(t => t.id === key)) set({ tabs: [...state.tabs, { id: key, path, definition: node.definition }] })
      switchTab(key)
    },
    closeTab: id => { if (id === 'main') return; if (get().activeTab === id) switchTab('main'); set(s => ({ tabs: s.tabs.filter(t => t.id !== id) })) },
    makeGroup: (name = 'Custom Node') => {
      try {
        const state = get(), instance = freshId()
        const doc = groupNodes(state.doc, state.view.interfaceId, state.highlighted.length ? state.highlighted : [state.focused], name, freshId('g'), instance)
        commit(doc); set(s => ({ selected: s.view.nodes.some(n => n.id === s.selected) ? s.selected : instance, focused: instance, highlighted: [instance], port: s.view.nodes.some(n => n.id === s.selected) ? s.port : null, revision: s.revision + 1 })); get().openGroup(instance)
      } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
    },
    changeDataType: schema => { try { commit(updateDataType(get().doc, schema)) } catch (error) { set({ error: String(error) }) } },
    changeInterface: (id, patch) => { try { commit(updateInterface(get().doc, id, patch)) } catch (error) { set({ error: String(error) }) } },
    undo: () => {
      const s = get(), doc = s.past.at(-1); if (!doc || s.busy === 'bake') return
      clearThumbnails(s); commit(doc, false); set({ past: s.past.slice(0, -1), future: [s.doc, ...s.future], selected: get().view.nodes.some(n => n.id === s.selected) ? s.selected : target(get().view), focused: target(get().view), highlighted: [target(get().view)], port: get().view.nodes.some(n => n.id === s.selected) ? s.port : null, thumbnails: {}, revision: s.revision + 1 })
    },
    redo: () => {
      const s = get(), doc = s.future[0]; if (!doc || s.busy === 'bake') return
      clearThumbnails(s); commit(doc, false); set({ past: [...s.past, s.doc], future: s.future.slice(1), selected: get().view.nodes.some(n => n.id === s.selected) ? s.selected : target(get().view), focused: target(get().view), highlighted: [target(get().view)], port: get().view.nodes.some(n => n.id === s.selected) ? s.port : null, thumbnails: {}, revision: s.revision + 1 })
    },
  }
})

/** Layout and interface labels are excluded from semantic processing identity. */
export const computationKey = (doc: GraphDocument): string => JSON.stringify({ nodes: doc.nodes.map(({ id, type, params, definition, dataType, asset }) => ({ id, type, params, definition, dataType, asset })), edges: doc.edges, dataTypes: doc.dataTypes, definitions: doc.definitions?.map(d => ({ id: d.id, inputs: d.inputs, outputs: d.outputs, graph: computationKey(d.graph) })) })
export const nodeTitle = (id: string) => { const { view } = useEditor.getState(), node = view.nodes.find(n => n.id === id); return node ? specFor(node, view).title : 'Output' }
