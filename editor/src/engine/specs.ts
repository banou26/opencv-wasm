import type { GraphDocument, GraphNode, NodeSpec, NodeType, Params, PortType, Parameter, Port } from './types'
import { CATALOG } from './catalog'

/** Port colors remain consistent in the menu, sockets, edges and preview. */
export const PORT_COLORS: Record<PortType, string> = { frame: '#a6cb9d', video: '#e3c1ff', scalar: '#efbc7b', boolean: '#ea8195', string: '#6edbce', vector: '#99b8ff', rect: '#e0be73', frames: '#76c6a9', custom: '#c89aef', motion: '#9caef4', regions: '#d495bd' }
/** Node contracts are the single source of truth for controls and graph validation. */
const BASE: Partial<Record<NodeType, NodeSpec>> = {
  group: { type: 'group', title: 'Custom Node', category: 'Custom', description: 'A reusable graph with named, typed inputs and outputs. Double-click to edit its basic nodes.', algorithm: 'Internal node graph', version: 1, inputs: [], outputs: [], parameters: [] },
  groupInput: { type: 'groupInput', title: 'Group Inputs', category: 'Interface', description: 'Values supplied by this custom-node instance’s external connections or typed primitive defaults.', algorithm: 'External inputs → internal graph', version: 1, inputs: [], outputs: [], parameters: [] },
  groupOutput: { type: 'groupOutput', title: 'Group Outputs', category: 'Interface', description: 'Connect the internal results you want this custom node to expose to its parent graph.', algorithm: 'Internal graph → external outputs', version: 1, inputs: [], outputs: [], parameters: [] },
  constant: { type: 'constant', title: 'Number', category: 'Input', description: 'Produce a reusable numeric value that can drive another node’s input.', algorithm: 'constant', version: 1, inputs: [], outputs: [{ id: 'out:scalar:value', label: 'Value', type: 'scalar' }], parameters: [{ kind: 'number', key: 'value', label: 'Value', default: 0, min: -1000000, max: 1000000, step: 0.1 }] },
  multiply: { type: 'multiply', title: 'Multiply', category: 'Math', description: 'Multiply two numbers. For example, displacement times a time fraction gives the intermediate displacement.', algorithm: 'A × B', version: 1, inputs: [{ id: 'in:scalar:a', label: 'A', type: 'scalar' }, { id: 'in:scalar:b', label: 'B · optional', type: 'scalar', optional: true }], outputs: [{ id: 'out:scalar:value', label: 'Product', type: 'scalar' }], parameters: [{ kind: 'number', key: 'factor', label: 'Fallback B', default: 1, min: -1000000, max: 1000000, step: 0.1 }] },
  translateX: { type: 'translateX', title: 'Translate X', category: 'Transform', description: 'Shift an image horizontally by a scalar number of pixels. Positive values move right. Empty space is black.', algorithm: 'warpAffine · X axis', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }, { id: 'in:scalar:pixels', label: 'X pixels · optional', type: 'scalar', optional: true }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'number', key: 'pixels', label: 'Fallback X · px', default: 0, min: -1000000, max: 1000000, step: 0.1 }] },
  translateY: { type: 'translateY', title: 'Translate Y', category: 'Transform', description: 'Shift an image vertically by a scalar number of pixels. Positive values move down. Empty space is black.', algorithm: 'warpAffine · Y axis', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }, { id: 'in:scalar:pixels', label: 'Y pixels · optional', type: 'scalar', optional: true }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'number', key: 'pixels', label: 'Fallback Y · px', default: 0, min: -1000000, max: 1000000, step: 0.1 }] },
  time: { type: 'time', title: 'Time', category: 'Input', description: 'Expose the current evaluation time as scalar outputs. Fraction is the progress from source frame N toward N+1.', algorithm: 'time → floor + fraction', version: 1, inputs: [], outputs: [{ id: 'out:scalar:index', label: 'Frame index · floor', type: 'scalar' }, { id: 'out:scalar:fraction', label: 'Fraction 0…1', type: 'scalar' }, { id: 'out:scalar:frame', label: 'Frame time', type: 'scalar' }, { id: 'out:scalar:seconds', label: 'Seconds', type: 'scalar' }], parameters: [] },
  extractFrame: { type: 'extractFrame', title: 'Extract Frame', category: 'Time', description: 'Freeze the connected branch at a specific zero-based frame index N, independent of the timeline. Feed two Extract Frame nodes into Frame Delta to compare any pair of frames.', algorithm: 'upstream time = frame N', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image at frame N', type: 'frame', frameParam: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Extracted image', type: 'frame' }], parameters: [{ kind: 'number', key: 'frame', label: 'Frame N (from 0)', default: 0, min: 0, max: 1000000000, step: 1 }] },
  offset: { type: 'offset', title: 'Frame Offset', category: 'Time', description: 'Request another time from the entire connected upstream branch. Use +1 for the next source drawing or −1 for the previous one.', algorithm: 'upstream time + offset', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image at N + offset', type: 'frame', offsetParam: 'offset' }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'number', key: 'offset', label: 'Frame offset', default: 1, min: -32, max: 32, step: 1 }] },
  threshold: { type: 'threshold', title: 'Threshold Mask', category: 'Mask', description: 'Select pixels whose brightness exceeds a cutoff. On a difference image this marks changed pixels, not a complete character layer.', algorithm: 'transform · threshold', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Binary mask', type: 'frame' }], parameters: [{ kind: 'number', key: 'cutoff', label: 'Cutoff 0…1', default: 0.04, min: 0, max: 1, step: 0.01 }, { kind: 'boolean', key: 'invert', label: 'Invert mask', default: false }] },
  composite: { type: 'composite', title: 'Masked Composite', category: 'Compose', description: 'Copy foreground pixels where the mask exceeds 0.5 and keep the background everywhere else. The binary decision preserves source pixels.', algorithm: 'threshold · copyTo', version: 1, inputs: [{ id: 'in:frame:foreground', label: 'Foreground', type: 'frame' }, { id: 'in:frame:background', label: 'Background', type: 'frame' }, { id: 'in:frame:mask', label: 'Mask', type: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Composite', type: 'frame' }], parameters: [] },

  motion: { type: 'motion', title: 'Estimate Translation', category: 'Measure', description: 'Compare two frames in the frequency domain to estimate one global camera translation. This does not separate independently moving layers.', algorithm: 'phaseCorrelate', version: 1, inputs: [{ id: 'in:frame:a', label: 'A · frame N', type: 'frame' }, { id: 'in:frame:b', label: 'B · N + offset', type: 'frame', offsetParam: 'offset' }], outputs: [{ id: 'out:motion:shift', label: 'Translation', type: 'motion' }, { id: 'out:scalar:response', label: 'Response', type: 'scalar' }, { id: 'out:scalar:dx', label: 'Delta X · px', type: 'scalar' }, { id: 'out:scalar:dy', label: 'Delta Y · px', type: 'scalar' }], parameters: [{ kind: 'number', key: 'offset', label: 'B offset', default: 1, min: 1, max: 8, step: 1 }] },
  source: { type: 'source', title: 'Video Source', category: 'Input', description: 'Decode an exact frame from your clip. Connect it twice to compare neighboring frames.', algorithm: 'WebCodecs', version: 1, inputs: [], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [] },
  grayscale: { type: 'grayscale', title: 'Grayscale', category: 'Color', description: 'Keep brightness while removing color. Useful before comparing structure or motion.', algorithm: 'transform · cvtColor', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'select', key: 'weights', label: 'Weights', default: 'rec709', options: ['rec709', 'average'] }] },
  blur: { type: 'blur', title: 'Gaussian Blur', category: 'Filter', description: 'Average nearby pixels with Gaussian weights to reduce grain before measuring differences.', algorithm: 'GaussianBlur', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'number', key: 'radius', label: 'Radius', default: 3, min: 0, max: 32, step: 1 }, { kind: 'number', key: 'sigma', label: 'Sigma', default: 1.5, min: 0.1, max: 16, step: 0.1 }] },
  delta: { type: 'delta', title: 'Frame Delta', category: 'Compare', description: 'Subtract B from A. The B input requests frame N + offset, including every node upstream of it.', algorithm: 'subtract · absdiff · mean', version: 1, inputs: [{ id: 'in:frame:a', label: 'A · frame N', type: 'frame' }, { id: 'in:frame:b', label: 'B · N + offset', type: 'frame', offsetParam: 'offset' }], outputs: [{ id: 'out:frame:delta', label: 'Difference', type: 'frame' }, { id: 'out:scalar:mean', label: 'Mean |Δ luma|', type: 'scalar' }], parameters: [{ kind: 'number', key: 'offset', label: 'B offset', default: 1, min: -8, max: 8, step: 1 }, { kind: 'boolean', key: 'absolute', label: 'Absolute difference', default: true }] },
  output: { type: 'output', title: 'Output', category: 'Output', description: 'Choose the final image for inspection and baking. It forwards the connected result without copying it.', algorithm: 'Preview target', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [], parameters: [] },
}

/** Names are visible on sockets as well as in the graph legend. */
export const PORT_LABELS: Record<PortType, string> = { frame: 'Frame', video: 'Video', scalar: 'Number', boolean: 'Boolean', string: 'Text', vector: 'Vector 2D', rect: 'Rectangle', frames: 'Frame list', custom: 'Record', motion: 'Motion', regions: 'Regions' }
export const primitiveDefault = (port: Port): string | number | boolean | undefined => port.default ?? (port.type === 'scalar' ? 0 : port.type === 'boolean' ? false : port.type === 'string' ? '' : undefined)
export const portParameter = (port: Port): Parameter | undefined => port.type === 'scalar' ? { kind: 'number', key: port.id, label: port.label, default: Number(primitiveDefault(port)), min: -1000000, max: 1000000, step: 0.1 } : port.type === 'boolean' ? { kind: 'boolean', key: port.id, label: port.label, default: Boolean(primitiveDefault(port)) } : port.type === 'string' ? { kind: 'text', key: port.id, label: port.label, default: String(primitiveDefault(port)), maxLength: 4096 } : undefined

/** An unwired parameter uses its inline value; wiring overrides it without destroying that default. */
export const withParameterSockets = (spec: NodeSpec): NodeSpec => {
  const inputs = spec.inputs.map(p => ({ ...p }))
  for (const parameter of spec.parameters) {
    const type: PortType = parameter.kind === 'number' ? 'scalar' : parameter.kind === 'boolean' ? 'boolean' : 'string'
    const existing = inputs.find(p => p.parameter === parameter.key) ?? (spec.type === 'multiply' && parameter.key === 'factor' ? inputs.find(p => p.id === 'in:scalar:b') : (spec.type === 'translateX' || spec.type === 'translateY') && parameter.key === 'pixels' ? inputs.find(p => p.id === 'in:scalar:pixels') : undefined)
    if (existing) { existing.parameter = parameter.key; existing.optional = true }
    else inputs.push({ id: `param:${parameter.key}`, label: parameter.label, type, parameter: parameter.key, optional: true })
  }
  return { ...spec, inputs }
}
export const HIDDEN_NODES: NodeType[] = ['group', 'groupInput', 'groupOutput', 'source', 'offset', 'extractFrame', 'delta', 'motion', 'makeRecord', 'breakRecord']
export const SPECS = Object.fromEntries([...Object.values(BASE), ...CATALOG].map(spec => [spec.type, withParameterSockets(spec)])) as Record<NodeType, NodeSpec>

/** Resolve a custom node against the project library, or its explicit interface context. */
export const specFor = (node: GraphNode, doc: GraphDocument): NodeSpec => {
  if (node.type === 'group') {
    const definition = doc.definitions?.find(d => d.id === node.definition)
    if (!definition) throw new Error('Missing custom-node definition')
    const inputs = definition.inputs.map(p => ({ ...p, optional: primitiveDefault(p) !== undefined, ...(primitiveDefault(p) !== undefined ? { parameter: p.id } : {}) }))
    return { ...SPECS.group, title: definition.name, description: definition.description ?? SPECS.group.description, inputs, outputs: definition.outputs, parameters: definition.inputs.flatMap(p => { const control = portParameter(p); return control ? [control] : [] }) }
  }
  if (node.type === 'makeRecord' || node.type === 'breakRecord') {
    const type = doc.dataTypes?.find(t => t.id === node.dataType)
    if (!type) throw new Error('Choose a named data type for this record node')
    const record: Port = { id: 'record', label: type.name, type: 'custom', schema: type.id }
    const fields = type.fields.map(p => ({ ...p, optional: primitiveDefault(p) !== undefined, ...(primitiveDefault(p) !== undefined ? { parameter: p.id } : {}) }))
    return node.type === 'makeRecord' ? { ...SPECS.makeRecord, title: `Make ${type.name}`, inputs: fields, outputs: [record], parameters: type.fields.flatMap(p => { const control = portParameter(p); return control ? [control] : [] }) } : { ...SPECS.breakRecord, title: `Separate ${type.name}`, inputs: [record], outputs: type.fields, parameters: [] }
  }
  if (node.type === 'groupInput' || node.type === 'groupOutput') {
    const definition = doc.definitions?.find(d => d.id === doc.interfaceId)
    if (!definition) throw new Error('Group interface nodes belong inside a custom node')
    return node.type === 'groupInput' ? { ...SPECS.groupInput, outputs: definition.inputs } : { ...SPECS.groupOutput, inputs: definition.outputs }
  }
  return SPECS[node.type]
}

/** Produce independent default parameters for a newly created node. */
export const defaultParams = (type: NodeType): Params => Object.fromEntries(SPECS[type].parameters.map(p => [p.key, p.default]))

/** Refuse unknown, missing or out-of-range values before a native operation. */
export const validateParams = (type: NodeType, params: Params, spec = SPECS[type]): string | null => {
  const controls = spec.parameters
  if (Object.keys(params).some(key => !controls.some(p => p.key === key))) return 'Unknown node parameter'
  for (const p of controls) {
    const v = params[p.key]
    if (p.kind === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max || (p.step === 1 && !Number.isInteger(v)))) return `${p.label} must be between ${p.min} and ${p.max}`
    if (p.kind === 'boolean' && typeof v !== 'boolean') return `${p.label} must be true or false`
    if (p.kind === 'text' && (typeof v !== 'string' || v.length > p.maxLength)) return `${p.label} must be text with at most ${p.maxLength} characters`
    if (p.kind === 'select' && (typeof v !== 'string' || !p.options.includes(v))) return `Unknown ${p.label.toLowerCase()}`
  }
  return null
}
