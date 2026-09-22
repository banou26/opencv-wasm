import { useState } from 'react'
import { PORT_LABELS } from '../engine/specs'
import type { DataTypeDefinition, PortType } from '../engine/types'
import { useEditor } from './store'

/** A named record schema can be passed through groups and expanded into typed fields. */
export const DataTypes = () => {
  const state = useEditor(), [open, setOpen] = useState(false), [active, setActive] = useState('')
  const types = state.doc.dataTypes ?? [], selected = types.find(t => t.id === active) ?? types[0], locked = state.busy === 'bake'
  const update = (schema: DataTypeDefinition) => state.changeDataType(schema)
  return <div className="data-type-controls">
    <button aria-expanded={open} onClick={() => setOpen(!open)}>Data types ({types.length})</button>
    {open && <div className="data-type-editor" role="dialog" aria-label="Custom data types">
      <div className="data-type-heading"><strong>Named data types</strong><button onClick={() => setOpen(false)} aria-label="Close data types">×</button></div>
      <p>Bundle values such as a frame, region, confidence and label. Make and Separate nodes expose each field with its own type.</p>
      <div className="data-type-toolbar"><select aria-label="Data type" value={selected?.id ?? ''} onChange={e => setActive(e.target.value)}>{!types.length && <option value="">No custom types yet</option>}{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button disabled={locked || types.length >= 64} onClick={() => {
        const id = `t${crypto.randomUUID().replaceAll('-', '')}`
        update({ id, name: `Region Data ${types.length + 1}`, fields: [{ id: 'region', label: 'Region', type: 'rect' }, { id: 'confidence', label: 'Confidence', type: 'scalar', default: 1 }, { id: 'label', label: 'Label', type: 'string', default: '' }] }); setActive(id)
      }}>＋ New type</button></div>
      {selected && <>
        <label>Type name<input aria-label="Data type name" key={`${selected.id}-${selected.name}`} defaultValue={selected.name} maxLength={80} disabled={locked} onBlur={e => { const name = e.target.value.trim(); if (name && name !== selected.name) update({ ...selected, name }) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
        <div className="data-type-fields">{selected.fields.map((field, index) => <div className="data-type-field" key={field.id}>
          <input aria-label={`Field ${index + 1} name`} key={field.label} defaultValue={field.label} maxLength={80} disabled={locked} onBlur={e => { const label = e.target.value.trim(); if (label && label !== field.label) update({ ...selected, fields: selected.fields.map(p => p.id === field.id ? { ...p, label } : p) }) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          <select aria-label={`Field ${index + 1} type`} value={field.type} disabled={locked} onChange={e => update({ ...selected, fields: selected.fields.map(p => p.id === field.id ? { id: p.id, label: p.label, type: e.target.value as PortType } : p) })}>{Object.entries(PORT_LABELS).filter(([type]) => type !== 'custom' && type !== 'regions').map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
          <button aria-label={`Remove field ${index + 1}`} disabled={locked || selected.fields.length === 1} onClick={() => update({ ...selected, fields: selected.fields.filter(p => p.id !== field.id) })}>×</button>
        </div>)}</div>
        <button disabled={locked || selected.fields.length >= 32} onClick={() => update({ ...selected, fields: [...selected.fields, { id: `f${crypto.randomUUID().replaceAll('-', '')}`, label: 'Value', type: 'scalar', default: 0 }] })}>＋ Add field</button>
        <div className="data-type-toolbar"><button disabled={locked} onClick={() => { state.add('makeRecord', { x: 80, y: 100 }, selected.id); setOpen(false) }}>Add Make {selected.name}</button><button disabled={locked} onClick={() => { state.add('breakRecord', { x: 420, y: 100 }, selected.id); setOpen(false) }}>Add Separate {selected.name}</button></div>
      </>}
      <small>Changes apply to every node using this type. Removed or changed field connections are disconnected; Undo restores them.</small>
    </div>}
  </div>
}
