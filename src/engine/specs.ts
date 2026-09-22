import type { NodeSpec, NodeType, Params, PortType } from './types'

/** Port colors remain consistent in the palette, sockets, edges and preview. */
export const PORT_COLORS: Record<PortType, string> = { frame: '#a6cb9d', scalar: '#efbc7b', motion: '#9caef4', regions: '#d495bd' }
/** Node contracts are the single source of truth for controls and graph validation. */
export const SPECS: Record<NodeType, NodeSpec> = {
  source: { type: 'source', title: 'Video Source', category: 'Input', description: 'Decode an exact frame from your clip. Connect it twice to compare neighboring frames.', algorithm: 'WebCodecs', version: 1, inputs: [], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [] },
  grayscale: { type: 'grayscale', title: 'Grayscale', category: 'Color', description: 'Keep brightness while removing color. Useful before comparing structure or motion.', algorithm: 'transform · cvtColor', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'select', key: 'weights', label: 'Weights', default: 'rec709', options: ['rec709', 'average'] }] },
  blur: { type: 'blur', title: 'Gaussian Blur', category: 'Filter', description: 'Average nearby pixels with Gaussian weights to reduce grain before measuring differences.', algorithm: 'GaussianBlur', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [{ id: 'out:frame:image', label: 'Image', type: 'frame' }], parameters: [{ kind: 'number', key: 'radius', label: 'Radius', default: 3, min: 0, max: 32, step: 1 }, { kind: 'number', key: 'sigma', label: 'Sigma', default: 1.5, min: 0.1, max: 16, step: 0.1 }] },
  delta: { type: 'delta', title: 'Frame Delta', category: 'Compare', description: 'Subtract B from A. The B input requests frame N + offset, including every node upstream of it.', algorithm: 'subtract · absdiff · mean', version: 1, inputs: [{ id: 'in:frame:a', label: 'A · frame N', type: 'frame' }, { id: 'in:frame:b', label: 'B · N + offset', type: 'frame', offsetParam: 'offset' }], outputs: [{ id: 'out:frame:delta', label: 'Difference', type: 'frame' }, { id: 'out:scalar:mean', label: 'Mean |Δ luma|', type: 'scalar' }], parameters: [{ kind: 'number', key: 'offset', label: 'B offset', default: 1, min: -8, max: 8, step: 1 }, { kind: 'boolean', key: 'absolute', label: 'Absolute difference', default: true }] },
  output: { type: 'output', title: 'Output', category: 'Output', description: 'Choose the final image for inspection and baking. It forwards the connected result without copying it.', algorithm: 'Preview target', version: 1, inputs: [{ id: 'in:frame:image', label: 'Image', type: 'frame' }], outputs: [], parameters: [] },
}

/** Produce independent default parameters for a newly created node. */
export const defaultParams = (type: NodeType): Params => Object.fromEntries(SPECS[type].parameters.map(p => [p.key, p.default]))

/** Refuse unknown, missing or out-of-range values before a native operation. */
export const validateParams = (type: NodeType, params: Params): string | null => {
  const controls = SPECS[type].parameters
  if (Object.keys(params).some(key => !controls.some(p => p.key === key))) return 'Unknown node parameter'
  for (const p of controls) {
    const v = params[p.key]
    if (p.kind === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max || (p.step === 1 && !Number.isInteger(v)))) return `${p.label} must be between ${p.min} and ${p.max}`
    if (p.kind === 'boolean' && typeof v !== 'boolean') return `${p.label} must be true or false`
    if (p.kind === 'select' && (typeof v !== 'string' || !p.options.includes(v))) return `Unknown ${p.label.toLowerCase()}`
  }
  return null
}
