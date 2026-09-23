import { useEffect, useRef, useState } from 'react'
import { SPECS, HIDDEN_NODES } from '../engine/specs'
import { searchNodes, matchesQuery } from '../engine/search'
import { explicitGraph } from '../engine/prefabs'
import type { GraphDocument, NodeType } from '../engine/types'
import { useEditor } from './store'
import { saveBlob } from './client'

export type MenuPosition = { x: number; y: number; world: { x: number; y: number }; node?: string; edge?: string; socket?: { node: string; handle: string; type: 'source' | 'target' } }
const prefabs = [
  { id: 'texture', title: 'Procedural stripe texture', description: 'No video required: pixel coordinates + seeded noise → editable RGB arithmetic → Time-driven wrapped translation → output' },
  { id: 'motionVectors', title: 'Regional motion vectors', description: 'Motion cookbook: explicit frame pair → coarse pan → forward and reverse dense flow → texture + round-trip checks → regional medians → arrows over video' },
  { id: 'regionalLayers', title: 'Whole-scene regional analysis', description: 'Explicit scene range -> dense motion -> multiscale cells -> temporal motion groups -> drawing events -> evidence inspectors' },
  { id: 'difference', title: 'Compare neighboring frames', description: 'Video + explicit indices → two frames → grayscale → blur → difference → output' },
  { id: 'motion', title: 'Camera in-betweens', description: 'Two explicit frames → translation × fraction → move previous → fill revealed borders from next → output' },
  { id: 'mask', title: 'Changed-pixel mask', description: 'Frame comparison → threshold → output' },
  { id: 'crop', title: 'Process a region', description: 'Extract frame → rectangle → crop → Gaussian blur → paste into original → output' },
  { id: 'pyramid', title: 'Explore Laplacian pyramids', description: 'Extract frame → editable Down / Up / Subtract group → detail bands → reconstruction' },
  { id: 'filter', title: 'Prepare an image', description: 'Video → Extract Video Frame → grayscale → blur → output' },
] as const
const categories = ['Input', 'Generate', 'Video', 'Frame', 'Data', 'Region', 'Regional analysis', 'Color', 'Filter', 'Edges', 'Pyramid', 'Measure', 'Mask', 'Math', 'Transform', 'Compose', 'Output', 'Custom', 'Prefabs']

/** Copy only selected nodes and connections between them; disconnected boundary inputs stay editable. */
export const selectedGraph = (): GraphDocument => {
  const { view: doc, highlighted, focused } = useEditor.getState(), ids = new Set(highlighted.length ? highlighted : [focused])
  const nodes = doc.nodes.filter(n => ids.has(n.id) && !['groupInput', 'groupOutput'].includes(n.type)), kept = new Set(nodes.map(n => n.id))
  return { version: 1, definitions: doc.definitions, dataTypes: doc.dataTypes, nodes, edges: doc.edges.filter(e => kept.has(e.source) && kept.has(e.target)) }
}

/** Cursor-positioned add menu with keyboard navigation and typo-tolerant property search. */
export const NodeMenu = ({ position, close }: { position: MenuPosition; close: () => void }) => {
  const [query, setQuery] = useState(''), [category, setCategory] = useState('Input'), [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null)
  const node = useEditor(s => s.view.nodes.find(n => n.id === position.node))
  const highlighted = useEditor(s => s.highlighted), view = useEditor(s => s.view)
  const selection = view.nodes.filter(n => highlighted.includes(n.id)), editable = selection.filter(n => n.type !== 'groupInput' && n.type !== 'groupOutput')
  const showSelection = selection.length > 0, multiple = selection.length > 1
  const definitions = useEditor(s => s.doc.definitions) ?? []
  const customResults = definitions.filter(d => query.trim() ? matchesQuery(query, `${d.name} ${[...d.inputs, ...d.outputs].map(p => p.label).join(' ')}`) : category === 'Custom')
  const nodes = query.trim() ? searchNodes(query) : Object.values(SPECS).filter(s => s.category === category && !HIDDEN_NODES.includes(s.type)).map(s => s.type)
  const prefabResults = query.trim() ? prefabs.filter(p => matchesQuery(query, `${p.title} ${p.description} prefab`)) : category === 'Prefabs' ? prefabs : []
  const dataTypes = useEditor(s => s.doc.dataTypes) ?? []
  const records = dataTypes.flatMap(schema => (['makeRecord', 'breakRecord'] as const).map(type => ({ schema, type, title: `${type === 'makeRecord' ? 'Make' : 'Separate'} ${schema.name}` }))).filter(item => query.trim() ? matchesQuery(query, `${item.title} ${item.schema.fields.map(f => f.label).join(' ')} record custom data`) : category === 'Custom')
  const count = nodes.length + prefabResults.length + customResults.length + records.length
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 495))
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' }) }, [index])
  const add = (type: NodeType) => { useEditor.getState().add(type, position.world); close() }
  const choose = (at: number) => {
    const type = nodes[at], prefab = prefabResults[at - nodes.length], custom = customResults[at - nodes.length - prefabResults.length]
    if (type) add(type)
    else if (prefab) { useEditor.getState().insert(explicitGraph(prefab.id), position.world); close() }
    else if (records[at - nodes.length - prefabResults.length - customResults.length]) { const record = records[at - nodes.length - prefabResults.length - customResults.length]!; useEditor.getState().add(record.type, position.world, record.schema.id); close() }
    else if (custom) { useEditor.getState().add('group', position.world, custom.id); close() }
  }
  return <div className="menu-backdrop" onPointerDown={close} onContextMenu={e => { e.preventDefault(); close() }}>
    <div className="node-menu" role="dialog" aria-label="Add node" style={{ left: Math.max(8, Math.min(position.x, window.innerWidth - 488)), top, maxHeight: `calc(100dvh - ${top + 8}px)` }} onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => count ? (i + (e.key === 'ArrowDown' ? 1 : count - 1)) % count : 0) }
      else if (e.key === 'Enter') { e.preventDefault(); choose(index) }
      else if (e.key === 'Tab') { e.preventDefault(); input.current?.focus() }
    }}>
      <div className="menu-title"><span>{showSelection ? `${selection.length} node${multiple ? 's' : ''} selected` : 'Add to graph'}</span><code>Shift A</code><button aria-label="Close node menu" onClick={close}>×</button></div>
      <div className="menu-search"><span>⌕</span><input ref={input} aria-label="Search nodes" placeholder="Search nodes, algorithms or properties…" value={query} onChange={e => { setQuery(e.target.value); setIndex(0) }} /></div>
      {(node || showSelection) && <div className="menu-context">
        {node && <><button onClick={() => { useEditor.getState().select(node.id); close() }}>Select for preview</button><button onClick={() => { useEditor.getState().togglePreview(node.id); close() }}>Toggle node preview</button></>}
        {showSelection && <><button disabled={!editable.length} onClick={() => { const anchor = editable[0]!; useEditor.getState().insert(selectedGraph(), { x: anchor.position.x + 40, y: anchor.position.y + 40 }); close() }}>{multiple ? 'Duplicate selected nodes' : 'Duplicate'}</button><button disabled={!editable.length} onClick={() => { useEditor.getState().makeGroup(); close() }}>Make custom node</button><button disabled={!editable.length} onClick={() => { saveBlob(new Blob([JSON.stringify(selectedGraph(), null, 2)], { type: 'application/json' }), 'opencv-prefab.json'); close() }}>Save prefab to folder</button><button className="danger" disabled={!editable.length} onClick={() => { useEditor.getState().remove(editable.map(n => n.id)); close() }}>{multiple ? `Delete selected nodes (${editable.length})` : 'Delete'}</button></>}
      </div>}
      <div className={`menu-body ${query ? 'searching' : ''}`}>
        {!query && <nav aria-label="Node categories">{categories.map(c => <button key={c} className={category === c ? 'active' : ''} onMouseEnter={() => { setCategory(c); setIndex(0) }} onFocus={() => { setCategory(c); setIndex(0) }} onClick={() => { setCategory(c); setIndex(0); input.current?.focus() }}>{c}<span>›</span></button>)}</nav>}
        <div className="menu-results" ref={list} role="listbox" aria-label="Available nodes">
          {nodes.map((type, i) => <button key={type} role="option" aria-selected={index === i} className={index === i ? 'highlighted' : ''} data-index={i} onMouseEnter={() => setIndex(i)} onClick={() => add(type)}><strong>{SPECS[type].title}<small>{SPECS[type].category}</small></strong><span>{SPECS[type].description}</span></button>)}
          {prefabResults.map((p, i) => <button key={p.id} role="option" aria-selected={index === nodes.length + i} className={index === nodes.length + i ? 'highlighted' : ''} data-index={nodes.length + i} onMouseEnter={() => setIndex(nodes.length + i)} onClick={() => choose(nodes.length + i)}><strong>{p.title}<small>Prefab</small></strong><span>{p.description}</span></button>)}
          {customResults.map((d, i) => { const at = nodes.length + prefabResults.length + i; return <button key={d.id} role="option" aria-selected={index === at} className={index === at ? 'highlighted' : ''} data-index={at} onMouseEnter={() => setIndex(at)} onClick={() => choose(at)}><strong>{d.name}<small>Custom node</small></strong><span>{d.inputs.length} inputs → {d.outputs.length} outputs · double-click to enter</span></button> })}
          {records.map((record, i) => { const at = nodes.length + prefabResults.length + customResults.length + i; return <button key={`${record.type}-${record.schema.id}`} role="option" aria-selected={index === at} className={index === at ? 'highlighted' : ''} data-index={at} onMouseEnter={() => setIndex(at)} onClick={() => choose(at)}><strong>{record.title}<small>Data type</small></strong><span>{record.schema.fields.map(f => `${f.label}: ${f.type}`).join(' · ')}</span></button> })}
          {count === 0 && <p>No match. Try “blur”, “sigma”, “mask” or “time”.</p>}
        </div>
      </div><div className="menu-hint">↑ ↓ navigate · Enter place · Esc close<span>Typos welcome</span></div>
    </div>
  </div>
}
