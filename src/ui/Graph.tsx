import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useUpdateNodeInternals, useNodesInitialized } from '@xyflow/react'
import type { Edge, Node, NodeProps, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { SPECS, PORT_COLORS, specFor } from '../engine/specs'
import { validateConnection } from '../engine/graph'
import type { GraphNode, NodeType, NodeSpec, Parameter } from '../engine/types'
import { NodeMenu, selectedGraph } from './NodeMenu'
import type { MenuPosition } from './NodeMenu'
import type { GraphDocument } from '../engine/types'
import { useEditor } from './store'
import { SourceFile, videoFiles } from './SourceFile'
import { loadVideo } from './client'

type VisualNode = Node<{ model: GraphNode; spec: NodeSpec; connected: string[] }, 'operation'>
const symbols: Record<NodeType, string> = { source: '▷', grayscale: '◐', blur: '≋', delta: 'Δ', motion: '↗', translateX: '↔', translateY: '↕', multiply: '×', constant: '#', group: '▧', groupInput: '⇥', groupOutput: '⇤', output: '▣', time: 't', offset: '±', threshold: '◩', composite: '⊞' }

/** Keep partial numeric edits locally so typing a minus sign or clearing a field is possible. */
const NumberControl = ({ value, parameter, label, disabled, commit }: { value: number; parameter: Extract<Parameter, { kind: 'number' }>; label: string; disabled: boolean; commit: (value: number) => void }) => {
  const [draft, setDraft] = useState(String(value)), editing = useRef(false)
  // Do not replace a focused input with a delayed parent value between keystrokes.
  useEffect(() => { if (!editing.current) setDraft(String(value)) }, [value])
  const valid = (n: number) => Number.isFinite(n) && n >= parameter.min && n <= parameter.max && (parameter.step !== 1 || Number.isInteger(n))
  return <input aria-label={label} type="number" value={draft} min={parameter.min} max={parameter.max} step={parameter.step} disabled={disabled} onFocus={() => { editing.current = true }} title="Apply with Enter or when leaving the field" onChange={e => setDraft(e.target.value)} onBlur={e => { editing.current = false; if (valid(e.target.valueAsNumber)) commit(e.target.valueAsNumber); else setDraft(String(value)) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = String(value); setDraft(String(value)); e.currentTarget.blur() } }} />
}

const Operation = memo(({ data, selected }: NodeProps<VisualNode>) => {
  const node = data.model, spec = data.spec
  const status = useEditor(s => s.statuses[node.id]), parameter = useEditor(s => s.parameter)
  const enabled = useEditor(s => !!s.previews[node.id]), toggle = useEditor(s => s.togglePreview), thumbnail = useEditor(s => s.thumbnails[node.id])
  const canvas = useRef<HTMLCanvasElement>(null), updateInternals = useUpdateNodeInternals()
  const socketsKey = JSON.stringify([spec.inputs, spec.outputs])
  useEffect(() => { updateInternals(node.id) }, [node.id, socketsKey, enabled, updateInternals])
  useEffect(() => {
    if (!enabled || !thumbnail?.bitmap?.width || !canvas.current) return
    canvas.current.width = thumbnail.bitmap.width; canvas.current.height = thumbnail.bitmap.height
    canvas.current.getContext('2d')?.drawImage(thumbnail.bitmap, 0, 0)
  }, [enabled, thumbnail])
  const connected = (key: string) => data.connected.includes(node.type === 'group' ? key : key === 'pixels' ? 'in:scalar:pixels' : key === 'factor' ? 'in:scalar:b' : '')
  const frame = useEditor(s => s.frame), locked = useEditor(s => s.busy === 'bake')
  return <div className={`operation ${selected ? 'chosen' : ''}`} data-node={node.type} onDragOver={e => { if (node.type === 'source' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = locked ? 'none' : 'copy' } }} onDrop={e => {
    if (node.type !== 'source' || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault(); e.stopPropagation()
    const files = videoFiles(e.dataTransfer)
    if (locked) return
    if (files.length !== 1) { useEditor.setState({ error: 'Drop one video onto a source node, or drop multiple videos onto the canvas.' }); return }
    loadVideo(files[0]!, { node: node.id, definition: useEditor.getState().view.interfaceId })
  }}>
    <div className="node-preview-toolbar nodrag"><span>{enabled ? 'NODE PREVIEW' : 'PREVIEW HIDDEN'}</span><button aria-label={`${enabled ? 'Hide' : 'Show'} ${spec.title} preview`} onClick={() => toggle(node.id)}>{enabled ? 'Hide ◉' : 'Show ◉'}</button></div>
    {enabled && <div className="node-thumbnail nodrag" data-testid={`preview-${node.id}`}>
      <canvas ref={canvas} style={{ display: thumbnail?.bitmap ? 'block' : 'none' }} />
      {thumbnail?.scalar !== undefined && <strong>{thumbnail.scalar.toFixed(4)}</strong>}
      {thumbnail?.error && <span className="thumbnail-error">{thumbnail.error}</span>}
      {!thumbnail && <span>Load a clip and connect the inputs</span>}
      {thumbnail && !thumbnail.error && <code className="thumbnail-frame">#{thumbnail.frame.toFixed(2)}{frame !== thumbnail.frame ? ' · updating' : ''}</code>}
    </div>}
    <div className="operation-head"><span className={`op-symbol ${node.type}`}>{symbols[node.type]}</span><div><small>{spec.category}</small><strong>{spec.title}</strong></div><span className={`status-dot ${status?.state ?? ''}`} title={status ? `${status.state} · frame ${status.frame}` : 'Not evaluated for this selection'} /></div>
    {node.type === 'source' && <SourceFile node={node} />}
    <div className="sockets">
      {spec.inputs.map(port => <div className="socket input" key={port.id}>
        <Handle type="target" id={port.id} position={Position.Left} style={{ background: PORT_COLORS[port.type] }} />
        <span>{port.label}</span>{port.offsetParam && <code>{(frame + Number(node.params[port.offsetParam])).toFixed(2)}</code>}
      </div>)}
      {spec.outputs.map(port => <div className="socket output" key={port.id}>
        <span>{port.label}</span><Handle type="source" id={port.id} position={Position.Right} style={{ background: PORT_COLORS[port.type] }} />
      </div>)}
    </div>
    {spec.parameters.length > 0 && <div className="parameters nodrag nowheel">
      {spec.parameters.map(p => <label key={p.key}><span>{p.label}</span>{p.kind === 'boolean'
        ? <input type="checkbox" checked={!!node.params[p.key]} disabled={locked} onChange={e => parameter(node.id, p.key, e.target.checked)} />
        : p.kind === 'select'
          ? <select aria-label={`${spec.title} ${p.label}`} value={String(node.params[p.key])} disabled={locked} onChange={e => parameter(node.id, p.key, e.target.value)}>{p.options.map(o => <option key={o}>{o}</option>)}</select>
          : <NumberControl label={`${spec.title} ${p.label}`} value={Number(node.params[p.key])} parameter={p} disabled={locked || connected(p.key)} commit={value => parameter(node.id, p.key, value)} />}</label>)}
    </div>}
    {node.type === 'group' && <button className="enter-group nodrag" onClick={e => { e.stopPropagation(); useEditor.getState().openGroup(node.id) }}>Edit internal nodes ↗</button>}
    <div className="op-foot"><code>{spec.algorithm}</code><span>{status?.state === 'cached' ? 'cached' : status?.ms !== undefined ? `${Math.round(status.ms)} ms` : ''}</span></div>
  </div>
})
const nodeTypes = { operation: Operation }

const Canvas = () => {
  const doc = useEditor(s => s.view), highlighted = useEditor(s => s.highlighted), wire = useEditor(s => s.wire)
  const revision = useEditor(s => s.revision), locked = useEditor(s => s.busy === 'bake')
  const flow = useReactFlow<VisualNode>(), nodesInitialized = useNodesInitialized(), fittedRevision = useRef<number | undefined>(undefined)
  const [menu, setMenu] = useState<MenuPosition | null>(null), [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const clipboard = useRef<GraphDocument | null>(null), container = useRef<HTMLDivElement>(null)
  const openMenu = (x: number, y: number, node?: string, edge?: string) => { if (!locked) setMenu({ x, y, world: flow.screenToFlowPosition({ x, y }), node, edge }) }
  useEffect(() => {
    if (!nodesInitialized || fittedRevision.current === revision) return
    fittedRevision.current = revision
    // Fit measured nodes once per graph change. Overlapping startup animations can
    // interpolate a zero-size viewport into NaN transforms in a fresh browser.
    void flow.fitView({ padding: 0.15, maxZoom: 1 })
  }, [revision, nodesInitialized, flow])
  const nodes: VisualNode[] = doc.nodes.map(model => ({ id: model.id, position: model.position, data: { model, spec: specFor(model, doc), connected: doc.edges.filter(e => e.target === model.id).map(e => e.targetHandle) }, type: 'operation', deletable: model.type !== 'groupInput' && model.type !== 'groupOutput', selected: highlighted.includes(model.id) }))
  const edges: Edge[] = doc.edges.map(e => {
    const source = doc.nodes.find(n => n.id === e.source), type = source && specFor(source, doc).outputs.find(p => p.id === e.sourceHandle)?.type
    return { ...e, selected: selectedEdge === e.id, type: 'default', style: { stroke: PORT_COLORS[type ?? 'frame'], strokeWidth: 1.7 } }
  })
  const onNodesChange = useCallback((changes: NodeChange<VisualNode>[]) => {
    for (const c of changes) {
      if (c.type === 'position' && c.position) useEditor.getState().edit(view => ({ ...view, nodes: view.nodes.map(n => n.id === c.id ? { ...n, position: c.position! } : n) }), false)
      else if (c.type === 'select') useEditor.setState(s => ({ highlighted: c.selected ? [...new Set([...s.highlighted, c.id])] : s.highlighted.filter(id => id !== c.id) }))
      else if (c.type === 'remove' && useEditor.getState().busy !== 'bake') useEditor.getState().remove(c.id)
    }
  }, [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) { if (c.type === 'select') setSelectedEdge(c.selected ? c.id : null); if (c.type === 'remove' && useEditor.getState().busy !== 'bake') useEditor.getState().edit(view => ({ ...view, edges: view.edges.filter(e => e.id !== c.id) })) }
  }, [])
  return <div ref={container} className="graph-surface" tabIndex={0} aria-label="Node editor" onKeyDown={e => {
    if (locked || menu || (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName))) return
    const bounds = container.current!.getBoundingClientRect(), point = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    if (e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openMenu(point.x, point.y) }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { useEditor.getState().makeGroup(); e.preventDefault() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (e.shiftKey) useEditor.getState().redo(); else useEditor.getState().undo(); e.preventDefault() }
    else if (e.key === 'Tab') { useEditor.getState().openGroup(useEditor.getState().selected); e.preventDefault() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { clipboard.current = structuredClone(selectedGraph()); e.preventDefault() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.current) { useEditor.getState().insert(clipboard.current, flow.screenToFlowPosition(point)); e.preventDefault() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { useEditor.getState().insert(selectedGraph(), flow.screenToFlowPosition(point)); e.preventDefault() }
  }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={e => {
    e.preventDefault()
    if (locked) return
    if (e.dataTransfer.types.includes('Files')) {
      const files = videoFiles(e.dataTransfer), position = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      if (!files.length) { useEditor.setState({ error: 'Drop a video file here. MP4 and MOV containers are supported.' }); return }
      for (const [index, file] of files.entries()) {
        const state = useEditor.getState(), before = state.selected
        state.add('source', { x: position.x + index * 300, y: position.y })
        const next = useEditor.getState()
        if (next.selected !== before) { next.togglePreview(next.selected); loadVideo(file, { node: next.selected, definition: next.view.interfaceId }) }
      }
      return
    }
    const type = e.dataTransfer.getData('application/cadence-node')
    if (Object.hasOwn(SPECS, type) && !locked) useEditor.getState().add(type as NodeType, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }}>
    <ReactFlow<VisualNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={wire} onNodeDoubleClick={(_e, n) => useEditor.getState().openGroup(n.id)} onNodeClick={(_e, n) => { useEditor.setState({ selected: n.id, port: null }); setSelectedEdge(null) }} onPaneContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY) }} onNodeContextMenu={(e, n) => { e.preventDefault(); if (!highlighted.includes(n.id)) useEditor.getState().select(n.id); openMenu(e.clientX, e.clientY, n.id) }} onEdgeContextMenu={(e, edge) => { e.preventDefault(); setSelectedEdge(edge.id); openMenu(e.clientX, e.clientY, undefined, edge.id) }} isValidConnection={(c: Connection | Edge) => !validateConnection(useEditor.getState().view, c)} minZoom={0.2} maxZoom={1.6} multiSelectionKeyCode={['Shift', 'Control', 'Meta']} nodesConnectable={!locked} deleteKeyCode={locked ? null : ['Backspace', 'Delete']} colorMode="dark" >
      <Background variant={BackgroundVariant.Dots} color="#374239" gap={22} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
    <div className="graph-help">Drop videos here · Right-click / Shift A to add · Shift-select multiple</div>
    {menu && <NodeMenu position={menu} close={() => { setMenu(null); container.current?.focus() }} />}
  </div>
}
export const Graph = () => { const active = useEditor(s => s.activeTab); return <ReactFlowProvider key={active}><Canvas /></ReactFlowProvider> }
