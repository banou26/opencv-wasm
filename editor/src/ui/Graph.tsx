import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useUpdateNodeInternals, useNodesInitialized } from '@xyflow/react'
import type { Edge, Node, NodeProps, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { SPECS, PORT_COLORS, PORT_LABELS, specFor } from '../engine/specs'
import { validateConnection } from '../engine/graph'
import type { GraphNode, NodeType, NodeSpec, Parameter } from '../engine/types'
import { NodeMenu, selectedGraph } from './NodeMenu'
import { ConnectionMenu } from './ConnectionMenu'
import { NodeHelp } from './NodeHelp'
import type { MenuPosition } from './NodeMenu'
import type { GraphDocument } from '../engine/types'
import { useEditor } from './store'
import { SourceFile, videoFiles } from './SourceFile'
import { loadVideo } from './client'

type VisualNode = Node<{ model: GraphNode; spec: NodeSpec; connected: string[] }, 'operation'>
const symbols: Partial<Record<NodeType, string>> = { source: '▷', grayscale: '◐', blur: '≋', delta: 'Δ', motion: '↗', translateX: '↔', translateY: '↕', multiply: '×', constant: '#', group: '▧', groupInput: '⇥', groupOutput: '⇤', output: '▣', time: 't', offset: '±', extractFrame: '#N', threshold: '◩', composite: '⊞' }

/** Keep partial numeric edits locally so typing a minus sign or clearing a field is possible. */
const NumberControl = ({ value, parameter, label, disabled, commit }: { value: number; parameter: Extract<Parameter, { kind: 'number' }>; label: string; disabled: boolean; commit: (value: number) => void }) => {
  const [draft, setDraft] = useState(String(value)), editing = useRef(false)
  // Do not replace a focused input with a delayed parent value between keystrokes.
  useEffect(() => { if (!editing.current) setDraft(String(value)) }, [value])
  const valid = (n: number) => Number.isFinite(n) && n >= parameter.min && n <= parameter.max && (parameter.step !== 1 || Number.isInteger(n))
  return <input aria-label={label} type="number" value={draft} min={parameter.min} max={parameter.max} step={parameter.step} disabled={disabled} onFocus={() => { editing.current = true }} title="Updates immediately when the value is valid" onChange={e => { setDraft(e.target.value); const next = e.target.valueAsNumber; if (valid(next) && next !== value) commit(next) }} onBlur={e => { editing.current = false; const next = e.target.valueAsNumber; if (valid(next)) { if (next !== value) commit(next); setDraft(String(next)) } else setDraft(String(value)) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = String(value); setDraft(String(value)); e.currentTarget.blur() } }} />
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

  const frame = useEditor(s => s.frame), locked = useEditor(s => s.busy === 'bake')
  return <div className={`operation ${selected ? 'chosen' : ''}`} data-node={node.type} onDragOver={e => { if ((node.type === 'source' || node.type === 'clip') && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = locked ? 'none' : 'copy' } }} onDrop={e => {
    if (node.type !== 'source' && node.type !== 'clip' || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault(); e.stopPropagation()
    const files = videoFiles(e.dataTransfer)
    if (locked) return
    if (files.length !== 1) { useEditor.setState({ error: 'Drop one video onto a source node, or drop multiple videos onto the canvas.' }); return }
    loadVideo(files[0]!, { node: node.id, definition: useEditor.getState().view.interfaceId })
  }}>
    <div className="node-preview-toolbar node-drag-handle"><span>{enabled ? 'NODE PREVIEW' : 'PREVIEW HIDDEN'}</span><button className="nodrag" aria-label={`${enabled ? 'Hide' : 'Show'} ${spec.title} preview`} onClick={() => toggle(node.id)}>{enabled ? 'Hide ◉' : 'Show ◉'}</button></div>
    {enabled && <div className="node-thumbnail node-drag-handle" data-testid={`preview-${node.id}`}>
      <canvas ref={canvas} style={{ display: thumbnail?.bitmap ? 'block' : 'none' }} />
      {thumbnail?.scalar !== undefined && <strong>{thumbnail.scalar.toFixed(4)}</strong>}
      {thumbnail?.summary !== undefined && thumbnail.scalar === undefined && !thumbnail.bitmap && <pre className="thumbnail-value">{thumbnail.summary}</pre>}
      {thumbnail?.error && <span className="thumbnail-error">{thumbnail.error}</span>}
      {!thumbnail && <span>Connect the inputs to see this result</span>}
      {thumbnail && !thumbnail.error && <code className="thumbnail-frame">#{thumbnail.frame.toFixed(2)}{frame !== thumbnail.frame ? ' · updating' : ''}</code>}
    </div>}
    <div className="operation-head node-drag-handle"><span className={`op-symbol ${node.type}`}>{symbols[node.type] ?? '◇'}</span><div><small>{spec.category}</small><strong>{spec.title}</strong></div><NodeHelp spec={spec} /><span className={`status-dot ${status?.state ?? ''}`} title={status ? `${status.state} · frame ${status.frame}` : 'Not evaluated for this selection'} /></div>
    {(node.type === 'source' || node.type === 'clip') && <SourceFile node={node} />}
    <div className="sockets">
      {spec.inputs.map(port => {
        const control = spec.parameters.find(p => p.key === port.parameter), connected = data.connected.includes(port.id), label = control && `${spec.title} ${control.label}`
        return <div className={`socket input ${control ? 'parameter-socket' : ''}`} key={port.id} style={{ '--socket-color': PORT_COLORS[port.type] } as CSSProperties}>
          <Handle type="target" id={port.id} position={Position.Left} title={`${port.label} · ${PORT_LABELS[port.type]} input · Drag to connect · Right-click to disconnect`} />
          <span title={port.label}>{control?.label ?? port.label}</span><small className="socket-type">{PORT_LABELS[port.type]}</small>
          {control && <div className="socket-control nodrag nowheel">{connected ? <span className="wired-parameter" title="The connected value overrides the saved default. Disconnect to edit the default again.">↳ Connected</span> : control.kind === 'number'
            ? <NumberControl label={label!} value={Number(node.params[control.key])} parameter={control} disabled={locked} commit={value => parameter(node.id, control.key, value)} />
            : control.kind === 'boolean' ? <input aria-label={label} type="checkbox" checked={Boolean(node.params[control.key])} disabled={locked} onChange={e => parameter(node.id, control.key, e.target.checked)} />
              : control.kind === 'select' ? <select aria-label={label} value={String(node.params[control.key])} disabled={locked} onChange={e => parameter(node.id, control.key, e.target.value)}>{control.options.map(option => <option key={option}>{option}</option>)}</select>
                : <input aria-label={label} type="text" maxLength={control.maxLength} value={String(node.params[control.key])} disabled={locked} onChange={e => parameter(node.id, control.key, e.target.value)} />}</div>}
          {!control && (port.frameParam ? <code>#{String(node.params[port.frameParam])}</code> : port.offsetParam && <code>{(frame + Number(node.params[port.offsetParam])).toFixed(2)}</code>)}
        </div>
      })}
      {spec.outputs.map(port => <div className="socket output" key={port.id} style={{ '--socket-color': PORT_COLORS[port.type] } as CSSProperties}>
        <small className="socket-type">{PORT_LABELS[port.type]}</small><span>{port.label}</span><Handle type="source" id={port.id} position={Position.Right} title={`${port.label} · ${PORT_LABELS[port.type]} output · Drag to connect · Right-click to disconnect`} />
      </div>)}
    </div>
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
  // Controlled React Flow nodes must retain measurements across ordinary rerenders.
  // Dropping them resets handle bounds and makes selection treat nodes as unmeasured.
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({})
  const clipboard = useRef<GraphDocument | null>(null), container = useRef<HTMLDivElement>(null)
  const openMenu = (x: number, y: number, node?: string, edge?: string, socket?: MenuPosition['socket']) => { if (!locked) { if (!edge) setSelectedEdge(null); setMenu({ x, y, world: flow.screenToFlowPosition({ x, y }), node, edge, socket }) } }
  useEffect(() => {
    if (!nodesInitialized || fittedRevision.current === revision) return
    fittedRevision.current = revision
    // Fit measured nodes once per graph change. Overlapping startup animations can
    // interpolate a zero-size viewport into NaN transforms in a fresh browser.
    void flow.fitView({ padding: 0.15, maxZoom: 1 })
  }, [revision, nodesInitialized, flow])
  const nodes: VisualNode[] = doc.nodes.map(model => ({ id: model.id, position: model.position, measured: measurements[model.id], data: { model, spec: specFor(model, doc), connected: doc.edges.filter(e => e.target === model.id).map(e => e.targetHandle) }, type: 'operation', dragHandle: '.node-drag-handle', deletable: model.type !== 'groupInput' && model.type !== 'groupOutput', selected: highlighted.includes(model.id) }))
  const edges: Edge[] = doc.edges.map(e => {
    const source = doc.nodes.find(n => n.id === e.source), type = source && specFor(source, doc).outputs.find(p => p.id === e.sourceHandle)?.type
    return { ...e, selected: selectedEdge === e.id, type: 'default', interactionWidth: 28, style: { stroke: PORT_COLORS[type ?? 'frame'] } }
  })
  const onNodesChange = useCallback((changes: NodeChange<VisualNode>[]) => {
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) setMeasurements(s => s[c.id]?.width === c.dimensions!.width && s[c.id]?.height === c.dimensions!.height ? s : { ...s, [c.id]: c.dimensions! })
      else if (c.type === 'position' && c.position) useEditor.getState().edit(view => ({ ...view, nodes: view.nodes.map(n => n.id === c.id ? { ...n, position: c.position! } : n) }), false)
      else if (c.type === 'select') useEditor.setState(s => ({ highlighted: c.selected ? [...new Set([...s.highlighted, c.id])] : s.highlighted.filter(id => id !== c.id) }))
    }
  }, [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) if (c.type === 'select') setSelectedEdge(c.selected ? c.id : null)
  }, [])
  return <div ref={container} className="graph-surface" tabIndex={0} aria-label="Node editor" onContextMenuCapture={e => {
    const handle = e.target instanceof Element ? e.target.closest<HTMLElement>('.react-flow__handle') : null
    if (!handle?.dataset.nodeid || !handle.dataset.handleid) return
    e.preventDefault(); e.stopPropagation(); setSelectedEdge(null)
    openMenu(e.clientX, e.clientY, undefined, undefined, { node: handle.dataset.nodeid, handle: handle.dataset.handleid, type: handle.classList.contains('target') ? 'target' : 'source' })
  }} onKeyDown={e => {
    if (locked || menu || (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName))) return
    const bounds = container.current!.getBoundingClientRect(), point = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    if (e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openMenu(point.x, point.y) }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { useEditor.getState().makeGroup(); e.preventDefault() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (e.shiftKey) useEditor.getState().redo(); else useEditor.getState().undo(); e.preventDefault() }
    else if (e.key === 'Tab') { useEditor.getState().openGroup(useEditor.getState().focused); e.preventDefault() }
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
        const state = useEditor.getState(), before = state.focused
        state.add('clip', { x: position.x + index * 300, y: position.y })
        const next = useEditor.getState()
        if (next.focused !== before) { next.togglePreview(next.focused); loadVideo(file, { node: next.focused, definition: next.view.interfaceId }) }
      }
      return
    }
    const type = e.dataTransfer.getData('application/cadence-node')
    if (Object.hasOwn(SPECS, type) && !locked) useEditor.getState().add(type as NodeType, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }}>
    <ReactFlow<VisualNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onDelete={({ nodes, edges }) => { useEditor.getState().remove(nodes.map(n => n.id), edges.map(e => e.id)); setSelectedEdge(null) }} onConnect={wire} onNodeDoubleClick={(_e, n) => useEditor.getState().openGroup(n.id)} onNodeClick={(_e, n) => { useEditor.setState({ focused: n.id }); setSelectedEdge(null) }} onEdgeClick={(_e, edge) => { useEditor.setState({ highlighted: [], focused: '' }); setSelectedEdge(edge.id) }} onPaneClick={() => setSelectedEdge(null)} onPaneContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY) }} onSelectionContextMenu={(e, nodes) => { e.preventDefault(); e.stopPropagation(); useEditor.setState({ highlighted: nodes.map(n => n.id) }); openMenu(e.clientX, e.clientY) }} onNodeContextMenu={(e, n) => { e.preventDefault(); e.stopPropagation(); if (!useEditor.getState().highlighted.includes(n.id)) useEditor.getState().focus(n.id); else useEditor.setState({ focused: n.id }); openMenu(e.clientX, e.clientY, n.id) }} onEdgeContextMenu={(e, edge) => { e.preventDefault(); e.stopPropagation(); useEditor.setState({ highlighted: [], focused: '' }); setSelectedEdge(edge.id); openMenu(e.clientX, e.clientY, undefined, edge.id) }} isValidConnection={(c: Connection | Edge) => !validateConnection(useEditor.getState().view, c)} minZoom={0.2} maxZoom={1.6} multiSelectionKeyCode={['Shift', 'Control', 'Meta']} nodesDraggable={!locked} nodesConnectable={!locked} deleteKeyCode={locked ? null : ['Backspace', 'Delete']} colorMode="dark" >
      <Background variant={BackgroundVariant.Dots} color="var(--cv-grid)" gap={22} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
    {selectedEdge && doc.edges.some(e => e.id === selectedEdge) ? <div className="edge-tools"><span>Wire selected · Delete to disconnect</span><button disabled={locked} onClick={() => { useEditor.getState().remove([], [selectedEdge]); setSelectedEdge(null) }}>Disconnect wire</button></div> : <div className="graph-help">Right-click to add nodes · Right-click wires or sockets to disconnect</div>}
    {menu && (menu.edge || menu.socket ? <ConnectionMenu position={menu} close={() => { setMenu(null); container.current?.focus() }} /> : <NodeMenu position={menu} close={() => { setMenu(null); container.current?.focus() }} />)}
  </div>
}
export const Graph = () => { const active = useEditor(s => s.activeTab); return <ReactFlowProvider key={active}><Canvas /></ReactFlowProvider> }
