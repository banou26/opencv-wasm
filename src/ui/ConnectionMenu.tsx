import { useEffect, useRef } from 'react'
import { specFor } from '../engine/specs'
import type { MenuPosition } from './NodeMenu'
import { useEditor } from './store'

/** Disconnect a wire or a socket's connections without changing either endpoint node. */
export const ConnectionMenu = ({ position, close }: { position: MenuPosition; close: () => void }) => {
  const view = useEditor(s => s.view), locked = useEditor(s => s.busy === 'bake'), menu = useRef<HTMLDivElement>(null)
  const socket = position.socket
  const connections = view.edges.filter(e => position.edge ? e.id === position.edge : socket?.type === 'target' ? e.target === socket.node && e.targetHandle === socket.handle : e.source === socket?.node && e.sourceHandle === socket?.handle)
  const endpoint = (id: string, handle: string, input: boolean) => {
    const node = view.nodes.find(n => n.id === id)
    if (!node) return id
    const spec = specFor(node, view), port = (input ? spec.inputs : spec.outputs).find(p => p.id === handle)
    return `${spec.title} · ${port?.label ?? handle}`
  }
  const disconnect = (ids: string[]) => { useEditor.getState().remove([], ids); close() }
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 280))
  useEffect(() => { (menu.current?.querySelector<HTMLButtonElement>('[data-disconnect]:not(:disabled)') ?? menu.current?.querySelector<HTMLButtonElement>('[aria-label="Close connection menu"]'))?.focus() }, [])
  return <div className="menu-backdrop" onPointerDown={close} onContextMenu={e => { e.preventDefault(); close() }}>
    <div ref={menu} className="node-menu connection-menu" role="dialog" aria-label="Connection actions" style={{ left: Math.max(8, Math.min(position.x, window.innerWidth - 348)), top, maxHeight: `calc(100dvh - ${top + 8}px)` }} onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }}>
      <div className="menu-title"><span>{socket ? socket.type === 'target' ? 'Input connection' : 'Output connections' : 'Wire connection'}</span><button aria-label="Close connection menu" onClick={close}>×</button></div>
      <div className="connection-list">
        {connections.map(edge => <div className="connection-item" key={edge.id}><p><span>{endpoint(edge.source, edge.sourceHandle, false)}</span><span className="connection-arrow">↓</span><span>{endpoint(edge.target, edge.targetHandle, true)}</span></p><button className="danger" data-disconnect disabled={locked} onClick={() => disconnect([edge.id])}>{socket?.type === 'target' ? 'Disconnect input' : 'Disconnect wire'}</button></div>)}
        {!connections.length && <p className="connection-empty">This socket has no connections. Drag from it to a compatible input or output to create a wire.</p>}
      </div>
      {connections.length > 1 && <div className="connection-all"><button className="danger" data-disconnect disabled={locked} onClick={() => disconnect(connections.map(e => e.id))}>Disconnect all outputs ({connections.length})</button></div>}
      <div className="menu-hint">Nodes stay in place · Ctrl Z restores the wire</div>
    </div>
  </div>
}
