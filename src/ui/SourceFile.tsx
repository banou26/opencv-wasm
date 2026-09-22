import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { GraphNode } from '../engine/types'
import { loadVideo } from './client'
import { useEditor } from './store'

export const videoFiles = (transfer: DataTransfer) => Array.from(transfer.files).filter(file => file.type.startsWith('video/') || /\.(mp4|m4v|mov|mkv|webm)$/i.test(file.name))

/** Local clip attachment lives with the node, including missing-file recovery after import. */
export const SourceFile = ({ node }: { node: GraphNode }) => {
  const input = useRef<HTMLInputElement>(null), [over, setOver] = useState(false)
  const assets = useEditor(s => s.assets), reference = useEditor(s => s.source), definition = useEditor(s => s.view.interfaceId)
  const loading = useEditor(s => s.loadingSource), locked = useEditor(s => s.busy === 'bake')
  const info = node.asset ? assets[node.asset] : reference
  const importing = loading?.node === node.id && loading.definition === definition
  const attach = (file: File) => loadVideo(file, { node: node.id, definition })
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault(); event.stopPropagation(); setOver(false)
    const files = videoFiles(event.dataTransfer)
    if (locked) return
    if (files.length !== 1) { useEditor.setState({ error: 'Drop one video onto a source node, or drop multiple videos onto the canvas.' }); return }
    attach(files[0]!)
  }
  return <div className={`source-file nodrag nowheel ${over ? 'drag-over' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = locked ? 'none' : 'copy'; setOver(!locked) } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) }} onDrop={drop}>
    <strong title={info?.name ?? node.assetName}>{importing ? 'Indexing clip…' : info?.name ?? (node.asset ? `Reattach ${node.assetName ?? 'video'}` : 'Drop a video here')}</strong>
    <span>{info ? `${info.width} × ${info.height} · ${info.frameCount} frames` : 'MP4 / MOV · local file'}</span>
    {info && !node.asset && <small>Using timeline clip</small>}
    <button disabled={locked} onClick={e => { e.stopPropagation(); input.current?.click() }}>{info ? 'Replace file…' : 'Open file…'}</button>
    <input ref={input} hidden type="file" accept="video/mp4,.mp4,.m4v,.mov" aria-label="Video source file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) attach(file) }} />
    {Object.keys(assets).length > 0 && <select aria-label="Source clip" disabled={locked} value={node.asset ?? ''} onChange={e => { const asset = assets[e.target.value]; if (asset) useEditor.getState().bindSource({ node: node.id, definition }, asset) }}>
      <option value="" disabled>{node.asset && !info ? 'Missing clip' : 'Choose loaded clip…'}</option>
      {node.asset && !info && <option value={node.asset}>Missing: {node.assetName}</option>}
      {Object.values(assets).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
    </select>}
  </div>
}
