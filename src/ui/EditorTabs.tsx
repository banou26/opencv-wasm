import type { Port, PortType } from '../engine/types'
import { DataTypes } from './DataTypes'
import { PORT_LABELS } from '../engine/specs'
import { useEditor } from './store'

/** Tabs retain the instance path, so internal previews receive that instance's real input values. */
export const EditorTabs = () => {
  const state = useEditor(), locked = state.busy === 'bake', definition = state.doc.definitions?.find(d => d.id === state.view.interfaceId)
  const patchPorts = (side: 'inputs' | 'outputs', ports: Port[]) => { if (definition) state.changeInterface(definition.id, { name: definition.name, inputs: definition.inputs, outputs: definition.outputs, [side]: ports }) }
  return <>
    <div className="editor-tabbar" role="tablist" aria-label="Node editor tabs">
      {state.tabs.map(tab => <div key={tab.id} className={`editor-tab ${state.activeTab === tab.id ? 'active' : ''}`}>
        <button role="tab" aria-selected={state.activeTab === tab.id} disabled={locked} onClick={() => state.switchTab(tab.id)}>{tab.id === 'main' ? 'Main graph' : state.doc.definitions?.find(d => d.id === tab.definition)?.name ?? 'Custom node'}{tab.id !== 'main' && <code>{tab.path.length > 1 ? ` / depth ${tab.path.length}` : ''}</code>}</button>
        {tab.id !== 'main' && <button disabled={locked} aria-label="Close custom node tab" onClick={() => state.closeTab(tab.id)}>×</button>}
      </div>)}
      <DataTypes />
      <div className="history-buttons"><button title="Undo · Ctrl Z" disabled={locked || !state.past.length} onClick={state.undo}>↶</button><button title="Redo · Ctrl Shift Z" disabled={locked || !state.future.length} onClick={state.redo}>↷</button></div>
    </div>
    {definition && <details className="interface-editor" key={definition.id} open>
      <summary>Custom-node interface <span>Shared by every {definition.name} instance · double-click nested nodes to enter</span></summary>
      <div className="interface-content"><label className="definition-name">Node name<input aria-label="Custom node name" disabled={locked} key={`${definition.id}-${definition.name}`} defaultValue={definition.name} maxLength={80} onBlur={e => { const name = e.target.value.trim(); if (name) state.changeInterface(definition.id, { name, inputs: definition.inputs, outputs: definition.outputs }); else e.target.value = definition.name }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
        {(['inputs', 'outputs'] as const).map(side => <div className="interface-ports" key={side}><div className="interface-port-heading"><span>{side === 'inputs' ? 'Inputs' : 'Outputs'}</span><button disabled={locked || definition[side].length >= 32} onClick={() => patchPorts(side, [...definition[side], { id: `p${crypto.randomUUID().replaceAll('-', '')}`, label: side === 'inputs' ? 'New input' : 'New output', type: 'frame' }])}>＋ Add {side === 'inputs' ? 'input' : 'output'}</button></div>
          {definition[side].map((port, index) => <div className="interface-port" key={`${port.id}-${port.type}`}>
            <input aria-label={`${side} port ${index + 1} name`} disabled={locked} key={port.label} defaultValue={port.label} maxLength={80} onBlur={e => { const label = e.target.value.trim(); if (label) patchPorts(side, definition[side].map(p => p.id === port.id ? { ...p, label } : p)); else e.target.value = port.label }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <select aria-label={`${side} port ${index + 1} type`} disabled={locked} value={port.type === 'custom' ? `custom:${port.schema}` : port.type} onChange={e => { const [kind, schema] = e.target.value.split(':'), type = kind as PortType; patchPorts(side, definition[side].map(p => p.id === port.id ? { id: p.id, label: p.label, type, ...(schema ? { schema } : {}), ...(type === 'scalar' && side === 'inputs' ? { default: 0 } : {}) } : p)) }}>{Object.entries(PORT_LABELS).filter(([type]) => type !== 'custom' && type !== 'regions').map(([type, label]) => <option key={type} value={type}>{label}</option>)}{state.doc.dataTypes?.map(type => <option key={type.id} value={`custom:${type.id}`}>{type.name}</option>)}</select>
            {side === 'inputs' && port.type === 'scalar' && <input aria-label={`Default ${port.label}`} title="Default for new instances" type="number" disabled={locked} defaultValue={Number(port.default ?? 0)} min={-1000000} max={1000000} step={0.1} onBlur={e => { if (Number.isFinite(e.target.valueAsNumber)) patchPorts(side, definition[side].map(p => p.id === port.id ? { ...p, default: e.target.valueAsNumber } : p)) }} />}
            {side === 'inputs' && port.type === 'boolean' && <input aria-label={`Default ${port.label}`} type="checkbox" disabled={locked} checked={Boolean(port.default)} onChange={e => patchPorts(side, definition[side].map(p => p.id === port.id ? { ...p, default: e.target.checked } : p))} />}
            {side === 'inputs' && port.type === 'string' && <input aria-label={`Default ${port.label}`} type="text" disabled={locked} value={String(port.default ?? '')} maxLength={4096} onChange={e => patchPorts(side, definition[side].map(p => p.id === port.id ? { ...p, default: e.target.value } : p))} />}
            <button aria-label={`Remove ${side} port ${index + 1}`} disabled={locked} title="Remove this port and its connections. Undo restores them." onClick={() => patchPorts(side, definition[side].filter(p => p.id !== port.id))}>×</button>
          </div>)}
        </div>)}
      </div>
    </details>}
  </>
}
